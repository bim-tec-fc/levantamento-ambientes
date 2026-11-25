/* ═══════════════════════════════════════════════════════════════════════════
   planta.js: geometria, desenho (SVG) e exportação DXF da planta baixa.
   Núcleo BIM · Ferreira Costa · Melqui Domingos

   Como a planta se monta
   ─────────────────────
   Cada ambiente é um retângulo com medidas internas: comp (↔, eixo X) e
   larg (↕, eixo Y). O primeiro ambiente do pavimento fica na origem.
   Os outros são posicionados pela PORTA que os liga a um ambiente já desenhado:

     abertura = { ambA, parede, modelo, largura, altura, peitoril, boneca, canto,
                  espessura, abre, lado, ambB, bonecaB, cantoB }

   - parede: em qual parede do ambiente A está a abertura (cima, baixo, esq, dir),
     do jeito que aparece na tela.
   - modelo: giro, giro2, correr, correr2, vao (portas) ou janela, janela_alta.
     Só porta liga ambientes; janela fica na parede, sem o "+" do vizinho.
   - boneca: distância do canto até o batente, medida dentro de A.
     canto 'ini' = canto esquerdo (paredes de cima/baixo) ou de baixo
     (paredes da esquerda/direita); 'fim' = o canto oposto.
   - abre: 'dentro' (folha gira ou corre dentro de A) ou 'fora'.
   - lado: dobradiça (giro) ou sentido em que a folha corre (correr): 'ini' ou 'fim'.
   - espessura: espessura da parede, medida no vão.
   - bonecaB / cantoB: a mesma porta, medida dentro do ambiente B.

   Dentro de cada ambiente também ficam os pontos de instalação na parede
   (a.inst com parede e pos) e os objetos (a.objetos: mobiliário, louças,
   pilar, escada, patamar/desnível), com posição a partir do canto de baixo à
   esquerda do ambiente.

   As posições não são guardadas: são recalculadas a cada desenho. Corrigir
   uma medida reposiciona tudo o que depende dela.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (raiz) {
  'use strict';

  const num = v => {
    if (v == null) return null;
    const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const fmt = (n, d = 2) => n == null ? '–' : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNivel = n => (n > 0.0005 ? '+' : n < -0.0005 ? '' : '±') + fmt(n || 0);

  const OPOSTA = { cima: 'baixo', baixo: 'cima', esq: 'dir', dir: 'esq' };
  const HORIZ = p => p === 'cima' || p === 'baixo';
  const ESPESSURA_PADRAO = 0.15;
  const PD_PADRAO = 2.8;

  // ───────────────────────── Catálogos ─────────────────────────
  const MODELOS = [
    ['giro', 'Giro'], ['giro2', 'Giro duplo'], ['correr', 'Correr'], ['correr2', 'Correr duplo'],
    ['vao', 'Vão livre'], ['janela', 'Janela baixa'], ['janela_alta', 'Janela alta'],
  ];
  const ehJanela = m => m === 'janela' || m === 'janela_alta';
  /** Medidas padrão de cada modelo: [largura, altura, peitoril]. */
  const PADRAO_ABERTURA = {
    giro: ['0,80', '2,10', ''], giro2: ['1,40', '2,10', ''], correr: ['0,80', '2,10', ''], correr2: ['1,60', '2,10', ''],
    vao: ['0,90', '2,10', ''], janela: ['1,20', '1,20', '1,00'], janela_alta: ['1,00', '0,60', '1,60'],
  };

  /** Pontos de instalação na parede: sigla e altura padrão do piso (m). */
  const PONTOS = {
    'Tomada': ['T', '0,30'], 'Interruptor': ['I', '1,10'], 'Quadro elétrico': ['QE', '1,50'],
    'Ponto de rede / dados': ['R', '0,30'], 'Ponto de luz / luminária': ['L', '2,20'],
    'Luminária de emergência': ['LE', '2,20'], 'Ar-condicionado: evaporadora': ['AC', '2,20'],
    'Exaustor / ventilação': ['EV', '2,20'], 'Câmera CFTV': ['CF', '2,50'], 'Ponto de água': ['AG', '0,60'],
    'Ponto de esgoto / ralo': ['ES', '0,50'], 'Extintor': ['EX', '1,60'], 'Hidrante': ['HI', '1,30'],
  };

  /**
   * Biblioteca de objetos. Medidas em metros (largura w, profundidade d, altura h).
   * O desenho é feito no sistema do objeto: u ao longo da largura, v da parte de trás (v = 0,
   * o lado encostado na parede) para a frente. Primitivas:
   *   ['r', u0, v0, u1, v1] retângulo · ['f', ...] retângulo cheio · ['rd', ...] retângulo tracejado
   *   ['l', u0, v0, u1, v1] linha · ['c', u, v, raio] círculo · ['e', u, v, ru, rv] elipse · ['t', u, v, texto]
   */
  const BIBLIOTECA = {
    mesa: { nome: 'Mesa', w: 1.2, d: 0.6, h: 0.75, s: (w, d) => [['r', 0, 0, w, d]] },
    mesa_reuniao: { nome: 'Mesa de reunião', w: 2.0, d: 1.0, h: 0.75, s: (w, d) => [['e', w / 2, d / 2, w / 2, d / 2]] },
    cadeira: { nome: 'Cadeira', w: 0.5, d: 0.5, h: 0.9, s: (w, d) => [['r', 0.05 * w, 0.22 * d, 0.95 * w, d], ['r', 0.05 * w, 0, 0.95 * w, 0.18 * d]] },
    armario: { nome: 'Armário', w: 0.9, d: 0.5, h: 2.0, s: (w, d) => [['r', 0, 0, w, d], ['l', 0, d, w, 0]] },
    estante: { nome: 'Estante', w: 0.9, d: 0.35, h: 2.0, s: (w, d) => [['r', 0, 0, w, d], ['l', 0, d / 2, w, d / 2]] },
    arquivo: { nome: 'Arquivo', w: 0.5, d: 0.65, h: 1.35, s: (w, d) => [['r', 0, 0, w, d], ['l', 0.2 * w, 0.9 * d, 0.8 * w, 0.9 * d]] },
    sofa: { nome: 'Sofá', w: 1.8, d: 0.85, h: 0.85, s: (w, d) => [['r', 0, 0, w, d], ['r', 0, 0, w, 0.25 * d], ['r', 0, 0.25 * d, 0.12 * w, d], ['r', 0.88 * w, 0.25 * d, w, d]] },
    bancada: { nome: 'Bancada', w: 1.5, d: 0.6, h: 0.9, s: (w, d) => [['r', 0, 0, w, d], ['l', 0, 0.9 * d, w, 0.9 * d]] },
    pia: { nome: 'Bancada com pia', w: 1.2, d: 0.6, h: 0.9, s: (w, d) => [['r', 0, 0, w, d], ['r', 0.3 * w, 0.18 * d, 0.7 * w, 0.85 * d], ['c', w / 2, 0.1 * d, 0.03]] },
    lavatorio: { nome: 'Lavatório', w: 0.5, d: 0.42, h: 0.85, s: (w, d) => [['r', 0, 0, w, 0.18 * d], ['e', w / 2, 0.56 * d, 0.44 * w, 0.42 * d], ['c', w / 2, 0.09 * d, 0.025]] },
    vaso: { nome: 'Vaso sanitário', w: 0.38, d: 0.65, h: 0.4, s: (w, d) => [['r', 0.04 * w, 0, 0.96 * w, 0.26 * d], ['e', w / 2, 0.62 * d, 0.46 * w, 0.37 * d]] },
    mictorio: { nome: 'Mictório', w: 0.4, d: 0.35, h: 0.6, s: (w, d) => [['r', 0, 0, w, 0.2 * d], ['e', w / 2, 0.52 * d, 0.45 * w, 0.46 * d]] },
    chuveiro: { nome: 'Box / chuveiro', w: 0.9, d: 0.9, h: 2.0, s: (w, d) => [['r', 0, 0, w, d], ['l', 0, 0, w, d], ['l', w, 0, 0, d], ['c', w / 2, d / 2, 0.06]] },
    geladeira: { nome: 'Geladeira', w: 0.7, d: 0.7, h: 1.8, s: (w, d) => [['r', 0, 0, w, d], ['t', w / 2, d / 2, 'GEL']] },
    bebedouro: { nome: 'Bebedouro', w: 0.35, d: 0.35, h: 1.0, s: (w, d) => [['r', 0, 0, w, d], ['c', w / 2, d / 2, 0.11]] },
    pilar: { nome: 'Pilar', w: 0.3, d: 0.3, h: 0, s: (w, d) => [['f', 0, 0, w, d]] },
    escada: {
      nome: 'Escada', w: 1.2, d: 3.0, h: 0, s: (w, d) => {
        const p = [['r', 0, 0, w, d]];
        for (let v = 0.28; v < d - 0.05; v += 0.28) p.push(['l', 0, v, w, v]);
        p.push(['l', w / 2, 0.15, w / 2, d - 0.15], ['l', w / 2, d - 0.15, w / 2 - 0.12, d - 0.4], ['l', w / 2, d - 0.15, w / 2 + 0.12, d - 0.4]);
        return p;
      },
    },
    desnivel: { nome: 'Patamar / desnível', w: 1.5, d: 1.5, h: 0, s: (w, d) => [['rd', 0, 0, w, d]] },
  };

  const nivelDe = a => num(a && a.nivel) || 0;
  const pdDe = a => num(a && a.peDireito) || PD_PADRAO;
  const dims = a => ({ dx: num(a.comp) || 0, dy: num(a.larg) || 0 });
  /** Distância do início da parede (esquerda ou baixo) até o batente. */
  const canon = (len, b, w, canto) => canto === 'fim' ? len - b - w : b;

  /** Face interna de um ambiente: eixo, início e fim ao longo dele, coordenada fixa e normal para dentro. */
  function face(r, f) {
    const h = HORIZ(f);
    return {
      h, u0: h ? r.x : r.y, u1: h ? r.x + r.dx : r.y + r.dy,
      fixo: f === 'baixo' ? r.y : f === 'cima' ? r.y + r.dy : f === 'esq' ? r.x : r.x + r.dx,
      ix: f === 'esq' ? 1 : f === 'dir' ? -1 : 0, iy: f === 'baixo' ? 1 : f === 'cima' ? -1 : 0,
      pt(u, off = 0) { return h ? [u, this.fixo + this.iy * off] : [this.fixo + this.ix * off, u]; },
    };
  }

  // ───────────────────────── Posições ─────────────────────────
  function layout(L, pavId) {
    const ambs = L.ambientes.filter(a => a.pavimentoId === pavId).sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
    const porId = new Map(ambs.map(a => [a.id, a]));
    const portas = (L.portas || []).filter(p => porId.has(p.ambA));
    const pos = new Map();
    const ligadaPor = new Map();
    const posiciona = p => !ehJanela(p.modelo);
    const raizes = ambs.filter(a => !portas.some(p => p.id === a.ancora && p.ambB === a.id && posiciona(p)));
    const info = a => ({ ...dims(a), nivel: nivelDe(a), pd: pdDe(a) });
    let cursor = 0;

    for (const r of raizes) {
      if (pos.has(r.id)) continue;
      pos.set(r.id, { x: cursor, y: 0, ...info(r) });
      const fila = [r.id];
      while (fila.length) {
        const id = fila.shift();
        const A = pos.get(id);
        for (const p of portas) {
          if (p.ambA !== id || !p.ambB || pos.has(p.ambB) || !posiciona(p)) continue;
          const B = porId.get(p.ambB);
          if (!B || B.ancora !== p.id) continue;
          const bd = info(B);
          const w = num(p.largura) || 0;
          const t = num(p.espessura) ?? ESPESSURA_PADRAO;
          const h = HORIZ(p.parede);
          const cA = canon(h ? A.dx : A.dy, num(p.boneca) || 0, w, p.canto);
          const cB = canon(h ? bd.dx : bd.dy, num(p.bonecaB) || 0, w, p.cantoB);
          let x, y;
          if (p.parede === 'cima') { y = A.y + A.dy + t; x = A.x + cA - cB; }
          else if (p.parede === 'baixo') { y = A.y - t - bd.dy; x = A.x + cA - cB; }
          else if (p.parede === 'dir') { x = A.x + A.dx + t; y = A.y + cA - cB; }
          else { x = A.x - t - bd.dx; y = A.y + cA - cB; }
          pos.set(B.id, { x, y, ...bd });
          ligadaPor.set(B.id, p.id);
          fila.push(B.id);
        }
      }
      cursor = caixa([...pos.values()]).x1 + 2;
    }

    const geo = portas.filter(p => pos.has(p.ambA)).map(p => {
      const A = pos.get(p.ambA);
      const w = num(p.largura) || 0;
      const t = num(p.espessura) ?? ESPESSURA_PADRAO;
      const h = HORIZ(p.parede);
      const len = h ? A.dx : A.dy;
      const c = canon(len, num(p.boneca) || 0, w, p.canto);
      let x1, y1, x2, y2, nx, ny;
      if (p.parede === 'cima') { x1 = A.x + c; x2 = x1 + w; y1 = y2 = A.y + A.dy; nx = 0; ny = 1; }
      else if (p.parede === 'baixo') { x1 = A.x + c; x2 = x1 + w; y1 = y2 = A.y; nx = 0; ny = -1; }
      else if (p.parede === 'dir') { y1 = A.y + c; y2 = y1 + w; x1 = x2 = A.x + A.dx; nx = 1; ny = 0; }
      else { y1 = A.y + c; y2 = y1 + w; x1 = x2 = A.x; nx = -1; ny = 0; }
      const ligada = !!(p.ambB && ligadaPor.get(p.ambB) === p.id);
      let foraB = false;
      if (ligada) {
        const B = pos.get(p.ambB);
        const lenB = h ? B.dx : B.dy;
        const cB = (h ? x1 - B.x : y1 - B.y);
        foraB = cB < -0.005 || cB + w > lenB + 0.005;
      }
      const g = {
        p, x1, y1, x2, y2, nx, ny, t, w, c, len, ligada, janela: ehJanela(p.modelo),
        corta: p.modelo !== 'janela_alta', fora: c < -0.005 || c + w > len + 0.005, foraB,
        ua: h ? x1 : y1, ub: h ? x2 : y2,
      };
      g.prims = primitivasAbertura(g);
      return g;
    });

    // pontos de instalação na parede
    const pontos = [];
    const objetos = [];
    for (const a of ambs) {
      const r = pos.get(a.id);
      if (!r) continue;
      for (const i of a.inst || []) {
        if (!i.parede || num(i.pos) == null) continue;
        const F = face(r, i.parede);
        const u = F.u0 + num(i.pos);
        const [px, py] = F.pt(u);
        const [cx, cy] = F.pt(u, 0.17);
        pontos.push({ i, amb: a.id, face: i.parede, u, px, py, cx, cy, F, len: F.u1 - F.u0, cod: (PONTOS[i.tipo] || ['?'])[0] });
      }
      for (const o of a.objetos || []) {
        const b = BIBLIOTECA[o.tipo];
        if (!b) continue;
        const w = num(o.w) || b.w, d = num(o.d) || b.d, rot = ((+o.rot || 0) % 360 + 360) % 360;
        const bw = rot % 180 ? d : w, bh = rot % 180 ? w : d;
        const x0 = r.x + (num(o.x) || 0), y0 = r.y + (num(o.y) || 0);
        const tr = (u, v) => {
          const [X, Y] = rot === 90 ? [d - v, u] : rot === 180 ? [w - u, d - v] : rot === 270 ? [v, w - u] : [u, v];
          return [x0 + X, y0 + Y];
        };
        const prims = [];
        for (const s of b.s(w, d)) {
          if (s[0] === 'r' || s[0] === 'f' || s[0] === 'rd') {
            prims.push({ t: s[0] === 'r' ? 'p' : s[0] === 'f' ? 'pf' : 'pd', pts: [tr(s[1], s[2]), tr(s[3], s[2]), tr(s[3], s[4]), tr(s[1], s[4])] });
          } else if (s[0] === 'l') {
            prims.push({ t: 'l', pts: [tr(s[1], s[2]), tr(s[3], s[4])] });
          } else if (s[0] === 'c') {
            const [cx, cy] = tr(s[1], s[2]);
            prims.push({ t: 'c', cx, cy, r: s[3] });
          } else if (s[0] === 'e') {
            const pts = [];
            for (let k = 0; k < 24; k++) { const an = k / 24 * 2 * Math.PI; pts.push(tr(s[1] + s[3] * Math.cos(an), s[2] + s[4] * Math.sin(an))); }
            prims.push({ t: 'p', pts });
          } else if (s[0] === 't') {
            const [cx, cy] = tr(s[1], s[2]);
            prims.push({ t: 't', cx, cy, txt: s[3] });
          }
        }
        const h = o.tipo === 'pilar' ? r.pd : (num(o.h) ?? b.h);
        objetos.push({ o, amb: a.id, b, x0, y0, bw, bh, w, d, rot, prims, h, nivel: o.tipo === 'desnivel' ? (num(o.nivel) ?? r.nivel) : r.nivel });
      }
    }
    return { pos, portas: geo, pontos, objetos };
  }

  function caixa(rs) {
    if (!rs.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    return {
      x0: Math.min(...rs.map(r => r.x)), y0: Math.min(...rs.map(r => r.y)),
      x1: Math.max(...rs.map(r => r.x + r.dx)), y1: Math.max(...rs.map(r => r.y + r.dy)),
    };
  }

  // ───────────────────────── Símbolos das aberturas ─────────────────────────
  /**
   * Primitivas da porta ou janela, em metros:
   *   {t:'l', pts:[[x,y],[x,y]]} linha · {t:'lf'} folha de correr · {t:'ld'} tracejada
   *   {t:'a', cx, cy, r, de:[x,y], ate:[x,y]} arco de 90° com centro na dobradiça
   */
  function primitivasAbertura(g) {
    const { p, nx, ny, t, w } = g;
    const P1 = [g.x1, g.y1], P2 = [g.x2, g.y2];
    const em = (P, d) => [P[0] + nx * d, P[1] + ny * d];
    const ao = (P, k) => [P[0] + (P2[0] - P1[0]) / (w || 1) * k, P[1] + (P2[1] - P1[1]) / (w || 1) * k];
    const s = p.abre === 'fora' ? 1 : -1;           // lado da folha em relação à normal (para fora de A)
    const f0 = p.abre === 'fora' ? t : 0;           // face onde fica a dobradiça
    const out = [];
    const L = (a, b, tp = 'l') => out.push({ t: tp, pts: [a, b] });
    const A = (c, de, ate, r) => out.push({ t: 'a', cx: c[0], cy: c[1], r, de, ate });
    const m = p.modelo || 'giro';
    if (w <= 0) return out;
    if (m === 'giro') {
      const H = em(p.lado === 'fim' ? P2 : P1, f0), J = em(p.lado === 'fim' ? P1 : P2, f0);
      const E = em(H, s * w);
      L(H, E);
      A(H, E, J, w);
    } else if (m === 'giro2') {
      const H1 = em(P1, f0), H2 = em(P2, f0), M = em(ao(P1, w / 2), f0);
      const E1 = em(H1, s * w / 2), E2 = em(H2, s * w / 2);
      L(H1, E1); A(H1, E1, M, w / 2);
      L(H2, E2); A(H2, E2, M, w / 2);
    } else if (m === 'correr' || m === 'correr2') {
      const seta = (de, ate) => {
        L(de, ate);
        const dx = ate[0] - de[0], dy = ate[1] - de[1], n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n, k = 0.08;
        L(ate, [ate[0] - ux * k + uy * k * 0.6, ate[1] - uy * k - ux * k * 0.6]);
        L(ate, [ate[0] - ux * k - uy * k * 0.6, ate[1] - uy * k + ux * k * 0.6]);
      };
      if (m === 'correr') {
        const o = f0 + s * 0.05;
        L(em(P1, o), em(P2, o), 'lf');
        const ida = p.lado === 'fim' ? 1 : -1, M = ao(P1, w / 2);
        seta(em(ao(M, -ida * w * 0.2), o + s * 0.12), em(ao(M, ida * w * 0.2), o + s * 0.12));
      } else {
        const o1 = f0 + s * 0.04, o2 = f0 + s * 0.1;
        L(em(P1, o1), em(ao(P1, w / 2 + 0.05), o1), 'lf');
        L(em(ao(P1, w / 2 - 0.05), o2), em(P2, o2), 'lf');
        seta(em(ao(P1, w * 0.35), o2 + s * 0.12), em(ao(P1, w * 0.12), o2 + s * 0.12));
        seta(em(ao(P1, w * 0.65), o2 + s * 0.12), em(ao(P1, w * 0.88), o2 + s * 0.12));
      }
    } else if (m === 'janela') {
      L(em(P1, t * 0.35), em(P2, t * 0.35));
      L(em(P1, t * 0.65), em(P2, t * 0.65));
    } else if (m === 'janela_alta') {
      L(em(P1, t * 0.5), em(P2, t * 0.5), 'ld');
      L(em(P1, -0.05), em(P1, t + 0.05), 'ld');
      L(em(P2, -0.05), em(P2, t + 0.05), 'ld');
    }
    return out;
  }

  // ───────────────────────── Linhas do desenho ─────────────────────────
  /** Aberturas que cortam a parede de um ambiente numa face, em coordenadas do eixo. */
  function vaosDaFace(lay, amb, f) {
    return lay.portas.filter(g => g.corta && ((g.p.ambA === amb && g.p.parede === f) || (g.ligada && g.p.ambB === amb && OPOSTA[g.p.parede] === f)))
      .map(g => ({ g, ua: Math.min(g.ua, g.ub), ub: Math.max(g.ua, g.ub), lado: g.p.ambA === amb ? 'A' : 'B' }))
      .sort((a, b) => a.ua - b.ua);
  }

  /** Paredes com os vãos recortados ([x1,y1,x2,y2,amb,face,u0,u1]), batentes e símbolos. Tudo em metros. */
  function linhas(lay) {
    const paredes = [];
    for (const [id, r] of lay.pos) {
      for (const f of ['baixo', 'cima', 'esq', 'dir']) {
        const F = face(r, f);
        let u = F.u0;
        const seg = (a, b) => { if (b - a > 0.0005) paredes.push([...F.pt(a), ...F.pt(b), id, f, a, b]); };
        for (const v of vaosDaFace(lay, id, f)) {
          seg(u, Math.min(v.ua, F.u1));
          u = Math.max(u, v.ub);
        }
        seg(u, F.u1);
      }
    }
    const batentes = [], simbolos = [];
    for (const g of lay.portas) {
      if (g.corta) {
        batentes.push([g.x1, g.y1, g.x1 + g.nx * g.t, g.y1 + g.ny * g.t]);
        batentes.push([g.x2, g.y2, g.x2 + g.nx * g.t, g.y2 + g.ny * g.t]);
      }
      for (const pr of g.prims) simbolos.push({ ...pr, porta: g.p.id });
    }
    return { paredes, batentes, simbolos };
  }

  // ───────────────────────── Conferência ─────────────────────────
  function conferir(L, pavId, lay) {
    const av = [];
    const cod = id => { const a = L.ambientes.find(x => x.id === id); return a ? (a.codigo || a.nome || '?') : '?'; };
    const ids = [...lay.pos.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = lay.pos.get(ids[i]), b = lay.pos.get(ids[j]);
        const ix = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y);
        if (ix > 0.02 && iy > 0.02) av.push(`${cod(ids[i])} e ${cod(ids[j])} se sobrepõem (${fmt(ix)} × ${fmt(iy)} m). Confira as medidas e as bonecas das portas.`);
      }
    }
    for (const g of lay.portas) {
      const oq = g.janela ? 'A janela' : 'A porta';
      if (g.fora) av.push(`${oq} de ${cod(g.p.ambA)} não cabe na parede (${fmt(g.len)} m). Confira a boneca e a largura.`);
      if (g.foraB) av.push(`A porta entre ${cod(g.p.ambA)} e ${cod(g.p.ambB)} não cabe na parede de ${cod(g.p.ambB)}. Confira a boneca medida lá.`);
    }
    for (const pt of lay.pontos) {
      const pos = pt.u - pt.F.u0;
      if (pos < -0.005 || pos > pt.len + 0.005) av.push(`Um ponto (${pt.cod}) de ${cod(pt.amb)} está fora da parede.`);
    }
    for (const o of lay.objetos) {
      const r = lay.pos.get(o.amb);
      if (o.x0 < r.x - 0.005 || o.y0 < r.y - 0.005 || o.x0 + o.bw > r.x + r.dx + 0.005 || o.y0 + o.bh > r.y + r.dy + 0.005) {
        av.push(`${o.b.nome} de ${cod(o.amb)} passa da parede. Confira as cotas.`);
      }
    }
    for (const [id, r] of lay.pos) if (!(r.dx > 0 && r.dy > 0)) av.push(`${cod(id)} está sem medidas.`);
    return av;
  }

  // ───────────────────────── Itens selecionáveis e cotas ─────────────────────────
  /**
   * Para o item selecionado devolve as cotas a desenhar e os valores que o painel mostra.
   * item = {tipo:'porta', id} | {tipo:'ponto', amb, id} | {tipo:'obj', amb, id} | {tipo:'seg', amb, face, esq, dir}
   * 'esq'/'dir' do segmento: 'canto' ou o id da abertura que o limita.
   */
  function infoItem(lay, item) {
    if (!item) return null;
    if (item.tipo === 'porta') {
      const g = lay.portas.find(x => x.p.id === item.id);
      if (!g) return null;
      const r = lay.pos.get(g.p.ambA), F = face(r, g.p.parede);
      const off = 0.32;   // por dentro de A
      const ini = g.ua, fim = g.ub;
      return {
        g, F, valores: { esq: ini - F.u0, dir: F.u1 - fim, larg: g.w },
        cotas: [
          { a: F.pt(F.u0, off), b: F.pt(ini, off), campo: 'esq' },
          { a: F.pt(ini, off), b: F.pt(fim, off), campo: 'larg' },
          { a: F.pt(fim, off), b: F.pt(F.u1, off), campo: 'dir' },
        ],
      };
    }
    if (item.tipo === 'ponto') {
      const pt = lay.pontos.find(x => x.i.id === item.id);
      if (!pt) return null;
      const off = 0.45;
      return {
        pt, F: pt.F, valores: { esq: pt.u - pt.F.u0, dir: pt.F.u1 - pt.u },
        cotas: [{ a: pt.F.pt(pt.F.u0, off), b: pt.F.pt(pt.u, off), campo: 'esq' }, { a: pt.F.pt(pt.u, off), b: pt.F.pt(pt.F.u1, off), campo: 'dir' }],
      };
    }
    if (item.tipo === 'obj') {
      const o = lay.objetos.find(x => x.o.id === item.id);
      if (!o) return null;
      const r = lay.pos.get(o.amb), cx = o.x0 + o.bw / 2, cy = o.y0 + o.bh / 2;
      return {
        obj: o, valores: { esq: o.x0 - r.x, dir: r.x + r.dx - o.x0 - o.bw, baixo: o.y0 - r.y, cima: r.y + r.dy - o.y0 - o.bh },
        cotas: [
          { a: [r.x, cy], b: [o.x0, cy], campo: 'esq' }, { a: [o.x0 + o.bw, cy], b: [r.x + r.dx, cy], campo: 'dir' },
          { a: [cx, r.y], b: [cx, o.y0], campo: 'baixo' }, { a: [cx, o.y0 + o.bh], b: [cx, r.y + r.dy], campo: 'cima' },
        ],
      };
    }
    if (item.tipo === 'seg') {
      const r = lay.pos.get(item.amb);
      if (!r) return null;
      const F = face(r, item.face), vs = vaosDaFace(lay, item.amb, item.face);
      const vE = item.esq === 'canto' ? null : vs.find(v => v.g.p.id === item.esq);
      const vD = item.dir === 'canto' ? null : vs.find(v => v.g.p.id === item.dir);
      if ((item.esq !== 'canto' && !vE) || (item.dir !== 'canto' && !vD)) return null;
      const u0 = vE ? vE.ub : F.u0, u1 = vD ? vD.ua : F.u1;
      return { F, vE, vD, u0, u1, valores: { trecho: u1 - u0 }, cotas: [{ a: F.pt(u0, 0.32), b: F.pt(u1, 0.32), campo: 'trecho' }] };
    }
    return null;
  }

  /** Identifica o trecho de parede tocado (entre cantos e aberturas). */
  function segmentoEm(lay, amb, f, u0, u1) {
    const r = lay.pos.get(amb), F = face(r, f), vs = vaosDaFace(lay, amb, f);
    const esq = Math.abs(u0 - F.u0) < 1e-4 ? 'canto' : (vs.find(v => Math.abs(v.ub - u0) < 1e-4) || { g: { p: { id: 'canto' } } }).g.p.id;
    const dir = Math.abs(u1 - F.u1) < 1e-4 ? 'canto' : (vs.find(v => Math.abs(v.ua - u1) < 1e-4) || { g: { p: { id: 'canto' } } }).g.p.id;
    return { tipo: 'seg', amb, face: f, esq, dir };
  }

  // ───────────────────────── SVG ─────────────────────────
  function enquadrar(lay, W, H, ids) {
    const rs = [...lay.pos.entries()].filter(([id]) => !ids || ids.includes(id)).map(e => e[1]).filter(r => r.dx > 0 && r.dy > 0);
    if (!rs.length) return { s: 40, ox: W / 2, oy: H / 2 };
    const b = caixa(rs);
    const m = 0.9;
    const bw = b.x1 - b.x0 + 2 * m, bh = b.y1 - b.y0 + 2 * m;
    const s = Math.max(4, Math.min((W - 24) / bw, (H - 24) / bh, 160));
    return { s, ox: W / 2 - ((b.x0 + b.x1) / 2) * s, oy: H / 2 + ((b.y0 + b.y1) / 2) * s };
  }

  /**
   * Desenha o pavimento. view = { s (px por metro), ox, oy }.
   * o = { sel, item, cotas: [{a,b,txt,campo}], mais, destaque: [ids], toque: true (camadas de toque) }
   */
  function svg(L, pavId, lay, view, o = {}) {
    const { s, ox, oy } = view;
    const X = x => +(ox + x * s).toFixed(1), Y = y => +(oy - y * s).toFixed(1);
    const P = pt => `${X(pt[0])},${Y(pt[1])}`;
    const ln = (a, b, cls, extra = '') => `<line class="${cls}" x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}"${extra}/>`;
    const ls = linhas(lay);
    const amb = id => L.ambientes.find(a => a.id === id) || {};
    const it = o.item;
    let out = '';

    // fundos
    for (const [id, r] of lay.pos) {
      const cls = ['pl-fundo', o.sel === id && !it ? 'sel' : '', o.destaque && o.destaque.includes(id) ? 'dest' : ''].join(' ');
      out += `<rect class="${cls}" data-amb="${esc(id)}" x="${X(r.x)}" y="${Y(r.y + r.dy)}" width="${+(r.dx * s).toFixed(1)}" height="${+(r.dy * s).toFixed(1)}"/>`;
    }
    // objetos
    for (const ob of lay.objetos) {
      const sel = it && it.tipo === 'obj' && it.id === ob.o.id;
      out += `<g class="pl-obj${sel ? ' sel' : ''}">`;
      for (const pr of ob.prims) {
        if (pr.t === 'l') out += ln(pr.pts[0], pr.pts[1], '');
        else if (pr.t === 'c') out += `<circle cx="${X(pr.cx)}" cy="${Y(pr.cy)}" r="${Math.max(1.5, pr.r * s).toFixed(1)}"/>`;
        else if (pr.t === 't') { if (ob.bw * s > 24) out += `<text x="${X(pr.cx)}" y="${Y(pr.cy) + 3}" text-anchor="middle">${esc(pr.txt)}</text>`; }
        else out += `<polygon class="${pr.t === 'pf' ? 'cheio' : pr.t === 'pd' ? 'trac' : ''}" points="${pr.pts.map(P).join(' ')}"/>`;
      }
      if (ob.o.tipo === 'desnivel') out += `<text class="pl-nv" x="${X(ob.x0 + ob.bw / 2)}" y="${Y(ob.y0 + ob.bh / 2) + 4}" text-anchor="middle">NV ${fmtNivel(ob.nivel)}</text>`;
      out += '</g>';
    }
    // paredes, batentes, folhas e janelas
    out += ls.paredes.map(l => ln([l[0], l[1]], [l[2], l[3]], 'pl-parede')).join('');
    out += ls.batentes.map(l => ln([l[0], l[1]], [l[2], l[3]], 'pl-batente')).join('');
    for (const pr of ls.simbolos) {
      const sel = it && it.tipo === 'porta' && it.id === pr.porta ? ' sel' : '';
      if (pr.t === 'a') {
        const ux = X(pr.de[0]) - X(pr.cx), uy = Y(pr.de[1]) - Y(pr.cy), vx = X(pr.ate[0]) - X(pr.cx), vy = Y(pr.ate[1]) - Y(pr.cy);
        const varre = ux * vy - uy * vx > 0 ? 1 : 0, rr = +(pr.r * s).toFixed(1);
        out += `<path class="pl-arco${sel}" d="M${P(pr.de).replace(',', ' ')} A${rr} ${rr} 0 0 ${varre} ${P(pr.ate).replace(',', ' ')}"/>`;
      } else {
        out += ln(pr.pts[0], pr.pts[1], (pr.t === 'lf' ? 'pl-correr' : pr.t === 'ld' ? 'pl-janela-alta' : 'pl-folha') + sel);
      }
    }
    // trecho de parede selecionado
    const info = infoItem(lay, it);
    if (it && it.tipo === 'seg' && info) out += ln(info.F.pt(info.u0), info.F.pt(info.u1), 'pl-seg-sel');

    if (o.toque) {
      for (const l of ls.paredes) out += ln([l[0], l[1]], [l[2], l[3]], 'pl-seg-alvo', ` data-seg="${esc(l[4])}|${l[5]}|${l[6]}|${l[7]}"`);
      for (const ob of lay.objetos) {
        out += `<rect class="pl-alvo" data-obj="${esc(ob.amb)}|${esc(ob.o.id)}" x="${X(ob.x0)}" y="${Y(ob.y0 + ob.bh)}" width="${+(ob.bw * s).toFixed(1)}" height="${+(ob.bh * s).toFixed(1)}"/>`;
      }
      for (const g of lay.portas) {
        const xs = [g.x1, g.x2, g.x1 + g.nx * g.t], ys = [g.y1, g.y2, g.y1 + g.ny * g.t];
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pad = 9;
        out += `<rect class="pl-alvo" data-porta="${esc(g.p.id)}" x="${X(x0) - pad}" y="${Y(y1) - pad}" width="${(x1 - x0) * s + 2 * pad}" height="${(y1 - y0) * s + 2 * pad}"/>`;
      }
    }
    // pontos de instalação
    for (const pt of lay.pontos) {
      const sel = it && it.tipo === 'ponto' && it.id === pt.i.id;
      const rr = Math.max(8, Math.min(14, 0.12 * s));
      out += `<g class="pl-ponto${sel ? ' sel' : ''}" data-ponto="${esc(pt.amb)}|${esc(pt.i.id)}">` +
        `<line x1="${X(pt.px)}" y1="${Y(pt.py)}" x2="${X(pt.cx)}" y2="${Y(pt.cy)}"/>` +
        `<circle cx="${X(pt.cx)}" cy="${Y(pt.cy)}" r="${rr}"/><text x="${X(pt.cx)}" y="${Y(pt.cy) + 3.5}" text-anchor="middle">${esc(pt.cod)}</text></g>`;
    }
    // textos dos ambientes
    for (const [id, r] of lay.pos) {
      const a = amb(id), wpx = r.dx * s, hpx = r.dy * s;
      if (wpx < 34 || hpx < 22) continue;
      const cx = X(r.x + r.dx / 2), cy = Y(r.y + r.dy / 2);
      const linhasTxt = [`<tspan class="pl-cod">${esc(a.codigo || '')}</tspan>`];
      if (a.nome && wpx > 70) linhasTxt.push(`<tspan x="${cx}" dy="14" class="pl-nome">${esc(cortar(a.nome, Math.floor(wpx / 7)))}</tspan>`);
      if (hpx > 46) linhasTxt.push(`<tspan x="${cx}" dy="13" class="pl-area">${fmt(r.dx * r.dy)} m²</tspan>`);
      if (hpx > 60 && (num(a.nivel) || 0) !== 0) linhasTxt.push(`<tspan x="${cx}" dy="13" class="pl-nv">NV ${fmtNivel(r.nivel)}</tspan>`);
      out += `<text class="pl-txt" x="${cx}" y="${cy - (linhasTxt.length - 1) * 6.5}" text-anchor="middle">${linhasTxt.join('')}</text>`;
    }
    // medidas do ambiente selecionado (quando nada dentro dele está selecionado)
    if (o.sel && !it && lay.pos.has(o.sel)) {
      const r = lay.pos.get(o.sel);
      out += `<text class="pl-med" x="${X(r.x + r.dx / 2)}" y="${Y(r.y) + 15}" text-anchor="middle">${fmt(r.dx)}</text>`;
      out += `<text class="pl-med" x="${X(r.x) - 6}" y="${Y(r.y + r.dy / 2) + 4}" text-anchor="end">${fmt(r.dy)}</text>`;
    }
    // cotas
    const cotas = [...(o.cotas || []), ...(info ? info.cotas.map(c => ({ ...c, txt: fmt(info.valores[c.campo]) })) : [])];
    for (const c of cotas) {
      if (!c) continue;
      const a = c.a || [c.x1, c.y1], b = c.b || [c.x2, c.y2];
      const x1 = X(a[0]), y1 = Y(a[1]), x2 = X(b[0]), y2 = Y(b[1]);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, px = -dy / len * 5, py = dx / len * 5;
      const tx = (x1 + x2) / 2 + px * 2.4, ty = (y1 + y2) / 2 + py * 2.4 + 4;
      out += `<g class="pl-cota${c.campo ? ' editavel' : ''}"${c.campo ? ` data-cota="${c.campo}"` : ''}><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
        `<line x1="${x1 - px}" y1="${y1 - py}" x2="${x1 + px}" y2="${y1 + py}"/><line x1="${x2 - px}" y1="${y2 - py}" x2="${x2 + px}" y2="${y2 + py}"/>` +
        (c.campo ? `<rect class="pl-cota-alvo" x="${tx - 22}" y="${ty - 15}" width="44" height="20" rx="4"/>` : '') +
        `<text x="${tx}" y="${ty}" text-anchor="middle">${esc(c.txt)}</text></g>`;
    }
    // "+" nas portas sem ambiente do outro lado
    if (o.mais) {
      for (const g of lay.portas) {
        if (g.p.ambB || g.janela) continue;
        const d = g.t + 0.55;
        const cx = X((g.x1 + g.x2) / 2 + g.nx * d), cy = Y((g.y1 + g.y2) / 2 + g.ny * d);
        out += `<g class="pl-mais" data-mais="${esc(g.p.id)}"><circle cx="${cx}" cy="${cy}" r="17"/><path d="M${cx - 7} ${cy}H${cx + 7}M${cx} ${cy - 7}V${cy + 7}"/></g>`;
      }
    }
    return out;
  }
  const cortar = (s, n) => s.length > n ? s.slice(0, Math.max(3, n - 1)) + '…' : s;

  /** Cota da boneca: do canto da parede até o batente, por dentro do ambiente. lado = 'A' | 'B'. */
  function cotaBoneca(lay, portaId, lado, txt) {
    const g = lay.portas.find(x => x.p.id === portaId);
    if (!g) return null;
    const id = lado === 'A' ? g.p.ambA : g.p.ambB;
    const r = lay.pos.get(id);
    if (!r) return null;
    const f = lado === 'A' ? g.p.parede : OPOSTA[g.p.parede];
    const F = face(r, f), canto = lado === 'A' ? g.p.canto : g.p.cantoB;
    return canto === 'fim' ? { a: F.pt(g.ub, 0.3), b: F.pt(F.u1, 0.3), txt } : { a: F.pt(F.u0, 0.3), b: F.pt(g.ua, 0.3), txt };
  }
  /** Cota da largura da porta, por dentro do ambiente A, em linha com a cota da boneca. */
  function cotaLargura(lay, portaId, txt) {
    const g = lay.portas.find(x => x.p.id === portaId);
    if (!g) return null;
    const F = face(lay.pos.get(g.p.ambA), g.p.parede);
    return { a: F.pt(g.ua, 0.3), b: F.pt(g.ub, 0.3), txt };
  }

  /** Miniatura de um objeto da biblioteca (para o seletor). */
  function iconeObjeto(tipo, tam = 44) {
    const b = BIBLIOTECA[tipo];
    const k = (tam - 8) / Math.max(b.w, b.d), ox = (tam - b.w * k) / 2, oy = (tam - b.d * k) / 2;
    const X = u => (ox + u * k).toFixed(1), Y = v => (tam - oy - v * k).toFixed(1);
    let s = '';
    for (const p of b.s(b.w, b.d)) {
      if (p[0] === 'l') s += `<line x1="${X(p[1])}" y1="${Y(p[2])}" x2="${X(p[3])}" y2="${Y(p[4])}"/>`;
      else if (p[0] === 'c') s += `<circle cx="${X(p[1])}" cy="${Y(p[2])}" r="${Math.max(1, p[3] * k).toFixed(1)}"/>`;
      else if (p[0] === 'e') s += `<ellipse cx="${X(p[1])}" cy="${Y(p[2])}" rx="${(p[3] * k).toFixed(1)}" ry="${(p[4] * k).toFixed(1)}"/>`;
      else if (p[0] === 't') s += `<text x="${X(p[1])}" y="${+Y(p[2]) + 3}" text-anchor="middle">${p[3]}</text>`;
      else s += `<rect class="${p[0] === 'f' ? 'cheio' : p[0] === 'rd' ? 'trac' : ''}" x="${X(p[1])}" y="${Y(p[4])}" width="${((p[3] - p[1]) * k).toFixed(1)}" height="${((p[4] - p[2]) * k).toFixed(1)}"/>`;
    }
    return `<svg class="ic-obj" viewBox="0 0 ${tam} ${tam}" width="${tam}" height="${tam}" aria-hidden="true">${s}</svg>`;
  }

  // ───────────────────────── DXF (R12, metros) ─────────────────────────
  const dxfTxt = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7E]/g, c => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  const f4 = n => (Math.round(n * 10000) / 10000).toString();

  /** Todos os pavimentos lado a lado (10 m de folga), cada um com o nome em cima. */
  function dxf(L) {
    const ent = [];
    const linha = (camada, x1, y1, x2, y2) => ent.push(`0\nLINE\n8\n${camada}\n10\n${f4(x1)}\n20\n${f4(y1)}\n30\n0\n11\n${f4(x2)}\n21\n${f4(y2)}\n31\n0`);
    const arco = (camada, cx, cy, r, a1, a2) => ent.push(`0\nARC\n8\n${camada}\n10\n${f4(cx)}\n20\n${f4(cy)}\n30\n0\n40\n${f4(r)}\n50\n${f4(a1)}\n51\n${f4(a2)}`);
    const circulo = (camada, cx, cy, r) => ent.push(`0\nCIRCLE\n8\n${camada}\n10\n${f4(cx)}\n20\n${f4(cy)}\n30\n0\n40\n${f4(r)}`);
    const texto = (camada, x, y, alt, t) => ent.push(`0\nTEXT\n8\n${camada}\n10\n${f4(x)}\n20\n${f4(y)}\n30\n0\n40\n${f4(alt)}\n1\n${dxfTxt(t)}\n72\n4\n11\n${f4(x)}\n21\n${f4(y)}\n31\n0`);
    const ang = (x, y) => (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const poli = (camada, pts, dx) => pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; linha(camada, p[0] + dx, p[1], q[0] + dx, q[1]); });

    let desloc = 0;
    for (const pav of L.pavimentos) {
      const lay = layout(L, pav.id);
      if (!lay.pos.size) continue;
      const b = caixa([...lay.pos.values()]);
      const dx = desloc - b.x0;
      const ls = linhas(lay);
      for (const l of ls.paredes) linha('PAREDES', l[0] + dx, l[1], l[2] + dx, l[3]);
      for (const l of ls.batentes) linha('ESQUADRIAS', l[0] + dx, l[1], l[2] + dx, l[3]);
      for (const pr of ls.simbolos) {
        if (pr.t === 'a') {
          const a1 = ang(pr.de[0] - pr.cx, pr.de[1] - pr.cy), a2 = ang(pr.ate[0] - pr.cx, pr.ate[1] - pr.cy);
          if (Math.round((a2 - a1 + 360) % 360) === 90) arco('ESQUADRIAS', pr.cx + dx, pr.cy, pr.r, a1, a2);
          else arco('ESQUADRIAS', pr.cx + dx, pr.cy, pr.r, a2, a1);
        } else {
          linha(pr.t === 'ld' ? 'ACIMA_DO_CORTE' : 'ESQUADRIAS', pr.pts[0][0] + dx, pr.pts[0][1], pr.pts[1][0] + dx, pr.pts[1][1]);
        }
      }
      for (const ob of lay.objetos) {
        const cam = ob.o.tipo === 'desnivel' ? 'DESNIVEIS' : 'MOBILIARIO';
        for (const pr of ob.prims) {
          if (pr.t === 'l') linha(cam, pr.pts[0][0] + dx, pr.pts[0][1], pr.pts[1][0] + dx, pr.pts[1][1]);
          else if (pr.t === 'c') circulo(cam, pr.cx + dx, pr.cy, pr.r);
          else if (pr.t === 't') texto(cam, pr.cx + dx, pr.cy, 0.1, pr.txt);
          else poli(cam, pr.pts, dx);
        }
        if (ob.o.tipo === 'desnivel') texto('TEXTOS', ob.x0 + ob.bw / 2 + dx, ob.y0 + ob.bh / 2, 0.12, `NV ${fmtNivel(ob.nivel)}`);
      }
      for (const pt of lay.pontos) {
        linha('INSTALACOES', pt.px + dx, pt.py, pt.cx + dx, pt.cy);
        circulo('INSTALACOES', pt.cx + dx, pt.cy, 0.1);
        texto('INSTALACOES', pt.cx + dx, pt.cy, 0.07, pt.cod);
      }
      for (const [id, r] of lay.pos) {
        const a = L.ambientes.find(x => x.id === id) || {};
        const cx = r.x + r.dx / 2 + dx, cy = r.y + r.dy / 2;
        texto('TEXTOS', cx, cy + 0.25, 0.2, a.codigo || '');
        if (a.nome) texto('TEXTOS', cx, cy, 0.15, a.nome);
        texto('TEXTOS', cx, cy - 0.25, 0.12, `${fmt(r.dx * r.dy)} m2`);
        if (r.nivel) texto('TEXTOS', cx, cy - 0.45, 0.12, `NV ${fmtNivel(r.nivel)}`);
      }
      texto('TEXTOS', desloc + (b.x1 - b.x0) / 2, b.y1 + 1, 0.4, pav.nome || pav.sigla || 'Pavimento');
      desloc += (b.x1 - b.x0) + 10;
    }
    const camadas = [['PAREDES', 7, 'CONTINUOUS'], ['ESQUADRIAS', 3, 'CONTINUOUS'], ['ACIMA_DO_CORTE', 4, 'DASHED'],
      ['MOBILIARIO', 8, 'CONTINUOUS'], ['DESNIVEIS', 6, 'DASHED'], ['INSTALACOES', 1, 'CONTINUOUS'], ['TEXTOS', 2, 'CONTINUOUS']];
    return [
      '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC',
      '0\nSECTION\n2\nTABLES',
      '0\nTABLE\n2\nLTYPE\n70\n2\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n' +
        '0\nLTYPE\n2\nDASHED\n70\n0\n3\n__ __ __\n72\n65\n73\n2\n40\n0.15\n49\n0.1\n49\n-0.05\n0\nENDTAB',
      `0\nTABLE\n2\nLAYER\n70\n${camadas.length}\n` + camadas.map(([n, c, t]) => `0\nLAYER\n2\n${n}\n70\n0\n62\n${c}\n6\n${t}`).join('\n') + '\n0\nENDTAB',
      '0\nENDSEC',
      '0\nSECTION\n2\nENTITIES',
      ...ent,
      '0\nENDSEC\n0\nEOF',
    ].join('\n') + '\n';
  }

  raiz.Planta = {
    layout, linhas, conferir, enquadrar, svg, cotaBoneca, cotaLargura, infoItem, segmentoEm, vaosDaFace, face, dxf, caixa, iconeObjeto,
    OPOSTA, HORIZ, ESPESSURA_PADRAO, PD_PADRAO, MODELOS, PADRAO_ABERTURA, PONTOS, BIBLIOTECA, ehJanela, canon, fmtNivel, nivelDe, pdDe,
  };
})(typeof window !== 'undefined' ? window : globalThis);
