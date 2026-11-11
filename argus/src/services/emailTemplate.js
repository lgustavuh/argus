/**
 * Modelo visual dos e-mails do Argus. HTML de e-mail precisa ser "antigo": tabelas, estilos inline
 * e cores em hexadecimal — Outlook e Gmail ignoram CSS moderno (variaveis, oklch, flex).
 * A aparencia vem de Configuracoes > E-mail (cabecalho, cor, prefixo do assunto, rodape).
 * Sempre gera tambem a versao texto puro, que melhora a entrega e a leitura em celulares simples.
 */

const COR_PADRAO = '#1f5aa6';

function esc(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function corValida(cor) {
    return /^#[0-9a-fA-F]{6}$/.test(cor || '') ? cor : COR_PADRAO;
}

// Faixa de destaque por tipo de mensagem (mesma semantica das cores de status do sistema).
const DESTAQUES = {
    novo: { cor: '#c2410c', fundo: '#fff4ed', rotulo: 'Nova movimentação' },
    escalado: { cor: '#7e22ce', fundo: '#f7f0fd', rotulo: 'Alerta escalado' },
    teste: { cor: '#15803d', fundo: '#effaf3', rotulo: 'Mensagem de teste' },
    agenda: { cor: '#1f4f96', fundo: '#eef3fb', rotulo: 'Agenda' },
    atribuido: { cor: '#1f4f96', fundo: '#eef3fb', rotulo: 'Compromisso atribuído a você' }
};

function linhaInfo(rotulo, valor, mono = false) {
    if (!valor) return '';
    const fonte = mono ? "font-family:Consolas,'Courier New',monospace;" : '';
    return `<tr>
        <td style="padding:6px 0;width:150px;vertical-align:top;color:#64748b;font-size:13px;">${esc(rotulo)}</td>
        <td style="padding:6px 0;vertical-align:top;color:#1e293b;font-size:14px;${fonte}">${esc(valor)}</td>
    </tr>`;
}

/**
 * @param {object} p
 * @param {'novo'|'escalado'|'teste'|'agenda'|'atribuido'} p.tipo
 * @param {object} p.aparencia  { cabecalho, cor, prefixo, rodape, linkOrigem }
 * @param {string} p.titulo     frase principal
 * @param {string} p.texto      paragrafo explicativo
 * @param {Array<[string,string,boolean?]>} p.infos  linhas rotulo/valor(/mono)
 * @param {{texto:string,url:string}} [p.botao]
 * @param {{texto:string,url:string}} [p.linkSecundario]
 * @param {string} p.assunto    assunto sem prefixo
 */
function montarEmail({ tipo, aparencia, titulo, texto, infos = [], botao, linkSecundario, assunto }) {
    const cor = corValida(aparencia.cor);
    const destaque = DESTAQUES[tipo] || DESTAQUES.novo;
    const prefixo = (aparencia.prefixo || '').trim();
    const subject = prefixo ? `${prefixo} ${assunto}` : assunto;
    const mostrarSecundario = linkSecundario && aparencia.linkOrigem !== false;

    const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef2f7;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(titulo)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #dbe2ea;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
    <tr><td style="background:${cor};padding:18px 28px;">
      <div style="color:#ffffff;font-size:17px;font-weight:600;line-height:1.3;">${esc(aparencia.cabecalho || 'Argus')}</div>
      <div style="color:#ffffff;opacity:0.8;font-size:12px;margin-top:2px;">Argus · acompanhamento processual</div>
    </td></tr>
    <tr><td style="background:${destaque.fundo};border-bottom:1px solid #e5e9ef;padding:10px 28px;">
      <span style="color:${destaque.cor};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${esc(destaque.rotulo)}</span>
    </td></tr>
    <tr><td style="padding:26px 28px 8px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;color:#0f172a;font-weight:600;">${esc(titulo)}</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#334155;">${esc(texto)}</p>
      ${infos.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e9ef;border-bottom:1px solid #e5e9ef;margin:0 0 22px;">
        <tr><td style="padding:8px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${infos.map(([r, v, m]) => linhaInfo(r, v, m)).join('')}</table></td></tr>
      </table>` : ''}
      ${botao ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr>
        <td style="border-radius:6px;background:${cor};">
          <a href="${esc(botao.url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">${esc(botao.texto)}</a>
        </td></tr></table>` : ''}
      ${mostrarSecundario ? `<p style="margin:0 0 18px;font-size:13px;"><a href="${esc(linkSecundario.url)}" style="color:${cor};">${esc(linkSecundario.texto)}</a></p>` : ''}
    </td></tr>
    <tr><td style="padding:16px 28px 22px;border-top:1px solid #e5e9ef;">
      <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">${esc(aparencia.rodape || '').replace(/\n/g, '<br>')}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

    const text = [
        aparencia.cabecalho || 'Argus',
        `${destaque.rotulo.toUpperCase()}`,
        '',
        titulo,
        '',
        texto,
        '',
        ...infos.filter(([, v]) => v).map(([r, v]) => `${r}: ${v}`),
        '',
        botao ? `${botao.texto}: ${botao.url}` : '',
        mostrarSecundario ? `${linkSecundario.texto}: ${linkSecundario.url}` : '',
        '',
        '--',
        aparencia.rodape || ''
    ].filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');

    return { subject, html, text };
}

module.exports = { montarEmail, corValida, COR_PADRAO };
