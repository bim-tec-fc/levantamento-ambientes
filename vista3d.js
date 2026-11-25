/* ═══════════════════════════════════════════════════════════════════════════
   vista3d.js: maquete 3D simples da planta (SVG, projeção axonométrica).
   Núcleo BIM · Ferreira Costa · Melqui Domingos

   Monta paredes (com a espessura padrão para fora de cada ambiente, em qualquer
   ângulo), vãos de portas e janelas com verga e peitoril, pisos no nível de
   cada ambiente e os objetos como blocos. O desenho ordena as faces da mais
   distante para a mais próxima (algoritmo do pintor) e descarta as que estão de
   costas. Usa as alturas que o levantamento já guarda: pé-direito, nível do
   piso, altura e peitoril das aberturas e altura dos objetos.
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

  /**
   * Bloco vertical sobre uma base de pontos (no plano), de z0 a z1.
   * Faces com normal para fora (a de baixo não é desenhada).
   */
  function bloco(base, z0, z1, tipo) {
    if (z1 - z0 < 1e-4) return [];
    let ar = 0;
    base.forEach((p, i) => { const q = base[(i + 1) % base.length]; ar += p[0] * q[1] - q[0] * p[1]; });
    if (Math.abs(ar) < 1e-8) return [];
    const b = ar > 0 ? base : [...base].reverse();   // anti-horário
    const faces = [{ tipo, n: [0, 0, 1], p: b.map(p => [p[0], p[1], z1]) }];
    b.forEach((p, i) => {
      const q = b[(i + 1) % b.length], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
      if (L < 1e-6) return;
      faces.push({ tipo, n: [dy / L, -dx / L, 0], p: [[p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]] });
    });
    return faces;
  }

  /** corte: se informado, as paredes param nessa altura acima do piso (para ver o interior). */
  function montar(L, pavId, corte) {
    const P = raiz.Planta;
    const lay = P.layout(L, pavId);
    const faces = [];
    const pdc = R => Math.min(R.pd, corte || Infinity);

    for (const [id, R] of lay.pos) {
      if (R.fechado) faces.push({ tipo: 'piso', n: [0, 0, 1], p: R.verts.map(v => [v[0], v[1], R.nivel]) });
      for (const W of R.walls) {
        // trechos de parede entre as aberturas (inclusive a janela alta, que no 3D é vão)
        const vaos = P.vaosDaParede(lay, id, W.k, true);
        let s = 0;
        const parede = (a, b) => {
          if (b - a < 1e-4) return;
          const n = Math.max(1, Math.ceil((b - a) / 0.6));   // trechos curtos: a ordenação erra menos
          for (let k = 0; k < n; k++) {
            const s0 = a + (b - a) * k / n, s1 = a + (b - a) * (k + 1) / n;
            faces.push(...bloco([P.ptW(W, s0), P.ptW(W, s1), P.ptW(W, s1, -ESP), P.ptW(W, s0, -ESP)], R.nivel, R.nivel + pdc(R), 'parede'));
          }
        };
        for (const v of vaos) { parede(s, Math.min(v.ua, W.len)); s = Math.max(s, v.ub); }
        parede(s, W.len);
      }
    }
    // vergas, peitoris e vidros
    for (const g of lay.portas) {
      const R = lay.pos.get(g.p.ambA), z0 = R.nivel, topo = z0 + pdc(R);
      const P1 = [g.x1, g.y1], P2 = [g.x2, g.y2], n = [g.nx * g.t, g.ny * g.t];
      const m = k => [P1[0] + n[0] * k, P1[1] + n[1] * k], q = k => [P2[0] + n[0] * k, P2[1] + n[1] * k];
      const base = [m(0), q(0), q(1), m(1)];
      if (g.janela) {
        const pad = P.PADRAO_ABERTURA[g.p.modelo];
        const peit = num(g.p.peitoril) ?? num(pad[2]), alt = num(g.p.altura) ?? num(pad[1]);
        faces.push(...bloco(base, z0, Math.min(z0 + peit, topo), 'parede'));
        faces.push(...bloco(base, z0 + peit + alt, topo, 'parede'));
        faces.push(...bloco([m(0.46), q(0.46), q(0.54), m(0.54)], z0 + peit, Math.min(z0 + peit + alt, topo), 'vidro'));
      } else {
        faces.push(...bloco(base, z0 + (num(g.p.altura) ?? 2.1), topo, 'parede'));
      }
    }
    // objetos
    for (const o of lay.objetos) {
      const R = lay.pos.get(o.amb), z0 = R.nivel;
      if (o.o.tipo === 'desnivel') {
        if (o.nivel > z0) faces.push(...bloco(o.contorno, z0, o.nivel, 'patamar'));
        else faces.push({ tipo: 'patamar', n: [0, 0, 1], p: o.contorno.map(v => [v[0], v[1], o.nivel + 0.001]) });
      } else {
        const h = o.o.tipo === 'pilar' ? pdc(R) : o.h;
        if (h > 0) faces.push(...bloco(o.contorno, z0, z0 + h, o.o.tipo === 'pilar' ? 'parede' : 'obj'));
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
      lista.push({ f, pts, prof: pts.reduce((s, p) => s + p[2], 0) / pts.length });
    }
    // pisos primeiro (estão por baixo de tudo); o resto do mais distante para o mais próximo
    lista.sort((a, b) => (b.f.tipo === 'piso') - (a.f.tipo === 'piso') || b.prof - a.prof);
    return lista.map(({ f, pts }) => `<polygon class="d3-${f.tipo} d3-${pr.luz(f.n)}" points="${pts.map(p => `${(v.ox + p[0] * v.s).toFixed(1)},${(v.oy - p[1] * v.s).toFixed(1)}`).join(' ')}"/>`).join('');
  }

  raiz.Vista3D = { montar, enquadrar, centrar, svg };
})(typeof window !== 'undefined' ? window : globalThis);
