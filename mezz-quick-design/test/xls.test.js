// src/xls.js: typing values into the real NBG workbooks. With the workbooks present (private/workbooks/, not in the
// repo): every typed cell reads back, the stream positions the format keeps stay consistent, every other stream of
// the compound file (the VBA project …) is byte for byte the same, and RECALCID is gone (Excel recalculates on open).
// oracle/fill_check.py goes further: LibreOffice recalculates the copies and every result equals the tool's.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const X = require('../src/xls.js');

// RK numbers
[24, 0, -3, 22.33, 4.66, 0.4167, 1e9, 18.954].forEach(v => { const rk = X.rkOf(v); if (rk != null) assert.strictEqual(X.rkVal(rk), v, 'RK ' + v); });
assert.strictEqual(X.rkOf(0.4167), null);
assert.deepStrictEqual(X.addr('D14'), { r: 13, c: 3 });
assert.deepStrictEqual(X.addr('$AB$2'), { r: 1, c: 27 });

const dir = path.join(__dirname, '..', 'private', 'workbooks');
if (!fs.existsSync(path.join(dir, 'IBC_Seismic.xls'))) { console.log('xls tests passed (RK; the NBG workbooks are not present — fill skipped)'); process.exit(0); }
const u16 = (d, o) => d[o] | (d[o + 1] << 8), u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
function consistent(bytes) {
  const cf = X.cfbRead(bytes), rs = X.records(cf.stream('Workbook')), at = new Map(rs.map(r => [r.off, r])), R = X.R;
  X.sheetsOf(rs).forEach(s => assert.strictEqual((at.get(s.pos) || {}).type, R.BOF, 'BOUNDSHEET → BOF'));
  rs.filter(r => r.type === R.INDEX).forEach(r => { for (let o = 16; o + 4 <= r.data.length; o += 4) assert.strictEqual((at.get(u32(r.data, o)) || {}).type, R.DBCELL, 'INDEX → DBCELL'); });
  rs.filter(r => r.type === R.DBCELL).forEach(r => assert.strictEqual((at.get(r.off - u32(r.data, 0)) || {}).type, R.ROW, 'DBCELL → first ROW'));
  assert.ok(!rs.some(r => r.type === R.RECALCID));
  return cf;
}
const cases = [
  ['Mezzanine_Beam_Design_15th.xls', [['INPUT', 'D14', 40], ['INPUT', 'D16', 125], ['MB1', 'D5', 'MB1'], ['MB1', 'D7', 22.333333], ['MB1', 'D9', 28], ['MB1', 'M22', 15], ['MB1', 'M23', 0.3125], ['MB2', 'D5', 'MB2 a mark name not in the workbook'], ['MB1', 'D15', null]]],
  ['Mezzanine_Column_15th_S16-14.xls', [['Column', 'C16', 'W8X24'], ['Column', 'C27', 18.954], ['Miscellaneous', 'K8', '50']]],
  ['IBC_Seismic.xls', [['Input Data', 'B7', 'Standard Buildings'], ['Input Data', 'B26', 0.169], ['Input Data', 'B21', true], ['Miscellaneous', 'B36', true], ['Lateral Calcs. (1)', 'Q1', 3], ['Input Data', 'B89', 11.5], ['Input Data', 'F90', 55]]],
];
for (const [file, edits] of cases) {
  const src = new Uint8Array(fs.readFileSync(path.join(dir, file)));
  const r = X.fill(src, edits.map(([sheet, cell, value]) => ({ sheet, cell, value })));
  assert.deepStrictEqual(r.missing, [], file);
  assert.strictEqual(r.done.length, edits.length);
  const back = X.read(r.bytes, edits.map(([sheet, cell]) => ({ sheet, cell })));
  edits.forEach(([sheet, cell, v]) => assert.strictEqual(back[`${sheet}!${cell}`], v == null ? '' : v, `${file} ${sheet}!${cell}`));
  const a = X.cfbRead(src), b = consistent(r.bytes);
  a.ents.filter(e => e.type === 2 && !/^workbook$/i.test(e.name)).forEach(e => assert.ok(Buffer.from(a.stream(e.name)).equals(Buffer.from(b.stream(e.name))), `${file}: ${e.name} unchanged`));
  assert.strictEqual(r.bytes.length % a.ss, 0);
}
console.log('xls tests passed (beam, column and seismic workbooks: numbers, text — a new shared string too — check boxes and blanks typed and read back; BOUNDSHEET / INDEX / DBCELL consistent; every other stream unchanged)');
