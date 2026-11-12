const banco = require('./helpers/banco'); // antes de src/ (define DATABASE_URL)

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db/pool');
const processosModel = require('../src/models/processos');
const usuariosModel = require('../src/models/usuarios');
const configuracoes = require('../src/services/configuracoes');
const { enviarAvisoSemanal } = require('../src/services/processosParados');

const SEGUNDA_8H = new Date('2026-11-16T11:00:00Z'); // 08h de Brasília
const SEGUNDA_6H = new Date('2026-11-16T09:00:00Z');
const TERCA_8H = new Date('2026-11-17T11:00:00Z');

let seq = 0;
async function processoComUltimoMovimento(diasAtras, responsavelId = null) {
    seq += 1;
    const p = await processosModel.inserirManual({ numeroProcesso: `${String(seq).padStart(7, '0')}0020268130529`, tribunal: 'tjmg' });
    await pool.query(`UPDATE processos SET situacao_fonte = 'localizado', procurador_responsavel_id = $2 WHERE id = $1`, [p.id, responsavelId]);
    await pool.query(
        `INSERT INTO movimentos (processo_id, codigo_tpu, nome, data_hora, hash_dedup)
         VALUES ($1, 581, 'Juntada', NOW() - ($2 || ' days')::interval, md5(random()::text) || md5(random()::text))`,
        [p.id, String(diasAtras)]
    );
    return p;
}

const filaParados = async () =>
    (await pool.query(`SELECT para, assunto FROM emails_saida WHERE tipo = 'processos_parados' ORDER BY para`)).rows;

describe('processos parados (MEL-13, integração)', { skip: banco.motivoPulo }, () => {
    let advogado;
    let procurador;
    let parado;
    let paradoSemResponsavel;
    let ativo;

    before(async () => {
        await banco.resetar();
        procurador = await usuariosModel.create({ nome: 'Procuradora Chefe', email: 'chefe@parados.local', senhaHash: 'x', papel: 'procurador' });
        advogado = await usuariosModel.create({ nome: 'Advogado Um', email: 'adv@parados.local', senhaHash: 'x', papel: 'advogado' });
        await configuracoes.salvar({ 'geral.dias_sem_movimentacao': '60' });
        parado = await processoComUltimoMovimento(100, advogado.id);
        paradoSemResponsavel = await processoComUltimoMovimento(90);
        ativo = await processoComUltimoMovimento(10, advogado.id);
    });
    after(banco.encerrar);

    test('lista e filtro trazem só os parados há mais de N dias', async () => {
        const ids = (await processosModel.listParados(60)).map((p) => p.id).sort();
        assert.deepEqual(ids, [parado.id, paradoSemResponsavel.id].sort());
        const { processos } = await processosModel.list({ paradosHaDias: 60 }, { limit: 50, offset: 0 });
        assert.ok(!processos.some((p) => p.id === ativo.id));
        assert.equal((await processosModel.contarResumo({ diasSemMovimentacao: 60 })).semMovimentacao, 2);
    });

    test('só segunda-feira, a partir das 7h, uma vez por dia', async () => {
        assert.equal(await enviarAvisoSemanal({ agora: TERCA_8H }), 0);
        assert.equal(await enviarAvisoSemanal({ agora: SEGUNDA_6H }), 0);
        assert.equal(await enviarAvisoSemanal({ agora: SEGUNDA_8H }), 2);
        assert.equal(await enviarAvisoSemanal({ agora: SEGUNDA_8H }), 0, 'não repete no mesmo dia');
    });

    test('cada responsável recebe os seus; sem responsável vai para o procurador', async () => {
        const fila = await filaParados();
        assert.deepEqual(fila.map((e) => e.para), ['adv@parados.local', 'chefe@parados.local']);
        assert.match(fila[0].assunto, /1 processo\(s\) sem movimentação há mais de 60 dias/);
    });

    test('desligado na configuração: não envia', async () => {
        await pool.query('DELETE FROM emails_saida');
        await configuracoes.salvar({ 'geral.aviso_parados_ativo': 'false', 'geral.ultimo_aviso_parados_dia': '' });
        assert.equal(await enviarAvisoSemanal({ agora: SEGUNDA_8H }), 0);
        assert.equal((await filaParados()).length, 0);
    });
});
