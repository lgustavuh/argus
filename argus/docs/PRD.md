# PRD — Argus

**Produto:** Argus — Sistema de Unificação e Alerta de Processos
**Cliente:** Procuradoria Municipal de Itaú de Minas/MG
**Versão do documento:** 1.0 — 11/11/2026 (reconstruído a partir do sistema em produção, v0.1.0)
**Documentos relacionados:** [`README.md`](../README.md) (operação), [`DOCUMENTO_TECNICO.md`](DOCUMENTO_TECNICO.md)
(arquitetura, segurança, LGPD, MNI), [`PRODUCT.md`](../PRODUCT.md) e [`DESIGN.md`](../DESIGN.md) (tom e design).
A especificação original (`../MVP_SPEC.md`, fora do repositório) é histórica; este PRD a substitui.

---

## 1. Problema

A Procuradoria acompanha processos espalhados em vários sistemas de tribunal (PJe, eproc, Projudi)
e depende de alguém abrir cada um para descobrir se houve intimação, citação ou sentença. O risco
central é **perder prazo porque ninguém viu a movimentação** — e, quando acontece, não há como
responder "quem foi avisado e quando".

## 2. Objetivo e métricas de sucesso

| Objetivo | Métrica | Meta |
|---|---|---|
| Nenhum prazo perdido por falta de acompanhamento | Prazos da agenda vencidos sem conclusão (tela Indicadores) | 0 por mês |
| Toda movimentação relevante vira alerta rastreável | Movimentos relevantes sem alerta (fora da carga inicial) | 0 |
| Ciência rápida | Tempo mediano entre criação do alerta e ciência | ≤ 1 dia útil |
| Pouco escalonamento | % de alertas que chegam a "escalado" | < 10% |
| Base completa | % dos processos ativos com consulta "localizado" | ≥ 90% |
| Rastreabilidade | Toda ação sobre alerta/processo com autor e horário na auditoria | 100% |

## 3. Usuários

| Perfil | Quem é | O que precisa |
|---|---|---|
| **Procurador** | Responsável jurídico; destino do escalonamento | Ver o que exige atenção hoje, dar ciência, distribuir responsáveis |
| **Advogado** | Atua nos processos | Mesmo fluxo do procurador, sem receber escalonamento |
| **Assistente Jurídico** | Apoio administrativo | Consultar tudo, receber alertas por e-mail; **somente leitura** |
| **Admin (TI)** | Equipe de TI da Prefeitura | Usuários, configurações, auditoria, backup; não atua nos processos |

Uso típico: checagens curtas e recorrentes durante o expediente ("tem algo novo?"), em desktop,
na rede interna da Prefeitura.

## 4. Princípios de produto

1. **Somente leitura nos tribunais** — o Argus monitora; nunca peticiona nem assina.
2. **Rastreabilidade acima de conveniência** — ciência é um clique explícito, registrado; anotações não são apagáveis.
3. **Urgência primeiro** — o que precisa de atenção salta; o que foi tratado recua (ver `PRODUCT.md`).
4. **Nenhum alerta pode se perder** — falha de e-mail, de rede ou de tribunal nunca pode apagar silenciosamente um alerta.
5. **Single-tenant, on-premise** — um município, servidor próprio, dados sob controle da Prefeitura (LGPD).

---

## 5. Escopo atual (implementado — v0.1.0)

### 5.1 Processos
- **RF-01** Cadastro em massa por texto livre ou `.csv`/`.txt` (até 5.000 números por envio), com extração de números CNJ, validação do dígito verificador (ISO 7064 mod 97-10) e dedução do tribunal pelo número. ✅
- **RF-02** Consulta à fonte de dados logo após o cadastro, em segundo plano. ✅
- **RF-03** Situação da consulta: localizado / não localizado; arquivar e reativar processos. ✅
- **RF-04** Responsável por processo (procurador ou advogado), observação, sistema de tramitação informado manualmente. ✅
- **RF-05** Linha do tempo de movimentações de todos os graus, com correção de fuso (DataJud entrega hora local marcada como UTC). ✅
- **RF-06** Link para a consulta pública no sistema de origem, com links alternativos. ✅

