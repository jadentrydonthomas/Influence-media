// Seismic (src/seismic.js): the ASCE 7 equivalent lateral force the way NBG's IBC Seismic workbook does it. The expected
// values are what the workbook gives for the same inputs (oracle/seismic_check.js runs the full set against it: 1,293 of
// 1,293 values tie across 14 cases). Then the job-level step: each frame's mezzanine load to the frame columns it
// frames into, the roof seismic override, the bracing lines.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../src/seismic.js');
const near = (a, b, t = 2e-5) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));

const g = { width: 120, length: 140, rooftype: 'Gable', dtr: 60, slope: 1, leh: 25, heh: 25 };
const roof = { SW: 2, RSW: 1, RDL: 4.66, CDL: 6, Pf: 30, P: 0 }, walls = { fsw: 3, bsw: 3, lew: 3, rew: 3 };
const mz = (a1, a2) => [{ id: 'Mezz 1', area: a1, conc: 0, elev: 11.5, FDL: 55, FLC: 5, FLJ: 8, FLL: 125, storage: true, FLP: 0 }, { id: 'Mezz 2', area: a2, conc: 0, elev: 11.5, FDL: 55, FLC: 5, FLJ: 8, FLL: 125, storage: true, FLP: 0 }].filter(m => m.area);
const job = (site, over = {}) => ({ d: S.design(site), g, roof, walls, vertical: true, ...over });

// 1. ASCE 7-16, Site D, RC II, SDC B: the longitudinal (bracing) table of a 120' × 140' building with two storage mezzanines
{
  const j = job({ ed: '7-16', Ss: 0.169, S1: 0.058, siteClass: 'D', risk: 'II' });
  assert.ok(near(j.d.Fa, 1.6) && near(j.d.Fv, 2.4) && near(j.d.SDS, 0.1802666666666667) && near(j.d.SD1, 0.0928) && j.d.SDC === 'B');
  assert.strictEqual(S.meanRoofHeight(g), 27.5);
  const L = S.longitudinal(j, { types: ['X-Bracing', 'X-Bracing'], mezz: mz(3360, 1440) });
  assert.ok(near(L.cs.Cs, 0.06008888781070709) && L.k === 1);
  assert.deepStrictEqual(L.rows.map(r => [r.name, Math.round(r.W), +r.h.toFixed(2), Math.round(r.D), +r.Fx.toFixed(2)]), [
    ['Roof', 230283, 27.5, 6332795, 23.04], ['Left endwall', 9900, 13.79, 136500, 0.5], ['Right endwall', 9900, 13.79, 136500, 0.5],
    ['Front sidewall', 10500, 12.5, 131250, 0.48], ['Back sidewall', 10500, 12.5, 131250, 0.48], ['Mezz 1', 333480, 11.5, 3835020, 13.95], ['Mezz 2', 142920, 11.5, 1643580, 5.98]]);
  assert.ok(near(L.V, 44.91544935518806) && near(L.mezzLoads[0].F, 13.951009312956385) && near(L.bracingV, 43.94279818182991));
  // the lateral sheet for an interior frame (28 ft strip, 672 + 936 sq ft of mezzanine) and the left end frame
  const F2 = S.lateral(j, { type: 'Rigid Frame', bay: 28, at: 'interior', mezz: mz(672, 936) });
  assert.ok(near(F2.Ta, 0.3968479912997342) && near(F2.mezzLoads[0].F, 3.0661034924789874) && near(F2.mezzLoads[1].F, 4.2706441502385895));
  assert.ok(near(F2.altRoof, 25.549812376234737) && near(F2.frameV, 12.510671912124284));
  const F1 = S.lateral(j, { type: 'Rigid Frame', bay: 14, at: 'lew', mezz: mz(336, 504) });
  assert.ok(near(F1.mezzLoads[0].F, 1.5548326144581421) && near(F1.mezzLoads[1].F, 2.332248921687213) && near(F1.altRoof, 28.66140201332184) && near(F1.frameV, 6.788266327103182));
  // the roof's share with a mezzanine low in the building: well over Cs × roof weight (NBG Frame's single-level value)
  assert.ok(F2.rows[0].Fx > 1.8 * F2.cs.Cs * F2.rows[0].W / 1000);
}
// 2. SDC D with the 7-16 11.4.8 exception (Site D, T > 1.5 Ts), 7-10 interpolation at RC IV, 7-05 Ss cap + S1 ≥ 0.6 minimum, SDC A
{
  const D = job({ ed: '7-16', Ss: 1.5, S1: 0.15, siteClass: 'D', risk: 'II' });
  assert.ok(near(D.d.Fv, 2.3) && D.d.SDC === 'D');
  assert.ok(near(S.lateral(D, { type: 'Rigid Frame', bay: 28, at: 'interior', mezz: mz(672, 936) }).cs.Cs, 0.24838584661483765));
  assert.ok(near(S.longitudinal(D, { mezz: mz(3360, 1440) }).cs.Cs, 0.29465577006340027));
  const C = job({ ed: '7-10', Ss: 0.6, S1: 0.25, siteClass: 'C', risk: 'IV' });
  assert.ok(near(C.d.Fa, 1.16) && near(C.d.Fv, 1.55) && C.d.SDC === 'D' && C.d.Ie === 1.5);
  assert.ok(near(S.lateral(C, { type: 'Rigid Frame', bay: 28, at: 'interior', mezz: mz(672, 936) }).cs.Cs, 0.1988571435213089));
  const B = job({ ed: '7-05', Ss: 1.8, S1: 0.7, siteClass: 'B', risk: 'III' });
  assert.ok(near(S.lateral(B, { type: 'Rigid Frame', bay: 28, at: 'interior', mezz: mz(672, 936) }).cs.Cs, 0.3571428656578064));
  const A = job({ ed: '7-16', Ss: 0.1, S1: 0.04, siteClass: 'B', risk: 'II' });
  assert.strictEqual(A.d.SDC, 'A');
  assert.ok(near(S.lateral(A, { type: 'Rigid Frame', bay: 28, at: 'interior', mezz: mz(672, 936) }).mezzLoads[0].F, 0.66696));
  // a mezzanine counted as a story in SDC D: the moment frame is over its limits (12.2.5.6.1)
  const st = job({ ed: '7-16', Ss: 1.0, S1: 0.4, siteClass: 'D', risk: 'II' }, { story: true });
  assert.ok(/12\.2\.5\.6\.1/.test(S.lateral(st, { type: 'Rigid Frame', bay: 28, at: 'interior', mezz: mz(672, 936) }).limit || ''));
  // Site Class E at Ss 1.0: site-specific — flagged, not guessed
  const E = S.design({ ed: '7-16', Ss: 1.0, S1: 0.2, siteClass: 'E', risk: 'II' });
  assert.ok(!E.ok && /site-specific/.test(E.flags[0]));
  assert.deepStrictEqual(['Post and Beam Multi Span - EMS', 'Post & Beam', 'Rigid Frame Clear Span - RCS', 'Lean-To Clear Span - LCS', 'Rigid Frame Multi Span (Non-Exp) -'].map(S.frameType), ['Post & Beam', 'Post & Beam', 'Rigid Frame', 'Rigid Frame', 'Rigid Frame']);
  assert.strictEqual(S.editionOf('Massachusetts (MASS 10th Ed.) ASCE 7-16').ed, '7-16');
  assert.strictEqual(S.editionOf('Ohio 2024 (IBC 2021) ASCE 7-16').ed, '7-16');
  assert.ok(/Hazard Tool/.test(S.editionOf('IBC 2024').note || ''));
}

