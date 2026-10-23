// NBG Bracing files (src/bracingfile.js): read a .bracing, plan the mezzanine's "Mezz. Seismic" EQB / EQF loads and the
// wall strut lines, write them in. A small model is made here; a real one is checked too when present (private).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const FF = require('../src/framefile.js');
const BR = require('../src/bracingfile.js');
const io = { inflate: u => Promise.resolve(new Uint8Array(zlib.inflateRawSync(u))), deflate: u => Promise.resolve(new Uint8Array(zlib.deflateRawSync(u))) };

// a 60' × 100' building, frame lines every 25', braced bays: FSW 4–5, BSW 2–3; one bay with no struts at all
const line = (i, x) => `<Index>${i}</Index>\n<Name>${i + 1}</Name>\n<DistanceFromOne>${x}</DistanceFromOne>`;
const bay = (i, braced, struts = true) => `<SidewallBay>
<Index>${i}</Index>
${braced ? '<Braces>\n<Brace>\n<AppliedForces />\n<Index>0</Index>\n<TopElevation>20</TopElevation>\n<BottomElevation>0</BottomElevation>\n<MemberDescription>5/8_ROD</MemberDescription>\n</Brace>\n</Braces>' : '<Braces />'}
${struts ? '<Struts>\n  <Strut>\n    <AppliedForces />\n    <Index>0</Index>\n    <StrutType>Eave</StrutType>\n    <Elevation>20</Elevation>\n    <Real>false</Real>\n  </Strut>\n</Struts>' : '<Struts />'}
<WallBracingInfo>
<WallBracingInfo>
<FromLine>${i}</FromLine>
<ToLine>${i + 1}</ToLine>
</WallBracingInfo>
</WallBracingInfo>
<FromLine>
${line(i, i * 25)}
</FromLine>
<ToLine>
${line(i + 1, (i + 1) * 25)}
</ToLine>
</SidewallBay>`;
const load = (i, name, caseId, F) => `<ConcentratedLoad>\n<Index>${i}</Index>\n<Name>${name}</Name>\n<Elevation>10</Elevation>\n<Gridline>0</Gridline>\n<Magnitude>${F}</Magnitude>\n<PlaneNbr>0</PlaneNbr>\n<Frameline>2</Frameline>\n<LoadCaseId>${caseId}</LoadCaseId>\n<Direction>120</Direction>\n<Plane>119</Plane>\n</ConcentratedLoad>`;
const model = `<?xml version="1.0"?>
<Container>
<ProjectData>
<JobNumber>1234567</JobNumber>
<JobName>Test</JobName>
<BracingRun>Bldg_1234567</BracingRun>
<ApplicationVersion>1.12.15.0</ApplicationVersion>
<RoofDeadLoad>2.5</RoofDeadLoad>
<CollateralDeadLoad>5</CollateralDeadLoad>
<Buildings>
<BuildingLayout>
<WidthInFeet>60</WidthInFeet>
<LengthInFeet>100</LengthInFeet>
<BSWEaveHeight>20</BSWEaveHeight>
<FSWEaveHeight>20</FSWEaveHeight>
<WallData>
<FrontSidewall>
<Index>0</Index>
<AtGrid>0</AtGrid>
<Bays>
${[0, 1, 2, 3].map(i => bay(i, i === 3)).join('\n')}
</Bays>
</FrontSidewall>
<BackSidewall>
<Index>1</Index>
<AtGrid>4</AtGrid>
<Bays>
${[0, 1, 2, 3].map(i => bay(i, i === 1, i !== 2)).join('\n')}
</Bays>
</BackSidewall>
</WallData>
</BuildingLayout>
</Buildings>
<BracingLoads>
<BuildingCode>
<DesignCodeString>IBC2021</DesignCodeString>
<MBMAImportanceCategoryString>II-Standard Buildings</MBMAImportanceCategoryString>
</BuildingCode>
<Snow>
<RoofSnowLoad>30</RoofSnowLoad>
</Snow>
<Seismic>
<DesignCode>IBC2021</DesignCode>
<SiteClassString>D</SiteClassString>
<Ss>0.2</Ss>
<S1>0.08</S1>
</Seismic>
<SpecialConcentratedLoads>
${load(0, 'Crane stop', 'EQB', 0.5)}
${load(1, 'Mezz. Seismic', 'EQB', 1.333)}
</SpecialConcentratedLoads>
</BracingLoads>
</ProjectData>
</Container>`.replace(/\n/g, '\r\n');
const pfrx = new TextEncoder().encode('<?xml version="1.0"?>\r\n<Container />');
function bracingZip(xml) {
  const raw = new TextEncoder().encode(xml), now = { time: 0, date: 0x5521 };
  const ent = (name, u8) => { const data = new Uint8Array(zlib.deflateRawSync(u8)); return { verMade: 20, verNeed: 20, flags: 0, method: 8, ...now, crc: FF.crc32(u8), usize: u8.length, data, nameBytes: new TextEncoder().encode(name), intAttr: 0, extAttr: 0 }; };
  return FF.zip([ent('.bracingX', raw), ent('.pfrx', pfrx)]);
}

