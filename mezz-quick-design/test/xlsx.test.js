// src/xlsx.js (the .xlsx writer) and src/calcpack.js (the calc package). The writer: a zip every reader takes (CRC,
// sizes, stored and deflated entries), the parts Excel needs, escaped text, numbers, booleans, styles, merges, row
// heights. The package, on the sample jobs: every sheet, every mark and column, numbers where numbers are, no "NaN".
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const X = require('../src/xlsx.js');

// a minimal unzip: local headers in order (no data descriptors — the writer never uses them)
function unzip(u) {
  const out = {}, dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let o = 0;
  while (dv.getUint32(o, true) === 0x04034b50) {
    const method = dv.getUint16(o + 8, true), crc = dv.getUint32(o + 14, true), csize = dv.getUint32(o + 18, true), size = dv.getUint32(o + 22, true);
    const nlen = dv.getUint16(o + 26, true), xlen = dv.getUint16(o + 28, true), name = Buffer.from(u.subarray(o + 30, o + 30 + nlen)).toString('utf8');
    const raw = u.subarray(o + 30 + nlen + xlen, o + 30 + nlen + xlen + csize), data = method === 8 ? new Uint8Array(zlib.inflateRawSync(raw)) : raw;
    assert.strictEqual(data.length, size, name + ' size');
    assert.strictEqual(X.crc32(data), crc, name + ' crc');
    out[name] = Buffer.from(data).toString('utf8');
    o += 30 + nlen + xlen + csize;
  }
  // the central directory and its end record agree with the entries
  const end = u.length - 22;
  assert.strictEqual(dv.getUint32(end, true), 0x06054b50, 'end record');
  assert.strictEqual(dv.getUint16(end + 10, true), Object.keys(out).length, 'entry count');
  assert.strictEqual(dv.getUint32(end + 16, true), o, 'central directory offset');
  return out;
}

// CRC-32 and column names
assert.strictEqual(X.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
assert.deepStrictEqual([0, 25, 26, 27, 51, 52, 701, 702].map(X.colName), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);

// stored and deflated entries side by side
{
  const a = new TextEncoder().encode('stored entry'), b = new TextEncoder().encode('deflated entry '.repeat(200));
  const z = unzip(X.zip([{ name: 'a.txt', data: a }, { name: 'dir/b.txt', data: b, packed: new Uint8Array(zlib.deflateRawSync(b)) }]));
  assert.strictEqual(z['a.txt'], 'stored entry');
  assert.strictEqual(z['dir/b.txt'], 'deflated entry '.repeat(200));
}

// a workbook: parts, sheet names made legal and unique, cells of every kind
{
  const row = ['x', 2]; row.ht = 39.6;
  const bytes = X.book([
    { name: 'Summary', cols: [20, 10], freeze: 1, merges: ['A3:B3'], rows: [[{ v: 'Title', s: 't' }, null], [{ v: 'a < b & "c"', s: 'h' }, { v: 18.954, s: 'n3' }], row, [true, false, '', { v: NaN }], [{ v: '\u0007bell', s: 'note' }]] },
    { name: 'Summary', rows: [['dup']] },
    { name: 'a/b:c?*[d]', rows: [[1]] },
  ], { title: 'T & U' });
  const z = unzip(bytes);
  ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml'].forEach(n => assert.ok(z[n], n));
  assert.ok(/<sheet name="Summary" sheetId="1"/.test(z['xl/workbook.xml']));
  assert.ok(/<sheet name="Summary 2" sheetId="2"/.test(z['xl/workbook.xml']));
  assert.ok(/<sheet name="a b c d" sheetId="3"/.test(z['xl/workbook.xml']), z['xl/workbook.xml']);
  assert.ok(/<dc:title>T &amp; U<\/dc:title>/.test(z['docProps/core.xml']));
  const s1 = z['xl/worksheets/sheet1.xml'];
  assert.ok(s1.includes('<t xml:space="preserve">a &lt; b &amp; &quot;c&quot;</t>'));
  assert.ok(s1.includes(`<c r="B2" s="${X.STYLE.n3}"><v>18.954</v></c>`));
  assert.ok(s1.includes('<row r="3" ht="39.6" customHeight="1">'));
  assert.ok(s1.includes('<c r="A4" t="b"><v>1</v></c><c r="B4" t="b"><v>0</v></c>'));
  assert.ok(s1.includes('<is><t>NaN</t></is>'), 'a non-finite number is text, never a broken <v>');
  assert.ok(s1.includes('<t xml:space="preserve">bell</t>'), 'control characters are dropped');
  assert.ok(s1.includes('<mergeCell ref="A3:B3"/>') && s1.includes('state="frozen"') && s1.includes('fitToPage="1"'));
  // every style named resolves to an xf that exists
  const xfs = (z['xl/styles.xml'].match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/) || []);
  assert.strictEqual((xfs[2].match(/<xf /g) || []).length, +xfs[1]);
  Object.values(X.STYLE).forEach(i => assert.ok(i < +xfs[1], 'style ' + i));
  // well formed: tags balance in every part
  Object.entries(z).forEach(([n, x]) => { const open = (x.match(/<[A-Za-z][^>]*>/g) || []).filter(t => !t.endsWith('/>')).length, close = (x.match(/<\/[^>]+>/g) || []).length; assert.strictEqual(open, close, n + ' tags balance'); });
}

