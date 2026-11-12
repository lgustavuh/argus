const crypto = require('crypto');

const { fonteAtiva, roteadorDeFontes } = require('../fontes');
const configuracoes = require('./configuracoes');
const codigosTpuModel = require('../models/codigosTpu');
const processosModel = require('../models/processos');
const movimentosModel = require('../models/movimentos');
const { buildLinkConsultaPublica } = require('./linkBuilder');
const { gerarAlertasPendentes } = require('./alertEngine');
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
 *
 * Troca de fonte (PRD MEL-19, ex.: DataJud -> MNI): o mesmo movimento chega com outro formato de
 * data e, portanto, outro hash. Na primeira consulta pela nova fonte, o movimento que ja existe com
 * o mesmo codigo e o mesmo minuto e reconhecido e so ganha o hash da nova fonte (nao duplica a
 * linha do tempo nem o alerta); o resto segue a regra da carga inicial.
 */
async function aplicarDadosDaFonte(processo, dados, { mapaCodigosRelevantes, janelaCargaInicialDias, fonteNome = 'datajud' }) {
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
    const trocaDeFonte = hashesExistentes.size > 0 && Boolean(processo.fonte_movimentos) && processo.fonte_movimentos !== fonteNome;
    const primeiraCarga = hashesExistentes.size === 0 || trocaDeFonte;

    // codigo|minuto -> ids dos movimentos ja gravados (so na troca de fonte).
    const jaGravados = new Map();
    if (trocaDeFonte) {
        for (const r of await movimentosModel.listChavesSemanticas(processo.id)) {
            const k = `${r.codigo_tpu ?? ''}|${r.minuto}`;
            if (!jaGravados.has(k)) jaGravados.set(k, []);
            jaGravados.get(k).push(r.id);
        }
    }
    const limiteCargaInicial = Date.now() - janelaCargaInicialDias * 24 * 60 * 60 * 1000;

    const foraDaCargaInicial = (dataHora) => {
        if (!primeiraCarga) return false;
        const quando = dataHora ? new Date(dataHora).getTime() : 0;
        return quando < limiteCargaInicial;
    };

    const vistos = new Set();
    const novos = [];
    for (const m of dados.movimentos) {
        // `chave` = valor bruto da fonte; mantem os hashes ja gravados validos mesmo com a correcao de fuso.
        const chave = m.chave ?? m.dataHora;
        const hash = hashDedup(processo.id, m.codigo, chave, m.ocorrencia);
        if (hashesExistentes.has(hash) || vistos.has(hash)) continue;
        vistos.add(hash);
        if (trocaDeFonte) {
            const ids = jaGravados.get(`${m.codigo ?? ''}|${minutoUtc(m.dataHora)}`);
            if (ids?.length) {
                await movimentosModel.trocarHash(ids.shift(), hash);
                continue;
            }
        }
        // Repeticoes que antes eram descartadas pela deduplicacao antiga: entram na linha do tempo, mas
        // nao geram alerta, porque a 1a ocorrencia (mesmo codigo e horario) ja foi gravada e alertada.
        const repeticaoJaAlertada = m.ocorrencia > 1 && hashesExistentes.has(hashDedup(processo.id, m.codigo, chave));
        const relevanteParaPrazo = mapaCodigosRelevantes.has(m.codigo);
        novos.push({
            processoId: processo.id,
            codigoTpu: m.codigo,
            nome: m.nome,
            dataHora: m.dataHora,
            relevanteParaPrazo,
            hashDedup: hash,
            // Decidido ANTES de gravar: o movimento entra marcado e a marca so sai junto com a
            // criacao do alerta (mesma transacao). Assim uma falha nunca deixa movimento sem alerta.
            alertaPendente: relevanteParaPrazo && !repeticaoJaAlertada && !foraDaCargaInicial(m.dataHora)
        });
    }

    const inseridos = await movimentosModel.insertMany(novos);
    if (processo.fonte_movimentos !== fonteNome) await processosModel.setFonteMovimentos(processo.id, fonteNome);

    // Inclui pendentes de rodadas anteriores deste processo que tenham falhado.
    const { criados: alertasCriados } = await gerarAlertasPendentes({ processoId: processo.id, processo: atualizado });

    return { movimentosNovos: inseridos.length, alertasCriados };
}

