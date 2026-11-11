const { Pool, types } = require('pg');

// As colunas TIMESTAMP (sem fuso) guardam horario UTC — o PostgreSQL do container roda em UTC e o
// NOW() grava em UTC. Sem isto, o driver interpretaria o valor no fuso do processo Node e os
// horarios na tela poderiam sair deslocados em 3h. A exibicao converte para America/Sao_Paulo.
const TIMESTAMP_SEM_FUSO = 1114;
types.setTypeParser(TIMESTAMP_SEM_FUSO, (valor) => (valor === null ? null : new Date(`${valor.replace(' ', 'T')}Z`)));

// Colunas DATE (dia de calendario, sem hora) ficam como texto 'AAAA-MM-DD'. Convertidas em Date, virariam
// meia-noite UTC e apareceriam na tela como o dia anterior (21h em Brasilia). Ver src/util/datas.js.
const DATE = 1082;
types.setTypeParser(DATE, (valor) => valor);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: '-c timezone=UTC'
});

module.exports = pool;
