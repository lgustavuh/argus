-- 008: etiquetas, casos sem numero de processo e anotacoes internas.

-- Etiquetas livres para organizar processos e casos (ex.: "execução fiscal", "saúde", "urgente").
CREATE TABLE IF NOT EXISTS etiquetas (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(40) NOT NULL,
    criado_em TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_etiquetas_nome ON etiquetas (lower(nome));

CREATE TABLE IF NOT EXISTS processo_etiquetas (
    processo_id INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    etiqueta_id INTEGER NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
    PRIMARY KEY (processo_id, etiqueta_id)
);

-- Caso: assunto acompanhado pela Procuradoria que nao tem (ou ainda nao tem) numero de processo
-- judicial — procedimento administrativo, notificacao extrajudicial, consulta de secretaria etc.
-- Quando vira acao judicial, o caso pode ser vinculado ao processo.
CREATE TABLE IF NOT EXISTS casos (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(200) NOT NULL,
    tipo VARCHAR(20) NOT NULL DEFAULT 'administrativo',
    referencia VARCHAR(100),
    interessado VARCHAR(200),
    descricao TEXT,
    responsavel_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    processo_id INTEGER REFERENCES processos(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'aberto',
    encerrado_em TIMESTAMP,
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW(),
    CONSTRAINT casos_tipo_chk CHECK (tipo IN ('administrativo', 'extrajudicial', 'consulta', 'outro')),
    CONSTRAINT casos_status_chk CHECK (status IN ('aberto', 'encerrado'))
);
COMMENT ON COLUMN casos.referencia IS 'numero do procedimento/protocolo/SEI, se houver';
CREATE INDEX IF NOT EXISTS idx_casos_status ON casos(status);

CREATE TABLE IF NOT EXISTS caso_etiquetas (
    caso_id INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
    etiqueta_id INTEGER NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
    PRIMARY KEY (caso_id, etiqueta_id)
);

-- Anotacoes internas (historico escrito pela equipe) de um processo ou de um caso.
CREATE TABLE IF NOT EXISTS anotacoes (
    id SERIAL PRIMARY KEY,
    processo_id INTEGER REFERENCES processos(id) ON DELETE CASCADE,
    caso_id INTEGER REFERENCES casos(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    autor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP DEFAULT NOW(),
    CONSTRAINT anotacoes_dono_chk CHECK ((processo_id IS NULL) <> (caso_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_anotacoes_processo ON anotacoes(processo_id);
CREATE INDEX IF NOT EXISTS idx_anotacoes_caso ON anotacoes(caso_id);

-- Compromisso da agenda tambem pode ser de um caso.
ALTER TABLE compromissos ADD COLUMN IF NOT EXISTS caso_id INTEGER REFERENCES casos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_compromissos_caso ON compromissos(caso_id);
