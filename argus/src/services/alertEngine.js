const alertasModel = require('../models/alertas');
const movimentosModel = require('../models/movimentos');
const processosModel = require('../models/processos');
const usuariosModel = require('../models/usuarios');
const configuracoes = require('./configuracoes');
const mensagens = require('./mensagensEmail');
const mailer = require('./mailer');
const outbox = require('./outbox');
const { PAPEIS_RECEBEM_ALERTAS, PAPEIS_RESPONSAVEIS, PAPEL_ESCALONAMENTO } = require('../config/papeis');
const { hojeSP, somarDiasUteis } = require('../util/datas');
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

// Entra na fila de saida (services/outbox): o envio, com novas tentativas, acontece fora do sync.
async function enviarParaEquipe(mensagem, { tipo, referencia }) {
    for (const to of await destinatariosAlerta()) {
        await outbox.enfileirar({ to, ...mensagem }, { tipo, referencia });
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
            }),
            { tipo: 'alerta_novo', referencia: `alerta:${alerta.id}` }
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
 * Movimento do mesmo dia de um alerta ainda aberto entra nesse alerta (PRD MEL-17) e nao gera
 * novo e-mail: a equipe ja foi avisada daquele alerta e o ve no sistema.
 *
 * @returns {Promise<{alerta: object, novo: boolean}|null>} null se o movimento ja tinha sido tratado
 */
async function criarAlertaParaMovimento({ processo, movimento }) {
    const prazoDiasAlerta = await configuracoes.lerNumero('geral.dias_escalonamento');
    const resultado = await alertasModel.criarParaMovimentoPendente({ movimentoId: movimento.id, prazoDiasAlerta });
    if (!resultado) return null;
    if (resultado.novo) await notificarNovoAlerta({ alerta: resultado.alerta, processo, movimento });
    return resultado;
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
            const resultado = await criarAlertaParaMovimento({ processo: processos.get(movimento.processo_id), movimento });
            if (resultado?.novo) criados += 1;
        } catch (err) {
            falhas += 1;
            console.error(`[alertas] Falha ao criar alerta do movimento ${movimento.id} (fica pendente):`, err.message);
        }
    }
    return { criados, falhas };
}

/**
 * Quem recebe o escalonamento (PRD MEL-10): o responsavel pelo processo, que e quem deve agir, e
 * o(s) procurador(es), que respondem pela Procuradoria. O restante da equipe ja recebeu o alerta
 * novo e nao e avisado de novo. Fica registrado como destino o responsavel, se for procurador;
 * senao o primeiro procurador ativo.
 */
async function destinosEscalonamento(processoResponsavelId) {
    const procuradores = await usuariosModel.listAtivosPorPapeis([PAPEL_ESCALONAMENTO]);
    const responsavel = processoResponsavelId ? await usuariosModel.findById(processoResponsavelId) : null;
    const responsavelAtivo = responsavel && responsavel.ativo && PAPEIS_RESPONSAVEIS.includes(responsavel.papel) ? responsavel : null;
    const destino = responsavelAtivo?.papel === PAPEL_ESCALONAMENTO ? responsavelAtivo : procuradores[0] || null;
    const emails = [...new Set([responsavelAtivo?.email, ...procuradores.map((p) => p.email)].filter(Boolean))];
    // Sem procurador nem responsavel ativo: ninguem pode ficar sem saber — vai para a equipe toda.
    return { destino, emails: emails.length ? emails : await destinatariosAlerta() };
}

/**
 * Alertas pendentes/visualizados sem ciencia depois de N dias UTEIS (PRD MEL-09; sabado, domingo
 * e feriados nao contam) viram "escalado" e o responsavel + procurador(es) sao avisados. Escala
 * quando "hoje" passa do N-esimo dia util apos o dia de criacao. Alerta escalado continua
 * aceitando ciencia.
 */
async function escalarAlertasVencidos({ hoje = hojeSP() } = {}) {
    const prazoDiasPadrao = await configuracoes.lerNumero('geral.dias_escalonamento');
    const vencidos = (await alertasModel.listParaEscalonar()).filter(
        (a) => somarDiasUteis(a.criado_dia, a.prazo_dias_alerta || prazoDiasPadrao) < hoje
    );
    if (!vencidos.length) return 0;

    const aparencia = await mensagens.aparencia();

    let escalados = 0;
    for (const vencido of vencidos) {
        const { destino, emails } = await destinosEscalonamento(vencido.procurador_responsavel_id);
        // null = alguem deu ciencia entre a consulta e agora: nao escala nem avisa (PRD BUG-04).
        const marcado = await alertasModel.marcarEscalado(vencido.id, destino?.id || null);
        if (!marcado) continue;
        escalados += 1;
        try {
            const a = await alertasModel.findById(vencido.id);
            const mensagem = await mensagens.alertaEscalado(
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
            );
            for (const to of emails) {
                await outbox.enfileirar({ to, ...mensagem }, { tipo: 'alerta_escalado', referencia: `alerta:${a.id}` });
            }
        } catch (err) {
            console.error(`[alertas] Alerta ${vencido.id} escalado, mas a notificacao por e-mail falhou:`, err.message);
        }
    }

    return escalados;
}

module.exports = { criarAlertaParaMovimento, gerarAlertasPendentes, escalarAlertasVencidos };
