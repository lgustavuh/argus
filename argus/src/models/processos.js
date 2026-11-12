const pool = require('../db/pool');
const etiquetas = require('./etiquetas');

/**
 * Cadastra um processo pelo numero (20 digitos). Se ja existir, nao altera nada e devolve null.
 */
async function inserirManual({ numeroProcesso, tribunal, origem = 'manual', observacao = null, responsavelId = null, criadoPor = null }) {
    const { rows } = await pool.query(
        `INSERT INTO processos (numero_processo, tribunal, origem, observacao, procurador_responsavel_id, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (numero_processo) DO NOTHING
         RETURNING *`,
        [numeroProcesso, tribunal, origem, observacao || null, responsavelId || null, criadoPor || null]
    );
    return rows[0] || null;
}

async function listNumerosExistentes(numeros) {
    if (!numeros.length) return new Set();
    const { rows } = await pool.query('SELECT numero_processo FROM processos WHERE numero_processo = ANY($1)', [numeros]);
    return new Set(rows.map((r) => r.numero_processo));
}

async function atualizarDadosFonte(id, { grau, graus, classeNome, orgaoJulgador, dataAjuizamento, valorCausa, sistema, linkConsultaPublica }) {
    const { rows } = await pool.query(
        `UPDATE processos SET
            grau = $1, graus = $2, classe_nome = $3, orgao_julgador = $4, data_ajuizamento = $5,
            valor_causa = $6, sistema = $7, link_consulta_publica = $8, atualizado_em = NOW()
         WHERE id = $9 RETURNING *`,
        [grau, graus, classeNome, orgaoJulgador, dataAjuizamento, valorCausa, sistema, linkConsultaPublica, id]
    );
    return rows[0];
}

async function setFonteMovimentos(id, fonte) {
    await pool.query('UPDATE processos SET fonte_movimentos = $1 WHERE id = $2', [fonte, id]);
}

async function marcarConsulta(id, situacao) {
    await pool.query('UPDATE processos SET situacao_fonte = $1, ultima_consulta_em = NOW() WHERE id = $2', [situacao, id]);
}

async function listAtivosParaSync() {
    const { rows } = await pool.query('SELECT * FROM processos WHERE ativo = TRUE ORDER BY id');
    return rows;
}

async function listPorIds(ids) {
    if (!ids.length) return [];
    const { rows } = await pool.query('SELECT * FROM processos WHERE id = ANY($1) AND ativo = TRUE ORDER BY id', [ids]);
    return rows;
}

async function findById(id) {
    const { rows } = await pool.query(
        `SELECT p.*, u.nome AS procurador_nome, c.nome AS criado_por_nome, ${etiquetas.subconsulta('processo', 'p')} AS etiquetas
         FROM processos p
         LEFT JOIN usuarios u ON u.id = p.procurador_responsavel_id
         LEFT JOIN usuarios c ON c.id = p.criado_por
         WHERE p.id = $1`,
        [id]
    );
    return rows[0] || null;
}

async function findByNumero(numeroProcesso) {
    const { rows } = await pool.query('SELECT * FROM processos WHERE numero_processo = $1', [numeroProcesso]);
    return rows[0] || null;
}

// Processo do TJMG sem sistema de tramitacao conhecido: o botao "Abrir no PJe/eproc" nao sabe para
// onde levar (mesma regra de linkBuilder.normalizarSistema). Constante interna, sem dado do usuario.
const SEM_SISTEMA_TJMG = `p.tribunal = 'tjmg'
    AND COALESCE(p.sistema_informado, '') NOT IN ('pje', 'eproc')
    AND lower(COALESCE(p.sistema, '')) NOT LIKE '%pje%'
    AND lower(COALESCE(p.sistema, '')) NOT LIKE '%eproc%'`;

function montarFiltro({ responsavelId, tribunal, semResponsavel, semSistema, situacao, busca, arquivados, etiqueta }) {
    const conditions = [arquivados ? 'p.ativo = FALSE' : 'p.ativo = TRUE'];
    const params = [];
    if (responsavelId) {
        params.push(responsavelId);
        conditions.push(`p.procurador_responsavel_id = $${params.length}`);
    }
    if (tribunal) {
        params.push(tribunal);
        conditions.push(`p.tribunal = $${params.length}`);
    }
    if (semResponsavel) conditions.push('p.procurador_responsavel_id IS NULL');
    if (semSistema) conditions.push(`(${SEM_SISTEMA_TJMG})`);
    if (etiqueta) {
        params.push(etiqueta);
        conditions.push(etiquetas.condicao('processo', 'p', `$${params.length}`));
    }
    if (situacao) {
        params.push(situacao);
        conditions.push(`p.situacao_fonte = $${params.length}`);
    }
    if (busca) {
        const digitos = String(busca).replace(/\D/g, '');
        params.push(`%${digitos || busca}%`);
        conditions.push(`(p.numero_processo LIKE $${params.length} OR p.classe_nome ILIKE $${params.length} OR p.observacao ILIKE $${params.length})`);
    }
    return { where: conditions.join(' AND '), params };
}

