/* The NBG workbooks themselves, filled in: type values into input cells of an Excel 97–2003 (.xls) workbook and give
   it back, everything else byte for byte (sheets, formulas, formats, drop-downs, the VBA project). Excel recalculates
   the whole workbook when it opens the copy, so what it shows is the workbook's own answer for these inputs.

   The workbook is the user's own file, dropped into the page and kept in this browser; nothing is sent anywhere and
   no workbook is part of this tool.

   Format: an OLE2 compound file (MS-CFB) holding the "Workbook" stream of BIFF8 records (MS-XLS). Only that stream is
   rewritten: each edited cell's record is replaced (a NUMBER / RK for a number, a LABELSST for text — a string the
   workbook does not have yet is added to its shared-string table), multi-cell records are split around it, and every
   stream position the format keeps (BOUNDSHEET, INDEX, DBCELL, EXTSST) is re-pointed. The RECALCID record goes, which
   makes Excel recalculate on load. */
(function (root) {
  'use strict';
  const FREE = 0xFFFFFFFF, END = 0xFFFFFFFE, FATSECT = 0xFFFFFFFD;
  const SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

  // ---------------- compound file ----------------
  function cfbRead(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!SIG.every((b, i) => u8[i] === b)) throw new Error('not an Excel 97–2003 workbook (.xls)');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const ss = 1 << dv.getUint16(0x1E, true), mss = 1 << dv.getUint16(0x20, true);
    const nFat = dv.getUint32(0x2C, true), dir0 = dv.getUint32(0x30, true), cutoff = dv.getUint32(0x38, true);
    const mfat0 = dv.getUint32(0x3C, true), nMfat = dv.getUint32(0x40, true), difat0 = dv.getUint32(0x44, true), nDifat = dv.getUint32(0x48, true);
    const at = s => (s + 1) * ss;
    // the FAT sector list: 109 in the header, then the DIFAT chain
    const fatSecs = [];
    for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(0x4C + i * 4, true));
    for (let d = difat0, k = 0; k < nDifat && d < END; k++) {
      for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(at(d) + i * 4, true));
      d = dv.getUint32(at(d) + ss - 4, true);
    }
    const fat = new Uint32Array(fatSecs.length * ss / 4);
    fatSecs.forEach((s, i) => { for (let j = 0; j < ss / 4; j++) fat[i * ss / 4 + j] = dv.getUint32(at(s) + j * 4, true); });
    const chain = s => { const out = []; const seen = new Set(); while (s < END) { if (seen.has(s) || s >= fat.length) throw new Error('broken sector chain'); seen.add(s); out.push(s); s = fat[s]; } return out; };
    const readChain = (s, size) => { const c = chain(s), out = new Uint8Array(c.length * ss); c.forEach((x, i) => out.set(u8.subarray(at(x), at(x) + ss), i * ss)); return size == null ? out : out.subarray(0, size); };
    const dirBytes = readChain(dir0);
    const ents = [];
    for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
      const e = new DataView(dirBytes.buffer, dirBytes.byteOffset + o, 128), nl = e.getUint16(0x40, true), type = e.getUint8(0x42);
      let name = ''; for (let i = 0; i < Math.max(0, nl / 2 - 1); i++) name += String.fromCharCode(e.getUint16(i * 2, true));
      ents.push({ i: ents.length, name, type, start: e.getUint32(0x74, true), size: e.getUint32(0x78, true), off: o });
    }
    const rootE = ents[0];
    const mini = rootE && rootE.start < END ? readChain(rootE.start, rootE.size) : new Uint8Array(0);
    const mfat = nMfat ? (() => { const b = readChain(mfat0); const a = new Uint32Array(b.length / 4); const v = new DataView(b.buffer, b.byteOffset, b.byteLength); for (let i = 0; i < a.length; i++) a[i] = v.getUint32(i * 4, true); return a; })() : new Uint32Array(0);
    const stream = name => {
      const e = ents.find(x => x.type === 2 && x.name.toLowerCase() === name.toLowerCase());
      if (!e) return null;
      if (e.size >= cutoff) return readChain(e.start, e.size).slice();
      const out = new Uint8Array(e.size); let s = e.start, p = 0;
      while (p < e.size && s < END) { out.set(mini.subarray(s * mss, s * mss + Math.min(mss, e.size - p)), p); p += mss; s = mfat[s]; }
      return out;
    };
    return { u8, dv, ss, mss, cutoff, nFat, fatSecs, fat, ents, dir0, chain, stream, dirBytes, at };
  }

  /* the same file with one stream (≥ the mini-stream cutoff, e.g. "Workbook") replaced. Its old sectors are reused,
     extra ones are appended at the end (with a new FAT sector when the FAT is full); nothing else moves. */
  function cfbReplace(cf, name, data) {
    const e = cf.ents.find(x => x.type === 2 && x.name.toLowerCase() === name.toLowerCase());
    if (!e) throw new Error(`no "${name}" stream`);
    if (e.size < cf.cutoff || data.length < cf.cutoff) throw new Error('only a large stream can be replaced');
    const ss = cf.ss, per = ss / 4;
    let fat = Array.from(cf.fat), fatSecs = cf.fatSecs.slice();
    let nSec = Math.ceil(cf.u8.length / ss) - 1;   // sectors in the file now
    const old = cf.chain(e.start), need = Math.ceil(data.length / ss);
    const use = old.slice(0, need);
    old.slice(need).forEach(s => { fat[s] = FREE; });
    const grow = () => { while (fat.length <= nSec) { fatSecs.push(null); fat = fat.concat(new Array(per).fill(FREE)); } };
    while (use.length < need) {
      // a free sector inside the file, else a new one at the end
      let s = fat.findIndex((v, i) => v === FREE && i < nSec && !use.includes(i));
      if (s < 0) { s = nSec++; grow(); }
      use.push(s);
    }
    // FAT sectors added by grow(): put them at the end too, marked as FAT sectors
    for (let i = 0; i < fatSecs.length; i++) if (fatSecs[i] == null) { const s = nSec++; grow(); fatSecs[i] = s; fat[s] = FATSECT; }
    if (fatSecs.length > 109) throw new Error('workbook too large to rewrite (DIFAT)');
    use.forEach((s, i) => { fat[s] = i + 1 < use.length ? use[i + 1] : END; });
    const out = new Uint8Array((nSec + 1) * ss);
    out.set(cf.u8.subarray(0, Math.min(cf.u8.length, out.length)));
    const dv = new DataView(out.buffer);
    use.forEach((s, i) => { const chunk = data.subarray(i * ss, Math.min(data.length, (i + 1) * ss)); out.fill(0, (s + 1) * ss, (s + 2) * ss); out.set(chunk, (s + 1) * ss); });
    // header: FAT sector count and list
    dv.setUint32(0x2C, fatSecs.length, true);
    for (let i = 0; i < 109; i++) dv.setUint32(0x4C + i * 4, i < fatSecs.length ? fatSecs[i] : FREE, true);
    fatSecs.forEach((s, i) => { for (let j = 0; j < per; j++) dv.setUint32((s + 1) * ss + j * 4, fat[i * per + j] == null ? FREE : fat[i * per + j], true); });
    // the directory entry: start sector and size
    const dsec = cf.chain(cf.dir0), eo = e.off, ds = dsec[Math.floor(eo / ss)], base = (ds + 1) * ss + (eo % ss);
    dv.setUint32(base + 0x74, use[0], true); dv.setUint32(base + 0x78, data.length, true); dv.setUint32(base + 0x7C, 0, true);
    return out;
  }

  // ---------------- BIFF8 ----------------
  const R = { BOF: 0x809, EOF: 0x0A, BOUNDSHEET: 0x85, SST: 0xFC, EXTSST: 0xFF, CONTINUE: 0x3C, INDEX: 0x20B, DBCELL: 0xD7, ROW: 0x208,
    NUMBER: 0x203, RK: 0x27E, MULRK: 0xBD, LABELSST: 0xFD, LABEL: 0x204, BLANK: 0x201, MULBLANK: 0xBE, BOOLERR: 0x205, FORMULA: 0x06,
    STRING: 0x207, SHRFMLA: 0x4BC, ARRAY: 0x221, TABLE: 0x236, RECALCID: 0x1C1, DIMENSIONS: 0x200 };
  function records(s) {
    const out = [], dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    for (let o = 0; o + 4 <= s.length;) {
      const type = dv.getUint16(o, true), len = dv.getUint16(o + 2, true);
      if (o + 4 + len > s.length) break;
      out.push({ type, off: o, data: s.subarray(o + 4, o + 4 + len) });
      o += 4 + len;
    }
    return out;
  }
  const u16 = (d, o) => d[o] | (d[o + 1] << 8), u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
  const put16 = (d, o, v) => { d[o] = v & 255; d[o + 1] = (v >> 8) & 255; }, put32 = (d, o, v) => { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; d[o + 2] = (v >>> 16) & 255; d[o + 3] = (v >>> 24) & 255; };
  const rec = (type, data) => ({ type, data: data instanceof Uint8Array ? data : new Uint8Array(data) });

  // the workbook's sheets (BOUNDSHEET), in order, with where each starts
  function sheetsOf(rs) {
    return rs.filter(r => r.type === R.BOUNDSHEET).map(r => {
      const d = r.data, cch = d[6], hi = d[7] & 1;
      let name = ''; for (let i = 0; i < cch; i++) name += String.fromCharCode(hi ? u16(d, 8 + i * 2) : d[8 + i]);
      return { name, pos: u32(d, 0), rec: r, hidden: d[4] & 3, kind: d[5] };
    });
  }

  // ---------------- shared strings ----------------
  // every string of the SST (with its rich-text / phonetic tails, kept as they are), across CONTINUE records
  function sstRead(rs, i0) {
    const parts = [rs[i0].data.subarray(8)];
    let j = i0 + 1;
    while (j < rs.length && rs[j].type === R.CONTINUE) parts.push(rs[j++].data);
    const unique = u32(rs[i0].data, 4), total = u32(rs[i0].data, 0), strs = [];
    let pi = 0, p = 0;
    const left = () => parts[pi].length - p;
    const next = () => { pi++; p = 0; };
    const bytes = n => { const out = new Uint8Array(n); let k = 0; while (k < n) { if (!left()) next(); const t = Math.min(n - k, left()); out.set(parts[pi].subarray(p, p + t), k); k += t; p += t; } return out; };
    for (let s = 0; s < unique; s++) {
      if (!left()) next();
      const head = bytes(3), cch = u16(head, 0), fl = head[2];
      const rich = fl & 8 ? u16(bytes(2), 0) : 0, ext = fl & 4 ? u32(bytes(4), 0) : 0;
      let hi = fl & 1, text = '';
      for (let k = 0; k < cch;) {
        if (!left()) { next(); hi = parts[pi][p] & 1; p++; }   // a CONTINUE inside the characters repeats the high-byte flag
        const n = Math.min(cch - k, Math.floor(left() / (hi ? 2 : 1)));
        for (let q = 0; q < n; q++) text += String.fromCharCode(hi ? u16(parts[pi], p + q * 2) : parts[pi][p + q]);
        p += n * (hi ? 2 : 1); k += n;
      }
      const tail = bytes(rich * 4 + ext);
      strs.push({ text, rich, ext, tail });
    }
    return { total, strs, end: j };
  }
  // SST + CONTINUE records (strings never split) and the EXTSST that indexes them, for a stream offset `at`
  function sstWrite(total, strs, at) {
    const enc = s => {
      const wide = [...s.text].some(c => c.charCodeAt(0) > 255), n = s.text.length;
      const b = new Uint8Array(3 + (s.rich ? 2 : 0) + (s.ext ? 4 : 0) + n * (wide ? 2 : 1) + s.tail.length);
      put16(b, 0, n); b[2] = (wide ? 1 : 0) | (s.rich ? 8 : 0) | (s.ext ? 4 : 0);
      let o = 3; if (s.rich) { put16(b, o, s.rich); o += 2; } if (s.ext) { put32(b, o, s.ext); o += 4; }
      for (let k = 0; k < n; k++) { if (wide) { put16(b, o, s.text.charCodeAt(k)); o += 2; } else b[o++] = s.text.charCodeAt(k); }
      b.set(s.tail, o);
      return b;
    };
    const MAX = 8224, recs = [], pos = [];
    let cur = [], len = 8, first = true, recStart = at;
    const flush = () => { const d = new Uint8Array(len); let o = 0; if (first) { put32(d, 0, total); put32(d, 4, strs.length); o = 8; } cur.forEach(b => { d.set(b, o); o += b.length; }); recs.push(rec(first ? R.SST : R.CONTINUE, d)); recStart += 4 + len; first = false; cur = []; len = 0; };
    strs.forEach(s => {
      const b = enc(s);
      if (len + b.length > MAX && cur.length) flush();
      if (b.length > MAX) throw new Error('shared string too long to rewrite');
      pos.push({ ib: recStart + 4 + len, cb: 4 + len });
      cur.push(b); len += b.length;
    });
    flush();
    const dsst = Math.max(8, Math.ceil(strs.length / 128)), buckets = Math.ceil(strs.length / dsst);
    const ex = new Uint8Array(2 + buckets * 8); put16(ex, 0, dsst);
    for (let k = 0; k < buckets; k++) { const q = pos[k * dsst]; put32(ex, 2 + k * 8, q.ib); put16(ex, 6 + k * 8, q.cb); }
    return { recs, extsst: rec(R.EXTSST, ex) };
  }

  // ---------------- cells ----------------
  const colOf = s => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const addr = a => { const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(String(a).trim()); if (!m) throw new Error('bad cell ' + a); return { r: +m[2] - 1, c: colOf(m[1].toUpperCase()) }; };
  // RK: the value exactly as a 30-bit integer (optionally ÷100), else null
  function rkOf(v) {
    if (Number.isInteger(v) && v >= -(2 ** 29) && v < 2 ** 29) return ((v << 2) | 2) >>> 0;
    const h = Math.round(v * 100);
    if (Math.abs(h / 100 - v) === 0 && h >= -(2 ** 29) && h < 2 ** 29) return ((h << 2) | 3) >>> 0;
    return null;
  }
  function rkVal(rk) {
    let v;
    if (rk & 2) v = (rk | 0) >> 2;
    else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, rk & 0xFFFFFFFC, true); b.setUint32(0, 0, true); v = b.getFloat64(0, true); }
    return rk & 1 ? v / 100 : v;
  }
  function numRec(r, c, xf, v) {
    const rk = rkOf(v);
    if (rk != null) { const d = new Uint8Array(10); put16(d, 0, r); put16(d, 2, c); put16(d, 4, xf); put32(d, 6, rk); return rec(R.RK, d); }
    const d = new Uint8Array(14); put16(d, 0, r); put16(d, 2, c); put16(d, 4, xf); new DataView(d.buffer).setFloat64(6, v, true); return rec(R.NUMBER, d);
  }
  const sstRec = (r, c, xf, i) => { const d = new Uint8Array(10); put16(d, 0, r); put16(d, 2, c); put16(d, 4, xf); put32(d, 6, i); return rec(R.LABELSST, d); };
  // the cells a record covers: [{c, xf, single record for it}]
  function splitMulti(x) {
    const d = x.data, r = u16(d, 0), c0 = u16(d, 2);
    if (x.type === R.MULRK) { const n = (d.length - 6) / 6; return Array.from({ length: n }, (_, k) => ({ r, c: c0 + k, xf: u16(d, 4 + k * 6), rk: u32(d, 6 + k * 6) })); }
    const n = (d.length - 6) / 2; return Array.from({ length: n }, (_, k) => ({ r, c: c0 + k, xf: u16(d, 4 + k * 2) }));
  }
  function joinMulti(type, cells) {
    if (!cells.length) return [];
    if (cells.length === 1) {
      const q = cells[0], d = new Uint8Array(type === R.MULRK ? 10 : 6); put16(d, 0, q.r); put16(d, 2, q.c); put16(d, 4, q.xf);
      if (type === R.MULRK) put32(d, 6, q.rk);
      return [rec(type === R.MULRK ? R.RK : R.BLANK, d)];
    }
    const w = type === R.MULRK ? 6 : 2, d = new Uint8Array(6 + cells.length * w);
    put16(d, 0, cells[0].r); put16(d, 2, cells[0].c);
    cells.forEach((q, k) => { put16(d, 4 + k * w, q.xf); if (type === R.MULRK) put32(d, 6 + k * w, q.rk); });
    put16(d, 4 + cells.length * w, cells[cells.length - 1].c);
    return [rec(type, d)];
  }

  /* fill a workbook: edits [{ sheet, cell: 'D14', value: number | string | null }] (null leaves the cell empty).
     Returns { bytes, done: [{sheet, cell, value, was}], missing: [...] } — a cell the workbook has no record for (never
     formatted, nowhere on the sheet) is reported in missing, not written. */
  function fill(bytes, edits) {
    const cf = cfbRead(bytes);
    const wb = cf.stream('Workbook') || cf.stream('Book');
    if (!wb) throw new Error('no Workbook stream — save it as an Excel 97–2003 workbook');
    let rs = records(wb);
    const sheets = sheetsOf(rs);
    // shared strings: find or add
    const si = rs.findIndex(r => r.type === R.SST);
    const sst = si >= 0 ? sstRead(rs, si) : null;
    const strIndex = new Map(); if (sst) sst.strs.forEach((s, i) => { if (!strIndex.has(s.text)) strIndex.set(s.text, i); });
    let added = 0, refs = 0;   // strings added; net change in string-cell references
    const sstIdx = t => { if (!sst) throw new Error('no shared-string table'); let i = strIndex.get(t); if (i == null) { i = sst.strs.length; sst.strs.push({ text: t, rich: 0, ext: 0, tail: new Uint8Array(0) }); strIndex.set(t, i); added++; } refs++; return i; };
    // edits by sheet and cell
    const want = new Map(), done = [], missing = [];
    edits.forEach(ed => {
      const sh = sheets.find(s => s.name.toLowerCase() === String(ed.sheet).toLowerCase());
      if (!sh) { missing.push({ ...ed, why: `no sheet "${ed.sheet}"` }); return; }
      const { r, c } = addr(ed.cell);
      want.set(`${sh.pos}|${r}|${c}`, { ...ed, r, c });
    });
    // walk the stream: which substream a record is in (by its BOF position)
    const out = [];   // { type, data, from: old record or null }
    let cur = null;
    for (let i = 0; i < rs.length; i++) {
      const x = rs[i];
      if (x.type === R.BOF) cur = x.off;
      if (x.type === R.RECALCID) continue;   // gone: Excel then recalculates the workbook on load
      const isCell = [R.NUMBER, R.RK, R.LABELSST, R.LABEL, R.BLANK, R.BOOLERR, R.FORMULA].includes(x.type);
      if (isCell) {
        const r = u16(x.data, 0), c = u16(x.data, 2), w = want.get(`${cur}|${r}|${c}`);
        if (w) {
          let n = 1;
          if (x.type === R.FORMULA) {
            // a formula typed over (as a user would); a shared / array formula anchor cannot be
            if (rs[i + 1] && [R.SHRFMLA, R.ARRAY, R.TABLE].includes(rs[i + 1].type)) { missing.push({ ...w, why: 'a shared-formula cell' }); out.push({ ...x, from: x }); continue; }
            if (rs[i + 1] && rs[i + 1].type === R.STRING) n = 2;
          }
          const xf = u16(x.data, 4), was = cellText(x, sst);
          if (x.type === R.LABELSST) refs--;
          out.push({ ...newCell(w, xf), from: x });
          done.push({ sheet: w.sheet, cell: w.cell, value: w.value, was });
          want.delete(`${cur}|${r}|${c}`);
          if (n === 2) { out.push({ type: -1, data: null, from: rs[i + 1] }); i++; }   // dropped STRING keeps its position mapped
          continue;
        }
      }
      if (x.type === R.MULRK || x.type === R.MULBLANK) {
        const cells = splitMulti(x), hit = cells.filter(q => want.has(`${cur}|${q.r}|${q.c}`));
        if (hit.length) {
          const parts = []; let run = [];
          cells.forEach(q => {
            const key = `${cur}|${q.r}|${q.c}`, w = want.get(key);
            if (!w) { run.push(q); return; }
            parts.push(...joinMulti(x.type, run)); run = [];
            parts.push(newCell(w, q.xf));
            done.push({ sheet: w.sheet, cell: w.cell, value: w.value, was: x.type === R.MULRK ? rkVal(q.rk) : '' });
            want.delete(key);
          });
          parts.push(...joinMulti(x.type, run));
          parts.forEach((p, k) => out.push({ ...p, from: k ? null : x }));
          continue;
        }
      }
      out.push({ ...x, from: x });
    }
    want.forEach(w => missing.push({ ...w, why: 'no cell there in the workbook' }));
    function newCell(w, xf) {
      if (w.value == null || w.value === '') { const d = new Uint8Array(6); put16(d, 0, w.r); put16(d, 2, w.c); put16(d, 4, xf); return rec(R.BLANK, d); }
      if (typeof w.value === 'boolean') { const d = new Uint8Array(8); put16(d, 0, w.r); put16(d, 2, w.c); put16(d, 4, xf); d[6] = w.value ? 1 : 0; d[7] = 0; return rec(R.BOOLERR, d); }   // a check box's linked cell
      if (typeof w.value === 'number' && isFinite(w.value)) return numRec(w.r, w.c, xf, w.value);
      return sstRec(w.r, w.c, xf, sstIdx(String(w.value)));
    }
    // the shared strings, rewritten when strings were added (and their reference count)
    let body = out;
    if (sst && !added && refs) {
      const a = out.find(x => x.from && x.from.type === R.SST);
      a.data = a.data.slice(); put32(a.data, 0, Math.max(0, sst.total + refs));
    }
    if (sst && added) {
      const a = out.findIndex(x => x.from && x.from.type === R.SST);
      let b = a + 1; while (b < out.length && out[b].from && out[b].from.type === R.CONTINUE) b++;
      const e = out.findIndex(x => x.from && x.from.type === R.EXTSST);
      body = out.map(x => x);
      body.splice(a, b - a, { type: 'SST*', from: out[a].from, olds: out.slice(a, b) });
      if (e >= 0) { const ei = body.findIndex(x => x.from && x.from.type === R.EXTSST); body.splice(ei, 1, { type: 'EXTSST*', from: out[e].from }); }
      sst.total += refs;
    }
    // serialise, keeping old offset → new offset for every record that stays (or is replaced)
    const map = new Map(), chunks = [];
    let pos = 0, sstOut = null;
    body.forEach(x => {
      if (x.type === -1) { if (x.from) map.set(x.from.off, pos); return; }
      if (x.type === 'SST*') {
        sstOut = sstWrite(sst.total, sst.strs, pos);
        map.set(x.from.off, pos);
        x.olds.slice(1).forEach(o => map.set(o.from.off, pos));
        sstOut.recs.forEach(r => { chunks.push(r); pos += 4 + r.data.length; });
        return;
      }
      if (x.type === 'EXTSST*') { map.set(x.from.off, pos); const r = sstOut.extsst; chunks.push(r); pos += 4 + r.data.length; return; }
      if (x.from && !map.has(x.from.off)) map.set(x.from.off, pos);
      const r = { type: x.type, data: x.data.slice() }; r.newOff = pos; r.from = x.from;
      chunks.push(r); pos += 4 + r.data.length;
    });
    // a position inside the old stream → the new one (exact for record starts)
    const olds = rs.map(r => r.off);
    const mapPos = p => {
      if (map.has(p)) return map.get(p);
      let lo = 0, hi = olds.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (olds[m] <= p) lo = m; else hi = m - 1; }
      return (map.get(olds[lo]) ?? 0) + (p - olds[lo]);
    };
    // re-point what the format keeps as stream positions
    chunks.forEach(r => {
      if (!r.from) return;
      if (r.type === R.BOUNDSHEET) put32(r.data, 0, mapPos(u32(r.data, 0)));
      if (r.type === R.INDEX) {
        if (u32(r.data, 12)) put32(r.data, 12, mapPos(u32(r.data, 12)));
        for (let o = 16; o + 4 <= r.data.length; o += 4) put32(r.data, o, mapPos(u32(r.data, o)));
      }
      if (r.type === R.DBCELL) {
        const oldDb = r.from.off, firstRow = oldDb - u32(r.data, 0);
        const rowsAt = rs.filter(q => q.type === R.ROW && q.off >= firstRow && q.off < oldDb).map(q => q.off);
        put32(r.data, 0, r.newOff - mapPos(firstRow));
        // the first cell of each row: from the second ROW record (or the end of the only one), then row to row
        let oldBase = rowsAt.length > 1 ? rowsAt[1] : firstRow + 4 + 16, newBase = mapPos(oldBase);
        for (let o = 4; o + 2 <= r.data.length; o += 2) {
          const oldP = oldBase + u16(r.data, o), newP = mapPos(oldP);
          put16(r.data, o, newP - newBase);
          oldBase = oldP; newBase = newP;
        }
      }
    });
    const ns = new Uint8Array(pos);
    let o = 0; chunks.forEach(r => { put16(ns, o, r.type); put16(ns, o + 2, r.data.length); ns.set(r.data, o + 4); o += 4 + r.data.length; });
    return { bytes: cfbReplace(cf, cf.ents.find(x => x.type === 2 && /^(workbook|book)$/i.test(x.name)).name, ns), done, missing, sheets: sheets.map(s => s.name), stringsAdded: added };
  }
  function cellText(x, sst) {
    const d = x.data;
    if (x.type === R.NUMBER) return new DataView(d.buffer, d.byteOffset, d.byteLength).getFloat64(6, true);
    if (x.type === R.RK) return rkVal(u32(d, 6));
    if (x.type === R.LABELSST) return sst && sst.strs[u32(d, 6)] ? sst.strs[u32(d, 6)].text : '';
    if (x.type === R.FORMULA) return '(formula)';
    if (x.type === R.BOOLERR) return d[7] ? '#ERR' : !!d[6];
    return '';
  }

  /* read cells back (cached values as saved — a filled copy has none until Excel recalculates it) */
  function read(bytes, cells) {
    const cf = cfbRead(bytes), wb = cf.stream('Workbook') || cf.stream('Book'), rs = records(wb), sheets = sheetsOf(rs);
    const si = rs.findIndex(r => r.type === R.SST), sst = si >= 0 ? sstRead(rs, si) : null;
    const res = {};
    const want = new Map(cells.map(q => { const sh = sheets.find(s => s.name.toLowerCase() === q.sheet.toLowerCase()); const { r, c } = addr(q.cell); return [`${sh ? sh.pos : -1}|${r}|${c}`, q]; }));
    let cur = null;
    rs.forEach((x, i) => {
      if (x.type === R.BOF) cur = x.off;
      const take = (r, c, v) => { const q = want.get(`${cur}|${r}|${c}`); if (q) res[`${q.sheet}!${q.cell}`] = v; };
      if ([R.NUMBER, R.RK, R.LABELSST, R.BLANK, R.BOOLERR].includes(x.type)) take(u16(x.data, 0), u16(x.data, 2), cellText(x, sst));
      else if (x.type === R.FORMULA) {
        const d = x.data;
        if (d[12] === 0xFF && d[13] === 0xFF) take(u16(d, 0), u16(d, 2), d[6] === 0 && rs[i + 1] && rs[i + 1].type === R.STRING ? strRec(rs[i + 1].data) : d[6] === 1 ? !!d[8] : d[6] === 2 ? '#ERR' : '');
        else take(u16(d, 0), u16(d, 2), new DataView(d.buffer, d.byteOffset, d.byteLength).getFloat64(6, true));
      } else if (x.type === R.MULRK) splitMulti(x).forEach(q => take(q.r, q.c, rkVal(q.rk)));
    });
    return res;
  }
  const strRec = d => { const n = u16(d, 0), hi = d[2] & 1; let t = ''; for (let k = 0; k < n; k++) t += String.fromCharCode(hi ? u16(d, 3 + k * 2) : d[3 + k]); return t; };

  const api = { fill, read, cfbRead, cfbReplace, records, sheetsOf, addr, rkOf, rkVal, R };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_XLS = api;
})(typeof self !== 'undefined' ? self : this);
