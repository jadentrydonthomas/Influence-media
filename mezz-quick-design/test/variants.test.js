// Variant PCS loop: the example PCS is re-read as phrases, edited the way other jobs differ (numeric dead
// load, code year, mezzanine offsets, interior frame columns, deck text, LW concrete, requested dims filled,
// a second mezzanine on a continuation page) and every variant is designed on the 13th, 15th and 16th sheets.
// The PCS is customer data and stays out of the repo; without it (or pdfjs-dist) this test is skipped.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PCS = require('../src/pcs.js');
const RUN = require('../src/run.js');

const pdf = process.env.MZ_PCS || path.join(__dirname, '..', 'private', 'pcs', 'Project_Confirmation_Summary_W2H-26018.pdf');
if (!fs.existsSync(pdf)) { console.log('variant tests skipped (example PCS not present)'); process.exit(0); }
let readPcs;
try { ({ readPcs } = require('./pdf-node.js')); require('./pdf-node.js').loadPdfjs(); } catch (e) { console.log('variant tests skipped (pdfjs-dist not installed)'); process.exit(0); }

// pages rebuilt from merged phrases, so a variant can swap a whole phrase ("Dead Load: 50 PSF")
const phrasePages = pages => pages.map(p => ({
  num: p.num, width: p.width, height: p.height, annots: (p.annots || []).map(a => ({ ...a })), checks: p.checks ? { ...p.checks } : undefined,
  items: PCS.lines(p).flatMap(l => l.items.map(it => ({ str: it.str, x: it.x, y: l.y, w: it.w, h: it.h || 8 }))),
}));
const clone = pages => phrasePages(pages);
function sub(pages, re, to, where) {
  let n = 0;
  pages.forEach((p, i) => { if (where != null && i !== where) return; p.items.forEach(it => { if (re.test(it.str)) { it.str = it.str.replace(re, to); n++; } }); });
  assert.ok(n > 0, 'variant edit found nothing for ' + re);
  return pages;
}
const box22 = pages => pages.findIndex(p => PCS.lines(p).some(l => /22\)\s*MEZZANINES/i.test(l.text)));
// the value phrase sitting in the Requested column on a Box 22 dimension row (the blue note on that row is dropped)
// — edits items only: PCS.lines() caches per page object, so nothing may read an edited page before parse
function setRequestedOn(p, rowRe, value) {
  const row = p.items.find(it => rowRe.test(it.str));
  assert.ok(row, 'no row ' + rowRe);
  const cell = p.items.filter(it => Math.abs(it.y - row.y) < 2 && it.x > 440 && it.x < 500)[0];
  assert.ok(cell, 'no requested cell on ' + rowRe);
  cell.str = value;
  p.annots = (p.annots || []).filter(a => !(a.subtype === 'FreeText' && row.y >= a.y1 - 2 && row.y <= a.y2 + 4));
}

