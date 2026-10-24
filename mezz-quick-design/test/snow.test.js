// Snow and drift: src/snow.js against NBG Design Calcs' own snow document and hand calculations; src/site.js placing
// attached buildings and putting a step's drift on the lower frames. Sample jobs (private/pcs) when present.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const S = require('../src/snow.js');
const SITE = require('../src/site.js');
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

// ---------- NBG Design Calcs' unbalanced snow document (ASCE 7-16, pg 51, Ce 1, Ct 1, Is 1, gable 60 ft, 1:12) ----------
{
  const r = S.roof({ ed: '7-16', pg: 51, Ce: 1, Ct: 1, risk: 'II', slope: 1, W: 30, gable: true });
  near(r.gamma, 20.6299991607666, 1e-6, 'snow density');                 // NBG stores float32
  near(r.ps, 35.70000076293945, 1e-6, 'sloped roof snow Ps');
  assert.strictEqual(r.pm, 20, 'Pmin');
  near(r.slopeDeg, 4.763641834259033, 1e-6, 'roof angle');
  near(r.unbalanced.surcharge, 13.304309844970703, 5e-6, 'unbalanced surcharge');
  near(r.unbalanced.length, 20.6368350982666, 5e-6, 'surcharge length');
  near(r.unbalanced.windward, 10.710000991821289, 1e-5, 'windward');
  near(r.unbalanced.leeward, 35.70000076293945, 1e-5, 'leeward');
}
// ASCE 7-22 balanced, no Is (the Shop's PCS, Ct 1.13 by its R-value): Box 4 shows 40.3 psf
near(S.roof({ ed: '7-22', pg: 51, Ce: 1, Ct: 1.13, risk: 'II', slope: 1 }).ps, 0.7 * 1.13 * 51, 1e-9, '7-22 ps');
assert.strictEqual(+(0.7 * 1.13 * 51).toFixed(1), 40.3);
// 7-22 drift height with the winter wind parameter: 1.5 √(pg^0.74 lu^0.70 W2^1.7 / γ)
near(S.driftHeight('7-22', 51, 30, 0.45).hd, 1.5 * Math.sqrt(Math.pow(51, 0.74) * Math.pow(30, 0.7) * Math.pow(0.45, 1.7) / 20.63), 1e-12, '7-22 hd');
assert.strictEqual(S.driftHeight('7-22', 51, 30, null).hd, null, '7-22 needs W2');
// fetch under 20 ft is 20 ft
near(S.driftHeight('7-16', 30, 8).hd, 0.43 * Math.cbrt(20) * Math.pow(40, 0.25) - 1.5, 1e-12, 'lu min 20');
// Cs: warm roof, other surfaces 1.0 up to 30°; slippery from 5°; Ct 1.2 slippery flat to 15°
assert.strictEqual(S.Cs(25, 1, false), 1);
near(S.Cs(40, 1, false), 1 - 10 / 40, 1e-12, 'Cs warm');
near(S.Cs(9.46, 1, true), 1 - 4.46 / 65, 1e-12, 'Cs warm slippery');
assert.strictEqual(S.Cs(9.46, 1.2, true), 1);
// importance and the minimum
assert.strictEqual(S.minimum({ ed: '7-16', pg: 15, risk: 'III' }), 15 * 1.1);
assert.strictEqual(S.minimum({ ed: '7-16', pg: 40, risk: 'III' }), 20 * 1.1);
assert.strictEqual(S.minimum({ ed: '7-22', pg: 40, risk: 'III' }), 20);
// rain-on-snow only for pg ≤ 20 on slopes under W/50 degrees
assert.strictEqual(S.roof({ ed: '7-16', pg: 20, Ce: 1, Ct: 1, risk: 'II', slope: 0.25, W: 100 }).rainOnSnow, 5);
assert.strictEqual(S.roof({ ed: '7-16', pg: 25, Ce: 1, Ct: 1, risk: 'II', slope: 0.25, W: 100 }).rainOnSnow, 0);

