// The OCR reader (src/ocr.js): Tesseract's usual slips on a PCS put right, checkboxes found in the picture, pen
// markups told apart, words placed on the baseline of the row. With OCR_TOOLS set (test/ocr-node.js) and the S1B
// contract in private/pcs/ (its pages drawn as outlines: no text layer), the whole PDF is read and checked against
// what the pages show.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const OCR = require('../src/ocr.js');
const PCS = require('../src/pcs.js');

// ---- the slips ----
const fx = OCR.fixWord;
[[`9-10"`, `9'-10"`], [`0-21/2"`, `0'-2 1/2"`], [`52'_5"`, `52'-5"`], [`1T@13'-6",`, `1@13'-6",`], [`T@15'-0",`, `1@15'-0",`],
  [`@20'-0",`, `1@20'-0",`], [`1@13-11"`, `1@13'-11"`], [`1O'-6"`, `10'-6"`], [`(©)`, '(C)'], ['Ill', 'III'], ['5,000Ib.', '5,000lb.'],
  ['$1:', 'S1:'], [`13’-5”`, `13'-5"`], [`2-3/4"`, `2-3/4"`], [`3/4"`, `3/4"`], [`113/16"`, `11 3/16"`], ['$200', '$200'], ['Width:', 'Width:']]
  .forEach(([a, b]) => assert.strictEqual(fx(a), b, a));
// a foot mark lost on a value split in two words still reads
assert.strictEqual(PCS.ftin(`8-4 1/2"`), 8 + 4.5 / 12);
assert.strictEqual(PCS.ftin(`2-3/4"`), 2.75 / 12, 'inches with a hyphen stay inches');

// ---- a page picture: white, with checkboxes, a ring, a bullet ----
const S = 300 / 72;
function canvas(w, h) { const data = new Uint8ClampedArray(w * h * 4).fill(255); return { width: w, height: h, data }; }
function fill(img, x0, y0, x1, y1, rgb) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * img.width + x) * 4; img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; } }
function frame(img, x, y, n, t, rgb) { fill(img, x, y, x + n, y + t - 1, rgb); fill(img, x, y + n - t + 1, x + n, y + n, rgb); fill(img, x, y, x + t - 1, y + n, rgb); fill(img, x + n - t + 1, y, x + n, y + n, rgb); }
const img = canvas(600, 300);
frame(img, 40, 40, 37, 4, [150, 150, 150]);                                   // empty box
frame(img, 140, 40, 37, 4, [150, 150, 150]);                                  // ticked box
for (let k = 0; k < 14; k++) fill(img, 150 + k, 60 + Math.round(k * 0.6), 152 + k, 63 + Math.round(k * 0.6), [20, 20, 20]);
for (let a = 0; a < 720; a++) { const x = Math.round(270 + 16 * Math.cos(a / 114.6)), y = Math.round(58 + 16 * Math.sin(a / 114.6)); fill(img, x, y, x + 2, y + 2, [0, 0, 0]); }   // an "O"
fill(img, 340, 40, 372, 72, [0, 0, 0]);                                       // a bullet
frame(img, 420, 20, 200 - 30, 3, [0, 0, 0]);                                  // a table cell far bigger than a box
const boxes = OCR.findBoxes(img, S);
assert.strictEqual(boxes.length, 2, 'two checkboxes: ' + JSON.stringify(boxes));
assert.deepStrictEqual(boxes.map(b => b.checked).sort(), [false, true]);
assert(Math.abs(boxes.find(b => b.checked).x1 - 140 / S) < 0.5, 'the box is placed in page points');

// ---- pen markups: a slanted red line through black figures; red figures; black figures ----
const word = canvas(400, 60);
const glyphs = (x0, rgb) => [0, 22, 44].forEach(dx => { frame(word, x0 + dx, 15, 16, 3, rgb); });   // three "figures" 16 px tall
glyphs(10, [0, 0, 0]);
for (let x = 6; x <= 80; x++) { const y = Math.round(26 - (x - 6) * 0.08); fill(word, x, y, x, y + 2, [230, 20, 20]); }
glyphs(150, [225, 25, 25]);
glyphs(290, [0, 0, 0]);
const mk = x0 => OCR.markup(word, { x0, y0: 15, x1: x0 + 60, y1: 31 }, 31, 15);
assert.deepStrictEqual(mk(10), { color: null, struck: true }, 'black figures under a slanted red line are struck out');
assert.deepStrictEqual(mk(150), { color: 'red', struck: false }, 'red figures are a markup, not struck');
assert.deepStrictEqual(mk(290), { color: null, struck: false });

// ---- Tesseract words -> items: the baseline under the letters, the struck word kept aside ----
const sym = (text, x0, x1, y0, y1) => ({ text, bbox: { x0, x1, y0, y1 } });
const data = { blocks: [{ paragraphs: [{ lines: [
  { rowAttributes: { row_height: 33 }, bbox: { x0: 0, y0: 0, x1: 400, y1: 40 }, words: [
    { text: 'Frame;', confidence: 90, bbox: { x0: 10, y0: 10, x1: 80, y1: 36 }, symbols: [sym('F', 10, 22, 10, 36), sym('r', 23, 30, 16, 36), sym('a', 31, 40, 16, 36), sym('m', 41, 60, 16, 36), sym('e', 61, 70, 16, 36), sym(';', 71, 80, 16, 40)] },
    // a lone figure, whose fitted line baseline Tesseract put a third of the way up: the symbols say 36
    { text: '9-10"', confidence: 81, bbox: { x0: 120, y0: 12, x1: 180, y1: 36 }, symbols: [sym('9', 120, 132, 12, 36), sym('-', 135, 145, 22, 25), sym('1', 148, 152, 12, 36), sym('0', 156, 168, 12, 36), sym('"', 172, 180, 12, 18)] },
  ] },
] }] }] };
const blank = canvas(400, 60);
const its = OCR.items(data, blank, S).items;
assert.deepStrictEqual(its.map(i => i.str), ['Frame:', `9'-10"`], '";" before a value is ":", the foot mark put back');
assert(Math.abs(its[0].y - 36 / S) < 1e-9 && Math.abs(its[1].y - 36 / S) < 1e-9, 'one baseline for the row');

