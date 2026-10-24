/* NBG Bracing files (.bracing): a zip holding .bracingX (the bracing model, XML) and .pfrx (the purlin force report).

   The mezzanine's longitudinal seismic goes in the way it is entered by hand. Tools → Add Loads, one "Mezz. Seismic"
   concentrated load per wall and direction:
     · Load Case EQB (seismic one way): +F at the mezzanine's first frame line.
     · Load Case EQF (the other way): −F at its last frame line.
     · Panel: the wall's plane, Grid Line the wall's own, Elevation the mezzanine's, X - Longitudinal. The plane is the
       element whose bays are that wall (read() works it out: <FrontSidewall> holds line A, the back sidewall).
   Those rows are <BracingLoads><SpecialConcentratedLoads>.

   A load acts only where the wall has a joint at that height. Tools → Add Wall Strut Line (To Wall, From / To Frame Line,
   At Elevation) puts a strut in each bay from the mezzanine to the wall's braced bay at the mezzanine's elevation. That
   strut is a <Strut> (MemberType WallStrut, Real) in each bay's <Struts>; the program numbers its joints and members
   and tiers the bracing when the bracing is designed.

   Everything else in the file is left byte for byte: the .pfrx entry is copied as it is, and the model text only gains
   the new rows (earlier "Mezz. Seismic" rows are replaced, a strut already at that height is kept).
   inflate / deflate: (Uint8Array) → Promise<Uint8Array> of raw DEFLATE data (Node zlib or the browser's streams). */
