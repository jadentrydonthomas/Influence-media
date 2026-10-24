// Point loads on a mezzanine: typed lengths read leniently, the loads a PCS note gives, a beam designed for one at an
// equivalent uniform trib, and every kip of it reaching the columns by statics.
const assert = require('assert');
const RUN = require('../src/run.js');
const PCS = require('../src/pcs.js');

const close = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const F = PCS.fmtFtIn;

// 1. a length as typed in a hurry: all of these are 20'-3 1/2"
['20-3/2', '20-3-1/2', '20 3 1/2', '20 3.5', '20-3.5', `20'-3 1/2"`, `20' 3.5"`, '20 - 3 - 1/2', '20’-3 1/2”'].forEach(t => assert.strictEqual(F(PCS.typedLen(t)), `20'-3 1/2"`, t));
assert.strictEqual(F(PCS.typedLen('20ft 3in')), `20'-3"`);
assert.strictEqual(F(PCS.typedLen('20.25')), `20'-3"`, 'a bare number is feet');
assert.strictEqual(F(PCS.typedLen('20-3/4')), `20'-0 3/4"`, 'a proper fraction is that fraction of an inch');
assert.strictEqual(F(PCS.typedLen('20-5/4')), `20'-5 1/4"`, 'over its own denominator: the inches and that part');
assert.strictEqual(F(PCS.typedLen('16"')), `1'-4"`);
assert.strictEqual(F(PCS.typedLen('3/2', 'in')), `0'-3 1/2"`, 'an inch box: 3/2 is 3 1/2"');
assert.strictEqual(F(PCS.typedLen('5/8', 'in')), `0'-0 5/8"`);
['abc', '1/2', '20-3-5/4', '-4', ''].forEach(t => assert.strictEqual(PCS.typedLen(t), null, t));

// 2. the loads a note gives: what, how much, where; a door's hanging weight is not the floor's
const np = RUN.notePoints([
  { n: 6, page: 11, text: 'Design edge of mezzanine for support of 2000# stair located at frame line 3. Nucor has reviewed your specifications.' },
  { n: 3, page: 13, text: 'Provide support for (2) 250# underhung point loads for interior fans located 30\' from FSW.' },
  { n: 7, page: 24, text: 'Loads approximate the grids of 5,000lb. collateral point loads. The grid systems have been designed as an 8\'x8\' grid with a 5kip load between each beam span.' },
  { n: 21, page: 3, text: 'The 20 x 14 roll-up door framed opening has been designed to support a total hanging dead weight of 2800 #.' },
]);
assert.deepStrictEqual(np.map(q => [q.n, q.P, q.count, q.what, q.frameLine, q.edge, q.grid && `${q.grid.sx}x${q.grid.sy}`]), [
  [6, 2, 1, 'stair', 3, true, null], [3, 0.25, 2, 'point load', null, false, null], [7, 5, 1, 'point load', null, false, '8x8']]);

// 3. the equivalent trib: a 1 k load at the middle of a 24' beam with 28' of floor at 125 psf live (8 sq ft of that floor)
close(RUN.equivTribPoints(24, 28, [{ a: 12, A: 8 }]), Math.ceil((28 + 8 * 24 / 4 * 8 / 24 / 24) * 12 - 1e-6) / 12, 1e-9, 'M = wL²/8 + PL/4');
close(RUN.equivTribPoints(24, 28, []), 28, 1e-9, 'no point: the floor');
// near an end the end shear governs: 2R/L
close(RUN.equivTribPoints(20, 0, [{ a: 1, A: 100 }]), Math.ceil(2 * (100 * 19 / 20) / 20 * 12 - 1e-6) / 12, 1e-9, 'end shear');

