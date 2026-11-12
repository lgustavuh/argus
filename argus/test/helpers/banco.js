/**
 * Banco para testes de integracao. Usa TEST_DATABASE_URL (nunca DATABASE_URL) e se recusa a rodar
 * se o nome do banco nao terminar em "_test" — o reset apaga o schema inteiro.
 *
 * Subir um banco descartavel:
 *   docker run -d --rm --name argus-test-db -e POSTGRES_USER=argus -e POSTGRES_PASSWORD=teste \
 *     -e POSTGRES_DB=argus_test -p 127.0.0.1:55432:5432 postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://argus:teste@127.0.0.1:55432/argus_test npm test
 *
 * IMPORTANTE: requerer este modulo ANTES de qualquer modulo de src/ (o pool le DATABASE_URL ao carregar).
 */
const URL_TESTE = process.env.TEST_DATABASE_URL || '';
const disponivel = Boolean(URL_TESTE);

if (disponivel) {
    const nomeBanco = new URL(URL_TESTE).pathname.slice(1);
    if (!nomeBanco.endsWith('_test')) {
        throw new Error(`TEST_DATABASE_URL deve apontar para um banco "*_test" (recebido: "${nomeBanco}").`);
    }
    process.env.DATABASE_URL = URL_TESTE;
}

const motivoPulo = disponivel ? false : 'defina TEST_DATABASE_URL para rodar os testes de integração';

async function resetar() {
    const pool = require('../../src/db/pool');
    const migrar = require('../../src/db/migrate');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const log = console.log;
    console.log = () => {};
    try {
        await migrar();
    } finally {
        console.log = log;
    }
}

async function encerrar() {
    if (disponivel) await require('../../src/db/pool').end();
}

module.exports = { disponivel, motivoPulo, resetar, encerrar };
