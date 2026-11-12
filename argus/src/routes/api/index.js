const express = require('express');
const bcrypt = require('bcryptjs');

const processosModel = require('../../models/processos');
const movimentosModel = require('../../models/movimentos');
const alertasModel = require('../../models/alertas');
const usuariosModel = require('../../models/usuarios');
const codigosTpuModel = require('../../models/codigosTpu');
const auditoria = require('../../services/auditoria');
const { cadastrar } = require('../../services/cadastroProcessos');
const { sincronizar, syncEmAndamento } = require('../../services/reconciliation');
const { verificarCredenciais } = require('../../services/autenticacao');
const { statusSync } = require('../web/painel');
const { requireAuth, requirePermissao, gerarToken } = require('../../middleware/auth');
const limiteLogin = require('../../middleware/limiteLogin');
const { papelValido, PAPEIS_RESPONSAVEIS } = require('../../config/papeis');
const { validarSenha } = require('../../util/senha');
const { lerPaginacao } = require('../../util/paginacao');
const { a } = require('../../util/http');

/**
 * API REST (JSON). Autenticacao pelo cookie de sessao ou por `Authorization: Bearer <token>`,
 * obtido em POST /api/auth/login (mesmas regras de bloqueio por tentativas do login da tela).
 */
const router = express.Router();

router.post('/auth/login', a(async (req, res) => {
    const email = String(req.body.email || '').toLowerCase().trim();
    const senha = String(req.body.senha || '');
    const bloqueio = await limiteLogin.minutosBloqueado(req, email);
    if (bloqueio) return res.status(429).json({ erro: `Muitas tentativas. Tente em ${bloqueio} minuto(s).` });

    // Mesmo servico da tela: compara a senha mesmo sem usuario (tempo constante, PRD BUG-05).
    const { usuario, valido } = await verificarCredenciais(email, senha);
    if (!valido) {
        await limiteLogin.registrarFalha(req, email);
        await auditoria.registrar(req, 'login_falha', { detalhes: { email, via: 'api' }, usuario: usuario || null });
        return res.status(401).json({ erro: 'Credenciais invalidas' });
    }
    if (usuario.deve_trocar_senha) return res.status(403).json({ erro: 'Troque a senha provisoria pela tela antes de usar a API' });

    await limiteLogin.registrarSucesso(req, email);
    await usuariosModel.registrarLogin(usuario.id);
    await auditoria.registrar(req, 'login', { entidade: 'usuario', entidadeId: usuario.id, usuario, detalhes: { via: 'api' } });
    res.json({ token: gerarToken(usuario), usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel } });
}));

router.use(requireAuth);

// ---------- Processos ----------
router.get('/processos', a(async (req, res) => {
    const pag = lerPaginacao(req, Math.min(200, Number(req.query.porPagina) || 50));
    const { processos, total } = await processosModel.list(
        {
            tribunal: req.query.tribunal,
            responsavelId: req.query.responsavelId,
            semResponsavel: req.query.semResponsavel === 'true',
            situacao: req.query.situacao,
            busca: req.query.busca,
            arquivados: req.query.arquivados === 'true'
        },
        pag
    );
    res.json({ total, pagina: pag.pagina, processos });
}));

router.get('/processos/:id(\\d+)', a(async (req, res) => {
    const processo = await processosModel.findById(req.params.id);
    if (!processo) return res.status(404).json({ erro: 'Processo nao encontrado' });
    res.json({ ...processo, movimentos: await movimentosModel.listByProcesso(processo.id) });
}));

// Aceita { numeros: ["...", "..."] } ou { texto: "lista livre" }.
router.post('/processos', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    const texto = Array.isArray(req.body.numeros) ? req.body.numeros.join('\n') : req.body.texto || '';
    const resultado = await cadastrar({ texto, origem: 'importacao', usuario: req.usuario });
    if (resultado.cadastrados.length) {
        await auditoria.registrar(req, 'processos_importados', {
            entidade: 'processo',
            detalhes: { cadastrados: resultado.cadastrados.length, via: 'api' }
        });
    }
    res.status(201).json(resultado);
}));

router.patch('/processos/:id(\\d+)', requirePermissao('gerenciarProcessos'), a(async (req, res) => {
    let processo = await processosModel.findById(req.params.id);
    if (!processo) return res.status(404).json({ erro: 'Processo nao encontrado' });
    if ('responsavelId' in req.body) {
        const id = req.body.responsavelId;
        if (id !== null && id !== '' && !(/^\d+$/.test(String(id)) && (await usuariosModel.findAtivoComPapel(Number(id), PAPEIS_RESPONSAVEIS)))) {
            return res.status(400).json({ erro: 'Responsável inválido: informe um procurador ou advogado ativo (ou null para remover).' });
        }
        processo = await processosModel.setProcuradorResponsavel(processo.id, id ? Number(id) : null);
        await auditoria.registrar(req, 'processo_responsavel', { entidade: 'processo', entidadeId: processo.id });
    }
    if ('observacao' in req.body) {
        processo = await processosModel.setObservacao(processo.id, req.body.observacao);
        await auditoria.registrar(req, 'processo_observacao', { entidade: 'processo', entidadeId: processo.id });
    }
    if ('ativo' in req.body) {
        processo = await processosModel.setAtivo(processo.id, Boolean(req.body.ativo));
        await auditoria.registrar(req, processo.ativo ? 'processo_reativado' : 'processo_arquivado', { entidade: 'processo', entidadeId: processo.id });
    }
    res.json(processo);
}));

