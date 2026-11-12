const banco = require('./helpers/banco'); // antes de src/ (define DATABASE_URL)

const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-so-para-teste-'.repeat(3);

const bcrypt = require('bcryptjs');
const pool = require('../src/db/pool');
const app = require('../src/app');
const usuariosModel = require('../src/models/usuarios');
const processosModel = require('../src/models/processos');
const configuracoes = require('../src/services/configuracoes');
const { enviarResumosDiarios } = require('../src/services/agenda');
const { gerarToken } = require('../src/middleware/auth');

let servidor;
let base;
const SENHA = 'Senha-Forte-123!';

async function criar(papel, extra = {}) {
    const u = await usuariosModel.create({
        nome: `API ${papel} ${extra.sufixo || ''}`.trim(),
        email: `${papel}${extra.sufixo || ''}@api.local`,
        senhaHash: await bcrypt.hash(SENHA, 4),
        papel
    });
    if (extra.inativo) await usuariosModel.setAtivo(u.id, false);
    const completo = await usuariosModel.findById(u.id);
    return { ...completo, token: gerarToken(completo) };
}

function api(caminho, { token, method = 'GET', body, headers = {} } = {}) {
    return fetch(base + caminho, {
        method,
        redirect: 'manual',
        headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...headers
        },
        body: body ? JSON.stringify(body) : undefined
    });
}

