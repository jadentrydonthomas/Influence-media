// W2R-26047 when present: a building name that wraps in its Box 2 / Box 4 / Box 5 cells, the floor plan on a /Rotate 90
// sheet ahead of a vector-only wind-pressure table, ⊘ mezzanine columns, ✱ interior frame columns on line C, a "JOIST"
// arrow with shallow heads, and a slab that overhangs line 4 and line C — the layout must be the drawing's.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pdf = process.env.MZ_PCS5 || path.join(__dirname, '..', 'private', 'pcs', 'PCS_job5.pdf');
let ok = fs.existsSync(pdf);
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { ok = false; }
if (!ok) { console.log('job5 tests passed (PCS not present, skipped)'); process.exit(0); }
const { loadJob } = require('../oracle/job_load.js');
const RUN = require('../src/run.js');
const DESIGN = require('../src/design.js');
const r4 = a => a.map(v => +v.toFixed(4));
(async () => {
  const { pcs, inps, job, plan } = await loadJob(pdf);
  assert.strictEqual(pcs.job.quote, 'W2R-26047');
  // Box 2, Box 5, Box 4 of "MAINTENANCE BUILDING" (wrapped "MAINTENANCE" / "BUILDING" and "MAINTENAN" / "CE BUILDING")
  const b = pcs.building, own = pcs.buildings['MAINTENANCE BUILDING'];
  assert.deepStrictEqual([b.name, b.width, b.length, b.ridge, b.profile], ['MAINTENANCE BUILDING', 102, 182, 51, 'Gable']);
  assert.deepStrictEqual(b.bays, [31, 30, 30, 30, 30, 31]);
  assert.deepStrictEqual([r4(b.lewCols), r4(b.rewCols)], [[28, 24.3333, 23.6667, 26], [28, 24.3333, 23.6667, 26]]);
  assert.deepStrictEqual(pcs.frames.map(f => [f.from, f.to, f.wall, f.type, r4(f.interior), f.intType]), [
    [1, 1, 'LEW', 'Rigid Frame Multi Span (Non-Exp) - RMG', [52.3333, 49.6667], 'Most Economical'],
    [2, 6, null, 'Rigid Frame Multi Span - RMG', [52.3333, 49.6667], 'Most Economical'],
    [7, 7, 'REW', 'Rigid Frame Multi Span (Non-Exp) - RMG', [52.3333, 49.6667], 'Most Economical']]);
  assert.deepStrictEqual([own.roof.dead.perSeller, own.roof.snow.value, own.roof.coll1, own.roof.coll2], [true, 21, 7.5, 7.5]);
  // the floor plan: page 16 (the C&C wind table, page 17, is vector-only too), read as printed
  assert.ok(plan && plan.page === 16 && plan.reg.ok, plan && plan.reg.reason);
  assert.deepStrictEqual(pcs.plan.letters.map(l => [l.letter, Math.round(l.y) || 0]), [['A', 102], ['B', 76], ['C', 52], ['D', 51], ['E', 28], ['F', 0]]);
  assert.deepStrictEqual(pcs.plan.columns.map(c => [c.kind, Math.round(c.x), Math.round(c.y)]), [['s', 31, 76], ['s', 61, 76], ['s', 91, 76]]);
  const stars = pcs.plan.frameCols.filter(c => c.kind === 'star');
  assert.ok(stars.length === 7 && stars.every(c => Math.abs(c.y - 52.333) < 0.1), 'a ✱ on line C at every frame');
  assert.strictEqual(pcs.mezzanines[0].planJoists, 'y');
  // the layout is the drawing's: beams on A, B and C over lines 1–4, ⊘ at 2/B, 3/B, 4/B; frame columns A/1–A/4, the LEW's
  // B/1, the interior columns C/1–C/4; the slab past line 4 and past C overhangs them
  const r = job.mezz[0], L = r.layout;
  assert.strictEqual(L.joists, 'y');
  assert.deepStrictEqual(L.beamLines.map(v => +v.toFixed(3)), [52.333, 76, 102]);
  assert.deepStrictEqual(L.supportLines, [0, 31, 61, 91]);
  assert.deepStrictEqual(job.columns.map(c => c.label), ['2/B', '3/B', '4/B']);
  assert.deepStrictEqual(L.supports.filter(s => s.building).map(s => s.label).sort(), ['1/A', '1/B', '1/C', '2/A', '2/C', '3/A', '3/C', '4/A', '4/C']);
  assert.deepStrictEqual(L.supports.filter(s => s.planKind).map(s => s.label + ' ' + s.planKind).sort(), ['1/A I', '1/B I', '1/C star', '2/A I', '2/B s', '2/C star', '3/A I', '3/B s', '3/C star', '4/A I', '4/B s', '4/C star']);
  const say = re => r.warn.some(w => re.test(w.text));
  assert.ok(say(/^Floor plan check: the drawing shows 3 ⊘ mezzanine columns in mezzanine 1, at 2\/B, 3\/B, 4\/B — the same as the layout\./));
  assert.ok(say(/edge 92'-3" from the LEW is framed on the grid line 4 \(91'-0"\) — the slab overhangs it by 1'-3", as the PCS floor plan draws it/));
  assert.ok(say(/edge 50'-5 3\/16" from the FSW is framed on the grid line C \(52'-4"\) — the slab overhangs it by 1'-10 13\/16"/));
  // nothing read is in doubt: the only stops are the design's own (8'-6" clearance C caps the beams at 14")
  const stops = r.warn.filter(w => w.level === 'stop').map(w => w.text);
  assert.ok(stops.length && stops.every(t => /no stocked BU section|not sized/.test(t)), stops.join('\n'));
  // what next: the beams that run into the LEW end at its columns, held in from the grid by the girts — 1'-4" at the
  // rigid end frame (1/B on line B for MB1; 1/A and 1/C for MB2). The longest beams left are the 30'-0" ones, and
  // nothing fits the 14" there either, so the clear height: at the clear span MB1 takes the least room as BU19x111,
  // 19" + 1.47" sag = 20.47" — C 7'-11 1/2" (on the 1/8" grid, never more than that leaves) or the floor at 11'-0 1/2"
  const F = require('../src/pcs.js').fmtFtIn, [k1, k2] = job.marks;
  assert.ok(k1.rescue.setback.state === 'offer' && k1.rescue.setback.span === 30 && !k1.rescue.setback.best && k1.rescue.setback.ends.map(e => `${e.label} ${e.wall} ${e.kind} ${F(e.ft)}`).join() === `1/B LEW rigid 1'-4"`);
  assert.ok(r.roomIn === 14 && k1.rescue.clear.d === 19 && k1.rescue.clear.best.desc === 'BU19x111' && Math.abs(k1.rescue.clear.needIn - 20.469) < 5e-4 && F(k1.rescue.clear.needC) === `7'-11 1/2"` && F(k1.rescue.clear.needA) === `11'-0 1/2"` && /^Mezzanine 1: MB1 .* a 19" beam \(BU19x111, 1\.47" sag\) then works\.$/.test(k1.rescue.clear.request), k1.rescue.clear.request);
  assert.deepStrictEqual(k2.rescue.setback.ends.map(e => `${e.label} ${e.kind} ${F(e.ft)}`).sort(), [`1/A rigid 1'-4"`, `1/C rigid 1'-4"`]);
  assert.ok(k2.rescue.setback.state === 'offer' && k2.rescue.setback.span === 30 && !k2.rescue.setback.best && k2.rescue.clear.withSetback && k2.rescue.clear.d === 15 && F(k2.rescue.clear.needC) === `8'-3 1/2"` && k2.rescue.clear.grid.d === 16 && F(k2.rescue.clear.grid.needC) === `8'-2 1/2"`, JSON.stringify([k2.rescue.setback.state, k2.rescue.clear.d]));
  assert.ok(k2.beamsAll.some(x => x.ends.some(e => e.why === 'interior column, on its grid line')) && k2.beamsAll.some(x => x.ends.some(e => e.why === 'the beam runs along the wall')));
  // the notes a missing section brings are tagged, so the page asks for the decision in their place
  assert.ok(r.warn.filter(w => w.level === 'stop').every(w => w.tag === 'nosec'));
  assert.ok(stops.some(t => /^MB1: .* What next \(the card at the top of the Design page\): the frame column setback \(30'-0" clear span\) does not do it on its own; or more clear height with the setback — a 19" beam \(1\.47" sag\) needs C 7'-11 1\/2" \(now 8'-6"\)/.test(t)));
  // C entered as no requirement: every beam sized, and line 4 takes the 1'-3" overhang the end beams cantilever to it
  const c2 = JSON.parse(JSON.stringify(inps));
  c2[0].geom.C = { value: null, source: 'none' };
  const j2 = RUN.runJob(c2.map(inp => ({ inp, settings: {} }))), m2 = j2.mezz[0];
  assert.ok(m2.marks.every(mk => mk.sec), m2.marks.map(mk => mk.mark + ' ' + mk.desc).join(', '));
  const k = 1 + 2 * 1.25 / 30 * (1 + 1.25 / 60), shear = (line, to) => { const bm = m2.layout.beams.find(q => Math.abs(q.line - line) < 0.01 && q.to === to); return DESIGN.reactions({ ...m2.beamBase, L: bm.span, trib: bm.trib }, m2.marks.find(mk => mk.beams.includes(bm.id)).sec); };
  const c4 = j2.columns.find(c => c.label === '4/B'), vB = shear(76, 91);
  assert.ok(Math.abs(c4.DL_L - vB.D * k) < 1e-9 && Math.abs(c4.LL_L - vB.L * k) < 1e-9 && c4.DL_R === 0, '4/B: end shear plus the cantilever');
  const f4 = j2.frameLoads.find(q => q.label === '4/C'), vC = shear(52 + 4 / 12, 91);
  assert.ok(Math.abs(f4.D - vC.D * k) < 1e-9 && Math.abs(f4.L - vC.L * k) < 1e-9, '4/C to frame 4: end shear plus the cantilever');
  const f3 = j2.frameLoads.find(q => q.label === '3/C'), vC3 = shear(52 + 4 / 12, 61);
  assert.ok(Math.abs(f3.D - 2 * vC3.D) < 1e-6, '3/C: two plain end shears');
  // the frame files: frames 1–4 take the line A and line C columns (members), B/1 goes to the endwall design
  assert.deepStrictEqual(j2.frameEntries.filter(f => +f.frame <= 4).map(f => f.frame + ':' + f.entries.map(e => e.label + (e.member ? '=' + e.member : '')).join(',')),
    ['1:1/C=COL02,1/B,1/A=COL03', '2:2/C=COL02,2/A=COL03', '3:3/C=COL02,3/A=COL03', '4:4/C=COL02,4/A=COL03']);
  console.log(`job5 tests passed (W2R-26047: wrapped building name read in Box 2 / 4 / 5, plan page 16 on a rotated sheet, ⊘ 2/B 3/B 4/B, ✱ on C, joists N-S, beams on A / B / C over lines 1–4, overhangs past 4 and C carried to their columns; with C open: ${m2.marks.map(mk => mk.mark + ' ' + mk.desc + ' ×' + mk.qty).join(', ')}, ${m2.colFinal ? m2.colFinal.quoteAs + ' ×' + m2.columns.length : 'columns not sized'})`);
})().catch(e => { console.error(e); process.exit(1); });
