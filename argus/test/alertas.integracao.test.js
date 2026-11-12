const banco = require('./helpers/banco'); // antes de src/ (define DATABASE_URL)

const { test, describe, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db/pool');
const processosModel = require('../src/models/processos');
const alertasModel = require('../src/models/alertas');
const usuariosModel = require('../src/models/usuarios');
const mailer = require('../src/services/mailer');
const { aplicarDadosDaFonte } = require('../src/services/reconciliation');
const { gerarAlertasPendentes, escalarAlertasVencidos } = require('../src/services/alertEngine');

const INTIMACAO = 12265;
const JUNTADA = 581; // nao relevante para prazo
const MAPA_RELEVANTES = new Map([[INTIMACAO, 1]]);
const OPCOES = { mapaCodigosRelevantes: MAPA_RELEVANTES, janelaCargaInicialDias: 15 };

// DataJud entrega hora local de Brasilia com sufixo "Z" (ver src/util/fuso.js).
function diasAtras(dias) {
    return new Date(Date.now() - dias * 864e5).toISOString().slice(0, 19) + '.000Z';
}

function movimento(codigo, dataHora, ocorrencia = 1) {
    return { codigo, nome: `Movimento ${codigo}`, dataHora, chave: dataHora, ocorrencia };
}

function dadosFonte(movimentos) {
    return { grau: 'G1', graus: 'G1', classeNome: 'Execução Fiscal', orgaoJulgador: 'Vara Única', movimentos };
}

let sequencial = 0;
async function novoProcesso() {
    sequencial += 1;
    // Numero ficticio: so precisa ser unico (a validacao de DV fica na rota de cadastro).
    const numero = `${String(sequencial).padStart(7, '0')}0020268130000`; // NNNNNNN DD AAAA J TR OOOO
    return processosModel.inserirManual({ numeroProcesso: numero, tribunal: 'tjmg' });
}

async function contar(sql, params = []) {
    const { rows } = await pool.query(sql, params);
    return Number(rows[0].n);
}

const alertasDo = (id) => contar('SELECT COUNT(*) AS n FROM alertas WHERE processo_id = $1', [id]);
const pendentesDo = (id) => contar('SELECT COUNT(*) AS n FROM movimentos WHERE processo_id = $1 AND alerta_pendente', [id]);

describe('alertas: sync e escalonamento (integração)', { skip: banco.motivoPulo }, () => {
    before(banco.resetar);
    after(banco.encerrar);
    beforeEach(() => {
        mock.restoreAll();
        mock.method(mailer, 'enviarEmail', async () => ({ ok: true }));
        mock.method(console, 'error', () => {});
    });

    test('movimento relevante gera alerta; não relevante não; reexecutar não duplica', async () => {
        const p = await novoProcesso();
        // Processo que ja tem historico (nao e carga inicial).
        await aplicarDadosDaFonte(p, dadosFonte([movimento(JUNTADA, diasAtras(100))]), OPCOES);

        const dados = dadosFonte([movimento(JUNTADA, diasAtras(100)), movimento(INTIMACAO, diasAtras(1)), movimento(JUNTADA, diasAtras(1))]);
        const r1 = await aplicarDadosDaFonte(p, dados, OPCOES);
        assert.equal(r1.movimentosNovos, 2);
        assert.equal(r1.alertasCriados, 1);

        const r2 = await aplicarDadosDaFonte(p, dados, OPCOES);
        assert.deepEqual(r2, { movimentosNovos: 0, alertasCriados: 0 });
        assert.equal(await alertasDo(p.id), 1);
        assert.equal(await pendentesDo(p.id), 0);
    });

    test('carga inicial: só alerta movimentos relevantes dentro da janela', async () => {
        const p = await novoProcesso();
        const r = await aplicarDadosDaFonte(p, dadosFonte([movimento(INTIMACAO, diasAtras(90)), movimento(INTIMACAO, diasAtras(2))]), OPCOES);
        assert.equal(r.movimentosNovos, 2);
        assert.equal(r.alertasCriados, 1);
        assert.equal(await pendentesDo(p.id), 0, 'movimento antigo não pode ficar pendente');
    });

    test('BUG-02: falha ao criar um alerta não o perde — fica pendente e é gerado depois', async () => {
        const p = await novoProcesso();
        await aplicarDadosDaFonte(p, dadosFonte([movimento(JUNTADA, diasAtras(100))]), OPCOES);

        const original = alertasModel.criarParaMovimentoPendente;
        let chamadas = 0;
        mock.method(alertasModel, 'criarParaMovimentoPendente', async (args) => {
            chamadas += 1;
            if (chamadas === 2) throw new Error('falha simulada no banco');
            return original(args);
        });

        const dados = dadosFonte([movimento(INTIMACAO, diasAtras(3)), movimento(INTIMACAO, diasAtras(2)), movimento(INTIMACAO, diasAtras(1))]);
        const r = await aplicarDadosDaFonte(p, dados, OPCOES);
        assert.equal(r.movimentosNovos, 3);
        assert.equal(r.alertasCriados, 2, 'a falha de um não pode interromper os demais');
        assert.equal(await pendentesDo(p.id), 1);

        mock.method(alertasModel, 'criarParaMovimentoPendente', original);
        const retomada = await gerarAlertasPendentes();
        assert.equal(retomada.criados, 1);
        assert.equal(await alertasDo(p.id), 3);
        assert.equal(await pendentesDo(p.id), 0);

        // Um novo sync com os mesmos dados nao cria nada a mais.
        await aplicarDadosDaFonte(p, dados, OPCOES);
        assert.equal(await alertasDo(p.id), 3);
    });

    test('falha no e-mail não desfaz o alerta', async () => {
        await usuariosModel.create({ nome: 'Procuradora Teste', email: 'proc@teste.local', senhaHash: 'x', papel: 'procurador' });
        mock.method(mailer, 'enviarEmail', async () => {
            throw new Error('SMTP fora do ar');
        });
        const p = await novoProcesso();
        await aplicarDadosDaFonte(p, dadosFonte([movimento(JUNTADA, diasAtras(100))]), OPCOES);
        const r = await aplicarDadosDaFonte(p, dadosFonte([movimento(INTIMACAO, diasAtras(1))]), OPCOES);
        assert.equal(r.alertasCriados, 1);
        assert.equal(await alertasDo(p.id), 1);
        assert.equal(await pendentesDo(p.id), 0);
    });

    test('execuções simultâneas não duplicam alerta', async () => {
        const p = await novoProcesso();
        await aplicarDadosDaFonte(p, dadosFonte([movimento(JUNTADA, diasAtras(100))]), OPCOES);
        await pool.query(
            `INSERT INTO movimentos (processo_id, codigo_tpu, nome, data_hora, relevante_para_prazo, hash_dedup, alerta_pendente)
             VALUES ($1, $2, 'Intimação', NOW(), TRUE, md5(random()::text) || md5(random()::text), TRUE)`,
            [p.id, INTIMACAO]
        );
        const resultados = await Promise.all([gerarAlertasPendentes(), gerarAlertasPendentes(), gerarAlertasPendentes()]);
        assert.equal(resultados.reduce((s, r) => s + r.criados, 0), 1);
        assert.equal(await alertasDo(p.id), 1);
    });

    test('BUG-04: alerta que recebeu ciência antes de ser escalado não é escalado nem notificado', async () => {
        const p = await novoProcesso();
        await aplicarDadosDaFonte(p, dadosFonte([movimento(JUNTADA, diasAtras(100))]), OPCOES);
        await aplicarDadosDaFonte(p, dadosFonte([movimento(INTIMACAO, diasAtras(1))]), OPCOES);
        await pool.query(`UPDATE alertas SET criado_em = NOW() - INTERVAL '10 days' WHERE processo_id = $1`, [p.id]);

        // Simula a ciencia dada entre a listagem e a marcacao.
        const listar = alertasModel.listParaEscalonar;
        mock.method(alertasModel, 'listParaEscalonar', async (...args) => {
            const vencidos = await listar(...args);
            await pool.query(`UPDATE alertas SET status = 'ciente', ciente_em = NOW() WHERE processo_id = $1`, [p.id]);
            return vencidos;
        });
        const envio = mock.method(mailer, 'enviarEmail', async () => ({ ok: true }));

        const escalados = await escalarAlertasVencidos();
        const { rows } = await pool.query('SELECT status FROM alertas WHERE processo_id = $1', [p.id]);
        assert.equal(rows[0].status, 'ciente');
        assert.equal(escalados, 0);
        assert.equal(envio.mock.callCount(), 0, 'nenhum e-mail de escalonamento deve sair');
    });

    test('alerta vencido sem ciência é escalado e notificado', async () => {
        const p = await novoProcesso();
        await aplicarDadosDaFonte(p, dadosFonte([movimento(JUNTADA, diasAtras(100))]), OPCOES);
        await aplicarDadosDaFonte(p, dadosFonte([movimento(INTIMACAO, diasAtras(1))]), OPCOES);
        await pool.query(`UPDATE alertas SET criado_em = NOW() - INTERVAL '10 days' WHERE processo_id = $1`, [p.id]);
        const envio = mock.method(mailer, 'enviarEmail', async () => ({ ok: true }));

        assert.equal(await escalarAlertasVencidos(), 1);
        const { rows } = await pool.query('SELECT status FROM alertas WHERE processo_id = $1', [p.id]);
        assert.equal(rows[0].status, 'escalado');
        assert.ok(envio.mock.callCount() >= 1);
    });
});
