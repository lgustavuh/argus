-- 010: garante que nenhum movimento relevante fique sem alerta (PRD BUG-02).
--
-- Antes, o movimento era gravado e so depois o alerta era criado; se a criacao do alerta falhasse,
-- o movimento ja existia (hash_dedup) e nunca mais gerava alerta. Agora o movimento e gravado com
-- alerta_pendente = TRUE quando deve gerar alerta, e a marca so e removida na mesma transacao que
-- cria o alerta. O que ficar pendente e reprocessado no fim de cada sync e de hora em hora.
--
-- Movimentos ja existentes ficam FALSE: ja foram tratados pelo fluxo antigo.
ALTER TABLE movimentos ADD COLUMN IF NOT EXISTS alerta_pendente BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_movimentos_alerta_pendente ON movimentos(id) WHERE alerta_pendente;
