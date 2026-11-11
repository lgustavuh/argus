const express = require('express');

const casosModel = require('../../models/casos');
const processosModel = require('../../models/processos');
const compromissosModel = require('../../models/compromissos');
const anotacoesModel = require('../../models/anotacoes');
const etiquetasModel = require('../../models/etiquetas');
const documentosModel = require('../../models/documentos');
const usuariosModel = require('../../models/usuarios');
const auditoria = require('../../services/auditoria');
const { requirePermissao } = require('../../middleware/auth');
const { PAPEIS_RESPONSAVEIS } = require('../../config/papeis');
const { limpar } = require('../../util/cnj');
const { hojeSP } = require('../../util/datas');
const { lerPaginacao, montarPaginacao } = require('../../util/paginacao');
const { a, comMsg } = require('../../util/http');

const router = express.Router();

function listarResponsaveis() {
    return usuariosModel.listAtivosPorPapeis(PAPEIS_RESPONSAVEIS);
}

router.get('/', a(async (req, res) => {
    const filtro = {
        status: ['aberto', 'encerrado', 'todos'].includes(req.query.status) ? req.query.status : 'aberto',
        responsavelId: /^\d+$/.test(req.query.responsavelId || '') ? Number(req.query.responsavelId) : undefined,
        tipo: casosModel.TIPOS[req.query.tipo] ? req.query.tipo : undefined,
        etiqueta: req.query.etiqueta?.trim() || undefined,
        busca: req.query.busca?.trim() || undefined
    };
    const pag = lerPaginacao(req);
    const [{ casos, total }, responsaveis, etiquetas] = await Promise.all([
        casosModel.list(filtro, pag),
        listarResponsaveis(),
        etiquetasModel.listAll()
    ]);
    res.render('casos', {
        casos,
        filtro,
        responsaveis,
        etiquetas: etiquetas.filter((e) => e.casos > 0),
        TIPOS: casosModel.TIPOS,
        paginacao: montarPaginacao(req, pag, total),
        msg: req.query.msg
    });
}));

async function lerFormulario(body) {
    const erros = [];
    const dados = {
        titulo: String(body.titulo || '').trim().slice(0, 200),
        tipo: casosModel.TIPOS[body.tipo] ? body.tipo : 'administrativo',
        referencia: String(body.referencia || '').trim().slice(0, 100) || null,
        interessado: String(body.interessado || '').trim().slice(0, 200) || null,
        descricao: String(body.descricao || '').trim() || null,
        responsavelId: /^\d+$/.test(body.responsavelId || '') ? Number(body.responsavelId) : null,
        numeroProcesso: String(body.numeroProcesso || '').trim(),
        etiquetas: String(body.etiquetas || ''),
        processoId: null
    };
    if (!dados.titulo) erros.push('Informe o título do caso.');
    const digitos = limpar(dados.numeroProcesso);
    if (digitos) {
        const processo = digitos.length === 20 ? await processosModel.findByNumero(digitos) : null;
        if (processo) dados.processoId = processo.id;
        else erros.push(`O processo ${dados.numeroProcesso} não está cadastrado no Argus. Cadastre-o antes ou deixe o campo em branco.`);
    }
    if (dados.responsavelId && !(await listarResponsaveis()).some((u) => u.id === dados.responsavelId)) erros.push('Responsável inválido.');
    return { dados, erros };
}

async function renderForm(res, { caso, erros = [], status = 200 }) {
    res.status(status).render('caso_form', {
        caso,
        erros,
        responsaveis: await listarResponsaveis(),
        etiquetasExistentes: await etiquetasModel.listAll(),
        TIPOS: casosModel.TIPOS
    });
}

router.get('/novo', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const responsaveis = await listarResponsaveis();
    await renderForm(res, {
        caso: {
            tipo: 'administrativo',
            responsavelId: responsaveis.some((u) => u.id === req.usuario.id) ? req.usuario.id : null
        }
    });
}));

