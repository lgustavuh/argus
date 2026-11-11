const nodemailer = require('nodemailer');
const configuracoes = require('./configuracoes');

/**
 * Envio de e-mail com a configuracao SMTP salva em Configuracoes > E-mail.
 * Enquanto o e-mail estiver desativado (ou sem servidor), as mensagens so sao registradas no log —
 * os alertas continuam aparecendo normalmente dentro do sistema.
 */
async function obterConfig() {
    const email = await configuracoes.lerGrupo('email');
    return {
        ativo: email.ativo === 'true',
        host: email.smtp_host,
        porta: Number(email.smtp_porta) || 587,
        usuario: email.smtp_usuario,
        senha: email.smtp_senha,
        remetente: email.remetente,
        nomeRemetente: email.nome_remetente,
        fallback: email.fallback
    };
}

function criarTransporter(cfg) {
    return nodemailer.createTransport({
        host: cfg.host,
        port: cfg.porta,
        secure: cfg.porta === 465, // 465 = SSL direto; 587/25 = STARTTLS quando o servidor oferece
        auth: cfg.usuario ? { user: cfg.usuario, pass: cfg.senha } : undefined,
        connectionTimeout: 15000
    });
}

/**
 * @returns {Promise<{ok: boolean, motivo?: string}>}
 */
async function enviarEmail({ to, subject, html, text }, { ignorarAtivo = false } = {}) {
    const cfg = await obterConfig();
    if ((!cfg.ativo && !ignorarAtivo) || !cfg.host) {
        console.log(`[mailer] E-mail desativado — nao enviado (assunto: "${subject}", destinatario: ${to})`);
        return { ok: false, motivo: 'E-mail desativado ou sem servidor SMTP configurado.' };
    }
    try {
        const endereco = cfg.remetente || cfg.usuario;
        const from = cfg.nomeRemetente ? { name: cfg.nomeRemetente, address: endereco } : endereco;
        await criarTransporter(cfg).sendMail({ from, to, subject, html, text });
        return { ok: true };
    } catch (err) {
        console.error(`[mailer] Falha ao enviar e-mail para ${to}:`, err.message);
        return { ok: false, motivo: err.message };
    }
}

async function emailFallback() {
    return (await obterConfig()).fallback || null;
}

module.exports = { enviarEmail, emailFallback };
