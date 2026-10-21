// Load a PDF in Node with pdfjs-dist (legacy build) and run the extractor + PCS parser.
// PDFJS_DIST points at a pdfjs-dist@3.11.174 install (not vendored in the repo).
const path = require('path');
const fs = require('fs');
require('./ocr-node.js');   // with OCR_TOOLS set, puts the canvas globals pdf.js renders with in place first

function loadPdfjs() {
  const dir = process.env.PDFJS_DIST || path.join(__dirname, '..', 'node_modules', 'pdfjs-dist');
  return require(path.join(dir, 'legacy', 'build', 'pdf.js'));
}

// opts.ocr: false to leave pages drawn as outlines unread; otherwise they are read when OCR_TOOLS is set (test/ocr-node.js)
async function readPcs(file, opts = {}) {
  const pdfjs = loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(file));
  const ocr = opts.ocr === false ? null : await require('./ocr-node.js').ocrEngine();
  const pdf = await pdfjs.getDocument({ data, disableFontFace: true, verbosity: 0, ...(ocr ? { canvasFactory: ocr.canvasFactory } : {}) }).promise;
  const EX = require('../src/extract.js');
  return EX.extractDoc(pdf, { OPS: pdfjs.OPS, ocr, onOcr: opts.onOcr });
}
const endOcr = async () => { const e = process.env.OCR_TOOLS ? await require('./ocr-node.js').ocrEngine() : null; if (e) await e.end(); };

module.exports = { readPcs, loadPdfjs, endOcr };

if (require.main === module) {
  (async () => {
    const pages = await readPcs(process.argv[2]);
    const PCS = require('../src/pcs.js');
    const res = PCS.parse(pages);
    if (process.argv[3] === '--lines') {
      const pn = +process.argv[4];
      PCS.lines(pages[pn - 1]).forEach(l => console.log(l.y.toFixed(1).padStart(6), l.items.map(i => `[${i.x.toFixed(0)}]${i.str}`).join(' ')));
      console.log(pages[pn - 1].annots);
    } else console.log(JSON.stringify(res, (k, v) => (k === 'pageRef' ? undefined : v), 1));
    await endOcr();
  })().catch(e => { console.error(e); process.exit(1); });
}
