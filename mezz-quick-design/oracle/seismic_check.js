// The seismic engine (src/seismic.js) against NBG's IBC Seismic workbook, case by case.
//   node oracle/seismic_check.js cases oracle/out/seis_cases.json        (write the cases)
//   python3 oracle/seismic_oracle.py oracle/out/seis_cases.json oracle/out/seis_res.json
//   node oracle/seismic_check.js check oracle/out/seis_cases.json oracle/out/seis_res.json
const fs = require('fs');
const S = require('../src/seismic.js');

const ED = { 1: '7-05', 2: '7-05', 3: '7-10', 4: '7-10', 5: '7-10', 6: '7-16', 7: '7-16' };
const RC = { 'Low Hazard': 'I', 'Standard Buildings': 'II', 'Substantial Hazard': 'III', 'Essential Facilities': 'IV' };
const base = {
  code: 7, occupancy: 'Standard Buildings', rooftype: 'Gable', width: 120, length: 140, dtr: 60, slope: 1, leh: 25, heh: 25,
  Ss: 0.169, S1: 0.058, site: 'D', SW: 2, RDL: 4.66, CDL: 6, RSW: 1, Pf: 30, walls: { lew: 3, rew: 3, fsw: 3, bsw: 3 }, vertical: true,
  mezz: [{ elev: 11.5, FDL: 55, FLC: 5, FLJ: 8, FLL: 125, FLP: 0, storage: true }, { elev: 11.5, FDL: 55, FLC: 5, FLJ: 8, FLL: 125, FLP: 0, storage: true }],
  lat: { type: 'Rigid Frame', bay: 28, at: 3, story: false, area: [672, 936], conc: [0, 0] },
  long: { types: ['X-Bracing', 'X-Bracing'], area: [3360, 1440], conc: [0, 0] },
};
const v = (o, p) => JSON.parse(JSON.stringify({ ...base, ...o, lat: { ...base.lat, ...(o.lat || {}) }, long: { ...base.long, ...(o.long || {}) } }));
const CASES = [
  ['W1S-26062 frame 2 (interior rigid frame, both mezzanines)', v({})],
  ['W1S-26062 frame 1 (LEW rigid end frame)', v({ lat: { bay: 14, at: 1, area: [336, 504] } })],
  ['post & beam right endwall', v({ lat: { type: 'Post & Beam', bay: 14, at: 2, area: [336, 0] } })],
  ['single slope, RC III, one mezzanine (W1G-26097-like)', v({ occupancy: 'Substantial Hazard', rooftype: 'Single Slope', width: 99.0417, length: 158.625, dtr: 0, slope: 0.25, leh: 24.4688, heh: 26.5313, Ss: 0.2, S1: 0.093, RDL: 3.5, CDL: 7, Pf: 40,
    mezz: [{ elev: 16, FDL: 62.5, FLC: 7, FLJ: 8, FLL: 125, FLP: 0, storage: false }], lat: { bay: 19.82, area: [1962.7], conc: [0] }, long: { area: [15710], conc: [0] } })],
  ['SDC D, 11.4.8 exception (Ss 1.5, S1 0.15)', v({ Ss: 1.5, S1: 0.15 })],
  ['ASCE 7-10, site C, RC IV, interpolated Fa / Fv', v({ code: 5, occupancy: 'Essential Facilities', Ss: 0.6, S1: 0.25, site: 'C' })],
  ['ASCE 7-05, Ss 1.8 cap, S1 0.7 minimum', v({ code: 2, occupancy: 'Substantial Hazard', Ss: 1.8, S1: 0.7, site: 'B' })],
  ['SDC A (Ss 0.1, S1 0.04, site B)', v({ Ss: 0.1, S1: 0.04, site: 'B' })],
  ['snow 40 psf (20 % in W), partition 15 psf, conc. loads', v({ Pf: 40, mezz: [{ elev: 14, FDL: 50, FLC: 5, FLJ: 8, FLL: 100, FLP: 15, storage: false }, { elev: 10, FDL: 45, FLC: 3, FLJ: 7, FLL: 125, FLP: 0, storage: true }], lat: { conc: [2.5, 0] }, long: { conc: [5, 1] } })],
  ['no vertical distribution (k = 0)', v({ vertical: false })],
  ['ignore "not detailed for seismic" (OMF, R 3.5)', v({ ignoreNDFS: true })],
  ['unequal gable, ridge 40 ft from the BSW', v({ width: 100, dtr: 40, leh: 18, heh: 20, lat: { bay: 25, area: [600, 0] } })],
  ['SDC D, mezzanine a story, portal frame + X-brace', v({ Ss: 1.0, S1: 0.4, site: 'D', lat: { story: true }, long: { types: ['Portal Frame', 'X-Bracing'] } })],
  ['tall, T > 0.5 s (k > 1)', v({ leh: 60, heh: 60, Ss: 0.5, S1: 0.2, site: 'C' })],
  ['rigid mezzanine diaphragm (accidental torsion 1.10 on the bracing)', v({ rigid: true })],
];

