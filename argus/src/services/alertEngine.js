const alertasModel = require('../models/alertas');
const movimentosModel = require('../models/movimentos');
const processosModel = require('../models/processos');
const usuariosModel = require('../models/usuarios');
const configuracoes = require('./configuracoes');
const mensagens = require('./mensagensEmail');
// Acessado como `mailer.enviarEmail` (e nao desestruturado) para que os testes possam substitui-lo.
const mailer = require('./mailer');
const { PAPEIS_RECEBEM_ALERTAS, PAPEL_ESCALONAMENTO } = require('../config/papeis');
const { acessoNoTribunal } = require('./linkBuilder');

async function destinatariosAlerta() {
    const usuarios = await usuariosModel.listAtivosPorPapeis(PAPEIS_RECEBEM_ALERTAS);
    const emails = usuarios.map((u) => u.email);
    if (!emails.length) {
        const fallback = await mailer.emailFallback();
        if (fallback) emails.push(fallback);
    }
    return [...new Set(emails)];
}

async function enviarParaEquipe(mensagem) {
    for (const to of await destinatariosAlerta()) {
        await mailer.enviarEmail({ to, ...mensagem });
    }
}

/**
 * Avisa a equipe sobre um alerta ja gravado. Nunca lanca erro: o alerta ja existe no sistema, e
 * uma falha de e-mail (ou ao montar a mensagem) nao pode desfaze-lo nem interromper o sync.
 */
async function notificarNovoAlerta({ alerta, processo, movimento }) {
    try {
        const responsavel = processo.procurador_responsavel_id
            ? await usuariosModel.findById(processo.procurador_responsavel_id)
            : null;
        await enviarParaEquipe(
            await mensagens.novoAlerta({
                alertaId: alerta.id,
                numero: processo.numero_processo,
                movimento: movimento.nome || 'Movimento sem descrição',
                dataMovimento: movimento.data_hora,
                classe: processo.classe_nome,
                orgao: processo.orgao_julgador,
                tribunal: processo.tribunal,
                responsavel: responsavel?.nome,
                acesso: acessoNoTribunal(processo)
            })
        );
    } catch (err) {
        console.error(`[alertas] Alerta ${alerta.id} criado, mas a notificacao por e-mail falhou:`, err.message);
    }
}

/**
 * Cria o alerta de um movimento marcado com `alerta_pendente` e avisa a equipe (procuradores,
 * advogados e assistente — todos veem todos os processos do Municipio).
 *
 * A criacao e a remocao da marca acontecem na mesma transacao; se algo falhar antes do COMMIT,
 * o movimento continua pendente e sera reprocessado por `gerarAlertasPendentes`.
 *
 * @returns {Promise<object|null>} o alerta, ou null se o movimento ja tinha sido tratado
 */
async function criarAlertaParaMovimento({ processo, movimento }) {
    const prazoDiasAlerta = await configuracoes.lerNumero('geral.dias_escalonamento');
    const alerta = await alertasModel.criarParaMovimentoPendente({ movimentoId: movimento.id, prazoDiasAlerta });
    if (!alerta) return null;
    await notificarNovoAlerta({ alerta, processo, movimento });
    return alerta;
}

/**
 * Gera os alertas de todos os movimentos ainda marcados como pendentes (de um processo, ou de
 * todos). Falha em um movimento nao impede os demais; ele fica pendente para a proxima rodada.
 *
 * @returns {Promise<{criados: number, falhas: number}>}
 */
async function gerarAlertasPendentes({ processoId = null, processo = null } = {}) {
    const pendentes = await movimentosModel.listAlertaPendente({ processoId });
    const processos = new Map(processo ? [[processo.id, processo]] : []);
    let criados = 0;
    let falhas = 0;
    for (const movimento of pendentes) {
        try {
            if (!processos.has(movimento.processo_id)) {
                processos.set(movimento.processo_id, await processosModel.findById(movimento.processo_id));
            }
            const alerta = await criarAlertaParaMovimento({ processo: processos.get(movimento.processo_id), movimento });
            if (alerta) criados += 1;
        } catch (err) {
            falhas += 1;
            console.error(`[alertas] Falha ao criar alerta do movimento ${movimento.id} (fica pendente):`, err.message);
        }
    }
    return { criados, falhas };
}

/**
 * Alertas pendentes/visualizados sem ciencia ha mais tempo que o prazo interno viram "escalado":
 * o procurador e registrado como destino e toda a equipe e avisada de novo. Alerta escalado
 * continua aceitando ciencia.
 */
async function escalarAlertasVencidos() {
    const prazoDiasPadrao = await configuracoes.lerNumero('geral.dias_escalonamento');
    const vencidos = await alertasModel.listParaEscalonar(prazoDiasPadrao);
    if (!vencidos.length) return 0;

    const procuradores = await usuariosModel.listAtivosPorPapeis([PAPEL_ESCALONAMENTO]);
    const aparencia = await mensagens.aparencia();

    let escalados = 0;
    for (const vencido of vencidos) {
        // null = alguem deu ciencia entre a consulta e agora: nao escala nem avisa (PRD BUG-04).
        const marcado = await alertasModel.marcarEscalado(vencido.id, procuradores[0]?.id || null);
        if (!marcado) continue;
        escalados += 1;
        try {
            const a = await alertasModel.findById(vencido.id);
            await enviarParaEquipe(
                await mensagens.alertaEscalado(
                    {
                        alertaId: a.id,
                        numero: a.numero_processo,
                        movimento: a.movimento_nome || 'Movimento sem descrição',
                        dataMovimento: a.movimento_data_hora,
                        classe: a.classe_nome,
                        orgao: a.orgao_julgador,
                        tribunal: a.tribunal,
                        responsavel: a.procurador_nome,
                        acesso: acessoNoTribunal(a),
                        criadoEm: a.criado_em,
                        dias: a.prazo_dias_alerta || prazoDiasPadrao
                    },
                    aparencia
                )
            );
        } catch (err) {
            console.error(`[alertas] Alerta ${vencido.id} escalado, mas a notificacao por e-mail falhou:`, err.message);
        }
    }

    return escalados;
}

module.exports = { criarAlertaParaMovimento, gerarAlertasPendentes, escalarAlertasVencidos };
