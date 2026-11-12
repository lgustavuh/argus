const banco = require('./helpers/banco'); // antes de src/ (define DATABASE_URL)

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-so-para-teste-'.repeat(3);

const pool = require('../src/db/pool');
const app = require('../src/app');
const usuariosModel = require('../src/models/usuarios');
const processosModel = require('../src/models/processos');
const { gerarToken } = require('../src/middleware/auth');

let servidor;
let base;
const sessao = {};

async function criarUsuario(papel) {
    const u = await usuariosModel.create({ nome: `Teste ${papel}`, email: `${papel}@telas.local`, senhaHash: 'x', papel });
    const completo = await usuariosModel.findById(u.id);
    return `token=${gerarToken(completo)}`;
}

function pedir(caminho, papel, opcoes = {}) {
    return fetch(base + caminho, {
        redirect: 'manual',
        ...opcoes,
        headers: { cookie: sessao[papel], 'sec-fetch-site': 'same-origin', ...(opcoes.headers || {}) }
    });
}

async function novoAlerta(sistema) {
    const numero = `${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}0020268130529`;
    const p = await processosModel.inserirManual({ numeroProcesso: numero, tribunal: 'tjmg' });
    await pool.query('UPDATE processos SET sistema = $1, grau = $2 WHERE id = $3', [sistema, 'G1', p.id]);
    const { rows: [m] } = await pool.query(
        `INSERT INTO movimentos (processo_id, codigo_tpu, nome, data_hora, relevante_para_prazo, hash_dedup)
         VALUES ($1, 12265, 'Intimação', NOW(), TRUE, md5(random()::text) || md5(random()::text)) RETURNING id`,
        [p.id]
    );
    const { rows: [al] } = await pool.query('INSERT INTO alertas (processo_id, movimento_id) VALUES ($1, $2) RETURNING id', [p.id, m.id]);
    await pool.query('UPDATE movimentos SET alerta_id = $1 WHERE id = $2', [al.id, m.id]);
    return { processoId: p.id, alertaId: al.id };
}

