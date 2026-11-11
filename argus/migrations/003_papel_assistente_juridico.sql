-- Novo cargo "assistente_juridico" — mesmo escopo de acesso de "procurador" por enquanto
-- (ver src/config/papeis.js). Sem CHECK constraint na coluna, entao nao ha alteracao de schema
-- necessaria alem de documentar o valor aceito.
COMMENT ON COLUMN usuarios.papel IS 'procurador | assistente_juridico | chefe | admin';
