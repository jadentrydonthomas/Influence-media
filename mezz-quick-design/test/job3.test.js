// W1S-26062 (Mezz 1 / Mezz 2, ⊗ mezzanine columns, ✱ Most Economical ridge columns, joist truss symbols) when present
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pdf = process.env.MZ_PCS3 || path.join(__dirname, '..', 'private', 'pcs', 'PCS_job3.pdf');
let ok = fs.existsSync(pdf);
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { ok = false; }
if (!ok) { console.log('job3 tests passed (PCS not present, skipped)'); process.exit(0); }
const { loadJob } = require('../oracle/job_load.js');
const PLAN = require('../src/plan.js');
(async () => {
  const { pcs, job } = await loadJob(pdf);
  assert.strictEqual(pcs.job.quote, 'W1S-26062');
  assert.deepStrictEqual(pcs.mezzanines.map(m => [m.id, m.width, m.length, m.startLEW, m.startFSW]), [['Mezz 1', 24, 140, 0, 96], ['Mezz 2', 36, 40, 0, 60]]);
  assert.deepStrictEqual(pcs.frames.map(f => [f.from, f.to, f.intType]), [[1, 1, null], [2, 2, null], [3, 5, 'Most Economical'], [6, 6, 'Most Economical']]);
  // the floor plan: eight ⊗, ✱ at the ridge of frames 3–6, an I at 2/E, the joist truss symbols run along the length
  const lab = c => job.mezz[0].grid.xLabel(Math.round(c.x)) + '/' + c.y.toFixed(0);
  assert.strictEqual(pcs.plan.columns.length, 8);
  assert.ok(pcs.plan.columns.every(c => c.kind === 'x'));
  assert.deepStrictEqual(pcs.plan.frameCols.filter(c => c.kind === 'star').map(c => Math.round(c.x)), [56, 84, 112, 139]);
  assert.ok(pcs.plan.frameCols.some(c => c.kind === 'I' && Math.abs(c.x - 28) < 0.5 && Math.abs(c.y - 60) < 0.5), 'I at 2/E');
  assert.deepStrictEqual(pcs.mezzanines.map(m => m.planJoists), ['x', 'x']);
  // the layout: exactly the drawing's mezzanine columns; 2/E and the endwall columns go to the frame
  assert.deepStrictEqual(job.columns.map(c => c.label).sort(), ['2/B', '2/C', '3/B', '4/B', `40'-0"/B`, `40'-0"/C`, `40'-0"/E`, '5/B']);
  assert.ok(PLAN.compare(pcs.plan.columns, job.columns).agree, 'every ⊗ is a mezzanine column and no other');
  assert.ok(job.frameLoads.some(f => f.label === '2/E'));
  // loads to NBG Frame: on frame members only, by frame line
  const fr = n => job.frameEntries.find(f => f.frame === String(n));
  assert.deepStrictEqual(fr(2).entries.map(e => [e.label, e.member]), [['2/E', 'COL02'], ['2/A', 'COL03']]);
  assert.deepStrictEqual(fr(1).entries.filter(e => !e.member).map(e => e.label), ['1/C', '1/B'], 'wind columns beside the rigid end frame are not members');
  const e2a = fr(2).entries.find(e => e.label === '2/A');
  // dead 40 psf: 4" NW on the PCS's "Other: 1.5B x 22Ga." deck (1.5" ribs)
  // MB1 BU15x95 (12 × 1 flanges on a 5/16" web: the production guidelines' tw/tf ≥ 0.30 rules out the 1/4" web)
  assert.ok(Math.abs(e2a.D - 18.95) < 0.01 && Math.abs(e2a.L - 42) < 0.01 && Math.abs(e2a.elev - 10.75) < 1e-9 && Math.abs(e2a.A - 11.5) < 1e-9);
  assert.ok(!job.frameEntries.some(f => f.entries.some(e => job.columns.some(c => c.label === e.label))), 'no mezzanine column in the frame loads');
  // the Beam calc design span: MB1 at 22'-4" (between column faces) — the plan, the columns and frame line A are kept
  const RUN = require('../src/run.js');
  const { inps } = await loadJob(pdf);
  const dj = RUN.runJob(inps.map(inp => ({ inp, settings: { markInput: { MB1: { span: 22 + 4 / 12 } } } })));
  const mb1 = dj.marks.find(m => m.mark === 'MB1'), wt = d => +/x([\d.]+)$/.exec(d)[1];
  assert.ok(mb1.design.set && Math.abs(mb1.design.span - 22.3333) < 1e-3 && mb1.span === 24, 'design span on the MB sheet, layout span kept');
  assert.deepStrictEqual(mb1.spanRuns.map(q => [q.span, +q.L.toFixed(3)]), [[24, 22.333], [20, 18.333], [16, 14.333]], 'the cut on every member length');
  assert.ok(mb1.check.res.CSR <= 0.99 && mb1.desc !== job.marks[0].desc, 'redesigned at the shorter span');
  assert.deepStrictEqual(dj.columns.map(c => c.label).sort(), job.columns.map(c => c.label).sort(), 'same mezzanine columns');
  assert.deepStrictEqual(dj.frameEntries.map(f => f.frame + ':' + f.entries.map(e => e.label + (e.member || '')).join(',')), job.frameEntries.map(f => f.frame + ':' + f.entries.map(e => e.label + (e.member || '')).join(',')), 'same frame columns, same members');
  const fA = n => dj.frameEntries.find(f => f.frame === String(n)).entries.find(e => e.label === n + '/A');
  [2, 3, 4, 5].forEach(n => assert.ok(Math.abs(fA(n).L - 42) < 1e-6 && Math.abs(fA(n).D - (e2a.D - (wt(job.marks[0].desc) - wt(mb1.desc)) / 1000 * 12)) < 0.01, `frame ${n}: line A keeps the layout load (lighter beam self-weight only)`));
  const xl = dj.excel.beam[0].sheets.find(sh => sh.mark === 'MB1' && !sh.shorter).steps.find(st => st.cell === 'D7');
  assert.strictEqual(xl.value, 22.333, 'Excel D7 at the design span');
  assert.ok(dj.mezz[0].warn.some(w => /designed at 22'-4" span \(layout 24'-0"/.test(w.text)));
  // the other way (footprint cut to 22'-4"): the loads leave line A, and the page says so
  const cut = JSON.parse(JSON.stringify(inps));
  cut[0].geom.width = { value: 22 + 4 / 12, source: 'manual' };
  const cj = RUN.runJob(cut.map(inp => ({ inp, settings: {} })));
  assert.ok(!cj.frameEntries.some(f => f.frame === '3'), 'no load on frame 3 once the edge leaves line A');
  assert.ok(cj.mezz[0].warn.some(w => w.level === 'warn' && /BSW-side edge is at 118'-4", 1'-8" short of the building column line A/.test(w.text)), 'the guard names it');
  assert.ok(!job.mezz.some(r => r.warn.some(w => /short of the building column line/.test(w.text))), 'no guard on the job as quoted');
  // the Plan page edits: 3/B made a frame column (no column there in the frame: added, named so, no member), 1/A made a
  // mezzanine column (designed on the Column sheet, gone from frame 1), and a new column line at 108'-0" across Mezz 1
  {
    const kinds = { '56.00,96.00': 'frame', '0.00,120.00': 'mezz' };
    const ej = RUN.runJob(inps.map((inp, i) => ({ inp, settings: i === 0 ? { colKind: kinds } : {} })));
    const m1 = ej.mezz[0], cols = m1.layout.mezzCols.map(c => c.label);
    assert.ok(!cols.includes('3/B') && cols.includes('1/A'), cols.join(' '));
    const f3 = ej.frameEntries.find(f => f.frame === '3').entries.find(e => e.label === '3/B');
    assert.ok(f3 && f3.member === null && /made a frame column on the Plan page: add it in NBG Frame/.test(f3.where), JSON.stringify(f3 && f3.where));
    assert.ok(!ej.frameEntries.find(f => f.frame === '1').entries.some(e => e.label === '1/A'), '1/A no longer loads frame 1');
    assert.ok(m1.warn.some(w => /3\/B: made a frame column on the Plan page/.test(w.text)) && m1.warn.some(w => /1\/A: made a mezzanine column/.test(w.text)));
    const lj = RUN.runJob(inps.map((inp, i) => ({ inp, settings: i === 0 ? { joists: 'x', xLines: job.mezz[0].layout.beamLines, yLines: [96, 108, 120] } : {} })));
    assert.deepStrictEqual([...new Set(lj.mezz[0].layout.beams.map(b => b.span))], [12]);
    assert.strictEqual(lj.mezz[0].layout.mezzCols.filter(c => c.y === 108).length, 6, 'a column on every beam line at 108\'-0"');
    // a beam line added 2' off line 2: joists both sides, so interior — even with no more trib than the edge beams
    const aj = RUN.runJob(inps.map((inp, i) => ({ inp, settings: i === 0 ? { xLines: job.mezz[0].layout.beamLines.concat(30) } : {} }))), am = aj.mezz[0];
    const at30 = am.layout.beams.filter(b => Math.abs(b.line - 30) < 1e-6 && !b.absorbed);
    assert.ok(at30.length && at30.every(b => (am.marks.find(mk => mk.beams.includes(b.id)) || {}).kind === 'interior'), at30.map(b => b.trib).join(' '));
    assert.ok(am.warn.some(w => w.level === 'warn' && /lines at 28'-0" and 30'-0" from the LEW are only 2'-0" apart/.test(w.text)), 'a line added 2\' from another is flagged');
    assert.ok(!job.mezz[0].warn.some(w => /only .* apart \(a line added/.test(w.text)), 'not on the layout as read');
  }
  // the quote never drops what does not pass: a mark with no passing section stays as NO SECTION rows, every beam
  // counted; columns that could not be sized stay as NOT SIZED; a failing section picked by hand says FAILS
  {
    const all = job.mezz.reduce((a, r) => a + r.marks.reduce((b, m) => b + m.qty, 0), 0), cols = job.columns.length;
    const nj = RUN.runJob(inps.map(inp => ({ inp, settings: { dMax: 10 } })));
    const q = RUN.quoteJob(nj.mezz, inps);
    assert.strictEqual(q.beams.reduce((a, b) => a + b.QTY, 0), all, 'every beam on the quote');
    assert.ok(q.beams.every(b => b.SECTION === 'NO SECTION' && /NO PASSING SECTION/.test(b.NOTES)));
    assert.strictEqual(q.columns.reduce((a, c) => a + c.QTY, 0), cols, 'every column on the quote');
    assert.ok(q.columns.every(c => c.SECTION === 'NOT SIZED'));
    const pj = RUN.runJob(inps.map(inp => ({ inp, settings: { override: { MB1: { sec: { type: 'BU', d: 10, tw: 0.25, bof: 6, tof: 0.375, bif: 6, tif: 0.375 } } } } })));
    const pq = RUN.quoteJob(pj.mezz, inps).beams.filter(b => /^FAILS — combined/.test(b.NOTES));
    assert.ok(pq.length >= 1 && pq.every(b => /section picked by the engineer/.test(b.NOTES)), 'a failing pick says so on the row');
  }
  console.log('job3 tests passed (W1S-26062: 8/8 ⊗, ✱ 3/E–6/E, I 2/E, joists along the length from the truss symbols, frame loads on members; MB1 design span 22\'-4" keeps line A on the frame; footprint cut flagged)');
})().catch(e => { console.error(e); process.exit(1); });
