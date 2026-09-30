// Load a PDF in Node with pdfjs-dist (legacy build) and run the extractor + PCS parser.
// PDFJS_DIST points at a pdfjs-dist@3.11.174 install (not vendored in the repo).
const path = require('path');
const fs = require('fs');

function loadPdfjs() {
  const dir = process.env.PDFJS_DIST || path.join(__dirname, '..', 'node_modules', 'pdfjs-dist');
  return require(path.join(dir, 'legacy', 'build', 'pdf.js'));
}

async function readPcs(file) {
  const pdfjs = loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjs.getDocument({ data, disableFontFace: true, verbosity: 0 }).promise;
  const EX = require('../src/extract.js');
  return EX.extractDoc(pdf);
}

module.exports = { readPcs, loadPdfjs };

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
  })().catch(e => { console.error(e); process.exit(1); });
}
