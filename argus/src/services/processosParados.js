const processosModel = require('../models/processos');
const usuariosModel = require('../models/usuarios');
const configuracoes = require('./configuracoes');
const mensagens = require('./mensagensEmail');
const outbox = require('./outbox');
const { PAPEL_ESCALONAMENTO, PAPEIS_RESPONSAVEIS } = require('../config/papeis');
const { hojeSP, diaDaSemana } = require('../util/datas');

const HORA_AVISO = 7;

function horaSP(agora) {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(agora));
}

/**
 * Aviso semanal de processos parados (PRD MEL-13): toda segunda-feira, a partir das 7h de Brasilia,
 * cada responsavel recebe os seus processos sem movimentacao ha mais de N dias; os sem responsavel
 * (ou com responsavel inativo) vao para o(s) procurador(es). Chamado de hora em hora pelo
 * scheduler; a chave geral.ultimo_aviso_parados_dia evita repetir (gravada antes do envio, como no
 * resumo da agenda, para uma falha no meio nao duplicar e-mails).
 *
 * @returns {Promise<number>} quantas pessoas entraram na fila de e-mail
 */
async function enviarAvisoSemanal({ agora = new Date(), forcar = false } = {}) {
    const hoje = hojeSP(agora);
    if (!forcar) {
        if (!(await configuracoes.lerBooleano('geral.aviso_parados_ativo'))) return 0;
        if (diaDaSemana(hoje) !== 'segunda-feira' || horaSP(agora) < HORA_AVISO) return 0;
        if ((await configuracoes.ler('geral.ultimo_aviso_parados_dia')) === hoje) return 0;
    }
    await configuracoes.salvar({ 'geral.ultimo_aviso_parados_dia': hoje });

    const dias = await configuracoes.lerNumero('geral.dias_sem_movimentacao');
    const parados = await processosModel.listParados(dias);
    if (!parados.length) return 0;

    const responsaveis = new Map((await usuariosModel.listAtivosPorPapeis(PAPEIS_RESPONSAVEIS)).map((u) => [u.id, u]));
    const procuradores = await usuariosModel.listAtivosPorPapeis([PAPEL_ESCALONAMENTO]);
    const porPessoa = new Map();
    const juntar = (usuario, p) => {
        if (!porPessoa.has(usuario.id)) porPessoa.set(usuario.id, { usuario, processos: [] });
        porPessoa.get(usuario.id).processos.push(p);
    };
    for (const p of parados) {
        const responsavel = responsaveis.get(p.procurador_responsavel_id);
        if (responsavel) juntar(responsavel, p);
        else procuradores.forEach((u) => juntar(u, p));
    }

    for (const { usuario, processos } of porPessoa.values()) {
        const msg = await mensagens.processosParados({ nome: usuario.nome, dias, processos });
        await outbox.enfileirar({ to: usuario.email, ...msg }, { tipo: 'processos_parados', referencia: `parados:${hoje}` });
    }
    return porPessoa.size;
}

module.exports = { enviarAvisoSemanal };
