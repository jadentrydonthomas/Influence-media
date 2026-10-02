// Dump every workbook run a job's answer rests on:
//   beam: each mark × member length (the MB sheet runs), the lightest section at every depth of each mark's search,
//         and every beam's own end shears (span, own trib, mark section) — the column / frame inputs
//   column: every column case of every mezzanine × every W tried for the job-wide section
// usage: node oracle/job_dump.js PCS.pdf oracle/out/job   (open values a PCS leaves TBD: B 9'-0", C none, seat 5", joists @ 4'-0")
const fs = require('fs');
const M = require('path').join(__dirname, '..');
const RUN = require(M + '/src/run.js'), PCS = require(M + '/src/pcs.js'), PLAN = require(M + '/src/plan.js'), LAYOUT = require(M + '/src/layout.js'), DESIGN = require(M + '/src/design.js'), WF = require(M + '/src/wf-db.js');
const { readPcs, loadPdfjs } = require(M + '/test/pdf-node.js');
(async () => {
  const [pdf, pre] = process.argv.slice(2);
  const pages = await readPcs(pdf), pcs = PCS.parse(pages);
  const g = LAYOUT.buildingGrid({ ...pcs.building, frames: pcs.frames });
  const p = pages[pages.length - 1];
  const reg = PLAN.registerAndRead(PLAN.subpaths(await p._page.getOperatorList(), loadPdfjs().OPS, p.height), { xs: g.xs, colY: [...new Set([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()])], lewY: g.lewY, rewY: g.rewY, width: g.width, letterLines: g.allY });
  RUN.applyPlan(pcs, reg);
  const inps = pcs.mezzanines.map((m, i) => RUN.inputsFromPCS(pcs, i));
  const miss = n => !n || n.value == null || n.source === 'missing';
  inps.forEach(inp => { const q = inp.geom; if (miss(q.B)) q.B = { value: 9, source: 'manual' }; if (miss(q.C)) q.C = { value: null, source: 'none' }; if (miss(q.seat)) q.seat = { value: 5 / 12, source: 'manual' }; if (miss(q.joistSpacing)) q.joistSpacing = { value: 4, source: 'manual' }; });
  const job = RUN.runJob(inps.map(inp => ({ inp, settings: {} })));
  const ed = job.mezz[0].edition;
  const P = q => ({ dead: q.dead, coll: q.coll, live: q.live, joistWt: q.joistWt, L: q.L, Lb: q.Lb, trib: q.trib });
  const beams = [], cols = [], ties = [];
  job.marks.forEach(mk => {
    mk.spanRuns.forEach((r, i) => beams.push({ ...P(r.params), sec: { type: 'BU', ...pick(mk.sec) }, tag: `${mk.mark} ${mk.kind} ${mk.desc} run ${PCS.fmtFtIn(r.span)} ×${r.qty}${i ? '' : ' (designed)'}`, role: 'run', mark: mk.mark, desc: mk.desc }));
    mk.search.byDepth.filter(a => !a.none).forEach(a => beams.push({ ...P(mk.params), sec: { type: 'BU', ...pick(a.sec) }, tag: `${mk.mark} search ${a.d}" ${a.desc}`, role: 'depth', mark: mk.mark, wt: a.wt, chosen: a.desc === mk.desc }));
  });
  const shearIdx = new Map();
  job.mezz.forEach(r => r.layout.beams.filter(b => !b.absorbed).forEach(b => {
    const mk = r.marks.find(m => m.beams.includes(b.id));
    shearIdx.set(`${r.id} B${b.id + 1}`, beams.length);
    beams.push({ ...P({ ...r.beamBase, L: b.span, trib: b.trib }), sec: { type: 'BU', ...pick(mk.sec) }, tag: `${r.id} B${b.id + 1} own shear (${mk.mark})`, role: 'shear' });
  }));
  // columns: every case, every W the job-wide search tried
  const tried = DESIGN.COMMON_COLUMNS.slice().sort((a, b) => WF[a].W - WF[b].W);
  job.mezz.forEach(r => r.colGroups.forEach(gp => {
    const c = gp.cols[0];
    tried.forEach(name => cols.push({ sec: { type: 'WF', name }, Fy: 50, Fu: 65, L: r.colLen, Lby: r.colLen * 12, ...gp.loads, tag: `${r.id} ${gp.cols.map(q => q.label).join(',')} ${name}`, chosen: name === r.colFinal.name, mezz: r.id }));
    // where the case loads come from: sum of beam end shears, per sheet side
    ties.push({ tag: `${r.id} ${c.label}`, loads: gp.loads, parts: c.parts.map(p2 => ({ key: `${p2.mezz} ${p2.beam}`, side: p2.sheetSide })) });
  }));
  (job.frameLoads || []).forEach(fl => ties.push({ tag: 'frame ' + fl.label, frame: { D: fl.D, L: fl.L }, parts: fl.parts.map(p2 => ({ key: `${p2.mezz} ${p2.beam}` })) }));
  fs.writeFileSync(pre + '_beam.json', JSON.stringify(beams));
  fs.writeFileSync(pre + '_col.json', JSON.stringify(cols));
  fs.writeFileSync(pre + '_ties.json', JSON.stringify({ ties, shearIdx: [...shearIdx], chosenCol: job.mezz.map(r => r.colFinal && r.colFinal.name), beamEd: ed.beamEd, colEd: ed.colEd }));
  console.log(pre, 'beam cases', beams.length, 'column cases', cols.length, 'ties', ties.length, 'editions', ed.beamEd, ed.colEd);
})();
function pick(s) { return { d: s.d, tw: s.tw, bof: s.bof, tof: s.tof, bif: s.bif, tif: s.tif }; }
