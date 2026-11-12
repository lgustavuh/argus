const banco = require('./helpers/banco'); // antes de src/ (define DATABASE_URL)

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db/pool');
const limite = require('../src/middleware/limiteLogin');

const req = (ip) => ({ ip });

describe('limite de login no banco (MEL-12, integração)', { skip: banco.motivoPulo }, () => {
    before(banco.resetar);
    after(banco.encerrar);

    test('5 erros para o mesmo e-mail bloqueiam por ~15 minutos; acerto antes disso zera', async () => {
        const r = req('10.0.0.1');
        for (let i = 0; i < limite.MAX_FALHAS - 1; i++) await limite.registrarFalha(r, 'a@x.local');
        assert.equal(await limite.minutosBloqueado(r, 'a@x.local'), 0);
        await limite.registrarSucesso(r, 'a@x.local');
        await limite.registrarFalha(r, 'a@x.local');
        assert.equal(await limite.minutosBloqueado(r, 'a@x.local'), 0, 'o acerto zerou a contagem do e-mail');

        for (let i = 0; i < limite.MAX_FALHAS; i++) await limite.registrarFalha(r, 'B@X.local ');
        const minutos = await limite.minutosBloqueado(req('10.9.9.9'), 'b@x.local');
        assert.ok(minutos >= 14 && minutos <= 15, `bloqueio do e-mail vale de qualquer IP (${minutos})`);
    });

    test('o bloqueio sobrevive a reinício (está no banco, não na memória)', async () => {
        delete require.cache[require.resolve('../src/middleware/limiteLogin')];
        const recarregado = require('../src/middleware/limiteLogin');
        assert.ok((await recarregado.minutosBloqueado(req('10.9.9.9'), 'b@x.local')) > 0);
    });

    test('20 erros do mesmo IP bloqueiam o IP para qualquer e-mail', async () => {
        const r = req('10.0.0.2');
        for (let i = 0; i < limite.MAX_FALHAS_IP; i++) await limite.registrarFalha(r, `u${i}@x.local`);
        assert.ok((await limite.minutosBloqueado(r, 'outro@x.local')) > 0);
        assert.equal(await limite.minutosBloqueado(req('10.0.0.3'), 'outro@x.local'), 0);
    });

    test('janela vencida recomeça a contagem', async () => {
        const r = req('10.0.0.4');
        for (let i = 0; i < limite.MAX_FALHAS - 1; i++) await limite.registrarFalha(r, 'c@x.local');
        await pool.query(`UPDATE limite_login SET primeira_falha = NOW() - INTERVAL '20 minutes' WHERE chave = 'email:c@x.local'`);
        await limite.registrarFalha(r, 'c@x.local');
        assert.equal(await limite.minutosBloqueado(r, 'c@x.local'), 0);
        const { rows } = await pool.query(`SELECT falhas FROM limite_login WHERE chave = 'email:c@x.local'`);
        assert.equal(rows[0].falhas, 1);
    });
});
