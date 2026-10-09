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
  // W2H-26018 (the quoted job: MB1 BU24x30): lightest = most economical; the step-by-step method stops at 26" (BU26x31),
  // which the lightest beats, so best fit takes the method's next step — a lesser depth: 23" BU23x32
  {
    const { job } = await loadJob(path.join(dir, 'Project_Confirmation_Summary_W2H-26018.pdf'));
    const mb1 = job.marks.find(m => m.mark === 'MB1');
    assert.strictEqual(pick(mb1, 'lightest').desc, 'BU24x30');
    assert.strictEqual(pick(mb1, 'econ').desc, 'BU24x30');
    const fit = mb1.options.find(o => o.key === 'fit');
    assert.deepStrictEqual(fit.steps.map(s => s.step), ['depth', 'web', 'flange', 'reduce', 'cut', 'alternate']);
    assert.ok(/F8\.31 is the first that passes at 30"/.test(fit.steps[2].text), fit.steps[2].text);
    assert.ok(/still passes at 26"/.test(fit.steps[3].text) && /at 25" it does not/.test(fit.steps[3].text), fit.steps[3].text);
    assert.ok(/BU26x31/.test(fit.steps[5].text) && /at 23"/.test(fit.steps[5].text), fit.steps[5].text);
    assert.strictEqual(fit.pick.desc, 'BU23x32');
    // three different designs on the cards, every one passing
    assert.strictEqual(new Set(mb1.options.map(o => o.pick.desc)).size, 3);
    assert.ok(mb1.options.every(o => o.pick.CSR <= 0.99 && o.pick.SRv <= 0.99 && o.pick.rLL >= 360 && o.pick.rTL >= 240));
  }
  // W1S-26062: the clearance leaves 15" — one design there; the other two cards are 16" and 17", each with the C it needs
  {
    const { job } = await loadJob(path.join(dir, 'PCS_job3.pdf'));
    const mb1 = job.marks.find(m => m.mark === 'MB1');
    assert.strictEqual(pick(mb1, 'lightest').desc, 'BU15x95');
    assert.strictEqual(pick(mb1, 'econ').desc, 'BU15x95');
    assert.ok(!mb1.options.some(o => o.key === 'fit'), 'nothing shallower passes: no best fit');
    const deep = mb1.options.filter(o => /^deeper/.test(o.key));
    assert.deepStrictEqual(deep.map(o => o.pick.desc), ['BU16x77', 'BU17x71']);
    assert.ok(Math.abs(deep[0].needC - (11.5 - (4 + 5) / 12 - 16 / 12)) < 1e-9, 'C = A − slab − seat − d');
    assert.deepStrictEqual(mb1.deeper.map(z => z.d), [16, 17, 18, 19, 20, 21]);
    const mb2 = job.marks.find(m => m.mark === 'MB2');
    assert.strictEqual(new Set(mb2.options.map(o => o.pick.desc)).size, 3);
  }
  // W0S-26160 MB2: the lightest uses a somewhat-economical (yellow) flange; the most economical is green
  {
    const { job } = await loadJob(path.join(dir, 'PCS_job2.pdf'));
    const mb2 = job.marks.find(m => m.mark === 'MB2');
    assert.strictEqual(pick(mb2, 'lightest').tier, 'Y');
    assert.strictEqual(pick(mb2, 'econ').tier, 'G');
    assert.ok(pick(mb2, 'econ').wt > pick(mb2, 'lightest').wt);
  }
  console.log('options tests passed (three different designs a mark: W2H-26018 lightest = economical BU24x30, best fit 23" BU23x32 by the method\'s lesser-depth step; W1S-26062 BU15x95 at the 15" cap with 16" / 17" options and the C each needs; W0S-26160 MB2 green over yellow)');
})().catch(e => { console.error(e); process.exit(1); });
