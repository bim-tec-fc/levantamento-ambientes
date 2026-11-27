/* ═══════════════════════════════════════════════════════════════════════════
   Levantamento de Ambientes, v1
   Núcleo BIM · Ferreira Costa · Melqui Domingos

   Ferramenta de campo para levantar ambientes (arquitetura) e indicar pontos de
   instalações e encaminhamentos. Funciona sem internet: os dados ficam no
   IndexedDB do aparelho até serem exportados (Excel, ZIP com fotos ou backup JSON).
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const VERSAO = '1.5.0';
const FORMATO_BACKUP = 'fc-levantamento-ambientes';

// ───────────────────────── Listas padrão ─────────────────────────
const USOS = [
  'Área de vendas', 'Depósito / estoque', 'Escritório', 'Sala de reunião', 'Recepção / atendimento',
  'Caixa / frente de loja', 'Circulação', 'Escada', 'Rampa', 'Banheiro / WC', 'Vestiário',
  'Copa / refeitório', 'Cozinha', 'DML / limpeza', 'Área técnica', 'Sala elétrica / quadros',
  'Doca / carga e descarga', 'Guarita', 'Estacionamento', 'Área externa',
];
const PISOS = [
  'Porcelanato', 'Cerâmica', 'Granilite', 'Concreto polido', 'Cimentado', 'Piso epóxi / autonivelante',
  'Vinílico', 'Laminado', 'Pedra natural', 'Piso tátil', 'Intertravado', 'Asfalto', 'Grama / terra',
];
const PAREDES = [
  'Pintura látex', 'Pintura acrílica / epóxi', 'Revestimento cerâmico', 'Porcelanato', 'Textura',
  'Bloco aparente', 'Concreto aparente', 'Drywall', 'Divisória naval', 'Telha / chapa metálica', 'Vidro',
];
const FORROS = [
  'Gesso acartonado', 'Gesso modular', 'Forro mineral modular', 'PVC', 'Madeira', 'Metálico',
  'Sem forro: laje aparente', 'Sem forro: telhado aparente', 'Céu aberto',
];
const CONSERVACAO = ['Bom', 'Regular', 'Ruim'];

// Instalações: "linear" = calhas, tubulações e dutos (pede comprimento e trajeto).
const INSTALACOES = [
  ['Tomada', 0], ['Interruptor', 0], ['Ponto de luz / luminária', 0], ['Luminária de emergência', 0],
  ['Quadro elétrico', 0], ['Ponto de rede / dados', 0], ['Câmera CFTV', 0],
  ['Ar-condicionado: evaporadora', 0], ['Ar-condicionado: condensadora', 0], ['Exaustor / ventilação', 0],
  ['Ponto de água', 0], ['Ponto de esgoto / ralo', 0], ['Extintor', 0], ['Hidrante', 0], ['Sprinkler', 0],
  ['Eletrocalha / leito', 1], ['Eletroduto', 1], ['Tubulação de água', 1], ['Tubulação de esgoto', 1],
  ['Tubulação de incêndio', 1], ['Calha pluvial', 1], ['Duto de ar', 1],
];
const TIPOS_INST = INSTALACOES.map(x => x[0]);
const LINEARES = new Set(INSTALACOES.filter(x => x[1]).map(x => x[0]));

// Campos obrigatórios para o ambiente contar como completo.
const OBRIGATORIOS = 9;

// ───────────────────────── Utilidades ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clonar = o => JSON.parse(JSON.stringify(o));

/** Converte o que foi digitado (aceita vírgula ou ponto) em número; vazio/ inválido → null. */
function num(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const r2 = n => n == null ? null : Math.round(n * 100) / 100;
const fmt = (n, d = 2) => n == null ? '–' : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const hojeISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const dataBR = iso => iso ? String(iso).split('-').reverse().join('/') : '';
const dataHoraBR = ms => ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
const ls = {
  get(k, d) { try { const v = localStorage.getItem('levamb.' + k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('levamb.' + k, v); } catch { /* sem armazenamento local */ } },
};
const semAcento = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const nomeArquivo = s => semAcento(s).replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

const ICONE_VOLTAR = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ───────────────────────── Banco local (IndexedDB) ─────────────────────────
let _db;
function abrirDB() {
  return _db || (_db = new Promise((ok, falha) => {
    const r = indexedDB.open('levantamento-ambientes', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('levantamentos', { keyPath: 'id' });
      d.createObjectStore('fotos', { keyPath: 'id' }).createIndex('levId', 'levId');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  }));
}
async function tx(loja, modo, fn) {
  const d = await abrirDB();
  return new Promise((ok, falha) => {
    const t = d.transaction(loja, modo);
    let res;
    const req = fn(t.objectStore(loja));
    if (req) req.onsuccess = () => { res = req.result; };
    t.oncomplete = () => ok(res);
    t.onerror = () => falha(t.error);
    t.onabort = () => falha(t.error || new Error('Operação cancelada'));
  });
}
const db = {
  todos: () => tx('levantamentos', 'readonly', s => s.getAll()),
  get: id => tx('levantamentos', 'readonly', s => s.get(id)),
  put: l => tx('levantamentos', 'readwrite', s => s.put(l)),
  del: id => tx('levantamentos', 'readwrite', s => s.delete(id)),
  fotoGet: id => tx('fotos', 'readonly', s => s.get(id)),
  fotoPut: f => tx('fotos', 'readwrite', s => s.put(f)),
  fotoDel: id => tx('fotos', 'readwrite', s => s.delete(id)),
  fotosDoLev: levId => tx('fotos', 'readonly', s => s.index('levId').getAll(levId)),
};

// ───────────────────────── Estado da tela ─────────────────────────
const ctx = { lev: null, amb: null, filtroPav: '', arquivoPronto: null, sel: null, pavPlanta: '', views: {} };
let rasc = null;                 // rascunho do formulário aberto na planta
const outroAberto = new Set();   // campos "Outro…" abertos e ainda vazios
const thumbs = new Map();        // fotoId → miniatura
let timerSalvar = null;
let donoFoto = null;             // para onde vai a próxima foto ('a' ou 'i:<id>')
let ovEstado = null;             // foto aberta em tela cheia

// ───────────────────────── Modelo ─────────────────────────
function novoLevantamento() {
  return {
    id: uid(), formato: FORMATO_BACKUP, versaoDados: 1,
    filial: '', endereco: '', responsavel: ls.get('responsavel', ''), data: hojeISO(), obs: '',
    pavimentos: [{ id: uid(), nome: 'Térreo', sigla: 'T' }],
    ambientes: [], portas: [], criadoEm: Date.now(), atualizadoEm: Date.now(), ultimaExportacao: null,
  };
}
function novoAmbiente(L, pavId) {
  return {
    id: uid(), codigo: proximoCodigo(L, pavId), pavimentoId: pavId, nome: '', uso: '',
    forma: 'ret', comp: '', larg: '', partes: [], lados: '', peDireito: '',
    piso: '', parede: '', forro: '', conservacao: '', obs: '', fotos: [], inst: [], objetos: [], nivel: '', ancora: null, criadoEm: Date.now(),
  };
}
const novaParte = (c = '', l = '') => ({ id: uid(), c, l, desc: false });
const novaInst = () => ({ id: uid(), tipo: '', qtd: '1', comp: '', altura: '', local: '', fotos: [] });

/** Garante que dados antigos ou importados tenham todos os campos. */
function normalizar(L) {
  L.pavimentos = Array.isArray(L.pavimentos) && L.pavimentos.length ? L.pavimentos : [{ id: uid(), nome: 'Térreo', sigla: 'T' }];
  L.ambientes = Array.isArray(L.ambientes) ? L.ambientes : [];
  L.portas = Array.isArray(L.portas) ? L.portas : [];
  const idsAmb = new Set(L.ambientes.map(a => a.id));
  L.portas = L.portas.filter(p => idsAmb.has(p.ambA));
  Planta.converterAntigo(L);   // paredes por nome (até a v1.2) → índice
  Planta.fixarPosicoes(L);     // cada ambiente com posição própria; a porta não posiciona mais
  for (const p of L.portas) {
    p.parede = +p.parede || 0;
    if (!p.modelo) p.modelo = p.tipo === 'vao' ? 'vao' : 'giro';   // dados da v1.1
    delete p.tipo;
    for (const k of ['largura', 'boneca', 'espessura', 'peitoril']) p[k] = p[k] ?? '';
    p.altura = p.altura ?? Planta.PADRAO_ABERTURA[p.modelo][1];
    p.canto = p.canto === 'fim' ? 'fim' : 'ini';
    p.abre = p.abre === 'fora' ? 'fora' : 'dentro';
    p.lado = p.lado === 'fim' ? 'fim' : 'ini';
  }
  for (const a of L.ambientes) {
    a.nivel = a.nivel ?? '';
    a.objetos = Array.isArray(a.objetos) ? a.objetos : [];
    a.partes = Array.isArray(a.partes) ? a.partes : [];
    a.fotos = Array.isArray(a.fotos) ? a.fotos : [];
    a.inst = Array.isArray(a.inst) ? a.inst : [];
    for (const i of a.inst) i.fotos = Array.isArray(i.fotos) ? i.fotos : [];
    for (const k of ['codigo', 'nome', 'uso', 'comp', 'larg', 'lados', 'peDireito', 'piso', 'parede', 'forro', 'conservacao', 'obs']) a[k] = a[k] ?? '';
    a.forma = ['irr', 'poli', 'marcador'].includes(a.forma) ? a.forma : 'ret';
    if (a.forma === 'poli') a.paredes = Array.isArray(a.paredes) ? a.paredes : [];
    if (!L.pavimentos.some(p => p.id === a.pavimentoId)) a.pavimentoId = L.pavimentos[0].id;
  }
  return L;
}

function proximoCodigo(L, pavId) {
  const pav = L.pavimentos.find(p => p.id === pavId) || L.pavimentos[0];
  const s = (pav.sigla || 'X').trim().toUpperCase() || 'X';
  const re = new RegExp('^' + escRe(s) + '-(\\d+)$', 'i');
  let max = 0;
  for (const a of L.ambientes) { const m = re.exec(a.codigo || ''); if (m) max = Math.max(max, +m[1]); }
  return `${s}-${String(max + 1).padStart(2, '0')}`;
}

const parseLados = s => String(s || '').split(/[;+\s]+/).map(num).filter(n => n != null && n > 0);
const partesValidas = a => a.partes.filter(p => num(p.c) > 0 && num(p.l) > 0);

function calc(a) {
  let area = null, perim = null;
  if (a.forma === 'poli') {
    const ap = Planta.areaPerimetro(a);
    area = ap.area; perim = ap.perim;
  } else if (a.forma === 'ret') {
    const c = num(a.comp), l = num(a.larg);
    if (c > 0 && l > 0) { area = c * l; perim = 2 * (c + l); }
  } else {
    const pv = partesValidas(a);
    if (pv.length) area = pv.reduce((s, p) => s + (p.desc ? -1 : 1) * num(p.c) * num(p.l), 0);
    const lados = parseLados(a.lados);
    if (lados.length) perim = lados.reduce((s, x) => s + x, 0);
  }
  const pd = num(a.peDireito);
  const vol = area != null && pd > 0 ? area * pd : null;
  return { area: r2(area), perim: r2(perim), pd, vol: r2(vol) };
}

function pendencias(a) {
  const p = [], c = calc(a);
  if (!a.nome.trim()) p.push('nome');
  if (!a.uso.trim()) p.push('uso');
  if (!(c.area > 0)) p.push('medidas');
  if (!(c.pd > 0)) p.push('pé-direito');
  if (!a.piso.trim()) p.push('piso');
  if (!a.parede.trim()) p.push('parede');
  if (!a.forro.trim()) p.push('forro');
  if (!a.conservacao) p.push('conservação');
  if (!a.fotos.length) p.push('foto');
  return p;
}
const pctCompleto = p => Math.round((OBRIGATORIOS - p.length) / OBRIGATORIOS * 100);
const classeFarol = pct => pct === 100 ? 'g' : pct >= 50 ? 'a' : 'r';

function alertas(a, L) {
  const w = [], c = calc(a);
  const medidas = a.forma === 'poli' ? (a.paredes || []).map(p => num(p.c)) : a.forma === 'ret' ? [num(a.comp), num(a.larg)] : a.partes.flatMap(p => [num(p.c), num(p.l)]);
  if (medidas.some(d => d != null && d > 150)) w.push('Há medida acima de 150 m. Confira se não foi digitada em centímetros.');
  if (medidas.some(d => d != null && d > 0 && d < 0.3)) w.push('Há medida abaixo de 0,30 m. Confira.');
  if (c.pd != null && (c.pd < 2.2 || c.pd > 20)) w.push('Pé-direito fora do usual (2,20 a 20 m). Confira.');
  if (a.forma === 'irr') {
    if (c.area != null && c.area <= 0) w.push('A área ficou zero ou negativa. Confira as partes marcadas para descontar.');
    if (c.area > 0 && c.perim != null && c.perim < 4 * Math.sqrt(c.area) * 0.98) w.push('O perímetro está pequeno demais para essa área. Faltou algum lado?');
    if (c.area > 0 && c.perim == null) w.push('Informe os lados para calcular o perímetro.');
  }
  const cod = (a.codigo || '').trim().toUpperCase();
  if (!cod) w.push('O ambiente está sem código.');
  else if (L.ambientes.some(x => x !== a && (x.codigo || '').trim().toUpperCase() === cod)) w.push(`O código ${a.codigo} já existe em outro ambiente.`);
  return w;
}

function ordenar(L) {
  const idx = new Map(L.pavimentos.map((p, i) => [p.id, i]));
  return [...L.ambientes].sort((a, b) =>
    (idx.get(a.pavimentoId) ?? 99) - (idx.get(b.pavimentoId) ?? 99) ||
    String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', { numeric: true }));
}
const somaArea = ambs => r2(ambs.reduce((s, a) => s + (calc(a).area || 0), 0));
const nomePav = (L, id) => (L.pavimentos.find(p => p.id === id) || {}).nome || '';
const tituloAmb = a => [a.codigo, a.nome].filter(Boolean).join(' · ') || 'Ambiente';

// ───────────────────────── Salvamento automático ─────────────────────────
function salvarDepois() {
  if (!ctx.lev) return;
  ctx.lev.atualizadoEm = Date.now();
  marcaSalvo('pendente');
  clearTimeout(timerSalvar);
  timerSalvar = setTimeout(salvarAgora, 400);
}
async function salvarAgora() {
  clearTimeout(timerSalvar);
  timerSalvar = null;
  if (!ctx.lev) return;
  try {
    await db.put(ctx.lev);
    marcaSalvo('ok');
  } catch (e) {
    marcaSalvo('erro');
    toast('Não foi possível salvar: ' + e.message, 6000);
  }
}
const flush = () => timerSalvar ? salvarAgora() : Promise.resolve();
function marcaSalvo(est) {
  const el = $('#salvo');
  if (!el) return;
  el.className = 'salvo ' + est;
  el.textContent = est === 'ok' ? 'Salvo' : est === 'erro' ? 'Erro ao salvar' : 'Salvando…';
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', () => { flush(); });

// ───────────────────────── Avisos ─────────────────────────
let timerToast;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.hidden = true; }, ms);
}

// ───────────────────────── Navegação ─────────────────────────
async function rotear() {
  await flush();
  fecharOverlay(false);
  fecharDialogo();
  fechar3D();
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (p[0] === 'l' && p[1]) {
      if (!ctx.lev || ctx.lev.id !== p[1]) {
        ctx.lev = await db.get(p[1]);
        ctx.filtroPav = '';
        ctx.arquivoPronto = null;
      }
      if (!ctx.lev) { location.replace('#/'); return; }
      normalizar(ctx.lev);
      if (p[2] === 'a' && p[3]) {
        const a = ctx.lev.ambientes.find(x => x.id === p[3]);
        if (!a) { location.replace(`#/l/${ctx.lev.id}`); return; }
        if (ctx.amb !== a) { outroAberto.clear(); window.scrollTo(0, 0); }
        ctx.amb = a;
        return telaAmbiente();
      }
      ctx.amb = null;
      window.scrollTo(0, 0);
      return telaLev(p[2] || 'planta');
    }
    ctx.lev = null;
    ctx.amb = null;
    window.scrollTo(0, 0);
    return telaInicio();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<main class="wrap"><div class="card sec"><h2 class="fc-h2">Algo deu errado</h2><p>${h(e.message)}</p><p><a href="#/">Voltar ao início</a></p></div></main>`;
  }
}
window.addEventListener('hashchange', rotear);

function render({ titulo, sub, voltar, corpo, rodape, abas, planta }) {
  document.body.classList.toggle('modo-planta', !!planta);
  fecharFolha();
  $('#app').innerHTML = `
  <header class="fc-topbar tb">
    <div class="tb-in">
      ${voltar ? `<a class="voltar" href="${voltar}" aria-label="Voltar">${ICONE_VOLTAR}</a>` : ''}
      <div class="tb-tit">
        <div class="fc-brand">${h(sub || 'Núcleo BIM · Ferreira Costa')}</div>
        <h1 class="fc-title" id="titulo">${h(titulo)}</h1>
      </div>
      <span id="salvo" class="salvo"></span>
      ${planta ? `<button class="btn btn-ghost tb-menu" data-acao="pl-menu" aria-label="Menu do levantamento">${ICONE_MENU}<span>Menu</span></button>` : ''}
    </div>
    ${planta ? '' : abas || ''}
  </header>
  ${planta ? corpo : `<main class="wrap${rodape ? ' com-rodape' : ''}">${corpo}</main>`}
  ${rodape ? `<div class="bottombar">${rodape}</div>` : ''}`;
}

/** Redesenha a tela atual mantendo a rolagem. */
function redesenhar() {
  const y = window.scrollY;
  if (ctx.amb) telaAmbiente(); else if (ctx.lev) telaLev(abaAtual()); else telaInicio();
  window.scrollTo(0, y);
}
const abaAtual = () => location.hash.split('/')[3] || 'planta';

// ───────────────────────── Componentes de formulário ─────────────────────────
let _n = 0;
const fid = () => 'f' + (++_n);

function campo(rot, bind, val, { tipo = 'text', extra = '', cls = '', dica = '' } = {}) {
  const id = fid();
  return `<div class="field ${cls}"><label for="${id}">${h(rot)}</label>
    <input id="${id}" class="input" type="${tipo}" data-bind="${bind}" value="${h(val ?? '')}" autocomplete="off" ${extra}>
    ${dica ? `<div class="dica">${h(dica)}</div>` : ''}</div>`;
}
const NUM = 'inputmode="decimal" enterkeyhint="next" placeholder="0,00"';
const campoNum = (rot, bind, val, o = {}) => campo(rot, bind, val, { ...o, extra: NUM + ' ' + (o.extra || ''), cls: 'num ' + (o.cls || '') });

function campoTexto(rot, bind, val, ph = '') {
  const id = fid();
  return `<div class="field"><label for="${id}">${h(rot)}</label>
    <textarea id="${id}" class="input" data-bind="${bind}" rows="3" placeholder="${h(ph)}">${h(val ?? '')}</textarea></div>`;
}

/** Lista suspensa com opção "Outro…" que abre um campo de texto livre. */
function campoLista(rot, bind, lista, val) {
  const id = fid();
  const naLista = lista.includes(val);
  const outro = (!naLista && !!val) || outroAberto.has(bind);
  return `<div class="field"><label for="${id}">${h(rot)}</label>
    <select id="${id}" class="input" data-sel="${bind}">
      <option value="">Selecione…</option>
      ${lista.map(o => `<option${o === val ? ' selected' : ''}>${h(o)}</option>`).join('')}
      <option value="__outro__"${outro ? ' selected' : ''}>Outro…</option>
    </select>
    <input class="input outro" data-bind="${bind}" value="${outro ? h(val) : ''}" placeholder="Descreva" aria-label="${h(rot)}: outro" ${outro ? '' : 'hidden'}>
  </div>`;
}

function alvo(path) {
  const [o, k] = path.split('.');
  if (o === 'lev') return [ctx.lev, k];
  if (o === 'a') return [ctx.amb, k];
  const [t, id] = o.split(':');
  const arr = t === 'p' ? ctx.amb && ctx.amb.partes : t === 'i' ? ctx.amb && ctx.amb.inst : t === 'v' ? ctx.lev && ctx.lev.pavimentos : null;
  return [arr ? arr.find(x => x.id === id) : null, k];
}

function aoEditar(path) {
  if (path === 'lev.filial') { const t = $('#titulo'); if (t) t.textContent = ctx.lev.filial || 'Sem nome'; }
  if (path === 'lev.responsavel') ls.set('responsavel', ctx.lev.responsavel);
  if (ctx.amb) atualizarAmb();
}

const ICONE_MENU = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICONE_FERR = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="7" r="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="10" cy="17" r="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';

/**
 * Folha que sobe de baixo com grupos de botões (Menu e Ferramentas da prancheta).
 * Qualquer botão ou link de dentro fecha a folha antes de agir.
 */
function abrirFolha(titulo, corpo) {
  fecharFolha();
  const f = document.createElement('div');
  f.className = 'folha-fundo';
  f.id = 'folha';
  f.innerHTML = `<div class="folha" role="dialog" aria-modal="true" aria-label="${h(titulo)}">
      <div class="folha-cab"><span class="folha-t">${h(titulo)}</span><button class="btn btn-ghost icone" data-folha="fechar" aria-label="Fechar">×</button></div>
      <div class="folha-corpo">${corpo}</div>
    </div>`;
  f.addEventListener('click', e => {
    if (e.target === f || e.target.closest('[data-folha="fechar"]') || e.target.closest('a')) fecharFolha();
  });
  document.body.appendChild(f);
}
function fecharFolha() { const f = $('#folha'); if (f) f.remove(); }
const grupoFolha = (titulo, conteudo, cls = '') => conteudo ? `<section class="folha-g ${cls}"><div class="folha-gt">${h(titulo)}</div>${conteudo}</section>` : '';

/** Menu do levantamento: navegação entre as telas (no lugar das abas, para a prancheta ficar maior). */
function folhaMenu() {
  const L = ctx.lev, base = `#/l/${L.id}`;
  abrirFolha('Menu', grupoFolha('Levantamento', `<div class="folha-bts g2">
      <a class="btn btn-ghost" href="${base}/ambientes">Lista de ambientes</a>
      <a class="btn btn-ghost" href="${base}/dados">Dados e pavimentos</a>
      <a class="btn btn-ghost" href="${base}/exportar">Exportar</a>
      <a class="btn btn-ghost" href="#/">Todos os levantamentos</a>
    </div>`) + grupoFolha('Gestos na prancheta', `<ul class="folha-ajuda">
      <li><b>Um toque curto</b> seleciona ou marca o ponto (canto do desenho, calibração, marcador).</li>
      <li><b>Dois dedos</b> movem e aproximam a planta. Um dedo sozinho não mexe a folha.</li>
      <li><b>Arraste</b> um ambiente selecionado para movê-lo: perto de outro, ele encosta sozinho (ímã).</li>
      <li><b>Toque numa parede</b> para corrigir a medida ou inserir porta, janela, ponto ou objeto.</li>
    </ul>`));
}

/** Ferramentas da prancheta, agrupadas por tema. */
function folhaFerramentas() {
  const L = ctx.lev, pav = pavAtual(L), lay = Planta.layout(L, pav), temFundo = !!fundoDoPav(L, pav);
  const avisos = Planta.conferir(L, pav, lay);
  const pavs = L.pavimentos.length > 1 ? `<div class="seg">${L.pavimentos.map(p =>
    `<button class="chip${p.id === pav ? '' : ' off'}" data-acao="pl-pav" data-id="${h(p.id)}">${h(p.nome || p.sigla)}</button>`).join('')}</div>` : '';
  abrirFolha('Ferramentas',
    (avisos.length ? grupoFolha('Avisos', avisos.map(x => `<div class="alerta">${h(x)}</div>`).join(''), 'avisos') : '') +
    grupoFolha('Criar ambiente', `<div class="folha-bts g3">
      <button class="btn btn-primary" data-acao="pl-desenhar">Desenhar</button>
      <button class="btn btn-ghost" data-acao="pl-novo-raiz">Retângulo</button>
      <button class="btn btn-ghost" data-acao="mc-novo">Marcador</button>
    </div><p class="folha-dica">Desenhar: toque canto a canto. Retângulo: digite as medidas. Marcador: só a ficha, sem medir.</p>`) +
    grupoFolha('Vista', `<div class="folha-bts g4">
      <button class="btn btn-ghost" data-acao="pl-enquadrar">Enquadrar</button>
      <button class="btn btn-ghost" data-acao="pl-zoom" data-v="1.3">Aproximar</button>
      <button class="btn btn-ghost" data-acao="pl-zoom" data-v="0.77">Afastar</button>
      <button class="btn btn-ghost" data-acao="pl-3d">3D</button>
    </div>${pavs ? `<div class="folha-sub">Pavimento</div>${pavs}` : ''}`) +
    grupoFolha('Planta de fundo', `<div class="folha-bts g2">
      ${temFundo ? '<button class="btn btn-ghost" data-acao="fd-carregar">Ajustar e calibrar</button><button class="btn btn-ghost" data-acao="fd-trocar">Trocar imagem</button>'
        : '<button class="btn btn-ghost" data-acao="fd-trocar">Carregar imagem</button><span></span>'}
    </div>`) +
    grupoFolha('Situação dos ambientes', htmlResumoStatus(L, pav) || '<p class="folha-dica">Nenhum ambiente ainda.</p>'));
}

const ICONE_LIXEIRA = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Janela de confirmação (no lugar do confirm do navegador).
 * Devolve true só se a pessoa tocar no botão de confirmar.
 */
function confirmar({ titulo, texto, ok = 'Excluir', perigo = true }) {
  return new Promise(resolve => {
    const fundo = document.createElement('div');
    fundo.className = 'conf-fundo';
    fundo.innerHTML = `<div class="conf card" role="alertdialog" aria-modal="true" aria-labelledby="conf-t" aria-describedby="conf-x">
        <div id="conf-t" class="conf-t">${h(titulo)}</div>
        <div id="conf-x" class="conf-x">${texto}</div>
        <div class="conf-acoes">
          <button type="button" class="btn btn-ghost" data-conf="nao">Cancelar</button>
          <button type="button" class="btn ${perigo ? 'btn-perigo' : 'btn-primary'}" data-conf="sim">${h(ok)}</button>
        </div>
      </div>`;
    const fechar = sim => { document.removeEventListener('keydown', tecla, true); fundo.remove(); resolve(sim); };
    const tecla = e => { if (e.key === 'Escape') { e.preventDefault(); fechar(false); } };
    fundo.addEventListener('click', e => {
      const b = e.target.closest('[data-conf]');
      if (b) fechar(b.dataset.conf === 'sim');
      else if (e.target === fundo) fechar(false);
    });
    document.addEventListener('keydown', tecla, true);
    document.body.appendChild(fundo);
    fundo.querySelector('[data-conf="nao"]').focus();
  });
}

// ───────────────────────── Tela: início ─────────────────────────
async function telaInicio() {
  const levs = (await db.todos()).map(normalizar).sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
  const lista = levs.length ? levs.map(L => {
    const pend = !L.ultimaExportacao || L.atualizadoEm > L.ultimaExportacao;
    return `<div class="card item lev-item">
      <a class="lev-link" href="#/l/${h(L.id)}">
        <div class="item-c">
          <div class="item-t">${h(L.filial || 'Levantamento sem nome')}</div>
          <div class="item-s">${h(dataBR(L.data))}${L.responsavel ? ' · ' + h(L.responsavel) : ''}</div>
          <div class="item-s num">${L.ambientes.length} ambiente(s) · ${fmt(somaArea(L.ambientes))} m²</div>
        </div>
        <span class="farol ${pend ? 'a' : 'g'}">${pend ? 'Não exportado' : 'Exportado'}</span>
      </a>
      <button class="btn btn-ghost icone perigo lev-del" data-acao="del-lev" data-id="${h(L.id)}" aria-label="Excluir ${h(L.filial || 'levantamento sem nome')}">${ICONE_LIXEIRA}</button>
    </div>`;
  }).join('') : `<div class="card vazio">Nenhum levantamento neste aparelho ainda.<br>Toque em <b>Novo levantamento</b> para começar.</div>`;

  const tema = ls.get('tema', 'auto');
  render({
    titulo: 'Levantamento de ambientes',
    corpo: `
      <div class="card aviso"><b>Os dados ficam só neste aparelho</b> até você exportar.
      Ao terminar, gere a planilha e o backup e envie para a equipe.</div>
      <div class="fc-sec-h"><span class="fc-sec-t">Levantamentos</span></div>
      ${lista}
      <div class="rodape-info">
        <div class="field tema"><label for="tema">Tema</label>
          <select id="tema" class="input">
            <option value="auto"${tema === 'auto' ? ' selected' : ''}>Automático</option>
            <option value="light"${tema === 'light' ? ' selected' : ''}>Claro (melhor no sol)</option>
            <option value="dark"${tema === 'dark' ? ' selected' : ''}>Escuro</option>
          </select></div>
        <p>Versão ${VERSAO} · Núcleo BIM · Ferreira Costa</p>
      </div>`,
    rodape: `<button class="btn btn-ghost" data-acao="importar">Importar backup</button>
             <button class="btn btn-primary" data-acao="novo-lev">Novo levantamento</button>`,
  });
}

// ───────────────────────── Tela: levantamento ─────────────────────────
function telaLev(aba) {
  const L = ctx.lev, base = `#/l/${L.id}`;
  const abas = `<nav class="tabs">${[['planta', 'Planta'], ['ambientes', 'Ambientes'], ['dados', 'Dados'], ['exportar', 'Exportar']]
    .map(([k, t]) => `<a class="tab${aba === k ? ' on' : ''}" href="${base}${k === 'planta' ? '' : '/' + k}">${t}</a>`).join('')}</nav>`;
  if (aba === 'planta') {
    render({ titulo: L.filial || 'Sem nome', sub: 'Levantamento', voltar: '#/', corpo: htmlPlanta(L), abas, planta: true });
    iniciarPlanta();
    return;
  }
  let corpo;
  if (aba === 'dados') corpo = htmlDados(L);
  else if (aba === 'exportar') corpo = htmlExportar(L);
  else corpo = htmlAmbientes(L);
  render({ titulo: L.filial || 'Sem nome', sub: 'Levantamento', voltar: '#/', corpo, abas });
  if (aba === 'exportar') mostrarArmazenamento();
}

function htmlAmbientes(L) {
  const f = ctx.filtroPav;
  const ambs = ordenar(L).filter(a => !f || a.pavimentoId === f);
  const completos = ambs.filter(a => !pendencias(a).length).length;
  const kpis = `<div class="kpis k3">
    <div class="kpi info"><div class="kpi-l">Ambientes</div><div class="kpi-n num">${ambs.length}</div></div>
    <div class="kpi"><div class="kpi-l">Área ${f ? 'do pavimento' : 'total'} (m²)</div><div class="kpi-n num">${fmt(somaArea(ambs))}</div></div>
    <div class="kpi ${ambs.length && completos === ambs.length ? 'green' : 'amber'}"><div class="kpi-l">Completos</div><div class="kpi-n num">${completos}/${ambs.length}</div></div>
  </div>`;
  const chips = L.pavimentos.length > 1 ? `<div class="seg filtro">${[['', 'Todos'], ...L.pavimentos.map(p => [p.id, p.nome || p.sigla])]
    .map(([id, n]) => `<button class="chip${f === id ? '' : ' off'}" data-acao="filtro-pav" data-id="${h(id)}">${h(n)}</button>`).join('')}</div>` : '';
  const lista = ambs.length ? ambs.map(a => {
    const c = calc(a), pct = pctCompleto(pendencias(a));
    return `<a class="card item" href="#/l/${h(L.id)}/a/${h(a.id)}">
      <div class="item-cod num">${h(a.codigo || '?')}</div>
      <div class="item-c">
        <div class="item-t">${h(a.nome || '(sem nome)')}</div>
        <div class="item-s">${h(a.uso || 'Uso não informado')}${L.pavimentos.length > 1 ? ' · ' + h(nomePav(L, a.pavimentoId)) : ''}</div>
      </div>
      <div class="item-d"><span class="st-tag st-${a.status || 'levantar'}">${h(nomeStatus(a.status))}</span><div class="num item-area">${c.area != null ? fmt(c.area) + ' m²' : a.forma === 'marcador' ? 'marcador' : '–'}</div>
        <span class="farol ${classeFarol(pct)}">${pct}%</span></div>
    </a>`;
  }).join('') : `<div class="card vazio">Nenhum ambiente${f ? ' neste pavimento' : ''} ainda.<br>Os ambientes são desenhados na aba <b>Planta</b>.</div>`;
  return kpis + htmlResumoStatus(L, f) + chips + lista;
}

function htmlDados(L) {
  const pavs = L.pavimentos.map(p => {
    const usados = L.ambientes.filter(a => a.pavimentoId === p.id).length;
    return `<div class="pav-linha">
      ${campo('Pavimento', `v:${p.id}.nome`, p.nome, { extra: 'placeholder="Ex.: Mezanino"' })}
      ${campo('Sigla', `v:${p.id}.sigla`, p.sigla, { cls: 'sigla', extra: 'autocapitalize="characters" maxlength="4" placeholder="M"' })}
      <button class="btn btn-ghost icone" data-acao="del-pav" data-id="${h(p.id)}" aria-label="Remover pavimento"
        ${usados || L.pavimentos.length === 1 ? 'disabled title="Pavimento com ambientes não pode ser removido"' : ''}>×</button>
    </div>`;
  }).join('');
  return `
  <section class="card sec">
    <h2 class="fc-h2">Dados do levantamento</h2>
    ${campo('Filial / obra', 'lev.filial', L.filial, { extra: 'placeholder="Ex.: Loja Imbiribeira"' })}
    ${campoNum('Espessura das paredes entre ambientes (m)', 'lev.espessura', L.espessura ?? '0,15', { dica: 'Usada pelo ímã ao encostar um ambiente no outro.' })}
    ${campo('Endereço', 'lev.endereco', L.endereco)}
    <div class="grid2">
      ${campo('Responsável', 'lev.responsavel', L.responsavel, { extra: 'autocapitalize="words"' })}
      ${campo('Data', 'lev.data', L.data, { tipo: 'date' })}
    </div>
    ${campoTexto('Observações gerais', 'lev.obs', L.obs, 'Condições da visita, acesso, o que ficou de fora…')}
  </section>
  <section class="card sec">
    <h2 class="fc-h2">Pavimentos</h2>
    <p class="dica">A sigla forma o código dos ambientes (ex.: T-01, M-03).</p>
    ${pavs}
    <button class="btn btn-ghost" data-acao="add-pav">+ Pavimento</button>
  </section>
  <section class="card sec perigo-zona">
    <h2 class="fc-h2">Excluir</h2>
    <p class="dica">Apaga este levantamento e as fotos deste aparelho. Exporte o backup antes.</p>
    <button class="btn btn-ghost perigo" data-acao="del-lev">Excluir levantamento</button>
  </section>`;
}

function htmlExportar(L) {
  const pend = !L.ultimaExportacao || L.atualizadoEm > L.ultimaExportacao;
  const nFotos = L.ambientes.reduce((s, a) => s + a.fotos.length + a.inst.reduce((t, i) => t + i.fotos.length, 0), 0);
  const p = ctx.arquivoPronto;
  const share = p && navigator.canShare && navigator.canShare({ files: [p.file] });
  return `
  <div class="card status">
    <span class="farol ${pend ? 'a' : 'g'}">${pend ? 'Alterações não exportadas' : 'Tudo exportado'}</span>
    <span class="pend">${L.ultimaExportacao ? 'Última exportação: ' + h(dataHoraBR(L.ultimaExportacao)) : 'Ainda não exportado'}</span>
  </div>
  ${p ? `<section class="card sec pronto">
    <h2 class="fc-h2">Arquivo pronto</h2>
    <p class="arq num">${h(p.file.name)} · ${p.file.size < 1048576 ? fmt(p.file.size / 1024, 0) + ' KB' : fmt(p.file.size / 1048576, 1) + ' MB'}</p>
    <div class="fc-row">
      <button class="btn btn-primary" data-acao="baixar">Baixar</button>
      ${share ? '<button class="btn btn-ghost" data-acao="compartilhar">Enviar (WhatsApp, Teams…)</button>' : ''}
    </div>
  </section>` : ''}
  <section class="card sec">
    <h2 class="fc-h2">Exportar</h2>
    <button class="exp" data-acao="exp-dxf"><b>Planta baixa (.dxf)</b>
      <span>Para abrir no AutoCAD ou importar no Revit. Unidade: metro. Pavimentos lado a lado.</span></button>
    <button class="exp" data-acao="exp-xlsx"><b>Planilha Excel (.xlsx)</b>
      <span>Abas de ambientes (com posição na planta), portas, instalações e resumo por pavimento.</span></button>
    <button class="exp" data-acao="exp-zip"><b>Planilha + planta + fotos (.zip)</b>
      <span>${nFotos} foto(s), com o código do ambiente no nome do arquivo.</span></button>
    <button class="exp" data-acao="exp-json"><b>Backup completo (.json)</b>
      <span>Guarda tudo, inclusive fotos. Use "Importar backup" para abrir em outro aparelho.</span></button>
  </section>
  <p class="dica" id="armaz"></p>`;
}

async function mostrarArmazenamento() {
  const el = $('#armaz');
  if (!el || !navigator.storage || !navigator.storage.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    el.textContent = `Espaço usado pela ferramenta neste aparelho: ${fmt(usage / 1048576, 1)} MB de ${fmt(quota / 1048576, 0)} MB disponíveis.`;
  } catch { /* sem estimativa */ }
}

// ───────────────────────── Tela: ambiente ─────────────────────────
function telaAmbiente() {
  const L = ctx.lev, a = ctx.amb;
  const pavOpts = L.pavimentos.map(p => `<option value="${h(p.id)}"${p.id === a.pavimentoId ? ' selected' : ''}>${h(p.nome || p.sigla)}</option>`).join('');
  const idPav = fid();

  const ligado = estaLigado(L, a);
  const medidas = a.forma === 'marcador'
    ? '<p class="dica">Marcador: ainda sem medidas. Em <b>Ver na planta</b>, use <b>Desenhar</b> ou <b>Retângulo</b> para medir este ambiente.</p>'
    : a.forma === 'poli'
    ? `<p class="dica">Forma livre, ${(a.paredes || []).length + 1} paredes: ${(a.paredes || []).map((p, k) => `${Planta.letra(k)}–${Planta.letra(k + 1)} ${fmt(num(p.c))} m${k ? ` (${h(p.ang)}°)` : ''}`).join(' · ')}. Para mudar, use <b>Ver na planta</b> e <b>Medidas</b>.</p>`
    : a.forma === 'ret'
    ? `<div class="grid2">${campoNum('Comprimento (parede A–B)', 'a.comp', a.comp)}${campoNum('Largura (parede B–C)', 'a.larg', a.larg)}</div>`
    : `<p class="dica">Divida o ambiente em retângulos. Marque "descontar" para recortes (pilar, shaft, escada).</p>
       ${a.partes.map((p, i) => `<div class="parte">
          <span class="parte-n num">${i + 1}</span>
          ${campoNum('Compr.', `p:${p.id}.c`, p.c)}
          <span class="x">×</span>
          ${campoNum('Larg.', `p:${p.id}.l`, p.l)}
          <label class="check"><input type="checkbox" data-bind="p:${p.id}.desc"${p.desc ? ' checked' : ''}> descontar</label>
          <button class="btn btn-ghost icone" data-acao="del-parte" data-id="${h(p.id)}" aria-label="Remover parte">×</button>
        </div>`).join('')}
       <button class="btn btn-ghost" data-acao="add-parte">+ Parte</button>
       ${campo('Lados medidos (perímetro)', 'a.lados', a.lados, { extra: 'inputmode="decimal" placeholder="Ex.: 5,20; 3,00; 2,10; 1,50"', dica: 'Separe os lados com ponto e vírgula. A soma é o perímetro.' })}`;

  const inst = a.inst.map((it, k) => {
    const linear = LINEARES.has(it.tipo);
    return `<div class="inst">
      <div class="inst-h"><span class="fc-label">Item I${String(k + 1).padStart(2, '0')}</span>
        <button class="btn btn-ghost icone" data-acao="del-inst" data-id="${h(it.id)}" aria-label="Remover item">×</button></div>
      ${campoLista('Tipo', `i:${it.id}.tipo`, TIPOS_INST, it.tipo)}
      <div class="grid2">
        ${linear ? campoNum('Comprimento aprox. (m)', `i:${it.id}.comp`, it.comp)
                 : campo('Quantidade', `i:${it.id}.qtd`, it.qtd, { cls: 'num', extra: 'inputmode="numeric" placeholder="1"' })}
        ${campoNum('Altura do piso (m)', `i:${it.id}.altura`, it.altura)}
      </div>
      ${campoTexto(linear ? 'Encaminhamento' : 'Localização', `i:${it.id}.local`, it.local,
        linear ? 'Ex.: sai do QGBT, segue pela parede leste a 3,00 m até o forro do depósito'
               : 'Ex.: parede norte, ao lado da porta')}
      ${htmlFotos(it.fotos, 'i:' + it.id, true)}
    </div>`;
  }).join('');

  render({
    titulo: tituloAmb(a), sub: L.filial || 'Levantamento', voltar: `#/l/${L.id}`,
    corpo: `
    <div id="status-amb"></div>
    <section class="card sec">
      <h2 class="fc-h2">Identificação</h2>
      <div class="grid2">
        ${campo('Código', 'a.codigo', a.codigo, { cls: 'num', extra: 'autocapitalize="characters"' })}
        <div class="field"><label for="${idPav}">Pavimento</label>
          <select id="${idPav}" class="input" data-mudapav${ligado ? ' disabled title="Ambiente ligado por porta a outro"' : ''}>${pavOpts}</select></div>
      </div>
      ${campo('Nome do ambiente', 'a.nome', a.nome, { extra: 'placeholder="Ex.: Depósito de cerâmica" enterkeyhint="next" autocapitalize="sentences"' })}
      <div class="field"><span class="fc-label">Status</span>${chipsStatus(a.status)}</div>
      ${campoLista('Uso', 'a.uso', USOS, a.uso)}
    </section>

    <section class="card sec">
      <h2 class="fc-h2">Medidas (m)</h2>
      ${a.forma === 'irr' ? `<div class="seg">
        <button class="chip off" data-acao="forma" data-v="ret">Voltar para retangular</button>
      </div>` : '<p class="dica">Alterar as medidas redesenha a planta.</p>'}
      ${medidas}
      ${campoNum('Pé-direito', 'a.peDireito', a.peDireito, { dica: 'Do piso ao forro ou, sem forro, até a laje ou o banzo da cobertura.' })}
      <div class="res" id="res"></div>
      <div id="alertas"></div>
    </section>

    <section class="card sec">
      <h2 class="fc-h2">Acabamentos</h2>
      ${campoLista('Piso', 'a.piso', PISOS, a.piso)}
      ${campoLista('Parede', 'a.parede', PAREDES, a.parede)}
      ${campoLista('Forro / teto', 'a.forro', FORROS, a.forro)}
      <div class="field"><span class="fc-label">Estado de conservação</span>
        <div class="seg">${CONSERVACAO.map(c => `<button class="chip${a.conservacao === c ? '' : ' off'}" data-acao="conserv" data-v="${c}">${c}</button>`).join('')}</div>
      </div>
    </section>

    <section class="card sec">
      <h2 class="fc-h2">Fotos</h2>
      ${htmlFotos(a.fotos, 'a')}
    </section>

    <section class="card sec">
      <h2 class="fc-h2">Instalações e encaminhamentos</h2>
      <p class="dica">Indique pontos (tomadas, quadros, ar-condicionado, ralos…) e o trajeto de calhas e tubulações aparentes.</p>
      ${inst}
      <button class="btn btn-ghost" data-acao="add-inst">+ Instalação</button>
    </section>

    <section class="card sec">
      ${campoTexto('Observações', 'a.obs', a.obs, 'Patologias, infiltração, divergência com a planta…')}
    </section>

    <section class="acoes-fim">
      <button class="btn btn-ghost perigo" data-acao="del-amb">Excluir ambiente</button>
    </section>`,
    rodape: `<a class="btn btn-ghost" href="#/l/${h(L.id)}/ambientes">Lista</a>
             <button class="btn btn-primary" data-acao="ver-na-planta">Ver na planta</button>`,
  });
  atualizarAmb();
  carregarThumbs();
}

function htmlFotos(lista, dono, compacto = false) {
  return `<div class="fotos${compacto ? ' compacto' : ''}">${lista.map((f, i) =>
    `<button class="foto" data-acao="ver-foto" data-id="${h(f.id)}" data-dono="${h(dono)}" aria-label="Abrir foto ${i + 1}">
      <img data-thumb="${h(f.id)}" alt="">${f.legenda ? `<span class="leg">${h(f.legenda)}</span>` : ''}</button>`).join('')}</div>
    <div class="fc-row">
      <button class="btn btn-ghost" data-acao="foto" data-dono="${h(dono)}" data-cam="1">Câmera</button>
      <button class="btn btn-ghost" data-acao="foto" data-dono="${h(dono)}">Galeria</button>
    </div>`;
}

/** Atualiza cálculos, completude e alertas sem redesenhar os campos (não perde o foco). */
function atualizarAmb() {
  const a = ctx.amb, c = calc(a);
  const kpi = (t, v) => `<div class="kpi"><div class="kpi-l">${t}</div><div class="kpi-n num">${v}</div></div>`;
  const res = $('#res');
  if (res) res.innerHTML = kpi('Área (m²)', fmt(c.area)) + kpi('Perímetro (m)', fmt(c.perim)) + kpi('Volume (m³)', fmt(c.vol));
  const al = $('#alertas');
  if (al) al.innerHTML = alertas(a, ctx.lev).map(x => `<div class="alerta">${h(x)}</div>`).join('');
  const st = $('#status-amb');
  if (st) {
    const p = pendencias(a), pct = pctCompleto(p);
    st.innerHTML = `<div class="card status"><span class="farol ${classeFarol(pct)}">${pct}% completo</span>
      <span class="pend">${p.length ? 'Falta: ' + h(p.join(', ')) : 'Tudo preenchido'}</span></div>`;
  }
  const t = $('#titulo');
  if (t) t.textContent = tituloAmb(a);
}

// ───────────────────────── Planta baixa ─────────────────────────
const letra = k => Planta.letra(k);
/** Letras dos cantos de cada parede de um ambiente: [início, fim]. */
function cantosDe(a, k) {
  const f = Planta.formaLocal(a), n = f.verts.length;
  return [letra(k), letra(f.fechado ? (k + 1) % n : k + 1)];
}
const nomeParede = (a, k) => { const [x, y] = cantosDe(a, k); return `${x}–${y}`; };
const paredesDoAmb = a => { const f = Planta.formaLocal(a); return Planta.paredesDe(f.verts, f.fechado, f.sentido); };
const nomeModelo = m => (Planta.MODELOS.find(x => x[0] === m) || [0, 'Porta'])[1];
const MODELOS_PORTA = Planta.MODELOS.filter(m => !Planta.ehJanela(m[0]));
const MODELOS_JANELA = Planta.MODELOS.filter(m => Planta.ehJanela(m[0]));
/** Número para guardar como o usuário digitaria (vírgula, 2 casas no máximo). */
const vnum = n => n == null || !Number.isFinite(n) ? '' : String(r2(n)).replace('.', ',');
/** Número para mostrar nos campos do painel (sempre 2 casas). */
const vexib = n => n == null || !Number.isFinite(n) ? '' : n.toFixed(2).replace('.', ',');
const ICONE_ENQUADRAR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
/** Ângulo arredondado de 5 em 5 graus; perto do esquadro, fica no esquadro. */
function arredAng(g, volta = true, esquadro = 4) {
  if (volta) g = ((g % 360) + 360) % 360;
  const q = Math.round(g / 90) * 90;
  const r = Math.abs(g - q) <= esquadro ? q : Math.round(g / 5) * 5;
  return volta ? r % 360 : r;
}
const arredMedida = m => Math.max(0.05, Math.round(m / 0.05) * 0.05);

const ambPorId = (L, id) => L.ambientes.find(a => a.id === id);
function estaLigado() { return false; }   // ambientes são independentes; a porta só fura a parede
/** Ambientes desenhados a partir das portas deste (dependem dele para ter posição). */
function dependentes(L, a) {
  return L.ambientes.filter(x => x.desenhando && x.ancora && L.portas.some(p => p.id === x.ancora && p.ambA === a.id));
}
/** Ambiente do outro lado da porta (o que encosta na parede dela), se houver. */
function outroLado(L, p) {
  const A = ambPorId(L, p.ambA);
  const g = A && Planta.layout(L, A.pavimentoId).portas.find(x => x.p.id === p.id);
  return g && g.ambB ? ambPorId(L, g.ambB) : null;
}
async function excluirAmbiente(L, a, perguntar = true) {
  const dep = dependentes(L, a);
  if (dep.length) {
    alert(`Antes, exclua o que foi desenhado a partir das portas de ${tituloAmb(a)}: ${dep.map(tituloAmb).join(', ')}.`);
    return false;
  }
  if (perguntar && !confirm(`Excluir o ambiente ${tituloAmb(a)} e as fotos dele?`)) return false;
  await apagarFotos(fotosDoAmb(a));
  L.portas = L.portas.filter(p => p.ambA !== a.id);
  for (const p of L.portas) if (p.ambB === a.id) { p.ambB = null; p.bonecaB = ''; p.cantoB = 'ini'; p.paredeB = 0; }
  L.ambientes = L.ambientes.filter(x => x !== a);
  if (ctx.sel === a.id) { ctx.sel = null; ctx.item = null; }
  if (ctx.amb === a) ctx.amb = null;
  salvarDepois();
  await flush();
  return true;
}

function pavAtual(L) {
  if (!L.pavimentos.some(p => p.id === ctx.pavPlanta)) {
    const comAmb = L.pavimentos.find(p => L.ambientes.some(a => a.pavimentoId === p.id));
    ctx.pavPlanta = (comAmb || L.pavimentos[0]).id;
  }
  return ctx.pavPlanta;
}

function htmlPlanta(L) {
  const pav = pavAtual(L);
  const pv = L.pavimentos.find(p => p.id === pav);
  return `<main class="planta-area">
    ${L.pavimentos.length > 1 ? `<button class="pl-pav-tag" data-acao="pl-ferr">${h(pv.nome || pv.sigla)}</button>` : ''}
    <svg id="planta" class="planta" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Planta baixa"></svg>
    <div id="pl-vazia" class="pl-vazia" hidden>Prancheta vazia. Toque em <b>Ferramentas</b> para desenhar o primeiro ambiente, marcar ambientes ou carregar a planta de fundo.</div>
    <button id="pl-fab" class="pl-fab" data-acao="pl-ferr" aria-label="Ferramentas">${ICONE_FERR}<span>Ferramentas</span><b class="pl-fab-n" hidden></b></button>
  </main>
  <div id="pl-painel" class="pl-painel"></div>`;
}

function iniciarPlanta() {
  const el = $('#planta');
  if (!el) return;
  ligarGestos(el);
  // um desenho interrompido (página recarregada, app fechado) continua de onde parou
  if (!ctx.desenho) {
    const a = ctx.lev.ambientes.find(x => x.desenhando);
    if (a) { ctx.desenho = { amb: a.id, porta: a.ancora || null }; ctx.pavPlanta = a.pavimentoId; ctx.sel = a.id; }
  }
  desenharPlanta();
}

/**
 * Tamanho do desenho em px. Sem viewBox: 1 unidade = 1 px da tela, a partir do canto de cima à
 * esquerda. Assim, se a área mudar de tamanho (painel abrindo, teclado), o desenho não estica
 * nem desloca, e o toque continua caindo exatamente onde está o traço.
 */
function tamanhoSvg(el) {
  el.removeAttribute('viewBox');
  return [el.clientWidth || 360, el.clientHeight || 400];
}
function opcoesPlanta() {
  const L = ctx.lev, pav = pavAtual(L), d = ctx.desenho, a = d && ambPorId(L, d.amb), arr = ctx.arrasto;
  const fundo = opcaoFundo(L, pav), calib = ctx.calibrar ? ctx.calibrar.pontos : null;
  if (arr) return { sel: arr.amb, item: null, mais: false, toque: false, destaque: [arr.amb], invalido: arr.invalido ? arr.amb : null, fundo };
  const livre = !d && !ctx.calibrar && !ctx.marcando && !ctx.moverFundo;
  return { sel: ctx.sel, item: ctx.item, mais: false, toque: livre, desenho: a && (a.pos || a.ancora) ? a.id : null, fundo, calib, mira: opcaoMira() };
}

function desenharPlanta() {
  const L = ctx.lev, el = $('#planta');
  if (!L || !el) return;
  const pav = pavAtual(L);
  const lay = Planta.layout(L, pav);
  if (ctx.sel && !lay.pos.has(ctx.sel) && !lay.marcadores.some(m => m.id === ctx.sel)) { ctx.sel = null; ctx.item = null; }
  if (ctx.item && !Planta.infoItem(lay, ctx.item)) ctx.item = null;
  const [W, H] = tamanhoSvg(el);
  el.classList.toggle('desenhando', !!ctx.desenho);
  const cxFundo = caixaFundo(L, pav);
  const temDesenho = [...lay.pos.values()].some(R => R.verts.length > 1) || lay.marcadores.length > 0 || !!cxFundo;
  if (!temDesenho && !ctx.desenho && !ctx.marcando) { delete ctx.views[pav]; el.innerHTML = ''; painelPlanta(lay); return; }
  if (!temDesenho && !ctx.views[pav]) ctx.views[pav] = { s: 40, ox: W / 2, oy: H / 2 };
  const v0 = ctx.views[pav];
  // reenquadra quando pedido ou quando o ambiente recém-salvo (ou o "+" das portas dele) ficaria fora da tela
  const R0 = ctx.verSel && ctx.sel && lay.pos.get(ctx.sel);
  ctx.verSel = false;
  const fora = v0 && R0 && (v0.ox + (R0.bbox.x0 - 0.8) * v0.s < 0 || v0.ox + (R0.bbox.x1 + 0.8) * v0.s > W ||
    v0.oy - (R0.bbox.y1 + 0.8) * v0.s < 0 || v0.oy - (R0.bbox.y0 - 0.8) * v0.s > H);
  if ((!v0 || ctx.focar || fora) && temDesenho) { ctx.views[pav] = Planta.enquadrar(lay, W, H, null, cxFundo ? [cxFundo] : []); ctx.focar = null; }
  if (ctx.verItem) {
    // centraliza o item recém-selecionado se ele ficou fora da área visível (o painel ocupa parte da tela)
    ctx.verItem = false;
    const c = pontoDoItem(lay, ctx.item), v = ctx.views[pav];
    if (c) {
      const px = v.ox + c[0] * v.s, py = v.oy - c[1] * v.s;
      if (px < 30 || px > W - 60 || py < 30 || py > H - 30) { v.ox += W / 2 - px; v.oy += H / 2 - py; }
    }
  }
  el.innerHTML = Planta.svg(L, pav, lay, ctx.views[pav], opcoesPlanta());
  painelPlanta(lay);
}
let rafPlanta = 0;
function agendarPlanta() {
  if (rafPlanta) return;
  rafPlanta = requestAnimationFrame(() => {
    rafPlanta = 0;
    const L = ctx.lev, el = $('#planta');
    if (!L || !el) return;
    const pav = pavAtual(L);
    if (!ctx.views[pav]) return;
    el.innerHTML = Planta.svg(L, pav, Planta.layout(L, pav), ctx.views[pav], opcoesPlanta());
  });
}

// ── Painel de baixo ──

function painelPlanta(lay) {
  const L = ctx.lev, pav = pavAtual(L), p = $('#pl-painel');
  if (!p) return;
  // botão Ferramentas: número de avisos; prancheta vazia: uma dica no meio
  const avisos = lay.pos.size ? Planta.conferir(L, pav, lay) : [];
  const n = $('#pl-fab .pl-fab-n');
  if (n) { n.hidden = !avisos.length; n.textContent = avisos.length; }
  const vazia = $('#pl-vazia');
  if (vazia) vazia.hidden = !!(lay.pos.size || lay.marcadores.length || fundoDoPav(L, pav) || ctx.desenho || ctx.marcando);
  const fechar = '<button class="pl-x" data-acao="pl-fechar-sel" aria-label="Fechar">×</button>';
  if (ctx.desenho) { p.innerHTML = painelDesenho(); return; }
  if (ctx.marcando) { p.innerHTML = painelMarcando(); return; }
  if (ctx.painelFundo || ctx.calibrar) { const html = painelFundo(); if (html) { p.innerHTML = html; return; } }
  if (ctx.escolha) { p.innerHTML = painelEscolha(); return; }
  if (ctx.item) {
    const html = painelItem(lay);
    if (html) { p.innerHTML = fechar + html; return; }
    ctx.item = null;
  }
  const a = ctx.sel && ambPorId(L, ctx.sel);
  if (a && a.forma === 'marcador') { p.innerHTML = fechar + painelMarcador(a); return; }
  if (!a) { p.innerHTML = ''; return; }
  const c = calc(a), R = lay.pos.get(a.id);
  const portas = lay.portas.filter(g => g.p.ambA === a.id || g.ambB === a.id);
  const formaTxt = a.forma === 'poli' ? `${R ? R.walls.length : '?'} paredes` : `${fmt(num(a.comp))} × ${fmt(num(a.larg))} m`;
  const listaPortas = portas.length ? `<div class="seg pl-portas">${portas.map(g => {
    const x = g.p, deA = x.ambA === a.id;
    const outro = ambPorId(L, deA ? g.ambB : x.ambA);
    const par = deA ? nomeParede(a, +x.parede) : nomeParede(a, g.WB.k);
    return `<button class="chip off" data-acao="pl-sel-porta" data-id="${h(x.id)}">${h(nomeModelo(x.modelo))} ${par} · ${fmt(num(x.largura))}${outro ? ' · ' + h(outro.codigo) : ''}</button>`;
  }).join('')}</div>` : '<p class="dica">Sem portas ainda. Toque numa parede ou em <b>+ Porta</b>.</p>';
  p.innerHTML = `${fechar}
    <div class="pl-sel">
      <div class="pl-sel-t"><b class="num">${h(a.codigo)}</b> ${h(a.nome || '(sem nome)')}</div>
      <div class="pl-sel-s num">${formaTxt} · ${fmt(c.area)} m²${num(a.nivel) ? ' · NV ' + Planta.fmtNivel(num(a.nivel)) : ''}
        <button class="st-tag st-${a.status || 'levantar'} pl-st" data-acao="pl-mais">${h(nomeStatus(a.status))}</button></div>
    </div>
    <div class="pl-acoes g4">
      <button class="btn btn-primary" data-acao="pl-nova-porta">+ Porta</button>
      <button class="btn btn-ghost" data-acao="pl-novo-obj">+ Objeto</button>
      <button class="btn btn-ghost" data-acao="pl-editar-amb">Medidas</button>
      <a class="btn btn-ghost" href="#/l/${h(L.id)}/a/${h(a.id)}">Detalhes</a>
    </div>
    <button class="pl-mais${ctx.plMais ? ' aberto' : ''}" data-acao="pl-mais">${ctx.plMais ? 'Menos' : `Situação e portas${portas.length ? ` (${portas.length})` : ''}`}</button>
    ${ctx.plMais ? `${chipsStatus(a.status)}${listaPortas}` : ''}`;
}

function campoPe(rot, k, val, { numero = true, dica = '', extra = '', attr = 'data-pe' } = {}) {
  const id = fid();
  return `<div class="field${numero ? ' num' : ''}"><label for="${id}">${h(rot)}</label>
    <input id="${id}" class="input" ${attr}="${k}" value="${h(val ?? '')}" autocomplete="off" ${numero ? 'inputmode="decimal" enterkeyhint="done"' : ''} ${extra}>
    ${dica ? `<div class="dica">${dica}</div>` : ''}</div>`;
}
const opcoesPe = (k, atual, lista) => `<div class="seg">${lista.map(([v, t]) =>
  `<button class="chip${atual === v ? '' : ' off'}" data-acao="pe-op" data-k="${k}" data-v="${v}">${h(t)}</button>`).join('')}</div>`;

function painelItem(lay) {
  const L = ctx.lev, it = ctx.item, info = Planta.infoItem(lay, it);
  if (!info) return '';
  const vv = info.valores;
  if (it.tipo === 'seg') {
    const a = ambPorId(L, it.amb), ab = info.vE || info.vD;
    const fechamento = a.forma === 'poli' && it.k >= (a.paredes || []).length;
    const desc = !info.vE && !info.vD
      ? (fechamento ? 'Parede de fechamento: é calculada pelas outras. Para mudar, ajuste as outras paredes ou os ângulos.' : 'Parede inteira: mudar aqui muda a medida do ambiente.')
      : !info.vE || !info.vD ? `Do canto até a ${ab.g.janela ? 'janela' : 'porta'} (a boneca): mudar aqui ${ab.lado === 'A' ? 'move a abertura' : 'move este ambiente'}.`
        : 'Trecho entre duas aberturas.';
    const angulo = a.forma === 'poli' && !fechamento && it.k >= 1 && a.paredes[it.k]
      ? campoPe(`Ângulo no canto ${letra(it.k)} (graus)`, 'ang', a.paredes[it.k].ang, { dica: 'interno, entre a parede anterior e esta; 90 = esquadro, 270 = canto de "L"' }) : '';
    return `<div class="pl-sel"><div class="pl-sel-t">Parede ${nomeParede(a, it.k)} de <b class="num">${h(a.codigo)}</b></div></div>
      ${angulo ? `<div class="grid2">` : ''}${campoPe('Comprimento deste trecho (m)', 'trecho', vexib(vv.trecho), { dica: angulo ? '' : desc, extra: fechamento && !ab ? 'readonly' : '' })}${angulo ? `${angulo}</div><p class="dica">${desc}</p>` : ''}
      <span class="fc-label">Inserir neste ponto da parede</span>
      <div class="pl-acoes g4">
        <button class="btn btn-primary" data-acao="ins" data-v="porta">Porta</button>
        <button class="btn btn-ghost" data-acao="ins" data-v="janela">Janela</button>
        <button class="btn btn-ghost" data-acao="ins" data-v="ponto">Ponto</button>
        <button class="btn btn-ghost" data-acao="ins" data-v="obj">Objeto</button>
      </div>`;
  }
  if (it.tipo === 'porta') {
    const p = info.g.p, A = ambPorId(L, p.ambA), B = info.g.ambB && ambPorId(L, info.g.ambB), jan = Planta.ehJanela(p.modelo);
    const [cI, cF] = cantosDe(A, +p.parede);
    const titulo = jan ? `${nomeModelo(p.modelo)} em ${A.codigo}` : B ? `Porta ${A.codigo} ↔ ${B.codigo}` : `Porta em ${A.codigo}`;
    let opc = '';
    if (!jan && p.modelo !== 'vao') {
      opc += `<div class="field"><span class="fc-label">Abre para</span>${opcoesPe('abre', p.abre, [['dentro', `Dentro de ${A.codigo}`], ['fora', B ? `Dentro de ${B.codigo}` : 'Fora']])}</div>`;
      if (p.modelo === 'giro') opc += `<div class="field"><span class="fc-label">Dobradiça</span>${opcoesPe('lado', p.lado, [['ini', `Lado do canto ${cI}`], ['fim', `Lado do canto ${cF}`]])}</div>`;
      if (p.modelo === 'correr') opc += `<div class="field"><span class="fc-label">Corre para</span>${opcoesPe('lado', p.lado, [['ini', `O canto ${cI}`], ['fim', `O canto ${cF}`]])}</div>`;
    }
    return `<div class="pl-sel"><div class="pl-sel-t">${h(titulo)}</div><div class="pl-sel-s">Parede ${cI}–${cF} de ${h(A.codigo)}. Toque numa cota para editar.</div></div>
      <div class="grid2">${campoPe(`Até o canto ${cI}`, 'esq', vexib(vv.esq))}${campoPe(`Até o canto ${cF}`, 'dir', vexib(vv.dir))}</div>
      <div class="${jan ? 'grid3' : 'grid2'}">${campoPe('Largura (m)', 'larg', vexib(vv.larg))}${campoPe('Altura (m)', 'alt', p.altura)}${jan ? campoPe('Peitoril (m)', 'peit', p.peitoril) : ''}</div>
      <div class="field"><span class="fc-label">Modelo</span>${opcoesPe('modelo', p.modelo, jan ? MODELOS_JANELA : MODELOS_PORTA)}</div>
      ${opc}
      ${B ? `<p class="dica">Liga ${h(A.codigo)} a ${h(B.codigo)} (parede encostada, ${fmt(info.g.t)} m de espessura).</p>` : (!jan ? '<p class="dica">Ainda não liga a outro ambiente. Encoste um ambiente nesta parede (arraste) ou crie um do outro lado.</p>' : '')}
      <div class="pl-acoes g3">
        <button class="btn btn-ghost" data-acao="pe-mais">Mais opções</button>
        ${!jan && !B ? '<button class="btn btn-ghost" data-acao="pe-vizinho">Novo ambiente do outro lado</button>' : ''}
        <button class="btn btn-ghost perigo" data-acao="pe-excluir">Excluir</button>
      </div>`;
  }
  if (it.tipo === 'ponto') {
    const pt = info.pt, a = ambPorId(L, it.amb), [cI, cF] = cantosDe(a, +pt.i.parede), idT = fid();
    return `<div class="pl-sel"><div class="pl-sel-t"><b>${h(pt.cod)}</b> ${h(pt.i.tipo)}</div><div class="pl-sel-s">Parede ${cI}–${cF} de ${h(a.codigo)}. Cotas até o centro do ponto.</div></div>
      <div class="grid2">${campoPe(`Até o canto ${cI}`, 'esq', vexib(vv.esq))}${campoPe(`Até o canto ${cF}`, 'dir', vexib(vv.dir))}</div>
      <div class="field"><label for="${idT}">Tipo</label><select id="${idT}" class="input" data-pe="tipo">${Object.keys(Planta.PONTOS).map(t => `<option${t === pt.i.tipo ? ' selected' : ''}>${h(t)}</option>`).join('')}</select></div>
      <div class="grid2">${campoPe('Altura do piso (m)', 'altura', pt.i.altura)}${campoPe('Quantidade', 'qtd', pt.i.qtd, { extra: 'inputmode="numeric"' })}</div>
      <div class="pl-acoes g2">
        <a class="btn btn-ghost" href="#/l/${h(L.id)}/a/${h(a.id)}">Fotos e detalhes</a>
        <button class="btn btn-ghost perigo" data-acao="pe-excluir">Excluir</button>
      </div>`;
  }
  if (it.tipo === 'obj') {
    const ob = info.obj, o = ob.o, b = ob.b, a = ambPorId(L, it.amb);
    const cotas = Object.keys(vv).map(k => campoPe(`Até a parede ${nomeParede(a, +k.slice(1))}`, k, vexib(vv[k]))).join('');
    const medidas = o.tipo === 'desnivel'
      ? `<div class="grid3">${campoPe('Largura (m)', 'w', o.w || vnum(b.w))}${campoPe('Profund. (m)', 'd', o.d || vnum(b.d))}${campoPe('Nível (m)', 'nivel', o.nivel, { extra: 'placeholder="+0,17"' })}</div>
         <p class="dica">Nível do patamar ou rebaixo, na mesma referência do nível do piso dos ambientes.</p>`
      : `<div class="grid3">${campoPe('Largura (m)', 'w', o.w || vnum(b.w))}${campoPe('Profund. (m)', 'd', o.d || vnum(b.d))}${o.tipo === 'pilar' ? '' : campoPe('Altura (m)', 'h', o.h || vnum(b.h))}</div>`;
    return `<div class="pl-sel"><div class="pl-sel-t">${h(b.nome)} · <b class="num">${h(a.codigo)}</b></div><div class="pl-sel-s">Cotas até as paredes mais próximas. Toque numa cota para editar.</div></div>
      ${cotas ? `<div class="grid2">${cotas}</div>` : ''}
      ${medidas}
      <div class="grid2">${campoPe('Rotação (graus)', 'rot', vnum(num(o.rot) || 0))}
        <div class="field"><span class="fc-label">&nbsp;</span><button class="btn btn-ghost" data-acao="pe-girar">Girar 90°</button></div></div>
      <div class="pl-acoes g2">
        <span></span>
        <button class="btn btn-ghost perigo" data-acao="pe-excluir">Excluir</button>
      </div>`;
  }
  return '';
}

function painelEscolha() {
  const e = ctx.escolha;
  if (e.tipo === 'ponto') {
    return `<div class="pl-sel-t">Qual ponto?</div>
      <div class="seg pl-escolha">${Object.entries(Planta.PONTOS).map(([t, [sg]]) =>
        `<button class="chip off" data-acao="ins-ponto" data-v="${h(t)}"><b>${sg}</b>&nbsp;${h(t)}</button>`).join('')}</div>
      <button class="btn btn-ghost" data-acao="esc-cancelar">Cancelar</button>`;
  }
  return `<div class="pl-sel-t">Qual objeto?</div>
    <div class="pl-biblio">${Object.entries(Planta.BIBLIOTECA).map(([k, b]) =>
      `<button class="bib" data-acao="ins-obj" data-v="${k}">${Planta.iconeObjeto(k)}<span>${h(b.nome)}</span></button>`).join('')}</div>
    <button class="btn btn-ghost" data-acao="esc-cancelar">Cancelar</button>`;
}

/** Aplica a edição de um campo do painel no item selecionado. */
function aplicarPe(k, val) {
  const L = ctx.lev, it = ctx.item, lay = Planta.layout(L, pavAtual(L)), info = Planta.infoItem(lay, it);
  if (!info) return;
  const v = num(val);
  if (it.tipo === 'porta') {
    const p = info.g.p;
    if (k === 'esq') { p.canto = 'ini'; p.boneca = val; }
    else if (k === 'dir') { p.canto = 'fim'; p.boneca = val; }
    else if (k === 'larg') p.largura = val;
    else if (k === 'alt') p.altura = val;
    else if (k === 'peit') p.peitoril = val;
  } else if (it.tipo === 'ponto') {
    const i = info.pt.i;
    if (k === 'esq') i.pos = val;
    else if (k === 'dir') { if (v != null) i.pos = vnum(info.W.len - v); }
    else i[k] = val;
  } else if (it.tipo === 'obj') {
    const o = info.obj.o;
    if (k in info.valores) {
      if (v == null) return;
      // anda na perpendicular da parede escolhida
      const W = info.paredes[k], dlt = v - info.valores[k];
      const local = rotacionar([W.nIn[0] * dlt, W.nIn[1] * dlt], -info.R.rot);
      o.cx = r2((num(o.cx) || 0) + local[0]);
      o.cy = r2((num(o.cy) || 0) + local[1]);
    } else if (['w', 'd', 'h', 'nivel', 'rot'].includes(k)) o[k] = val;
  } else if (it.tipo === 'seg' && k === 'ang') {
    // ângulo do canto inicial da parede (ambiente desenhado): espera um valor plausível antes de aplicar
    const a = ambPorId(L, it.amb), pa = a && a.paredes[it.k];
    if (!pa || v == null || v < 20 || v > 340) return;
    const antes = retrato(L, a), velho = pa.ang, posVelha = { ...a.pos };
    pa.ang = val;
    if (antes && manterCanto(L, a, antes, 'auto') < 0) {
      pa.ang = velho;
      a.pos = posVelha;
      return toast('Com esse ângulo o ambiente ficaria por cima de outro. Mova-o antes ou ajuste o valor.', 4500);
    }
    manterConteudo(L, a, antes);
  } else if (it.tipo === 'seg') {
    if (v == null || v < 0) return;
    const a = ambPorId(L, it.amb), { vE, vD, W } = info;
    const pos = (x, canto, valor) => {
      const p = x.g.p;
      if (x.lado === 'A') { p.canto = canto; p.boneca = vnum(valor); return; }
      // porta do ambiente vizinho: a parede dele corre no sentido oposto; anda com a porta lá
      const atual = canto === 'ini' ? x.ua : W.len - x.ub;
      p.canto = 'ini';
      p.boneca = vnum(x.g.c - (valor - atual) * (canto === 'ini' ? 1 : -1));
    };
    if (!vE && !vD) {
      const antes = retrato(L, a), campo = a.forma === 'poli' ? null : (it.k % 2 === 0 ? 'comp' : 'larg');
      if (a.forma === 'poli' && it.k >= a.paredes.length) return;
      const velho = campo ? a[campo] : a.paredes[it.k].c, posVelha = { ...a.pos };
      if (campo) a[campo] = val; else a.paredes[it.k].c = val;
      if (antes && manterCanto(L, a, antes, 'auto') < 0) {
        if (campo) a[campo] = velho; else a.paredes[it.k].c = velho;
        a.pos = posVelha;
        return toast('Com essa medida o ambiente ficaria por cima de outro. Mova-o antes ou ajuste a medida.', 4500);
      }
      manterConteudo(L, a, antes);
    } else if (!vE) pos(vD, 'ini', v);
    else if (!vD) pos(vE, 'fim', v);
    else if (vD.lado === 'A') pos(vD, 'ini', vE.ub + v);
    else if (vE.lado === 'A') pos(vE, 'fim', W.len - vD.ua + v);
    else pos(vD, 'ini', vE.ub + v);
  }
  salvarDepois();
}
const rotacionar = (p, r) => [p[0] * Math.cos(r) - p[1] * Math.sin(r), p[0] * Math.sin(r) + p[1] * Math.cos(r)];

/** Atualiza os campos do painel que dependem do que foi editado (sem mexer no campo em uso). */
function sincronizarPainel(ativo) {
  const L = ctx.lev, info = Planta.infoItem(Planta.layout(L, pavAtual(L)), ctx.item);
  if (!info) return;
  for (const el of $$('#pl-painel [data-pe]')) {
    if (el === ativo || !(el.dataset.pe in info.valores)) continue;
    el.value = vexib(info.valores[el.dataset.pe]);
  }
}

function pontoDoItem(lay, item) {
  const info = Planta.infoItem(lay, item);
  if (!info) return null;
  if (item.tipo === 'porta') return [(info.g.x1 + info.g.x2) / 2, (info.g.y1 + info.g.y2) / 2];
  if (item.tipo === 'ponto') return [info.pt.cx, info.pt.cy];
  if (item.tipo === 'obj') return info.obj.centro;
  if (item.tipo === 'seg') return Planta.ptW(info.W, (info.u0 + info.u1) / 2);
  return null;
}

function selecionar(item, amb) {
  ctx.verItem = true;
  ctx.item = item;
  ctx.sel = amb;
  ctx.escolha = null;
  desenharPlanta();
}

function inserirAbertura(tipo) {
  const L = ctx.lev, it = ctx.item, lay = Planta.layout(L, pavAtual(L)), info = Planta.infoItem(lay, it);
  if (!info || it.tipo !== 'seg') return;
  const modelo = tipo === 'janela' ? 'janela' : 'giro';
  const [larg, alt, peit] = Planta.PADRAO_ABERTURA[modelo];
  const w = num(larg);
  const meio = it.uToque ?? (info.u0 + info.u1) / 2;
  const s = Math.max(info.u0, Math.min(meio - w / 2, info.u1 - w));
  const p = {
    id: uid(), ambA: it.amb, parede: it.k, modelo, largura: larg, altura: alt, peitoril: peit, abre: 'dentro', lado: 'ini',
    boneca: vnum(s), canto: 'ini', espessura: ls.get('espessura', '0,15'),
  };
  L.portas.push(p);
  salvarDepois();
  selecionar({ tipo: 'porta', id: p.id }, it.amb);
}

function inserirPonto(tipo) {
  const L = ctx.lev, base = ctx.escolha && ctx.escolha.base, lay = Planta.layout(L, pavAtual(L)), info = Planta.infoItem(lay, base);
  if (!info) { ctx.escolha = null; return desenharPlanta(); }
  const a = ambPorId(L, base.amb);
  const s = base.uToque ?? (info.u0 + info.u1) / 2;
  const i = { id: uid(), tipo, qtd: '1', comp: '', altura: Planta.PONTOS[tipo][1], local: '', fotos: [], parede: base.k, pos: vnum(s) };
  a.inst.push(i);
  salvarDepois();
  selecionar({ tipo: 'ponto', amb: a.id, id: i.id }, a.id);
}

function inserirObjeto(tipo) {
  const L = ctx.lev, e = ctx.escolha;
  const b = Planta.BIBLIOTECA[tipo], amb = e.base ? e.base.amb : ctx.sel, a = ambPorId(L, amb);
  if (!a) { ctx.escolha = null; return desenharPlanta(); }
  const o = { id: uid(), tipo, cx: 0, cy: 0, w: '', d: '', h: '', rot: 0, nivel: tipo === 'desnivel' ? vnum((num(a.nivel) || 0) + 0.17) : '' };
  const ws = paredesDoAmb(a), W = e.base && ws[e.base.k];
  if (W) {
    // encosta a parte de trás do objeto na parede tocada (sistema do ambiente)
    const s = Math.max(b.w / 2, Math.min((e.base.uToque ?? W.len / 2), W.len - b.w / 2));
    const c = Planta.ptW(W, s, b.d / 2 + 0.005);
    o.cx = r2(c[0]); o.cy = r2(c[1]);
    o.rot = Math.round(Math.atan2(-W.nIn[0], W.nIn[1]) / Planta.RAD);
  } else {
    const f = Planta.formaLocal(a);
    const c = f.verts.reduce((s, p) => [s[0] + p[0] / f.verts.length, s[1] + p[1] / f.verts.length], [0, 0]);
    o.cx = r2(c[0]); o.cy = r2(c[1]);
  }
  a.objetos.push(o);
  salvarDepois();
  selecionar({ tipo: 'obj', amb: a.id, id: o.id }, a.id);
}

async function excluirItem() {
  const L = ctx.lev, it = ctx.item;
  if (!it) return;
  if (it.tipo === 'porta') {
    const p = L.portas.find(x => x.id === it.id);
    if (!confirm(`Excluir esta ${Planta.ehJanela(p.modelo) ? 'janela' : 'porta'}?`)) return;
    L.portas = L.portas.filter(x => x !== p);
  } else if (it.tipo === 'ponto') {
    const a = ambPorId(L, it.amb), i = a.inst.find(x => x.id === it.id);
    if (!confirm('Excluir este ponto' + (i.fotos.length ? ' e as fotos dele?' : '?'))) return;
    await apagarFotos(i.fotos.map(f => f.id));
    a.inst = a.inst.filter(x => x !== i);
  } else if (it.tipo === 'obj') {
    const a = ambPorId(L, it.amb);
    a.objetos = a.objetos.filter(x => x.id !== it.id);
  }
  ctx.item = null;
  salvarDepois();
  desenharPlanta();
}

function girarObjeto() {
  const a = ctx.item && ambPorId(ctx.lev, ctx.item.amb), o = a && a.objetos.find(x => x.id === ctx.item.id);
  if (!o) return;
  o.rot = ((num(o.rot) || 0) + 90) % 360;
  salvarDepois();
  desenharPlanta();
}

// ── Desenho parede a parede ──
/** Começa um ambiente desenhado. porta: quando ele nasce do "+" de uma porta (a 1ª parede é a da porta). */
function iniciarDesenho({ porta = null, nome = '', ladoPorta = '', bonecaB = '', cantoB = 'ini', nivel = '' } = {}) {
  const L = ctx.lev, pav = pavAtual(L);
  const a = novoAmbiente(L, porta ? ambPorId(L, porta.ambA).pavimentoId : pav);
  Object.assign(a, { forma: 'poli', paredes: [], desenhando: true, pos: null, rot: '0', nome, nivel });
  if (porta) {
    a.paredes.push({ c: ladoPorta });
    a.ancora = porta.id;
    Object.assign(porta, { ambB: a.id, paredeB: 0, bonecaB, cantoB });
  }
  L.ambientes.push(a);
  ctx.desenho = { amb: a.id, porta: porta ? porta.id : null };
  ctx.item = null;
  ctx.escolha = null;
  ctx.sel = a.id;
  salvarDepois();
  desenharPlanta();
}

function painelDesenho() {
  const L = ctx.lev, a = ambPorId(L, ctx.desenho.amb);
  if (!a) { ctx.desenho = null; return ''; }
  const n = a.paredes.length;
  const dica = !a.pos && !a.ancora ? 'Toque na planta onde fica o <b>canto A</b>.'
    : n === 0 ? 'Toque no <b>canto B</b>: a parede fica na horizontal ou na vertical.'
      : n === 1 ? `Toque no <b>canto ${letra(2)}</b>: a parede vira 90° para o lado do toque.`
        : `Toque no <b>canto ${letra(n + 1)}</b>, ou no canto A (ou em <b>Fechar</b>) para fechar o ambiente.`;
  const nome = a.nome ? ` ${h(a.nome)}` : '';
  return `<div class="pl-sel"><div class="pl-sel-t">Desenhando <b class="num">${h(a.codigo)}</b>${nome}${n ? ` <span class="dz-cont">· ${n} parede${n > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="pl-sel-s">${dica}</div></div>
    <div class="pl-acoes g3">
      <button class="btn btn-ghost" data-acao="dz-desfazer"${n === 0 && !a.pos ? ' disabled' : ''}>Desfazer</button>
      <button class="btn btn-ghost perigo" data-acao="dz-cancelar">Cancelar</button>
      <button class="btn btn-primary" data-acao="dz-fechar"${n >= 2 ? '' : ' disabled'}>Fechar</button>
    </div>`;
}

/**
 * Onde cai o próximo canto do desenho para um ponto P da planta (sem gravar nada).
 * Esquadro: a 1ª parede fica na horizontal ou na vertical e cada parede seguinte vira 90° para
 * o lado do toque. Outro ângulo a pessoa digita depois, no campo. O comprimento é a projeção do
 * toque nessa direção, alinhado a um canto já marcado quando passa perto dele.
 */
function proximoCanto(P) {
  const L = ctx.lev, a = ctx.desenho && ambPorId(L, ctx.desenho.amb), pav = pavAtual(L), v = ctx.views[pav];
  if (!a || !v) return null;
  if (!a.pos && !a.ancora) return { tipo: 'A', ate: [r2(P[0]), r2(P[1])] };
  const R = Planta.layout(L, pav).pos.get(a.id);
  if (!R) return null;
  const A0 = R.verts[0], ult = R.verts[R.verts.length - 1];
  // tocar perto do canto A fecha o ambiente
  if (a.paredes.length >= 2 && Math.hypot(P[0] - A0[0], P[1] - A0[1]) * v.s < 18) return { tipo: 'fechar', de: ult, ate: A0 };
  const d = [P[0] - ult[0], P[1] - ult[1]];
  const rumo = Math.atan2(d[1], d[0]) / Planta.RAD;
  const tol = 14 / v.s;                                            // ~14 px na tela, em metros
  const medir = (dirGraus, alinhar) => {
    const u = [Math.cos(dirGraus * Planta.RAD), Math.sin(dirGraus * Planta.RAD)];
    let c = d[0] * u[0] + d[1] * u[1], alinhou = false;
    if (c < 0.05) return null;
    if (alinhar) {
      let melhor = null;
      for (const V of R.verts.slice(0, -1)) {
        const cc = (V[0] - ult[0]) * u[0] + (V[1] - ult[1]) * u[1];
        if (cc > 0.05 && Math.abs(cc - c) < tol && (melhor == null || Math.abs(cc - c) < Math.abs(melhor - c))) melhor = cc;
      }
      if (melhor != null) { c = melhor; alinhou = true; }
    }
    if (!alinhou) c = arredMedida(c);
    return { c, ate: [ult[0] + u[0] * c, ult[1] + u[1] * c] };
  };
  if (a.paredes.length === 0) {
    const dir = (Math.round(rumo / 90) * 90 + 360) % 360;          // só 0, 90, 180 ou 270
    const m = medir(dir, false);
    return m ? { tipo: 'parede', de: ult, ate: m.ate, c: m.c, rot: dir } : { tipo: 'erro', de: ult };
  }
  const anterior = (R.rot + R.local.rumoFinal) / Planta.RAD;
  const giro = ((rumo - anterior + 540) % 360) - 180;              // positivo = virou à esquerda
  const giroAj = giro >= 0 ? 90 : -90;                             // sempre esquadro
  // a primeira curva define o sentido: virar à esquerda = anti-horário (interior à esquerda)
  const sentidoTxt = a.paredes.length === 1 && !a.ancora ? (giroAj < 0 ? 'horario' : 'anti') : a.sentido;
  const sentido = sentidoTxt === 'horario' ? -1 : 1;
  const m = medir(anterior + giroAj, true);
  return m ? { tipo: 'parede', de: ult, ate: m.ate, c: m.c, ang: 180 - sentido * giroAj, sentido: sentidoTxt } : { tipo: 'erro', de: ult };
}

/** Toque na planta durante o desenho: marca o próximo canto. */
function tocarDesenho(ev) {
  const a = ambPorId(ctx.lev, ctx.desenho.amb);
  const k = a && proximoCanto(telaParaPlanta(ev.clientX, ev.clientY));
  ctx.mira = null;
  if (!k) return;
  if (k.tipo === 'fechar') return fecharDesenho();
  if (k.tipo === 'erro') { agendarPlanta(); return toast('Toque para o lado em que a parede segue (90° da anterior). Outro ângulo, digite no campo.'); }
  if (k.tipo === 'A') a.pos = { x: k.ate[0], y: k.ate[1] };
  else if (a.paredes.length === 0) { a.rot = String(k.rot); a.paredes.push({ c: vnum(k.c) }); }
  else {
    if (k.sentido) a.sentido = k.sentido;
    a.paredes.push({ c: vnum(k.c), ang: String(k.ang) });
  }
  salvarDepois();
  desenharPlanta();
}

/** Prévia do próximo canto (mouse parado sobre a planta ou dedo encostado). */
function mirar(x, y) {
  if (!ctx.desenho) { if (ctx.mira) { ctx.mira = null; agendarPlanta(); } return; }
  ctx.mira = x == null ? null : telaParaPlanta(x, y);
  agendarPlanta();
}
function opcaoMira() {
  if (!ctx.desenho || !ctx.mira) return null;
  const k = proximoCanto(ctx.mira);
  if (!k) return null;
  if (k.tipo === 'erro') return { de: k.de, ate: ctx.mira, erro: true };
  return { de: k.de || null, ate: k.ate, txt: k.tipo === 'parede' ? fmt(k.c) : '', fecha: k.tipo === 'fechar' };
}

function aplicarDesenho(k, val) {
  const a = ambPorId(ctx.lev, ctx.desenho.amb);
  if (!a) return;
  if (k === 'nome') a.nome = val;
  else if (k === 'rot') a.rot = val;
  else {
    const [campo, i] = k.split(':');
    if (a.paredes[+i]) a.paredes[+i][campo] = val;
  }
  salvarDepois();
}

function fecharDesenho() {
  const L = ctx.lev, a = ambPorId(L, ctx.desenho.amb);
  if (!a || a.paredes.length < 2) return;
  delete a.desenhando;
  Planta.fixarPosicoes(L);
  ctx.desenho = null;
  ctx.sel = a.id;
  ctx.item = null;
  ctx.verSel = true;
  salvarDepois();
  desenharPlanta();
  const R = Planta.layout(L, pavAtual(L)).pos.get(a.id);
  const W = R && R.walls[R.walls.length - 1];
  if (W) toast(`Ambiente fechado. Para corrigir uma medida ou um ângulo, toque na parede. A última (${letra(W.k)}–A) ficou com ${fmt(W.len)} m e é calculada pelas outras.`, 6500);
}

async function cancelarDesenho() {
  const L = ctx.lev, a = ambPorId(L, ctx.desenho.amb), volta = ctx.desenho.deMarcador;
  ctx.desenho = null;
  if (a && volta) {
    // era um marcador: volta a ser marcador, com a ficha intacta
    Object.assign(a, { forma: 'marcador', pos: volta.pos, paredes: [] });
    delete a.desenhando;
    salvarDepois();
    return desenharPlanta();
  }
  if (a) await excluirAmbiente(L, a, false);
  desenharPlanta();
}

// ── Status, planta de fundo e marcadores ──
const STATUS = Planta.STATUS;
const nomeStatus = s => (STATUS.find(x => x[0] === (s || '')) || STATUS[0])[1];
const chipsStatus = (atual, acao = 'st', extra = '') => `<div class="seg st-chips">${STATUS.map(([v, t]) =>
  `<button class="chip st-chip st-${v || 'levantar'}${(atual || '') === v ? ' on' : ' off'}" data-acao="${acao}" data-v="${v}"${extra}>${h(t)}</button>`).join('')}</div>`;

/** Resumo do levantamento por status (quantos ambientes e marcadores em cada um). */
function resumoStatus(L, pav) {
  const lista = L.ambientes.filter(a => !pav || a.pavimentoId === pav);
  return STATUS.map(([v, t]) => [v, t, lista.filter(a => (a.status || '') === v).length]).filter(x => x[2] > 0);
}
const htmlResumoStatus = (L, pav) => {
  const r = resumoStatus(L, pav);
  return r.length ? `<div class="st-resumo">${r.map(([v, t, n]) => `<span class="st-tag st-${v || 'levantar'}"><b class="num">${n}</b> ${h(t)}</span>`).join('')}</div>` : '';
};

// planta de fundo: imagem guardada junto das fotos, com posição e escala no pavimento
const urlsFundo = new Map();   // fotoId → URL temporária da imagem (evita repetir a imagem inteira a cada desenho)
function fundoDoPav(L, pav) {
  const p = L.pavimentos.find(x => x.id === pav);
  return p && p.fundo && p.fundo.fotoId ? p.fundo : null;
}
function opcaoFundo(L, pav) {
  const f = fundoDoPav(L, pav);
  if (!f) return null;
  const url = urlsFundo.get(f.fotoId);
  if (!url) {
    if (!urlsFundo.has(f.fotoId)) {
      urlsFundo.set(f.fotoId, '');
      db.fotoGet(f.fotoId).then(ft => {
        if (!ft) return;
        fetch(ft.dataUrl).then(r => r.blob()).then(b => { urlsFundo.set(f.fotoId, URL.createObjectURL(b)); desenharPlanta(); });
      });
    }
    return null;
  }
  return { url, x: f.x, y: f.y, w: f.wpx * f.escala, h: f.hpx * f.escala, rot: num(f.rot) || 0, opac: f.opac ?? 0.5 };
}
/** Cantos da imagem de fundo na planta (para enquadrar). */
function caixaFundo(L, pav) {
  const f = fundoDoPav(L, pav);
  if (!f) return null;
  const r = (num(f.rot) || 0) * Planta.RAD, w = f.wpx * f.escala, hh = f.hpx * f.escala;
  const pts = [[0, 0], [w, 0], [w, hh], [0, hh]].map(([x, y]) => [f.x + x * Math.cos(r) - y * Math.sin(r), f.y + x * Math.sin(r) + y * Math.cos(r)]);
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
}

async function receberFundo(file) {
  const L = ctx.lev, pav = pavAtual(L), pv = L.pavimentos.find(p => p.id === pav);
  if (!file) return;
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) return toast('Por enquanto a planta precisa ser imagem (JPG ou PNG). Exporte a página do PDF como imagem ou tire um print.', 6000);
  toast('Carregando a planta…', 20000);
  try {
    const img = await carregarImg(file);
    const dataUrl = reduzir(img, 2600, 0.82);
    const k = Math.min(1, 2600 / Math.max(img.naturalWidth, img.naturalHeight));
    const wpx = Math.round(img.naturalWidth * k), hpx = Math.round(img.naturalHeight * k);
    if (pv.fundo && pv.fundo.fotoId) await apagarFotos([pv.fundo.fotoId]);
    const foto = { id: uid(), levId: L.id, criadoEm: Date.now(), nomeOriginal: file.name || '', dataUrl, thumb: '', tipo: 'fundo' };
    await db.fotoPut(foto);
    // escala provisória: a imagem ocupa a largura visível; depois se calibra com uma medida conhecida
    const el = $('#planta'), v = ctx.views[pav] || { s: 40, ox: el.clientWidth / 2, oy: el.clientHeight / 2 };
    const larguraM = el.clientWidth / v.s * 0.9, escala = larguraM / wpx;
    const cx = (el.clientWidth / 2 - v.ox) / v.s, cy = (v.oy - el.clientHeight / 2) / v.s;
    pv.fundo = { fotoId: foto.id, wpx, hpx, escala, x: cx - wpx * escala / 2, y: cy - hpx * escala / 2, rot: '0', opac: 0.5 };
    ctx.views[pav] = ctx.views[pav] || v;
    salvarDepois();
    ctx.painelFundo = true;
    ctx.calibrar = { pontos: [] };
    desenharPlanta();
    toast('Planta carregada. Agora calibre a escala: toque nas duas pontas de uma medida conhecida.', 6000);
  } catch (e) { toast(e.message, 5000); }
}

function painelFundo() {
  const L = ctx.lev, pav = pavAtual(L), f = fundoDoPav(L, pav);
  if (!f) { ctx.painelFundo = false; return ''; }
  const c = ctx.calibrar;
  if (c) {
    if (c.pontos.length < 2) {
      return `<div class="pl-sel"><div class="pl-sel-t">Calibrar a escala da planta</div>
        <div class="pl-sel-s">Toque na planta no ${c.pontos.length ? '<b>2º ponto</b>' : '<b>1º ponto</b>'} de uma medida conhecida (de preferência longa: uma parede cotada, um eixo).</div></div>
        <div class="pl-acoes g2"><span></span><button class="btn btn-ghost" data-acao="fd-cal-cancelar">Cancelar</button></div>`;
    }
    const atual = Math.hypot(c.pontos[1][0] - c.pontos[0][0], c.pontos[1][1] - c.pontos[0][1]);
    return `<div class="pl-sel"><div class="pl-sel-t">Calibrar a escala da planta</div>
        <div class="pl-sel-s">Na escala atual essa distância mede ${fmt(atual)} m. Informe a medida real.</div></div>
      ${campoPe('Distância real entre os dois pontos (m)', 'dist', '', { attr: 'data-fd' })}
      <div class="pl-acoes g2"><button class="btn btn-primary" data-acao="fd-cal-aplicar">Aplicar</button><button class="btn btn-ghost" data-acao="fd-cal-cancelar">Cancelar</button></div>`;
  }
  const idOp = fid();
  return `<div class="pl-sel"><div class="pl-sel-t">Planta de fundo</div>
      <div class="pl-sel-s">Largura da imagem na escala atual: ${fmt(f.wpx * f.escala)} m. Calibre com uma medida conhecida antes de desenhar por cima.</div></div>
    <div class="grid2">
      <div class="field"><label for="${idOp}">Transparência</label><input id="${idOp}" type="range" min="0.1" max="1" step="0.05" value="${f.opac ?? 0.5}" data-fd="opac"></div>
      ${campoPe('Rotação (graus)', 'rot', f.rot, { attr: 'data-fd' })}
    </div>
    <div class="pl-acoes g3">
      <button class="btn btn-primary" data-acao="fd-calibrar">Calibrar escala</button>
      <button class="btn btn-ghost${ctx.moverFundo ? ' ativo' : ''}" data-acao="fd-mover">${ctx.moverFundo ? 'Mover: ligado' : 'Mover a planta'}</button>
      <button class="btn btn-ghost" data-acao="fd-trocar">Trocar imagem</button>
    </div>
    <div class="pl-acoes g2">
      <button class="btn btn-ghost perigo" data-acao="fd-remover">Remover planta</button>
      <button class="btn btn-ghost" data-acao="fd-fechar">Fechar</button>
    </div>`;
}

function aplicarFundo(k, val) {
  const L = ctx.lev, f = fundoDoPav(L, pavAtual(L));
  if (!f) return;
  if (k === 'opac') f.opac = +val;
  else if (k === 'rot') f.rot = val;
  salvarDepois();
}

function aplicarCalibracao() {
  const L = ctx.lev, f = fundoDoPav(L, pavAtual(L)), c = ctx.calibrar, inp = $('#pl-painel [data-fd="dist"]');
  const real = num(inp && inp.value);
  if (!f || !c || c.pontos.length < 2) return;
  if (!(real > 0)) return toast('Informe a distância real em metros.');
  const [P1, P2] = c.pontos, atual = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]);
  if (atual < 1e-6) return;
  const k = real / atual;
  // amplia em torno do 1º ponto: ele continua no mesmo lugar
  f.escala *= k;
  f.x = P1[0] + (f.x - P1[0]) * k;
  f.y = P1[1] + (f.y - P1[1]) * k;
  ctx.calibrar = null;
  ctx.focar = true;
  salvarDepois();
  desenharPlanta();
  toast(`Escala calibrada. A imagem tem ${fmt(f.wpx * f.escala)} m de largura.`);
}

// marcadores
function painelMarcando() {
  const m = ctx.marcando;
  return `<div class="pl-sel"><div class="pl-sel-t">Novo marcador</div>
      <div class="pl-sel-s">Toque na planta onde fica o ambiente. Ele abre a ficha (fotos, observações, instalações) sem precisar medir agora.</div></div>
    <div class="seg">
      <button class="chip${m.status === '' ? '' : ' off'}" data-acao="mc-status" data-v="">Ambiente da planta</button>
      <button class="chip${m.status === 'novo' ? '' : ' off'}" data-acao="mc-status" data-v="novo">Não consta na planta</button>
    </div>
    <div class="pl-acoes g2"><span></span><button class="btn btn-ghost" data-acao="mc-cancelar">Cancelar</button></div>`;
}

function criarMarcador(P) {
  const L = ctx.lev, pav = pavAtual(L);
  const a = novoAmbiente(L, pav);
  Object.assign(a, { forma: 'marcador', pos: { x: r2(P[0]), y: r2(P[1]) }, rot: '0', status: ctx.marcando.status || '' });
  L.ambientes.push(a);
  ctx.marcando = null;
  ctx.sel = a.id;
  ctx.item = null;
  salvarDepois();
  desenharPlanta();
  toast(`Marcador ${a.codigo} criado. Abra a ficha para registrar.`);
}

function painelMarcador(a) {
  const L = ctx.lev;
  return `<div class="pl-sel">
      <div class="pl-sel-t"><b class="num">${h(a.codigo)}</b> ${h(a.nome || '(sem nome)')} <span class="st-tag st-${a.status || 'levantar'}">${h(nomeStatus(a.status))}</span></div>
      <div class="pl-sel-s">Marcador: ainda sem medidas. Arraste para mudar de lugar.</div>
    </div>
    ${chipsStatus(a.status)}
    <div class="pl-acoes g4">
      <a class="btn btn-primary" href="#/l/${h(L.id)}/a/${h(a.id)}">Ficha</a>
      <button class="btn btn-ghost" data-acao="mc-desenhar">Desenhar</button>
      <button class="btn btn-ghost" data-acao="mc-retangulo">Retângulo</button>
      <button class="btn btn-ghost perigo" data-acao="mc-excluir">Excluir</button>
    </div>`;
}

/** Marcador vira ambiente desenhado parede a parede (a ficha continua a mesma). */
function marcadorParaDesenho(a) {
  const volta = { pos: { ...a.pos } };
  Object.assign(a, { forma: 'poli', paredes: [], desenhando: true, pos: null, rot: '0' });
  ctx.desenho = { amb: a.id, porta: null, deMarcador: volta };
  ctx.item = null;
  ctx.sel = a.id;
  salvarDepois();
  desenharPlanta();
  toast('Toque no canto A do ambiente e siga pelos cantos.');
}

// ── Toque e gestos na planta ──
function zoomPlanta(v, f, px, py) {
  const s2 = Math.max(4, Math.min(600, v.s * f)), k = s2 / v.s;
  v.ox = px - (px - v.ox) * k;
  v.oy = py - (py - v.oy) * k;
  v.s = s2;
}

/**
 * Gestos na planta, como uma folha na prancheta:
 * - dedo (ou caneta): um toque curto chama aoTocar no ponto onde o dedo encostou; arrastar com um
 *   dedo não move a planta (só arrasta o ambiente selecionado, quando arrastar.pode permite);
 * - dois dedos: movem e aproximam/afastam a planta juntos;
 * - mouse: arrastar move a planta, a roda aproxima, clique chama aoTocar, passar por cima chama mirar.
 * arrastar (opcional): inicio(x, y), mover(x, y), soltar(cancelado), pode(alvo).
 * umDedo: um dedo também chama mover (vista 3D: girar); aí dois dedos só aproximam.
 */
function gestos(el, { mover, zoom, aoTocar, arrastar, mirar, umDedo = false }) {
  const pts = new Map();
  let ini = null, moveu = false, alvo = null, dois = null, arr = false, arrIniciado = false, varios = false;
  const limite = e => e.pointerType === 'mouse' ? 5 : 12;              // px que o dedo pode escorregar num toque
  const centro = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { el.setPointerCapture(e.pointerId); } catch { }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, tipo: e.pointerType });
    if (pts.size === 1) {
      ini = { x: e.clientX, y: e.clientY, tipo: e.pointerType }; moveu = false; alvo = e.target; varios = false;
      arr = !!(arrastar && arrastar.pode(e.target)); arrIniciado = false;
      if (mirar && e.pointerType !== 'mouse') mirar(e.clientX, e.clientY);
    } else {
      // segundo dedo: vira gesto de mover/aproximar; nenhum toque é marcado
      varios = true; moveu = true;
      if (arrIniciado) { arrastar.soltar(true); arrIniciado = false; }
      arr = false;
      if (mirar) mirar(null);
      if (pts.size === 2) dois = centro();
    }
  });
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) {
      if (mirar && e.pointerType === 'mouse' && !e.buttons) mirar(e.clientX, e.clientY);
      return;
    }
    const ant = pts.get(e.pointerId), at = { x: e.clientX, y: e.clientY, tipo: e.pointerType };
    pts.set(e.pointerId, at);
    if (pts.size === 1 && !varios) {
      if (!moveu && Math.hypot(at.x - ini.x, at.y - ini.y) > limite(e)) { moveu = true; if (mirar) mirar(null); }
      if (!moveu) return;
      if (arr) {
        if (!arrIniciado) { arrastar.inicio(ini.x, ini.y); arrIniciado = true; }
        arrastar.mover(at.x, at.y);
      } else if (umDedo || e.pointerType === 'mouse') mover(at.x - ant.x, at.y - ant.y);
      // dedo sozinho arrastando: a planta fica parada (é uma folha na prancheta)
    } else if (pts.size === 2 && dois) {
      const c = centro(), r = el.getBoundingClientRect();
      if (!umDedo) mover(c.x - dois.x, c.y - dois.y);
      if (dois.d > 0 && c.d > 0) zoom(c.d / dois.d, c.x - r.left, c.y - r.top);
      dois = c;
    }
  });
  const fim = (e, cancelado) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 2) dois = centro(); else dois = null;
    if (pts.size > 0) return;
    if (arrIniciado) arrastar.soltar(!!cancelado);
    else if (!cancelado && !moveu && !varios && alvo && aoTocar) aoTocar(alvo, { clientX: ini.x, clientY: ini.y, pointerType: ini.tipo });
    else if (mirar && ini && ini.tipo !== 'mouse') mirar(null);
    arrIniciado = false; alvo = null; arr = false;
  };
  el.addEventListener('pointerup', e => fim(e, false));
  el.addEventListener('pointercancel', e => fim(e, true));
  el.addEventListener('pointerleave', e => { if (mirar && e.pointerType === 'mouse' && !pts.size) mirar(null); });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
}

function ligarGestos(el) {
  const vista = () => ctx.views[pavAtual(ctx.lev)];
  gestos(el, {
    mover: (dx, dy) => { const v = vista(); if (v) { v.ox += dx; v.oy += dy; agendarPlanta(); } },
    zoom: (f, px, py) => { const v = vista(); if (v) { zoomPlanta(v, f, px, py); agendarPlanta(); } },
    aoTocar: tocarPlanta,
    mirar,
    arrastar: {
      // arrasta o ambiente selecionado (toque nele e arraste)
      pode: t => {
        if (ctx.moverFundo) return true;
        if (ctx.desenho || ctx.item || ctx.calibrar || ctx.marcando) return false;
        const mc = t.closest('[data-marc]');
        if (mc) return mc.dataset.marc === ctx.sel;
        const g = t.closest('[data-amb]');
        const a = g && g.dataset.amb === ctx.sel && ambPorId(ctx.lev, ctx.sel);
        return !!a;
      },
      inicio: iniciarArrasto,
      mover: moverArrasto,
      soltar: soltarArrasto,
    },
  });
}

/** Ponto da tela → ponto da planta (metros). */
function telaParaPlanta(x, y) {
  const v = ctx.views[pavAtual(ctx.lev)], r = $('#planta').getBoundingClientRect();
  return [(x - r.left - v.ox) / v.s, (v.oy - (y - r.top)) / v.s];
}

// ── Arrastar ambiente: ímã parede com parede e sem sobreposição ──
/** Espessura das paredes entre ambientes (usada pelo ímã). */
const espessuraEntre = L => num(L.espessura) ?? num(ls.get('espessura', '0,15')) ?? 0.15;

function iniciarArrasto(x, y) {
  const L = ctx.lev;
  if (ctx.moverFundo) {
    const f = fundoDoPav(L, pavAtual(L));
    if (f) ctx.arrasto = { fundo: true, P0: telaParaPlanta(x, y), pos0: { x: f.x, y: f.y } };
    return;
  }
  const a = ambPorId(L, ctx.sel);
  if (a && a.forma === 'marcador') { ctx.arrasto = { marcador: true, amb: a.id, P0: telaParaPlanta(x, y), pos0: { ...a.pos } }; return; }
  const R = a && Planta.layout(L, pavAtual(L)).pos.get(a.id);
  if (!R) return;
  a.pos = { x: R.t[0], y: R.t[1] };
  a.rot = String(R.rot / Planta.RAD);
  ctx.arrasto = { amb: a.id, P0: telaParaPlanta(x, y), pos0: { ...a.pos }, rot0: a.rot, invalido: null, encostou: false };
}

function moverArrasto(x, y) {
  const A = ctx.arrasto, L = ctx.lev;
  if (!A) return;
  if (A.fundo || A.marcador) {
    const P = telaParaPlanta(x, y), alvo = A.fundo ? fundoDoPav(L, pavAtual(L)) : ambPorId(L, A.amb).pos;
    alvo.x = A.pos0.x + P[0] - A.P0[0];
    alvo.y = A.pos0.y + P[1] - A.P0[1];
    return agendarPlanta();
  }
  const a = ambPorId(L, A.amb), pav = pavAtual(L), v = ctx.views[pav];
  const P = telaParaPlanta(x, y);
  const t = [A.pos0.x + P[0] - A.P0[0], A.pos0.y + P[1] - A.P0[1]];
  const lay = Planta.layout(L, pav);
  const im = Planta.imantar(lay, a, (num(A.rot0) || 0) * Planta.RAD, t, espessuraEntre(L), Math.max(0.3, 28 / v.s));
  a.pos = { x: im.t[0], y: im.t[1] };
  a.rot = String(im.r / Planta.RAD);
  A.encostou = im.encostou;
  const R = Planta.colocar(a, im.r, im.t);
  R.id = a.id;
  A.invalido = Planta.bateEm(lay, R);
  agendarPlanta();
}

function soltarArrasto(cancelado) {
  const A = ctx.arrasto, L = ctx.lev;
  if (!A) return;
  if (A.fundo || A.marcador) {
    const alvo = A.fundo ? fundoDoPav(L, pavAtual(L)) : ambPorId(L, A.amb).pos;
    if (cancelado) { alvo.x = A.pos0.x; alvo.y = A.pos0.y; }
    alvo.x = r2(alvo.x); alvo.y = r2(alvo.y);
    ctx.arrasto = null;
    salvarDepois();
    return desenharPlanta();
  }
  const a = ambPorId(L, A.amb);
  const volta = cancelado || A.invalido;
  if (volta) { a.pos = A.pos0; a.rot = A.rot0; }
  // guarda com 3 casas (milímetro)
  a.pos = { x: Math.round(a.pos.x * 1000) / 1000, y: Math.round(a.pos.y * 1000) / 1000 };
  a.rot = String(Math.round((num(a.rot) || 0) * 100) / 100);
  ctx.arrasto = null;
  salvarDepois();
  desenharPlanta();
  if (!cancelado && A.invalido) {
    const o = ambPorId(L, A.invalido);
    toast(`Não cabe aí: ${a.codigo} ficaria por cima de ${o ? o.codigo : 'outro ambiente'}. Voltou para onde estava.`, 4500);
  } else if (!cancelado && A.encostou) toast(`${a.codigo} encostado.`);
}

/** Muda a forma/medida do ambiente mantendo um canto parado. 'auto': o primeiro canto que não cause sobreposição. */
function manterCanto(L, a, antes, fixo = 'auto') {
  const n = Planta.formaLocal(a).verts.length;
  const ordem = fixo === 'auto' ? [...Array(Math.min(n, antes.verts.length)).keys()] : [+fixo];
  const r = (num(a.rot) || 0) * Planta.RAD;
  let primeiro = null;
  for (const k of ordem) {
    const alvo = antes.verts[k];
    if (!alvo) continue;
    const R0 = Planta.colocar(a, r, [0, 0]);
    if (!R0.verts[k]) continue;
    a.pos = { x: alvo[0] - R0.verts[k][0], y: alvo[1] - R0.verts[k][1] };
    if (primeiro == null) primeiro = { ...a.pos };
    const lay = Planta.layout(L, a.pavimentoId), R = lay.pos.get(a.id);
    if (!R || !Planta.bateEm(lay, R)) return k;
  }
  if (primeiro) a.pos = primeiro;
  return -1;
}
/** Retrato do ambiente na planta antes de uma mudança: cantos e onde estão portas, pontos e objetos. */
function retrato(L, a) {
  const lay = Planta.layout(L, a.pavimentoId), R = lay.pos.get(a.id);
  if (!R) return null;
  return {
    verts: R.verts.map(p => [...p]),
    portas: lay.portas.filter(g => g.p.ambA === a.id).map(g => ({ p: g.p, P1: [g.x1, g.y1] })),
    pontos: lay.pontos.filter(pt => pt.amb === a.id).map(pt => ({ i: pt.i, P: [pt.px, pt.py] })),
    objs: lay.objetos.filter(o => o.amb === a.id).map(o => ({ o: o.o, C: [...o.centro] })),
  };
}
/** Depois de mudar a medida, devolve portas, pontos e objetos ao mesmo lugar da planta. */
function manterConteudo(L, a, antes) {
  const R = antes && Planta.layout(L, a.pavimentoId).pos.get(a.id);
  if (!R) return;
  const naParede = (k, P) => { const W = R.walls[k]; return W ? (P[0] - W.a[0]) * W.d[0] + (P[1] - W.a[1]) * W.d[1] : null; };
  for (const { p, P1 } of antes.portas) { const s = naParede(+p.parede, P1); if (s != null) { p.canto = 'ini'; p.boneca = vnum(s); } }
  for (const { i, P } of antes.pontos) { const s = naParede(+i.parede, P); if (s != null) i.pos = vnum(s); }
  for (const { o, C } of antes.objs) { const c = R.paraLocal(C); o.cx = r2(c[0]); o.cy = r2(c[1]); }
}

function tocarPlanta(t, ev) {
  if (ctx.desenho) return tocarDesenho(ev);
  if (ctx.calibrar && ctx.calibrar.pontos.length < 2) {
    ctx.calibrar.pontos.push(telaParaPlanta(ev.clientX, ev.clientY));
    desenharPlanta();
    if (ctx.calibrar.pontos.length === 2) { const inp = $('#pl-painel [data-fd="dist"]'); if (inp) inp.focus(); }
    return;
  }
  if (ctx.marcando) return criarMarcador(telaParaPlanta(ev.clientX, ev.clientY));
  if (ctx.moverFundo) return;
  const L = ctx.lev;
  const de = sel => t.closest(sel);
  if (de('[data-mais]')) return abrirVizinho(de('[data-mais]').dataset.mais);
  if (de('[data-cota]')) {
    const inp = $(`#pl-painel [data-pe="${de('[data-cota]').dataset.cota}"]`);
    if (inp) { inp.focus(); inp.select(); }
    return;
  }
  if (de('[data-marc]')) { ctx.item = null; ctx.escolha = null; ctx.sel = de('[data-marc]').dataset.marc; return desenharPlanta(); }
  if (de('[data-ponto]')) { const [amb, id] = de('[data-ponto]').dataset.ponto.split('|'); return selecionar({ tipo: 'ponto', amb, id }, amb); }
  if (de('[data-porta]')) { const p = L.portas.find(x => x.id === de('[data-porta]').dataset.porta); return selecionar({ tipo: 'porta', id: p.id }, p.ambA); }
  if (de('[data-obj]')) { const [amb, id] = de('[data-obj]').dataset.obj.split('|'); return selecionar({ tipo: 'obj', amb, id }, amb); }
  if (de('[data-seg]')) {
    const [amb, k, s0, s1] = de('[data-seg]').dataset.seg.split('|');
    const lay = Planta.layout(L, pavAtual(L)), item = Planta.segmentoEm(lay, amb, +k, +s0, +s1);
    const v = ctx.views[pavAtual(L)], r = $('#planta').getBoundingClientRect();
    const P = [(ev.clientX - r.left - v.ox) / v.s, (v.oy - (ev.clientY - r.top)) / v.s];
    const W = lay.pos.get(amb).walls[+k];
    item.uToque = (P[0] - W.a[0]) * W.d[0] + (P[1] - W.a[1]) * W.d[1];
    return selecionar(item, amb);
  }
  const amb = de('[data-amb]');
  ctx.item = null;
  ctx.escolha = null;
  ctx.sel = amb ? amb.dataset.amb : null;
  desenharPlanta();
}
window.addEventListener('resize', () => { if ($('#planta')) desenharPlanta(); if (rasc) atualizarPrevia(); if (v3) desenhar3D(true); });

// ── Formulários da planta (com pré-visualização) ──
function abrirAmbiente(id) {
  const L = ctx.lev;
  if (!id) {
    const temAmb = L.ambientes.some(a => a.pavimentoId === pavAtual(L));
    return abrirDialogo({ tipo: 'amb', id: null, pav: pavAtual(L), titulo: temAmb ? 'Ambiente sem ligação' : 'Primeiro ambiente', v: { forma: 'ret', nome: '', comp: '', larg: '', nivel: '', peDireito: '' } });
  }
  const a = ambPorId(L, id);
  const v = { forma: a.forma === 'poli' ? 'poli' : 'ret', nome: a.nome, nivel: a.nivel, peDireito: a.peDireito, rot: vnum(num(a.rot) || 0), fechamento: a.fechamento || '', fixo: 'auto' };
  if (v.forma === 'poli') v.paredes = clonar(a.paredes);
  else { v.comp = a.comp; v.larg = a.larg; }
  abrirDialogo({ tipo: 'amb', id, pav: a.pavimentoId, ancora: null, titulo: `${a.codigo}: medidas`, antes: retrato(L, a), v });
}
function abrirPorta(id) {
  const L = ctx.lev;
  if (!id) {
    const a = ambPorId(L, ctx.sel);
    if (!a) return;
    const usadas = new Set(L.portas.filter(p => p.ambA === a.id).map(p => +p.parede));
    const n = paredesDoAmb(a).length;
    const parede = [...Array(n).keys()].find(k => !usadas.has(k)) ?? 0;
    return abrirDialogo({
      tipo: 'porta', id: null, novoId: uid(), ambA: a.id, pav: a.pavimentoId, titulo: `Nova porta em ${a.codigo}`,
      v: { parede, modelo: 'giro', abre: 'dentro', lado: 'ini', largura: '0,80', altura: '2,10', peitoril: '', boneca: '', canto: 'ini', espessura: ls.get('espessura', '0,15') },
    });
  }
  const p = L.portas.find(x => x.id === id);
  const A = ambPorId(L, p.ambA), B = outroLado(L, p);
  abrirDialogo({
    tipo: 'porta', id, ambA: p.ambA, pav: A.pavimentoId, titulo: B ? `Porta ${A.codigo} ↔ ${B.codigo}` : `${nomeModelo(p.modelo)} em ${A.codigo}`,
    v: {
      parede: +p.parede, modelo: p.modelo, abre: p.abre, lado: p.lado, largura: p.largura, altura: p.altura, peitoril: p.peitoril,
      boneca: p.boneca, canto: p.canto, espessura: p.espessura,
    },
  });
}
function abrirVizinho(portaId) {
  const L = ctx.lev, p = L.portas.find(x => x.id === portaId);
  if (!p) return;
  const A = ambPorId(L, p.ambA);
  abrirDialogo({ tipo: 'vizinho', portaId, novoId: uid(), pav: A.pavimentoId, titulo: `Ambiente ao lado de ${A.codigo}`, v: { nome: '', ladoPorta: '', prof: '', bonecaB: '', cantoB: 'ini', nivel: A.nivel || '' } });
}

function abrirDialogo(r) { rasc = r; desenharDialogo(); }
function fecharDialogo() {
  const d = $('#dialogo');
  if (!d || d.hidden) return;
  d.hidden = true;
  d.innerHTML = '';
  rasc = null;
  document.body.classList.remove('travado');
}
function desenharDialogo() {
  const d = $('#dialogo'), r = rasc;
  d.innerHTML = `
    <div class="dl-top">
      <button class="btn btn-ghost" data-acao="dl-cancelar">Cancelar</button>
      <b class="dl-tit">${h(r.titulo)}</b>
      <button class="btn btn-primary" data-acao="dl-salvar">Salvar</button>
    </div>
    <div class="dl-prev"><svg id="dl-svg" class="planta" xmlns="http://www.w3.org/2000/svg"></svg></div>
    <div class="dl-corpo">${formDialogo(r)}<div id="dl-avisos"></div></div>`;
  d.hidden = false;
  document.body.classList.add('travado');
  atualizarPrevia();
}

function campoR(rot, k, val, { dica = '', extra = '', numero = false } = {}) {
  const id = fid();
  return `<div class="field${numero ? ' num' : ''}"><label for="${id}">${h(rot)}</label>
    <input id="${id}" class="input" data-r="${k}" value="${h(val ?? '')}" autocomplete="off" ${numero ? NUM : ''} ${extra}>
    ${dica ? `<div class="dica">${dica}</div>` : ''}</div>`;
}
const opcoes = (k, atual, lista) => `<div class="seg">${lista.map(([v, t]) =>
  `<button class="chip${String(atual) === String(v) ? '' : ' off'}" data-acao="dl-op" data-k="${k}" data-v="${v}">${h(t)}</button>`).join('')}</div>`;

function formDialogo(r) {
  const L = ctx.lev, v = r.v;
  const niveis = `<div class="grid2">${campoR('Nível do piso (m)', 'nivel', v.nivel, { numero: true, extra: 'placeholder="±0,00"', dica: 'Use + ou − para desnível.' })}${campoR('Pé-direito (m)', 'peDireito', v.peDireito, { numero: true, extra: 'placeholder="2,80"', dica: 'Para a vista 3D.' })}</div>`;
  if (r.tipo === 'amb') {
    let medidas;
    if (v.forma === 'poli') {
      medidas = v.paredes.map((p, k) => `<div class="dz-linha">
          <span class="dz-par num">${letra(k)}–${letra(k + 1)}</span>
          ${campoR('Comprimento (m)', `c:${k}`, p.c, { numero: true })}
          ${k === 0 ? (r.ancora ? '<div class="field"><span class="fc-label">Direção</span><span class="dica">a da porta</span></div>'
            : campoR('Direção (graus)', 'rot', v.rot, { numero: true, dica: '0 = para a direita' }))
            : campoR(`Ângulo em ${letra(k)} (graus)`, `ang:${k}`, p.ang, { numero: true, dica: 'interno' })}
        </div>`).join('') +
        `<div class="fc-row"><button class="btn btn-ghost" data-acao="dl-parede-mais">+ Parede</button>${v.paredes.length > 2 ? '<button class="btn btn-ghost" data-acao="dl-parede-menos">− Última parede</button>' : ''}</div>
        ${campoR(`Última parede (${letra(v.paredes.length)}–A) medida (m)`, 'fechamento', v.fechamento, { numero: true, dica: 'Opcional. É calculada; se você mediu, informe para conferir.' })}`;
    } else {
      medidas = r.ancora
        ? `<div class="grid2">${campoR('Parede da porta (m)', 'ladoPorta', v.ladoPorta, { numero: true })}${campoR('Profundidade (m)', 'prof', v.prof, { numero: true })}</div>`
        : `<div class="grid2">${campoR('Comprimento ↔ (m)', 'comp', v.comp, { numero: true })}${campoR('Largura ↕ (m)', 'larg', v.larg, { numero: true })}</div>`;
      medidas += `<p class="dica">Medidas internas, de parede a parede.</p>
        ${campoR('Rotação na planta (graus)', 'rot', v.rot, { numero: true, dica: 'O ímã acerta sozinho ao encostar.' })}
        ${r.id ? '<button class="btn btn-ghost" data-acao="dl-virar-poli">Não é retângulo? Editar parede a parede</button>' : ''}`;
    }
    if (r.id) {
      const n = v.forma === 'poli' ? v.paredes.length + 1 : 4;
      medidas += `<div class="field"><span class="fc-label">Ao mudar medidas, qual canto fica parado</span>
        ${opcoes('fixo', v.fixo, [['auto', 'Automático'], ...[...Array(n).keys()].map(k => [String(k), letra(k)])])}
        <div class="dica">Automático: o primeiro canto que não deixe o ambiente por cima de outro.</div></div>`;
    }
    return `${campoR('Nome do ambiente', 'nome', v.nome, { extra: 'placeholder="Ex.: Sala de reunião" autocapitalize="sentences"' })}
      ${medidas}
      ${niveis}
      ${r.id ? '<button class="btn btn-ghost perigo" data-acao="dl-excluir-amb">Excluir ambiente</button>' : ''}`;
  }
  if (r.tipo === 'porta') {
    const A = ambPorId(L, r.ambA);
    const p = r.id && L.portas.find(x => x.id === r.id);
    const B = p && outroLado(L, p);
    const jan = Planta.ehJanela(v.modelo);
    const [cI, cF] = cantosDe(A, +v.parede);
    let opc = '';
    if (!jan && v.modelo !== 'vao') {
      opc += `<div class="field"><span class="fc-label">Abre para</span>${opcoes('abre', v.abre, [['dentro', `Dentro de ${A.codigo}`], ['fora', B ? `Dentro de ${B.codigo}` : 'Fora']])}</div>`;
      if (v.modelo === 'giro') opc += `<div class="field"><span class="fc-label">Dobradiça</span>${opcoes('lado', v.lado, [['ini', `Lado do canto ${cI}`], ['fim', `Lado do canto ${cF}`]])}</div>`;
      if (v.modelo === 'correr') opc += `<div class="field"><span class="fc-label">Corre para</span>${opcoes('lado', v.lado, [['ini', `O canto ${cI}`], ['fim', `O canto ${cF}`]])}</div>`;
    }
    const nPar = paredesDoAmb(A).length;
    return `<div class="field"><span class="fc-label">Parede de ${h(A.codigo)}</span>
        ${opcoes('parede', v.parede, [...Array(nPar).keys()].map(k => [k, nomeParede(A, k)]))}</div>
      <div class="field"><span class="fc-label">Modelo</span>${opcoes('modelo', v.modelo, B ? MODELOS_PORTA : Planta.MODELOS)}</div>
      <div class="grid2">
        ${campoR('Largura do vão (m)', 'largura', v.largura, { numero: true })}
        ${campoR('Espessura da parede (m)', 'espessura', v.espessura, { numero: true, dica: 'Medida no batente.' })}
      </div>
      <div class="grid2">
        ${campoR('Altura (m)', 'altura', v.altura, { numero: true })}
        ${jan ? campoR('Peitoril (m)', 'peitoril', v.peitoril, { numero: true, dica: 'Do piso até a janela.' }) : ''}
      </div>
      ${campoR(`Boneca em ${A.codigo} (m)`, 'boneca', v.boneca, { numero: true, dica: `Do canto até o batente, medida por dentro de ${h(A.codigo)}.` })}
      ${opcoes('canto', v.canto, [['ini', `Do canto ${cI}`], ['fim', `Do canto ${cF}`]])}
      ${opc}
      ${B ? `<p class="dica">Do outro lado: <b>${h(B.codigo)}</b> (a parede dele encosta nesta).</p>` : ''}
      ${r.id ? `<button class="btn btn-ghost perigo" data-acao="dl-excluir-porta">Excluir ${jan ? 'janela' : 'porta'}</button>` : ''}`;
  }
  // vizinho
  const p = L.portas.find(x => x.id === r.portaId), A = ambPorId(L, p.ambA);
  return `<p class="dica">Porta na parede ${nomeParede(A, +p.parede)} de <b>${h(A.codigo)}</b>, vão de ${fmt(num(p.largura))} m. Agora meça o ambiente do outro lado. A parede da porta dele é a <b>A–B</b>.</p>
    ${campoR('Nome do ambiente', 'nome', v.nome, { extra: 'placeholder="Ex.: Copa" autocapitalize="sentences"' })}
    <div class="grid2">
      ${campoR('Parede da porta (m)', 'ladoPorta', v.ladoPorta, { numero: true, dica: 'A parede A–B, onde está a porta.' })}
      ${campoR('Profundidade (m)', 'prof', v.prof, { numero: true, dica: 'Só se for retângulo.' })}
    </div>
    ${campoR('Boneca neste ambiente (m)', 'bonecaB', v.bonecaB, { numero: true, dica: 'Do canto até o batente da mesma porta, medida por dentro deste ambiente.' })}
    ${opcoes('cantoB', v.cantoB, [['ini', 'Do canto A'], ['fim', 'Do canto B']])}
    ${campoR('Nível do piso (m)', 'nivel', v.nivel, { numero: true, extra: 'placeholder="±0,00"', dica: 'Se houver degrau na porta, informe a diferença aqui.' })}
    <button class="btn btn-ghost" data-acao="dl-viz-livre">Não é retângulo? Desenhar parede a parede</button>`;
}

/** Aplica o rascunho no levantamento L (o real ao salvar, ou uma cópia para a pré-visualização). */
function aplicar(L, r) {
  const v = r.v;
  const medidas = (a, ancora) => {
    const p = ancora && L.portas.find(x => x.id === ancora);
    if (v.forma === 'poli') {
      a.forma = 'poli';
      a.paredes = clonar(v.paredes);
      a.rot = v.rot;
      a.fechamento = v.fechamento;
    } else {
      a.forma = 'ret';
      if (p && 'ladoPorta' in v) {
        if ((+p.paredeB || 0) % 2 === 0) { a.comp = v.ladoPorta; a.larg = v.prof; } else { a.larg = v.ladoPorta; a.comp = v.prof; }
      } else { a.comp = v.comp; a.larg = v.larg; }
    }
    if ('nivel' in v) a.nivel = v.nivel;
    if ('peDireito' in v) a.peDireito = v.peDireito;
  };
  if (r.tipo === 'amb') {
    let a = r.id && ambPorId(L, r.id);
    if (!a) {
      // novo ambiente solto: à direita do que já existe no pavimento
      const lay = Planta.layout(L, r.pav), rs = [...lay.pos.values()];
      const bb = rs.length ? Planta.caixa(rs) : null;
      a = novoAmbiente(L, r.pav);
      a.id = r.novoId || (r.novoId = uid());
      a.pos = bb ? { x: r2(bb.x1 + 1), y: r2(bb.y0) } : { x: 0, y: 0 };
      L.ambientes.push(a);
    }
    a.nome = v.nome;
    medidas(a, null);
    if (v.forma !== 'poli' && 'rot' in v) a.rot = v.rot;
    if (r.antes) { r.cantoUsado = manterCanto(L, a, r.antes, v.fixo || 'auto'); manterConteudo(L, a, r.antes); }
    return { ambId: a.id };
  }
  if (r.tipo === 'porta') {
    let p = r.id && L.portas.find(x => x.id === r.id);
    if (!p) { p = { id: r.novoId, ambA: r.ambA }; L.portas.push(p); }
    Object.assign(p, {
      parede: +v.parede, modelo: v.modelo, abre: v.abre, lado: v.lado, largura: v.largura, altura: v.altura,
      peitoril: v.peitoril, boneca: v.boneca, canto: v.canto, espessura: v.espessura,
    });
    return { portaId: p.id, ambId: p.ambA };
  }
  const p = L.portas.find(x => x.id === r.portaId);
  let b = ambPorId(L, r.novoId);
  if (!b) { b = novoAmbiente(L, ambPorId(L, p.ambA).pavimentoId); b.id = r.novoId; L.ambientes.push(b); }
  b.nome = v.nome;
  // posiciona pela porta uma única vez e depois fica independente (posição própria)
  b.ancora = p.id;
  Object.assign(p, { ambB: b.id, paredeB: 0, bonecaB: v.bonecaB, cantoB: v.cantoB });
  medidas(b, p.id);
  const R = Planta.layout(L, b.pavimentoId).pos.get(b.id);
  if (R) { b.pos = { x: R.t[0], y: R.t[1] }; b.rot = String(R.rot / Planta.RAD); }
  delete b.ancora;
  for (const k of ['ambB', 'paredeB', 'bonecaB', 'cantoB']) delete p[k];
  return { ambId: b.id, portaId: p.id };
}

function atualizarPrevia() {
  const el = $('#dl-svg');
  if (!el || !rasc) return;
  const Lc = normalizar(clonar(ctx.lev));
  const ref = aplicar(Lc, rasc);
  const lay = Planta.layout(Lc, rasc.pav);
  const [W, H] = tamanhoSvg(el);
  const cotas = [], foco = [ref.ambId];
  const p = ref.portaId && Lc.portas.find(x => x.id === ref.portaId);
  let cantos = ref.ambId;
  if (rasc.tipo === 'porta') {
    cotas.push(Planta.cotaBoneca(lay, p.id, 'A', fmt(num(p.boneca) || 0)), Planta.cotaLargura(lay, p.id, fmt(num(p.largura) || 0)));
    const g = lay.portas.find(x => x.p.id === p.id);
    if (g && g.ambB) { cotas.push(Planta.cotaBoneca(lay, p.id, 'B', fmt(g.cB))); foco.push(g.ambB); }
  } else if (rasc.tipo === 'vizinho') {
    foco.push(p.ambA);
    cotas.push(Planta.cotaBoneca(lay, p.id, 'B', fmt(num(rasc.v.bonecaB) || 0)));
  }
  el.innerHTML = Planta.svg(Lc, rasc.pav, lay, Planta.enquadrar(lay, W, H, foco), { cotas: cotas.filter(Boolean), destaque: [ref.ambId], cantos });
  const av = $('#dl-avisos');
  if (av) av.innerHTML = Planta.conferir(Lc, rasc.pav, lay).map(x => `<div class="alerta">${h(x)}</div>`).join('');
}

async function salvarDialogo() {
  const r = rasc, v = r.v;
  if ((r.tipo === 'amb' || r.tipo === 'vizinho') && v.forma !== 'poli') {
    const m1 = num('ladoPorta' in v ? v.ladoPorta : v.comp), m2 = num('prof' in v ? v.prof : v.larg);
    if (!(m1 > 0 && m2 > 0)) return toast('Informe as duas medidas do ambiente.');
  }
  if (v.forma === 'poli' && v.paredes.some(p => !(num(p.c) > 0))) return toast('Informe o comprimento de todas as paredes.');
  if (r.tipo === 'porta') {
    if (!(num(v.largura) > 0)) return toast('Informe a largura do vão.');
    if (num(v.boneca) == null) return toast('Informe a distância da boneca.');
    if (!(num(v.espessura) >= 0)) return toast('Informe a espessura da parede.');
    ls.set('espessura', v.espessura);
  }
  if (r.tipo === 'vizinho' && num(v.bonecaB) == null) return toast('Informe a boneca da porta neste ambiente.');
  if (r.tipo === 'amb' || r.tipo === 'vizinho') {
    const Lc = normalizar(clonar(ctx.lev)), rc = { ...r, v: clonar(v) }, refc = aplicar(Lc, rc);
    const layc = Planta.layout(Lc, r.pav), Rn = layc.pos.get(refc.ambId), outro = Rn && Planta.bateEm(layc, Rn);
    if (outro) {
      const o = ambPorId(Lc, outro);
      return toast(`Assim o ambiente ficaria por cima de ${o ? o.codigo : 'outro'}. ${r.id ? 'Escolha outro canto parado ou mova o ambiente antes.' : 'Ajuste as medidas.'}`, 5000);
    }
  }
  const ref = aplicar(ctx.lev, r);
  ctx.sel = ref.ambId;
  ctx.item = r.tipo === 'porta' ? { tipo: 'porta', id: ref.portaId } : null;
  ctx.verSel = true;
  salvarDepois();
  fecharDialogo();
  desenharPlanta();
  if (r.tipo === 'vizinho') toast('Ambiente desenhado. Toque numa parede dele para continuar.');
}

// ── Vista 3D ──
let v3 = null, modelo3d = null, corte3d = false;
function abrir3D() {
  const L = ctx.lev, pav = pavAtual(L), ov = $('#vista3d');
  modelo3d = Vista3D.montar(L, pav, corte3d ? 1.2 : null);
  if (!modelo3d.faces.length) return toast('Desenhe a planta primeiro.');
  const nomePv = (L.pavimentos.find(p => p.id === pav) || {}).nome || '';
  ov.innerHTML = `<div class="dl-top">
      <button class="btn btn-ghost" data-acao="fechar-3d">Fechar</button>
      <b class="dl-tit">3D${nomePv ? ' · ' + h(nomePv) : ''}</b>
      <button class="btn btn-ghost${corte3d ? ' ativo' : ''}" data-acao="corte-3d" aria-pressed="${corte3d}">Corte</button>
      <button class="btn btn-ghost icone" data-acao="enq-3d" aria-label="Enquadrar">${ICONE_ENQUADRAR}</button>
    </div>
    <svg id="svg3d" class="planta d3" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vista 3D"></svg>
    <p class="d3-dica">Arraste para girar · dois dedos ou a roda do mouse para aproximar</p>`;
  ov.hidden = false;
  document.body.classList.add('travado');
  v3 = { az: -0.6, el: 0.62 };
  desenhar3D(true);
  const el = $('#svg3d');
  gestos(el, {
    mover: (dx, dy) => { v3.az += dx * 0.01; v3.el = Math.max(0.08, Math.min(1.5, v3.el + dy * 0.008)); desenhar3D(); },
    zoom: f => { v3.s = Math.max(3, Math.min(800, v3.s * f)); desenhar3D(); },
    umDedo: true,
  });
}
function desenhar3D(enquadrar) {
  const el = $('#svg3d');
  if (!el || !v3) return;
  const [W, H] = tamanhoSvg(el);
  v3 = enquadrar ? Vista3D.enquadrar(modelo3d, v3, W, H) : Vista3D.centrar(modelo3d, v3, W, H);
  el.innerHTML = Vista3D.svg(modelo3d, v3);
}
function fechar3D() {
  const ov = $('#vista3d');
  if (!ov || ov.hidden) return;
  ov.hidden = true;
  ov.innerHTML = '';
  v3 = modelo3d = null;
  document.body.classList.remove('travado');
}

// ───────────────────────── Fotos ─────────────────────────
function carregarImg(file) {
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Não foi possível ler a imagem.')); };
    img.src = url;
  });
}
function reduzir(img, max, q) {
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * r);
  c.height = Math.round(img.naturalHeight * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
function listaDono(dono) {
  if (!ctx.amb) return null;
  if (dono === 'a') return ctx.amb.fotos;
  const it = ctx.amb.inst.find(i => 'i:' + i.id === dono);
  return it ? it.fotos : null;
}
async function receberFotos(files) {
  const lista = listaDono(donoFoto);
  if (!lista || !files || !files.length) return;
  toast(files.length > 1 ? `Processando ${files.length} fotos…` : 'Processando foto…', 20000);
  let n = 0;
  for (const file of files) {
    try {
      const img = await carregarImg(file);
      const foto = {
        id: uid(), levId: ctx.lev.id, criadoEm: Date.now(), nomeOriginal: file.name || '',
        dataUrl: reduzir(img, 1600, 0.72), thumb: reduzir(img, 320, 0.6),
      };
      await db.fotoPut(foto);
      thumbs.set(foto.id, foto.thumb);
      lista.push({ id: foto.id, legenda: '' });
      n++;
    } catch (e) {
      toast(e.message, 5000);
    }
  }
  if (n) {
    salvarDepois();
    redesenhar();
    toast(n > 1 ? `${n} fotos adicionadas.` : 'Foto adicionada.');
  }
}
async function carregarThumbs() {
  for (const img of $$('img[data-thumb]')) {
    const id = img.dataset.thumb;
    let t = thumbs.get(id);
    if (t === undefined) { const f = await db.fotoGet(id); t = f ? f.thumb : ''; thumbs.set(id, t); }
    if (t) img.src = t;
  }
}
async function apagarFotos(ids) {
  for (const id of ids) { thumbs.delete(id); await db.fotoDel(id); }
}
const fotosDoAmb = a => [...a.fotos.map(f => f.id), ...a.inst.flatMap(i => i.fotos.map(f => f.id))];

async function verFoto(id, dono) {
  const ref = (listaDono(dono) || []).find(f => f.id === id);
  if (!ref) return;
  const f = await db.fotoGet(id);
  const ov = $('#overlay');
  ov.innerHTML = `
    <div class="ov-top">
      <input class="input" id="ov-leg" placeholder="Legenda (opcional)" value="${h(ref.legenda || '')}" aria-label="Legenda da foto">
      <button class="btn btn-ghost" data-ov="fechar">Fechar</button>
    </div>
    <div class="ov-img">${f ? `<img src="${f.dataUrl}" alt="">` : '<p>Foto não encontrada neste aparelho.</p>'}</div>
    <div class="ov-bot"><button class="btn btn-ghost perigo" data-ov="excluir">Excluir foto</button></div>`;
  ov.hidden = false;
  document.body.classList.add('travado');
  ovEstado = { id, dono, ref };
}
function fecharOverlay(atualizar = true) {
  const ov = $('#overlay');
  if (!ov || ov.hidden) return;
  ov.hidden = true;
  ov.innerHTML = '';
  document.body.classList.remove('travado');
  ovEstado = null;
  if (atualizar) redesenhar();
}
async function acaoOverlay(acao) {
  if (acao === 'fechar') return fecharOverlay();
  if (acao === 'excluir' && ovEstado) {
    if (!confirm('Excluir esta foto?')) return;
    const lista = listaDono(ovEstado.dono);
    const i = lista ? lista.findIndex(f => f.id === ovEstado.id) : -1;
    if (i >= 0) lista.splice(i, 1);
    await apagarFotos([ovEstado.id]);
    salvarDepois();
    fecharOverlay();
    toast('Foto excluída.');
  }
}

// ───────────────────────── Exportação ─────────────────────────
function planoFotos(L) {
  const out = [];
  for (const a of ordenar(L)) {
    const cod = nomeArquivo(a.codigo || 'SEM-CODIGO');
    a.fotos.forEach((f, i) => out.push({ id: f.id, arq: `${cod}_${String(i + 1).padStart(2, '0')}.jpg` }));
    a.inst.forEach((it, k) => it.fotos.forEach((f, i) =>
      out.push({ id: f.id, arq: `${cod}_I${String(k + 1).padStart(2, '0')}_${String(i + 1).padStart(2, '0')}.jpg` })));
  }
  const vistos = new Set();
  for (const p of out) {
    let n = p.arq, k = 2;
    while (vistos.has(n)) n = p.arq.replace(/\.jpg$/, `_${k++}.jpg`);
    p.arq = n;
    vistos.add(n);
  }
  return out;
}

function montarAbas(L) {
  const plano = planoFotos(L);
  const arq = new Map(plano.map(p => [p.id, p.arq]));
  const ambs = ordenar(L);
  const posicao = new Map();
  for (const pv of L.pavimentos) for (const [id, r] of Planta.layout(L, pv.id).pos) posicao.set(id, r);
  const txtPartes = a => partesValidas(a).map((p, i) =>
    `${i ? (p.desc ? ' − ' : ' + ') : (p.desc ? '− ' : '')}${fmt(num(p.c))} × ${fmt(num(p.l))}`).join('');

  const ambientes = {
    nome: 'Ambientes', filtro: true,
    colunas: [
      { t: 'Código', w: 10 }, { t: 'Pavimento', w: 14 }, { t: 'Nome', w: 28 }, { t: 'Uso', w: 22 }, { t: 'Forma', w: 11 },
      { t: 'Comprimento (m)', w: 15, fmt: 'dec' }, { t: 'Largura (m)', w: 12, fmt: 'dec' },
      { t: 'Partes (forma irregular)', w: 30 }, { t: 'Paredes / lados (m)', w: 40 },
      { t: 'Área (m²)', w: 11, fmt: 'dec' }, { t: 'Perímetro (m)', w: 13, fmt: 'dec' },
      { t: 'Pé-direito (m)', w: 13, fmt: 'dec' }, { t: 'Volume (m³)', w: 12, fmt: 'dec' },
      { t: 'Piso', w: 22 }, { t: 'Parede', w: 22 }, { t: 'Forro / teto', w: 24 }, { t: 'Conservação', w: 12 },
      { t: 'Qtde fotos', w: 10, fmt: 'int' }, { t: 'Arquivos das fotos', w: 34 }, { t: 'Itens de instalação', w: 12, fmt: 'int' },
      { t: 'Pendências', w: 28 }, { t: 'Observações', w: 44 },
      { t: 'X na planta (m)', w: 13, fmt: 'dec' }, { t: 'Y na planta (m)', w: 13, fmt: 'dec' }, { t: 'Nível do piso (m)', w: 13, fmt: 'dec' }, { t: 'Status', w: 16 },
    ],
    linhas: ambs.map(a => {
      const c = calc(a), ret = a.forma === 'ret', ps = posicao.get(a.id);
      return [
        a.codigo, nomePav(L, a.pavimentoId), a.nome, a.uso, ret ? 'Retangular' : a.forma === 'poli' ? 'Forma livre' : a.forma === 'marcador' ? 'Marcador (sem medidas)' : 'Outra forma',
        ret ? r2(num(a.comp)) : null, ret ? r2(num(a.larg)) : null,
        ret || a.forma === 'poli' ? '' : txtPartes(a),
        a.forma === 'poli' ? (a.paredes || []).map((p, k) => `${Planta.letra(k)}–${Planta.letra(k + 1)} ${fmt(num(p.c))}${k ? ` (${p.ang}°)` : ''}`).join('; ') : ret ? '' : parseLados(a.lados).map(x => fmt(x)).join('; '),
        c.area, c.perim, c.pd != null ? r2(c.pd) : null, c.vol,
        a.piso, a.parede, a.forro, a.conservacao,
        a.fotos.length, a.fotos.map(f => arq.get(f.id)).join(', '), a.inst.length,
        pendencias(a).join(', '), a.obs,
        ps ? r2(ps.x) : a.forma === 'marcador' && a.pos ? r2(num(a.pos.x)) : null, ps ? r2(ps.y) : a.forma === 'marcador' && a.pos ? r2(num(a.pos.y)) : null, num(a.nivel) ?? 0, nomeStatus(a.status),
      ];
    }),
  };

  const portas = {
    nome: 'Portas e janelas', filtro: true,
    colunas: [
      { t: 'Pavimento', w: 14 }, { t: 'Ambiente', w: 12 }, { t: 'Parede', w: 10 }, { t: 'Modelo', w: 14 },
      { t: 'Largura do vão (m)', w: 13, fmt: 'dec' }, { t: 'Altura (m)', w: 10, fmt: 'dec' }, { t: 'Peitoril (m)', w: 10, fmt: 'dec' },
      { t: 'Abre para', w: 14 }, { t: 'Dobradiça / corre para', w: 16 }, { t: 'Espessura da parede (m)', w: 13, fmt: 'dec' },
      { t: 'Boneca (m)', w: 11, fmt: 'dec' }, { t: 'Boneca medida', w: 20 },
      { t: 'Liga a', w: 12 }, { t: 'Boneca no outro ambiente (m)', w: 15, fmt: 'dec' }, { t: 'Boneca medida (outro)', w: 20 },
    ],
    linhas: L.portas.map(p => {
      const A = ambPorId(L, p.ambA);
      const g = Planta.layout(L, A.pavimentoId).portas.find(x => x.p.id === p.id), B = g && g.ambB && ambPorId(L, g.ambB);
      return [
        nomePav(L, A.pavimentoId), A.codigo, nomeParede(A, +p.parede), nomeModelo(p.modelo),
        r2(num(p.largura)), r2(num(p.altura)), Planta.ehJanela(p.modelo) ? r2(num(p.peitoril)) : null,
        ['giro', 'giro2', 'correr', 'correr2'].includes(p.modelo) ? (p.abre === 'fora' ? (B ? 'Dentro de ' + B.codigo : 'Fora') : 'Dentro de ' + A.codigo) : '',
        p.modelo === 'giro' || p.modelo === 'correr' ? 'Lado do canto ' + cantosDe(A, +p.parede)[p.lado === 'fim' ? 1 : 0] : '',
        r2(num(p.espessura)), r2(num(p.boneca)), 'Do canto ' + cantosDe(A, +p.parede)[p.canto === 'fim' ? 1 : 0],
        B ? B.codigo : '', B ? r2(g.cB) : null, B ? 'Do canto ' + cantosDe(B, g.WB.k)[0] + ' de ' + B.codigo : '',
      ];
    }),
  };

  const instalacoes = {
    nome: 'Instalações', filtro: true,
    colunas: [
      { t: 'Código do ambiente', w: 12 }, { t: 'Ambiente', w: 26 }, { t: 'Pavimento', w: 14 }, { t: 'Item', w: 7 },
      { t: 'Tipo', w: 28 }, { t: 'Quantidade', w: 11, fmt: 'int' }, { t: 'Comprimento aprox. (m)', w: 14, fmt: 'dec' },
      { t: 'Altura do piso (m)', w: 13, fmt: 'dec' }, { t: 'Localização / encaminhamento', w: 50 }, { t: 'Arquivos das fotos', w: 34 },
      { t: 'Parede', w: 10 }, { t: 'Posição a partir do 1º canto (m)', w: 16, fmt: 'dec' },
    ],
    linhas: ambs.flatMap(a => a.inst.map((it, k) => {
      const linear = LINEARES.has(it.tipo);
      return [
        a.codigo, a.nome, nomePav(L, a.pavimentoId), `I${String(k + 1).padStart(2, '0')}`, it.tipo,
        linear ? null : num(it.qtd), linear ? r2(num(it.comp)) : null, r2(num(it.altura)), it.local,
        it.fotos.map(f => arq.get(f.id)).join(', '),
        it.parede !== '' && it.parede != null ? nomeParede(a, +it.parede) : '', it.parede !== '' && it.parede != null ? r2(num(it.pos)) : null,
      ];
    })),
  };

  const objetos = {
    nome: 'Objetos', filtro: true,
    colunas: [
      { t: 'Pavimento', w: 14 }, { t: 'Ambiente', w: 12 }, { t: 'Objeto', w: 22 }, { t: 'Largura (m)', w: 11, fmt: 'dec' },
      { t: 'Profundidade (m)', w: 13, fmt: 'dec' }, { t: 'Altura (m)', w: 10, fmt: 'dec' }, { t: 'Rotação (graus)', w: 12, fmt: 'int' },
      { t: 'Centro X no ambiente (m)', w: 15, fmt: 'dec' }, { t: 'Centro Y no ambiente (m)', w: 15, fmt: 'dec' }, { t: 'Nível (m)', w: 10, fmt: 'dec' },
    ],
    linhas: ambs.flatMap(a => a.objetos.map(o => {
      const b = Planta.BIBLIOTECA[o.tipo] || { nome: o.tipo, w: 0, d: 0, h: 0 };
      return [
        nomePav(L, a.pavimentoId), a.codigo, b.nome, num(o.w) ?? b.w, num(o.d) ?? b.d,
        o.tipo === 'pilar' ? (num(a.peDireito) ?? null) : o.tipo === 'desnivel' ? null : (num(o.h) ?? b.h),
        num(o.rot) || 0, num(o.cx) ?? 0, num(o.cy) ?? 0, o.tipo === 'desnivel' ? num(o.nivel) : null,
      ];
    })),
  };

  const resumo = {
    nome: 'Resumo', filtro: false,
    colunas: [{ t: 'Campo', w: 34 }, { t: 'Valor', w: 46, fmt: 'dec' }],
    linhas: [
      ['Filial / obra', L.filial], ['Endereço', L.endereco], ['Responsável', L.responsavel],
      ['Data do levantamento', dataBR(L.data)], ['Observações gerais', L.obs],
      ['Exportado em', dataHoraBR(Date.now())], ['Ferramenta', `Levantamento de Ambientes v${VERSAO}`],
      ['', ''], ['Área por pavimento (m²)', ''],
      ...L.pavimentos.map(p => {
        const doPav = L.ambientes.filter(a => a.pavimentoId === p.id);
        return [`${p.nome || p.sigla} (${doPav.length} ambiente(s))`, somaArea(doPav)];
      }),
      [`Total (${L.ambientes.length} ambiente(s))`, somaArea(L.ambientes)],
      ['Ambientes completos', `${L.ambientes.filter(a => !pendencias(a).length).length} de ${L.ambientes.length}`],
    ],
  };
  return { abas: [ambientes, portas, instalacoes, objetos, resumo], plano };
}

function dataUrlBytes(du) {
  const bin = atob(du.slice(du.indexOf(',') + 1));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function exportar(tipo) {
  const L = ctx.lev;
  await flush();
  toast('Gerando arquivo…', 20000);
  const base = nomeArquivo(`levantamento_${L.filial || 'sem-nome'}_${L.data || hojeISO()}`);
  let blob, nome;
  if (tipo === 'xlsx') {
    blob = new Blob([FCZip.xlsx(montarAbas(L).abas)], { type: MIME_XLSX });
    nome = base + '.xlsx';
  } else if (tipo === 'zip') {
    const { abas, plano } = montarAbas(L);
    const arquivos = [{ nome: base + '.xlsx', dados: FCZip.xlsx(abas) }];
    if (L.ambientes.length) arquivos.push({ nome: base + '_planta.dxf', dados: Planta.dxf(L) });
    for (const p of plano) {
      const f = await db.fotoGet(p.id);
      if (f) arquivos.push({ nome: 'fotos/' + p.arq, dados: dataUrlBytes(f.dataUrl) });
    }
    blob = new Blob(FCZip.zipPartes(arquivos), { type: 'application/zip' });
    nome = base + '.zip';
  } else if (tipo === 'dxf') {
    if (!L.ambientes.length) { $('#toast').hidden = true; return toast('A planta ainda está vazia.'); }
    blob = new Blob([Planta.dxf(L)], { type: 'application/dxf' });
    nome = base + '_planta.dxf';
  } else {
    const ids = new Set([...L.ambientes.flatMap(fotosDoAmb), ...L.pavimentos.filter(p => p.fundo).map(p => p.fundo.fotoId)]);
    const fotos = (await db.fotosDoLev(L.id)).filter(f => ids.has(f.id));
    blob = new Blob([JSON.stringify({
      formato: FORMATO_BACKUP, versaoDados: 1, app: VERSAO, exportadoEm: new Date().toISOString(), levantamento: L, fotos,
    })], { type: 'application/json' });
    nome = base + '_backup.json';
  }
  L.ultimaExportacao = Date.now();
  await db.put(L);
  ctx.arquivoPronto = { file: new File([blob], nome, { type: blob.type }) };
  $('#toast').hidden = true;
  redesenhar();
  window.scrollTo(0, 0);
}

function baixar(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ───────────────────────── Importação ─────────────────────────
async function importar(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch { return toast('Arquivo inválido.', 5000); }
  if (!obj || obj.formato !== FORMATO_BACKUP || !obj.levantamento) return toast('Este arquivo não é um backup do levantamento.', 5000);
  const L = normalizar(obj.levantamento);
  let fotos = Array.isArray(obj.fotos) ? obj.fotos : [];
  const existente = await db.get(L.id);
  if (existente) {
    if (confirm(`"${existente.filial || 'Sem nome'}" já existe neste aparelho.\n\nSubstituir pelo backup? Os dados atuais dele serão perdidos.`)) {
      await apagarFotos((await db.fotosDoLev(L.id)).map(f => f.id));
    } else if (confirm('Importar o backup como uma cópia separada?')) {
      L.id = uid();
      L.filial = (L.filial || 'Sem nome') + ' (cópia)';
      const mapa = new Map(fotos.map(f => [f.id, uid()]));
      const troca = lista => lista.forEach(f => { f.id = mapa.get(f.id) || uid(); });
      for (const a of L.ambientes) { troca(a.fotos); a.inst.forEach(i => troca(i.fotos)); }
      for (const pv of L.pavimentos) if (pv.fundo) pv.fundo.fotoId = mapa.get(pv.fundo.fotoId) || pv.fundo.fotoId;
      fotos = fotos.map(f => ({ ...f, id: mapa.get(f.id) }));
    } else return;
  }
  for (const f of fotos) await db.fotoPut({ ...f, levId: L.id });
  L.ultimaExportacao = L.atualizadoEm = Date.now();
  await db.put(L);
  toast('Backup importado.');
  location.hash = `#/l/${L.id}`;
}

// ───────────────────────── Eventos ─────────────────────────
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.r && rasc) {
    const [campo, k] = el.dataset.r.split(':');
    if (k != null && rasc.v.paredes && rasc.v.paredes[+k]) rasc.v.paredes[+k][campo] = el.value;
    else rasc.v[el.dataset.r] = el.value;
    atualizarPrevia();
    return;
  }
  if (el.dataset.dz && ctx.desenho) { aplicarDesenho(el.dataset.dz, el.value); agendarPlanta(); return; }
  if (el.dataset.fd && el.dataset.fd !== 'dist') { aplicarFundo(el.dataset.fd, el.value); agendarPlanta(); return; }
  if (el.dataset.pe && ctx.item) {
    aplicarPe(el.dataset.pe, el.value);
    agendarPlanta();
    sincronizarPainel(el);
    return;
  }
  if (el.id === 'ov-leg' && ovEstado) { ovEstado.ref.legenda = el.value; salvarDepois(); return; }
  if (!el.dataset.bind || el.type === 'checkbox') return;
  const [o, k] = alvo(el.dataset.bind);
  if (!o) return;
  o[k] = el.value;
  salvarDepois();
  aoEditar(el.dataset.bind);
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.type === 'checkbox' && el.dataset.bind) {
    const [o, k] = alvo(el.dataset.bind);
    if (o) { o[k] = el.checked; salvarDepois(); aoEditar(el.dataset.bind); }
    return;
  }
  if (el.dataset.sel) {
    const key = el.dataset.sel, txt = el.nextElementSibling, [o, k] = alvo(key);
    if (!o) return;
    if (el.value === '__outro__') {
      outroAberto.add(key);
      txt.hidden = false;
      txt.value = '';
      o[k] = '';
      txt.focus();
    } else {
      outroAberto.delete(key);
      txt.hidden = true;
      txt.value = '';
      o[k] = el.value;
    }
    salvarDepois();
    aoEditar(key);
    if (/^i:.+\.tipo$/.test(key)) redesenhar();   // muda entre quantidade e comprimento
    return;
  }
  if (el.hasAttribute('data-mudapav')) {
    const L = ctx.lev, a = ctx.amb;
    if (estaLigado(L, a)) { redesenhar(); return; }
    const antiga = L.pavimentos.find(p => p.id === a.pavimentoId);
    a.pavimentoId = el.value;
    if (antiga && new RegExp('^' + escRe((antiga.sigla || '').toUpperCase()) + '-\\d+$', 'i').test(a.codigo || '')) {
      a.codigo = proximoCodigo(L, el.value);
    }
    ls.set('ultimoPav', el.value);
    salvarDepois();
    redesenhar();
    return;
  }
  if (el.id === 'in-cam' || el.id === 'in-gal') { await receberFotos([...el.files]); el.value = ''; return; }
  if (el.id === 'in-fundo') { if (el.files[0]) await receberFundo(el.files[0]); el.value = ''; return; }
  if (el.id === 'in-import') { if (el.files[0]) await importar(el.files[0]); el.value = ''; return; }
  if (el.id === 'tema') {
    ls.set('tema', el.value);
    if (el.value === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = el.value;
  }
});

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-acao],[data-ov]');
  if (!b || b.disabled) return;
  if (b.closest('#folha')) fecharFolha();
  try {
    if (b.dataset.ov) return await acaoOverlay(b.dataset.ov);
    await acao(b.dataset.acao, b);
  } catch (err) {
    console.error(err);
    toast('Erro: ' + err.message, 6000);
  }
});

