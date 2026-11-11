-- 006: sistema de tramitacao informado pela Procuradoria.
-- O DataJud as vezes nao sabe em qual sistema o processo tramita (sistema "Inválido", tipico de autos
-- fisicos). Antes, o Argus adivinhava pelo grau (1o grau -> eproc) e errava, ex.: 0279389-66.2009.8.13.0529
-- tramita no PJe. Agora, sem informacao, nao ha link unico (a tela oferece PJe e eproc) e o usuario
-- pode fixar o sistema, que tem prioridade sobre o DataJud e nao e sobrescrito pelo sync.
ALTER TABLE processos ADD COLUMN IF NOT EXISTS sistema_informado VARCHAR(20);
COMMENT ON COLUMN processos.sistema_informado IS 'pje | eproc | NULL (usa o sistema informado pelo DataJud)';

-- Remove os links que foram montados por palpite (sistema desconhecido).
UPDATE processos SET link_consulta_publica = NULL
WHERE sistema IS NULL OR (sistema NOT ILIKE '%pje%' AND sistema NOT ILIKE '%eproc%');
