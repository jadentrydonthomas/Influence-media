// Compare what the workbooks showed after typing the steps with what the tool says they will show.
// usage: node oracle/steps_check.js oracle/out/steps
const fs = require('fs');
const pre = process.argv[2];
const books = JSON.parse(fs.readFileSync(pre + '.json')), res = JSON.parse(fs.readFileSync(pre + '_res.json'));
let n = 0, bad = 0;
books.forEach((b, bi) => b.runs.forEach((run, ri) => run.read.forEach((r, k) => {
  const got = res[bi][ri][k], want = r.expect;
  n++;
  // three-decimal kips / ft as typed; deflection ratios to ±1 (the sheet shows whole numbers); text exactly
  const ok = typeof want === 'number' ? typeof got === 'number' && Math.abs(got - want) <= (/L \//.test(r.label) ? 1 : Math.max(0.0015, Math.abs(want) * 0.002)) : String(got) === String(want);
  if (!ok) { bad++; console.log(`  ✗ ${b.file} · ${run.tag} · ${r.sheet}!${r.cell} ${r.label}: Excel ${got} · tool ${want}`); }
})));
console.log(`${pre}: ${n} read-backs after typing the steps, ${bad} differ`);
process.exitCode = bad ? 1 : 0;
