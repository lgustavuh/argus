const express = require('express');

const compromissosModel = require('../../models/compromissos');
const processosModel = require('../../models/processos');
const alertasModel = require('../../models/alertas');
const casosModel = require('../../models/casos');
const usuariosModel = require('../../models/usuarios');
const auditoria = require('../../services/auditoria');
const { avisarAtribuicao } = require('../../services/agenda');
const { requirePermissao } = require('../../middleware/auth');
const { PAPEIS_RESPONSAVEIS } = require('../../config/papeis');
const { limpar, formatar } = require('../../util/cnj');
const { hojeSP, somarDias, diaValido, horaValida } = require('../../util/datas');
const { lerPaginacao, montarPaginacao } = require('../../util/paginacao');
const { a, comMsg } = require('../../util/http');

const router = express.Router();

const STATUS = ['aberto', 'concluido', 'cancelado', 'todos'];

function listarResponsaveis() {
    return usuariosModel.listAtivosPorPapeis(PAPEIS_RESPONSAVEIS);
}

/**
 * Filtro de responsavel da tela: '' (todos), 'meus', 'sem' ou o id de alguem.
 */
function lerFiltro(req) {
    const resp = String(req.query.responsavel || '');
    return {
        status: STATUS.includes(req.query.status) ? req.query.status : 'aberto',
        responsavel: resp,
        responsavelId: resp === 'meus' ? req.usuario.id : (/^\d+$/.test(resp) ? Number(resp) : undefined),
        semResponsavel: resp === 'sem',
        tipo: compromissosModel.TIPOS[req.query.tipo] ? req.query.tipo : undefined,
        busca: req.query.busca?.trim() || undefined
    };
}

// Agenda em aberto agrupada por periodo, do mais urgente para o mais distante.
function agrupar(compromissos, hoje) {
    const amanha = somarDias(hoje, 1);
    const semana = somarDias(hoje, 7);
    const grupos = [
        { chave: 'vencidos', titulo: 'Vencidos — data já passou e não foram concluídos', itens: [] },
        { chave: 'hoje', titulo: 'Hoje', itens: [] },
        { chave: 'amanha', titulo: 'Amanhã', itens: [] },
        { chave: 'semana', titulo: 'Próximos 7 dias', itens: [] },
        { chave: 'depois', titulo: 'Mais adiante', itens: [] }
    ];
    for (const c of compromissos) {
        if (c.data < hoje) grupos[0].itens.push(c);
        else if (c.data === hoje) grupos[1].itens.push(c);
        else if (c.data === amanha) grupos[2].itens.push(c);
        else if (c.data <= semana) grupos[3].itens.push(c);
        else grupos[4].itens.push(c);
    }
    return grupos.filter((g) => g.itens.length);
}

router.get('/', a(async (req, res) => {
    const filtro = lerFiltro(req);
    const hoje = hojeSP();
    const abertos = filtro.status === 'aberto';
    // Em aberto mostra tudo (a agenda inteira, agrupada); historico e paginado.
    const pag = abertos ? { pagina: 1, porPagina: 1000, limit: 1000, offset: 0 } : lerPaginacao(req);
    const [{ compromissos, total }, responsaveis] = await Promise.all([
        compromissosModel.list(filtro, pag),
        listarResponsaveis()
    ]);
    res.render('agenda', {
        filtro,
        hoje,
        grupos: abertos ? agrupar(compromissos, hoje) : null,
        compromissos,
        total,
        responsaveis,
        TIPOS: compromissosModel.TIPOS,
        paginacao: abertos ? null : montarPaginacao(req, pag, total),
        msg: req.query.msg
    });
}));

/**
 * Le e valida o formulario. O processo pode vir pelo id (link a partir do processo/alerta) ou
 * pelo numero digitado; numero de processo que nao esta no Argus e recusado, para nao criar
 * compromisso apontando para um processo que ninguem acompanha.
 */
