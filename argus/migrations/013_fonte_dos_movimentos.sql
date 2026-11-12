-- 013: qual fonte de dados alimentou os movimentos de cada processo (PRD MEL-19).
-- O hash de deduplicacao usa o dataHora bruto da fonte; ao trocar de fonte (DataJud -> MNI) o mesmo
-- movimento chegaria com outro formato e outro hash. Sabendo a fonte anterior, o sync trata a
-- primeira consulta pela nova fonte como carga inicial e reconhece os movimentos ja gravados.
ALTER TABLE processos ADD COLUMN IF NOT EXISTS fonte_movimentos VARCHAR(20);

-- Ate aqui so o DataJud foi usado.
UPDATE processos p SET fonte_movimentos = 'datajud'
WHERE fonte_movimentos IS NULL AND EXISTS (SELECT 1 FROM movimentos m WHERE m.processo_id = p.id);
