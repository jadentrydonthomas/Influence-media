// Tie the job's answer to the workbook numbers (no engine in the loop):
//  1. every MB-sheet run of every mark passes on the workbook (G19 / G20 / Main Report OK, L/360, L/240, joist bearing)
//  2. the chosen section is the lightest workbook-passing row of the mark's depth table, at the target SR
//  3. every column case's left / right D and L = the sum of the workbook end shears (MB H6 / H10) of the beams framing in
//  4. the job-wide W passes all three combinations of every case on the Column sheet; every lighter W fails one
//  5. the loads to the frame = the sum of the workbook end shears at that building column
const fs = require('fs');
// usage: node oracle/job_ties.js oracle/out/job   (after beam_oracle.py / col_oracle.py on job_beam.json / job_col.json)
const pre = process.argv[2], target = 0.99;
const B = JSON.parse(fs.readFileSync(pre + '_beam.json')), BR = JSON.parse(fs.readFileSync(pre + '_beam_res.json'));
const C = JSON.parse(fs.readFileSync(pre + '_col.json')), CR = JSON.parse(fs.readFileSync(pre + '_col_res.json'));
const T = JSON.parse(fs.readFileSync(pre + '_ties.json'));
let bad = 0; const fail = m => { bad++; console.log('  ✗ ' + m); };
const n = v => (typeof v === 'number' ? v : parseFloat(v));
const passes = r => /OK/.test(r['MB.G19']) && /OK/.test(r['MB.G20']) && r['MR.G46'] === 'OK' && n(r['MB.K11']) >= 360 && n(r['MB.K15']) >= 240 && (r['CONC.G42'] == null || r['CONC.G42'] === 'OK');
// 1
B.forEach((c, i) => { if (c.role === 'run') { const r = BR[i]; if (!passes(r) || n(r['MR.G47']) > target || n(r['MR.G48']) > target) fail(`${c.tag}: workbook ${r['MB.G19']} / ${r['MB.G20']} CSR ${r['MR.G47']} SRv ${r['MR.G48']}`); else console.log(`  ✓ ${c.tag}: ${r['MB.M20']} CSR ${(+r['MR.G47']).toFixed(3)} SRv ${(+r['MR.G48']).toFixed(3)} L/${Math.round(r['MB.K11'])} L/${Math.round(r['MB.K15'])} · end shear D ${(+r['MB.H6']).toFixed(2)} L ${(+r['MB.H10']).toFixed(2)} k`); } });
// 2
[...new Set(B.filter(c => c.role === 'depth').map(c => c.mark))].forEach(mk => {
  const rows = B.map((c, i) => ({ c, r: BR[i] })).filter(x => x.c.role === 'depth' && x.c.mark === mk);
  const ok = rows.filter(x => passes(x.r) && n(x.r['MR.G47']) <= target && n(x.r['MR.G48']) <= target);
  const light = ok.slice().sort((a, b) => n(a.r['SR.G22']) - n(b.r['SR.G22']))[0], ch = rows.find(x => x.c.chosen);
  if (ok.length !== rows.length) fail(`${mk}: ${rows.length - ok.length} depth-table rows fail on the workbook`);
  if (!ch || light.r['MB.M20'] !== ch.r['MB.M20']) fail(`${mk}: lightest workbook-passing row is ${light.r['MB.M20']}, chosen ${ch && ch.r['MB.M20']}`);
  else console.log(`  ✓ ${mk}: ${ok.length}/${rows.length} depth rows pass on the workbook; lightest ${light.r['MB.M20']} (${(+light.r['SR.G22']).toFixed(2)} plf) = the quote section`);
});
// 3 + 5
const sh = new Map(T.shearIdx.map(([k, i]) => [k, { D: n(BR[i]['MB.H6']), L: n(BR[i]['MB.H10']) }]));
const close = (a, b) => Math.abs(a - b) <= 0.005;
T.ties.forEach(t => {
  if (t.frame) {
    const D = t.parts.reduce((a, p) => a + sh.get(p.key).D, 0), L = t.parts.reduce((a, p) => a + sh.get(p.key).L, 0);
    if (!close(D, t.frame.D) || !close(L, t.frame.L)) fail(`${t.tag}: D ${t.frame.D} L ${t.frame.L} vs workbook shears ${D} ${L}`);
    else console.log(`  ✓ ${t.tag}: D ${D.toFixed(2)} · L ${L.toFixed(2)} k = ${t.parts.map(p => p.key).join(' + ')} (MB H6 / H10)`);
    return;
  }
  const side = s => t.parts.filter(p => p.side === s).reduce((a, p) => ({ D: a.D + sh.get(p.key).D, L: a.L + sh.get(p.key).L }), { D: 0, L: 0 });
  const l = side('left'), r = side('right');
  if (!close(l.D, t.loads.DL_L) || !close(l.L, t.loads.LL_L) || !close(r.D, t.loads.DL_R) || !close(r.L, t.loads.LL_R)) fail(`${t.tag}: column inputs ${JSON.stringify(t.loads)} vs workbook shears L ${JSON.stringify(l)} R ${JSON.stringify(r)}`);
  else console.log(`  ✓ column ${t.tag}: left ${l.D.toFixed(2)} / ${l.L.toFixed(2)} · right ${r.D.toFixed(2)} / ${r.L.toFixed(2)} k = ${t.parts.map(p => p.key + ' (' + p.side + ')').join(' + ')}`);
});
// 4
const okCol = r => ['C', 'D', 'E'].every(L => /OK/.test(r['COL.' + L + '39']) && n(r['COL.' + L + '40']) < 1);
const names = [...new Set(C.map(c => c.sec.name))];
const res = names.map(nm => ({ nm, all: C.map((c, i) => ({ c, r: CR[i] })).filter(x => x.c.sec.name === nm) })).map(x => ({ ...x, ok: x.all.every(y => okCol(y.r)), max: Math.max(...x.all.map(y => Math.max(...['C', 'D', 'E'].map(L => n(y.r['COL.' + L + '40']))))) }));
const chosen = [...new Set(T.chosenCol)];
if (chosen.length !== 1) fail('more than one column section: ' + chosen);
const first = res.find(x => x.ok);
res.forEach(x => console.log(`  ${x.ok ? '✓' : '·'} ${x.nm}: ${x.ok ? 'passes every case' : 'fails at least one case'} on the Column sheet (max CSR ${x.max.toFixed(3)}, ${x.all.length} cases)`));
if (!first || first.nm !== chosen[0]) fail(`lightest workbook-passing W is ${first && first.nm}, chosen ${chosen}`);
else console.log(`  ✓ job column ${chosen[0]} = the lightest W (try order) that passes every case on the workbook`);
console.log(`${pre}: ${bad ? bad + ' FAILED' : 'all tied to the workbooks'}`);
process.exitCode = bad ? 1 : 0;
