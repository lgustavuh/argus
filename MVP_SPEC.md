# MVP — Sistema de Unificação e Alerta de Processos da Procuradoria Municipal

> **Nota (out/2026):** especificação original do MVP, mantida como histórico. Pontos superados: a filtragem por nome da parte (seção 4) é inviável — a API pública do DataJud não expõe partes —, o perfil "chefe" foi substituído pelos perfis Procurador/Advogado/Assistente Jurídico/Admin (TI), e os códigos TPU do seed foram corrigidos. A documentação vigente está em `argus/README.md` e `argus/docs/DOCUMENTO_TECNICO.md`.

**Nome provisório:** Argus (referência a Argos Panoptes, o gigante mitológico de cem olhos que tudo vigiava — coerente com o padrão já usado em outros projetos: Atlas, Hígia, Vitalis; e evita conflito de nome com o produto comercial "Themis" da Aurum). Pode ser renomeado livremente.

**Cliente:** Procuradoria Municipal de Itaú de Minas/MG
**Responsável técnico:** Luiz Gustavo (STI)
**Objetivo de negócio:** eliminar perda de prazo por "ninguém viu que o processo teve movimentação", unificando em uma única base todos os processos onde a Procuradoria/Município é parte, com alertas rastreáveis e escalonamento.

---

## 1. Escopo do MVP

### Entra no MVP
- Consulta periódica à **API Pública do DataJud/CNJ** para o TJMG (e, se aplicável, TRF6 e TRT3) filtrando processos onde a Procuradoria/Município é parte.
- Normalização e deduplicação de processos (mesmo processo pode aparecer com variações do nome da parte).
- Detecção de **movimentações novas** por processo (diff contra o que já está salvo).
- Classificação heurística de movimentações como "potencialmente geradoras de prazo" (lista de códigos TPU-CNJ configurável).
- Geração de **link direto de consulta pública** para o processo no sistema de origem (eproc/PJe do TJMG).
- **Alertas rastreáveis**: criação, visualização, confirmação de ciência, e **escalonamento automático** se não confirmado em X dias.
- Cadastro simples de processos → procurador responsável (mapeamento manual, já que o DataJud não sabe disso).
- Dashboard web mínimo: lista de processos, linha do tempo de movimentos, painel de alertas pendentes/tratados, com autenticação simples.
- Notificação por e-mail (mínimo) ao criar alerta novo e ao escalar.

### Não entra no MVP (fora de escopo, propositalmente)
- Peticionamento eletrônico, manifestação processual, assinatura digital — **nenhuma ação escrita no tribunal**, apenas leitura/monitoramento.
- Integração via MNI (Modelo Nacional de Interoperabilidade) com o TJMG — depende de ofício formal e credenciamento; entra em v2 quando aprovado.
- Cálculo jurídico exato de prazo processual (dias úteis, suspensões, feriados forenses) — o MVP sinaliza "há uma movimentação que pode abrir prazo", não calcula a data fatal com certeza jurídica.
- Notificação via WhatsApp (pode entrar como Fase 1.5, mas não bloqueia o MVP).
- Múltiplos municípios/tenants — sistema single-tenant para Itaú de Minas nesta fase (diferente do Tracking SaaS, que é multi-tenant).

---

## 2. Arquitetura técnica

Stack alinhado ao padrão já usado nos outros projetos (ServiceDesk Pro, Tracking SaaS): **sem n8n** — decisão já tomada, pois é um poller simples sem orquestração complexa de múltiplos sistemas heterogêneos.

