const express = require('express');

const indicadores = require('../../models/indicadores');
const { hojeSP, somarDias } = require('../../util/datas');
const { a } = require('../../util/http');

const router = express.Router();

const PERIODOS = { 30: 'últimos 30 dias', 90: 'últimos 90 dias', 365: 'últimos 12 meses' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

router.get('/', a(async (req, res) => {
    const dias = PERIODOS[req.query.dias] ? Number(req.query.dias) : 90;
    const hoje = hojeSP();
    const inicio = somarDias(hoje, -dias);
    const [prazos, alertas, porClasse, porOrgao, porResponsavel, porMes, agenda] = await Promise.all([
        indicadores.prazos(inicio, hoje),
        indicadores.alertas(new Date(Date.now() - dias * 864e5)),
        indicadores.processosPor('classe'),
        indicadores.processosPor('orgao'),
        indicadores.processosPor('responsavel'),
        indicadores.movimentosRelevantesPorMes(hoje),
        indicadores.agendaPorResponsavel(hoje)
    ]);
    const concluidos = prazos.no_prazo + prazos.apos_prazo;
    res.render('indicadores', {
        dias,
        PERIODOS,
        prazos,
        pctNoPrazo: concluidos ? Math.round((prazos.no_prazo / concluidos) * 100) : null,
        alertas,
        pctCiencia: alertas.criados ? Math.round((alertas.com_ciencia / alertas.criados) * 100) : null,
        porClasse,
        porOrgao,
        porResponsavel,
        porMes: porMes.map((m) => ({ ...m, rotulo: `${MESES[Number(m.mes.slice(5)) - 1]}/${m.mes.slice(2, 4)}` })),
        agenda
    });
}));

module.exports = router;
