const configuracoes = require('../services/configuracoes');
const datajud = require('./datajud');
const mni = require('./mni');

/**
 * Registro das fontes de dados de processos. Toda fonte segue o mesmo contrato:
 *   nome, rotulo, tribunais (lista de aliases ou null = todos), disponivel(),
 *   consultarProcessos(numeros), descobrirProcessos (funcao ou null)
 * O sync (services/reconciliation.js) so conversa com a fonte por este contrato.
 */
const FONTES = { datajud, mni };

// Fonte para todos os tribunais que a escolhida nao atende (ex.: TRF6/TRT3 quando o TJMG usa o MNI).
const FONTE_PADRAO = datajud;

function atende(fonte, tribunal) {
    return !fonte.tribunais || fonte.tribunais.includes(tribunal);
}

/** A fonte escolhida em Configuracoes > Integracao (sync.fonte). */
async function fonteAtiva() {
    const nome = await configuracoes.ler('sync.fonte');
    return FONTES[nome] || FONTE_PADRAO;
}

/**
 * Fonte de cada tribunal (PRD MEL-19): a escolhida, onde ela atende; a padrao no resto.
 * @returns {Promise<(tribunal: string) => object>}
 */
async function roteadorDeFontes() {
    const escolhida = await fonteAtiva();
    return (tribunal) => (atende(escolhida, tribunal) ? escolhida : FONTE_PADRAO);
}

function listarFontes() {
    return Object.values(FONTES).map((f) => ({
        nome: f.nome,
        rotulo: f.rotulo,
        implementado: f.implementado !== false,
        tribunais: f.tribunais || null
    }));
}

module.exports = { FONTES, FONTE_PADRAO, fonteAtiva, roteadorDeFontes, listarFontes };
