const crypto = require('crypto');

const { fonteAtiva } = require('../fontes');
const configuracoes = require('./configuracoes');
const codigosTpuModel = require('../models/codigosTpu');
const processosModel = require('../models/processos');
const movimentosModel = require('../models/movimentos');
const { buildLinkConsultaPublica } = require('./linkBuilder');
const { criarAlertaParaMovimento } = require('./alertEngine');
const { tribunalDoNumero } = require('../util/cnj');

/**
 * A 1a ocorrencia de (codigo, horario) usa o hash original, entao os movimentos ja gravados
 * continuam reconhecidos; so as repeticoes no mesmo segundo ganham o sufixo `#n`.
 */
function hashDedup(processoId, codigoTpu, dataHora, ocorrencia = 1) {
    const sufixo = ocorrencia > 1 ? `#${ocorrencia}` : '';
    return crypto
        .createHash('sha256')
        .update(`${processoId}:${codigoTpu ?? ''}:${dataHora ?? ''}${sufixo}`)
        .digest('hex');
}

/**
 * Aplica os dados vindos da fonte a um processo ja cadastrado: atualiza metadados, grava os
 * movimentos novos e cria alertas para os relevantes.
 *
 * Carga inicial: na primeira vez que um processo e localizado (nenhum movimento salvo ainda), o
 * historico inteiro entra como linha do tempo, mas so geram alerta os movimentos relevantes dos
 * ultimos N dias (Configuracoes > Integracao). Sem isso, cadastrar 300 processos geraria milhares de
 * alertas de intimacoes antigas ja tratadas.
 */
async function aplicarDadosDaFonte(processo, dados, { mapaCodigosRelevantes, janelaCargaInicialDias }) {
    const atualizado = await processosModel.atualizarDadosFonte(processo.id, {
        grau: dados.grau,
        graus: dados.graus,
        classeNome: dados.classeNome,
        orgaoJulgador: dados.orgaoJulgador,
        dataAjuizamento: dados.dataAjuizamento,
        valorCausa: dados.valorCausa,
        sistema: dados.sistema,
        linkConsultaPublica: buildLinkConsultaPublica({
            numeroProcesso: processo.numero_processo,
            tribunal: processo.tribunal,
            grau: dados.grau,
            // O que a Procuradoria informou manualmente prevalece sobre o DataJud.
            sistema: processo.sistema_informado || dados.sistema
        })
    });

    const hashesExistentes = await movimentosModel.listHashesExistentes(processo.id);
    const primeiraCarga = hashesExistentes.size === 0;
    const limiteCargaInicial = Date.now() - janelaCargaInicialDias * 24 * 60 * 60 * 1000;

    const vistos = new Set();
    const novos = [];
    // Repeticoes que antes eram descartadas pela deduplicacao antiga: entram na linha do tempo, mas
    // nao geram alerta, porque a 1a ocorrencia (mesmo codigo e horario) ja foi gravada e alertada.
    const semAlerta = new Set();
    for (const m of dados.movimentos) {
        // `chave` = valor bruto da fonte; mantem os hashes ja gravados validos mesmo com a correcao de fuso.
        const chave = m.chave ?? m.dataHora;
        const hash = hashDedup(processo.id, m.codigo, chave, m.ocorrencia);
        if (hashesExistentes.has(hash) || vistos.has(hash)) continue;
        vistos.add(hash);
        if (m.ocorrencia > 1 && hashesExistentes.has(hashDedup(processo.id, m.codigo, chave))) semAlerta.add(hash);
        novos.push({
            processoId: processo.id,
            codigoTpu: m.codigo,
            nome: m.nome,
            dataHora: m.dataHora,
            relevanteParaPrazo: mapaCodigosRelevantes.has(m.codigo),
            hashDedup: hash
        });
    }

    const inseridos = await movimentosModel.insertMany(novos);

    let alertasCriados = 0;
    for (const movimento of inseridos) {
        if (!movimento.relevante_para_prazo || semAlerta.has(movimento.hash_dedup)) continue;
        if (primeiraCarga) {
            const quando = movimento.data_hora ? new Date(movimento.data_hora).getTime() : 0;
            if (quando < limiteCargaInicial) continue;
        }
        await criarAlertaParaMovimento({ processo: atualizado, movimento });
        alertasCriados += 1;
    }

    return { movimentosNovos: inseridos.length, alertasCriados };
}

