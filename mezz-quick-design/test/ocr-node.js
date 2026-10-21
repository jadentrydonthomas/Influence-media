// OCR in Node, for the tests and the e2e runs: pdf.js renders on @napi-rs/canvas, tesseract.js reads (src/ocr.js).
// OCR_TOOLS points at a node_modules folder holding tesseract.js@5.1.1, @tesseract.js-data/eng@1.0.0 and
// @napi-rs/canvas (none vendored). Without it ocrEngine() is null: pages drawn as outlines stay unread and the tests
// that need them skip.
const path = require('path');
const OCR = require('../src/ocr.js');

// pdf.js draws with DOMMatrix and Path2D, which Node lacks: take them from @napi-rs/canvas before pdf.js loads
if (process.env.OCR_TOOLS) {
  try {
    const C = require(path.join(process.env.OCR_TOOLS, '@napi-rs', 'canvas'));
    ['DOMMatrix', 'Path2D', 'ImageData'].forEach(k => { if (!globalThis[k] && C[k]) globalThis[k] = C[k]; });
  } catch (e) { /* no canvas here: the outlined pages stay unread */ }
}

let shared = null;
async function ocrEngine(workers = 2) {
  const dir = process.env.OCR_TOOLS;
  if (!dir) return null;
  if (shared) return shared;
  const T = require(path.join(dir, 'tesseract.js'));
  const { createCanvas } = require(path.join(dir, '@napi-rs', 'canvas'));
  const langPath = path.join(dir, '@tesseract.js-data', 'eng', '4.0.0_best_int');
  const scheduler = T.createScheduler();
  for (let i = 0; i < workers; i++) {
    const w = await T.createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' });
    await w.setParameters({ ...OCR.PAGE_PARAMS, ...(process.env.OCR_PSM ? { tessedit_pageseg_mode: process.env.OCR_PSM } : {}) });
    scheduler.addWorker(w);
  }
  // one more worker for figures read again on their own (src/ocr.js rereadFigures)
  const figures = await T.createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' });
  await figures.setParameters(OCR.LINE_PARAMS);
  const canvasFactory = {
    create(w, h) { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext('2d') }; },
    reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; },
    destroy(cc) { cc.canvas = null; cc.context = null; },
  };
  shared = {
    workers,
    canvas: (w, h) => createCanvas(w, h),
    canvasFactory,   // pdf.js 3.11 takes it per document: getDocument({ canvasFactory })
    recognize: async bytes => (await scheduler.addJob('recognize', Buffer.from(bytes), {}, { blocks: true, text: false })).data,
    line: async bytes => (await figures.recognize(Buffer.from(bytes), {}, { text: true })).data,
    end: async () => { await scheduler.terminate(); await figures.terminate(); shared = null; },
  };
  return shared;
}

module.exports = { ocrEngine };
