/**
 * Gera/atualiza os segredos do .env do Argus. Rode NA PASTA argus, na maquina servidora:
 *
 *   node src/scripts/configurarSegredos.js
 *
 * - JWT_SECRET: gera um novo (128 caracteres hex = 512 bits) se estiver ausente, curto ou de exemplo.
 *   Isso encerra a sessao de todos os usuarios (todos fazem login de novo).
 * - ENCRYPTION_KEY: gera se estiver ausente/invalida (64 caracteres hex = AES-256).
 * - POSTGRES_PASSWORD: se ausente, gera uma senha nova e a aplica no PostgreSQL em execucao
 *   (docker compose exec postgres ... ALTER USER) antes de grava-la no .env.
 * - Mantem DATAJUD_API_KEY, APP_BASE_URL e demais valores ja existentes.
 * - Faz copia do .env anterior em .env.bak-<data>.
 *
 * Nenhum valor secreto e exibido na tela.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..', '..');
const ARQ_ENV = path.join(RAIZ, '.env');
const ARQ_EXEMPLO = path.join(RAIZ, '.env.example');
const SEGREDOS_DE_EXEMPLO = ['troque-esta-chave-em-producao', 'changeme', 'secret'];

function lerEnv(arquivo) {
    if (!fs.existsSync(arquivo)) return {};
    return Object.fromEntries(
        fs
            .readFileSync(arquivo, 'utf8')
            .split(/\r?\n/)
            .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
            .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
    );
}

function main() {
    const atual = lerEnv(ARQ_ENV);
    const novo = { ...atual };
    const feitos = [];

    const jwt = atual.JWT_SECRET || '';
    if (jwt.length < 64 || SEGREDOS_DE_EXEMPLO.includes(jwt)) {
        novo.JWT_SECRET = crypto.randomBytes(64).toString('hex');
        feitos.push('JWT_SECRET gerado (todos os usuarios precisarao entrar de novo)');
    }

    if (!/^[0-9a-fA-F]{64}$/.test(atual.ENCRYPTION_KEY || '')) {
        novo.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
        feitos.push('ENCRYPTION_KEY gerada');
    }

    if (!atual.POSTGRES_PASSWORD) {
        const senha = crypto.randomBytes(24).toString('hex');
        try {
            execFileSync(
                'docker',
                ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'argus', '-d', 'argus', '-c', `ALTER USER argus PASSWORD '${senha}';`],
                // O docker-compose.yml exige POSTGRES_PASSWORD para ser lido; passa a nova ja aqui.
                { cwd: RAIZ, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, POSTGRES_PASSWORD: senha } }
            );
        } catch (err) {
            console.error('Nao foi possivel alterar a senha no PostgreSQL. O container "postgres" esta rodando? (docker compose up -d postgres)');
            process.exit(1);
        }
        novo.POSTGRES_PASSWORD = senha;
        feitos.push('POSTGRES_PASSWORD gerada e aplicada no banco');
    }

    // Variaveis que sairam do .env (agora ficam na tela de Configuracoes).
    for (const obsoleta of ['DATABASE_URL', 'DATAJUD_SYNC_PAUSADO', 'DATAJUD_SYNC_INTERVAL_HOURS', 'ALERTA_DIAS_ESCALONAMENTO',
        'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_REMETENTE', 'EMAIL_FALLBACK_PROCURADORIA']) {
        if (obsoleta in novo) {
            delete novo[obsoleta];
            feitos.push(`${obsoleta} removida (obsoleta)`);
        }
    }

    if (!feitos.length) {
        console.log('Nada a fazer: os segredos do .env ja estao adequados.');
        return;
    }

    // Monta o arquivo a partir do modelo (.env.example), preservando os comentarios.
    let conteudo = fs.readFileSync(ARQ_EXEMPLO, 'utf8');
    const usados = new Set();
    conteudo = conteudo.replace(/^([A-Z_][A-Z0-9_]*)=.*$/gm, (linha, chave) => {
        usados.add(chave);
        return chave in novo ? `${chave}=${novo[chave]}` : linha;
    });
    const extras = Object.keys(novo).filter((k) => !usados.has(k));
    if (extras.length) conteudo += `\n# Outras variaveis mantidas do .env anterior\n${extras.map((k) => `${k}=${novo[k]}`).join('\n')}\n`;

    if (fs.existsSync(ARQ_ENV)) {
        const copia = `${ARQ_ENV}.bak-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
        fs.copyFileSync(ARQ_ENV, copia);
        console.log(`Copia do .env anterior: ${path.basename(copia)}`);
    }
    fs.writeFileSync(ARQ_ENV, conteudo);

    console.log('Feito:');
    for (const f of feitos) console.log(`  - ${f}`);
    console.log('\nAgora recrie os containers para valer: docker compose up -d --build');
}

main();
