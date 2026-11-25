/* ═══════════════════════════════════════════════════════════════════════════
   xlsx.js: gera planilha .xlsx e arquivo .zip sem nenhuma biblioteca externa.
   Os arquivos vão sem compressão (método "store"): fotos JPG já são comprimidas
   e a planilha é pequena, então o ganho de comprimir não compensa o código.
   Levantamento de Ambientes · Núcleo BIM · Ferreira Costa · Melqui Domingos
   ═══════════════════════════════════════════════════════════════════════════ */
(function (raiz) {
  'use strict';

  // ── CRC-32 (exigido pelo formato ZIP) ──
  const TAB = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();

  function dataHoraDOS(d) {
    const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const data = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return [hora, data];
  }

  /**
   * Monta um ZIP. arquivos = [{ nome, dados: Uint8Array | string }].
   * Devolve a lista de pedaços (Uint8Array) para virar Blob sem copiar tudo de novo.
   */
  function zipPartes(arquivos) {
    const partes = [], central = [];
    const [hora, data] = dataHoraDOS(new Date());
    let pos = 0;
    for (const a of arquivos) {
      const nome = enc.encode(a.nome);
      const dados = typeof a.dados === 'string' ? enc.encode(a.dados) : a.dados;
      const crc = crc32(dados);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);          // nomes em UTF-8
      lh.setUint16(8, 0, true);               // sem compressão
      lh.setUint16(10, hora, true);
      lh.setUint16(12, data, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, dados.length, true);
      lh.setUint32(22, dados.length, true);
      lh.setUint16(26, nome.length, true);
      lh.setUint16(28, 0, true);
      partes.push(new Uint8Array(lh.buffer), nome, dados);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, hora, true);
      ch.setUint16(14, data, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, dados.length, true);
      ch.setUint32(24, dados.length, true);
      ch.setUint16(28, nome.length, true);
      ch.setUint32(42, pos, true);
      central.push(new Uint8Array(ch.buffer), nome);

      pos += 30 + nome.length + dados.length;
    }
    const tamCentral = central.reduce((s, p) => s + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true);
    fim.setUint16(8, arquivos.length, true);
    fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamCentral, true);
    fim.setUint32(16, pos, true);
    return partes.concat(central, [new Uint8Array(fim.buffer)]);
  }

  function juntar(partes) {
    const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of partes) { out.set(p, o); o += p.length; }
    return out;
  }

  // ── XLSX ──
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NSR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const xesc = s => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function col(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  // Estilos: 0 normal · 1 cabeçalho · 2 decimal 0,00 · 3 inteiro
  const ESTILOS = `<styleSheet xmlns="${NS}">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF272525"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function celTexto(ref, v, s) {
    return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  }
  function cel(ref, v, fmt) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') {
      if (!isFinite(v)) return '';
      return `<c r="${ref}" s="${fmt === 'int' ? 3 : fmt === 'dec' ? 2 : 0}"><v>${v}</v></c>`;
    }
    return celTexto(ref, v, 0);
  }

  function aba(a) {
    const cols = a.colunas;
    const ult = col(cols.length - 1);
    const cab = `<row r="1">${cols.map((c, j) => celTexto(col(j) + 1, c.t, 1)).join('')}</row>`;
    const corpo = a.linhas.map((linha, i) => {
      const r = i + 2;
      return `<row r="${r}">${linha.map((v, j) => cel(col(j) + r, v, cols[j] && cols[j].fmt)).join('')}</row>`;
    }).join('');
    const larguras = `<cols>${cols.map((c, j) => `<col min="${j + 1}" max="${j + 1}" width="${c.w || 14}" customWidth="1"/>`).join('')}</cols>`;
    const vista = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    const filtro = a.filtro && a.linhas.length ? `<autoFilter ref="A1:${ult}${a.linhas.length + 1}"/>` : '';
    return `<worksheet xmlns="${NS}">${vista}${larguras}<sheetData>${cab}${corpo}</sheetData>${filtro}</worksheet>`;
  }

  const nomeAba = s => String(s).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || 'Planilha';

  /**
   * abas = [{ nome, filtro, colunas: [{ t: título, w: largura, fmt: 'dec'|'int'|'txt' }], linhas: [[...]] }]
   * Devolve o .xlsx como Uint8Array.
   */
  function xlsx(abas) {
    const nomes = abas.map(a => nomeAba(a.nome));
    const arqs = [];
    arqs.push({ nome: '[Content_Types].xml', dados: XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>' });
    arqs.push({ nome: '_rels/.rels', dados: XML +
      `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${NSR}/officeDocument" Target="xl/workbook.xml"/></Relationships>` });

    const defs = abas.map((a, i) => a.filtro && a.linhas.length
      ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xesc(nomes[i]).replace(/'/g, "''")}'!$A$1:$${col(a.colunas.length - 1)}$${a.linhas.length + 1}</definedName>`
      : '').join('');
    arqs.push({ nome: 'xl/workbook.xml', dados: XML +
      `<workbook xmlns="${NS}" xmlns:r="${NSR}"><sheets>` +
      abas.map((_, i) => `<sheet name="${xesc(nomes[i])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      `</sheets>${defs ? `<definedNames>${defs}</definedNames>` : ''}</workbook>` });
    arqs.push({ nome: 'xl/_rels/workbook.xml.rels', dados: XML +
      `<Relationships xmlns="${PR}">` +
      abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NSR}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${abas.length + 1}" Type="${NSR}/styles" Target="styles.xml"/></Relationships>` });
    arqs.push({ nome: 'xl/styles.xml', dados: XML + ESTILOS });
    abas.forEach((a, i) => arqs.push({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: XML + aba(a) }));
    return juntar(zipPartes(arqs));
  }

  raiz.FCZip = { xlsx, zipPartes, juntar, crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
