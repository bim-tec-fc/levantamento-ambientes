/* ═══════════════════════════════════════════════════════════════════════════
   Levantamento de Ambientes, v1
   Núcleo BIM · Ferreira Costa · Melqui Domingos

   Ferramenta de campo para levantar ambientes (arquitetura) e indicar pontos de
   instalações e encaminhamentos. Funciona sem internet: os dados ficam no
   IndexedDB do aparelho até serem exportados (Excel, ZIP com fotos ou backup JSON).
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const VERSAO = '1.0.0';
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
const ctx = { lev: null, amb: null, filtroPav: '', arquivoPronto: null };
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
    ambientes: [], criadoEm: Date.now(), atualizadoEm: Date.now(), ultimaExportacao: null,
  };
}
function novoAmbiente(L, pavId) {
  return {
    id: uid(), codigo: proximoCodigo(L, pavId), pavimentoId: pavId, nome: '', uso: '',
    forma: 'ret', comp: '', larg: '', partes: [], lados: '', peDireito: '',
    piso: '', parede: '', forro: '', conservacao: '', obs: '', fotos: [], inst: [], criadoEm: Date.now(),
  };
}
const novaParte = (c = '', l = '') => ({ id: uid(), c, l, desc: false });
const novaInst = () => ({ id: uid(), tipo: '', qtd: '1', comp: '', altura: '', local: '', fotos: [] });

/** Garante que dados antigos ou importados tenham todos os campos. */
function normalizar(L) {
  L.pavimentos = Array.isArray(L.pavimentos) && L.pavimentos.length ? L.pavimentos : [{ id: uid(), nome: 'Térreo', sigla: 'T' }];
  L.ambientes = Array.isArray(L.ambientes) ? L.ambientes : [];
  for (const a of L.ambientes) {
    a.partes = Array.isArray(a.partes) ? a.partes : [];
    a.fotos = Array.isArray(a.fotos) ? a.fotos : [];
    a.inst = Array.isArray(a.inst) ? a.inst : [];
    for (const i of a.inst) i.fotos = Array.isArray(i.fotos) ? i.fotos : [];
    for (const k of ['codigo', 'nome', 'uso', 'comp', 'larg', 'lados', 'peDireito', 'piso', 'parede', 'forro', 'conservacao', 'obs']) a[k] = a[k] ?? '';
    a.forma = a.forma === 'irr' ? 'irr' : 'ret';
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
  if (a.forma === 'ret') {
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
  const medidas = a.forma === 'ret' ? [num(a.comp), num(a.larg)] : a.partes.flatMap(p => [num(p.c), num(p.l)]);
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
      return telaLev(p[2] || 'ambientes');
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

function render({ titulo, sub, voltar, corpo, rodape, abas }) {
  $('#app').innerHTML = `
  <header class="fc-topbar tb">
    <div class="tb-in">
      ${voltar ? `<a class="voltar" href="${voltar}" aria-label="Voltar">${ICONE_VOLTAR}</a>` : ''}
      <div class="tb-tit">
        <div class="fc-brand">${h(sub || 'Núcleo BIM · Ferreira Costa')}</div>
        <h1 class="fc-title" id="titulo">${h(titulo)}</h1>
      </div>
      <span id="salvo" class="salvo"></span>
    </div>
    ${abas || ''}
  </header>
  <main class="wrap${rodape ? ' com-rodape' : ''}">${corpo}</main>
  ${rodape ? `<div class="bottombar">${rodape}</div>` : ''}`;
}

/** Redesenha a tela atual mantendo a rolagem. */
function redesenhar() {
  const y = window.scrollY;
  if (ctx.amb) telaAmbiente(); else if (ctx.lev) telaLev(abaAtual()); else telaInicio();
  window.scrollTo(0, y);
}
const abaAtual = () => location.hash.split('/')[3] || 'ambientes';

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

// ───────────────────────── Tela: início ─────────────────────────
async function telaInicio() {
  const levs = (await db.todos()).map(normalizar).sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
  const lista = levs.length ? levs.map(L => {
    const pend = !L.ultimaExportacao || L.atualizadoEm > L.ultimaExportacao;
    return `<a class="card item" href="#/l/${h(L.id)}">
      <div class="item-c">
        <div class="item-t">${h(L.filial || 'Levantamento sem nome')}</div>
        <div class="item-s">${h(dataBR(L.data))}${L.responsavel ? ' · ' + h(L.responsavel) : ''}</div>
        <div class="item-s num">${L.ambientes.length} ambiente(s) · ${fmt(somaArea(L.ambientes))} m²</div>
      </div>
      <span class="farol ${pend ? 'a' : 'g'}">${pend ? 'Não exportado' : 'Exportado'}</span>
    </a>`;
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
  const abas = `<nav class="tabs">${[['ambientes', 'Ambientes'], ['dados', 'Dados'], ['exportar', 'Exportar']]
    .map(([k, t]) => `<a class="tab${aba === k ? ' on' : ''}" href="${base}${k === 'ambientes' ? '' : '/' + k}">${t}</a>`).join('')}</nav>`;
  let corpo, rodape = '';
  if (aba === 'dados') corpo = htmlDados(L);
  else if (aba === 'exportar') corpo = htmlExportar(L);
  else {
    corpo = htmlAmbientes(L);
    rodape = `<button class="btn btn-primary" data-acao="add-amb">+ Novo ambiente</button>`;
  }
  render({ titulo: L.filial || 'Sem nome', sub: 'Levantamento', voltar: '#/', corpo, rodape, abas });
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
      <div class="item-d"><div class="num item-area">${c.area != null ? fmt(c.area) + ' m²' : '–'}</div>
        <span class="farol ${classeFarol(pct)}">${pct}%</span></div>
    </a>`;
  }).join('') : `<div class="card vazio">Nenhum ambiente${f ? ' neste pavimento' : ''} ainda.<br>Toque em <b>+ Novo ambiente</b>.</div>`;
  return kpis + chips + lista;
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
    <button class="exp" data-acao="exp-xlsx"><b>Planilha Excel (.xlsx)</b>
      <span>Abas de ambientes, instalações e resumo por pavimento.</span></button>
    <button class="exp" data-acao="exp-zip"><b>Planilha + fotos (.zip)</b>
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

  const medidas = a.forma === 'ret'
    ? `<div class="grid2">${campoNum('Comprimento', 'a.comp', a.comp)}${campoNum('Largura', 'a.larg', a.larg)}</div>`
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
          <select id="${idPav}" class="input" data-mudapav>${pavOpts}</select></div>
      </div>
      ${campo('Nome do ambiente', 'a.nome', a.nome, { extra: 'placeholder="Ex.: Depósito de cerâmica" enterkeyhint="next" autocapitalize="sentences"' })}
      ${campoLista('Uso', 'a.uso', USOS, a.uso)}
    </section>

    <section class="card sec">
      <h2 class="fc-h2">Medidas (m)</h2>
      <div class="seg">
        <button class="chip${a.forma === 'ret' ? '' : ' off'}" data-acao="forma" data-v="ret">Retangular</button>
        <button class="chip${a.forma === 'irr' ? '' : ' off'}" data-acao="forma" data-v="irr">Outra forma</button>
      </div>
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
      <button class="btn btn-ghost" data-acao="dup-amb">Duplicar ambiente</button>
      <button class="btn btn-ghost perigo" data-acao="del-amb">Excluir ambiente</button>
    </section>`,
    rodape: `<a class="btn btn-ghost" href="#/l/${h(L.id)}">Lista</a>
             <button class="btn btn-primary" data-acao="prox-amb">+ Próximo ambiente</button>`,
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
  const txtPartes = a => partesValidas(a).map((p, i) =>
    `${i ? (p.desc ? ' − ' : ' + ') : (p.desc ? '− ' : '')}${fmt(num(p.c))} × ${fmt(num(p.l))}`).join('');

  const ambientes = {
    nome: 'Ambientes', filtro: true,
    colunas: [
      { t: 'Código', w: 10 }, { t: 'Pavimento', w: 14 }, { t: 'Nome', w: 28 }, { t: 'Uso', w: 22 }, { t: 'Forma', w: 11 },
      { t: 'Comprimento (m)', w: 15, fmt: 'dec' }, { t: 'Largura (m)', w: 12, fmt: 'dec' },
      { t: 'Partes (forma irregular)', w: 30 }, { t: 'Lados (m)', w: 24 },
      { t: 'Área (m²)', w: 11, fmt: 'dec' }, { t: 'Perímetro (m)', w: 13, fmt: 'dec' },
      { t: 'Pé-direito (m)', w: 13, fmt: 'dec' }, { t: 'Volume (m³)', w: 12, fmt: 'dec' },
      { t: 'Piso', w: 22 }, { t: 'Parede', w: 22 }, { t: 'Forro / teto', w: 24 }, { t: 'Conservação', w: 12 },
      { t: 'Qtde fotos', w: 10, fmt: 'int' }, { t: 'Arquivos das fotos', w: 34 }, { t: 'Itens de instalação', w: 12, fmt: 'int' },
      { t: 'Pendências', w: 28 }, { t: 'Observações', w: 44 },
    ],
    linhas: ambs.map(a => {
      const c = calc(a), ret = a.forma === 'ret';
      return [
        a.codigo, nomePav(L, a.pavimentoId), a.nome, a.uso, ret ? 'Retangular' : 'Outra forma',
        ret ? r2(num(a.comp)) : null, ret ? r2(num(a.larg)) : null,
        ret ? '' : txtPartes(a), ret ? '' : parseLados(a.lados).map(x => fmt(x)).join('; '),
        c.area, c.perim, c.pd != null ? r2(c.pd) : null, c.vol,
        a.piso, a.parede, a.forro, a.conservacao,
        a.fotos.length, a.fotos.map(f => arq.get(f.id)).join(', '), a.inst.length,
        pendencias(a).join(', '), a.obs,
      ];
    }),
  };

  const instalacoes = {
    nome: 'Instalações', filtro: true,
    colunas: [
      { t: 'Código do ambiente', w: 12 }, { t: 'Ambiente', w: 26 }, { t: 'Pavimento', w: 14 }, { t: 'Item', w: 7 },
      { t: 'Tipo', w: 28 }, { t: 'Quantidade', w: 11, fmt: 'int' }, { t: 'Comprimento aprox. (m)', w: 14, fmt: 'dec' },
      { t: 'Altura do piso (m)', w: 13, fmt: 'dec' }, { t: 'Localização / encaminhamento', w: 50 }, { t: 'Arquivos das fotos', w: 34 },
    ],
    linhas: ambs.flatMap(a => a.inst.map((it, k) => {
      const linear = LINEARES.has(it.tipo);
      return [
        a.codigo, a.nome, nomePav(L, a.pavimentoId), `I${String(k + 1).padStart(2, '0')}`, it.tipo,
        linear ? null : num(it.qtd), linear ? r2(num(it.comp)) : null, r2(num(it.altura)), it.local,
        it.fotos.map(f => arq.get(f.id)).join(', '),
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
  return { abas: [ambientes, instalacoes, resumo], plano };
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
    for (const p of plano) {
      const f = await db.fotoGet(p.id);
      if (f) arquivos.push({ nome: 'fotos/' + p.arq, dados: dataUrlBytes(f.dataUrl) });
    }
    blob = new Blob(FCZip.zipPartes(arquivos), { type: 'application/zip' });
    nome = base + '.zip';
  } else {
    const ids = new Set(L.ambientes.flatMap(fotosDoAmb));
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

    case 'filtro-pav': ctx.filtroPav = id || ''; redesenhar(); break;
    case 'add-amb': case 'prox-amb': {
      const pav = nome === 'prox-amb' && a ? a.pavimentoId
        : ctx.filtroPav || (L.pavimentos.some(p => p.id === ls.get('ultimoPav')) ? ls.get('ultimoPav') : L.pavimentos[0].id);
      const n = novoAmbiente(L, pav);
      L.ambientes.push(n);
      salvarDepois();
      await flush();
      location.hash = `#/l/${L.id}/a/${n.id}`;
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
      if (!confirm(`Excluir "${L.filial || 'Sem nome'}" e todas as fotos deste aparelho?\n\nIsso não pode ser desfeito.`)) return;
      clearTimeout(timerSalvar);
      timerSalvar = null;
      await apagarFotos((await db.fotosDoLev(L.id)).map(f => f.id));
      await db.del(L.id);
      ctx.lev = null;
      location.hash = '#/';
      toast('Levantamento excluído.');
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

    case 'dup-amb': {
      const n = clonar(a);
      Object.assign(n, {
        id: uid(), codigo: proximoCodigo(L, a.pavimentoId), nome: a.nome ? a.nome + ' (cópia)' : '',
        fotos: [], inst: [], criadoEm: Date.now(), partes: n.partes.map(p => ({ ...p, id: uid() })),
      });
      L.ambientes.push(n);
      salvarDepois();
      await flush();
      toast('Ambiente duplicado (sem fotos e sem instalações).');
      location.hash = `#/l/${L.id}/a/${n.id}`;
      break;
    }
    case 'del-amb': {
      if (!confirm(`Excluir o ambiente ${tituloAmb(a)} e as fotos dele?`)) return;
      await apagarFotos(fotosDoAmb(a));
      L.ambientes = L.ambientes.filter(x => x !== a);
      ctx.amb = null;
      salvarDepois();
      await flush();
      location.hash = `#/l/${L.id}`;
      break;
    }

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
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const tinhaControle = !!navigator.serviceWorker.controller;
  const avisar = w => {
    const b = $('#banner');
    b.hidden = false;
    b.querySelector('button').onclick = async () => { await flush(); w.postMessage('atualizar'); };
  };
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (reg.waiting && tinhaControle) avisar(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) avisar(w); });
    });
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
