-- 004: perfis da Procuradoria, modulo de configuracoes, auditoria, cadastro manual de processos
-- e preparacao para a troca de fonte de dados (DataJud publico -> MNI/TJMG).

-- ---------------------------------------------------------------------------
-- Perfis: procurador | advogado | assistente_juridico | admin.
-- O antigo perfil "chefe" deixa de existir (todos veem todos os processos do Municipio);
-- quem estiver nele vira procurador.
-- ---------------------------------------------------------------------------
UPDATE usuarios SET papel = 'procurador' WHERE papel = 'chefe';
COMMENT ON COLUMN usuarios.papel IS 'procurador | advogado | assistente_juridico | admin';

-- Forca troca de senha no proximo login (senha provisoria criada pelo admin/script).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS deve_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE;
-- Incrementado ao trocar senha, mudar perfil ou desativar: invalida sessoes (JWT) ja emitidas.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_login_em TIMESTAMP;

-- ---------------------------------------------------------------------------
-- Alertas: registrar quem deu ciencia (visualizado_por ja existia).
-- ---------------------------------------------------------------------------
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS ciente_por INTEGER REFERENCES usuarios(id);

-- ---------------------------------------------------------------------------
-- Processos: cadastro manual/importacao em lote e situacao na fonte de dados.
-- numero_processo e gravado so com os 20 digitos (sem pontuacao); a formatacao CNJ e feita na tela.
-- ---------------------------------------------------------------------------
ALTER TABLE processos ADD COLUMN IF NOT EXISTS origem VARCHAR(20) NOT NULL DEFAULT 'manual';
COMMENT ON COLUMN processos.origem IS 'manual | importacao | mni_aviso';
ALTER TABLE processos ADD COLUMN IF NOT EXISTS situacao_fonte VARCHAR(20) NOT NULL DEFAULT 'aguardando';
COMMENT ON COLUMN processos.situacao_fonte IS 'aguardando | localizado | nao_localizado';
ALTER TABLE processos ADD COLUMN IF NOT EXISTS ultima_consulta_em TIMESTAMP;
ALTER TABLE processos ADD COLUMN IF NOT EXISTS graus VARCHAR(50);
ALTER TABLE processos ADD COLUMN IF NOT EXISTS observacao TEXT;
ALTER TABLE processos ADD COLUMN IF NOT EXISTS criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_processos_ativo ON processos(ativo);

-- A varredura por comarca foi abandonada (trazia processos de terceiros). O monitoramento agora e
-- feito pelos numeros cadastrados, e o tribunal e deduzido do proprio numero CNJ.
DROP TABLE IF EXISTS termos_comarca;
DROP TABLE IF EXISTS tribunais_monitorados;

-- ---------------------------------------------------------------------------
-- Configuracoes do sistema (chave/valor), editaveis pela tela de Configuracoes.
-- Valores sensiveis (senhas SMTP/MNI) sao gravados cifrados (AES-256-GCM, ver src/util/cripto.js).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracoes (
    chave VARCHAR(100) PRIMARY KEY,
    valor TEXT,
    atualizado_em TIMESTAMP DEFAULT NOW(),
    atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Trilha de auditoria: quem fez o que e quando.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
    id BIGSERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    usuario_nome VARCHAR(200),
    acao VARCHAR(60) NOT NULL,
    entidade VARCHAR(40),
    entidade_id VARCHAR(40),
    detalhes JSONB,
    ip VARCHAR(64),
    criado_em TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_criado_em ON auditoria(criado_em DESC);

-- ---------------------------------------------------------------------------
-- Codigos TPU: os seeds do MVP estavam errados (ex.: 22 e "Baixa Definitiva", nao Distribuicao;
-- 970/971/12223/54 nunca aparecem nos dados do TJMG). Lista abaixo validada contra amostra real
-- do DataJud (TJMG, comarca de Pratapolis, outubro/2026). Ajustavel em Configuracoes > Alertas.
-- ---------------------------------------------------------------------------
DELETE FROM codigos_tpu_relevantes WHERE codigo IN (22, 26, 970, 971, 12223, 54);
INSERT INTO codigos_tpu_relevantes (codigo, nome, peso_urgencia) VALUES
    (12265, 'Intimação expedida/certificada', 5),
    (12266, 'Intimação confirmada (início de prazo)', 5),
    (12282, 'Comunicação expedida/certificada (citação/notificação)', 5),
    (12287, 'Comunicação expedida/certificada (citação/notificação)', 5),
    (12288, 'Comunicação confirmada (citação/notificação)', 5),
    (219, 'Sentença — procedência', 5),
    (220, 'Sentença — improcedência', 5),
    (221, 'Sentença — procedência em parte', 5),
    (1061, 'Disponibilização no Diário da Justiça Eletrônico', 4),
    (92, 'Publicação', 4),
    (332, 'Antecipação de tutela', 4),
    (785, 'Antecipação de tutela', 4),
    (339, 'Liminar', 4),
    (792, 'Liminar', 4),
    (12740, 'Audiência de conciliação', 4),
    (12624, 'Audiência do art. 334 CPC', 4),
    (12750, 'Audiência de instrução e julgamento', 4),
    (12164, 'Outras decisões', 3),
    (1051, 'Decurso de prazo', 3),
    (848, 'Trânsito em julgado', 3),
    (11010, 'Despacho de mero expediente', 2)
ON CONFLICT (codigo) DO NOTHING;
