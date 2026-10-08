const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PCS = require('../src/pcs.js');

// ft-in parsing as it appears on eQuote PCS pages and annotations
const ft = PCS.ftin;
assert.strictEqual(ft(`12'-0"`), 12);
assert.strictEqual(ft(`10'-2"`), 10 + 2 / 12);
assert.strictEqual(ft(`0'-3 1/2"`), 3.5 / 12);
assert.strictEqual(ft(`0'-4"`), 4 / 12);
assert.strictEqual(ft(`5"`), 5 / 12);
assert.strictEqual(ft(`2 1/2"`), 2.5 / 12);
assert.strictEqual(ft(`4'`), 4);
assert.strictEqual(ft('TBD'), null);
assert.strictEqual(ft('N/A'), null);
assert.deepStrictEqual(PCS.spacingList(`2@20'-0", 3@24'-0", 1@18'-0"`), [20, 20, 24, 24, 24, 18]);
assert.deepStrictEqual(PCS.spacingList(`3@20'-0"`), [20, 20, 20]);
assert.strictEqual(PCS.undouble('BBuuiillddiinngg'), 'Building');
assert.strictEqual(PCS.undouble('1:12'), '1:12');
assert.strictEqual(PCS.fmtFtIn(10 + 2 / 12), `10'-2"`);
assert.strictEqual(PCS.fmtFtIn(3.5 / 12), `0'-3 1/2"`);
// Box 3 building code -> workbook edition
assert.strictEqual(PCS.editionFor('Ohio 2024 (IBC 2021) ASCE 7-16').edition, '15');
assert.strictEqual(PCS.editionFor('IBC 2018').edition, '15');
assert.strictEqual(PCS.editionFor('IBC 2024').edition, '16');
assert.strictEqual(PCS.editionFor('IBC 2015').edition, '13');
assert.strictEqual(PCS.editionFor('NBCC 2020').edition, 'S16-19');
// IBC → AISC 360 edition (IBC chapter 35): 2024 → 360-22 (16th), 2018 / 2021 → 360-16 (15th), 2012 / 2015 → 360-10 (13th sheet)
[['IBC 2024', '16'], ['IBC 2021', '15'], ['IBC 2018', '15'], ['IBC 2015', '13'], ['IBC 2012', '13'], ['IBC 2009', '13']].forEach(([c, e]) => assert.strictEqual(PCS.editionFor(c).edition, e, c));
// no IBC year: the state code's IBC base, else the ASCE 7 year (7-22 → IBC 2024, 7-16 → IBC 2018/21, 7-10 → IBC 2012/15)
assert.strictEqual(PCS.editionFor('Massachusetts (MASS 10th Ed.) ASCE 7-16').edition, '15');
assert.strictEqual(PCS.editionFor('Massachusetts (MASS 9th Ed.) ASCE 7-10').edition, '13');
assert.strictEqual(PCS.editionFor('Florida Building Code 8th Edition (2023) ASCE 7-22').edition, '15', 'FBC 8th is IBC 2021 even with ASCE 7-22');
assert.strictEqual(PCS.editionFor('California Building Code 2025 ASCE 7-22').edition, '16');
assert.strictEqual(PCS.editionFor('Texas ASCE 7-22').edition, '16');
assert.strictEqual(PCS.editionFor('Some County Code ASCE 7-16').edition, '15');
assert.strictEqual(PCS.editionFor('Ohio 2024 (IBC 2021) ASCE 7-16').edition, '15', 'an explicit IBC year wins');
assert.strictEqual(PCS.divisionFrom('Nucor Building Systems - IN'), 'NBS-IN');