function engine(c) {
  const d = S.design({ ed: ED[c.code], Ss: c.Ss, S1: c.S1, siteClass: c.site, risk: RC[c.occupancy] });
  const g = { width: c.width, length: c.length, rooftype: c.rooftype, dtr: c.dtr, slope: c.slope, leh: c.leh, heh: c.heh };
  const j = { d, g, roof: { SW: c.SW, RSW: c.RSW, RDL: c.RDL, CDL: c.CDL, Pf: c.Pf, P: 0 }, walls: c.walls, vertical: c.vertical, ignoreNDFS: !!c.ignoreNDFS, story: !!c.lat.story, rigid: !!c.rigid };
  const mz = (area, conc) => c.mezz.map((m, i) => ({ id: `Mezz ${i + 1}`, ...m, area: area[i] || 0, conc: conc[i] || 0 })).filter(m => m.area || m.conc);
  const lat = S.lateral(j, { type: c.lat.type, bay: c.lat.bay, at: { 1: 'lew', 2: 'rew', 3: 'interior' }[c.lat.at], mezz: mz(c.lat.area, c.lat.conc) });
  const long = S.longitudinal(j, { types: c.long.types, torsion: c.rigid ? 1.1 : 1, mezz: mz(c.long.area, c.long.conc) });
  return { d, g, lat, long };
}