async function acao(nome, b) {
  const L = ctx.lev, a = ctx.amb, id = b.dataset.id;
  switch (nome) {
    case 'novo-lev': {
      const novo = novoLevantamento();
      await db.put(novo);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      location.hash = `#/l/${novo.id}/dados`;
      break;
    }
    case 'importar': $('#in-import').click(); break;

    // planta
    case 'pl-pav': Object.assign(ctx, { pavPlanta: id, sel: null, item: null, escolha: null, painelFundo: false, calibrar: null, moverFundo: false, marcando: null }); redesenhar(); break;
    case 'pl-sel-porta': { const p = L.portas.find(x => x.id === id); if (p) selecionar({ tipo: 'porta', id }, p.ambA); break; }
    case 'pl-novo-obj': ctx.item = null; ctx.escolha = { tipo: 'obj', base: null }; desenharPlanta(); break;
    case 'ins': {
      const v = b.dataset.v;
      if (v === 'porta' || v === 'janela') inserirAbertura(v);
      else { ctx.escolha = { tipo: v, base: ctx.item }; desenharPlanta(); }
      break;
    }
    case 'ins-ponto': inserirPonto(b.dataset.v); break;
    case 'ins-obj': inserirObjeto(b.dataset.v); break;
    case 'esc-cancelar': ctx.escolha = null; desenharPlanta(); break;
    case 'pe-op': {
      const p = ctx.item && ctx.item.tipo === 'porta' && L.portas.find(x => x.id === ctx.item.id);
      if (!p) return;
      const k = b.dataset.k, novo = b.dataset.v;
      if (k === 'modelo' && Planta.ehJanela(novo) && Planta.ehJanela(p.modelo) && novo !== p.modelo) {
        const [, altV, peitV] = Planta.PADRAO_ABERTURA[p.modelo], [, altN, peitN] = Planta.PADRAO_ABERTURA[novo];
        if (num(p.altura) === num(altV)) p.altura = altN;
        if (num(p.peitoril) === num(peitV)) p.peitoril = peitN;
      }
      p[k] = novo;
      salvarDepois();
      desenharPlanta();
      break;
    }
    case 'pe-girar': girarObjeto(); break;
    case 'pe-excluir': await excluirItem(); break;
    case 'pe-mais': if (ctx.item && ctx.item.tipo === 'porta') abrirPorta(ctx.item.id); break;
    case 'pe-vizinho': if (ctx.item && ctx.item.tipo === 'porta') abrirVizinho(ctx.item.id); break;
    case 'pl-3d': abrir3D(); break;
    case 'pl-menu': folhaMenu(); break;
    case 'pl-ferr': folhaFerramentas(); break;
    case 'pl-fechar-sel':
      if (ctx.item) ctx.item = null; else ctx.sel = null;
      ctx.escolha = null;
      desenharPlanta();
      break;
    case 'pl-mais': ctx.plMais = !ctx.plMais; desenharPlanta(); break;
    case 'fechar-3d': fechar3D(); break;
    case 'enq-3d': desenhar3D(true); break;
    case 'corte-3d': {
      corte3d = !corte3d;
      const vis = v3;
      modelo3d = Vista3D.montar(L, pavAtual(L), corte3d ? 1.2 : null);
      b.classList.toggle('ativo', corte3d);
      b.setAttribute('aria-pressed', corte3d);
      v3 = vis;
      desenhar3D();
      break;
    }
    case 'pl-zoom': {
      const el = $('#planta'), v = ctx.views[pavAtual(L)];
      if (el && v) { zoomPlanta(v, +b.dataset.v, el.clientWidth / 2, el.clientHeight / 2); agendarPlanta(); }
      break;
    }
    case 'pl-enquadrar': ctx.focar = true; desenharPlanta(); break;
    case 'pl-novo-raiz': abrirAmbiente(null); break;
    case 'pl-desenhar': iniciarDesenho(); break;
    case 'st': {
      const alvo = ctx.amb || ambPorId(L, ctx.sel);
      if (!alvo) return;
      alvo.status = b.dataset.v;
      salvarDepois();
      if (ctx.amb) redesenhar(); else desenharPlanta();
      break;
    }
    case 'fd-carregar': {
      if (fundoDoPav(L, pavAtual(L))) { ctx.painelFundo = true; ctx.sel = null; ctx.item = null; desenharPlanta(); }
      else $('#in-fundo').click();
      break;
    }
    case 'fd-trocar': $('#in-fundo').click(); break;
    case 'fd-calibrar': ctx.calibrar = { pontos: [] }; ctx.moverFundo = false; desenharPlanta(); break;
    case 'fd-cal-aplicar': aplicarCalibracao(); break;
    case 'fd-cal-cancelar': ctx.calibrar = null; desenharPlanta(); break;
    case 'fd-mover': ctx.moverFundo = !ctx.moverFundo; desenharPlanta(); break;
    case 'fd-fechar': ctx.painelFundo = false; ctx.moverFundo = false; ctx.calibrar = null; desenharPlanta(); break;
    case 'fd-remover': {
      const pv = L.pavimentos.find(p => p.id === pavAtual(L));
      if (!pv.fundo || !confirm('Remover a planta de fundo deste pavimento?')) return;
      await apagarFotos([pv.fundo.fotoId]);
      delete pv.fundo;
      ctx.painelFundo = false; ctx.moverFundo = false; ctx.calibrar = null;
      salvarDepois();
      desenharPlanta();
      break;
    }
    case 'mc-novo': ctx.marcando = { status: '' }; ctx.sel = null; ctx.item = null; ctx.painelFundo = false; desenharPlanta(); break;
    case 'mc-status': ctx.marcando.status = b.dataset.v; desenharPlanta(); break;
    case 'mc-cancelar': ctx.marcando = null; desenharPlanta(); break;
    case 'mc-desenhar': { const m = ambPorId(L, ctx.sel); if (m) marcadorParaDesenho(m); break; }
    case 'mc-retangulo': { const m = ambPorId(L, ctx.sel); if (m) abrirAmbiente(m.id); break; }
    case 'mc-excluir': {
      const m = ambPorId(L, ctx.sel);
      if (m && await excluirAmbiente(L, m)) desenharPlanta();
      break;
    }
    case 'dz-desfazer': {
      const a2 = ambPorId(L, ctx.desenho.amb);
      if (a2.paredes.length > (a2.ancora ? 1 : 0)) a2.paredes.pop();
      else if (!a2.ancora) a2.pos = null;
      salvarDepois();
      desenharPlanta();
      break;
    }
    case 'dz-cancelar': await cancelarDesenho(); break;
    case 'dz-fechar': fecharDesenho(); break;
    case 'dl-virar-poli': {
      const v = rasc.v;
      const ladoA = num(v.comp ?? v.ladoPorta), ladoB = num(v.larg ?? v.prof);
      const par = !rasc.ancora || (+(ctx.lev.portas.find(x => x.id === rasc.ancora) || {}).paredeB || 0) % 2 === 0;
      const c0 = vnum(par ? ladoA : ladoB), c1 = vnum(par ? ladoB : ladoA);
      Object.assign(v, { forma: 'poli', paredes: [{ c: c0 }, { c: c1, ang: '90' }, { c: c0, ang: '90' }], rot: v.rot || '0', fechamento: '' });
      desenharDialogo();
      break;
    }
    case 'dl-parede-mais': rasc.v.paredes.push({ c: '', ang: '90' }); desenharDialogo(); break;
    case 'dl-parede-menos': if (rasc.v.paredes.length > 2) rasc.v.paredes.pop(); desenharDialogo(); break;
    case 'dl-viz-livre': {
      const v = rasc.v;
      if (!(num(v.ladoPorta) > 0)) return toast('Informe a medida da parede da porta (A–B) antes.');
      if (num(v.bonecaB) == null) return toast('Informe a boneca da porta neste ambiente antes.');
      const porta = L.portas.find(x => x.id === rasc.portaId);
      fecharDialogo();
      iniciarDesenho({ porta, nome: v.nome, ladoPorta: v.ladoPorta, bonecaB: v.bonecaB, cantoB: v.cantoB, nivel: v.nivel });
      break;
    }
    case 'pl-nova-porta': abrirPorta(null); break;
    case 'pl-editar-amb': if (ctx.sel) abrirAmbiente(ctx.sel); break;
    case 'dl-cancelar': fecharDialogo(); break;
    case 'dl-salvar': await salvarDialogo(); break;
    case 'dl-op': {
      const k = b.dataset.k, novo = b.dataset.v;
      if (k === 'modelo' && Planta.ehJanela(novo) !== Planta.ehJanela(rasc.v.modelo)) {
        [rasc.v.largura, rasc.v.altura, rasc.v.peitoril] = Planta.PADRAO_ABERTURA[novo];
      }
      rasc.v[k] = novo;
      desenharDialogo();
      break;
    }
    case 'dl-excluir-amb': {
      const alvoAmb = ambPorId(L, rasc.id);
      if (alvoAmb && await excluirAmbiente(L, alvoAmb)) { fecharDialogo(); desenharPlanta(); toast('Ambiente excluído.'); }
      break;
    }
    case 'dl-excluir-porta': {
      const p = L.portas.find(x => x.id === rasc.id);
      if (!p) return;
      if (!confirm('Excluir esta porta?')) return;
      L.portas = L.portas.filter(x => x !== p);
      salvarDepois();
      fecharDialogo();
      desenharPlanta();
      break;
    }

    case 'filtro-pav': ctx.filtroPav = id || ''; redesenhar(); break;
    case 'ver-na-planta': {
      ctx.sel = a.id;
      ctx.pavPlanta = a.pavimentoId;
      ctx.focar = a.id;
      location.hash = `#/l/${L.id}`;
      break;
    }
    case 'add-pav': {
      L.pavimentos.push({ id: uid(), nome: '', sigla: '' });
      salvarDepois();
      redesenhar();
      const ins = $$('.pav-linha input');
      if (ins.length > 1) ins[ins.length - 2].focus();
      break;
    }
    case 'del-pav': {
      if (L.ambientes.some(x => x.pavimentoId === id) || L.pavimentos.length === 1) return;
      L.pavimentos = L.pavimentos.filter(p => p.id !== id);
      salvarDepois();
      redesenhar();
      break;
    }
    case 'del-lev': {
      // da lista (data-id) ou da tela Dados do levantamento aberto
      const alvo = id ? await db.get(id) : L;
      if (!alvo) return;
      const Lx = normalizar(alvo), fotos = await db.fotosDoLev(Lx.id);
      const pend = !Lx.ultimaExportacao || Lx.atualizadoEm > Lx.ultimaExportacao;
      const sim = await confirmar({
        titulo: 'Excluir levantamento',
        texto: `<p><b>${h(Lx.filial || 'Levantamento sem nome')}</b>: ${Lx.ambientes.length} ambiente(s) e ${fotos.length} foto(s).</p>` +
          (pend ? '<p class="conf-alerta">Este levantamento ainda não foi exportado. Gere a planilha e o backup antes se precisar dos dados.</p>' : '') +
          '<p>Tudo será apagado deste aparelho. Isso não pode ser desfeito.</p>',
      });
      if (!sim) return;
      if (ctx.lev && ctx.lev.id === Lx.id) { clearTimeout(timerSalvar); timerSalvar = null; ctx.lev = null; }
      await apagarFotos(fotos.map(f => f.id));
      await db.del(Lx.id);
      toast('Levantamento excluído.');
      if (location.hash === '#/' || location.hash === '') await telaInicio();
      else location.hash = '#/';
      break;
    }

    case 'forma': {
      if (a.forma === b.dataset.v) return;
      a.forma = b.dataset.v;
      if (a.forma === 'irr' && !a.partes.length) a.partes.push(novaParte(a.comp, a.larg));
      salvarDepois();
      redesenhar();
      break;
    }
    case 'add-parte': a.partes.push(novaParte()); salvarDepois(); redesenhar(); break;
    case 'del-parte': a.partes = a.partes.filter(p => p.id !== id); salvarDepois(); redesenhar(); break;
    case 'conserv': a.conservacao = a.conservacao === b.dataset.v ? '' : b.dataset.v; salvarDepois(); redesenhar(); break;

    case 'foto': {
      donoFoto = b.dataset.dono;
      const inp = $(b.dataset.cam ? '#in-cam' : '#in-gal');
      inp.value = '';
      inp.click();
      break;
    }
    case 'ver-foto': await verFoto(id, b.dataset.dono); break;

    case 'add-inst': {
      a.inst.push(novaInst());
      salvarDepois();
      redesenhar();
      const sels = $$('.inst select');
      if (sels.length) sels[sels.length - 1].scrollIntoView({ block: 'center' });
      break;
    }
    case 'del-inst': {
      const it = a.inst.find(i => i.id === id);
      if (!it) return;
      if ((it.tipo || it.local || it.fotos.length) && !confirm('Remover este item de instalação' + (it.fotos.length ? ' e as fotos dele' : '') + '?')) return;
      await apagarFotos(it.fotos.map(f => f.id));
      a.inst = a.inst.filter(i => i.id !== id);
      salvarDepois();
      redesenhar();
      break;
    }

    case 'del-amb': {
      if (await excluirAmbiente(L, a)) location.hash = `#/l/${L.id}`;
      break;
    }

    case 'exp-dxf': await exportar('dxf'); break;
    case 'exp-xlsx': await exportar('xlsx'); break;
    case 'exp-zip': await exportar('zip'); break;
    case 'exp-json': await exportar('json'); break;
    case 'baixar': if (ctx.arquivoPronto) baixar(ctx.arquivoPronto.file); break;
    case 'compartilhar': {
      const f = ctx.arquivoPronto && ctx.arquivoPronto.file;
      if (!f) return;
      try { await navigator.share({ files: [f], title: f.name }); }
      catch (err) { if (err.name !== 'AbortError') { toast('Não deu para enviar daqui. Use "Baixar".', 5000); } }
      break;
    }
  }
}

