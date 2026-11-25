# Levantamento de Ambientes

Ferramenta de campo do **Núcleo BIM · Ferreira Costa** para levantar ambientes pelo celular,
tablet ou computador. Abre no navegador, funciona **sem internet** depois do primeiro acesso
e exporta tudo para Excel.

Responsável: Melqui Domingos, Núcleo BIM.

## O que faz (v1)

- **Levantamento:** filial ou obra, endereço, responsável, data e pavimentos (cada pavimento tem uma sigla, ex.: T, M, 1).
- **Ambientes:** código automático (`T-01`, `M-03`…), nome e uso (lista padrão ou "Outro").
- **Medidas em metros:** retangular (comprimento × largura) ou outra forma (soma de retângulos com recortes descontados, mais a lista de lados para o perímetro). Pé-direito. **Área, perímetro e volume são calculados na hora.**
- **Acabamentos:** piso, parede e forro/teto (lista padrão ou texto livre), mais estado de conservação.
- **Fotos:** pela câmera ou pela galeria. A foto é reduzida para 1600 px antes de ser guardada, para não estourar a memória do aparelho.
- **Instalações e encaminhamentos:** pontos (tomada, quadro, ar-condicionado, ralo…) com quantidade e altura; calhas, eletrodutos, tubulações e dutos com comprimento aproximado e descrição do trajeto. Cada item pode ter fotos.
- **Conferência:** percentual de preenchimento por ambiente e alertas (medida que parece estar em centímetros, pé-direito fora do usual, perímetro incompatível com a área, código repetido).
- **Exportação:**
  - Planilha Excel (`.xlsx`) com as abas *Ambientes*, *Instalações* e *Resumo* (área por pavimento).
  - Planilha + fotos (`.zip`), com as fotos nomeadas pelo código do ambiente (`T-01_01.jpg`, `T-01_I02_01.jpg`).
  - Backup completo (`.json`) para abrir o levantamento em outro aparelho (botão **Importar backup**).
- Salva sozinho a cada alteração, tem tema claro (bom no sol) e escuro, e segue o padrão visual FC (`DESIGN.md`).

## Onde ficam os dados

No próprio aparelho (IndexedDB do navegador). **Nada é enviado para servidor.**
Até a exportação, o levantamento existe só naquele celular: limpar os dados do navegador apaga tudo.
Por isso a tela inicial e a aba *Exportar* mostram se há alterações ainda não exportadas.

## Publicar no GitHub do setor (GitHub Pages)

1. Suba o conteúdo desta pasta para a raiz de um repositório (ex.: `levantamento-ambientes`).
2. No repositório: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. O endereço fica `https://<organização>.github.io/levantamento-ambientes/`. Mande esse link para a equipe.

GitHub Pages serve por HTTPS, que é o que o navegador exige para o modo offline funcionar.

> Repositório privado só publica Pages em plano pago do GitHub (Team/Enterprise).
> Se o repositório do setor for privado num plano gratuito, use um repositório público só para a
> ferramenta. O código não contém dados de levantamento.

## Instalar no celular

Abra o link uma vez com internet e depois:

- **Android (Chrome):** menu ⋮ → *Adicionar à tela inicial* / *Instalar app*.
- **iPhone (Safari):** botão compartilhar → *Adicionar à Tela de Início*.

A partir daí abre pelo ícone e funciona sem internet.

> No iPhone, o que for preenchido no Safari e o que for preenchido no ícone da tela de início ficam
> em espaços separados. Oriente a equipe a usar sempre o ícone.

## Publicar uma versão nova

O celular guarda a ferramenta para usar offline. Para ele baixar a versão nova:

1. Altere `VERSAO` em `sw.js` (ex.: `levamb-1.0.1`) e `VERSAO` em `app.js` (ex.: `1.0.1`).
2. Suba para o GitHub.

Na próxima vez que a pessoa abrir com internet aparece **"Nova versão disponível · Atualizar"**.
Os levantamentos salvos não são afetados.

## Testar no computador

Use um servidor local (abrir o `index.html` direto do disco não ativa o modo offline):

```
python -m http.server 8765
```

e abra `http://localhost:8765`.

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Página |
| `app.js` | Telas, cálculos, fotos, exportação e importação |
| `xlsx.js` | Gera `.xlsx` e `.zip` sem biblioteca externa |
| `app.css` | Ajustes de uso no celular sobre o padrão FC |
| `fc-base.css`, `fonts/`, `DESIGN.md` | Design system dos painéis FC (Barlow local) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Funcionamento offline e instalação como app |

## Próximas versões (sugestão)

- **v2:** croqui à mão livre (sobre grade ou sobre a foto), esquadrias (portas e janelas), modelos prontos de ambiente, relatório para impressão/PDF, juntar levantamentos de várias pessoas num só.
- **v3:** marcação de instalações no croqui, nomes de colunas iguais aos parâmetros do Revit para criar os Rooms automaticamente, envio direto para o SharePoint, trena laser Bluetooth (Chrome no Android).