function minutoUtc(dataHora) {
    const t = dataHora ? new Date(dataHora) : null;
    return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 16) : null;
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
    const escolhida = await fonteAtiva();
    const fontePara = await roteadorDeFontes();
    const resumo = {
        fonte: escolhida.nome,
        origem,
        processosConsultados: 0,
        localizados: 0,
        naoLocalizados: 0,
        descobertos: 0,
        movimentosNovos: 0,
        alertasCriados: 0,
        erros: []
    };

    const escolhidaDisponivel = await escolhida.disponivel();

    if (!processoIds && escolhidaDisponivel && typeof escolhida.descobrirProcessos === 'function') {
        try {
            const numeros = await escolhida.descobrirProcessos();
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

    // Cada tribunal na sua fonte (PRD MEL-19): MNI no TJMG e DataJud no resto, por exemplo.
    const grupos = new Map();
    for (const processo of processos) {
        const fonte = fontePara(processo.tribunal);
        if (!grupos.has(fonte)) grupos.set(fonte, []);
        grupos.get(fonte).push(processo);
    }
    resumo.fonte = [...new Set([escolhida, ...grupos.keys()].map((f) => f.nome))].join(', ');

    const disponiveis = new Map();
    for (const fonte of grupos.keys()) {
        disponiveis.set(fonte, fonte === escolhida ? escolhidaDisponivel : await fonte.disponivel());
    }
    // Nenhuma fonte utilizavel: erro visivel na tela, como antes.
    if (processos.length ? ![...disponiveis.values()].some(Boolean) : !escolhidaDisponivel) {
        const f = processos.length ? [...grupos.keys()][0] : escolhida;
        throw new Error(`Fonte de dados "${f.rotulo}" indisponível — verifique Configurações > Integração.`);
    }

    if (processos.length) {
        const [mapaCodigosRelevantes, janelaCargaInicialDias] = await Promise.all([
            codigosTpuModel.getMapaRelevancia(),
            configuracoes.lerNumero('sync.janela_carga_inicial_dias')
        ]);

        for (const [fonte, lista] of grupos) {
            if (!disponiveis.get(fonte)) {
                // Fonte fora do ar nao e "nao localizado": os processos ficam como estavam.
                resumo.erros.push({ fonte: fonte.nome, erro: `Fonte "${fonte.rotulo}" indisponível; ${lista.length} processo(s) não consultado(s).` });
                continue;
            }
            const { encontrados, erros } = await fonte.consultarProcessos(lista.map((p) => p.numero_processo));
            resumo.erros.push(...erros);
            const tribunaisComErro = new Set(erros.map((e) => e.tribunal));

            for (const processo of lista) {
                // Se a consulta do tribunal falhou, nao da para afirmar que o processo "nao foi localizado".
                if (tribunaisComErro.has(processo.tribunal)) continue;
                const dados = encontrados.get(processo.numero_processo);
                if (!dados) {
                    await processosModel.marcarConsulta(processo.id, 'nao_localizado');
                    resumo.naoLocalizados += 1;
                    continue;
                }
                try {
                    const r = await aplicarDadosDaFonte(processo, dados, { mapaCodigosRelevantes, janelaCargaInicialDias, fonteNome: fonte.nome });
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
    }

    // Rede de seguranca: alertas que ficaram pendentes em qualquer processo (falha em rodada anterior).
    try {
        const { criados } = await gerarAlertasPendentes();
        resumo.alertasCriados += criados;
    } catch (err) {
        resumo.erros.push({ etapa: 'alertas_pendentes', erro: err.message });
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