// ---- the S1B contract: DocuWare drew every glyph as an outline; read it all by OCR ----
const file = path.join(__dirname, '..', 'private', 'pcs', 'S1B-26004_contract.pdf');
if (!process.env.OCR_TOOLS || !fs.existsSync(file)) {
  console.log(`ocr.test: unit checks passed; the S1B read SKIPPED (${!process.env.OCR_TOOLS ? 'set OCR_TOOLS — see test/ocr-node.js' : 'no private/pcs/S1B-26004_contract.pdf'})`);
} else {
  (async () => {
    const { readPcs, endOcr } = require('./pdf-node.js');
    const EX = require('../src/extract.js');
    const t0 = Date.now(), pages = await readPcs(file);
    assert.deepStrictEqual(pages.ocr.pages, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22], 'pages 5-22 are outlines (23 is the floor plan, a drawing)');
    for (const p of PCS.box22Pages(pages)) p.checks = (await EX.detectChecks(p, PCS.checkboxTargets(p), p._page)).states || {};
    const pcs = PCS.parse(pages), ft = PCS.fmtFtIn;
    assert(pcs.job.project && pcs.job.project.length > 3, 'project name read');
    assert.strictEqual(pcs.job.division, 'NBG-SC');
    assert.strictEqual(pcs.job.quote, 'S1B-26002');
    assert.deepStrictEqual([pcs.seismic.Ss, pcs.seismic.S1, pcs.seismic.siteClass, pcs.seismic.risk], [0.155, 0.076, 'D', 'II']);
    const b = pcs.building;
    assert.deepStrictEqual([ft(b.width), ft(b.length), ft(b.eaveFSW)], [`52'-5"`, `122'-0"`, `25'-8"`]);
    assert.deepStrictEqual(b.bays.map(ft), [`27'-6"`, `15'-0"`, `25'-0"`, `30'-0"`, `24'-6"`]);
    assert.deepStrictEqual(b.lewCols.map(ft), [`13'-6"`, `25'-0"`, `13'-11"`]);
    assert.deepStrictEqual(pcs.frames.map(f => `${f.from}-${f.to} ${f.interior.map(ft).join(',')}`), [`1-1 13'-6",25'-0",13'-11"`, `2-5 52'-5"`, `6-6 13'-6",25'-0",13'-11"`]);
    const [A, B] = pcs.mezzanines;
    assert.deepStrictEqual(pcs.mezzanines.map(m => m.id), ['A', 'B']);
    // A: 26'-6" struck through, 26'-8" written in red — the red value
    assert.strictEqual(ft(A.width), `26'-8"`);
    assert(A.markups.some(x => x.field === 'width' && x.now === `26'-8"`), JSON.stringify(A.markups));
    assert.deepStrictEqual([ft(A.length), ft(A.startLEW), ft(A.startFSW), ft(A.slab)], [`46'-6"`, `74'-10"`, `0'-8"`, `0'-4"`]);
    // B: 25'-3" struck through (a slanted pen line), 25'-1" in red
    assert.strictEqual(ft(B.width), `25'-1"`);
    assert.deepStrictEqual([ft(B.length), ft(B.startLEW), ft(B.startFSW)], [`83'-0"`, `38'-4"`, `27'-2"`]);
    for (const m of [A, B]) {
      assert.deepStrictEqual([m.dead, m.live, m.collateral, m.partition], [34, 100, 5, 20], m.id);
      assert.deepStrictEqual(['A', 'B', 'C', 'D'].map(k => ft(m.dims[k].value)), [`13'-5"`, `11'-5"`, `11'-5"`, `9'-10"`], m.id);
      assert.strictEqual(m.dims.joistSpacing.value, null, 'joist spacing TBD / TBD: asked');
      assert.strictEqual(ft(m.dims.seat.value), `0'-2 1/2"`);
      assert.strictEqual(m.checks.material['Light Weight Concrete'], true);
      assert.strictEqual(m.checks.material['Standard Weight Concrete'], false);
      assert.strictEqual(m.checks.use.Office, true);
      assert.deepStrictEqual(Object.keys(m.checks.provided).filter(k => m.checks.provided[k]), ['Auxiliary Columns', 'Support Beams', 'Edge Angle / Pour Stop']);
      assert.deepStrictEqual(Object.keys(m.checks.joists).filter(k => m.checks.joists[k]), ['Welded Joists', 'Welded Bridging']);
    }
    assert.strictEqual(ft(A.dims.E.value), `0'-8"`);
    assert.strictEqual(B.dims.E.requested, 'TBD');
    assert.strictEqual(ft(B.dims.E.value), `8'-0"`, "B's E: TBD requested, 8'-0\" provided");
    assert(pcs.notes.length >= 4 && pcs.notes.some(n => /mezzanine columns per attached floor plan/i.test(n.text)), 'Box 27 notes read');
    await endOcr();
    console.log(`ocr.test: unit checks passed; S1B read by OCR in ${((Date.now() - t0) / 1000).toFixed(0)} s — every checked value matches the pages`);
  })().catch(e => { console.error(e); process.exit(1); });
}
