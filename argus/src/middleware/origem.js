/**
 * Defesa extra contra CSRF (alem do cookie SameSite=Lax): requisicoes que alteram dados vindas de
 * outro site sao recusadas.
 *
 * 1. Sec-Fetch-Site (enviado por todos os navegadores atuais) e a fonte mais confiavel.
 * 2. Sem ele, compara Origin/Referer com o Host. "Origin: null" (enviado, p.ex., sob
 *    Referrer-Policy no-referrer) nao identifica a origem e por isso nao e usado para decidir.
 */
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function recusar(res) {
    return res.status(403).send('Requisição recusada: origem inválida.');
}

function verificarOrigem(req, res, next) {
    if (METODOS_SEGUROS.has(req.method)) return next();

    const fetchSite = req.get('sec-fetch-site');
    if (fetchSite) {
        // "none" = acao direta do usuario (barra de endereco/favorito).
        return fetchSite === 'same-origin' || fetchSite === 'none' ? next() : recusar(res);
    }

    const origemBruta = req.get('origin');
    const origem = origemBruta && origemBruta !== 'null' ? origemBruta : req.get('referer');
    if (!origem) return next(); // clientes de API (curl, scripts) nao mandam Origin
    try {
        if (new URL(origem).host === req.get('host')) return next();
    } catch (err) {
        // origem malformada cai na recusa abaixo
    }
    return recusar(res);
}

module.exports = { verificarOrigem };