### 5.2 Sincronização
- **RF-07** Relógio interno de hora em hora; sync quando o intervalo configurado passou; pode ser pausado pela tela. ✅
- **RF-08** Deduplicação de movimentos por hash (processo + código TPU + data/hora + ocorrência). ✅
- **RF-09** Carga inicial: histórico completo entra na linha do tempo, mas só geram alerta movimentos relevantes dos últimos N dias (padrão 15). ✅
- **RF-10** Falha de um tribunal não marca seus processos como "não localizado". ✅
- **RF-11** Sync manual pelo painel/configurações (em segundo plano) e pela API. ✅
- **RF-12** Camada de fontes plugável (`src/fontes/`): DataJud ativo; MNI/TJMG estruturado, aguardando credenciamento. 🟡

### 5.3 Alertas
- **RF-13** Movimento com código TPU relevante gera alerta; códigos e peso de urgência configuráveis. ✅
- **RF-14** Ciclo pendente → visualizado (automático ao abrir, para quem pode dar ciência) → ciente (clique explícito). ✅
- **RF-15** Escalonamento automático após N dias sem ciência; nova notificação à equipe. ✅
- **RF-16** E-mail para a equipe (procurador, advogado, assistente) em alerta novo e escalado; e-mail de reserva se não houver destinatário. ✅
- **RF-17** Contador de alertas sem ciência no menu. ✅

### 5.4 Agenda, casos e documentos
- **RF-18** Compromissos (prazo, audiência, tarefa, evento) vinculados a processo, caso ou alerta; responsável; concluir/cancelar. ✅
- **RF-19** "Meu dia" no painel; contador de compromissos vencidos. ✅
- **RF-20** Aviso por e-mail ao ser atribuído; resumo diário (dias úteis, 7h) por responsável. ✅
- **RF-21** Casos sem número judicial (procedimentos administrativos etc.). ✅
- **RF-22** Etiquetas livres em processos e casos; anotações internas imutáveis. ✅
- **RF-23** Documentos anexos (até 25 MB, lista fechada de tipos) e modelos de documento com campos `{{...}}`. ✅

### 5.5 Gestão e indicadores
- **RF-24** Indicadores: prazos cumpridos até a data fatal, vencidos em aberto, tempo típico até ciência. ✅
- **RF-25** Configurações pela tela (e-mail/SMTP, prazos, integração, aparência dos e-mails); senhas de SMTP/MNI cifradas (AES-256). ✅
- **RF-26** Usuários, perfis, senha provisória com troca obrigatória, auditoria de ações. ✅
- **RF-27** API REST JSON com token Bearer (processos, alertas, sync, códigos TPU, usuários). ✅

### 5.6 Requisitos não funcionais (atendidos)
- **RNF-01 Segurança:** JWT HS256 revalidado no banco a cada requisição (`sessao_versao`); recusa subir em produção com segredo fraco; CSP restritiva; defesa CSRF (Sec-Fetch-Site/Origin + SameSite); limite de tentativas de login; bcrypt custo 12; SQL parametrizado; uploads com nome aleatório.
- **RNF-02 Datas:** "hoje" sempre em America/Sao_Paulo; colunas DATE tratadas como texto `AAAA-MM-DD`.
- **RNF-03 Operação:** Docker Compose (app + Postgres 16 + backup diário com retenção); migrations automáticas no start.
- **RNF-04 Idioma:** interface, mensagens e documentação em português.

---

## 6. Fora de escopo

