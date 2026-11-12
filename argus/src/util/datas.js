/**
 * Datas de calendario (sem hora) como texto 'AAAA-MM-DD'. Colunas DATE chegam do banco nesse formato
 * (ver src/db/pool.js), e "hoje" e sempre o dia em Brasilia — o servidor roda em UTC, e depois das
 * 21h de Brasilia o CURRENT_DATE do banco ja seria o dia seguinte. Por isso as consultas recebem o
 * dia de hoje como parametro, em vez de usar CURRENT_DATE.
 */
const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

function hojeSP(agora = new Date()) {
    return FMT_DIA.format(agora);
}

function diaValido(texto) {
    const m = RE_DIA.exec(String(texto || ''));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function somarDias(dia, n) {
    const m = RE_DIA.exec(dia);
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return d.toISOString().slice(0, 10);
}

// 'AAAA-MM-DD' -> 'DD/MM/AAAA' sem passar por Date (que deslocaria o dia pelo fuso).
function fmtDia(dia) {
    const m = RE_DIA.exec(String(dia || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function diaDaSemana(dia) {
    const m = RE_DIA.exec(String(dia || ''));
    return m ? DIAS_SEMANA[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] : null;
}

function horaValida(texto) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(texto || ''));
}

// Mesmo calendario da calculadora de prazos da agenda (feriados nacionais, moveis e Dia da Justica).
const { motivoNaoUtil } = require('../../public/js/prazos');

/**
 * Dia util para os prazos INTERNOS da Procuradoria (escalonamento): pula sabado, domingo e
 * feriados, mas nao o recesso forense — no recesso chegam liminares e plantoes, e um alerta sem
 * ciencia nao pode esperar ate 21/01 para escalar.
 */
function ehDiaUtilInterno(dia) {
    const motivo = motivoNaoUtil(dia);
    return !motivo || motivo.startsWith('recesso');
}

/** Soma n dias uteis internos a 'AAAA-MM-DD' (o proprio dia nao conta). */
function somarDiasUteis(dia, n) {
    let atual = dia;
    let contados = 0;
    while (contados < n) {
        atual = somarDias(atual, 1);
        if (ehDiaUtilInterno(atual)) contados += 1;
    }
    return atual;
}

module.exports = { hojeSP, diaValido, somarDias, somarDiasUteis, ehDiaUtilInterno, fmtDia, diaDaSemana, horaValida };
