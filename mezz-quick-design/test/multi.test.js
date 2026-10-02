// Several mezzanines in one job: shared beam lines, shared columns, joist arrows and grid letters off the drawing.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const RUN = require('../src/run.js');

const close = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

// equivalent uniform trib: full-length extra adds straight; a partial one keeps max moment and end shear
close(RUN.equivTrib(28, 12 + 4 / 12, [{ s: 0, e: 28, trib: 7 + 8 / 12 }]), 20, 1e-9, 'full overlap');
{
  const t = RUN.equivTrib(28, 12 + 4 / 12, [{ s: 0, e: 12 + 4 / 12, trib: 7 + 8 / 12 }]);
  // left reaction (unit load): (12.333·28·14 + 7.667·12.333·(28 − 6.167)) / 28 = 246.4 → 2R/L = 17.60 → 17'-8"
  close(t, 17 + 8 / 12, 1e-9, 'partial overlap rounds up to the inch');
}
close(RUN.equivTrib(20, 10, []), 10, 1e-9, 'no extras');

// a building like the example job: 60' x 130', bays 2@20, 3@24, 1@18, endwalls 3@20
const v = (value, source = 'pcs') => ({ value, source });
function inputs(id, geom, loads = {}) {
  return {
    job: { quote: 'TEST', project: 'multi', division: 'NBS-IN', code: { family: 'AISC', edition: '15', spec: 'AISC 360-16' } },
    mezz: { id, building: 'MAIN', material: 'Standard Weight Concrete', concrete: 'NW', deck: '1.0C', provided: {}, planJoists: geom.joists || null },
    loads: { dead: v(loads.dead ?? 43), coll: v(5), live: v(loads.live ?? 125), partition: v(0), joistWt: v(8, 'default') },
    geom: { width: v(geom.width), length: v(geom.length), startLEW: v(geom.lew || 0), startFSW: v(geom.fsw || 0), slab: v(4 / 12), A: v(geom.A ?? 12), B: v(10 + 2 / 12), C: { value: null, source: 'none' }, joistSpacing: v(4), seat: v(5 / 12) },
    building: { width: 60, length: 130, ridge: 30, bays: [20, 20, 24, 24, 24, 18], lewCols: [20, 20, 20], rewCols: [20, 20, 20], frames: [{ from: 1, to: 7, interior: [60] }], fswSoldier: [], bswSoldier: [] },
  };
}

// 1. side by side along the length, sharing the support line at x = 40: one column there, both reactions
{
  const A = inputs('A', { width: 60, length: 40, joists: 'y' }), B = inputs('B', { width: 60, length: 24, lew: 40, joists: 'y' });
  const job = RUN.runJob([{ inp: A }, { inp: B }]);
  const [ra, rb] = job.mezz;
  assert.strictEqual(ra.layout.joists, 'y'); assert.strictEqual(rb.layout.joists, 'y');
  const shared = job.columns.filter(c => c.shared);
  assert.deepStrictEqual(shared.map(c => c.label).sort(), ['3/B', '3/D'], 'columns on the common line are shared');
  shared.forEach(c => {
    assert.strictEqual(c.parts.length, 2);
    assert.deepStrictEqual(c.parts.map(p => p.mezz).sort(), ['A', 'B']);
    const left = c.parts.find(p => p.sheetSide === 'left'), right = c.parts.find(p => p.sheetSide === 'right');
    close(c.DL_L, left.D, 1e-9); close(c.LL_L, left.L, 1e-9); close(c.DL_R, right.D, 1e-9); close(c.LL_R, right.L, 1e-9);
  });
  // counted once over the job
  const total = job.mezz.reduce((a, r) => a + r.columns.length, 0);
  assert.strictEqual(total, job.columns.length);
  assert.ok(shared.every(c => job.mezz[c.owner].columns.includes(c)));
  assert.ok(shared.every(c => job.mezz[1 - c.owner].foreignCols.some(f => f.label === c.label)));
  // the single-mezzanine run of A alone sees one side only — the job run must be heavier at the shared columns
  const alone = RUN.run(inputs('A', { width: 60, length: 40, joists: 'y' }), {});
  const a3b = alone.columns.find(c => c.label === '3/B'), j3b = shared.find(c => c.label === '3/B');
  assert.ok(j3b.DL_L + j3b.DL_R > a3b.DL_L + a3b.DL_R + 1, 'shared column carries both mezzanines');
  assert.ok(job.mezz.every(r => r.colFinal && r.colFinal.ok));
  const q = RUN.quoteJob(job.mezz, [A, B]);
  assert.deepStrictEqual(q.design.map(r => r.MEZZ), ['A', 'B']);
  assert.strictEqual(q.columns.reduce((a, r) => a + r.QTY, 0), job.columns.length);
}