// Kerning fragments and double-struck runs rebuild into phrases
{
  const page = { items: [
    { str: 'Dead', x: 45, y: 172, w: 20, h: 8.3 }, { str: 'Lo', x: 67.2, y: 172, w: 9.5, h: 8.3 }, { str: 'ad:', x: 76.8, y: 172, w: 14, h: 8.3 },
    { str: 'P', x: 93, y: 172, w: 4.2, h: 8.3 }, { str: 'er', x: 97.1, y: 172, w: 8, h: 8.3 }, { str: 'Seller', x: 107.3, y: 172, w: 20, h: 8.3 }, { str: 'PSF', x: 129.4, y: 172, w: 15, h: 8.3 },
    { str: 'Liv', x: 180, y: 172, w: 11, h: 8.3 }, { str: 'e', x: 191, y: 172, w: 4.5, h: 8.3 },
    { str: 'Building', x: 38, y: 158, w: 32.5, h: 8.3 }, { str: 'Building', x: 38.2, y: 158, w: 32.5, h: 8.3 },
  ], annots: [] };
  const ls = PCS.lines(page);
  assert.strictEqual(ls[0].text, 'Building');
  assert.strictEqual(ls[1].items[0].str, 'Dead Load: Per Seller PSF');
  assert.strictEqual(ls[1].items[1].str, 'Live');
}

// Box 22 checkboxes: the base scope's "NONE REQUIRED" page is not rendered, an alternate's pages are; two mezzanines
// on one page each keep the ticks on their own rows ("Other Deck Type" is not the material "Other")
{
  const it = (str, x, y) => ({ str, x, y, w: str.length * 4, h: 8 });
  const mezz = (id, y) => [it(`Mezzanine ID: ${id}`, 40, y), it('Standard Weight Concrete', 60, y + 40), it('Light Weight Concrete', 220, y + 40), it('Plywood', 380, y + 40), it('Other', 470, y + 40),
    it('Storage', 60, y + 60), it('Office', 160, y + 60), it('Theater', 260, y + 60), it('Other Deck Type: 22ga B deck', 40, y + 80)];
  const none = { num: 1, items: [it('22) MEZZANINES - NONE REQUIRED', 30, 100), it('23) CRANES - NONE REQUIRED', 30, 130)], annots: [] };
  const alt = { num: 2, items: [it('22) MEZZANINES', 30, 100), ...mezz('M1', 120), ...mezz('M2', 320)], annots: [] };
  assert.deepStrictEqual(PCS.box22Pages([none, alt]).map(p => p.num), [2]);
  const tg = PCS.checkboxTargets(alt);
  assert.strictEqual(tg.length, 14, 'material and use rows of both mezzanines, no "Other Deck Type"');
  assert.strictEqual(new Set(tg.map(t => t.key)).size, 14);
  alt.checks = Object.fromEntries(tg.map(t => [t.key, t.y < 300 ? /Standard|Theater/.test(t.label) : /Light|Office/.test(t.label)]));
  const [m1, m2] = PCS.parse([none, alt]).mezzanines;
  assert.deepStrictEqual([m1.checks.material['Standard Weight Concrete'], m1.checks.use.Theater, m1.checks.material.Other], [true, true, false]);
  assert.deepStrictEqual([m2.checks.material['Light Weight Concrete'], m2.checks.use.Office, m2.checks.use.Theater], [true, true, false]);
}