// 3. the job (W1S-26062, when present): every frame line with mezzanine gets its share on the columns it frames into;
//    the bracing lines hold the whole longitudinal mezzanine force
const pdf = process.env.MZ_PCS3 || path.join(__dirname, '..', 'private', 'pcs', 'PCS_job3.pdf');
let ok = fs.existsSync(pdf);
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { ok = false; }
if (!ok) { console.log('seismic tests passed (engine vs the workbook; W1S-26062 not present, job step skipped)'); process.exit(0); }
(async () => {
  const { loadJob } = require('../oracle/job_load.js');
  const RUN = require('../src/run.js');
  const { inps } = await loadJob(pdf);
  const items = inps.map(inp => ({ inp, settings: {} }));
  // roof dead is "Per Seller" on the PCS: asked for, never guessed
  let sj = RUN.runJob(items).seismic;
  assert.ok(!sj.ok && /roof dead load/.test(sj.need.join(' ')));
  const bk = sj.buildings[0].bkey;
  sj = RUN.runJob(items, { seis: { buildings: { [bk]: { RDL: 4.66 } }, mezz: { 'Mezz 1': { FDL: 55, framing: false, storage: true }, 'Mezz 2': { FDL: 55, framing: false, storage: true } } } }).seismic;
  assert.ok(sj.ok, sj.need.join('; '));
  const b = sj.buildings[0];
  assert.deepStrictEqual(b.mezz.map(m => +m.psf.toFixed(2)), [99.25, 99.25], '55 + 5 + 8 + 25 % of 125');
  assert.deepStrictEqual(b.frames.map(f => [f.label, f.at, f.bay, f.eqs.map(e => `${e.member} ${e.F.toFixed(2)}`).join(' ')]), [
    ['1', 'lew', 14, 'COL03 1.55 COL02 2.33'], ['2', 'interior', 28, 'COL03 3.07 COL02 4.27'], ['3', 'interior', 28, 'COL03 2.58'],
    ['4', 'interior', 28, 'COL03 2.58'], ['5', 'interior', 28, 'COL03 2.58'], ['6', 'rew', 14, 'COL03 1.34']]);
  assert.ok(b.frames.every(f => !f.loose.length));
  assert.ok(near(b.long.mezzLoads[0].F, 13.951009312956385, 1e-4) && near(b.long.mezzLoads[1].F, 5.98, 2e-3));
  const lines = b.braceLines.map(l => [l.edge.replace(/,.*$/, ''), l.segs.map(s => s.join('-')).join(' '), +l.F.toFixed(2), l.independent]);
  assert.deepStrictEqual(lines, [['line E', '0-40', 4.98, true], ['line B', '40-140', 4.98, true], ['BSW sidewall', '0-140', 9.97, false]]);
  assert.ok(near(b.braceLines.reduce((a, l) => a + l.F, 0), b.long.mezzLoads.reduce((a, m) => a + m.F, 0), 1e-9), 'the lines hold all of it');
  console.log('seismic tests passed (ASCE 7-05 / 7-10 / 7-16 against the IBC Seismic workbook; W1S-26062: 99.25 psf, frames 1–6 EQ on COL02 / COL03, bracing 13.95 + 5.98 k to line E, line B and the BSW)');
})().catch(e => { console.error(e); process.exit(1); });
