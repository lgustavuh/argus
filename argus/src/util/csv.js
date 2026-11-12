const { fmtDia } = require('./datas');

/**
 * CSV para o Excel em portugues (PRD MEL-14): separador ";", UTF-8 com BOM (sem ele o Excel mostra
 * acentos quebrados) e quebra de linha CRLF.
 *
 * Injecao de formula: celula que comeca com = + - @ (ou tab/CR) vira formula no Excel/LibreOffice.
 * Texto vindo do tribunal ou digitado por usuario pode comecar assim, entao ganha um apostrofo na
 * frente (recomendacao OWASP "CSV injection").
 */
const PERIGOSO = /^[=+\-@\t\r]/;

function fmtInstante(d) {
    return d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
}

function celula(valor) {
    if (valor === null || valor === undefined) return '';
    let s;
    if (valor instanceof Date) s = fmtInstante(valor);
    else if (Array.isArray(valor)) s = valor.join(', ');
    else s = String(valor);
    if (PERIGOSO.test(s)) s = `'${s}`;
    if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}

/** @param {string[]} cabecalhos  @param {Array<Array<*>>} linhas */
function gerarCsv(cabecalhos, linhas) {
    return '﻿' + [cabecalhos, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n';
}

function enviarCsv(res, nomeArquivo, conteudo) {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.set('Cache-Control', 'no-store');
    res.send(conteudo);
}

module.exports = { gerarCsv, enviarCsv, celula, fmtInstante, fmtDia };
