const pool = require('../db/pool');

const CAMPOS_PUBLICOS = 'id, nome, email, papel, ativo, deve_trocar_senha, sessao_versao, ultimo_login_em, criado_em';

async function findByEmail(email) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    return rows[0] || null;
}

async function findById(id) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    return rows[0] || null;
}

async function findSessao(id) {
    const { rows } = await pool.query(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = $1`, [id]);
    return rows[0] || null;
}

async function listAtivos() {
    const { rows } = await pool.query(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE ativo = TRUE ORDER BY nome`);
    return rows;
}

async function listAll() {
    const { rows } = await pool.query(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios ORDER BY nome`);
    return rows;
}

async function listAtivosPorPapeis(papeis) {
    const { rows } = await pool.query(
        `SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE ativo = TRUE AND papel = ANY($1) ORDER BY nome`,
        [papeis]
    );
    return rows;
}

async function existeAlgum() {
    const { rows } = await pool.query('SELECT 1 FROM usuarios LIMIT 1');
    return rows.length > 0;
}

/**
 * Cria o admin inicial so se ainda nao houver usuario nenhum (PRD BUG-11). O advisory lock
 * serializa requisicoes simultaneas ao /setup: a segunda encontra o primeiro admin e desiste.
 * @returns {Promise<object|null>} o admin criado, ou null se ja existia usuario
 */
async function criarPrimeiroAdmin({ nome, email, senhaHash }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('argus:setup'))`);
        const { rows: existentes } = await client.query('SELECT 1 FROM usuarios LIMIT 1');
        if (existentes.length) {
            await client.query('ROLLBACK');
            return null;
        }
        const { rows } = await client.query(
            `INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ($1, $2, $3, 'admin') RETURNING ${CAMPOS_PUBLICOS}`,
            [nome, email, senhaHash]
        );
        await client.query('COMMIT');
        return rows[0];
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/** Usuario ativo com um dos papeis dados (ex.: quem pode ser responsavel), ou null. */
async function findAtivoComPapel(id, papeis) {
    const { rows } = await pool.query(
        `SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = $1 AND ativo = TRUE AND papel = ANY($2)`,
        [id, papeis]
    );
    return rows[0] || null;
}

/** Logout: invalida todos os tokens ja emitidos para o usuario (PRD BUG-10). */
async function encerrarSessoes(id) {
    await pool.query('UPDATE usuarios SET sessao_versao = sessao_versao + 1 WHERE id = $1', [id]);
}

async function create({ nome, email, senhaHash, papel = 'procurador', deveTrocarSenha = false }) {
    const { rows } = await pool.query(
        `INSERT INTO usuarios (nome, email, senha_hash, papel, deve_trocar_senha)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${CAMPOS_PUBLICOS}`,
        [nome, email, senhaHash, papel, deveTrocarSenha]
    );
    return rows[0];
}

// Mudancas de ativo/papel/senha incrementam sessao_versao: sessoes abertas daquele usuario caem.
async function setAtivo(id, ativo) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET ativo = $1, sessao_versao = sessao_versao + 1 WHERE id = $2 RETURNING ${CAMPOS_PUBLICOS}`,
        [ativo, id]
    );
    return rows[0] || null;
}

async function setPapel(id, papel) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET papel = $1, sessao_versao = sessao_versao + 1 WHERE id = $2 RETURNING ${CAMPOS_PUBLICOS}`,
        [papel, id]
    );
    return rows[0] || null;
}

async function setSenha(id, senhaHash, { deveTrocarSenha = false } = {}) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET senha_hash = $1, deve_trocar_senha = $2, sessao_versao = sessao_versao + 1
         WHERE id = $3 RETURNING ${CAMPOS_PUBLICOS}`,
        [senhaHash, deveTrocarSenha, id]
    );
    return rows[0] || null;
}

async function registrarLogin(id) {
    await pool.query('UPDATE usuarios SET ultimo_login_em = NOW() WHERE id = $1', [id]);
}

module.exports = {
    findByEmail,
    findById,
    findSessao,
    listAtivos,
    listAll,
    listAtivosPorPapeis,
    existeAlgum,
    criarPrimeiroAdmin,
    findAtivoComPapel,
    encerrarSessoes,
    create,
    setAtivo,
    setPapel,
    setSenha,
    registrarLogin
};
