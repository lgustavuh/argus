const banco = require('./helpers/banco'); // antes de src/ (define DATABASE_URL)

const { test, describe, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db/pool');
const processosModel = require('../src/models/processos');
const configuracoes = require('../src/services/configuracoes');
const { FONTES } = require('../src/fontes');
const { aplicarDadosDaFonte, sincronizar } = require('../src/services/reconciliation');

const INTIMACAO = 12265;
const JUNTADA = 581;
const OPCOES = { mapaCodigosRelevantes: new Map([[INTIMACAO, 1]]), janelaCargaInicialDias: 15 };

// Instante UTC N dias atras, cortado no minuto, e duas "chaves brutas" diferentes para ele: o
// DataJud manda ISO e o MNI manda AAAAMMDDHHmmss (por isso o hash muda na troca de fonte).
function instante(dias) {
    const d = new Date(Date.now() - dias * 864e5);
    d.setUTCSeconds(0, 0);
    return d.toISOString();
}
const chaveMni = (iso) => iso.replace(/\D/g, '').slice(0, 14);

const dados = (movimentos) => ({ grau: 'G1', graus: 'G1', classeNome: 'Execução Fiscal', orgaoJulgador: 'Vara Única', sistema: 'PJe', movimentos });
const mov = (codigo, iso, chave) => ({ codigo, nome: `Movimento ${codigo}`, dataHora: iso, chave, ocorrencia: 1 });

let seq = 0;
async function novoProcesso(tribunal = 'tjmg') {
    seq += 1;
    const ramo = tribunal === 'trf6' ? '406' : '813';
    return processosModel.inserirManual({ numeroProcesso: `${String(seq).padStart(7, '0')}002026${ramo}0529`, tribunal });
}

const contar = async (sql, params) => Number((await pool.query(sql, params)).rows[0].n);

describe('fonte por tribunal e troca de fonte (MEL-19, integração)', { skip: banco.motivoPulo }, () => {
    before(banco.resetar);
    after(banco.encerrar);
    beforeEach(() => {
        mock.restoreAll();
        mock.method(console, 'error', () => {});
        delete FONTES.falsa;
    });

    test('troca DataJud -> MNI: movimentos já gravados não duplicam nem alertam de novo', async () => {
        const p = await novoProcesso();
        const antigo = instante(100);
        const recente = instante(2);
        await aplicarDadosDaFonte(p, dados([mov(JUNTADA, antigo, antigo)]), { ...OPCOES, fonteNome: 'datajud' });
        const comHistorico = await processosModel.findById(p.id);
        await aplicarDadosDaFonte(comHistorico, dados([mov(JUNTADA, antigo, antigo), mov(INTIMACAO, recente, recente)]), { ...OPCOES, fonteNome: 'datajud' });
        assert.equal(await contar('SELECT COUNT(*) AS n FROM alertas WHERE processo_id = $1', [p.id]), 1);

        const novo = instante(1);
        const viaMni = dados([mov(JUNTADA, antigo, chaveMni(antigo)), mov(INTIMACAO, recente, chaveMni(recente)), mov(INTIMACAO, novo, chaveMni(novo))]);
        const r = await aplicarDadosDaFonte(await processosModel.findById(p.id), viaMni, { ...OPCOES, fonteNome: 'mni' });
        assert.equal(r.movimentosNovos, 1, 'só o movimento realmente novo entra');
        assert.equal(r.alertasCriados, 1);
        assert.equal(await contar('SELECT COUNT(*) AS n FROM movimentos WHERE processo_id = $1', [p.id]), 3);
        assert.equal((await processosModel.findById(p.id)).fonte_movimentos, 'mni');

        // Próximas consultas pelo MNI reconhecem tudo pelo hash (os antigos foram re-chaveados).
        const de_novo = await aplicarDadosDaFonte(await processosModel.findById(p.id), viaMni, { ...OPCOES, fonteNome: 'mni' });
        assert.deepEqual(de_novo, { movimentosNovos: 0, alertasCriados: 0 });
        assert.equal(await contar('SELECT COUNT(*) AS n FROM alertas WHERE processo_id = $1', [p.id]), 2);
    });

    test('na troca, movimento antigo que só a nova fonte traz entra sem alerta (regra da carga inicial)', async () => {
        const p = await novoProcesso();
        const a = instante(100);
        await aplicarDadosDaFonte(p, dados([mov(JUNTADA, a, a)]), { ...OPCOES, fonteNome: 'datajud' });
        const antigoSoNoMni = instante(60);
        const r = await aplicarDadosDaFonte(
            await processosModel.findById(p.id),
            dados([mov(JUNTADA, a, chaveMni(a)), mov(INTIMACAO, antigoSoNoMni, chaveMni(antigoSoNoMni))]),
            { ...OPCOES, fonteNome: 'mni' }
        );
        assert.equal(r.movimentosNovos, 1);
        assert.equal(r.alertasCriados, 0);
    });

    test('sync: cada tribunal vai para a sua fonte; fonte fora do ar não marca "não localizado"', async () => {
        const tj = await novoProcesso('tjmg');
        const trf = await novoProcesso('trf6');
        const pedidos = { falsa: [], datajud: [] };
        let falsaNoAr = true;
        FONTES.falsa = {
            nome: 'falsa',
            rotulo: 'Fonte falsa (TJMG)',
            tribunais: ['tjmg'],
            disponivel: async () => falsaNoAr,
            consultarProcessos: async (numeros) => {
                pedidos.falsa.push(...numeros);
                return { encontrados: new Map(numeros.map((n) => [n, dados([])])), erros: [] };
            },
            descobrirProcessos: null
        };
        mock.method(FONTES.datajud, 'disponivel', async () => true);
        mock.method(FONTES.datajud, 'consultarProcessos', async (numeros) => {
            pedidos.datajud.push(...numeros);
            return { encontrados: new Map(numeros.map((n) => [n, dados([])])), erros: [] };
        });
        await configuracoes.salvar({ 'sync.fonte': 'falsa' });

        const r = await sincronizar({ processoIds: [tj.id, trf.id], origem: 'teste' });
        assert.deepEqual(pedidos.falsa, [tj.numero_processo]);
        assert.deepEqual(pedidos.datajud, [trf.numero_processo]);
        assert.equal(r.localizados, 2);
        assert.equal((await processosModel.findById(tj.id)).fonte_movimentos, 'falsa');
        assert.equal((await processosModel.findById(trf.id)).fonte_movimentos, 'datajud');

        // Fonte do TJMG fora do ar: o TRF6 continua sendo consultado e o processo do TJMG não vira "não localizado".
        falsaNoAr = false;
        await pool.query(`UPDATE processos SET situacao_fonte = 'localizado' WHERE id = $1`, [tj.id]);
        const r2 = await sincronizar({ processoIds: [tj.id, trf.id], origem: 'teste' });
        assert.equal(r2.localizados, 1);
        assert.equal(r2.naoLocalizados, 0);
        assert.ok(r2.erros.some((e) => e.fonte === 'falsa'));
        assert.equal((await processosModel.findById(tj.id)).situacao_fonte, 'localizado');

        await configuracoes.salvar({ 'sync.fonte': 'datajud' });
    });
});