- Peticionamento, protocolo ou assinatura digital em tribunal.
- Cálculo jurídico da data fatal com certeza (dias úteis, feriados forenses, suspensões) — o prazo é lançado por pessoa.
- Multi-município / multi-tenant.
- Descoberta automática de processos pela API pública do DataJud (ela não expõe partes — Portaria CNJ 160/2020).
- Notificação por WhatsApp (candidata a fase futura).

---

## 7. Bugs conhecidos

Encontrados na revisão de 11/11/2026. Severidade: 🔴 alta · 🟠 média · 🟡 baixa.

**Status (12/11/2026):**
- ✅ **BUG-02** corrigido — `movimentos.alerta_pendente` (migration 010); alerta e remoção da marca na mesma transação; reprocessamento no fim de cada sync e de hora em hora; e-mail não desfaz alerta. Coberto por `test/alertas.integracao.test.js`.
- ✅ **BUG-04** corrigido — escalonamento só notifica se `marcarEscalado` de fato escalou. Coberto por teste.
- ✅ **BUG-01** corrigido — `.gitignore` corrigido; dumps, `.env.bak` e `.claude/settings.local.json` removidos do índice **e de todo o histórico** (reescrita + force push em 12/11/2026, autorizada). Repositório privado: troca de segredos não foi necessária.
- ✅ **BUG-14** corrigido — `npm audit fix` + `node-cron` 4.6: `npm audit` sem vulnerabilidades.
- ✅ **BUG-15** corrigido (encontrado em 12/11/2026) — **o backup diário não estava sendo gravado.** A pasta do projeto foi movida de `Desktop\Sistema Juridico\argus` para `Desktop\Argus\argus` sem recriar os containers; os bind mounts de `backups/` e `documentos/` apontavam para um caminho inexistente. Último backup real: 11/11/2026 14:48 (nenhum documento anexado foi perdido — tabela vazia). Resolvido recriando a stack a partir da pasta nova. **Ao mover a pasta do projeto, sempre rodar `docker compose up -d` na pasta nova.**