// ---------- roof step drift by hand: a lean-to 6.151 ft below a single-slope roof 99.04 ft wide (pg 40, Risk III) ----------
{
  const ps = 0.7 * 1 * 1 * 1.1 * 40, g = 0.13 * 40 + 14, h = (26 + 6.375 / 12) - (20 + 4.5625 / 12);
  const d = S.stepDrift({ ed: '7-16', pg: 40, psLower: ps, h, luUpper: 99 + 0.5 / 12, luLower: 28 + 2 / 12, lowerWidth: 28 + 2 / 12 });
  const hb = ps / g, hc = h - hb, hdLee = 0.43 * Math.pow(99 + 0.5 / 12, 1 / 3) * Math.pow(50, 0.25) - 1.5;
  const hdWin = 0.75 * (0.43 * Math.pow(28 + 2 / 12, 1 / 3) * Math.pow(50, 0.25) - 1.5);
  near(d.hb, hb, 1e-12, 'hb'); near(d.hc, hc, 1e-12, 'hc');
  near(d.leeward.hd, hdLee, 1e-12, 'leeward hd'); near(d.windward.hd, hdWin, 1e-12, 'windward hd');
  assert.strictEqual(d.gov, 'leeward'); assert.ok(!d.capped && !d.truncated);
  near(d.w, 4 * hdLee, 1e-12, 'w = 4 hd'); near(d.pd, hdLee * g, 1e-12, 'pd = hd γ');
  near(d.pd, 72.7745, 1e-3, 'pd value');
  near(S.driftAt(d, d.w / 2), d.pd / 2, 1e-12, 'linear');
  near(S.driftArea(d, 0, d.w), d.pd * d.w / 2, 1e-9, 'triangle area');
}
// hd above hc: w = 4 hd² / hc (≤ 8 hc) and hd held to hc
{
  const d = S.stepDrift({ ed: '7-16', pg: 60, psLower: 42, h: 4, luUpper: 300, luLower: 40, lowerWidth: 100 });
  const g = 0.13 * 60 + 14, hc = 4 - 42 / g, hd = 0.43 * Math.cbrt(300) * Math.pow(70, 0.25) - 1.5;
  assert.ok(hd > hc && d.capped);
  near(d.hd, hc, 1e-12, 'capped hd'); near(d.w, Math.min(4 * hd * hd / hc, 8 * hc), 1e-12, 'capped w'); near(d.pd, hc * g, 1e-12, 'capped pd');
}
// wider than the lower roof: cut off at the far edge at the height it has there
{
  const d = S.stepDrift({ ed: '7-10', pg: 15, psLower: 13.86, h: 22.109375, luUpper: 490.5, luLower: 105, lowerWidth: 21 + 10 / 12 });
  assert.ok(d.truncated);
  near(d.end, d.pd * (1 - (21 + 10 / 12) / d.w), 1e-12, 'truncated end');
  assert.strictEqual(S.driftAt(d, 22), 0, 'nothing past the roof');
  near(S.driftArea(d, 0, 100), d.pd * (21 + 10 / 12) - d.pd * Math.pow(21 + 10 / 12, 2) / (2 * d.w), 1e-9, 'truncated area');
}
// too little clear height: no drift; windward governs with a short upper roof
assert.ok(S.stepDrift({ ed: '7-16', pg: 30, psLower: 21, h: 1.3, luUpper: 100, luLower: 50, lowerWidth: 50 }).none);
assert.strictEqual(S.stepDrift({ ed: '7-16', pg: 30, psLower: 21, h: 10, luUpper: 20, luLower: 200, lowerWidth: 200 }).gov, 'windward');
// a separate higher building 10 ft away, 5 ft taller: leeward held to (6h − s) / 6, w to 6h − s
{
  const d = S.stepDrift({ ed: '7-16', pg: 50, psLower: 35, h: 5, luUpper: 200, luLower: 30, lowerWidth: 60, s: 10 });
  const hd = Math.min(0.43 * Math.cbrt(200) * Math.pow(60, 0.25) - 1.5, (30 - 10) / 6);
  near(d.leeward.hd, hd, 1e-12, 'separated hd');
  assert.ok(S.stepDrift({ ed: '7-16', pg: 50, psLower: 35, h: 5, luUpper: 200, luLower: 30, lowerWidth: 60, s: 25 }).leeward.hd === 0, 's ≥ 20 ft: no leeward');
}
// sliding: 0.4 pf W over 15 ft, scaled down on a narrower lower roof
{
  const sl = S.sliding({ pfUpper: 21, Wupper: 60, slopeUpper: 3, slippery: false, lowerWidth: 40, h: 4, drains: true });
  near(sl.perFt, 504, 1e-9, 'sliding per ft'); near(sl.psf, 504 / 15, 1e-9, 'sliding psf');
  const nar = S.sliding({ pfUpper: 21, Wupper: 60, slopeUpper: 3, slippery: false, lowerWidth: 10, h: 4, drains: true });
  near(nar.perFt, 336, 1e-9, 'narrow lower roof'); near(nar.psf, 33.6, 1e-9, 'same psf');
  assert.ok(!S.sliding({ pfUpper: 21, Wupper: 60, slopeUpper: 1, slippery: false, lowerWidth: 40, drains: true }).applies, 'not steep enough');
  assert.ok(S.sliding({ pfUpper: 21, Wupper: 60, slopeUpper: 1, slippery: true, lowerWidth: 40, drains: true }).applies, 'slippery from 1/4 on 12');
}
assert.deepStrictEqual(['IBC 2024', 'IBC 2021', 'KBC 2018 ASCE 7-10', 'IBC 2015'].map(t => S.editionOf(t).ed), ['7-22', '7-16', '7-10', '7-10']);

