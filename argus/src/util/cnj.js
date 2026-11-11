/**
 * Utilitarios para o numero unico de processo do CNJ (Resolucao CNJ 65/2008):
 * NNNNNNN-DD.AAAA.J.TR.OOOO — 20 digitos.
 *   NNNNNNN sequencial | DD digitos verificadores | AAAA ano | J segmento do Judiciario |
 *   TR tribunal | OOOO unidade de origem
 */

const REGEX_FORMATADO = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
const REGEX_20_DIGITOS = /(?<!\d)\d{20}(?!\d)/g;

function limpar(numero) {
    return String(numero || '').replace(/\D/g, '');
}

function formatar(numero) {
    const d = limpar(numero);
    if (d.length !== 20) return numero || '';
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

/**
 * Digito verificador pelo algoritmo ISO 7064 mod 97-10 (Anexo VIII da Res. CNJ 65/2008):
 * DD = 98 - ((NNNNNNN AAAA J TR OOOO 00) mod 97).
 */
function digitoVerificadorValido(numero) {
    const d = limpar(numero);
    if (d.length !== 20) return false;
    const sequencial = d.slice(0, 7);
    const dv = d.slice(7, 9);
    const resto = d.slice(9);
    const calculado = 98n - (BigInt(`${sequencial}${resto}00`) % 97n);
    return String(calculado).padStart(2, '0') === dv;
}

/**
 * Extrai todos os numeros CNJ de um texto livre (lista colada de planilha, CSV, relatorio...).
 * Aceita o formato com pontuacao e o de 20 digitos corridos. Retorna digitos, sem repeticao.
 */
function extrairNumeros(texto) {
    const encontrados = new Set();
    const bruto = String(texto || '');
    for (const m of bruto.match(REGEX_FORMATADO) || []) encontrados.add(limpar(m));
    const semFormatados = bruto.replace(REGEX_FORMATADO, ' ');
    for (const m of semFormatados.match(REGEX_20_DIGITOS) || []) encontrados.add(m);
    return [...encontrados];
}

const UF_POR_TR_ESTADUAL = {
    '01': 'ac', '02': 'al', '03': 'ap', '04': 'am', '05': 'ba', '06': 'ce', '07': 'dft', '08': 'es',
    '09': 'go', '10': 'ma', '11': 'mt', '12': 'ms', '13': 'mg', '14': 'pa', '15': 'pb', '16': 'pr',
    '17': 'pe', '18': 'pi', '19': 'rj', '20': 'rn', '21': 'rs', '22': 'ro', '23': 'rr', '24': 'sc',
    '25': 'se', '26': 'sp', '27': 'to'
};

/**
 * Deduz o alias do tribunal no DataJud (api_publica_{alias}) a partir de J e TR do numero.
 * Retorna null para segmentos que o DataJud publico nao cobre (ex.: STF).
 */
function tribunalDoNumero(numero) {
    const d = limpar(numero);
    if (d.length !== 20) return null;
    const j = d.slice(13, 14);
    const tr = d.slice(14, 16);
    switch (j) {
        case '8': return UF_POR_TR_ESTADUAL[tr] ? `tj${UF_POR_TR_ESTADUAL[tr]}` : null;
        case '4': return `trf${Number(tr)}`;
        case '5': return tr === '00' ? 'tst' : `trt${Number(tr)}`;
        case '6': return UF_POR_TR_ESTADUAL[tr] ? `tre-${UF_POR_TR_ESTADUAL[tr].replace('dft', 'df')}` : null;
        case '9': return UF_POR_TR_ESTADUAL[tr] ? `tjm${UF_POR_TR_ESTADUAL[tr]}` : null;
        case '3': return 'stj';
        default: return null;
    }
}

module.exports = { limpar, formatar, digitoVerificadorValido, extrairNumeros, tribunalDoNumero };
