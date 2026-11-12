-- 014: limite de tentativas de login no banco (PRD MEL-12).
-- Antes ficava em memoria: reiniciar o container zerava os bloqueios por forca bruta.
CREATE TABLE IF NOT EXISTS limite_login (
    chave VARCHAR(250) PRIMARY KEY,         -- 'email:<email>' ou 'ip:<ip>'
    falhas INTEGER NOT NULL DEFAULT 0,
    primeira_falha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    bloqueado_ate TIMESTAMPTZ
);
