/**
 * O DataJud entrega `dataHora` dos movimentos com sufixo "Z" (UTC), mas o valor e o horario LOCAL do
 * tribunal (Brasilia). Conferido em out/2026: o processo 0030762-44.2011.8.13.0529 mostra no PJe
 * "12/02/2026 12:25:48 — Distribuído por dependência" e o DataJud devolve "2026-02-12T12:25:48.000Z";
 * a dataAjuizamento (que vem sem fuso) tambem bate digito a digito com o primeiro movimento.
 * Esta funcao le data/hora ignorando o sufixo e interpreta como America/Sao_Paulo (inclui o horario
 * de verao vigente ate 2019), devolvendo o instante correto em UTC.
 */
const FMT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});

function deslocamentoSaoPaulo(instanteMs) {
    const p = Object.fromEntries(FMT.formatToParts(new Date(instanteMs)).map((x) => [x.type, x.value]));
    const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return comoUtc - Math.floor(instanteMs / 1000) * 1000;
}

function horaLocalSaoPauloParaUtc(valor) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?/.exec(String(valor || ''));
    if (!m) return valor || null;
    const ms = m[7] ? Math.round(Number(m[7]) * 1000) : 0;
    const comoSeFosseUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
    let instante = comoSeFosseUtc - deslocamentoSaoPaulo(comoSeFosseUtc);
    instante = comoSeFosseUtc - deslocamentoSaoPaulo(instante); // ajuste fino nas viradas de horario de verao
    return new Date(instante).toISOString();
}

module.exports = { horaLocalSaoPauloParaUtc };
