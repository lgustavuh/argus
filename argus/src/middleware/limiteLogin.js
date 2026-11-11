/**
 * Protecao contra tentativa de senha por forca bruta: depois de MAX_FALHAS erros para o mesmo
 * e-mail (ou do mesmo IP) dentro da janela, novas tentativas ficam bloqueadas por BLOQUEIO_MS.
 * Em memoria — suficiente para uma instancia unica; reiniciar o container zera os contadores.
 */
const MAX_FALHAS = 5;
const MAX_FALHAS_IP = 20;
const JANELA_MS = 15 * 60 * 1000;
const BLOQUEIO_MS = 15 * 60 * 1000;

const registros = new Map();

function chaves(req, email) {
    return [`email:${(email || '').toLowerCase().trim()}`, `ip:${req.ip}`];
}

function obter(chave) {
    const agora = Date.now();
    let r = registros.get(chave);
    if (!r || (r.primeiraFalha + JANELA_MS < agora && (!r.bloqueadoAte || r.bloqueadoAte < agora))) {
        r = { falhas: 0, primeiraFalha: agora, bloqueadoAte: 0 };
        registros.set(chave, r);
    }
    return r;
}

/**
 * @returns {number} minutos restantes de bloqueio (0 = liberado)
 */
function minutosBloqueado(req, email) {
    const agora = Date.now();
    const restante = Math.max(...chaves(req, email).map((c) => (obter(c).bloqueadoAte || 0) - agora));
    return restante > 0 ? Math.ceil(restante / 60000) : 0;
}

function registrarFalha(req, email) {
    const [chaveEmail, chaveIp] = chaves(req, email);
    for (const [chave, limite] of [[chaveEmail, MAX_FALHAS], [chaveIp, MAX_FALHAS_IP]]) {
        const r = obter(chave);
        r.falhas += 1;
        if (r.falhas >= limite) r.bloqueadoAte = Date.now() + BLOQUEIO_MS;
    }
}

function registrarSucesso(req, email) {
    registros.delete(chaves(req, email)[0]);
}

// Limpeza periodica para o Map nao crescer indefinidamente.
setInterval(() => {
    const agora = Date.now();
    for (const [chave, r] of registros) {
        if (r.primeiraFalha + JANELA_MS < agora && (r.bloqueadoAte || 0) < agora) registros.delete(chave);
    }
}, JANELA_MS).unref();

module.exports = { minutosBloqueado, registrarFalha, registrarSucesso };
