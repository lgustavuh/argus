// Calculadora de prazo processual (CPC): usada na tela de agenda e testavel no Node.
// E uma AJUDA para preencher a data fatal — feriados municipais/estaduais e suspensoes de expediente
// do TJMG (portarias) nao entram e precisam ser conferidos por quem lanca o prazo.
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else raiz.ArgusPrazos = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
    function dia(ano, mes, d) { return new Date(Date.UTC(ano, mes - 1, d)); }
    function iso(data) { return data.toISOString().slice(0, 10); }
    function somar(data, n) { return new Date(data.getTime() + n * 864e5); }

    // Domingo de Pascoa (algoritmo de Meeus/Jones/Butcher).
    function pascoa(ano) {
        var a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
        var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
        var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
        var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
        var mes = Math.floor((h + l - 7 * m + 114) / 31), d2 = ((h + l - 7 * m + 114) % 31) + 1;
        return dia(ano, mes, d2);
    }

    var cacheFeriados = {};
    // Feriados nacionais, os moveis que fecham o forum e o Dia da Justica (8/12).
    function feriados(ano) {
        if (cacheFeriados[ano]) return cacheFeriados[ano];
        var p = pascoa(ano);
        var lista = [
            [dia(ano, 1, 1), 'Confraternização Universal'],
            [somar(p, -48), 'Carnaval'],
            [somar(p, -47), 'Carnaval'],
            [somar(p, -2), 'Sexta-feira Santa'],
            [dia(ano, 4, 21), 'Tiradentes'],
            [dia(ano, 5, 1), 'Dia do Trabalho'],
            [somar(p, 60), 'Corpus Christi'],
            [dia(ano, 9, 7), 'Independência'],
            [dia(ano, 10, 12), 'Nossa Senhora Aparecida'],
            [dia(ano, 11, 2), 'Finados'],
            [dia(ano, 11, 15), 'Proclamação da República'],
            [dia(ano, 11, 20), 'Dia Nacional de Zumbi e da Consciência Negra'],
            [dia(ano, 12, 8), 'Dia da Justiça'],
            [dia(ano, 12, 25), 'Natal']
        ];
        var mapa = {};
        lista.forEach(function (f) { mapa[iso(f[0])] = f[1]; });
        cacheFeriados[ano] = mapa;
        return mapa;
    }

    // Recesso forense: prazos suspensos de 20/12 a 20/01, inclusive (CPC, art. 220).
    function noRecesso(data) {
        var m = data.getUTCMonth() + 1, d = data.getUTCDate();
        return (m === 12 && d >= 20) || (m === 1 && d <= 20);
    }

    // Motivo de o dia nao contar como util, ou null se e dia util.
    function motivoNaoUtil(data) {
        var sem = data.getUTCDay();
        if (sem === 0) return 'domingo';
        if (sem === 6) return 'sábado';
        var f = feriados(data.getUTCFullYear())[iso(data)];
        if (f) return f;
        if (noRecesso(data)) return 'recesso forense (art. 220 do CPC)';
        return null;
    }

    function proximoUtil(data) {
        var d = data;
        while (motivoNaoUtil(d)) d = somar(d, 1);
        return d;
    }

    /**
     * @param {object} o
     *   inicio: 'AAAA-MM-DD' — dia da intimação/ciência (não conta; art. 224 do CPC)
     *   dias: número de dias do prazo
     *   contagem: 'uteis' (art. 219, padrão) | 'corridos'
     *   dobro: true para prazo em dobro da Fazenda Pública (art. 183)
     * @returns {{fim: string, diasContados: number, ignorados: Array<{dia: string, motivo: string}>}}
     */
    function calcular(o) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.inicio || '');
        var dias = Number(o.dias);
        if (!m || !(dias >= 1)) return null;
        var total = o.dobro ? dias * 2 : dias;
        var atual = dia(+m[1], +m[2], +m[3]);
        var ignorados = [];

        if (o.contagem === 'corridos') {
            var fim = somar(atual, total);
            var prorrogado = proximoUtil(fim);
            for (var x = fim; x < prorrogado; x = somar(x, 1)) ignorados.push({ dia: iso(x), motivo: motivoNaoUtil(x) });
            return { fim: iso(prorrogado), diasContados: total, ignorados: ignorados };
        }

        var contados = 0;
        while (contados < total) {
            atual = somar(atual, 1);
            var motivo = motivoNaoUtil(atual);
            if (motivo) ignorados.push({ dia: iso(atual), motivo: motivo });
            else contados++;
        }
        return { fim: iso(atual), diasContados: total, ignorados: ignorados };
    }

    return { calcular: calcular, motivoNaoUtil: function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? motivoNaoUtil(dia(+m[1], +m[2], +m[3])) : null; }, pascoa: function (a) { return iso(pascoa(a)); } };
});
