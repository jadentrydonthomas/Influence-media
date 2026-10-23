// NBG Design Calcs' validation examples against src/seismic.js, value by value: every input of an example is typed
// into the engine as the application takes it, and every number the application prints (seismic factors, each row of
// the multistory distribution, the NBG Frame / NBG Bracing loads, the base shear) is compared at the precision it is
// printed to. The fixtures come from the validation prints (oracle/nbg_parse.py) and stay private:
//   node oracle/nbg_seismic.js [fixtures dir] [--verbose]
const fs = require('fs');
const path = require('path');
const S = require('../src/seismic.js');

const dir = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'private', 'nbg-calcs', 'validation', 'fixtures');
const verbose = process.argv.includes('--verbose');

const ED = { ASCE705: '7-05', ASCE710: '7-10', ASCE716: '7-16', ASCE722: '7-22' };
function toProject(fx) {
  const b = fx.building, s = fx.seismic, ed = ED[fx.code] || '7-16';
  const old = ed !== '7-22' && /^1\.1\.6[0-5]/.test(fx.version || '');   // before the torsion check boxes: on with a rigid diaphragm
  const walls = {};
  Object.entries(fx.walls).forEach(([k, w]) => { walls[k] = { kind: w.partial ? 'partial' : 'full', shear: !!w.shear, parapet: !!w.parapet, top: w.top, weight: w.weight, upperWeight: w.upperWeight, masonryTop: w.masonryTop, lowerWeight: w.lowerWeight }; });
  return {
    building: { ed, type: b.type, width: b.width, length: b.length, dtr: b.dtr, slope: b.slopeBSW, eaveFSW: b.eaveFSW, eaveBSW: b.eaveBSW },
    seismic: { ed, risk: (s.occupancy.match(/^(IV|III|II|I)\b/) || [])[1] || 'II', Ss: s.Ss, S1: s.S1, SMS: s.Sms, SM1: s.Sm1, siteClass: s.siteClass,
      roofDiaphragm: s.roofDiaphragm, mezzDiaphragm: s.mezzDiaphragm, ndfs: s.ndfs !== false, significant: !!s.significant, irregular: !!s.irregular,
      torsionLong: old ? true : s.torsionLong !== false, torsionLat: !!s.torsionLat },
    roof: { ...fx.roof }, walls,
    mezz: fx.mezz.map(m => ({ id: m.id, elev: m.elev, FDL: m.FDL || 0, FLC: m.FLC || 0, FLJ: m.FLJ || 0, FLL: m.FLL || 0, storage: !!m.storage, partition: !!m.partition, FLP: m.FLP || 0 })),
    cranes: fx.cranes.map(c => ({ ...c })),
    sfrs: { FSW: fx.sfrs.FSW, BSW: fx.sfrs.BSW, lines: fx.sfrs.lines.map(l => l.sfrs) },
  };
}
// what the application was told for this calculation beyond the project: overrides of Ta, k and ρ
function overrides(L, J) {
  const o = {}, f = L.factors;
  if (f.Ct === 0) o.Ta = f.Ta;
  return o;
}

const DEC = { W: 0, h: 2, num: 0, Fx: 2, Mx: 2 };
let checked = 0, exact = 0, near = 0;
const bad = [];
function cmp(where, label, ours, shown, dec) {
  if (shown == null || ours == null || (typeof shown === 'string')) {
    if (typeof shown === 'string' && String(ours) !== shown) bad.push(`${where} ${label}: ours ${ours} — NBG ${shown}`);
    checked++; if (String(ours) === String(shown)) exact++;
    return;
  }
  checked++;
  const r = +ours.toFixed(dec), u = Math.pow(10, -dec);
  // exact when the printed figure is a rounding of ours (NBG prints x.5 to the even figure: 124,312.5 lb → 124,312)
  if (Math.abs(r - shown) < u / 2 || Math.abs(ours - shown) <= u / 2 + 1e-9) { exact++; return; }
  if (Math.abs(r - shown) <= u * 1.01) { near++; if (verbose) console.log(`  ~ ${where} ${label}: ours ${ours.toFixed(dec + 3)} — NBG ${shown}`); return; }
  bad.push(`${where} ${label}: ours ${ours.toFixed(dec + 3)} — NBG ${shown}`);
}
const decOf = v => { const s = String(v); return s.includes('.') ? s.split('.')[1].length : 0; };

