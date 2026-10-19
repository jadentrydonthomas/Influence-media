const assert = require('assert');
const LAY = require('../src/layout.js');

// Example job W2H-26018: 60' x 130', bays 2@20, 3@24, 1@18, endwalls 3@20, clear-span frames, ridge 30'.
const bldg = { width: 60, length: 130, ridge: 30, bays: [20, 20, 24, 24, 24, 18], lewCols: [20, 20, 20], rewCols: [20, 20, 20], frames: [{ from: 1, to: 7, interior: [60] }] };
const g = LAY.buildingGrid(bldg);
assert.deepStrictEqual(g.xs, [0, 20, 40, 64, 88, 112, 130]);
// letters over every column line from the BSW, ridge included: A=60, B=40, C=30, D=20, E=0 (matches the drawing)
assert.deepStrictEqual([60, 40, 30, 20, 0].map(g.yLabel), ['A', 'B', 'C', 'D', 'E']);
{
  const L = LAY.layout(g, { length: 40, width: 60, startLEW: 0, startFSW: 0 });
  assert.strictEqual(L.joists, 'y', 'joists span across the width');
  assert.strictEqual(L.beams.length, 8);
  assert.deepStrictEqual(L.beams.map(b => b.trib).sort((a, b) => a - b), [10, 10, 10, 10, 20, 20, 20, 20]);
  assert.ok(L.beams.every(b => b.span === 20));
  assert.deepStrictEqual(L.mezzCols.map(c => c.label).sort(), ['2/B', '2/D', '3/B', '3/D']);
  const marks = LAY.beamMarks(L.beams, 'single');
  assert.strictEqual(marks.length, 1); assert.strictEqual(marks[0].trib, 20); assert.strictEqual(marks[0].beams.length, 8);
  const split = LAY.beamMarks(L.beams, 'split');
  assert.deepStrictEqual(split.map(m => [m.span, m.trib, m.beams.length]), [[20, 20, 4], [20, 10, 4]]);
  // 3/B and 3/D carry a beam on one side only
  const c3 = L.mezzCols.filter(c => c.label.startsWith('3/'));
  assert.ok(c3.every(c => (c.beams.L == null) !== (c.beams.R == null)));
}
// Shorter span direction wins: mezz 40' long x 20' wide at the FSW -> beams run along the 20' direction
{
  const L = LAY.layout(g, { length: 40, width: 20, startLEW: 0, startFSW: 0 });
  // x lines 0,20,40 ; y lines 0,20 -> beams along x: 2 lines x 2 spans (span 20, joists 20); beams along y: 3 lines x 1 span
  assert.ok(L.beams.every(b => b.span <= L.joistSpan + 1e-9));
}
// Multi-span frames: an interior column at 30' on frame 2 is a building column, not a mezz column
{
  const g2 = LAY.buildingGrid({ ...bldg, frames: [{ from: 1, to: 7, interior: [30, 30] }] });
  const L = LAY.layout(g2, { length: 40, width: 60, startLEW: 0, startFSW: 0 }, { joists: 'y', yLines: [0, 20, 30, 40, 60] });
  const at = L.supports.find(s => s.x === 20 && s.y === 30);
  assert.ok(at && at.building, 'interior frame column recognised');
}
// Mezzanine edge off-grid: 30' long -> x = 30 is not a frame line, so every beam-line support there is a mezz column
{
  const L = LAY.layout(g, { length: 30, width: 60, startLEW: 0, startFSW: 0 }, { joists: 'y' });
  const edge = L.supports.filter(s => s.x === 30);
  assert.ok(edge.length === 4 && edge.every(s => !s.building));
}
// the engineer's edits on the Plan page: a column taken out — the beam on that line spans through; a line's first or
// last support is never taken out (no cantilever)
{
  const base = LAY.layout(g, { length: 40, width: 60, startLEW: 0, startFSW: 0 }, { joists: 'y' });
  const L = LAY.layout(g, { length: 40, width: 60, startLEW: 0, startFSW: 0 }, { joists: 'y', drop: ['20.00,20.00', '0.00,40.00'] });
  assert.deepStrictEqual(L.dropped.map(d => d.label), ['2/D']);
  assert.strictEqual(L.beams.length, base.beams.length - 1);
  const through = L.beams.filter(b => b.line === 20);
  assert.deepStrictEqual(through.map(b => [b.from, b.to, b.span]), [[0, 40, 40]]);
  assert.ok(!L.supports.some(s => s.x === 20 && s.y === 20) && L.supports.some(s => s.x === 0 && s.y === 40));
  assert.deepStrictEqual(L.mezzCols.map(c => c.label).sort(), ['2/B', '3/B', '3/D']);
  assert.strictEqual(L.beamSpan, 40);
}
// edges and the PCS drawing (W2R-26047: frames with an interior column at 52'-4", the mezzanine 1'-3" past line 4 and
// 1'-10 13/16" past line C, its back edge 1/16" past the BSW): an edge the drawing puts no column on, up to 3'-0" outside a
// line it does, is framed on that line — the slab overhangs it; an edge short of a line is never moved out to it
{
  const C = 52 + 4 / 12, ew = [28, 24 + 4 / 12, 23 + 8 / 12, 26];
  const gb = LAY.buildingGrid({ width: 102, length: 182, ridge: 51, bays: [31, 30, 30, 30, 30, 31], lewCols: ew, rewCols: ew, frames: [{ from: 1, to: 7, interior: [C, 102 - C] }] });
  const mz = { length: 92.25, width: 102.00520833333333 - 50.432291666666664, startLEW: 0, startFSW: 50.432291666666664 };
  const drawn = [...[31, 61, 91].map(x => ({ x, y: 76 })), ...[0, 31, 61, 91].map(x => ({ x, y: C })), ...[0, 31, 61, 91].map(x => ({ x, y: 102 })), { x: 0, y: 76 }, { x: 0, y: 28 }];
  const L = LAY.layout(gb, mz, { joists: 'y', drawn });
  assert.deepStrictEqual(L.beamLines.map(v => +v.toFixed(3)), [52.333, 76, 102], 'the 1/16" past the BSW is on it; the slab past C is framed on C');
  assert.deepStrictEqual(L.supportLines, [0, 31, 61, 91]);
  assert.deepStrictEqual(L.snaps.map(q => [q.axis, +q.edge.toFixed(3), +q.line.toFixed(3), q.drawn]), [['x', 92.25, 91, true], ['y', 50.432, 52.333, true]]);
  assert.deepStrictEqual(L.mezzCols.map(c => c.label), ['2/B', '3/B', '4/B']);
  // the end beams carry the 1'-3" past line 4 to it (and nothing past line 1); the line-C beams take the 1'-10 13/16"
  assert.ok(L.beams.every(b => b.ov[0] === 0 && b.ov[1] === (b.to === 91 ? 1.25 : 0)));
  assert.ok(L.beams.filter(b => Math.abs(b.line - C) < 0.01).every(b => Math.abs(b.trib - ((76 - C) / 2 + (C - mz.startFSW))) < 0.001));
  // without the drawing (1'-0" rule): both edges are beam / column lines of their own, on new columns
  const N = LAY.layout(gb, mz, { joists: 'y' });
  assert.ok(N.supportLines.includes(92.25) && N.beamLines.some(v => Math.abs(v - 50.432) < 0.01));
  // the slab stopping 2'-1" short of line A stays short: its edge is a beam line on new columns
  const S = LAY.layout(gb, { ...mz, width: 49.5 }, { joists: 'y', drawn });
  assert.ok(S.beamLines.some(v => Math.abs(v - 99.932) < 0.01) && !S.beamLines.some(v => Math.abs(v - 102) < 0.01));
}
console.log('layout tests passed');