```
┌─────────────────────────────────────────────┐
│  node-cron (scheduler interno ao processo)   │
│  → dispara varredura periódica (ex: 6/6h)    │
└───────────────────┬───────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│  DataJud Client (módulo Node)                 │
│  - monta query Elasticsearch por tribunal     │
│  - roda variações de nome da parte            │
│  - paginação via search_after                 │
│  - retry/backoff em rate limit                │
└───────────────────┬───────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│  Reconciliation Service                       │
│  - dedup por numeroProcesso                   │
│  - diff de movimentos (novo vs já salvo)      │
│  - classificação heurística (código TPU)      │
└───────────────────┬───────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│  PostgreSQL                                   │
│  processos / movimentos / alertas / usuarios  │
└───────────────────┬───────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌───────────────┐       ┌───────────────────┐
│ Alert Engine   │       │ Express REST API   │
│ - cria alerta  │       │ - CRUD processos    │
│ - escalonamento│       │ - listagem alertas  │
│ - dispara email│       │ - auth (JWT simples)│
└───────────────┘       └─────────┬───────────┘
                                   │
                                   ▼
                         ┌───────────────────┐
                         │ Dashboard (SPA)     │
                         │ ou server-rendered  │
                         └───────────────────┘
```

**Stack sugerida:**
- Backend: Node.js + Express
- Banco: PostgreSQL
- Scheduler: `node-cron` (dentro do próprio processo — sem worker separado no MVP)
- E-mail: `nodemailer` (SMTP da Prefeitura, se disponível, ou serviço transacional)
- Frontend: pode ser server-rendered simples (EJS/Handlebars) para o MVP, ou React se preferir reaproveitar componentes de outros projetos — decisão livre do Claude Code, mas recomenda-se simplicidade no MVP.
- Deploy: Docker (mesmo padrão do ServiceDesk Pro e Atlas ERP), docker-compose com serviços `app` + `postgres`.

---

## 3. Modelo de dados (PostgreSQL)

```sql
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    email VARCHAR(200) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    papel VARCHAR(30) NOT NULL DEFAULT 'procurador', -- 'procurador' | 'chefe' | 'admin'
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT NOW()
);

CREATE TABLE variacoes_nome_parte (
    id SERIAL PRIMARY KEY,
    nome_variante VARCHAR(300) NOT NULL,
    ativo BOOLEAN DEFAULT TRUE
    -- ex: "Municipio de Itau de Minas", "Prefeitura Municipal de Itau de Minas",
    --     "Fazenda Publica do Municipio de Itau de Minas"
);

CREATE TABLE tribunais_monitorados (
    id SERIAL PRIMARY KEY,
    alias VARCHAR(50) NOT NULL UNIQUE, -- 'tjmg', 'trf6', 'trt3'
    nome VARCHAR(100) NOT NULL,
    ativo BOOLEAN DEFAULT TRUE
);

CREATE TABLE processos (
    id SERIAL PRIMARY KEY,
    numero_processo VARCHAR(30) NOT NULL UNIQUE, -- formato CNJ NNNNNNN-DD.AAAA.J.TR.OOOO
    tribunal VARCHAR(50) NOT NULL,
    grau VARCHAR(10),
    classe_nome VARCHAR(200),
    orgao_julgador VARCHAR(200),
    data_ajuizamento DATE,
    valor_causa NUMERIC(14,2),
    procurador_responsavel_id INTEGER REFERENCES usuarios(id),
    ativo BOOLEAN DEFAULT TRUE,
    link_consulta_publica TEXT, -- URL montada para o eproc/PJe do TJMG
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW()
);

CREATE TABLE movimentos (
    id SERIAL PRIMARY KEY,
    processo_id INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    codigo_tpu INTEGER,
    nome VARCHAR(300),
    data_hora TIMESTAMP,
    relevante_para_prazo BOOLEAN DEFAULT FALSE, -- heurística por código
    hash_dedup VARCHAR(64) NOT NULL, -- hash(processo_id + codigo_tpu + data_hora)
    criado_em TIMESTAMP DEFAULT NOW(),
    UNIQUE(hash_dedup)
);

CREATE TABLE alertas (
    id SERIAL PRIMARY KEY,
    processo_id INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    movimento_id INTEGER REFERENCES movimentos(id),
    tipo VARCHAR(50) NOT NULL DEFAULT 'movimento_relevante',
    status VARCHAR(30) NOT NULL DEFAULT 'pendente', -- 'pendente' | 'visualizado' | 'ciente' | 'escalado'
    prazo_dias_alerta INTEGER DEFAULT 3, -- dias até escalonamento
    criado_em TIMESTAMP DEFAULT NOW(),
    visualizado_em TIMESTAMP,
    visualizado_por INTEGER REFERENCES usuarios(id),
    ciente_em TIMESTAMP,
    escalado_em TIMESTAMP,
    escalado_para INTEGER REFERENCES usuarios(id)
);

CREATE TABLE codigos_tpu_relevantes (
    codigo INTEGER PRIMARY KEY,
    nome VARCHAR(200),
    peso_urgencia INTEGER DEFAULT 1 -- 1 a 5, para priorização no dashboard
    -- seed inicial: 22 (Distribuição), 26 (Conclusão), 970/971 (Intimação/Citação — verificar
    -- código exato vigente na Tabela Processual Unificada), 12223 (Sentença), 54 (Acórdão)
);
```