// ───────────────────────── Funcionamento offline e atualização ─────────────────────────
// No computador de desenvolvimento (localhost) o modo offline fica desligado para sempre carregar
// o código novo. Para testá-lo localmente, abra com ?sw=1.
const EM_DESENVOLVIMENTO = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/[?&]sw=1/.test(location.search);
if (EM_DESENVOLVIMENTO && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
} else if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const tinhaControle = !!navigator.serviceWorker.controller;
  const avisar = w => {
    const b = $('#banner');
    b.hidden = false;
    b.querySelector('button').onclick = async () => { await flush(); w.postMessage('atualizar'); };
  };
  // Acompanha a versão nova em qualquer estágio: ela pode já estar instalada, ainda instalando
  // (a verificação começa junto com o register, antes de o "then" rodar) ou chegar depois.
  const acompanhar = w => {
    if (!w) return;
    const ver = () => { if (w.state === 'installed' && navigator.serviceWorker.controller) avisar(w); };
    ver();
    w.addEventListener('statechange', ver);
  };
  navigator.serviceWorker.register('sw.js').then(reg => {
    acompanhar(reg.waiting);
    acompanhar(reg.installing);
    reg.addEventListener('updatefound', () => acompanhar(reg.installing));
  }).catch(err => console.warn('Sem modo offline:', err));
  let recarregando = false;
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!tinhaControle || recarregando) return;
    recarregando = true;
    await flush();
    location.reload();
  });
}

if (!window.indexedDB) {
  $('#app').innerHTML = '<main class="wrap"><div class="card sec">Este navegador não permite guardar dados. Abra a ferramenta no Chrome, Edge ou Safari atualizados.</div></main>';
} else {
  rotear();
}
