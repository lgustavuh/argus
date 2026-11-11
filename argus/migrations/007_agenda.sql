-- 007: agenda da Procuradoria — prazos, audiências, tarefas e eventos, com responsável.
-- Um compromisso pode estar ligado a um processo (e ao alerta que o originou) ou ser avulso.
-- `data` e o dia do compromisso (para prazo, a data fatal); `hora` e opcional.
CREATE TABLE IF NOT EXISTS compromissos (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(20) NOT NULL DEFAULT 'prazo',
    titulo VARCHAR(200) NOT NULL,
    descricao TEXT,
    data DATE NOT NULL,
    hora TIME,
    local VARCHAR(200),
    processo_id INTEGER REFERENCES processos(id) ON DELETE SET NULL,
    alerta_id INTEGER REFERENCES alertas(id) ON DELETE SET NULL,
    responsavel_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'aberto',
    concluido_em TIMESTAMP,
    concluido_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW(),
    CONSTRAINT compromissos_tipo_chk CHECK (tipo IN ('prazo', 'audiencia', 'tarefa', 'evento')),
    CONSTRAINT compromissos_status_chk CHECK (status IN ('aberto', 'concluido', 'cancelado'))
);
COMMENT ON COLUMN compromissos.tipo IS 'prazo | audiencia | tarefa | evento';
COMMENT ON COLUMN compromissos.status IS 'aberto | concluido | cancelado';

CREATE INDEX IF NOT EXISTS idx_compromissos_data_aberto ON compromissos(data) WHERE status = 'aberto';
CREATE INDEX IF NOT EXISTS idx_compromissos_processo ON compromissos(processo_id);
CREATE INDEX IF NOT EXISTS idx_compromissos_responsavel ON compromissos(responsavel_id);