async function lerFormulario(body) {
    const erros = [];
    const dados = {
        tipo: compromissosModel.TIPOS[body.tipo] ? body.tipo : 'prazo',
        titulo: String(body.titulo || '').trim().slice(0, 200),
        descricao: String(body.descricao || '').trim() || null,
        data: String(body.data || ''),
        hora: String(body.hora || '').trim() || null,
        local: String(body.local || '').trim().slice(0, 200) || null,
        responsavelId: /^\d+$/.test(body.responsavelId || '') ? Number(body.responsavelId) : null,
        alertaId: /^\d+$/.test(body.alertaId || '') ? Number(body.alertaId) : null,
        casoId: /^\d+$/.test(body.casoId || '') ? Number(body.casoId) : null,
        processoId: null,
        numeroProcesso: String(body.numeroProcesso || '').trim()
    };
    if (!dados.titulo) erros.push('Informe o título.');
    if (!diaValido(dados.data)) erros.push('Informe uma data válida.');
    if (dados.hora && !horaValida(dados.hora)) erros.push('Hora inválida — use o formato 14:30.');

    const digitos = limpar(dados.numeroProcesso);
    if (digitos) {
        const processo = digitos.length === 20 ? await processosModel.findByNumero(digitos) : null;
        if (processo) dados.processoId = processo.id;
        else erros.push(`O processo ${dados.numeroProcesso} não está cadastrado no Argus. Cadastre-o antes ou deixe o campo em branco.`);
    }
    if (dados.casoId && !(await casosModel.findById(dados.casoId))) dados.casoId = null;
    if (dados.responsavelId) {
        const validos = await listarResponsaveis();
        if (!validos.some((u) => u.id === dados.responsavelId)) erros.push('Responsável inválido.');
    }
    return { dados, erros };
}

async function renderForm(res, { compromisso, erros = [], status = 200 }) {
    res.status(status).render('agenda_form', {
        compromisso,
        erros,
        responsaveis: await listarResponsaveis(),
        TIPOS: compromissosModel.TIPOS
    });
}

router.get('/novo', requirePermissao('gerenciarAgenda'), a(async (req, res) => {
    const novo = { tipo: compromissosModel.TIPOS[req.query.tipo] ? req.query.tipo : 'prazo', titulo: '', data: '', hora: '', local: '', descricao: '', numeroProcesso: '', responsavelId: null, alertaId: null };
    const responsaveis = await listarResponsaveis();
    if (responsaveis.some((u) => u.id === req.usuario.id)) novo.responsavelId = req.usuario.id;

    if (/^\d+$/.test(req.query.alertaId || '')) {
        const alerta = await alertasModel.findById(req.query.alertaId);
        if (alerta) {
            novo.alertaId = alerta.id;
            novo.numeroProcesso = formatar(alerta.numero_processo);
            novo.titulo = `Prazo — ${alerta.movimento_nome || 'movimentação'}`.slice(0, 200);
            if (alerta.procurador_responsavel_id) novo.responsavelId = alerta.procurador_responsavel_id;
        }
    } else if (/^\d+$/.test(req.query.casoId || '')) {
        const caso = await casosModel.findById(req.query.casoId);
        if (caso) {
            novo.casoId = caso.id;
            novo.caso_titulo = caso.titulo;
            if (caso.numero_processo) novo.numeroProcesso = formatar(caso.numero_processo);
            if (caso.responsavel_id) novo.responsavelId = caso.responsavel_id;
        }
    } else if (/^\d+$/.test(req.query.processoId || '')) {
        const processo = await processosModel.findById(req.query.processoId);
        if (processo) {
            novo.numeroProcesso = formatar(processo.numero_processo);
            if (processo.procurador_responsavel_id) novo.responsavelId = processo.procurador_responsavel_id;
        }
    }
    await renderForm(res, { compromisso: novo });
}));

router.post('/novo', requirePermissao('gerenciarAgenda'), a(async (req, res) => {
    const { dados, erros } = await lerFormulario(req.body);
    if (erros.length) {
        const caso = dados.casoId ? await casosModel.findById(dados.casoId) : null;
        return renderForm(res, { compromisso: { ...dados, caso_titulo: caso?.titulo }, erros, status: 422 });
    }

    const c = await compromissosModel.create({ ...dados, criadoPor: req.usuario.id });
    await auditoria.registrar(req, 'compromisso_criado', {
        entidade: 'compromisso',
        entidadeId: c.id,
        detalhes: { tipo: c.tipo, data: c.data, processoId: c.processo_id, casoId: c.caso_id, responsavelId: c.responsavel_id, alertaId: c.alerta_id }
    });
    avisarAtribuicao(c, req.usuario).catch((err) => console.error('[agenda] Falha ao avisar responsável:', err.message));
    res.redirect(comMsg(`/agenda/${c.id}`, 'Compromisso lançado na agenda.'));
}));

