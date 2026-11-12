# Argus — Documento Técnico

**Sistema de acompanhamento processual e alertas de prazo**
Procuradoria-Geral do Município de Itaú de Minas/MG — CNPJ 23.767.031/0001-78
Responsável técnico: Setor de Tecnologia da Informação (STI) da Prefeitura Municipal
Versão do documento: 1.2 — novembro/2026 (escopo: sem abertura de teor nem ciência no Tribunal)

> Documento destinado a acompanhar o pedido de credenciamento no Modelo Nacional de
> Interoperabilidade (MNI) do Tribunal de Justiça de Minas Gerais e a responder dúvidas técnicas
> da Diretoria de Tecnologia da Informação do Tribunal.

---

## 1. Objetivo

O Argus é um sistema interno da Procuradoria do Município, de uso exclusivo da sua equipe, que:

- reúne em uma única base os processos judiciais em que o Município é parte;
- acompanha periodicamente as movimentações desses processos;
- identifica as movimentações que podem abrir prazo processual (intimação, citação, sentença,
  publicação, decisão liminar etc.);
- gera **alertas rastreáveis** para a equipe, com registro de visualização e de ciência e com
  escalonamento automático quando a ciência não é confirmada no prazo interno.

O objetivo de negócio é eliminar a perda de prazo por falta de acompanhamento ("ninguém viu que o
processo andou").

## 2. Escopo — o que o sistema faz e o que não faz

**Faz (somente leitura em relação ao Tribunal):**
- Consulta dados de processos cujos números são conhecidos pela Procuradoria.
- Armazena metadados do processo (classe, órgão julgador, grau, sistema) e a lista de movimentações
  com seus códigos da Tabela Processual Unificada (TPU/CNJ).
- Gera alertas internos e, opcionalmente, notificações por e-mail para a equipe.

**Não faz:**
- **Nenhum peticionamento, protocolo, manifestação ou ato processual.** O Argus não escreve nada no
  sistema do Tribunal.
- **Não abre teor de comunicação processual nem registra ciência**, em nenhuma hipótese (ver §8.3).
  A ciência e as providências são praticadas pelos procuradores diretamente no PJe ou no eproc.
- Não calcula a data fatal do prazo com valor jurídico; sinaliza que há movimentação que pode abrir
  prazo, e a contagem continua sob responsabilidade do procurador/advogado.
- Não é acessível ao público nem a terceiros.

## 3. Usuários e perfis

Uso restrito à equipe da Procuradoria (1 procuradora, 2 advogados e 1 assistente jurídica na data
deste documento) e ao responsável técnico da TI da Prefeitura:

| Perfil | Quem | Pode |
|---|---|---|
| Procurador | Procurador(a) do Município | Ver tudo, dar ciência, cadastrar/arquivar processos; destino do escalonamento |
| Advogado | Advogados do Município | Ver tudo, dar ciência, cadastrar/arquivar processos |
| Assistente Jurídico | Assistente jurídica | Somente leitura; recebe os alertas |
| Admin (TI) | Responsável técnico do STI | Configurações do sistema, gestão de usuários, auditoria |

Contas são pessoais e intransferíveis, criadas apenas pelo administrador; não há autocadastro.

## 4. Arquitetura

```
 ┌──────────────────────────── Servidor da Prefeitura (Docker) ───────────────────────────┐
 │                                                                                        │
 │  ┌─────────────────┐       ┌───────────────────────────────────────────┐               │
 │  │ Navegador       │  HTTP │ Aplicação Argus (Node.js 20 + Express)    │               │
 │  │ da equipe       ├──────►│  - telas (server-side) e API REST         │               │
 │  │ (rede interna)  │  (S)  │  - autenticação e perfis                  │               │
 │  └─────────────────┘       │  - agendador interno (hora em hora)       │               │
 │                            │  - motor de alertas e escalonamento       │               │
 │                            │  - camada de FONTES DE DADOS ─────────────┼───────┐       │
 │                            └─────────────┬─────────────────────────────┘       │       │
 │                                          │ SQL (rede interna Docker)           │       │
 │                            ┌─────────────▼──────────────┐    ┌──────────┐      │       │
 │                            │ PostgreSQL 16              │◄───┤ Backup   │      │       │
 │                            │ (não exposto fora do host) │    │ diário   │      │       │
 │                            └────────────────────────────┘    └──────────┘      │       │
 └────────────────────────────────────────────────────────────────────────────────┼───────┘
                                                                    HTTPS (saída) │
                         ┌────────────────────────────────────────────────────────┴───┐
                         │ Hoje: API Pública do DataJud/CNJ                           │
                         │ Após credenciamento: MNI do TJMG (SOAP; PJe e eproc)       │
                         └────────────────────────────────────────────────────────────┘
```

- **Hospedagem:** servidor da própria Prefeitura, em containers Docker (aplicação, banco e backup).
  Nenhum dado é enviado a serviços de terceiros além das consultas ao CNJ/Tribunal.
- **Comunicação externa:** apenas conexões de **saída** HTTPS para a fonte de dados (DataJud hoje,
  MNI após o credenciamento) e, se configurado, para o servidor de e-mail da Prefeitura.
- **Banco de dados:** PostgreSQL 16, acessível apenas pela rede interna do Docker (a porta não é
  publicada no servidor).
- **Tecnologias:** Node.js 20, Express 4, PostgreSQL 16, EJS, bcrypt, JSON Web Token (HS256),
  helmet, nodemailer, node-cron.

## 5. Funcionamento

### 5.1 Entrada dos processos
A Procuradoria cadastra os números CNJ dos processos (individualmente ou por importação de lista).
O sistema valida o dígito verificador (Res. CNJ 65/2008, ISO 7064 mod 97-10) e identifica o tribunal
pelos segmentos J.TR do número.

### 5.2 Consulta periódica
De hora em hora o agendador verifica se o intervalo configurado (padrão: 6 horas) passou desde a
última consulta. Em caso positivo, consulta a fonte de dados para todos os processos ativos, em
lotes. Para cada processo, compara as movimentações recebidas com as já armazenadas (deduplicação
por hash de processo + código TPU + data/hora + ordem da repetição, de modo que duas movimentações
iguais lançadas no mesmo segundo são registradas separadamente) e grava apenas as novas.

### 5.3 Classificação e alertas
Movimentações cujo código TPU consta da lista de "códigos relevantes" (configurável; ex.: 12265/12266
intimação expedida/confirmada, 12282/12287/12288 citação/notificação, 219/220/221 sentença, 1061
disponibilização no DJe, 92 publicação, 339/792 liminar) geram um alerta.

Ciclo do alerta, todo registrado em trilha de auditoria:

```
 pendente ──(procurador/advogado abre)──► visualizado ──(clica "Dar ciência")──► ciente
     │                                         │
     └──────(N dias sem ciência)───────────────┴──► escalado ──(ciência)──► ciente
```

Na primeira consulta de um processo, o histórico completo entra na linha do tempo, mas só geram
alerta as movimentações dos últimos 15 dias (configurável), evitando alertas sobre atos antigos.

### 5.4 Volume e carga sobre a fonte de dados
A carga prevista é baixa: algumas centenas de processos, consultados em lotes de até 100 números
por requisição na API pública, a cada 6 horas (intervalo ajustável). Há tratamento de limitação de
taxa (HTTP 429) com espera exponencial. No MNI, a frequência e o paralelismo serão ajustados ao que
o Tribunal indicar.

## 6. Segurança da informação

| Controle | Implementação |
|---|---|
| Autenticação | E-mail e senha pessoais; senhas armazenadas com **bcrypt** (custo 12), nunca em texto. |
| Política de senha | Mínimo de 10 caracteres com letras e números; senha provisória com troca obrigatória no primeiro acesso. |
| Proteção contra força bruta | Bloqueio de 15 minutos após 5 tentativas erradas por conta (20 por endereço IP). |
| Sessão | Token JWT assinado com HMAC-SHA-256 e chave aleatória de 512 bits; cookie `HttpOnly`, `SameSite=Lax` (e `Secure` sob HTTPS); validade de 12 h; o usuário é revalidado no banco a cada requisição — desativação, troca de perfil ou de senha encerra a sessão imediatamente. |
| Autorização | Perfis com permissões centralizadas; verificação no servidor em todas as telas e na API. |
| Ataques web | Cabeçalhos de segurança (Content-Security-Policy sem script inline, X-Frame-Options/frame-ancestors, nosniff, Referrer-Policy); verificação de origem em requisições que alteram dados (anti-CSRF); consultas SQL parametrizadas; saída HTML escapada. |
| Segredos | Chaves do servidor fora do código (arquivo `.env` restrito ao servidor); senhas de integração (SMTP, MNI) cifradas no banco com **AES-256-GCM**. O sistema se recusa a iniciar em produção com chave de sessão fraca. |
| Auditoria | Registro de logins (inclusive falhos e bloqueados), visualizações, ciências, cadastros, arquivamentos, alterações de configuração e de usuários — com usuário, data/hora e IP. Senhas nunca são registradas. |
| Disponibilidade | Containers com reinício automático; backup diário do banco com retenção configurável (padrão 30 dias). |
| Transporte | Rede interna; para acesso externo, proxy reverso com certificado TLS (HTTPS + HSTS). |
| Dependências | Bibliotecas mantidas em versões sem vulnerabilidades conhecidas de severidade alta (verificação `npm audit`). |

### 6.1 Certificado digital (MNI)
Como o Argus consulta o Tribunal sem intervenção humana, o certificado ICP-Brasil exigido para o
MNI deve ser do **tipo A1** (arquivo), institucional (e-CNPJ) ou do procurador (e-CPF), conforme o
Tribunal admitir. Certificados A3 (token ou cartão) exigem a presença física do titular e não se
prestam a consultas automáticas. O certificado:

- ficará armazenado apenas no servidor da Prefeitura, em pasta montada somente para leitura no
  container, com acesso restrito ao responsável técnico;
- terá a senha de uso cifrada no banco com AES-256-GCM, como as demais credenciais de integração;
- terá a validade acompanhada pelo sistema, com aviso ao administrador antes do vencimento;
- nunca será transmitido a terceiros nem incluído no código-fonte.

## 7. Proteção de dados pessoais (LGPD)

- **Base legal:** execução de competência legal e cumprimento de obrigação legal pela Administração
  Pública — defesa judicial do Município (Lei 13.709/2018, art. 7º, II e III, e art. 23).
- **Finalidade única:** acompanhamento dos processos em que o Município é parte, para cumprimento de
  prazos. Os dados não são usados para nenhuma outra finalidade nem compartilhados.
- **Minimização:** são armazenados apenas os dados necessários ao acompanhamento (número, classe,
  órgão julgador, movimentações). A integração MNI poderá trazer o nome das partes, que será usado
  somente para confirmar que o Município figura no processo.
- **Processos sigilosos:** processos em segredo de justiça só serão acessados nos limites da
  autorização concedida pelo Tribunal; a aplicação não tenta contornar restrições de acesso.
- **Acesso:** restrito à equipe da Procuradoria por conta pessoal, com trilha de auditoria.
- **Retenção:** processos encerrados podem ser arquivados no sistema; os dados ficam sob guarda da
  Prefeitura enquanto necessários à defesa do Município e ao cumprimento de normas de arquivo público.

## 8. Integração MNI (TJMG)

### 8.1 Situação atual
Hoje a fonte de dados é a **API Pública do DataJud/CNJ**, que não informa as partes do processo
(Portaria CNJ 160/2020) e tem defasagem de atualização. Por isso o Município precisa conhecer e
cadastrar os números de seus processos, e processos novos só entram quando alguém os cadastra.

### 8.2 O que muda com o MNI
O sistema já foi construído com uma **camada de fontes de dados**: toda consulta passa por um
contrato único (`consultarProcessos` e `descobrirProcessos`), e a troca de fonte é uma opção na tela
de configuração. O conector MNI será implementado sobre esse contrato assim que o acesso for
concedido, na versão do MNI que o Tribunal disponibilizar (o PJe aceita as versões 2.2.2, 2.2.3 e
3.0.0), usando as operações do serviço de intercomunicação:

| Operação MNI | Uso no Argus |
|---|---|
| `consultarProcesso` (com movimentos e cabeçalho) | Atualizar dados e movimentações dos processos cadastrados, com informação mais atual que a do DataJud. |
| `consultarAvisosPendentes` | Listar citações e intimações pendentes dirigidas ao Município e **cadastrar automaticamente processos novos**. |
| `consultarTeorComunicacao` | **Não utilizada** (ver §8.3). |

Nenhuma operação de envio (`entregarManifestacaoProcessual`) será utilizada.

Como o TJMG mantém processos no PJe e, em expansão pelas comarcas, no eproc, o Argus consultará o
endereço MNI de cada sistema e grau. O sistema que responder pelo processo passa a ser o sistema
registrado para ele, informação que a API pública do DataJud muitas vezes não traz.

### 8.3 Cuidado com a ciência das comunicações
A consulta ao teor de uma comunicação pode ser registrada pelo Tribunal como ciência da intimação,
iniciando a contagem do prazo. Por isso o Argus **nunca abre o teor de comunicações e não registra
ciência no Tribunal**: ele apenas lista os avisos pendentes, informa a data em que ocorrerá a ciência
tácita e alerta a equipe, com um atalho para o processo no PJe ou no eproc. A ciência e as demais
providências são praticadas pelo procurador no sistema do Tribunal. A "ciência" registrada dentro do
Argus é apenas interna (confirma que a equipe viu o alerta) e não tem efeito processual.

### 8.4 Dados necessários do Tribunal
- Endereços (WSDL) do serviço MNI para cada sistema e grau — PJe 1º e 2º graus e eproc 1º e 2º
  graus — e do ambiente de homologação, se houver;
- Versão do MNI disponível em cada sistema (2.2.2, 2.2.3 ou 3.0.0);
- Forma de autenticação (identificador/senha do consultante e/ou certificado ICP-Brasil) e tipo de
  certificado aceito (institucional ou pessoal);
- Se o Município poderá consultar, pelo MNI, os avisos de citação e intimação pendentes a ele
  dirigidos (`consultarAvisosPendentes`);
- Limites de uso (frequência de consultas, horários, paralelismo) a serem respeitados;
- Contato técnico na Diretoria de TI para o período de homologação.

## 9. Responsabilidades

- **Prefeitura (STI):** hospedagem, segurança do servidor, guarda do certificado e das credenciais,
  backups, atualização do sistema, gestão de contas e auditoria.
- **Procuradoria:** cadastro dos processos, tratamento dos alertas e contagem dos prazos.
- **Ponto de contato técnico:** Setor de Tecnologia da Informação — Prefeitura Municipal de Itaú de
  Minas/MG.