// 4. a job (60' × 130' building, one mezzanine): a 4 k live load on a beam and a 3 k dead load on the floor between two beam
//    lines — every kip of both reaches the columns and the frames, by statics; the loaded beams are a mark of their own
//    after the others (the marks there before keep their names)
const v = (value, source = 'pcs') => ({ value, source });
const inp = () => ({
  job: { quote: 'TEST', project: 'points', division: 'NBS-IN', code: { family: 'AISC', edition: '15', spec: 'AISC 360-16' } },
  mezz: { id: 'A', building: 'MAIN', material: 'Standard Weight Concrete', concrete: 'NW', deck: '1.0C', provided: {}, planJoists: 'y' },
  loads: { dead: v(43), coll: v(5), live: v(125), partition: v(0), joistWt: v(8, 'default') },
  geom: { width: v(60), length: v(40), startLEW: v(0), startFSW: v(0), slab: v(4 / 12), A: v(14), B: v(10 + 2 / 12), C: { value: null, source: 'none' }, joistSpacing: v(4), seat: v(5 / 12) },
  building: { width: 60, length: 130, ridge: 30, bays: [20, 20, 24, 24, 24, 18], lewCols: [20, 20, 20], rewCols: [20, 20, 20], frames: [{ from: 1, to: 7, interior: [60] }], fswSoldier: [], bswSoldier: [] },
});
const totals = job => {
  const cols = job.mezz.reduce((a, r) => a + r.columns.reduce((c, q) => c + q.DL_L + q.DL_R, 0), 0) + job.columns.frame.reduce((a, q) => a + q.D, 0);
  const live = job.mezz.reduce((a, r) => a + r.columns.reduce((c, q) => c + q.LL_L + q.LL_R, 0), 0) + job.columns.frame.reduce((a, q) => a + q.L, 0);
  return { D: cols, L: live };
};
const j0 = RUN.runJob([{ inp: inp() }]), m0 = j0.mezz[0], L0 = m0.layout;
assert.strictEqual(L0.joists, 'y');
const bl = L0.beamLines, b = L0.beams.find(x => !x.edge && x.span > 15);
const pts = [{ x: (b.from + b.to) / 2, y: b.line, P: 4, kind: 'L', what: 'equipment' }, { x: (b.from + b.to) / 2, y: bl[1] + (bl[2] - bl[1]) / 4, P: 3, kind: 'D', what: 'tank' }];
const j1 = RUN.runJob([{ inp: inp(), settings: { pointLoads: pts } }]), m1 = j1.mezz[0];
const t0 = totals(j0), t1 = totals(j1);
assert.ok([t0.D, t0.L, t1.D, t1.L].every(isFinite), 'every column has its loads');
close(t1.L - t0.L, 4, 1e-6, 'the 4 k live reaches the columns once');
// the dead total moves by the 3 k and by the heavier sections the loaded beams now take (their own weight)
const selfW = j => j.mezz[0].layout.beams.reduce((a, x) => { const mk = j.mezz[0].marks.find(q => q.beams.includes(x.id)); return a + (mk && mk.sec ? require('../src/design.js').reactions({ ...j.mezz[0].beamBase, L: x.span, trib: 0 }, mk.sec).D * 2 : 0); }, 0);
close(t1.D - t0.D, 3 + selfW(j1) - selfW(j0), 1e-6, 'the 3 k dead reaches the columns once');
const lp = m1.layout.pointLoads;
assert.strictEqual(lp.length, 2);
assert.deepStrictEqual(lp[0].on.map(o => [o.beam, o.k]), [[b.id, 1]], 'on the beam: all of it');
assert.deepStrictEqual(lp[1].on.map(o => +o.k.toFixed(3)), [0.75, 0.25], 'on the floor a quarter of the way: 3/4 and 1/4 by the joists');
const loaded = m1.layout.beams.filter(x => x.pts);
assert.ok(loaded.every(x => x.trib > x.tribNoPts), 'the loaded beams take a larger equivalent trib');
const mk = m1.marks.find(q => q.kind === 'point load');
assert.ok(mk && loaded.every(x => mk.beams.includes(x.id)), 'a mark of their own');
assert.deepStrictEqual(m0.marks.map(q => q.mark), m1.marks.filter(q => q.kind !== 'point load').map(q => q.mark), 'the other marks keep their names');
assert.ok(m1.warn.some(w => /equipment 4\.00 k \(live\) .* on beam B\d+/.test(w.text)) && m1.warn.some(w => /tank 3\.00 k \(dead\) .* the joists take it to B\d+ \(75 %\) and B\d+ \(25 %\)/.test(w.text)));
// off the mezzanine: left out, said so
const j2 = RUN.runJob([{ inp: inp(), settings: { pointLoads: [{ x: 100, y: 30, P: 2, kind: 'L' }] } }]);
assert.ok(j2.mezz[0].layout.pointLoads[0].on.length === 0 && j2.mezz[0].warn.some(w => /not over this mezzanine's beams/.test(w.text)));
close(totals(j2).L, t0.L, 1e-6, 'and not in the loads');

console.log(`points tests passed (lenient lengths; note loads: stair 2 k at frame line 3, (2) 250 lb, 5 k on an 8'×8' grid; equivalent trib; ${F(b.span)} beam with 4 k live + 3 k dead on the floor: +4.000 k live and +3 k dead at the columns, mark ${mk.mark})`);