(async () => {
  const f = await BR.read(bracingZip(model), io, 'Bldg_1234567.bracing'), i = f.info;
  assert.deepStrictEqual([i.job, i.code, i.risk, i.roofDead, i.collateral, i.snow, i.width, i.length, i.seismic.Ss, i.seismic.S1, i.seismic.siteClass], ['1234567', 'IBC2021', 'II-Standard Buildings', 2.5, 5, 30, 60, 100, 0.2, 0.08, 'D']);
  assert.deepStrictEqual(i.lines.map(l => `${l.index}:${l.name}@${l.x}`), ['0:1@0', '1:2@25', '2:3@50', '3:4@75', '4:5@100']);
  assert.deepStrictEqual([i.walls.FSW.plane, i.walls.FSW.grid, i.walls.BSW.plane, i.walls.BSW.grid], [0, 0, 1, 4]);
  assert.deepStrictEqual(['FSW', 'BSW'].map(w => i.walls[w].bays.filter(b => b.braced).map(b => `${b.from}-${b.to}`).join()), ['3-4', '1-2']);
  assert.deepStrictEqual(i.loads.map(l => l.name), ['Crane stop', 'Mezz. Seismic']);
  // a mezzanine from 30' to 70' at 12': no frame line at its ends — the bay's lines 2 and 4 take EQB / EQF; the strut
  // line runs from it to each wall's braced bay
  const plan = BR.planFor(f, [{ wall: 'FSW', F: 2.5, at: 12, x0: 30, x1: 70 }, { wall: 'BSW', F: 2.5, at: 12, x0: 30, x1: 70 }]);
  assert.deepStrictEqual(plan.loads.map(l => `${l.wall} ${l.caseId} ${l.lineName} ${l.F}`), ['FSW EQB 2 2.5', 'FSW EQF 4 -2.5', 'BSW EQB 2 2.5', 'BSW EQF 4 -2.5']);
  assert.deepStrictEqual(plan.struts.map(s => `${s.wall} ${s.fromName}-${s.toName} @${s.elev} bay ${s.bay}`), ['FSW 2-5 @12 bay 4–5', 'BSW 2-4 @12 bay 2–3']);
  const out = await BR.write(f, plan, io);
  assert.deepStrictEqual([out.added, out.kept, out.replaced], [{ loads: 4, struts: 5 }, { struts: 0 }, 1]);
  const g = await BR.read(out.bytes, io);
  assert.deepStrictEqual(g.info.loads.map(l => `${l.name} ${l.caseId} wall ${l.plane + 1} line ${l.line + 1} grid ${l.grid} @${l.elev} ${l.F}`), [
    'Crane stop EQB wall 1 line 3 grid 0 @10 0.5', 'Mezz. Seismic EQB wall 1 line 2 grid 0 @12 2.5', 'Mezz. Seismic EQF wall 1 line 4 grid 0 @12 -2.5',
    'Mezz. Seismic EQB wall 2 line 2 grid 4 @12 2.5', 'Mezz. Seismic EQF wall 2 line 4 grid 4 @12 -2.5']);
  assert.deepStrictEqual(['FSW', 'BSW'].map(w => g.info.walls[w].bays.map(b => b.struts.map(s => s.elev).join('/') || '-').join(' | ')), ['20 | 20/12 | 20/12 | 20/12', '20 | 20/12 | 12 | 20']);
  assert.ok(/<Index>0<\/Index>\r\n\s*<Name>Crane stop<\/Name>/.test(out.xml) && out.xml.split('\n').every(l => l.endsWith('\r') || l === out.xml.split('\n').pop()), 'other loads kept; CRLF kept');
  // only the loads block and the struts changed; the purlin report is copied as it is
  const strip = x => x.replace(/<SpecialConcentratedLoads>[\s\S]*<\/SpecialConcentratedLoads>/, '').replace(/\s*<Strut>(?:(?!<\/Strut>)[\s\S])*?<Elevation>12<\/Elevation>[\s\S]*?<\/Strut>/g, '').replace(/<Struts>\s*<\/Struts>/g, '<Struts />');
  assert.strictEqual(strip(out.xml), strip(model));
  const pf = FF.unzip(out.bytes).find(e => e.name === '.pfrx');
  assert.deepStrictEqual(new Uint8Array(zlib.inflateRawSync(pf.data)), pfrx);
  // again on its own output: the same file (the struts are there, the loads replaced)
  const again = await BR.write(g, BR.planFor(g, [{ wall: 'FSW', F: 2.5, at: 12, x0: 30, x1: 70 }, { wall: 'BSW', F: 2.5, at: 12, x0: 30, x1: 70 }]), io);
  assert.ok(again.added.struts === 0 && again.kept.struts === 5 && again.replaced === 4 && again.xml === out.xml);
  // loads only: no strut line
  assert.strictEqual((await BR.write(f, { loads: plan.loads, struts: [] }, io)).added.struts, 0);

  // an eQuote project: the project loads and each building's roof loads and bracing
  const scope = BR.readScope(JSON.stringify({ SchemaVersion: '1.0', Project: { NucorQuoterNumber: '1234567', ProjectLoads: { BuildingCodeId: 168, MBMAImportanceCategory: 'II', SeismicLoad: { Ss: 0.125, S1: 0.044, Sms: 0.19, Sm1: 0.087, SiteClass: 'D' } },
    Planes: [{ Name: 'B:Front Sidewall (FSW)', BuildingId: 'x', Bracing: [{ BracingType: 'Wall X-Bracing', Bays: [7] }] }],
    Buildings: [{ Id: 'x', Name: 'B', Geometry: { BuildingWidth: 720, BuildingLength: 1920, FSWEaveHeightInches: 240, BSWEaveHeightInches: 240 }, BuildingLoads: { RoofDeadLoad: 2.5091, PrimaryCollateralPSF: 5, RoofSnowLoadPSF: 35.7 }, Mezzanines: [{ Name: '1', WidthInches: 720, LengthInches: 360, DeadLoadPSF: 1, LiveLoadPSF: 100, CollateralLoadPSF: 5, OccupancyClassifications: 'Office' }] }] } }));
  assert.deepStrictEqual([scope.code, scope.Ss, scope.S1, scope.siteClass, scope.buildings[0].width, scope.buildings[0].length, scope.buildings[0].roofDead, scope.buildings[0].bracing.FSW[0].bays[0], scope.buildings[0].mezz[0].length], ['IBC 2021', 0.125, 0.044, 'D', 60, 160, 2.5091, 7, 30]);

  // a real bracing run, when present (private): a mezzanine over its last bay — loads only, the rest of the model byte
  // for byte; with the strut line, a strut at the mezzanine level in each bay to the braced bay
  const dir = path.join(__dirname, '..', 'private', 'nbg-calcs');
  const real = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /\.bracing$/i.test(n)).map(n => path.join(dir, n))[0] : null;
  let realMsg = 'no real bracing file present';
  if (real) {
    const r = await BR.read(new Uint8Array(fs.readFileSync(real)), io, 'real.bracing'), L = r.info.lines, a = L[L.length - 2], z = L[L.length - 1];
    assert.ok(L.length >= 2 && r.info.walls.FSW && r.info.walls.BSW);
    const p = BR.planFor(r, ['FSW', 'BSW'].map(wall => ({ wall, F: 1.8, at: 10, x0: a.x, x1: z.x })));
    assert.deepStrictEqual(p.loads.map(l => `${l.wall} ${l.caseId} ${l.lineName}`), ['FSW', 'BSW'].flatMap(w => [`${w} EQB ${a.name}`, `${w} EQF ${z.name}`]));
    const o = await BR.write(r, { loads: p.loads, struts: [] }, io);
    assert.strictEqual(o.added.loads, 4);
    const x0 = r.xml, x1 = o.xml, s0 = x0.indexOf('<SpecialConcentratedLoads'), s1 = x1.indexOf('<SpecialConcentratedLoads');
    const e0 = x0.indexOf('</SpecialConcentratedLoads>') > 0 ? x0.indexOf('</SpecialConcentratedLoads>') + 27 : x0.indexOf('/>', s0) + 2;
    assert.ok(x0.slice(0, s0) === x1.slice(0, s1) && x0.slice(e0) === x1.slice(x1.indexOf('</SpecialConcentratedLoads>') + 27), 'the rest of the model byte for byte');
    const r2 = await BR.read((await BR.write(r, p, io)).bytes, io);
    p.struts.forEach(st => r2.info.walls[st.wall].bays.filter(b => b.from >= st.from && b.to <= st.to).forEach(b => assert.ok(b.struts.some(t => Math.abs(t.elev - 10) < 0.01))));
    realMsg = `a real bracing run: ${L.length} frame lines, loads at lines ${a.name} / ${z.name}, the rest byte for byte, strut lines in`;
  }
  console.log(`bracing file tests passed (EQB / EQF at the mezzanine's frame lines on both walls, strut lines to the braced bays, other loads kept, written twice = once; eScope read; ${realMsg})`);
})().catch(e => { console.error(e); process.exit(1); });
