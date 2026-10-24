// Seismic (src/seismic.js): ASCE 7's equivalent lateral force the way NBG Design Calcs works it. NBG's validation
// examples and a .nbgcalcs file are checked against the engine value by value in oracle/nbg_seismic.js when they are
// present (private); here each of its rules on cases worked by hand, then the job: each frame's mezzanine load on the
// columns it frames into, the bracing lines.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../src/seismic.js');
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));

// 1. spectral values: SDS = 0.6667 SMS, SD1 = 0.6667 SM1; Fa as interpolated, Fv to two decimals; Site Class E at
//    Ss ≥ 1.0 takes Site Class C's Fa; ASCE 7-22 takes SMS / SM1 from the hazard tool
{
  const d = S.design({ ed: '7-16', Ss: 0.26, S1: 0.075, siteClass: 'D', risk: 'II' });
  assert.ok(near(d.Fa, 1.592) && near(d.Fv, 2.4) && near(d.SMS, 0.41392) && near(d.SDS, 0.6667 * 0.41392) && near(d.SD1, 0.6667 * 0.18) && d.SDC === 'B' && d.rho === 1);
  const e = S.design({ ed: '7-16', Ss: 1.048, S1: 0.293, siteClass: 'E', risk: 'II' });
  assert.ok(near(e.Fa, 1.2) && near(e.Fv, 2.84) && near(e.SM1, 2.84 * 0.293) && e.SDC === 'D' && e.rho === 1.3, '2.835 → 2.84');
  const t = S.design({ ed: '7-22', Ss: 0.15, S1: 0.041, SMS: 0.19, SM1: 0.087, siteClass: 'D', risk: 'II' });
  assert.ok(t.ok && t.Fa == null && near(t.SDS, 0.6667 * 0.19) && near(t.SD1, 0.6667 * 0.087) && t.SDC === 'A');
  assert.ok(!S.design({ ed: '7-22', Ss: 0.15, S1: 0.041, siteClass: 'D' }).ok, '7-22 without SMS / SM1');
  assert.ok(!S.design({ ed: '7-16', Ss: 0.2, S1: 0.1, siteClass: 'F' }).ok, 'Site Class F is site-specific');
  assert.strictEqual(S.design({ ed: '7-16', Ss: 0.6, S1: 0.2, siteClass: 'D', risk: 'IV' }).SDC, 'D');
  assert.strictEqual(S.design({ ed: '7-16', Ss: 2, S1: 0.8, siteClass: 'D', risk: 'II' }).SDC, 'E');
  assert.strictEqual(S.editionOf('Ohio 2024 (IBC 2021) ASCE 7-16').ed, '7-16');
  assert.strictEqual(S.editionOf('IBC2021').ed, '7-16');
  assert.strictEqual(S.editionOf('IBC 2024 ASCE 7-22').ed, '7-22');
}
// 2. force resisting systems: "not detailed for seismic" in SDC A–C; Ω0 less 0.5, not under 2, with flexible diaphragms
{
  const pick = s => ({ label: s.label, R: s.R, Om: s.Om, Cd: s.Cd, Ct: s.Ct, x: s.x });
  assert.deepStrictEqual(pick(S.system('Rigid Frame', 'B', { flexible: true })), { label: 'Not Detailed For Seismic', R: 3, Om: 2.5, Cd: 3, Ct: 0.028, x: 0.8 });
  assert.deepStrictEqual(pick(S.system('X-Bracing', 'C', {})), { label: 'Not Detailed For Seismic', R: 3, Om: 3, Cd: 3, Ct: 0.02, x: 0.75 });
  assert.deepStrictEqual(pick(S.system('Portal Frame', 'D', { flexible: true })), { label: 'Ord. Moment Frame', R: 3.5, Om: 2.5, Cd: 3, Ct: 0.028, x: 0.8 });
  assert.deepStrictEqual(pick(S.system('Post & Beam', 'D', { flexible: true })), { label: 'Ord. Concentrically Braced Frame', R: 3.25, Om: 2, Cd: 3.25, Ct: 0.02, x: 0.75 });
  assert.deepStrictEqual(pick(S.system('Portal Frame (IMF)', 'D', {})), { label: 'Intermediate Moment Frame', R: 4.5, Om: 3, Cd: 4, Ct: 0.028, x: 0.8 });
  assert.strictEqual(S.system('Rigid Frame', 'B', { ndfs: false }).label, 'Ord. Moment Frame');
  assert.deepStrictEqual(['Post and Beam Multi Span - EMS', 'Post & Beam', 'Rigid Frame Clear Span - RCS', 'Lean-To Clear Span - LCS'].map(S.frameType), ['Post & Beam', 'Post & Beam', 'Rigid Frame', 'Rigid Frame']);
}
// 3. Cs: 12.8-2 / -3 / -5 / -6; ASCE 7-16's 11.4.8 exception (1.5 × Eq. 12.8-3 past 1.5 Ts) for Site Class D only with S1 ≥ 0.2
{
  const d = S.design({ ed: '7-16', Ss: 0.6, S1: 0.21, siteClass: 'D', risk: 'II' }), T = 1.0, Ts = d.SD1 / d.SDS;
  assert.ok(T > 1.5 * Ts);
  assert.ok(near(S.Cs(d, 3.5, T).Cs, 1.5 * d.SD1 / (T * 3.5)) && S.Cs(d, 3.5, T).exception1148);
  const d2 = S.design({ ed: '7-16', Ss: 0.6, S1: 0.19, siteClass: 'D', risk: 'II' });
  assert.ok(near(S.Cs(d2, 3.5, T).Cs, d2.SD1 / (T * 3.5)), 'S1 under 0.2: no exception');
  const d3 = S.design({ ed: '7-22', Ss: 0.6, S1: 0.21, SMS: 0.79, SM1: 0.46, siteClass: 'D', risk: 'II' });
  assert.ok(near(S.Cs(d3, 3.5, T).Cs, d3.SD1 / (T * 3.5)), 'ASCE 7-22: none');
  assert.ok(near(S.Cs(d, 3.5, 0.3).Cs, d.SDS / 3.5), 'short period: SDS / R');
  const III = S.design({ ed: '7-16', Ss: 0.225, S1: 0.06, siteClass: 'D', risk: 'III' });
  assert.ok(near(S.Cs(III, 3, 0.3).Cs, III.SDS / (3 / 1.25)), 'Ie 1.25');
}
// 4. one building worked by hand: 80' × 120' gable 1:12, eaves 18', a 30' × 40' storage mezzanine at 12'
const building = { ed: '7-16', type: 'Gable', width: 80, length: 120, dtr: 40, slope: 1, eaveFSW: 18, eaveBSW: 18 };
const full = w => ({ kind: 'full', weight: w });
const project = (seis = {}, extra = {}) => S.project({
  building, seismic: { ed: '7-16', risk: 'II', Ss: 0.3, S1: 0.1, siteClass: 'D', roofDiaphragm: 'Flexible', mezzDiaphragm: 'None', ...seis },
  roof: { SW: 2, RDL: 3, CDL: 2, RSW: 0, Pf: 25 }, walls: { LEW: full(3), REW: full(3), FSW: full(3), BSW: full(3) },
  mezz: [{ id: 'M1', elev: 12, FDL: 50, FLC: 5, FLJ: 5, storage: true, FLL: 125 }], cranes: [], sfrs: { FSW: 'X-Bracing', BSW: 'X-Bracing', lines: ['Post & Beam', 'Rigid Frame', 'Rigid Frame'] }, ...extra });
{
  const J = project(), g = J.g;
  assert.ok(near(g.mrh, 18 + 40 / 12 / 2) && near(g.wos, 80 / Math.cos(Math.atan(1 / 12))) && near(g.ridge, 18 + 40 / 12));
  assert.ok(near(S.mezzPsf(J.P.mezz[0]), 50 + 5 + 5 + 0.25 * 125));
  // an interior frame line, 24' strip, 30' × 24' of the mezzanine in it: no significant mezzanine, so each weight takes Cs × W
  const L = S.frameLine(J, { framing: 'Rigid Frame', bay: 24, bayType: 'Interior', fswTrib: 24, bswTrib: 24, mezz: [{ id: 'M1', area: 720, conc: 0 }] });
  const T = 0.028 * Math.pow(g.mrh, 0.8), Cs = Math.min(J.d.SDS / 3, J.d.SD1 / (T * 3));
  assert.ok(near(L.Ta, T) && near(L.Cs, Cs) && L.k === 0 && L.sys.label === 'Not Detailed For Seismic' && L.factors.Om === 2.5);
  const row = k => L.rows.find(r => r.key === k);
  assert.ok(near(row('roof').W, 24 * 7 * g.wos) && near(row('roof').h, g.mrh), 'Pf 25: no snow in the weight');
  assert.ok(near(row('FSW').W, 24 * 18 * 3) && near(row('FSW').h, 9) && near(row('mezz').W, 720 * 91.25) && near(row('mezz').h, 12));
  L.rows.forEach(r => assert.ok(near(r.Fx, Cs * r.W / 1000) && near(r.Mx, r.Fx * r.h)));
  assert.ok(near(L.frame.roofPsf, row('roof').W / (80 * 24)), 'k = 0, no endwall: the roof weight over the plan');
  const fswF = row('FSW').Mx / (18 - 16 / 12);
  assert.ok(near(L.frame.conc.find(c => c.key === 'FSW').F, fswF) && near(L.frame.conc.find(c => c.key === 'FSW').at, 18 - 16 / 12));
  assert.ok(near(L.V, L.frame.roofPsf * 80 * 24 * Cs / 1000 + 2 * fswF + row('mezz').Fx));
  // the left end frame: its endwall to the roof line — 80 × 18 + the gable, at the outline's centroid
  const E = S.frameLine(J, { framing: 'Post & Beam', bay: 12, bayType: 'Left Endwall', fswTrib: 12, bswTrib: 12, mezz: [] });
  const A = 80 * 18 + 80 * (40 / 12) / 2, z = (80 * 18 * 9 + 80 * (40 / 12) / 2 * (18 + 40 / 12 / 3)) / A;
  const ew = E.rows.find(r => r.key === 'LEW');
  assert.ok(near(ew.W, 3 * A) && near(ew.h, z) && near(E.frame.roofPsf, (E.rows[0].Mx + ew.Mx) * 1000 / (g.mrh * 80 * 12 * E.Cs)));
  // significant mezzanine: the vertical distribution, k from Ta (12.8.3)
  const K = S.frameLine(project({ significant: true }), { framing: 'Rigid Frame', bay: 24, bayType: 'Interior', fswTrib: 24, bswTrib: 24, mezz: [{ id: 'M1', area: 720, conc: 0 }] });
  const Wt = K.rows.reduce((a, r) => a + r.W, 0), Dt = K.rows.reduce((a, r) => a + r.W * r.h, 0);
  assert.ok(K.k === 1 && near(K.rows.find(r => r.key === 'mezz').Fx, K.Cs * Wt * (720 * 91.25 * 12) / Dt / 1000));
  // the longitudinal: the whole building, both endwalls; sidewall loads at the eave; the bracing's roof weights
  const B = S.bracing(J, { fswTrib: 120, bswTrib: 120, mezz: [{ id: 'M1', area: 1200, conc: 0 }] });
  const brow = k => B.rows.find(r => r.key === k);
  assert.ok(near(brow('roof').W, 120 * 7 * g.wos) && near(brow('LEW').W, 3 * A) && near(brow('mezz').W, 1200 * 91.25));
  assert.ok(near(B.bracing.totalPsf, (brow('roof').Mx + brow('LEW').Mx + brow('REW').Mx) * 1000 / (g.mrh * 80 * 120 * B.Cs)) && near(B.bracing.deadPsf, B.bracing.totalPsf));
  assert.ok(near(B.bracing.conc.find(c => c.key === 'FSW').F, brow('FSW').Mx / 18) && near(B.bracing.conc.find(c => c.key === 'mezz').F, brow('mezz').Fx), 'flexible floor: no torsion');
  // a rigid mezzanine diaphragm with accidental torsion: 1.1 on its force, Ω0 not reduced; a rigid roof: 1.1 on the factor
  const R = S.bracing(project({ mezzDiaphragm: 'Rigid', roofDiaphragm: 'Rigid' }), { fswTrib: 120, bswTrib: 120, mezz: [{ id: 'M1', area: 1200, conc: 0 }] });
  assert.ok(near(R.bracing.conc.find(c => c.key === 'mezz').F, 1.1 * R.rows.find(r => r.key === 'mezz').Fx) && near(R.bracing.factor, 1.1 * R.Cs) && R.factors.Om === 3);
  const R0 = S.bracing(project({ mezzDiaphragm: 'Rigid', torsionLong: false }), { fswTrib: 120, bswTrib: 120, mezz: [{ id: 'M1', area: 1200, conc: 0 }] });
  assert.ok(near(R0.bracing.conc.find(c => c.key === 'mezz').F, R0.rows.find(r => r.key === 'mezz').Fx), 'torsion off');
  // snow in the weight: 20 % of Pf over 30 psf; ASCE 7-22 15 % over 45 psf; on plan
  const snow = (ed, Pf, extra = {}) => { const Jx = S.project({ ...J.P, building: { ...building, ed }, seismic: { ...J.P.seismic, ed, SMS: 0.47, SM1: 0.24, ...extra }, roof: { ...J.P.roof, Pf } }); return S.bracing(Jx, { fswTrib: 120, bswTrib: 120 }).rows[0].W - 120 * 7 * g.wos; };
  assert.ok(near(snow('7-16', 40), 0.2 * 40 * 80 * 120) && near(snow('7-16', 30), 0) && near(snow('7-22', 40), 0) && near(snow('7-22', 50), 0.15 * 50 * 80 * 120));
  // walls: a partial height hardwall (masonry 8' at 40 psf, panel above), a parapet to 22', a shear wall left out in its own plane
  const W2 = { LEW: { kind: 'full', weight: 3, parapet: true, top: 22 }, REW: full(3), FSW: { kind: 'partial', masonryTop: 8, lowerWeight: 40, upperWeight: 3, top: 18, shear: true }, BSW: full(3) };
  const J2 = S.project({ ...J.P, walls: W2 });
  const B2 = S.bracing(J2, { fswTrib: 120, bswTrib: 120 }), up = B2.rows.find(r => r.name === 'Front SW Loads - Upper'), lo = B2.rows.find(r => r.name === 'Front SW Loads - Lower');
  assert.ok(near(up.W, 120 * 10 * 3) && near(up.h, 13) && lo.W === 0 && lo.excluded, 'the sidewall\'s masonry carries itself along its own plane');
  assert.ok(near(B2.rows.find(r => r.key === 'LEW').W, 80 * 22 * 3) && near(B2.rows.find(r => r.key === 'LEW').h, 11), 'a parapet: the wall to its top');
  const L2 = S.frameLine(J2, { framing: 'Rigid Frame', bay: 24, bayType: 'Interior', fswTrib: 24, bswTrib: 24, mezz: [] });
  assert.ok(near(L2.rows.find(r => r.name === 'Front SW Loads - Lower').W, 24 * 8 * 40), 'across the building it loads the frame');
  // 12.2.3.3: with a rigid diaphragm the least R of the lateral lines governs each line (its own period)
  const J3 = project({ ed: '7-16', Ss: 1.0, S1: 0.4, mezzDiaphragm: 'Rigid' }, { sfrs: { FSW: 'X-Bracing', BSW: 'X-Bracing', lines: ['Post & Beam', 'Rigid Frame (IMF)'] } });
  const L3 = S.frameLine(J3, { framing: 'Rigid Frame (IMF)', bay: 24, bayType: 'Interior', fswTrib: 24, bswTrib: 24, mezz: [] });
  assert.ok(L3.sys.label === 'Ord. Concentrically Braced Frame' && L3.R === 3.25 && near(L3.Ta, 0.028 * Math.pow(J3.g.mrh, 0.8)));
  const L4 = S.frameLine(project({ ed: '7-16', Ss: 1.0, S1: 0.4 }, { sfrs: J3.P.sfrs }), { framing: 'Rigid Frame (IMF)', bay: 24, bayType: 'Interior', fswTrib: 24, bswTrib: 24, mezz: [] });
  assert.ok(L4.sys.label === 'Intermediate Moment Frame' && L4.R === 4.5, 'flexible, Risk Category II: each line its own');
}

