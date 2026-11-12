const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { acessoNoTribunal } = require('../src/services/linkBuilder');

const NUMERO = '00307624420118130529';

describe('linkBuilder.acessoNoTribunal (MEL-16)', () => {
    test('sistema do DataJud: um botão só, para o sistema certo', () => {
        const a = acessoNoTribunal({ numero_processo: NUMERO, tribunal: 'tjmg', grau: 'G1', sistema: 'PJe' });
        assert.equal(a.sistema.chave, 'pje');
        assert.equal(a.sistema.informado, false);
        assert.match(a.principal.url, /^https:\/\/pje-consulta-publica\.tjmg\.jus\.br\/.*numeroProcesso=00307624420118130529/);
        assert.deepEqual(a.alternativos, []);
    });

    test('sistema informado pela Procuradoria tem prioridade sobre o do DataJud', () => {
        const a = acessoNoTribunal({ numero_processo: NUMERO, tribunal: 'tjmg', grau: 'G1', sistema: 'PJe', sistema_informado: 'eproc' });
        assert.equal(a.sistema.chave, 'eproc');
        assert.equal(a.sistema.informado, true);
        assert.match(a.principal.url, /eproc-consulta-publica-1g/);
    });

    test('2º grau no PJe vai para o PJe recursal', () => {
        const a = acessoNoTribunal({ numero_processo: NUMERO, tribunal: 'tjmg', grau: 'G2', sistema: 'PJe' });
        assert.match(a.principal.url, /^https:\/\/pjerecursal\.tjmg\.jus\.br\//);
    });

    test('sistema desconhecido ("Inválido"): sem palpite, oferece PJe e eproc', () => {
        const a = acessoNoTribunal({ numero_processo: NUMERO, tribunal: 'tjmg', grau: 'G1', sistema: 'Inválido' });
        assert.equal(a.sistema, null);
        assert.equal(a.principal, null);
        assert.deepEqual(a.alternativos.map((l) => l.sistema), ['pje', 'eproc']);
    });

    test('tribunal sem link validado (TRF6): nenhum link', () => {
        const a = acessoNoTribunal({ numero_processo: '00000010020204060000', tribunal: 'trf6', sistema: 'PJe' });
        assert.equal(a.principal, null);
        assert.deepEqual(a.alternativos, []);
    });
});
