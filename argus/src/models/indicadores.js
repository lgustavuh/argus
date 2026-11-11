const pool = require('../db/pool');

// Dia (em Brasilia) de um TIMESTAMP gravado em UTC.
const DIA_SP = (coluna) => `((${coluna} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date`;

/**
 * Prazos (compromissos do tipo prazo) com data fatal no periodo [inicio, hoje]: cumpridos ate a data,
 * concluidos depois dela, ainda em aberto e vencidos, cancelados. Mais os em aberto com data futura.
 */
async function prazos(inicio, hoje) {
    const { rows } = await pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE status = 'concluido' AND ${DIA_SP('concluido_em')} <= data AND data BETWEEN $1 AND $2)::int AS no_prazo,
            COUNT(*) FILTER (WHERE status = 'concluido' AND ${DIA_SP('concluido_em')} > data AND data BETWEEN $1 AND $2)::int AS apos_prazo,
            COUNT(*) FILTER (WHERE status = 'aberto' AND data < $2)::int AS vencidos_abertos,
            COUNT(*) FILTER (WHERE status = 'aberto' AND data >= $2)::int AS a_vencer,
            COUNT(*) FILTER (WHERE status = 'cancelado' AND data BETWEEN $1 AND $2)::int AS cancelados
         FROM compromissos WHERE tipo = 'prazo'`,
        [inicio, hoje]
    );
    return rows[0];
}

/**
 * Alertas criados desde `inicio`: quantos, quantos com ciencia, quantos escalaram e a mediana do
 * tempo ate a ciencia (em horas).
 */
async function alertas(inicioTs) {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS criados,
                COUNT(*) FILTER (WHERE status = 'ciente')::int AS com_ciencia,
                COUNT(*) FILTER (WHERE escalado_em IS NOT NULL)::int AS escalados,
                COUNT(*) FILTER (WHERE status <> 'ciente')::int AS sem_ciencia,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ciente_em - criado_em)) / 3600)
                    FILTER (WHERE ciente_em IS NOT NULL) AS mediana_horas
         FROM alertas WHERE criado_em >= $1`,
        [inicioTs]
    );
    return rows[0];
}

async function processosPor(coluna, limite = 10) {
    const expr = {
        classe: "COALESCE(NULLIF(p.classe_nome, ''), 'Classe não informada')",
        orgao: "COALESCE(NULLIF(p.orgao_julgador, ''), 'Órgão não informado')",
        responsavel: "COALESCE(u.nome, 'Sem responsável')"
    }[coluna];
    const { rows } = await pool.query(
        `SELECT ${expr} AS rotulo, COUNT(*)::int AS total
         FROM processos p LEFT JOIN usuarios u ON u.id = p.procurador_responsavel_id
         WHERE p.ativo = TRUE GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT $1`,
        [limite]
    );
    return rows;
}

// Movimentacoes que podem abrir prazo, por mes (ultimos 12 meses, incluindo meses zerados).
async function movimentosRelevantesPorMes(hoje) {
    const { rows } = await pool.query(
        `WITH meses AS (
             SELECT generate_series(date_trunc('month', $1::date) - interval '11 months', date_trunc('month', $1::date), interval '1 month')::date AS mes
         )
         SELECT to_char(m.mes, 'YYYY-MM') AS mes, COUNT(mv.id)::int AS total
         FROM meses m
         LEFT JOIN movimentos mv ON mv.relevante_para_prazo = TRUE
              AND date_trunc('month', ${DIA_SP('mv.data_hora')}) = m.mes
         GROUP BY m.mes ORDER BY m.mes`,
        [hoje]
    );
    return rows;
}

// Agenda em aberto por responsavel: total e quantos ja vencidos.
async function agendaPorResponsavel(hoje) {
    const { rows } = await pool.query(
        `SELECT COALESCE(u.nome, 'Sem responsável') AS rotulo,
                COUNT(*)::int AS abertos,
                COUNT(*) FILTER (WHERE c.data < $1)::int AS vencidos,
                COUNT(*) FILTER (WHERE c.data BETWEEN $1 AND $1::date + 7)::int AS proximos_7
         FROM compromissos c LEFT JOIN usuarios u ON u.id = c.responsavel_id
         WHERE c.status = 'aberto' GROUP BY 1 ORDER BY 3 DESC, 2 DESC, 1`,
        [hoje]
    );
    return rows;
}

module.exports = { prazos, alertas, processosPor, movimentosRelevantesPorMes, agendaPorResponsavel };
