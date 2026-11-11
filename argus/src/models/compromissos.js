const pool = require('../db/pool');

const TIPOS = {
    prazo: 'Prazo',
    audiencia: 'Audiência',
    tarefa: 'Tarefa',
    evento: 'Evento'
};

const SELECT_DETALHADO = `
    SELECT c.*, to_char(c.hora, 'HH24:MI') AS hora,
           p.numero_processo, p.classe_nome, p.orgao_julgador, k.titulo AS caso_titulo,
           r.nome AS responsavel_nome, r.email AS responsavel_email,
           cp.nome AS criado_por_nome, cc.nome AS concluido_por_nome
    FROM compromissos c
    LEFT JOIN processos p ON p.id = c.processo_id
    LEFT JOIN casos k ON k.id = c.caso_id
    LEFT JOIN usuarios r ON r.id = c.responsavel_id
    LEFT JOIN usuarios cp ON cp.id = c.criado_por
    LEFT JOIN usuarios cc ON cc.id = c.concluido_por`;

const ORDEM_AGENDA = 'c.data ASC, c.hora ASC NULLS LAST, c.id ASC';

async function create({ tipo, titulo, descricao, data, hora, local, processoId, casoId, alertaId, responsavelId, criadoPor }) {
    const { rows } = await pool.query(
        `INSERT INTO compromissos (tipo, titulo, descricao, data, hora, local, processo_id, caso_id, alerta_id, responsavel_id, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [tipo, titulo, descricao || null, data, hora || null, local || null, processoId || null, casoId || null, alertaId || null, responsavelId || null, criadoPor || null]
    );
    return findById(rows[0].id);
}

async function update(id, { tipo, titulo, descricao, data, hora, local, processoId, casoId, responsavelId }) {
    const { rows } = await pool.query(
        `UPDATE compromissos SET tipo = $1, titulo = $2, descricao = $3, data = $4, hora = $5, local = $6,
                processo_id = $7, caso_id = $8, responsavel_id = $9, atualizado_em = NOW()
         WHERE id = $10 RETURNING id`,
        [tipo, titulo, descricao || null, data, hora || null, local || null, processoId || null, casoId || null, responsavelId || null, id]
    );
    return rows[0] ? findById(rows[0].id) : null;
}

async function findById(id) {
    const { rows } = await pool.query(`${SELECT_DETALHADO} WHERE c.id = $1`, [id]);
    return rows[0] || null;
}

/**
 * Concluir/cancelar so valem para compromisso em aberto; reabrir, para concluido ou cancelado.
 * Devolvem null quando o compromisso ja estava no estado pedido.
 */
async function concluir(id, usuarioId) {
    const { rows } = await pool.query(
        `UPDATE compromissos SET status = 'concluido', concluido_em = NOW(), concluido_por = $1, atualizado_em = NOW()
         WHERE id = $2 AND status = 'aberto' RETURNING id`,
        [usuarioId, id]
    );
    return rows[0] || null;
}

async function cancelar(id, usuarioId) {
    const { rows } = await pool.query(
        `UPDATE compromissos SET status = 'cancelado', concluido_em = NOW(), concluido_por = $1, atualizado_em = NOW()
         WHERE id = $2 AND status = 'aberto' RETURNING id`,
        [usuarioId, id]
    );
    return rows[0] || null;
}

async function reabrir(id) {
    const { rows } = await pool.query(
        `UPDATE compromissos SET status = 'aberto', concluido_em = NULL, concluido_por = NULL, atualizado_em = NOW()
         WHERE id = $1 AND status IN ('concluido', 'cancelado') RETURNING id`,
        [id]
    );
    return rows[0] || null;
}

function montarFiltro({ status = 'aberto', responsavelId, semResponsavel, tipo, processoId, busca }) {
    const conditions = [];
    const params = [];
    if (status !== 'todos') {
        params.push(status);
        conditions.push(`c.status = $${params.length}`);
    }
    if (responsavelId) {
        params.push(responsavelId);
        conditions.push(`c.responsavel_id = $${params.length}`);
    }
    if (semResponsavel) conditions.push('c.responsavel_id IS NULL');
    if (tipo) {
        params.push(tipo);
        conditions.push(`c.tipo = $${params.length}`);
    }
    if (processoId) {
        params.push(processoId);
        conditions.push(`c.processo_id = $${params.length}`);
    }
    if (busca) {
        const digitos = String(busca).replace(/\D/g, '');
        params.push(`%${busca}%`);
        const pTexto = params.length;
        let cond = `c.titulo ILIKE $${pTexto} OR c.descricao ILIKE $${pTexto} OR k.titulo ILIKE $${pTexto}`;
        if (digitos.length >= 4) {
            params.push(`%${digitos}%`);
            cond += ` OR p.numero_processo LIKE $${params.length}`;
        }
        conditions.push(`(${cond})`);
    }
    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

/**
 * Abertos em ordem de agenda (o mais proximo primeiro); concluidos/cancelados do mais recente
 * para o mais antigo.
 */
async function list(filtro = {}, { limit = 200, offset = 0 } = {}) {
    const { where, params } = montarFiltro(filtro);
    const ordem = (filtro.status || 'aberto') === 'aberto' ? ORDEM_AGENDA : 'c.data DESC, c.hora DESC NULLS LAST, c.id DESC';
    const [{ rows }, total] = await Promise.all([
        pool.query(
            `${SELECT_DETALHADO} ${where} ORDER BY ${ordem}
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        ),
        pool.query(`SELECT COUNT(*)::int AS total FROM compromissos c LEFT JOIN processos p ON p.id = c.processo_id LEFT JOIN casos k ON k.id = c.caso_id ${where}`, params)
    ]);
    return { compromissos: rows, total: total.rows[0].total };
}

