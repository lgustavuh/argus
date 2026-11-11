const { cifragemDisponivel } = require('../util/cripto');

const SEGREDOS_DE_EXEMPLO = ['troque-esta-chave-em-producao', 'changeme', 'secret'];
const JWT_MIN_CARACTERES = 64; // 64 hex = 256 bits, o minimo recomendado para HS256 (RFC 7518 §3.2)

/**
 * Verifica a configuracao de seguranca no start. Em producao, um JWT_SECRET fraco impede a
 * aplicacao de subir — com ele, qualquer um poderia forjar um login de admin.
 */
function verificarConfiguracaoSeguranca() {
    const problemas = [];
    const segredo = process.env.JWT_SECRET || '';

    if (!segredo) problemas.push('JWT_SECRET nao definido.');
    else if (SEGREDOS_DE_EXEMPLO.includes(segredo)) problemas.push('JWT_SECRET ainda esta com o valor de exemplo.');
    else if (segredo.length < JWT_MIN_CARACTERES) {
        problemas.push(`JWT_SECRET muito curto (${segredo.length} caracteres; minimo ${JWT_MIN_CARACTERES}).`);
    }

    if (problemas.length) {
        const mensagem = `${problemas.join(' ')} Gere um novo com: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`;
        if (process.env.NODE_ENV === 'production') throw new Error(mensagem);
        console.warn(`[seguranca] AVISO: ${mensagem}`);
    }

    if (!cifragemDisponivel()) {
        console.warn('[seguranca] ENCRYPTION_KEY ausente/invalida — senhas de SMTP/MNI nao poderao ser salvas pela tela de Configuracoes.');
    }
}

/**
 * Resumo exibido em Configuracoes > Geral (sem revelar nenhum valor).
 */
function statusSeguranca() {
    const segredo = process.env.JWT_SECRET || '';
    return {
        jwtForte: segredo.length >= JWT_MIN_CARACTERES && !SEGREDOS_DE_EXEMPLO.includes(segredo),
        cifragemDisponivel: cifragemDisponivel(),
        cookieSeguro: process.env.COOKIE_SECURE === 'true',
        datajudChaveConfigurada: Boolean(process.env.DATAJUD_API_KEY)
    };
}

module.exports = { verificarConfiguracaoSeguranca, statusSeguranca, JWT_MIN_CARACTERES };
