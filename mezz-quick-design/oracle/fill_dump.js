// Fill the real NBG workbooks the way the page's "Download the filled workbook" does (src/xls.js), from a job's
// step-by-step Excel entries, and list what to read back. Then oracle/fill_check.py opens each copy in LibreOffice,
// recalculates and compares with the tool, and xlrd re-reads every copy as a strict check of the file structure.
//   node oracle/fill_dump.js out_dir pcs.pdf …     (the workbooks from private/workbooks/)
//   MZ_SETTINGS='{"colOverride":"alt"}' …        (the job with its lighter built-up column picked)
const fs = require('fs'), path = require('path');
const XLS = require('../src/xls.js');
const { loadJob } = require('./job_load.js');
const WB = process.env.MZ_WORKBOOKS || path.join(__dirname, '..', 'private', 'workbooks');
(async () => {
  const out = process.argv[2], list = [];
  fs.mkdirSync(out, { recursive: true });
  for (const pdf of process.argv.slice(3)) {
    const ld = await loadJob(pdf), { pcs, inps } = ld, q = pcs.job.quote;
    // MZ_SETTINGS: settings for every mezzanine (JSON); colOverride "alt" takes the job's lighter built-up column
    let job = ld.job;
    if (process.env.MZ_SETTINGS) {
      const st = JSON.parse(process.env.MZ_SETTINGS), RUN0 = require('../src/run.js');
      if (st.colOverride === 'alt') { const a = job.colAlt; if (!a) { console.log(q, 'no built-up alternative — skipped'); continue; } st.colOverride = { type: 'BU', d: a.sec.d, tw: a.sec.tw, bf: a.sec.bof, tf: a.sec.tof }; }
      job = RUN0.runJob(inps.map(inp => ({ inp, settings: { ...st } })));
    }
    const books = [];
    job.excel.beam.forEach((b, i) => books.push({ kind: 'beam', file: b.file, runs: [{ steps: b.inputs[0].steps.concat(b.sheets.flatMap(s => s.steps)), read: b.sheets.flatMap(s => s.read).concat(b.inputs[0].read) }], tag: `beam${i + 1}` }));
    job.excel.column.forEach((b, i) => b.cases.forEach((c, k) => books.push({ kind: 'column', file: b.file, runs: [{ steps: c.steps, read: c.read }], tag: `col${i + 1}-${k + 1}` })));
    // the seismic workbook, a copy per frame line (roof dead is "Per Seller" on these PCSs: a stand-in where it is missing)
    const RUN = require('../src/run.js');
    let sj = job.seismic;
    if (sj && !sj.ok) sj = RUN.runJob(inps.map(inp => ({ inp, settings: {} })), { seis: { buildings: Object.fromEntries(sj.buildings.map(b => [b.bkey, { RDL: 4.66 }])) } }).seismic;
    (sj && sj.ok ? sj.buildings : []).forEach((b, bi) => (b.workbook ? b.workbook.frames : []).forEach(fr => books.push({ kind: 'seismic', file: b.workbook.file, runs: [{ steps: b.workbook.input.concat(b.workbook.long, fr.steps), read: fr.read.concat(b.workbook.longRead) }], tag: `seis-b${bi + 1}-f${fr.label}` })));
    for (const b of books) {
      const src = fs.readFileSync(path.join(WB, b.file));
      const edits = b.runs[0].steps.map(st => ({ sheet: st.sheet, cell: st.cell, value: st.value }));
      const r = XLS.fill(new Uint8Array(src), edits);
      const name = `${q}-${b.tag}.xls`;
      fs.writeFileSync(path.join(out, name), r.bytes);
      list.push({ quote: q, file: name, book: b.file, missing: r.missing, done: r.done.length, added: r.stringsAdded, steps: edits, read: b.runs[0].read });
      console.log(q, name, `${r.done.length}/${edits.length} cells`, r.missing.length ? 'MISSING ' + JSON.stringify(r.missing) : '', r.stringsAdded ? `+${r.stringsAdded} strings` : '');
    }
  }
  fs.writeFileSync(path.join(out, 'filled.json'), JSON.stringify(list, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