router.get('/:id', a(async (req, res) => {
    const compromisso = await compromissosModel.findById(req.params.id);
    if (!compromisso) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Compromisso não encontrado.' });
    const [historico, responsaveis] = await Promise.all([
        auditoria.listarPorEntidade('compromisso', compromisso.id),
        listarResponsaveis()
    ]);
    res.render('agenda_detalhe', {
        compromisso,
        historico,
        responsaveis,
        hoje: hojeSP(),
        TIPOS: compromissosModel.TIPOS,
        ROTULOS_ACAO: auditoria.ROTULOS_ACAO,
        erros: [],
        msg: req.query.msg
    });
}));

router.post('/:id', requirePermissao('gerenciarAgenda'), a(async (req, res) => {
    const atual = await compromissosModel.findById(req.params.id);
    if (!atual) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Compromisso não encontrado.' });
    const { dados, erros } = await lerFormulario(req.body);
    if (erros.length) {
        return res.status(422).render('agenda_detalhe', {
            compromisso: { ...atual, ...dados, numero_processo: limpar(dados.numeroProcesso) || null, editando: true },
            historico: await auditoria.listarPorEntidade('compromisso', atual.id),
            responsaveis: await listarResponsaveis(),
            hoje: hojeSP(),
            TIPOS: compromissosModel.TIPOS,
            ROTULOS_ACAO: auditoria.ROTULOS_ACAO,
            erros,
            msg: null
        });
    }
    const c = await compromissosModel.update(atual.id, dados);
    const mudou = ['tipo', 'titulo', 'data', 'hora', 'local', 'processo_id', 'caso_id', 'responsavel_id', 'descricao']
        .filter((k) => String(atual[k] ?? '') !== String(c[k] ?? ''));
    if (mudou.length) {
        await auditoria.registrar(req, 'compromisso_alterado', {
            entidade: 'compromisso',
            entidadeId: c.id,
            detalhes: { campos: mudou, ...(mudou.includes('data') ? { dataAnterior: atual.data, data: c.data } : {}) }
        });
    }
    if (mudou.includes('responsavel_id')) {
        avisarAtribuicao(c, req.usuario).catch((err) => console.error('[agenda] Falha ao avisar responsável:', err.message));
    }
    res.redirect(comMsg(`/agenda/${c.id}`, mudou.length ? 'Alterações salvas.' : 'Nada foi alterado.'));
}));

const TRANSICOES = {
    concluir: { fn: (id, u) => compromissosModel.concluir(id, u.id), acao: 'compromisso_concluido', ok: 'Marcado como concluído.', ja: 'Este compromisso não está em aberto.' },
    cancelar: { fn: (id, u) => compromissosModel.cancelar(id, u.id), acao: 'compromisso_cancelado', ok: 'Compromisso cancelado.', ja: 'Este compromisso não está em aberto.' },
    reabrir: { fn: (id) => compromissosModel.reabrir(id), acao: 'compromisso_reaberto', ok: 'Compromisso reaberto.', ja: 'Este compromisso já está em aberto.' }
};

router.post('/:id/:transicao(concluir|cancelar|reabrir)', requirePermissao('gerenciarAgenda'), a(async (req, res) => {
    const t = TRANSICOES[req.params.transicao];
    const feito = await t.fn(req.params.id, req.usuario);
    if (feito) await auditoria.registrar(req, t.acao, { entidade: 'compromisso', entidadeId: req.params.id });
    // Concluir a partir da lista (ou do painel) volta para onde a pessoa estava.
    const origem = req.body.voltar;
    const destino = typeof origem === 'string' && /^\/(agenda|painel|processos|casos|alertas)(\/|\?|$)/.test(origem) ? origem : `/agenda/${req.params.id}`;
    res.redirect(comMsg(destino, feito ? t.ok : t.ja));
}));

module.exports = router;
