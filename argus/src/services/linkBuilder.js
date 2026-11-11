/**
 * Geracao do link de consulta publica do TJMG.
 *
 * - O sistema (PJe x eproc) vem de `sistema.nome` do DataJud, ou do que a Procuradoria informou
 *   manualmente no processo (processos.sistema_informado), que tem prioridade.
 * - Quando o DataJud nao sabe (sistema "Inválido", comum em autos fisicos e em processos convertidos
 *   recentemente), NAO adivinhamos: nao ha link unico e a tela oferece PJe e eproc lado a lado.
 *   Exemplo real (out/2026): 0279389-66.2009.8.13.0529 tramita no PJe, mas o DataJud informa
 *   "Inválido"/"Físico" nos tres documentos do numero; o palpite antigo (1o grau -> eproc) errava.
 * - PJe 1o grau: https://pje-consulta-publica.tjmg.jus.br/pje/ConsultaPublica/listView.seam
 * - PJe 2o grau/recursal: https://pjerecursal.tjmg.jus.br/pje/ConsultaPublica/listView.seam
 * - eproc 1o grau: https://eproc-consulta-publica-1g.tjmg.jus.br/eproc/externo_controlador.php
 *   (o formulario publico do eproc exige CAPTCHA; pode ser preciso colar o numero manualmente).
 */

const PJE_1G_BASE = 'https://pje-consulta-publica.tjmg.jus.br/pje/ConsultaPublica/listView.seam';
const PJE_RECURSAL_BASE = 'https://pjerecursal.tjmg.jus.br/pje/ConsultaPublica/listView.seam';
const EPROC_1G_BASE = 'https://eproc-consulta-publica-1g.tjmg.jus.br/eproc/externo_controlador.php';

const SISTEMAS_CONHECIDOS = { pje: 'PJe', eproc: 'eproc' };

function isSegundoGrau(grau) {
    if (!grau) return false;
    const g = String(grau).trim().toUpperCase();
    return g === 'G2' || g === '2' || g === '2G' || g === 'SEGUNDO GRAU';
}

/** 'pje' | 'eproc' | null a partir de um nome livre ("PJe", "eproc", "Inválido"...). */
function normalizarSistema(sistema) {
    const s = String(sistema || '').toLowerCase();
    if (s.includes('pje')) return 'pje';
    if (s.includes('eproc')) return 'eproc';
    return null;
}

function linkPje({ numeroProcesso, grau }) {
    const base = isSegundoGrau(grau) ? PJE_RECURSAL_BASE : PJE_1G_BASE;
    return `${base}?${new URLSearchParams({ numeroProcesso }).toString()}`;
}

function linkEproc({ numeroProcesso }) {
    return `${EPROC_1G_BASE}?${new URLSearchParams({ acao: 'processo_consulta_publica', num_processo: numeroProcesso }).toString()}`;
}

/**
 * Link unico, ou null quando o sistema e desconhecido (ou o tribunal ainda nao e suportado).
 */
function buildLinkConsultaPublica({ numeroProcesso, tribunal, grau, sistema }) {
    if ((tribunal || '').toLowerCase() !== 'tjmg') return null; // TRF6/TRT3 ainda nao validados
    const s = normalizarSistema(sistema);
    if (s === 'pje') return linkPje({ numeroProcesso, grau });
    if (s === 'eproc') return linkEproc({ numeroProcesso });
    return null;
}

/**
 * Opcoes para quando o sistema e desconhecido: a tela mostra as duas.
 */
function linksAlternativos({ numeroProcesso, tribunal, grau }) {
    if ((tribunal || '').toLowerCase() !== 'tjmg') return [];
    return [
        { sistema: 'pje', rotulo: 'PJe', url: linkPje({ numeroProcesso, grau }) },
        { sistema: 'eproc', rotulo: 'eproc', url: linkEproc({ numeroProcesso }) }
    ];
}

module.exports = { buildLinkConsultaPublica, linksAlternativos, normalizarSistema, SISTEMAS_CONHECIDOS };
