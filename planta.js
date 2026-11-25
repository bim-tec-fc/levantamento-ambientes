/* ═══════════════════════════════════════════════════════════════════════════
   planta.js: geometria, desenho (SVG) e exportação DXF da planta baixa.
   Núcleo BIM · Ferreira Costa · Melqui Domingos

   Ambientes
   ─────────
   Cada ambiente é um polígono de paredes internas, percorrido no sentido
   anti-horário (o interior fica à esquerda de cada parede). Os cantos recebem
   letras: A, B, C… A parede k vai do canto k ao canto k+1.

   - forma 'ret': retângulo comp (parede A–B) × larg (parede B–C).
   - forma 'poli': a.paredes = [{c, ang}]: comprimento de cada parede e, a partir
     da segunda, o ângulo interno no canto onde ela começa (90 = esquadro,
     270 = canto de um "L"). A última parede fecha o polígono e é calculada.
     Enquanto a.desenhando é verdadeiro o polígono fica aberto.

   No sistema do ambiente o canto A está na origem e a parede A–B segue o eixo X.
   Na planta, cada ambiente tem uma posição e uma rotação:
   - o primeiro (e os desenhados soltos) usam a.pos = {x, y} e a.rot (graus);
   - os outros são posicionados pela PORTA que os liga a um ambiente já desenhado:

     abertura = { ambA, parede (índice), modelo, largura, altura, peitoril,
                  boneca, canto, espessura, abre, lado, ambB, paredeB, bonecaB, cantoB }

     A parede paredeB de B fica encostada na parede de A (sentido oposto), do
     outro lado da espessura, com a porta no mesmo lugar nas duas.
     boneca: do canto até o batente; canto 'ini' = canto onde a parede começa,
     'fim' = canto onde termina.

   Dentro de cada ambiente ficam os pontos de instalação na parede (a.inst com
   parede e pos a partir do canto inicial) e os objetos (a.objetos com centro
   cx, cy no sistema do ambiente e rotação rot em graus).

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
  const RAD = Math.PI / 180;
  const letra = k => k < 26 ? String.fromCharCode(65 + k) : 'A' + String.fromCharCode(65 + k - 26);

  // vetores
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const len = a => Math.hypot(a[0], a[1]);
  const rotv = (a, r) => [a[0] * Math.cos(r) - a[1] * Math.sin(r), a[0] * Math.sin(r) + a[1] * Math.cos(r)];

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
   * Desenho no sistema do objeto: u ao longo da largura, v da parte de trás (v = 0,
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
  /** Distância do canto inicial da parede até o batente mais próximo dele. */
  const canon = (L, b, w, canto) => canto === 'fim' ? L - b - w : b;

  // ───────────────────────── Forma de cada ambiente ─────────────────────────
  /**
   * Polígono no sistema do ambiente. Devolve {verts, fechado, paredesInfo}.
   * Para 'poli', a parede k (k ≥ 1) gira em relação à anterior: rumo += 180 − ângulo interno.
   */
  function formaLocal(a) {
    if (a.forma === 'poli') {
      const ps = Array.isArray(a.paredes) ? a.paredes : [];
      const verts = [[0, 0]];
      // sentido em que os cantos foram marcados: anti-horário (interior à esquerda) ou horário
      const sentido = a.sentido === 'horario' ? -1 : 1;
      let rumo = 0;
      ps.forEach((p, k) => {
        if (k > 0) rumo += sentido * (180 - (num(p.ang) ?? 90)) * RAD;
        const c = num(p.c) || 0;
        const u = verts[verts.length - 1];
        verts.push([u[0] + c * Math.cos(rumo), u[1] + c * Math.sin(rumo)]);
      });
      const fechado = !a.desenhando && ps.length >= 2;
      // a parede de fechamento (do último canto ao A) não é guardada; se o último canto caiu
      // em cima do A (todas as paredes digitadas), ele é o próprio A
      if (fechado && verts.length > 3 && len(sub(verts[verts.length - 1], verts[0])) < 0.01) verts.pop();
      return { verts, fechado, rumoFinal: rumo, sentido };
    }
    const dx = num(a.comp) || 0, dy = num(a.larg) || 0;
    return { verts: [[0, 0], [dx, 0], [dx, dy], [0, dy]], fechado: true, rumoFinal: Math.PI, sentido: 1 };
  }

  /** Área (fórmula do polígono) e perímetro de um ambiente fechado. */
  function areaPerimetro(a) {
    const { verts, fechado } = formaLocal(a);
    if (!fechado || verts.length < 3) return { area: null, perim: null };
    let ar = 0, pe = 0;
    verts.forEach((p, i) => { const q = verts[(i + 1) % verts.length]; ar += p[0] * q[1] - q[0] * p[1]; pe += len(sub(q, p)); });
    return { area: Math.abs(ar) / 2, perim: pe };
  }

  /** Paredes (no mundo) a partir dos cantos já transformados. */
  function paredesDe(verts, fechado, sentido = 1) {
    const n = verts.length, out = [];
    const total = fechado ? n : n - 1;
    // o interior fica à esquerda se o polígono for anti-horário; à direita se horário
    let esq = sentido > 0;
    if (fechado && n >= 3) {
      let ar = 0;
      verts.forEach((p, i) => { const q = verts[(i + 1) % n]; ar += p[0] * q[1] - q[0] * p[1]; });
      if (Math.abs(ar) > 1e-9) esq = ar > 0;
    }
    for (let k = 0; k < total; k++) {
      const a = verts[k], b = verts[(k + 1) % n], v = sub(b, a), L = len(v) || 1e-9;
      const d = [v[0] / L, v[1] / L], l = [-d[1], d[0]];
      out.push({ k, a, b, len: len(v), d, nIn: esq ? l : mul(l, -1), nOut: esq ? mul(l, -1) : l });
    }
    return out;
  }
  const ptW = (W, s, off = 0) => [W.a[0] + W.d[0] * s + W.nIn[0] * off, W.a[1] + W.d[1] * s + W.nIn[1] * off];

  /** Coloca o ambiente na planta: rotação r (rad) e posição t do canto A. */
  function colocar(a, r, t) {
    const f = formaLocal(a);
    const verts = f.verts.map(p => add(rotv(p, r), t));
    const walls = paredesDe(verts, f.fechado, f.sentido);
    const xs = verts.map(p => p[0]), ys = verts.map(p => p[1]);
    let cx = 0, cy = 0;
    verts.forEach(p => { cx += p[0]; cy += p[1]; });
    const ap = areaPerimetro(a);
    return {
      id: a.id, a, rot: r, t, verts, walls, fechado: f.fechado, local: f,
      nivel: nivelDe(a), pd: pdDe(a), area: ap.area, perim: ap.perim,
      centro: verts.length ? [cx / verts.length, cy / verts.length] : t,
      bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
      paraMundo: p => add(rotv(p, r), t),
      paraLocal: p => rotv(sub(p, t), -r),
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
    let cursor = null;

    const espalhar = id => {
      const fila = [id];
      while (fila.length) {
        const A = pos.get(fila.shift());
        for (const p of portas) {
          if (p.ambA !== A.id || !p.ambB || pos.has(p.ambB) || !posiciona(p)) continue;
          const B = porId.get(p.ambB);
          const WA = A.walls[+p.parede];
          if (!B || B.ancora !== p.id || !WA) continue;
          const fB = formaLocal(B), wB = paredesDe(fB.verts, fB.fechado, fB.sentido)[+p.paredeB || 0];
          if (!wB) continue;
          const w = num(p.largura) || 0, t = num(p.espessura) ?? ESPESSURA_PADRAO;
          const cA = canon(WA.len, num(p.boneca) || 0, w, p.canto);
          const cB = canon(wB.len, num(p.bonecaB) || 0, w, p.cantoB);
          // gira B para que o interior dele fique do lado de fora da parede de A
          const r = Math.atan2(WA.nOut[1], WA.nOut[0]) - Math.atan2(wB.nIn[1], wB.nIn[0]);
          const dB = rotv(wB.d, r);
          // o batente de A (do outro lado da espessura) que fica no início da parede de B
          const Q = add(ptW(WA, dot(dB, WA.d) < 0 ? cA + w : cA), mul(WA.nOut, t));
          const inicioB = sub(Q, mul(dB, cB));                         // canto inicial da parede de B no mundo
          const tB = sub(inicioB, rotv(wB.a, r));
          pos.set(B.id, colocar(B, r, tB));
          ligadaPor.set(B.id, p.id);
          fila.push(B.id);
        }
      }
    };

    for (const r of raizes) {
      if (pos.has(r.id)) continue;
      let R;
      if (r.pos && num(r.pos.x) != null) R = colocar(r, (num(r.rot) || 0) * RAD, [num(r.pos.x), num(r.pos.y) || 0]);
      else {
        const prov = colocar(r, (num(r.rot) || 0) * RAD, [0, 0]);
        const x = cursor == null ? 0 : cursor - prov.bbox.x0;
        R = colocar(r, (num(r.rot) || 0) * RAD, [x, 0]);
      }
      pos.set(r.id, R);
      espalhar(r.id);
      cursor = caixa([...pos.values()]).x1 + 2;
    }

    const geo = portas.filter(p => pos.has(p.ambA) && pos.get(p.ambA).walls[+p.parede]).map(p => {
      const A = pos.get(p.ambA), W = A.walls[+p.parede];
      const w = num(p.largura) || 0, t = num(p.espessura) ?? ESPESSURA_PADRAO;
      const c = canon(W.len, num(p.boneca) || 0, w, p.canto);
      const P1 = ptW(W, c), P2 = ptW(W, c + w);
      // o ambiente do outro lado é o que tem uma parede encostada nesta (paralela, a até 60 cm)
      let viz = null;
      for (const [id2, R2] of pos) {
        if (id2 === p.ambA || !R2.fechado) continue;
        for (const W2 of R2.walls) {
          if (dot(W2.nOut, W.nOut) > -0.995) continue;   // paredes de frente uma para a outra
          const g1 = dot(sub(P1, W2.a), W2.nOut), g2 = dot(sub(P2, W2.a), W2.nOut), gap = (g1 + g2) / 2;
          if (gap < 0.005 || gap > 0.6 || Math.abs(g1 - g2) > 0.03) continue;
          const sB = Math.min(dot(sub(P1, W2.a), W2.d), dot(sub(P2, W2.a), W2.d));   // batente mais perto do início da parede de B
          if (sB < -0.05 || sB + w > W2.len + 0.05) continue;
          if (!viz || gap < viz.gap) viz = { id: id2, W: W2, gap, cB: sB };
        }
      }
      const g = {
        p, W, x1: P1[0], y1: P1[1], x2: P2[0], y2: P2[1], nx: W.nOut[0], ny: W.nOut[1], t: viz ? viz.gap : t, w, c, len: W.len,
        ligada: !!viz, ambB: viz ? viz.id : null, WB: viz ? viz.W : null, cB: viz ? viz.cB : null,
        janela: ehJanela(p.modelo), corta: p.modelo !== 'janela_alta',
        fora: c < -0.005 || c + w > W.len + 0.005, foraB: !!viz && (viz.cB < -0.005 || viz.cB + w > viz.W.len + 0.005),
      };
      g.prims = primitivasAbertura(g);
      return g;
    });

    const pontos = [], objetos = [];
    for (const a of ambs) {
      const R = pos.get(a.id);
      if (!R) continue;
      for (const i of a.inst || []) {
        const W = R.walls[+i.parede];
        if (i.parede === '' || i.parede == null || !W || num(i.pos) == null) continue;
        const s = num(i.pos);
        const P = ptW(W, s), C = ptW(W, s, 0.17);
        pontos.push({ i, amb: a.id, W, s, px: P[0], py: P[1], cx: C[0], cy: C[1], len: W.len, cod: (PONTOS[i.tipo] || ['?'])[0] });
      }
      for (const o of a.objetos || []) {
        const b = BIBLIOTECA[o.tipo];
        if (!b) continue;
        const w = num(o.w) || b.w, d = num(o.d) || b.d, rot = (num(o.rot) || 0) * RAD;
        const c = [num(o.cx) || 0, num(o.cy) || 0];
        // objeto: (u, v) → ambiente (centro + rotação) → planta
        const tr = (u, v) => R.paraMundo(add(c, rotv([u - w / 2, v - d / 2], rot)));
        const prims = [];
        for (const s of b.s(w, d)) {
          if (s[0] === 'r' || s[0] === 'f' || s[0] === 'rd') prims.push({ t: s[0] === 'r' ? 'p' : s[0] === 'f' ? 'pf' : 'pd', pts: [tr(s[1], s[2]), tr(s[3], s[2]), tr(s[3], s[4]), tr(s[1], s[4])] });
          else if (s[0] === 'l') prims.push({ t: 'l', pts: [tr(s[1], s[2]), tr(s[3], s[4])] });
          else if (s[0] === 'c') { const [x, y] = tr(s[1], s[2]); prims.push({ t: 'c', cx: x, cy: y, r: s[3] }); }
          else if (s[0] === 'e') {
            const pts = [];
            for (let k = 0; k < 24; k++) { const an = k / 24 * 2 * Math.PI; pts.push(tr(s[1] + s[3] * Math.cos(an), s[2] + s[4] * Math.sin(an))); }
            prims.push({ t: 'p', pts });
          } else if (s[0] === 't') { const [x, y] = tr(s[1], s[2]); prims.push({ t: 't', cx: x, cy: y, txt: s[3] }); }
        }
        const contorno = [tr(0, 0), tr(w, 0), tr(w, d), tr(0, d)];
        const h = o.tipo === 'pilar' ? R.pd : (num(o.h) ?? b.h);
        objetos.push({
          o, amb: a.id, b, w, d, rot, centroLocal: c, centro: R.paraMundo(c), contorno, prims, h,
          nivel: o.tipo === 'desnivel' ? (num(o.nivel) ?? R.nivel) : R.nivel,
        });
      }
    }
    return { pos, portas: geo, pontos, objetos };
  }

  function caixa(rs) {
    if (!rs.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    return {
      x0: Math.min(...rs.map(r => r.bbox.x0)), y0: Math.min(...rs.map(r => r.bbox.y0)),
      x1: Math.max(...rs.map(r => r.bbox.x1)), y1: Math.max(...rs.map(r => r.bbox.y1)),
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
    const s = p.abre === 'fora' ? 1 : -1;
    const f0 = p.abre === 'fora' ? t : 0;
    const out = [];
    const Ln = (a, b, tp = 'l') => out.push({ t: tp, pts: [a, b] });
    const Ar = (c, de, ate, r) => out.push({ t: 'a', cx: c[0], cy: c[1], r, de, ate });
    const m = p.modelo || 'giro';
    if (w <= 0) return out;
    if (m === 'giro') {
      const H = em(p.lado === 'fim' ? P2 : P1, f0), J = em(p.lado === 'fim' ? P1 : P2, f0);
      const E = em(H, s * w);
      Ln(H, E);
      Ar(H, E, J, w);
    } else if (m === 'giro2') {
      const H1 = em(P1, f0), H2 = em(P2, f0), M = em(ao(P1, w / 2), f0);
      const E1 = em(H1, s * w / 2), E2 = em(H2, s * w / 2);
      Ln(H1, E1); Ar(H1, E1, M, w / 2);
      Ln(H2, E2); Ar(H2, E2, M, w / 2);
    } else if (m === 'correr' || m === 'correr2') {
      const seta = (de, ate) => {
        Ln(de, ate);
        const dx = ate[0] - de[0], dy = ate[1] - de[1], n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n, k = 0.08;
        Ln(ate, [ate[0] - ux * k + uy * k * 0.6, ate[1] - uy * k - ux * k * 0.6]);
        Ln(ate, [ate[0] - ux * k - uy * k * 0.6, ate[1] - uy * k + ux * k * 0.6]);
      };
      if (m === 'correr') {
        const o = f0 + s * 0.05;
        Ln(em(P1, o), em(P2, o), 'lf');
        const ida = p.lado === 'fim' ? 1 : -1, M = ao(P1, w / 2);
        seta(em(ao(M, -ida * w * 0.2), o + s * 0.12), em(ao(M, ida * w * 0.2), o + s * 0.12));
      } else {
        const o1 = f0 + s * 0.04, o2 = f0 + s * 0.1;
        Ln(em(P1, o1), em(ao(P1, w / 2 + 0.05), o1), 'lf');
        Ln(em(ao(P1, w / 2 - 0.05), o2), em(P2, o2), 'lf');
        seta(em(ao(P1, w * 0.35), o2 + s * 0.12), em(ao(P1, w * 0.12), o2 + s * 0.12));
        seta(em(ao(P1, w * 0.65), o2 + s * 0.12), em(ao(P1, w * 0.88), o2 + s * 0.12));
      }
    } else if (m === 'janela') {
      Ln(em(P1, t * 0.35), em(P2, t * 0.35));
      Ln(em(P1, t * 0.65), em(P2, t * 0.65));
    } else if (m === 'janela_alta') {
      Ln(em(P1, t * 0.5), em(P2, t * 0.5), 'ld');
      Ln(em(P1, -0.05), em(P1, t + 0.05), 'ld');
      Ln(em(P2, -0.05), em(P2, t + 0.05), 'ld');
    }
    return out;
  }

  // ───────────────────────── Linhas do desenho ─────────────────────────
  /** Aberturas que cortam uma parede de um ambiente, em distância a partir do canto inicial dela. */
  function vaosDaParede(lay, amb, k, todas = false) {
    const out = [];
    for (const g of lay.portas) {
      if (!todas && !g.corta) continue;
      if (g.p.ambA === amb && +g.p.parede === k) out.push({ g, ua: g.c, ub: g.c + g.w, lado: 'A' });
      else if (g.ligada && g.ambB === amb && g.WB.k === k) out.push({ g, ua: g.cB, ub: g.cB + g.w, lado: 'B' });
    }
    return out.sort((a, b) => a.ua - b.ua);
  }

  /** Paredes com os vãos recortados ([x1,y1,x2,y2,amb,k,s0,s1]), batentes e símbolos. Tudo em metros. */
  function linhas(lay) {
    const paredes = [];
    for (const [id, R] of lay.pos) {
      for (const W of R.walls) {
        let s = 0;
        const seg = (a, b) => { if (b - a > 0.0005) paredes.push([...ptW(W, a), ...ptW(W, b), id, W.k, a, b]); };
        for (const v of vaosDaParede(lay, id, W.k)) { seg(s, Math.min(v.ua, W.len)); s = Math.max(s, v.ub); }
        seg(s, W.len);
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
  function dentro(pt, poli) {
    let c = false;
    for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
      const a = poli[i], b = poli[j];
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  /** Polígono encolhido 2 cm para dentro (para não acusar ambientes só encostados). */
  function encolher(R, m = 0.02) {
    return R.verts.map((p, i) => {
      const W1 = R.walls[(i - 1 + R.walls.length) % R.walls.length], W2 = R.walls[i];
      if (!W1 || !W2) return p;
      const n = add(W1.nIn, W2.nIn), L = len(n) || 1;
      return add(p, mul(n, m / L * 1.4));
    });
  }
  const cruzam = (p1, p2, q1, q2) => {
    const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
  };
  function sobrepoe(A, B) {
    if (!A.fechado || !B.fechado) return false;
    if (A.bbox.x1 < B.bbox.x0 || B.bbox.x1 < A.bbox.x0 || A.bbox.y1 < B.bbox.y0 || B.bbox.y1 < A.bbox.y0) return false;
    const a = encolher(A), b = encolher(B);
    if (a.some(p => dentro(p, b)) || b.some(p => dentro(p, a))) return true;
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
      if (cruzam(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
    return false;
  }

  function conferir(L, pavId, lay) {
    const av = [];
    const cod = id => { const a = L.ambientes.find(x => x.id === id); return a ? (a.codigo || a.nome || '?') : '?'; };
    const ids = [...lay.pos.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (sobrepoe(lay.pos.get(ids[i]), lay.pos.get(ids[j]))) av.push(`${cod(ids[i])} e ${cod(ids[j])} se sobrepõem. Confira as medidas, os ângulos e as bonecas das portas.`);
      }
    }
    for (const g of lay.portas) {
      const oq = g.janela ? 'A janela' : 'A porta';
      if (g.fora) av.push(`${oq} de ${cod(g.p.ambA)} não cabe na parede (${fmt(g.len)} m). Confira a boneca e a largura.`);
      if (g.foraB) av.push(`A porta entre ${cod(g.p.ambA)} e ${cod(g.ambB)} não cabe na parede de ${cod(g.ambB)}. Confira a posição dos ambientes.`);
    }
    for (const pt of lay.pontos) if (pt.s < -0.005 || pt.s > pt.len + 0.005) av.push(`Um ponto (${pt.cod}) de ${cod(pt.amb)} está fora da parede.`);
    for (const o of lay.objetos) {
      const R = lay.pos.get(o.amb);
      if (R.fechado && o.contorno.some(p => !dentro(p, encolher(R, -0.02)))) av.push(`${o.b.nome} de ${cod(o.amb)} passa da parede. Confira as cotas.`);
    }
    for (const [id, R] of lay.pos) {
      const a = R.a;
      if (R.fechado && !(R.area > 0.01)) av.push(`${cod(id)} está sem medidas.`);
      if (a.forma === 'poli' && R.fechado) {
        const med = num(a.fechamento);
        const W = R.walls[R.walls.length - 1];
        if (med != null && Math.abs(med - W.len) > 0.02) av.push(`${cod(id)}: a última parede (${letra(W.k)}–A) medida tem ${fmt(med)} m, mas o desenho fecha com ${fmt(W.len)} m. Confira medidas e ângulos.`);
      }
    }
    return av;
  }

  // ───────────────────────── Itens selecionáveis e cotas ─────────────────────────
  /**
   * Para o item selecionado devolve as cotas a desenhar e os valores que o painel mostra.
   * item = {tipo:'porta', id} | {tipo:'ponto', amb, id} | {tipo:'obj', amb, id} | {tipo:'seg', amb, k, esq, dir}
   * 'esq' do segmento fica do lado do canto inicial da parede; 'esq'/'dir' = 'canto' ou o id da abertura.
   */
  function infoItem(lay, item) {
    if (!item) return null;
    if (item.tipo === 'porta') {
      const g = lay.portas.find(x => x.p.id === item.id);
      if (!g) return null;
      const W = g.W, off = 0.32;
      return {
        g, W, valores: { esq: g.c, dir: W.len - g.c - g.w, larg: g.w },
        cotas: [
          { a: ptW(W, 0, off), b: ptW(W, g.c, off), campo: 'esq' },
          { a: ptW(W, g.c, off), b: ptW(W, g.c + g.w, off), campo: 'larg' },
          { a: ptW(W, g.c + g.w, off), b: ptW(W, W.len, off), campo: 'dir' },
        ],
      };
    }
    if (item.tipo === 'ponto') {
      const pt = lay.pontos.find(x => x.i.id === item.id);
      if (!pt) return null;
      const W = pt.W, off = 0.45;
      return {
        pt, W, valores: { esq: pt.s, dir: W.len - pt.s },
        cotas: [{ a: ptW(W, 0, off), b: ptW(W, pt.s, off), campo: 'esq' }, { a: ptW(W, pt.s, off), b: ptW(W, W.len, off), campo: 'dir' }],
      };
    }
    if (item.tipo === 'obj') {
      const ob = lay.objetos.find(x => x.o.id === item.id);
      if (!ob) return null;
      const R = lay.pos.get(ob.amb);
      // as duas paredes mais próximas (que não sejam paralelas entre si), medidas na perpendicular
      const cand = [];
      for (const W of R.walls) {
        const s = dot(sub(ob.centro, W.a), W.d);
        if (s < -0.01 || s > W.len + 0.01) continue;
        let dmin = Infinity, pmin = null;
        for (const p of ob.contorno) { const dd = dot(sub(p, W.a), W.nIn); if (dd < dmin) { dmin = dd; pmin = p; } }
        cand.push({ W, d: dmin, p: pmin });
      }
      cand.sort((a, b) => a.d - b.d);
      const esc2 = [];
      for (const c of cand) {
        if (esc2.length === 2) break;
        if (esc2.length === 1 && Math.abs(dot(esc2[0].W.d, c.W.d)) > 0.5) continue;
        esc2.push(c);
      }
      const valores = {}, cotas = [], paredes = {};
      for (const c of esc2) {
        const campo = 'p' + c.W.k;
        valores[campo] = c.d;
        paredes[campo] = c.W;
        cotas.push({ a: sub(c.p, mul(c.W.nIn, c.d)), b: c.p, campo });
      }
      return { obj: ob, R, valores, cotas, paredes };
    }
    if (item.tipo === 'seg') {
      const R = lay.pos.get(item.amb);
      const W = R && R.walls[item.k];
      if (!W) return null;
      const vs = vaosDaParede(lay, item.amb, item.k);
      const vE = item.esq === 'canto' ? null : vs.find(v => v.g.p.id === item.esq);
      const vD = item.dir === 'canto' ? null : vs.find(v => v.g.p.id === item.dir);
      if ((item.esq !== 'canto' && !vE) || (item.dir !== 'canto' && !vD)) return null;
      const u0 = vE ? vE.ub : 0, u1 = vD ? vD.ua : W.len;
      return { W, R, vE, vD, u0, u1, valores: { trecho: u1 - u0 }, cotas: [{ a: ptW(W, u0, 0.32), b: ptW(W, u1, 0.32), campo: 'trecho' }] };
    }
    return null;
  }

  /** Identifica o trecho de parede tocado (entre cantos e aberturas). s0/s1 em distância a partir do canto inicial. */
  function segmentoEm(lay, amb, k, s0, s1) {
    const W = lay.pos.get(amb).walls[k], vs = vaosDaParede(lay, amb, k);
    const esq = s0 < 1e-4 ? 'canto' : ((vs.find(v => Math.abs(v.ub - s0) < 1e-4) || {}).g || { p: { id: 'canto' } }).p.id;
    const dir = Math.abs(s1 - W.len) < 1e-4 ? 'canto' : ((vs.find(v => Math.abs(v.ua - s1) < 1e-4) || {}).g || { p: { id: 'canto' } }).p.id;
    return { tipo: 'seg', amb, k, esq, dir };
  }

  // ───────────────────────── SVG ─────────────────────────
  function enquadrar(lay, W, H, ids) {
    const rs = [...lay.pos.entries()].filter(([id]) => !ids || ids.includes(id)).map(e => e[1]).filter(r => r.verts.length);
    if (!rs.length) return { s: 40, ox: W / 2, oy: H / 2 };
    const b = caixa(rs);
    const m = 0.9;
    const bw = Math.max(b.x1 - b.x0, 1) + 2 * m, bh = Math.max(b.y1 - b.y0, 1) + 2 * m;
    const s = Math.max(4, Math.min((W - 24) / bw, (H - 24) / bh, 160));
    return { s, ox: W / 2 - ((b.x0 + b.x1) / 2) * s, oy: H / 2 + ((b.y0 + b.y1) / 2) * s };
  }

  /**
   * Desenha o pavimento. view = { s (px por metro), ox, oy }.
   * o = { sel, item, cotas, mais, destaque: [ids], toque, desenho: idDoAmbienteSendoDesenhado }
   */
  function svg(L, pavId, lay, view, o = {}) {
    const { s, ox, oy } = view;
    const X = x => +(ox + x * s).toFixed(1), Y = y => +(oy - y * s).toFixed(1);
    const P = pt => `${X(pt[0])},${Y(pt[1])}`;
    const ln = (a, b, cls, extra = '') => `<line class="${cls}" x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}"${extra}/>`;
    const ls = linhas(lay);
    const it = o.item;
    let out = '';

    // fundos
    for (const [id, R] of lay.pos) {
      if (R.verts.length < 2) continue;
      const cls = ['pl-fundo', o.sel === id && !it ? 'sel' : '', (o.destaque && o.destaque.includes(id)) || o.desenho === id ? 'dest' : '', o.invalido === id ? 'invalido' : ''].join(' ');
      out += `<polygon class="${cls}" data-amb="${esc(id)}" points="${R.verts.map(P).join(' ')}"/>`;
      if (!R.fechado && R.verts.length > 2) out += ln(R.verts[R.verts.length - 1], R.verts[0], 'pl-fechar');
    }
    // objetos
    for (const ob of lay.objetos) {
      const sel = it && it.tipo === 'obj' && it.id === ob.o.id;
      out += `<g class="pl-obj${sel ? ' sel' : ''}">`;
      for (const pr of ob.prims) {
        if (pr.t === 'l') out += ln(pr.pts[0], pr.pts[1], '');
        else if (pr.t === 'c') out += `<circle cx="${X(pr.cx)}" cy="${Y(pr.cy)}" r="${Math.max(1.5, pr.r * s).toFixed(1)}"/>`;
        else if (pr.t === 't') { if (ob.w * s > 24) out += `<text x="${X(pr.cx)}" y="${Y(pr.cy) + 3}" text-anchor="middle">${esc(pr.txt)}</text>`; }
        else out += `<polygon class="${pr.t === 'pf' ? 'cheio' : pr.t === 'pd' ? 'trac' : ''}" points="${pr.pts.map(P).join(' ')}"/>`;
      }
      if (ob.o.tipo === 'desnivel') out += `<text class="pl-nv" x="${X(ob.centro[0])}" y="${Y(ob.centro[1]) + 4}" text-anchor="middle">NV ${fmtNivel(ob.nivel)}</text>`;
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
        out += `<path class="pl-arco${sel}" d="M${X(pr.de[0])} ${Y(pr.de[1])} A${rr} ${rr} 0 0 ${varre} ${X(pr.ate[0])} ${Y(pr.ate[1])}"/>`;
      } else {
        out += ln(pr.pts[0], pr.pts[1], (pr.t === 'lf' ? 'pl-correr' : pr.t === 'ld' ? 'pl-janela-alta' : 'pl-folha') + sel);
      }
    }
    const info = infoItem(lay, it);
    if (it && it.tipo === 'seg' && info) out += ln(ptW(info.W, info.u0), ptW(info.W, info.u1), 'pl-seg-sel');

    if (o.toque) {
      for (const l of ls.paredes) out += ln([l[0], l[1]], [l[2], l[3]], 'pl-seg-alvo', ` data-seg="${esc(l[4])}|${l[5]}|${l[6]}|${l[7]}"`);
      for (const ob of lay.objetos) out += `<polygon class="pl-alvo" data-obj="${esc(ob.amb)}|${esc(ob.o.id)}" points="${ob.contorno.map(P).join(' ')}"/>`;
      for (const g of lay.portas) {
        const q = [[g.x1, g.y1], [g.x2, g.y2], [g.x2 + g.nx * g.t, g.y2 + g.ny * g.t], [g.x1 + g.nx * g.t, g.y1 + g.ny * g.t]];
        out += `<polygon class="pl-alvo pl-porta-alvo" data-porta="${esc(g.p.id)}" points="${q.map(P).join(' ')}"/>`;
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
    for (const [id, R] of lay.pos) {
      if (!R.fechado) continue;
      const a = R.a, wpx = (R.bbox.x1 - R.bbox.x0) * s, hpx = (R.bbox.y1 - R.bbox.y0) * s;
      if (wpx < 34 || hpx < 22) continue;
      const cx = X(R.centro[0]), cy = Y(R.centro[1]);
      const t = [`<tspan class="pl-cod">${esc(a.codigo || '')}</tspan>`];
      if (a.nome && wpx > 70) t.push(`<tspan x="${cx}" dy="14" class="pl-nome">${esc(cortar(a.nome, Math.floor(wpx / 7)))}</tspan>`);
      if (hpx > 46 && R.area != null) t.push(`<tspan x="${cx}" dy="13" class="pl-area">${fmt(R.area)} m²</tspan>`);
      if (hpx > 60 && R.nivel) t.push(`<tspan x="${cx}" dy="13" class="pl-nv">NV ${fmtNivel(R.nivel)}</tspan>`);
      out += `<text class="pl-txt" x="${cx}" y="${cy - (t.length - 1) * 6.5}" text-anchor="middle">${t.join('')}</text>`;
    }
    // cantos com letras e medidas das paredes (ambiente selecionado ou em desenho)
    const marcar = o.cantos || o.desenho || (!it && o.sel);
    if (marcar && lay.pos.has(marcar)) {
      const R = lay.pos.get(marcar);
      R.verts.forEach((p, i) => {
        const W1 = R.walls[(i - 1 + R.walls.length) % R.walls.length], W2 = R.walls[i];
        let n = [0, 0];
        if (W1 && (R.fechado || i > 0)) n = add(n, W1.nIn);
        if (W2) n = add(n, W2.nIn);
        const L = len(n) || 1, q = add(p, mul(n, 0.28 / L));
        out += `<g class="pl-canto"><circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3"/><text x="${X(q[0])}" y="${Y(q[1]) + 4}" text-anchor="middle">${letra(i)}</text></g>`;
      });
      for (const W of R.walls) {
        if (W.len * s < 28) continue;
        const m = ptW(W, W.len / 2, -0.22);
        out += `<text class="pl-med" x="${X(m[0])}" y="${Y(m[1]) + 4}" text-anchor="middle">${fmt(W.len)}</text>`;
      }
    }
    // cotas
    const cotas = [...(o.cotas || []), ...(info ? info.cotas.map(c => ({ ...c, txt: fmt(info.valores[c.campo]) })) : [])];
    for (const c of cotas) {
      if (!c) continue;
      const x1 = X(c.a[0]), y1 = Y(c.a[1]), x2 = X(c.b[0]), y2 = Y(c.b[1]);
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, px = -dy / L * 5, py = dx / L * 5;
      const tx = (x1 + x2) / 2 + px * 2.4, ty = (y1 + y2) / 2 + py * 2.4 + 4;
      out += `<g class="pl-cota${c.campo ? ' editavel' : ''}"${c.campo ? ` data-cota="${c.campo}"` : ''}><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
        `<line x1="${x1 - px}" y1="${y1 - py}" x2="${x1 + px}" y2="${y1 + py}"/><line x1="${x2 - px}" y1="${y2 - py}" x2="${x2 + px}" y2="${y2 + py}"/>` +
        (c.campo ? `<rect class="pl-cota-alvo" x="${tx - 22}" y="${ty - 15}" width="44" height="20" rx="4"/>` : '') +
        `<text x="${tx}" y="${ty}" text-anchor="middle">${esc(c.txt)}</text></g>`;
    }
    // "+" nas portas sem ambiente do outro lado
    if (o.mais) {
      for (const g of lay.portas) {
        if (g.ambB || g.janela) continue;
        const d = g.t + 0.55;
        const cx = X((g.x1 + g.x2) / 2 + g.nx * d), cy = Y((g.y1 + g.y2) / 2 + g.ny * d);
        out += `<g class="pl-mais" data-mais="${esc(g.p.id)}"><circle cx="${cx}" cy="${cy}" r="17"/><path d="M${cx - 7} ${cy}H${cx + 7}M${cx} ${cy - 7}V${cy + 7}"/></g>`;
      }
    }
    return out;
  }
  const cortar = (s, n) => s.length > n ? s.slice(0, Math.max(3, n - 1)) + '…' : s;

  /** Cota da boneca: do canto até o batente, por dentro do ambiente. lado = 'A' | 'B'. */
  function cotaBoneca(lay, portaId, lado, txt) {
    const g = lay.portas.find(x => x.p.id === portaId);
    if (!g) return null;
    if (lado === 'A') {
      return g.p.canto === 'fim' ? { a: ptW(g.W, g.c + g.w, 0.3), b: ptW(g.W, g.W.len, 0.3), txt } : { a: ptW(g.W, 0, 0.3), b: ptW(g.W, g.c, 0.3), txt };
    }
    if (!g.ligada) return null;
    return { a: ptW(g.WB, 0, 0.3), b: ptW(g.WB, g.cB, 0.3), txt };
  }
  /** Cota da largura da porta, por dentro do ambiente A, em linha com a cota da boneca. */
  function cotaLargura(lay, portaId, txt) {
    const g = lay.portas.find(x => x.p.id === portaId);
    return g ? { a: ptW(g.W, g.c, 0.3), b: ptW(g.W, g.c + g.w, 0.3), txt } : null;
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
        if (ob.o.tipo === 'desnivel') texto('TEXTOS', ob.centro[0] + dx, ob.centro[1], 0.12, `NV ${fmtNivel(ob.nivel)}`);
      }
      for (const pt of lay.pontos) {
        linha('INSTALACOES', pt.px + dx, pt.py, pt.cx + dx, pt.cy);
        circulo('INSTALACOES', pt.cx + dx, pt.cy, 0.1);
        texto('INSTALACOES', pt.cx + dx, pt.cy, 0.07, pt.cod);
      }
      for (const [, R] of lay.pos) {
        if (!R.fechado) continue;
        const a = R.a, cx = R.centro[0] + dx, cy = R.centro[1];
        texto('TEXTOS', cx, cy + 0.25, 0.2, a.codigo || '');
        if (a.nome) texto('TEXTOS', cx, cy, 0.15, a.nome);
        if (R.area != null) texto('TEXTOS', cx, cy - 0.25, 0.12, `${fmt(R.area)} m2`);
        if (R.nivel) texto('TEXTOS', cx, cy - 0.45, 0.12, `NV ${fmtNivel(R.nivel)}`);
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

  // ───────────────────────── Posição própria e ímã ─────────────────────────
  /**
   * Desde a v1.2 cada ambiente guarda a própria posição (pos, rot). Ambientes que ainda dependiam de
   * uma porta (ancora) ou sem posição recebem a posição em que estão desenhados agora, e as portas
   * deixam de guardar o outro lado (ele é reconhecido pela parede encostada).
   * Ambientes em desenho a partir de uma porta ficam como estão até fechar.
   */
  function fixarPosicoes(L) {
    let mudou = false;
    for (const pav of L.pavimentos || []) {
      const lay = layout(L, pav.id);
      for (const a of L.ambientes) {
        if (a.pavimentoId !== pav.id || a.desenhando) continue;
        const R = lay.pos.get(a.id);
        if (!R) continue;
        if (a.ancora || !a.pos || num(a.pos.x) == null) {
          a.pos = { x: Math.round(R.t[0] * 1000) / 1000, y: Math.round(R.t[1] * 1000) / 1000 };
          a.rot = String(Math.round(R.rot / RAD * 100) / 100);
          mudou = true;
        }
      }
    }
    const desenhando = new Set((L.ambientes || []).filter(a => a.desenhando).map(a => a.ancora));
    for (const a of L.ambientes || []) if (!a.desenhando && a.ancora) { delete a.ancora; mudou = true; }
    for (const p of L.portas || []) {
      if (desenhando.has(p.id)) continue;
      for (const k of ['ambB', 'paredeB', 'bonecaB', 'cantoB']) if (k in p) { delete p[k]; mudou = true; }
    }
    return mudou;
  }

  /**
   * Ímã: recebe a posição pretendida (r em radianos, t) do ambiente a e devolve a posição encaixada.
   * 1) a parede dele mais próxima de uma parede de outro ambiente (quase paralela, de frente) gira
   *    para ficar exatamente paralela e encosta, deixando a espessura de parede entre as duas;
   * 2) ao longo dessa parede, encosta numa segunda parede (para entrar num canto) ou alinha as quinas.
   * lim: até que distância (m) o ímã puxa. Devolve { r, t, encostou }.
   */
  function imantar(lay, a, r, t, esp, lim) {
    const outras = [...lay.pos.values()].filter(o => o.id !== a.id && o.fechado).flatMap(o => o.walls);
    const frente = (W, W2) => {
      const ang = Math.acos(Math.max(-1, Math.min(1, -dot(W.nOut, W2.nOut))));   // 0 = de frente
      const meio = mul(add(W.a, W.b), 0.5);
      const dist = dot(sub(meio, W2.a), W2.nOut);
      const s0 = dot(sub(W.a, W2.a), W2.d), s1 = dot(sub(W.b, W2.a), W2.d);
      const sobre = Math.min(Math.max(s0, s1), W2.len) - Math.max(Math.min(s0, s1), 0);
      return { ang, dist, sobre };
    };
    let R = colocar(a, r, t);
    let melhor = null;
    for (const W of R.walls) for (const W2 of outras) {
      const e = frente(W, W2);
      if (e.ang > 15 * RAD || Math.abs(e.dist - esp) > lim || e.sobre < 0.05) continue;
      const nota = Math.abs(e.dist - esp) + e.ang * 1.5;
      if (!melhor || nota < melhor.nota) melhor = { k: W.k, W2, nota };
    }
    if (!melhor) return { r, t, encostou: false };
    const { k, W2 } = melhor;
    // gira em torno do meio da parede, até ficar de frente para a outra
    const W = R.walls[k], meio = mul(add(W.a, W.b), 0.5), meioLocal = rotv(sub(meio, t), -r);
    r += Math.atan2(-W2.nOut[1], -W2.nOut[0]) - Math.atan2(W.nOut[1], W.nOut[0]);
    t = sub(meio, rotv(meioLocal, r));
    R = colocar(a, r, t);
    t = add(t, mul(W2.nOut, esp - dot(sub(R.walls[k].a, W2.a), W2.nOut)));
    R = colocar(a, r, t);
    // ao longo da parede encostada: segunda parede de frente ou quinas alinhadas
    const eixo = W2.d;
    let desl = null;
    for (const V of R.walls) {
      if (V.k === k || Math.abs(dot(V.d, eixo)) > 0.2) continue;
      for (const V2 of outras) {
        if (V2 === W2) continue;
        const e = frente(V, V2), kk = dot(eixo, V2.nOut);
        if (e.ang > 3 * RAD || Math.abs(kk) < 0.5) continue;
        const d = (esp - e.dist) / kk;
        if (Math.abs(d) > lim) continue;
        // depois de andar d, as duas precisam ficar uma de frente para a outra
        const s0 = dot(sub(add(V.a, mul(eixo, d)), V2.a), V2.d), s1 = dot(sub(add(V.b, mul(eixo, d)), V2.a), V2.d);
        if (Math.min(Math.max(s0, s1), V2.len) - Math.max(Math.min(s0, s1), 0) < 0.05) continue;
        if (desl == null || Math.abs(d) < Math.abs(desl)) desl = d;
      }
    }
    if (desl == null) {
      const Wk = R.walls[k];
      for (const sv of [dot(sub(Wk.a, W2.a), eixo), dot(sub(Wk.b, W2.a), eixo)]) {
        for (const alvo of [0, W2.len]) {
          const d = alvo - sv;
          if (Math.abs(d) <= lim && (desl == null || Math.abs(d) < Math.abs(desl))) desl = d;
        }
      }
    }
    if (desl != null) t = add(t, mul(eixo, desl));
    return { r: Math.atan2(Math.sin(r), Math.cos(r)), t, encostou: true };
  }

  /** O ambiente (na posição R) fica por cima de algum outro do pavimento? Devolve o id do primeiro. */
  function bateEm(lay, R) {
    for (const [id, o] of lay.pos) if (id !== R.id && sobrepoe(R, o)) return id;
    return null;
  }

  // ───────────────────────── Conversão de dados antigos ─────────────────────────
  /**
   * Até a v1.2 as paredes eram 'baixo', 'dir', 'cima', 'esq' e as distâncias eram medidas a partir
   * do canto esquerdo ou de baixo. Agora são índices (A–B = 0, B–C = 1, C–D = 2, D–A = 3) e as
   * distâncias partem do canto inicial de cada parede, que nas paredes de cima e da esquerda é o
   * canto oposto. Converte portas, pontos e objetos. Devolve true se mudou algo.
   */
  const INDICE = { baixo: 0, dir: 1, cima: 2, esq: 3 };
  const INVERTE = { cima: true, esq: true };
  const OPOSTA_NOME = { cima: 'baixo', baixo: 'cima', esq: 'dir', dir: 'esq' };
  function converterAntigo(L) {
    let mudou = false;
    const troca = c => c === 'fim' ? 'ini' : 'fim';
    for (const p of L.portas || []) {
      if (typeof p.parede === 'string' && p.parede in INDICE) {
        const f = p.parede, fB = OPOSTA_NOME[f];
        p.parede = INDICE[f];
        if (INVERTE[f]) p.canto = troca(p.canto);
        if (p.paredeB == null || p.paredeB === '') { p.paredeB = INDICE[fB]; if (INVERTE[fB]) p.cantoB = troca(p.cantoB); }
        // na parede de cima/esquerda o sentido inverteu: dobradiça e sentido de correr trocam de lado
        if (INVERTE[f]) p.lado = troca(p.lado);
        mudou = true;
      }
    }
    for (const a of L.ambientes || []) {
      for (const i of a.inst || []) {
        if (typeof i.parede === 'string' && i.parede in INDICE) {
          const f = i.parede, dx = num(a.comp) || 0, dy = num(a.larg) || 0, lenW = f === 'baixo' || f === 'cima' ? dx : dy;
          i.parede = INDICE[f];
          if (INVERTE[f] && num(i.pos) != null) i.pos = String(Math.round((lenW - num(i.pos)) * 100) / 100).replace('.', ',');
          mudou = true;
        }
      }
      for (const o of a.objetos || []) {
        if (o.cx == null && o.x != null) {
          const b = BIBLIOTECA[o.tipo] || { w: 1, d: 1 };
          const w = num(o.w) || b.w, d = num(o.d) || b.d, r = ((+o.rot || 0) % 360 + 360) % 360;
          const bw = r % 180 ? d : w, bh = r % 180 ? w : d;
          o.cx = Math.round(((num(o.x) || 0) + bw / 2) * 1000) / 1000;
          o.cy = Math.round(((num(o.y) || 0) + bh / 2) * 1000) / 1000;
          delete o.x; delete o.y;
          mudou = true;
        }
      }
    }
    return mudou;
  }

  raiz.Planta = {
    layout, linhas, conferir, enquadrar, svg, cotaBoneca, cotaLargura, infoItem, segmentoEm, vaosDaParede, dxf, caixa, iconeObjeto,
    formaLocal, areaPerimetro, converterAntigo, letra, ptW, paredesDe, sobrepoe, colocar, fixarPosicoes, imantar, bateEm,
    ESPESSURA_PADRAO, PD_PADRAO, MODELOS, PADRAO_ABERTURA, PONTOS, BIBLIOTECA, ehJanela, canon, fmtNivel, nivelDe, pdDe, RAD,
  };
})(typeof window !== 'undefined' ? window : globalThis);
