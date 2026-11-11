const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { formatar } = require('../util/cnj');
const { hojeSP, fmtDia } = require('../util/datas');

/**
 * Arquivos anexados ficam em DOCUMENTOS_DIR (no Docker, o volume ./documentos), com nome aleatorio
 * — o nome original so existe no banco. Assim nenhum nome enviado pelo usuario chega ao disco.
 */
const DIR = process.env.DOCUMENTOS_DIR || path.join(__dirname, '..', '..', 'documentos');
const TAMANHO_MAXIMO = 25 * 1024 * 1024;

// Tipos aceitos. O Content-Type do download vem desta lista (pela extensao), nunca do que o
// navegador informou no envio. HTML/SVG ficam de fora: seriam executaveis no navegador.
const TIPOS = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    odt: 'application/vnd.oasis.opendocument.text',
    rtf: 'application/rtf',
    txt: 'text/plain; charset=utf-8',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    csv: 'text/csv; charset=utf-8',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    eml: 'message/rfc822',
    msg: 'application/vnd.ms-outlook'
};

const RE_ARQUIVO = /^[a-f0-9]{32}\.[a-z0-9]{2,5}$/;

function extensao(nome) {
    const m = /\.([a-z0-9]{2,5})$/i.exec(String(nome || ''));
    return m ? m[1].toLowerCase() : '';
}

function garantirDiretorio() {
    fs.mkdirSync(DIR, { recursive: true });
}

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            try {
                garantirDiretorio();
                cb(null, DIR);
            } catch (err) {
                cb(err);
            }
        },
        filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}.${extensao(file.originalname)}`)
    }),
    // Navegadores enviam o nome do arquivo em UTF-8 sem declarar o charset; o padrao (latin1) estragaria acentos.
    defParamCharset: 'utf8',
    limits: { fileSize: TAMANHO_MAXIMO, files: 1, fields: 10 },
    fileFilter: (req, file, cb) => {
        if (TIPOS[extensao(file.originalname)]) return cb(null, true);
        const err = new Error('tipo');
        err.code = 'TIPO_NAO_PERMITIDO';
        return cb(err);
    }
});

/**
 * Middleware de envio de um arquivo (campo "arquivo"). Erros de envio viram req.erroUpload (texto
 * para o usuario) em vez de erro 500.
 */
function receberArquivo(req, res, next) {
    upload.single('arquivo')(req, res, (err) => {
        if (err) {
            if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {});
            if (err.code === 'LIMIT_FILE_SIZE') req.erroUpload = `Arquivo maior que ${TAMANHO_MAXIMO / 1024 / 1024} MB.`;
            else if (err.code === 'TIPO_NAO_PERMITIDO') req.erroUpload = `Tipo de arquivo não aceito. Envie: ${Object.keys(TIPOS).join(', ')}.`;
            else return next(err);
        }
        next();
    });
}

function caminho(arquivo) {
    if (!RE_ARQUIVO.test(arquivo)) throw new Error('Nome de arquivo inválido');
    return path.join(DIR, arquivo);
}

function tipoDe(nomeOriginal) {
    return TIPOS[extensao(nomeOriginal)] || 'application/octet-stream';
}

async function apagarArquivo(arquivo) {
    await fs.promises.rm(caminho(arquivo), { force: true });
}

// Nome original para exibir e para o download (sem barras nem quebras de linha).
function nomeOriginal(file) {
    return path.basename(String(file.originalname)).replace(/[\\/\0\r\n]/g, '_').slice(0, 255);
}

// ---------- Modelos ----------

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function porExtenso(dia) {
    const [a, m, d] = dia.split('-').map(Number);
    return `${d === 1 ? '1º' : d} de ${MESES[m - 1]} de ${a}`;
}

function moeda(valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Campos disponiveis nos modelos: {{chave}} -> descricao (exibida na tela de edicao do modelo).
const CAMPOS = {
    numero_processo: 'Número do processo (formato CNJ)',
    classe: 'Classe processual',
    orgao_julgador: 'Órgão julgador (vara)',
    tribunal: 'Tribunal',
    valor_causa: 'Valor da causa',
    data_ajuizamento: 'Data do ajuizamento',
    caso: 'Título do caso',
    caso_referencia: 'Referência do caso (procedimento, protocolo)',
    interessado: 'Interessado do caso',
    responsavel: 'Responsável pelo processo/caso',
    usuario: 'Quem está gerando o documento',
    data_hoje: 'Data de hoje (29/10/2026)',
    data_extenso: 'Data de hoje por extenso (29 de outubro de 2026)'
};

function dadosParaModelo({ processo, caso, usuario }) {
    const hoje = hojeSP();
    return {
        numero_processo: processo ? formatar(processo.numero_processo) : '',
        classe: processo?.classe_nome || '',
        orgao_julgador: processo?.orgao_julgador || '',
        tribunal: processo?.tribunal ? processo.tribunal.toUpperCase() : '',
        valor_causa: moeda(processo?.valor_causa),
        data_ajuizamento: processo?.data_ajuizamento ? fmtDia(processo.data_ajuizamento) : '',
        caso: caso?.titulo || '',
        caso_referencia: caso?.referencia || '',
        interessado: caso?.interessado || '',
        responsavel: (caso ? caso.responsavel_nome : processo?.procurador_nome) || '',
        usuario: usuario?.nome || '',
        data_hoje: fmtDia(hoje),
        data_extenso: porExtenso(hoje)
    };
}

/**
 * Troca {{campo}} pelos valores. Campo vazio vira "[campo não informado]" — fica visivel para quem
 * revisa o texto, em vez de sumir sem aviso. Marcador desconhecido fica como esta.
 */
function preencher(conteudo, dados) {
    const vazios = new Set();
    const texto = String(conteudo).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (inteiro, chave) => {
        if (!(chave in dados)) return inteiro;
        if (!dados[chave]) {
            vazios.add(chave);
            return `[${CAMPOS[chave] || chave} não informado]`;
        }
        return dados[chave];
    });
    return { texto, vazios: [...vazios] };
}

function esc(t) {
    return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Documento .doc (HTML que o Word abre e salva como .docx). Paragrafos vem das linhas do texto.
 */
function montarDoc(titulo, texto) {
    const paragrafos = texto
        .split(/\n/)
        .map((l) => (l.trim() ? `<p>${esc(l)}</p>` : '<p>&nbsp;</p>'))
        .join('\n');
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>@page { size: 21cm 29.7cm; margin: 3cm 2cm 2cm 3cm; } body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; } p { margin: 0 0 6pt; text-align: justify; }</style>
</head><body>
${paragrafos}
</body></html>`;
}

module.exports = {
    DIR,
    TIPOS,
    TAMANHO_MAXIMO,
    CAMPOS,
    receberArquivo,
    caminho,
    tipoDe,
    apagarArquivo,
    nomeOriginal,
    dadosParaModelo,
    preencher,
    montarDoc,
    garantirDiretorio
};
