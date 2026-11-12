const configuracoes = require('../services/configuracoes');

/**
 * Fonte de dados: MNI (Modelo Nacional de Interoperabilidade — Resolucao CNJ 185/2013) do TJMG.
 *
 * ESTADO: aguardando credenciamento. Este arquivo ja define o contrato que o resto do sistema usa,
 * para que a troca DataJud -> MNI seja so implementar as duas funcoes abaixo e escolher "MNI" em
 * Configuracoes > Integracao. Nada fora de src/fontes/ precisa mudar.
 *
 * O que implementar quando o TJMG liberar o acesso (servico SOAP, WSDL informado pelo tribunal,
 * autenticacao por idConsultante/senhaConsultante e/ou certificado ICP-Brasil):
 *
 * 1. consultarProcessos(numeros) -> operacao `consultarProcesso` (MNI 2.2.x), com
 *    movimentos=true e incluirCabecalho=true, uma chamada por numero. Converter a resposta para o
 *    mesmo formato que src/fontes/datajud.js devolve:
 *      { numeroProcesso, tribunal, grau, graus, classeNome, orgaoJulgador, dataAjuizamento,
 *        valorCausa, sistema, movimentos: [{ codigo, nome, dataHora }] }
 *    (codigo = movimentoNacional.codigoNacional da TPU; o MNI tambem traz polos/partes, que podem
 *    ser usados para confirmar que o Municipio — CNPJ 23.767.031/0001-78 — e parte.)
 *
 * 2. descobrirProcessos() -> operacao `consultarAvisosPendentes`: lista as citacoes/intimacoes
 *    pendentes dirigidas ao Municipio. E isso que permite descobrir processos NOVOS sem cadastro
 *    manual: devolver os numeros CNJ e o sync os cadastra automaticamente (origem 'mni_aviso').
 *    PROIBIDO chamar `consultarTeorComunicacao`: abrir o teor pode CONTAR COMO CIENCIA da intimacao
 *    no tribunal. O Argus so lista avisos e leva o procurador ao PJe/eproc (PRD §4, decisao de
 *    12/11/2026). Do aviso basta a data de disponibilizacao, para mostrar quando ocorre a ciencia tacita.
 */

async function carregarCredenciais() {
    const mni = await configuracoes.lerGrupo('mni');
    return { wsdlUrl: mni.wsdl_url, idConsultante: mni.id_consultante, senhaConsultante: mni.senha_consultante };
}

function naoImplementado() {
    throw new Error('Integração MNI ainda não implementada — aguardando credenciamento junto ao TJMG. Use a fonte DataJud.');
}

module.exports = {
    nome: 'mni',
    rotulo: 'MNI — TJMG (aguardando credenciamento)',
    // So o TJMG: os demais tribunais continuam no DataJud (PRD MEL-19).
    tribunais: ['tjmg'],
    implementado: false,
    async disponivel() {
        const cred = await carregarCredenciais();
        return Boolean(module.exports.implementado && cred.wsdlUrl && cred.idConsultante && cred.senhaConsultante);
    },
    async consultarProcessos(/* numeros */) {
        naoImplementado();
    },
    async descobrirProcessos() {
        naoImplementado();
    }
};
