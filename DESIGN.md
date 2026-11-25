---
version: alpha
name: Ferreira Costa — Painéis de Logística
description: >
  Identidade visual dos painéis operacionais da Logística FC (esteira de painéis).
  Institucional, denso de informação, legível de longe no chão do CD. Sóbrio:
  vermelho FC como único acento, tipografia condensada nos números, zero gradiente
  decorativo, zero emoji supérfluo. Todo painel novo herda estes tokens.
colors:
  # ── Marca ──
  primary: "#CF1030"          # vermelho FC institucional (ÚNICO — aposenta #CC0000)
  primary-hover: "#B00E29"
  primary-alt: "#DA0812"      # legado; só compatibilidade, nunca em painel novo
  ink: "#272525"              # preto-texto FC
  ink-soft: "#636363"
  muted: "#9A9A9A"
  # ── Superfícies ──
  bg: "#F5F5F5"               # fundo da página
  surface: "#FFFFFF"          # cartões e tabelas
  border: "#E4E4E4"
  # ── Farol / status ──
  success: "#62BF1B"          # verde (aposenta #28A745 / #16A34A)
  warning: "#E8A400"          # âmbar
  danger: "#CF1030"           # = primary
  info: "#2563EB"
# Extensão FC (fora do spec base): valores do MODO ESCURO. O fc-base.css aplica
# via prefers-color-scheme + override [data-theme]. Marca/farol mantêm o matiz;
# superfícies e texto invertem; o vermelho-como-texto clareia p/ contraste.
colors-dark:
  red-text: "#FF5C74"         # vermelho quando é TEXTO no escuro (fills seguem #CF1030)
  ink: "#EAEAEA"
  ink-soft: "#B4B4B4"
  muted: "#7E7E7E"
  bg: "#141518"
  surface: "#1E2024"
  border: "#33363C"
  success: "#7BD22E"
  warning: "#F0B429"
  info: "#5B8DEF"
typography:
  display:                    # título de página
    fontFamily: "Barlow Condensed"
    fontSize: 2rem
    fontWeight: 700
    lineHeight: 1.1
  h2:                         # cabeçalho de seção
    fontFamily: "Barlow Condensed"
    fontSize: 1.25rem
    fontWeight: 700
    letterSpacing: 0.02em
    fontFeature: '"tnum" 1'
  kpi-number:                 # número grande do KPI
    fontFamily: "Barlow Condensed"
    fontSize: 2.25rem
    fontWeight: 700
    lineHeight: 1.05
    fontFeature: '"tnum" 1'   # números tabulares — colunas alinham
  label-caps:                 # rótulo de KPI e th de tabela
    fontFamily: "Barlow Condensed"
    fontSize: 0.6875rem       # 11px
    fontWeight: 600
    letterSpacing: 0.06em
  body:                       # corpo, células
    fontFamily: Barlow
    fontSize: 0.875rem        # 14px
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: 4px                     # padrão de cartão/tabela/chip
  lg: 8px                     # containers maiores
  full: 9999px                # pílula (farol, badge)
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "{spacing.lg}"
  kpi:
    backgroundColor: "{colors.surface}"
    typography: "{typography.kpi-number}"
    rounded: "{rounded.sm}"
    padding: "{spacing.lg}"
  table-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label-caps}"
  chip:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs}"
  farol:
    rounded: "{rounded.full}"
    typography: "{typography.label-caps}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    height: 38px
  input:                        # texto/data/número/select/busca
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: 38px
    focus: "borda {colors.primary} + halo {colors.focus}"
  filter-bar:                   # barra de filtros de topo (multiselect + range + chips + visão)
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sm}"
  chart:                        # Chart.js vendorizado, alimentado com estes tokens
    series: "[{colors.danger}, {colors.warning}, {colors.success}, {colors.info}]"
    grid: "{colors.border}"
    axisText: "{colors.ink-soft}"
    goalLine: "{colors.info} tracejado"
---

## Overview

