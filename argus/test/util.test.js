const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const cnj = require('../src/util/cnj');
const datas = require('../src/util/datas');
const { horaLocalSaoPauloParaUtc } = require('../src/util/fuso');

describe('util/cnj', () => {
    // Processo real citado em src/util/fuso.js.
    const VALIDO = '0030762-44.2011.8.13.0529';

    test('dígito verificador', () => {
        assert.equal(cnj.digitoVerificadorValido(VALIDO), true);
        assert.equal(cnj.digitoVerificadorValido('0030762-45.2011.8.13.0529'), false);
        assert.equal(cnj.digitoVerificadorValido('123'), false);
    });

    test('formatar e limpar', () => {
        assert.equal(cnj.formatar('00307624420118130529'), VALIDO);
        assert.equal(cnj.limpar(VALIDO), '00307624420118130529');
    });

    test('extrai números de texto livre, sem repetir', () => {
        const texto = `Processo ${VALIDO}; de novo 00307624420118130529\noutro 1234567-89.2020.8.13.0001 e lixo 123456789012345678901`;
        assert.deepEqual(cnj.extrairNumeros(texto).sort(), ['00307624420118130529', '12345678920208130001']);
    });

    test('tribunal pelo número', () => {
        assert.equal(cnj.tribunalDoNumero(VALIDO), 'tjmg');
        assert.equal(cnj.tribunalDoNumero('0000001-00.2020.4.06.0000'), 'trf6');
        assert.equal(cnj.tribunalDoNumero('0000001-00.2020.5.03.0000'), 'trt3');
        assert.equal(cnj.tribunalDoNumero('0000001-00.2020.5.00.0000'), 'tst');
        assert.equal(cnj.tribunalDoNumero('0000001-00.2020.1.00.0000'), null);
    });
});

describe('util/datas', () => {
    test('hoje em Brasília, não em UTC', () => {
        // 23h30 de Brasilia = 02h30 UTC do dia seguinte.
        assert.equal(datas.hojeSP(new Date('2026-03-11T02:30:00Z')), '2026-03-10');
    });

    test('valida, soma e formata dias sem passar por fuso', () => {
        assert.equal(datas.diaValido('2026-02-29'), false);
        assert.equal(datas.diaValido('2028-02-29'), true);
        assert.equal(datas.somarDias('2026-12-30', 3), '2027-01-02');
        assert.equal(datas.fmtDia('2026-11-12'), '12/11/2026');
        assert.equal(datas.diaDaSemana('2026-11-12'), 'quinta-feira');
        assert.equal(datas.horaValida('23:59'), true);
        assert.equal(datas.horaValida('24:00'), false);
    });
});

describe('util/fuso', () => {
    test('DataJud: hora local marcada como Z vira o instante UTC correto', () => {
        assert.equal(horaLocalSaoPauloParaUtc('2026-02-12T12:25:48.000Z'), '2026-02-12T15:25:48.000Z');
    });

    test('considera o horário de verão (vigente até 2019)', () => {
        assert.equal(horaLocalSaoPauloParaUtc('2018-01-10T12:00:00Z'), '2018-01-10T14:00:00.000Z');
    });

    test('valor sem data reconhecível passa adiante', () => {
        assert.equal(horaLocalSaoPauloParaUtc(null), null);
    });
});
