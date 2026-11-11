const express = require('express');

const alertasModel = require('../../models/alertas');
const compromissosModel = require('../../models/compromissos');
const { requireAuth, requirePermissao } = require('../../middleware/auth');
const { a } = require('../../util/http');
const { hojeSP } = require('../../util/datas');

const authRoutes = require('./auth');
const { router: painelRoutes } = require('./painel');
const alertasRoutes = require('./alertas');
const processosRoutes = require('./processos');
const agendaRoutes = require('./agenda');
const casosRoutes = require('./casos');
const documentosRoutes = require('./documentos');
const indicadoresRoutes = require('./indicadores');
const contaRoutes = require('./conta');
const configuracoesRoutes = require('./configuracoes');

const router = express.Router();

// Publicas: setup inicial, login, logout.
router.use(authRoutes);

// Daqui pra baixo, so autenticado.
router.use(requireAuth);

// Contadores do menu lateral (o "aviso" de quem nao usa e-mail): alertas sem ciencia e
// compromissos vencidos na agenda.
router.use(a(async (req, res, next) => {
    const [alertasAbertos, compromissosVencidos] = await Promise.all([
        alertasModel.contarAbertos(),
        compromissosModel.contarVencidos(hojeSP())
    ]);
    res.locals.alertasAbertos = alertasAbertos;
    res.locals.compromissosVencidos = compromissosVencidos;
    // Endereco atual sem a mensagem de retorno, para formularios que voltam para a mesma tela.
    const url = new URL(req.originalUrl, 'http://argus');
    url.searchParams.delete('msg');
    res.locals.urlAtual = url.pathname + url.search;
    next();
}));

router.use(painelRoutes);
router.use('/alertas', alertasRoutes);
router.use('/processos', processosRoutes);
router.use('/agenda', agendaRoutes);
router.use('/casos', casosRoutes);
router.use('/documentos', documentosRoutes);
router.use('/indicadores', indicadoresRoutes);
router.use('/minha-conta', contaRoutes);
router.use('/configuracoes', requirePermissao('configurar'), configuracoesRoutes);

module.exports = router;
