const pool = require('../db/pool');

const SELECT = `
    SELECT d.*, u.nome AS enviado_por_nome, p.numero_processo, c.titulo AS caso_titulo
    FROM documentos d
    LEFT JOIN usuarios u ON u.id = d.enviado_por
    LEFT JOIN processos p ON p.id = d.processo_id
    LEFT JOIN casos c ON c.id = d.caso_id`;

async function create({ processoId = null, casoId = null, nomeOriginal, arquivo, tamanho, descricao, enviadoPor }) {
    const { rows } = await pool.query(
        `INSERT INTO documentos (processo_id, caso_id, nome_original, arquivo, tamanho, descricao, enviado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [processoId, casoId, nomeOriginal, arquivo, tamanho, descricao || null, enviadoPor]
    );
    return rows[0];
}

async function findById(id) {
    const { rows } = await pool.query(`${SELECT} WHERE d.id = $1`, [id]);
    return rows[0] || null;
}

async function listDe({ processoId, casoId }) {
    const { rows } = await pool.query(
        `${SELECT} WHERE ${processoId ? 'd.processo_id' : 'd.caso_id'} = $1 ORDER BY d.criado_em DESC, d.id DESC`,
        [processoId || casoId]
    );
    return rows;
}

async function list({ busca } = {}, { limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = '';
    if (busca) {
        params.push(`%${busca}%`);
        const digitos = busca.replace(/\D/g, '');
        let cond = `d.nome_original ILIKE $1 OR d.descricao ILIKE $1 OR c.titulo ILIKE $1`;
        if (digitos.length >= 4) {
            params.push(`%${digitos}%`);
            cond += ` OR p.numero_processo LIKE $2`;
        }
        where = `WHERE ${cond}`;
    }
    const [{ rows }, total] = await Promise.all([
        pool.query(`${SELECT} ${where} ORDER BY d.criado_em DESC, d.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
        pool.query(`SELECT COUNT(*)::int AS total FROM documentos d LEFT JOIN processos p ON p.id = d.processo_id LEFT JOIN casos c ON c.id = d.caso_id ${where}`, params)
    ]);
    return { documentos: rows, total: total.rows[0].total };
}

async function remove(id) {
    const { rows } = await pool.query('DELETE FROM documentos WHERE id = $1 RETURNING *', [id]);
    return rows[0] || null;
}

// --- Modelos ---

async function listModelos({ incluirInativos = false } = {}) {
    const { rows } = await pool.query(
        `SELECT m.*, u.nome AS atualizado_por_nome FROM modelos_documento m
         LEFT JOIN usuarios u ON u.id = m.atualizado_por
         ${incluirInativos ? '' : 'WHERE m.ativo = TRUE'} ORDER BY m.ativo DESC, lower(m.nome)`
    );
    return rows;
}

async function findModelo(id) {
    const { rows } = await pool.query('SELECT * FROM modelos_documento WHERE id = $1', [id]);
    return rows[0] || null;
}

async function salvarModelo(id, { nome, descricao, conteudo, ativo = true }, usuarioId) {
    if (id) {
        const { rows } = await pool.query(
            `UPDATE modelos_documento SET nome = $1, descricao = $2, conteudo = $3, ativo = $4, atualizado_por = $5, atualizado_em = NOW()
             WHERE id = $6 RETURNING *`,
            [nome, descricao || null, conteudo, ativo, usuarioId, id]
        );
        return rows[0] || null;
    }
    const { rows } = await pool.query(
        `INSERT INTO modelos_documento (nome, descricao, conteudo, criado_por, atualizado_por) VALUES ($1,$2,$3,$4,$4) RETURNING *`,
        [nome, descricao || null, conteudo, usuarioId]
    );
    return rows[0];
}

module.exports = { create, findById, listDe, list, remove, listModelos, findModelo, salvarModelo };
