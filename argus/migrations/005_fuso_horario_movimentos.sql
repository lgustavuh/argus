-- 005: corrige o horario dos movimentos ja gravados.
-- O DataJud entrega dataHora com sufixo "Z", mas o valor e horario de Brasilia; ate aqui ele era
-- gravado como se fosse UTC e aparecia 3h atrasado na tela (12:25 virava 09:25).
-- A coluna guarda UTC: reinterpreta o valor atual como hora local de Sao Paulo e converte para UTC
-- (o banco de fusos do PostgreSQL trata o horario de verao historico).
-- Os hashes de deduplicacao nao mudam (sao calculados sobre o valor bruto da fonte).
UPDATE movimentos
SET data_hora = (data_hora AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC'
WHERE data_hora IS NOT NULL;
