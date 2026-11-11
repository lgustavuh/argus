const express = require('express');

const alertasModel = require('../../models/alertas');
const compromissosModel = require('../../models/compromissos');
const { hojeSP } = require('../../util/datas');
const auditoria = require('../../services/auditoria');
const { requirePermissao } = require('../../middleware/auth');
const { pode } = require('../../config/papeis');
const { lerPaginacao, montarPaginacao } = require('../../util/paginacao');
const { a, comMsg } = require('../../util/http');

const router = express.Router();

const STATUS_VALIDOS = ['abertos', 'pendente', 'visualizado', 'escalado', 'ciente'];

router.get('/', a(async (req, res) => {
    const status = STATUS_VALIDOS.includes(req.query.status) ? req.query.status : null;
    const pag = lerPaginacao(req);
    const { alertas, total } = await alertasModel.list({ status }, pag);
    res.render('alertas', {
        alertas,
        statusAtual: status,
        paginacao: montarPaginacao(req, pag, total),
        msg: req.query.msg
    });
}));

/**
 * Abrir o alerta registra a visualizacao — mas so para quem pode agir sobre ele
 * (procurador/advogado/admin). A assistente juridica consulta sem alterar o status.
 */
router.get('/:id', a(async (req, res) => {
    let alerta = await alertasModel.findById(req.params.id);
    if (!alerta) return res.status(404).render('erro', { titulo: 'Não encontrado', mensagem: 'Alerta não encontrado.' });

    if (alerta.status === 'pendente' && pode(req.usuario.papel, 'darCiencia')) {
        if (await alertasModel.marcarVisualizado(alerta.id, req.usuario.id)) {
            await auditoria.registrar(req, 'alerta_visualizado', { entidade: 'alerta', entidadeId: alerta.id });
            alerta = await alertasModel.findById(alerta.id);
        }
    }
    const [historico, compromissos] = await Promise.all([
        auditoria.listarPorEntidade('alerta', alerta.id),
        compromissosModel.listPorAlerta(alerta.id)
    ]);
    res.render('alerta_detalhe', { alerta, historico, compromissos, hoje: hojeSP(), msg: req.query.msg });
}));

router.post('/:id/ciencia', requirePermissao('darCiencia'), a(async (req, res) => {
    const alerta = await alertasModel.marcarCiente(req.params.id, req.usuario.id);
    if (!alerta) return res.redirect(comMsg(`/alertas/${req.params.id}`, 'Este alerta já estava com ciência confirmada.'));
    await auditoria.registrar(req, 'alerta_ciencia', { entidade: 'alerta', entidadeId: alerta.id });
    res.redirect(comMsg(`/alertas/${alerta.id}`, 'Ciência registrada.'));
}));

module.exports = router;