// ---------- site: placing attached buildings, and a step's drift on the lower frames ----------
{
  const b = (name, o) => ({ building: { name, profile: 'Gable', ...o }, frames: [], roof: { Ct: 1, obstruction: true } });
  // a lean-to on the high side of a single-slope building, back to back (BSW to BSW), 6 ft below
  const pcs = {
    site: {
      Main: b('Main', { profile: 'Single Slope', width: 100, length: 120, eaveFSW: 24, eaveBSW: 30, slopeFSW: 0.72, bays: [30, 30, 30, 30] }),
      LT: b('LT', { profile: 'Lean-To', width: 24, length: 120, eaveFSW: 23, eaveBSW: 24, slopeFSW: 0.5, bays: [30, 30, 30, 30] }),
    },
    attachments: [{ building: 'LT', wall: 'BSW', to: 'Main', toWall: 'BSW', at: 0 }],
  };
  const site = SITE.place(pcs), LT = site.buildings.find(q => q.name === 'LT');
  // turned 180°: the lean-to's LEW end sits at the main building's REW end
  assert.deepStrictEqual(LT.toSite([0, 24]).map(v => +v.toFixed(9)), [120, 100]);
  assert.deepStrictEqual(LT.toSite([0, 0]).map(v => +v.toFixed(9)), [120, 124]);
  const J = SITE.snowJob(pcs, { ed: '7-16', pg: 40, Ce: 1, risk: 'II' });
  const d = J.drifts[0];
  assert.strictEqual(d.lower, 'LT'); assert.strictEqual(d.kind, 'side'); near(d.hMin, 6, 1e-9, 'step'); near(d.luUpper, 100, 0, 'fetch = upper width');
  const ps = 28, g = 19.2, hd = 0.43 * Math.cbrt(100) * Math.pow(50, 0.25) - 1.5, pd = hd * g;
  near(d.drift.hd, hd, 1e-12, 'job hd');
  const f2 = d.frames.find(f => f.frame === 2), f1 = d.frames.find(f => f.frame === 1);
  assert.strictEqual(f2.segs.length, 1);
  // the high wall is the lean-to's BSW (24 ft from its FSW): −pd × 30 ft there, 0 at 4 hd toward the FSW
  near(f2.segs[0].end, -pd * 30 / 1000, 1e-12, 'max at the wall'); near(f2.segs[0].to, 24, 1e-12, 'at the BSW');
  near(f2.segs[0].start, 0, 1e-12, 'zero at w'); near(f2.segs[0].from, 24 - 4 * hd, 1e-12, 'w from the wall');
  near(f1.segs[0].end, -pd * 15 / 1000, 1e-12, 'end frame: half bay');
  assert.ok(ps / g < 6);
}
// an endwall step: a low building against a tall one's endwall gets the drift on its end frames, uniform across them
{
  const pcs = {
    site: {
      Tall: { building: { name: 'Tall', profile: 'Gable', width: 60, length: 100, ridge: 30, eaveFSW: 30, eaveBSW: 30, slopeFSW: 1, slopeBSW: 1, bays: [25, 25, 25, 25] }, roof: { Ct: 1, obstruction: true } },
      Low: { building: { name: 'Low', profile: 'Gable', width: 60, length: 80, ridge: 30, eaveFSW: 16, eaveBSW: 16, slopeFSW: 1, slopeBSW: 1, bays: [20, 20, 20, 20] }, roof: { Ct: 1, obstruction: true } },
    },
    attachments: [{ building: 'Low', wall: 'LEW', to: 'Tall', toWall: 'REW', at: 0 }],
  };
  const J = SITE.snowJob(pcs, { ed: '7-16', pg: 30, Ce: 1, risk: 'II' });
  const d = J.drifts[0];
  assert.strictEqual(d.kind, 'end'); assert.strictEqual(d.lowerWall, 'LEW');
  near(d.luUpper, 100, 0, 'fetch = upper length');
  // at the eaves the step is 14 ft; at the ridges both rakes rise 2.5 ft: 14 ft all along
  near(d.hMin, 14, 1e-9, 'step at eave'); near(d.hMax, 14, 1e-9, 'step at ridge');
  const dr = d.drift, f1 = d.frames.find(f => f.frame === 1), f2 = d.frames.find(f => f.frame === 2);
  // frame 1's strip is the first 10 ft from the step; frame 2's 10–30 ft
  near(f1.segs[0].start, -S.driftArea(dr, 0, 10) / 1000, 1e-12, 'frame 1 = drift over 0–10 ft');
  near(f2.segs[0].start, -S.driftArea(dr, 10, 30) / 1000, 1e-12, 'frame 2 = drift over 10–30 ft');
  assert.deepStrictEqual(f1.segs.map(s => [s.from, s.to, s.panel]), [[0, 30, 1], [30, 60, 2]], 'across both roof panels');
}

