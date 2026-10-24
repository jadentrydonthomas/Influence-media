// The practice contracts (private/jobs/k01…k10, when present): what the quote engineer typed or drew over the print is
// read the way they meant it — a note's lines each on their own row, values typed without their foot marks, an opening
// boxed on the marked-up plan framed and left out of the seismic loading area, notes with arrows to columns, the
// drawing's hand-drawn X marks on their grid lines.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'private', 'jobs'), job = k => path.join(dir, k, 'PCS.pdf');
let ok = fs.existsSync(job('k01'));
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { ok = false; }
if (!ok) { console.log('practice tests passed (practice contracts not present, skipped)'); process.exit(0); }
const { readPcs } = require('./pdf-node.js');
const { loadJob } = require('../oracle/job_load.js');
const PCS = require('../src/pcs.js');
const RUN = require('../src/run.js');
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const geo = async (k, mi = 0) => { const p = PCS.parse(await readPcs(job(k))), g = RUN.inputsFromPCS(p, mi).geom; return k2 => g[k2]; };
(async () => {
  const seen = [];
  // k02: red notes in the Provided column — "8'-0"⏎7'-10"" in one box over C and D, "17'-10"" for F in a box reaching
  // the seat row; the seat and the joist spacing stay the printed 0'-5" and 3'-11"
  if (fs.existsSync(job('k02'))) {
    const g = await geo('k02');
    assert.ok(near(g('C').value, 8) && g('C').source === 'annotation', 'C 8\'-0" from the first line of the note');
    assert.ok(near(g('D').value, 7 + 10 / 12) && g('D').source === 'annotation', 'D 7\'-10" from its second line');
    assert.ok(near(g('F').value, 17 + 10 / 12) && g('F').source === 'annotation');
    assert.ok(near(g('seat').value, 5 / 12) && g('seat').source !== 'annotation', 'the seat is the printed 0\'-5", not the 17\'-10" note');
    assert.ok(near(g('joistSpacing').value, 3 + 11 / 12) && g('joistSpacing').source !== 'annotation');
    seen.push('k02 C / D / F from the notes, seat 5"');
  }
  // k02 seismic against the engineer's own Design Calcs file: its inputs typed (code, Ss / S1, roof, the mezzanine's
  // loads with no framing added, the 2 k it puts on line 4) give its base shear on every frame line and the bracing
  const calcs = path.join(dir, 'k02', 'NewFile.nbgcalcs');
  if (fs.existsSync(job('k02')) && fs.existsSync(calcs)) {
    const { pcs, inps } = await loadJob(job('k02'));
    const items = inps.map(inp => ({ inp, settings: {} }));
    const d = JSON.parse(fs.readFileSync(calcs, 'utf8').replace(/^\uFEFF/, '')), doc = d.Folders[0].Documents.find(x => /^Seismic/.test(x.Name));
    const li = doc.BuildingLoadInputs, si = doc.SeismicDataInputs, m0 = li.MezzanineLoads[0];
    const sj0 = RUN.runJob(items, { pcs }).seismic, bk = sj0.buildings[0].bkey, id = sj0.buildings[0].mezz[0].id;
    const lat = doc.LateralCalculations.map(l => l.FramingInputs), concAt = lat.findIndex(l => (l.Mezzanines[0] || {}).ConcentratedLoadTotalInKips > 0);
    const cfg = { ed: '7-16', Ss: si.Ss, S1: si.S1, siteClass: si.SiteClass, risk: 'II', buildings: { [bk]: { RDL: li.RoofDeadLoadInPSF, CDL: li.RoofCollateralLoadInPSF, SW: li.LateralFrameSelfWeightInPSF, RSW: li.RoofSelfWeightInPSF, Pf: li.RoofSnowInPSF } },
      mezz: { [id]: { FDL: m0.FloorDeadInPSF, FLC: m0.FloorCollateralInPSF, FLJ: m0.JoistDeadInPSF, FLL: m0.FloorLiveInPSF, storage: m0.ApplyStorageLoading } },
      concLat: concAt >= 0 ? { [`${bk}|${concAt + 1}|${id}`]: lat[concAt].Mezzanines[0].ConcentratedLoadTotalInKips } : {} };
    const b = RUN.runJob(items, { pcs, seis: cfg }).seismic.buildings[0];
    doc.LateralCalculations.forEach((l, i) => assert.ok(near(b.lines[i].lat.V, l.BaseShearResults.BaseShear, 1e-9), `line ${i + 1}: ${b.lines[i].lat.V} vs ${l.BaseShearResults.BaseShear}`));
    lat.forEach((l, i) => (l.Mezzanines || []).forEach(q => assert.ok(near(b.lines[i].areas[id], q.LoadingAreaInSquareFeet, 1e-6), `line ${i + 1} loading area`)));
    assert.ok(near(b.long.V, doc.LongitudinalCalculations.BaseShearResults.BaseShear, 1e-9));
    seen.push(`k02 seismic = its Design Calcs file on ${lat.length} frame lines and the bracing`);
    // ...and its bracing run holds the engineer's Mezz. Seismic rows: EQB + at the mezzanine's first frame line (4), EQF −
    // at its last (5), at the floor (10 ft), the floor's whole 4.73 k on each sidewall. The tool's plan has the same rows
    // with half on each wall (the floor spans FSW to BSW: 2.36 k each, the walls holding it once); the strut line goes to
    // the BSW's braced bay (3–4) and to the FSW's portal frame (4–5, read from <PortalFrames>)
    const brPath = path.join(dir, 'k02', 'MAIN.bracing');
    if (fs.existsSync(brPath)) {
      const BRF = require('../src/bracingfile.js'), z = require('zlib'), io = { inflate: async u => new Uint8Array(z.inflateRawSync(u)), deflate: async u => new Uint8Array(z.deflateRawSync(u)) };
      const bf = await BRF.read(new Uint8Array(fs.readFileSync(brPath)), io, 'MAIN.bracing');
      const plan = BRF.planFor(bf, b.braceLines.filter(l => l.wall).map(l => ({ wall: l.wall, F: l.F, at: l.at, x0: l.x0, x1: l.x1, mezz: l.mezz.join(' + ') })));
      const key = r => `${r.plane}|${r.line}|${r.caseId}|${(+r.elev).toFixed(2)}`, theirs = new Map(bf.info.loads.filter(r => r.name === BRF.LOAD_NAME).map(r => [key(r), r.F]));
      const ours = plan.loads.map(l => ({ ...l, plane: bf.info.walls[l.wall].plane }));
      assert.strictEqual(ours.length, theirs.size, `${ours.length} rows vs the file's ${theirs.size}`);
      ours.forEach(l => assert.ok(theirs.has(key(l)) && near(l.F, theirs.get(key(l)) / 2, 0.006), `${l.wall} ${l.caseId} line ${l.line + 1}: ${l.F} vs half of ${theirs.get(key(l))}`));
      assert.ok(near(Math.abs(ours.filter(l => l.caseId === 'EQB').reduce((a, l) => a + l.F, 0)), b.mezzLong.total, 0.01), 'the two walls hold the total once');
      assert.deepStrictEqual(plan.struts.map(q => `${q.wall} ${q.from}-${q.to} @${q.elev}`).sort(), ['BSW 2-4 @10', 'FSW 3-4 @10']);
      seen.push('k02 bracing: the engineer\'s EQB / EQF rows, half the floor\'s 4.73 k on each wall');
    }
  }
  // k02 as the engineer designed it in the workbooks (their filled 15th-edition copies): MB1 BU15x30, 25'-0" span, 8'-0"
  // trib, 43 + 5 / 115 / 8 psf, 1 k axial; the column W10X22 at 8'-4" with 5.948 / 11.5 k each side. The tool's engine
  // gives the workbook's numbers. (The tool's own pick is BU13x36: it keeps the beam's total-load sag inside C = 8'-0".)
  {
    const wbDir = path.join(dir, 'workbooks-new');
    if (fs.existsSync(path.join(wbDir, 'Mezzanine_Beam_Design_15th.xls'))) {
      const MZ = require('../src/engine.js'), WF = require('../src/wf-db.js');
      const b = MZ.beamCheck({ dead: 43, coll: 5, live: 115, joistWt: 8, L: 25, Lb: 3.916667, trib: 8, axial: 1, edition: '15', sec: { type: 'BU', d: 15, tw: 0.188, bof: 8, tof: 0.375, bif: 8, tif: 0.375 } }, WF);
      assert.ok(b.desc === 'BU15x30' && b.combinedText === 'COMBINED OK (SR = 0.81)' && b.shearText === 'SHEAR OK (SR = 0.43)', b.combinedText);
      assert.ok(near(b.V.D, 5.9691829625, 1e-9) && near(b.V.L, 11.5, 1e-9) && near(b.M.T, 109.182393515625, 1e-9) && near(b.res.Ix, 366.2399597167969, 1e-4));
      assert.deepStrictEqual([b.defl.rDL, b.defl.rLL, b.defl.rTL].map(Math.round), [759, 394, 259]);
      const c = MZ.columnCheck({ sec: { type: 'WF', name: 'W10X22' }, Fy: 50, Fu: 65, L: 8.33333, Lby: 99.99996, DL_L: 5.948, LL_L: 11.5, DL_R: 5.948, LL_R: 11.5 }, WF);
      [[4.887499809265137, 23.57933235168457, 0.19105537836941727], [-4.887499809265137, 23.57933235168457, 0.19105537836941727], [0, 35.0793342590332, 0.2724502438196258]].forEach(([Mx, P, csr], i) => assert.ok(near(c.combos[i].Mx, Mx, 1e-5) && near(c.combos[i].P, P, 1e-5) && near(c.combos[i].csr, csr, 1e-5), `column combination ${i + 1}`));
      seen.push('k02 the engineer\'s MB1 BU15x30 and W10X22 = their workbooks');
    }
  }
  // the building-only jobs: "22) MEZZANINES - NONE REQUIRED" read as no mezzanine; Box 4's yes / no obstruction answers
  // read as answers; Box 23's crane read field by field
  for (const k of ['k04', 'k05', 'k07', 'k10']) {
    if (!fs.existsSync(job(k))) continue;
    const p = PCS.parse(await readPcs(job(k)));
    assert.strictEqual(p.mezzanines.length, 0, `${k}: no mezzanine`);
    if (k === 'k05') assert.deepStrictEqual(p.extras.map(x => [x.yesNo, x.exists, x.drift, x.none]), [[true, 'Yes', 'No', false]], 'Yes (an obstruction) · No (no drift)');
    if (k === 'k10') {
      const [c] = p.cranes;
      assert.ok(p.cranes.length === 1 && c.type === 'UHSG' && c.tons === 5 && c.cmaa === 'C' && c.startLine === 6 && c.direction === 'REW' && near(c.runway, 53) && c.wheel === 5100 && c.bridge === 2273 && c.hoistTrolley === 690 && near(c.wheelSpacing, 7 + 6.5 / 12) && near(c.beamCC, 15) && c.runwayBeam === 50 && c.notBySeller, JSON.stringify(c));
    } else assert.strictEqual(p.cranes.length, 0, `${k}: no crane`);
    // k04, an unequal gable: Box 2's 121'-6" to the ridge is from the FSW (eaves 28'-9 3/4" / 33'-11 3/8", slopes 1 and
    // 0.987:12) — the two roof planes meet there; from the BSW they would miss by 10 ft (a step at the ridge in every drawing)
    if (k === 'k04') {
      const SITE = require('../src/site.js'), b = p.site.Main.building, yr = SITE.ridgeY(b);
      assert.ok(near(yr, b.ridge, 1e-9) && near(SITE.roofZ(b, 0, yr - 1e-6), SITE.roofZ(b, 0, yr + 1e-6), 0.01), `k04 ridge ${yr} from the FSW, the planes meeting there`);
    }
  }
  seen.push('k04 / k05 / k07 / k10 building only; k04 ridge 121\'-6" from the FSW (the planes meet); k05 Box 4 yes / no; k10 Box 23 crane (5 t UHSG from line 6)');
  // k06: a column of single-value notes, each box taller than its row
  if (fs.existsSync(job('k06'))) {
    const g = await geo('k06');
    assert.deepStrictEqual(['B', 'C', 'D', 'E', 'F', 'joistSpacing'].map(k => +g(k).value.toFixed(4)), [9, 9, 9.5, 0, 21, +(4 + 11 / 12).toFixed(4)]);
    assert.ok(near(g('seat').value, 5 / 12), 'seat 0\'-5", not 21\'-0"');
    seen.push('k06 B–F, 4\'-11", 5"');
  }
  // k08: "2-8⏎⏎2.5"" in 7 pt — the spacing typed with no foot mark, the seat two lines down
  if (fs.existsSync(job('k08'))) {
    const g = await geo('k08');
    assert.ok(near(g('joistSpacing').value, 2 + 8 / 12) && g('joistSpacing').source === 'annotation');
    assert.ok(near(g('seat').value, 2.5 / 12) && g('seat').source === 'annotation');
    seen.push('k08 2\'-8" / 2.5"');
  }
  // k09: "0-0" for E
  if (fs.existsSync(job('k09'))) {
    const g = await geo('k09');
    assert.ok(g('E').value === 0 && g('E').source === 'annotation');
    assert.ok(near(g('D').value, 9 + 1 / 12) && near(g('F').value, 21 + 5 / 12));
    seen.push('k09 E 0\'-0"');
  }
  // k01: the drawing followed (no column the drawing lacks), the 13'-0" × 8'-0" opening boxed on the marked-up plan framed
  // in mezzanine 1 and left out of its seismic loading area, the four column notes read against Box 2 as corrected
  {
    const { inps, job: J } = await loadJob(job('k01'));
    assert.deepStrictEqual(J.columns.map(c => c.label), ['2/D', '2/B', '3/D', '3/B', '68\'-0"/F', '68\'-0"/23\'-8"', '68\'-0"/B', '81\'-0"/23\'-8"', '81\'-0"/C']);
    const m1 = J.mezz[1], op = m1.layout.openings[0];
    assert.ok(near(op.x0, 68) && near(op.x1, 81) && near(op.y0, 23 + 8 / 12, 1e-3) && near(op.y1, 31 + 8 / 12, 1e-3), JSON.stringify(op));   // layout keeps 0.001 ft
    const hdr = m1.layout.beams.find(b => b.opening === 'header'), trm = m1.layout.beams.find(b => b.opening === 'trimmer');
    assert.ok(hdr && near(hdr.line, 81) && near(hdr.trib, 9.5) && trm && near(trm.span, 13) && near(trm.trib, 29, 0.001), 'header on 81\'-0", trib 9\'-6"; trimmer 13\'-0" at the cut beam\'s end');
    // the trimmer's equivalent trib: the line-4 beam's end (16 ft trib × 23'-8" / 2) 7 ft along a 13 ft span → 8M/L²
    const P = 16 * (23 + 8 / 12) / 2, M = P * 7 * 6 / 13;
    assert.ok(near(trm.trib, Math.ceil(8 * M / 169 * 12) / 12, 1e-3), `trimmer trib ${trm.trib} vs 8M/L² ${8 * M / 169}`);
    const sm = J.seismic.buildings[0].mezz.find(m => m.id === '1');
    assert.ok(near(sm.gross, 31 * (31 + 4 / 12), 1e-6) && near(sm.openArea, 104, 0.01) && near(sm.area, sm.gross - sm.openArea) && sm.areaSrc === 'less openings', JSON.stringify({ gross: sm.gross, open: sm.openArea, area: sm.area }));
    const notes = J.mezz.flatMap(r => r.warn.filter(w => /marked-up plan, page 13/.test(w.text)).map(w => w.text));
    assert.strictEqual(notes.length, 4, notes.join('\n'));
    assert.ok(notes.some(t => /"ok to move".*LEW column drawn 42'-6" from the FSW — Box 2, as corrected, has it at 36'-8" \(line B\)/.test(t)));
    assert.ok(notes.some(t => /"this column has to stay".*LEW column on line D, 22'-0" from the FSW — kept there/.test(t)));
    assert.ok(notes.some(t => /"ok to move".*REW column drawn 36'-0" from the FSW — Box 2, as corrected, has it at 31'-8" \(line C\)/.test(t)));
    assert.ok(notes.some(t => /"this column has to stay".*REW column on line E, 15'-0" from the FSW — kept there/.test(t)));
    assert.ok(inps[1].mezz.openingsAt[0].placed && !/@\s*lbs/.test(inps[1].mezz.openingsAt[0].from), 'no blank "@ lbs" in the opening\'s source');
    seen.push('k01 drawing followed, opening framed, 867 sq ft loading area, 4 column notes');
  }
  console.log(`practice tests passed (${seen.join('; ')})`);
})().catch(e => { console.error(e); process.exit(1); });
