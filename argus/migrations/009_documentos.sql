-- 009: documentos anexados a processos/casos e modelos de documento com campos automaticos.

-- O arquivo fica em disco (DOCUMENTOS_DIR, volume ./documentos no docker-compose) com nome aleatorio;
-- o banco guarda o nome original e os metadados. O backup diario do banco NAO inclui os arquivos.
CREATE TABLE IF NOT EXISTS documentos (
    id SERIAL PRIMARY KEY,
    processo_id INTEGER REFERENCES processos(id) ON DELETE CASCADE,
    caso_id INTEGER REFERENCES casos(id) ON DELETE CASCADE,
    nome_original VARCHAR(255) NOT NULL,
    arquivo VARCHAR(100) NOT NULL UNIQUE,
    tamanho INTEGER NOT NULL,
    descricao VARCHAR(300),
    enviado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP DEFAULT NOW(),
    CONSTRAINT documentos_dono_chk CHECK ((processo_id IS NULL) <> (caso_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_documentos_processo ON documentos(processo_id);
CREATE INDEX IF NOT EXISTS idx_documentos_caso ON documentos(caso_id);

-- Modelo de texto com marcadores {{campo}} preenchidos com os dados do processo/caso.
CREATE TABLE IF NOT EXISTS modelos_documento (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    descricao VARCHAR(300),
    conteudo TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Modelo de exemplo, para a equipe ver como os campos funcionam (pode ser editado ou desativado).
INSERT INTO modelos_documento (nome, descricao, conteudo)
SELECT 'Exemplo — Ofício de requisição de informações',
       'Modelo de demonstração dos campos automáticos. Ajuste o texto ou desative.',
       E'Ofício nº ____/______\n\nItaú de Minas, {{data_extenso}}.\n\nA Sua Senhoria o(a) Senhor(a)\n[Destinatário]\n[Cargo / Secretaria]\n\nAssunto: Requisição de informações — Processo nº {{numero_processo}}\n\nSenhor(a),\n\nA Procuradoria-Geral do Município de Itaú de Minas, para instruir a defesa do Município nos autos do processo nº {{numero_processo}} ({{classe}}), em trâmite na {{orgao_julgador}}, solicita que sejam encaminhadas a esta Procuradoria, no prazo de 5 (cinco) dias, as seguintes informações e documentos:\n\n1. [informação ou documento];\n2. [informação ou documento].\n\nAtenciosamente,\n\n{{responsavel}}\nProcuradoria-Geral do Município de Itaú de Minas'
WHERE NOT EXISTS (SELECT 1 FROM modelos_documento);
