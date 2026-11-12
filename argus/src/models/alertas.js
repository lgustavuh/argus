const pool = require('../db/pool');

const SELECT_DETALHADO = `
    SELECT a.*, p.numero_processo, p.link_consulta_publica, p.procurador_responsavel_id, p.sistema,
           p.classe_nome, p.orgao_julgador, p.tribunal, p.grau, p.sistema_informado,
           u.nome AS procurador_nome,
           m.nome AS movimento_nome, m.codigo_tpu, m.data_hora AS movimento_data_hora,
           COALESCE(c.peso_urgencia, 1) AS peso_urgencia,
           uv.nome AS visualizado_por_nome, uc.nome AS ciente_por_nome, ue.nome AS escalado_para_nome,
           (SELECT COUNT(*)::int FROM movimentos mm WHERE mm.alerta_id = a.id) AS qtd_movimentos
    FROM alertas a
    JOIN processos p ON p.id = a.processo_id
    LEFT JOIN usuarios u ON u.id = p.procurador_responsavel_id
    LEFT JOIN movimentos m ON m.id = a.movimento_id
    LEFT JOIN codigos_tpu_relevantes c ON c.codigo = m.codigo_tpu
    LEFT JOIN usuarios uv ON uv.id = a.visualizado_por
    LEFT JOIN usuarios uc ON uc.id = a.ciente_por
    LEFT JOIN usuarios ue ON ue.id = a.escalado_para`;

