const pool = require('../db/pool');

/**
 * Trilha de auditoria. Nunca grave senhas ou valores de configuracao sensiveis em `detalhes`.
 * Falha ao auditar nao derruba a operacao principal — so loga.
 */
async function registrar(req, acao, { entidade = null, entidadeId = null, detalhes = null, usuario = null } = {}) {
    const autor = usuario || req?.usuario || null;
    try {
        await pool.query(
            `INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes, ip)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                autor?.id || null,
                autor?.nome || null,
                acao,
                entidade,
                entidadeId === null || entidadeId === undefined ? null : String(entidadeId),
                detalhes ? JSON.stringify(detalhes) : null,
                req?.ip || null
            ]
        );
    } catch (err) {
        console.error(`[auditoria] Falha ao registrar "${acao}":`, err.message);
    }
}

async function listar({ limit = 50, offset = 0 } = {}) {
    const [{ rows }, total] = await Promise.all([
        pool.query('SELECT * FROM auditoria ORDER BY criado_em DESC, id DESC LIMIT $1 OFFSET $2', [limit, offset]),
        pool.query('SELECT COUNT(*)::int AS total FROM auditoria')
    ]);
    return { registros: rows, total: total.rows[0].total };
}

async function listarPorEntidade(entidade, entidadeId, limit = 50) {
    const { rows } = await pool.query(
        `SELECT * FROM auditoria WHERE entidade = $1 AND entidade_id = $2 ORDER BY criado_em DESC LIMIT $3`,
        [entidade, String(entidadeId), limit]
    );
    return rows;
}

const ROTULOS_ACAO = {
    login: 'Login',
    login_falha: 'Tentativa de login recusada',
    login_bloqueado: 'Login bloqueado (excesso de tentativas)',
    logout: 'Logout',
    senha_alterada: 'Alterou a própria senha',
    alerta_visualizado: 'Visualizou alerta',
    alerta_ciencia: 'Deu ciência em alerta',
    processo_cadastrado: 'Cadastrou processo',
    processos_importados: 'Importou processos em lote',
    processo_arquivado: 'Arquivou processo',
    processo_reativado: 'Reativou processo',
    processo_responsavel: 'Alterou responsável do processo',
    processo_observacao: 'Alterou observação do processo',
    processo_sistema: 'Informou o sistema do processo',
    compromisso_criado: 'Lançou compromisso na agenda',
    compromisso_alterado: 'Alterou compromisso da agenda',
    compromisso_concluido: 'Concluiu compromisso da agenda',
    compromisso_cancelado: 'Cancelou compromisso da agenda',
    compromisso_reaberto: 'Reabriu compromisso da agenda',
    processo_etiquetas: 'Alterou etiquetas do processo',
    caso_criado: 'Cadastrou caso',
    caso_alterado: 'Alterou caso',
    caso_encerrado: 'Encerrou caso',
    caso_reaberto: 'Reabriu caso',
    anotacao_criada: 'Registrou anotação',
    documento_enviado: 'Anexou documento',
    documento_excluido: 'Excluiu documento',
    modelo_criado: 'Criou modelo de documento',
    modelo_alterado: 'Alterou modelo de documento',
    modelo_gerado: 'Gerou documento a partir de modelo',
    sync_manual: 'Disparou sincronização manual',
    config_alterada: 'Alterou configurações',
    email_teste: 'Enviou e-mail de teste',
    tpu_salvo: 'Salvou código TPU',
    tpu_removido: 'Removeu código TPU',
    usuario_criado: 'Criou usuário',
    usuario_papel: 'Alterou perfil de usuário',
    usuario_ativo: 'Ativou/desativou usuário',
    usuario_senha_redefinida: 'Redefiniu senha de usuário',
    setup_admin: 'Criou o administrador inicial'
};

module.exports = { registrar, listar, listarPorEntidade, ROTULOS_ACAO };