Os painéis da Logística FC são **ferramentas operacionais**, não sites de marketing:
o gestor lê de pé, de longe, com pressa. A estética é **institucional e sóbria** —
vermelho FC (#CF1030) como único acento, tipografia **Barlow Condensed** nos números
e títulos (peso, densidade), **Barlow** no corpo. Sem gradiente decorativo, sem emoji
supérfluo, sem sombra pesada. O dado é o herói; o cromo some.

Referência viva mais fiel hoje: `gestao-soli`. Esqueleto de tokens formalizados: o
`Home Portal Logístico` (escala de spacing/raio/sombra). O `base.css` da esteira é a
origem da paleta.

## Colors

Paleta de **alto contraste + um acento**. Vermelho é só para marca, ação e perigo —
nunca para preencher área grande.

- **primary #CF1030** — vermelho FC. Ação, borda-topo de assinatura, farol de perigo.
  Cravado como único: **#CC0000 e #DA0812 estão aposentados** (viravam 3 vermelhos no ar).
- **ink #272525** — texto principal (não #000, não #1A1A1A).
- **ink-soft #636363 / muted #9A9A9A** — legendas, metadados, th de tabela.
- **bg #F5F5F5 / surface #FFF / border #E4E4E4** — o "papel" e o cartão.
- **Farol: success #62BF1B · warning #E8A400 · danger #CF1030.** Sempre estes três —
  nada de #28A745/#16A34A. O verde FC é limão (#62BF1B), não esmeralda.
- **info #2563EB** — azul só para destaque neutro (link, seleção), com parcimônia.
- **Modo escuro (`colors-dark`):** os mesmos tokens têm valor claro e escuro; o
  `fc-base.css` troca por `prefers-color-scheme` + override `[data-theme]`. Superfícies e
  texto invertem (bg #141518 · surface #1E2024 · ink #EAEAEA); **marca e farol mantêm o
  matiz** (só o vermelho-como-texto clareia p/ `#FF5C74`). Nunca faça painel só-claro:
  use as variáveis `--fc-*`, que já resolvem os dois modos.

## Typography

**Barlow Condensed** (títulos, KPIs, th, chips — sempre `UPPERCASE` nos rótulos) +
**Barlow** (corpo, células). Números em `font-feature-settings: "tnum"` para as colunas
alinharem. **Auto-hospede as fontes** (`@fontsource` ou WOFF2 local) — `fonts.googleapis.com`
não resolve dentro do pod/CSP. Fallback: `system-ui, sans-serif`. Nada de Nunito/Segoe/Inter.

## Layout

Dois shells oficiais — escolha um; não invente um terceiro:

1. **Painel simples (topbar):** header branco `border-top: 5px solid #CF1030`, título à
   esquerda, filtros/timestamp à direita; `main` centralizado até **1200px** (ou fluido
   até 1600px em painel denso de tabela). É o shell mais barato e o mais repetido.
2. **Portal multi-visão (sidebar):** sidebar **branca** 240–272px com `border-right:3px #CF1030`,
   topo sticky branco. Use só quando há navegação entre várias telas. **Uma cor de sidebar**
   (branca) — nada de sidebar escura em uns e clara em outros.

Grid de KPIs no topo (`repeat(auto-fit, minmax(...))`), depois abas ou seções.

## Elevation & Depth

Profundidade mínima e consistente:
- Cartão: `border: 1px solid #E4E4E4` + `box-shadow: 0 1px 3px rgba(39,37,37,.06)`.
- Sticky/dropdown: `box-shadow: 0 4px 16px rgba(39,37,37,.12)`.
Sem sombras coloridas, sem `blur` decorativo. A borda faz o trabalho; a sombra é sutil.

## Shapes

Raio **4px** em tudo (cartão, tabela, input, chip); **8px** só em container grande;
**pílula (9999px)** só em farol/badge. Aposenta os 6px/12px avulsos.

## Components

- **KPI card:** `surface`, `border-top: 4px solid <cor-do-farol>`, rótulo `label-caps`
  cinza, número `kpi-number`. Acento pela borda-topo, nunca pelo fundo.
- **Tabela:** header **branco** com `border-bottom: 2px solid #272525` (NÃO header preto
  sólido); th `label-caps` cinza; linhas `border-bottom: 1px #E4E4E4`, hover #FAFAFA;
  linha em atraso `background: rgba(207,16,48,.05)`. Números alinhados à direita, `tnum`.
- **Chip de filtro:** `primary` preenchido quando ligado, cinza-claro quando desligado.
- **Farol:** pílula ou faixa lateral nas 3 cores. Rótulo curto uppercase.
- **Botão primário:** `primary`, texto branco, hover `primary-hover`, `height 38px`.
- **Inputs:** altura **38px**, `border 1px #E4E4E4`, raio 4px, Barlow; foco = borda
  `primary` + halo `focus`. Rótulo em `label-caps`. Checkbox com `accent-color: primary`.
- **Barra de filtros:** um `card` em linha — multiselect de filiais (gatilho com badge de
  contagem), range de datas, chips de tipo/status, select de visão. É o padrão de topo.
- **Gráfico:** **Chart.js vendorizado local** (ou barras SVG/CSS). Série = `[danger,
  warning, success, info]`; grid `border`; eixo `ink-soft`; linha de meta `info` tracejada.

## Do's and Don'ts

**Do**
- Auto-hospede Barlow/Barlow Condensed; vendorize o Chart.js. Painel roda **offline** do CDN.
- Use os tokens (`--fc-*`), nunca hex solto no componente.
- Números tabulares e alinhados à direita; farol nas 3 cores canônicas.
- `h()` de escape universal (`& < > " '`) em todo `innerHTML` com dado do banco.

**Don't**
- ❌ Carregar fonte ou Chart.js de `fonts.googleapis.com` / `cdnjs` (quebra na rede interna).
- ❌ Usar #CC0000, #DA0812, #28A745 — vermelho é **#CF1030**, verde é **#62BF1B**.
- ❌ Header de tabela preto sólido; sidebar escura; gradiente no header; emoji decorativo.
- ❌ Inventar um 3º shell, um 4º raio, uma 5ª fonte. Escolha entre os oficiais.
- ❌ Duas identidades no mesmo app (ex.: login numa cor, painel noutra).
