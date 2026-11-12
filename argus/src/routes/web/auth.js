const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const usuariosModel = require('../../models/usuarios');
const auditoria = require('../../services/auditoria');
const { verificarCredenciais } = require('../../services/autenticacao');
const { definirCookieSessao, limparCookieSessao } = require('../../middleware/auth');
const limiteLogin = require('../../middleware/limiteLogin');
const { validarSenha } = require('../../util/senha');
const { a } = require('../../util/http');

const router = express.Router();

// Primeiro acesso: sem nenhum usuario cadastrado, so a tela de setup cria o admin inicial —
// nenhuma credencial de admin fica salva em .env.
router.get('/setup', a(async (req, res) => {
    if (await usuariosModel.existeAlgum()) return res.redirect('/login');
    res.render('setup', { erro: null });
}));

router.post('/setup', a(async (req, res) => {
    if (await usuariosModel.existeAlgum()) return res.redirect('/login');

    const { nome, email, senha, confirmarSenha } = req.body;
    if (!nome?.trim() || !email?.trim() || !senha) {
        return res.status(400).render('setup', { erro: 'Preencha nome, e-mail e senha.' });
    }
    const erroSenha = validarSenha(senha);
    if (erroSenha) return res.status(400).render('setup', { erro: erroSenha });
    if (senha !== confirmarSenha) return res.status(400).render('setup', { erro: 'As senhas não coincidem.' });

    const usuario = await usuariosModel.criarPrimeiroAdmin({
        nome: nome.trim(),
        email: email.toLowerCase().trim(),
        senhaHash: await bcrypt.hash(senha, 12)
    });
    // Outra requisicao criou o admin primeiro (PRD BUG-11).
    if (!usuario) return res.redirect('/login');
    await auditoria.registrar(req, 'setup_admin', { entidade: 'usuario', entidadeId: usuario.id, usuario });
    definirCookieSessao(res, usuario);
    res.redirect('/painel');
}));

router.get('/login', a(async (req, res) => {
    if (!(await usuariosModel.existeAlgum())) return res.redirect('/setup');
    res.render('login', { erro: null });
}));

router.post('/login', a(async (req, res) => {
    const email = (req.body.email || '').toLowerCase().trim();
    const senha = req.body.senha || '';

    const bloqueio = await limiteLogin.minutosBloqueado(req, email);
    if (bloqueio) {
        await auditoria.registrar(req, 'login_bloqueado', { detalhes: { email } });
        return res.status(429).render('login', {
            erro: `Muitas tentativas incorretas. Tente novamente em ${bloqueio} minuto(s).`
        });
    }

    const { usuario, valido } = await verificarCredenciais(email, senha);
    if (!valido) {
        await limiteLogin.registrarFalha(req, email);
        await auditoria.registrar(req, 'login_falha', { detalhes: { email }, usuario: usuario || null });
        return res.status(401).render('login', { erro: 'E-mail ou senha inválidos.' });
    }

    await limiteLogin.registrarSucesso(req, email);
    await usuariosModel.registrarLogin(usuario.id);
    await auditoria.registrar(req, 'login', { entidade: 'usuario', entidadeId: usuario.id, usuario });
    definirCookieSessao(res, usuario);
    res.redirect(usuario.deve_trocar_senha ? '/minha-conta?trocar=1' : '/painel');
}));

// Logout so por POST (um link/imagem de outro site nao derruba a sessao) e invalidando o token no
// banco: um token copiado antes do logout deixa de valer (PRD BUG-10).
router.post('/logout', a(async (req, res) => {
    const token = req.cookies?.token;
    if (token) {
        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
            const usuario = await usuariosModel.findSessao(payload.id);
            if (usuario) {
                await usuariosModel.encerrarSessoes(usuario.id);
                await auditoria.registrar(req, 'logout', { entidade: 'usuario', entidadeId: usuario.id, usuario });
            }
        } catch (err) {
            // token invalido/expirado: basta limpar o cookie
        }
    }
    limparCookieSessao(res);
    res.redirect('/login');
}));

// Endereco antigo (favoritos): nao faz logout por GET, so leva para o sistema.
router.get('/logout', (req, res) => res.redirect('/painel'));

module.exports = router;
