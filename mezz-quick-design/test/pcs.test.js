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
  const res = RUN.run(inp, {});
  assert.strictEqual(res.joistDepthIn, 13, 'A - B - slab - seat = 13"');
  assert.strictEqual(res.quote.beams.length, 1);
  assert.strictEqual(res.quote.beams[0].qty, 8);
  assert.strictEqual(res.quote.beams[0].trib, 20);
  assert.strictEqual(res.quote.columns[0].qty, 4);
  assert.ok(res.marks[0].check.res.CSR <= 0.99 && res.marks[0].check.defl.rLL >= 360 && res.marks[0].check.defl.rTL >= 240);
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
  console.log('pcs tests passed (example job:', res.quote.beams[0].section, res.quote.columns[0].section + ')');
})().catch(e => { console.error(e); process.exit(1); });
