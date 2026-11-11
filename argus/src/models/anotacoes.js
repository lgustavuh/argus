const pool = require('../db/pool');

const MAX_TEXTO = 5000;

async function create({ processoId = null, casoId = null, texto, autorId }) {
    const { rows } = await pool.query(
        `INSERT INTO anotacoes (processo_id, caso_id, texto, autor_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        [processoId, casoId, String(texto).slice(0, MAX_TEXTO), autorId]
    );
    return rows[0];
}

async function listDe({ processoId, casoId }) {
    const { rows } = await pool.query(
        `SELECT a.*, u.nome AS autor_nome FROM anotacoes a LEFT JOIN usuarios u ON u.id = a.autor_id
         WHERE ${processoId ? 'a.processo_id' : 'a.caso_id'} = $1 ORDER BY a.criado_em DESC, a.id DESC`,
        [processoId || casoId]
    );
    return rows;
}

module.exports = { create, listDe, MAX_TEXTO };
