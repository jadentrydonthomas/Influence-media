// W1S-26062 (Mezz 1 / Mezz 2, ⊗ mezzanine columns, ✱ Most Economical ridge columns, joist truss symbols) when present
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pdf = process.env.MZ_PCS3 || path.join(__dirname, '..', 'private', 'pcs', 'PCS_job3.pdf');
let ok = fs.existsSync(pdf);
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { ok = false; }
if (!ok) { console.log('job3 tests passed (PCS not present, skipped)'); process.exit(0); }
const { loadJob } = require('../oracle/job_load.js');
const PLAN = require('../src/plan.js');
(async () => {
  const { pcs, job } = await loadJob(pdf);
  assert.strictEqual(pcs.job.quote, 'W1S-26062');
  assert.deepStrictEqual(pcs.mezzanines.map(m => [m.id, m.width, m.length, m.startLEW, m.startFSW]), [['Mezz 1', 24, 140, 0, 96], ['Mezz 2', 36, 40, 0, 60]]);
  assert.deepStrictEqual(pcs.frames.map(f => [f.from, f.to, f.intType]), [[1, 1, null], [2, 2, null], [3, 5, 'Most Economical'], [6, 6, 'Most Economical']]);
  // the floor plan: eight ⊗, ✱ at the ridge of frames 3–6, an I at 2/E, the joist truss symbols run along the length
  const lab = c => job.mezz[0].grid.xLabel(Math.round(c.x)) + '/' + c.y.toFixed(0);
  assert.strictEqual(pcs.plan.columns.length, 8);
  assert.ok(pcs.plan.columns.every(c => c.kind === 'x'));
  assert.deepStrictEqual(pcs.plan.frameCols.filter(c => c.kind === 'star').map(c => Math.round(c.x)), [56, 84, 112, 139]);
  assert.ok(pcs.plan.frameCols.some(c => c.kind === 'I' && Math.abs(c.x - 28) < 0.5 && Math.abs(c.y - 60) < 0.5), 'I at 2/E');
  assert.deepStrictEqual(pcs.mezzanines.map(m => m.planJoists), ['x', 'x']);
  // the layout: exactly the drawing's mezzanine columns; 2/E and the endwall columns go to the frame
  assert.deepStrictEqual(job.columns.map(c => c.label).sort(), ['2/B', '2/C', '3/B', '4/B', `40'-0"/B`, `40'-0"/C`, `40'-0"/E`, '5/B']);
  assert.ok(PLAN.compare(pcs.plan.columns, job.columns).agree, 'every ⊗ is a mezzanine column and no other');
  assert.ok(job.frameLoads.some(f => f.label === '2/E'));
  // loads to NBG Frame: on frame members only, by frame line
  const fr = n => job.frameEntries.find(f => f.frame === String(n));
  assert.deepStrictEqual(fr(2).entries.map(e => [e.label, e.member]), [['2/E', 'COL02'], ['2/A', 'COL03']]);
  assert.deepStrictEqual(fr(1).entries.filter(e => !e.member).map(e => e.label), ['1/C', '1/B'], 'wind columns beside the rigid end frame are not members');
  const e2a = fr(2).entries.find(e => e.label === '2/A');
  assert.ok(Math.abs(e2a.D - 19.93) < 0.01 && Math.abs(e2a.L - 42) < 0.01 && Math.abs(e2a.elev - 10.75) < 1e-9);
  assert.ok(!job.frameEntries.some(f => f.entries.some(e => job.columns.some(c => c.label === e.label))), 'no mezzanine column in the frame loads');
  console.log('job3 tests passed (W1S-26062: 8/8 ⊗, ✱ 3/E–6/E, I 2/E, joists along the length from the truss symbols, frame loads on members)');
})().catch(e => { console.error(e); process.exit(1); });
