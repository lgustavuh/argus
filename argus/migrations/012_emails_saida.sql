-- 012: fila de saida de e-mails (PRD MEL-11 / BUG-03).
-- Alertas e avisos da agenda entram na fila e sao enviados por um processo separado, com novas
-- tentativas. Assim o sync nao espera o SMTP e uma falha de envio deixa de sumir no log: fica
-- visivel em Configuracoes > E-mail e pode ser reenviada.
CREATE TABLE IF NOT EXISTS emails_saida (
    id SERIAL PRIMARY KEY,
    para VARCHAR(200) NOT NULL,
    assunto TEXT NOT NULL,
    html TEXT,
    texto TEXT,
    tipo VARCHAR(40) NOT NULL,             -- alerta_novo | alerta_escalado | agenda_atribuicao | agenda_resumo
    referencia VARCHAR(60),                -- ex.: 'alerta:12', 'compromisso:5'
    status VARCHAR(20) NOT NULL DEFAULT 'pendente', -- pendente | enviando | enviado | falhou | descartado
    tentativas INTEGER NOT NULL DEFAULT 0,
    ultimo_erro TEXT,
    proxima_tentativa_em TIMESTAMP NOT NULL DEFAULT NOW(),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    enviado_em TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_emails_saida_fila ON emails_saida(proxima_tentativa_em) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_emails_saida_status ON emails_saida(status);
CREATE INDEX IF NOT EXISTS idx_emails_saida_referencia ON emails_saida(referencia);
