---
name: Argus
description: Painel de monitoramento de processos judiciais para a Procuradoria Municipal de Itaú de Minas/MG
colors:
  ink: "oklch(24% 0.015 255)"
  ink-muted: "oklch(46% 0.018 255)"
  ink-faint: "oklch(62% 0.014 255)"
  surface: "oklch(96% 0.005 255)"
  surface-card: "oklch(99% 0.003 255)"
  border: "oklch(90% 0.008 255)"
  border-strong: "oklch(82% 0.012 255)"
  sidebar-bg: "oklch(21% 0.025 258)"
  sidebar-bg-raised: "oklch(27% 0.032 258)"
  sidebar-text: "oklch(74% 0.02 255)"
  sidebar-text-active: "oklch(98% 0.004 255)"
  primary: "oklch(48% 0.14 255)"
  primary-hover: "oklch(42% 0.15 255)"
  primary-soft: "oklch(94% 0.025 255)"
  status-pendente: "oklch(55% 0.19 25)"
  status-pendente-bg: "oklch(95% 0.03 25)"
  status-visualizado: "oklch(58% 0.15 75)"
  status-visualizado-bg: "oklch(95% 0.045 75)"
  status-ciente: "oklch(55% 0.13 150)"
  status-ciente-bg: "oklch(95% 0.035 150)"
  status-escalado: "oklch(48% 0.16 300)"
  status-escalado-bg: "oklch(94% 0.035 300)"
typography:
  headline:
    fontFamily: "Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.04em"
  mono:
    fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "10px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface-card}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface-card}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  nav-item:
    backgroundColor: "{colors.sidebar-bg}"
    textColor: "{colors.sidebar-text}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  nav-item-active:
    backgroundColor: "{colors.sidebar-bg-raised}"
    textColor: "{colors.sidebar-text-active}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  badge-pendente:
    backgroundColor: "{colors.status-pendente-bg}"
    textColor: "{colors.status-pendente}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
---

# Design System: Argus

## 1. Overview

**Creative North Star: "The Quiet Watch"**

Argus existe para que ninguém precise ficar recarregando um site do tribunal com medo de perder
prazo. O sistema vigia; o procurador só precisa olhar quando o Argus aponta. Por isso a interface
inteira segue uma regra simples: **o que precisa de atenção agora se destaca; o que já foi
resolvido recua e sai do caminho.** Não é um painel para impressionar — é um painel de guarda,
consultado várias vezes ao dia, entre outras tarefas, num escritório com luz normal de expediente.

A composição segue o padrão de referência trazido pelo cliente (sidebar escura ancorando a
navegação, conteúdo claro para leitura prolongada de tabelas e linhas do tempo), mas com
identidade e paleta próprias — nada de verde-Aurum ou do logo do concorrente. A sidebar escura
não é decoração: é o "perímetro" do sistema, sempre visível, sempre no mesmo lugar, como um posto
de vigia. O conteúdo claro é a mesa de trabalho.

Rejeita explicitamente: grades de cards idênticos sem hierarquia, hero-metrics com gradiente,
glassmorphism decorativo, qualquer tom lúdico ou gamificado — é ferramenta de órgão público, não
produto de consumo.

**Key Characteristics:**
- Sidebar escura fixa como perímetro de navegação, conteúdo claro como mesa de trabalho
- Um único accent institucional (azul) para ações e identidade; cor "solta" (vermelho/âmbar/
  verde/violeta) reservada exclusivamente ao estado dos alertas — nunca decorativa
- Tipografia direta, sem serifa, hierarquia por peso e tamanho, não por cor
- Superfícies quase sempre planas; sombra é exceção, não hábito
- Números de processo e códigos em monoespaçada, para parecerem dados, não prosa

## 2. Colors

Paleta restrita: neutros levemente frios (leve tom azulado, nunca cinza puro) carregam quase toda
a interface; o azul institucional aparece só em ações e estados ativos. Os quatro tons de status
do alerta (pendente/visualizado/ciente/escalado) são a única "paleta cheia" do sistema — servem
como um pequeno sistema de dataviz para o estado do alerta, e por isso têm liberdade cromática que
o resto da UI não tem.

### Primary
- **Azul Institucional** (`oklch(48% 0.14 255)`): ações primárias (botões, links, item de nav
  ativo, foco de campo). Usado com moderação — é o que diz "clique aqui" ou "você está aqui".

### Neutral
- **Tinta** (`oklch(24% 0.015 255)`): texto principal.
- **Tinta Suave** (`oklch(46% 0.018 255)`): texto secundário, metadados (datas, contagens).
- **Tinta Fraca** (`oklch(62% 0.014 255)`): texto terciário, placeholders.
- **Superfície** (`oklch(96% 0.005 255)`): fundo da área de conteúdo.
- **Superfície Cartão** (`oklch(99% 0.003 255)`): fundo de cards, tabelas, campos — nunca branco
  puro.
