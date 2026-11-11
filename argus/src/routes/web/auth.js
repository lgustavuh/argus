const express = require('express');
const bcrypt = require('bcryptjs');

const usuariosModel = require('../../models/usuarios');
const auditoria = require('../../services/auditoria');
const { definirCookieSessao, limparCookieSessao } = require('../../middleware/auth');
const limiteLogin = require('../../middleware/limiteLogin');
const { validarSenha } = require('../../util/senha');
const { a } = require('../../util/http');

const router = express.Router();

// Hash real de uma senha descartavel: usado para comparar quando o e-mail nao existe.
const HASH_FICTICIO = bcrypt.hashSync('usuario-inexistente', 12);

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

    const usuario = await usuariosModel.create({
        nome: nome.trim(),
        email: email.toLowerCase().trim(),
        senhaHash: await bcrypt.hash(senha, 12),
        papel: 'admin'
    });
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

    const bloqueio = limiteLogin.minutosBloqueado(req, email);
    if (bloqueio) {
        await auditoria.registrar(req, 'login_bloqueado', { detalhes: { email } });
        return res.status(429).render('login', {
            erro: `Muitas tentativas incorretas. Tente novamente em ${bloqueio} minuto(s).`
        });
    }

    const usuario = email ? await usuariosModel.findByEmail(email) : null;
    // Compara mesmo sem usuario, para o tempo de resposta nao revelar se o e-mail existe.
    const senhaOk = await bcrypt.compare(senha, usuario?.senha_hash || HASH_FICTICIO);

    if (!usuario || !usuario.ativo || !senhaOk) {
        limiteLogin.registrarFalha(req, email);
        await auditoria.registrar(req, 'login_falha', { detalhes: { email }, usuario: usuario || null });
        return res.status(401).render('login', { erro: 'E-mail ou senha inválidos.' });
    }

    limiteLogin.registrarSucesso(req, email);
    await usuariosModel.registrarLogin(usuario.id);
    await auditoria.registrar(req, 'login', { entidade: 'usuario', entidadeId: usuario.id, usuario });
    definirCookieSessao(res, usuario);
    res.redirect(usuario.deve_trocar_senha ? '/minha-conta?trocar=1' : '/painel');
}));

router.get('/logout', (req, res) => {
    limparCookieSessao(res);
    res.redirect('/login');
});

module.exports = router;
