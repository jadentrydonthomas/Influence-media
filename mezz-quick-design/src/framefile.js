/* NBG Frame files (.frame): a zip holding .nfrx (the frame model, XML), .connections.xml and .detailing.xml.

   The mezzanine floor loads go in the way the quote engineer enters them by hand, under Tools → Concentrated (Panel)
   Loads: one row per column and case — description "FDL 1" / "FLL 1" (the number is the column's), load case FDL /
   FLL, member COL0n, Y force in kips (down is negative), location = the height on the column in feet (Loc. Sys.
   Global: above the finished floor), Ecc. Loc. WebCenterline with no offset (see WEB_GUESS). Those rows are the
   <SpecialLoads><CLoads> list of the model. Floor dead / floor live are set to 1 psf when they are 0, as done by hand
   so that NBG Frame makes the FDL / FLL cases (Process → Get Applied Loads). Everything else in the file is left
   byte for byte: the other two zip entries are copied as they are, and the model text only gains the new rows and
   the two 1-psf values. The analysis results stored in the file are re-run when the frame is processed.
   inflate / deflate: (Uint8Array) → Promise<Uint8Array> of raw DEFLATE data (Node zlib or the browser's streams). */
(function (root) {
  'use strict';

  // ---------- zip ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const utf8 = s => new TextEncoder().encode(s), unutf8 = u => new TextDecoder('utf-8').decode(u);

  function unzip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not an NBG Frame file (no zip directory)');
    const n = dv.getUint16(e + 10, true), out = [];
    let p = dv.getUint32(e + 16, true);
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip directory');
      const ent = {
        verMade: dv.getUint16(p + 4, true), verNeed: dv.getUint16(p + 6, true), flags: dv.getUint16(p + 8, true), method: dv.getUint16(p + 10, true),
        time: dv.getUint16(p + 12, true), date: dv.getUint16(p + 14, true), crc: dv.getUint32(p + 16, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true),
        intAttr: dv.getUint16(p + 36, true), extAttr: dv.getUint32(p + 38, true),
      };
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      ent.nameBytes = u8.slice(p + 46, p + 46 + nl);
      ent.name = unutf8(ent.nameBytes);
      if (dv.getUint32(lho, true) !== 0x04034b50) throw new Error('damaged zip entry ' + ent.name);
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      ent.data = u8.slice(start, start + ent.csize);
      out.push(ent);
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  function zip(entries) {
    const parts = [], cd = [];
    let off = 0;
    entries.forEach(en => {
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, en.verNeed, true); h.setUint16(6, en.flags & ~8, true); h.setUint16(8, en.method, true);
      h.setUint16(10, en.time, true); h.setUint16(12, en.date, true); h.setUint32(14, en.crc, true); h.setUint32(18, en.data.length, true); h.setUint32(22, en.usize, true);
      h.setUint16(26, en.nameBytes.length, true); h.setUint16(28, 0, true);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, en.verMade, true); c.setUint16(6, en.verNeed, true); c.setUint16(8, en.flags & ~8, true); c.setUint16(10, en.method, true);
      c.setUint16(12, en.time, true); c.setUint16(14, en.date, true); c.setUint32(16, en.crc, true); c.setUint32(20, en.data.length, true); c.setUint32(24, en.usize, true);
      c.setUint16(28, en.nameBytes.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, en.intAttr, true); c.setUint32(38, en.extAttr, true); c.setUint32(42, off, true);
      parts.push(new Uint8Array(h.buffer), en.nameBytes, en.data);
      cd.push(new Uint8Array(c.buffer), en.nameBytes);
      off += 30 + en.nameBytes.length + en.data.length;
    });
    const cdLen = cd.reduce((a, u) => a + u.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdLen, true); end.setUint32(16, off, true);
    const all = parts.concat(cd, [new Uint8Array(end.buffer)]), out = new Uint8Array(all.reduce((a, u) => a + u.length, 0));
    let k = 0;
    all.forEach(u => { out.set(u, k); k += u.length; });
    return out;
  }

  // ---------- the model ----------
  const MODEL = '.nfrx';
  const tag = (xml, t, from = 0) => { const m = new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml.slice(from)); return m ? m[1] : null; };
  const num = v => (v == null ? null : +v);
  // which frame lines a file designs: from its name (…_Bldg_1_3-5.frame → 3, 4, 5), else its title (…-Bldg 1-2)
  function frameLinesOf(fileName, title) {
    const base = String(fileName || '').replace(/(?:\s*\(\d+\))+(?=\.frame$)/i, '').replace(/[-_ ]mezz(?=\.frame$)/i, '');
    const m = /_([0-9]+(?:\s*-\s*[0-9]+)?)\.frame$/i.exec(base) || /-\s*([0-9]+(?:\s*-\s*[0-9]+)?)\s*$/.exec(title || '');
    if (!m) return [];
    const [a, b] = m[1].split('-').map(s => +s.trim());
    const out = [];
    for (let k = a; k <= (b || a); k++) out.push(k);
    return out;
  }
  // the building a file belongs to: title "<job>-Bldg 1-2" → "Bldg 1"
  function buildingOf(title, job) {
    let t = String(title || '').trim();
    if (job && t.toUpperCase().startsWith(String(job).toUpperCase() + '-')) t = t.slice(String(job).length + 1);
    const m = /^(.+?)\s*-\s*\d+(?:\s*-\s*\d+)?\s*$/.exec(t);
    return m ? m[1].trim() : '';
  }

  async function read(bytes, io, fileName) {
    const entries = unzip(bytes), model = entries.find(e => e.name === MODEL);
    if (!model) throw new Error('no frame model (.nfrx) in this file');
    const raw = model.method === 0 ? model.data : await io.inflate(model.data);
    if (crc32(raw) !== model.crc) throw new Error('the frame model does not match its checksum');
    const xml = unutf8(raw), bom = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;   // the decoder drops a BOM: put it back on write
    const sl = xml.indexOf('<SpecialLoads>'), colsAt = xml.indexOf('<Columns>');
    const columns = [];
    const colRe = /<Column>[\s\S]*?<\/Column>(?=\s*(?:<Column>|<\/Columns>))/g;
    colRe.lastIndex = colsAt;
    let m;
    const colsEnd = xml.indexOf('</Columns>', colsAt);
    while ((m = colRe.exec(xml)) && m.index < colsEnd) {
      const block = m[0];
      columns.push({ id: tag(block, 'ID'), x: num(tag(block, 'GlobalX')), top: num(tag(block, 'TopElevation')), type: tag(block, 'ColumnType') });
    }
    const title = tag(xml, 'FrameTitle'), job = tag(xml, 'NBGJobNumber'), loadsAt = xml.indexOf('<Loads>');
    const info = {
      fileName: fileName || '', title, job, building: buildingOf(title, job), lines: frameLinesOf(fileName, title),
      width: num(tag(xml, 'WidthInFeet')), length: num(tag(xml, 'LengthInFeet')), eave: num(tag(xml, 'LeftEaveHeight')), bayWidth: num(tag(xml, 'BayWidth')),
      type: tag(xml, 'Type', xml.indexOf('<Geometry>')), columns: columns.filter(c => c.id),
      floorDead: num(tag(xml, 'FloorDead', loadsAt)), floorLive: num(tag(xml, 'FloorLive', loadsAt)),
      cloads: cloadsOf(xml).map(c => c.fields), hasSpecialLoads: sl >= 0,
    };
    return { entries, model, xml, bom, info };
  }
  // the <CLoad> rows of <SpecialLoads>, with their text spans
  function cloadsOf(xml) {
    const s = xml.indexOf('<SpecialLoads>'), e = xml.indexOf('</SpecialLoads>', s);
    if (s < 0 || e < 0) return [];
    const out = [], re = /([ \t]*)<CLoad>[\s\S]*?<\/CLoad>(\r?\n)?/g;
    re.lastIndex = s;
    let m;
    while ((m = re.exec(xml)) && m.index < e) {
      const fields = {};
      m[0].replace(/<([A-Za-z]+)>([^<]*)<\/\1>/g, (_, k, v) => { fields[k] = v; return _; });
      out.push({ start: m.index, end: m.index + m[0].length, fields });
    }
    return out;
  }
  // rows this tool writes (and the same rows typed by hand): case FDL / FLL, description "FDL 1", "FLL1", "FDL" …
  const isOurs = f => (f.loadCaseID === 'FDL' || f.loadCaseID === 'FLL') && /^F[DL]L\s*\d*$/i.test(String(f.name || '').trim());
  const fmt = v => String(+(+v).toFixed(4));

  /* Ecc. Loc. is the <toFlange> code of a row. NBG Frame shows 1 as Top/Left (the Lean-To rows it writes). 0 is not
     one of its choices: the cell comes up blank and the dialog says "Invalid data was entered or pasted". The code
     for WebCenterline is learned from a saved file where FDL / FLL rows were set to WebCenterline by hand
     (learnWebCode); until then WEB_GUESS is written and the page says it is not confirmed. */
  const ECC_TOP_LEFT = '1', WEB_GUESS = '2';
  // the WebCenterline code from the FDL / FLL rows of a saved file: a code this tool did not write (not `wrote`), not
  // the invalid 0 and not Top/Left; the most common one when rows differ
  function learnWebCode(cloads, wrote) {
    const n = new Map();
    (cloads || []).filter(isOurs).forEach(c => {
      const v = String(c.toFlange == null ? '' : c.toFlange).trim();
      if (/^-?\d+$/.test(v) && v !== '0' && v !== ECC_TOP_LEFT && v !== String(wrote)) n.set(v, (n.get(v) || 0) + 1);
    });
    const best = [...n].sort((a, b) => b[1] - a[1])[0];
    return best ? { code: best[0], rows: best[1] } : null;
  }

  /* rows: [{ name, caseId, member, y (kips, down −), location (ft) }]; opt: { toFlange (the WebCenterline code; default
     WEB_GUESS), eccentricity (in, default 0) }. Earlier FDL<n> / FLL<n> rows are replaced, so a second export of the
     same file gives the same result. Returns the new model text and what changed. */
  function addLoads(xml, rows, opt = {}) {
    const nl = xml.includes('\r\n') ? '\r\n' : '\n';
    const s = xml.indexOf('<SpecialLoads>'), e = xml.indexOf('</SpecialLoads>', s);
    if (s < 0 || e < 0) throw new Error('no <SpecialLoads> in the frame model');
    const existing = cloadsOf(xml), ours = existing.filter(c => isOurs(c.fields)), theirs = existing.filter(c => !isOurs(c.fields));
    // load group, status and location system as the rows NBG Frame wrote; Ecc. Loc. web centre with no offset
    const other = (theirs[0] || {}).fields || {};
    const code = String(opt.toFlange == null ? WEB_GUESS : opt.toFlange);
    if (!/^-?\d+$/.test(code) || code === '0') throw new Error(`Ecc. Loc. code ${code} is not one NBG Frame accepts`);
    const conv = {
      loadGroup: other.loadGroup ?? '0', status: other.status ?? 'Global', locSys: other.locSys ?? '1',
      toFlange: code, eccentricity: String(opt.eccentricity == null ? 0 : opt.eccentricity),
    };
    // drop earlier mezzanine rows (back to front so the spans stay valid)
    let out = xml;
    ours.slice().sort((a, b) => b.start - a.start).forEach(c => { out = out.slice(0, c.start) + out.slice(c.end); });
    // indentation from the <CLoads> line
    const s2 = out.indexOf('<SpecialLoads>'), e2 = out.indexOf('</SpecialLoads>', s2);
    let open = out.indexOf('<CLoads', s2);
    if (open < 0 || open > e2) {
      // no list yet: an empty one goes after <PLoads> (the order NBG Frame writes), else first in <SpecialLoads>
      const pl = out.indexOf('<PLoads', s2), plEnd = pl >= 0 && pl < e2 ? (out.startsWith('<PLoads />', pl) ? pl + 10 : out.indexOf('</PLoads>', pl) + 9) : s2 + '<SpecialLoads>'.length;
      const at = out.indexOf('\n', plEnd) + 1, lineStart0 = out.lastIndexOf('\n', pl >= 0 && pl < e2 ? pl : s2) + 1;
      const ind0 = out.slice(lineStart0, pl >= 0 && pl < e2 ? pl : s2) + (pl >= 0 && pl < e2 ? '' : '  ');
      out = out.slice(0, at) + `${ind0}<CLoads />${nl}` + out.slice(at);
      open = at + ind0.length;
    }
    const lineStart = out.lastIndexOf('\n', open) + 1, ind = out.slice(lineStart, open);
    const i1 = ind + '  ', i2 = ind + '    ';
    const block = rows.map(r => [
      `${i1}<CLoad>`,
      `${i2}<loadGroup>${conv.loadGroup}</loadGroup>`, `${i2}<status>${conv.status}</status>`, `${i2}<xMag>0</xMag>`, `${i2}<yMag>${fmt(r.y)}</yMag>`, `${i2}<moment>0</moment>`,
      `${i2}<location>${fmt(r.location)}</location>`, `${i2}<eccentricity>${conv.eccentricity}</eccentricity>`, `${i2}<memberID>${r.member}</memberID>`,
      `${i2}<loadCaseID>${r.caseId}</loadCaseID>`, `${i2}<locSys>${conv.locSys}</locSys>`, `${i2}<toFlange>${conv.toFlange}</toFlange>`, `${i2}<name>${r.name}</name>`,
      `${i1}</CLoad>`,
    ].join(nl) + nl).join('');
    if (out.startsWith('<CLoads />', open)) out = out.slice(0, open) + `<CLoads>${nl}${block}${ind}</CLoads>` + out.slice(open + '<CLoads />'.length);
    else {
      const close = out.indexOf('</CLoads>', open), closeLine = out.lastIndexOf('\n', close) + 1;
      out = out.slice(0, closeLine) + block + out.slice(closeLine);
    }
    // floor dead / live 1 psf when 0, so NBG Frame makes the FDL / FLL cases
    const floors = {};
    const loadsAt = out.indexOf('<Loads>');
    ['FloorDead', 'FloorLive'].forEach(k => {
      const at = out.indexOf(`<${k}>`, loadsAt), endAt = out.indexOf(`</${k}>`, at);
      if (at < 0 || endAt < 0) return;
      const v = +out.slice(at + k.length + 2, endAt);
      floors[k] = { was: v, now: v > 0 ? v : 1 };
      if (!(v > 0)) out = out.slice(0, at + k.length + 2) + '1' + out.slice(endAt);
    });
    const others = theirs.filter(c => c.fields.loadCaseID === 'FDL' || c.fields.loadCaseID === 'FLL').map(c => c.fields);
    return { xml: out, added: rows.length, replaced: ours.length, others, conv, floors };
  }

  async function write(file, xml, io) {
    const body = utf8(xml), raw = file.bom && !xml.startsWith('\uFEFF') ? new Uint8Array([0xEF, 0xBB, 0xBF, ...body]) : body, data = await io.deflate(raw);
    const entries = file.entries.map(en => (en.name === MODEL ? { ...en, method: 8, crc: crc32(raw), usize: raw.length, data } : en));
    return zip(entries);
  }

  /* Which end of the frame file is the front sidewall. NBG Frame numbers the columns from the left of the frame,
     and GlobalX runs from there; on the files seen so far COL01 is the FSW column. The file itself says so when
     (1) its interior columns are not symmetric about the middle — Box 5 gives them from the FSW — or (2) it carries
     lean-to loads (rows named "Lean-To") and the PCS says which sidewall the lean-to attaches to. With neither, the
     FSW is taken on the COL01 side and said so. ref: { interior: [ft from FSW], leanToWall: 'FSW' | 'BSW' | null } */
  function orient(info, ref = {}) {
    const cols = info.columns.slice().sort((a, b) => a.x - b.x), W = info.width || (cols.length ? cols[cols.length - 1].x : 0);
    const inner = cols.slice(1, -1).map(c => c.x), want = (ref.interior || []).filter(y => y > 0.05 && y < W - 0.05).sort((a, b) => a - b);
    if (W && inner.length && inner.length === want.length) {
      const direct = inner.reduce((a, x, i) => a + Math.abs(x - want[i]), 0);
      const mir = want.map(y => W - y).sort((a, b) => a - b), mirrored = inner.reduce((a, x, i) => a + Math.abs(x - mir[i]), 0);
      if (Math.abs(direct - mirrored) > 1 && Math.min(direct, mirrored) < 2 * inner.length)
        return { mirrored: mirrored < direct, how: 'interior', text: `interior columns at ${inner.map(x => +x.toFixed(2)).join(', ')}' match Box 5 measured from the ${mirrored < direct ? 'BSW' : 'FSW'}` };
    }
    const lean = new Set((info.cloads || []).filter(c => /lean/i.test(c.name || '')).map(c => c.memberID));
    if (lean.size && /^(FSW|BSW)$/.test(ref.leanToWall || '') && cols.length > 1) {
      const first = lean.has(cols[0].id), last = lean.has(cols[cols.length - 1].id);
      if (first !== last) {
        const mirrored = (ref.leanToWall === 'FSW') !== first;
        return { mirrored, how: 'lean-to', text: `the lean-to loads in the file are on ${first ? cols[0].id : cols[cols.length - 1].id} and the PCS attaches the lean-to to the ${ref.leanToWall}` };
      }
    }
    return { mirrored: false, how: 'assumed', text: `${cols[0] ? cols[0].id : 'COL01'} taken as the FSW column (NBG Frame's usual order); the file has nothing that tells the sides apart` };
  }

  /* The loads one frame file takes. frameLines: the job's frame lines ([{ frame, building, entries: [{ label, y, D, L,
     elev, A, member, where, parts }] }], y from the FSW). A file that designs several lines (3-5) takes, for each of
     its columns, the largest dead and the largest live of those lines. Columns are matched by position across the
     frame (within 2'-0": the column line sits a girt depth inside the steel line), so the file's own member IDs are
     used. A load at a column that is not in the file (an endwall column beside a rigid end frame) is listed apart,
     never put on another member. opt: { lines, mirrored, height: 'beam' | 'A', building } */
  // "Building 1", "BLDG-1", "Bldg 1" are one building
  const bldgKey = b => String(b || '').toUpperCase().replace(/BUILDING/g, 'BLDG').replace(/[^A-Z0-9]/g, '');
  function rowsFor(info, frameLines, opt = {}) {
    const lines = (opt.lines && opt.lines.length ? opt.lines : info.lines).map(String);
    const sameBldg = f => !opt.building || !f.building || bldgKey(f.building) === bldgKey(opt.building);
    const use = frameLines.filter(f => lines.includes(String(f.frame)) && sameBldg(f));
    const byMember = new Map(), unplaced = [];
    const W = info.width || Math.max(...info.columns.map(c => c.x));
    use.forEach(f => f.entries.forEach(e => {
      const gx = opt.mirrored ? W - e.y : e.y;
      const col = info.columns.map(c => ({ c, d: Math.abs(c.x - gx) })).filter(o => o.d <= 2).sort((a, b) => a.d - b.d)[0];
      if (!col) { unplaced.push({ ...e, frame: f.frame, gx }); return; }
      const k = col.c.id, cur = byMember.get(k) || { member: k, x: col.c.x, D: 0, L: 0, elev: 0, from: [] };
      cur.D = Math.max(cur.D, e.D); cur.L = Math.max(cur.L, e.L);
      cur.elev = Math.max(cur.elev, opt.height === 'A' && e.A != null ? e.A : e.elev);
      cur.from.push({ frame: f.frame, label: e.label, D: e.D, L: e.L, elev: e.elev, parts: e.parts });
      byMember.set(k, cur);
    }));
    const members = [...byMember.values()].sort((a, b) => a.x - b.x);
    const rows = [];
    members.forEach(m => {
      const n = +(/(\d+)\s*$/.exec(m.member) || [0, 0])[1];
      if (m.D > 0) rows.push({ name: `FDL ${n}`, caseId: 'FDL', member: m.member, y: -m.D, location: m.elev });
      if (m.L > 0) rows.push({ name: `FLL ${n}`, caseId: 'FLL', member: m.member, y: -m.L, location: m.elev });
    });
    return { lines, used: use.map(f => f.frame), members, rows, unplaced, width: W };
  }

  // several finished files in one download: a zip of the .frame files, stored as they are
  const dosDate = d => ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), dosTime = d => (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  function bundle(files, now = new Date()) {
    return zip(files.map(f => ({
      verMade: 20, verNeed: 20, flags: 0, method: 0, time: dosTime(now), date: dosDate(now), crc: crc32(f.bytes), usize: f.bytes.length,
      intAttr: 0, extAttr: 0, nameBytes: utf8(f.name), data: f.bytes,
    })));
  }

  const api = { unzip, zip, crc32, read, write, addLoads, rowsFor, orient, bundle, cloadsOf, isOurs, learnWebCode, WEB_GUESS, ECC_TOP_LEFT, frameLinesOf, buildingOf, bldgKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_FRAMEFILE = api;
})(typeof self !== 'undefined' ? self : this);
