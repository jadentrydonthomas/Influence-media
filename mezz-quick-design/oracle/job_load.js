// Read a PCS and design the job as the app does (floor-plan arrows, every mezzanine together).
// Values the PCS leaves TBD are filled the way the quote engineer did on the example jobs:
// B 9'-0", C no requirement, seat 5", joists @ 4'-0". settings: the Settings page (e.g. { edition: '13' }).
const M = require('path').join(__dirname, '..');
const RUN = require(M + '/src/run.js'), PCS = require(M + '/src/pcs.js'), PLAN = require(M + '/src/plan.js'), LAYOUT = require(M + '/src/layout.js');
const { readPcs, loadPdfjs } = require(M + '/test/pdf-node.js');
// null when the PDF has no mezzanine to read (pages drawn as outlines and no OCR_TOOLS to read them: test/ocr-node.js)
async function loadJob(pdf, settings = {}) {
  const pages = await readPcs(pdf), pcs = PCS.parse(pages);
  if (!pcs.mezzanines.length) return null;
  const g = LAYOUT.buildingGrid({ ...pcs.building, frames: pcs.frames });
  // the floor plan as the app finds it: the drawing page whose grid bubbles register to the frame lines
  const plan = await PLAN.findPlan(pages, PLAN.gridOf(g), p => p._page.getOperatorList(), loadPdfjs().OPS);
  RUN.applyPlan(pcs, plan ? { ...plan.reg, page: plan.page } : null);
  const inps = pcs.mezzanines.map((m, i) => RUN.inputsFromPCS(pcs, i));
  const miss = n => !n || n.value == null || n.source === 'missing';
  inps.forEach(inp => { const q = inp.geom; if (miss(q.B)) q.B = { value: 9, source: 'manual' }; if (miss(q.C)) q.C = { value: null, source: 'none' }; if (miss(q.seat)) q.seat = { value: 5 / 12, source: 'manual' }; if (miss(q.joistSpacing)) q.joistSpacing = { value: 4, source: 'manual' }; });
  return { pcs, inps, plan, job: RUN.runJob(inps.map(inp => ({ inp, settings }))) };
}
module.exports = { loadJob };
