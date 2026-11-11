const pool = require('../db/pool');

async function listHashesExistentes(processoId) {
    const { rows } = await pool.query('SELECT hash_dedup FROM movimentos WHERE processo_id = $1', [
        processoId
    ]);
    return new Set(rows.map((r) => r.hash_dedup));
}

async function insertMany(movimentos) {
    if (!movimentos.length) return [];
    const inseridos = [];
    for (const m of movimentos) {
        const { rows } = await pool.query(
            `INSERT INTO movimentos (processo_id, codigo_tpu, nome, data_hora, relevante_para_prazo, hash_dedup)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (hash_dedup) DO NOTHING
             RETURNING *`,
            [m.processoId, m.codigoTpu, m.nome, m.dataHora, m.relevanteParaPrazo, m.hashDedup]
        );
        if (rows[0]) inseridos.push(rows[0]);
    }
    return inseridos;
}

async function listByProcesso(processoId) {
    const { rows } = await pool.query(
        'SELECT * FROM movimentos WHERE processo_id = $1 ORDER BY data_hora DESC NULLS LAST, id DESC',
        [processoId]
    );
    return rows;
}

module.exports = { listHashesExistentes, insertMany, listByProcesso };
