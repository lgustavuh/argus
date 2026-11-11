/**
 * Query Elasticsearch para buscar processos no DataJud pelos numeros CNJ (20 digitos, sem pontuacao).
 *
 * A API publica do DataJud NAO expoe partes processuais (nome ou CNPJ) — confirmado empiricamente,
 * por protecao de dados da Portaria CNJ 160/2020 —, entao nao ha como descobrir "todos os processos
 * do Municipio" por ela. O que funciona (validado contra a API real em outubro/2026) e consultar
 * pelos numeros que a Procuradoria ja conhece: `terms` em numeroProcesso aceita um lote de numeros
 * por requisicao. Um mesmo numero pode voltar em mais de um documento (um por grau de jurisdicao).
 */
function buildQueryPorNumeros(numeros) {
    return {
        size: Math.min(numeros.length * 4, 1000),
        query: { terms: { numeroProcesso: numeros } }
    };
}

module.exports = { buildQueryPorNumeros };
