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

// Reaproveita a conexao SMTP entre envios (a fila manda varios e-mails seguidos); se a configuracao
// mudar na tela, um transporter novo e criado.
let cache = { chave: null, transporter: null };

function criarTransporter(cfg) {
    const chave = JSON.stringify([cfg.host, cfg.porta, cfg.usuario, cfg.senha]);
    if (cache.chave === chave) return cache.transporter;
    if (cache.transporter) cache.transporter.close();
    cache = { chave, transporter: novoTransporter(cfg) };
    return cache.transporter;
}

function novoTransporter(cfg) {
    return nodemailer.createTransport({
        pool: true,
        maxConnections: 1,
        host: cfg.host,
        port: cfg.porta,
        secure: cfg.porta === 465, // 465 = SSL direto; 587/25 = STARTTLS quando o servidor oferece
        auth: cfg.usuario ? { user: cfg.usuario, pass: cfg.senha } : undefined,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000
    });
}

/**
 * Envio direto (usado pela fila de saida e pelo e-mail de teste). Para avisos, use services/outbox.
 * @returns {Promise<{ok: boolean, motivo?: string, desativado?: boolean}>}
 */
async function enviarEmail({ to, subject, html, text }, { ignorarAtivo = false } = {}) {
    const cfg = await obterConfig();
    if ((!cfg.ativo && !ignorarAtivo) || !cfg.host) {
        console.log(`[mailer] E-mail desativado — nao enviado (assunto: "${subject}", destinatario: ${to})`);
        return { ok: false, desativado: true, motivo: 'E-mail desativado ou sem servidor SMTP configurado.' };
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