- **Borda** (`oklch(90% 0.008 255)`): divisores, bordas de card.
- **Borda Forte** (`oklch(82% 0.012 255)`): bordas de input, separadores com mais peso.
- **Sidebar Escura** (`oklch(21% 0.025 258)`): fundo da navegação lateral.
- **Sidebar Elevada** (`oklch(27% 0.032 258)`): item de navegação ativo/hover dentro da sidebar.

### Status dos alertas (paleta cheia, uso exclusivo)
- **Pendente** (`oklch(55% 0.19 25)` sobre `oklch(95% 0.03 25)`): ainda ninguém olhou.
- **Visualizado** (`oklch(58% 0.15 75)` sobre `oklch(95% 0.045 75)`): alguém abriu, ciência não
  confirmada.
- **Ciente** (`oklch(55% 0.13 150)` sobre `oklch(95% 0.035 150)`): resolvido, ciência confirmada.
- **Escalado** (`oklch(48% 0.16 300)` sobre `oklch(94% 0.035 300)`): estourou o prazo interno.

### Named Rules
**The One Accent Rule.** Azul institucional é a única cor "de marca" na interface. Nunca aparece
em mais de um elemento por bloco de conteúdo — é seletivo, não decorativo.

**The Status-Only Color Rule.** Fora dos quatro tons de status de alerta, nenhuma cor "solta"
aparece na interface. Se não é ação primária e não é estado de alerta, é neutro.

## 3. Typography

**Display/Body Font:** Inter (com fallback `-apple-system, Segoe UI, Roboto, sans-serif`)
**Mono Font:** JetBrains Mono (com fallback `SFMono-Regular, Consolas, monospace`), reservada para
números de processo, códigos TPU e outros identificadores.

**Character:** Sans humanista, neutra e altamente legível em tamanhos pequenos — feita para ser
lida rápido em tabela densa, não para impressionar. O contraste de hierarquia vem de peso e
tamanho, nunca de cor.

### Hierarchy
- **Headline** (650, 1.5rem/24px, 1.25): título de página ("Painel de Controle", "Alertas").
- **Title** (600, 1.0625rem/17px, 1.3): título de card/seção, número do processo em destaque.
- **Body** (400, 0.9375rem/15px, 1.55): texto padrão, células de tabela, parágrafos. Máx. ~70ch.
- **Label** (600, 0.75rem/12px, uppercase, +0.04em): rótulos de nav, cabeçalhos de tabela, badges.
- **Mono** (500, 0.875rem/14px, 1.4): número de processo (`NNNNNNN-DD.AAAA.J.TR.OOOO`), código TPU.

### Named Rules
**The Data-Looks-Like-Data Rule.** Qualquer identificador estruturado (número de processo, código
TPU, hash) usa a família mono. Se parece um código, deve parecer um código.

## 4. Elevation

Sistema quase totalmente plano. Cards e tabelas se separam do fundo por uma borda de 1px
(`oklch(90% 0.008 255)`), não por sombra — sombra constante em todo card lembra "template
genérico de SaaS", o oposto do tom institucional que o Argus precisa. A única sombra do sistema é
um halo suave sob elementos temporariamente flutuantes (dropdown, tooltip), como resposta a
interação, nunca como decoração de repouso.

### Shadow Vocabulary
- **Flutuante** (`box-shadow: 0 8px 24px oklch(20% 0.02 258 / 0.14)`): dropdown, menu de contexto,
  tooltip — sempre associado a um elemento que se sobrepõe ao conteúdo, nunca a um card em repouso.

### Named Rules
**The Flat-At-Rest Rule.** Nenhum elemento em repouso (card, tabela, badge, item de sidebar) tem
sombra. Sombra é reservada a elementos que se sobrepõem à camada de conteúdo.

## 5. Components

### Sidebar (navegação)
- **Estrutura:** coluna fixa de 232px, fundo `sidebar-bg`, ocupa a altura inteira da viewport.
- **Item de navegação:** ícone (20px, SVG inline, stroke atual da cor do texto) + rótulo (label,
  `sidebar-text`). Padding 9px 12px, `rounded.sm`, sem borda.
- **Hover:** fundo `sidebar-bg-raised`, texto sobe para `sidebar-text-active`. Transição de
  background apenas (`background-color 0.15s ease-out`), nunca transform.
