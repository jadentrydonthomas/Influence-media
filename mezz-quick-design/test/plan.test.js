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
// markup over the plan (PDF annotations): "X" text boxes are mezzanine columns; a line labelled JOISTS, and every line
// of its colour and direction, gives the joist direction; lines of another colour are beam lines
{
  const fx = (x, y) => ({ subtype: 'FreeText', text: 'X', x1: x - 7, x2: x + 7, y1: y - 9, y2: y + 9 });
  const ln = (a, b, color) => ({ subtype: 'Line', text: '', color, line: [a, b], x1: Math.min(a[0], b[0]), x2: Math.max(a[0], b[0]), y1: Math.min(a[1], b[1]), y2: Math.max(a[1], b[1]) });
  const mk = PLAN.readMarkup([fx(345, 334), fx(420, 334), ln([319, 155], [320, 640], [0, 0, 255]), { subtype: 'FreeText', text: 'JOISTS', x1: 303, x2: 321, y1: 354, y2: 398 },
    ln([801, 160], [802, 645], [0, 0, 255]), ln([263, 155], [875, 155], [255, 0, 0]), { subtype: 'FreeText', text: 'MEZZ BEAMS & COLUMNS TYP.', x1: 482, x2: 640, y1: 319, y2: 337 }]);
  assert.deepStrictEqual(mk.crosses.map(c => [c.x, c.y, c.kind, c.markup]), [[345, 334, 'x', true], [420, 334, 'x', true]]);
  assert.deepStrictEqual(mk.arrows.map(a => [Math.round(a.x), a.vert, a.kind]), [[320, true, 'markup'], [802, true, 'markup']], 'both blue lines are joist lines');
  assert.strictEqual(mk.beams.length, 1, 'the red line is a beam line');
  assert.deepStrictEqual(PLAN.readMarkup([ln([10, 10], [10, 300], [0, 0, 255])]).arrows, [], 'a line without a JOISTS note says nothing');
  assert.deepStrictEqual(PLAN.readMarkup(null), { crosses: [], arrows: [], beams: [] });
}
// ⊘ (one diagonal) is a mezzanine column too; a bare circle is not; a "JOIST" arrow with shallow (~15°) half heads reads,
// a shaft with 45° ticks does not
{
  const slash = (cx, cy, r) => [circle(cx, cy, r), seg(cx - r * 0.7, cy + r * 0.7, cx + r * 0.7, cy - r * 0.7)];
  const s = PLAN.readSymbols([...slash(100, 100, 2.5), circle(140, 100, 2.5), ...xMark(180, 100, 2.8, 0)]);
  assert.deepStrictEqual(s.crosses.map(c => [c.kind, Math.round(c.x)]).sort((a, b) => a[1] - b[1]), [['s', 100], ['x', 180]]);
  const arrow = (x, y0, y1, k) => [seg(x, y0, x, y1), seg(x, y0, x - k * 11, y0 + 11), seg(x, y1, x + k * 11, y1 - 11)];   // heads at atan(k)
  assert.strictEqual(PLAN.readArrows([...arrow(300, 100, 180, 0.27)].map(([a, b]) => ({ a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) }))).length, 1, '15° heads');
  assert.strictEqual(PLAN.readArrows([...arrow(300, 100, 180, 1)].map(([a, b]) => ({ a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) }))).length, 0, '45° ticks');
}
const pending = [];
// a drawing sheet set landscape with /Rotate 90: paths are read through the page's viewport transform, as printed; and
// the floor plan is the drawing whose bubbles register to the frame lines — not the vector-only page after it
{
  const OPS = { save: 1, restore: 2, transform: 3, constructPath: 4, moveTo: 5, lineTo: 6, curveTo: 7, curveTo2: 8, curveTo3: 9, closePath: 10, rectangle: 11, beginAnnotation: 12, endAnnotation: 13, paintFormXObjectBegin: 14, paintFormXObjectEnd: 15 };
  const ops = (paths, rot) => ({ fnArray: paths.map(() => OPS.constructPath), argsArray: paths.map(pts => [[OPS.moveTo, ...pts.slice(1).map(() => OPS.lineTo)], pts.flatMap(([x, y]) => (rot ? [y, x] : [x, 612 - y]))]) });
  assert.deepStrictEqual(PLAN.subpaths(ops([seg(10, 20, 30, 20)], true), OPS, [0, 1, 1, 0, 0, 0]), [[[10, 20], [30, 20]]], 'rotated sheet read as printed');
  assert.deepStrictEqual(PLAN.subpaths(ops([seg(10, 20, 30, 20)], false), OPS, 612), [[[10, 20], [30, 20]]], 'a height still works');
  // a 60' x 40' building, frame lines at 0 / 30 / 60, endwall columns at 20': 3 pt a foot, the BSW at page y 280
  const X = x => 100 + 3 * x, Y = y => 400 - 3 * y, bub = (x, y) => circle(x, y, 8, 40);
  const plan = [...[0, 30, 60].flatMap(x => [bub(X(x), Y(40) - 30), bub(X(x), Y(0) + 30)]), ...[0, 20, 40].flatMap(y => [bub(X(0) - 30, Y(y)), bub(X(60) + 30, Y(y))]),
    circle(X(30), Y(20), 2.5), seg(X(30) - 1.75, Y(20) + 1.75, X(30) + 1.75, Y(20) - 1.75), seg(X(15), Y(20) + 3, X(15), Y(40) - 3), seg(X(15), Y(20) + 3, X(15) - 3, Y(20) - 8), seg(X(15), Y(40) - 3, X(15) + 3, Y(40) + 8)];
  const decoy = [...[0, 1, 2, 3, 4, 5].map(i => circle(80 + i * 40, 500, 8, 40)), ...Array.from({ length: 900 }, (_, i) => seg(i % 300, 50 + (i % 7), i % 300 + 2, 52 + (i % 7)))];
  const pad = Array.from({ length: 900 }, (_, i) => seg(600 + (i % 50), 30 + (i % 11), 601 + (i % 50), 31 + (i % 11)));   // stroked text and title block
  const pages = [{ num: 7, items: [], height: 612, vt: [0, 1, 1, 0, 0, 0], ops: ops([...plan, ...pad], true) }, { num: 8, items: [], height: 612, ops: ops(decoy, false) }];
  const grid = { xs: [0, 30, 60], colY: [0, 20, 40], lewY: [0, 20, 40], rewY: [0, 20, 40], width: 40, letterLines: [0, 20, 40] };
  pending.push((async () => {
    const got = await PLAN.findPlan(pages, grid, p => p.ops, OPS);
    assert.ok(got && got.page === 7 && got.reg.ok, got && got.reg.reason);
    assert.deepStrictEqual(got.reg.columns.map(c => [c.kind, Math.round(c.x), Math.round(c.y)]), [['s', 30, 20]]);
    assert.deepStrictEqual(got.reg.arrows.map(a => [a.dir, Math.round(a.x)]), [['y', 15]]);
    // without the rotation the same page does not register (the sheet's bubbles would run the wrong way)
    const flat = await PLAN.findPlan([{ ...pages[0], vt: null }], grid, p => p.ops, OPS);
    assert.ok(!flat.reg.ok);
  })());
}
// the drawing frames an overhanging edge on the line it puts columns on, and the end beams' cantilever loads its columns:
// W2R-26047's 1'-3" past line 4 and 1'-10 13/16" past line C, ⊘ at 2/B, 3/B, 4/B
{
  const C = 52 + 4 / 12, ew = [28, 24 + 4 / 12, 23 + 8 / 12, 26];
  const bw = { width: 102, length: 182, ridge: 51, bays: [31, 30, 30, 30, 30, 31], lewCols: ew, rewCols: ew, frames: [{ from: 1, to: 7, interior: [C, 102 - C] }], fswSoldier: [], bswSoldier: [],
    planCols: [...[31, 61, 91].map(x => sym(x, 76, 's')), ...[0, 31, 61, 91, 121, 151, 182].map(x => sym(x, C, 'star')), ...[31, 61, 91].map(x => sym(x, 100.2, 'I')), sym(1.4, 76, 'I'), sym(1.4, 28, 'I')] };
  const one = (b, extra = {}) => { const m0 = mz('1', 102 - 50.432291666666664 + 0.005208333, 92.25, 0, 50.432291666666664, b);
    return RUN.runJob([{ inp: { ...m0, geom: { ...m0.geom, C: { value: null, source: 'none' } }, mezz: { ...m0.mezz, planJoists: 'y', planRead: { found: true, ok: true }, ...extra } } }]); };
  const j = one(bw), r = j.mezz[0], L = r.layout;
  assert.deepStrictEqual(L.beamLines.map(v => +v.toFixed(3)), [52.333, 76, 102]);
  assert.deepStrictEqual(L.supportLines, [0, 31, 61, 91]);
  assert.deepStrictEqual(j.columns.map(c => c.label), ['2/B', '3/B', '4/B']);
  assert.ok(r.warn.some(w => w.level === 'ok' && /3 ⊘ mezzanine columns in mezzanine 1, at 2\/B, 3\/B, 4\/B — the same as the layout/.test(w.text)));
  assert.ok(r.warn.some(w => /edge 92'-3" from the LEW is framed on the grid line 4 \(91'-0"\) — the slab overhangs it by 1'-3", as the PCS floor plan draws it/.test(w.text)));
  // 4/B: the 61→91 beam on line B, plus its 1'-3" cantilever: R = V (1 + 2a/L (1 + a/2L)); 3/B: plain end shears
  const c4 = j.columns.find(c => c.label === '4/B'), c3 = j.columns.find(c => c.label === '3/B');
  const bB = L.beams.find(b => Math.abs(b.line - 76) < 0.01 && b.to === 91), mkB = r.marks.find(mk => mk.beams.includes(bB.id));
  const V = require('../src/design.js').reactions({ ...r.beamBase, L: bB.span, trib: bB.trib }, mkB.sec), k = 1 + 2 * 1.25 / 30 * (1 + 1.25 / 60);
  assert.ok(Math.abs(c4.DL_L - V.D * k) < 1e-9 && Math.abs(c4.LL_L - V.L * k) < 1e-9, `${c4.DL_L} vs ${V.D * k}`);
  assert.ok(Math.abs(c3.DL_L - V.D) < 1e-9 && Math.abs(c3.DL_R - V.D) < 1e-9);
  // a misread on either side stops the layout: Box 5 without the interior columns (the ✱ say otherwise), a bay list cut short
  const stops = b => one(b).mezz[0].warn.filter(w => w.level === 'stop').map(w => w.text).join('\n');
  assert.match(stops({ ...bw, frames: [{ from: 1, to: 7, interior: [102] }] }), /PCS floor plan shows ✱ interior frame columns at 1\/C, 2\/C, 3\/C, 4\/C, where Box 5 lists no interior column/);
  assert.match(stops({ ...bw, bays: [31, 30, 30, 30, 30] }), /bays of "BLDG 1" .* add to 151'-0", but the building is 182'-0" long/);
  assert.match(stops({ ...bw, frames: bw.frames.map(f => ({ ...f, to: 6 })) }), /Box 5: frame line 7 of "BLDG 1" has no frame row/);
  assert.match(stops({ ...bw, lewCols: [28, 24 + 4 / 12] }), /LEW column spacing of "BLDG 1" .* adds to 52'-4", but the building is 102'-0" wide/);
  assert.match(one(bw, { planRead: { found: true, ok: false, reason: 'letter bubbles do not line up', page: 16 } }).mezz[0].warn.filter(w => w.level === 'stop').map(w => w.text).join(' '), /The PCS floor plan \(page 16\) could not be matched to the building grid/);
  // the drawing's ⊘ against a layout without them (line B lost with the endwall list): a stop that names where they are
  const lost = one({ ...bw, lewCols: [28, 24 + 4 / 12, 49 + 8 / 12], rewCols: [28, 24 + 4 / 12, 49 + 8 / 12] }).mezz[0];
  assert.ok(lost.warn.some(w => w.level === 'stop' && /does not match the PCS drawing's ⊘ mezzanine columns — drawn but not in the layout: 2\/76'-0", 3\/76'-0", 4\/76'-0"/.test(w.text)), lost.warn.map(w => w.text).join('\n'));
}
Promise.all(pending).then(() => console.log('plan tests passed (symbols: lopsided ⊗, ⊘, I, circled I, ✱, joist truss and shallow-headed arrows, marked-up X and JOISTS lines; a rotated sheet; the plan page picked by registration; frame vs mezzanine settled by the drawing; drawn overhangs and their reactions; misreads stop)')).catch(e => { console.error(e); process.exit(1); });
