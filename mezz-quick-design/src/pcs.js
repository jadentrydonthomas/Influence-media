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
  /* State codes that name no IBC year but are built on a known IBC edition (each code's own preface).
     Checked after an explicit "IBC yyyy" and before the ASCE 7 fallback. */
  const STATE_CODES = [
    [/MASS(?:ACHUSETTS)?\b[^\n]*?\b10th/i, 2021, 'Massachusetts 10th Ed. (780 CMR) is based on IBC 2021'],
    [/MASS(?:ACHUSETTS)?\b[^\n]*?\b9th/i, 2015, 'Massachusetts 9th Ed. (780 CMR) is based on IBC 2015'],
    [/(?:\bFBC\b|Florida)[^\n]*?\b8th/i, 2021, 'Florida Building Code 8th Ed. (2023) is based on IBC 2021'],
    [/(?:\bFBC\b|Florida)[^\n]*?\b7th/i, 2018, 'Florida Building Code 7th Ed. (2020) is based on IBC 2018'],
    [/(?:\bCBC\b|California)[^\n]*?\b2025\b/i, 2024, 'California Building Code 2025 is based on IBC 2024'],
    [/(?:\bCBC\b|California)[^\n]*?\b2022\b/i, 2021, 'California Building Code 2022 is based on IBC 2021'],
    [/(?:\bCBC\b|California)[^\n]*?\b2019\b/i, 2018, 'California Building Code 2019 is based on IBC 2018'],
  ];
  function editionFor(code) {
    const st = !/IBC\s*\d{4}/i.test(code) && STATE_CODES.find(([re]) => re.test(code));
    if (st) return { ...editionFor(`IBC ${st[1]}`), state: true, note: `${st[2]} → ${editionFor(`IBC ${st[1]}`).spec}.` };
    const ibc = code.match(/IBC\s*(\d{4})/i), nbcc = code.match(/NBCC\s*(\d{4})/i);
    if (ibc) {
      const y = +ibc[1];
      if (y >= 2024) return { family: 'AISC', year: y, edition: '16', spec: 'AISC 360-22' };
      if (y >= 2018) return { family: 'AISC', year: y, edition: '15', spec: 'AISC 360-16' };
      if (y >= 2012) return { family: 'AISC', year: y, edition: '13', spec: 'AISC 360-10', note: 'IBC 2012/2015 reference AISC 360-10 (14th ed.); no 14th-edition sheet exists, so the 13th-edition sheet is used. Confirm.' };
      return { family: 'AISC', year: y, edition: '13', spec: 'AISC 360-05' };
    }
    if (nbcc) return { family: 'CSA', year: +nbcc[1], edition: +nbcc[1] >= 2020 ? 'S16-19' : 'S16-14', spec: +nbcc[1] >= 2020 ? 'CSA S16-19' : 'CSA S16-14' };
    // state codes without an IBC year (e.g. "Massachusetts (MASS 10th Ed.) ASCE 7-16"): the ASCE 7 edition
    // pins the IBC cycle — 7-22 → IBC 2024, 7-16 → IBC 2018/2021, 7-10 → IBC 2012/2015, 7-05 → IBC 2006/2009
    const asce = code.match(/ASCE\s*7\s*-\s*(\d{2})/i);
    if (asce) {
      const a = +asce[1], via = `No IBC year on the code line; ASCE 7-${asce[1]} → `;
      if (a >= 22) return { family: 'AISC', year: null, asce: a, edition: '16', spec: 'AISC 360-22', note: via + 'IBC 2024 → 16th-edition sheets.' };
      if (a >= 16) return { family: 'AISC', year: null, asce: a, edition: '15', spec: 'AISC 360-16', note: via + 'IBC 2018/2021 → 15th-edition sheets.' };
      if (a >= 10) return { family: 'AISC', year: null, asce: a, edition: '13', spec: 'AISC 360-10', note: via + 'IBC 2012/2015 → 13th-edition sheet (no 14th-edition sheet exists). Confirm.' };
      return { family: 'AISC', year: null, asce: a, edition: '13', spec: 'AISC 360-05', note: via + 'IBC 2006/2009 → 13th-edition sheet.' };
    }
    return { family: 'AISC', year: null, edition: '15', spec: 'AISC 360-16', note: 'Building code not found; defaulting to the 15th-edition sheets.' };
  }

  /* ---------- Box 3: seismic, snow, risk category ----------
     "Occupancy Classification: II - Standard Buildings", "Seismic Information: Ss: 0.169", "S1: 0.058",
     "Site Class: D Soils Report", "Ground Snow Load: 30 psf" */
  function seismicFacts(pages) {
    const txt = allLines(pages.slice(0, 8)).map(l => l.text).join('\n');
    const occ = grab(txt, /Occupancy Classification:\s*(.+?)(?:\s{2,}|\n|$)/);
    const risk = occ && (occ.match(/^\s*(IV|III|II|I)\b/) || [])[1];
    const num = re => { const v = grab(txt, re); return v != null && isFinite(parseFloat(v)) ? parseFloat(v) : null; };
    const site = grab(txt, /Site Class:\s*(.+?)(?:\s{2,}|\n|$)/);
    return {
      occupancy: occ, risk: risk || null, Ss: num(/\bSs:\s*([\d.]+)/), S1: num(/\bS1:\s*([\d.]+)/),
      siteClass: site ? (site.match(/^\s*([A-F])\b/i) || [])[1] || null : null, siteNote: site ? clean(site.replace(/^\s*[A-F]\b/i, '')) || null : null,
      groundSnow: num(/Ground Snow Load:\s*([\d.]+)/), roofLive: num(/(?:^|\s)Live Load:\s*([\d.]+)\s*psf/i),
    };
  }
  /* ---------- Box 4: roof loads per building ----------
     Building | Roof Dead | Roof Snow | Wind Enclosure | Thermal | Primary Collateral | Secondary Collateral | …
     ("Per Seller" or "n psf"; a * on the snow marks a user override) */
  function roofLoads(pages, name) {
    for (const p of pages.slice(0, 8)) {
      const ls = lines(p), h = findLine(ls, /Roof Dead\s+Roof Snow|Roof Dead/i);
      if (h < 0 || !/Collateral/i.test(ls[h].text)) continue;
      const hx = re => { for (const l of ls.slice(h, h + 3)) for (const it of l.items) if (re.test(it.str)) return it.x; return null; };
      const xPrim = hx(/^Primary/i), xSec = hx(/^Secondary/i), xDue = hx(/^Collateral$|Collateral Load/i);
      const end = findLine(ls, /DEFLECTION REQUIREMENTS|^\* /i, h + 1);
      const rows = ls.slice(h + 2, end < 0 ? h + 12 : end).filter(l => l.items.length >= 3 && !/psf/i.test(l.items[0].str));
      const row = rows.find(l => !name || bkey(l.items[0].str) === bkey(name)) || (!name ? rows[0] : null);
      if (!row) continue;
      const psf = t => { const m = /([\d.]+)\s*psf(\*)?/i.exec(t || ''); return m ? { value: +m[1], override: !!m[2] } : /per seller/i.test(t || '') ? { value: null, perSeller: true } : null; };
      const rest = row.items.slice(1);
      const bin = x => [[xPrim, 'coll1'], [xSec, 'coll2'], [xDue, 'due']].filter(c => c[0] != null).sort((a, b) => Math.abs(a[0] - x) - Math.abs(b[0] - x))[0];
      const out = { building: clean(row.items[0].str), dead: psf(rest[0] && rest[0].str), snow: psf(rest[1] && rest[1].str), coll1: null, coll2: null };
      rest.slice(2).forEach(it => { const v = psf(it.str), b = v && v.value != null && bin(it.x); if (b && (b[1] === 'coll1' || b[1] === 'coll2') && out[b[1]] == null) out[b[1]] = v.value; });
      return out;
    }
    return null;
  }
  const bkey = t => String(t || '').toUpperCase().replace(/BUILDING/g, 'BLDG').replace(/[^A-Z0-9]/g, '');

  // ---------- Box 2: building geometry ----------
  function building(pages, name) {
    const pi = pages.findIndex(p => lines(p).some(l => /BUILDING DESCRIPTION/i.test(l.text)));
    if (pi < 0) return null;
    const ls = lines(pages[pi]);
    const out = { name: null, width: null, length: null, ridge: null, eave: null, eaveFSW: null, eaveBSW: null, slopeFSW: null, slopeBSW: null, profile: null, bays: [], lewCols: [], rewCols: [], fswSoldier: [], bswSoldier: [] };
    // building information row: first line after the header carrying >= 3 dimensions
    const hi = findLine(ls, /BUILDING INFORMATION/i);
    for (let i = hi + 1; i < ls.length && i >= 0; i++) {
      if (/ROOF SECONDARY|SIDEWALL AND ENDWALL/i.test(ls[i].text)) break;
      const dims = (ls[i].text.match(reDimAll) || []).map(ftin).filter(v => v != null);
      if (dims.length >= 3 && (!name || ls[i].text.toUpperCase().includes(name.toUpperCase()) || !out.width)) {
        // width, length, distance to ridge (N/A on a single slope or a lean-to), eave heights: N/A keeps its place
        const tok = (ls[i].text.match(new RegExp(DIM + '|N\\/A', 'g')) || []).map(t => (t === 'N/A' ? null : ftin(t)));
        [out.width, out.length, out.ridge, out.eave] = tok.length >= 3 ? tok : dims;
        // eave heights FSW / BSW and roof slopes FSW / BSW ("1:12\"", N/A on the low side of a single slope); the
        // slope's 12" would read as a dimension, so slopes are taken on their own
        out.eaveFSW = out.eave; out.eaveBSW = tok.length >= 5 && tok[4] != null ? tok[4] : out.eave;
        const sl = [...ls[i].text.matchAll(/(\d+(?:\.\d+)?)\s*:\s*12/g)].map(m => +m[1]);
        out.slopeFSW = sl[0] ?? null; out.slopeBSW = sl[1] ?? null;
        out.profile = /single\s*slope/i.test(ls[i].text) ? 'Single Slope' : /lean/i.test(ls[i].text) ? 'Lean-To' : /gable/i.test(ls[i].text) ? 'Gable' : null;
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
      // data rows start with the building name in the first column; continuation rows (spacings that wrap)
      // have nothing there. Only the rows of the mezzanine's building are read (a lean-to has its own row).
      const xFirst = cols[0][1];
      let started = false, current = null;
      for (const l of region) {
        const hasSp = /\d+\s*@/.test(l.text);
        if (!hasSp && started && /Building Name/i.test(l.text)) break;
        if (!hasSp && !(started && /N\/A/.test(l.text))) continue;
        const lead = l.items[0] && l.items[0].x < xFirst - 6 ? clean(l.items[0].str) : null;
        if (lead) current = lead;
        if (name && current && current.toUpperCase() !== name.toUpperCase()) { started = true; continue; }
        started = true;
        l.items.forEach(it => { const k = colOf(it.x); if (k) text[k] += ' ' + it.str; });
      }
      Object.keys(text).forEach(k => { out[k] = spacingList(text[k]); });
    }
    return out;
  }

  // ---------- Box 5: frame information (interior columns) ----------
  function frames(pages, name) {
    const pi = pages.findIndex(p => lines(p).some(l => /FRAME INFORMATION/i.test(l.text)));
    if (pi < 0) return [];
    const ls = lines(pages[pi]);
    const s = findLine(ls, /FRAME INFORMATION/i);
    // every building's block, down to the next box (each block ends with its own "Base Plate Elevations" note)
    const e = findLine(ls, /^\s*6\)\s|6\) ROOF PANEL/i, s + 1);
    let region = ls.slice(s + 1, e < 0 ? ls.length : e);
    // one block per building ("BUILDING NAME: Main", "BUILDING NAME: Lean-To Canopy"): keep the mezzanine's
    const heads = region.map((l, i) => { const m = l.text.match(/BUILDING NAME:\s*(.+?)(?:\s{2,}|$)/i); return m ? { i, name: clean(m[1]) } : null; }).filter(Boolean);
    const key = t => String(t || '').toUpperCase().replace(/BUILDING/g, 'BLDG').replace(/[^A-Z0-9]/g, '');
    if (heads.length) {
      // the named building's block; with no name, the first building's (never another building's frames)
      const k = name ? heads.findIndex(h => key(h.name) === key(name)) : 0;
      if (k < 0) return [];
      region = region.slice(heads[k].i, heads[k + 1] ? heads[k + 1].i : region.length);
    }
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
    // interior column type ("Most Economical" = the ✱ columns on the floor plan): the row's text, down to the next row
    rows.forEach((r, i) => {
      const band = region.filter(l => l.y >= r.y - 3 && (!rows[i + 1] || l.y < rows[i + 1].y - 3)).map(l => l.text).join(' ');
      // "Most" sits on the row, "Economical" wraps to the line under it
      r.intType = /\bMost\b/i.test(band) && /Economical/i.test(band) ? 'Most Economical' : ((band.match(/\b(Pipe|Tube|I-Shape|W-Shape|HSS)\b/i) || [])[1] || null);
    });
    return rows.map(r => ({ from: r.from, to: r.to, wall: r.wall, type: r.type, interior: spacingList(r.tokens.join(' ')), intType: r.intType, clearSpan: spacingList(r.tokens.join(' ')).length <= 1 }));
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
    joists: ['Bolted Joists', 'Welded Joists', 'Bolted Bridging', 'Welded Bridging'],
  };

  /* Box 22. A quote can carry it more than once: "22) MEZZANINES - NONE REQUIRED" in the base scope and the
     alternate's Box 22 pages appended after the drawings ("ALTERNATE #1 MEZZANINE SPECS"). Every block that lists a
     mezzanine is read; a block runs over the next pages while they continue it, and stops at "23)". The same
     mezzanine ID read twice keeps the later one. */
  const isBox22 = t => /22\)\s*MEZZANINES/i.test(t) && !/NONE\s+REQUIRED/i.test(t);
  function mezzanines(pages) {
    const out = [];
    for (let start = 0; start < pages.length; start++) {
      if (!lines(pages[start]).some(l => isBox22(l.text))) continue;
      const blockLines = [];
      let pi = start;
      for (; pi < pages.length; pi++) {
        const ls = lines(pages[pi]);
        if (pi > start && !ls.some(l => isBox22(l.text) || /Mezzanine ID:/i.test(l.text))) break;   // not a continuation
        const s = pi === start ? findLine(ls, /22\)\s*MEZZANINES/i) + 1 : findLine(ls, /CONTROL #/i) + 1;
        const e = findLine(ls, /^2[3-9]\)\s|^23\)/, s);
        ls.slice(s, e < 0 ? ls.length : e).forEach(l => blockLines.push({ ...l, page: pages[pi].num, pageRef: pages[pi] }));
        if (e >= 0) { pi++; break; }
      }
      const starts = blockLines.map((l, i) => (/Mezzanine ID:/i.test(l.text) ? i : -1)).filter(i => i >= 0);
      starts.forEach((s, k) => {
        const m = parseMezz(blockLines.slice(s, k + 1 < starts.length ? starts[k + 1] : blockLines.length));
        const label = (lines(pages[start]).find(l => /LABEL:/i.test(l.text)) || {}).text;
        m.label = label ? clean(label.replace(/^.*LABEL:\s*/i, '')) : null;
        m.alternate = (pages[start].annots || []).map(a => clean(a.text)).find(t => /ALTERNATE/i.test(t)) || (m.label && /created from/i.test(m.label) ? `quote label ${m.label}` : null);
        const at = out.findIndex(x => x.id === m.id);
        if (at >= 0) out.splice(at, 1);
        out.push(m);
      });
      start = Math.max(start, pi - 1);
    }
    return out;
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
      deckType: grab(txt, /(?:^|\s)Deck Type:\s*(.+?)(?:\s{2,}|\n|$)/),
      deckOther: grab(txt, /Other Deck Type:\s*(.+?)(?:\s{2,}|\n|$)/),
      deckAttach: grab(txt, /Deck Attachment:\s*(.+?)(?:\s{2,}|\n|$)/),
      deckFinish: grab(txt, /Deck Finish:\s*(.+?)(?:\s{2,}|\n|$)/),
      primer: grab(txt, /Joist Primer Colou?r:?\s*(.+?)(?:\s{2,}|\n|$)/),
      openings: grab(txt, /Floor Openings[^\n]*\n([^\n]*)/),
      dims: {}, checks: {}, sources: {}, page: ls[0] && ls[0].page,
    };
    if (m.openings && /Materials Provided|Deck Type/i.test(m.openings)) m.openings = null;
    // dimension rows: requested / provided columns + FreeText annotation on the same row
    const pageRef = ls[0] && ls[0].pageRef;
    const annots = pageRef ? (pageRef.annots || []).filter(a => /FreeText/i.test(a.subtype) && clean(a.text)) : [];
    // a blue note on the Design Loads row ("62.5psf" over "Dead Load: Per Seller") is the engineer's dead load
    const loadRow = ls.find(l => /Dead Load:/i.test(l.text));
    if (loadRow) {
      const xLive = (loadRow.items.find(it => /Live Load/i.test(it.str)) || {}).x ?? Infinity;
      const note = annots.find(a => loadRow.y >= a.y1 - 4 && loadRow.y <= a.y2 + 6 && a.x1 < xLive && /^\s*\d+(?:\.\d+)?\s*(?:psf|#)?\s*$/i.test(clean(a.text)));
      if (note) m.deadNote = parseFloat(clean(note.text));
    }
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
    // checkboxes (only available when the page was rendered): each label read off this mezzanine's own row, so two
    // mezzanines on one page keep their own ticks
    if (ls.some(l => l.pageRef && l.pageRef.checks)) {
      Object.entries(CHECK_LABELS).forEach(([grp, labels]) => {
        m.checks[grp] = {};
        labels.forEach(lb => {
          const row = ls.find(l => l.pageRef && l.pageRef.checks && checkRow(l, grp) && l.items.some(it => isLabel(it.str, lb)));
          const it = row && row.items.find(i => isLabel(i.str, lb)), ck = row ? row.pageRef.checks : (pageRef && pageRef.checks) || {};
          m.checks[grp][lb] = (it && ck[checkKey(lb, it.y)]) ?? ck[lb] ?? null;
        });
      });
    }
    return m;
  }

  // positions of checkbox labels on a page (for the renderer to sample just left of them): every mezzanine's rows,
  // each keyed by label and height ("Other" only on the material row, not "Other Deck Type")
  const isLabel = (str, lb) => str === lb || (str.startsWith(lb) && !(lb === 'Other' && /^Other\s+Deck/i.test(str)));
  const checkRow = (l, grp) => CHECK_LABELS[grp].filter(lb => l.items.some(it => isLabel(it.str, lb))).length >= 2;
  const checkKey = (lb, y) => `${lb}@${Math.round(y)}`;
  function checkboxTargets(page) {
    const out = [];
    lines(page).forEach(l => Object.keys(CHECK_LABELS).filter(g => checkRow(l, g)).forEach(g => l.items.forEach(it => {
      const lb = CHECK_LABELS[g].find(w => isLabel(it.str, w));
      if (lb) out.push({ label: lb, key: checkKey(lb, it.y), x: it.x, y: it.y, h: it.h || 8 });
    })));
    return out;
  }
  // pages that carry a Box 22 listing a mezzanine (for checkbox rendering): the base scope's and an alternate's
  function box22Pages(pages) {
    return pages.filter(p => lines(p).some(l => isBox22(l.text) || /Mezzanine ID:/i.test(l.text)));
  }

  // ---------- building attachments: "The Back Sidewall (BSW) of the building Bldg 2 attaches to the Front Sidewall (FSW) of the building Bldg 1 at …" ----------
  function attachments(pages) {
    const text = allLines(pages).map(l => l.text).join(' ').replace(/\s+/g, ' ');
    const re = new RegExp(String.raw`The\s+(?:Front|Back|Left|Right)\s+(?:Sidewall|Endwall)\s*\((FSW|BSW|LEW|REW)\)\s+of the building\s+(.+?)\s+attaches to the\s+(?:Front|Back|Left|Right)\s+(?:Sidewall|Endwall)\s*\((FSW|BSW|LEW|REW)\)\s+of the building\s+(.+?)\s+at\b\s*(` + DIM + ')?', 'gi');
    const out = [];
    let m;
    // "at 0'-0" from the Left Steel Line of the Wall Being Attached to" (left as seen from outside that wall)
    while ((m = re.exec(text))) out.push({ building: clean(m[2]), wall: m[1].toUpperCase(), to: clean(m[4]), toWall: m[3].toUpperCase(), at: m[5] ? ftin(m[5]) : 0 });
    return out;
  }

  function parse(pages) {
    const job = jobFacts(pages);
    const code = buildingCode(pages);
    const mezz = mezzanines(pages);
    // geometry per building the mezzanines sit in (a job can have a main building plus a lean-to, etc.)
    const buildings = {};
    [...new Set(mezz.map(m => m.building || ''))].forEach(n => { buildings[n] = { building: building(pages, n || null), frames: frames(pages, n || null), roof: roofLoads(pages, n || null) }; });
    const first = buildings[(mezz[0] && mezz[0].building) || ''] || { building: building(pages, null), frames: frames(pages, null) };
    // Ecospan (Vulcraft composite joist floor, DM 15.1.5): named anywhere in the text or the blue notes
    const words = allLines(pages).map(l => l.text).concat(pages.flatMap(p => (p.annots || []).map(a => a.text || ''))).join('\n');
    const eco = words.match(/[^\n]{0,60}(ecospan|e-series joist)[^\n]{0,60}/i);
    // a request for tube / HSS / pipe columns (the Column sheet sizes W / BU only): the word next to "column"
    const colReq = allLines(pages).map(l => l.text).find(t => /\b(?:tube|tubular|hss|pipe)\b[^.\n]{0,30}\bcol(?:umn)?s?\b|\bcol(?:umn)?s?\b[^.\n]{0,30}\b(?:tube|tubular|hss|pipe)\b/i.test(t));
    return { job, code, building: first.building, frames: first.frames, buildings, mezzanines: mezz, ecospan: eco ? eco[0].trim() : null, attachments: attachments(pages), seismic: seismicFacts(pages), columnRequest: colReq ? clean(colReq) : null };
  }

  const api = { parse, lines, ftin, fmtFtIn, spacingList, undouble, editionFor, divisionFrom, checkboxTargets, box22Pages, CHECK_LABELS, building, frames, mezzanines, jobFacts, attachments, seismicFacts, roofLoads };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_PCS = api;
})(typeof self !== 'undefined' ? self : this);
