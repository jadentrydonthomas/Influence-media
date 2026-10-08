// NBG Frame files: zip round trip, the concentrated-load rows, orientation, and (when the private files are present)
// the four frame files of W1S-26062 with the job's floor loads.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const FF = require('../src/framefile.js');
const io = { inflate: async u => new Uint8Array(zlib.inflateRawSync(u)), deflate: async u => new Uint8Array(zlib.deflateRawSync(u)) };
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;

// ---------- a small synthetic frame file (the element names NBG Frame writes, made-up values) ----------
function model({ cloads = '', floorDead = 0, cols = [[0.667, 'COL01'], [60, 'COL02'], [119.333, 'COL03']] } = {}) {
  const N = '\r\n';
  const col = ([x, id]) => `      <Column>${N}        <TopElevation>24</TopElevation>${N}        <GlobalX>${x}</GlobalX>${N}        <ID>${id}</ID>${N}        <ColumnType>BU</ColumnType>${N}      </Column>`;
  return ['<?xml version="1.0" encoding="utf-8"?>', '<FrameData>', '  <Project>', '    <Buildings>', '      <Building>',
    '        <Geometry>', '          <Type>RMG</Type>', '        </Geometry>',
    '        <SpecialLoads>', '          <CraneLoads />', '          <PLoads />', cloads, '          <SnowDriftLoads />', '        </SpecialLoads>',
    '        <Columns>', ...cols.map(col), '        </Columns>', '      </Building>', '    </Buildings>',
    '    <GeneralData>', '      <NBGJobNumber>X1X-00001</NBGJobNumber>', '      <FrameTitle>X1X-00001-Bldg 1-3</FrameTitle>', '    </GeneralData>',
    '    <BuildingInfo>', '      <WidthInFeet>120</WidthInFeet>', '      <LengthInFeet>140</LengthInFeet>', '      <BayWidth>28</BayWidth>', '    </BuildingInfo>',
    '    <Loads>', `      <FloorDead>${floorDead}</FloorDead>`, '      <FloorLive>0</FloorLive>', '    </Loads>', '  </Project>', '</FrameData>', ''].filter(l => l !== '').join(N);
}
const lean = (member, ind = '            ') => ['<CLoad>', '  <loadGroup>0</loadGroup>', '  <status>Global</status>', '  <xMag>0</xMag>', '  <yMag>-1.5</yMag>', '  <moment>0</moment>', '  <location>23.75</location>', '  <eccentricity>0</eccentricity>', `  <memberID>${member}</memberID>`, '  <loadCaseID>RDL</loadCaseID>', '  <locSys>1</locSys>', '  <toFlange>1</toFlange>', '  <name>Lean-To</name>', '</CLoad>'].map(l => ind + l).join('\r\n');
async function fileOf(xml, name = 'Frame_1_Bldg_1_3-5.frame') {
  const raw = new TextEncoder().encode(xml), other = new TextEncoder().encode('<Connections />');
  const ent = (n, data, method, u) => ({ verMade: 20, verNeed: 20, flags: 0, method, time: 0, date: 33, crc: FF.crc32(u), usize: u.length, intAttr: 0, extAttr: 0, nameBytes: new TextEncoder().encode(n), data });
  const bytes = FF.zip([ent('.nfrx', await io.deflate(raw), 8, raw), ent('.connections.xml', other, 0, other)]);
  return FF.read(bytes, io, name);
}
const lines = [
  { frame: '3', building: 'Bldg 1', entries: [{ label: '3/A', y: 120, D: 10, L: 20, elev: 10.75, A: 11.5 }, { label: '3/C', y: 80, D: 5, L: 9, elev: 10.75, A: 11.5 }] },
  { frame: '4', building: 'Bldg 1', entries: [{ label: '4/A', y: 120, D: 12, L: 18, elev: 10.75, A: 11.5 }, { label: '4/E', y: 60, D: 7, L: 14, elev: 10.75, A: 11.5 }] },
  { frame: '6', building: 'Bldg 1', entries: [{ label: '6/A', y: 120, D: 99, L: 99, elev: 10.75, A: 11.5 }] },
];

