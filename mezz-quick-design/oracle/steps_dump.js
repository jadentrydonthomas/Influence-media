// The app's "Excel, step by step" lists for a job, as runs for steps_oracle.py (type them, read back),
// and steps_check.js compares what Excel shows with what the tool says it will show.
// usage: node oracle/steps_dump.js PCS.pdf oracle/out/steps [settings-json]
const fs = require('fs');
const { loadJob } = require('./job_load.js');
(async () => {
  const [pdf, pre, set] = process.argv.slice(2);
  const { job } = await loadJob(pdf, set ? JSON.parse(set) : {});
  const books = [];
  job.excel.beam.forEach(b => {
    const runs = [{ tag: 'INPUT', steps: b.inputs[0].steps, read: [] }];
    b.sheets.forEach(sh => runs.push({ tag: `${sh.sheet} = ${sh.mark}${sh.shorter ? ' at ' + sh.span : ''}`, steps: sh.steps, read: sh.read }));
    // the INPUT clearance block uses the deepest beam on MB1–MB4: read it once every sheet is in, for each mezzanine
    b.inputs.forEach(inp => runs.push({ tag: `INPUT clearances · ${inp.mezz}`, steps: inp.steps, read: inp.read }));
    books.push({ file: b.file, runs });
  });
  job.excel.column.forEach(b => books.push({ file: b.file, runs: b.cases.map(c => ({ tag: `Column ${c.mezz} ${c.labels.join(',')}`, steps: c.steps, read: c.read })) }));
  fs.writeFileSync(pre + '.json', JSON.stringify(books));
  console.log(pre, books.map(b => `${b.file}: ${b.runs.length} runs, ${b.runs.reduce((a, r) => a + r.steps.length, 0)} cells typed`).join(' · '));
})();
