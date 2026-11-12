# CLAUDE.md — Argus

Sistema de acompanhamento de processos e alertas de prazo da Procuradoria Municipal de Itaú de
Minas/MG. Em **produção** com dados reais — trate cada mudança como mudança em sistema jurídico.

- Requisitos, bugs conhecidos e roadmap: [`docs/PRD.md`](docs/PRD.md) — **leia antes de mudar comportamento**.
- Operação/instalação: [`README.md`](README.md) · Arquitetura/segurança/LGPD/MNI: [`docs/DOCUMENTO_TECNICO.md`](docs/DOCUMENTO_TECNICO.md)
- Tom e design da interface: [`PRODUCT.md`](PRODUCT.md), [`DESIGN.md`](DESIGN.md)

## Stack

Node 22 (imagem `node:22-alpine`, usuário `node`) · Express 4 · EJS (server-rendered) · PostgreSQL 16 (`pg`, SQL puro, sem ORM) · node-cron ·
nodemailer · JWT em cookie httpOnly · Docker Compose (app + postgres + backup). JS puro (CommonJS), sem build.

## Comandos

```bash
npm install                 # dependências
npm run dev                 # node --watch (precisa de Postgres e .env)
npm start                   # produção
npm run migrate             # aplica migrations pendentes (também roda sozinho no start)
node src/scripts/criarAdmin.js        # cria/recupera admin pela linha de comando
node src/scripts/configurarSegredos.js
docker compose up -d --build          # stack completa
docker compose logs -f app
curl -s http://localhost:3000/healthz             # {"ok":true} = app + banco no ar
for f in $(git ls-files 'src/*.js'); do node --check "$f"; done   # checagem de sintaxe
npm audit --omit=dev
```

### Testes

`node:test` nativo, arquivos `test/**/*.test.js`. Os de integração usam um Postgres **descartável**
(nunca o banco de produção, que roda em `argus-postgres-1` nesta máquina):

```bash
docker run -d --rm --name argus-test-db -e POSTGRES_USER=argus -e POSTGRES_PASSWORD=teste \
  -e POSTGRES_DB=argus_test -p 127.0.0.1:55432:5432 postgres:16-alpine
TEST_DATABASE_URL=postgres://argus:teste@127.0.0.1:55432/argus_test npm test
docker stop argus-test-db
```

Sem `TEST_DATABASE_URL` só os unitários rodam. O helper `test/helpers/banco.js` recusa bancos que
não terminem em `_test` (o reset apaga o schema) e precisa ser requerido antes de qualquer módulo de `src/`.
Toda correção de bug ganha um teste que falharia sem ela.

## Estrutura

```
src/app.js            Express, helmet/CSP, helpers das views (app.locals), handlers 404/500
src/config/           papeis.js (permissões — fonte única), seguranca.js (checagens no start)
src/middleware/       auth (JWT + recarga do usuário), origem (CSRF), limiteLogin
src/routes/web/       telas (EJS)        src/routes/api/  API JSON (/api)
src/models/           SQL por entidade (só acesso a dados)
src/services/         regras de negócio: reconciliation (sync), alertEngine, agenda, mailer, documentos...
src/fontes/           fontes de dados plugáveis: datajud.js (ativa), mni.js (aguardando credenciamento)
src/datajud/          cliente HTTP do DataJud (retry/backoff, lotes de 100)
src/jobs/             syncScheduler — relógio único de hora em hora
src/util/             cnj, datas, fuso, cripto, senha, paginacao, http
migrations/           NNN_descricao.sql, aplicadas em ordem, cada uma em transação
views/ + partials/    EJS        public/  css/js estáticos (sem CDN de script — CSP 'self')
```

Fluxo central: `syncScheduler` → `reconciliation.sincronizar` → `fonte.consultarProcessos` →
`aplicarDadosDaFonte` (dedup por `hash_dedup`, carga inicial) → `alertEngine.criarAlertaParaMovimento` → e-mail.

## Regras do projeto

**Domínio**
- Permissões só via `pode(papel, acao)` / `requirePermissao('acao')` de `src/config/papeis.js`. Nunca `papel === '...'` espalhado.
- Todos os perfis veem todos os processos (são todos do Município); perfis diferem só no que podem alterar.
- **Nenhum alerta pode se perder.** Mudanças em sync/alertas precisam preservar: dedup por `hash_dedup`
  (não mude a fórmula — invalidaria os hashes gravados), regra da carga inicial, e "falha do tribunal ≠ não localizado".
