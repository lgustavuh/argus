const alertasModel = require('../models/alertas');
const usuariosModel = require('../models/usuarios');
const configuracoes = require('./configuracoes');
const mensagens = require('./mensagensEmail');
const { enviarEmail, emailFallback } = require('./mailer');
const { PAPEIS_RECEBEM_ALERTAS, PAPEL_ESCALONAMENTO } = require('../config/papeis');

async function destinatariosAlerta() {
    const usuarios = await usuariosModel.listAtivosPorPapeis(PAPEIS_RECEBEM_ALERTAS);
    const emails = usuarios.map((u) => u.email);
    if (!emails.length) {
        const fallback = await emailFallback();
        if (fallback) emails.push(fallback);
    }
    return [...new Set(emails)];
}

async function enviarParaEquipe(mensagem) {
    for (const to of await destinatariosAlerta()) {
        await enviarEmail({ to, ...mensagem });
    }
}

/**
 * Cria um alerta para um movimento relevante e avisa toda a equipe que recebe alertas
 * (procuradores, advogados e assistente). Todos veem todos os processos do Municipio.
 */
async function criarAlertaParaMovimento({ processo, movimento }) {
    const prazoDiasAlerta = await configuracoes.lerNumero('geral.dias_escalonamento');

    const alerta = await alertasModel.create({
        processoId: processo.id,
        movimentoId: movimento.id,
        tipo: 'movimento_relevante',
        prazoDiasAlerta
    });

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
            linkOrigem: processo.link_consulta_publica
        })
    );

    return alerta;
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

    for (const vencido of vencidos) {
        await alertasModel.marcarEscalado(vencido.id, procuradores[0]?.id || null);
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
                    linkOrigem: a.link_consulta_publica,
                    criadoEm: a.criado_em,
                    dias: a.prazo_dias_alerta || prazoDiasPadrao
                },
                aparencia
            )
        );
    }

    return vencidos.length;
}

module.exports = { criarAlertaParaMovimento, escalarAlertasVencidos };
