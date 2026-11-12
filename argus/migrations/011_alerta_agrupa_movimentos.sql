-- 011: um alerta pode reunir varios movimentos (PRD MEL-17 — "uma intimacao, um alerta").
-- Uma publicacao no DJe costuma gerar 3 movimentos relevantes no mesmo dia (disponibilizacao,
-- expedicao, publicacao); antes viravam 3 alertas. alertas.movimento_id continua sendo o movimento
-- que abriu o alerta; movimentos.alerta_id diz a qual alerta cada movimento pertence.
ALTER TABLE movimentos ADD COLUMN IF NOT EXISTS alerta_id INTEGER REFERENCES alertas(id) ON DELETE SET NULL;

UPDATE movimentos m SET alerta_id = a.id
FROM alertas a
WHERE a.movimento_id = m.id AND m.alerta_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_movimentos_alerta_id ON movimentos(alerta_id) WHERE alerta_id IS NOT NULL;