const bad = [];
// MZ_DUMP=dir writes every picked beam / column as oracle cases (oracle/*_oracle.py → oracle/compare.js)
const dump = process.env.MZ_DUMP ? { beam: { 13: [], 15: [], 16: [] }, column: { 15: [], 16: [] } } : null;
const seen = new Set();
function keep(kind, ed, c) { const k = kind + ed + JSON.stringify(c); if (!seen.has(k)) { seen.add(k); dump[kind][ed].push(c); } }
function designAll(label, pcs, mi, expect = {}) {
  const inp = RUN.inputsFromPCS(pcs, mi);
  assert.ok(inp, label + ': no inputs');
  if (expect.inputs) expect.inputs(inp);
  const lines = [];
  for (const edition of ['13', '15', '16']) {
    for (const optionDefault of ['lightest', 'fit', 'headroom']) {
      const res = RUN.run(JSON.parse(JSON.stringify(inp)), { edition, optionDefault });
      const tag = `${label} [${edition}th, ${optionDefault}]`;
      const stops = res.warn.filter(w => w.level === 'stop').map(w => w.text);
      if (!expect.allowStop && stops.length) bad.push(`${tag}: ${stops.join(' | ')}`);
      if (res.incomplete) { bad.push(`${tag}: incomplete`); continue; }
      res.marks.forEach(mk => {
        if (!mk.sec) return bad.push(`${tag}: ${mk.mark} has no section`);
        const c = mk.check;
        const ok = c.res.CSR <= 0.99 && c.res.SRvx <= 0.99 && c.defl.rLL >= 360 && c.defl.rTL >= 240 && (!c.conc || c.conc.ok) && isFinite(c.res.CSR);
        if (!ok) bad.push(`${tag}: ${mk.mark} ${c.desc} fails (CSR ${c.res.CSR}, V ${c.res.SRvx}, L/${c.defl.rLL}, L/${c.defl.rTL})`);
        if (optionDefault === 'lightest' && mk.search && mk.search.best && mk.check.res.Wt > mk.search.best.wt + 1e-9) bad.push(`${tag}: ${mk.mark} not the lightest`);
      });
      if (res.columns.length) {
        if (!res.colFinal || !res.colFinal.ok) bad.push(`${tag}: columns ${res.colFinal ? res.colFinal.name + ' max ' + res.colFinal.max : 'none'}`);
        res.colGroups.forEach(g => { if (res.colFinal && !res.colFinal.checks.every(c => c.ok)) bad.push(`${tag}: ${res.colFinal.name} fails a group`); });
      }
      const q = RUN.quoteSheet(res, inp);
      const tsv = [q.tsv.design, q.tsv.beams, q.tsv.columns].join('\n');
      if (/NaN|undefined|null|Infinity/.test(tsv)) bad.push(`${tag}: quote rows contain ${tsv.match(/NaN|undefined|null|Infinity/)[0]}`);
      if (expect.result) expect.result(res, q, tag, edition, optionDefault);
      if (dump) {
        res.marks.forEach(mk => { if (mk.sec) { const { dead, coll, live, joistWt, L, Lb, trib } = mk.params; keep('beam', res.edition.beamEd, { dead, coll, live, joistWt, L, Lb, trib, sec: mk.sec }); } });
        if (res.colFinal) res.colGroups.forEach(g => keep('column', res.edition.colEd, { sec: { type: 'WF', name: res.colFinal.name }, Fy: 50, Fu: 65, L: res.colLen, Lby: res.colLen * 12, ...g.loads }));
      }
      if (optionDefault === 'lightest') lines.push(`${edition}th ${res.quote.beams.map(b => `${b.section}×${b.qty}`).join(' + ')} | ${res.colFinal ? res.colFinal.quoteAs + '×' + res.columns.length : 'no mezz cols'}`);
    }
  }
  console.log(label.padEnd(34), lines.join('  ·  '));
  return inp;
}

