const { buscarPorNumeros } = require('../datajud/client');
const { tribunalDoNumero } = require('../util/cnj');
const { horaLocalSaoPauloParaUtc } = require('../util/fuso');

/**
 * Fonte de dados: API publica do DataJud/CNJ.
 *
 * Consulta processos pelos numeros cadastrados. Nao traz partes (Portaria CNJ 160/2020) e nao
 * permite descobrir processos novos do Municipio — so acompanha os que ja foram cadastrados.
 * Os dados do DataJud tem defasagem (atualizacao periodica pelos tribunais), por isso o MNI e o
 * caminho para dados mais proximos do tempo real.
 */

/**
 * dataAjuizamento vem como "YYYYMMDDHHmmss" (ou ISO em alguns tribunais). Formato sujo -> null.
 */
function parseDataAjuizamento(raw) {
    if (!raw) return null;
    const s = String(raw);
    const data = /^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null;
}

/**
 * Junta os documentos de um mesmo numero (um por grau) em um registro so: metadados do documento
 * atualizado mais recentemente, movimentos de todos os graus.
 */
function consolidar(documentos, tribunalAlias) {
    const ordenados = [...documentos].sort((a, b) =>
        String(b.dataHoraUltimaAtualizacao || '').localeCompare(String(a.dataHoraUltimaAtualizacao || ''))
    );
    const principal = ordenados[0];
    const graus = [...new Set(documentos.map((d) => d.grau).filter(Boolean))].sort();
    return {
        numeroProcesso: principal.numeroProcesso,
        tribunal: tribunalAlias,
        grau: principal.grau || null,
        graus: graus.join(', ') || null,
        classeNome: principal.classe?.nome || null,
        orgaoJulgador: principal.orgaoJulgador?.nome || null,
        dataAjuizamento: parseDataAjuizamento(principal.dataAjuizamento),
        valorCausa: principal.valorCausa ?? null,
        sistema: principal.sistema?.nome || null,
        movimentos: documentos.flatMap((d) => {
            // Movimentos com mesmo codigo e mesmo horario dentro de um documento (ex.: duas
            // intimacoes expedidas no mesmo segundo) sao lancamentos distintos: numera as repeticoes.
            // A contagem e por documento, entao o mesmo movimento repetido em outro grau continua
            // sendo o mesmo e e deduplicado.
            const contagem = new Map();
            return (d.movimentos || []).map((m) => {
                const base = `${m.codigo ?? ''}:${m.dataHora ?? ''}`;
                const ocorrencia = (contagem.get(base) || 0) + 1;
                contagem.set(base, ocorrencia);
                return {
                    codigo: m.codigo ?? null,
                    nome: m.nome || null,
                    dataHora: horaLocalSaoPauloParaUtc(m.dataHora),
                    // Chave de deduplicacao: o valor bruto da fonte (estavel entre consultas).
                    chave: m.dataHora || null,
                    ocorrencia
                };
            });
        })
    };
}

/**
 * @param {string[]} numeros numeros CNJ (20 digitos)
 * @returns {Promise<{encontrados: Map<string, object>, erros: Array<{tribunal: string, erro: string}>}>}
 */
async function consultarProcessos(numeros) {
    const apiKey = process.env.DATAJUD_API_KEY;
    if (!apiKey) throw new Error('DATAJUD_API_KEY nao configurada no .env');

    const porTribunal = new Map();
    for (const numero of numeros) {
        const alias = tribunalDoNumero(numero);
        if (!alias) continue;
        if (!porTribunal.has(alias)) porTribunal.set(alias, []);
        porTribunal.get(alias).push(numero);
    }

    const encontrados = new Map();
    const erros = [];
    for (const [alias, lista] of porTribunal) {
        try {
            const documentos = await buscarPorNumeros({ tribunalAlias: alias, numeros: lista, apiKey });
            const agrupados = new Map();
            for (const doc of documentos) {
                if (!doc.numeroProcesso) continue;
                if (!agrupados.has(doc.numeroProcesso)) agrupados.set(doc.numeroProcesso, []);
                agrupados.get(doc.numeroProcesso).push(doc);
            }
            for (const [numero, docs] of agrupados) encontrados.set(numero, consolidar(docs, alias));
        } catch (err) {
            console.error(`[fonte:datajud] Falha ao consultar ${alias}:`, err.message);
            erros.push({ tribunal: alias, erro: err.message });
        }
    }
    return { encontrados, erros };
}

module.exports = {
    nome: 'datajud',
    rotulo: 'DataJud — API pública do CNJ',
    async disponivel() {
        return Boolean(process.env.DATAJUD_API_KEY);
    },
    consultarProcessos,
    descobrirProcessos: null
};
