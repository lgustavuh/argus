const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { gerarCsv, celula } = require('../src/util/csv');

describe('util/csv (MEL-14)', () => {
    test('BOM, separador ";" e CRLF para o Excel em português', () => {
        const csv = gerarCsv(['Número', 'Classe'], [['0030762-44.2011.8.13.0529', 'Execução Fiscal']]);
        assert.equal(csv, '﻿Número;Classe\r\n0030762-44.2011.8.13.0529;Execução Fiscal\r\n');
    });

    test('aspas, ";" e quebra de linha ficam entre aspas', () => {
        assert.equal(celula('a;b'), '"a;b"');
        assert.equal(celula('diz "oi"'), '"diz ""oi"""');
        assert.equal(celula('linha1\nlinha2'), '"linha1\nlinha2"');
    });

    test('injeção de fórmula: = + - @ ganham apóstrofo', () => {
        assert.equal(celula('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
        assert.equal(celula('+1'), "'+1");
        assert.equal(celula('-2'), "'-2");
        assert.equal(celula('@SUM(A1)'), "'@SUM(A1)");
        assert.equal(celula('texto normal'), 'texto normal');
    });

    test('nulos, listas e datas', () => {
        assert.equal(celula(null), '');
        assert.equal(celula(undefined), '');
        assert.equal(celula(['fiscal', 'urgente']), 'fiscal, urgente');
        assert.equal(celula(new Date('2026-11-12T15:00:00Z')), '12/11/2026, 12:00:00');
    });
});
