const pool = require('../db/pool');

async function listHashesExistentes(processoId) {
    const { rows } = await pool.query('SELECT hash_dedup FROM movimentos WHERE processo_id = $1', [
        processoId
    ]);
    return new Set(rows.map((r) => r.hash_dedup));
}

/**
 * Movimentos ja gravados de um processo com a chave "semantica" codigo|minuto (UTC). Usado so na
 * troca de fonte (PRD MEL-19): o mesmo movimento vindo da outra fonte tem outro hash, mas o mesmo
 * codigo TPU e o mesmo instante.
 */
async function listChavesSemanticas(processoId) {
    const { rows } = await pool.query(
        `SELECT id, codigo_tpu, to_char(data_hora, 'YYYY-MM-DD"T"HH24:MI') AS minuto
         FROM movimentos WHERE processo_id = $1 ORDER BY id`,
        [processoId]
    );
    return rows;
}

/** Re-chaveia um movimento ja gravado com o hash da nova fonte (a formula do hash nao muda). */
async function trocarHash(id, hashDedup) {
    await pool.query('UPDATE movimentos SET hash_dedup = $1 WHERE id = $2', [hashDedup, id]);
}

async function insertMany(movimentos) {
    if (!movimentos.length) return [];
    const inseridos = [];
    for (const m of movimentos) {
        const { rows } = await pool.query(
            `INSERT INTO movimentos (processo_id, codigo_tpu, nome, data_hora, relevante_para_prazo, hash_dedup, alerta_pendente)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (hash_dedup) DO NOTHING
             RETURNING *`,
            [m.processoId, m.codigoTpu, m.nome, m.dataHora, m.relevanteParaPrazo, m.hashDedup, Boolean(m.alertaPendente)]
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

/**
 * Movimentos que devem gerar alerta e ainda nao geraram (ver migrations/010_alerta_pendente.sql).
 */
async function listAlertaPendente({ processoId = null } = {}) {
    const { rows } = await pool.query(
        `SELECT * FROM movimentos
         WHERE alerta_pendente AND ($1::int IS NULL OR processo_id = $1)
         ORDER BY data_hora NULLS LAST, id`,
        [processoId]
    );
    return rows;
}

module.exports = { listHashesExistentes, listChavesSemanticas, trocarHash, insertMany, listByProcesso, listAlertaPendente };
