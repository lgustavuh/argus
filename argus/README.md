# Argus

Sistema de acompanhamento de processos e alertas de prazo da **Procuradoria Municipal de Itaú de
Minas/MG**.

O Argus consulta periodicamente os processos do Município cadastrados nele, detecta movimentações
novas, separa as que podem abrir prazo (intimação, citação, sentença, publicação…) e cria
**alertas rastreáveis**: cada alerta tem um ciclo *pendente → visualizado → ciente* com registro de
quem fez o quê, e é **escalado** automaticamente se ninguém confirmar ciência dentro do prazo interno.

> Documento técnico (arquitetura, segurança, LGPD, integração MNI) para anexar ao ofício ao TJMG:
> [`docs/DOCUMENTO_TECNICO.md`](docs/DOCUMENTO_TECNICO.md) — também em `.docx` e `.pdf` na mesma
> pasta (gerados a partir do `.md`; se editar o `.md`, gere-os de novo).

---

## Sumário

1. [Perfis de acesso](#perfis-de-acesso)
2. [Como os processos entram no sistema](#como-os-processos-entram-no-sistema)
3. [Agenda, casos, documentos e indicadores](#agenda-casos-documentos-e-indicadores)
4. [Instalação](#instalação)
5. [Primeiro acesso e conta do administrador](#primeiro-acesso-e-conta-do-administrador)
6. [Configurações (tela)](#configurações-tela)
7. [Segredos do servidor (.env)](#segredos-do-servidor-env)
8. [Backup e restauração](#backup-e-restauração)
9. [HTTPS](#https)
10. [Operação do dia a dia](#operação-do-dia-a-dia)
11. [API REST](#api-rest)
12. [Estrutura do código](#estrutura-do-código)

---

## Perfis de acesso

Todos os processos cadastrados são do Município, então **todos os perfis veem todos os processos e
alertas**. O que muda é o que cada um pode alterar:

| Ação | Procurador | Advogado | Assistente Jurídico | Admin (TI) |
|---|:-:|:-:|:-:|:-:|
| Ver processos, alertas e linha do tempo | ✓ | ✓ | ✓ | ✓ |
| Confirmar ciência no Argus (não é ciência no tribunal) | ✓ | ✓ | — | ✓ |
| Cadastrar, importar, arquivar processos; definir responsável | ✓ | ✓ | — | ✓ |
| Lançar, editar e concluir prazos, audiências e tarefas na agenda | ✓ | ✓ | — | ✓ |
| Casos, etiquetas, anotações, documentos e modelos | ✓ | ✓ | — | ✓ |
| Ver agenda, casos, documentos (baixar) e indicadores | ✓ | ✓ | ✓ | ✓ |
| Disparar atualização manual | ✓ | ✓ | — | ✓ |
| Configurações, usuários e auditoria | — | — | — | ✓ |
| Recebe alertas por e-mail (quando configurado) | ✓ | ✓ | ✓ | — |
| Destino do escalonamento | ✓ | — | — | — |

- A **assistente jurídica** tem acesso somente leitura: abrir um alerta não muda o status dele.
- Abrir um alerta como procurador/advogado registra a **visualização** automaticamente; a
  **ciência** é um clique explícito, registrado com nome e horário. É uma ciência **interna** (a equipe
  viu o alerta e o escalonamento para); a ciência da intimação é feita no PJe/eproc.
- Cada alerta tem o botão **"Abrir no PJe/eproc"**, que leva à consulta do processo no sistema do
  tribunal, e "Copiar número" (o eproc pede CAPTCHA). Se o sistema não for conhecido, o alerta
  mostra os dois e o procurador/advogado informa em qual o processo tramita. O Argus nunca abre o
  teor de intimações nem pratica ato no tribunal.
- As regras ficam em `src/config/papeis.js` — altere lá, não espalhe verificações de perfil pelo código.

## Como os processos entram no sistema

A API pública do DataJud/CNJ **não informa as partes** dos processos (Portaria CNJ 160/2020 —
confirmado contra a API real), então não é possível "descobrir" automaticamente os processos do
Município por ela. Por isso o Argus trabalha com **números cadastrados**:

1. Em **Processos → Cadastrar processos**, cole uma lista de números (coluna do Excel, relatório do
   PJe/eproc, CSV — com ou sem pontuação) ou carregue um arquivo `.csv`/`.txt`. O sistema reconhece
   os números CNJ no texto, confere o dígito verificador, deduz o tribunal pelo próprio número e
   ignora os já cadastrados. Até 5.000 números por envio.
2. Logo após o cadastro, cada processo é consultado na fonte de dados (em segundo plano): classe,
   órgão julgador, graus e a linha do tempo completa de movimentações.
3. **Carga inicial:** na primeira consulta, o histórico entra inteiro na linha do tempo, mas só geram
   alerta as movimentações relevantes dos últimos 15 dias (configurável). Depois disso, toda
   movimentação relevante nova gera alerta.
4. Processos não encontrados ficam marcados como **"não localizado"** (segredo de justiça, ainda não
   indexado pelo tribunal ou número errado).
5. Processos encerrados podem ser **arquivados** — deixam de ser consultados e não geram alertas.

Quando o credenciamento **MNI** junto ao TJMG for concedido, a fonte de dados passa a ser o MNI, que
traz dados mais atuais e os **avisos de citação/intimação dirigidos ao Município** — com isso,
processos novos passam a ser cadastrados automaticamente. Ver
[Integração MNI](docs/DOCUMENTO_TECNICO.md#8-integração-mni-tjmg).

## Agenda, casos, documentos e indicadores

- **Agenda** (menu Agenda): prazos, audiências, tarefas e eventos, com data (para prazo, a data
  fatal), hora opcional, responsável e vínculo opcional com um processo ou caso. A lista agrupa em
  *vencidos, hoje, amanhã, próximos 7 dias e mais adiante*; o contador vermelho no menu mostra os
  vencidos sem conclusão. Num alerta, **"Registrar prazo"** abre o formulário já com o processo e o
  responsável. O formulário tem uma **calculadora de data fatal** (dias úteis do CPC, prazo em dobro
  da Fazenda, feriados nacionais e recesso de 20/12 a 20/01). Feriados municipais e suspensões do
  TJMG não entram e precisam ser conferidos.
- **Avisos por e-mail**: quem recebe um compromisso atribuído por outra pessoa é avisado na hora. De
  segunda a sexta, a partir das 7h, cada responsável recebe o **resumo da agenda** (vencidos e
  próximos N dias; os sem responsável vão para a procuradora). Liga/desliga e antecedência em
  Configurações → Geral.
- **Painel → Meu dia**: procuradores e advogados veem os próprios vencidos, hoje, amanhã e próximos;
  "ver de todos" mostra a agenda da Procuradoria.
- **Casos** (menu Casos): assuntos sem número de processo judicial (procedimento administrativo,
  notificação extrajudicial, consulta). Têm responsável, referência (SEI/protocolo), interessado,
  agenda, anotações e documentos, e podem ser vinculados a um processo quando forem judicializados.
- **Etiquetas**: livres, separadas por vírgula, em processos e casos; filtram as listas.
- **Anotações internas**: histórico escrito pela equipe em cada processo/caso; não podem ser apagadas.
- **Documentos**: anexos de até 25 MB (PDF, Word, planilhas, imagens, e-mail) em cada processo/caso,
  guardados em `argus/documentos/` com nome aleatório; download só com login. **Modelos** com campos
  como `{{numero_processo}}` e `{{orgao_julgador}}` geram ofícios e petições preenchidos, para copiar
  ou baixar no Word.
- **Indicadores**: prazos cumpridos até a data fatal, vencidos em aberto, tempo típico até a ciência
  dos alertas, agenda por responsável, movimentações relevantes por mês e processos por classe,
  órgão julgador e responsável.

## Instalação

Requisitos: Docker Desktop (Windows) ou Docker Engine + Compose (Linux).

```bash
cd argus
cp .env.example .env
node src/scripts/configurarSegredos.js   # gera JWT_SECRET, ENCRYPTION_KEY e POSTGRES_PASSWORD
# edite o .env e preencha DATAJUD_API_KEY e APP_BASE_URL
docker compose up -d --build
```

A aplicação sobe em `http://<servidor>:3000`. As migrations do banco rodam sozinhas no start.

> Em uma instalação **nova**, o `configurarSegredos.js` precisa do container `postgres` rodando para
> aplicar a senha do banco: rode `docker compose up -d postgres` antes dele. Se preferir, defina
> `POSTGRES_PASSWORD` manualmente no `.env` antes do primeiro `up` (ela só vale na criação do banco).

**Atualizar após mudanças no código:** `docker compose up -d --build`. (`docker compose restart`
**não** aplica código novo — só reinicia a imagem antiga.)

## Primeiro acesso e conta do administrador

- **Banco vazio:** a tela `/setup` cria o primeiro administrador (só funciona enquanto não existe
  nenhum usuário).
- **Criar ou recuperar um admin pela linha de comando** (ex.: senha do admin perdida):

  ```bash
  docker compose exec app node src/scripts/criarAdmin.js "Admin TI" ti@itaudeminas.mg.gov.br
  ```

  Gera uma senha provisória aleatória, exibida uma única vez. Se o e-mail já existir, a conta vira
  admin e recebe senha nova.
- Usuários criados pela tela (ou com senha redefinida pelo admin) **precisam trocar a senha no
  primeiro acesso**. Política: mínimo de 10 caracteres, com letras e números.
- Cada usuário troca a própria senha em **Minha conta**.

## Configurações (tela)

Menu **Configurações** (somente Admin TI):

| Aba | O que tem |
|---|---|
| **Geral** | Dias até escalar um alerta sem ciência (padrão 3); dias para considerar um processo parado; resumo diário da agenda por e-mail (liga/desliga, dias de antecedência); painel de status (chaves de segurança, DataJud, HTTPS, último backup). |
| **Usuários** | Criar, desativar, mudar perfil, redefinir senha. Desativar ou mudar perfil derruba a sessão do usuário na hora. |
| **Alertas** | Códigos TPU/CNJ que geram alerta e peso de urgência (1–5). Lista inicial conferida contra dados reais do TJMG. |
| **E-mail** | Servidor SMTP, porta, usuário, senha (guardada cifrada), remetente, e-mail geral; liga/desliga o envio; botão de e-mail de teste. Com o e-mail desligado, os alertas continuam no sistema (contador vermelho no menu). |
| **Integração** | Fonte de dados (DataJud; MNI quando implementado), atualização automática liga/desliga, intervalo em horas, janela da carga inicial, resumo da última atualização, botão "Atualizar agora", dados do MNI (WSDL, consultante, senha cifrada, observações). |
| **Auditoria** | Trilha de acessos e de todas as ações que alteram dados (quem, quando, IP). |

As configurações valem sem reiniciar o container.

## Segredos do servidor (.env)

O `.env` guarda **só** o que é do servidor; o resto está na tela. Nunca versione nem envie esse arquivo.

| Variável | Para que serve |
|---|---|
| `POSTGRES_PASSWORD` | Senha do banco (o compose monta a conexão com ela). |
| `JWT_SECRET` | Chave que assina as sessões (HS256). **Valor aleatório de 128 caracteres hexadecimais (512 bits)**; o mínimo aceito é 64 (256 bits). Não é um hash SHA-256 de uma frase — "SHA-256" é o algoritmo da assinatura, a chave em si deve ser aleatória. Em produção o sistema **não sobe** com chave curta ou de exemplo. Trocar a chave desconecta todos os usuários. |
| `ENCRYPTION_KEY` | Chave AES-256 (64 caracteres hex) que cifra as senhas de SMTP/MNI no banco. Se trocada, recadastre essas senhas. |
| `DATAJUD_API_KEY` | Chave pública do DataJud. O CNJ publica e às vezes troca: copie a vigente em <https://datajud-wiki.cnj.jus.br/api-publica/acesso/> e reinicie (`docker compose up -d`). |
| `APP_BASE_URL` | Endereço usado nos links dos e-mails (ex.: `http://192.168.0.10:3000`). |
| `COOKIE_SECURE` | `true` só se o acesso for por HTTPS (ver abaixo). |
| `TRUST_PROXY` | `1` se houver proxy reverso na frente (registra o IP real). |
| `BACKUP_RETENCAO_DIAS` | Quantos dias de backup manter (padrão 30). |

Gerar/regenerar os segredos: `node src/scripts/configurarSegredos.js` (só troca o que estiver
ausente ou fraco, faz cópia do `.env` anterior e nunca exibe valores).

## Backup e restauração

O serviço `backup` do docker-compose gera **um dump por dia** do banco em `argus/backups/` e apaga os
mais antigos que `BACKUP_RETENCAO_DIAS`. A aba **Configurações → Geral** mostra a data do último.

**Os documentos anexados não estão no dump do banco**: ficam em `argus/documentos/`. Inclua essa
pasta junto com `backups/` na cópia externa — sem ela, uma restauração traz os registros dos
documentos, mas não os arquivos.

Copie a pasta `backups/` (e `documentos/`) para outro local (servidor de arquivos da Prefeitura, mídia externa) com
alguma regularidade — backup na mesma máquina não protege contra perda do disco.

Restaurar um backup (substitui os dados atuais):

```bash
docker compose stop app
docker compose exec -T postgres pg_restore -U argus -d argus --clean --if-exists < backups/argus_AAAAMMDD_HHMM.dump
docker compose start app
```

## HTTPS

Na rede interna, `http://<servidor>:3000` funciona. Para acesso fora da rede, coloque um proxy
reverso com certificado (IIS com ARR, nginx ou Caddy) na frente da porta 3000 e defina no `.env`:
`COOKIE_SECURE=true` e `TRUST_PROXY=1`. Com isso o sistema também passa a enviar o cabeçalho HSTS.

## Operação do dia a dia

- **Contador vermelho no menu "Alertas"**: alertas sem ciência (pendentes, visualizados e escalados).
- **Contador vermelho no menu "Agenda"**: compromissos com data passada que ninguém concluiu.
- **Escalonamento**: verificado de hora em hora; alerta sem ciência após N dias vira "escalado", a
  equipe é avisada de novo e a procuradora fica registrada como destino. Alerta escalado continua
  aceitando ciência.
- **Atualização automática**: o relógio interno roda de hora em hora e dispara a consulta quando o
  intervalo configurado passou. Ligue/desligue em Configurações → Integração.
- **Logs**: `docker compose logs -f app`.

## API REST

JSON, para integrações futuras. Autenticação por `POST /api/auth/login` (`{ "email", "senha" }`) →
`{ token }`, enviado depois como `Authorization: Bearer <token>`. Mesmas permissões das telas.

```
POST  /api/auth/login
GET   /api/processos?busca=&situacao=&tribunal=&responsavelId=&pagina=&porPagina=
GET   /api/processos/:id                 (com movimentos)
POST  /api/processos                     { "numeros": ["..."] } ou { "texto": "lista livre" }
PATCH /api/processos/:id                 { responsavelId?, observacao?, ativo? }
GET   /api/alertas?status=abertos|pendente|visualizado|escalado|ciente
GET   /api/alertas/:id
PATCH /api/alertas/:id/visualizar
PATCH /api/alertas/:id/ciencia
POST  /api/sync/run
GET   /api/codigos-tpu        POST /api/codigos-tpu   (admin)
GET   /api/usuarios           POST /api/usuarios      (admin)
```

## Estrutura do código

```
src/
  app.js                 servidor Express, cabeçalhos de segurança (helmet/CSP), rotas
  config/                papeis.js (perfis e permissões), seguranca.js (checagens no start)
  fontes/                FONTES DE DADOS: datajud.js, mni.js (contrato pronto, aguardando credenciamento)
  datajud/               cliente HTTP da API pública (busca por lote de números, retry/backoff)
  services/              reconciliation (sync), alertEngine, agenda (avisos e resumo diário),
                         documentos (upload e modelos), cadastroProcessos, configuracoes,
                         auditoria, mailer, linkBuilder (link de consulta pública do TJMG)
  models/                acesso ao PostgreSQL (SQL puro, pg)
  middleware/            auth (sessão revalidada no banco), limiteLogin, origem (anti-CSRF)
  routes/web/            telas (EJS);  routes/api/  API REST
  scripts/               criarAdmin.js, configurarSegredos.js
  util/                  cnj (número CNJ/dígito verificador), cripto (AES-256-GCM), datas (dia em
                         Brasília), paginação, senha
public/js/prazos.js      calculadora de data fatal (CPC), usada na tela e testável no Node
migrations/              SQL versionado, aplicado no start
views/                   telas EJS;  public/  CSS e JS (sem script inline)
docs/                    documentação técnica
```

Design da interface: `PRODUCT.md` e `DESIGN.md`.