- Ciência é explícita e auditada; anotações são imutáveis; ações relevantes chamam `auditoria.registrar`.
- O Argus é **somente leitura** nos tribunais.

**Datas e fuso**
- "Hoje" = `hojeSP()` (America/Sao_Paulo), passado como parâmetro. Não use `CURRENT_DATE` nem `new Date()` para dia de calendário.
- Colunas `DATE` trafegam como texto `'AAAA-MM-DD'` (ver `src/db/pool.js`); formate com `fmtDia`, nunca via `Date`.
- `dataHora` do DataJud é hora local marcada com `Z`: converta com `horaLocalSaoPauloParaUtc`.

**Banco**
- SQL sempre parametrizado (`$1, $2`). Interpolação só de constantes internas (nomes de tabela de whitelist).
- Schema muda **só** por nova migration `migrations/NNN_descricao.sql` (próximo número livre). Nunca edite uma migration já aplicada.
- Operações com várias escritas dependentes usam transação (`pool.connect()` + `BEGIN/COMMIT/ROLLBACK`).

**Rotas e views**
- Todo handler async envolto em `a(...)` (`src/util/http.js`) — Express 4 não captura promessa rejeitada.
- Parâmetros numéricos com `:id(\\d+)`. Valide entrada na rota; responda 400 com mensagem em português.
- Em EJS use `<%= %>`. `<%- %>` só para `include` ou HTML montado com `escapar(...)` em todo dado do banco.
- Sem script inline nem CDN de JS (CSP `script-src 'self'`): JS vai em `public/js/`.
- Mensagens de retorno via `comMsg(url, msg)`.

**Segurança**
- Segredos só no `.env` (nunca no código, no log ou no git). Senhas de SMTP/MNI salvas cifradas (`util/cripto`).
- Não afrouxe CSP, `verificarOrigem`, cookie httpOnly/SameSite ou a recarga do usuário em `requireAuth`.
- Upload: lista fechada de extensões em `services/documentos.js`; nunca aceitar HTML/SVG.

**Estilo**
- Interface, mensagens, commits e docs em **português** (com acentos). Comentários no código seguem o padrão existente (sem acentos).
- 4 espaços, aspas simples, ponto e vírgula, `const`/`let`, funções pequenas, early return.
- Comentário explica **por quê** (decisão, armadilha), não o quê.
- Não adicione dependência sem necessidade clara; prefira a biblioteca padrão do Node.

## Git

- **Nunca** versionar `.env*` (exceto `.env.example`), `backups/`, `documentos/`, `imagens/`, dumps ou logs —
  contêm dados reais de processos e usuários. Confira `git status` antes de todo commit.
- Commits pequenos, um assunto por commit, Conventional Commits em português: `fix(alertas): ...`, `feat(agenda): ...`.
- Ao concluir um conjunto de alterações: **commit e push automáticos** na branch atual (pedido do responsável
  pelo projeto). Force push e reescrita de histórico continuam exigindo confirmação.
- A raiz do repositório git é a pasta acima (`Argus/`); o código fica em `argus/`.
- Ao corrigir um item do PRD, cite o ID (`BUG-02`, `MEL-01`) no commit e atualize a tabela em `docs/PRD.md`.

## Produção (nesta máquina)

- Stack Docker Compose do projeto `argus`, banco no volume `argus_argus_pgdata` (nunca `docker compose down -v`).
- Antes de `docker compose up -d --build`: backup manual
  `docker exec argus-postgres-1 pg_dump -U argus -Fc argus > backups/argus_antes_deploy_AAAAMMDD_HHMM.dump`.
- Depois: conferir `docker compose logs app` (migrations), `/healthz` e `docker compose logs backup`.
- Se a pasta do projeto mudar de lugar, recriar a stack a partir da pasta nova (bind mounts de `backups/` e
  `documentos/` usam caminho absoluto — PRD BUG-15).

## Antes de concluir uma tarefa

1. `node --check` nos arquivos alterados e `npm test` (com `TEST_DATABASE_URL` se mexeu em banco/sync/alertas).
2. Mudou schema? Migration nova + subir a app numa base de teste.
3. Mudou permissão, sync, alerta ou data? Revise as regras acima e teste com cada perfil.
4. Atualize README/PRD se o comportamento visível mudou.
