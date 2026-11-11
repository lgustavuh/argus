/**
 * Express 4 nao captura erro de handler async — sem isso, uma falha de banco vira promessa
 * rejeitada e a requisicao fica pendurada. Envolva todo handler async com `a(...)`.
 */
function a(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function comMsg(url, msg) {
    const separador = url.includes('?') ? '&' : '?';
    return `${url}${separador}msg=${encodeURIComponent(msg)}`;
}

module.exports = { a, comMsg };