async function create({ processoId, movimentoId, tipo = 'movimento_relevante', prazoDiasAlerta }) {
    const { rows } = await pool.query(
        `INSERT INTO alertas (processo_id, movimento_id, tipo, prazo_dias_alerta)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [processoId, movimentoId, tipo, prazoDiasAlerta]
    );
    return rows[0];
}

// Dia (America/Sao_Paulo) de uma coluna TIMESTAMP que guarda UTC.
const DIA_SP = (coluna) => `((${coluna} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date`;

/**
 * Trata um movimento pendente: remove a marca `alerta_pendente` e, na MESMA transacao, ou o junta a
 * um alerta ainda sem ciencia do mesmo processo e do mesmo dia (PRD MEL-17: uma publicacao gera
 * disponibilizacao + expedicao + publicacao no mesmo dia), ou cria um alerta novo.
 *
 * - O UPDATE da marca trava o movimento: duas execucoes simultaneas nao tratam o mesmo movimento.
 * - O advisory lock por processo evita que dois movimentos do mesmo dia, tratados em paralelo,
 *   abram dois alertas.
 * - Nunca junta a um alerta com ciencia: um movimento novo depois da ciencia seria escondido.
 *
 * @returns {Promise<{alerta: object, novo: boolean}|null>} null se o movimento ja tinha sido tratado
 */
async function criarParaMovimentoPendente({ movimentoId, prazoDiasAlerta, tipo = 'movimento_relevante' }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: reivindicado } = await client.query(
            `UPDATE movimentos SET alerta_pendente = FALSE
             WHERE id = $1 AND alerta_pendente
             RETURNING processo_id, data_hora`,
            [movimentoId]
        );
        if (!reivindicado.length) {
            await client.query('ROLLBACK');
            return null;
        }
        const { processo_id: processoId, data_hora: dataHora } = reivindicado[0];
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`argus:alerta:processo:${processoId}`]);

        let alerta = null;
        if (dataHora) {
            const { rows } = await client.query(
                `SELECT a.* FROM alertas a
                 JOIN movimentos m ON m.id = a.movimento_id
                 WHERE a.processo_id = $1 AND a.tipo = $2
                   AND a.status IN ('pendente', 'visualizado', 'escalado')
                   AND ${DIA_SP('m.data_hora')} = ${DIA_SP('$3::timestamp')}
                 ORDER BY a.id LIMIT 1`,
                [processoId, tipo, dataHora]
            );
            alerta = rows[0] || null;
        }
        const novo = !alerta;
        if (novo) {
            const { rows } = await client.query(
                `INSERT INTO alertas (processo_id, movimento_id, tipo, prazo_dias_alerta)
                 VALUES ($1,$2,$3,$4) RETURNING *`,
                [processoId, movimentoId, tipo, prazoDiasAlerta]
            );
            alerta = rows[0];
        }
        await client.query('UPDATE movimentos SET alerta_id = $1 WHERE id = $2', [alerta.id, movimentoId]);
        await client.query('COMMIT');
        return { alerta, novo };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/** Movimentos reunidos num alerta (o que abriu o alerta incluido), em ordem cronologica. */
async function listMovimentos(alertaId) {
    const { rows } = await pool.query(
        `SELECT m.id, m.codigo_tpu, m.nome, m.data_hora
         FROM movimentos m
         WHERE m.alerta_id = $1 OR m.id = (SELECT movimento_id FROM alertas WHERE id = $1)
         ORDER BY m.data_hora NULLS LAST, m.id`,
        [alertaId]
    );
    return rows;
}

async function findById(id) {
    const { rows } = await pool.query(`${SELECT_DETALHADO} WHERE a.id = $1`, [id]);
    return rows[0] || null;
}

async function list({ status, processoId } = {}, { limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    if (status === 'abertos') {
        conditions.push(`a.status IN ('pendente', 'visualizado', 'escalado')`);
    } else if (status) {
        params.push(status);
        conditions.push(`a.status = $${params.length}`);
    }
    if (processoId) {
        params.push(processoId);
        conditions.push(`a.processo_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [{ rows }, total] = await Promise.all([
        pool.query(
            `${SELECT_DETALHADO} ${where}
             ORDER BY (a.status = 'ciente') ASC, COALESCE(c.peso_urgencia, 1) DESC, a.criado_em ASC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        ),
        pool.query(`SELECT COUNT(*)::int AS total FROM alertas a ${where}`, params)
    ]);
    return { alertas: rows, total: total.rows[0].total };
}

async function marcarVisualizado(id, usuarioId) {
    const { rows } = await pool.query(
        `UPDATE alertas SET status = 'visualizado', visualizado_em = NOW(), visualizado_por = $1
         WHERE id = $2 AND status = 'pendente' RETURNING *`,
        [usuarioId, id]
    );
    return rows[0] || null;
}

/**
 * Ciencia vale para pendente, visualizado e escalado. Se ninguem tinha registrado visualizacao,
 * quem deu ciencia tambem fica como quem visualizou.
 */
async function marcarCiente(id, usuarioId) {
    const { rows } = await pool.query(
        `UPDATE alertas SET status = 'ciente', ciente_em = NOW(), ciente_por = $1,
                visualizado_em = COALESCE(visualizado_em, NOW()),
                visualizado_por = COALESCE(visualizado_por, $1)
         WHERE id = $2 AND status IN ('pendente', 'visualizado', 'escalado') RETURNING *`,
        [usuarioId, id]
    );
    return rows[0] || null;
}

async function listParaEscalonar(prazoDiasPadrao) {
    const { rows } = await pool.query(
        `SELECT a.*, p.numero_processo, p.procurador_responsavel_id
         FROM alertas a
         JOIN processos p ON p.id = a.processo_id
         WHERE a.status IN ('pendente', 'visualizado')
           AND a.criado_em < NOW() - (COALESCE(a.prazo_dias_alerta, $1) || ' days')::interval`,
        [prazoDiasPadrao]
    );
    return rows;
}

async function marcarEscalado(id, escaladoParaId) {
    const { rows } = await pool.query(
        `UPDATE alertas SET status = 'escalado', escalado_em = NOW(), escalado_para = $1
         WHERE id = $2 AND status IN ('pendente', 'visualizado') RETURNING *`,
        [escaladoParaId, id]
    );
    return rows[0] || null;
}

async function contarPorStatus() {
    const { rows } = await pool.query('SELECT status, COUNT(*)::int AS total FROM alertas GROUP BY status');
    const base = { pendente: 0, visualizado: 0, ciente: 0, escalado: 0 };
    for (const r of rows) base[r.status] = r.total;
    return base;
}

async function contarAbertos() {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM alertas WHERE status IN ('pendente', 'visualizado', 'escalado')`
    );
    return rows[0].total;
}

async function listRecentes({ limit = 6 } = {}) {
    const { rows } = await pool.query(
        `SELECT a.*, p.numero_processo, m.nome AS movimento_nome
         FROM alertas a
         JOIN processos p ON p.id = a.processo_id
         LEFT JOIN movimentos m ON m.id = a.movimento_id
         ORDER BY a.criado_em DESC
         LIMIT $1`,
        [limit]
    );
    return rows;
}

module.exports = {
    create,
    criarParaMovimentoPendente,
    listMovimentos,
    findById,
    list,
    marcarVisualizado,
    marcarCiente,
    listParaEscalonar,
    marcarEscalado,
    contarPorStatus,
    contarAbertos,
    listRecentes
};
