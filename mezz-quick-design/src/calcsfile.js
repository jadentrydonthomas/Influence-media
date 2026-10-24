/* NBG Design Calcs files (.nbgcalcs): the job's calc documents, a folder a building — unbalanced snow, wind, seismic and
   each roof step's drift. Read: every document listed with the few numbers that say what it holds, and the seismic
   inputs taken as a source for the Seismic calc (code, site, Ss / S1, roof and wall loads, each line's system). Write:
   the mezzanine loads put back in the seismic documents the way Design Calcs keeps them — the floor's uniform loads, and
   on each frame line and the longitudinal its Mezzanine ID, Loading Area and Concentrated Loads — with the base shear
   results worked again by src/seismic.js (tied to NBG Design Calcs to 1e-9), so the file opens as Design Calcs would
   have left it. Everything else in the file is left as it was; the file keeps its BOM and line endings. */
(function (root) {
  'use strict';

  const KIND = d => {
    const t = String((d && d.$type) || ''), n = String((d && d.Name) || '');
    return /SeismicCalc/i.test(t) || /^Seismic/i.test(n) ? 'seismic' : /UnbalancedSnow/i.test(t) || /^Unbalanced Snow/i.test(n) ? 'snow'
      : /Drift/i.test(t) || /Snow Drift/i.test(n) ? 'drift' : /Wind/i.test(t) || /^Wind/i.test(n) ? 'wind' : 'other';
  };
  // the building a folder holds: the folder's name, its seismic / snow document's width and length
  const geomOf = docs => { const g = (docs.find(d => d.BuildingGeometryInputs) || {}).BuildingGeometryInputs || {}; return { width: g.BuildingWidthInFeet, length: g.BuildingLengthInFeet }; };

  function read(text) {
    const s = String(text), bom = s.charCodeAt(0) === 0xFEFF, raw = JSON.parse(bom ? s.slice(1) : s);
    const folders = (raw.Folders || []).map((fo, fi) => ({ name: fo.Name, index: fi, ...geomOf(fo.Documents || []),
      docs: (fo.Documents || []).map((d, di) => ({ name: d.Name, kind: KIND(d), index: di, doc: d })) }));
    return { raw, bom, crlf: /\r\n/.test(s), indent: (s.match(/\n( +)"/) || [])[1] || '  ', written: raw.WriteDate || null, folders };
  }
  function serialize(file) {
    let t = JSON.stringify(file.raw, null, file.indent.length);
    if (file.crlf) t = t.replace(/\n/g, '\r\n');
    return (file.bom ? '﻿' : '') + t;
  }

  // ---------- the seismic document as src/seismic.js takes it ----------
  const SFRS_ENUM = t => {
    const s = String(t || '');
    const base = /Portal/i.test(s) ? 'Portal Frame' : /Rigid/i.test(s) ? 'Rigid Frame' : /XBrace|X_?Brac/i.test(s) ? 'X-Bracing' : /Post/i.test(s) ? 'Post & Beam' : /Fixed|Cantilever/i.test(s) ? 'Fixed Base' : /BRBF|Buckling/i.test(s) ? 'BRBF' : /EBF|Eccentric/i.test(s) ? 'EBF' : 'X-Bracing';
    return /_IMF/i.test(s) ? `${base} (IMF)` : /_SMF/i.test(s) ? `${base} (SMF)` : /_SCBF/i.test(s) ? `${base} (SCBF)` : base;
  };
  const RISK = { LowHazard: 'I', StandardHazard: 'II', SubstantialHazard: 'III', EssentialFacilities: 'IV', EssentialFacility: 'IV' };
  const ED = { ASCE705: '7-05', ASCE710: '7-10', ASCE716: '7-16', ASCE722: '7-22' };
  const BAY = { LeftEndwall: 'Left Endwall', RightEndwall: 'Right Endwall', Interior: 'Interior', InteriorWithPartition: 'Interior w/ Partition' };
  const wallOf = w => (!w ? null : { kind: w.TopOfMasonryElevationInFeet != null || w.IsPartialHeight ? 'partial' : 'full', shear: !!w.SelfSupportingShearWall, parapet: !!w.HasParapet, top: w.TopElevationInFeet,
    weight: w.WallWeightInPSF, upperWeight: w.UpperWallWeightInPSF, masonryTop: w.TopOfMasonryElevationInFeet, lowerWeight: w.LowerWallWeightInPSF });
  const mezzOf = m => ({ id: m.ID, elev: m.ElevationInFeet, FDL: m.FloorDeadInPSF, FLC: m.FloorCollateralInPSF, FLJ: m.JoistDeadInPSF, storage: !!m.ApplyStorageLoading, FLL: m.FloorLiveInPSF, partition: !!m.ApplyPartitionLoading, FLP: m.PartitionDeadInPSF });
  const over = fi => ({ Ta: fi.OverrideFundamentalPeriod ? fi.FundamentalPeriod : undefined, k: fi.OverrideVerticalDistributionFactor ? fi.VerticalDistributionFactor : undefined, rho: fi.OverrideRedundancyFactor ? fi.RedundancyFactor : undefined });
  const mzIn = list => (list || []).map(m => ({ id: m.UniformLoadInputId, area: m.LoadingAreaInSquareFeet, conc: m.ConcentratedLoadTotalInKips || 0 }));

  // the codes src/seismic.js works (ASCE 7); a Canadian document (NBCC: Sa(T), Rd · Ro) is read and shown, not worked
  const asce = sd => !!ED[((sd && sd.DesignCodeInputs) || {}).SelectedBuildingCode];
  const codeOf = sd => String(((sd && sd.DesignCodeInputs) || {}).SelectedBuildingCode || ((sd && sd.BuildingCode) || {}).SelectedBuildingCode || ((sd && sd.BuildingCode) || {}).BuildingCode || '').replace(/^ASCE(\d)(\d\d)$/, 'ASCE $1-$2').replace(/^NBCC(\d{4})$/, 'NBCC $1');
  function seismicInputs(sd) {
    const gi = sd.BuildingGeometryInputs || {}, si = sd.SeismicDataInputs || {}, li = sd.BuildingLoadInputs || {}, ed = ED[(sd.DesignCodeInputs || {}).SelectedBuildingCode] || '7-16';
    const long = sd.LongitudinalCalculations || { FramingInputs: {} };
    const P = {
      building: { ed, type: /Single/i.test((sd.BuildingTypeInputs || {}).BuildingType) ? 'Single Slope' : 'Gable', width: gi.BuildingWidthInFeet, length: gi.BuildingLengthInFeet, dtr: gi.BSWRidgeDistanceInFeet, slope: gi.BSWRoofSlopeOn12, eaveFSW: gi.FSWEaveHeightInFeet, eaveBSW: gi.BSWEaveHeightInFeet },
      seismic: { ed, risk: RISK[si.OccupancyCategory] || 'II', Ss: si.Ss, S1: si.S1, SMS: ed === '7-22' ? si.Sms : undefined, SM1: ed === '7-22' ? si.Sm1 : undefined, siteClass: si.SiteClass,
        roofDiaphragm: si.RoofDiaphragm, mezzDiaphragm: si.MezzanineDiaphragm, ndfs: si.UseNotDetailedForSeismicSFRSIfPossible !== false, significant: !!si.IsMultiStory,
        irregular: !!si.SeismicIrregularitiesExist, torsionLong: si.UseAccidentalTorsionInLongDirection !== false, torsionLat: !!si.UseAccidentalTorsionInLateralDirection },
      roof: { SW: li.LateralFrameSelfWeightInPSF, RDL: li.RoofDeadLoadInPSF, CDL: li.RoofCollateralLoadInPSF, RSW: li.RoofSelfWeightInPSF, Pf: li.RoofSnowInPSF },
      walls: { LEW: wallOf(li.LEWLoads), REW: wallOf(li.REWLoads), FSW: wallOf(li.FSWLoads), BSW: wallOf(li.BSWLoads), Partition: wallOf(li.PartitionLoads) },
      mezz: (li.MezzanineLoads || []).map(mezzOf), cranes: [],
      sfrs: { FSW: SFRS_ENUM(long.FramingInputs.FSW_SFRS), BSW: SFRS_ENUM(long.FramingInputs.BSW_SFRS), lines: (sd.LateralCalculations || []).map(l => SFRS_ENUM(l.FramingInputs.SFRS)) },
    };
    const lines = (sd.LateralCalculations || []).map(l => { const fi = l.FramingInputs; return { desc: fi.Description, framing: SFRS_ENUM(fi.SFRS), bay: fi.BayWidthInFeet, bayType: BAY[fi.BayType] || fi.BayType, roofConc: fi.RoofConcentratedLoadsInKips, fswTrib: fi.FSWTribLengthInFeet, bswTrib: fi.BSWTribLengthInFeet, partLen: fi.PartitionWallLength, mezz: mzIn(fi.Mezzanines), cranes: [], over: over(l.SeismicFactorInputs || {}) }; });
    const lf = long.FramingInputs;
    const longIn = { roofConc: lf.RoofConcentratedLoadsInKips, fswTrib: lf.FSWTribLengthInFeet, bswTrib: lf.BSWTribLengthInFeet, partTrib: lf.PartitionWallLength, partQty: lf.NumberOfPartitionWalls, mezz: mzIn(lf.Mezzanines), cranes: [], over: over(long.SeismicFactorInputs || {}) };
    return { P, lines, longIn };
  }

  // the few numbers a card shows, and what the document's results say
  function summary(d) {
    const doc = d.doc;
    if (d.kind === 'seismic') {
      const lat = doc.LateralCalculations || [], lg = doc.LongitudinalCalculations || {}, bs = lg.BaseShearResults || {};
      const mz = (doc.BuildingLoadInputs || {}).MezzanineLoads || [];
      return { code: codeOf(doc), asce: asce(doc), lines: lat.length, longV: bs.BaseShear, latV: lat.map(l => (l.BaseShearResults || {}).BaseShear), mezz: mz.length, SDC: ((lg.SeismicFactorResults || {}).SeismicDesignCategory || '').replace(/^Category/, ''), Cs: (lg.SeismicFactorResults || {}).Cs,
        mezzLong: ((bs.ValuesForNBGBracing || {}).ConcentratedSeismicLoads || []).filter(c => c.SeismicMassType === 'Mezzanine').map(c => ({ name: c.Description, F: c.MagnitudeInKips, at: c.ElevationInFeet })) };
    }
    if (d.kind === 'snow') {
      const c = doc.CommonSnowResults || {}, u = doc.UnbalancedSnowResults || {}, inp = doc.SnowLoadInputs || {};
      return { code: codeOf(doc), ca: c.Cb != null, pg: inp.GroundSnowPSF, rain: inp.RainLoadPSF, Ce: c.Ce, Ct: c.Ct, Cb: c.Cb, Cw: c.Cw, Is: c.ImportanceFactor, ps: c.Slope1 ? c.Slope1.Ps : null, pmin: c.Slope1 ? c.Slope1.Pmin : null,
        cases: Object.entries(u).filter(([k, v]) => v && typeof v === 'object').map(([k, v]) => ({ key: k, name: v.CaseName || '', shape: v.ShapeFactor, windward: v.WindwardSnowLoadPSF, leeward: v.LeewardSnowLoadPSF, surcharge: v.SurchargeSnowLoadPSF, length: v.SurchargeLengthInFeet })),
        unbalanced: u.WindToRight ? { surcharge: u.WindToRight.SurchargeSnowLoadPSF, windward: u.WindToRight.WindwardSnowLoadPSF, leeward: u.WindToRight.LeewardSnowLoadPSF, length: u.WindToRight.SurchargeLengthInFeet } : null };
    }
    if (d.kind === 'wind') {
      const c = doc.CommonWindResults || {}, inp = doc.WindLoadInputs || {}, m = doc.MainWindResults || {};
      // NBCC: the reference velocity pressure q (kPa) for the importance category, Ce, Cg Cp and Cpi (Clause 4.1.7)
      const ca = inp.WindPressureKPA != null;
      return { code: codeOf(doc), ca, V: inp.WindSpeedMPH, exposure: String(inp.WindExposure || '').replace(/^Exposure/, ''), enclosure: inp.BuildingEnclosure || (doc.EnclosureResults || {}).Condition, Kd: c.Kd, Kh: c.Kh, Kzt: c.Kzt, Ke: c.Ke, G: c.GustFactor, GCpi: c.GCpi, qh: c.VelocityPressureInPSF, h: c.ReferenceHeightInFeet, zone: m.LateralEdgeZoneDistanceInFeet,
        qKpa: ca ? c.VelocityPressureInKPA ?? inp.WindPressureKPA : undefined, importance: inp.ImportanceCategory, category: inp.EnclosureCategory, Ce: c.Ce, Cgi: c.Cgi, Cpi: ca ? [c.PositiveCpi, c.NegativeCpi] : undefined, Iw: c.ImportanceFactor,
        base: m.BaseWindPressure, longBracing: m.LongitudinalForceResistedByBracing, longTotal: m.TotalLongitudinalForceAppliedToBuilding };
    }
    if (d.kind === 'drift') {
      const r = doc.DriftResults || {}, c = doc.CommonSnowResults || {};
      const pick = o => (o && typeof o === 'object' ? o : {});
      const lee = pick(r.LeewardDrift || r.Leeward), win = pick(r.WindwardDrift || r.Windward);
      return { ps: c.Slope1 ? c.Slope1.Ps : c.Ps, hd: r.DriftHeightInFeet ?? lee.DriftHeightInFeet, w: r.DriftWidthInFeet ?? lee.DriftWidthInFeet, pd: r.MaxDriftLoadPSF ?? lee.MaxDriftLoadPSF, windHd: win.DriftHeightInFeet, keys: Object.keys(r) };
    }
    return {};
  }

  /* The mezzanine loads into one seismic document, its results worked again.
     m: { loads: [{ elev, FDL, FLC, FLJ, FLL, storage, partition, FLP }] (the floor's uniform loads, in order: ID 1, 2 …),
          lines: [[{ n (index into loads), area, conc }]] — one list a lateral calculation, in the document's order, or null
          to leave the lateral calculations as they are; long: [{ n, area, conc }];
          framing: [{ bay, roofConc }] — a lateral calculation's tributary width (bay, FSW and BSW) and roof concentrated
          load (kips) where the engineer typed them, else null } 
     S: src/seismic.js. Returns { changed: [text], lat: [V], longV } */
  function writeSeismic(sd, m, S) {
    if (!asce(sd)) throw new Error(`${codeOf(sd) || 'this code'}: the tool works ASCE 7 seismic only — the document is left as it is`);
    const li = sd.BuildingLoadInputs = sd.BuildingLoadInputs || {}, changed = [];
    const uni = (q, k) => ({ ID: k + 1, ElevationInFeet: q.elev, FloorDeadInPSF: q.FDL, FloorCollateralInPSF: q.FLC || 0, JoistDeadInPSF: q.FLJ || 0, ApplyStorageLoading: !!q.storage, FloorLiveInPSF: q.FLL || 0, ApplyPartitionLoading: !!q.partition, PartitionDeadInPSF: q.partition ? q.FLP || 0 : 0 });
    const loads = (m.loads || []).map(uni);
    li.MezzanineLoads = loads;
    changed.push(`${loads.length} mezzanine${loads.length === 1 ? '' : 's'} in Building Loads`);
    const place = list => (list || []).filter(q => q.area > 0 || q.conc > 0).map(q => ({ UniformLoadInputId: q.n + 1, UniformLoads: { ...loads[q.n] }, LoadingAreaInSquareFeet: q.area, ConcentratedLoadTotalInKips: q.conc || 0 }));
    const lat = sd.LateralCalculations || [];
    if (m.lines) lat.forEach((l, i) => { l.FramingInputs.Mezzanines = place(m.lines[i]); });
    if (m.framing) lat.forEach((l, i) => {
      const t = m.framing[i], fi = l.FramingInputs;
      if (t && t.bay > 0) { fi.BayWidthInFeet = t.bay; fi.FSWTribLengthInFeet = t.bay; fi.BSWTribLengthInFeet = t.bay; changed.push(`${fi.Description || 'line ' + (i + 1)}: tributary width ${t.bay}`); }
      if (t && t.roofConc != null) { fi.RoofConcentratedLoadsInKips = t.roofConc; changed.push(`${fi.Description || 'line ' + (i + 1)}: roof concentrated ${t.roofConc} k`); }
    });
    sd.LongitudinalCalculations.FramingInputs.Mezzanines = place(m.long);
    // the results, as Design Calcs works them from these inputs
    const { P, lines, longIn } = seismicInputs(sd), J = S.project(P);
    const TYPE = { roof: 'Roof', LEW: 'LEW', REW: 'REW', FSW: 'FSW', BSW: 'BSW', mezz: 'Mezzanine', crane: 'Crane', Partition: 'Partition' };
    const masses = R => R.rows.map(r => ({ Description: r.name, SeismicMassType: TYPE[r.key] || r.key, WeightInLbs: r.W, ElevationInFeet: r.h, VerticalDistributionNumerator: r.num, ForceInKips: r.Fx, BaseMomentInKipFt: r.Mx }));
    const concs = list => list.map(c => ({ Description: c.name, SeismicMassType: TYPE[c.key] || c.key, MagnitudeInKips: c.F, ElevationInFeet: c.at }));
    const latV = lat.map((l, i) => {
      const R = S.frameLine(J, lines[i]), bs = l.BaseShearResults = l.BaseShearResults || {}, v = bs.ValuesForNBGFrame = bs.ValuesForNBGFrame || {};
      Object.assign(v, { EquivalentRoofForceInKips: R.frame.equivRoof, RoofWeightInPsf: R.frame.roofPsf, AltRoofWeightInPsf: R.frame.altRoofPsf, PanelLoadInKlf: R.frame.panel, AltPanelLoadInKlf: R.frame.altPanel, SeismicFactor: R.frame.factor, ConcentratedSeismicLoads: concs(R.frame.conc) });
      bs.SeismicMassResults = masses(R); bs.BaseShear = R.V;
      return R.V;
    });
    const lg = sd.LongitudinalCalculations, R = S.bracing(J, longIn), bs = lg.BaseShearResults = lg.BaseShearResults || {}, v = bs.ValuesForNBGBracing = bs.ValuesForNBGBracing || {};
    Object.assign(v, { EquivalentRoofForceInKips: R.bracing.equivRoof, RoofSnowInPsf: R.bracing.snow, RoofDeadOnlyInPsf: R.bracing.deadPsf, RoofTotalSeismicWeightInPsf: R.bracing.totalPsf, AltRoofTotalSeismicWeightInPsf: R.bracing.altTotalPsf, SeismicFactor: R.bracing.factor, ConcentratedSeismicLoads: concs(R.bracing.conc) });
    bs.SeismicMassResults = masses(R); bs.BaseShear = R.V;
    return { changed, lat: latV, longV: R.V };
  }

  const api = { read, serialize, summary, seismicInputs, writeSeismic, asce, codeOf, KIND, SFRS_ENUM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_CALCS = api;
})(typeof self !== 'undefined' ? self : this);
