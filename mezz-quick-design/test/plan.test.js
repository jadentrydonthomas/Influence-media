// Floor-plan symbols: ⊗ / circled-I (mezzanine column), bare I and ✱ (frame columns), the joist truss symbol —
// and the floor plan settling frame vs mezzanine column where the building data disagrees.
const assert = require('assert');
const PLAN = require('../src/plan.js');
const RUN = require('../src/run.js');

// --- drawing primitives in page points
const seg = (x1, y1, x2, y2) => [[x1, y1], [x2, y2]];
const circle = (cx, cy, r, n = 34, skew = 0) => { const p = []; for (let i = 0; i <= n; i++) { const t = (i / n) * 2 * Math.PI; p.push([cx + r * Math.cos(t) + (Math.cos(t) > 0 ? skew : 0), cy + r * Math.sin(t)]); } return p; };
const xMark = (cx, cy, r, skew) => [circle(cx, cy, r, 34, skew), seg(cx - r * 0.75, cy - r * 0.5, cx + r * 0.75, cy + r * 0.5), seg(cx + r * 0.75, cy - r * 0.5, cx - r * 0.75, cy + r * 0.5)];
const iShape = (cx, cy, h, w) => [seg(cx, cy - h / 2, cx, cy + h / 2), seg(cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2), seg(cx - w / 2, cy + h / 2, cx + w / 2, cy + h / 2)];
const star = (cx, cy, s) => [seg(cx - s * 0.36, cy - s / 2, cx + s * 0.36, cy + s / 2), seg(cx - s * 0.36, cy + s / 2, cx + s * 0.36, cy - s / 2), seg(cx - s * 0.36, cy, cx + s * 0.36, cy), seg(cx, cy - s / 2, cx, cy + s / 2)];
const truss = (x0, y0, len, n) => { const out = [seg(x0, y0, x0 + len, y0)], w = len / n; for (let i = 0; i < n; i++) out.push(seg(x0 + i * w, y0 + 0.4, x0 + (i + 0.5) * w, y0 + 3.5), seg(x0 + (i + 0.5) * w, y0 + 3.5, x0 + (i + 1) * w, y0 + 0.4)); return out; };

// a lopsided ⊗ (its vertices bunched to one side — the 5/B symbol on W1S-26062) is still a mezzanine column
{
  const s = PLAN.readSymbols([...xMark(100, 100, 2.8, 0.45), ...xMark(150, 100, 2.8, 0)]);
  assert.deepStrictEqual(s.crosses.map(c => c.kind), ['x', 'x'], 'both ⊗ read');
}
// bare I = frame column; the same I inside a circle = mezzanine column; ✱ = Most Economical frame column
{
  const s = PLAN.readSymbols([...iShape(50, 50, 5.9, 2.7), circle(80, 50, 4), ...iShape(80, 50, 4, 2.7), ...star(110, 50, 5.6)]);
  assert.deepStrictEqual(s.crosses.map(c => c.kind), ['i'], 'circled I is a mezzanine column');
  assert.deepStrictEqual(s.frameCols.map(c => c.kind).sort(), ['I', 'star']);
  assert.ok(Math.abs(s.frameCols.find(c => c.kind === 'star').x - 110) < 0.1);
}
// the joist truss symbol reads as a joist direction; a lone zigzag hatch along a line does not need to
{
  const s = PLAN.readSymbols([...truss(200, 300, 60, 6), ...truss(400, 200, 40, 5).map(p => p.map(([x, y]) => [y, x]))]);
  const t = s.arrows.filter(a => a.kind === 'truss');
  assert.deepStrictEqual(t.map(a => a.vert).sort(), [false, true]);
  const noZig = PLAN.readSymbols([seg(0, 0, 60, 0), ...Array.from({ length: 6 }, (_, i) => seg(i * 10, 1, i * 10 + 4, 4))]);   // all one slope
  assert.strictEqual(noZig.arrows.filter(a => a.kind === 'truss').length, 0);
}