describe('telas: botão "Abrir no PJe/eproc" (MEL-16, integração)', { skip: banco.motivoPulo }, () => {
    before(async () => {
        await banco.resetar();
        sessao.procurador = await criarUsuario('procurador');
        sessao.assistente_juridico = await criarUsuario('assistente_juridico');
        sessao.admin = await criarUsuario('admin');
        servidor = app.listen(0, '127.0.0.1');
        await new Promise((r) => servidor.once('listening', r));
        base = `http://127.0.0.1:${servidor.address().port}`;
    });
    after(async () => {
        servidor?.close();
        await banco.encerrar();
    });

    test('sistema conhecido: um botão só, direto para o PJe', async () => {
        const { alertaId } = await novoAlerta('PJe');
        const html = await (await pedir(`/alertas/${alertaId}`, 'procurador')).text();
        assert.match(html, /Abrir no PJe/);
        assert.doesNotMatch(html, /Abrir no eproc/);
        assert.doesNotMatch(html, /Tramita no PJe/);
        assert.match(html, /Estou ciente \(só no Argus\)/);
    });

    test('sistema desconhecido: PJe e eproc, e o procurador pode informar o sistema', async () => {
        const { alertaId } = await novoAlerta('Inválido');
        const html = await (await pedir(`/alertas/${alertaId}`, 'procurador')).text();
        assert.match(html, /Abrir no PJe/);
        assert.match(html, /Abrir no eproc/);
        assert.match(html, /Tramita no eproc/);
    });

    test('assistente vê os links mas não o formulário de sistema', async () => {
        const { alertaId } = await novoAlerta('Inválido');
        const resp = await pedir(`/alertas/${alertaId}`, 'assistente_juridico');
        assert.equal(resp.status, 200);
        const html = await resp.text();
        assert.match(html, /Abrir no eproc/);
        assert.doesNotMatch(html, /Tramita no eproc/);
    });

    test('informar o sistema pelo alerta volta ao alerta, que passa a abrir só o eproc', async () => {
        const { processoId, alertaId } = await novoAlerta('Inválido');
        const resp = await pedir(`/processos/${processoId}/sistema`, 'procurador', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ sistema: 'eproc', voltar: `/alertas/${alertaId}` }).toString()
        });
        assert.equal(resp.status, 302);
        assert.match(resp.headers.get('location'), new RegExp(`^/alertas/${alertaId}\\b`));
        const html = await (await pedir(`/alertas/${alertaId}`, 'procurador')).text();
        assert.match(html, /Abrir no eproc/);
        assert.doesNotMatch(html, /Abrir no PJe/);
    });

    test('"voltar" para fora do Argus é ignorado (sem redirecionamento aberto)', async () => {
        const { processoId } = await novoAlerta('Inválido');
        const resp = await pedir(`/processos/${processoId}/sistema`, 'procurador', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ sistema: 'pje', voltar: 'https://exemplo.invalido/alertas/1' }).toString()
        });
        assert.equal(resp.status, 302);
        assert.match(resp.headers.get('location'), new RegExp(`^/processos/${processoId}\\b`));
    });

    test('MEL-17: alerta com várias movimentações lista todas (detalhe e lista)', async () => {
        const { processoId, alertaId } = await novoAlerta('PJe');
        await pool.query(
            `INSERT INTO movimentos (processo_id, codigo_tpu, nome, data_hora, relevante_para_prazo, hash_dedup, alerta_id)
             VALUES ($1, 12265, 'Publicação no DJe', NOW(), TRUE, md5(random()::text) || md5(random()::text), $2)`,
            [processoId, alertaId]
        );
        const html = await (await pedir(`/alertas/${alertaId}`, 'procurador')).text();
        assert.match(html, /Movimentações deste alerta/);
        assert.match(html, /Publicação no DJe/);
        assert.match(await (await pedir('/alertas?status=abertos', 'procurador')).text(), /\+1<\/span>/);
    });

    test('MEL-11: admin vê a fila de e-mails e pode reenviar o que falhou', async () => {
        const { rows: [e] } = await pool.query(
            `INSERT INTO emails_saida (para, assunto, tipo, status, tentativas, ultimo_erro)
             VALUES ('x@teste.local', 'Assunto falho', 'alerta_novo', 'falhou', 6, 'SMTP fora do ar') RETURNING id`
        );
        const html = await (await pedir('/configuracoes?aba=email', 'admin')).text();
        assert.match(html, /Fila de e-mails/);
        assert.match(html, /Assunto falho/);
        assert.match(await (await pedir('/configuracoes?aba=geral', 'admin')).text(), /e-mail\(s\) não entregue\(s\)/);

        const resp = await pedir(`/configuracoes/email/reenviar/${e.id}`, 'admin', { method: 'POST' });
        assert.equal(resp.status, 302);
        const { rows } = await pool.query('SELECT status FROM emails_saida WHERE id = $1', [e.id]);
        assert.equal(rows[0].status, 'pendente');

        assert.equal((await pedir(`/configuracoes/email/reenviar/${e.id}`, 'procurador', { method: 'POST' })).status, 403, 'procurador não acessa configurações');
    });

    test('painel conta processos do TJMG sem sistema e a lista filtra por eles', async () => {
        const semSistema = await novoAlerta('Inválido');
        const comSistema = await novoAlerta('PJe');
        await pool.query(`UPDATE processos SET situacao_fonte = 'localizado' WHERE id = ANY($1)`, [[semSistema.processoId, comSistema.processoId]]);
        const { rows: [esperado] } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM processos WHERE ativo AND situacao_fonte = 'localizado' AND tribunal = 'tjmg'
               AND sistema_informado IS NULL AND sistema = 'Inválido'`);

        const painel = await (await pedir('/painel', 'procurador')).text();
        assert.match(painel, new RegExp(`>${esperado.n}</span>\\s*<span class="desc">Sem sistema identificado`));

        const lista = await (await pedir('/processos?semSistema=true', 'procurador')).text();
        const { rows } = await pool.query('SELECT numero_processo FROM processos WHERE id = ANY($1) ORDER BY id', [[semSistema.processoId, comSistema.processoId]]);
        const fmt = (n) => `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16)}`;
        assert.ok(lista.includes(fmt(rows[0].numero_processo)), 'processo sem sistema aparece');
        assert.ok(!lista.includes(fmt(rows[1].numero_processo)), 'processo no PJe não aparece');
    });

    test('MEL-13: filtro de processos parados abre a partir do painel', async () => {
        const painel = await (await pedir('/painel', 'procurador')).text();
        assert.match(painel, /href="\/processos\?parados=true"/);
        const resp = await pedir('/processos?parados=true', 'procurador');
        assert.equal(resp.status, 200);
        assert.match(await resp.text(), /sem movimentação há mais de 60 dias/);
    });

    test('MEL-14: exporta processos e alertas em CSV, com auditoria e sem fórmula', async () => {
        const { processoId } = await novoAlerta('PJe');
        await pool.query(`UPDATE processos SET classe_nome = '=HYPERLINK("http://x")' WHERE id = $1`, [processoId]);
        const resp = await pedir('/processos/exportar.csv', 'assistente_juridico');
        assert.equal(resp.status, 200);
        assert.match(resp.headers.get('content-type'), /text\/csv/);
        assert.match(resp.headers.get('content-disposition'), /argus_processos_\d{4}-\d{2}-\d{2}\.csv/);
        const csv = await resp.text();
        assert.ok(csv.startsWith('Número;Tribunal;Sistema') || csv.startsWith('﻿Número;'), 'cabeçalho');
        assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`), 'fórmula neutralizada');
        assert.ok(!/;=HYPERLINK/.test(csv));

        const alertas = await (await pedir('/alertas/exportar.csv?status=abertos', 'procurador')).text();
        assert.match(alertas, /Alerta;Processo;Movimentação/);

        const { rows } = await pool.query(`SELECT detalhes FROM auditoria WHERE acao = 'exportacao' ORDER BY id`);
        assert.deepEqual(rows.map((r) => (typeof r.detalhes === 'string' ? JSON.parse(r.detalhes) : r.detalhes).tipo), ['processos', 'alertas']);

        const tela = await (await pedir('/processos?semSistema=true', 'procurador')).text();
        assert.match(tela, /href="\/processos\/exportar\.csv\?semSistema=true"/, 'exporta o mesmo filtro da tela');
    });

    test('lista de alertas e detalhe do processo também mostram o botão', async () => {
        const { processoId } = await novoAlerta('eproc');
        assert.match(await (await pedir('/alertas?status=abertos', 'procurador')).text(), /Abrir no eproc/);
        assert.match(await (await pedir(`/processos/${processoId}`, 'procurador')).text(), /Abrir no eproc/);
    });
});
