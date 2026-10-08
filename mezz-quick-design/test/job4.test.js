// W1G-26097 (when present): Box 22 only in the alternate's pages appended after the drawings, two buildings (a lean-to
// attached back to back), dead load from the blue note, the deck written out under "Other", mezzanine columns and joist
// direction marked up over the floor plan as annotations, the shared BSW line carried by one beam.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pdf = process.env.MZ_PCS4 || path.join(__dirname, '..', 'private', 'pcs', 'PCS_job4.pdf');
let ok = fs.existsSync(pdf);
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { ok = false; }
if (!ok) { console.log('job4 tests passed (PCS not present, skipped)'); process.exit(0); }
const { loadJob } = require('../oracle/job_load.js');
const PLAN = require('../src/plan.js');
const near = (a, b, t = 0.01) => Math.abs(a - b) < t;
(async () => {
  const { pcs, inps, job } = await loadJob(pdf);
  // Box 22: "22) MEZZANINES - NONE REQUIRED" in the base scope; the alternate's Box 22 pages at the end
  assert.strictEqual(pcs.job.quote, 'W1G-26097');
  assert.deepStrictEqual(pcs.mezzanines.map(m => [m.id, m.building, +m.width.toFixed(3), +m.length.toFixed(3), m.alternate]), [
    ['Sanctuary', 'Sanctuary', 99.042, 158.625, 'ALTERNATE #1 MEZZANINE SPECS'], ['Lean To', 'Lean To', 28.167, 159.958, 'ALTERNATE #1 MEZZANINE SPECS']]);
  // dead load "Per Seller" with the blue 62.5psf note; deck "Other: 22ga B deck 1.5""; C from its blue note
  inps.forEach(inp => {
    assert.ok(inp.loads.dead.value === 62.5 && inp.loads.dead.source === 'annotation');
    assert.strictEqual(inp.mezz.deck, '1.5VL');
    assert.ok(near(inp.geom.A.value, 16) && near(inp.geom.B.value, 12.5) && near(inp.geom.C.value, 13.5) && near(inp.geom.joistSpacing.value, 2.5));
  });
  // Box 2 / Box 5 per building: single slope (no ridge line), the lean-to's own frames
  assert.strictEqual(pcs.buildings.Sanctuary.building.ridge, null);
  assert.deepStrictEqual(pcs.buildings.Sanctuary.frames.map(f => [f.from, f.to, /Post/.test(f.type) ? 'P&B' : 'RF']), [[1, 1, 'P&B'], [2, 8, 'RF'], [9, 9, 'P&B']]);
  assert.ok(pcs.buildings['Lean To'].frames.every(f => /Lean-To/.test(f.type)));
  assert.deepStrictEqual(pcs.attachments, [{ building: 'Lean To', wall: 'BSW', to: 'Sanctuary', toWall: 'BSW', at: 0 }]);
  // the floor plan: page 22 of 24; 28 marked-up X columns; JOISTS lines across the width; the Sanctuary drawn as lines 2–10
  assert.ok(pcs.plan, 'the floor plan registers');
  assert.strictEqual(pcs.plan.columns.length, 28);
  assert.ok(pcs.plan.columns.every(c => c.markup));
  assert.strictEqual(pcs.plan.numberOffset, 1);
  assert.deepStrictEqual(pcs.mezzanines.map(m => [m.planJoists, m.planJoistsFrom]), [['y', 'markup'], ['y', 'markup']]);
  // the layout: exactly the marked columns, beams on B–G, the lean-to's BSW edge carried by the Sanctuary's line B beam
  const [s, l] = job.mezz;
  assert.ok(PLAN.compare(pcs.plan.columns, job.columns).agree, 'every marked X is a mezzanine column and no other');
  assert.strictEqual(job.columns.length, 28);
  assert.deepStrictEqual(s.layout.beamLines.map(v => +v.toFixed(2)), [0, 21.18, 40.65, 60.1, 79.57, 99.04]);
  const lineB = s.layout.beams.filter(b => near(b.line, s.grid.width));
  assert.ok(lineB.length === 8 && lineB.every(b => b.extra && near(b.trib, 23.81, 0.02)), 'line B: 9\'-8 3/4" + 14\'-1"');
  assert.deepStrictEqual(l.grid.allY.map(y => l.grid.yLabel(y)), ['A', 'B'], 'lean-to lines lettered as drawn');
  assert.strictEqual(l.layout.beams.filter(b => b.absorbed).length, 8, 'its BSW edge beams are the Sanctuary\'s');
  // sections and every check passing
  assert.deepStrictEqual(job.marks.map(m => [m.mark, m.kind, m.desc, m.qtyAll]), [['MB1', 'interior', 'BU20x41', 40], ['MB2', 'exterior', 'BU20x28', 18]]);
  job.marks.forEach(m => m.spanRuns.forEach(q => assert.ok(q.check.res.CSR <= 0.99 && q.check.res.SRvx <= 0.99 && q.check.llOK && q.check.tlOK, m.mark)));
  assert.ok(s.colFinal && s.colFinal.ok && s.colFinal.quoteAs === 'BU8x28' && near(s.colLen, 16));
  // loads to the frame: the BSW frame columns carry both floors through line B; the lean-to's FSW columns its own
  const fe = (b, n) => job.frameEntries.find(f => f.building === b && f.frame === String(n));
  const s3 = fe('Sanctuary', 3).entries.map(e => [e.label, e.member, +e.D.toFixed(2), +e.L.toFixed(2)]);
  assert.deepStrictEqual(s3, [['3/G', 'COL01', 16.54, 25.81], ['3/B', 'COL02', 36.8, 58.05]]);
  assert.deepStrictEqual(fe('Lean To', 3).entries.map(e => e.label), ['3/A']);
  console.log('job4 tests passed (W1G-26097: Box 22 from the alternate pages, 62.5 psf blue note, 1.5" deck, 28/28 marked-up columns, joists across from the JOISTS markup, lean-to edge on the Sanctuary line B beam, MB1 BU20x41 ×40, MB2 BU20x28 ×18, BU8x28 ×28)');
})().catch(e => { console.error(e); process.exit(1); });
