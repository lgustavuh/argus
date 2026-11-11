const crypto = require('crypto');

const SENHA_MIN = 10;

/**
 * Politica de senha: minimo de 10 caracteres, com letras e numeros.
 * @returns {string|null} mensagem de erro, ou null se a senha e aceitavel
 */
function validarSenha(senha) {
    if (!senha || senha.length < SENHA_MIN) return `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
    if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) return 'A senha precisa ter letras e números.';
    return null;
}

/**
 * Senha provisoria legivel (sem caracteres ambiguos), usada pelo script de criacao de admin.
 */
function gerarSenhaProvisoria() {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    for (;;) {
        const senha = Array.from(crypto.randomBytes(14), (b) => alfabeto[b % alfabeto.length]).join('');
        if (!validarSenha(senha)) return senha;
    }
}

module.exports = { validarSenha, gerarSenhaProvisoria, SENHA_MIN };
