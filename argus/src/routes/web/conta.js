const express = require('express');
const bcrypt = require('bcryptjs');

const usuariosModel = require('../../models/usuarios');
const auditoria = require('../../services/auditoria');
const { definirCookieSessao } = require('../../middleware/auth');
const { validarSenha } = require('../../util/senha');
const { a, comMsg } = require('../../util/http');

const router = express.Router();

router.get('/', (req, res) => {
    res.render('minha_conta', { erro: null, msg: req.query.msg, forcarTroca: req.usuario.deve_trocar_senha });
});

router.post('/senha', a(async (req, res) => {
    const { senhaAtual, novaSenha, confirmarSenha } = req.body;
    const renderErro = (erro) =>
        res.status(400).render('minha_conta', { erro, msg: null, forcarTroca: req.usuario.deve_trocar_senha });

    const usuario = await usuariosModel.findById(req.usuario.id);
    if (!(await bcrypt.compare(senhaAtual || '', usuario.senha_hash))) return renderErro('Senha atual incorreta.');
    const erroSenha = validarSenha(novaSenha);
    if (erroSenha) return renderErro(erroSenha);
    if (novaSenha !== confirmarSenha) return renderErro('A confirmação não confere com a nova senha.');
    if (await bcrypt.compare(novaSenha, usuario.senha_hash)) return renderErro('A nova senha precisa ser diferente da atual.');

    const atualizado = await usuariosModel.setSenha(usuario.id, await bcrypt.hash(novaSenha, 12));
    await auditoria.registrar(req, 'senha_alterada', { entidade: 'usuario', entidadeId: usuario.id });
    // A troca invalida as sessoes antigas (sessao_versao); renova a sessao atual.
    definirCookieSessao(res, atualizado);
    res.redirect(comMsg('/minha-conta', 'Senha alterada com sucesso.'));
}));

module.exports = router;
