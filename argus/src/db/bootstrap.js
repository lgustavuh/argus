const runMigrations = require('./migrate');
const pool = require('./pool');

/**
 * Roda migrations no start. Nenhuma credencial de usuario fica em variavel de ambiente — o
 * primeiro administrador e criado pela propria interface (tela /setup, disponivel enquanto a
 * tabela `usuarios` estiver vazia).
 */
async function bootstrap() {
    await runMigrations();
}

if (require.main === module) {
    bootstrap()
        .then(() => pool.end())
        .catch((err) => {
            console.error('[bootstrap] Falha:', err);
            process.exit(1);
        });
}

module.exports = bootstrap;
