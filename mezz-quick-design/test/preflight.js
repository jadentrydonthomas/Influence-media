// Before the tests: say loudly what will be skipped, so "passed" is never read as "the sample jobs passed" when they
// did not run. The sample PCS files (private/pcs/), the NBG workbooks (private/workbooks/) and frame files are not in
// the repository; pdf.js comes from `npm install` (or PDFJS_DIST).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const has = (dir, re) => { try { return fs.readdirSync(path.join(root, dir)).some(n => re.test(n)); } catch (e) { return false; } };
let pdfjs = true;
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { pdfjs = false; }
const missing = [
  !pdfjs && 'pdf.js (run `npm install`, or set PDFJS_DIST) — every sample-job test',
  !has('private/pcs', /\.pdf$/i) && 'private/pcs/*.pdf — every sample-job test',
  !has('private/workbooks', /\.xls$/i) && 'private/workbooks/*.xls — the filled-workbook tests',
  !has('private/frame', /\.frame$/i) && 'private/frame/*.frame — the real frame-file tests',
].filter(Boolean);
if (missing.length) console.log(`\n*** SKIPPED below — not present:\n${missing.map(m => '***   ' + m).join('\n')}\n`);
else console.log('preflight: pdf.js, sample PCS, workbooks and frame files present — every test runs');