router.post('/novo', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const { dados, erros } = await lerFormulario(req.body);
    if (erros.length) return renderForm(res, { caso: dados, erros, status: 422 });
    const caso = await casosModel.create({ ...dados, criadoPor: req.usuario.id });
    const nomes = await etiquetasModel.definir('caso', caso.id, dados.etiquetas);
    await auditoria.registrar(req, 'caso_criado', { entidade: 'caso', entidadeId: caso.id, detalhes: { tipo: caso.tipo, etiquetas: nomes } });
    res.redirect(comMsg(`/casos/${caso.id}`, 'Caso cadastrado.'));
}));

async function dadosDetalhe(caso) {
    const [compromissos, anotacoes, historico, responsaveis, etiquetasExistentes, documentos, modelos] = await Promise.all([
        compromissosModel.listPorCaso(caso.id),
        anotacoesModel.listDe({ casoId: caso.id }),
        auditoria.listarPorEntidade('caso', caso.id),
        listarResponsaveis(),
        etiquetasModel.listAll(),
        documentosModel.listDe({ casoId: caso.id }),
        documentosModel.listModelos()
    ]);
    return { caso, compromissos, anotacoes, historico, responsaveis, etiquetasExistentes, documentos, modelos, hoje: hojeSP(), TIPOS: casosModel.TIPOS, ROTULOS_ACAO: auditoria.ROTULOS_ACAO };
}

router.get('/:id', a(async (req, res) => {
    const caso = await casosModel.findById(req.params.id);
    if (!caso) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Caso não encontrado.' });
    res.render('caso_detalhe', { ...(await dadosDetalhe(caso)), erros: [], msg: req.query.msg });
}));

router.post('/:id', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const atual = await casosModel.findById(req.params.id);
    if (!atual) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Caso não encontrado.' });
    const { dados, erros } = await lerFormulario(req.body);
    if (erros.length) {
        const base = await dadosDetalhe(atual);
        return res.status(422).render('caso_detalhe', { ...base, caso: { ...atual, ...dados, editando: true }, erros, msg: null });
    }
    const caso = await casosModel.update(atual.id, dados);
    const nomes = await etiquetasModel.definir('caso', caso.id, dados.etiquetas);
    const mudou = ['titulo', 'tipo', 'referencia', 'interessado', 'descricao', 'responsavel_id', 'processo_id']
        .filter((k) => String(atual[k] ?? '') !== String(caso[k] ?? ''));
    if (nomes.join('|') !== (atual.etiquetas || []).join('|')) mudou.push('etiquetas');
    if (mudou.length) await auditoria.registrar(req, 'caso_alterado', { entidade: 'caso', entidadeId: caso.id, detalhes: { campos: mudou } });
    res.redirect(comMsg(`/casos/${caso.id}`, mudou.length ? 'Alterações salvas.' : 'Nada foi alterado.'));
}));

router.post('/:id/status', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const status = req.body.status === 'encerrado' ? 'encerrado' : 'aberto';
    const feito = await casosModel.setStatus(req.params.id, status);
    if (feito) await auditoria.registrar(req, status === 'encerrado' ? 'caso_encerrado' : 'caso_reaberto', { entidade: 'caso', entidadeId: req.params.id });
    res.redirect(comMsg(`/casos/${req.params.id}`, status === 'encerrado' ? 'Caso encerrado.' : 'Caso reaberto.'));
}));

router.post('/:id/anotacoes', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const caso = await casosModel.findById(req.params.id);
    if (!caso) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Caso não encontrado.' });
    const texto = String(req.body.texto || '').trim();
    if (!texto) return res.redirect(comMsg(`/casos/${caso.id}`, 'Escreva o texto da anotação.'));
    const anotacao = await anotacoesModel.create({ casoId: caso.id, texto, autorId: req.usuario.id });
    await auditoria.registrar(req, 'anotacao_criada', { entidade: 'caso', entidadeId: caso.id, detalhes: { anotacaoId: anotacao.id } });
    res.redirect(comMsg(`/casos/${caso.id}`, 'Anotação registrada.'));
}));

module.exports = router;
