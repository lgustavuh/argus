const pool = require('../db/pool');
const etiquetas = require('./etiquetas');

const TIPOS = {
    administrativo: 'Procedimento administrativo',
    extrajudicial: 'Notificação / tratativa extrajudicial',
    consulta: 'Consulta / parecer',
    outro: 'Outro'
};

const SELECT_DETALHADO = `
    SELECT c.*, r.nome AS responsavel_nome, cp.nome AS criado_por_nome, p.numero_processo,
           ${etiquetas.subconsulta('caso', 'c')} AS etiquetas,
           (SELECT MIN(k.data) FROM compromissos k WHERE k.caso_id = c.id AND k.status = 'aberto') AS proximo_compromisso
    FROM casos c
    LEFT JOIN usuarios r ON r.id = c.responsavel_id
    LEFT JOIN usuarios cp ON cp.id = c.criado_por
    LEFT JOIN processos p ON p.id = c.processo_id`;

async function create({ titulo, tipo, referencia, interessado, descricao, responsavelId, processoId, criadoPor }) {
    const { rows } = await pool.query(
        `INSERT INTO casos (titulo, tipo, referencia, interessado, descricao, responsavel_id, processo_id, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [titulo, tipo, referencia || null, interessado || null, descricao || null, responsavelId || null, processoId || null, criadoPor || null]
    );
    return findById(rows[0].id);
}

async function update(id, { titulo, tipo, referencia, interessado, descricao, responsavelId, processoId }) {
    const { rows } = await pool.query(
        `UPDATE casos SET titulo = $1, tipo = $2, referencia = $3, interessado = $4, descricao = $5,
                responsavel_id = $6, processo_id = $7, atualizado_em = NOW()
         WHERE id = $8 RETURNING id`,
        [titulo, tipo, referencia || null, interessado || null, descricao || null, responsavelId || null, processoId || null, id]
    );
    return rows[0] ? findById(rows[0].id) : null;
}

async function findById(id) {
    const { rows } = await pool.query(`${SELECT_DETALHADO} WHERE c.id = $1`, [id]);
    return rows[0] || null;
}

async function setStatus(id, status) {
    const { rows } = await pool.query(
        `UPDATE casos SET status = $1, encerrado_em = CASE WHEN $1 = 'encerrado' THEN NOW() END, atualizado_em = NOW()
         WHERE id = $2 AND status <> $1 RETURNING id`,
        [status, id]
    );
    return rows[0] || null;
}

async function list({ status = 'aberto', responsavelId, tipo, etiqueta, busca } = {}, { limit = 50, offset = 0 } = {}) {
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
    if (tipo) {
        params.push(tipo);
        conditions.push(`c.tipo = $${params.length}`);
    }
    if (etiqueta) {
        params.push(etiqueta);
        conditions.push(etiquetas.condicao('caso', 'c', `$${params.length}`));
    }
    if (busca) {
        params.push(`%${busca}%`);
        const n = params.length;
        conditions.push(`(c.titulo ILIKE $${n} OR c.referencia ILIKE $${n} OR c.interessado ILIKE $${n} OR c.descricao ILIKE $${n})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [{ rows }, total] = await Promise.all([
        pool.query(
            `${SELECT_DETALHADO} ${where}
             ORDER BY proximo_compromisso ASC NULLS LAST, c.atualizado_em DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        ),
        pool.query(`SELECT COUNT(*)::int AS total FROM casos c ${where}`, params)
    ]);
    return { casos: rows, total: total.rows[0].total };
}

async function listPorProcesso(processoId) {
    const { rows } = await pool.query(`${SELECT_DETALHADO} WHERE c.processo_id = $1 ORDER BY c.criado_em DESC`, [processoId]);
    return rows;
}

module.exports = { TIPOS, create, update, findById, setStatus, list, listPorProcesso };
