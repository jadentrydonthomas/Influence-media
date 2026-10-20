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
  assert.ok(!job.frameEntries.some(f => f.entries.some(e => job.columns.some(c => c.label === e.label))), 'no mezzanine column in the frame loads');
  // the job as the practice inputs leave it (A 11'-6", C 9'-6", 4" slab and deck, 5" joist seat): MB1 waits on a
  // decision (below), so its loads to the frame are not known yet; with the frame column setback picked — MB1 and MB2
  // at the 22'-8" clear span — BU14x94 / BU13x48, each fitting the 15" of room with its total-load sag
  const RUN = require('../src/run.js');
  const { inps } = await loadJob(pdf);
  const SB = { markInput: { MB1: { setback: true }, MB2: { setback: true } } };
  const sj = RUN.runJob(inps.map(inp => ({ inp, settings: SB }))), s1 = sj.marks.find(m => m.mark === 'MB1'), s2 = sj.marks.find(m => m.mark === 'MB2');
  assert.ok(fr(2).entries.every(e => !isFinite(e.D)), 'no load to the frame before MB1 has a section');
  const e2a = sj.frameEntries.find(f => f.frame === '2').entries.find(e => e.label === '2/A');
  // dead 40 psf: 4" NW on the PCS's "Other: 1.5B x 22Ga." deck (1.5" ribs); MB1 BU14x94 at the 24'-0" layout length
  assert.ok(Math.abs(e2a.D - 18.94) < 0.01 && Math.abs(e2a.L - 42) < 0.01 && Math.abs(e2a.elev - 10.75) < 1e-9 && Math.abs(e2a.A - 11.5) < 1e-9, JSON.stringify([e2a.D, e2a.L]));
  // the Beam calc design span: MB1 at 22'-4" (between column faces) — the plan, the columns and frame line A are kept
  const dj = RUN.runJob(inps.map(inp => ({ inp, settings: { markInput: { MB1: { span: 22 + 4 / 12 } } } })));
  const mb1 = dj.marks.find(m => m.mark === 'MB1'), wt = d => +/x([\d.]+)$/.exec(d)[1];
  assert.ok(mb1.design.set && Math.abs(mb1.design.span - 22.3333) < 1e-3 && mb1.span === 24, 'design span on the MB sheet, layout span kept');
  assert.deepStrictEqual(mb1.spanRuns.map(q => [q.span, +q.L.toFixed(3)]), [[24, 22.333], [20, 18.333], [16, 14.333]], 'the cut on every member length');
  assert.ok(mb1.desc === 'BU14x94' && mb1.check.res.CSR <= 0.99 && mb1.sec.d + mb1.check.defl.TL <= 15, 'designed at the shorter span, fits with its sag');
  assert.deepStrictEqual(dj.columns.map(c => c.label).sort(), job.columns.map(c => c.label).sort(), 'same mezzanine columns');
  assert.deepStrictEqual(dj.frameEntries.map(f => f.frame + ':' + f.entries.map(e => e.label + (e.member || '')).join(',')), job.frameEntries.map(f => f.frame + ':' + f.entries.map(e => e.label + (e.member || '')).join(',')), 'same frame columns, same members');
  const fA = n => dj.frameEntries.find(f => f.frame === String(n)).entries.find(e => e.label === n + '/A');
  [2, 3, 4, 5].forEach(n => assert.ok(Math.abs(fA(n).L - 42) < 1e-6 && Math.abs(fA(n).D - (e2a.D - (wt(s1.desc) - wt(mb1.desc)) / 1000 * 12)) < 0.01, `frame ${n}: line A keeps the layout load (beam self-weight only)`));
  const xl = dj.excel.beam[0].sheets.find(sh => sh.mark === 'MB1' && !sh.shorter).steps.find(st => st.cell === 'D7');
  assert.strictEqual(xl.value, 22.333, 'Excel D7 at the design span');
  assert.ok(dj.mezz[0].warn.some(w => /designed at 22'-4" span \(layout 24'-0"/.test(w.text)));
  // What next when nothing passes — the practice inputs as loaded: A 11'-6" − C 9'-6" − 4" slab − 5" seat = 15" of room
  // for the beam and its sag (the MB sheet's TOTAL LOAD max deflection). MB1 (24'-0" × 28'-0") takes more: the beam that
  // takes the least room is BU15x104, 15" + 1.03" = 16.03". Offered, in order, nothing applied: (1) the frame column
  // setback — MB1's Mezz 1 beams stop at the BSW rigid frame columns 2/A–5/A, 1'-4" inside line A: 22'-8" clear, where
  // BU14x94 fits (14" + 0.98"); (2) more clear height, the other way: C 9'-4 7/8" or the floor at 11'-7 1/8"
  {
    const F = require('../src/pcs.js').fmtFtIn;
    const n1 = job.marks.find(m => m.mark === 'MB1'), n2 = job.marks.find(m => m.mark === 'MB2');
    assert.ok(job.mezz[0].maxDepthByC === 15 && !n1.sec && n2.desc === 'BU13x59' && !n2.rescue && n2.sec.d + n2.check.defl.TL <= 15, `${n1.desc} / ${n2.desc}`);
    assert.ok(n1.design.span === 24 && !n1.design.setback, 'flagged, not applied');
    const sb = n1.rescue.setback, cl = n1.rescue.clear;
    assert.strictEqual(sb.state, 'offer');
    assert.ok(Math.abs(sb.span - (22 + 8 / 12)) < 1e-9 && sb.best && sb.best.desc === 'BU14x94' && sb.best.d === 14 && Math.abs(sb.best.dTL - 0.980) < 5e-4 && sb.best.need <= 15, JSON.stringify(sb.best && sb.best.desc));
    assert.deepStrictEqual(sb.ends.map(e => [e.mezz, e.label, e.kind, F(e.ft)]), [['Mezz 1', '2/A', 'rigid', `1'-4"`], ['Mezz 1', '3/A', 'rigid', `1'-4"`], ['Mezz 1', '4/A', 'rigid', `1'-4"`], ['Mezz 1', '5/A', 'rigid', `1'-4"`]]);
    // every end of MB1 and MB2 and why it takes what it takes: line 1 / line 6 beams run along the endwalls into the
    // corner columns of the end frames (in those frames' planes); Mezz 2's 2/E is an interior frame column on its grid
    const why = mk => [...new Set(mk.beamsAll.flatMap(x => x.ends.filter(e => e.why !== 'mezzanine column').map(e => `${job.mezz[x.mi].id} ${e.label} ${F(e.ft)}`)))].sort();
    assert.deepStrictEqual(why(n2), [`Mezz 1 1/A 1'-4"`, `Mezz 1 1/B 0'-0"`, `Mezz 1 6/A 1'-4"`, `Mezz 1 6/B 0'-0"`, `Mezz 2 1/B 0'-0"`, `Mezz 2 1/C 0'-0"`, `Mezz 2 1/E 0'-0"`]);
    assert.ok(n1.beamsAll.some(x => x.ends.some(e => e.label === '2/E' && e.ft === 0 && e.why === 'interior column, on its grid line')));
    // the setback alone does it, so the clear height is the other way: at the 24'-0" span as it is, the request always
    // for more room than there is
    assert.ok(!cl.withSetback && cl.span === 24 && !cl.grid && cl.d === 15 && cl.best.desc === 'BU15x104' && Math.abs(cl.dTL - 1.032) < 5e-4 && Math.abs(cl.needIn - 16.032) < 5e-4 && F(cl.needC) === `9'-4 7/8"` && F(cl.needA) === `11'-7 1/8"`, JSON.stringify([cl.d, cl.best && cl.best.desc, F(cl.needC), F(cl.needA)]));
    assert.ok(cl.light && cl.light.need > 15 && cl.light.wt < cl.best.wt, 'the lightest within 6" more is a deeper ask');
    // the room for the beam, term by term, as the card spells it out: A 11'-6" − C 9'-6" − slab 4" − seat 5" = 15"
    assert.ok(cl.stack && cl.stack.id === 'Mezz 1' && cl.stack.A === 11.5 && cl.stack.C === 9.5 && cl.stack.slabIn === 4 && Math.abs(cl.stack.seatIn - 5) < 1e-9 && Math.abs(cl.stack.room - 15) < 1e-9 && cl.per.every(p => p.slabIn === 4 && Math.abs(p.seatIn - 5) < 1e-9), JSON.stringify(cl.stack));
    assert.ok(/^Mezz 1 \/ Mezz 2: MB1 \(6 beams, 24'-0" span × 28'-0" trib\) has no beam section that fits, with its total-load sag, in the 15" the clear height .* Requesting C 9'-4 7\/8" clear under the beams, or the floor raised to 11'-7 1\/8": a 15" beam \(BU15x104, 1\.03" sag\) then works\.$/.test(cl.request), cl.request);
    assert.ok(job.mezz[0].warn.some(w => w.level === 'stop' && /^MB1: no stocked BU section between 10" and 15" deep meets SR ≤ 0\.99, L\/360 and L\/240 and fits the 15" of room under clearance C with its total-load sag\. What next \(the card at the top of the Design page\): the frame column setback — at the 22'-8" clear span BU14x94 passes and fits with its sag \(14" \+ 0\.98"\); or more clear height — a 15" beam \(1\.03" sag\) needs C 9'-4 7\/8" \(now 9'-6"\) or the floor at 11'-7 1\/8"\./.test(w.text)));
    // C at midspan: the sheet's C row takes the depth alone; the tool adds the sag of the beam that takes the most room
    const c0 = job.mezz[0].clear.C;
    assert.ok(c0.ok && c0.okSheet && c0.sag.mark === 'MB2' && Math.abs(c0.mid - (11.5 - (4 + 5 + 13 + c0.sag.tl) / 12)) < 1e-9 && c0.mid >= 9.5, JSON.stringify(c0));
    // picked: each member length less its own setback — Mezz 2's 20'-0" and 16'-0" MB1 beams end on 2/E (interior) and
    // mezzanine columns, so they keep their length (not the 1'-4" cut of a typed design span)
    assert.ok(s1.desc === 'BU14x94' && s2.desc === 'BU13x48' && s1.design.setback && Math.abs(s1.design.span - 22.6667) < 1e-3 && !s1.rescue);
    assert.ok([s1, s2].every(m => m.sec.d + m.check.defl.TL <= 15) && Math.abs(s2.check.defl.TL - 1.056) < 5e-4, 'both fit the 15" with their sag');
    assert.deepStrictEqual(s1.spanRuns.map(q => [q.span, +q.L.toFixed(3), q.qty]), [[24, 22.667, 4], [20, 20, 1], [16, 16, 1]]);
    assert.deepStrictEqual(s2.spanRuns.map(q => [q.span, +q.L.toFixed(3), q.qty]), [[24, 22.667, 2], [20, 20, 2], [16, 16, 2]]);
    assert.deepStrictEqual(sj.excel.beam[0].sheets.map(sh => `${sh.sheet}=${sh.mark}@${+sh.L.toFixed(3)}`).slice(0, 2), ['MB1=MB1@22.667', 'MB2=MB2@22.667'], 'the MB sheets at the clear span');
    assert.deepStrictEqual(sj.frameEntries.map(f => f.frame + ':' + f.entries.map(e => e.label).join(',')), job.frameEntries.map(f => f.frame + ':' + f.entries.map(e => e.label).join(',')), 'the frame columns stay');
    const fa = sj.frameEntries.find(f => f.frame === '3').entries.find(e => e.label === '3/A');
    assert.ok(Math.abs(fa.L - 42) < 1e-9, 'line A keeps the layout load: 125 psf × 28\' × 24\' / 2');
    const sc = sj.mezz[0].clear.C;
    assert.ok(sc.ok && sc.sag.mark === 'MB1' && sc.sag.desc === 'BU14x94' && F(sc.mid) === `9'-6"` && sc.mid >= 9.5, JSON.stringify(sc));
    // 14.98" of the 15": a fit that close is said (check before quoting) — with the room to spare
    assert.ok(sj.mezz[0].warn.some(w => w.level === 'warn' && /^Clearance C is tight: MB1 BU14x94 \(22'-8" member\) is 14" deep and sags 0\.98" under the total load, 14\.98" of the 15" of room — 0\.02" to spare \(C at midspan 9'-6"\)\./.test(w.text)));
    assert.ok(!job.mezz.some(r => r.warn.some(w => /Clearance C is tight/.test(w.text))), 'MB2 BU13x59 alone: room to spare');
    // MB2's deeper choice: BU14x41 is lighter but 14" + 1.07" = 15.07" — 1/16" over the room, so it waits on 1/8" of C
    const d14 = (s2.deeper || []).find(z => z.d === 14);
    assert.ok(d14 && d14.desc === 'BU14x41' && d14.need > 15 && F(d14.needC) === `9'-5 7/8"`, JSON.stringify(d14 && [d14.desc, d14.need, F(d14.needC)]));
    // the quote sheet as pasted at A7 / A17 / A37 of the MEZZ sheet: the user's own rows 17–22 (they quoted BU14x92, F12×1
    // flanges on a 1/4" web — tw/tf 0.25 under the production guidelines' 0.30; with the guidelines off it is the answer)
    const q = RUN.quoteJob(sj.mezz, inps);
    assert.deepStrictEqual(q.beams.map(r => [r.MEZZ, r.SPAN, r.TRIB, r.SECTION, r.QTY]), [[1, 24, 28, 'BU14x94', 4], [1, 24, 14, 'BU13x48', 2], [2, 20, 28, 'BU14x94', 1], [2, 16, 28, 'BU14x94', 1], [2, 20, 14, 'BU13x48', 2], [2, 16, 14, 'BU13x48', 2]]);
    assert.deepStrictEqual(q.tsv.design.split('\n'), ['1\t11.5\t\t4\tNW\t40\t5\t125\t', '2\t11.5\t\t4\tNW\t40\t5\t125\t']);
    assert.deepStrictEqual(q.tsv.beams.split('\n').slice(0, 3), ['1\t24\t\t28\t=IF(B17="","",F$7+G$7+I$7)\t=IF(B17="","",H7)\tBU14x94\t=IF(B17="","",40)\t4', '1\t24\t\t14\t=IF(B18="","",F$7+G$7+I$7)\t=IF(B18="","",H7)\tBU13x48\t=IF(B18="","",40)\t2', '2\t20\t\t28\t=IF(B19="","",F$8+G$8+I$8)\t=IF(B19="","",H8)\tBU14x94\t=IF(B19="","",40)\t1']);
    assert.deepStrictEqual(q.tsv.columns.split('\n'), ['1&2\t11.5\t\t496\t\tW8x24\t=IF(B37="","",46)\t8']);
    assert.deepStrictEqual([q.sheet.design.at, q.sheet.beams.at, q.sheet.columns.at, q.sheet.beams.to, q.sheet.columns.letters.AREA], ['A7', 'A17', 'A37', 'I', 'D:E']);
    const off = RUN.runJob(inps.map(inp => ({ inp, settings: { production: false, ...SB } })));
    assert.deepStrictEqual(off.marks.map(m => m.desc), ['BU14x92', 'BU13x48'], 'the quote engineer\'s BU14x92 with the production guidelines off');
    // one mezzanine with no clearance requirement: the request is the other one's (Mezz 1's C caps the shared mark)
    const mix = JSON.parse(JSON.stringify(inps)); mix[1].geom.C = { value: null, source: 'none' };
    const mc = RUN.runJob(mix.map(inp => ({ inp, settings: {} }))).marks.find(m => m.mark === 'MB1').rescue.clear;
    assert.ok(mc && mc.per.length === 1 && mc.per[0].id === 'Mezz 1' && F(mc.C) === `9'-6"` && F(mc.needC) === `9'-4 7/8"` && /^Mezz 1: MB1 /.test(mc.request), mc && mc.request);
    // a 6" seat leaves 14": the setback is not enough on its own — at the 22'-8" clear span the least room is BU14x102,
    // 14" + 0.96": C 9'-5" with the setback, or C 9'-3 7/8" for a 15" beam without it
    const six = JSON.parse(JSON.stringify(inps)); six.forEach(inp => { inp.geom.seat = { value: 0.5, source: 'manual' }; });
    const xj = RUN.runJob(six.map(inp => ({ inp, settings: {} }))), x1 = xj.marks.find(m => m.mark === 'MB1'), xc = x1.rescue.clear;
    assert.ok(xj.mezz[0].maxDepthByC === 14 && !x1.sec && xj.marks.find(m => m.mark === 'MB2').desc === 'BU12x70', xj.marks.map(m => m.desc).join(' / '));
    assert.ok(x1.rescue.setback.state === 'offer' && !x1.rescue.setback.best && xc.withSetback && Math.abs(xc.span - 22.6667) < 1e-3 && xc.d === 14 && xc.best.desc === 'BU14x102' && F(xc.needC) === `9'-5"` && F(xc.needA) === `11'-7"` && xc.grid.d === 15 && F(xc.grid.needC) === `9'-3 7/8"`, JSON.stringify([xc.d, xc.best.desc, F(xc.needC), xc.grid && F(xc.grid.needC)]));
    assert.ok(xj.mezz[0].warn.some(w => w.level === 'stop' && /the frame column setback \(22'-8" clear span\) does not do it on its own; or more clear height with the setback — a 14" beam \(0\.96" sag\) needs C 9'-5" \(now 9'-6"\)/.test(w.text)));
    // the setback in use and still nothing (an 8" seat leaves 12"): the card says so and goes on to the clear height,
    // found at the 22'-8" clear span
    const eight = JSON.parse(JSON.stringify(inps)); eight.forEach(inp => { inp.geom.seat = { value: 8 / 12, source: 'manual' }; });
    const ar = RUN.runJob(eight.map(inp => ({ inp, settings: { markInput: { MB1: { setback: true } } } }))).marks.find(m => m.mark === 'MB1');
    assert.ok(!ar.sec && ar.design.setback && ar.rescue.setback.state === 'applied' && ar.rescue.clear.withSetback && Math.abs(ar.rescue.clear.span - 22.6667) < 1e-3 && !ar.rescue.clear.grid && F(ar.rescue.clear.needC) === `9'-3"`, JSON.stringify(ar.rescue.setback.state));
    // a typed design span replaces the setback (the cut on every member again)
    const tj = RUN.runJob(inps.map(inp => ({ inp, settings: { markInput: { MB1: { span: 22 + 8 / 12 } } } })));
    assert.deepStrictEqual(tj.marks[0].spanRuns.map(q => +q.L.toFixed(3)), [22.667, 18.667, 14.667]);
    // partition carried as live load: the pasted DLT / LLF formulas follow it (the sheet's own DLT adds PART to the dead)
    const pt = JSON.parse(JSON.stringify(inps)); pt.forEach(inp => { inp.loads.partition = { value: 15, source: 'manual' }; });
    const pq = RUN.quoteJob(RUN.runJob(pt.map(inp => ({ inp, settings: SB }))).mezz, pt);
    assert.ok(pq.beams[0].partLive && pq.beams[0].DLT === 45 && pq.beams[0].LLT === 140 && pq.tsv.beams.split('\n')[0].split('\t').slice(4, 6).join(' ') === '=IF(B17="","",F$7+G$7) =IF(B17="","",H7+I7)' && pq.tsv.design.split('\n')[0].split('\t')[8] === '15');
  }
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
    assert.ok(q.beams.every(b => b.SECTION === 'NO SECTION' && /nothing passes at/.test(b.DETAIL)));
    assert.strictEqual(q.columns.reduce((a, c) => a + c.QTY, 0), cols, 'every column on the quote');
    assert.ok(q.columns.every(c => c.SECTION === 'NOT SIZED'));
    const pj = RUN.runJob(inps.map(inp => ({ inp, settings: { override: { MB1: { sec: { type: 'BU', d: 10, tw: 0.25, bof: 6, tof: 0.375, bif: 6, tif: 0.375 } } } } })));
    const pq = RUN.quoteJob(pj.mezz, inps).beams.filter(b => /^FAILS — combined/.test(b.FLAG));
    assert.ok(pq.length >= 1 && pq.every(b => /section picked by the engineer/.test(b.DETAIL)), 'a failing pick says so on the row');
    assert.ok(RUN.quoteJob(pj.mezz, inps).tsv.beams.split('\n').every(l => l.split('\t').length === 11 && /^FAILS|^$/.test(l.split('\t')[9])), 'with a failing row the copy carries the J:K note (J, K)');
  }
  console.log('job3 tests passed (W1S-26062: 8/8 ⊗, ✱ 3/E–6/E, I 2/E, joists along the length from the truss symbols, frame loads on members; MB1 design span 22\'-4" keeps line A on the frame; footprint cut flagged; 15" of room, MB1 needs 16.03" with its sag → setback 22\'-8" BU14x94 (14" + 0.98") or C 9\'-4 7/8"; quote rows as pasted at A7 / A17 / A37)');
})().catch(e => { console.error(e); process.exit(1); });
