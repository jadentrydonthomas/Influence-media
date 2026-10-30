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
// as the page writes a download: the tool's results saved with their formulas (what Excel shows before it recalculates,
// in Protected View), every other formula's saved result emptied (the template's last job never shows)
{
  // (the later copy carries an earlier job's results on MB1 — 11.5 k live end shear, "SHEAR OK …" — the first is blank)
  const later = path.join(dir, '..', 'jobs', 'workbooks-new', 'Mezzanine_Beam_Design_15th.xls');
  const src = new Uint8Array(fs.readFileSync(fs.existsSync(later) ? later : path.join(dir, 'Mezzanine_Beam_Design_15th.xls')));
  const was = X.read(src, [{ sheet: 'MB1', cell: 'H10' }, { sheet: 'MB1', cell: 'G20' }]);
  if (fs.existsSync(later)) assert.ok(was['MB1!H10'] !== '' && was['MB1!G20'] !== '', 'the later copy carries an earlier job\'s results');
  const r = X.fill(src, [{ sheet: 'MB1', cell: 'D7', value: 24 }, { sheet: 'MB1', cell: 'D9', value: 28 }],
    { results: [{ sheet: 'MB1', cell: 'M20', value: 'BU16x77' }, { sheet: 'MB1', cell: 'H6', value: 18.5 }, { sheet: 'MB1', cell: 'K11', value: 395.25 }, { sheet: 'MB1', cell: 'G19', value: 'COMBINED OK (SR = 0.97)' }], clearCached: true });
  assert.strictEqual(r.cached.length, 4);
  const back = X.read(r.bytes, ['M20', 'H6', 'K11', 'G19', 'H10', 'G20', 'D7'].map(cell => ({ sheet: 'MB1', cell })));
  assert.deepStrictEqual([back['MB1!M20'], back['MB1!H6'], back['MB1!K11'], back['MB1!G19']], ['BU16x77', 18.5, 395.25, 'COMBINED OK (SR = 0.97)'], 'saved results');
  assert.deepStrictEqual([back['MB1!H10'], back['MB1!G20']], ['', ''], 'the rest emptied');
  assert.strictEqual(back['MB1!D7'], 24);
  const a = X.cfbRead(src), b = consistent(r.bytes);
  a.ents.filter(e => e.type === 2 && !/^workbook$/i.test(e.name)).forEach(e => assert.ok(Buffer.from(a.stream(e.name)).equals(Buffer.from(b.stream(e.name))), `saved results: ${e.name} unchanged`));
}
// what Excel's file validation walks: every stream position the BIFF8 stream keeps (BOUNDSHEET, INDEX, DBCELL and the
// first cell of each of its rows) lands on the same record in the filled copy as in the original, and a formula has a
// STRING after it exactly when its saved result is text
function pointers(bytes) {
  const rs = X.records(X.cfbRead(bytes).stream('Workbook')), at = new Map(rs.map((r, i) => [r.off, i])), R = X.R, n = {}, ord = new Map();
  const CELL = [R.NUMBER, R.RK, R.MULRK, R.LABELSST, R.LABEL, R.BLANK, R.MULBLANK, R.BOOLERR, R.FORMULA];
  rs.forEach(r => { n[r.type] = n[r.type] || 0; ord.set(r.off, n[r.type]++); });
  const id = p => { const r = rs[at.get(p)]; return !r ? `mid-record ${p}` : CELL.includes(r.type) ? `cell ${u16(r.data, 0)},${u16(r.data, 2)}` : `${r.type}#${ord.get(p)}`; };
  const out = [];
  rs.forEach((r, i) => {
    if (r.type === R.BOUNDSHEET) out.push('BS ' + id(u32(r.data, 0)));
    if (r.type === R.INDEX) for (let o = 16; o + 4 <= r.data.length; o += 4) out.push('IX ' + id(u32(r.data, o)));
    if (r.type === R.DBCELL) {
      const first = r.off - u32(r.data, 0), rows = []; out.push('DB ' + id(first));
      for (let k = at.get(first); k < i && rs[k].type === R.ROW; k++) rows.push(rs[k]);
      let base = rows.length > 1 ? rows[1].off : rows[0].off + 4 + rows[0].data.length;
      for (let o = 4; o + 2 <= r.data.length; o += 2) { base += u16(r.data, o); out.push('DB ' + id(base)); }
    }
    if (r.type === R.FORMULA) {
      let k = i + 1; while (rs[k] && [R.SHRFMLA, R.ARRAY, R.TABLE].includes(rs[k].type)) k++;
      assert.strictEqual(r.data[12] === 0xFF && r.data[13] === 0xFF && r.data[6] === 0, !!(rs[k] && rs[k].type === R.STRING), 'a text result has its STRING');
    }
  });
  return out;
}
{
  const later = path.join(dir, '..', 'jobs', 'workbooks-new', 'Mezzanine_Beam_Design_15th.xls');
  [[fs.existsSync(later) ? later : path.join(dir, 'Mezzanine_Beam_Design_15th.xls'), [{ sheet: 'INPUT', cell: 'H2', value: 'a new project number' }, { sheet: 'MB1', cell: 'D7', value: 24 }]],
    [path.join(dir, 'Mezzanine_Column_16th_S16-19.xls'), [{ sheet: 'Column', cell: 'H2', value: 'a new description' }]],
    [path.join(dir, 'IBC_Seismic.xls'), [{ sheet: 'Input Data', cell: 'B26', value: 1.5 }]]].filter(([f]) => fs.existsSync(f)).forEach(([f, edits]) => {
    const src = new Uint8Array(fs.readFileSync(f)), r = X.fill(src, edits, { results: [], clearCached: true });
    assert.strictEqual(r.done.length, edits.length, `${path.basename(f)}: typed in`);
    assert.deepStrictEqual(pointers(r.bytes), pointers(src), `${path.basename(f)}: every stream position lands on the same record`);
  });
}
console.log('xls tests passed (beam, column and seismic workbooks: numbers, text — a new shared string too — check boxes and blanks typed and read back; BOUNDSHEET / INDEX / DBCELL consistent and landing on the same records as the original; every other stream unchanged)');
