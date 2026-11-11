const express = require('express');

const alertasModel = require('../../models/alertas');
const processosModel = require('../../models/processos');
const compromissosModel = require('../../models/compromissos');
const { PAPEIS_RESPONSAVEIS } = require('../../config/papeis');
const { hojeSP, somarDias } = require('../../util/datas');
const configuracoes = require('../../services/configuracoes');
const auditoria = require('../../services/auditoria');
const { sincronizar, syncEmAndamento } = require('../../services/reconciliation');
const { requirePermissao } = require('../../middleware/auth');
const { a, comMsg } = require('../../util/http');

const router = express.Router();

async function statusSync() {
    const cfg = await configuracoes.lerTudo();
    let ultimoResumo = null;
    try {
        ultimoResumo = cfg['sync.ultimo_resumo'] ? JSON.parse(cfg['sync.ultimo_resumo']) : null;
    } catch (err) {
        ultimoResumo = null;
    }
    return {
        ativo: cfg['sync.ativo'] === 'true',
        fonte: cfg['sync.fonte'],
        intervaloHoras: Number(cfg['sync.intervalo_horas']),
        ultimoEm: cfg['sync.ultimo_em'] || null,
        ultimoResumo,
        emAndamento: syncEmAndamento()
    };
}

router.get('/', (req, res) => res.redirect('/painel'));

/**
 * "Meu dia": vencidos, hoje, amanha e os proximos compromissos. Quem pode ser responsavel
 * (procurador/advogado) ve os seus por padrao; admin e assistente veem os de todos.
 */
async function meuDia(req) {
    const podeTerProprios = PAPEIS_RESPONSAVEIS.includes(req.usuario.papel);
    const escopo = req.query.agenda === 'todos' || !podeTerProprios ? 'todos' : 'meus';
    const responsavelId = escopo === 'meus' ? req.usuario.id : undefined;
    const hoje = hojeSP();
    const amanha = somarDias(hoje, 1);
    const [ateAmanha, proximos] = await Promise.all([
        compromissosModel.listAbertosAte(amanha, { responsavelId }),
        compromissosModel.proximosApos(amanha, { responsavelId, limit: 5 })
    ]);
    return {
        escopo,
        podeTerProprios,
        hoje,
        grupos: [
            { chave: 'vencidos', titulo: 'Vencidos', itens: ateAmanha.filter((c) => c.data < hoje) },
            { chave: 'hoje', titulo: 'Hoje', itens: ateAmanha.filter((c) => c.data === hoje) },
            { chave: 'amanha', titulo: 'Amanhã', itens: ateAmanha.filter((c) => c.data === amanha) },
            { chave: 'proximos', titulo: 'Próximos', itens: proximos }
        ]
    };
}

router.get('/painel', a(async (req, res) => {
    const diasSemMovimentacao = await configuracoes.lerNumero('geral.dias_sem_movimentacao');
    const [resumoAlertas, resumoProcessos, recentes, sync, dia] = await Promise.all([
        alertasModel.contarPorStatus(),
        processosModel.contarResumo({ diasSemMovimentacao }),
        alertasModel.listRecentes({ limit: 6 }),
        statusSync(),
        meuDia(req)
    ]);
    res.render('painel', { resumoAlertas, resumoProcessos, recentes, sync, dia, hoje: dia.hoje, msg: req.query.msg });
}));

// Dispara o sync em segundo plano — com muitos processos ele pode levar minutos.
router.post('/sync/run', requirePermissao('rodarSync'), a(async (req, res) => {
    const voltar = req.get('referer')?.includes('/configuracoes') ? '/configuracoes?aba=integracao' : '/painel';
    if (syncEmAndamento()) return res.redirect(comMsg(voltar, 'Já existe uma sincronização em andamento.'));
    await auditoria.registrar(req, 'sync_manual');
    sincronizar({ origem: `manual:${req.usuario.nome}` }).catch((err) => console.error('[sync manual] Falha:', err.message));
    res.redirect(comMsg(voltar, 'Sincronização iniciada. Os resultados aparecem em alguns instantes — atualize a página.'));
}));

module.exports = { router, statusSync };
