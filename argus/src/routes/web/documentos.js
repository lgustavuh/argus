const express = require('express');
const fs = require('fs');

const documentosModel = require('../../models/documentos');
const processosModel = require('../../models/processos');
const casosModel = require('../../models/casos');
const auditoria = require('../../services/auditoria');
const docs = require('../../services/documentos');
const { requirePermissao } = require('../../middleware/auth');
const { lerPaginacao, montarPaginacao } = require('../../util/paginacao');
const { a, comMsg } = require('../../util/http');

const router = express.Router();

const MAX_MODELO = 100000;

router.get('/', a(async (req, res) => {
    const aba = req.query.aba === 'modelos' ? 'modelos' : 'arquivos';
    const busca = req.query.busca?.trim() || undefined;
    const dados = { aba, busca, msg: req.query.msg, TAMANHO_MAXIMO: docs.TAMANHO_MAXIMO };
    if (aba === 'arquivos') {
        const pag = lerPaginacao(req);
        const { documentos, total } = await documentosModel.list({ busca }, pag);
        dados.documentos = documentos;
        dados.paginacao = montarPaginacao(req, pag, total);
    } else {
        dados.modelos = await documentosModel.listModelos({ incluirInativos: true });
    }
    res.render('documentos', dados);
}));

// Destino seguro para voltar depois do envio/exclusao: so a tela do proprio processo/caso.
function telaDoDono(doc) {
    return doc.processo_id ? `/processos/${doc.processo_id}` : `/casos/${doc.caso_id}`;
}

router.post('/enviar', requirePermissao('gerenciarProcessos'), docs.receberArquivo, a(async (req, res) => {
    const processoId = /^\d+$/.test(req.body.processoId || '') ? Number(req.body.processoId) : null;
    const casoId = !processoId && /^\d+$/.test(req.body.casoId || '') ? Number(req.body.casoId) : null;
    const dono = processoId ? await processosModel.findById(processoId) : casoId ? await casosModel.findById(casoId) : null;
    const voltar = processoId ? `/processos/${processoId}` : casoId ? `/casos/${casoId}` : '/documentos';
    const descartar = () => req.file && fs.rm(req.file.path, { force: true }, () => {});

    if (!dono) {
        descartar();
        return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Processo ou caso não encontrado.' });
    }
    if (req.erroUpload) return res.redirect(comMsg(voltar, req.erroUpload));
    if (!req.file) return res.redirect(comMsg(voltar, 'Escolha um arquivo para enviar.'));

    const doc = await documentosModel.create({
        processoId,
        casoId,
        nomeOriginal: docs.nomeOriginal(req.file),
        arquivo: req.file.filename,
        tamanho: req.file.size,
        descricao: String(req.body.descricao || '').trim().slice(0, 300),
        enviadoPor: req.usuario.id
    });
    await auditoria.registrar(req, 'documento_enviado', {
        entidade: processoId ? 'processo' : 'caso',
        entidadeId: processoId || casoId,
        detalhes: { documentoId: doc.id, nome: doc.nome_original, tamanho: doc.tamanho }
    });
    res.redirect(comMsg(voltar, `Documento "${doc.nome_original}" anexado.`));
}));

router.get('/:id(\\d+)/baixar', a(async (req, res) => {
    const doc = await documentosModel.findById(req.params.id);
    if (!doc) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Documento não encontrado.' });
    const arquivo = docs.caminho(doc.arquivo);
    if (!fs.existsSync(arquivo)) {
        return res.status(410).render('erro', { titulo: 'Arquivo indisponível', mensagem: 'O registro do documento existe, mas o arquivo não foi encontrado no servidor. Avise a TI.' });
    }
    // attachment() tambem define o Content-Type pela extensao; o da lista de tipos aceitos vem depois e prevalece.
    res.attachment(doc.nome_original);
    res.set('Content-Type', docs.tipoDe(doc.nome_original));
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(arquivo);
}));

router.post('/:id(\\d+)/excluir', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const doc = await documentosModel.remove(req.params.id);
    if (!doc) return res.redirect(comMsg('/documentos', 'Documento não encontrado.'));
    await docs.apagarArquivo(doc.arquivo);
    await auditoria.registrar(req, 'documento_excluido', {
        entidade: doc.processo_id ? 'processo' : 'caso',
        entidadeId: doc.processo_id || doc.caso_id,
        detalhes: { documentoId: doc.id, nome: doc.nome_original }
    });
    res.redirect(comMsg(telaDoDono(doc), `Documento "${doc.nome_original}" excluído.`));
}));

