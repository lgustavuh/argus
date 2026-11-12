require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const bootstrap = require('./db/bootstrap');
const pool = require('./db/pool');
const { iniciarScheduler } = require('./jobs/syncScheduler');
const { verificarConfiguracaoSeguranca } = require('./config/seguranca');
const { verificarOrigem } = require('./middleware/origem');
const { formatar } = require('./util/cnj');
const { fmtDia, diaDaSemana } = require('./util/datas');
const { ROTULOS_PAPEL } = require('./config/papeis');
const { normalizarSistema, linksAlternativos, SISTEMAS_CONHECIDOS } = require('./services/linkBuilder');

const apiRoutes = require('./routes/api');
const webRoutes = require('./routes/web');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

// Atras de proxy reverso com HTTPS (nginx, IIS, Caddy), defina TRUST_PROXY=1 para o IP real do
// cliente chegar ao limite de tentativas de login e a auditoria.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                fontSrc: ["'self'", 'https://fonts.gstatic.com'],
                imgSrc: ["'self'", 'data:'],
                formAction: ["'self'"],
                frameAncestors: ["'none'"],
                // Sem HTTPS configurado, nao force upgrade (quebraria o acesso por http://IP:3000).
                upgradeInsecureRequests: process.env.COOKIE_SECURE === 'true' ? [] : null
            }
        },
        // HSTS so faz sentido servindo por HTTPS.
        strictTransportSecurity: process.env.COOKIE_SECURE === 'true',
        // "no-referrer" (padrao do helmet) faz o navegador mandar "Origin: null" ate em formularios
        // do proprio sistema. "same-origin" nao vaza a URL para sites externos e mantem a origem.
        referrerPolicy: { policy: 'same-origin' }
    })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(verificarOrigem);

// Helpers disponiveis em todas as views.
app.locals.fmtCnj = formatar;
app.locals.ROTULOS_PAPEL = ROTULOS_PAPEL;
// Sistema de tramitacao para exibir: o informado pela Procuradoria, senao o do DataJud (se valido).
app.locals.sistemaDoProcesso = (p) => {
    const s = normalizarSistema(p.sistema_informado) || normalizarSistema(p.sistema);
    return s ? { chave: s, rotulo: SISTEMAS_CONHECIDOS[s], informado: Boolean(p.sistema_informado) } : null;
};
app.locals.linksAlternativos = (p) =>
    linksAlternativos({ numeroProcesso: p.numero_processo, tribunal: p.tribunal, grau: p.grau });
// Colunas DATE chegam como 'AAAA-MM-DD' e sao formatadas sem conversao de fuso; instantes passam por America/Sao_Paulo.
app.locals.fmtData = (d) => fmtDia(d) || (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
app.locals.diaDaSemana = diaDaSemana;
// Para trechos montados como HTML na view (<%- ... %>): escapa texto vindo do banco.
app.locals.escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
app.locals.fmtDataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');

// Healthcheck (Docker/monitoramento): sem autenticacao e sem expor nada alem de ok/erro.
app.get('/healthz', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true });
    } catch (err) {
        res.status(503).json({ ok: false });
    }
});

app.use('/api', apiRoutes);
app.use('/', webRoutes);

app.use((req, res) => {
    res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'A página solicitada não existe.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error(`[erro] ${req.method} ${req.originalUrl}:`, err);
    if (req.originalUrl.startsWith('/api/')) return res.status(500).json({ erro: 'Erro interno' });
    res.status(500).render('erro', { titulo: 'Erro interno', mensagem: 'Ocorreu um erro inesperado. Tente novamente; se persistir, avise a TI.' });
});

async function start() {
    verificarConfiguracaoSeguranca();
    await bootstrap();
    iniciarScheduler();

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`Argus rodando em http://localhost:${port}`);
    });
}

if (require.main === module) {
    start().catch((err) => {
        console.error('Falha ao iniciar Argus:', err.message || err);
        process.exit(1);
    });
}

module.exports = app;
