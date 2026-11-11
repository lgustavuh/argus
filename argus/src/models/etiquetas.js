const pool = require('../db/pool');

const MAX_NOME = 40;
const MAX_POR_ITEM = 10;

/**
 * "saúde, Execução fiscal ,saúde" -> ['saúde', 'Execução fiscal'] (sem repetidas, ignorando
 * maiúsculas; espacos internos normalizados).
 */
function normalizarLista(texto) {
    const vistos = new Set();
    const nomes = [];
    for (const bruto of String(texto || '').split(/[,;\n]/)) {
        const nome = bruto.replace(/\s+/g, ' ').trim().slice(0, MAX_NOME);
        if (!nome || vistos.has(nome.toLowerCase())) continue;
        vistos.add(nome.toLowerCase());
        nomes.push(nome);
    }
    return nomes.slice(0, MAX_POR_ITEM);
}

// Etiqueta ja existente (com outra grafia de maiusculas) e reaproveitada.
async function garantir(client, nomes) {
    const ids = [];
    for (const nome of nomes) {
        const { rows } = await client.query(
            `WITH nova AS (
                 INSERT INTO etiquetas (nome) VALUES ($1) ON CONFLICT ((lower(nome))) DO NOTHING RETURNING id
             )
             SELECT id FROM nova UNION ALL SELECT id FROM etiquetas WHERE lower(nome) = lower($1) LIMIT 1`,
            [nome]
        );
        ids.push(rows[0].id);
    }
    return ids;
}

const TABELAS = {
    processo: { tabela: 'processo_etiquetas', coluna: 'processo_id' },
    caso: { tabela: 'caso_etiquetas', coluna: 'caso_id' }
};

/**
 * Substitui as etiquetas de um processo/caso. Devolve os nomes gravados.
 */
async function definir(tipo, id, texto) {
    const { tabela, coluna } = TABELAS[tipo];
    const nomes = normalizarLista(texto);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const ids = await garantir(client, nomes);
        await client.query(`DELETE FROM ${tabela} WHERE ${coluna} = $1`, [id]);
        for (const etiquetaId of ids) {
            await client.query(`INSERT INTO ${tabela} (${coluna}, etiqueta_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, etiquetaId]);
        }
        // Etiquetas que ficaram sem uso somem da lista de sugestoes.
        await client.query(
            `DELETE FROM etiquetas e WHERE NOT EXISTS (SELECT 1 FROM processo_etiquetas WHERE etiqueta_id = e.id)
                                     AND NOT EXISTS (SELECT 1 FROM caso_etiquetas WHERE etiqueta_id = e.id)`
        );
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
    return nomes;
}

async function listDe(tipo, id) {
    const { tabela, coluna } = TABELAS[tipo];
    const { rows } = await pool.query(
        `SELECT e.nome FROM ${tabela} x JOIN etiquetas e ON e.id = x.etiqueta_id WHERE x.${coluna} = $1 ORDER BY lower(e.nome)`,
        [id]
    );
    return rows.map((r) => r.nome);
}

async function listAll() {
    const { rows } = await pool.query(
        `SELECT e.id, e.nome,
                (SELECT COUNT(*)::int FROM processo_etiquetas WHERE etiqueta_id = e.id) AS processos,
                (SELECT COUNT(*)::int FROM caso_etiquetas WHERE etiqueta_id = e.id) AS casos
         FROM etiquetas e ORDER BY lower(e.nome)`
    );
    return rows;
}

// Trecho de SELECT que traz as etiquetas de cada linha como array de nomes.
function subconsulta(tipo, aliasLinha) {
    const { tabela, coluna } = TABELAS[tipo];
    return `(SELECT COALESCE(array_agg(e.nome ORDER BY lower(e.nome)), '{}') FROM ${tabela} x JOIN etiquetas e ON e.id = x.etiqueta_id WHERE x.${coluna} = ${aliasLinha}.id)`;
}

// Condicao WHERE "tem a etiqueta $n" (por nome, sem diferenciar maiusculas).
function condicao(tipo, aliasLinha, param) {
    const { tabela, coluna } = TABELAS[tipo];
    return `EXISTS (SELECT 1 FROM ${tabela} x JOIN etiquetas e ON e.id = x.etiqueta_id WHERE x.${coluna} = ${aliasLinha}.id AND lower(e.nome) = lower(${param}))`;
}

module.exports = { normalizarLista, definir, listDe, listAll, subconsulta, condicao, MAX_POR_ITEM };
