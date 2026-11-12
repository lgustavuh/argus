const bcrypt = require('bcryptjs');
const usuariosModel = require('../models/usuarios');

// Hash real de uma senha descartavel: compara mesmo quando o e-mail nao existe, para o tempo de
// resposta nao revelar quais e-mails estao cadastrados (PRD BUG-05). Usado pela tela e pela API.
const HASH_FICTICIO = bcrypt.hashSync('usuario-inexistente', 12);

/**
 * @returns {Promise<{usuario: object|null, valido: boolean}>} usuario (se o e-mail existe, para a
 *   auditoria) e se a senha confere com um usuario ativo.
 */
async function verificarCredenciais(email, senha) {
    const usuario = email ? await usuariosModel.findByEmail(email) : null;
    const senhaOk = await bcrypt.compare(String(senha || ''), usuario?.senha_hash || HASH_FICTICIO);
    return { usuario, valido: Boolean(usuario && usuario.ativo && senhaOk) };
}

module.exports = { verificarCredenciais };