async function list(filtro = {}, { limit = 50, offset = 0 } = {}) {
    const { where, params } = montarFiltro(filtro);
    const [{ rows }, total] = await Promise.all([
        pool.query(
            `SELECT p.*, u.nome AS procurador_nome, ${etiquetas.subconsulta('processo', 'p')} AS etiquetas,
                    (SELECT MAX(m.data_hora) FROM movimentos m WHERE m.processo_id = p.id) AS ultima_movimentacao
             FROM processos p
             LEFT JOIN usuarios u ON u.id = p.procurador_responsavel_id
             WHERE ${where}
             ORDER BY ultima_movimentacao DESC NULLS LAST, p.id DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        ),
        pool.query(`SELECT COUNT(*)::int AS total FROM processos p WHERE ${where}`, params)
    ]);
    return { processos: rows, total: total.rows[0].total };
}

async function listTribunaisEmUso() {
    const { rows } = await pool.query('SELECT DISTINCT tribunal FROM processos ORDER BY tribunal');
    return rows.map((r) => r.tribunal);
}

async function setProcuradorResponsavel(id, procuradorId) {
    const { rows } = await pool.query(
        `UPDATE processos SET procurador_responsavel_id = $1, atualizado_em = NOW()
         WHERE id = $2 RETURNING *`,
        [procuradorId || null, id]
    );
    return rows[0] || null;
}

async function setObservacao(id, observacao) {
    const { rows } = await pool.query('UPDATE processos SET observacao = $1 WHERE id = $2 RETURNING *', [observacao || null, id]);
    return rows[0] || null;
}

async function setSistemaInformado(id, sistema, linkConsultaPublica) {
    const { rows } = await pool.query(
        'UPDATE processos SET sistema_informado = $1, link_consulta_publica = $2, atualizado_em = NOW() WHERE id = $3 RETURNING *',
        [sistema || null, linkConsultaPublica || null, id]
    );
    return rows[0] || null;
}

async function setAtivo(id, ativo) {
    const { rows } = await pool.query('UPDATE processos SET ativo = $1, atualizado_em = NOW() WHERE id = $2 RETURNING *', [ativo, id]);
    return rows[0] || null;
}

async function contarResumo({ diasSemMovimentacao = 60 } = {}) {
    const { rows } = await pool.query(
        `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE procurador_responsavel_id IS NULL)::int AS sem_responsavel,
            COUNT(*) FILTER (WHERE situacao_fonte = 'nao_localizado')::int AS nao_localizados,
            COUNT(*) FILTER (WHERE situacao_fonte = 'aguardando')::int AS aguardando,
            COUNT(*) FILTER (WHERE situacao_fonte = 'localizado' AND ${SEM_SISTEMA_TJMG})::int AS sem_sistema,
            COUNT(*) FILTER (WHERE situacao_fonte = 'localizado' AND COALESCE(
                (SELECT MAX(m.data_hora) FROM movimentos m WHERE m.processo_id = p.id),
                p.data_ajuizamento) < NOW() - ($1 || ' days')::interval)::int AS sem_movimentacao
         FROM processos p WHERE p.ativo = TRUE`,
        [diasSemMovimentacao]
    );
    const r = rows[0];
    return {
        total: r.total,
        semResponsavel: r.sem_responsavel,
        semSistema: r.sem_sistema,
        naoLocalizados: r.nao_localizados,
        aguardando: r.aguardando,
        semMovimentacao: r.sem_movimentacao,
        diasSemMovimentacao
    };
}

module.exports = {
    inserirManual,
    listNumerosExistentes,
    atualizarDadosFonte,
    marcarConsulta,
    listAtivosParaSync,
    setFonteMovimentos,
    listPorIds,
    findById,
    findByNumero,
    list,
    listTribunaisEmUso,
    setProcuradorResponsavel,
    setObservacao,
    setSistemaInformado,
    setAtivo,
    contarResumo
};