// 5. NBG's validation examples and .nbgcalcs files, when present (private): every value ties
const fixtures = path.join(__dirname, '..', 'private', 'nbg-calcs', 'validation', 'fixtures');
let nbg = 'NBG validation examples not present';
if (fs.existsSync(fixtures)) {
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'oracle', 'nbg_seismic.js')], { encoding: 'utf8' });
  const m = /(\d+) values: (\d+) exact, (\d+) within 1 in the last printed digit, (\d+) differ/.exec(r.stdout);
  assert.ok(m && m[4] === '0' && r.status === 0, 'NBG validation: ' + (r.stdout || '').split('\n').filter(l => /✗|differ|values/.test(l)).slice(0, 12).join('\n'));
  nbg = `NBG validation ${m[2]}/${m[1]} printed values${/nbgcalcs: .* all tie/.test(r.stdout) ? ' and the .nbgcalcs file to 1e-9' : ''}`;
}

// 6. the job (W1S-26062, when present): every frame line with mezzanine gets its share on the columns it frames into;
//    the bracing lines hold the whole longitudinal mezzanine force
const pdf = process.env.MZ_PCS3 || path.join(__dirname, '..', 'private', 'pcs', 'PCS_job3.pdf');
let ok = fs.existsSync(pdf);
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { ok = false; }
if (!ok) { console.log(`seismic tests passed (the rules worked by hand; ${nbg}; W1S-26062 not present, job step skipped)`); process.exit(0); }
(async () => {
  const { loadJob } = require('../oracle/job_load.js');
  const RUN = require('../src/run.js');
  const { inps } = await loadJob(pdf);
  // as the practice inputs leave it, MB1 waits on a decision (15" of room under C, 16.03" with its sag): the Seismic page
  // waits too. The job as quoted takes the frame column setback (MB1 BU14x94, MB2 BU13x48)
  assert.ok(RUN.runJob(inps.map(inp => ({ inp, settings: {} }))).seismic.need.some(n => /^MB1 sized on the Design page/.test(n)));
  const items = inps.map(inp => ({ inp, settings: { markInput: { MB1: { setback: true }, MB2: { setback: true } } } }));
  // roof dead is "Per Seller" on the PCS: not a stop — 3 psf (NBG Bracing's default) is assumed and said so; a frame
  // file's own value, a bracing file's, or a typed one replaces it
  let sj = RUN.runJob(items).seismic;
  assert.ok(sj.buildings[0].roof.RDL.value === 3 && sj.buildings[0].roof.RDL.source === 'default' && sj.notes.some(n => /roof dead load 3 psf assumed/.test(n.text)) && !sj.need.some(n => /roof dead/.test(n)));
  const fromFrame = RUN.runJob(items, { seis: { buildings: { [sj.buildings[0].bkey]: { frameFile: { roofDead: 2.7291 } } }, files: { [sj.buildings[0].bkey]: { from: 'bracing file', roofDead: 3 } } } }).seismic.buildings[0].roof.RDL;
  assert.deepStrictEqual([fromFrame.value, fromFrame.source], [2.7291, 'frame file'], 'NBG Frame\'s own roof dead before the bracing run\'s');
  const bk = sj.buildings[0].bkey;
  const base = { buildings: { [bk]: { RDL: 4.66 } }, mezz: { 'Mezz 1': { FDL: 55, framing: false, storage: true }, 'Mezz 2': { FDL: 55, framing: false, storage: true } } };
  sj = RUN.runJob(items, { seis: base }).seismic;
  assert.ok(sj.ok, sj.need.join('; '));
  const b = sj.buildings[0];
  assert.deepStrictEqual(b.mezz.map(m => +m.psf.toFixed(2)), [99.25, 99.25], '55 + 5 + 8 + 25 % of 125');
  // "significant mezzanine exists" unchecked, as NBG Design Calcs has it: each weight takes Cs × W (4,800 sq ft of
  // mezzanine in 16,800 is under a third: no hint either)
  assert.ok(!b.significant && !b.sigHint && b.lines.length === 6 && b.lines.every(l => l.lat.k === 0));
  const sig = RUN.runJob(items, { seis: { ...base, significant: true } }).seismic.buildings[0];
  assert.ok(sig.significant && sig.lines.every(l => l.lat.k === 1) && sig.long.mezzLoads[0].F < b.long.mezzLoads[0].F, 'checked: k from Ta, the mezzanine (below the roof) takes less');
  const Cs = b.long.Cs;
  assert.ok(near(Cs, sj.design.SDS / 3) && near(sj.design.SDS, 0.6667 * sj.design.SMS));
  assert.deepStrictEqual(b.frames.map(f => [f.label, f.at, f.bay, f.eqs.map(e => `${e.member} ${e.F.toFixed(2)}`).join(' ')]), [
    ['1', 'lew', 14, 'COL02 3.01 COL03 2.00'], ['2', 'interior', 28, 'COL02 5.58 COL03 4.01'], ['3', 'interior', 28, 'COL03 4.01'],
    ['4', 'interior', 28, 'COL03 4.01'], ['5', 'interior', 28, 'COL03 4.01'], ['6', 'rew', 14, 'COL03 2.00']]);
  // a frame's mezzanine load is Cs × its floor in the strip
  b.frames.forEach(f => f.lat.mezzLoads.forEach(ml => assert.ok(near(ml.F, Cs * f.areas[ml.id] * 99.25 / 1000, 1e-9))));
  assert.ok(b.frames.every(f => !f.loose.length));
  assert.ok(near(b.long.mezzLoads[0].F, Cs * 333480 / 1000) && near(b.long.mezzLoads[1].F, Cs * 142920 / 1000));
  // each mezzanine sends half its force to each of its long edges, in EQB and EQF: Mezz 2 (60–96 ft, 0–40) half to line E
  // and half on through Mezz 1 (joined to it all along at 96 ft) to the BSW; Mezz 1 (96–120, 0–140) half to line B (its
  // free stretch 40–140) and half to the BSW. The BSW 10.02 + 4.29 = 14.31 k, the lines holding the 28.63 k once
  const lines = b.braceLines.map(l => [l.edge.replace(/,.*$/, ''), l.segs.map(s => s.join('-')).join(' '), +l.F.toFixed(2), l.independent, l.wall]);
  assert.deepStrictEqual(lines, [['line E', '0-40', 4.29, true, null], ['line B', '40-140', 10.02, true, null], ['BSW sidewall', '0-140', 14.31, false, 'BSW']]);
  assert.deepStrictEqual(b.braceLines[2].by.map(q => [q.id, +q.F.toFixed(2), q.via]), [['Mezz 1', 10.02, null], ['Mezz 2', 4.29, 'Mezz 1']]);
  const mzTotal = b.long.mezzLoads.reduce((a, m) => a + m.F, 0);
  assert.ok(near(b.mezzLong.total, mzTotal, 1e-12) && near(b.braceLines.reduce((a, l) => a + l.F, 0), mzTotal, 1e-9), 'the lines hold the mezzanine total once');
  assert.ok(near(b.braceLines.find(l => l.wall === 'BSW').F, mzTotal / 2, 1e-9), 'the BSW half of each mezzanine');
  b.braceLines.forEach(l => assert.ok(near(l.by.reduce((a, q) => a + q.F, 0), l.F, 1e-9), 'each mezzanine\'s part adds up'));
  b.long.mezzLoads.forEach(m => assert.ok(near(b.braceLines.reduce((a, l) => a + l.by.filter(q => q.id === m.id).reduce((c, q) => c + q.F, 0), 0), m.F, 1e-9), 'each mezzanine\'s force goes out whole'));
  // the engineer's edits: × 1.2 on every computed load, 5 k typed on frame 2 COL02 (Mezz 1 + Mezz 2 at that column, one
  // value), and the frame-file rows carry exactly what is shown — EQR +, EQL −
  const FF = require('../src/framefile.js');
  const f2 = b.frames.find(f => f.label === '2'), c2 = f2.eqs.find(e => e.member === 'COL02');
  assert.strictEqual(c2.key, RUN.eqKey(bk, '2', c2.label, c2.at));
  const ed = RUN.runJob(items, { seis: { ...base, eqScale: 1.2, eqOverride: { [c2.key]: 5 } } });
  const eb = ed.seismic.buildings[0];
  assert.deepStrictEqual(eb.frames.map(f => [f.label, f.eqs.map(e => `${e.member} ${e.F.toFixed(2)} ${e.edited}`).join(' ')]), [
    ['1', 'COL02 3.61 scaled COL03 2.40 scaled'], ['2', 'COL02 5.00 typed COL03 4.81 scaled'], ['3', 'COL03 4.81 scaled'],
    ['4', 'COL03 4.81 scaled'], ['5', 'COL03 4.81 scaled'], ['6', 'COL03 2.40 scaled']]);
  assert.ok(near(eb.frames[1].eqs.find(e => e.member === 'COL02').calc, f2.lat.mezzLoads.find(m => m.id === 'Mezz 2').F), 'the calculated value is kept beside the typed one');
  const rowsOf = (job, ls) => {
    const fe = job.frameEntries.filter(x => ls.includes(x.frame)), cols = [...new Map(fe.flatMap(x => x.entries.filter(e => e.member)).map(e => [e.member, { id: e.member, x: e.y }])).values()];
    return FF.rowsFor({ lines: ls, columns: cols, width: 120 }, job.frameEntries, { lines: ls }).rows.filter(x => /^EQ/.test(x.caseId)).map(x => `${x.name} ${x.member} ${x.x.toFixed(2)}`);
  };
  assert.deepStrictEqual(rowsOf(ed, ['2']), ['EQR2 COL02 5.00', 'EQL2 COL02 -5.00', 'EQR3 COL03 4.81', 'EQL3 COL03 -4.81']);
  // a file for lines 3-5: one typed value for every line at that column (what the card does) is what goes in
  const keys = ['3', '4', '5'].map(l => eb.frames.find(f => f.label === l).eqs[0].key);
  const ed2 = RUN.runJob(items, { seis: { ...base, eqOverride: Object.fromEntries(keys.map(k => [k, 2.75])) } });
  assert.deepStrictEqual(rowsOf(ed2, ['3', '4', '5']), ['EQR3 COL03 2.75', 'EQL3 COL03 -2.75']);
  assert.deepStrictEqual(rowsOf(RUN.runJob(items, { seis: base }), ['3', '4', '5']), ['EQR3 COL03 4.01', 'EQL3 COL03 -4.01'], 'no edits: the calculated loads');
  assert.deepStrictEqual(rowsOf(RUN.runJob(items, { seis: { ...base, eqOverride: { [c2.key]: 0 } } }), ['2']), ['EQR3 COL03 4.01', 'EQL3 COL03 -4.01'], '0 typed: no EQ rows for that column');
  // the tributary width and roof concentrated load typed for a frame line (as NBG Design Calcs takes them): the roof and
  // both sidewalls take the typed width, the roof load × Cs adds to the base shear; the mezzanine area in the strip stays
  const l2 = b.lines.find(l => l.label === '2'), lk = `${bk}|2`;
  const tw = RUN.runJob(items, { seis: { ...base, tribLat: { [lk]: 33 }, roofConcLat: { [lk]: 2 } } }).seismic.buildings[0].lines.find(l => l.label === '2');
  assert.ok(tw.trib === 33 && tw.bay === 28 && tw.lineIn.bayTyped && tw.lineIn.fswTrib === 33 && tw.lineIn.bswTrib === 33 && tw.lineIn.roofConc === 2);
  assert.deepStrictEqual(tw.lineIn.mezz.map(q => q.area), l2.lineIn.mezz.map(q => q.area), 'the strip\'s mezzanine area is kept');
  const roofW = r => r.lat.rows.find(x => x.key === 'roof').W;
  assert.ok(near(roofW(tw) - roofW(l2), 5 * (roofW(l2) / 28) + 2000, 1e-6), 'roof weight: 5 ft more of the strip + the 2 k');
  assert.ok(tw.lat.V > l2.lat.V && near(tw.lat.frame.conc.filter(c => c.key === 'mezz').reduce((a, c) => a + c.F, 0), l2.lat.frame.conc.filter(c => c.key === 'mezz').reduce((a, c) => a + c.F, 0), 1e-9), 'the mezzanine loads unchanged');
  // the code chosen on the page over the PCS's: the PCS's Ss / S1 belong to its own edition, so they are asked for
  const sw = RUN.runJob(items, { seis: { ...base, ed: '7-22' } }).seismic;
  assert.ok(!sw.ok && /SMS and SM1|Ss and S1 for ASCE 7-22/.test(sw.need.join(' ')));
  // a bracing file's code, site and roof loads stand in for the PCS's (typed values still win)
  const fromFile = RUN.runJob(items, { seis: { mezz: base.mezz, files: { [bk]: { from: 'bracing file', code: 'IBC2021', Ss: 0.2, S1: 0.07, siteClass: 'D', roofDead: 3.1 } } } }).seismic;
  assert.ok(fromFile.ok && fromFile.inputs.Ss.value === 0.2 && fromFile.inputs.Ss.source === 'bracing file' && fromFile.buildings[0].roof.RDL.value === 3.1);
  console.log(`seismic tests passed (the rules worked by hand; ${nbg}; W1S-26062: 99.25 psf, k = 0 unless a significant mezzanine, frames 1–6 EQ on COL02 / COL03, bracing ${b.long.mezzLoads.map(m => m.F.toFixed(2)).join(' + ')} k, half of each mezzanine to each of its edges: line E 4.29, line B 10.02, BSW 14.31 k; EQ edits × scale / typed per column into the frame-file rows)`);
})().catch(e => { console.error(e); process.exit(1); });
