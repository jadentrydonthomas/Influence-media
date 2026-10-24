// Assemble the single self-contained tool: mezz-quick-design/index.html
// usage: node build.js   (needs pdfjs-dist@3.11.174: `npm install` here, or PDFJS_DIST=/path/to/pdfjs-dist)
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const PDFJS = process.env.PDFJS_DIST || path.join(__dirname, 'node_modules', 'pdfjs-dist');
const resolve = name => (/^pdf(\.worker)?\.min\.js$/.test(name) ? path.join(PDFJS, 'build', name) : path.join(SRC, name));

// Keep inlined code from closing the <script> element or opening an HTML comment.
const safe = js => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let html = fs.readFileSync(path.join(SRC, 'app.html'), 'utf8');
html = html.replace(/\/\*@INLINE_CSS ([\w.-]+)\*\//g, (_, n) => fs.readFileSync(resolve(n), 'utf8'));
html = html.replace(/<script>\/\*@INLINE_JS ([\w.-]+)\*\/<\/script>/g, (_, n) => {
  const code = fs.readFileSync(resolve(n), 'utf8');
  // a script that does not parse would leave the page dead on load: stop the build instead
  try { new (require('vm').Script)(code, { filename: n }); } catch (e) { console.error(`build stopped — ${n} does not parse: ${e.message}`); process.exit(1); }
  return `<script>\n/* ---- ${n} ---- */\n${safe(code)}\n</script>`;
});
/* The OCR reader for a PCS whose pages carry no text layer (src/ocr.js): tesseract.js 5.1.1 and its SIMD LSTM core
   (Apache-2.0) and the English LSTM model (tessdata_best int, Apache-2.0), in inert blocks the page unpacks only when
   a PCS needs them. OCR_DIST is a node_modules folder with tesseract.js@5.1.1 and @tesseract.js-data/eng@1.0.0. */
const OCRD = process.env.OCR_DIST || path.join(__dirname, 'node_modules');
const OCR_FILES = { lib: 'tesseract.js/dist/tesseract.min.js', worker: 'tesseract.js/dist/worker.min.js', core: 'tesseract.js-core/tesseract-core-simd-lstm.js', wasm: 'tesseract.js-core/tesseract-core-simd-lstm.wasm', eng: '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz' };
let ocrNote = 'no OCR reader (set OCR_DIST)';
// tesseract.js 5.1.1 initialises a language handed over in memory ({ code, data }) by its data instead of its code
// (src/worker-script/index.js, initialize): the worker names it by code, as loadLanguage does
function patchWorker(js) {
  const bug = 'return"string"==typeof t?t:t.data})).join("+")', n = js.split(bug).length - 1;
  if (n !== 1) { console.error(`build stopped — worker.min.js: the language-name fix matched ${n} times (expected tesseract.js 5.1.1)`); process.exit(1); }
  return js.replace(bug, 'return"string"==typeof t?t:t.code})).join("+")');
}
if (Object.values(OCR_FILES).every(f => fs.existsSync(path.join(OCRD, f)))) {
  const read = f => fs.readFileSync(path.join(OCRD, f));
  const tv = JSON.parse(fs.readFileSync(path.join(OCRD, 'tesseract.js', 'package.json'), 'utf8')).version;
  if (tv !== '5.1.1') console.warn(`warning: expected tesseract.js 5.1.1, found ${tv}`);
  const block = (id, text) => `<script type="text/plain" id="${id}">${text}</script>`;
  const blocks = [
    `<!-- OCR reader: tesseract.js ${tv} + tesseract.js-core (Apache License 2.0, github.com/naptha/tesseract.js; bundles zlib.js, MIT), eng.traineddata from tessdata_best (Apache License 2.0, github.com/tesseract-ocr/tessdata_best) -->`,
    block('ocr-lib', safe(read(OCR_FILES.lib).toString('utf8'))),
    block('ocr-worker', safe(patchWorker(read(OCR_FILES.worker).toString('utf8')))),
    block('ocr-core', safe(read(OCR_FILES.core).toString('utf8'))),
    block('ocr-wasm', require('zlib').gzipSync(read(OCR_FILES.wasm), { level: 9 }).toString('base64')),
    block('ocr-eng', read(OCR_FILES.eng).toString('base64')),
  ];
  html = html.replace('<!--@OCR_ASSETS-->', () => blocks.join('\n'));
  ocrNote = `OCR reader tesseract.js ${tv}`;
} else {
  html = html.replace('<!--@OCR_ASSETS-->', '');
  console.warn('warning: built without the OCR reader — a PCS drawn as outlines (no text layer) will not be read. Set OCR_DIST.');
}
const pkg = JSON.parse(fs.readFileSync(path.join(PDFJS, 'package.json'), 'utf8'));
if (pkg.version !== '3.11.174') console.warn(`warning: expected pdfjs-dist 3.11.174, found ${pkg.version}`);
const stamp = new Date().toISOString().slice(0, 10);
html = html.replace('</title>', `</title>\n<meta name="generator" content="mezz-quick-design build ${stamp}; pdf.js ${pkg.version}; ${ocrNote}">`);
const out = process.env.BUILD_OUT ? path.resolve(process.env.BUILD_OUT) : path.join(__dirname, 'index.html');   // BUILD_OUT: a copy elsewhere (the tests read index.html)
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB)`);