---

## 4. Integração com DataJud

### Endpoint base
```
POST https://api-publica.datajud.cnj.jus.br/api_publica_{alias}/_search
Authorization: APIKey <chave pública vigente>
Content-Type: application/json
```

A chave pública é compartilhada e pode mudar — implementar leitura/config via variável de ambiente `DATAJUD_API_KEY`, documentando de onde ela vem (`datajud-wiki.cnj.jus.br/api-publica/acesso/`) para facilitar atualização manual quando o CNJ trocar.

### Query de busca por parte (uma por variação de nome, por tribunal)
```json
{
  "query": { "match": { "partes.nome": "Municipio de Itau de Minas" } },
  "size": 100,
  "sort": [{ "dataAjuizamento": { "order": "desc" } }]
}
```

### Regras de implementação
- Rodar uma requisição por combinação (tribunal × variação de nome cadastrada em `variacoes_nome_parte`).
- Paginação: usar `search_after` quando o total ultrapassar a `size` configurada, respeitando o limite de 10.000 do Elasticsearch.
- Deduplicar por `numeroProcesso` no momento do upsert em `processos`.
- Para cada processo, comparar array `movimentos` retornado contra os já salvos (via `hash_dedup`); inserir apenas os novos.
- Cada movimento novo passa pela checagem contra `codigos_tpu_relevantes`; se relevante, criar registro em `alertas`.
- Rate limit: implementar backoff exponencial simples em caso de HTTP 429.

---

## 5. Geração do link de consulta pública (eproc/PJe TJMG)

O Claude Code deve pesquisar e validar o padrão de URL de consulta pública vigente do eproc do TJMG (geralmente algo como `https://eproc1g.tjmg.jus.br/eproc/...&num_processo=...` ou similar — **validar o padrão real antes de implementar**, pois pode variar por grau/sistema legado vs. eproc). Montar esse link a partir de `numeroProcesso` + `grau` e salvar em `processos.link_consulta_publica` no momento do upsert.

Se o padrão de URL não permitir link direto sem sessão autenticada, usar como fallback a página de consulta pública genérica do TJMG com o número pré-preenchido via query string, quando suportado.

---

## 6. Motor de alertas e escalonamento

Fluxo:
1. Movimento novo classificado como relevante → cria `alertas` com status `pendente`, dispara e-mail ao `procurador_responsavel_id` do processo (se houver; caso não tenha responsável cadastrado, notificar um e-mail genérico da Procuradoria configurável em `.env`).
2. Procurador abre o link no dashboard → status muda para `visualizado`, grava `visualizado_em`/`visualizado_por`.
3. Procurador confirma ciência explicitamente (botão "Dar ciência") → status `ciente`, grava `ciente_em`.
4. Job periódico (mesmo `node-cron`) varre alertas com status `pendente` ou `visualizado` (sem ciência) há mais de `prazo_dias_alerta` dias → muda status para `escalado`, notifica `escalado_para` (papel `chefe`) e reenvia ao procurador original.