if (process.argv[2] === 'cases') {
  fs.writeFileSync(process.argv[3], JSON.stringify(CASES.map(c => c[1]), null, 1));
  console.log(CASES.length, 'cases →', process.argv[3]);
} else if (process.argv[2] === 'check') {
  const cases = JSON.parse(fs.readFileSync(process.argv[3])), res = JSON.parse(fs.readFileSync(process.argv[4]));
  let bad = 0, n = 0;
  const cmp = (tag, a, b, tol = 2e-5) => {
    n++;
    const num = x => (typeof x === 'number' ? x : x === '' || x === '--' || x == null ? null : +x);
    const A = num(a), B = num(b);
    const ok = typeof b === 'string' && isNaN(+b) && b !== '--' && b !== '' ? String(a) === b : A == null || B == null ? (A == null) === (B == null) : Math.abs(A - B) <= tol * Math.max(1, Math.abs(B));
    if (!ok) { bad++; console.log(`   ✗ ${tag}: engine ${a} · workbook ${b}`); }
  };
  cases.forEach((c, i) => {
    const w = res[i], e = engine(c), name = CASES[i] ? CASES[i][0] : `case ${i + 1}`;
    const before = bad;
    cmp('Fa', e.d.Fa, w.Fa); cmp('Fv', e.d.Fv, w.Fv); cmp('SDS', e.d.SDS, w.Sds); cmp('SD1', e.d.SD1, w.Sd1); cmp('SDC', e.d.SDC, w.SDC); cmp('mrh', e.lat.hn, w.mrh);
    const L = e.lat, WL = w.lat;
    cmp('lat R', L.R, WL.R); cmp('lat Ct', L.sys.Ct, WL.Ct); cmp('lat Ta', L.Ta, WL.Ta); cmp('lat Cs', L.cs.Cs, WL.Cs); cmp('lat k', L.k, WL.k);
    const row = (rows, key, id) => rows.find(r => r.key === key && (id == null || r.id === id));
    const five = (t, r, wr) => { if (!r) { cmp(t + ' W', 0, wr[0] === '--' ? 0 : wr[0]); return; } ['W', 'h', 'D', 'Fx', 'M'].forEach((k, q) => cmp(`${t} ${k}`, r[k], wr[q])); };
    five('lat roof', row(L.rows, 'roof'), WL.rows['67']);
    if (c.lat.at !== 3) five('lat endwall', row(L.rows, 'endwall'), WL.rows['68']);
    five('lat FSW', row(L.rows, 'fsw'), WL.rows['70']); five('lat BSW', row(L.rows, 'bsw'), WL.rows['72']);
    five('lat mezz 1', row(L.rows, 'mezz', 'Mezz 1'), WL.rows['77']); five('lat mezz 2', row(L.rows, 'mezz', 'Mezz 2'), WL.rows['78']);
    cmp('lat ΣW', L.W, WL.rows['79'][0]); cmp('lat ΣD', L.rows.reduce((a, r) => a + r.D, 0), WL.rows['79'][2]); cmp('lat ΣFx', L.V, WL.rows['79'][3]); cmp('lat ΣM', L.M, WL.rows['79'][4]);
    cmp('lat roof override (G67)', L.roofOverride, WL.G67); cmp('lat alt. roof (G64)', L.altRoof, WL.G64);
    cmp('lat FSW load (G70)', L.wallLoads[0].F, WL.G70); cmp('lat BSW load (G72)', L.wallLoads[1].F, WL.G72);
    const m1 = L.mezzLoads.find(m => m.id === 'Mezz 1'), m2 = L.mezzLoads.find(m => m.id === 'Mezz 2');
    if (m1) cmp('lat mezz 1 load (G77)', m1.F, WL.G77); if (m2) cmp('lat mezz 2 load (G78)', m2.F, WL.G78);
    cmp('lat frame base shear (H79)', L.frameV, WL.H79);
    cmp('lat limit warning', L.limit ? 'warn' : '', WL.warn ? 'warn' : '');
    const G = e.long, WG = w.long;
    cmp('long R', G.sys.R, WG.R); cmp('long Ta', G.Ta, WG.Ta); cmp('long Cs', G.cs.Cs, WG.Cs); cmp('long k', G.k, WG.k);
    five('long roof', row(G.rows, 'roof'), WG.rows['63']); five('long LEW', row(G.rows, 'lew'), WG.rows['64']); five('long REW', row(G.rows, 'rew'), WG.rows['66']);
    five('long FSW', row(G.rows, 'fsw'), WG.rows['70']); five('long BSW', row(G.rows, 'bsw'), WG.rows['72']);
    five('long mezz 1', row(G.rows, 'mezz', 'Mezz 1'), WG.rows['77']); five('long mezz 2', row(G.rows, 'mezz', 'Mezz 2'), WG.rows['78']);
    cmp('long ΣFx', G.V, WG.rows['79'][3]); cmp('long roof psf (H66)', G.roofPsf, WG.H66);
    cmp('long FSW load (G70)', G.wallLoads[0].F, WG.G70); cmp('long BSW load (G72)', G.wallLoads[1].F, WG.G72);
    const g1 = G.mezzLoads.find(m => m.id === 'Mezz 1'); if (g1) cmp('long mezz 1 load (G77)', g1.F, WG.G77);
    cmp('bracing base shear (H79)', G.bracingV, WG.H79);
    console.log(`${bad === before ? '✓' : '✗'} ${name}: SDC ${e.d.SDC}, lateral Cs ${L.cs.Cs.toFixed(4)} V ${L.V.toFixed(2)} k (mezz ${L.mezzLoads.map(m => m.F.toFixed(2)).join(' + ')}), bracing V ${G.bracingV.toFixed(2)} k`);
  });
  console.log(`${n - bad}/${n} values tie to the workbook`);
  process.exit(bad ? 1 : 0);
}