// Full example job (the PCS is customer data and stays out of the repo)
const pdf = process.env.MZ_PCS || path.join(__dirname, '..', 'private', 'pcs', 'Project_Confirmation_Summary_W2H-26018.pdf');
if (!fs.existsSync(pdf)) { console.log('pcs tests passed (example PCS not present, full-job test skipped)'); process.exit(0); }
let readPcs;
try { ({ readPcs } = require('./pdf-node.js')); require('./pdf-node.js').loadPdfjs(); } catch (e) { console.log('pcs tests passed (pdfjs-dist not installed, full-job test skipped)'); process.exit(0); }
(async () => {
  const pages = await readPcs(pdf);
  const pcs = PCS.parse(pages);
  assert.strictEqual(pcs.job.quote, 'W2H-26018');
  assert.strictEqual(pcs.code.edition, '15');
  assert.deepStrictEqual(pcs.building.bays, [20, 20, 24, 24, 24, 18]);
  assert.deepStrictEqual(pcs.building.lewCols, [20, 20, 20]);
  const m = pcs.mezzanines[0];
  assert.strictEqual(m.id, '2nd FL Office');
  assert.strictEqual(m.live, 125); assert.strictEqual(m.collateral, 5); assert.strictEqual(m.dead, 'Per Seller');
  assert.strictEqual(m.width, 60); assert.strictEqual(m.length, 40); assert.strictEqual(m.slab * 12, 4);
  assert.strictEqual(m.dims.A.value, 12);
  assert.strictEqual(m.dims.B.source, 'annotation'); assert.strictEqual(m.dims.B.value, 10 + 2 / 12);
  assert.strictEqual(m.dims.joistSpacing.value, 4);
  assert.strictEqual(Math.round(m.dims.seat.value * 12 * 1000) / 1000, 5);
  const RUN = require('../src/run.js');
  const inp = RUN.inputsFromPCS(pcs, 0);
  // (C) is TBD with no blue note: the run asks for it rather than assuming
  const ask = RUN.run(JSON.parse(JSON.stringify(inp)), {});
  assert.ok(ask.incomplete); assert.deepStrictEqual(ask.need.map(n => n.path), ['geom.C']);
  inp.geom.C = { value: null, source: 'none' };   // entered: no requirement
  const res = RUN.run(inp, {});
  assert.strictEqual(res.joistDepthIn, 13, 'A - B - slab - seat = 13"');
  // interior / exterior marks: the two inside lines carry 20' of floor, the sidewall lines 10' (joists one side)
  assert.deepStrictEqual(res.marks.map(mk => [mk.mark, mk.kind, mk.qty, mk.span, mk.trib]), [['MB1', 'interior', 4, 20, 20], ['MB2', 'exterior', 4, 20, 10]]);
  assert.deepStrictEqual(res.quote.beams.map(b => [b.mark, b.qty, b.trib]), [['MB1', 4, 20], ['MB2', 4, 10]]);
  assert.strictEqual(res.quote.columns[0].qty, 4);
  res.marks.forEach(mk => assert.ok(mk.check.res.CSR <= 0.99 && mk.check.res.SRvx <= 0.99 && mk.check.defl.rLL >= 360 && mk.check.defl.rTL >= 240, mk.mark));
  assert.ok(res.marks[1].sec.d < res.marks[0].sec.d, 'exterior mark is lighter than the interior one');
  // one governing mark when asked: every beam at the largest trib
  const one = RUN.run(JSON.parse(JSON.stringify(inp)), { marks: 'single' });
  assert.deepStrictEqual(one.marks.map(mk => [mk.qty, mk.trib, mk.kind]), [[8, 20, '']]);
  assert.strictEqual(one.marks[0].desc, res.marks[0].desc);
  assert.ok(res.colFinal.ok && res.colFinal.max < 1);
  // floor plan: the ⊗ symbols on the last page register to the grid and match the derived columns
  const PLAN = require('../src/plan.js');
  const { loadPdfjs } = require('./pdf-node.js');
  const planPage = pages[pages.length - 1];
  const ol = await planPage._page.getOperatorList();
  const paths = PLAN.subpaths(ol, loadPdfjs().OPS, planPage.height);
  const reg = PLAN.registerAndRead(paths, { xs: res.grid.xs, colY: [0, 20, 40, 60] });
  assert.ok(reg.ok, reg.reason);
  assert.strictEqual(reg.columns.length, 4);
  assert.ok(PLAN.compare(reg.columns, res.layout.mezzCols).agree, 'floor plan ⊗ match the layout');
  console.log('pcs tests passed (example job:', res.quote.beams.map(b => b.mark + ' ' + b.section + ' x' + b.qty).join(', '), res.quote.columns[0].section + ')');
})().catch(e => { console.error(e); process.exit(1); });
