const banco = require('./helpers/banco'); // antes de src/ (define DATABASE_URL)

const { test, describe, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db/pool');
const mailer = require('../src/services/mailer');
const outbox = require('../src/services/outbox');

const MSG = { to: 'proc@teste.local', subject: 'Alerta', html: '<p>oi</p>', text: 'oi' };

async function estado(id) {
    const { rows } = await pool.query('SELECT status, tentativas, ultimo_erro, proxima_tentativa_em > NOW() AS futuro FROM emails_saida WHERE id = $1', [id]);
    return rows[0];
}

// Faz o e-mail "vencer" a espera, como se o tempo tivesse passado.
const vencerEspera = (id) => pool.query(`UPDATE emails_saida SET proxima_tentativa_em = NOW() - INTERVAL '1 second' WHERE id = $1`, [id]);

describe('fila de e-mails (MEL-11 / BUG-03, integração)', { skip: banco.motivoPulo }, () => {
    before(banco.resetar);
    after(banco.encerrar);
    beforeEach(async () => {
        mock.restoreAll();
        mock.method(console, 'error', () => {});
        await pool.query('DELETE FROM emails_saida');
    });

    test('envio com sucesso marca como enviado', async () => {
        const envio = mock.method(mailer, 'enviarEmail', async () => ({ ok: true }));
        const id = await outbox.enfileirar(MSG, { tipo: 'alerta_novo', referencia: 'alerta:1' });
        const r = await outbox.processar();
        assert.equal(r.enviados, 1);
        assert.equal((await estado(id)).status, 'enviado');
        assert.equal(envio.mock.calls[0].arguments[0].to, MSG.to);
    });

    test('falha de SMTP: volta para a fila com espera, sem perder o e-mail', async () => {
        mock.method(mailer, 'enviarEmail', async () => ({ ok: false, motivo: 'SMTP fora do ar' }));
        const id = await outbox.enfileirar(MSG, { tipo: 'alerta_novo' });
        const r = await outbox.processar();
        assert.equal(r.reagendados, 1);
        const e = await estado(id);
        assert.equal(e.status, 'pendente');
        assert.equal(e.tentativas, 1);
        assert.equal(e.ultimo_erro, 'SMTP fora do ar');
        assert.equal(e.futuro, true, 'só tenta de novo depois da espera');

        // Antes da espera vencer, nada sai.
        assert.equal((await outbox.processar()).reagendados, 0);
    });

    test('erro lançado pelo envio também é tratado como falha', async () => {
        mock.method(mailer, 'enviarEmail', async () => { throw new Error('conexão recusada'); });
        const id = await outbox.enfileirar(MSG, { tipo: 'alerta_novo' });
        await outbox.processar();
        assert.equal((await estado(id)).ultimo_erro, 'conexão recusada');
    });

    test('esgotadas as tentativas fica "falhou" e pode ser reenviado', async () => {
        mock.method(mailer, 'enviarEmail', async () => ({ ok: false, motivo: 'caixa cheia' }));
        const id = await outbox.enfileirar(MSG, { tipo: 'alerta_novo' });
        for (let i = 0; i < outbox.MAX_TENTATIVAS; i++) {
            await vencerEspera(id);
            await outbox.processar();
        }
        assert.equal((await estado(id)).status, 'falhou');
        assert.equal((await outbox.listarProblemas()).length, 1);

        mock.method(mailer, 'enviarEmail', async () => ({ ok: true }));
        assert.equal(await outbox.reenviar(id), true);
        await outbox.processar();
        assert.equal((await estado(id)).status, 'enviado');
        assert.equal(await outbox.reenviar(id), false, 'e-mail enviado não volta para a fila');
    });

    test('e-mail desativado: descarta em vez de insistir', async () => {
        mock.method(mailer, 'enviarEmail', async () => ({ ok: false, desativado: true, motivo: 'E-mail desativado' }));
        const id = await outbox.enfileirar(MSG, { tipo: 'alerta_novo' });
        const r = await outbox.processar();
        assert.equal(r.descartados, 1);
        assert.equal((await estado(id)).status, 'descartado');
    });

    test('execuções simultâneas não enviam o mesmo e-mail duas vezes', async () => {
        const envio = mock.method(mailer, 'enviarEmail', async () => {
            await new Promise((r) => setTimeout(r, 20));
            return { ok: true };
        });
        for (let i = 0; i < 5; i++) await outbox.enfileirar({ ...MSG, to: `p${i}@teste.local` }, { tipo: 'alerta_novo' });
        await Promise.all([outbox.processar(), outbox.processar(), outbox.processar()]);
        await outbox.processar();
        assert.equal(envio.mock.callCount(), 5);
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM emails_saida WHERE status = 'enviado'`);
        assert.equal(rows[0].n, 5);
    });

    test('e-mail preso em "enviando" (processo caiu) volta para a fila', async () => {
        mock.method(mailer, 'enviarEmail', async () => ({ ok: true }));
        const id = await outbox.enfileirar(MSG, { tipo: 'alerta_novo' });
        await pool.query(`UPDATE emails_saida SET status = 'enviando', atualizado_em = NOW() - INTERVAL '1 hour' WHERE id = $1`, [id]);
        await outbox.processar();
        assert.equal((await estado(id)).status, 'enviado');
    });

    test('retenção: enviados com mais de 90 dias são apagados', async () => {
        mock.method(mailer, 'enviarEmail', async () => ({ ok: true }));
        const id = await outbox.enfileirar(MSG, { tipo: 'alerta_novo' });
        await pool.query(`UPDATE emails_saida SET status = 'enviado', enviado_em = NOW() - INTERVAL '91 days' WHERE id = $1`, [id]);
        await outbox.processar();
        assert.equal(await estado(id), undefined);
    });
});