if (!fs.existsSync(dir)) { console.log(`no fixtures at ${dir} — skipped`); process.exit(0); }
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
for (const file of files) {
  const fx = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const P = toProject(fx), J = S.project(P), name = file.replace(/\.json$/, '').replace('_Validation', ' (7-16)').replace(/^Example_(\d+)$/, 'Example $1 (7-22)');
  // the print shows a loading area to the whole sq ft (812 for 812.5): the area is the row's weight over the floor's psf
  const areas = L => L.mezz.map(a => {
    const m = P.mezz.find(q => q.id === a.id), row = L.rows.find(r => r.name === `Mezzanine ${a.id} Loads`);
    if (!m || !row) return a;
    const exact = (row.W - a.conc * 1000) / S.mezzPsf(m);
    return Math.abs(exact - a.area) <= 0.5 + 1e-6 ? { ...a, area: Math.round(exact * 4) / 4 } : a;
  });
  const calcs = fx.lateral.map(L => ({ L, R: S.frameLine(J, { desc: L.desc, framing: L.framing, bay: L.bay, bayType: L.bayType, roofConc: L.roofConc, fswTrib: L.fswTrib, bswTrib: L.bswTrib, partLen: L.partLen, mezz: areas(L), cranes: L.cranes, over: overrides(L, J) }) }));
  const lg = fx.longitudinal;
  calcs.push({ L: lg, R: S.bracing(J, { roofConc: lg.roofConc, fswTrib: lg.fswTrib, bswTrib: lg.bswTrib, partTrib: lg.partTrib, partQty: lg.partQty, mezz: areas(lg), cranes: lg.cranes, over: overrides(lg, J) }) });
  const before = bad.length;
  for (const { L, R } of calcs) {
    const w = `${name} ${L.kind === 'lateral' ? L.desc : 'Longitudinal'}:`, f = R.factors, e = L.factors;
    cmp(w, 'SFRS', R.sys.label, L.sfrsName);
    if (e.Fa != null) { cmp(w, 'Fa', f.Fa, e.Fa, 2); cmp(w, 'Fv', f.Fv, e.Fv, 2); }
    ['Sms', 'Sm1', 'Sds', 'Sd1'].forEach(k => cmp(w, k, f[k], e[k], 3));
    cmp(w, 'SDC', f.SDC, e.SDC);
    cmp(w, 'R', f.R, e.R, decOf(e.R)); cmp(w, 'Ω0', f.Om, e.Om, decOf(e.Om)); cmp(w, 'Cd', f.Cd, e.Cd, decOf(e.Cd));
    cmp(w, 'Ct', f.Ct, e.Ct, 2); cmp(w, 'Ta', f.Ta, e.Ta, 3); cmp(w, 'ρ', f.rho, e.rho, 3); cmp(w, 'k', f.k, e.k, 3);
    cmp(w, 'Cs', R.Cs, L.Cs, 3);
    if (L.kind === 'lateral') {
      const u = R.frame;
      cmp(w, 'roof weight (psf)', u.roofPsf, L.uniform.roof, 2); cmp(w, 'alt. roof weight (psf)', u.altRoofPsf, L.uniform.altRoof, 2);
      cmp(w, 'panel load (klf)', u.panel, L.uniform.panel, 2); cmp(w, 'alt. panel load (klf)', u.altPanel, L.uniform.altPanel, 2);
      cmp(w, 'seismic factor', u.factor, L.uniform.factor, 3);
    } else {
      const u = R.bracing;
      cmp(w, 'roof snow (psf)', u.snow, L.uniform.snow, 2); cmp(w, 'roof dead (psf)', u.deadPsf, L.uniform.dead, 2);
      cmp(w, 'roof total (psf)', u.totalPsf, L.uniform.total, 2); cmp(w, 'alt. roof total (psf)', u.altTotalPsf, L.uniform.altTotal, 2);
      cmp(w, 'seismic factor', u.factor, L.uniform.factor, 3);
    }
    // the distribution, row by row (the print truncates "Partition Wall Loads - Upper" at the page edge)
    const norm = n => n.replace(/^P?artition Wall Loads - (Upp|Low)e?r?$/, 'Partition Wall Loads - $1').replace(/^(.*) - (Upp|Low)(er)?$/, '$1 - $2');
    const ours = new Map(R.rows.map(r => [norm(r.name), r]));
    L.rows.forEach(er => {
      const r = ours.get(norm(er.name));
      if (!r) { bad.push(`${w} row ${er.name}: missing (ours: ${[...ours.keys()].join(', ')})`); return; }
      ours.delete(norm(er.name));
      ['W', 'h', 'num', 'Fx', 'Mx'].forEach(k => { if (er[k] != null && !(er.W === 0 && k !== 'W')) cmp(w, `${er.name} ${k}`, k === 'num' ? r.num : r[k], er[k], DEC[k]); });
    });
    [...ours.values()].filter(r => r.W > 0.5).forEach(r => bad.push(`${w} row ${r.name}: extra (W ${Math.round(r.W)})`));
    cmp(w, 'total W', R.totals.W, L.totals.W, 0); cmp(w, 'total Fx', R.totals.Fx, L.totals.Fx, 2); cmp(w, 'total Mx', R.totals.Mx, L.totals.Mx, 2);
    // the concentrated loads for NBG Frame / NBG Bracing, in print order
    const oc = (L.kind === 'lateral' ? R.frame : R.bracing).conc;
    const order = c => (c.key === 'FSW' ? 0 : c.key === 'BSW' ? 1 : c.key === 'crane' ? 2 : 3);
    const ocs = oc.slice().sort((a, b) => order(a) - order(b));
    if (ocs.length !== L.conc.length) bad.push(`${w} concentrated loads: ours ${ocs.length} (${ocs.map(c => c.name).join(', ')}) — NBG ${L.conc.length}`);
    L.conc.forEach((c, i) => { if (ocs[i]) { cmp(w, `conc ${ocs[i].name} F`, ocs[i].F, c.F, 2); cmp(w, `conc ${ocs[i].name} at`, ocs[i].at, c.at, 2); } });
    cmp(w, 'base shear', L.kind === 'lateral' ? R.frame.V : R.bracing.V, L.baseShear, 2);
  }
  console.log(`${name.padEnd(22)} ${calcs.length} calculations · ${bad.length - before ? (bad.length - before) + ' differ' : 'all tie'}`);
}
console.log(`\n${checked} values: ${exact} exact, ${near} within 1 in the last printed digit, ${bad.length} differ`);
bad.slice(0, verbose ? 1e9 : 60).forEach(t => console.log('  ✗ ' + t));
if (bad.length > 60 && !verbose) console.log(`  … ${bad.length - 60} more (--verbose)`);
process.exitCode = bad.length ? 1 : 0;

