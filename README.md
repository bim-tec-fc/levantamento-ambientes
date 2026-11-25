# Levantamento de Ambientes

Ferramenta de campo do **Núcleo BIM · Ferreira Costa** para levantar ambientes pelo celular,
tablet ou computador. Abre no navegador, funciona **sem internet** depois do primeiro acesso
e exporta tudo para Excel.

Responsável: Melqui Domingos, Núcleo BIM.

## O que faz

### Planta baixa (v1.1)

A planta é montada ambiente por ambiente, a partir das portas:

1. Desenhe o primeiro ambiente com as medidas internas (comprimento ↔ e largura ↕).
2. Toque nele e em **+ Porta**: escolha a parede (de cima, de baixo, da esquerda, da direita), a largura do vão, a espessura da parede (medida no batente) e a **boneca**, que é a distância do canto até o batente, medida por dentro do ambiente e a partir do canto indicado.
3. Toque no **+** que aparece do lado de fora da porta e informe o ambiente do outro lado: a parede onde está a porta, a profundidade e a boneca da mesma porta medida por dentro dele.
4. O ambiente novo é posicionado e alinhado sozinho. Repita a partir de qualquer porta.

Cada formulário mostra uma pré-visualização com as cotas que estão sendo digitadas.
As posições não são guardadas: são recalculadas a cada desenho. Por isso, corrigir uma medida
ou uma boneca reposiciona tudo o que depende dela. A ferramenta avisa quando dois ambientes se
sobrepõem ou quando uma porta não cabe na parede, o que costuma indicar medida errada.

Arraste para mover a planta; use dois dedos (ou a roda do mouse) para aproximar.

### Informações de cada ambiente

- **Levantamento:** filial ou obra, endereço, responsável, data e pavimentos (cada pavimento tem uma sigla, ex.: T, M, 1).
- **Ambientes:** código automático (`T-01`, `M-03`…), nome e uso (lista padrão ou "Outro").
- **Medidas em metros:** as mesmas da planta, mais o pé-direito. **Área, perímetro e volume são calculados na hora.**
- **Acabamentos:** piso, parede e forro/teto (lista padrão ou texto livre), mais estado de conservação.
- **Fotos:** pela câmera ou pela galeria. A foto é reduzida para 1600 px antes de ser guardada, para não estourar a memória do aparelho.
- **Instalações e encaminhamentos:** pontos (tomada, quadro, ar-condicionado, ralo…) com quantidade e altura; calhas, eletrodutos, tubulações e dutos com comprimento aproximado e descrição do trajeto. Cada item pode ter fotos.
- **Conferência:** percentual de preenchimento por ambiente e alertas (medida que parece estar em centímetros, pé-direito fora do usual, perímetro incompatível com a área, código repetido).
- **Exportação:**
  - Planta baixa (`.dxf`, metros) com as camadas PAREDES, PORTAS e TEXTOS, para o AutoCAD ou para importar no Revit. Pavimentos lado a lado.
  - Planilha Excel (`.xlsx`) com as abas *Ambientes* (com a posição X/Y de cada um na planta), *Portas*, *Instalações* e *Resumo* (área por pavimento).
  - Planilha + planta + fotos (`.zip`), com as fotos nomeadas pelo código do ambiente (`T-01_01.jpg`, `T-01_I02_01.jpg`).
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

Use um servidor local:

```
python -m http.server 8765
```

e abra `http://localhost:8765`. Em `localhost` o modo offline fica desligado, para o navegador
sempre carregar o código novo. Para testar o modo offline localmente, abra `http://localhost:8765/?sw=1`.

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Página |
| `app.js` | Telas, formulários, cálculos, fotos, exportação e importação |
| `planta.js` | Posição dos ambientes pelas portas, desenho da planta (SVG), conferência e DXF |
| `xlsx.js` | Gera `.xlsx` e `.zip` sem biblioteca externa |
| `app.css` | Ajustes de uso no celular sobre o padrão FC |
| `fc-base.css`, `fonts/`, `DESIGN.md` | Design system dos painéis FC (Barlow local) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Funcionamento offline e instalação como app |

## Próximas versões (sugestão)

- **Planta:** ligar uma porta a um ambiente já desenhado (fecha o circuito e confere as medidas), janelas, ambiente em L, lado de abertura da porta, marcar as instalações na planta.
- **Depois:** relatório para impressão/PDF, juntar levantamentos de várias pessoas num só, nomes de colunas iguais aos parâmetros do Revit para criar os Rooms automaticamente, envio direto para o SharePoint, trena laser Bluetooth (Chrome no Android).
