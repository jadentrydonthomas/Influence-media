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

// A building name that wraps in its table cells — "WAREHOUSE" / "BUILDING" in the spacing table, mid-word "WAREHOUS" /
// "E BUILDING" in the information and roof-load rows (where a short gap also glues it to "Per Seller") — and Box 5's
// head running on into "Cold Formed Materials Allowed on Frame", its block continued on the next page: every table
// still reads the building's own row, and a second building's rows stay its own
{
  const it = (str, x, y) => ({ str, x, y, w: str.length * 3.6, h: 8 });   // ~3.6 pt a character, as pdf.js gives these cells
  const head = [it('PROJECT #:', 361, 35), it('LABEL: 0 - Base', 378, 78), it('CONTROL #: P2', 420, 91)];
  const p3 = { num: 3, annots: [], items: [...head, it('2) BUILDING DESCRIPTION', 28, 121), it('BUILDING INFORMATION', 47, 143),
    it('Building', 38, 158), it('Building Profile', 87, 158), it('Name', 43, 169), it('Width', 165, 169), it('Length', 215, 169),
    it('WAREHOUS', 31, 198.6), it('Gable', 106, 198.6), it(`102'-0"`, 164, 198.6), it(`182'-0"`, 215, 198.6), it(`51'-0"`, 272, 198.6), it(`22'-9"`, 324, 198.6), it(`22'-9"`, 370, 198.6), it('1:12"', 414, 198.6), it('1:12"', 454, 198.6),
    it('E BUILDING', 30, 209.6), it('Symmetrical', 95, 209.6),
    it('SHED', 40, 224.3), it('Lean-To', 102, 224.3), it(`20'-0"`, 166, 224.3), it(`180'-0"`, 215, 224.3), it('N/A', 275, 224.3), it(`18'-0"`, 324, 224.3), it(`20'-0"`, 370, 224.3),
    it('* Unless noted in Special Requirements all structural members are primed.', 28, 237),
    it('SIDEWALL AND ENDWALL SPACING', 47, 337), it('Building Name', 35, 351.6), it('Sidewall Bay Spacing', 108, 351.6), it('FSW Soldier Column', 204, 351.6), it('BSW Soldier Column', 297, 351.6), it('Left Endwall (LEW)', 395, 351.6), it('Right Endwall (REW)', 486, 351.6),
    it('WAREHOUSE', 35, 388.3), it(`1@31'-0", 4@30'-0",`, 111, 388.3), it('N/A', 236, 388.3), it('N/A', 330, 388.3), it(`1@28'-0", 1@24'-4",`, 395, 388.3), it(`1@28'-0", 1@24'-4",`, 489, 388.3),
    it('BUILDING', 46, 399.2), it(`1@31'-0"`, 131, 399.2), it(`1@23'-8", 1@26'-0"`, 396, 399.2), it(`1@23'-8", 1@26'-0"`, 490, 399.2),
    it('SHED', 40, 412), it(`6@30'-0"`, 131, 412), it('N/A', 236, 412), it('N/A', 330, 412), it(`1@20'-0"`, 415, 412), it(`1@20'-0"`, 509, 412),
    it('GIRT CONDITION, DEPTH, AND SPACING', 47, 430), it('3) PROJECT LOAD REQUIREMENTS', 28, 541)] };
  const p4 = { num: 4, annots: [], items: [...head, it('4) BUILDING LOAD REQUIREMENTS', 28, 121),
    it('Building', 38, 150.5), it('Roof Dead Roof Snow', 87, 150.5), it('Wind', 201, 150.5), it('Primary', 305, 150.5), it('Secondary', 350, 150.5), it('Collateral', 406, 150.5),
    it('Name', 43, 161.4), it('Load', 98, 161.4), it('Load', 150, 161.4), it('Collateral Collateral Load Due To', 302, 161.4),
    it('WAREHOUS', 31, 176.2), it('Per Seller', 72, 176.2), it('21.0 psf', 145, 176.2), it('Enclosed', 195, 176.2), it('7.5 psf', 309, 176.2), it('7.5 psf', 358, 176.2), it('Mech/Elec/', 404, 176.2),
    it('E BUILDING', 30, 187.1), it('Std.', 101, 187.1),
    it('SHED', 40, 200), it('Per Seller', 90, 200), it('30.0 psf*', 144, 200), it('5.0 psf', 309, 200), it('6.0 psf', 358, 200),
    it('DEFLECTION REQUIREMENTS (Serviceability Criteria)', 47, 221),
    it('5) FRAME INFORMATION', 28, 454), it('BUILDING NAME: WAREHOUSE BUILDING Cold Formed Materials Allowed on Frame', 47, 487.9),
    it('1 (LEW)', 39, 554.3), it('Rigid Frame Multi Span (Non-Exp) -', 83, 554.3), it('N/A', 233, 554.3), it(`1@52'-4", 1@49'-8"`, 283, 554.3), it('Most', 393, 554.3),
    it('RMG', 139, 565.2), it('Economical', 382, 565.2),
    it('2 - 6', 44, 580), it('Rigid Frame Multi Span - RMG', 93, 580), it('N/A', 233, 580), it(`1@52'-4", 1@49'-8"`, 283, 580), it('Most', 393, 580), it('Economical', 382, 590.9)] };
  const p5 = { num: 5, annots: [], items: [...head, it('5) FRAME INFORMATION (CONTINUED)', 28, 121),
    it('7 (REW)', 38, 150), it('Rigid Frame Multi Span (Non-Exp) -', 83, 150), it('N/A', 233, 150), it(`1@52'-4", 1@49'-8"`, 283, 150), it('Most', 393, 150),
    it('RMG', 139, 161), it('Economical', 382, 161), it('Base Plate Elevations: Negative values are below finish floor.', 28, 175),
    it('BUILDING NAME: SHED Cold Formed Materials Allowed on Frame', 47, 200), it('1 - 7', 44, 230), it('Lean-To Clear Span - LCS', 103, 230), it('N/A', 233, 230), it(`1@20'-0"`, 302, 230),
    it('6) ROOF PANEL', 28, 300)] };
  const p10 = { num: 10, annots: [], items: [...head, it('22) MEZZANINES', 30, 100), it('Mezzanine ID: 1', 33, 120), it('Building Name: WAREHOUSE BUILDING', 176, 120), it('23) CRANES - NONE REQUIRED', 30, 200)] };
  const pages = [p3, p4, p5, p10], r3 = a => a.map(v => +v.toFixed(3));
  const b = PCS.building(pages, 'WAREHOUSE BUILDING');
  assert.deepStrictEqual([b.name, b.width, b.length, b.ridge, b.profile], ['WAREHOUSE BUILDING', 102, 182, 51, 'Gable']);
  assert.deepStrictEqual(b.bays, [31, 30, 30, 30, 30, 31]);
  assert.deepStrictEqual([r3(b.lewCols), r3(b.rewCols)], [[28, 24.333, 23.667, 26], [28, 24.333, 23.667, 26]]);
  const sh = PCS.building(pages, 'SHED');
  assert.deepStrictEqual([sh.name, sh.width, sh.profile, sh.bays, sh.lewCols], ['SHED', 20, 'Lean-To', [30, 30, 30, 30, 30, 30], [20]]);
  const fr = PCS.frames(pages, 'WAREHOUSE BUILDING');
  assert.deepStrictEqual(fr.map(f => [f.from, f.to, f.wall, f.type, r3(f.interior), f.intType]), [
    [1, 1, 'LEW', 'Rigid Frame Multi Span (Non-Exp) - RMG', [52.333, 49.667], 'Most Economical'],
    [2, 6, null, 'Rigid Frame Multi Span - RMG', [52.333, 49.667], 'Most Economical'],
    [7, 7, 'REW', 'Rigid Frame Multi Span (Non-Exp) - RMG', [52.333, 49.667], 'Most Economical']], 'the block read on over the page break');
  assert.deepStrictEqual(PCS.frames(pages, 'SHED').map(f => [f.from, f.to, f.interior]), [[1, 7, [20]]]);
  const rf = PCS.roofLoads(pages, 'WAREHOUSE BUILDING');
  assert.deepStrictEqual([rf.building, rf.dead.perSeller, rf.snow.value, rf.coll1, rf.coll2], ['WAREHOUSE BUILDING', true, 21, 7.5, 7.5], 'name glued to "Per Seller" split off');
  const rs = PCS.roofLoads(pages, 'SHED');
  assert.deepStrictEqual([rs.snow.value, rs.snow.override, rs.coll1, rs.coll2], [30, true, 5, 6]);
  const pcs = PCS.parse(pages);
  assert.deepStrictEqual(Object.keys(pcs.buildings), ['WAREHOUSE BUILDING']);
  assert.deepStrictEqual(pcs.building.bays, [31, 30, 30, 30, 30, 31]);
  assert.strictEqual(pcs.frames.length, 3);
  // lengths read to the PCS's own 1/16"
  assert.strictEqual(PCS.fmtFtIn(52 + 4 / 12 - 50.432291666666664), `1'-10 13/16"`);
  assert.strictEqual(PCS.fmtFtIn(20 + 4.5625 / 12), `20'-4 9/16"`);
  assert.strictEqual(PCS.fmtFtIn(-1e-4), `0'-0"`);
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
  const paths = PLAN.subpaths(ol, loadPdfjs().OPS, planPage.vt || planPage.height);
  const reg = PLAN.registerAndRead(paths, { xs: res.grid.xs, colY: [0, 20, 40, 60] });
  assert.ok(reg.ok, reg.reason);
  assert.strictEqual(reg.columns.length, 4);
  assert.ok(PLAN.compare(reg.columns, res.layout.mezzCols).agree, 'floor plan ⊗ match the layout');
  console.log('pcs tests passed (example job:', res.quote.beams.map(b => b.mark + ' ' + b.section + ' x' + b.qty).join(', '), res.quote.columns[0].section + ')');
})().catch(e => { console.error(e); process.exit(1); });