// ---------- Alertas ----------
router.get('/alertas', a(async (req, res) => {
    const pag = lerPaginacao(req, Math.min(200, Number(req.query.porPagina) || 50));
    const { alertas, total } = await alertasModel.list({ status: req.query.status }, pag);
    res.json({ total, pagina: pag.pagina, alertas });
}));

router.get('/alertas/:id(\\d+)', a(async (req, res) => {
    const alerta = await alertasModel.findById(req.params.id);
    if (!alerta) return res.status(404).json({ erro: 'Alerta nao encontrado' });
    res.json(alerta);
}));

router.patch('/alertas/:id(\\d+)/visualizar', requirePermissao('darCiencia'), a(async (req, res) => {
    const alerta = await alertasModel.marcarVisualizado(req.params.id, req.usuario.id);
    if (!alerta) return res.status(409).json({ erro: 'Alerta nao encontrado ou ja tratado' });
    await auditoria.registrar(req, 'alerta_visualizado', { entidade: 'alerta', entidadeId: alerta.id });
    res.json(alerta);
}));

router.patch('/alertas/:id(\\d+)/ciencia', requirePermissao('darCiencia'), a(async (req, res) => {
    const alerta = await alertasModel.marcarCiente(req.params.id, req.usuario.id);
    if (!alerta) return res.status(409).json({ erro: 'Alerta nao encontrado ou ja com ciencia' });
    await auditoria.registrar(req, 'alerta_ciencia', { entidade: 'alerta', entidadeId: alerta.id });
    res.json(alerta);
}));

// ---------- Sync ----------
// Em segundo plano, como na tela: o sync pode levar minutos e proxies cortariam a requisicao
// (PRD BUG-09). O andamento e o resultado ficam em GET /api/sync/status.
router.post('/sync/run', requirePermissao('rodarSync'), a(async (req, res) => {
    if (syncEmAndamento()) return res.status(409).json({ erro: 'Ja existe uma sincronizacao em andamento' });
    await auditoria.registrar(req, 'sync_manual', { detalhes: { via: 'api' } });
    sincronizar({ origem: `api:${req.usuario.nome}` }).catch((err) => console.error('[sync api] Falha:', err.message));
    res.status(202).json({ iniciado: true, status: '/api/sync/status' });
}));

router.get('/sync/status', a(async (req, res) => res.json(await statusSync())));

// ---------- Codigos TPU ----------
router.get('/codigos-tpu', a(async (req, res) => res.json(await codigosTpuModel.listAll())));

router.post('/codigos-tpu', requirePermissao('configurar'), a(async (req, res) => {
    const { codigo, nome, pesoUrgencia } = req.body;
    if (!codigo || !nome) return res.status(400).json({ erro: 'codigo e nome sao obrigatorios' });
    const salvo = await codigosTpuModel.upsert({ codigo: Number(codigo), nome: String(nome).trim(), pesoUrgencia: Number(pesoUrgencia) || 1 });
    await auditoria.registrar(req, 'tpu_salvo', { entidade: 'tpu', entidadeId: salvo.codigo });
    res.status(201).json(salvo);
}));

// ---------- Usuarios (admin) ----------
router.get('/usuarios', requirePermissao('configurar'), a(async (req, res) => res.json(await usuariosModel.listAll())));

router.post('/usuarios', requirePermissao('configurar'), a(async (req, res) => {
    const { nome, email, papel, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'nome, email e senha sao obrigatorios' });
    const erroSenha = validarSenha(senha);
    if (erroSenha) return res.status(400).json({ erro: erroSenha });
    try {
        const criado = await usuariosModel.create({
            nome: String(nome).trim(),
            email: String(email).toLowerCase().trim(),
            senhaHash: await bcrypt.hash(senha, 12),
            papel: papelValido(papel) ? papel : 'assistente_juridico',
            deveTrocarSenha: true
        });
        await auditoria.registrar(req, 'usuario_criado', { entidade: 'usuario', entidadeId: criado.id, detalhes: { via: 'api' } });
        res.status(201).json(criado);
    } catch (err) {
        // So violacao de unicidade e "e-mail repetido"; o resto vai para o handler de erro (PRD BUG-08).
        if (err.code === '23505') return res.status(409).json({ erro: 'E-mail ja cadastrado' });
        throw err;
    }
}));

router.use((req, res) => res.status(404).json({ erro: 'Rota nao encontrada' }));

module.exports = router;