| ID | Sev. | Problema | Onde | Correção proposta |
|---|:-:|---|---|---|
| BUG-01 | 🔴 | **Dumps do banco e `.env.bak` versionados e enviados ao GitHub.** O `.gitignore` não cobre `backups/` nem `.env.bak*`. Os dumps têm dados reais (processos, usuários, hashes de senha, auditoria). | `.gitignore` | Ignorar `backups/`, `.env.*` (exceto `.env.example`) e `documentos/`; `git rm --cached`; reescrever histórico e trocar segredos se o repositório tiver sido exposto. |
| BUG-02 | 🔴 | **Alerta pode se perder no sync.** Os movimentos são gravados antes dos alertas; se `criarAlertaParaMovimento` falhar (erro de banco, configuração), os movimentos restantes já têm hash gravado e nunca mais geram alerta. Viola o princípio 4. | `src/services/reconciliation.js:86` | Gravar movimento + alerta na mesma transação, ou marcar `alerta_pendente` no movimento e reprocessar; isolar falha por movimento. |
| BUG-03 | 🟠 | **Envio de e-mail dentro do sync.** Cada alerta envia e-mail sequencialmente para cada destinatário, abrindo uma conexão SMTP por mensagem (timeout de 15 s). Com SMTP lento, um sync com muitos alertas leva minutos/horas e segura o `emAndamento`. | `src/services/alertEngine.js:19`, `src/services/mailer.js` | Fila/outbox de e-mails (tabela) processada pelo scheduler; transporter reutilizado (pool). |
| BUG-04 | 🟠 | **E-mail de escalonamento enviado mesmo se a ciência foi dada no meio.** `marcarEscalado` retorna `null` quando o alerta deixou de estar pendente, mas o retorno é ignorado. | `src/services/alertEngine.js:73` | Só notificar se `marcarEscalado` retornou o alerta. |
| BUG-05 | 🟠 | **Enumeração de usuários pela API.** `POST /api/auth/login` só roda `bcrypt.compare` quando o e-mail existe; o tempo de resposta revela e-mails válidos (a tela de login já usa hash fictício). | `src/routes/api/index.js:32` | Usar o mesmo `HASH_FICTICIO` da rota web (extrair para um serviço de login comum). |
| BUG-06 | 🟠 | **Responsável sem validação.** `POST /processos/:id/responsavel` e `PATCH /api/processos/:id` aceitam qualquer id: usuário inativo, admin ou assistente vira responsável; id inexistente gera erro 500 (FK). | `src/routes/web/processos.js:124`, `src/routes/api/index.js:88` | Validar contra `listAtivosPorPapeis(PAPEIS_RESPONSAVEIS)`; responder 400. |
| BUG-07 | 🟡 | **IDs não numéricos geram 500 na API.** Rotas `/api/processos/:id` e `/api/alertas/:id` não restringem `:id` a dígitos (as rotas web restringem). | `src/routes/api/index.js:65` e seguintes | Usar `:id(\\d+)` como nas rotas web. |
| BUG-08 | 🟡 | **`POST /api/usuarios` responde "E-mail já cadastrado" para qualquer erro.** | `src/routes/api/index.js:169` | Tratar só o código `23505` (unique violation); repassar os demais ao handler de erro. |
| BUG-09 | 🟡 | **`POST /api/sync/run` síncrono.** Segura a requisição HTTP durante o sync inteiro (pode passar de minutos; proxies cortam). | `src/routes/api/index.js:134` | Responder 202 e disparar em segundo plano, como no painel; expor `GET /api/sync/status`. |
| BUG-10 | 🟡 | **Logout não invalida o token** (JWT continua válido por até 12 h se tiver sido copiado) e é um `GET` (pode ser disparado por outro site). | `src/routes/web/auth.js:79` | `POST /logout` incrementando `sessao_versao`. |
| BUG-11 | 🟡 | **Corrida no `/setup`.** Duas requisições simultâneas com o banco vazio podem criar dois admins; e o primeiro a acessar um servidor recém-instalado vira admin. | `src/routes/web/auth.js:23` | Inserir com `INSERT ... WHERE NOT EXISTS` / advisory lock; opcional: token de setup impresso no log. |
| BUG-12 | 🟡 | **Fetch ao DataJud sem timeout explícito.** Depende dos 300 s padrão do undici por tentativa (× 6 tentativas). | `src/datajud/client.js:14` | `signal: AbortSignal.timeout(30_000)`. |
| BUG-13 | 🟡 | **Resumo diário descarta compromissos sem responsável** quando não há procurador ativo. | `src/services/agenda.js:55` | Cair para o e-mail de reserva ou para os admins. |
| BUG-14 | 🟡 | **Dependências com vulnerabilidade conhecida** (`npm audit`): `body-parser` (alta, DoS), `nodemailer`, `uuid` (moderadas). | `package-lock.json` | `npm audit fix`; revisar periodicamente. |

---

## 8. Melhorias recomendadas

### 8.1 Qualidade e engenharia
- **MEL-01 Testes automatizados (prioridade máxima).** 🟡 Iniciado em 12/11/2026: `npm test` (`node:test`), unitários de `util/cnj`, `util/datas`, `util/fuso` e integração do sync/alertas/escalonamento com Postgres descartável (`TEST_DATABASE_URL`). Falta: rotas/permissões, agenda, documentos. Começar por `node:test` + `supertest`, sem dependência nova pesada:
  unidade em `util/cnj`, `util/datas`, `util/fuso`, `hashDedup`/`consolidar`; integração em `aplicarDadosDaFonte` (carga inicial, repetições no mesmo segundo, falha de tribunal), escalonamento e permissões por perfil. Meta: 80% nas regras de negócio.