(async () => {
  const raw = await readPcs(pdf);
  const base = phrasePages(raw);
  const B22 = box22(base);

  // 0. as issued
  designAll('as issued', PCS.parse(clone(base)), 0, {
    result: (res, q, tag, ed, opt) => {
      if (ed === '15' && opt === 'lightest') { assert.strictEqual(res.quote.beams[0].section, 'BU24x30'); assert.strictEqual(res.colFinal.quoteAs, 'W10X22'); }
    },
  });

  // 1. numeric dead load on the PCS replaces the deck-guide value
  {
    const p = sub(clone(base), /^Dead Load: Per Seller PSF$/, 'Dead Load: 50 PSF', B22);
    designAll('dead load 50 psf on the PCS', PCS.parse(p), 0, {
      inputs: inp => { assert.strictEqual(inp.loads.dead.value, 50); assert.strictEqual(inp.loads.dead.source, 'pcs'); assert.ok(!inp.loads.dead.auto); },
      result: (res, q) => { assert.strictEqual(q.design[0].DL, 50); assert.strictEqual(q.beams[0].DLT, 55); },
    });
  }
  // 2 / 3. building code year → workbook edition
  for (const [code, ed, beamEd, colEd] of [['IBC 2024 ASCE 7-22', '16', '16', '16'], ['IBC 2015 ASCE 7-10', '13', '13', '15'], ['IBC 2018 ASCE 7-16', '15', '15', '15']]) {
    const p = sub(clone(base), /^Building Code: .*$/, 'Building Code: ' + code);
    const pcs = PCS.parse(p);
    assert.strictEqual(pcs.code.edition, ed, code);
    const res = RUN.run(RUN.inputsFromPCS(pcs, 0), { edition: 'auto' });
    assert.strictEqual(res.edition.beamEd, beamEd, code + ' beam sheet'); assert.strictEqual(res.edition.colEd, colEd, code + ' column sheet');
    console.log(('code ' + code).padEnd(34), `auto → beams ${beamEd}th, columns ${colEd}th: ${res.quote.beams.map(b => b.section).join(' / ')} · ${res.colFinal.quoteAs}`);
  }
  // 4. mezzanine offset from the LEW, edge off the grid (x = 20' → 60', grid at 0/20/40/64)
  {
    const p = sub(clone(base), /^0'-0"$/, `20'-0"`, B22);   // both "Start Location" values are 0'-0" on this page — set LEW only
    const pg = p[B22], lewRow = pg.items.find(it => /^Start Location from LEW/.test(it.str));
    pg.items.filter(it => Math.abs(it.y - lewRow.y) < 2 && it.str === `20'-0"` && it.x > 300).forEach(it => { it.str = `0'-0"`; });
    designAll('offset 20\' from LEW (edge off grid)', PCS.parse(p), 0, {
      inputs: inp => { assert.strictEqual(inp.geom.startLEW.value, 20); assert.strictEqual(inp.geom.startFSW.value, 0); },
      result: res => { assert.ok(res.layout.footprint.x0 === 20 && res.layout.footprint.x1 === 60); },
    });
  }
  // 5. narrower mezzanine set in from both sidewalls: no building columns under it
  {
    const p = clone(base), pg = p[B22];
    sub(p, /^Width: 60'-0"$/, `Width: 40'-0"`, B22);
    const fswRow = pg.items.find(it => /^Start Location from FSW/.test(it.str));
    pg.items.filter(it => Math.abs(it.y - fswRow.y) < 2 && it.x > fswRow.x).forEach(it => { it.str = `10'-0"`; });
    designAll('40\' wide, 10\' in from the FSW', PCS.parse(p), 0, {
      inputs: inp => { assert.strictEqual(inp.geom.width.value, 40); assert.strictEqual(inp.geom.startFSW.value, 10); },
      result: res => { assert.ok(res.layout.mezzCols.length >= 4, 'free-standing mezzanine needs its own columns'); },
    });
  }
  // 6. interior frame columns (frames 2–6 with an interior column at 30')
  {
    const p = clone(base);
    const fp = p.findIndex(pg => pg.items.some(it => /^Interior Module$/.test(it.str)));
    const row = p[fp].items.find(it => it.str === '2 - 6');
    p[fp].items.filter(it => Math.abs(it.y - row.y) < 2 && it.str === `1@60'-0"`).forEach(it => { it.str = `2@30'-0"`; });
    let nCols0;
    designAll('interior frame columns @ 30\'', PCS.parse(p), 0, {
      inputs: inp => { assert.ok(inp.building.frames.some(fr => fr.interior && fr.interior.length === 2), 'frames read'); },
      result: (res, q, tag, ed, opt) => {
        nCols0 = nCols0 ?? RUN.run(RUN.inputsFromPCS(PCS.parse(clone(base)), 0), {}).columns.length;
        const bcol = res.layout.supports.filter(s => s.building && s.y > 0 && s.y < 60);
        assert.ok(bcol.length > 0, 'interior building columns used as beam supports');
      },
    });
  }
  // 7. deck type written on the PCS
  {
    const p = sub(clone(base), /^Deck Type: Per Seller$/, 'Deck Type: 1.5VL 20 ga Composite', B22);
    designAll('deck 1.5VL on the PCS', PCS.parse(p), 0, {
      inputs: inp => { assert.strictEqual(inp.mezz.deck, '1.5VL'); assert.ok(inp.loads.dead.auto); assert.strictEqual(inp.loads.dead.source, 'estimate'); },
    });
  }
  // 8. lightweight concrete checked
  {
    const p = clone(base);
    p[B22].checks = { 'Standard Weight Concrete': false, 'Light Weight Concrete': true, Office: true };
    designAll('lightweight concrete checked', PCS.parse(p), 0, {
      inputs: inp => { assert.strictEqual(inp.mezz.concrete, 'LW'); assert.ok(inp.loads.dead.value < 43); },
      result: (res, q) => assert.strictEqual(q.design[0].WT, 'LW'),
    });
  }
  // 9. requested dimensions filled in (no blue notes)
  {
    const p = clone(base);
    setRequestedOn(p[B22], /^\(B\) Minimum Required Clearance Under Joist:/, `9'-0"`);
    setRequestedOn(p[B22], /^Joist Seat Depth:/, `2 1/2"`);
    setRequestedOn(p[B22], /^Mezzanine Joist Spacing:/, `5'-0"`);
    setRequestedOn(p[B22], /^\(C\) Minimum Required Clearance Under Floor Beams:/, `8'-0"`);
    designAll('requested B / C / seat / spacing', PCS.parse(p), 0, {
      inputs: inp => {
        assert.strictEqual(inp.geom.B.value, 9); assert.strictEqual(inp.geom.B.source, 'pcs');
        assert.strictEqual(inp.geom.seat.value, 2.5 / 12); assert.strictEqual(inp.geom.joistSpacing.value, 5); assert.strictEqual(inp.geom.C.value, 8);
      },
      result: res => {
        assert.strictEqual(res.joistDepthIn, 29.5);
        res.marks.forEach(mk => assert.ok(mk.sec.d <= 12 * (12 - 8) - 4 - 2.5, 'C caps the beam depth'));
        assert.strictEqual(res.beamBase.Lb, 5);
      },
    });
  }
  // 10. a second mezzanine on a continuation page
  {
    const p = clone(base), src = p[B22];
    const idY = src.items.find(it => /^Mezzanine ID:/.test(it.str)).y, endY = src.items.find(it => /^23\) CRANES/.test(it.str)).y;
    const hdr = src.items.filter(it => it.y < 115);   // page header incl. CONTROL #
    const body = src.items.filter(it => it.y >= idY - 1 && it.y < endY - 1).map(it => ({ ...it }));
    const cont = { num: src.num + 0.5, width: src.width, height: src.height, annots: [], checks: { 'Standard Weight Concrete': true, Storage: true }, items: [...hdr.map(it => ({ ...it })), ...body, ...src.items.filter(it => /^23\) CRANES/.test(it.str)).map(it => ({ ...it }))] };
    src.items = src.items.filter(it => !/^23\) CRANES/.test(it.str));
    p.splice(B22 + 1, 0, cont);
    const s2 = (re, to) => sub(p, re, to, B22 + 1);
    s2(/^Mezzanine ID: .*$/, 'Mezzanine ID: Storage Mezz'); s2(/^Dead Load: Per Seller PSF$/, 'Dead Load: 50 PSF'); s2(/^Live Load: 125 PSF$/, 'Live Load: 250 PSF');
    s2(/^Width: 60'-0"$/, `Width: 20'-0"`); s2(/^Length: 40'-0"$/, `Length: 40'-0"`);
    const lewRow = cont.items.find(it => /^Start Location from LEW/.test(it.str));
    cont.items.filter(it => Math.abs(it.y - lewRow.y) < 2 && it.x > 150 && it.x < 250).forEach(it => { it.str = `64'-0"`; });
    setRequestedOn(cont, /^\(A\) Finished Floor/, `14'-0"`); setRequestedOn(cont, /^\(B\) Minimum Required Clearance Under Joist:/, `11'-0"`);
    setRequestedOn(cont, /^Joist Seat Depth:/, `4"`); setRequestedOn(cont, /^Mezzanine Joist Spacing:/, `3'-0"`);
    const pcs = PCS.parse(p);
    assert.strictEqual(pcs.mezzanines.length, 2, 'two mezzanines read');
    assert.strictEqual(pcs.mezzanines[0].id, '2nd FL Office');
    designAll('mezz 1 of 2 (unchanged)', pcs, 0, { result: (res, q, tag, ed, opt) => { if (ed === '15' && opt === 'lightest') assert.strictEqual(res.quote.beams[0].section, 'BU24x30'); } });
    designAll('mezz 2 of 2: storage 250 psf', pcs, 1, {
      inputs: inp => {
        assert.strictEqual(inp.mezz.id, 'Storage Mezz'); assert.strictEqual(inp.loads.live.value, 250); assert.strictEqual(inp.loads.dead.value, 50);
        assert.strictEqual(inp.geom.startLEW.value, 64); assert.strictEqual(inp.geom.A.value, 14); assert.strictEqual(inp.geom.joistSpacing.value, 3);
      },
      result: (res, q) => { assert.strictEqual(q.design[0].MEZZ, 'Storage Mezz'); assert.strictEqual(q.design[0].LL, 250); },
    });
  }

  if (dump) {
    fs.mkdirSync(process.env.MZ_DUMP, { recursive: true });
    for (const kind of ['beam', 'column']) for (const [ed, cs] of Object.entries(dump[kind])) if (cs.length) fs.writeFileSync(path.join(process.env.MZ_DUMP, `picked_${kind}${ed}.json`), JSON.stringify(cs));
    console.log('oracle cases written to', process.env.MZ_DUMP);
  }
  if (bad.length) { console.log(bad.slice(0, 40).join('\n')); console.log(`${bad.length} variant problems`); process.exit(1); }
  console.log('variant tests passed');
})().catch(e => { console.error(e); process.exit(1); });