(function (root) {
  'use strict';
  const FF = root.MZ_FRAMEFILE || (typeof require !== 'undefined' ? require('./framefile.js') : null);
  const MODEL = '.bracingX', LOAD_NAME = 'Mezz. Seismic';
  const utf8 = s => new TextEncoder().encode(s), unutf8 = u => new TextDecoder('utf-8').decode(u);
  const num = v => (v == null || v === '' ? null : +v);

  // ---------- XML, as text: the direct children of an element, so offsets stay exact for the edits ----------
  const TAG = /<(\/?)([A-Za-z_][\w.:-]*)(?:\s[^>]*?)?(\/?)>/g;
  function kids(xml, scope) {
    const out = [];
    let depth = 0, cur = null, m;
    TAG.lastIndex = scope.innerStart;
    while ((m = TAG.exec(xml)) && m.index < scope.innerEnd) {
      const [all, close, name, self] = m;
      if (close) { depth--; if (depth === 0 && cur) { cur.end = m.index + all.length; cur.innerEnd = m.index; out.push(cur); cur = null; } }
      else if (self) { if (depth === 0) out.push({ name, start: m.index, end: m.index + all.length, innerStart: m.index + all.length, innerEnd: m.index + all.length, empty: true }); }
      else { if (depth === 0) cur = { name, start: m.index, innerStart: m.index + all.length }; depth++; }
    }
    return out;
  }
  const kid = (xml, scope, name) => (scope ? kids(xml, scope).find(k => k.name === name) || null : null);
  const all = (xml, scope, name) => (scope ? kids(xml, scope).filter(k => k.name === name) : []);
  const path = (xml, scope, ...names) => names.reduce((s, n) => kid(xml, s, n), scope);
  // the first element of that name anywhere inside scope (for blocks whose parent varies between versions)
  function findDeep(xml, scope, name) {
    if (!scope) return null;
    const re = new RegExp(`<${name}(?=[\\s>/])`, 'g');
    re.lastIndex = scope.innerStart;
    const m = re.exec(xml);
    if (!m || m.index >= scope.innerEnd) return null;
    let depth = 0, x;
    TAG.lastIndex = m.index;
    while ((x = TAG.exec(xml))) {
      const [whole, close, , self] = x;
      if (self && depth === 0) return { name, start: m.index, end: x.index + whole.length, innerStart: x.index + whole.length, innerEnd: x.index + whole.length, empty: true };
      if (close) { if (--depth === 0) return { name, start: m.index, end: x.index + whole.length, innerStart: xml.indexOf('>', m.index) + 1, innerEnd: x.index }; }
      else if (!self) depth++;
    }
    return null;
  }
  const text = (xml, scope, name) => { const k = kid(xml, scope, name); return k && !k.empty ? xml.slice(k.innerStart, k.innerEnd) : null; };
  const rootOf = xml => ({ innerStart: 0, innerEnd: xml.length });

  async function read(bytes, io, fileName) {
    const entries = FF.unzip(bytes), model = entries.find(e => e.name === MODEL || /\.bracingX$/i.test(e.name));
    if (!model) throw new Error('no bracing model (.bracingX) in this file');
    const raw = model.method === 0 ? model.data : await io.inflate(model.data);
    if (FF.crc32(raw) !== model.crc) throw new Error('the bracing model does not match its checksum');
    const bom = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
    const xml = unutf8(raw);
    const C = kid(xml, rootOf(xml), 'Container'), pd = kid(xml, C, 'ProjectData'), bl = kid(xml, pd, 'BracingLoads');
    if (!pd || !bl) throw new Error('not an NBG Bracing model');
    const nl = xml.includes('\r\n') ? '\r\n' : '\n';
    const info = {
      fileName: fileName || null, job: text(xml, pd, 'JobNumber'), jobName: text(xml, pd, 'JobName'), run: text(xml, pd, 'BracingRun'), version: text(xml, pd, 'ApplicationVersion'),
      roofDead: num(text(xml, pd, 'RoofDeadLoad')), collateral: num(text(xml, pd, 'CollateralDeadLoad')), roofLive: num(text(xml, pd, 'RoofLiveLoad')),
    };
    const code = kid(xml, bl, 'BuildingCode'), snow = kid(xml, bl, 'Snow'), sz = kid(xml, bl, 'Seismic');
    info.code = text(xml, code, 'DesignCodeString'); info.risk = text(xml, code, 'MBMAImportanceCategoryString');
    info.snow = num(text(xml, snow, 'RoofSnowLoad'));
    const sv = n => num(text(xml, sz, n));
    info.seismic = sz ? { code: text(xml, sz, 'DesignCode'), siteClass: text(xml, sz, 'SiteClassString'), Ss: sv('Ss'), S1: sv('S1'), Sms: sv('Sms'), Sm1: sv('Sm1'), Sds: sv('Sds'), Sd1: sv('Sd1'),
      R: sv('R'), mrh: sv('MeanRoofHeight'), roofTotal: sv('RoofTotalSeismic'), roofDead: sv('RoofSeismicDead'), factor: sv('RoofSeismicFactor'),
      customFactor: text(xml, sz, 'CustomRoofSeismicFactor') === 'true', bracingType: text(xml, sz, 'BracingType'), roofDiaphragm: text(xml, sz, 'RoofDiaphragm') } : null;
    // the building: frame lines (0-based index, the name shown, the distance from line 1) and the two sidewalls
    const lay = path(xml, pd, 'Buildings', 'BuildingLayout');
    if (!lay) throw new Error('no building layout in this bracing model');
    info.width = num(text(xml, lay, 'WidthInFeet')); info.length = num(text(xml, lay, 'LengthInFeet'));
    info.eaveFSW = num(text(xml, lay, 'FSWEaveHeight')); info.eaveBSW = num(text(xml, lay, 'BSWEaveHeight'));
    const wd = kid(xml, lay, 'WallData'), lines = new Map(), els = [];
    ['FrontSidewall', 'BackSidewall'].forEach((t, plane) => {
      const w = kid(xml, wd, t);
      if (!w) return;
      const bays = all(xml, kid(xml, w, 'Bays'), 'SidewallBay');
      els.push({ tag: t, plane: num(text(xml, w, 'Index')) ?? plane, grid: num(text(xml, w, 'AtGrid')), headerTop: num(text(xml, w, 'WallTop')),
        bays: bays.map(b => {
          const ln = e => ({ index: num(text(xml, e, 'Index')), name: text(xml, e, 'Name'), x: num(text(xml, e, 'DistanceFromOne')) });
          const from = ln(kid(xml, b, 'FromLine')), to = ln(kid(xml, b, 'ToLine'));
          [from, to].forEach(l => { if (l.index != null) lines.set(l.index, l); });
          const st = kid(xml, b, 'Struts'), br = kid(xml, b, 'Braces');
          // each member with what the last design found: its force under the governing combination and what it allows
          const struts = all(xml, st, 'Strut').map(s => ({ elev: num(text(xml, s, 'Elevation')), real: text(xml, s, 'Real') === 'true', type: text(xml, s, 'StrutType'), atRoof: num(text(xml, s, 'AtRoof')),
            id: text(xml, s, 'ID'), axial: Math.abs(num(text(xml, s, 'Axial')) || 0), allowed: num(text(xml, s, 'AxialAllowed')), combo: num(text(xml, s, 'LoadCombination')), bogus: text(xml, s, 'BogusStrut') === 'true' }));
          const braces = all(xml, br, 'Brace').map(s => ({ top: num(text(xml, s, 'TopElevation')), bottom: num(text(xml, s, 'BottomElevation')), member: text(xml, s, 'MemberDescription'),
            id: text(xml, s, 'ID'), axial: Math.abs(num(text(xml, s, 'AxialLoad')) || 0), allowed: num(text(xml, s, 'AxialAllowed')), combo: num(text(xml, s, 'LoadCombination')), length: num(text(xml, s, 'Length')), orient: text(xml, s, 'BracingOrientation') }));
          return { index: num(text(xml, b, 'Index')), from: from.index, to: to.index, braced: braces.length > 0, braces, struts, strutsAt: st ? { start: st.start, end: st.end, innerEnd: st.innerEnd, empty: !!st.empty } : null };
        }) });
    });
    /* Which wall each element is. The bays NBG Bracing keeps under <FrontSidewall> sit on grid line A (AtGrid 0, struts
       DistanceFromA 0) — on Nucor's drawings line A is the BACK sidewall — and their eave strut, girts and brace tops are
       the back sidewall's height; <BackSidewall> holds the front sidewall's. Only the element's own WallTop names the
       other side. Every run seen with unequal eaves reads this way, and PCS Box 12 agrees with it (X-bracing on the low
       FSW, the BSW's portal frames not in the rods). So each element is keyed by its bays' eave strut where the eaves
       differ, else by line A = BSW; the loads written for a wall go on that element's plane and grid. */
    const eF = info.eaveFSW, eB = info.eaveBSW, decisive = eF != null && eB != null && Math.abs(eF - eB) > 0.05;
    els.forEach(e => {
      const ev = e.bays.flatMap(b => b.struts.filter(t => t.type === 'Eave' && t.atRoof === 0).map(t => t.elev)).filter(v => v != null);
      e.eave = ev.length ? Math.max(...ev) : null;
      if (decisive && e.eave != null && Math.min(Math.abs(e.eave - eF), Math.abs(e.eave - eB)) < 0.05) { e.key = Math.abs(e.eave - eF) < Math.abs(e.eave - eB) ? 'FSW' : 'BSW'; e.how = 'eave strut'; }
    });
    const g0 = Math.min(...els.map(e => (e.grid == null ? Infinity : e.grid)));
    els.forEach(e => { if (!e.key) { e.key = e.grid === g0 ? 'BSW' : 'FSW'; e.how = 'line A'; } });
    if (els.length === 2 && els[0].key === els[1].key) els.forEach(e => { e.key = e.tag === 'FrontSidewall' ? 'BSW' : 'FSW'; e.how = 'line A'; });
    const walls = {};
    els.forEach(e => { walls[e.key] = { key: e.key, tag: e.tag, plane: e.plane, grid: e.grid, top: e.eave ?? (e.key === 'FSW' ? eF : eB) ?? e.headerTop, headerTop: e.headerTop, eave: e.eave, how: e.how, bays: e.bays }; });
    info.wallMap = els.map(e => ({ key: e.key, tag: e.tag, plane: e.plane, grid: e.grid, eave: e.eave, how: e.how }));
    info.lines = [...lines.values()].sort((a, b) => a.index - b.index);
    info.walls = walls;
    // portal frames (not rods: <PortalFrames>, by wall plane and bay) — a braced bay all the same
    const dbl = (scope, name) => all(xml, kid(xml, scope, name), 'double').map(d => +xml.slice(d.innerStart, d.innerEnd));
    info.portals = all(xml, path(xml, pd, 'Buildings', 'BuildingLayout', 'PortalFrames') || kid(xml, pd, 'PortalFrames') || findDeep(xml, pd, 'PortalFrames'), 'PortalFrame').map(q => ({
      id: text(xml, q, 'ID'), plane: num(text(xml, q, 'Wall')), bay: num(text(xml, q, 'Bay')), height: num(text(xml, q, 'Height')), grid: text(xml, q, 'GridLine'), combo: num(text(xml, q, 'Combination')),
      H1: dbl(q, 'Portal_H1'), H2: dbl(q, 'Portal_H2'), T1: dbl(q, 'Portal_T1'), T2: dbl(q, 'Portal_T2'), delta: dbl(q, 'Portal_Delta') }));
    Object.values(walls).forEach(w => w.bays.forEach(b => { const pf = info.portals.find(q => q.plane === w.plane && q.bay === b.index); if (pf) { b.portal = pf; b.braced = true; } }));
    // the load combinations, in the order the members' forces are kept, each named by its cases
    const CASE = { SelfWeight: 'SW', RoofDeadLoad: 'D', CollateralDeadLoad: 'C', SnowLeftSlope: 'S', SnowRightSlope: 'S', RoofLiveLeft: 'Lr', RoofLiveRight: 'Lr', LongitudinalWind1Back: 'W1B', LongitudinalWind1Front: 'W1F',
      LongitudinalWind2Back: 'W2B', LongitudinalWind2Front: 'W2F', SeismicBack: 'EQB', SeismicFront: 'EQF', NotionalLoadToBack: 'NB', NotionalLoadToFront: 'NF' };
    info.combos = all(xml, findDeep(xml, pd, 'LoadCombinations'), 'LoadCombination').map((c, n) => ({ n, active: text(xml, c, 'Active') !== 'false',
      text: all(xml, kid(xml, c, 'LoadCasesWithFactor'), 'LoadCase').map(lc => { const fct = +(text(xml, lc, 'Factor') || 1), cs = text(xml, lc, 'Case') || ''; return `${fct === 1 ? '' : +fct.toFixed(3) + ' '}${CASE[cs] || cs}`; }).join(' + ') }));
    const cw = findDeep(xml, pd, 'CostAndWeights'), cv = n => num(text(xml, cw, n));
    info.cost = cw ? { rodWeight: cv('RodWeight'), rodCost: cv('RodCost'), strutWeight: cv('StrutWeight'), strutCost: cv('StrutCost'), portalWeight: cv('PortalWeight'), portalCost: cv('PortalCost'), cableWeight: cv('CableWeight'),
      angleWeight: cv('AngleWeight'), purlinStrutWeight: cv('PurlinStrutWeight'), totalWeight: cv('TotalWeight'), totalCost: cv('TotalCost') } : null;
    const ctl = findDeep(xml, pd, 'Control'), flag = n => text(xml, ctl, n) === 'true';
    info.status = ctl ? { solved: flag('DidSolveModel'), designed: flag('DidDesignBracing'), edited: flag('DidEditBracing') } : null;
    info.totalLong = num(text(xml, sz, 'TotalLongitudinalForce')) ?? num(text(xml, findDeep(xml, pd, 'Seismic'), 'TotalLongitudinalForce'));
    // the special concentrated loads already in the file ("Mezz. Seismic" rows from an earlier run or by hand)
    const sl = kid(xml, bl, 'SpecialConcentratedLoads');
    info.loads = all(xml, sl, 'ConcentratedLoad').map(c => ({ name: text(xml, c, 'Name'), caseId: text(xml, c, 'LoadCaseId'), plane: num(text(xml, c, 'PlaneNbr')), line: num(text(xml, c, 'Frameline')),
      grid: num(text(xml, c, 'Gridline')), elev: num(text(xml, c, 'Elevation')), F: num(text(xml, c, 'Magnitude')), dir: num(text(xml, c, 'Direction')), panel: num(text(xml, c, 'Plane')) }));
    return { entries, model, xml, bom, nl, info };
  }

  // a value as the program writes it: the float32 it keeps, printed to read back exactly
  const f32 = v => { const x = Math.fround(+v); return Number.isInteger(x) ? String(x) : String(+x.toPrecision(17)); };
  function indentOf(xml, at) { const ls = xml.lastIndexOf('\n', at - 1); return xml.slice(ls + 1, at).replace(/\S[\s\S]*$/, ''); }

  /* plan: { loads: [{ wall: 'FSW' | 'BSW', line (0-based frame line), elev, F (kips, signed), caseId: 'EQB' | 'EQF' }],
             struts: [{ wall, from, to (0-based frame lines), elev, skip: [bay from] (braced bays left untiered) }] }
           (struts: [] to leave the strut lines to the program)
     returns { bytes, xml, added: { loads, struts }, kept: { struts }, replaced } */
  async function write(file, plan, io) {
    let xml = file.xml;
    const nl = file.nl, walls = file.info.walls, added = { loads: 0, struts: 0 }, kept = { struts: 0 }, edits = [];
    // 1. a wall strut in each bay of each strut line (a strut already at that height stays as it is)
    (plan.struts || []).forEach(s => {
      const w = walls[s.wall];
      if (!w) return;
      const lo = Math.min(s.from, s.to), hi = Math.max(s.from, s.to);
      w.bays.filter(b => Math.min(b.from, b.to) >= lo && Math.max(b.from, b.to) <= hi && !(s.skip || []).includes(Math.min(b.from, b.to))).forEach(b => {
        if (b.struts.some(t => Math.abs(t.elev - s.elev) < 0.01)) { kept.struts++; return; }
        if (!b.strutsAt) return;
        const ind = indentOf(xml, b.strutsAt.start), ci = ind + '  ', fi = ci + '  ';
        const strut = [`<Strut>`, `${fi}<AppliedForces />`, `${fi}<Index>${b.struts.length}</Index>`, `${fi}<StrutType>Eave</StrutType>`, `${fi}<DistanceFromA>0</DistanceFromA>`,
          `${fi}<FromJoint>0</FromJoint>`, `${fi}<ToJoint>0</ToJoint>`, `${fi}<AtRoof>-1</AtRoof>`, `${fi}<Elevation>${f32(s.elev)}</Elevation>`, `${fi}<MemberNbr>0</MemberNbr>`,
          `${fi}<LoadCombination>0</LoadCombination>`, `${fi}<Axial>0</Axial>`, `${fi}<AxialAllowed>0</AxialAllowed>`, `${fi}<OmegaRdApplied>false</OmegaRdApplied>`,
          `${fi}<BogusStrut>false</BogusStrut>`, `${fi}<Real>true</Real>`, `${fi}<ID />`, `${fi}<MemberType>WallStrut</MemberType>`, `${fi}<CompositeMember>false</CompositeMember>`, `${ci}</Strut>`].join(nl);
        if (b.strutsAt.empty) edits.push({ at: b.strutsAt.start, del: b.strutsAt.end - b.strutsAt.start, text: `<Struts>${nl}${ci}${strut}${nl}${ind}</Struts>` });
        else edits.push({ at: b.strutsAt.innerEnd, del: 0, text: `  ${strut}${nl}${ind}` });
        b.struts.push({ elev: s.elev, real: true, type: 'Eave' });
        added.struts++;
      });
    });
    // 2. the special concentrated loads: earlier "Mezz. Seismic" rows out, ours in
    const C = kid(xml, rootOf(xml), 'Container'), bl = kid(xml, kid(xml, C, 'ProjectData'), 'BracingLoads'), sl = kid(xml, bl, 'SpecialConcentratedLoads');
    if (!sl) throw new Error('no <SpecialConcentratedLoads> in this bracing model');
    const ind = indentOf(xml, sl.start), ci = ind + '  ', fi = ci + '  ';
    const others = all(xml, sl, 'ConcentratedLoad').filter(c => text(xml, c, 'Name') !== LOAD_NAME);
    const replaced = all(xml, sl, 'ConcentratedLoad').length - others.length;
    const rows = others.map((c, i) => xml.slice(c.start, c.end).replace(/<Index>\d+<\/Index>/, `<Index>${i}</Index>`));
    (plan.loads || []).forEach(l => {
      const w = walls[l.wall];
      if (!w) return;
      rows.push([`<ConcentratedLoad>`, `${fi}<Index>${rows.length}</Index>`, `${fi}<Name>${LOAD_NAME}</Name>`, `${fi}<Elevation>${f32(l.elev)}</Elevation>`, `${fi}<Gridline>${w.grid}</Gridline>`,
        `${fi}<Magnitude>${f32(l.F)}</Magnitude>`, `${fi}<PlaneNbr>${w.plane}</PlaneNbr>`, `${fi}<Frameline>${l.line}</Frameline>`, `${fi}<FromConcLoad>0</FromConcLoad>`,
        `${fi}<LoadCase>0</LoadCase>`, `${fi}<LoadCaseId>${l.caseId}</LoadCaseId>`, `${fi}<Joint>0</Joint>`, `${fi}<Direction>120</Direction>`, `${fi}<Plane>119</Plane>`, `${fi}<Status>71</Status>`, `${ci}</ConcentratedLoad>`].join(nl));
      added.loads++;
    });
    const block = rows.length ? `<SpecialConcentratedLoads>${nl}${rows.map(r => ci + r).join(nl)}${nl}${ind}</SpecialConcentratedLoads>` : '<SpecialConcentratedLoads />';
    edits.push({ at: sl.start, del: sl.end - sl.start, text: block });
    edits.sort((a, b) => b.at - a.at).forEach(e => { xml = xml.slice(0, e.at) + e.text + xml.slice(e.at + e.del); });
    const body = utf8(xml), rawOut = file.bom ? new Uint8Array([0xEF, 0xBB, 0xBF, ...body]) : body, data = await io.deflate(rawOut);
    const entries = file.entries.map(en => (en === file.model ? { ...en, method: 8, crc: FF.crc32(rawOut), usize: rawOut.length, data } : en));
    return { bytes: FF.zip(entries), xml, added, kept, replaced };
  }

  /* What goes into the file for the mezzanines, from the Seismic calc's bracing lines:
     lines: [{ wall: 'FSW' | 'BSW', F (kips), at (elevation), x0, x1 (the mezzanine's extent along the length, ft from the LEW), mezz }]
     returns { loads, struts, notes }: EQB +F at the first frame line of the mezzanine's extent, EQF −F at the last;
     a strut line at its elevation from the mezzanine to the wall's nearest braced bay. */
  function planFor(file, lines) {
    const info = file.info, L = info.lines, notes = [], loads = [], struts = [];
    if (!L.length) return { loads, struts, notes: ['No frame lines read from the bracing file.'] };
    const byIndex = i => L.find(l => l.index === i) || {};
    lines.forEach(bl => {
      const w = info.walls[bl.wall];
      if (!w) { notes.push(`${bl.wall}: no such wall in the bracing file.`); return; }
      if (!(Math.abs(bl.F) > 0)) return;
      // the frame lines at the mezzanine's ends: the first and last at or inside it, or the bay it sits in
      const inside = L.filter(l => l.x >= bl.x0 - 0.6 && l.x <= bl.x1 + 0.6);
      let a = inside[0], b = inside[inside.length - 1];
      if (!a || a === b) {
        a = L.filter(l => l.x <= bl.x0 + 0.6).pop() || L[0];
        b = L.find(l => l.x >= bl.x1 - 0.6 && l.index > a.index) || L[Math.min(L.length - 1, L.indexOf(a) + 1)];
      }
      loads.push({ wall: bl.wall, line: a.index, lineName: a.name, elev: bl.at, F: Math.abs(bl.F), caseId: 'EQB', mezz: bl.mezz });
      loads.push({ wall: bl.wall, line: b.index, lineName: b.name, elev: bl.at, F: -Math.abs(bl.F), caseId: 'EQF', mezz: bl.mezz });
      // the strut line: from the mezzanine to the braced bay nearest it (the bay it sits in, when that one is braced)
      const braced = w.bays.filter(x => x.braced);
      let from = a.index, to = b.index, bay = null;
      if (braced.length) {
        const mid = (a.index + b.index) / 2;
        bay = braced.reduce((p, q) => (Math.abs((q.from + q.to) / 2 - mid) < Math.abs((p.from + p.to) / 2 - mid) ? q : p));
        from = Math.min(from, bay.from, bay.to); to = Math.max(to, bay.from, bay.to);
      } else notes.push(`${bl.wall}: no braced bay in the file yet — the strut line runs along the mezzanine (lines ${a.name}–${b.name}); carry it to the bracing once it is placed.`);
      struts.push({ wall: bl.wall, from, to, elev: bl.at, fromName: byIndex(from).name, toName: byIndex(to).name, bay: bay ? `${byIndex(bay.from).name}–${byIndex(bay.to).name}` : null });
    });
    // one strut line per wall and height
    const seen = new Map();
    struts.forEach(s => { const k = `${s.wall}|${s.elev.toFixed(3)}`, o = seen.get(k); if (!o) seen.set(k, s); else { o.from = Math.min(o.from, s.from); o.to = Math.max(o.to, s.to); o.fromName = byIndex(o.from).name; o.toName = byIndex(o.to).name; } });
    return { loads, struts: [...seen.values()], notes };
  }

  /* An eQuote project (.nbgscope, JSON): the project loads (building code, Ss, S1, SMS, SM1, site class, risk category)
     and each building's size, roof loads (dead, collateral, snow) and wall bracing. The code is eQuote's id; the ones
     known here are those its bracing runs name (code 168 → IBC2021). */
  const SCOPE_CODES = { 168: 'IBC 2021' };
  function readScope(textIn) {
    const d = JSON.parse(String(textIn).replace(/^﻿/, ''));
    const p = d.Project;
    if (!p || !p.ProjectLoads) throw new Error('not an eQuote project file');
    const L = p.ProjectLoads, s = L.SeismicLoad || {};
    const planes = p.Planes || [];
    return {
      job: p.NucorQuoterNumber || null, name: p.Name || null, codeId: L.BuildingCodeId ?? null, code: SCOPE_CODES[L.BuildingCodeId] || null,
      risk: L.MBMAImportanceCategory || null, Ss: s.Ss ?? null, S1: s.S1 ?? null, Sms: s.Sms ?? null, Sm1: s.Sm1 ?? null, siteClass: s.SiteClass || null, Ie: s.SeismicImportanceFactor ?? null,
      buildings: (p.Buildings || []).map(b => {
        const g = b.Geometry || {}, bl = b.BuildingLoads || {};
        const wall = re => planes.filter(pl => pl.BuildingId === b.Id && re.test(pl.Name || '')).flatMap(pl => (pl.Bracing || []).map(x => ({ type: x.BracingType, bays: x.Bays || [] })));
        return { name: b.Name, id: b.eQuoteBuildingId ?? null, width: g.BuildingWidth / 12, length: g.BuildingLength / 12, eaveFSW: g.FSWEaveHeightInches / 12, eaveBSW: g.BSWEaveHeightInches / 12,
          roofDead: bl.RoofDeadLoad ?? null, collateral: bl.PrimaryCollateralPSF ?? null, snow: bl.RoofSnowLoadPSF ?? null,
          bracing: { FSW: wall(/\(FSW\)/), BSW: wall(/\(BSW\)/), LEW: wall(/\(LEW\)/), REW: wall(/\(REW\)/) },
          mezz: (b.Mezzanines || []).map(m => ({ name: m.Name, width: m.WidthInches / 12, length: m.LengthInches / 12, dead: m.DeadLoadPSF, live: m.LiveLoadPSF, collateral: m.CollateralLoadPSF, use: m.OccupancyClassifications || null })) };
      }),
    };
  }

  const api = { read, write, planFor, readScope, kids, LOAD_NAME, SCOPE_CODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_BRACING = api;
})(typeof self !== 'undefined' ? self : this);