// Todos os do processo: abertos primeiro (por data), depois o historico.
async function listPorProcesso(processoId) {
    const { rows } = await pool.query(
        `${SELECT_DETALHADO} WHERE c.processo_id = $1
         ORDER BY (c.status = 'aberto') DESC, CASE WHEN c.status = 'aberto' THEN c.data END ASC, c.data DESC, c.id DESC`,
        [processoId]
    );
    return rows;
}

async function listPorCaso(casoId) {
    const { rows } = await pool.query(
        `${SELECT_DETALHADO} WHERE c.caso_id = $1
         ORDER BY (c.status = 'aberto') DESC, CASE WHEN c.status = 'aberto' THEN c.data END ASC, c.data DESC, c.id DESC`,
        [casoId]
    );
    return rows;
}

async function listPorAlerta(alertaId) {
    const { rows } = await pool.query(`${SELECT_DETALHADO} WHERE c.alerta_id = $1 ORDER BY ${ORDEM_AGENDA}`, [alertaId]);
    return rows;
}

/**
 * Para o painel "meu dia": compromissos em aberto ate `ate` (inclusive), vencidos incluidos.
 * Com `responsavelId`, so os daquela pessoa.
 */
async function listAbertosAte(ate, { responsavelId } = {}) {
    const params = [ate];
    let cond = '';
    if (responsavelId) {
        params.push(responsavelId);
        cond = `AND c.responsavel_id = $${params.length}`;
    }
    const { rows } = await pool.query(
        `${SELECT_DETALHADO} WHERE c.status = 'aberto' AND c.data <= $1 ${cond} ORDER BY ${ORDEM_AGENDA}`,
        params
    );
    return rows;
}

async function proximosApos(dia, { responsavelId, limit = 5 } = {}) {
    const params = [dia, limit];
    let cond = '';
    if (responsavelId) {
        params.push(responsavelId);
        cond = `AND c.responsavel_id = $${params.length}`;
    }
    const { rows } = await pool.query(
        `${SELECT_DETALHADO} WHERE c.status = 'aberto' AND c.data > $1 ${cond} ORDER BY ${ORDEM_AGENDA} LIMIT $2`,
        params
    );
    return rows;
}

async function contarVencidos(hoje) {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM compromissos WHERE status = 'aberto' AND data < $1`,
        [hoje]
    );
    return rows[0].total;
}

module.exports = {
    TIPOS,
    create,
    update,
    findById,
    concluir,
    cancelar,
    reabrir,
    list,
    listPorProcesso,
    listPorAlerta,
    listPorCaso,
    listAbertosAte,
    proximosApos,
    contarVencidos
};
