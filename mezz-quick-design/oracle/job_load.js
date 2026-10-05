// Read a PCS and design the job as the app does (floor-plan arrows, every mezzanine together).
// Values the PCS leaves TBD are filled the way the quote engineer did on the example jobs:
// B 9'-0", C no requirement, seat 5", joists @ 4'-0". settings: the Settings page (e.g. { edition: '13' }).
const M = require('path').join(__dirname, '..');
const RUN = require(M + '/src/run.js'), PCS = require(M + '/src/pcs.js'), PLAN = require(M + '/src/plan.js'), LAYOUT = require(M + '/src/layout.js');
const { readPcs, loadPdfjs } = require(M + '/test/pdf-node.js');
async function loadJob(pdf, settings = {}) {
  const pages = await readPcs(pdf), pcs = PCS.parse(pages);
  const g = LAYOUT.buildingGrid({ ...pcs.building, frames: pcs.frames });
  const p = pages[pages.length - 1];
  const reg = PLAN.registerAndRead(PLAN.subpaths(await p._page.getOperatorList(), loadPdfjs().OPS, p.height), { xs: g.xs, colY: [...new Set([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()])], lewY: g.lewY, rewY: g.rewY, width: g.width, letterLines: g.allY });
  RUN.applyPlan(pcs, reg);
  const inps = pcs.mezzanines.map((m, i) => RUN.inputsFromPCS(pcs, i));
  const miss = n => !n || n.value == null || n.source === 'missing';
  inps.forEach(inp => { const q = inp.geom; if (miss(q.B)) q.B = { value: 9, source: 'manual' }; if (miss(q.C)) q.C = { value: null, source: 'none' }; if (miss(q.seat)) q.seat = { value: 5 / 12, source: 'manual' }; if (miss(q.joistSpacing)) q.joistSpacing = { value: 4, source: 'manual' }; });
  return { pcs, inps, job: RUN.runJob(inps.map(inp => ({ inp, settings }))) };
}
module.exports = { loadJob };
