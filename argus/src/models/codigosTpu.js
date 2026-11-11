const pool = require('../db/pool');

async function listAll() {
    const { rows } = await pool.query('SELECT * FROM codigos_tpu_relevantes ORDER BY peso_urgencia DESC, codigo');
    return rows;
}

async function getMapaRelevancia() {
    const rows = await listAll();
    const mapa = new Map();
    for (const r of rows) mapa.set(r.codigo, r);
    return mapa;
}

async function upsert({ codigo, nome, pesoUrgencia = 1 }) {
    const { rows } = await pool.query(
        `INSERT INTO codigos_tpu_relevantes (codigo, nome, peso_urgencia) VALUES ($1, $2, $3)
         ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, peso_urgencia = EXCLUDED.peso_urgencia
         RETURNING *`,
        [codigo, nome, Math.min(5, Math.max(1, pesoUrgencia))]
    );
    return rows[0];
}

async function remove(codigo) {
    const { rowCount } = await pool.query('DELETE FROM codigos_tpu_relevantes WHERE codigo = $1', [codigo]);
    return rowCount > 0;
}

module.exports = { listAll, getMapaRelevancia, upsert, remove };
