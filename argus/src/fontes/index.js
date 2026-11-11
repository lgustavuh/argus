const configuracoes = require('../services/configuracoes');
const datajud = require('./datajud');
const mni = require('./mni');

/**
 * Registro das fontes de dados de processos. Toda fonte segue o mesmo contrato:
 *   nome, rotulo, disponivel(), consultarProcessos(numeros), descobrirProcessos (funcao ou null)
 * O sync (services/reconciliation.js) so conversa com a fonte por este contrato.
 */
const FONTES = { datajud, mni };

async function fonteAtiva() {
    const nome = await configuracoes.ler('sync.fonte');
    return FONTES[nome] || datajud;
}

function listarFontes() {
    return Object.values(FONTES).map((f) => ({ nome: f.nome, rotulo: f.rotulo, implementado: f.implementado !== false }));
}

module.exports = { FONTES, fonteAtiva, listarFontes };
