const pool = require('../db/pool');
const { cifrar, decifrar } = require('../util/cripto');

/**
 * Configuracoes do sistema editaveis pela tela (tabela `configuracoes`, chave/valor em texto).
 * Toda chave usada no codigo precisa estar em PADROES — e o valor usado enquanto ninguem salvou
 * nada na tela. Chaves em SENSIVEIS sao gravadas cifradas e nunca voltam para a tela.
 */
const PADROES = {
    'geral.dias_escalonamento': '3',
    'geral.dias_sem_movimentacao': '60',

    'agenda.lembrete_ativo': 'true',
    'agenda.dias_antecedencia': '3',
    'agenda.ultimo_lembrete_dia': '',

    'email.ativo': 'false',
    'email.smtp_host': '',
    'email.smtp_porta': '587',
    'email.smtp_usuario': '',
    'email.smtp_senha': '',
    'email.remetente': '',
    'email.fallback': '',
    'email.nome_remetente': 'Argus — Procuradoria de Itaú de Minas',
    'email.prefixo_assunto': '[Argus]',
    'email.cabecalho': 'Procuradoria-Geral do Município de Itaú de Minas',
    'email.cor': '#1f5aa6',
    'email.rodape': 'Mensagem automática do Argus, sistema de acompanhamento processual da Procuradoria-Geral do Município de Itaú de Minas/MG. Não responda este e-mail.',
    'email.link_origem': 'true',

    'sync.ativo': 'false',
    'sync.fonte': 'datajud',
    'sync.intervalo_horas': '6',
    'sync.janela_carga_inicial_dias': '15',
    'sync.ultimo_em': '',
    'sync.ultimo_resumo': '',

    'mni.wsdl_url': '',
    'mni.id_consultante': '',
    'mni.senha_consultante': '',
    'mni.observacoes': ''
};

const SENSIVEIS = new Set(['email.smtp_senha', 'mni.senha_consultante']);

// Valores iniciais vindos do .env (instalacoes anteriores ao modulo de configuracoes).
const LEGADO_ENV = {
    'geral.dias_escalonamento': 'ALERTA_DIAS_ESCALONAMENTO',
    'sync.intervalo_horas': 'DATAJUD_SYNC_INTERVAL_HOURS',
    'email.smtp_host': 'SMTP_HOST',
    'email.smtp_porta': 'SMTP_PORT',
    'email.smtp_usuario': 'SMTP_USER',
    'email.remetente': 'EMAIL_REMETENTE',
    'email.fallback': 'EMAIL_FALLBACK_PROCURADORIA'
};

async function lerTudo() {
    const { rows } = await pool.query('SELECT chave, valor FROM configuracoes');
    const salvos = new Map(rows.map((r) => [r.chave, r.valor]));
    const resultado = {};
    for (const chave of Object.keys(PADROES)) {
        if (salvos.has(chave)) resultado[chave] = salvos.get(chave);
        else if (LEGADO_ENV[chave] && process.env[LEGADO_ENV[chave]]) resultado[chave] = process.env[LEGADO_ENV[chave]];
        else resultado[chave] = PADROES[chave];
    }
    return resultado;
}

/**
 * Le varias chaves de um prefixo ja convertidas: valores sensiveis vem decifrados.
 * Uso interno (mailer, fonte MNI) — nunca passe o resultado direto para uma view.
 */
async function lerGrupo(prefixo) {
    const tudo = await lerTudo();
    const grupo = {};
    for (const [chave, valor] of Object.entries(tudo)) {
        if (!chave.startsWith(`${prefixo}.`)) continue;
        grupo[chave.slice(prefixo.length + 1)] = SENSIVEIS.has(chave) ? decifrar(valor) : valor;
    }
    return grupo;
}

/**
 * Versao segura para a tela: segredos viram apenas um booleano "ja existe valor salvo".
 */
async function lerParaTela() {
    const tudo = await lerTudo();
    const tela = {};
    for (const [chave, valor] of Object.entries(tudo)) {
        tela[chave] = SENSIVEIS.has(chave) ? Boolean(valor) : valor;
    }
    return tela;
}

async function ler(chave) {
    const tudo = await lerTudo();
    return SENSIVEIS.has(chave) ? decifrar(tudo[chave]) : tudo[chave];
}

async function lerNumero(chave) {
    const valor = Number(await ler(chave));
    return Number.isFinite(valor) ? valor : Number(PADROES[chave]);
}

async function lerBooleano(chave) {
    return (await ler(chave)) === 'true';
}

/**
 * Salva um conjunto de chaves. Para chaves sensiveis, string vazia significa "manter a atual".
 * Devolve a lista de chaves efetivamente alteradas (para a auditoria — sem valores).
 */
async function salvar(valores, usuarioId) {
    const alteradas = [];
    for (const [chave, valorBruto] of Object.entries(valores)) {
        if (!(chave in PADROES)) throw new Error(`Configuracao desconhecida: ${chave}`);
        let valor = valorBruto === undefined || valorBruto === null ? '' : String(valorBruto);
        if (SENSIVEIS.has(chave)) {
            if (!valor) continue;
            valor = cifrar(valor);
        }
        await pool.query(
            `INSERT INTO configuracoes (chave, valor, atualizado_em, atualizado_por)
             VALUES ($1, $2, NOW(), $3)
             ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW(),
                 atualizado_por = EXCLUDED.atualizado_por`,
            [chave, valor, usuarioId || null]
        );
        alteradas.push(chave);
    }
    return alteradas;
}

async function limparSegredo(chave, usuarioId) {
    if (!SENSIVEIS.has(chave)) return;
    await pool.query(
        `INSERT INTO configuracoes (chave, valor, atualizado_por) VALUES ($1, '', $2)
         ON CONFLICT (chave) DO UPDATE SET valor = '', atualizado_em = NOW(), atualizado_por = EXCLUDED.atualizado_por`,
        [chave, usuarioId || null]
    );
}

module.exports = { PADROES, lerTudo, lerGrupo, lerParaTela, ler, lerNumero, lerBooleano, salvar, limparSegredo };