// ---------- NBG Design Calcs files (.nbgcalcs): every Seismic document, at full precision ----------
const calcDirs = [path.join(__dirname, '..', 'private', 'nbg-calcs')];
const SFRS_ENUM = t => {
  const s = String(t || '');
  const base = /Portal/i.test(s) ? 'Portal Frame' : /Rigid/i.test(s) ? 'Rigid Frame' : /XBrace|X_?Brac/i.test(s) ? 'X-Bracing' : /Post/i.test(s) ? 'Post & Beam' : /Fixed|Cantilever/i.test(s) ? 'Fixed Base' : /BRBF|Buckling/i.test(s) ? 'BRBF' : /EBF|Eccentric/i.test(s) ? 'EBF' : 'X-Bracing';
  return /_IMF/i.test(s) ? `${base} (IMF)` : /_SMF/i.test(s) ? `${base} (SMF)` : /_SCBF/i.test(s) ? `${base} (SCBF)` : base;
};
const RISK = { LowHazard: 'I', StandardHazard: 'II', SubstantialHazard: 'III', EssentialFacilities: 'IV', EssentialFacility: 'IV' };
const ED2 = { ASCE705: '7-05', ASCE710: '7-10', ASCE716: '7-16', ASCE722: '7-22' };
const BAY = { LeftEndwall: 'Left Endwall', RightEndwall: 'Right Endwall', Interior: 'Interior', InteriorWithPartition: 'Interior w/ Partition' };
const wallOf = w => (!w ? null : { kind: w.TopOfMasonryElevationInFeet != null || w.IsPartialHeight ? 'partial' : 'full', shear: !!w.SelfSupportingShearWall, parapet: !!w.HasParapet, top: w.TopElevationInFeet,
  weight: w.WallWeightInPSF, upperWeight: w.UpperWallWeightInPSF, masonryTop: w.TopOfMasonryElevationInFeet, lowerWeight: w.LowerWallWeightInPSF });
