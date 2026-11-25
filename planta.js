/* ═══════════════════════════════════════════════════════════════════════════
   planta.js: geometria, desenho (SVG) e exportação DXF da planta baixa.
   Núcleo BIM · Ferreira Costa · Melqui Domingos

   Como a planta se monta
   ─────────────────────
   Cada ambiente é um retângulo com medidas internas: comp (↔, eixo X) e
   larg (↕, eixo Y). O primeiro ambiente do pavimento fica na origem.
   Os outros são posicionados pela PORTA que os liga a um ambiente já desenhado:

     porta = { ambA, parede, largura, boneca, canto, espessura,
               ambB, bonecaB, cantoB }

   - parede: em qual parede do ambiente A está a porta (cima, baixo, esq, dir),
     do jeito que aparece na tela.
   - boneca: distância do canto até o batente, medida dentro de A.
     canto 'ini' = canto esquerdo (paredes de cima/baixo) ou de baixo
     (paredes da esquerda/direita); 'fim' = o canto oposto.
   - espessura: espessura da parede, medida no vão da porta.
   - bonecaB / cantoB: a mesma coisa, medida dentro do ambiente B.

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

  const OPOSTA = { cima: 'baixo', baixo: 'cima', esq: 'dir', dir: 'esq' };
  const HORIZ = p => p === 'cima' || p === 'baixo';
  const ESPESSURA_PADRAO = 0.15;

  const dims = a => ({ dx: num(a.comp) || 0, dy: num(a.larg) || 0 });
  /** Distância do início da parede (esquerda ou baixo) até o batente. */
  const canon = (len, b, w, canto) => canto === 'fim' ? len - b - w : b;

  // ───────────────────────── Posições ─────────────────────────
  function layout(L, pavId) {
    const ambs = L.ambientes.filter(a => a.pavimentoId === pavId).sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
    const porId = new Map(ambs.map(a => [a.id, a]));
    const portas = (L.portas || []).filter(p => porId.has(p.ambA));
    const pos = new Map();
    const ligadaPor = new Map();   // ambB → porta que o posiciona
    const raizes = ambs.filter(a => !portas.some(p => p.id === a.ancora && p.ambB === a.id));
    let cursor = 0;

    for (const r of raizes) {
      if (pos.has(r.id)) continue;
      const d = dims(r);
      pos.set(r.id, { x: cursor, y: 0, ...d });
      const fila = [r.id];
      while (fila.length) {
        const id = fila.shift();
        const A = pos.get(id);
        for (const p of portas) {
          if (p.ambA !== id || !p.ambB || pos.has(p.ambB)) continue;
          const B = porId.get(p.ambB);
          if (!B || B.ancora !== p.id) continue;
          const bd = dims(B);
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
      return { p, x1, y1, x2, y2, nx, ny, t, w, c, len, ligada, fora: c < -0.005 || c + w > len + 0.005, foraB };
    });
    return { pos, portas: geo };
  }

  function caixa(rs) {
    if (!rs.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    return {
      x0: Math.min(...rs.map(r => r.x)), y0: Math.min(...rs.map(r => r.y)),
      x1: Math.max(...rs.map(r => r.x + r.dx)), y1: Math.max(...rs.map(r => r.y + r.dy)),
    };
  }

  // ───────────────────────── Linhas do desenho ─────────────────────────
  /** Paredes com os vãos das portas recortados, batentes e folhas. Tudo em metros. */
  function linhas(lay) {
    const cortes = new Map();
    const corta = (amb, face, u1, u2) => {
      const k = amb + '|' + face;
      if (!cortes.has(k)) cortes.set(k, []);
      cortes.get(k).push([Math.min(u1, u2), Math.max(u1, u2)]);
    };
    for (const g of lay.portas) {
      const h = HORIZ(g.p.parede);
      corta(g.p.ambA, g.p.parede, h ? g.x1 : g.y1, h ? g.x2 : g.y2);
      if (g.ligada) corta(g.p.ambB, OPOSTA[g.p.parede], h ? g.x1 : g.y1, h ? g.x2 : g.y2);
    }
    const paredes = [];
    for (const [id, r] of lay.pos) {
      const faces = {
        baixo: [r.x, r.x + r.dx, u => [u, r.y]],
        cima: [r.x, r.x + r.dx, u => [u, r.y + r.dy]],
        esq: [r.y, r.y + r.dy, u => [r.x, u]],
        dir: [r.y, r.y + r.dy, u => [r.x + r.dx, u]],
      };
      for (const [face, [i0, i1, pt]] of Object.entries(faces)) {
        const cs = (cortes.get(id + '|' + face) || []).sort((a, b) => a[0] - b[0]);
        let u = i0;
        for (const [c0, c1] of cs) {
          if (c0 > u) paredes.push([...pt(u), ...pt(Math.min(c0, i1))]);
          u = Math.max(u, c1);
        }
        if (u < i1) paredes.push([...pt(u), ...pt(i1)]);
      }
    }
    const batentes = [], folhas = [];
    for (const g of lay.portas) {
      batentes.push([g.x1, g.y1, g.x1 + g.nx * g.t, g.y1 + g.ny * g.t]);
      batentes.push([g.x2, g.y2, g.x2 + g.nx * g.t, g.y2 + g.ny * g.t]);
      if (g.p.tipo !== 'vao' && g.w > 0) {
        // folha abre para dentro do ambiente A, dobradiça no início da parede
        folhas.push({ cx: g.x1, cy: g.y1, ex: g.x1 - g.nx * g.w, ey: g.y1 - g.ny * g.w, fx: g.x2, fy: g.y2, r: g.w });
      }
    }
    return { paredes, batentes, folhas };
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
      if (g.fora) av.push(`A porta de ${cod(g.p.ambA)} não cabe na parede (${fmt(g.len)} m). Confira a boneca e a largura.`);
      if (g.foraB) av.push(`A porta entre ${cod(g.p.ambA)} e ${cod(g.p.ambB)} não cabe na parede de ${cod(g.p.ambB)}. Confira a boneca medida lá.`);
    }
    for (const [id, r] of lay.pos) if (!(r.dx > 0 && r.dy > 0)) av.push(`${cod(id)} está sem medidas.`);
    return av;
  }

  // ───────────────────────── SVG ─────────────────────────
  function enquadrar(lay, W, H, ids) {
    const rs = [...lay.pos.entries()].filter(([id]) => !ids || ids.includes(id)).map(e => e[1]).filter(r => r.dx > 0 && r.dy > 0);
    if (!rs.length) return { s: 40, ox: W / 2, oy: H / 2 };
    const b = caixa(rs);
    const m = 0.9;   // folga para o botão "+" e as cotas
    const bw = b.x1 - b.x0 + 2 * m, bh = b.y1 - b.y0 + 2 * m;
    const s = Math.max(4, Math.min((W - 24) / bw, (H - 24) / bh, 160));
    return { s, ox: W / 2 - ((b.x0 + b.x1) / 2) * s, oy: H / 2 + ((b.y0 + b.y1) / 2) * s };
  }

  /**
   * Desenha o pavimento. view = { s (px por metro), ox, oy }.
   * o = { sel, cotas: [{x1,y1,x2,y2,txt}], mais: true (mostra "+" nas portas soltas), destaque: [ids] }
   */
  function svg(L, pavId, lay, view, o = {}) {
    const { s, ox, oy } = view;
    const X = x => +(ox + x * s).toFixed(1), Y = y => +(oy - y * s).toFixed(1);
    const ln = (l, cls) => `<line class="${cls}" x1="${X(l[0])}" y1="${Y(l[1])}" x2="${X(l[2])}" y2="${Y(l[3])}"/>`;
    const ls = linhas(lay);
    const amb = id => L.ambientes.find(a => a.id === id) || {};
    let out = '';

    for (const [id, r] of lay.pos) {
      const cls = ['pl-fundo', o.sel === id ? 'sel' : '', o.destaque && o.destaque.includes(id) ? 'dest' : ''].join(' ');
      out += `<rect class="${cls}" data-amb="${esc(id)}" x="${X(r.x)}" y="${Y(r.y + r.dy)}" width="${+(r.dx * s).toFixed(1)}" height="${+(r.dy * s).toFixed(1)}"/>`;
    }
    out += ls.paredes.map(l => ln(l, 'pl-parede')).join('');
    out += ls.batentes.map(l => ln(l, 'pl-batente')).join('');
    for (const f of ls.folhas) {
      const ux = X(f.ex) - X(f.cx), uy = Y(f.ey) - Y(f.cy), vx = X(f.fx) - X(f.cx), vy = Y(f.fy) - Y(f.cy);
      const varre = ux * vy - uy * vx > 0 ? 1 : 0;
      out += `<line class="pl-folha" x1="${X(f.cx)}" y1="${Y(f.cy)}" x2="${X(f.ex)}" y2="${Y(f.ey)}"/>`;
      out += `<path class="pl-arco" d="M${X(f.ex)} ${Y(f.ey)} A${+(f.r * s).toFixed(1)} ${+(f.r * s).toFixed(1)} 0 0 ${varre} ${X(f.fx)} ${Y(f.fy)}"/>`;
    }
    // área de toque das portas
    for (const g of lay.portas) {
      const xs = [g.x1, g.x2, g.x1 + g.nx * g.t], ys = [g.y1, g.y2, g.y1 + g.ny * g.t];
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const pad = 10;
      out += `<rect class="pl-porta-alvo" data-porta="${esc(g.p.id)}" x="${X(x0) - pad}" y="${Y(y1) - pad}" width="${(x1 - x0) * s + 2 * pad}" height="${(y1 - y0) * s + 2 * pad}"/>`;
    }
    // textos
    for (const [id, r] of lay.pos) {
      const a = amb(id), wpx = r.dx * s, hpx = r.dy * s;
      if (wpx < 34 || hpx < 22) continue;
      const cx = X(r.x + r.dx / 2), cy = Y(r.y + r.dy / 2);
      const area = r.dx * r.dy;
      const nome = a.nome && wpx > 70 ? `<tspan x="${cx}" dy="14" class="pl-nome">${esc(cortar(a.nome, Math.floor(wpx / 7)))}</tspan>` : '';
      const ar = hpx > 46 ? `<tspan x="${cx}" dy="13" class="pl-area">${fmt(area)} m²</tspan>` : '';
      out += `<text class="pl-txt" x="${cx}" y="${cy - (nome ? 8 : 0) - (ar ? 6 : 0)}" text-anchor="middle"><tspan class="pl-cod">${esc(a.codigo || '')}</tspan>${nome}${ar}</text>`;
    }
    // medidas do ambiente selecionado
    if (o.sel && lay.pos.has(o.sel)) {
      const r = lay.pos.get(o.sel);
      out += `<text class="pl-med" x="${X(r.x + r.dx / 2)}" y="${Y(r.y) + 15}" text-anchor="middle">${fmt(r.dx)}</text>`;
      out += `<text class="pl-med" x="${X(r.x) - 6}" y="${Y(r.y + r.dy / 2) + 4}" text-anchor="end">${fmt(r.dy)}</text>`;
    }
    // cotas (pré-visualização dos formulários)
    for (const c of o.cotas || []) {
      const x1 = X(c.x1), y1 = Y(c.y1), x2 = X(c.x2), y2 = Y(c.y2);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, px = -dy / len * 5, py = dx / len * 5;
      out += `<g class="pl-cota"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
        `<line x1="${x1 - px}" y1="${y1 - py}" x2="${x1 + px}" y2="${y1 + py}"/><line x1="${x2 - px}" y1="${y2 - py}" x2="${x2 + px}" y2="${y2 + py}"/>` +
        `<text x="${(x1 + x2) / 2 + px * 2.4}" y="${(y1 + y2) / 2 + py * 2.4 + 4}" text-anchor="middle">${esc(c.txt)}</text></g>`;
    }
    // "+" nas portas sem ambiente do outro lado
    if (o.mais) {
      for (const g of lay.portas) {
        if (g.p.ambB) continue;
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
    const h = HORIZ(g.p.parede);
    const id = lado === 'A' ? g.p.ambA : g.p.ambB;
    const r = lay.pos.get(id);
    if (!r) return null;
    const canto = lado === 'A' ? g.p.canto : g.p.cantoB;
    const dentro = lado === 'A' ? -1 : 1;                     // sentido para dentro do ambiente
    const off = 0.3;
    const face = lado === 'A' ? 0 : g.t;                      // B fica do outro lado da parede
    const bx = g.x1 + g.nx * (face + dentro * off), by = g.y1 + g.ny * (face + dentro * off);
    if (h) {
      const ini = canto === 'fim' ? r.x + r.dx : r.x, bat = canto === 'fim' ? g.x2 : g.x1;
      return { x1: ini, y1: by, x2: bat, y2: by, txt };
    }
    const ini = canto === 'fim' ? r.y + r.dy : r.y, bat = canto === 'fim' ? g.y2 : g.y1;
    return { x1: bx, y1: ini, x2: bx, y2: bat, txt };
  }

  /** Cota da largura da porta, por dentro do ambiente A, em linha com a cota da boneca. */
  function cotaLargura(lay, portaId, txt) {
    const g = lay.portas.find(x => x.p.id === portaId);
    if (!g) return null;
    const d = -0.3;
    return { x1: g.x1 + g.nx * d, y1: g.y1 + g.ny * d, x2: g.x2 + g.nx * d, y2: g.y2 + g.ny * d, txt };
  }

  // ───────────────────────── DXF (R12, metros) ─────────────────────────
  const dxfTxt = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7E]/g, c => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  const f4 = n => (Math.round(n * 10000) / 10000).toString();

  /** Todos os pavimentos lado a lado (10 m de folga), cada um com o nome em cima. */
  function dxf(L) {
    const ent = [];
    const linha = (camada, x1, y1, x2, y2) => ent.push(`0\nLINE\n8\n${camada}\n10\n${f4(x1)}\n20\n${f4(y1)}\n30\n0\n11\n${f4(x2)}\n21\n${f4(y2)}\n31\n0`);
    const arco = (camada, cx, cy, r, a1, a2) => ent.push(`0\nARC\n8\n${camada}\n10\n${f4(cx)}\n20\n${f4(cy)}\n30\n0\n40\n${f4(r)}\n50\n${f4(a1)}\n51\n${f4(a2)}`);
    const texto = (camada, x, y, alt, t) => ent.push(`0\nTEXT\n8\n${camada}\n10\n${f4(x)}\n20\n${f4(y)}\n30\n0\n40\n${f4(alt)}\n1\n${dxfTxt(t)}\n72\n4\n11\n${f4(x)}\n21\n${f4(y)}\n31\n0`);
    const ang = (x, y) => (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

    let desloc = 0;
    for (const pav of L.pavimentos) {
      const lay = layout(L, pav.id);
      if (!lay.pos.size) continue;
      const b = caixa([...lay.pos.values()]);
      const dx = desloc - b.x0;
      const ls = linhas(lay);
      for (const l of ls.paredes) linha('PAREDES', l[0] + dx, l[1], l[2] + dx, l[3]);
      for (const l of ls.batentes) linha('PORTAS', l[0] + dx, l[1], l[2] + dx, l[3]);
      for (const f of ls.folhas) {
        linha('PORTAS', f.cx + dx, f.cy, f.ex + dx, f.ey);
        const a1 = ang(f.ex - f.cx, f.ey - f.cy), a2 = ang(f.fx - f.cx, f.fy - f.cy);
        if (Math.round((a2 - a1 + 360) % 360) === 90) arco('PORTAS', f.cx + dx, f.cy, f.r, a1, a2);
        else arco('PORTAS', f.cx + dx, f.cy, f.r, a2, a1);
      }
      for (const [id, r] of lay.pos) {
        const a = L.ambientes.find(x => x.id === id) || {};
        const cx = r.x + r.dx / 2 + dx, cy = r.y + r.dy / 2;
        texto('TEXTOS', cx, cy + 0.25, 0.2, a.codigo || '');
        if (a.nome) texto('TEXTOS', cx, cy, 0.15, a.nome);
        texto('TEXTOS', cx, cy - 0.25, 0.12, `${fmt(r.dx * r.dy)} m2`);
      }
      texto('TEXTOS', desloc + (b.x1 - b.x0) / 2, b.y1 + 1, 0.4, pav.nome || pav.sigla || 'Pavimento');
      desloc += (b.x1 - b.x0) + 10;
    }
    const camadas = [['PAREDES', 7], ['PORTAS', 3], ['TEXTOS', 2]];
    return [
      '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC',
      '0\nSECTION\n2\nTABLES',
      '0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB',
      `0\nTABLE\n2\nLAYER\n70\n${camadas.length}\n` + camadas.map(([n, c]) => `0\nLAYER\n2\n${n}\n70\n0\n62\n${c}\n6\nCONTINUOUS`).join('\n') + '\n0\nENDTAB',
      '0\nENDSEC',
      '0\nSECTION\n2\nENTITIES',
      ...ent,
      '0\nENDSEC\n0\nEOF',
    ].join('\n') + '\n';
  }

  raiz.Planta = { layout, linhas, conferir, enquadrar, svg, cotaBoneca, cotaLargura, dxf, caixa, OPOSTA, HORIZ, ESPESSURA_PADRAO, canon };
})(typeof window !== 'undefined' ? window : globalThis);