// unbalanced snow each way (NBG Design Calcs' WindToRight / WindToLeft): an equal gable the same both ways; an unequal
// one (ridge 20 ft from the FSW, 1.5 on 12 there, 0.75 on 12 to the BSW) its own each way — hd on the windward eave-to-
// ridge run, S of the leeward slope — and the larger surcharge stands for the roof
{
  const one = (name, bld) => SITE.snowJob({ site: { [name]: { building: { name, profile: 'Gable', length: 100, bays: [25, 25, 25, 25], ...bld }, roof: { Ct: 1, obstruction: true } } }, attachments: [] }, { ed: '7-16', pg: 40, Ce: 1, risk: 'II' }).roofs[0];
  const eq = one('Eq', { width: 60, ridge: 30, eaveFSW: 20, eaveBSW: 20, slopeFSW: 1, slopeBSW: 1 }).unbalanced;
  assert.ok(eq.same && eq.dirs.FSW.surcharge === eq.dirs.BSW.surcharge && eq.surcharge === eq.dirs.FSW.surcharge, 'equal gable: the same each way');
  const r = one('Uneq', { width: 60, ridge: 20, eaveFSW: 20, eaveBSW: 20, slopeFSW: 1.5, slopeBSW: 0.75 }), u = r.unbalanced, g = 0.13 * 40 + 14;
  const hd = lu => 0.43 * Math.cbrt(lu) * Math.pow(50, 0.25) - 1.5;
  near(r.ps, 28, 1e-9, 'ps'); near(u.dirs.FSW.windward, 8.4, 1e-9, 'windward 0.3 ps');
  near(u.dirs.FSW.surcharge, hd(20) * g / Math.sqrt(16), 1e-9, 'wind from the FSW: hd on the 20 ft run, S = 16 (the BSW slope)');
  near(u.dirs.FSW.length, 8 * hd(20) * 4 / 3, 1e-9, 'its length');
  near(u.dirs.BSW.surcharge, hd(40) * g / Math.sqrt(8), 1e-9, 'wind from the BSW: hd on the 40 ft run, S = 8 (the FSW slope)');
  near(u.dirs.BSW.length, 8 * hd(40) * Math.sqrt(8) / 3, 1e-9, 'its length');
  assert.ok(!u.same && u.gov === 'BSW' && u.surcharge === u.dirs.BSW.surcharge, 'the larger one governs');
}
// ---------- the sample jobs (private/pcs, gitignored), when present ----------
const PRIV = path.join(__dirname, '..', 'private', 'pcs');
const have = f => fs.existsSync(path.join(PRIV, f));
const run = async () => {
  if (!have('PCS_job4.pdf') || !(process.env.PDFJS_DIST || fs.existsSync(path.join(__dirname, '..', 'node_modules', 'pdfjs-dist')))) { console.log('snow tests passed (sample jobs not present, skipped)'); return; }
  const { readPcs } = require('./pdf-node.js'), PCS = require('../src/pcs.js');
  const job = async f => { const p = PCS.parse(await readPcs(path.join(PRIV, f))); return { p, J: SITE.snowJob(p, { ed: S.editionOf(p.code && p.code.text).ed, pg: p.seismic.groundSnow, Ce: p.seismic.Ce, risk: p.seismic.risk, W2: p.seismic.W2 }) }; };
  // W1G-26097: the lean-to 6.151 ft below the Sanctuary's high eave: leeward drift over the Sanctuary's 99 ft
  const a = await job('PCS_job4.pdf'), d = a.J.drifts[0];
  assert.strictEqual(d.lower, 'Lean To'); near(d.hMin, 6.151041666666668, 1e-9, 'W1G step');
  near(d.drift.pd, 72.7745, 1e-3, 'W1G pd'); near(d.drift.w, 15.1614, 1e-3, 'W1G w');
  const f3 = d.frames.find(f => f.frame === 3);
  near(f3.segs[0].end, -d.drift.pd * 19.5 / 1000, 1e-12, 'W1G frame 3 at the wall');
  // computed roof snow = Box 4 wherever the PCS has no override
  for (const f of ['PCS_job2.pdf', 'PCS_job5.pdf', 'PCS_job3.pdf']) if (have(f)) (await job(f)).J.roofs.forEach(r => assert.ok(r.pcsMatch !== false, `${f} ${r.name}: ${r.design} vs PCS ${r.pcsSnow && r.pcsSnow.value}`));
  // lean-tos flush with the main eave: no step, no drift
  if (have('PCS_job3.pdf')) assert.ok((await job('PCS_job3.pdf')).J.drifts.every(x => x.drift.none));
  // any sample job with a lower roof against a gable endwall: the rake raises the step toward the ridge; a long fetch
  // makes a drift wider than the lower roof, cut off at its far eave
  let extra = '';
  for (const f of fs.readdirSync(PRIV).filter(n => /\.pdf$/i.test(n) && n !== 'PCS_job4.pdf')) {
    let r;
    try { r = await job(f); } catch (e) { continue; }
    const c = r.J.drifts.find(x => /^(LEW|REW)$/.test(x.upperWall) && !x.drift.none);
    if (!c) continue;
    const ug = c.step.upper.g, lowEave = c.step.lower.g[c.lowerWall === 'BSW' ? 'eaveBSW' : 'eaveFSW'];
    near(c.luUpper, ug.length, 0, 'fetch along the endwall = the upper length');
    near(c.hMin, ug.eaveFSW - lowEave, 1e-9, 'step at the eave');
    near(c.hMax, ug.eaveFSW + ug.slopeFSW / 12 * (ug.width - ug.ridge) - lowEave, 1e-9, 'step at the ridge');
    if (c.drift.truncated) c.frames.forEach(fl => near(fl.segs[0].start / fl.segs[0].end, c.drift.end / c.drift.pd, 1e-9, 'cut off at the far eave'));
    const mid = c.frames[Math.floor(c.frames.length / 2)];
    extra = `; a lower roof against a ${ug.length} ft long gable endwall: ${c.frames.length} frames, ${(-mid.segs[0].end).toFixed(3)} → ${(-mid.segs[0].start).toFixed(3)} k/ft${c.drift.truncated ? ', cut off at its far eave' : ''}`;
  }
  console.log(`snow tests passed (NBG unbalanced snow to float precision; drift by hand: leeward / windward, capped, cut off, separated, sliding; W1G-26097 lean-to ${d.drift.pd.toFixed(2)} psf over ${d.drift.w.toFixed(2)} ft, frame 3 ${(-f3.segs[0].end).toFixed(3)} k/ft${extra})`);
};
run().catch(e => { console.error(e); process.exit(1); });