let emAndamento = null;

/**
 * Consulta a fonte ativa para os processos ativos (ou so para `processoIds`, ex.: logo apos uma
 * importacao) e reconcilia. Execucoes simultaneas sao enfileiradas na mesma promessa.
 */
async function sincronizar({ processoIds = null, origem = 'agendado' } = {}) {
    if (emAndamento && !processoIds) return emAndamento;
    const execucao = executar({ processoIds, origem }).finally(() => {
        if (emAndamento === execucao) emAndamento = null;
    });
    if (!processoIds) emAndamento = execucao;
    return execucao;
}

async function executar({ processoIds, origem }) {
    const inicio = new Date();
    const fonte = await fonteAtiva();
    const resumo = {
        fonte: fonte.nome,
        origem,
        processosConsultados: 0,
        localizados: 0,
        naoLocalizados: 0,
        descobertos: 0,
        movimentosNovos: 0,
        alertasCriados: 0,
        erros: []
    };

    if (!(await fonte.disponivel())) {
        throw new Error(`Fonte de dados "${fonte.rotulo}" indisponível — verifique Configurações > Integração.`);
    }

    if (!processoIds && typeof fonte.descobrirProcessos === 'function') {
        try {
            const numeros = await fonte.descobrirProcessos();
            for (const numero of numeros || []) {
                const criado = await processosModel.inserirManual({
                    numeroProcesso: numero,
                    tribunal: tribunalDoNumero(numero) || 'desconhecido',
                    origem: 'mni_aviso'
                });
                if (criado) resumo.descobertos += 1;
            }
        } catch (err) {
            resumo.erros.push({ etapa: 'descoberta', erro: err.message });
        }
    }

    const processos = processoIds
        ? await processosModel.listPorIds(processoIds)
        : await processosModel.listAtivosParaSync();
    resumo.processosConsultados = processos.length;

    if (processos.length) {
        const [mapaCodigosRelevantes, janelaCargaInicialDias] = await Promise.all([
            codigosTpuModel.getMapaRelevancia(),
            configuracoes.lerNumero('sync.janela_carga_inicial_dias')
        ]);

        const { encontrados, erros } = await fonte.consultarProcessos(processos.map((p) => p.numero_processo));
        resumo.erros.push(...erros);
        const tribunaisComErro = new Set(erros.map((e) => e.tribunal));

        for (const processo of processos) {
            // Se a consulta do tribunal falhou, nao da para afirmar que o processo "nao foi localizado".
            if (tribunaisComErro.has(processo.tribunal)) continue;
            const dados = encontrados.get(processo.numero_processo);
            if (!dados) {
                await processosModel.marcarConsulta(processo.id, 'nao_localizado');
                resumo.naoLocalizados += 1;
                continue;
            }
            try {
                const r = await aplicarDadosDaFonte(processo, dados, { mapaCodigosRelevantes, janelaCargaInicialDias });
                await processosModel.marcarConsulta(processo.id, 'localizado');
                resumo.localizados += 1;
                resumo.movimentosNovos += r.movimentosNovos;
                resumo.alertasCriados += r.alertasCriados;
            } catch (err) {
                console.error(`[sync] Falha ao reconciliar ${processo.numero_processo}:`, err.message);
                resumo.erros.push({ processo: processo.numero_processo, erro: err.message });
            }
        }
    }

    if (!processoIds) {
        await configuracoes.salvar({
            'sync.ultimo_em': inicio.toISOString(),
            'sync.ultimo_resumo': JSON.stringify(resumo)
        });
    }
    return resumo;
}

function syncEmAndamento() {
    return Boolean(emAndamento);
}

module.exports = { sincronizar, syncEmAndamento, aplicarDadosDaFonte };
