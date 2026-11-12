const express = require('express');

const processosModel = require('../../models/processos');
const movimentosModel = require('../../models/movimentos');
const alertasModel = require('../../models/alertas');
const compromissosModel = require('../../models/compromissos');
const casosModel = require('../../models/casos');
const anotacoesModel = require('../../models/anotacoes');
const etiquetasModel = require('../../models/etiquetas');
const documentosModel = require('../../models/documentos');
const { hojeSP, fmtDia } = require('../../util/datas');
const { gerarCsv, enviarCsv } = require('../../util/csv');
const { formatar } = require('../../util/cnj');
const usuariosModel = require('../../models/usuarios');
const auditoria = require('../../services/auditoria');
const configuracoes = require('../../services/configuracoes');
const { cadastrar, MAX_POR_IMPORTACAO } = require('../../services/cadastroProcessos');
const { fonteAtiva } = require('../../fontes');
const { buildLinkConsultaPublica, acessoNoTribunal, SISTEMAS_CONHECIDOS } = require('../../services/linkBuilder');
const { requirePermissao } = require('../../middleware/auth');
const { PAPEIS_RESPONSAVEIS } = require('../../config/papeis');
const { lerPaginacao, montarPaginacao } = require('../../util/paginacao');
const { a, comMsg } = require('../../util/http');

const router = express.Router();

const SITUACOES = ['aguardando', 'localizado', 'nao_localizado'];

async function listarResponsaveis() {
    return usuariosModel.listAtivosPorPapeis(PAPEIS_RESPONSAVEIS);
}

// Filtros da lista (tambem usados na exportacao, para exportar exatamente o que a tela mostra).
async function lerFiltro(req) {
    return {
        tribunal: req.query.tribunal || undefined,
        responsavelId: req.query.responsavelId || undefined,
        semResponsavel: req.query.semResponsavel === 'true',
        semSistema: req.query.semSistema === 'true',
        paradosHaDias: req.query.parados === 'true' ? await configuracoes.lerNumero('geral.dias_sem_movimentacao') : undefined,
        situacao: SITUACOES.includes(req.query.situacao) ? req.query.situacao : undefined,
        busca: req.query.busca?.trim() || undefined,
        etiqueta: req.query.etiqueta?.trim() || undefined,
        arquivados: req.query.arquivados === 'true'
    };
}

const MAX_EXPORTACAO = 10000;
const ROTULO_SITUACAO = { aguardando: 'aguardando consulta', localizado: 'localizado', nao_localizado: 'não localizado' };

// Exportacao CSV (PRD MEL-14). Declarada antes de '/:id'.
router.get('/exportar.csv', a(async (req, res) => {
    const filtro = await lerFiltro(req);
    const { processos, total } = await processosModel.list(filtro, { limit: MAX_EXPORTACAO, offset: 0 });
    const linhas = processos.map((p) => {
        const acesso = acessoNoTribunal(p);
        return [
            formatar(p.numero_processo),
            String(p.tribunal || '').toUpperCase(),
            acesso.sistema ? acesso.sistema.rotulo : '',
            p.classe_nome,
            p.orgao_julgador,
            p.procurador_nome,
            ROTULO_SITUACAO[p.situacao_fonte] || p.situacao_fonte,
            p.ultima_movimentacao ? new Date(p.ultima_movimentacao) : '',
            fmtDia(p.data_ajuizamento),
            p.etiquetas,
            p.ativo ? 'não' : 'sim',
            acesso.principal ? acesso.principal.url : ''
        ];
    });
    await auditoria.registrar(req, 'exportacao', { detalhes: { tipo: 'processos', linhas: linhas.length, total } });
    enviarCsv(res, `argus_processos_${hojeSP()}.csv`, gerarCsv(
        ['Número', 'Tribunal', 'Sistema', 'Classe', 'Órgão julgador', 'Responsável', 'Situação na fonte', 'Última movimentação', 'Ajuizamento', 'Etiquetas', 'Arquivado', 'Link no tribunal'],
        linhas
    ));
}));

router.get('/', a(async (req, res) => {
    const filtro = await lerFiltro(req);
    const pag = lerPaginacao(req);
    const [{ processos, total }, responsaveis, tribunais, etiquetas] = await Promise.all([
        processosModel.list(filtro, pag),
        listarResponsaveis(),
        processosModel.listTribunaisEmUso(),
        etiquetasModel.listAll()
    ]);
    res.render('processos', {
        processos,
        responsaveis,
        tribunais,
        etiquetas: etiquetas.filter((e) => e.processos > 0),
        filtro,
        exportarUrl: `/processos/exportar.csv${req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''}`,
        paginacao: montarPaginacao(req, pag, total),
        msg: req.query.msg
    });
}));

router.get('/novo', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const fonte = await fonteAtiva();
    res.render('processo_novo', {
        responsaveis: await listarResponsaveis(),
        fonteRotulo: fonte.rotulo,
        maxPorImportacao: MAX_POR_IMPORTACAO,
        resultado: null
    });
}));

router.post('/novo', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const unico = req.body.modo === 'unico';
    const texto = unico ? req.body.numero : req.body.lista;
    const resultado = await cadastrar({
        texto,
        origem: unico ? 'manual' : 'importacao',
        observacao: unico ? req.body.observacao?.trim() || null : null,
        responsavelId: req.body.responsavelId ? Number(req.body.responsavelId) : null,
        usuario: req.usuario
    });

    if (resultado.cadastrados.length) {
        await auditoria.registrar(req, unico ? 'processo_cadastrado' : 'processos_importados', {
            entidade: 'processo',
            entidadeId: unico ? resultado.cadastrados[0].id : null,
            detalhes: {
                cadastrados: resultado.cadastrados.length,
                existentes: resultado.existentes.length,
                invalidos: resultado.invalidos.length,
                numeros: resultado.cadastrados.slice(0, 50).map((c) => c.numero)
            }
        });
    }

    if (unico && resultado.cadastrados.length === 1) {
        return res.redirect(comMsg(`/processos/${resultado.cadastrados[0].id}`, 'Processo cadastrado. Consultando dados na fonte...'));
    }

    const fonte = await fonteAtiva();
    res.render('processo_novo', {
        responsaveis: await listarResponsaveis(),
        fonteRotulo: fonte.rotulo,
        maxPorImportacao: MAX_POR_IMPORTACAO,
        resultado
    });
}));

