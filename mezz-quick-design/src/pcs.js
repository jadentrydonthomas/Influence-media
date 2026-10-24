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
  // a value typed in a note, where the marks are often left off: "10-6 5/8", "2-8", "0-0" are feet-inches
  function ftinTyped(s) {
    const v = ftin(s);
    if (v != null || s == null) return v;
    const m = clean(s).replace(/\s*-\s*/g, '-').match(/^(\d+)-(\d+(?:\.\d+)?)(?: (\d+)\/(\d+))?$/);
    return m ? +m[1] + (+m[2] + (m[3] ? +m[3] / +m[4] : 0)) / 12 : null;
  }
  function ftin(s) {
    if (s == null) return null;
    const t = clean(s).replace(/\s*-\s*/g, '-');
    if (!t || /^(TBD|N\/?A|--|Per Seller)$/i.test(t)) return null;
    let m = t.match(/^(-?\d+(?:\.\d+)?)'(?:-?(\d+(?:\.\d+)?)?(?:[ -](\d+)\/(\d+))?"?)?$/);
    if (m) return +m[1] + ((+m[2] || 0) + (m[3] ? +m[3] / +m[4] : 0)) / 12;
    // the foot mark lost to OCR: 8-4 1/2" is 8'-4 1/2" (2-3/4" stays inches)
    m = t.match(/^(\d+)-(\d+(?:\.\d+)?)(?: (\d+)\/(\d+))?"$/);
    if (m) return +m[1] + (+m[2] + (m[3] ? +m[3] / +m[4] : 0)) / 12;
    m = t.match(/^(\d+(?:\.\d+)?)(?:[ -](\d+)\/(\d+))?"$/);
    if (m) return (+m[1] + (m[2] ? +m[2] / +m[3] : 0)) / 12;
    m = t.match(/^(\d+)\/(\d+)"$/);
    if (m) return (+m[1] / +m[2]) / 12;
    m = t.match(/^(-?\d+(?:\.\d+)?)$/);
    if (m) return +m[1];
    return null;
  }
  // 12'-0", 0'-3 1/2", 5", 2-3/4" — and 8-4 1/2" (8'-4 1/2" with the foot mark lost to OCR)
  const DIM = String.raw`-?\d+'(?:\s*-\s*\d+(?:\.\d+)?(?:[ -]\d+\/\d+)?")?|\d+-\d+(?:\.\d+)?(?: \d+\/\d+)?"|\d+(?:\.\d+)?(?:[ -]\d+\/\d+)?"`;
  const reDimAll = new RegExp(DIM, 'g');
  // "2@20'-0", 3@24'-0"" -> [20,20,24,24,24]
  function spacingList(s) {
    const out = [];
    const re = new RegExp(String.raw`(\d+)\s*@\s*(` + DIM + ')', 'g');
    let m;
    while ((m = re.exec(clean(s)))) { const f = ftin(m[2]); for (let i = 0; i < +m[1]; i++) out.push(f); }
    return out;
  }
  // to the 1/16" the PCS itself writes (1'-10 13/16"), reduced (1/2, 3/8, 9/16)
  const fmtFtIn = ft => {
    if (ft == null || !isFinite(ft)) return '—';
    const neg = ft < 0; ft = Math.abs(ft);
    let f = Math.floor(ft + 1e-9), n = Math.round((ft - f) * 12 * 16);
    if (n >= 12 * 16) { f += 1; n -= 12 * 16; }
    const whole = Math.floor(n / 16), q = n % 16, gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const fr = q ? ` ${q / gcd(q, 16)}/${16 / gcd(q, 16)}` : '';
    return (neg && (f || n) ? '-' : '') + f + "'-" + whole + fr + '"';
  };

  // ---------- page -> lines ----------
  // pdf.js hands back kerning fragments ("P" "er" "Seller", "12'" "-" "0\""). Rebuild phrases from the
  // x-gaps: < ~0.15 em joins letters, < ~1.6 em is a word space, anything wider is a new column.
  // Double-struck headers arrive as the same string drawn twice on top of itself; keep one copy.
  const cache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  /* The quote engineer's corrections typed over the print as PDF markup: a value struck through with a line annotation
     and the new one typed just past the line's end on its row (a FreeText) — "1@20'-6"," struck, "14'-8"" beside it.
     The struck words leave the text and the typed value takes their place, keeping the struck token's "n@" count and
     its comma, so every table reads the corrected value. page.edits keeps each change for the report. */
  function markupItems(page) {
    if (page.edits) return page.editedItems || page.items;
    page.edits = [];
    const an = page.annots || [];
    const strikes = an.filter(a => /^Line$/i.test(a.subtype) && a.line && Math.abs(a.line[0][1] - a.line[1][1]) < 2.5 && Math.abs(a.line[1][0] - a.line[0][0]) > 8);
    if (!strikes.length) return page.items;
    const typed = an.filter(a => /FreeText/i.test(a.subtype) && clean(a.text)), gone = new Set(), added = [];
    // the items as words (kerning fragments touching each other: "P" "er" → Per), so a stroke through most of a word
    // strikes all of it; a unit after the value (PSF) stays
    const words = [];
    page.items.slice().sort((a, b) => a.y - b.y || a.x - b.x).forEach(it => {
      const w = words.find(q => Math.abs(q.y - it.y) < 1.5 && Math.abs(it.x - q.xEnd) < 0.25 * (it.h || 8));
      if (w) { w.its.push(it); w.xEnd = Math.max(w.xEnd, it.x + (it.w || 0)); } else words.push({ y: it.y, h: it.h || 8, x: it.x, xEnd: it.x + (it.w || 0), its: [it] });
    });
    const UNIT = /^(?:psf|plf|lbs?|ksi|kips?|k|ft|in)\.?$/i;
    strikes.forEach(st => {
      const y = (st.line[0][1] + st.line[1][1]) / 2, x0 = Math.min(st.line[0][0], st.line[1][0]), x1 = Math.max(st.line[0][0], st.line[1][0]);
      const ws = words.filter(w => y < w.y + 0.5 && y > w.y - w.h && Math.min(x1, w.xEnd) - Math.max(x0, w.x) > 0.4 * Math.min(w.xEnd - w.x || 1, x1 - x0) && !UNIT.test(w.its.map(i => i.str).join('').trim()));
      const hit = ws.flatMap(w => w.its).filter(it => !gone.has(it)).sort((a, b) => a.x - b.x);
      if (!hit.length) return;
      const rep = typed.find(n => n.x1 >= x1 - 12 && n.x1 <= x1 + 30 && Math.min(n.y2, y + 5) - Math.max(n.y1, y - 5) > 2);
      const was = clean(hit.map(i => i.str).join(''));
      hit.forEach(i => gone.add(i));
      const now = rep ? clean(rep.text) : null;
      if (now) {
        const cnt = (was.match(/^(\d+\s*@)/) || [])[1] || '', comma = /,\s*$/.test(was) ? ',' : '';
        const str = /^\d+\s*@/.test(now) ? now + comma : cnt + now + comma;
        added.push({ str, x: hit[0].x, y: hit[0].y, h: hit[0].h, w: Math.max(hit[hit.length - 1].x + (hit[hit.length - 1].w || 0) - hit[0].x, 6 * str.length * 0.5), markup: true });
      }
      if (rep) (page.editReps = page.editReps || new Set()).add(rep);
      page.edits.push({ was, now, x: hit[0].x, y: hit[0].y, page: page.num });
    });
    page.editedItems = page.items.filter(i => !gone.has(i)).concat(added);
    return page.editedItems;
  }
  function lines(page, tol = 2.2) {
    if (cache && cache.has(page)) return cache.get(page);
    const its = markupItems(page).map(i => ({ ...i, str: String(i.str || '').replace(/\s+/g, ' ') })).filter(i => i.str.trim());
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
          if (it.conf != null) cur.conf = Math.min(cur.conf ?? 100, it.conf);
          if (it.color === 'red') cur.red = true;
        } else if (cur && gap <= -0.5 * em) {
          // overlap (second strike of a double-struck run): ignore
        } else {
          cur = { str: it.str, x: it.x, y: it.y, h: it.h, xEnd: it.x + (it.w || 0) };
          if (it.conf != null) cur.conf = it.conf;     // read by OCR: the least sure word of the phrase
          if (it.color === 'red') cur.red = true;      // written in red over the print
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
  const shift = (l, dy) => ({ ...l, y: l.y + dy, items: l.items.map(it => ({ ...it, y: it.y + dy })) });

  /* A numbered box's lines, from its heading ("5) FRAME INFORMATION") down to the next box's heading. A box that runs
     past the page goes on under the next page's header ("5) FRAME INFORMATION (CONTINUED)" after "CONTROL #"); those
     lines are shifted below the page before, so a wrapped row still reads as the row above it. */
  function boxLines(pages, n) {
    const head = new RegExp(String.raw`^\s*${n}\)\s`);
    const isNext = l => { const m = l.text.match(/^\s*(\d{1,2})\)\s+[A-Z][A-Z ,&/-]{3,}/); return !!m && +m[1] > n; };
    const out = [];
    let dy = 0, on = false;
    for (const p of pages) {
      const ls = lines(p);
      let from;
      if (!on) {
        const h = findLine(ls, head);
        if (h < 0) continue;
        on = true; from = h + 1;
      } else {
        const c = findLine(ls, /CONTROL #/i) + 1;
        if (!(ls[c] && head.test(ls[c].text) && /CONTINUED/i.test(ls[c].text))) break;
        from = c + 1;
      }
      let e = -1;
      for (let i = from; i < ls.length; i++) if (isNext(ls[i])) { e = i; break; }
      ls.slice(from, e < 0 ? ls.length : e).forEach(l => out.push(dy ? shift(l, dy) : l));
      if (e >= 0) break;
      dy += p.height || 792;
    }
    return out;
  }

  /* Building names. A name wraps inside its table cell ("MAINTENANCE" / "BUILDING", or mid-word "MAINTENAN" /
     "CE BUILDING"), and Box 5 runs it into the next words ("BUILDING NAME: MAINTENANCE BUILDING Cold Formed Materials
     Allowed on Frame"). Names compare on letters and digits only, BLDG read as BUILDING, so the pieces of a wrapped name
     join to the same key however the cell broke them. */
  const nkey = t => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/BLDG/g, 'BUILDING');
  const headName = t => clean(t).replace(/\s*\bCold\s+Formed\s+Materials\b.*$/i, '');
  // every building name the quote spells out in full: Box 5's block heads, Box 22's mezzanines, the attachment notes
  const knownCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function knownNames(pages, name) {
    let base = knownCache && knownCache.get(pages);
    if (!base) {
      base = [];
      allLines(pages).forEach(l => { const m = l.text.match(/BUILDING NAME:\s*(.+?)(?:\s{2,}|$)/i); if (m) base.push(headName(m[1])); });
      attachments(pages).forEach(a => base.push(a.building, a.to));
      if (knownCache) knownCache.set(pages, base);
    }
    return [...new Set([name, ...base].filter(Boolean))];
  }
  /* The rows of a table that opens each row with the building name (cells left of xData). A name piece that carries the
     row's name on toward a known building name continues that row; any other piece opens a new row; a line with
     nothing in the name cell (a spacing list that wraps) stays with the row above. `glue` finds where the next cell
     starts when a short gap ran it into the name ("MAINTENAN Per Seller"); unless the whole text still spells toward a
     known name, it is cut there and the rest kept as the row's first value. */
  function nameRows(ls, xData, known, glue) {
    const keys = known.map(nkey).filter(Boolean), rows = [];
    ls.forEach(l => {
      let items = l.items, piece = null;
      const it = items[0], cur = rows[rows.length - 1];
      if (it && it.x < xData - 6) {
        const fits = s => keys.some(k => k.startsWith(nkey(s)) || (cur && k.startsWith(nkey(cur.raw + ' ' + s))));
        const g = glue ? it.str.search(glue) : -1;
        const cut = g >= 0 && !fits(it.str);
        piece = cut ? it.str.slice(0, g).trim() || null : it.str;
        if (cut) items = [...(piece ? [{ ...it, str: piece }] : []), { ...it, str: it.str.slice(g).trim(), x: xData }, ...items.slice(1)];
        if (piece) items = [{ ...items[0], name: true }, ...items.slice(1)];
      }
      const line = { ...l, items };
      if (piece) {
        const joined = cur ? nkey(cur.raw + ' ' + piece) : '';
        if (cur && joined && keys.some(k => k.startsWith(joined))) { cur.raw += ' ' + piece; cur.lines.push(line); }
        else rows.push({ raw: piece, lines: [line] });
      } else if (cur) cur.lines.push(line);
    });
    rows.forEach(r => { r.key = nkey(r.raw); r.name = known.find(n => nkey(n) === r.key) || clean(r.raw); });
    return rows;
  }
  /* The named building's row: the same name; else the one row whose name starts the other (a cut-off cell); else, when
     the table lists a single building, that one. With no name, the first row. `matched` says which rule found it. */
  function pickRow(rows, name, known = []) {
    if (!name) return rows[0] ? { row: rows[0], matched: 'first' } : null;
    const k = nkey(name);
    const same = rows.find(r => r.key === k);
    if (same) return { row: same, matched: 'name' };
    // a cut-off cell may start the name, but a row that is another building's whole name ("Main" for "Main Extension")
    // never stands in for it
    const other = new Set(known.map(nkey).filter(q => q && q !== k));
    const pre = rows.filter(r => r.key && !other.has(r.key) && (k.startsWith(r.key) || r.key.startsWith(k)));
    if (pre.length === 1) return { row: pre[0], matched: 'prefix' };
    return rows.length === 1 ? { row: rows[0], matched: 'only' } : null;
  }

  // ---------- header / job facts ----------
  /* The Quote and Order Document's first page. A contract puts the order acknowledgement letter ahead of it (and a
     project summary sheet can come first), so the header and Box 3 are read from there, not from page 1. */
  function qoStart(pages) {
    const i = pages.findIndex(p => lines(p).some(l => /QUOTE AND ORDER DOCUMENT/i.test(l.text)));
    return i < 0 ? 0 : i;
  }
  const PLANT = String.raw`(?:Nucor Building Systems|Nucor Buildings Group)\s*[-–—]?\s*[A-Z]{2}\b`;   // OCR can drop the dash
  function jobFacts(pages) {
    const at = qoStart(pages), head = allLines(pages.slice(at, at + 4)).map(l => l.text).join('\n');
    const txt = head + '\n' + allLines(pages.slice(0, 4)).map(l => l.text).join('\n');
    const quote = grab(txt, /QUOTE #:\s*([A-Z0-9][A-Z0-9-]+)/);
    const project = grab(txt, /Project Name:\s*(.+?)(?:\s{2,}|\n|$)/);
    const date = grab(txt, /DATE:\s*([\d/]+)/);
    // the plant on the order form's own header ("Nucor Buildings Group – SC"), else its address, else a sister brand
    const divText = grab(head, new RegExp('(' + PLANT + ')', 'i')) || grab(txt, new RegExp('(' + PLANT + '|American Buildings|Kirby Building Systems|CBC Steel Buildings|Gulf States Manufacturers)', 'i'))
      || grab(head, /((?:Swansea|Waterloo|Terrell|Brigham City),?\s*[A-Z]{2})\b/i) || '';
    return { quote, project, date, divisionText: divText, division: divisionFrom(divText) };
  }
  function divisionFrom(t) {
    t = t.toLowerCase();
    const st = (t.match(/nucor building(?:s)?\s+(?:systems|group)\s*[-–—]\s*([a-z]{2})\b/) || [])[1];
    if (st === 'in' || /waterloo,?\s*in/.test(t)) return 'NBS-IN';
    if (st === 'sc' || /swansea,?\s*sc/.test(t)) return 'NBG-SC';
    if (st === 'tx' || /terrell,?\s*tx/.test(t)) return 'NBG-TX';
    if (st === 'ut' || st === 'ca' || /brigham city,?\s*ut/.test(t) || /cbc/.test(t)) return 'West';
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
  const PROVINCIAL = [
    [/\bOBC\b|Ontario/i, y => (y >= 2024 ? 2020 : y >= 2012 ? 2010 : y || 2020), 'Ontario Building Code'],
    [/\bBCBC\b|British Columbia/i, y => (y >= 2024 ? 2020 : y >= 2018 ? 2015 : y || 2020), 'BC Building Code'],
    [/Alberta|NBC\s*\(AE\)|\bABC\b/i, y => (y >= 2023 ? 2020 : y >= 2019 ? 2015 : y || 2020), 'Alberta Building Code'],
    [/Qu[eé]bec|\bCNB\b/i, y => (y >= 2020 ? 2015 : y || 2015), 'Quebec Construction Code'],
    [/Saskatchewan|Manitoba|Nova Scotia|New Brunswick|Newfoundland|Prince Edward|National Building Code of Canada|\bNBC\s*20\d\d/i, y => y || 2020, 'National Building Code of Canada'],
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
    // a Canadian provincial code: built on the National Building Code of Canada of its cycle (loads in kPa, NBCC seismic
    // and snow, CSA S16 steel)
    const prov = PROVINCIAL.find(([re]) => re.test(code));
    if (prov) {
      const y = +((code.match(/\b(20\d\d)\b/) || [])[1] || 0), nbc = prov[1](y);
      return { family: 'CSA', year: nbc, edition: nbc >= 2020 ? 'S16-19' : 'S16-14', spec: nbc >= 2020 ? 'CSA S16-19' : 'CSA S16-14', provincial: true, note: `${prov[2]}${y ? ' ' + y : ''} is built on NBC ${nbc || '(cycle not read)'} — a Canadian job: loads in kPa, NBCC seismic and snow, CSA S16 steel.` };
    }
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
    const at = qoStart(pages), txt = allLines(pages.slice(at, at + 8)).map(l => l.text).join('\n');
    const occ = grab(txt, /Occupancy Classification:\s*(.+?)(?:\s{2,}|\n|$)/);
    const risk = occ && (occ.match(/^\s*(IV|III|II|I)\b/) || [])[1];
    const num = re => { const v = grab(txt, re); return v != null && isFinite(parseFloat(v)) ? parseFloat(v) : null; };
    const site = grab(txt, /Site Class:\s*(.+?)(?:\s{2,}|\n|$)/);
    return {
      // S1 sits on the line under Ss; OCR can lose its S ("1: 0.058")
      occupancy: occ, risk: risk || null, Ss: num(/\bSs:\s*([\d.]+)/), S1: num(/\bS1:\s*([\d.]+)/) ?? num(/\bSs:\s*[\d.]+[^\n]*\n(?:[^\n]*\s)?[S$5]?1:\s*(0?\.\d+)/),
      // ASCE 7-22 jobs list SMS and SM1 (from the hazard tool) and the SDC on the same lines
      Sms: num(/\bSms:\s*([\d.]+)/), Sm1: num(/\bSm1:\s*([\d.]+)/), sdc: grab(txt, /\bSDC:\s*([A-F])\b/),
      siteClass: site ? (site.match(/^\s*([A-F])\b/i) || [])[1] || null : null, siteNote: site ? clean(site.replace(/^\s*[A-F]\b/i, '')) || null : null,
      groundSnow: num(/Ground Snow Load:\s*([\d.]+)(?!\s*kPa)/), roofLive: num(/(?:^|\s)Live Load:\s*([\d.]+)\s*psf/i),
      groundSnowKpa: num(/Ground Snow Load\s*\(Ss\):\s*([\d.]+)\s*kPa/i) ?? num(/Ground Snow Load:\s*([\d.]+)\s*kPa/i),
      Ce: num(/Snow Exposure (?:Coefficient|Factor)\s*\(Ce\):\s*([\d.]+)/i), ceText: grab(txt, /Snow Exposure (?:Coefficient|Factor)\s*\(Ce\):\s*[\d.]+\s*-?\s*(.+?)(?:\s{2,}|\n|$)/i),
      W2: num(/Winter Wind (?:Parameter|Factor)[^:\n]*:\s*([\d.]+)/i),
    };
  }
  /* ---------- Box 4: roof loads per building ----------
     Building | Roof Dead | Roof Snow | Wind Enclosure | Thermal | Primary Collateral | Secondary Collateral | …
     ("Per Seller" or "n psf"; a * on the snow marks a user override) */
  function roofLoads(pages, name) {
    // every copy of the load table: a long one goes on under "4) BUILDING LOAD REQUIREMENTS (CONTINUED)" with its header again
    const ls = boxLines(pages, 4), rows = [], PSF = /Per Seller|([\d.]+)\s*psf(\*)?/gi, known = knownNames(pages, name);
    for (let h = findLine(ls, /Roof Dead/i); h >= 0; h = findLine(ls, /Roof Dead/i, h + 1)) {
      if (!/Collateral/i.test(ls[h].text)) continue;
      const hx = re => { for (const l of ls.slice(h, h + 3)) for (const it of l.items) if (re.test(it.str)) return it.x; return null; };
      const cols = { xPrim: hx(/^Primary/i), xSec: hx(/^Secondary/i), xDue: hx(/^Collateral$|Collateral Load/i), xDead: hx(/^Roof Dead/i) ?? 85 };
      const end = findLine(ls, /DEFLECTION REQUIREMENTS|^\* |^LOAD REQUIREMENTS|Roof Dead/i, h + 2);
      nameRows(ls.slice(h + 2, end < 0 ? h + 12 : end), cols.xDead, known, /\s(?:Per Seller|[\d.]+\s*psf)/i).forEach(r => { r.cols = cols; rows.push(r); });
    }
    if (!rows.length) return null;
    const pick = pickRow(rows, name, known);
    if (!pick) return null;
    const { xPrim, xSec, xDue } = pick.row.cols;
    // the row's own line: dead and snow are its first two values ("Per Seller" or "n psf", * = a user override); the
    // collaterals sit under their headers
    const toks = [];
    pick.row.lines[0].items.forEach(it => { if (it.name) return; let m; PSF.lastIndex = 0; while ((m = PSF.exec(it.str))) toks.push({ x: it.x, v: m[1] != null ? { value: +m[1], override: !!m[2] } : { value: null, perSeller: true } }); });
    const bin = x => [[xPrim, 'coll1'], [xSec, 'coll2'], [xDue, 'due']].filter(c => c[0] != null).sort((a, b) => Math.abs(a[0] - x) - Math.abs(b[0] - x))[0];
    const out = { building: pick.row.name, matched: pick.matched, dead: toks[0] ? toks[0].v : null, snow: toks[1] ? toks[1].v : null, coll1: null, coll2: null };
    // the thermal factor Ct in brackets ("Heated" / "Structure(1)", "Unheated Structure(1.2)", "Held Just Above
    // Freezing(1.1)") and the last column, roof insulation R < 30 and/or a roof obstruction (Yes: not a slippery roof)
    const rowText = pick.row.lines.map(l => l.items.filter(it => !it.name).map(it => it.str).join('  ')).join('  ');
    const ct = rowText.match(/\(\s*(0?\.85|1(?:\.[0-3]\d*)?)\s*\)/);
    out.Ct = ct ? +ct[1] : null;
    // the cell wraps ("Structure Held" / "Just Above" / "Freezing(1.1)") across the row's lines
    const th = rowText.match(/\b(Unheated|Heated|Held\s+Just\s+Above|Just\s+Above|Above\s+Freezing|Freezer|Greenhouse|Open\s+Air)\b/i);
    out.thermal = th ? (/held|just|above/i.test(th[1]) ? 'Held just above freezing' : th[1][0].toUpperCase() + th[1].slice(1).toLowerCase()) : null;
    const yn = pick.row.lines[0].items.filter(it => !it.name).map(it => it.str.trim()).filter(Boolean).pop();
    out.obstruction = /^yes$/i.test(yn || '') ? true : /^no$/i.test(yn || '') ? false : null;
    toks.slice(2).forEach(t => { const b = t.v.value != null && bin(t.x); if (b && (b[1] === 'coll1' || b[1] === 'coll2') && out[b[1]] == null) out[b[1]] = t.v.value; });
    return out;
  }

  /* Box 4's additional building components: an existing building or natural obstruction the quote does not draw, whether
     it causes snow drift, solar panels, other loads — per building. "No Additional Obstruction" rows say nothing more. */
  function extraComponents(pages) {
    const ls = boxLines(pages, 4), h = findLine(ls, /ADDITIONAL BUILDING COMPONENTS/i);
    if (h < 0) return [];
    const end = findLine(ls, /Project Architect|Engineer of Record/i, h + 1);
    const head = findLine(ls, /Building Name/i, h);
    const body = ls.slice(head < 0 ? h + 1 : head + 1, end < 0 ? h + 12 : end).filter(l => !/^\s*(?:or Natural|cause Snow|Defined in Box)/i.test(l.text));
    const names = knownNames(pages, null), out = [];
    body.forEach(l => {
      const t = clean(l.text), nm = names.slice().sort((a, b) => b.length - a.length).find(n => nkey(t).startsWith(nkey(n)));
      if (!nm) return;
      const rest = clean(t.slice(t.toUpperCase().indexOf(String(nm).toUpperCase()) + String(nm).length));
      // the newer table asks yes / no: an existing building or obstruction not in Box 25? does it cause snow drift?
      // solar panels? other loads? — "Yes  No  N/A  N/A"
      const yn = rest.match(/^(Yes|No)\s+(Yes|No|N\/A)\s+(\S+(?:\s\S+)*?)\s+(\S+(?:\s\S+)*?)$/i);
      if (yn) { const v = q => (/^N\/A$/i.test(q) ? null : q); out.push({ building: nm, text: '', none: /^No$/i.test(yn[1]), exists: yn[1], drift: v(yn[2]), solar: v(yn[3]), other: v(yn[4]), yesNo: true }); return; }
      const none = /^No Additional Obstruction\b/i.test(rest), cells = rest.replace(/^No Additional Obstruction\s*/i, '').split(/\s{2,}|\s(?=N\/A\b)/).map(clean).filter(Boolean);
      out.push({ building: nm, text: rest, none, drift: cells[0] && !/^N\/A$/i.test(cells[0]) ? cells[0] : null, solar: cells[1] && !/^N\/A$/i.test(cells[1]) ? cells[1] : null, other: cells[2] && !/^N\/A$/i.test(cells[2]) ? cells[2] : null });
    });
    return out;
  }

  // ---------- Box 2: building geometry ----------
  // every building the quote lists in Box 2's building information table, in its order (a lean-to or canopy with no
  // mezzanine too): the snow on one roof and the drift a higher one puts on it need all of them
  /* the rows of Box 2's building information table — every copy of it: a long table goes on under "2) BUILDING
     DESCRIPTION (CONTINUED)" on the next page with its heading again */
  const PROFILE_GLUE = /\s(?:Gable|Single\s*Slope|Lean[- ]?To|Multi[- ]?Gable|Mono[- ]?Slope)\b/i;
  function infoRows(ls, known) {
    const rows = [];
    for (let hi = findLine(ls, /BUILDING INFORMATION/i); hi >= 0; hi = findLine(ls, /BUILDING INFORMATION/i, hi + 1)) {
      const end = findLine(ls, /^\*|ROOF SECONDARY|SIDEWALL AND ENDWALL|BUILDING INFORMATION/i, hi + 1);
      const region = ls.slice(hi + 1, end < 0 ? ls.length : end);
      const first = region.findIndex(l => (l.text.match(reDimAll) || []).map(ftin).filter(v => v != null).length >= 3);
      if (first < 0) continue;
      const prof = region.slice(0, first).flatMap(l => l.items).find(it => /^Building Profile/i.test(it.str));
      rows.push(...nameRows(region.slice(first), prof ? prof.x : 87, known, PROFILE_GLUE));
    }
    return rows;
  }
  function buildingNames(pages) {
    const names = infoRows(boxLines(pages, 2), knownNames(pages, null)).map(r => r.name).filter(Boolean);
    return [...new Set(names)];
  }
  function building(pages, name) {
    const ls = boxLines(pages, 2);
    if (!ls.length) return null;
    const known = knownNames(pages, name);
    const out = { name: null, width: null, length: null, ridge: null, eave: null, eaveFSW: null, eaveBSW: null, slopeFSW: null, slopeBSW: null, profile: null, bays: [], lewCols: [], rewCols: [], fswSoldier: [], bswSoldier: [], rows: {} };
    // building information: one row per building, from the first line carrying >= 3 dimensions down to the footnote,
    // in every copy of the table (it goes on over a page)
    {
      const pick = pickRow(infoRows(ls, known), name, known);
      if (pick) {
        // the row's own line, without the name piece; the profile can wrap ("Gable" / "Symmetrical")
        // a dimension the cell wrapped ("20'-7" over "11/16"" on the line under it) is joined back before reading
        const under = pick.row.lines.slice(1).flatMap(l => l.items.filter(it => !it.name));
        const own = pick.row.lines[0].items.filter(it => !it.name).map(it => {
          if (!/\d+'\s*-\s*\d+$/.test(it.str.trim())) return it.str;
          const tail = under.find(u => Math.abs(u.x - it.x) < 30 && /^\d+\/\d+"$|^\d+"$/.test(u.str.trim()));
          return tail ? it.str.trim() + ' ' + tail.str.trim() : it.str.trim() + '"';
        }).join('  ');
        const all = pick.row.lines.flatMap(l => l.items.filter(it => !it.name).map(it => it.str)).join('  ');
        const dims = (own.match(reDimAll) || []).map(ftin).filter(v => v != null);
        // width, length, distance to ridge (N/A on a single slope or a lean-to), eave heights: N/A keeps its place
        const tok = (own.match(new RegExp(DIM + '|N\\/A', 'g')) || []).map(t => (t === 'N/A' ? null : ftin(t)));
        [out.width, out.length, out.ridge, out.eave] = tok.length >= 3 ? tok : dims;
        // eave heights FSW / BSW and roof slopes FSW / BSW ("1:12\"", N/A on the low side of a single slope); the
        // slope's 12" would read as a dimension, so slopes are taken on their own
        out.eaveFSW = out.eave; out.eaveBSW = tok.length >= 5 && tok[4] != null ? tok[4] : out.eave;
        const sl = [...own.matchAll(/(\d+(?:\.\d+)?)\s*:\s*12/g)].map(m => +m[1]);
        out.slopeFSW = sl[0] ?? null; out.slopeBSW = sl[1] ?? null;
        out.profile = /single\s*slope/i.test(all) ? 'Single Slope' : /lean/i.test(all) ? 'Lean-To' : /gable/i.test(all) ? 'Gable' : null;
        out.name = pick.row.name;
        out.rows.info = { name: pick.row.name, matched: pick.matched };
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
      // one row per building (a lean-to has its own): the name, then the spacing lists, which wrap onto the lines under
      // it as the name can; only the mezzanine's building's row is read
      const xFirst = cols.length ? cols[0][1] : 108;
      const first = region.findIndex(l => l.items.some(it => it.x >= xFirst - 6 && (/\d+\s*@/.test(it.str) || /^N\/A$/i.test(it.str))));
      const pick = first < 0 ? null : pickRow(nameRows(region.slice(first), xFirst, known, /\s\d+\s*@/), name, known);
      if (pick) {
        pick.row.lines.forEach(l => l.items.forEach(it => { const k = !it.name && colOf(it.x); if (k) text[k] += ' ' + it.str; }));
        out.rows.spacing = { name: pick.row.name, matched: pick.matched };
      }
      Object.keys(text).forEach(k => { out[k] = spacingList(text[k]); });
    }
    return out;
  }

  // ---------- Box 5: frame information (interior columns) ----------
  function frames(pages, name) {
    // every building's block, down to the next box (each block ends with its own "Base Plate Elevations" note)
    let region = boxLines(pages, 5);
    if (!region.length) return [];
    // one block per building ("BUILDING NAME: Main", "BUILDING NAME: Lean-To Canopy"): keep the mezzanine's
    const heads = region.map((l, i) => { const m = l.text.match(/BUILDING NAME:\s*(.+?)(?:\s{2,}|$)/i); return m ? { i, raw: m[1], name: headName(m[1]), key: nkey(headName(m[1])) } : null; }).filter(Boolean);
    let matched = null;
    if (heads.length) {
      // the named building's block; with no name, the first building's (never another building's frames)
      const pick = pickRow(heads, name, knownNames(pages, name).concat(heads.map(h => h.name)));
      if (!pick) return [];
      const k = heads.indexOf(pick.row);
      matched = { name: pick.row.name, matched: pick.matched };
      region = region.slice(heads[k].i, heads[k + 1] ? heads[k + 1].i : region.length);
    }
    const TYPE = /Frame|Bearing|Post|Beam|Lean|Rigid|Truss|Span/i;
    const rows = [];
    region.forEach(l => {
      // "1 (LEW)" / "2 - 6" / "7 (REW)", then the frame type; a short gap can run the two together
      const it0 = l.items[0];
      const m = it0 && it0.str.match(/^(\d+)(?:\s*-\s*(\d+))?(?:\s*\((LEW|REW)\))?(?:\s+(.+))?$/);
      const type = m && (m[4] ? (TYPE.test(m[4]) ? m[4] : null) : l.items[1] && TYPE.test(l.items[1].str) ? l.items[1].str : null);
      if (m && type) rows.push({ from: +m[1], to: m[2] ? +m[2] : +m[1], wall: m[3] || null, type: clean(type), x: m[4] ? it0.x : l.items[1].x, y: l.y, tokens: [] });
    });
    // a long frame type wraps its code onto the line under it ("Rigid Frame Multi Span (Non-Exp) -" / "RMG")
    const xFuture = (region.flatMap(l => l.items).find(it => /^Future/i.test(it.str)) || {}).x ?? 221;
    rows.forEach((r, i) => region.filter(l => l.y > r.y + 3 && (!rows[i + 1] || l.y < rows[i + 1].y - 3) && !/BUILDING NAME:|Base Plate/i.test(l.text))
      .forEach(l => l.items.forEach(it => { if (it.x >= r.x - 12 && it.x < xFuture - 6) r.type = clean(r.type + ' ' + it.str); })));
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
  // each row by its letter, or by its words when OCR lost the letter
  const DIM_ROWS = [
    ['A', /^\(A\)|^Finished Floor to Top/i], ['B', /^\(B\)|Clearance Under Joist/i], ['C', /^\(C\)|Clearance Under Floor Beams/i],
    ['D', /^\(D\)|Minimum Required Clearance Under Frame/i], ['E', /^\(E\)|^Edge of Slab/i], ['F', /^\(F\)|^Clearance Under Frame/i],
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
    // a Canadian PCS gives the floor loads in kPa: taken in psf (1 kPa = 20.8854 psf), and said so
    const kpa = re => { const v = grab(txt, re); return v != null && isFinite(+v) ? +(+v * 20.8854342).toFixed(2) : null; };
    const m = {
      id: grab(txt, /Mezzanine ID:\s*(.+?)(?:\s{2,}Building Name|\n|$)/),
      building: grab(txt, /Building Name:\s*(.+?)(?:\s{2,}|\n|$)/),
      dead: num(grab(txt, /Dead Load:\s*(.+?)\s*PSF/i)) ?? kpa(/Dead Load:\s*([\d.]+)\s*kPa/i),
      live: num(grab(txt, /Live Load:\s*(.+?)\s*PSF/i)) ?? kpa(/Live Load:\s*([\d.]+)\s*kPa/i),
      collateral: num(grab(txt, /Collateral(?: \(Bottom Chord\))?:\s*(.+?)\s*PSF/i)) ?? kpa(/Collateral(?: \(Bottom Chord\))?:\s*([\d.]+)\s*kPa/i),
      partition: num(grab(txt, /Partition Loads?:\s*(.+?)\s*PSF/i)) ?? kpa(/Partition Loads?:\s*([\d.]+)\s*kPa/i),
      loadsKpa: /(?:Dead|Live) Load:\s*[\d.]+\s*kPa/i.test(txt) || undefined,
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
      // who supplies the deck and the bar joists ("Deck: Not by Seller", "Bar Joist and Bridging: Not by Seller")
      deckBy: /(?:^|\n)\s*Deck:\s*Not by Seller/i.test(txt) ? 'others' : null,
      joistsBy: /Bar Joist and Bridging:\s*Not by Seller/i.test(txt) ? 'others' : null,
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
    // each line of a typed note on its own row: a note's lines stack from the top of its box (12 pt: the first line's
    // baseline about 12 below the top, the next 14 lower), so a box drawn tall over several rows — "8'-0"⏎7'-10"" on
    // C and D, or one value in a box reaching the row below (a practice job: 17'-10" for F over the seat row) — reads row by row
    const annLines = annots.flatMap(a => { const fs = a.fs || 12; return String(a.text).split(/\r\n|\r|\n/).map(t => clean(t)).map((t, i) => ({ text: t, y: a.y1 + fs + i * fs * 1.2, x1: a.x1, a })).filter(q => q.text); });
    const hdr = ls.find(l => /Requested/.test(l.text) && /Provided/.test(l.text));
    const xReq = hdr ? hdr.items.find(i => /Requested/.test(i.str)).x : null;
    const xProv = hdr ? hdr.items.find(i => /Provided/.test(i.str)).x : null;
    DIM_ROWS.forEach(([key, re]) => {
      const row = ls.find(l => l.items.some(it => re.test(it.str)));
      if (!row) return;
      const lab = row.items.findIndex(it => re.test(it.str));
      const vals = row.items.slice(lab + 1).filter(it => !/^Joist Primer/i.test(it.str));
      let req = null, prov = null, reqIt = null, provIt = null;
      vals.forEach(it => {
        const toReq = xReq != null && xProv != null ? Math.abs(it.x - xReq) < Math.abs(it.x - xProv) : req == null;
        if (toReq) { if (req == null) { req = it.str; reqIt = it; } } else if (prov == null) { prov = it.str; provIt = it; }
      });
      const ann = annLines.filter(q => (xProv == null || q.x1 > xProv - 30) && Math.abs(q.y - row.y) <= 7).sort((p, q) => Math.abs(p.y - row.y) - Math.abs(q.y - row.y))[0];
      const annTxt = ann ? ann.text : null, annVal = ftinTyped(annTxt);
      let value = null, src = null;
      if (ftin(req) != null) { value = ftin(req); src = 'requested'; }
      else if (annVal != null) { value = annVal; src = 'annotation'; }
      // the Provided column is the quoted design's own number: a fair value for a dimension of that design (A, the joist
      // spacing and seat, E), but never a minimum clearance (B, C, D) — a TBD requirement is asked, the Provided offered
      else if (ftin(prov) != null && !/^[BCD]$/.test(key)) { value = ftin(prov); src = 'provided'; }
      m.dims[key] = { requested: req, provided: prov, annotation: annTxt, value, source: src };
      const from = src === 'requested' ? reqIt : src === 'provided' ? provIt : null;
      if (from && from.conf != null) m.dims[key].read = { conf: from.conf, red: !!from.red };
    });
    readByOcr(m, ls);
    typedMarkups(m, ls);
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

  /* A Box 22 read by OCR (src/ocr.js): how sure each value is — the least sure word of its phrase — and what the
     engineer wrote over the print: a value struck out with the new one written in red beside it ("Width: 26'-6""
     struck through, "26'-8"" in red). The struck word never reaches the text, so the red one is the value read. */
  const READ_FIELDS = [['width', /^Width:/i], ['length', /^Length:/i], ['slab', /^Slab\/Deck Thickness:/i], ['startLEW', /^Start Location from LEW/i],
    ['startFSW', /^Start Location from FSW/i], ['dead', /^Dead Load:/i], ['live', /^Live Load:/i], ['collateral', /^Collateral/i], ['partition', /^Partition Loads?:/i]];
  function readByOcr(m, ls) {
    if (!ls.some(l => l.items.some(it => it.conf != null))) return;
    m.read = {};
    READ_FIELDS.forEach(([k, re]) => {
      const l = ls.find(l => l.items.some(it => re.test(it.str)));
      if (!l) return;
      const i = l.items.findIndex(it => re.test(it.str)), lab = l.items[i];
      const it = lab.str.replace(re, '').trim() ? lab : l.items[i + 1];   // "Length: 46'-6"" is one phrase, "Width:" and "26'-8"" two
      if (it && it.conf != null) m.read[k] = { conf: it.conf, red: !!it.red };
    });
    Object.entries(m.dims).forEach(([k, d]) => { if (d.read) m.read[k] = d.read; });
    m.markups = [];
    const pages = [...new Set(ls.map(l => l.pageRef).filter(Boolean))];
    pages.forEach(p => (p.struck || []).forEach(st => {
      const l = ls.find(l => l.pageRef === p && Math.abs(l.y - st.y) < 3);
      if (!l) return;
      const lab = l.items.filter(it => it.x + it.w <= st.x + 2).pop(), now = l.items.find(it => it.x >= st.x + st.w - 2);
      const field = lab ? ((READ_FIELDS.find(([, re]) => re.test(lab.str)) || DIM_ROWS.find(([, re]) => re.test(lab.str)) || [])[0] || null) : null;
      // a line through a drawing's words (the sidewall sketch) is no markup: keep a struck field or one with a red value
      // the struck figures as OCR saw them through the line, a lost foot and inch mark put back (25-3 → 25'-3")
      const was = /^\d+-\d+(?: \d+\/\d+)?$/.test(st.str) ? st.str.replace(/^(\d+)-(.*)$/, `$1'-$2"`) : st.str;
      if (field || (now && now.red)) m.markups.push({ field, label: lab ? lab.str.replace(/:$/, '') : null, was, now: now && now.red ? now.str : null, page: p.num });
    }));
  }

  /* The corrections typed over this mezzanine's Box 22 (a value struck with a line annotation, the new one typed beside it:
     markupItems has already put it in the text): each listed as a markup of its field, so the field's source says so */
  function typedMarkups(m, ls) {
    m.markups = m.markups || [];
    const pages = [...new Set(ls.map(l => l.pageRef).filter(Boolean))];
    pages.forEach(p => (p.edits || []).filter(e => e.now).forEach(e => {
      const l = ls.find(q => q.pageRef === p && Math.abs(q.y - e.y) < 3);
      if (!l) return;
      const lab = l.items.filter(it => it.x < e.x - 1);
      const hit = lab.map(it => (READ_FIELDS.find(([, re]) => re.test(it.str)) || DIM_ROWS.find(([, re]) => re.test(it.str)) || (/^Deck Type:?/i.test(it.str) ? ['deck'] : null))).filter(Boolean).pop();
      if (!hit) return;
      const field = hit[0];
      if (m.markups.some(q => q.field === field && q.now === e.now)) return;
      m.markups.push({ field, label: (lab.find(it => (READ_FIELDS.concat(DIM_ROWS)).some(([k, re]) => k === field && re.test(it.str))) || {}).str || field, was: e.was, now: e.now, page: p.num, typed: true });
    }));
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

  /* ---------- Box 27 special user notes, Box 28 qualifications ----------
     Numbered items, each joined over its wrapped lines and page breaks. The notes are where a quote says what Box 22
     cannot: a mezzanine with no floor (MEP support grids), cantilever or hot-rolled framing, loads given as point loads. */
  function numbered(pages, startRe, endRe) {
    const out = [];
    let on = false, cur = null;
    pages.forEach(p => {
      const ls = lines(p);
      let from = 0;
      if (!on) { const i = findLine(ls, startRe); if (i < 0) return; on = true; from = i + 1; }
      else { const i = findLine(ls, /CONTROL #/i); from = i >= 0 ? i + 1 : 0; }
      for (let k = from; k < ls.length && on; k++) {
        const t = ls[k].text;
        if (endRe.test(t)) { on = false; break; }
        if (startRe.test(t) || /^See next page/i.test(t) || /^Page \d+ of \d+/i.test(t) || /^[A-Z]\d{2}[A-Z]\d{4}$/.test(t.trim())) continue;
        const m = t.match(/^\s*(\d{1,2})\.\s+(.*)$/);
        if (m) out.push(cur = { n: +m[1], text: clean(m[2]), page: p.num });
        else if (cur && t.trim() && !/^[*y•]$/i.test(t.trim())) cur.text = clean(cur.text + ' ' + t);
      }
    });
    return out;
  }
  const specialNotes = pages => numbered(pages, /^27\)\s*SPECIAL USER NOTES/i, /^28\)\s/);
  const qualifications = pages => numbered(pages, /^28\)\s*EQUOTE QUALIFICATIONS/i, /^29\)\s|^NBG Qualifications/i);
  /* the notes that bear on one mezzanine: a note naming a mezzanine — its ID, or its leading word ("AUX 2-4" ↔
     "auxiliary mezzanines", "ROOF ACCESS" ↔ "roof access mezzanine") — goes to that one only; a note about
     mezzanines that names none goes to every one. Each carries the qualification it points to ("qualification
     number 40 in Box 28"). */
  const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function namesMezz(m, t) {
    const id = String(m.id || '').toLowerCase().trim();
    if (!id) return false;
    // "1", "2": only as "mezzanine 1" — a bare digit is everywhere
    if (/^\d+$/.test(id) || id.length < 3) return new RegExp('mezz(?:anine)?s?\\s*(?:#|no\\.?|number)?\\s*' + reEsc(id) + '\\b').test(t);
    const word = (id.match(/^[a-z]{3,}/) || [])[0], two = id.split(/\s+/).slice(0, 2).join(' ');
    return new RegExp('\\b' + reEsc(id) + '\\b').test(t) || (/^[a-z]{3,}\s+[a-z]{3,}$/.test(two) && t.includes(two)) || (!!word && new RegExp('\\b' + word + '[a-z]*\\b[^.]{0,40}mezz').test(t));
  }
  function notesFor(m, all, notes, quals) {
    const seen = new Set();
    return notes.filter(n => {
      const t = n.text.toLowerCase(), about = t.replace(/mezzanines? (?:stairs|handrails)[^,.;]*/g, '');
      if (!/mezz/.test(about) || seen.has(t)) return false;   // about a mezzanine, not only its stairs; once
      seen.add(t);
      const named = all.filter(x => namesMezz(x, t));
      return named.length ? named.includes(m) : true;
    }).map(n => {
      const ref = (n.text.match(/qualification (?:number |#\s*)?(\d{1,2})/i) || [])[1];
      const q = ref ? quals.find(x => x.n === +ref) : null;
      return { ...n, qual: q ? q.text : null, qualN: q ? q.n : null };
    });
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

  // ---------- Box 12: bracing options — each building's walls, the bracing type and the bays it goes in ----------
  /* "Bldg 1  FSW, BSW  Portal Frames  Per Seller  Yes  1, 4" → one row per wall list. The bays are numbered from the LEW
     (bay 1 between frame lines 1 and 2 — checked against a bracing file: the eScope's bay 7 is the file's lines 7–8).
     TBD / Per Seller / N/A leave the bays open. A building name wrapped onto the next line is joined back. */
  const WALL_LIST = /^(?:LEW|REW|FSW|BSW)(?:,\s*(?:LEW|REW|FSW|BSW))*$/;
  function bracingOptions(pages) {
    const ls = boxLines(pages, 12), out = [];
    for (const l of ls) {
      if (/^Sketch must show|^Building Name|^Requested/i.test(l.text)) continue;
      const it = l.items.map(i => i.str.replace(/\s*,\s*$/, '')), wi = it.findIndex(s => WALL_LIST.test(s.trim()));
      if (wi < 0) {
        // a continuation line of the building name ("MAINTENANCE" / "BUILDING")
        const last = out[out.length - 1];
        if (last && it.length === 1 && /^[A-Z0-9 .'&-]{1,30}$/i.test(l.text) && Math.abs(l.y - last.y) < 20) last.building = clean(last.building + ' ' + l.text);
        continue;
      }
      const name = clean(it.slice(0, wi).join(' ')), walls = it[wi].split(/,\s*/).map(w => w.trim().toUpperCase());
      const rest = it.slice(wi + 1);
      // type · clear height · user specified bay (Yes/No) · bays — the Yes/No anchors the row when a cell is blank
      const yi = rest.findIndex(s => /^(Yes|No)$/i.test(s.trim()));
      const type = clean(rest[0] || ''), clear = yi > 1 ? clean(rest.slice(1, yi).join(' ')) : yi === 1 ? '' : clean(rest[1] || ''), user = yi >= 0 ? /^Yes$/i.test(rest[yi].trim()) : false;
      const baysText = clean(yi >= 0 ? rest.slice(yi + 1).join(' ') : rest.slice(2).join(' '));
      const bays = [];
      if (!/TBD|Per Seller|N\/A|None/i.test(baysText)) baysText.split(/[,\s]+/).forEach(t => { const r = t.match(/^(\d+)\s*[-–]\s*(\d+)$/); if (r) { for (let k = +r[1]; k <= +r[2]; k++) bays.push(k); } else if (/^\d+$/.test(t)) bays.push(+t); });
      const kind = /portal/i.test(type) ? 'portal' : /roof/i.test(type) && /x/i.test(type) ? 'roofx' : /x[- ]?brac|rod|cable/i.test(type) ? 'x' : /^none$/i.test(type) ? 'none' : type ? 'other' : 'none';
      out.push({ building: name, walls, type, kind, clearHeight: clear, userBay: user, bays: [...new Set(bays)].sort((a, b) => a - b), baysText, y: l.y });
    }
    return out.map(({ y, ...r }) => r);
  }
  const bracingKind = type => (/portal/i.test(type) ? 'portal' : /roof/i.test(type) && /x/i.test(type) ? 'roofx' : /x[- ]?brac|rod|cable/i.test(type) ? 'x' : /^none$/i.test(type) ? 'none' : type ? 'other' : 'none');
  // the options of one building, wall by wall: { FSW: { type, kind, bays, baysText, clearHeight, userBay }, … }
  function bracingByWall(options, name, known = []) {
    // the building's own rows; a cut-off name only when it is no other building's whole name ("Main" ≠ "Main Extension")
    const k = nkey(name), other = new Set(known.map(nkey).filter(q => q && q !== k));
    const exact = options.filter(o => nkey(o.building) === k);
    const rows = exact.length ? exact : options.filter(o => { const ok = nkey(o.building); return ok && !other.has(ok) && (k.startsWith(ok) || ok.startsWith(k)); });
    const out = {};
    rows.forEach(o => o.walls.forEach(w => { out[w] = { type: o.type, kind: o.kind, bays: o.bays, baysText: o.baysText, clearHeight: o.clearHeight, userBay: o.userBay }; }));
    return out;
  }

  /* A PDF can carry more than one Quote and Order Document — the current label and, behind it, an earlier one ("LABEL: 3 -
     Created from 2" then "LABEL: 1 - Created from 0", each from its own "Page 1 of N"). Only the first is read: the
     second holds the superseded values (a lean-to 66'-0" along a wall where the current label says 64'-0"). Pages added to
     one document (a Box 22 alternate, "Page 23 of …") are part of it and stay. */
  function primaryPages(pages) {
    const at = qoStart(pages);
    const label = p => { const l = lines(p).find(x => /LABEL:/i.test(x.text)); return l ? ((l.text.match(/LABEL:\s*(.+?)(?:\s{2,}|$)/i) || [])[1] || null) : null; };
    for (let i = at + 1; i < pages.length; i++) {
      const ls = lines(pages[i]).slice(0, 14).map(l => l.text).join('\n');
      if (/QUOTE AND ORDER DOCUMENT/i.test(ls) && /\bPage\s+1\s+of\s+\d+/i.test(ls)) return { pages: pages.slice(0, i), cut: { page: i + 1, of: pages.length, label: label(pages[i]), current: label(pages[at]) } };
    }
    return { pages, cut: null };
  }

  /* Everything the quote engineer wrote on the PCS as PDF markup, page by page: the corrections applied to the text
     (struck and retyped, see markupItems) and every other typed note, with the box it sits in and the printed words
     its callout line — or its row — points at. A note on a drawing page (no text there) is placed on the floor plan by
     src/plan.js. Highlights (yellow boxes) are left out. */
  function penNotes(pages) {
    const out = [];
    pages.forEach(p => {
      const ls = lines(p), used = p.editReps || new Set(), an = p.annots || [];
      const boxAt = y => { let b = null; ls.forEach(l => { if (l.y <= y + 2 && /^\d{1,2}\)\s+[A-Z]/.test(l.text)) b = clean(l.text.split(/\s{2,}/)[0]); }); return b; };
      (p.edits || []).forEach(e => { const box = boxAt(e.y); if (box || e.now) out.push({ kind: 'correction', page: p.num, box, was: e.was, now: e.now, at: rowWords(ls, e.x, e.y) }); });
      const callouts = an.filter(a => /^Line$/i.test(a.subtype) && a.line && !(Math.abs(a.line[0][1] - a.line[1][1]) < 2.5));
      an.filter(a => /FreeText/i.test(a.subtype) && clean(a.text) && !used.has(a)).forEach(a => {
        const cx = (a.x1 + a.x2) / 2, cy = (a.y1 + a.y2) / 2;
        const touch = callouts.find(l => l.line.some(q => q[0] > a.x1 - 8 && q[0] < a.x2 + 8 && q[1] > a.y1 - 8 && q[1] < a.y2 + 8));
        // the arrow: the note's own callout (its tip), else a line drawn from the note — its far end
        const far = a.callout ? a.callout : touch ? touch.line.slice().sort((q, r) => Math.hypot(r[0] - cx, r[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy))[0] : null;
        out.push({ kind: 'note', page: p.num, box: ls.length ? boxAt(a.y1) : null, text: clean(a.text), at: ls.length ? rowWords(ls, far ? far[0] : a.x1, far ? far[1] + 3 : a.y2) : null, drawing: !ls.length, rect: [a.x1, a.y1, a.x2, a.y2], to: far });
      });
    });
    return out;
  }
  // the printed words a point sits on: the row at that height, its words up to the point (a label and its value)
  function rowWords(ls, x, y) {
    const row = ls.filter(l => Math.abs(l.y - y) < 7).sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
    if (!row) return null;
    const its = row.items.filter(it => it.x <= x + 4).slice(-2);
    return its.length ? clean(its.map(it => it.str).join(' ')) : clean(row.items[0].str);
  }

  /* Box 23: the cranes. Each "Crane ID:" entry — its type and capacity, the aisle and the frame line it starts at, the
     runway, the weights and the wheel load, the clearances and the beam spacing — read for the flags and the Cranes
     page; the frames, bracing and seismic do not carry crane loads yet, and say so. */
  function cranes(pages) {
    const out = [];
    pages.forEach(p => {
      const ls = lines(p), s = findLine(ls, /^23\)\s*CRANES/i);
      if (s < 0 || /NONE\s+REQUIRED/i.test(ls[s].text)) return;
      const e = findLine(ls, /^2[4-9]\)\s/, s + 1), blk = ls.slice(s, e < 0 ? ls.length : e).map(l => l.text);
      const head = blk.slice(0, blk.findIndex(t => /^Crane ID:/i.test(t)) + 1 || 1).join('\n');
      const starts = blk.map((t, i) => (/^Crane ID:/i.test(t) ? i : -1)).filter(i => i >= 0);
      starts.forEach((st, k) => {
        const txt = blk.slice(st, k + 1 < starts.length ? starts[k + 1] : blk.length).join('\n');
        const g = re => grab(txt, re), lbs = re => { const v = g(re); return v != null && isFinite(+v) ? +v : null; };
        out.push({
          building: grab(head, /BUILDING NAME:\s*(.+?)(?:\s{2,}|\n|$)/i) || null, kind: grab(head, /CRANE TYPE:\s*(.+?)(?:\s{2,}|\n|$)/i) || null,
          id: g(/^Crane ID:\s*(\S+)/im), aisle: g(/Crane Aisle Location:\s*(\S+)/i), startLine: lbs(/Starting Frameline:\s*(\d+)/i), direction: g(/Crane Direction:\s*(\S+)/i),
          qty: lbs(/Quantity:\s*(\d+)/i), type: g(/^Crane Type:\s*(\S+)/im), tons: lbs(/Rated Capacity:\s*([\d.]+)\s*tons?/i), cmaa: g(/CMAA Service Duty Class:\s*(\S+)/i),
          control: g(/Operation Control Type:\s*(\S+)/i), runway: ftin(g(new RegExp(String.raw`Runway Length:\s*(` + DIM + ')', 'i'))),
          hoistTrolley: lbs(/Hoist and Trolley Weight:\s*([\d.]+)\s*lbs/i), bridge: lbs(/Bridge Weight:\s*([\d.]+)\s*lbs/i), wheel: lbs(/Max\. Wheel Load w\/o Impact:\s*([\d.]+)\s*lbs/i),
          wheelsPerTruck: lbs(/Wheels per End Truck[^:]*:\s*(\d+)/i), wheelSpacing: ftin(g(new RegExp(String.raw`Wheel Spacing:\s*(` + DIM + ')', 'i'))),
          beamCC: ftin(g(new RegExp(String.raw`Center to Center of Beam:\s*(` + DIM + ')', 'i'))), beamToSteel: ftin(g(new RegExp(String.raw`Center of Beam to Steel Line:\s*(` + DIM + ')', 'i'))),
          clearBeam: ftin(g(new RegExp(String.raw`Min\. Clear From Bottom of Beam:\s*(` + DIM + ')', 'i'))), runwayBeam: lbs(/Runway Beam Weight:\s*([\d.]+)\s*lbs/i),
          sway: g(/Sway Bracing by Seller \(Y\/N\):\s*(\S+)/i), notBySeller: /Seller has not supplied crane beams/i.test(blk.join(' ')), page: p.num,
        });
      });
    });
    return out;
  }

  function parse(pagesIn) {
    const prim = primaryPages(pagesIn), pages = prim.pages;
    const job = jobFacts(pages);
    const code = buildingCode(pages);
    const mezz = mezzanines(pages);
    const notes = specialNotes(pages), quals = qualifications(pages);
    mezz.forEach(m => { m.notes = notesFor(m, mezz, notes, quals); });
    // geometry per building the mezzanines sit in (a job can have a main building plus a lean-to, etc.)
    const buildings = {};
    [...new Set(mezz.map(m => m.building || ''))].forEach(n => { buildings[n] = { building: building(pages, n || null), frames: frames(pages, n || null), roof: roofLoads(pages, n || null) }; });
    const first = buildings[(mezz[0] && mezz[0].building) || ''] || { building: building(pages, null), frames: frames(pages, null) };
    // Ecospan (Vulcraft composite joist floor, DM 15.1.5): named anywhere in the text or the blue notes
    const words = allLines(pages).map(l => l.text).concat(pages.flatMap(p => (p.annots || []).map(a => a.text || ''))).join('\n');
    const eco = words.match(/[^\n]{0,60}(ecospan|e-series joist)[^\n]{0,60}/i);
    // a request for tube / HSS / pipe columns (the Column sheet sizes W / BU only): the word next to "column"
    const colReq = allLines(pages).map(l => l.text).find(t => /\b(?:tube|tubular|hss|pipe)\b[^.\n]{0,30}\bcol(?:umn)?s?\b|\bcol(?:umn)?s?\b[^.\n]{0,30}\b(?:tube|tubular|hss|pipe)\b/i.test(t));
    // every building of the quote (lean-tos and canopies with no mezzanine too), for the roof snow and the drifts
    const site = {};
    buildingNames(pages).forEach(n => { site[n] = buildings[n] || { building: building(pages, n), frames: frames(pages, n), roof: roofLoads(pages, n) }; });
    // Box 12: where the quote puts its bracing (and of what kind), per building and wall
    const brOpts = bracingOptions(pages);
    Object.keys(site).forEach(n => { site[n].bracing = bracingByWall(brOpts, n, Object.keys(site)); });
    const pen = penNotes(pages);
    // a note in Box 12 that gives a wall other bracing ("REW > ROOF X-BRACING", the wall struck from its row): that wall
    // takes it (the only building's, or every building's whose row lost the wall)
    pen.filter(q => q.kind === 'note' && /^12\)/.test(q.box || '')).forEach(q => {
      const m = q.text.match(/^((?:LEW|REW|FSW|BSW)(?:\s*(?:,|&|AND)\s*(?:LEW|REW|FSW|BSW))*)\s*(?:>|→|-+>|=+>|TO:?)\s*(.+)$/i);
      if (!m) return;
      const walls = m[1].toUpperCase().split(/\s*(?:,|&|AND)\s*/), type = clean(m[2]).toLowerCase().replace(/(^|[\s-])\w/g, c => c.toUpperCase());
      Object.keys(site).forEach(n => { if (Object.keys(site).length === 1 || walls.some(w => !site[n].bracing[w])) walls.forEach(w => { site[n].bracing[w] = { type, kind: bracingKind(type), bays: [], baysText: 'TBD', clearHeight: null, userBay: false, markup: q.text }; }); });
    });
    // Box 2's endwall column spacing corrected by markup while Box 5 still lists the old spacing for a multi-span endwall
    // frame: the endwall frame's columns are those endwall columns, so they follow the correction
    const box2Fixed = pen.some(q => q.kind === 'correction' && /^2\)/.test(q.box || '') && q.now);
    if (box2Fixed) Object.keys(site).forEach(n => {
      const b = site[n].building, fr = site[n].frames || [], last = Math.max(0, ...fr.map(f => f.to));
      [['lewCols', 1], ['rewCols', last]].forEach(([k, no]) => {
        const f = fr.find(q => q.from === no && q.to === no), sp = b[k] || [];
        const sum = a => a.reduce((x, y) => x + y, 0);
        if (f && f.interior && f.interior.length === sp.length && sp.length > 1 && Math.abs(sum(f.interior) - sum(sp)) < 0.1 && f.interior.some((v, i) => Math.abs(v - sp[i]) > 0.05)) { f.box5 = f.interior; f.interior = sp.slice(); f.fromMarkup = true; }
      });
    });
    return { job, code, building: first.building, frames: first.frames, buildings, site, mezzanines: mezz, notes, pen, ecospan: eco ? eco[0].trim() : null, attachments: attachments(pages), seismic: seismicFacts(pages), extras: extraComponents(pages), cranes: cranes(pages), bracingOptions: brOpts, columnRequest: colReq ? clean(colReq) : null, otherDoc: prim.cut };
  }

  const api = { parse, primaryPages, qoStart, specialNotes, qualifications, notesFor, lines, ftin, fmtFtIn, spacingList, undouble, editionFor, divisionFrom, checkboxTargets, box22Pages, CHECK_LABELS, building, frames, mezzanines, jobFacts, attachments, seismicFacts, roofLoads, buildingNames, extraComponents, bracingOptions, bracingByWall, cranes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_PCS = api;
})(typeof self !== 'undefined' ? self : this);