// 2. stacked across the width, sharing the beam line at y = 40: one beam, both tribs; B's edge beams drop out
{
  const A = inputs('A', { width: 40, length: 40, joists: 'y' }), B = inputs('B', { width: 20, length: 40, fsw: 40, joists: 'y' });
  const job = RUN.runJob([{ inp: A }, { inp: B }]);
  const [ra, rb] = job.mezz;
  const onLine = (r, y) => r.layout.beams.filter(b => Math.abs(b.line - y) < 1e-6);
  const aEdge = onLine(ra, 40), bEdge = onLine(rb, 40);
  assert.ok(aEdge.length === 2 && bEdge.length === 2);
  assert.ok(bEdge.every(b => b.absorbed && b.absorbed.mezz === 'A'), "B's edge beams are A's beams");
  aEdge.forEach(b => { close(b.tribOwn, 10, 1e-9); close(b.trib, 20, 1e-9, 'A edge trib = 10 + 10'); });
  assert.strictEqual(ra.marks[0].trib, 20);
  assert.strictEqual(rb.marks.reduce((a, m) => a + m.qty, 0), 2, 'B keeps only its own line (y = 60)');
  // columns on y = 40 belong to A (B has no beam there any more)
  assert.ok(job.columns.filter(c => Math.abs(c.y - 40) < 1e-6).every(c => c.owner === 0 && !c.shared));
  // same loads → the merged load is exact; heavier B loads scale B's trib up (conservative)
  const B2 = inputs('B', { width: 20, length: 40, fsw: 40, joists: 'y' }, { live: 250 });
  const j2 = RUN.runJob([{ inp: inputs('A', { width: 40, length: 40, joists: 'y' }) }, { inp: B2 }]);
  onLine(j2.mezz[0], 40).forEach(b => close(b.trib, 10 + 10 * (250 / 125), 1e-9, 'scaled by the live-load ratio'));
}

// 3. one mezzanine alone gives exactly what run() gives
{
  const a = RUN.run(inputs('A', { width: 60, length: 40 }), {}), j = RUN.runJob([{ inp: inputs('A', { width: 60, length: 40 }) }]).mezz[0];
  assert.deepStrictEqual(j.quote, a.quote);
}

