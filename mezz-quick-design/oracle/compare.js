// Compare engine output against workbook (oracle) results.
// usage: node compare.js beam|column cases.json results.json [edition]
const fs = require('fs');
const path = require('path');
const MZ = require('../src/engine.js');
const WF = require('../src/wf-db.js');

const [, , kind, casesFile, resFile, edition = '15'] = process.argv;
const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const res = JSON.parse(fs.readFileSync(resFile, 'utf8'));

const TOL = 0.002;                   // relative tolerance on ratios / forces
let bad = 0, checked = 0;
const fails = {};

function rel(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return a === b ? 0 : Infinity;
  if (!isFinite(a) && !isFinite(b)) return 0;
  const m = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / (m < 1 ? 1 : m);
}
function cmp(i, key, eng, wb) {
  checked++;
  let d;
  // a workbook error (#VALUE!) matches any engine failure: NaN / Infinity / "NG" / "... (SR = NaN)"
  if (wb === '#ERR') d = (typeof eng === 'number' && !isFinite(eng)) || /NG|NaN|Infinity/.test(String(eng)) ? 0 : Infinity;
  else if (typeof wb === 'string' || typeof eng === 'string') d = String(eng) === String(wb) ? 0 : Infinity;
  else d = rel(eng, wb);
  if (d > TOL) {
    bad++;
    (fails[key] = fails[key] || []).push(i);
    if (fails[key].length <= 3) console.log(`  #${i} ${key}: engine=${eng} workbook=${wb}`);
  }
}
const num = v => (typeof v === 'number' ? v : (v === '--' || v === '' ? '--' : v));

cases.forEach((c, i) => {
  const r = res[i];
  if (kind === 'beam') {
    const b = MZ.beamCheck({ ...c, edition }, WF);
    cmp(i, 'Wt', b.res.Wt, r['SR.G22']);
    cmp(i, 'Ix', b.res.Ix, r['MB.D17']);
    cmp(i, 'V_D', b.V.D, r['MB.H6']); cmp(i, 'V_L', b.V.L, r['MB.H10']); cmp(i, 'V_T', b.V.T, r['MB.H14']);
    cmp(i, 'M_T', b.M.T, r['MB.H16']);
    cmp(i, 'L/dDL', b.defl.rDL, r['MB.K7']); cmp(i, 'L/dLL', b.defl.rLL, r['MB.K11']); cmp(i, 'L/dTL', b.defl.rTL, r['MB.K15']);
    cmp(i, 'desc', b.desc, r['MB.M20']);
    cmp(i, 'CSR', b.res.CSR, num(r['MR.G47']));
    cmp(i, 'SRv', b.res.SRvx, num(r['MR.G48']));
    cmp(i, 'MR.G46', b.strengthOK ? 'OK' : 'NG', r['MR.G46']);
    cmp(i, 'G19', b.combinedText, r['MB.G19']);
    cmp(i, 'G20', b.shearText, r['MB.G20']);
    if (b.conc) {
      cmp(i, 'conc.WLY', b.conc.WLY, num(r['CONC.G44']));
      cmp(i, 'conc.WC', b.conc.WC, num(r['CONC.G45']));
      cmp(i, 'conc.WSB', b.conc.WSB === null ? '--' : b.conc.WSB, num(r['CONC.G46']));
      cmp(i, 'conc.OK', b.conc.ok ? 'OK' : 'NG', r['CONC.G42']);
    }
  } else {
    const col = MZ.columnCheck({ ...c, Lby: c.Lby ?? c.L * 12, edition }, WF);
    ['C', 'D', 'E'].forEach((L, k) => {
      cmp(i, 'Mx' + k, col.combos[k].Mx, r['COL.' + L + '33']);
      cmp(i, 'P' + k, col.combos[k].P, r['COL.' + L + '34']);
      cmp(i, 'CSR' + k, col.combos[k].csr, num(r['COL.' + L + '40']));
      cmp(i, 'OK' + k, col.combos[k].okText, r['COL.' + L + '39']);
    });
  }
});
console.log(`${kind} ed${edition}: ${cases.length} cases, ${checked} comparisons, ${bad} mismatches`);
for (const [k, v] of Object.entries(fails)) console.log(`  ${k}: ${v.length} (cases ${v.slice(0, 12).join(',')}${v.length > 12 ? ',…' : ''})`);
process.exitCode = bad ? 1 : 0;