// ---------- Modelos ----------

function renderModelo(res, modelo, erros = [], status = 200) {
    res.status(status).render('modelo_form', { modelo, erros, CAMPOS: docs.CAMPOS });
}

router.get('/modelos/novo', requirePermissao('gerenciarProcessos'), (req, res) => {
    renderModelo(res, { nome: '', descricao: '', conteudo: '', ativo: true });
});

router.get('/modelos/:id(\\d+)', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const modelo = await documentosModel.findModelo(req.params.id);
    if (!modelo) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Modelo não encontrado.' });
    renderModelo(res, modelo);
}));

router.post('/modelos/:id(\\d+)?', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const id = req.params.id ? Number(req.params.id) : null;
    const modelo = {
        id,
        nome: String(req.body.nome || '').trim().slice(0, 150),
        descricao: String(req.body.descricao || '').trim().slice(0, 300),
        conteudo: String(req.body.conteudo || '').replace(/\r\n/g, '\n'),
        ativo: id ? req.body.ativo === 'true' : true
    };
    const erros = [];
    if (!modelo.nome) erros.push('Informe o nome do modelo.');
    if (!modelo.conteudo.trim()) erros.push('Escreva o texto do modelo.');
    if (modelo.conteudo.length > MAX_MODELO) erros.push('Texto muito longo.');
    if (erros.length) return renderModelo(res, modelo, erros, 422);

    const salvo = await documentosModel.salvarModelo(id, modelo, req.usuario.id);
    if (!salvo) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Modelo não encontrado.' });
    await auditoria.registrar(req, id ? 'modelo_alterado' : 'modelo_criado', { entidade: 'modelo', entidadeId: salvo.id, detalhes: { nome: salvo.nome } });
    res.redirect(comMsg('/documentos?aba=modelos', id ? 'Modelo salvo.' : 'Modelo criado.'));
}));

// Formulario "Gerar documento a partir de um modelo" (processo/caso): escolhe o modelo na lista.
router.get('/gerar', (req, res) => {
    const modeloId = /^\d+$/.test(req.query.modeloId || '') ? req.query.modeloId : null;
    const dono = /^\d+$/.test(req.query.processoId || '') ? `processoId=${req.query.processoId}`
        : /^\d+$/.test(req.query.casoId || '') ? `casoId=${req.query.casoId}` : null;
    if (!modeloId || !dono) return res.status(400).render('erro', { titulo: 'Pedido inválido', mensagem: 'Escolha um modelo a partir da tela do processo ou do caso.' });
    res.redirect(`/documentos/modelos/${modeloId}/gerar?${dono}`);
});

/**
 * Gera o texto de um modelo com os dados de um processo ou caso. Sem ?formato=doc mostra a previa
 * na tela (para copiar ou baixar); com ?formato=doc baixa o arquivo para o Word.
 */
router.get('/modelos/:id(\\d+)/gerar', a(async (req, res) => {
    const modelo = await documentosModel.findModelo(req.params.id);
    if (!modelo || !modelo.ativo) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Modelo não encontrado.' });
    const caso = /^\d+$/.test(req.query.casoId || '') ? await casosModel.findById(req.query.casoId) : null;
    const processoId = /^\d+$/.test(req.query.processoId || '') ? req.query.processoId : caso?.processo_id;
    const processo = processoId ? await processosModel.findById(processoId) : null;
    if (!processo && !caso) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Processo ou caso não encontrado.' });

    const { texto, vazios } = docs.preencher(modelo.conteudo, docs.dadosParaModelo({ processo, caso, usuario: req.usuario }));
    if (req.query.formato === 'doc') {
        await auditoria.registrar(req, 'modelo_gerado', { entidade: caso ? 'caso' : 'processo', entidadeId: caso ? caso.id : processo.id, detalhes: { modeloId: modelo.id, nome: modelo.nome } });
        res.attachment(`${modelo.nome.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim() || 'documento'}.doc`);
        res.set('Content-Type', 'application/msword; charset=utf-8');
        return res.send(docs.montarDoc(modelo.nome, texto));
    }
    res.render('modelo_gerado', { modelo, texto, vazios, processo, caso, CAMPOS: docs.CAMPOS, query: req.query });
}));

module.exports = router;
