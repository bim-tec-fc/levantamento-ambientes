/* ═══════════════════════════════════════════════════════════════════════════
   sw.js: guarda a ferramenta no aparelho para funcionar sem internet.
   AO PUBLICAR QUALQUER MUDANÇA, altere VERSAO abaixo (e a VERSAO do app.js):
   é isso que faz os celulares baixarem a versão nova.
   Núcleo BIM · Ferreira Costa · Melqui Domingos
   ═══════════════════════════════════════════════════════════════════════════ */
const VERSAO = 'levamb-1.2.0';
const ARQUIVOS = [
  './', './index.html', './app.js', './xlsx.js', './planta.js', './vista3d.js', './fc-base.css', './app.css', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
  './fonts/barlow-400.woff2', './fonts/barlow-500.woff2', './fonts/barlow-600.woff2', './fonts/barlow-700.woff2',
  './fonts/barlow-condensed-500.woff2', './fonts/barlow-condensed-600.woff2', './fonts/barlow-condensed-700.woff2',
];

self.addEventListener('install', e => {
  // cache: 'reload' evita pegar arquivo velho do cache HTTP do GitHub Pages.
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('levamb-') && k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'atualizar') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).catch(() =>
      req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
