const pool = require('../db/pool');
// Acessado como `mailer.enviarEmail` (e nao desestruturado) para que os testes possam substitui-lo.
const mailer = require('./mailer');

/**
 * Fila de saida de e-mails (PRD MEL-11 / BUG-03).
 *
 * Quem precisa avisar alguem chama `enfileirar` (um INSERT, rapido) e segue; o scheduler chama
 * `processar` a cada minuto. Assim o sync nao fica preso a um SMTP lento, e uma falha de envio
 * nao some no log: o e-mail volta para a fila com espera crescente e, esgotadas as tentativas,
 * fica como "falhou" em Configuracoes > E-mail, de onde pode ser reenviado.
 */

// Espera antes de cada nova tentativa (minutos). Esgotada a lista, o e-mail fica como "falhou".
const ESPERAS_MIN = [5, 15, 60, 180, 360];
const MAX_TENTATIVAS = ESPERAS_MIN.length + 1;
// "enviando" ha mais tempo que isso = o processo caiu no meio do envio: volta para a fila.
const TRAVADO_MIN = 15;
// Retencao (LGPD): o corpo dos e-mails tem numeros de processo; enviados antigos sao apagados.
const RETENCAO_ENVIADOS_DIAS = 90;

async function enfileirar({ to, subject, html, text }, { tipo, referencia = null }) {
    const { rows } = await pool.query(
        `INSERT INTO emails_saida (para, assunto, html, texto, tipo, referencia)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [to, subject, html || null, text || null, tipo, referencia]
    );
    return rows[0].id;
}

/**
 * Reserva um lote: `FOR UPDATE SKIP LOCKED` + status 'enviando' garante que duas execucoes
 * simultaneas nunca peguem o mesmo e-mail (nenhum e-mail sai duplicado).
 */
async function reservarLote(limite) {
    const { rows } = await pool.query(
        `UPDATE emails_saida SET status = 'enviando', atualizado_em = NOW()
         WHERE id IN (
             SELECT id FROM emails_saida
             WHERE status = 'pendente' AND proxima_tentativa_em <= NOW()
             ORDER BY id
             LIMIT $1
             FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [limite]
    );
    return rows;
}

async function registrarResultado(email, resultado) {
    if (resultado.ok) {
        await pool.query(
            `UPDATE emails_saida SET status = 'enviado', enviado_em = NOW(), tentativas = tentativas + 1,
                    ultimo_erro = NULL, atualizado_em = NOW() WHERE id = $1`,
            [email.id]
        );
        return 'enviado';
    }
    // E-mail desativado em Configuracoes: nao adianta insistir. O alerta continua no sistema.
    if (resultado.desativado) {
        await pool.query(
            `UPDATE emails_saida SET status = 'descartado', ultimo_erro = $2, atualizado_em = NOW() WHERE id = $1`,
            [email.id, resultado.motivo || 'E-mail desativado']
        );
        return 'descartado';
    }
    const tentativas = email.tentativas + 1;
    const esgotou = tentativas >= MAX_TENTATIVAS;
    await pool.query(
        `UPDATE emails_saida SET status = $2, tentativas = $3, ultimo_erro = $4, atualizado_em = NOW(),
                proxima_tentativa_em = NOW() + ($5 || ' minutes')::interval
         WHERE id = $1`,
        [email.id, esgotou ? 'falhou' : 'pendente', tentativas, String(resultado.motivo || 'falha desconhecida').slice(0, 500), esgotou ? 0 : ESPERAS_MIN[tentativas - 1]]
    );
    return esgotou ? 'falhou' : 'reagendado';
}

let processando = false;

/**
 * Envia o que estiver na vez. Nunca lanca erro por causa de um e-mail: cada um e tratado isolado.
 * @returns {Promise<{enviados:number, reagendados:number, falharam:number, descartados:number}>}
 */
async function processar({ limite = 50 } = {}) {
    const resumo = { enviados: 0, reagendados: 0, falharam: 0, descartados: 0 };
    if (processando) return resumo;
    processando = true;
    try {
        await pool.query(
            `UPDATE emails_saida SET status = 'pendente', atualizado_em = NOW()
             WHERE status = 'enviando' AND atualizado_em < NOW() - ($1 || ' minutes')::interval`,
            [TRAVADO_MIN]
        );
        for (const email of await reservarLote(limite)) {
            let resultado;
            try {
                resultado = await mailer.enviarEmail({ to: email.para, subject: email.assunto, html: email.html, text: email.texto });
            } catch (err) {
                resultado = { ok: false, motivo: err.message };
            }
            const desfecho = await registrarResultado(email, resultado);
            if (desfecho === 'enviado') resumo.enviados += 1;
            else if (desfecho === 'reagendado') resumo.reagendados += 1;
            else if (desfecho === 'falhou') resumo.falharam += 1;
            else resumo.descartados += 1;
        }
        await pool.query(
            `DELETE FROM emails_saida WHERE status = 'enviado' AND enviado_em < NOW() - ($1 || ' days')::interval`,
            [RETENCAO_ENVIADOS_DIAS]
        );
    } finally {
        processando = false;
    }
    return resumo;
}

/** Volta um e-mail que falhou (ou foi descartado) para a fila, como se fosse novo. */
async function reenviar(id) {
    const { rows } = await pool.query(
        `UPDATE emails_saida SET status = 'pendente', tentativas = 0, proxima_tentativa_em = NOW(), atualizado_em = NOW()
         WHERE id = $1 AND status IN ('falhou', 'descartado') RETURNING id`,
        [id]
    );
    return rows.length > 0;
}

async function reenviarTodosQueFalharam() {
    const { rowCount } = await pool.query(
        `UPDATE emails_saida SET status = 'pendente', tentativas = 0, proxima_tentativa_em = NOW(), atualizado_em = NOW()
         WHERE status = 'falhou'`
    );
    return rowCount;
}

/** Para a tela: e-mails que precisam de atencao (falharam ou ainda tentando), mais recentes primeiro. */
async function listarProblemas({ limite = 50 } = {}) {
    const { rows } = await pool.query(
        `SELECT id, para, assunto, tipo, referencia, status, tentativas, ultimo_erro, proxima_tentativa_em, criado_em
         FROM emails_saida
         WHERE status = 'falhou' OR (status = 'pendente' AND tentativas > 0)
         ORDER BY criado_em DESC
         LIMIT $1`,
        [limite]
    );
    return rows;
}

async function contarPorStatus() {
    const { rows } = await pool.query('SELECT status, COUNT(*)::int AS n FROM emails_saida GROUP BY status');
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

module.exports = {
    enfileirar,
    processar,
    reenviar,
    reenviarTodosQueFalharam,
    listarProblemas,
    contarPorStatus,
    MAX_TENTATIVAS
};
