/* PCS (Project Confirmation Summary / eQuote) parser.

   Works on pre-extracted pages so it runs the same in the browser (pdf.js) and in Node tests:
     pages: [{ num, width, height,
               items:  [{ str, x, y, w, h }]            // y = baseline measured from the TOP of the page
               annots: [{ subtype, text, x1, y1, x2, y2 }] // top-origin rectangle
               checks?: { [label]: true|false|null } }]   // checkbox states found by rendering (browser)

   Blue "handwritten" values on the PCS are FreeText annotations, not text. The floor plan page has no
   text layer, so geometry comes from Box 2 (bays / endwall columns) and Box 5 (frame modules). */
(function (root) {
  'use strict';

  // ---------- text helpers ----------
  // Header text on the eQuote is double-struck; pdf.js can return "BBuuiillddiinngg". Collapse only when
  // every character is doubled, so "Gable Symmetrical" or "1:12" are left alone.
  function undouble(s) {
    if (s.length < 4 || s.length % 2) return s;
    for (let i = 0; i < s.length; i += 2) if (s[i] !== s[i + 1]) return s;
    let o = '';
    for (let i = 0; i < s.length; i += 2) o += s[i];
    return o;
  }
  const clean = s => undouble(String(s || '').replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"').replace(/\s+/g, ' ').trim());

  // ft-in text -> feet. Accepts 12'-0", 0'-3 1/2", 10'-2", 5", 4', 3.5", 12.5
  function ftin(s) {
    if (s == null) return null;
    const t = clean(s).replace(/\s*-\s*/g, '-');
    if (!t || /^(TBD|N\/?A|--|Per Seller)$/i.test(t)) return null;
    let m = t.match(/^(-?\d+(?:\.\d+)?)'(?:-?(\d+(?:\.\d+)?)?(?:[ -](\d+)\/(\d+))?"?)?$/);
    if (m) return +m[1] + ((+m[2] || 0) + (m[3] ? +m[3] / +m[4] : 0)) / 12;
    m = t.match(/^(\d+(?:\.\d+)?)(?:[ -](\d+)\/(\d+))?"$/);
    if (m) return (+m[1] + (m[2] ? +m[2] / +m[3] : 0)) / 12;
    m = t.match(/^(\d+)\/(\d+)"$/);
    if (m) return (+m[1] / +m[2]) / 12;
    m = t.match(/^(-?\d+(?:\.\d+)?)$/);
    if (m) return +m[1];
    return null;
  }
  const DIM = String.raw`-?\d+'(?:\s*-\s*\d+(?:\.\d+)?(?:[ -]\d+\/\d+)?")?|\d+(?:\.\d+)?(?:[ -]\d+\/\d+)?"`;
  const reDimAll = new RegExp(DIM, 'g');
  // "2@20'-0", 3@24'-0"" -> [20,20,24,24,24]
  function spacingList(s) {
    const out = [];
    const re = new RegExp(String.raw`(\d+)\s*@\s*(` + DIM + ')', 'g');
    let m;
    while ((m = re.exec(clean(s)))) { const f = ftin(m[2]); for (let i = 0; i < +m[1]; i++) out.push(f); }
    return out;
  }
  const fmtFtIn = ft => {
    if (ft == null || !isFinite(ft)) return '—';
    const neg = ft < 0; ft = Math.abs(ft);
    let f = Math.floor(ft + 1e-9), i = Math.round((ft - f) * 12 * 8) / 8;
    if (i >= 12) { f += 1; i -= 12; }
    const whole = Math.floor(i), frac = i - whole;
    const fr = frac ? ' ' + ({ 0.125: '1/8', 0.25: '1/4', 0.375: '3/8', 0.5: '1/2', 0.625: '5/8', 0.75: '3/4', 0.875: '7/8' })[frac] : '';
    return (neg ? '-' : '') + f + "'-" + whole + fr + '"';
  };

  // ---------- page -> lines ----------
  // pdf.js hands back kerning fragments ("P" "er" "Seller", "12'" "-" "0\""). Rebuild phrases from the
  // x-gaps: < ~0.15 em joins letters, < ~1.6 em is a word space, anything wider is a new column.
  // Double-struck headers arrive as the same string drawn twice on top of itself; keep one copy.
  const cache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function lines(page, tol = 2.2) {
    if (cache && cache.has(page)) return cache.get(page);
    const its = page.items.map(i => ({ ...i, str: String(i.str || '').replace(/\s+/g, ' ') })).filter(i => i.str.trim());
    its.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    its.forEach(it => {
      const L = rows.find(l => Math.abs(l.y - it.y) <= tol);
      L ? L.raw.push(it) : rows.push({ y: it.y, raw: [it] });
    });
    const out = rows.map(r => {
      const raw = r.raw.sort((a, b) => a.x - b.x).filter((it, i, a) => !a.slice(0, i).some(p => p.str === it.str && Math.abs(p.x - it.x) < 1.5));
      const items = [];
      let cur = null;
      raw.forEach(it => {
        const em = it.h || 8;
        const gap = cur ? it.x - cur.xEnd : Infinity;
        if (cur && gap < 1.6 * em && gap > -0.5 * em) {
          cur.str += (gap > 0.15 * em && !/\s$/.test(cur.str) ? ' ' : '') + it.str;
          cur.xEnd = Math.max(cur.xEnd, it.x + (it.w || 0));
        } else if (cur && gap <= -0.5 * em) {
          // overlap (second strike of a double-struck run): ignore
        } else {
          cur = { str: it.str, x: it.x, y: it.y, h: it.h, xEnd: it.x + (it.w || 0) };
          items.push(cur);
        }
      });
      items.forEach(i => { i.str = clean(i.str); i.w = i.xEnd - i.x; });
      return { y: r.y, items: items.filter(i => i.str), text: items.map(i => i.str).filter(Boolean).join('  ') };
    }).filter(l => l.items.length);
    out.sort((a, b) => a.y - b.y);
    if (cache) cache.set(page, out);
    return out;
  }
  const allLines = pages => pages.flatMap(p => lines(p).map(l => ({ ...l, page: p.num })));
  const findLine = (ls, re, from = 0) => { for (let i = from; i < ls.length; i++) if (re.test(ls[i].text)) return i; return -1; };
  const grab = (text, re) => { const m = text.match(re); return m ? clean(m[1]) : null; };

  // ---------- header / job facts ----------
  function jobFacts(pages) {
    const ls = allLines(pages.slice(0, 4));
    const txt = ls.map(l => l.text).join('\n');
    const quote = grab(txt, /QUOTE #:\s*([A-Z0-9][A-Z0-9-]+)/);
    const project = grab(txt, /Project Name:\s*(.+?)(?:\s{2,}|\n|$)/);
    const date = grab(txt, /DATE:\s*([\d/]+)/);
    const divText = grab(txt, /(Nucor Building Systems\s*-\s*[A-Z]{2}|American Buildings|Kirby Building Systems|CBC Steel Buildings|Gulf States Manufacturers|Nucor Buildings Group[^\n]*)/i) || '';
    return { quote, project, date, divisionText: divText, division: divisionFrom(divText) };
  }
  function divisionFrom(t) {
    t = t.toLowerCase();
    if (/nucor building systems\s*-\s*in/.test(t)) return 'NBS-IN';
    if (/nucor building systems\s*-\s*sc/.test(t)) return 'NBG-SC';
    if (/nucor building systems\s*-\s*tx/.test(t)) return 'NBG-TX';
    if (/nucor building systems\s*-\s*(ut|ca)/.test(t) || /cbc/.test(t)) return 'West';
    if (/american buildings/.test(t)) return 'ABC-IL';
    if (/kirby/.test(t)) return 'KBS-TN';
    return 'NBS-IN';
  }

  // ---------- Box 3: building code -> edition ----------
  function buildingCode(pages) {
    const txt = allLines(pages).map(l => l.text).join('\n');
    const code = grab(txt, /Building Code:\s*(.+?)(?:\s{2,}|\n|$)/);
    return { text: code, ...editionFor(code || '') };
  }
  function editionFor(code) {
    const ibc = code.match(/IBC\s*(\d{4})/i), nbcc = code.match(/NBCC\s*(\d{4})/i);
    if (ibc) {
      const y = +ibc[1];
      if (y >= 2024) return { family: 'AISC', year: y, edition: '16', spec: 'AISC 360-22' };
      if (y >= 2018) return { family: 'AISC', year: y, edition: '15', spec: 'AISC 360-16' };
      if (y >= 2012) return { family: 'AISC', year: y, edition: '13', spec: 'AISC 360-10', note: 'IBC 2012/2015 reference AISC 360-10 (14th ed.); no 14th-edition sheet exists, so the 13th-edition sheet is used. Confirm.' };
      return { family: 'AISC', year: y, edition: '13', spec: 'AISC 360-05' };
    }
    if (nbcc) return { family: 'CSA', year: +nbcc[1], edition: +nbcc[1] >= 2020 ? 'S16-19' : 'S16-14', spec: +nbcc[1] >= 2020 ? 'CSA S16-19' : 'CSA S16-14' };
    return { family: 'AISC', year: null, edition: '15', spec: 'AISC 360-16', note: 'Building code not found; defaulting to the 15th-edition sheets.' };
  }

  // ---------- Box 2: building geometry ----------
  function building(pages, name) {
    const pi = pages.findIndex(p => lines(p).some(l => /BUILDING DESCRIPTION/i.test(l.text)));
    if (pi < 0) return null;
    const ls = lines(pages[pi]);
    const out = { name: null, width: null, length: null, ridge: null, eave: null, bays: [], lewCols: [], rewCols: [], fswSoldier: [], bswSoldier: [] };
    // building information row: first line after the header carrying >= 3 dimensions
    const hi = findLine(ls, /BUILDING INFORMATION/i);
    for (let i = hi + 1; i < ls.length && i >= 0; i++) {
      if (/ROOF SECONDARY|SIDEWALL AND ENDWALL/i.test(ls[i].text)) break;
      const dims = (ls[i].text.match(reDimAll) || []).map(ftin).filter(v => v != null);
      if (dims.length >= 3 && (!name || ls[i].text.toUpperCase().includes(name.toUpperCase()) || !out.width)) {
        [out.width, out.length, out.ridge, out.eave] = dims;
        out.name = clean(ls[i].items[0].str);
        if (!name || out.name.toUpperCase() === name.toUpperCase()) break;
      }
    }
    // sidewall / endwall spacing table: bin n@ft-in tokens by header column x
    const si = findLine(ls, /SIDEWALL AND ENDWALL SPACING/i);
    if (si >= 0) {
      const end = findLine(ls, /GIRT CONDITION|ROOF PANEL|3\) PROJECT/i, si + 1);
      const region = ls.slice(si + 1, end < 0 ? ls.length : end);
      const hx = re => { for (const l of region) for (const it of l.items) if (re.test(it.str)) return it.x; return null; };
      const cols = [
        ['bays', hx(/^Sidewall Bay/i)], ['fswSoldier', hx(/^FSW Soldier/i)], ['bswSoldier', hx(/^BSW Soldier/i)],
        ['lewCols', hx(/^Left Endwall/i)], ['rewCols', hx(/^Right Endwall/i)],
      ].filter(c => c[1] != null).sort((a, b) => a[1] - b[1]);
      const colOf = x => { let k = null; cols.forEach(c => { if (x >= c[1] - 6) k = c[0]; }); return k; };
      const text = { bays: '', fswSoldier: '', bswSoldier: '', lewCols: '', rewCols: '' };
      // the first header block ends where the data row starts; stop at the repeated header
      let started = false;
      for (const l of region) {
        const hasSp = /\d+\s*@/.test(l.text);
        if (!hasSp && started && /Building Name/i.test(l.text)) break;
        if (!hasSp && !(started && /N\/A/.test(l.text))) continue;
        started = true;
        l.items.forEach(it => { const k = colOf(it.x); if (k) text[k] += ' ' + it.str; });
      }
      Object.keys(text).forEach(k => { out[k] = spacingList(text[k]); });
    }
    return out;
  }

  // ---------- Box 5: frame information (interior columns) ----------
  function frames(pages) {
    const pi = pages.findIndex(p => lines(p).some(l => /FRAME INFORMATION/i.test(l.text)));
    if (pi < 0) return [];
    const ls = lines(pages[pi]);
    const s = findLine(ls, /FRAME INFORMATION/i);
    const e = findLine(ls, /Base Plate Elevations|6\) ROOF PANEL/i, s + 1);
    const region = ls.slice(s + 1, e < 0 ? ls.length : e);
    const rows = [];
    region.forEach(l => {
      const m = l.items[0] && l.items[0].str.match(/^(\d+)(?:\s*-\s*(\d+))?(?:\s*\((LEW|REW)\))?$/);
      const typeIt = l.items[1] && /Frame|Bearing|Post|Beam|Lean|Rigid|Truss/i.test(l.items[1].str);
      if (m && typeIt) rows.push({ from: +m[1], to: m[2] ? +m[2] : +m[1], wall: m[3] || null, type: clean(l.items[1].str), y: l.y, tokens: [] });
    });
    // module spacing tokens (n@ft) belong to the nearest row above
    region.forEach(l => l.items.forEach(it => {
      if (!/\d+\s*@/.test(it.str)) return;
      let row = null;
      rows.forEach(r => { if (it.y >= r.y - 3) row = r; });
      if (row) row.tokens.push(it.str);
    }));
    return rows.map(r => ({ from: r.from, to: r.to, wall: r.wall, type: r.type, interior: spacingList(r.tokens.join(' ')), clearSpan: spacingList(r.tokens.join(' ')).length <= 1 }));
  }

  // ---------- Box 22: mezzanines ----------
  const DIM_ROWS = [
    ['A', /^\(A\)/], ['B', /^\(B\)/], ['C', /^\(C\)/], ['D', /^\(D\)/], ['E', /^\(E\)/], ['F', /^\(F\)/],
    ['joistSpacing', /^Mezzanine Joist Spacing/i], ['seat', /^Joist Seat Depth/i],
  ];
  const CHECK_LABELS = {
    material: ['Standard Weight Concrete', 'Light Weight Concrete', 'Extruded-Mesh or Diamond-Plate Steel', 'Plywood', 'Other'],
    use: ['Storage', 'Office', 'Retail Store', 'Manufacturing', 'Classroom', 'Theater'],
    provided: ['Designed For Load Provisions Only', 'Auxiliary Columns', 'Support Beams', 'Edge Angle / Pour Stop'],
  };

  function mezzanines(pages) {
    const start = pages.findIndex(p => lines(p).some(l => /22\)\s*MEZZANINES/i.test(l.text)));
    if (start < 0) return [];
    // Box 22 may run over several pages; stop at "23)"
    const blockLines = [];
    for (let pi = start; pi < pages.length; pi++) {
      const ls = lines(pages[pi]);
      let s = pi === start ? findLine(ls, /22\)\s*MEZZANINES/i) + 1 : findLine(ls, /CONTROL #/i) + 1;
      const e = findLine(ls, /^2[3-9]\)\s|^23\)/, s);
      ls.slice(s, e < 0 ? ls.length : e).forEach(l => blockLines.push({ ...l, page: pages[pi].num, pageRef: pages[pi] }));
      if (e >= 0) break;
    }
    const starts = blockLines.map((l, i) => (/Mezzanine ID:/i.test(l.text) ? i : -1)).filter(i => i >= 0);
    return starts.map((s, k) => parseMezz(blockLines.slice(s, k + 1 < starts.length ? starts[k + 1] : blockLines.length)));
  }

  function parseMezz(ls) {
    const txt = ls.map(l => l.text).join('\n');
    const num = v => (v == null ? null : /per seller/i.test(v) ? 'Per Seller' : isFinite(+v) ? +v : null);
    const m = {
      id: grab(txt, /Mezzanine ID:\s*(.+?)(?:\s{2,}Building Name|\n|$)/),
      building: grab(txt, /Building Name:\s*(.+?)(?:\s{2,}|\n|$)/),
      dead: num(grab(txt, /Dead Load:\s*(.+?)\s*PSF/i)),
      live: num(grab(txt, /Live Load:\s*(.+?)\s*PSF/i)),
      collateral: num(grab(txt, /Collateral(?: \(Bottom Chord\))?:\s*(.+?)\s*PSF/i)),
      partition: num(grab(txt, /Partition Loads?:\s*(.+?)\s*PSF/i)),
      width: ftin(grab(txt, new RegExp(String.raw`Width:\s*(` + DIM + ')'))),
      length: ftin(grab(txt, new RegExp(String.raw`Length:\s*(` + DIM + ')'))),
      slab: ftin(grab(txt, new RegExp(String.raw`Slab\/Deck Thickness:\s*(` + DIM + ')'))),
      startLEW: ftin(grab(txt, new RegExp(String.raw`Start Location from LEW\s*(` + DIM + ')'))),
      startFSW: ftin(grab(txt, new RegExp(String.raw`Start Location from FSW\s*(` + DIM + ')'))),
      deckType: grab(txt, /Deck Type:\s*(.+?)(?:\s{2,}|\n|$)/),
      openings: grab(txt, /Floor Openings[^\n]*\n([^\n]*)/),
      dims: {}, checks: {}, sources: {}, page: ls[0] && ls[0].page,
    };
    if (m.openings && /Materials Provided|Deck Type/i.test(m.openings)) m.openings = null;
    // dimension rows: requested / provided columns + FreeText annotation on the same row
    const pageRef = ls[0] && ls[0].pageRef;
    const annots = pageRef ? (pageRef.annots || []).filter(a => /FreeText/i.test(a.subtype) && clean(a.text)) : [];
    const hdr = ls.find(l => /Requested/.test(l.text) && /Provided/.test(l.text));
    const xReq = hdr ? hdr.items.find(i => /Requested/.test(i.str)).x : null;
    const xProv = hdr ? hdr.items.find(i => /Provided/.test(i.str)).x : null;
    DIM_ROWS.forEach(([key, re]) => {
      const row = ls.find(l => l.items.some(it => re.test(it.str)));
      if (!row) return;
      const lab = row.items.findIndex(it => re.test(it.str));
      const vals = row.items.slice(lab + 1).filter(it => !/^Joist Primer/i.test(it.str));
      let req = null, prov = null;
      vals.forEach(it => {
        if (xReq != null && xProv != null) (Math.abs(it.x - xReq) < Math.abs(it.x - xProv) ? (req = req ?? it.str) : (prov = prov ?? it.str));
        else req == null ? (req = it.str) : (prov = prov ?? it.str);
      });
      const ann = annots.find(a => row.y >= a.y1 - 2 && row.y <= a.y2 + 4 && (xProv == null || a.x1 > xProv - 30));
      const annTxt = ann ? clean(ann.text) : null;
      let value = null, src = null;
      if (ftin(req) != null) { value = ftin(req); src = 'requested'; }
      else if (ftin(annTxt) != null) { value = ftin(annTxt); src = 'annotation'; }
      else if (ftin(prov) != null) { value = ftin(prov); src = 'provided'; }
      m.dims[key] = { requested: req, provided: prov, annotation: annTxt, value, source: src };
    });
    // checkboxes (only available when the page was rendered)
    if (pageRef && pageRef.checks) {
      Object.entries(CHECK_LABELS).forEach(([grp, labels]) => {
        m.checks[grp] = {};
        labels.forEach(lb => { m.checks[grp][lb] = pageRef.checks[lb] ?? null; });
      });
    }
    return m;
  }

  // positions of checkbox labels on a page (for the renderer to sample just left of them)
  function checkboxTargets(page) {
    const want = Object.values(CHECK_LABELS).flat();
    const out = [];
    lines(page).forEach(l => l.items.forEach(it => {
      const lb = want.find(w => it.str === w || it.str.startsWith(w));
      if (lb && !out.some(o => o.label === lb)) out.push({ label: lb, x: it.x, y: it.y, h: it.h || 8 });
    }));
    return out;
  }
  // pages that carry Box 22 (for checkbox rendering)
  function box22Pages(pages) {
    const s = pages.findIndex(p => lines(p).some(l => /22\)\s*MEZZANINES/i.test(l.text)));
    if (s < 0) return [];
    const out = [];
    for (let i = s; i < pages.length; i++) { out.push(pages[i]); if (lines(pages[i]).some(l => /^2[3-9]\)/.test(l.text))) break; }
    return out;
  }

  function parse(pages) {
    const job = jobFacts(pages);
    const code = buildingCode(pages);
    const mezz = mezzanines(pages);
    const bname = mezz[0] && mezz[0].building;
    const bldg = building(pages, bname);
    const fr = frames(pages);
    return { job, code, building: bldg, frames: fr, mezzanines: mezz };
  }

  const api = { parse, lines, ftin, fmtFtIn, spacingList, undouble, editionFor, divisionFrom, checkboxTargets, box22Pages, CHECK_LABELS, building, frames, mezzanines, jobFacts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_PCS = api;
})(typeof self !== 'undefined' ? self : this);