- **Ativo:** fundo `sidebar-bg-raised` fixo, texto `sidebar-text-active`, ícone também claro. Sem
  barra lateral colorida — o próprio bloco inteiro muda de tom (ver Absolute Bans: sem
  side-stripe).
- **Rodapé da sidebar:** nome do usuário + papel + link "Sair", tipografia `label`, cor
  `sidebar-text`.

### Faixa de atalhos (topo do conteúdo)
- **Estrutura:** linha de "tiles" (não botões cheios): ícone 22px sobre `primary-soft`
  circular/`rounded.md`, rótulo `label` abaixo, centralizado. Fundo do tile é transparente até
  hover (`surface-card` + `border`).
- **Uso:** atalhos para as áreas mais acessadas (Alertas, Processos, Configurações, Rodar sync) —
  reforça no conteúdo o que já existe na sidebar, para acesso de um clique a partir do Painel.

### Buttons
- **Shape:** `rounded.sm` (6px), nunca pill exceto badges.
- **Primary:** fundo `primary`, texto `surface-card`, padding 9px 16px, peso 600. Hover escurece
  para `primary-hover` (`background-color 0.15s ease-out`, sem escala/transform).
- **Secondary:** fundo `surface`, texto `ink`, borda 1px `border-strong`. Hover: borda
  `ink-faint`.
- **Ghost:** sem fundo nem borda, texto `ink-muted`, sublinhado só no hover. Usado para ações
  terciárias ("voltar").

### Badges (status do alerta)
- **Shape:** `rounded.full`, padding 3px 10px, `label` (uppercase, 600, tracking +0.04em).
- **Cor:** par bg/texto do status correspondente (ver Colors). Nunca preenchimento sólido — sempre
  fundo suave + texto saturado, para não competir com o azul institucional.

### Cards / Painéis
- **Corner Style:** `rounded.md` (10px).
- **Background:** `surface-card`.
- **Shadow Strategy:** nenhuma — ver Elevation. Separação só por `border` 1px.
- **Internal Padding:** `spacing.lg` (24px), título em `title` já dentro do padding.
- **Regra:** cards não aninham cards. Se o conteúdo pede um cartão dentro de outro, o filho vira
  uma lista/tabela sem moldura própria.

### Inputs / Fields
- **Style:** fundo `surface-card`, borda 1px `border-strong`, `rounded.sm`, padding 8px 12px.
- **Focus:** borda muda para `primary`, halo suave `0 0 0 3px oklch(48% 0.14 255 / 0.18)`. Sem
  glow colorido além disso.

### Tabelas
- **Cabeçalho:** `label` sobre `ink-muted`, sem fundo, borda inferior 1px `border`.
- **Linha:** borda inferior 1px `border`; hover troca fundo para `surface` (sutil, sem transform).
- **Célula com identificador:** número de processo e código em `mono`.

### Contador de painel (substitui "hero-metric")
- **Estrutura:** número (`title`, cor de status quando aplicável) + rótulo (`body`,
  `ink-muted`) lado a lado numa linha de tabela simples dentro do card — não é um bloco isolado
  com número gigante e gradiente. Várias linhas empilhadas no mesmo card, cada uma clicável para
  filtrar a lista correspondente.

## 6. Do's and Don'ts

### Do:
- **Do** usar azul institucional (`oklch(48% 0.14 255)`) só em ação primária, link e estado ativo
  de navegação — nunca em texto decorativo.
- **Do** manter cards e tabelas planos, separados por borda de 1px, não por sombra.
- **Do** usar os quatro tons de status exclusivamente para o estado do alerta (pendente,
  visualizado, ciente, escalado) — nunca reaproveitar essas cores para outra coisa.
- **Do** usar fonte mono para números de processo e códigos TPU.
- **Do** deixar o que já foi tratado (ciente, resolvido) visualmente mais quieto que o que ainda
  precisa de ação.

### Don't:
- **Don't** usar verde ou o logo do concorrente Aurum/Themis — identidade própria, azul
  institucional.
- **Don't** usar `border-left`/`border-right` colorido como indicador de status em card, linha de
  tabela ou alerta (side-stripe é proibido; usar badge ou fundo tintado).
- **Don't** usar grade de cards idênticos (ícone + título + texto, repetidos) como Painel de
  Controle — cada card do painel tem estrutura própria de contadores clicáveis, não um mosaico
  genérico.
- **Don't** usar hero-metric com gradiente (número grande + rótulo pequeno + acento gradiente) —
  contadores vivem em linhas dentro do card, não em blocos isolados.
- **Don't** usar glassmorphism, blur decorativo ou sombra em elementos de repouso.
- **Don't** animar propriedades de layout (`width`, `height`, `top`, `left`); transições só em
  `background-color`, `border-color`, `color`, `opacity`.
