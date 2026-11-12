const pool = require('../db/pool');

/**
 * Protecao contra tentativa de senha por forca bruta: depois de MAX_FALHAS erros para o mesmo
 * e-mail (ou MAX_FALHAS_IP do mesmo IP) dentro da janela, novas tentativas ficam bloqueadas por
 * BLOQUEIO_MIN. Guardado no banco (PRD MEL-12): reiniciar o container nao zera os bloqueios.
 */
const MAX_FALHAS = 5;
const MAX_FALHAS_IP = 20;
const JANELA_MIN = 15;
const BLOQUEIO_MIN = 15;

function chaves(req, email) {
    return [`email:${String(email || '').toLowerCase().trim()}`.slice(0, 250), `ip:${req.ip}`.slice(0, 250)];
}

/**
 * @returns {Promise<number>} minutos restantes de bloqueio (0 = liberado)
 */
async function minutosBloqueado(req, email) {
    const { rows } = await pool.query(
        `SELECT CEIL(EXTRACT(EPOCH FROM MAX(bloqueado_ate) - NOW()) / 60)::int AS minutos
         FROM limite_login WHERE chave = ANY($1) AND bloqueado_ate > NOW()`,
        [chaves(req, email)]
    );
    return Math.max(0, rows[0].minutos || 0);
}

// Janela vencida e sem bloqueio vigente: a contagem recomeca. Texto constante (sem dado externo).
const EXPIROU = `(limite_login.primeira_falha < NOW() - INTERVAL '${JANELA_MIN} minutes'
    AND COALESCE(limite_login.bloqueado_ate, '-infinity') < NOW())`;
const FALHAS_NOVAS = `(CASE WHEN ${EXPIROU} THEN 1 ELSE limite_login.falhas + 1 END)`;

const SQL_FALHA = `
    INSERT INTO limite_login (chave, falhas, primeira_falha, bloqueado_ate)
    VALUES ($1, 1, NOW(), CASE WHEN 1 >= $2 THEN NOW() + ($3 || ' minutes')::interval END)
    ON CONFLICT (chave) DO UPDATE SET
        falhas = ${FALHAS_NOVAS},
        primeira_falha = CASE WHEN ${EXPIROU} THEN NOW() ELSE limite_login.primeira_falha END,
        bloqueado_ate = CASE WHEN ${FALHAS_NOVAS} >= $2 THEN NOW() + ($3 || ' minutes')::interval
                             ELSE limite_login.bloqueado_ate END`;

async function registrarFalha(req, email) {
    const [chaveEmail, chaveIp] = chaves(req, email);
    for (const [chave, limite] of [[chaveEmail, MAX_FALHAS], [chaveIp, MAX_FALHAS_IP]]) {
        await pool.query(SQL_FALHA, [chave, limite, String(BLOQUEIO_MIN)]);
    }
    // Faxina: registros vencidos ha mais de um dia (a tabela continua pequena).
    await pool.query(
        `DELETE FROM limite_login WHERE primeira_falha < NOW() - INTERVAL '1 day' AND COALESCE(bloqueado_ate, '-infinity') < NOW()`
    );
}

async function registrarSucesso(req, email) {
    await pool.query('DELETE FROM limite_login WHERE chave = $1', [chaves(req, email)[0]]);
}

module.exports = { minutosBloqueado, registrarFalha, registrarSucesso, MAX_FALHAS, MAX_FALHAS_IP };
