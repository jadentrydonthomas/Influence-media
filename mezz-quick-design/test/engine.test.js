// Training-guide examples, reproduced to the digit the guide prints.
const assert = require('assert');
const MZ = require('../src/engine.js');
const WF = require('../src/wf-db.js');
const D = require('../src/design.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const guide = { dead: 37, coll: 15, live: 125, joistWt: 8, L: 19 + 1 / 12, Lb: 2, trib: 25 }; // 19'-1" (sheet shows 19.083)

// MB1 - GOOD (guide p.8): BU18x42, COMBINED OK (SR = 0.88), SHEAR OK (SR = 0.62), L/1032, L/509, L/341
{
  const b = MZ.beamCheck({ ...guide, sec: { type: 'BU', d: 18, tw: 0.25, bof: 8, tof: 0.5, bif: 8, tif: 0.5 } }, WF);
  assert.strictEqual(b.desc, 'BU18x42');
  assert.strictEqual(b.combinedText, 'COMBINED OK (SR = 0.88)');
  assert.strictEqual(b.shearText, 'SHEAR OK (SR = 0.62)');
  near(b.res.Ix, 715.021, 0.001, 'Ix');
  near(b.V.D, 14.710, 0.0005, 'V dead'); near(b.V.L, 29.818, 0.0005, 'V live'); near(b.V.T, 44.528, 0.0005, 'V total');
  near(b.M.D, 70.180, 0.0005, 'M dead'); near(b.M.T, 212.435, 0.01, 'M total');
  assert.strictEqual(Math.round(b.defl.rDL), 1032); assert.strictEqual(Math.round(b.defl.rLL), 509); assert.strictEqual(Math.round(b.defl.rTL), 341);
  assert.ok(b.llOK && b.tlOK && b.strengthOK && b.conc.ok);
}
// MB1 - BAD (guide p.7): BU16x32, COMBINED NG (SR = 1.4), SHEAR OK (SR = 0.8), L/627, L/307, L/206
{
  const b = MZ.beamCheck({ ...guide, sec: { type: 'BU', d: 16, tw: 0.22, bof: 8, tof: 0.375, bif: 8, tif: 0.375 } }, WF);
  assert.strictEqual(b.desc, 'BU16x32');
  assert.strictEqual(b.combinedText, 'COMBINED NG (SR = 1.4)');
  assert.strictEqual(b.shearText, 'SHEAR OK (SR = 0.8)');
  near(b.res.Ix, 431.302, 0.001, 'Ix');
  assert.strictEqual(Math.round(b.defl.rDL), 627); assert.strictEqual(Math.round(b.defl.rLL), 307); assert.strictEqual(Math.round(b.defl.rTL), 206);
  assert.ok(!b.llOK && !b.tlOK && !b.strengthOK);
}
// Column (guide p.10): W12X26, L = 10, both sides D 14.71 / L 29.82 -> Mx 15.16 / -15.16 / 0, P 59.50 / 59.50 / 89.32, CSR .617 / .617 / .624
{
  const c = MZ.columnCheck({ sec: { type: 'WF', name: 'W12X26' }, Fy: 50, Fu: 65, L: 10, Lby: 120, DL_L: 14.71, LL_L: 29.82, DL_R: 14.71, LL_R: 29.82 }, WF);
  const want = [[15.16, 59.50, 0.617], [-15.16, 59.50, 0.617], [0, 89.32, 0.624]];
  c.combos.forEach((k, i) => {
    near(k.Mx, want[i][0], 0.005, 'Mx' + i); near(k.P, want[i][1], 0.005, 'P' + i); near(k.csr, want[i][2], 0.0005, 'CSR' + i);
    assert.strictEqual(k.okText, 'OK');
  });
  near(c.ex, 6.10, 0.001, 'e = d/2');
}
// Excel error semantics: an invalid singly-symmetric section (PNA in the flange) must not pass
{
  const b = MZ.beamCheck({ dead: 40, coll: 5, live: 100, joistWt: 8, L: 12, Lb: 2.5, trib: 10, sec: { type: 'BU', d: 16, tw: 0.1644, bof: 12, tof: 0.1875, bif: 10, tif: 0.5 } }, WF);
  assert.ok(!isFinite(b.res.CSR) && !b.strengthOK, 'invalid section flagged');
}
// Search: the guide's GOOD loads find a stocked section no heavier than the guide's BU18x42 at 18"
{
  const r = D.designBeam({ ...guide }, { dMin: 18, dMax: 18 });
  assert.ok(r.best && r.best.wt <= 42.0 && r.best.CSR <= 0.99 && r.best.rLL >= 360 && r.best.rTL >= 240, 'search at 18"');
}
// Dead load from the deck guide
assert.strictEqual(D.deadLoadFor(4).psf, 43);
assert.strictEqual(D.deadLoadFor(3.5).psf, 37);
console.log('engine tests passed');
