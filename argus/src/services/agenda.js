const compromissosModel = require('../models/compromissos');
const usuariosModel = require('../models/usuarios');
const configuracoes = require('./configuracoes');
const mensagens = require('./mensagensEmail');
const { enviarEmail } = require('./mailer');
const { PAPEL_ESCALONAMENTO } = require('../config/papeis');
const { hojeSP, somarDias, diaDaSemana } = require('../util/datas');

const HORA_RESUMO = 7;

function horaSP(agora = new Date()) {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(agora));
}

/**
 * Quem passou a ser responsavel por um compromisso recebe um e-mail — exceto se foi a propria
 * pessoa que se atribuiu.
 */
async function avisarAtribuicao(compromisso, autor) {
    if (!compromisso.responsavel_id || compromisso.responsavel_id === autor.id || !compromisso.responsavel_email) return;
    const msg = await mensagens.compromissoAtribuido(compromisso, autor.nome);
    await enviarEmail({ to: compromisso.responsavel_email, ...msg });
}

/**
 * Resumo diario da agenda, uma vez por dia (de segunda a sexta, a partir das 7h de Brasilia):
 * cada responsavel recebe os seus compromissos vencidos e os dos proximos N dias. Os sem
 * responsavel vao para o(s) procurador(es). Chamado de hora em hora pelo scheduler; a chave
 * agenda.ultimo_lembrete_dia evita repetir no mesmo dia (e e gravada antes do envio, para que uma
 * falha no meio nao dispare e-mails duplicados na hora seguinte).
 */
async function enviarResumosDiarios({ agora = new Date(), forcar = false } = {}) {
    const hoje = hojeSP(agora);
    if (!forcar) {
        if (!(await configuracoes.lerBooleano('agenda.lembrete_ativo'))) return 0;
        if (['sábado', 'domingo'].includes(diaDaSemana(hoje)) || horaSP(agora) < HORA_RESUMO) return 0;
        if ((await configuracoes.ler('agenda.ultimo_lembrete_dia')) === hoje) return 0;
    }
    await configuracoes.salvar({ 'agenda.ultimo_lembrete_dia': hoje });

    const dias = await configuracoes.lerNumero('agenda.dias_antecedencia');
    const itens = await compromissosModel.listAbertosAte(somarDias(hoje, dias));
    if (!itens.length) return 0;

    const procuradores = await usuariosModel.listAtivosPorPapeis([PAPEL_ESCALONAMENTO]);
    const ativos = new Map((await usuariosModel.listAtivos()).map((u) => [u.id, u]));
    const porPessoa = new Map();
    const juntar = (usuario, c) => {
        if (!porPessoa.has(usuario.id)) porPessoa.set(usuario.id, { usuario, itens: [] });
        porPessoa.get(usuario.id).itens.push(c);
    };
    for (const c of itens) {
        const responsavel = c.responsavel_id && ativos.get(c.responsavel_id);
        if (responsavel) juntar(responsavel, c);
        else procuradores.forEach((p) => juntar(p, c));
    }

    let enviados = 0;
    for (const { usuario, itens: lista } of porPessoa.values()) {
        const msg = await mensagens.resumoAgenda({
            nome: usuario.nome,
            hoje,
            vencidos: lista.filter((c) => c.data < hoje),
            proximos: lista.filter((c) => c.data >= hoje)
        });
        const r = await enviarEmail({ to: usuario.email, ...msg });
        if (r.ok) enviados++;
    }
    return enviados;
}

module.exports = { avisarAtribuicao, enviarResumosDiarios };
