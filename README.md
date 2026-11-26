# Levantamento de Ambientes

Ferramenta de campo do **Núcleo BIM · Ferreira Costa** para levantar ambientes pelo celular,
tablet ou computador. Abre no navegador, funciona **sem internet** depois do primeiro acesso
e exporta tudo para Excel.

Responsável: Melqui Domingos, Núcleo BIM.

## O que faz

### Planta de fundo, marcadores e status (v1.3)

- **Planta de fundo:** carregue a planta existente como imagem (JPG ou PNG; para PDF, exporte a página
  como imagem). Calibre a escala tocando nas duas pontas de uma medida conhecida e informando o valor
  real. Ajuste transparência e rotação e, se precisar, mova a imagem. Depois desenhe por cima dela.
- **Marcadores:** **+ Marcador** e um toque na planta criam o ambiente sem medir: a ficha (fotos,
  observações, instalações) já fica disponível. Marque como **Não consta na planta** quando for um
  ambiente novo. Mais tarde, o marcador vira ambiente medido (**Desenhar** ou **Retângulo**) mantendo a ficha.
- **Status:** cada ambiente ou marcador pode estar **A levantar**, **Conferido**, **Divergente**,
  **Novo (não consta)** ou **Demolido**. A cor aparece na planta, na lista, na ficha e na planilha,
  com o resumo de quantos há em cada um.

### Planta baixa (v1.2)

**Ambientes.** Cada ambiente é um polígono de paredes internas. Os cantos recebem letras (A, B, C…)
e as paredes são chamadas pelos cantos (parede A–B).

- **Retângulo:** informe comprimento (A–B) e largura (B–C).
- **Forma livre (paredes fora do esquadro):** toque em **Desenhar parede a parede**, depois no canto A
  e em cada canto seguinte. A medida e o ângulo vêm do toque; ajuste os valores exatos nos campos.
  O desenho usa esquadro: se a parede nova estiver até 30° do esquadro com a anterior, ela fica a 90°;
  o canto também se alinha com os cantos já marcados (inclusive o A), para a última parede fechar reta.
  O ângulo é o **interno**, entre a parede anterior e a nova (90 = esquadro, 270 = canto de um "L").
  Pode marcar os cantos em qualquer sentido. A última parede fecha sozinha; se ela foi medida,
  informe em **Medidas** e a ferramenta avisa se o desenho não fecha.

**Montagem da planta (ímã).** Cada ambiente tem posição própria. Desenhe os ambientes e encoste
um no outro: toque num ambiente e arraste. Perto de outro ambiente ele gira e encosta parede com
parede, deixando entre elas a espessura de parede definida em **Dados** (padrão 0,15 m); também
encosta numa segunda parede (para entrar num canto) ou alinha as quinas. Soltar por cima de outro
ambiente não é aceito: ele volta para onde estava.

**Portas.** Toque numa parede: aparece o comprimento daquele trecho (editável) e as opções **Porta**,
**Janela**, **Ponto** e **Objeto**, inseridos no lugar tocado. Se na parede encosta outro ambiente, a
porta passa a ligar os dois e fura as duas paredes automaticamente. Na porta sem ninguém do outro
lado há o botão **Novo ambiente do outro lado**, que cria o vizinho já encostado.

**Mudar medidas.** Em **Medidas**, escolha qual canto fica parado (ou deixe no automático, que usa o
primeiro canto que não cause sobreposição). Portas, pontos e objetos ficam no mesmo lugar da planta.
Uma medida que deixaria o ambiente por cima de outro não é salva.

**Portas e janelas:** giro, giro duplo, correr, correr duplo e vão livre, com lado de abertura e
dobradiça (ou sentido de correr); janela baixa e janela alta, com largura, altura e peitoril.

**Cotas editáveis:** porta, janela, ponto ou objeto selecionado mostra as cotas até os cantos (ou até
as paredes mais próximas, no caso de objetos). Editar a cota move o elemento.

