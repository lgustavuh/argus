-- Pivo: a API publica do DataJud NAO expoe nomes/CNPJ de partes processuais (confirmado
-- empiricamente contra a API real: nenhum documento retorna o campo "partes", por protecao de
-- dados da Portaria CNJ 160/2020). A filtragem por "variacao de nome da parte" descrita no MVP
-- original e inviavel nessa API. Troca para filtragem por comarca (orgaoJulgador.nome), unico
-- criterio geografico disponivel para restringir a varredura ao municipio atendido.

ALTER TABLE variacoes_nome_parte RENAME TO termos_comarca;
ALTER TABLE termos_comarca RENAME COLUMN nome_variante TO termo;

DELETE FROM termos_comarca;
INSERT INTO termos_comarca (termo) VALUES ('Pratápolis');

-- Campo "sistema" retornado pelo DataJud (ex: "PJe", "eproc", "Inválido") — usado para montar o
-- link de consulta publica corretamente e exibido como "Local" no painel de alertas.
ALTER TABLE processos ADD COLUMN IF NOT EXISTS sistema VARCHAR(50);
