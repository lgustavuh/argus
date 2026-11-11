const crypto = require('crypto');

/**
 * Cifra simetrica (AES-256-GCM) para os valores sensiveis guardados na tabela `configuracoes`
 * (senha SMTP, senha do MNI). A chave vem de ENCRYPTION_KEY (64 caracteres hexadecimais = 32 bytes)
 * e e separada do JWT_SECRET de proposito: trocar a chave de sessao nao pode inutilizar as senhas
 * ja salvas. Se ENCRYPTION_KEY for trocada, as senhas salvas precisam ser cadastradas de novo.
 */
const PREFIXO = 'enc:v1:';

function obterChave() {
    const hex = process.env.ENCRYPTION_KEY || '';
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
    return Buffer.from(hex, 'hex');
}

function cifragemDisponivel() {
    return obterChave() !== null;
}

function cifrar(texto) {
    const chave = obterChave();
    if (!chave) throw new Error('ENCRYPTION_KEY ausente ou invalida — nao e possivel salvar valores sensiveis.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv);
    const cifrado = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIXO}${iv.toString('base64')}:${tag.toString('base64')}:${cifrado.toString('base64')}`;
}

function decifrar(valor) {
    if (!valor) return '';
    if (!valor.startsWith(PREFIXO)) return '';
    const chave = obterChave();
    if (!chave) return '';
    try {
        const [ivB64, tagB64, dadosB64] = valor.slice(PREFIXO.length).split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(dadosB64, 'base64')), decipher.final()]).toString('utf8');
    } catch (err) {
        console.error('[cripto] Nao foi possivel decifrar um valor salvo (ENCRYPTION_KEY trocada?)');
        return '';
    }
}

module.exports = { cifrar, decifrar, cifragemDisponivel };