- **MEL-02 CI** (GitHub Actions): `npm ci`, `node --check`, testes com Postgres de serviço, `npm audit --omit=dev`.
- **MEL-03 Lint/format** (ESLint + Prettier) com as regras já seguidas no código (4 espaços, aspas simples).
- ✅ **MEL-04 / MEL-05** feitos em 12/11/2026 (Node 22, `npm ci`, `USER node`, `HEALTHCHECK` em `/healthz`, node-cron 4). Texto original:
- **MEL-04 Dockerfile:** `npm ci --omit=dev`, `USER node`, `HEALTHCHECK`, `NODE_ENV=production`; atualizar a imagem de `node:20` (fim de suporte em abr/2026) para `node:22`/`node:24` LTS e o `node-cron` para 4.x (fecha BUG-14).
- **MEL-05 Endpoint `/healthz`** (app + banco) para o healthcheck e monitoramento.
- **MEL-06 Commits pequenos** por funcionalidade, mensagens no padrão Conventional Commits.

### 8.2 Produto
- **MEL-07 Integração MNI/TJMG** assim que o credenciamento sair (avisos de citação/intimação → cadastro automático de processos).
- **MEL-08 Sugestão de data fatal** a partir do tipo de movimento + calendário de feriados forenses (sempre como sugestão editável, nunca automático).
- **MEL-09 Escalonamento em dias úteis** (hoje conta dias corridos, inclusive fins de semana).
- **MEL-10 Escalonamento para o responsável do processo primeiro**, depois para o procurador (hoje vai para o primeiro procurador por ordem alfabética).
- **MEL-11 Outbox de e-mail com reenvio** e tela de "e-mails não entregues" (resolve BUG-03 e dá visibilidade).
- **MEL-12 Limite de login persistente** (tabela) para sobreviver a reinício do container.
- **MEL-13 Alerta de "processo parado"** (sem movimentação há N dias) como notificação, não só no painel.
- **MEL-14 Exportação** (CSV/PDF) de processos, alertas e agenda para relatórios à chefia.
- **MEL-15 Retenção/LGPD:** política de expurgo de auditoria e documentos de processos arquivados.

---

## 9. Roadmap proposto

| Fase | Conteúdo | Critério de saída |
|---|---|---|
| **0 — Higiene (imediato)** | BUG-01, BUG-14 | Repositório sem dados/segredos; `npm audit` sem alta |
| **1 — Confiabilidade** | MEL-01, MEL-02, BUG-02, BUG-03/MEL-11, BUG-04 | Testes cobrindo sync e alertas; nenhum caminho que perca alerta |
| **2 — Endurecimento** | BUG-05 a BUG-13, MEL-04, MEL-05, MEL-12 | API e auth sem as falhas listadas |
| **3 — MNI** | MEL-07 | Processos novos cadastrados por aviso do TJMG |
| **4 — Prazos** | MEL-08, MEL-09, MEL-10, MEL-13, MEL-14 | Sugestão de data fatal em uso pela equipe |

## 10. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Defasagem do DataJud (dias) | Alerta chega tarde | Prazo continua sendo conferido no sistema do tribunal; MNI na fase 3 |
| Processo em segredo de justiça não aparece | Processo fica "não localizado" | Situação visível na lista; acompanhamento manual |
| Servidor único, sem redundância | Indisponibilidade | Backup diário + restauração documentada; testar restauração periodicamente |
| E-mail da Prefeitura fora do ar | Equipe não é avisada | Alertas continuam no sistema; outbox com reenvio (MEL-11) |
| Credenciamento MNI negado ou demorado | Cadastro continua manual | Importação em massa já atende |

## 11. Questões em aberto

1. O repositório `lgustavuh/argus` é público ou privado? (define a urgência da reescrita de histórico — BUG-01)
2. O escalonamento deve contar dias úteis? (MEL-09)
3. Há fonte oficial de feriados forenses do TJMG para usar na sugestão de data fatal? (MEL-08)
4. Política de retenção de dados exigida pela Prefeitura/LGPD? (MEL-15)
