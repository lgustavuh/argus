require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const runMigrations = require('../db/migrate');
const { gerarSenhaProvisoria } = require('../util/senha');

/**
 * Cria (ou recupera) uma conta de administrador pela linha de comando, com senha provisoria
 * aleatoria que precisa ser trocada no primeiro acesso. Serve tambem para recuperar o acesso se
 * a senha do admin for perdida — nesse caso a conta existente vira admin e recebe senha nova.
 *
 *   docker compose exec app node src/scripts/criarAdmin.js "Admin TI" ti@exemplo.gov.br
 */
async function main() {
    const [nome, emailBruto] = process.argv.slice(2);
    if (!nome || !emailBruto) {
        console.error('Uso: node src/scripts/criarAdmin.js "Nome" email@dominio');
        process.exit(1);
    }
    const email = emailBruto.toLowerCase().trim();
    await runMigrations();

    const senha = gerarSenhaProvisoria();
    const hash = await bcrypt.hash(senha, 12);
    const { rows } = await pool.query(
        `INSERT INTO usuarios (nome, email, senha_hash, papel, deve_trocar_senha, ativo)
         VALUES ($1, $2, $3, 'admin', TRUE, TRUE)
         ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, papel = 'admin',
             deve_trocar_senha = TRUE, ativo = TRUE, sessao_versao = usuarios.sessao_versao + 1
         RETURNING id, (xmax = 0) AS criado`,
        [nome, email, hash]
    );
    await pool.query(
        `INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
         VALUES ($1, 'linha de comando', $2, 'usuario', $3, $4)`,
        [rows[0].id, rows[0].criado ? 'usuario_criado' : 'usuario_senha_redefinida', String(rows[0].id), JSON.stringify({ papel: 'admin', via: 'criarAdmin.js' })]
    );

    console.log(rows[0].criado ? 'Administrador criado.' : 'Conta existente promovida a admin e com senha redefinida.');
    console.log(`  E-mail: ${email}`);
    console.log(`  Senha provisória: ${senha}`);
    console.log('  (troca obrigatória no primeiro acesso)');
}

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error('Falha:', err.message);
        process.exit(1);
    });