// the calc package on the sample jobs
const CP = require('../src/calcpack.js');
const dir = path.join(__dirname, '..', 'private', 'pcs');
let ok = fs.existsSync(path.join(dir, 'PCS_job3.pdf'));
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { ok = false; }
if (!ok) { console.log('xlsx tests passed (writer; sample jobs not present — the calc package skipped)'); process.exit(0); }
const { loadJob } = require('../oracle/job_load.js');
const cellText = c => (c != null && typeof c === 'object' ? c.v : c);
(async () => {
  for (const f of fs.readdirSync(dir).filter(n => /\.pdf$/i.test(n))) {
    const { job, inps } = await loadJob(path.join(dir, f));
    const sheets = CP.sheets(job, { inputs: inps, settings: {}, generated: '2026-01-01' });
    const names = sheets.map(s => s.name);
    ['Summary', 'Inputs', 'MB sheets', 'Beam options', 'Shop rules', 'Columns', 'Frame loads', 'Sources'].forEach(n => assert.ok(names.includes(n), `${f}: sheet ${n}`));
    assert.strictEqual(names.includes('Seismic'), !!(job.seismic && job.seismic.ok), `${f}: a Seismic sheet when the job has seismic`);
    const text = sheets.flatMap(s => s.rows.flatMap(r => (r || []).map(cellText))).filter(v => v != null).map(String);
    assert.ok(!text.some(t => /\bNaN\b|undefined|\[object Object\]/.test(t)), `${f}: ${text.find(t => /\bNaN\b|undefined|\[object Object\]/.test(t))}`);
    const sum = sheets.find(s => s.name === 'Summary'), col0 = sum.rows.map(r => cellText((r || [])[0]));
    job.marks.forEach(m => assert.ok(col0.includes(m.mark), `${f}: ${m.mark} on the Summary`));
    job.mezz.filter(r => r && r.colFinal).forEach(r => assert.ok(sum.rows.some(row => row && cellText(row[1]) === r.id && cellText(row[2]) === r.colFinal.name), `${f}: ${r.id} columns on the Summary`));
    // the beam rows carry the MB-sheet numbers as numbers
    job.marks.forEach(m => { const row = sum.rows.find(r => r && cellText(r[0]) === m.mark), c = m.spanRuns[0].check; assert.strictEqual(cellText(row[9]), c.res.CSR); assert.strictEqual(cellText(row[13]), c.V.D); });
    // every MB-sheet cell typed is on the MB sheets page with its value
    const mb = sheets.find(s => s.name === 'MB sheets'), typedCells = new Map(mb.rows.filter(r => r && r.length === 3).map(r => [String(cellText(r[0])).split(' ')[0], cellText(r[2])]));
    (job.excel.beam || []).forEach(b => b.sheets.forEach(sh => sh.steps.forEach(st => assert.ok(typedCells.has(`${st.sheet}!${st.cell}`), `${f}: ${st.sheet}!${st.cell}`))));
    // the frame loads add up to the beam end shears
    const fl = sheets.find(s => s.name === 'Frame loads'), D = fl.rows.slice(4).reduce((a, r) => a + (cellText(r[6]) || 0), 0);
    const want = (job.frameEntries || []).reduce((a, x) => a + x.entries.reduce((b, e) => b + e.D, 0), 0);
    assert.ok(Math.abs(D - want) < 1e-6, `${f}: frame dead ${D} vs ${want}`);
    // the whole package writes and reads back
    const z = unzip(X.book(sheets, { title: f }));
    assert.strictEqual(Object.keys(z).filter(n => n.startsWith('xl/worksheets/')).length, sheets.length);
    console.log(`  ${f}: ${sheets.length} sheets, ${text.length} cells`);
  }
  // with the seismic answered (W1S-26062: roof dead 4.66 psf asked for): a Seismic sheet — the workbook cells typed per
  // frame line and the EQ loads that go to NBG Frame, the ones the frame files get
  {
    const RUN = require('../src/run.js'), { inps } = await loadJob(path.join(dir, 'PCS_job3.pdf'));
    const items = inps.map(inp => ({ inp, settings: {} })), bk = RUN.runJob(items).seismic.buildings[0].bkey;
    const job = RUN.runJob(items, { seis: { buildings: { [bk]: { RDL: 4.66 } }, eqOverride: {} } });
    assert.ok(job.seismic.ok, job.seismic.need.join('; '));
    const se = CP.sheets(job, { inputs: inps, settings: {} }).find(s => s.name === 'Seismic');
    assert.ok(se, 'Seismic sheet');
    const cells = se.rows.map(r => (r || []).map(cellText));
    job.seismic.buildings[0].frames.forEach(fr => {
      assert.ok(cells.some(r => /frame line/.test(r[0] || '') && String(r[0]).includes(`frame line ${fr.label} `)), `frame ${fr.label} block`);
      fr.eqs.forEach(e => assert.ok(cells.some(r => r[0] === fr.label && r[1] === e.label && r[2] === e.member && Math.abs(r[5] - e.F) < 1e-9), `frame ${fr.label} ${e.member} applied`));
    });
    assert.ok(cells.some(r => /Lateral Calcs\. \(1\)!Q1/.test(r[0] || '')), 'R typed on the Lateral sheet');
  }
  console.log('xlsx tests passed');
})().catch(e => { console.error(e); process.exit(1); });
