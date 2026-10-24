// Two real jobs checked against the engineer's own NBG files (private, gitignored — skipped when absent):
// a main building, an extension in line with it and a lean-to shop against the extension's endwall, no mezzanine.
//  - PCS: every building (Box 2 / 4 continue over a page), Box 12 bracing, a PDF holding two labels read as the first
//  - snow: the fetch runs through the roofs that meet level (193'-8"), the drift as NBG Design Calcs works it to 1e-9,
//    sliding as Design Calcs works it (45.92 psf over 15 ft), the frames take the larger of the two
//  - seismic with no mezzanine: every lateral line and the longitudinal of every building, to 1e-9
//  - frame files: the lean-to's reactions onto the extension's end frame exactly as the engineer typed them; Snow Drift
//    panel rows written in the engineer's format and cleared back to the original byte for byte
const assert = require('assert'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const dir = path.join(__dirname, '..', 'private', 'incoming', '2026-10-23'), dirB = path.join(__dirname, '..', 'private', 'incoming', '2026-10-23b');
const need = ['Project_Confirmation_Summary.pdf', 'NewFile.nbgcalcs', 'Lean_to.frame', 'Frame_Main_Extension_2.frame', 'EXTENSION_F2.frame'];
let ok = need.every(f => fs.existsSync(path.join(dir, f)));
try { require('./pdf-node.js').loadPdfjs(); } catch (e) { ok = false; }
if (!ok) { console.log('real job tests passed (private files not present, skipped)'); process.exit(0); }
const { readPcs } = require('./pdf-node.js');
const PCS = require('../src/pcs.js'), SITE = require('../src/site.js'), SNOW = require('../src/snow.js'), SEIS = require('../src/seismic.js'), RUN = require('../src/run.js'), FF = require('../src/framefile.js');
const io = { ok: true, inflate: u => Promise.resolve(new Uint8Array(zlib.inflateRawSync(u))), deflate: u => Promise.resolve(new Uint8Array(zlib.deflateRawSync(u))) };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
(async () => {
  const pcs = PCS.parse(await readPcs(path.join(dir, 'Project_Confirmation_Summary.pdf')));
  // ---- PCS: three buildings, the second and third on Box 2's continued page; no mezzanine ----
  assert.deepStrictEqual(Object.keys(pcs.site), ['Main', 'Maintenance Shop', 'Main Extension']);
  const g = n => pcs.site[n].building;
  assert.deepStrictEqual([g('Main Extension').width, g('Main Extension').length, g('Maintenance Shop').width, g('Maintenance Shop').length, g('Maintenance Shop').profile], [93, 19, 33, 27, 'Lean-To']);
  assert.ok(near(g('Maintenance Shop').eaveBSW, 14.6875) && near(g('Main Extension').eaveBSW, 44.708333333, 1e-6));
  assert.strictEqual(pcs.mezzanines.length, 0);
  assert.deepStrictEqual(pcs.site.Main.bracing.BSW, { type: 'Portal Frames', kind: 'portal', bays: [6], baysText: '6', clearHeight: 'Per Seller', userBay: true });
  assert.strictEqual(pcs.site['Main Extension'].bracing.REW.kind, 'x');
  // ---- snow: the step from the extension's endwall onto the shop, the fetch through the extension and Main ----
  const facts = { ed: '7-16', pg: 20, Ce: 1, risk: 'II', W2: null };
  let J = SITE.snowJob(pcs, facts, {});
  const d = J.drifts.find(q => q.lower === 'Maintenance Shop');
  assert.deepStrictEqual(d.luUpperParts.map(p => p.name), ['Main Extension', 'Main']);
  assert.ok(near(d.luUpper, 193.6666666667, 1e-9));
  // NBG Design Calcs' roof-step drift (lu typed as 193.6667): hd 4.322378305849012, w 17.28951322339605, pd 71.7514794648795
  const calcs = JSON.parse(fs.readFileSync(path.join(dir, 'NewFile.nbgcalcs'), 'utf8').replace(/^﻿/, ''));
  const docs = calcs.Folders.flatMap(f => f.Documents.map(x => ({ folder: f.Name, ...x })));
  const drift = docs.find(x => /SnowDrift/.test(x.$type) && x.DriftGeometryInputs.UpperRoofWidthInFeet > 100), R = drift.DriftResults;
  const dd = SNOW.stepDrift({ ed: '7-16', pg: 20, psLower: 14, h: drift.DriftGeometryInputs.RoofStepHeightInFeet, luUpper: drift.DriftGeometryInputs.UpperRoofWidthInFeet, luLower: 33, lowerWidth: 33, s: 0 });
  // hd and w to the last digit; what γ multiplies or divides to 1e-7 (Design Calcs keeps γ in single precision: 16.600000381)
  assert.ok(near(dd.hd, R.LeewardDriftHeightInFeet, 1e-12) && near(dd.w, R.LeewardDriftWidthInFeet, 1e-12));
  assert.ok(near(dd.pd, R.LeewardDriftLoadInPSF, 1e-7) && near(dd.hc, R.ClearHeightInFeet, 1e-7) && near(dd.hb, R.UniformSnowDepthInFeet, 1e-7));
  assert.ok(near(d.drift.hd, R.LeewardDriftHeightInFeet, 1e-6) && near(d.drift.pd, R.MaxDriftLoadInPSF, 1e-6));
  // the 19-ft fetch Design Calcs was first run with: windward governs, 21.51 psf
  const short = docs.find(x => /SnowDrift/.test(x.$type) && x.DriftGeometryInputs.UpperRoofWidthInFeet < 20).DriftResults;
  const ds = SNOW.stepDrift({ ed: '7-16', pg: 20, psLower: 14, h: 26.145833333333336, luUpper: 19, luLower: 33, lowerWidth: 33, s: 0 });
  assert.ok(ds.gov === 'windward' && near(ds.hd, short.MaxDriftDepthInFeet, 1e-12) && near(ds.pd, short.MaxDriftLoadInPSF, 1e-7));
  // by the code the extension's roof drains to its FSW, not toward the shop: no sliding; as Design Calcs works it (a
  // slippery upper roof, W 123 ft): 0.4 × 14 × 123 / 15 = 45.92 psf over 15 ft, and the frames take the larger of the two
  assert.ok(!d.sliding.applies);
  J = SITE.snowJob(pcs, facts, { steps: { [d.key]: { sliding: 'calcs', W: 123 } } });
  const d2 = J.drifts.find(q => q.lower === 'Maintenance Shop');
  assert.ok(near(d2.sliding.psf, R.SlidingSnowMagnitudeInPsf) && d2.sliding.extent === R.SlidingSnowLengthInFeet);
  const env = d2.envelope;
  assert.ok(env.length === 3 && near(env[0].va, d2.drift.pd) && near(env[1].va, 45.92) && near(env[1].vb, 45.92) && env[2].vb === 0);
  assert.ok(near(env[0].b, d2.drift.w * (1 - 45.92 / d2.drift.pd)), 'the drift and the sliding snow cross');
  // Design Calcs' Total Snow = uniform + the larger of drift and sliding, never both (support 6: 42.04 + max(49.51, 132.16))
  const sup = drift.ContinuousBeamResults.SupportResults.find(x => x.ID === 6).ShearReactionInPlfPerCombo;
  assert.ok(near(sup['Total Snow'], sup['Uniform Snow'] + Math.max(sup['Drift Snow'], sup['Sliding Snow'])));
  // each of the shop's two frame lines (13'-6" each) takes one Snow Drift load, cut off at the drift's toe
  d.frames.forEach(fl => { assert.strictEqual(fl.segs.length, 1); assert.ok(near(-fl.segs[0].end, d.drift.pd * 13.5 / 1000, 1e-9) && near(fl.segs[0].from, 33 - d.drift.w, 1e-9) && fl.segs[0].to === 33); });
  // ---- seismic, no mezzanine: NBG Design Calcs for each building (the engineer's roof dead: NBG Frame's 2.7291, the shop's 2.8178) ----
  const sj = RUN.seismicJob([], [], [], {}, pcs);
  assert.ok(sj.ok && sj.buildings.length === 3 && sj.buildings.every(b => b.noMezz && b.roof.RDL.source === 'default'));
  assert.deepStrictEqual(sj.buildings.map(b => [b.name, b.sfrs.FSW, b.sfrs.BSW]), [['Main', 'X-Bracing', 'Portal Frame'], ['Maintenance Shop', 'Portal Frame', 'X-Bracing'], ['Main Extension', 'X-Bracing', 'X-Bracing']], 'the sidewalls\' systems from Box 12');
  const bk = n => sj.buildings.find(b => b.name === n).bkey;
  const typed = RUN.seismicJob([], [], [], { buildings: { [bk('Main')]: { RDL: 2.7291 }, [bk('Maintenance Shop')]: { RDL: 2.8178 }, [bk('Main Extension')]: { RDL: 2.7291 } } }, pcs);
  let n = 0;
  docs.filter(x => /SeismicCalcDocument/.test(x.$type)).forEach(doc => {
    const b = typed.buildings.find(q => q.name === doc.folder);
    doc.LateralCalculations.forEach(lc => {
      const at = { LeftEndwall: 'lew', RightEndwall: 'rew', Interior: 'interior' }[lc.FramingInputs.BayType];
      const line = b.lines.find(l => l.at === at && near(l.bay, lc.FramingInputs.BayWidthInFeet, 1e-6));
      const V = lc.BaseShearResults.ValuesForNBGFrame;
      assert.ok(line && near(line.lat.frame.roofPsf, V.RoofWeightInPsf) && near(line.lat.frame.altRoofPsf, V.AltRoofWeightInPsf) && near(line.lat.Cs, lc.SeismicFactorResults.Cs) && near(line.lat.V, lc.BaseShearResults.BaseShear), `${doc.folder} ${at}`);
      n++;
    });
    const L = doc.LongitudinalCalculations.BaseShearResults;
    assert.ok(near(b.long.V, L.BaseShear) && near(b.long.bracing.totalPsf, L.ValuesForNBGBracing.RoofTotalSeismicWeightInPsf) && near(b.long.bracing.altTotalPsf, L.ValuesForNBGBracing.AltRoofTotalSeismicWeightInPsf), doc.folder + ' longitudinal');
    n++;
  });
  // ---- frame files: the lean-to's COL02 onto the extension's end frame, as typed by the engineer ----
  const rd = f => FF.read(new Uint8Array(fs.readFileSync(path.join(dir, f))), io, f);
  const lean = await rd('Lean_to.frame'), host = await rd('Frame_Main_Extension_2.frame'), eng = await rd('EXTENSION_F2.frame');
  const r2 = lean.info.reactions.filter(r => r.col === 'COL02'), hostCases = new Set(host.info.cases);
  assert.ok(r2.every(r => r.Htop != null) && near(r2.find(r => r.caseName === 'RDL').Htop, -0.067377373576164246));
  const rows = ['COL04', 'COL05'].flatMap(member => r2.filter(r => hostCases.has(r.caseName)).map(r => ({ name: 'Lean to - COL02 - Reaction', caseId: r.caseName, member, x: -r.Htop, y: -r.V, location: 14.6875, toFlange: '3', leanTo: true })));
  const mine = FF.cloadsOf(FF.addLoads(host.xml, rows, { floors: false, toFlange: '3' }).xml).map(c => c.fields);
  assert.strictEqual(mine.length, eng.info.cloads.length);
  eng.info.cloads.forEach(t => { const m = mine.find(q => q.memberID === t.memberID && q.loadCaseID === t.loadCaseID); assert.ok(m && near(+m.xMag, +t.xMag, 5e-5) && near(+m.yMag, +t.yMag, 5e-5) && m.location === t.location && m.toFlange === t.toFlange && m.name === t.name, `${t.memberID} ${t.loadCaseID}`); });
  assert.deepStrictEqual([...new Set(r2.map(r => r.caseName))].filter(c => !hostCases.has(c)), ['W6B', 'W6F'], 'cases the host frame does not have are left out');
  // ---- Snow Drift panel rows: the engineer's one row replaced, the format kept; cleared, the file is the original ----
  assert.deepStrictEqual(lean.info.ploads.map(p => [p.name, p.loadCaseID, p.dir, p.panelID]), [['Snow Drift ', 'SL', 'GY', 'RP1']]);
  const pl = FF.addPanelLoads(lean.xml, [{ name: 'Snow Drift', caseId: 'SL', panel: 'RP1', from: 15.710487, to: 33, start: -1.24, end: -1.938 }]);
  assert.ok(pl.replaced === 1 && pl.added === 1);
  const back = await FF.read(await FF.write(lean, pl.xml, io), io, 'x.frame');
  // the direction: PY (snow on the horizontal projection, as the engineer confirmed); GY when a row asks for it
  assert.deepStrictEqual(back.info.ploads.map(p => [p.name, p.loadCaseID, p.dir, +p.startLoc, +p.endMag]), [['Snow Drift', 'SL', 'PY', 15.7105, -1.938]]);
  assert.strictEqual(FF.ploadsOf(FF.addPanelLoads(lean.xml, [{ name: 'Snow Drift', caseId: 'SL', panel: 'RP1', from: 15, to: 33, start: -1, end: -2, dir: 'GY' }]).xml)[0].fields.dir, 'GY');
  assert.strictEqual(FF.addPanelLoads(FF.addPanelLoads(host.xml, [{ name: 'Snow Drift', caseId: 'SL', panel: 'RP1', from: 0, to: 9, start: -1, end: 0 }]).xml, []).xml, host.xml);
  // ---- the reviewed version: a PDF holding the current label and an earlier one; NBG's own drift row ----
  let msgB = '';
  if (fs.existsSync(path.join(dirB, 'Project_Confirmation_Summary.pdf'))) {
    const pB = PCS.parse(await readPcs(path.join(dirB, 'Project_Confirmation_Summary.pdf')));
    assert.deepStrictEqual(Object.keys(pB.site), ['Main', 'Maintenance Shop', 'Main Extension', 'Scale House']);
    assert.ok(pB.otherDoc && pB.otherDoc.page > 20 && /LABEL|Created/i.test(pB.otherDoc.label || 'LABEL'));
    assert.deepStrictEqual(pB.attachments.filter(a => a.building === 'Maintenance Shop').map(a => a.at), [64], 'the current label only');
    assert.ok(pB.site['Scale House'].roof && pB.site['Scale House'].roof.Ct === 1.1, 'Box 4 continued on the next page');
    const JB = SITE.snowJob(pB, facts, {}), dB = JB.drifts.find(q => q.lower === 'Maintenance Shop');
    assert.ok(near(dB.luUpper, 190, 1e-9) && dB.frames.every(fl => near(fl.tribAt, 14, 1e-9)));
    const shop = await FF.read(new Uint8Array(fs.readFileSync(path.join(dirB, 'Frame_Maintenance_Shop_12.frame'))), io, 'Frame_Maintenance_Shop_12.frame');
    const nbg = shop.info.ploads.find(p => /drift/i.test(p.name)), psf = -(+nbg.startMag) * 1000 / shop.info.bayWidth;
    // NBG Frame's own lean-to drift takes the extension's 22'-6" alone: hd = 1.341 ft, 22.3 psf; through the roofs in line, 71.1 psf
    assert.ok(near(psf, SNOW.stepDrift({ ed: '7-16', pg: 20, psLower: 15.4, h: 16, luUpper: 22.5, luLower: 28, lowerWidth: 28, s: 0 }).pd, 2e-3));
    const repl = FF.addPanelLoads(shop.xml, [{ name: 'Snow Drift', caseId: 'SL', panel: 'RP1', from: 10.86, to: 28, start: 0, end: -0.996 }]);
    assert.ok(repl.replaced === 1 && /BackSidewall Drift/.test(repl.replacedRows[0].name), 'NBG\'s own drift row goes; left in, it would add to the new one');
    // the bracing runs: <FrontSidewall> holds line A (the BSW), told by its eave strut; read that way the rods are where
    // PCS Box 12 puts the X-bracing (Main FSW bays 2, 4; the shop's FSW bay 1) and the Main BSW's portal frames have none
    const BRF = require('../src/bracingfile.js'), rodBays = (f, w) => f.info.walls[w].bays.filter(b => b.braces.length).map(b => b.from + 1), pfBays = (f, w) => f.info.walls[w].bays.filter(b => b.portal).map(b => b.from + 1);
    const mainB = await BRF.read(new Uint8Array(fs.readFileSync(path.join(dirB, 'Main.bracing'))), io, 'Main.bracing');
    const shopB = await BRF.read(new Uint8Array(fs.readFileSync(path.join(dirB, 'Maintenance_Shop.bracing'))), io, 'Maintenance_Shop.bracing');
    assert.deepStrictEqual([mainB.info.walls.FSW.tag, mainB.info.walls.FSW.how, mainB.info.walls.FSW.top, mainB.info.walls.BSW.top], ['BackSidewall', 'eave strut', 32, 37]);
    assert.deepStrictEqual([rodBays(mainB, 'FSW'), rodBays(mainB, 'BSW'), rodBays(shopB, 'FSW'), rodBays(shopB, 'BSW')], [pB.site.Main.bracing.FSW.bays, [], pB.site['Maintenance Shop'].bracing.FSW.bays, []]);
    assert.deepStrictEqual(pB.site.Main.bracing.BSW.kind, 'portal');
    // the portal frames are in the run as <PortalFrames> (by wall plane and bay): on the BSW, in the bays Box 12 names
    assert.deepStrictEqual([pfBays(mainB, 'BSW'), pfBays(mainB, 'FSW')], [pB.site.Main.bracing.BSW.bays, []]);
    assert.ok(mainB.info.portals.every(q => /^PF[\d.]+W\d+H\d+K$/.test(q.id) && q.H1.length === mainB.info.combos.length) && mainB.info.status.designed, 'each portal\'s reactions a combination');
    msgB = `; the reviewed version: 4 buildings, the earlier label from page ${pB.otherDoc.page} left unread, lean-to at 64'-0", NBG Frame's own drift ${psf.toFixed(1)} psf (fetch 22'-6") replaced by ${dB.drift.pd.toFixed(1)} psf (fetch 190'-0"); the bracing runs' rods on the walls PCS Box 12 names`;
  }
  console.log(`real job tests passed (3 buildings read over Box 2's continued page; drift = NBG Design Calcs (hd, w to the last digit) with the 193'-8" fetch through the roofs in line; sliding 45.92 psf as Design Calcs works it, the frames taking the larger; ${n} seismic results with no mezzanine to 1e-9; the lean-to's 24 reaction rows as the engineer typed them; Snow Drift rows in the engineer's format${msgB})`);
})().catch(e => { console.error(e); process.exit(1); });