describe('API e autenticação: BUG-05 a BUG-13 (integração)', { skip: banco.motivoPulo }, () => {
    const u = {};

    before(async () => {
        await banco.resetar();
        servidor = app.listen(0, '127.0.0.1');
        await new Promise((r) => servidor.once('listening', r));
        base = `http://127.0.0.1:${servidor.address().port}`;
    });
    after(async () => {
        mock.restoreAll();
        servidor?.close();
        await banco.encerrar();
    });

    // Precisa do banco sem usuarios: roda primeiro.
    test('BUG-11: dois /setup simultâneos criam um admin só', async () => {
        const hash = await bcrypt.hash(SENHA, 4);
        const criados = await Promise.all(
            [1, 2, 3].map((i) => usuariosModel.criarPrimeiroAdmin({ nome: `Admin ${i}`, email: `admin${i}@api.local`, senhaHash: hash }))
        );
        assert.equal(criados.filter(Boolean).length, 1);
        const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
        assert.equal(rows[0].n, 1);

        u.procurador = await criar('procurador');
        u.advogado = await criar('advogado');
        u.assistente = await criar('assistente_juridico');
        u.advogadoInativo = await criar('advogado', { sufixo: '2', inativo: true });
        u.admin = await criar('admin', { sufixo: 'x' });
    });

    test('BUG-05: login da API compara a senha mesmo com e-mail inexistente', async () => {
        const compare = mock.method(bcrypt, 'compare');
        const r = await api('/api/auth/login', { method: 'POST', body: { email: 'ninguem@api.local', senha: 'qualquer' } });
        assert.equal(r.status, 401);
        assert.equal(compare.mock.callCount(), 1, 'bcrypt.compare roda também para e-mail inexistente');
        compare.mock.restore();

        const ok = await api('/api/auth/login', { method: 'POST', body: { email: 'procurador@api.local', senha: SENHA } });
        assert.equal(ok.status, 200);
        assert.ok((await ok.json()).token);
    });

    test('BUG-06: responsável só pode ser procurador/advogado ativo (API e tela)', async () => {
        const p = await processosModel.inserirManual({ numeroProcesso: '00000010020268130529', tribunal: 'tjmg' });
        const patch = (responsavelId) => api(`/api/processos/${p.id}`, { token: u.procurador.token, method: 'PATCH', body: { responsavelId } });

        assert.equal((await patch(u.assistente.id)).status, 400, 'assistente não');
        assert.equal((await patch(u.advogadoInativo.id)).status, 400, 'inativo não');
        assert.equal((await patch(u.admin.id)).status, 400, 'admin não');
        assert.equal((await patch(999999)).status, 400, 'id inexistente: 400, não 500');
        assert.equal((await patch('abc')).status, 400);
        const ok = await patch(u.advogado.id);
        assert.equal(ok.status, 200);
        assert.equal((await ok.json()).procurador_responsavel_id, u.advogado.id);
        assert.equal((await patch(null)).status, 200, 'null remove o responsável');

        const tela = await fetch(`${base}/processos/${p.id}/responsavel`, {
            method: 'POST',
            redirect: 'manual',
            headers: { cookie: `token=${u.procurador.token}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ responsavelId: String(u.assistente.id) }).toString()
        });
        assert.equal(tela.status, 302);
        assert.match(decodeURIComponent(tela.headers.get('location')), /Responsável inválido/);
        assert.equal((await processosModel.findById(p.id)).procurador_responsavel_id, null);
    });

    test('BUG-07: id não numérico na API responde 404, não 500', async () => {
        for (const caminho of ['/api/processos/abc', '/api/alertas/abc']) {
            const r = await api(caminho, { token: u.procurador.token });
            assert.equal(r.status, 404, caminho);
        }
        const r = await api('/api/alertas/abc/ciencia', { token: u.procurador.token, method: 'PATCH' });
        assert.equal(r.status, 404);
    });

    test('BUG-08: só e-mail repetido vira 409; outro erro vira 500', async () => {
        const novo = { nome: 'Fulano', email: 'fulano@api.local', senha: SENHA, papel: 'advogado' };
        assert.equal((await api('/api/usuarios', { token: u.admin.token, method: 'POST', body: novo })).status, 201);
        assert.equal((await api('/api/usuarios', { token: u.admin.token, method: 'POST', body: novo })).status, 409);

        mock.method(usuariosModel, 'create', async () => { throw new Error('banco fora do ar'); });
        mock.method(console, 'error', () => {});
        const r = await api('/api/usuarios', { token: u.admin.token, method: 'POST', body: { ...novo, email: 'outro@api.local' } });
        assert.equal(r.status, 500);
        mock.restoreAll();
    });

    test('BUG-09: sync pela API responde 202 na hora; andamento em /api/sync/status', async () => {
        mock.method(console, 'error', () => {});
        mock.method(console, 'log', () => {});
        const r = await api('/api/sync/run', { token: u.procurador.token, method: 'POST' });
        assert.equal(r.status, 202);
        const status = await api('/api/sync/status', { token: u.procurador.token });
        assert.equal(status.status, 200);
        assert.ok('emAndamento' in (await status.json()));
        // Espera o sync em segundo plano terminar antes do proximo teste.
        for (let i = 0; i < 100 && (await (await api('/api/sync/status', { token: u.procurador.token })).json()).emAndamento; i++) {
            await new Promise((res) => setTimeout(res, 50));
        }
        mock.restoreAll();
    });

    test('BUG-10: logout é POST e invalida o token já emitido', async () => {
        const token = u.advogado.token;
        assert.equal((await api('/api/alertas', { token })).status, 200);

        // GET /logout nao derruba a sessao (poderia vir de um link/imagem de outro site).
        const get = await fetch(`${base}/logout`, { redirect: 'manual', headers: { cookie: `token=${token}` } });
        assert.equal(get.status, 302);
        assert.equal((await api('/api/alertas', { token })).status, 200);

        const post = await fetch(`${base}/logout`, {
            method: 'POST',
            redirect: 'manual',
            headers: { cookie: `token=${token}`, 'sec-fetch-site': 'same-origin' }
        });
        assert.equal(post.status, 302);
        assert.equal(post.headers.get('location'), '/login');
        assert.equal((await api('/api/alertas', { token })).status, 401, 'token copiado antes do logout não vale mais');
    });

    test('BUG-13: sem procurador ativo, compromisso sem responsável vai para o e-mail geral', async () => {
        await usuariosModel.setAtivo(u.procurador.id, false);
        await configuracoes.salvar({ 'email.fallback': 'procuradoria@api.local' });
        await pool.query(`INSERT INTO compromissos (tipo, titulo, data) VALUES ('prazo', 'Prazo sem dono', CURRENT_DATE)`);

        await enviarResumosDiarios({ forcar: true });
        const { rows } = await pool.query(`SELECT para FROM emails_saida WHERE tipo = 'agenda_resumo'`);
        assert.deepEqual(rows.map((r) => r.para), ['procuradoria@api.local']);

        // Sem e-mail geral: vai para os admins.
        await pool.query('DELETE FROM emails_saida');
        await configuracoes.salvar({ 'email.fallback': '' });
        await enviarResumosDiarios({ forcar: true });
        const { rows: admins } = await pool.query(`SELECT para FROM emails_saida WHERE tipo = 'agenda_resumo' ORDER BY para`);
        const esperados = (await usuariosModel.listAtivosPorPapeis(['admin'])).map((x) => x.email).sort();
        assert.deepEqual(admins.map((r) => r.para), esperados);
    });
});