router.get('/:id', a(async (req, res) => {
    const processo = await processosModel.findById(req.params.id);
    if (!processo) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Processo não encontrado.' });
    const [movimentos, { alertas }, responsaveis, compromissos, anotacoes, casos, etiquetasExistentes, documentos, modelos] = await Promise.all([
        movimentosModel.listByProcesso(processo.id),
        alertasModel.list({ processoId: processo.id }, { limit: 100, offset: 0 }),
        listarResponsaveis(),
        compromissosModel.listPorProcesso(processo.id),
        anotacoesModel.listDe({ processoId: processo.id }),
        casosModel.listPorProcesso(processo.id),
        etiquetasModel.listAll(),
        documentosModel.listDe({ processoId: processo.id }),
        documentosModel.listModelos()
    ]);
    res.render('processo_detalhe', {
        processo, movimentos, alertas, responsaveis, compromissos, anotacoes, casos, etiquetasExistentes, documentos, modelos, hoje: hojeSP(), msg: req.query.msg
    });
}));

router.post('/:id/responsavel', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const id = req.body.responsavelId || '';
    // So procurador/advogado ativo (PRD BUG-06); vazio remove o responsavel.
    if (id && !(/^\d+$/.test(id) && (await usuariosModel.findAtivoComPapel(Number(id), PAPEIS_RESPONSAVEIS)))) {
        return res.redirect(comMsg(`/processos/${req.params.id}`, 'Responsável inválido: escolha um procurador ou advogado ativo.'));
    }
    const processo = await processosModel.setProcuradorResponsavel(req.params.id, id ? Number(id) : null);
    if (processo) {
        await auditoria.registrar(req, 'processo_responsavel', {
            entidade: 'processo',
            entidadeId: processo.id,
            detalhes: { responsavelId: processo.procurador_responsavel_id }
        });
    }
    res.redirect(comMsg(`/processos/${req.params.id}`, 'Responsável atualizado.'));
}));

router.post('/:id/observacao', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const processo = await processosModel.setObservacao(req.params.id, req.body.observacao?.trim());
    if (processo) await auditoria.registrar(req, 'processo_observacao', { entidade: 'processo', entidadeId: processo.id });
    res.redirect(comMsg(`/processos/${req.params.id}`, 'Observação salva.'));
}));

router.post('/:id/etiquetas', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const processo = await processosModel.findById(req.params.id);
    if (!processo) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Processo não encontrado.' });
    const nomes = await etiquetasModel.definir('processo', processo.id, req.body.etiquetas);
    await auditoria.registrar(req, 'processo_etiquetas', { entidade: 'processo', entidadeId: processo.id, detalhes: { etiquetas: nomes } });
    res.redirect(comMsg(`/processos/${processo.id}`, 'Etiquetas salvas.'));
}));

router.post('/:id/anotacoes', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const processo = await processosModel.findById(req.params.id);
    if (!processo) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Processo não encontrado.' });
    const texto = String(req.body.texto || '').trim();
    if (!texto) return res.redirect(comMsg(`/processos/${processo.id}`, 'Escreva o texto da anotação.'));
    const anotacao = await anotacoesModel.create({ processoId: processo.id, texto, autorId: req.usuario.id });
    await auditoria.registrar(req, 'anotacao_criada', { entidade: 'processo', entidadeId: processo.id, detalhes: { anotacaoId: anotacao.id } });
    res.redirect(comMsg(`/processos/${processo.id}`, 'Anotação registrada.'));
}));

router.post('/:id/sistema', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const processo = await processosModel.findById(req.params.id);
    if (!processo) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Processo não encontrado.' });
    const sistema = SISTEMAS_CONHECIDOS[req.body.sistema] ? req.body.sistema : null;
    const link = buildLinkConsultaPublica({
        numeroProcesso: processo.numero_processo,
        tribunal: processo.tribunal,
        grau: processo.grau,
        sistema: sistema || processo.sistema
    });
    await processosModel.setSistemaInformado(processo.id, sistema, link);
    await auditoria.registrar(req, 'processo_sistema', { entidade: 'processo', entidadeId: processo.id, detalhes: { sistema: sistema || 'datajud' } });
    // So volta para tela local conhecida (evita redirecionamento aberto).
    const destino = /^\/alertas\/\d+$/.test(req.body.voltar || '') ? req.body.voltar : `/processos/${processo.id}`;
    res.redirect(comMsg(destino, sistema ? `Sistema definido como ${SISTEMAS_CONHECIDOS[sistema]}.` : 'Voltando a usar o sistema informado pelo DataJud.'));
}));

router.post('/:id/ativo', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const ativo = req.body.ativo === 'true';
    const processo = await processosModel.setAtivo(req.params.id, ativo);
    if (processo) {
        await auditoria.registrar(req, ativo ? 'processo_reativado' : 'processo_arquivado', { entidade: 'processo', entidadeId: processo.id });
    }
    res.redirect(comMsg(`/processos/${req.params.id}`, ativo ? 'Processo reativado — volta a ser monitorado.' : 'Processo arquivado — deixa de ser monitorado.'));
}));

module.exports = router;
