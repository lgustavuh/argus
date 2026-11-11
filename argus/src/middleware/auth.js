const jwt = require('jsonwebtoken');
const usuariosModel = require('../models/usuarios');
const { pode, ROTULOS_PAPEL } = require('../config/papeis');

const DURACAO_SESSAO_HORAS = 12;

function gerarToken(usuario) {
    return jwt.sign(
        { id: usuario.id, v: usuario.sessao_versao },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: `${DURACAO_SESSAO_HORAS}h` }
    );
}

function definirCookieSessao(res, usuario) {
    res.cookie('token', gerarToken(usuario), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: DURACAO_SESSAO_HORAS * 60 * 60 * 1000
    });
}

function limparCookieSessao(res) {
    res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true' });
}

function extrairToken(req) {
    if (req.cookies?.token) return req.cookies.token;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return null;
}

function ehApi(req) {
    return req.originalUrl.startsWith('/api/');
}

// Rotas que continuam acessiveis enquanto o usuario e obrigado a trocar a senha provisoria.
const LIBERADAS_TROCA_SENHA = ['/minha-conta', '/logout'];

/**
 * Valida o token E recarrega o usuario do banco a cada requisicao: usuario desativado, com perfil
 * alterado ou com senha trocada perde a sessao imediatamente (sessao_versao diferente do token).
 */
async function requireAuth(req, res, next) {
    const token = extrairToken(req);
    const negar = (mensagem) => {
        limparCookieSessao(res);
        if (ehApi(req)) return res.status(401).json({ erro: mensagem });
        return res.redirect('/login');
    };
    if (!token) return negar('Nao autenticado');

    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
        return negar('Sessao invalida ou expirada');
    }

    try {
        const usuario = await usuariosModel.findSessao(payload.id);
        if (!usuario || !usuario.ativo || usuario.sessao_versao !== payload.v) return negar('Sessao encerrada');

        req.usuario = usuario;
        res.locals.usuario = usuario;
        res.locals.pode = (acao) => pode(usuario.papel, acao);
        res.locals.rotuloPapel = ROTULOS_PAPEL[usuario.papel] || usuario.papel;

        if (usuario.deve_trocar_senha && !LIBERADAS_TROCA_SENHA.some((p) => req.path.startsWith(p))) {
            if (ehApi(req)) return res.status(403).json({ erro: 'Troque a senha provisoria antes de continuar' });
            return res.redirect('/minha-conta?trocar=1');
        }
        next();
    } catch (err) {
        next(err);
    }
}

/**
 * Exige uma permissao de src/config/papeis.js (ex.: requirePermissao('darCiencia')).
 */
function requirePermissao(acao) {
    return (req, res, next) => {
        if (req.usuario && pode(req.usuario.papel, acao)) return next();
        if (ehApi(req)) return res.status(403).json({ erro: 'Sem permissao' });
        return res.status(403).render('erro', { titulo: 'Sem permissão', mensagem: 'Seu perfil não tem permissão para esta ação.' });
    };
}

module.exports = { requireAuth, requirePermissao, gerarToken, definirCookieSessao, limparCookieSessao };
