// The beam options (src/design.js beamOptions) on the sample jobs: lightest, the step-by-step best fit, the most
// economical by NBG "Economical Flange Sections", merged when they land on one section, alternates when fewer than
// three different designs come out, and what more depth would give when the clearance leaves one design.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DESIGN = require('../src/design.js');

// the economical-flange matrix as the sheet colours it
assert.deepStrictEqual([[8, 0.3125], [8, 0.25], [8, 0.625], [6, 0.5], [10, 0.375], [12, 0.375], [12, 1]].map(([b, t]) => DESIGN.TIER[DESIGN.tierOf(b, t)]), ['G', 'Y', 'Y', 'Y', 'G', 'Y', 'G']);
assert.strictEqual(DESIGN.flangeName(12, 1), 'F12×1');

const dir = path.join(__dirname, '..', 'private', 'pcs');
let ok = fs.existsSync(path.join(dir, 'PCS_job3.pdf'));
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { ok = false; }
if (!ok) { console.log('options tests passed (flange matrix; sample jobs not present, skipped)'); process.exit(0); }
const { loadJob } = require('../oracle/job_load.js');
const pick = (m, k) => (m.options.find(o => o.key === k) || {}).pick;
(async () => {
  // W2H-26018 (the quoted job: MB1 BU24x30): lightest = most economical; the step-by-step best fit lands deeper
  {
    const { job } = await loadJob(path.join(dir, 'Project_Confirmation_Summary_W2H-26018.pdf'));
    const mb1 = job.marks.find(m => m.mark === 'MB1');
    assert.strictEqual(pick(mb1, 'lightest').desc, 'BU24x30');
    assert.strictEqual(pick(mb1, 'econ').desc, 'BU24x30');
    const fit = mb1.options.find(o => o.key === 'fit');
    assert.deepStrictEqual(fit.steps.map(s => s.step), ['depth', 'web', 'flange', 'reduce', 'cut']);
    assert.ok(/F8\.31 is the first that passes at 30"/.test(fit.steps[2].text), fit.steps[2].text);
    assert.ok(/still passes at 26"/.test(fit.steps[3].text) && /at 25" it does not/.test(fit.steps[3].text), fit.steps[3].text);
    assert.strictEqual(fit.pick.desc, 'BU26x31');
    assert.ok(fit.dominated && /lighter and no deeper/.test(fit.why), 'the method stopping deeper and heavier than the lightest is said');
    // three different designs on the cards: an alternate fills in
    assert.strictEqual(new Set(mb1.options.map(o => o.pick.desc)).size, 3);
    assert.ok(mb1.options.every(o => o.pick.CSR <= 0.99 && o.pick.SRv <= 0.99 && o.pick.rLL >= 360 && o.pick.rTL >= 240));
  }
  // W1S-26062: the clearance leaves 15" — one design per mark, and what 16"–21" would give with C lowered
  {
    const { job } = await loadJob(path.join(dir, 'PCS_job3.pdf'));
    const mb1 = job.marks.find(m => m.mark === 'MB1');
    assert.deepStrictEqual([...new Set(mb1.options.map(o => o.pick.desc))], ['BU15x95']);
    assert.ok(mb1.options.every(o => o.sameAs.length === 2), 'lightest = best fit = most economical');
    assert.deepStrictEqual(mb1.deeper.map(z => z.d), [16, 17, 18, 19, 20, 21]);
    assert.ok(mb1.deeper.every(z => z.wt < pick(mb1, 'lightest').wt && z.needC < 9.5));
    assert.ok(Math.abs(mb1.deeper[0].needC - (11.5 - (4 + 5) / 12 - 16 / 12)) < 1e-9, 'C = A − slab − seat − d');
    const fl = mb1.options.find(o => o.key === 'fit').steps.find(s => s.step === 'flange');
    assert.ok(/F12×1 is the first that passes at 15", on W313 \(production/.test(fl.text), fl.text);
  }
  // W0S-26160 MB2: the lightest uses a somewhat-economical (yellow) flange; the most economical is green
  {
    const { job } = await loadJob(path.join(dir, 'PCS_job2.pdf'));
    const mb2 = job.marks.find(m => m.mark === 'MB2');
    assert.strictEqual(pick(mb2, 'lightest').tier, 'Y');
    assert.strictEqual(pick(mb2, 'econ').tier, 'G');
    assert.ok(pick(mb2, 'econ').wt > pick(mb2, 'lightest').wt);
  }
  console.log('options tests passed (W2H-26018 lightest = economical BU24x30, best fit by the step-by-step method BU26x31 (said to stop deeper); W1S-26062 one design at 15" with 16"–21" listed for a lower C; W0S-26160 MB2 green over yellow)');
})().catch(e => { console.error(e); process.exit(1); });