Esse fluxo é o que resolve o "o procurador não olhou o sistema": não é mais uma notificação solta, é um item com dono, prazo interno e escalonamento — mesmo padrão de SLA/ticket já usado no ServiceDesk Pro.

---

## 7. API REST (Express) — endpoints mínimos

```
POST   /api/auth/login
GET    /api/processos                 -- lista com filtros (procurador, status, tribunal)
GET    /api/processos/:id             -- detalhe + linha do tempo de movimentos
PATCH  /api/processos/:id             -- atribuir/alterar procurador responsável
GET    /api/alertas?status=pendente   -- painel de alertas
PATCH  /api/alertas/:id/visualizar
PATCH  /api/alertas/:id/ciencia
GET    /api/variacoes-nome
POST   /api/variacoes-nome
GET    /api/tribunais
POST   /api/tribunais
POST   /api/sync/run                  -- dispara varredura manual (além do cron)
```

Autenticação: JWT simples, papéis `procurador` / `chefe` / `admin` (chefe vê alertas escalados de todos; procurador vê só os seus).

---

## 8. Dashboard mínimo (telas)

1. **Login**
2. **Painel de Alertas** — lista priorizada (peso de urgência + tempo pendente), com ação rápida de "visualizar" / "dar ciência" e link direto pro processo.
3. **Lista de Processos** — todos os processos unificados, com filtro por procurador/tribunal/status.
4. **Detalhe do Processo** — linha do tempo de movimentos + link de consulta pública + campo para atribuir procurador responsável.
5. **Configurações** (admin) — variações de nome da parte, tribunais monitorados, códigos TPU relevantes.

---

## 9. Variáveis de ambiente

```
DATABASE_URL=postgres://...
DATAJUD_API_KEY=...
DATAJUD_SYNC_INTERVAL_HOURS=6
ALERTA_DIAS_ESCALONAMENTO=3
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
EMAIL_REMETENTE=...
EMAIL_FALLBACK_PROCURADORIA=...
JWT_SECRET=...
PORT=3000
```

---

## 10. Estrutura de pastas sugerida

```
argus/
├── src/
│   ├── datajud/
│   │   ├── client.js        # chamadas HTTP à API DataJud
│   │   └── queries.js       # montagem de queries por tribunal/variação
│   ├── services/
│   │   ├── reconciliation.js
│   │   ├── alertEngine.js
│   │   └── linkBuilder.js   # geração de link eproc/PJe
│   ├── jobs/
│   │   └── syncScheduler.js # node-cron
│   ├── routes/
│   ├── models/               # queries SQL ou ORM leve (pg / knex — decisão do Claude Code)
│   ├── middleware/
│   └── app.js
├── migrations/
├── views/ (se server-rendered) ou frontend/ (se SPA)
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── README.md
```

---

## 11. Critérios de aceite do MVP

- [ ] Sync roda automaticamente e popula `processos`/`movimentos` a partir do TJMG real.
- [ ] Pelo menos 2 variações de nome cadastradas e testadas contra dados reais.
- [ ] Movimento novo gera alerta rastreável (não é só e-mail solto).
- [ ] Escalonamento funciona quando alerta fica pendente além do prazo configurado.
- [ ] Link de consulta pública abre o processo correto no eproc/PJe do TJMG.
- [ ] Dashboard permite visualizar, dar ciência e ver histórico de quem tratou o quê.
- [ ] Sistema roda via `docker-compose up` sem passos manuais adicionais.
- [ ] README documenta como obter/atualizar a chave pública do DataJud e como cadastrar novas variações de nome.

---

## 12. Roadmap pós-MVP (não implementar agora)

- Fase 2: credenciamento MNI junto ao TJMG (ofício formal) para dados de prazo mais confiáveis e próximos de tempo real.
- Fase 3: notificação via WhatsApp.
- Fase 4: cálculo de prazo em dias úteis (considerando feriados forenses).
- Fase 5: multi-tenant, caso outros municípios/clientes da agência tenham interesse no mesmo produto.
