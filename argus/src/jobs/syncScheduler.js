const cron = require('node-cron');
const { sincronizar, syncEmAndamento } = require('../services/reconciliation');
const { escalarAlertasVencidos, gerarAlertasPendentes } = require('../services/alertEngine');
const { enviarResumosDiarios } = require('../services/agenda');
const configuracoes = require('../services/configuracoes');
const outbox = require('../services/outbox');

/**
 * Um unico relogio, de hora em hora:
 * - escalonamento de alertas vencidos (sempre ativo — so reage a alertas ja existentes);
 * - resumo diario da agenda por e-mail (uma vez por dia util, a partir das 7h);
 * - sync com a fonte de dados, se estiver ativado em Configuracoes > Integracao e o intervalo
 *   configurado ja tiver passado desde o ultimo. Como o intervalo e lido a cada hora, mudar a
 *   configuracao na tela vale sem reiniciar o container.
 */
async function talvezSincronizar() {
    if (syncEmAndamento()) return;
    const [ativo, intervaloHoras, ultimoEm] = await Promise.all([
        configuracoes.lerBooleano('sync.ativo'),
        configuracoes.lerNumero('sync.intervalo_horas'),
        configuracoes.ler('sync.ultimo_em')
    ]);
    if (!ativo) return;
    const ultimo = ultimoEm ? new Date(ultimoEm).getTime() : 0;
    // Folga de 5 minutos para o tick de hora em hora nao "perder" a vez por segundos.
    if (Date.now() - ultimo < intervaloHoras * 60 * 60 * 1000 - 5 * 60 * 1000) return;

    console.log('[scheduler] Iniciando sincronizacao agendada...');
    const resumo = await sincronizar({ origem: 'agendado' });
    console.log('[scheduler] Sincronizacao concluida:', JSON.stringify(resumo));
}

function iniciarScheduler() {
    // Fila de e-mails: a cada minuto, para o aviso sair logo depois de entrar na fila (PRD MEL-11).
    cron.schedule('30 * * * * *', async () => {
        try {
            const r = await outbox.processar();
            if (r.enviados || r.reagendados || r.falharam) console.log('[scheduler] E-mails:', JSON.stringify(r));
        } catch (err) {
            console.error('[scheduler] Falha ao processar a fila de e-mails:', err.message);
        }
    });
    cron.schedule('0 0 * * * *', async () => {
        try {
            // Alertas que falharam em um sync anterior nao esperam o proximo sync (PRD BUG-02).
            if (!syncEmAndamento()) {
                const { criados } = await gerarAlertasPendentes();
                if (criados > 0) console.log(`[scheduler] ${criados} alerta(s) pendente(s) gerado(s).`);
            }
        } catch (err) {
            console.error('[scheduler] Falha ao gerar alertas pendentes:', err.message);
        }
        try {
            const total = await escalarAlertasVencidos();
            if (total > 0) console.log(`[scheduler] ${total} alerta(s) escalado(s).`);
        } catch (err) {
            console.error('[scheduler] Falha ao escalar alertas:', err);
        }
        try {
            const enviados = await enviarResumosDiarios();
            if (enviados > 0) console.log(`[scheduler] Resumo da agenda enviado a ${enviados} pessoa(s).`);
        } catch (err) {
            console.error('[scheduler] Falha ao enviar o resumo da agenda:', err.message);
        }
        try {
            await talvezSincronizar();
        } catch (err) {
            console.error('[scheduler] Falha na sincronizacao agendada:', err.message);
        }
    });
    console.log('[scheduler] Relogio de hora em hora iniciado (escalonamento + resumo da agenda + sync conforme Configuracoes > Integracao); fila de e-mails a cada minuto.');
}

module.exports = { iniciarScheduler };