// --- the floor plan settles frame vs mezzanine column (the job of the drawing: Mezz 1 / Mezz 2, 140' x 120')
const v = (value, source = 'pcs') => ({ value, source });
const bldg = (frames, planCols) => ({ width: 120, length: 140, ridge: 60, bays: [28, 28, 28, 28, 28], lewCols: [20, 20, 20, 20, 16, 24], rewCols: [20, 20, 20, 18, 18, 24], frames, fswSoldier: [], bswSoldier: [], planCols });
const mz = (id, width, length, lew, fsw, b) => ({
  job: { quote: 'T', division: 'NBS-IN', code: { family: 'AISC', edition: '15', spec: 'AISC 360-16' } },
  mezz: { id, building: 'BLDG 1', material: 'Standard Weight Concrete', concrete: 'NW', deck: '1.0C', provided: {}, planJoists: 'x' },
  loads: { dead: v(43), coll: v(5), live: v(125), partition: v(0), joistWt: v(8, 'default') },
  geom: { width: v(width), length: v(length), startLEW: v(lew), startFSW: v(fsw), slab: v(4 / 12), A: v(11.5), B: v(9.5), C: v(9.5), joistSpacing: v(4), seat: v(5 / 12) },
  building: b });
const job = (frames, planCols) => RUN.runJob([{ inp: mz('Mezz 1', 24, 140, 0, 96, bldg(frames, planCols)) }, { inp: mz('Mezz 2', 36, 40, 0, 60, bldg(frames, planCols)) }]);
const rigid = [{ from: 1, to: 1, wall: 'LEW', interior: [60, 60] }, { from: 2, to: 5, interior: [60, 60] }, { from: 6, to: 6, wall: 'REW', interior: [60, 60] }];
const DRAWN = ['2/B', '2/C', '3/B', '4/B', '40\'-0"/B', '40\'-0"/C', '40\'-0"/E', '5/B'];
const sym = (x, y, kind) => ({ x, y, kind });
const onDrawing = [sym(28, 96, 'x'), sym(40, 96, 'x'), sym(56, 96, 'x'), sym(84, 96, 'x'), sym(112, 96, 'x'), sym(28, 80, 'x'), sym(40, 80, 'x'), sym(40, 60, 'x'),
  sym(28.1, 60, 'I'), sym(56, 60, 'star'), sym(84, 60, 'star'), sym(112, 60, 'star'), sym(138.7, 60, 'star'), sym(1.6, 96, 'I'), sym(28.2, 118.2, 'I')];
const mezzCols = j => j.columns.map(c => c.label).sort();
{
  // building data and drawing agree: the eight ⊗, 2/E a frame column, no override
  const j = job(rigid, onDrawing);
  assert.deepStrictEqual(mezzCols(j), DRAWN.slice().sort());
  assert.ok(!j.mezz.some(r => r.warn.some(w => /PCS floor plan shows a (frame|mezzanine) column/.test(w.text))));
  assert.strictEqual(j.frameLoads.find(f => f.label === '2/E').planKind, 'I');
  // REW columns (78') never make a support line in a mezzanine at the LEW end
  assert.ok(!j.mezz[1].layout.supportLines.includes(78));
}
{
  // frame 2's interior columns misread as the LEW endwall's (80', 96'): the ⊗ on the drawing put them back as mezzanine columns
  const bad = [{ from: 1, to: 1, wall: 'LEW', interior: [60, 60] }, { from: 2, to: 2, interior: [20, 20, 20, 20, 16, 24] }, { from: 3, to: 5, interior: [60, 60] }, { from: 6, to: 6, wall: 'REW', interior: [60, 60] }];
  const off = job(bad, null);
  assert.ok(!mezzCols(off).includes('2/B') && !mezzCols(off).includes('2/C'), 'without the drawing they would be frame columns');
  const on = job(bad, onDrawing);
  assert.deepStrictEqual(mezzCols(on), DRAWN.slice().sort());
  assert.ok(on.mezz.some(r => r.warn.some(w => /^2\/B: the PCS floor plan shows a mezzanine column/.test(w.text))));
}
{
  // Box 5 without the ridge columns: 2/E would be a mezzanine column — the I on the drawing makes it a frame column
  const noRidge = [{ from: 1, to: 6, interior: [] }];
  assert.ok(mezzCols(job(noRidge, null)).includes('2/E'));
  const on = job(noRidge, onDrawing);
  assert.ok(!mezzCols(on).includes('2/E'));
  assert.ok(on.mezz[1].warn.some(w => /^2\/E: the PCS floor plan shows a frame column there \(I\)/.test(w.text)));
}
{
  // an I drawn on a wall line never turns a mezzanine column into a frame column (opening marks read as I's)
  const j = job(rigid, onDrawing.concat([sym(40.2, 118.2, 'I')]));
  assert.deepStrictEqual(mezzCols(j), DRAWN.slice().sort());
}
console.log('plan tests passed (symbols: lopsided ⊗, I, circled I, ✱, joist truss; frame vs mezzanine settled by the drawing)');
