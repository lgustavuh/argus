const POR_PAGINA_PADRAO = 50;

/**
 * Le ?pagina= da query string e devolve limit/offset para o model, mais um helper para montar
 * os links de navegacao preservando os demais filtros.
 */
function lerPaginacao(req, porPagina = POR_PAGINA_PADRAO) {
    const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
    return { pagina, porPagina, limit: porPagina, offset: (pagina - 1) * porPagina };
}

function montarPaginacao(req, { pagina, porPagina }, total) {
    const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
    const linkPara = (p) => {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(req.query)) {
            if (k !== 'pagina' && v !== undefined && v !== '') params.set(k, v);
        }
        if (p > 1) params.set('pagina', p);
        const qs = params.toString();
        return qs ? `${req.path}?${qs}` : req.path;
    };
    return {
        pagina,
        totalPaginas,
        total,
        anterior: pagina > 1 ? linkPara(pagina - 1) : null,
        proxima: pagina < totalPaginas ? linkPara(pagina + 1) : null
    };
}

module.exports = { lerPaginacao, montarPaginacao, POR_PAGINA_PADRAO };
