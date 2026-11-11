-- Argus MVP — schema inicial

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    email VARCHAR(200) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    papel VARCHAR(30) NOT NULL DEFAULT 'procurador', -- 'procurador' | 'chefe' | 'admin'
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS variacoes_nome_parte (
    id SERIAL PRIMARY KEY,
    nome_variante VARCHAR(300) NOT NULL UNIQUE,
    ativo BOOLEAN DEFAULT TRUE
    -- ex: "Municipio de Itau de Minas", "Prefeitura Municipal de Itau de Minas",
    --     "Fazenda Publica do Municipio de Itau de Minas"
);

CREATE TABLE IF NOT EXISTS tribunais_monitorados (
    id SERIAL PRIMARY KEY,
    alias VARCHAR(50) NOT NULL UNIQUE, -- 'tjmg', 'trf6', 'trt3'
    nome VARCHAR(100) NOT NULL,
    ativo BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS processos (
    id SERIAL PRIMARY KEY,
    numero_processo VARCHAR(30) NOT NULL UNIQUE, -- formato CNJ NNNNNNN-DD.AAAA.J.TR.OOOO
    tribunal VARCHAR(50) NOT NULL,
    grau VARCHAR(10),
    classe_nome VARCHAR(200),
    orgao_julgador VARCHAR(200),
    data_ajuizamento DATE,
    valor_causa NUMERIC(14,2),
    procurador_responsavel_id INTEGER REFERENCES usuarios(id),
    ativo BOOLEAN DEFAULT TRUE,
    link_consulta_publica TEXT, -- URL montada para o eproc/PJe do TJMG
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movimentos (
    id SERIAL PRIMARY KEY,
    processo_id INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    codigo_tpu INTEGER,
    nome VARCHAR(300),
    data_hora TIMESTAMP,
    relevante_para_prazo BOOLEAN DEFAULT FALSE, -- heuristica por codigo
    hash_dedup VARCHAR(64) NOT NULL, -- hash(processo_id + codigo_tpu + data_hora)
    criado_em TIMESTAMP DEFAULT NOW(),
    UNIQUE(hash_dedup)
);

CREATE TABLE IF NOT EXISTS alertas (
    id SERIAL PRIMARY KEY,
    processo_id INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    movimento_id INTEGER REFERENCES movimentos(id),
    tipo VARCHAR(50) NOT NULL DEFAULT 'movimento_relevante',
    status VARCHAR(30) NOT NULL DEFAULT 'pendente', -- 'pendente' | 'visualizado' | 'ciente' | 'escalado'
    prazo_dias_alerta INTEGER DEFAULT 3, -- dias ate escalonamento
    criado_em TIMESTAMP DEFAULT NOW(),
    visualizado_em TIMESTAMP,
    visualizado_por INTEGER REFERENCES usuarios(id),
    ciente_em TIMESTAMP,
    escalado_em TIMESTAMP,
    escalado_para INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS codigos_tpu_relevantes (
    codigo INTEGER PRIMARY KEY,
    nome VARCHAR(200),
    peso_urgencia INTEGER DEFAULT 1 -- 1 a 5, para priorizacao no dashboard
);

CREATE INDEX IF NOT EXISTS idx_movimentos_processo_id ON movimentos(processo_id);
CREATE INDEX IF NOT EXISTS idx_alertas_status ON alertas(status);
CREATE INDEX IF NOT EXISTS idx_alertas_processo_id ON alertas(processo_id);
CREATE INDEX IF NOT EXISTS idx_processos_procurador ON processos(procurador_responsavel_id);

-- Seed: tribunais monitorados
INSERT INTO tribunais_monitorados (alias, nome) VALUES
    ('tjmg', 'Tribunal de Justica de Minas Gerais')
ON CONFLICT (alias) DO NOTHING;

-- Seed: codigos TPU-CNJ relevantes (revisar/ajustar contra a Tabela Processual Unificada vigente)
INSERT INTO codigos_tpu_relevantes (codigo, nome, peso_urgencia) VALUES
    (22, 'Distribuicao', 2),
    (26, 'Conclusao', 2),
    (970, 'Intimacao', 5),
    (971, 'Citacao', 5),
    (12223, 'Sentenca', 5),
    (54, 'Acordao', 5)
ON CONFLICT (codigo) DO NOTHING;

-- Seed: variacoes de nome da parte (ajustar conforme grafia oficial do municipio)
INSERT INTO variacoes_nome_parte (nome_variante) VALUES
    ('Municipio de Itau de Minas'),
    ('Prefeitura Municipal de Itau de Minas'),
    ('Fazenda Publica do Municipio de Itau de Minas')
ON CONFLICT (nome_variante) DO NOTHING;
