const { buildQueryPorNumeros } = require('./queries');

const BASE_URL = 'https://api-publica.datajud.cnj.jus.br';
const MAX_RETRIES = 5;
const TAMANHO_LOTE = 100;
// Sem limite explicito, cada tentativa poderia esperar os 300 s padrao do undici (PRD BUG-12).
const TIMEOUT_MS = 30000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postComRetry(url, body, apiKey, tentativa = 0) {
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `APIKey ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    } catch (err) {
        // Falha de rede (timeout, conexao resetada, DNS) — nao e erro da API, vale retry.
        if (tentativa < MAX_RETRIES) {
            const espera = Math.min(2 ** tentativa * 500, 15000);
            await sleep(espera);
            return postComRetry(url, body, apiKey, tentativa + 1);
        }
        throw new Error(`Falha de rede ao chamar DataJud apos ${MAX_RETRIES} tentativas: ${err.cause?.message || err.message}`);
    }

    if (res.status === 429 && tentativa < MAX_RETRIES) {
        const espera = Math.min(2 ** tentativa * 500, 15000);
        await sleep(espera);
        return postComRetry(url, body, apiKey, tentativa + 1);
    }

    if (!res.ok) {
        const texto = await res.text().catch(() => '');
        throw new Error(`DataJud respondeu ${res.status} para ${url}: ${texto.slice(0, 300)}`);
    }

    return res.json();
}

/**
 * Busca no indice de um tribunal os documentos dos numeros informados, em lotes.
 * Devolve todos os `_source` encontrados (pode haver mais de um por numero — um por grau).
 */
async function buscarPorNumeros({ tribunalAlias, numeros, apiKey }) {
    const url = `${BASE_URL}/api_publica_${tribunalAlias}/_search`;
    const documentos = [];
    for (let i = 0; i < numeros.length; i += TAMANHO_LOTE) {
        const lote = numeros.slice(i, i + TAMANHO_LOTE);
        const resposta = await postComRetry(url, buildQueryPorNumeros(lote), apiKey);
        for (const hit of resposta?.hits?.hits || []) documentos.push(hit._source);
    }
    return documentos;
}

module.exports = { buscarPorNumeros };