(async () => {
  // names, building, frame lines
  assert.deepStrictEqual(FF.frameLinesOf('Frame_1234567_Bldg_1_3-5.frame'), [3, 4, 5]);
  assert.deepStrictEqual(FF.frameLinesOf('Frame_1234567_Bldg_1_3-5 (2).frame'), [3, 4, 5]);
  assert.deepStrictEqual(FF.frameLinesOf('Frame_1234567_Bldg_1_6_mezz.frame'), [6]);
  assert.deepStrictEqual(FF.frameLinesOf('renamed.frame', 'X-Bldg 1-2'), [2]);
  assert.strictEqual(FF.buildingOf('W1S-26062-Bldg 1-1', 'W1S-26062'), 'Bldg 1');
  assert.strictEqual(FF.buildingOf('W1S-26062-Main Building-3', 'W1S-26062'), 'Main Building');

  // read
  const f = await fileOf(model({ cloads: ['          <CLoads>', lean('COL01'), '          </CLoads>'].join('\r\n') }));
  assert.deepStrictEqual(f.info.lines, [3, 4, 5]);
  assert.strictEqual(f.info.building, 'Bldg 1');
  assert.deepStrictEqual(f.info.columns.map(c => [c.id, c.x]), [['COL01', 0.667], ['COL02', 60], ['COL03', 119.333]]);
  assert.strictEqual(f.info.cloads.length, 1);

  // orientation: symmetric frame → the lean-to decides; asymmetric interior columns decide on their own
  assert.deepStrictEqual(FF.orient(f.info, { interior: [60], leanToWall: 'FSW' }).mirrored, false);
  assert.strictEqual(FF.orient(f.info, { interior: [60], leanToWall: 'FSW' }).how, 'lean-to');
  assert.strictEqual(FF.orient(f.info, { interior: [60], leanToWall: 'BSW' }).mirrored, true);
  assert.strictEqual(FF.orient(f.info, { interior: [60] }).how, 'assumed');
  const asym = await fileOf(model({ cols: [[0.667, 'COL01'], [40, 'COL02'], [119.333, 'COL03']] }));
  assert.deepStrictEqual([FF.orient(asym.info, { interior: [40] }).mirrored, FF.orient(asym.info, { interior: [80] }).mirrored], [false, true]);

  // rows: lines 3-5 only (6 is another file), the larger load per column, a column the file does not have listed apart
  const r = FF.rowsFor(f.info, lines);
  assert.deepStrictEqual(r.used, ['3', '4']);
  assert.deepStrictEqual(r.rows.map(x => [x.name, x.caseId, x.member, x.y, x.location]), [
    ['FDL 2', 'FDL', 'COL02', -7, 10.75], ['FLL 2', 'FLL', 'COL02', -14, 10.75], ['FDL 3', 'FDL', 'COL03', -12, 10.75], ['FLL 3', 'FLL', 'COL03', -20, 10.75]]);
  assert.deepStrictEqual(r.unplaced.map(u => u.label), ['3/C']);
  assert.strictEqual(FF.rowsFor(f.info, lines, { height: 'A' }).rows[0].location, 11.5);
  // mirrored: the BSW loads go on COL01
  assert.deepStrictEqual(FF.rowsFor(f.info, lines, { mirrored: true }).rows.map(x => x.member), ['COL01', 'COL01', 'COL02', 'COL02']);
  assert.strictEqual(FF.rowsFor(f.info, lines, { building: 'Bldg 2' }).rows.length, 0, 'another building’s loads never go in');

  // add: CRLF and indentation kept, floors to 1 psf, a second export replaces the first, hand-typed "FDL 1" rows too
  const a1 = FF.addLoads(f.xml, r.rows);
  assert.strictEqual(a1.added, 4);
  assert.ok(!/[^\r]\n/.test(a1.xml), 'CRLF only');
  assert.ok(a1.xml.includes('            <CLoad>\r\n              <loadGroup>0</loadGroup>'));
  assert.ok(a1.xml.includes('<name>FDL 2</name>') && a1.xml.includes(`<toFlange>${FF.WEB_GUESS}</toFlange>`) && a1.xml.includes('<yMag>-7</yMag>'));
  assert.ok(!/<toFlange>0<\/toFlange>/.test(a1.xml), 'never the code NBG Frame rejects (blank Ecc. Loc., "Invalid data")');
  assert.throws(() => FF.addLoads(f.xml, r.rows, { toFlange: '0' }));
  assert.ok(FF.addLoads(f.xml, r.rows, { toFlange: '3' }).xml.includes('<toFlange>3</toFlange>'));
  // the WebCenterline code from a saved file: rows fixed by hand in NBG Frame, not the code written, not 0 / Top/Left
  const fixed = FF.cloadsOf(a1.xml.replace(/<toFlange>2<\/toFlange>(\r\n\s*<name>FDL 2<)/, '<toFlange>3</toFlange>$1')).map(c => c.fields);
  assert.deepStrictEqual(FF.learnWebCode(fixed, '2'), { code: '3', rows: 1 });
  assert.strictEqual(FF.learnWebCode(FF.cloadsOf(a1.xml).map(c => c.fields), '2'), null, 'nothing changed by hand, nothing learned');
  assert.deepStrictEqual(FF.learnWebCode([{ loadCaseID: 'FDL', name: 'FDL 2', toFlange: '0' }, { loadCaseID: 'FLL', name: 'FLL 2', toFlange: '3' }, { loadCaseID: 'FDL', name: 'FDL 3', toFlange: '1' }], '2'), { code: '3', rows: 1 });
  assert.ok(a1.xml.includes('<FloorDead>1</FloorDead>') && a1.xml.includes('<FloorLive>1</FloorLive>'));
  const back = FF.cloadsOf(a1.xml).map(c => c.fields);
  assert.deepStrictEqual(back.map(c => c.name), ['Lean-To', 'FDL 2', 'FLL 2', 'FDL 3', 'FLL 3'], 'after the rows already there');
  assert.strictEqual(back[1].locSys, '1');
  const a2 = FF.addLoads(a1.xml, r.rows);
  assert.strictEqual(a2.replaced, 4);
  assert.strictEqual(a2.xml, a1.xml, 'same input, same file');
  const hand = a1.xml.replace('<name>FDL 2</name>', '<name>FDL2</name>');
  assert.strictEqual(FF.addLoads(hand, r.rows).xml, a1.xml);
  // removing the rows gives back the original text but for the floor values
  assert.strictEqual(FF.addLoads(a1.xml, []).xml, f.xml.replace('<FloorDead>0<', '<FloorDead>1<').replace('<FloorLive>0<', '<FloorLive>1<'));
  // floor loads already set are left
  assert.ok(FF.addLoads(model({ floorDead: 50 }).replace('<PLoads />', '<PLoads />\r\n          <CLoads />'), r.rows).xml.includes('<FloorDead>50</FloorDead>'));
  // <CLoads /> and no <CLoads> at all
  for (const m of [model({ cloads: '          <CLoads />' }), model()]) {
    const a = FF.addLoads(m, r.rows);
    assert.deepStrictEqual(FF.cloadsOf(a.xml).map(c => c.fields.name), ['FDL 2', 'FLL 2', 'FDL 3', 'FLL 3']);
    assert.ok(/<PLoads \/>\r\n          <CLoads>\r\n            <CLoad>/.test(a.xml), 'list right after <PLoads>, indented');
    assert.ok(a.xml.indexOf('</CLoads>') < a.xml.indexOf('<SnowDriftLoads'));
  }

  // write: the model re-deflated with a right CRC, the other entry copied byte for byte
  const out = await FF.write(f, a1.xml, io), re = await FF.read(out, io, 'x_3-5.frame');
  assert.strictEqual(re.xml, a1.xml);
  const e0 = FF.unzip(out).find(e => e.name === '.connections.xml'), e1 = f.entries.find(e => e.name === '.connections.xml');
  assert.deepStrictEqual(Buffer.from(e0.data), Buffer.from(e1.data));
  // the Ecc. Loc. check file: one zero-load row per candidate code, nothing else changed (floors left as they are)
  const chk = FF.cloadsOf(FF.eccCheck(f)).map(c => c.fields);
  assert.deepStrictEqual(chk.map(c => [c.name, c.toFlange, c.yMag, c.memberID, c.loadCaseID]), [['Lean-To', '1', '-1.5', 'COL01', 'RDL']].concat(FF.ECC_CANDIDATES.map(c => [`ECC ${c}`, c, '0', 'COL01', 'RDL'])));
  assert.ok(FF.eccCheck(f).includes('<FloorDead>0</FloorDead>'), 'the check file leaves the floor loads');
  assert.ok(!FF.ECC_CANDIDATES.includes('0') && !FF.ECC_CANDIDATES.includes(FF.ECC_TOP_LEFT));
  // a byte-order mark stays where it was
  const withBom = new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode(model())]);
  const bf = FF.zip([{ verMade: 20, verNeed: 20, flags: 0, method: 0, time: 0, date: 33, crc: FF.crc32(withBom), usize: withBom.length, intAttr: 0, extAttr: 0, nameBytes: new TextEncoder().encode('.nfrx'), data: withBom }]);
  const bRead = await FF.read(bf, io, 'b_1.frame'), bOut = FF.unzip(await FF.write(bRead, bRead.xml, io))[0];
  assert.deepStrictEqual(Buffer.from(zlib.inflateRawSync(bOut.data)), Buffer.from(withBom));
  // bundle
  const b = FF.unzip(FF.bundle([{ name: 'a.frame', bytes: out }, { name: 'b.frame', bytes: new Uint8Array([1, 2, 3]) }]));
  assert.deepStrictEqual(b.map(e => [e.name, e.method, e.data.length]), [['a.frame', 0, out.length], ['b.frame', 0, 3]]);

  // ---------- the real files of W1S-26062 (private) ----------
  const dir = path.join(__dirname, '..', 'private', 'frame'), pdf = path.join(__dirname, '..', 'private', 'pcs', 'PCS_job3.pdf');
  let have = fs.existsSync(dir) && fs.existsSync(pdf) && fs.readdirSync(dir).some(n => /^Frame_\d+_Bldg_1_[\d-]+\.frame$/.test(n));
  try { require('./pdf-node.js').loadPdfjs(); } catch (e) { have = false; }
  if (!have) { console.log('frame file tests passed (W1S-26062 frame files not present, skipped)'); return; }
  const { loadJob } = require('../oracle/job_load.js');
  const { pcs, job } = await loadJob(pdf);
  const leanTo = (pcs.attachments || []).find(a => a.to === 'Bldg 1' && /^(FSW|BSW)$/.test(a.toWall));
  assert.deepStrictEqual(leanTo, { building: 'Bldg 2', wall: 'BSW', to: 'Bldg 1', toWall: 'FSW' });
  const want = {
    '1': { rows: [['FDL 2', 'COL02', 8.27], ['FLL 2', 'COL02', 17.5], ['FDL 3', 'COL03', 9.92], ['FLL 3', 'COL03', 21]], unplaced: ['1/C', '1/B'] },
    '2': { rows: [['FDL 2', 'COL02', 12.13], ['FLL 2', 'COL02', 25], ['FDL 3', 'COL03', 19.93], ['FLL 3', 'COL03', 42]], unplaced: [] },
    '3-5': { rows: [['FDL 3', 'COL03', 19.93], ['FLL 3', 'COL03', 42]], unplaced: [] },
    '6': { rows: [['FDL 3', 'COL03', 9.92], ['FLL 3', 'COL03', 21]], unplaced: ['6/B'] },
  };
  const outDir = process.env.MZ_FRAME_OUT;
  for (const name of fs.readdirSync(dir).filter(n => /^Frame_\d+_Bldg_1_[\d-]+\.frame$/.test(n)).sort()) {
    const key = /_([0-9-]+)\.frame$/.exec(name)[1], w = want[key];
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, name))), file = await FF.read(bytes, io, name);
    assert.strictEqual(file.info.job, 'W1S-26062');
    assert.strictEqual(file.info.building, 'Bldg 1');
    const fe = job.frameEntries.find(x => file.info.lines.map(String).includes(x.frame));
    const o = FF.orient(file.info, { interior: fe ? fe.interior : [], leanToWall: leanTo.toWall });
    assert.deepStrictEqual([o.mirrored, o.how], [false, 'lean-to'], name + ': COL01 is the FSW (the lean-to side)');
    const rr = FF.rowsFor(file.info, job.frameEntries, { mirrored: o.mirrored, building: file.info.building });
    assert.deepStrictEqual(rr.rows.map(x => [x.name, x.member, +(-x.y).toFixed(2)]), w.rows, name);
    assert.ok(rr.rows.every(x => near(x.location, 10.75)), name + ': at T/beam 10\'-9"');
    assert.deepStrictEqual(rr.unplaced.map(u => u.label), w.unplaced, name);
    const add = FF.addLoads(file.xml, rr.rows);
    assert.strictEqual(add.added, w.rows.length);
    assert.strictEqual(add.replaced, 0);
    assert.deepStrictEqual(add.floors, { FloorDead: { was: 0, now: 1 }, FloorLive: { was: 0, now: 1 } });
    // the text only gains the rows (after the 20 Lean-To rows) and the two 1-psf values
    const before = FF.cloadsOf(file.xml), after = FF.cloadsOf(add.xml);
    assert.strictEqual(after.length, before.length + w.rows.length);
    const ins = add.xml.slice(after[before.length].start, after[after.length - 1].end);
    assert.strictEqual(add.xml.replace(ins, ''), file.xml.replace('<FloorDead>0<', '<FloorDead>1<').replace('<FloorLive>0<', '<FloorLive>1<'));
    const outBytes = await FF.write(file, add.xml, io), again = await FF.read(outBytes, io, name);
    assert.strictEqual(again.xml, add.xml);
    file.entries.filter(e => e.name !== '.nfrx').forEach(e => assert.deepStrictEqual(Buffer.from(FF.unzip(outBytes).find(x => x.name === e.name).data), Buffer.from(e.data)));
    if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, name.replace(/\.frame$/, '_mezz.frame')), outBytes); }
  }
  console.log('frame file tests passed (W1S-26062: frames 1, 2, 3-5, 6 — FDL / FLL on COL02 / COL03 at 10\'-9", COL01 = FSW from the lean-to, 1/B 1/C 6/B listed as endwall columns)');
})().catch(e => { console.error(e); process.exit(1); });