**Objetos (biblioteca básica):** mesa, mesa de reunião, cadeira, armário, estante, arquivo, sofá,
bancada, bancada com pia, lavatório, vaso sanitário, mictório, box, geladeira, bebedouro, pilar,
escada e patamar/desnível. Giram em qualquer ângulo.

**Níveis:** nível do piso por ambiente e patamar/desnível com nível próprio, mostrados na planta.

**Vista 3D:** botão **3D** na planta. Arraste para girar, dois dedos para aproximar, **Corte** baixa
as paredes para 1,20 m e mostra o interior. Usa pé-direito, níveis, alturas de portas, janelas e objetos.

As posições não são guardadas: são recalculadas a cada desenho. Por isso, corrigir uma medida, um
ângulo ou uma boneca reposiciona tudo o que depende dela. A ferramenta avisa quando dois ambientes se
sobrepõem, quando uma porta não cabe na parede ou um objeto passa da parede.

Arraste para mover a planta; use dois dedos (ou a roda do mouse) para aproximar.
Levantamentos feitos nas versões anteriores são convertidos automaticamente ao abrir.

### Informações de cada ambiente

- **Levantamento:** filial ou obra, endereço, responsável, data e pavimentos (cada pavimento tem uma sigla, ex.: T, M, 1).
- **Ambientes:** código automático (`T-01`, `M-03`…), nome e uso (lista padrão ou "Outro").
- **Medidas em metros:** as mesmas da planta, mais o pé-direito. **Área, perímetro e volume são calculados na hora.**
- **Acabamentos:** piso, parede e forro/teto (lista padrão ou texto livre), mais estado de conservação.
- **Fotos:** pela câmera ou pela galeria. A foto é reduzida para 1600 px antes de ser guardada, para não estourar a memória do aparelho.
- **Instalações e encaminhamentos:** pontos (tomada, quadro, ar-condicionado, ralo…) com quantidade e altura; calhas, eletrodutos, tubulações e dutos com comprimento aproximado e descrição do trajeto. Cada item pode ter fotos.
- **Conferência:** percentual de preenchimento por ambiente e alertas (medida que parece estar em centímetros, pé-direito fora do usual, perímetro incompatível com a área, código repetido).
- **Exportação:**
  - Planta baixa (`.dxf`, metros) com as camadas PAREDES, ESQUADRIAS, ACIMA_DO_CORTE, MOBILIARIO, DESNIVEIS, INSTALACOES e TEXTOS, para o AutoCAD ou para importar no Revit. Pavimentos lado a lado.
  - Planilha Excel (`.xlsx`) com as abas *Ambientes* (com paredes, posição na planta e nível), *Portas e janelas*, *Instalações* (com parede e posição), *Objetos* e *Resumo* (área por pavimento).
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
| `planta.js` | Polígonos dos ambientes, posição pelas portas, desenho da planta (SVG), cotas, conferência e DXF |
| `vista3d.js` | Maquete 3D simples (SVG) a partir da planta |
| `xlsx.js` | Gera `.xlsx` e `.zip` sem biblioteca externa |
| `app.css` | Ajustes de uso no celular sobre o padrão FC |
| `fc-base.css`, `fonts/`, `DESIGN.md` | Design system dos painéis FC (Barlow local) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Funcionamento offline e instalação como app |

## Próximas versões (sugestão)

- **Planta:** ligar uma porta a um ambiente já desenhado (fecha o circuito e confere as medidas), parede curva, pontos no teto e no piso (luminárias, ralos), encaixar o canto desenhado em cantos existentes.
- **Depois:** exportar o 3D (IFC ou OBJ), relatório para impressão/PDF, juntar levantamentos de várias pessoas num só, nomes de colunas iguais aos parâmetros do Revit para criar os Rooms automaticamente, envio direto para o SharePoint, trena laser Bluetooth (Chrome no Android).