let full = 0; const fullBad = [];
function near9(where, label, ours, theirs) {
  full++;
  if (theirs == null || ours == null) return;
  if (Math.abs(ours - theirs) > 1e-9 * Math.max(1, Math.abs(theirs))) fullBad.push(`${where} ${label}: ours ${ours} — NBG ${theirs}`);
}
for (const cd of calcDirs) {
  if (!fs.existsSync(cd)) continue;
  for (const fn of fs.readdirSync(cd).filter(f => f.endsWith('.nbgcalcs'))) {
    const doc = JSON.parse(fs.readFileSync(path.join(cd, fn), 'utf8').replace(/^﻿/, ''));
    (doc.Folders || []).forEach(fo => (fo.Documents || []).filter(d => /SeismicCalcDocument/.test(d.$type || '')).forEach(sd => {
      const gi = sd.BuildingGeometryInputs, si = sd.SeismicDataInputs, li = sd.BuildingLoadInputs, ed = ED2[sd.DesignCodeInputs.SelectedBuildingCode] || '7-16';
      const P = {
        building: { ed, type: /Single/i.test(sd.BuildingTypeInputs.BuildingType) ? 'Single Slope' : 'Gable', width: gi.BuildingWidthInFeet, length: gi.BuildingLengthInFeet, dtr: gi.BSWRidgeDistanceInFeet, slope: gi.BSWRoofSlopeOn12, eaveFSW: gi.FSWEaveHeightInFeet, eaveBSW: gi.BSWEaveHeightInFeet },
        seismic: { ed, risk: RISK[si.OccupancyCategory] || 'II', Ss: si.Ss, S1: si.S1, SMS: ed === '7-22' ? si.Sms : undefined, SM1: ed === '7-22' ? si.Sm1 : undefined, siteClass: si.SiteClass,
          roofDiaphragm: si.RoofDiaphragm, mezzDiaphragm: si.MezzanineDiaphragm, ndfs: si.UseNotDetailedForSeismicSFRSIfPossible !== false, significant: !!si.IsMultiStory,
          irregular: !!si.SeismicIrregularitiesExist, torsionLong: si.UseAccidentalTorsionInLongDirection !== false, torsionLat: !!si.UseAccidentalTorsionInLateralDirection },
        roof: { SW: li.LateralFrameSelfWeightInPSF, RDL: li.RoofDeadLoadInPSF, CDL: li.RoofCollateralLoadInPSF, RSW: li.RoofSelfWeightInPSF, Pf: li.RoofSnowInPSF },
        walls: { LEW: wallOf(li.LEWLoads), REW: wallOf(li.REWLoads), FSW: wallOf(li.FSWLoads), BSW: wallOf(li.BSWLoads), Partition: wallOf(li.PartitionLoads) },
        mezz: (li.MezzanineLoads || []).map(m => ({ id: m.ID, elev: m.ElevationInFeet, FDL: m.FloorDeadInPSF, FLC: m.FloorCollateralInPSF, FLJ: m.JoistDeadInPSF, storage: !!m.ApplyStorageLoading, FLL: m.FloorLiveInPSF, partition: !!m.ApplyPartitionLoading, FLP: m.PartitionDeadInPSF })),
        cranes: [], sfrs: { FSW: SFRS_ENUM(sd.LongitudinalCalculations.FramingInputs.FSW_SFRS), BSW: SFRS_ENUM(sd.LongitudinalCalculations.FramingInputs.BSW_SFRS), lines: sd.LateralCalculations.map(l => SFRS_ENUM(l.FramingInputs.SFRS)) },
      };
      const J = S.project(P);
      const over = fi => ({ Ta: fi.OverrideFundamentalPeriod ? fi.FundamentalPeriod : undefined, k: fi.OverrideVerticalDistributionFactor ? fi.VerticalDistributionFactor : undefined, rho: fi.OverrideRedundancyFactor ? fi.RedundancyFactor : undefined });
      const mz = list => (list || []).map(m => ({ id: m.UniformLoadInputId, area: m.LoadingAreaInSquareFeet, conc: m.ConcentratedLoadTotalInKips || 0 }));
      const check = (w, R, res, nbg) => {
        const fr = res.SeismicFactorResults;
        near9(w, 'Fa', R.factors.Fa, fr.Fa); near9(w, 'Fv', R.factors.Fv, fr.Fv); near9(w, 'Sms', R.factors.Sms, fr.Sms); near9(w, 'Sm1', R.factors.Sm1, fr.Sm1);
        near9(w, 'Sds', R.factors.Sds, fr.Sds); near9(w, 'Sd1', R.factors.Sd1, fr.Sd1); near9(w, 'R', R.factors.R, fr.R); near9(w, 'Ω0', R.factors.Om, fr.Omega0); near9(w, 'Cd', R.factors.Cd, fr.Cd);
        near9(w, 'Ct', R.factors.Ct, fr.Ct); near9(w, 'Ta', R.factors.Ta, fr.Ta); near9(w, 'k', R.factors.k, fr.DistributionExponentK); near9(w, 'Cs', R.Cs, fr.Cs);
        if (`Category${R.factors.SDC}` !== fr.SeismicDesignCategory) fullBad.push(`${w} SDC: ours ${R.factors.SDC} — NBG ${fr.SeismicDesignCategory}`);
        const bs = res.BaseShearResults, KEY = { Roof: 'roof', LEW: 'LEW', REW: 'REW', FSW: 'FSW', BSW: 'BSW', Mezzanine: 'mezz', Crane: 'crane', Partition: 'Partition' };
        bs.SeismicMassResults.forEach(m => {
          const r = R.rows.find(x => x.key === KEY[m.SeismicMassType] && (m.SeismicMassType !== 'Mezzanine' || new RegExp(`Mezzanine ${x.id} `).test(m.Description)));
          if (!r) { fullBad.push(`${w} ${m.Description}: missing`); return; }
          near9(w, `${m.Description} W`, r.W, m.WeightInLbs); near9(w, `${m.Description} h`, r.h, m.ElevationInFeet); near9(w, `${m.Description} num`, r.num, m.VerticalDistributionNumerator);
          near9(w, `${m.Description} Fx`, r.Fx, m.ForceInKips); near9(w, `${m.Description} Mx`, r.Mx, m.BaseMomentInKipFt);
        });
        near9(w, 'base shear', R.V, bs.BaseShear);
        const v = nbg(bs);
        return v;
      };
      sd.LateralCalculations.forEach((lc, i) => {
        const fi = lc.FramingInputs, w = `${fn} lateral ${i + 1} (${fi.Description}, ${fi.BayType}):`;
        const R = S.frameLine(J, { desc: fi.Description, framing: SFRS_ENUM(fi.SFRS), bay: fi.BayWidthInFeet, bayType: BAY[fi.BayType] || fi.BayType, roofConc: fi.RoofConcentratedLoadsInKips, fswTrib: fi.FSWTribLengthInFeet, bswTrib: fi.BSWTribLengthInFeet, partLen: fi.PartitionWallLength, mezz: mz(fi.Mezzanines), cranes: [], over: over(lc.SeismicFactorInputs) });
        check(w, R, lc, bs => {
          const v = bs.ValuesForNBGFrame;
          near9(w, 'equivalent roof force', R.frame.equivRoof, v.EquivalentRoofForceInKips); near9(w, 'roof weight', R.frame.roofPsf, v.RoofWeightInPsf); near9(w, 'alt roof weight', R.frame.altRoofPsf, v.AltRoofWeightInPsf);
          near9(w, 'panel load', R.frame.panel, v.PanelLoadInKlf); near9(w, 'alt panel load', R.frame.altPanel, v.AltPanelLoadInKlf); near9(w, 'seismic factor', R.frame.factor, v.SeismicFactor);
          v.ConcentratedSeismicLoads.forEach(c => { const o = R.frame.conc.find(x => x.key === c.SeismicMassType || (c.SeismicMassType === 'Mezzanine' && x.key === 'mezz')); if (!o) fullBad.push(`${w} conc ${c.Description}: missing`); else { near9(w, `conc ${c.Description}`, o.F, c.MagnitudeInKips); near9(w, `conc ${c.Description} at`, o.at, c.ElevationInFeet); } });
        });
      });
      const lc = sd.LongitudinalCalculations, fi = lc.FramingInputs, w = `${fn} longitudinal:`;
      const R = S.bracing(J, { roofConc: fi.RoofConcentratedLoadsInKips, fswTrib: fi.FSWTribLengthInFeet, bswTrib: fi.BSWTribLengthInFeet, partTrib: fi.PartitionWallLength, partQty: fi.NumberOfPartitionWalls, mezz: mz(fi.Mezzanines), cranes: [], over: over(lc.SeismicFactorInputs) });
      check(w, R, lc, bs => {
        const v = bs.ValuesForNBGBracing;
        near9(w, 'equivalent roof force', R.bracing.equivRoof, v.EquivalentRoofForceInKips); near9(w, 'roof snow', R.bracing.snow, v.RoofSnowInPsf); near9(w, 'roof dead only', R.bracing.deadPsf, v.RoofDeadOnlyInPsf);
        near9(w, 'roof total', R.bracing.totalPsf, v.RoofTotalSeismicWeightInPsf); near9(w, 'alt roof total', R.bracing.altTotalPsf, v.AltRoofTotalSeismicWeightInPsf); near9(w, 'seismic factor', R.bracing.factor, v.SeismicFactor);
        v.ConcentratedSeismicLoads.forEach(c => { const o = R.bracing.conc.find(x => x.key === c.SeismicMassType || (c.SeismicMassType === 'Mezzanine' && x.key === 'mezz')); if (!o) fullBad.push(`${w} conc ${c.Description}: missing`); else { near9(w, `conc ${c.Description}`, o.F, c.MagnitudeInKips); near9(w, `conc ${c.Description} at`, o.at, c.ElevationInFeet); } });
      });
      console.log(`${fn}: ${sd.LateralCalculations.length} frame lines + longitudinal, ${full} values to 1e-9 · ${fullBad.length ? fullBad.length + ' differ' : 'all tie'}`);
    }));
  }
}
fullBad.slice(0, 40).forEach(t => console.log('  ✗ ' + t));
if (fullBad.length) process.exitCode = 1;
