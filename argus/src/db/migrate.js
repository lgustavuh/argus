require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

async function run() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename VARCHAR(255) PRIMARY KEY,
            aplicado_em TIMESTAMP DEFAULT NOW()
        )
    `);

    const applied = new Set(
        (await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
    );

    const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    for (const file of files) {
        if (applied.has(file)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        console.log(`Aplicando migration: ${file}`);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    console.log('Migrations em dia.');
}

if (require.main === module) {
    run()
        .then(() => pool.end())
        .catch((err) => {
            console.error('Falha ao rodar migrations:', err);
            process.exit(1);
        });
}

module.exports = run;
