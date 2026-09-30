// Seeded random beam / column cases for the workbook-vs-engine sweep.
// usage: node gen_cases.js beam|column N seed > cases.json
const [, , kind = 'beam', N = '300', seed = '7'] = process.argv;
let s = +seed >>> 0;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = a => a[Math.floor(rnd() * a.length)];
const range = (a, b, step = 1) => Math.round((a + rnd() * (b - a)) / step) * step;

const WEBS = [0.1644, 0.1875, 0.22, 0.25, 0.275, 0.3125, 0.375, 0.5];
const FW = [5, 6, 8, 10, 12];
const FT = [0.1875, 0.25, 0.3125, 0.375, 0.5, 0.625, 0.75, 1];

function buSec(dmin, dmax) {
  const d = range(dmin, dmax, rnd() < 0.8 ? 1 : 0.5);
  const bof = pick(FW), tof = pick(FT);
  const same = rnd() < 0.75;
  return { type: 'BU', d, tw: pick(WEBS), bof, tof, bif: same ? bof : pick(FW), tif: same ? tof : pick(FT) };
}

const out = [];
if (kind === 'beam') {
  // guide examples first
  out.push({ dead: 37, coll: 15, live: 125, joistWt: 8, L: 19.083, Lb: 2, trib: 25, sec: { type: 'BU', d: 18, tw: 0.25, bof: 8, tof: 0.5, bif: 8, tif: 0.5 } });
  out.push({ dead: 37, coll: 15, live: 125, joistWt: 8, L: 19.083, Lb: 2, trib: 25, sec: { type: 'BU', d: 16, tw: 0.22, bof: 8, tof: 0.375, bif: 8, tif: 0.375 } });
  for (let i = out.length; i < +N; i++) {
    const L = range(8, 40, 0.5);
    const longLb = rnd() < 0.25;
    const c = {
      dead: range(15, 80), coll: range(0, 20), live: range(40, 250, 5), joistWt: range(4, 12),
      L, Lb: longLb ? range(6, L, 0.5) : pick([1, 2, 2.5, 3, 4, 5]),
      trib: range(3, 40, 0.5), sec: buSec(8, 36),
    };
    if (rnd() < 0.12) c.axial = range(-30, 30);
    out.push(c);
  }
} else {
  const W = ['W8X18', 'W8X24', 'W10X22', 'W12X26', 'W8X31', 'W10X33', 'W12X40', 'W14X43', 'W6X15', 'W8X10', 'W10X12', 'W12X14', 'W14X22', 'W8X40', 'W10X49'];
  out.push({ sec: { type: 'WF', name: 'W12X26' }, Fy: 50, Fu: 65, L: 10, DL_L: 14.71, LL_L: 29.82, DL_R: 14.71, LL_R: 29.82 });
  for (let i = out.length; i < +N; i++) {
    const wf = rnd() < 0.6;
    const sec = wf ? { type: 'WF', name: pick(W) } : (() => { const b = buSec(6, 16); b.bif = b.bof; b.tif = b.tof; return b; })();
    const oneSide = rnd() < 0.3;
    out.push({
      sec, Fy: wf ? 50 : 55, Fu: wf ? 65 : 70, L: range(6, 24, 0.5),
      DL_L: range(0, 40, 0.1), LL_L: range(0, 80, 0.1),
      DL_R: oneSide ? 0 : range(0, 40, 0.1), LL_R: oneSide ? 0 : range(0, 80, 0.1),
    });
  }
}
process.stdout.write(JSON.stringify(out));
