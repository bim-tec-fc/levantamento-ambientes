/* ═══════════════════════════════════════════════════════════════════════════
   vista3d.js: maquete 3D simples da planta (SVG, projeção axonométrica).
   Núcleo BIM · Ferreira Costa · Melqui Domingos

   Monta paredes (com a espessura padrão para fora de cada ambiente), vãos de
   portas e janelas com verga e peitoril, pisos no nível de cada ambiente e os
   objetos como caixas. O desenho ordena as faces da mais distante para a mais
   próxima (algoritmo do pintor) e descarta as que estão de costas.
   Usa as alturas que o levantamento já guarda: pé-direito, nível do piso,
   altura e peitoril das aberturas e altura dos objetos.
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
  const ESP = 0.15;

  /** Caixa alinhada aos eixos: faces com normal para fora (sem a de baixo). */
  function caixa(x0, y0, x1, y1, z0, z1, tipo) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return [];
    return [
      { tipo, n: [0, 0, 1], p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
      { tipo, n: [0, -1, 0], p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
      { tipo, n: [0, 1, 0], p: [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]] },
      { tipo, n: [-1, 0, 0], p: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]] },
      { tipo, n: [1, 0, 0], p: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    ];
  }
  const caixaPor = (a, b, z0, z1, tipo) => caixa(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), z0, z1, tipo);

  /** corte: se informado, as paredes param nessa altura acima do piso (para ver o interior). */
  function montar(L, pavId, corte) {
    const P = raiz.Planta;
    const lay = P.layout(L, pavId);
    const faces = [];
    const nv = id => lay.pos.get(id).nivel, pd = id => Math.min(lay.pos.get(id).pd, corte || Infinity);

    for (const [id, r] of lay.pos) {
      // piso
      faces.push({ tipo: 'piso', n: [0, 0, 1], p: [[r.x, r.y, r.nivel], [r.x + r.dx, r.y, r.nivel], [r.x + r.dx, r.y + r.dy, r.nivel], [r.x, r.y + r.dy, r.nivel]] });
      // paredes: cada face recortada por todas as aberturas (inclusive janela alta)
      for (const f of ['baixo', 'cima', 'esq', 'dir']) {
        const F = P.face(r, f);
        const fora = [-F.ix, -F.iy];
        const vaos = lay.portas.filter(g => (g.p.ambA === id && g.p.parede === f) || (g.ligada && g.p.ambB === id && P.OPOSTA[g.p.parede] === f))
          .map(g => [Math.min(g.ua, g.ub), Math.max(g.ua, g.ub)]).sort((a, b) => a[0] - b[0]);
        let u = F.u0;
        const parede = (a, b) => {
          if (b - a < 1e-4) return;
          // trechos curtos: a ordenação por profundidade erra menos com faces pequenas
          const n = Math.max(1, Math.ceil((b - a) / 0.6));
          for (let k = 0; k < n; k++) {
            const p1 = F.pt(a + (b - a) * k / n), p2 = F.pt(a + (b - a) * (k + 1) / n);
            faces.push(...caixaPor(p1, [p2[0] + fora[0] * ESP, p2[1] + fora[1] * ESP], r.nivel, r.nivel + pd(id), 'parede'));
          }
        };
        for (const [a, b] of vaos) { parede(u, Math.min(a, F.u1)); u = Math.max(u, b); }
        parede(u, F.u1);
      }
    }
    // vergas, peitoris e vidros
    for (const g of lay.portas) {
      const z0 = nv(g.p.ambA), topo = z0 + pd(g.p.ambA);
      const a = [g.x1, g.y1], b = [g.x2 + g.nx * g.t, g.y2 + g.ny * g.t];
      if (g.janela) {
        const pad = P.PADRAO_ABERTURA[g.p.modelo];
        const peit = num(g.p.peitoril) ?? num(pad[2]), alt = num(g.p.altura) ?? num(pad[1]);
        faces.push(...caixaPor(a, b, z0, Math.min(z0 + peit, topo), 'parede'));
        faces.push(...caixaPor(a, b, z0 + peit + alt, topo, 'parede'));
        const m1 = [g.x1 + g.nx * g.t * 0.48, g.y1 + g.ny * g.t * 0.48], m2 = [g.x2 + g.nx * g.t * 0.52, g.y2 + g.ny * g.t * 0.52];
        faces.push(...caixaPor(m1, m2, z0 + peit, Math.min(z0 + peit + alt, topo), 'vidro'));
      } else {
        const alt = num(g.p.altura) ?? 2.1;
        faces.push(...caixaPor(a, b, z0 + alt, topo, 'parede'));
      }
    }
    // objetos
    for (const o of lay.objetos) {
      const z0 = nv(o.amb);
      if (o.o.tipo === 'desnivel') {
        if (o.nivel > z0) faces.push(...caixa(o.x0, o.y0, o.x0 + o.bw, o.y0 + o.bh, z0, o.nivel, 'patamar'));
        else faces.push({ tipo: 'patamar', n: [0, 0, 1], p: [[o.x0, o.y0, o.nivel + 0.001], [o.x0 + o.bw, o.y0, o.nivel + 0.001], [o.x0 + o.bw, o.y0 + o.bh, o.nivel + 0.001], [o.x0, o.y0 + o.bh, o.nivel + 0.001]] });
      } else if (o.h > 0) {
        const h = o.o.tipo === 'pilar' ? pd(o.amb) : o.h;
        faces.push(...caixa(o.x0, o.y0, o.x0 + o.bw, o.y0 + o.bh, z0, z0 + h, o.o.tipo === 'pilar' ? 'parede' : 'obj'));
      }
    }
    return { faces, lay };
  }

  // ── projeção ──
  function projetor(v) {
    const ca = Math.cos(v.az), sa = Math.sin(v.az), ce = Math.cos(v.el), se = Math.sin(v.el);
    return {
      tela(p) {
        const x = p[0] * ca - p[1] * sa, y = p[0] * sa + p[1] * ca;
        return [x, y * se + p[2] * ce, y * ce - p[2] * se];   // [x na tela, y para cima, profundidade]
      },
      visivel(n) {
        const ny = n[0] * sa + n[1] * ca;
        return -ny * ce + n[2] * se > 1e-6;
      },
      luz(n) { return n[2] > 0.5 ? 'topo' : (n[0] * -0.55 + n[1] * -0.83 > 0 ? 'claro' : 'escuro'); },
    };
  }

  /** Centro do modelo (no espaço), para girar em torno dele. */
  function centro(modelo) {
    if (modelo._c) return modelo._c;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const f of modelo.faces) for (const p of f.p) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    return (modelo._c = isFinite(lo[0]) ? lo.map((v, k) => (v + hi[k]) / 2) : [0, 0, 0]);
  }
  /** Mantém o centro do modelo no meio da tela, com a escala atual. */
  function centrar(modelo, v, W, H) {
    const [x, y] = projetor(v).tela(centro(modelo));
    return { ...v, ox: W / 2 - x * v.s, oy: H / 2 + y * v.s };
  }
  /** Escala para caber na tela, centralizado. */
  function enquadrar(modelo, v, W, H) {
    const pr = projetor(v);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const f of modelo.faces) for (const p of f.p) {
      const [x, y] = pr.tela(p);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (!isFinite(x0)) return { ...v, s: 40, ox: W / 2, oy: H / 2 };
    const s = Math.min((W - 40) / Math.max(x1 - x0, 1), (H - 40) / Math.max(y1 - y0, 1), 200);
    return centrar(modelo, { ...v, s }, W, H);
  }

  function svg(modelo, v) {
    const pr = projetor(v);
    const lista = [];
    for (const f of modelo.faces) {
      if (!pr.visivel(f.n)) continue;
      const pts = f.p.map(p => pr.tela(p));
      const prof = pts.reduce((s, p) => s + p[2], 0) / pts.length;
      lista.push({ f, pts, prof });
    }
    // pisos primeiro (estão por baixo de tudo); o resto do mais distante para o mais próximo
    lista.sort((a, b) => (b.f.tipo === 'piso') - (a.f.tipo === 'piso') || b.prof - a.prof);
    return lista.map(({ f, pts }) => `<polygon class="d3-${f.tipo} d3-${pr.luz(f.n)}" points="${pts.map(p => `${(v.ox + p[0] * v.s).toFixed(1)},${(v.oy - p[1] * v.s).toFixed(1)}`).join(' ')}"/>`).join('');
  }

  raiz.Vista3D = { montar, enquadrar, centrar, svg };
})(typeof window !== 'undefined' ? window : globalThis);