// 4. the two-mezzanine PCS (W0S-26160) when it is present locally
const pdf = process.env.MZ_PCS2 || path.join(__dirname, '..', 'private', 'pcs', 'PCS_job2.pdf');
let pdfjsOK = true;
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { pdfjsOK = false; }
if (!fs.existsSync(pdf) || !pdfjsOK) { console.log('multi tests passed (two-mezzanine PCS not present, PDF test skipped)'); process.exit(0); }
(async () => {
  const PCS = require('../src/pcs.js'), PLAN = require('../src/plan.js'), LAYOUT = require('../src/layout.js');
  const { readPcs, loadPdfjs } = require('./pdf-node.js');
  const pages = await readPcs(pdf);
  const pcs = PCS.parse(pages);
  assert.deepStrictEqual(pcs.mezzanines.map(m => m.id), ['BSW', 'LEW']);
  assert.deepStrictEqual(pcs.building.bays, [28, 28, 28, 28, 28], 'lean-to row not mixed in');
  assert.deepStrictEqual(pcs.building.lewCols, [20, 20, 20, 20, 16, 24]);
  assert.strictEqual(pcs.code.edition, '15'); assert.ok(pcs.code.state && /Massachusetts 10th/.test(pcs.code.note), 'MA 10th Ed. → IBC 2021');
  const g = LAYOUT.buildingGrid({ ...pcs.building, frames: pcs.frames });
  const p = pages[pages.length - 1];
  const reg = PLAN.registerAndRead(PLAN.subpaths(await p._page.getOperatorList(), loadPdfjs().OPS, p.height),
    { xs: g.xs, colY: [...new Set([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()])], lewY: g.lewY, rewY: g.rewY, width: g.width, letterLines: g.allY });
  assert.ok(reg.ok, reg.reason);
  assert.strictEqual(reg.letters.map(l => l.letter).join(''), 'ABCDEFGHJK', 'letters as drawn (I skipped)');
  assert.strictEqual(reg.columns.length, 7); assert.ok(reg.columns.every(c => c.kind === 'i'), 'circled-I symbols');
  RUN.applyPlan(pcs, reg);
  assert.deepStrictEqual(pcs.mezzanines.map(m => m.planJoists), ['y', 'y'], 'Mez. Jst. arrows: joists across the width');
  const inps = pcs.mezzanines.map((m, i) => RUN.inputsFromPCS(pcs, i));
  // B, joist spacing and seat are TBD with no blue note: nothing is assumed, the run asks for them
  const first = RUN.runJob(inps.map(inp => ({ inp, settings: {} })));
  first.mezz.forEach(r => {
    assert.ok(r.incomplete, 'stops on the open values');
    assert.deepStrictEqual(r.need.map(n => n.path).sort(), ['geom.B', 'geom.C', 'geom.joistSpacing', 'geom.seat']);
  });
  // with (C) = 9'-0" every beam must fit A − C − slab − seat = 138 − 108 − 5 − 5 = 20"
  {
    const ins = pcs.mezzanines.map((m, i) => RUN.inputsFromPCS(pcs, i));
    ins.forEach(inp => { inp.geom.B = { value: 9, source: 'manual' }; inp.geom.C = { value: 9, source: 'manual' }; inp.geom.seat = { value: 5 / 12, source: 'manual' }; inp.geom.joistSpacing = { value: 4, source: 'manual' }; });
    const jc = RUN.runJob(ins.map(inp => ({ inp, settings: {} })));
    jc.mezz.forEach(r => {
      assert.ok(!r.incomplete);
      assert.strictEqual(r.maxDepthByC, 20);
      r.marks.forEach(mk => { assert.ok(mk.sec && mk.sec.d <= 20, `${r.id} ${mk.desc} within the C limit`); assert.ok(mk.options.every(o => o.pick.sec.d <= 20), 'every option within C'); });
      assert.ok(r.clear.C.ok, 'C provided ≥ requested');
    });
    console.log('  C = 9\'-0":', jc.mezz.map(r => `${r.id} ${r.marks.map(m => m.desc).join('/')} (${r.marks[0].options.map(o => o.key + ' ' + o.pick.desc).join(', ')})`).join(' · '));
  }
  // the quote engineer's entries (as on this job): B = 9'-0" (conservative headroom), seat 5", joists @ 4'-0"
  inps.forEach(inp => { inp.geom.B = { value: 9, source: 'manual' }; inp.geom.C = { value: null, source: 'none' }; inp.geom.seat = { value: 5 / 12, source: 'manual' }; inp.geom.joistSpacing = { value: 4, source: 'manual' }; });
  const job = RUN.runJob(inps.map(inp => ({ inp, settings: {} })));
  job.mezz.forEach(r => close(r.joistDepthIn, 20, 1e-9, "11'-6\" − 9'-0\" − 5\" − 5\" = 20\""));
  const [bsw, lew] = job.mezz;
  // one holistic set of beam marks over the job:
  //   interior = more trib than any edge beam: BSW line C (carries LEW's 7'-8" edge too) and LEW line D (18'-0") → 20'-0"
  //   exterior = edge beams with joists on one side: the largest is BSW line C east of LEW, 12'-4" → every edge beam
  const [mb1, mb2] = job.marks;
  assert.strictEqual(job.marks.length, 2);
  assert.deepStrictEqual([mb1.mark, mb1.kind, mb1.desc, mb1.qtyAll], ['MB1', 'interior', 'BU28x50', 4]);
  assert.deepStrictEqual([mb2.mark, mb2.kind, mb2.desc, mb2.qtyAll], ['MB2', 'exterior', 'BU26x36', 10]);
  close(mb1.span, 28, 1e-9); close(mb1.trib, 20, 1e-9); close(mb2.span, 28, 1e-9); close(mb2.trib, 12.333, 1e-9);   // layout lengths are to 0.001 ft, as typed on the MB sheet
  const who = m => m.beamsAll.map(x => `${job.mezz[x.mi].id} B${x.id + 1}`);
  assert.deepStrictEqual(who(mb1), ['BSW B1', 'BSW B2', 'LEW B3', 'LEW B4']);
  assert.deepStrictEqual(who(mb2), ['BSW B3', 'BSW B4', 'BSW B5', 'BSW B6', 'BSW B7', 'BSW B8', 'BSW B9', 'BSW B10', 'LEW B1', 'LEW B2']);
  // shorter members keep the section and get their own MB-sheet run: 40'-4" − 28'-0" = 12'-4"
  assert.deepStrictEqual(mb1.spanRuns.map(r => [+r.span.toFixed(3), r.qty]), [[28, 3], [12.333, 1]]);
  assert.deepStrictEqual(mb2.spanRuns.map(r => [+r.span.toFixed(3), r.qty]), [[28, 9], [12.333, 1]]);
  [mb1, mb2].forEach(m => m.spanRuns.forEach(r => {
    const c = r.check;
    assert.strictEqual(c.desc, m.desc); close(r.params.trib, m.trib, 1e-9); close(r.params.L, r.span, 1e-9);
    assert.ok(c.res.CSR <= 0.99 && c.res.SRvx <= 0.99 && c.llOK && c.tlOK, `${m.mark} at ${r.span}`);
  }));
  // each mezzanine sees its share of the job marks
  assert.deepStrictEqual(bsw.marks.map(m => [m.mark, m.qty]), [['MB1', 2], ['MB2', 8]]);
  assert.deepStrictEqual(lew.marks.map(m => [m.mark, m.qty]), [['MB1', 2], ['MB2', 2]]);
  // one governing mark when asked: all 14 beams at 28'-0" × 20'-0"
  {
    const one = RUN.runJob(inps.map(inp => ({ inp, settings: { marks: 'single' } })));
    assert.deepStrictEqual(one.marks.map(m => [m.desc, m.qtyAll, m.spanRuns.map(r => r.qty)]), [['BU28x50', 14, [12, 2]]]);
  }
  assert.deepStrictEqual(bsw.columns.map(c => c.label).sort(), ['2/C', '3/C', '4/C', '5/C']);
  assert.deepStrictEqual(lew.columns.map(c => c.label).sort(), ['2/D', `40'-4"/D`, `40'-4"/E`]);
  assert.strictEqual(bsw.colFinal.quoteAs, 'W8X24'); assert.strictEqual(lew.colFinal.quoteAs, 'W8X24');
  const c2 = bsw.columns.find(c => c.label === '2/C');
  close(c2.DL_L, 19.74, 0.005); close(c2.LL_L, 36.4, 0.005); close(c2.DL_R, 17.52, 0.005); close(c2.LL_R, 32.15, 0.005);
  const cmp = PLAN.compare(reg.columns, job.columns);
  assert.ok(cmp.agree, 'floor plan columns match the job layout');
  const q = RUN.quoteJob(job.mezz, inps);
  // quote rows: one per mark and member length, one per column section and height — the whole job
  assert.deepStrictEqual(q.beams.map(r => [r.MEZZ, r.SPAN, r.TRIB, r.SECTION, r.QTY]), [
    ['BSW / LEW', 28, 20, 'BU28x50', 3], ['LEW', 12.333, 20, 'BU28x50', 1],
    ['BSW / LEW', 28, 12.333, 'BU26x36', 9], ['LEW', 12.333, 12.333, 'BU26x36', 1]]);
  assert.ok(/^MB1 interior: BSW B1, B2 \(line C\); LEW B3 \(line D\)/.test(q.beams[0].NOTES), q.beams[0].NOTES);
  assert.ok(/shorter span — same section, MB sheet at 12'-4"/.test(q.beams[1].NOTES), q.beams[1].NOTES);
  assert.deepStrictEqual(q.columns.map(r => [r.MEZZ, r.SECTION, r.QTY]), [['BSW / LEW', 'W8X24', 7]]);
  console.log('multi tests passed (W0S-26160: MB1 interior BU28x50 ×4 (3 @ 28\' + 1 @ 12\'-4"), MB2 exterior BU26x36 ×10 (9 + 1), W8X24 ×7, 7/7 columns on the drawing)');
})().catch(e => { console.error(e); process.exit(1); });
