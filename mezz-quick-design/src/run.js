/* Job runner: parsed PCS -> inputs (with provenance) -> layout -> beam marks -> column groups -> quote lines. */
(function (root) {
  'use strict';
  const req = n => (typeof require !== 'undefined' ? require(n) : null);
  const MZ = root.MZ || req('./engine.js');
  const WF = root.MZ_WF || req('./wf-db.js');
  const LAYOUT = root.MZ_LAYOUT || req('./layout.js');
  const DESIGN = root.MZ_DESIGN || req('./design.js');
  const PCS = root.MZ_PCS || req('./pcs.js');

  const DEFAULTS = {
    joistWt: 8,          // psf, standard average (Econ. Joist Guide)
    joistSpacing: 4,     // ft, only if the PCS leaves it TBD with no annotation
    seat: 2.5 / 12,      // ft, standard joist seat
  };

  const SETTINGS = {
    edition: 'auto', division: 'auto', target: 0.99, dMin: 10, dMax: 30, symmetric: true, requireConc: true,
    marks: 'single',          // 'single' governing mark (as quoted) | 'split' by trib / span (guide)
    colLength: 'A',           // 'A' finish floor to top of mezzanine | 'clear' clear below mezzanine beam
    includeW818: false, joists: 'auto', partitionTo: 'live',
    optionDefault: 'lightest', // which of the three beam options goes on the quote by default
  };

  const v = (value, source, note) => ({ value, source, note });

  /* Build the editable input set from a parsed PCS (one mezzanine). */
  function inputsFromPCS(pcs, mi = 0) {
    const m = pcs.mezzanines[mi];
    if (!m) return null;
    const b = pcs.building || {};
    const matChecks = (m.checks && m.checks.material) || {};
    const material = Object.keys(matChecks).find(k => matChecks[k]) || null;
    const slabIn = m.slab != null ? m.slab * 12 : null;
    const concrete = /light/i.test(material || '') ? 'LW' : 'NW';
    const deck = DESIGN.deckKey(m.deckType) || '1.0C';
    const dl = typeof m.dead === 'number' ? v(m.dead, 'pcs') : (() => {
      const d = DESIGN.deadLoadFor(slabIn, concrete, deck);
      return { ...v(d.psf, d.estimate ? 'estimate' : 'deckGuide', d.note), auto: true };   // follows slab / deck / concrete edits
    })();
    const dim = k => (m.dims && m.dims[k]) || {};
    const dimV = (k, def, defNote) => {
      const d = dim(k);
      if (d.value != null) return v(d.value, d.source === 'annotation' ? 'annotation' : 'pcs', d.source === 'annotation' ? `PCS "${d.requested}"; blue note ${d.annotation}` : null);
      return def != null ? v(def, 'default', defNote) : v(null, 'missing');
    };
    const provided = (m.checks && m.checks.provided) || {};
    return {
      job: { ...pcs.job, code: pcs.code },
      mezz: { id: m.id, building: m.building, page: m.page, material, concrete, deck, deckText: m.deckType, use: Object.keys((m.checks && m.checks.use) || {}).find(k => m.checks.use[k]) || null, provided, openings: m.openings },
      loads: {
        dead: dl, coll: v(m.collateral ?? 0, m.collateral != null ? 'pcs' : 'default'),
        live: v(m.live, m.live != null ? 'pcs' : 'missing'), partition: v(m.partition ?? 0, m.partition != null ? 'pcs' : 'default'),
        joistWt: v(DEFAULTS.joistWt, 'default', 'Standard estimate (8 psf)'),
      },
      geom: {
        width: v(m.width, 'pcs'), length: v(m.length, 'pcs'), startLEW: v(m.startLEW ?? 0, 'pcs'), startFSW: v(m.startFSW ?? 0, 'pcs'),
        slab: v(m.slab, m.slab != null ? 'pcs' : 'missing'),
        A: dimV('A'), B: dimV('B'), C: dimV('C'),
        joistSpacing: dimV('joistSpacing', DEFAULTS.joistSpacing, 'Not on the PCS — 4\'-0" assumed'),
        seat: dimV('seat', DEFAULTS.seat, 'Not on the PCS — 2 1/2" standard seat assumed'),
      },
      building: {
        width: b.width, length: b.length, ridge: b.ridge, bays: b.bays || [], lewCols: b.lewCols || [], rewCols: b.rewCols || [],
        fswSoldier: b.fswSoldier || [], bswSoldier: b.bswSoldier || [], frames: pcs.frames || [],
      },
    };
  }

  const val = x => (x && typeof x === 'object' && 'value' in x ? x.value : x);

  function resolveEdition(inp, s) {
    const code = inp.job.code || { edition: '15', family: 'AISC' };
    const ed = s.edition === 'auto' ? code.edition : s.edition;
    const notes = [];
    if (s.edition === 'auto' && code.note) notes.push(code.note);
    let beamEd = ed, colEd = ed;
    if (ed === '13') { colEd = '15'; notes.push('No 13th-edition column sheet exists — columns run on the 15th-edition sheet.'); }
    if (/^S16/.test(ed)) { beamEd = null; colEd = null; notes.push(`${ed} (CSA) sheets are not ported yet — run this job in the S16 workbooks.`); }
    if (ed === '16') notes.push('16th-edition column sheet: Lby (C10) is hard-coded to 120 in. — set it to L×12 when you check this in Excel.');
    return { ed, beamEd, colEd, notes, spec: code.spec };
  }

  // Required inputs: without these the answer would be silently wrong, so stop and say what is missing.
  function validate(inp) {
    const miss = [], soft = [];
    const num = x => typeof x === 'number' && isFinite(x);
    [['loads.dead', 'Dead load'], ['loads.live', 'Live load'], ['geom.width', 'Mezzanine width'], ['geom.length', 'Mezzanine length']].forEach(([k, lab]) => {
      const [g, f] = k.split('.'); if (!num(val(inp[g][f]))) miss.push(lab);
    });
    if (!(val(inp.geom.joistSpacing) > 0)) miss.push('Joist spacing');
    const b = inp.building || {};
    if (!(b.width > 0) || !(b.length > 0)) miss.push('Building width / length (Box 2)');
    if (!num(val(inp.geom.A))) soft.push('Top of mezzanine (A) is missing — column length and clearances cannot be set.');
    if (!num(val(inp.geom.slab))) soft.push('Slab / deck thickness is missing — clearance checks are skipped.');
    if (!b.bays || !b.bays.length) soft.push('Sidewall bay spacing was not read (Box 2) — only the building ends are frame lines. Enter the bays on the Inputs page.');
    if ((!b.lewCols || !b.lewCols.length) && (!b.rewCols || !b.rewCols.length)) soft.push('Endwall column spacing was not read (Box 2) — beam lines fall only on the mezzanine edges. Enter it on the Inputs page.');
    return { miss, soft };
  }

  // Dead load from the deck guide tracks slab / deck / concrete edits until someone types a dead load
  function refreshDeadLoad(inp) {
    const d = inp.loads.dead;
    if (!d || !d.auto) return;
    const slab = val(inp.geom.slab);
    const r = DESIGN.deadLoadFor(slab != null ? slab * 12 : null, inp.mezz.concrete || 'NW', inp.mezz.deck || '1.0C');
    inp.loads.dead = { value: r.psf, source: r.estimate ? 'estimate' : 'deckGuide', note: r.note, auto: true };
  }

  function run(inp, settings = {}) {
    const s = { ...SETTINGS, ...settings };
    const warn = [];
    refreshDeadLoad(inp);
    const chk = validate(inp);
    chk.soft.forEach(t => warn.push({ level: 'warn', text: t }));
    if (chk.miss.length) {
      warn.unshift({ level: 'stop', text: `Missing input: ${chk.miss.join(', ')}. Enter it on the Inputs page to run the design.` });
      const ed0 = resolveEdition(inp, s);
      return { settings: s, edition: ed0, division: s.division === 'auto' ? (inp.job.division || 'NBS-IN') : s.division, warn, incomplete: true,
        grid: { xs: [], allY: [], lewY: [], rewY: [], interior: [], yLabel: () => null, xLabel: () => null, width: 0, length: 0 },
        layout: { beams: [], supports: [], mezzCols: [], beamLines: [], supportLines: [], footprint: { x0: 0, x1: 0, y0: 0, y1: 0 }, joists: 'y', why: 'inputs incomplete' },
        marks: [], clear: { A: {}, B: {}, C: {} }, joistDepthIn: null, colLen: null, columns: [], colGroups: [], colFinal: null,
        quote: { beams: [], columns: [] }, beamBase: { dead: val(inp.loads.dead), coll: val(inp.loads.coll), live: val(inp.loads.live), joistWt: val(inp.loads.joistWt), Lb: val(inp.geom.joistSpacing) } };
    }
    const ed = resolveEdition(inp, s);
    const division = s.division === 'auto' ? (inp.job.division || 'NBS-IN') : s.division;
    ed.notes.forEach(n => warn.push({ level: 'info', text: n }));

    const A = val(inp.geom.A), slabFt = val(inp.geom.slab), seatFt = val(inp.geom.seat), Bq = val(inp.geom.B), Cq = val(inp.geom.C);
    const spacing = val(inp.geom.joistSpacing);
    const slabIn = slabFt * 12, seatIn = seatFt * 12;
    const dead = val(inp.loads.dead), coll = val(inp.loads.coll) || 0, part = val(inp.loads.partition) || 0;
    const live = val(inp.loads.live) + (s.partitionTo === 'live' ? part : 0);
    const deadUsed = dead + (s.partitionTo === 'dead' ? part : 0);
    const joistWt = val(inp.loads.joistWt) ?? DEFAULTS.joistWt;

    // Total joist depth (Jaden): A - B - slab - seat
    const joistDepthIn = A != null && Bq != null ? Math.round((A - Bq) * 12 * 1000) / 1000 - slabIn - seatIn : null;

    // flags from Box 22
    const prov = inp.mezz.provided || {};
    if (prov['Designed For Load Provisions Only']) warn.push({ level: 'stop', text: 'Designed For Load Provisions Only is checked — NBG supplies no mezzanine beams or columns.' });
    if (prov['Support Beams'] === false) warn.push({ level: 'warn', text: 'Support Beams are not checked under Materials Provided By Seller.' });
    if (prov['Auxiliary Columns'] === false) warn.push({ level: 'warn', text: 'Auxiliary Columns are not checked under Materials Provided By Seller.' });
    const mat = inp.mezz.material;
    if (mat && !/Concrete/i.test(mat)) warn.push({ level: 'stop', text: `Mezzanine material is "${mat}" — per the training guide the quote engineer runs anything other than deck + concrete. Enter the dead load manually.` });
    if (inp.loads.dead.source === 'estimate') warn.push({ level: 'warn', text: `Dead load ${val(inp.loads.dead)} psf: ${inp.loads.dead.note}` });
    if (part > 0) warn.push({ level: 'info', text: `Partition load ${part} psf added to the ${s.partitionTo} load.` });
    if (spacing > 5) warn.push({ level: 'warn', text: `Joist spacing ${PCS.fmtFtIn(spacing)} exceeds the 5'-0" NBG maximum (DM 15.1.1.3).` });
    ['joistSpacing', 'seat'].forEach(k => { if (inp.geom[k].source === 'default') warn.push({ level: 'warn', text: inp.geom[k].note }); });
    if (inp.mezz.openings) warn.push({ level: 'warn', text: `Floor openings listed: ${inp.mezz.openings} — frame openings by hand.` });

    // layout
    const bl = inp.building;
    const grid = LAYOUT.buildingGrid({ width: bl.width, length: bl.length, bays: bl.bays, lewCols: bl.lewCols, rewCols: bl.rewCols, ridge: bl.ridge, frames: bl.frames, fswSoldier: bl.fswSoldier, bswSoldier: bl.bswSoldier });
    const mz = { length: val(inp.geom.length), width: val(inp.geom.width), startLEW: val(inp.geom.startLEW) || 0, startFSW: val(inp.geom.startFSW) || 0 };
    const lay = LAYOUT.layout(grid, mz, { joists: s.joists, xLines: s.xLines, yLines: s.yLines });
    // grid lines that only some frames share (interior frame columns off the endwall grid) can put beam lines close together
    const tight = lay.beamLines.slice(1).map((v, i) => [lay.beamLines[i], v]).filter(([a, b]) => b - a < 12 - 1e-6);
    if (tight.length && !(s.xLines || s.yLines)) warn.push({ level: 'info', text: `Beam lines ${tight.map(([a, b]) => `${PCS.fmtFtIn(a)} / ${PCS.fmtFtIn(b)}`).join(', ')} are under 12'-0" apart — joists span only ${PCS.fmtFtIn(Math.min(...tight.map(([a, b]) => b - a)))} there. Drop a line on the Plan page if the joists should span past it.` });

    // beams
    const maxDepthByC = Cq != null && A != null ? Math.floor((A - Cq) * 12 - slabIn - seatIn + 1e-6) : null;
    const marks = LAYOUT.beamMarks(lay.beams, s.marks);
    const beamBase = { dead: deadUsed, coll, live, joistWt, Lb: spacing, edition: ed.beamEd };
    const designed = marks.map(mk => {
      const p = { ...beamBase, L: mk.span, trib: mk.trib };
      const dz = ed.beamEd ? DESIGN.designBeam(p, { division, target: s.target, dMin: s.dMin, dMax: s.dMax, symmetric: s.symmetric, requireConc: s.requireConc, maxDepth: maxDepthByC ?? undefined }) : null;
      // the (B) clearance line: A - B - slab - seat (same number as the total joist depth)
      const dLimit = joistDepthIn != null ? Math.floor(joistDepthIn + 1e-6) : null;
      const options = dz ? DESIGN.beamOptions(dz, { dLimit, span: mk.span }) : [];
      // a pick is stored as intent — an option key or a depth — so every input change re-runs the search:
      //   { key: 'fit' } → that option for the current loads; { d: 20 } → lightest passing section at 20";
      //   { sec } → that exact section (checked, flagged if it fails)
      const ov = s.override && s.override[mk.mark];
      const preferred = options.find(o => o.key === ((ov && ov.key) || s.optionDefault));
      const atDepth = ov && ov.d != null && dz ? dz.byDepth.find(z => z.d === +ov.d && !z.none) : null;
      let chosen = ov && ov.sec ? ov.sec : atDepth ? atDepth.sec : preferred ? preferred.pick.sec : dz && dz.best ? dz.best.sec : null;
      if (ov && ov.d != null && !atDepth && chosen) warn.push({ level: 'warn', text: `${mk.mark}: nothing passes at ${ov.d}" deep for these loads — back to the ${preferred ? preferred.label.toLowerCase() : 'lightest'} section.` });
      if (ov && ov.key && !options.some(o => o.key === ov.key) && chosen) warn.push({ level: 'info', text: `${mk.mark}: no ${ov.key} option for these inputs — using the lightest.` });
      const check = chosen ? MZ.beamCheck({ ...p, sec: chosen }, WF) : null;
      const same = (a, b) => a && b && ['d', 'tw', 'bof', 'tof', 'bif', 'tif'].every(k => a[k] === b[k]);
      const optionKey = (options.find(o => same(o.pick.sec, chosen)) || {}).key || (chosen ? 'custom' : null);
      if (check && ov && ov.sec) {
        const okB = check.res.CSR <= s.target && check.res.SRvx <= s.target && check.llOK && check.tlOK && (!check.conc || check.conc.ok);
        if (!okB) warn.push({ level: 'stop', text: `${mk.mark}: the pinned ${check.desc} no longer passes (combined ${check.res.CSR.toFixed(3)}, shear ${check.res.SRvx.toFixed(3)}, L/${Math.round(check.defl.rLL)}) — pick an option again.` });
      }
      return { ...mk, qty: mk.beams.length, params: p, search: dz, options, optionKey, pinned: ov || null, sec: chosen, check, desc: check ? check.desc : null };
    });
    designed.forEach(mk => {
      if (mk.sec) return;
      const cap = maxDepthByC != null && maxDepthByC < s.dMax;
      warn.push({ level: 'stop', text: cap && maxDepthByC < s.dMin
        ? `${mk.mark}: clearance (C) ${PCS.fmtFtIn(Cq)} under the floor beams leaves only ${maxDepthByC}" of beam depth (A − C − slab − seat) — below the ${s.dMin}" minimum. Check the clearance or the minimum depth in Settings.`
        : `${mk.mark}: no stocked BU section between ${s.dMin}" and ${Math.min(s.dMax, maxDepthByC ?? Infinity)}" deep${cap ? ' (capped by clearance C)' : ''} meets SR ≤ ${s.target}, L/360 and L/240. Widen the depth range.` });
    });
    if (maxDepthByC != null && maxDepthByC < s.dMax && maxDepthByC >= s.dMin) warn.push({ level: 'info', text: `Clearance (C) ${PCS.fmtFtIn(Cq)} caps the beam depth at ${maxDepthByC}".` });
    const markOf = id => designed.find(mk => mk.beams.includes(id));

    // clearances (INPUT sheet)
    const dBeam = Math.max(0, ...designed.filter(mk => mk.sec).map(mk => mk.sec.d));
    const clear = {
      A: { req: A, prov: A },
      B: { req: Bq, prov: joistDepthIn != null && A != null ? A - (slabIn + joistDepthIn) / 12 : null },
      C: { req: Cq, prov: A != null && dBeam ? A - (slabIn + seatIn + dBeam) / 12 : null },
    };
    Object.entries(clear).forEach(([k, c]) => { c.ok = c.req == null || c.prov == null ? null : c.prov >= c.req - 1e-9; if (c.ok === false) warn.push({ level: 'stop', text: `Clearance ${k}: provided ${PCS.fmtFtIn(c.prov)} < requested ${PCS.fmtFtIn(c.req)}.` }); });

    // columns: left/right reactions of the beams framing in along the beam line
    const colLen = s.colLength === 'clear' && A != null && dBeam ? A - (slabIn + seatIn + dBeam) / 12 : A;
    const reactionOf = id => {
      if (id == null) return { D: 0, L: 0 };
      const bm = lay.beams[id], mk = markOf(id);
      if (!mk || !mk.sec) return { D: NaN, L: NaN };
      const r = DESIGN.reactions({ ...beamBase, L: bm.span, trib: bm.trib }, mk.sec);
      return { D: r.D, L: r.L, mark: mk.mark };
    };
    const cols = lay.mezzCols.map(c => {
      const Lr = reactionOf(c.beams.L), Rr = reactionOf(c.beams.R);
      // normalise so the heavier side is "left" (the three workbook combinations are symmetric)
      const sw = Lr.D + Lr.L < Rr.D + Rr.L;
      const left = sw ? Rr : Lr, right = sw ? Lr : Rr;
      // tributary floor area: half of each beam framing in x its trib width
      const tribArea = [c.beams.L, c.beams.R].filter(id => id != null).reduce((a, id) => a + lay.beams[id].trib * lay.beams[id].span / 2, 0);
      return { label: c.label, x: c.x, y: c.y, DL_L: left.D, LL_L: left.L, DL_R: right.D, LL_R: right.L, sides: (c.beams.L != null) + (c.beams.R != null), tribArea };
    });
    const key = c => [c.DL_L, c.LL_L, c.DL_R, c.LL_R].map(x => x.toFixed(2)).join('|');
    const groups = [];
    cols.forEach(c => { const g = groups.find(g => g.key === key(c)); g ? g.cols.push(c) : groups.push({ key: key(c), cols: [c], loads: { DL_L: c.DL_L, LL_L: c.LL_L, DL_R: c.DL_R, LL_R: c.LL_R } }); });
    const noBeam = cols.some(c => ![c.DL_L, c.LL_L, c.DL_R, c.LL_R].every(isFinite));   // a beam framing in has no section yet
    groups.forEach(g => { g.design = ed.colEd && colLen && !noBeam ? DESIGN.designColumn(g.loads, { L: colLen, includeW818: s.includeW818, edition: ed.colEd }, WF) : null; });
    // one section for every mezzanine column on the quote: the lightest W (same try order) that passes every group
    const allOK = groups.length && groups.every(g => g.design && g.design.name);
    const env = allOK && groups.length > 1 ? DESIGN.designColumn(groups.map(g => g.loads), { L: colLen, includeW818: s.includeW818, edition: ed.colEd }, WF) : null;
    const govCol = allOK ? (env ? (env.name ? { design: env } : null) : groups[0]) : null;
    let colFinal = null;
    if (govCol) {
      const name = s.colOverride || govCol.design.name;
      const checks = groups.map(g => MZ.columnCheck({ sec: { type: 'WF', name }, Fy: 50, Fu: 65, L: colLen, Lby: colLen * 12, ...g.loads, edition: ed.colEd }, WF));
      const [, dn, wt] = name.match(/^W(\d+)X([\d.]+)/);
      colFinal = { name, quoteAs: DESIGN.COMMON_COLUMNS.includes(name) || name === 'W8X18' ? name : 'BU' + dn + 'x' + wt, checks, max: Math.max(...checks.map(c => c.max)), ok: checks.every(c => c.ok) };
      if (!colFinal.ok) warn.push({ level: 'stop', text: `${name} fails on the Column sheet (max CSR ${colFinal.max.toFixed(3)})${s.colOverride ? ' — the column pick on the Column page overrides the automatic W' : ''}.` });
      if (WF[name].bf < 7) warn.push({ level: 'info', text: `${name} flange is ${WF[name].bf}" (< 7" DM 15.1.1.4.2 min for beams to the flange) — relies on the standard 4" bolt gage.` });
      if (!DESIGN.inStock(DESIGN.WF_STOCK, name, division)) warn.push({ level: 'info', text: `${name} is not a stocked W at ${division}.` });
    }
    if (cols.length && !colLen) warn.push({ level: 'stop', text: 'Column length unknown — enter the top of mezzanine (A) to size the columns.' });
    else if (cols.length && noBeam) warn.push({ level: 'stop', text: 'Columns not sized — the beams framing into them have no section yet.' });
    else if (cols.length && !govCol) warn.push({ level: 'stop', text: 'No W8–W14 column passes — check the loads or design a BU column.' });

    const quote = {
      beams: designed.map(mk => ({ mark: mk.mark, section: mk.desc, span: mk.span, trib: mk.trib, qty: mk.qty })),
      columns: colFinal ? [{ mark: 'MC1', section: colFinal.quoteAs, length: colLen, qty: cols.length }] : [],
    };
    return { settings: s, edition: ed, division, warn, grid, layout: lay, marks: designed, clear, joistDepthIn, maxDepthByC, colLen, columns: cols, colGroups: groups, colFinal, quote, beamBase };
  }

  function quoteText(res, inp) {
    const f = PCS.fmtFtIn;
    const L = [];
    L.push(`${inp.job.quote || ''}  ${inp.job.project || ''}  —  Mezzanine "${inp.mezz.id || ''}"`.trim());
    L.push(`Loads: DL ${res.beamBase.dead} + coll ${res.beamBase.coll} + LL ${res.beamBase.live} psf, joist ${res.beamBase.joistWt} psf; joists @ ${f(res.beamBase.Lb)}; ${res.edition.spec || ''}`);
    res.quote.beams.forEach(b => L.push(`${b.mark}  ${b.section || 'NO SECTION'}   span ${f(b.span)}   trib ${f(b.trib)}   qty ${b.qty}`));
    res.quote.columns.forEach(c => L.push(`${c.mark}  ${c.section}   length ${f(c.length)}   qty ${c.qty}`));
    return L.join('\n');
  }

  /* Rows for the quote workbook's mezzanine tables (Mezz. Design Information / Mezz. Beams / Mezz. Columns).
     DL_T = DL + COL; LL_T = LL (+ partition when it is carried as live). End plates: 40 lb per beam, 46 lb per column. */
  const END_WT_BEAM = 40, END_WT_COL = 46;
  const round = (v, n = 2) => (v == null || !isFinite(v) ? '' : +(+v).toFixed(n));
  function quoteSheet(res, inp) {
    const id = inp.mezz.id || 'A';
    const conc = /light/i.test(inp.mezz.material || '') ? 'LW' : 'NW';
    const b = res.beamBase, part = val(inp.loads.partition) || 0;
    const dl = val(inp.loads.dead), col = val(inp.loads.coll) || 0, ll = val(inp.loads.live);
    const dlT = dl + col + (res.settings.partitionTo === 'dead' ? part : 0);
    const llT = ll + (res.settings.partitionTo === 'live' ? part : 0);
    const dlNote = inp.loads.dead.source === 'pcs' ? 'DL per PCS' : inp.loads.dead.source === 'manual' ? 'DL entered by QE'
      : `DL per seller: ${val(inp.loads.dead)} psf = ${(inp.loads.dead.note || '').replace(/^Deck guide: /, '').replace(/ — estimated.*$/, ' (est.)')}`;
    const design = [{ MEZZ: id, FF: round(val(inp.geom.A), 3), SLAB: round(val(inp.geom.slab) * 12, 3), WT: conc, DL: dl, COL: col, LL: ll, PART: part,
      NOTES: [dlNote, part ? `partition to ${res.settings.partitionTo}` : ''].filter(Boolean).join('; ') }];
    const g = res.grid, lay = res.layout;
    const lineLab = v => (lay.joists === 'y' ? g.yLabel(v) : g.xLabel(v)) || PCS.fmtFtIn(v);
    const beams = res.marks.map(mk => {
      const bs = mk.beams.map(i => lay.beams[i]);
      const lines = [...new Set(bs.map(x => lineLab(x.line)))].sort((a, c) => String(a).localeCompare(String(c), undefined, { numeric: true }));
      const tribs = [...new Set(bs.map(x => x.trib))].sort((a, c) => c - a);
      const opt = mk.options && mk.options.find(o => o.key === mk.optionKey);
      const notes = [`${mk.mark}: lines ${lines.join(', ')}`, tribs.length > 1 ? `trib ${tribs.map(t => PCS.fmtFtIn(t)).join(' / ')} (designed for ${PCS.fmtFtIn(mk.trib)})` : '', opt && opt.key !== 'lightest' ? opt.label.toLowerCase() + ' option' : ''].filter(Boolean).join('; ');
      return { MEZZ: id, SPAN: round(mk.span, 3), TRIB: round(mk.trib, 3), DLT: round(dlT, 2), LLT: round(llT, 2), SECTION: mk.desc || '', ENDWT: END_WT_BEAM, QTY: mk.qty, NOTES: notes };
    });
    const columns = [];
    if (res.colFinal && res.columns.length) {
      const areas = res.columns.map(c => c.tribArea);
      const byArea = {};
      res.columns.forEach(c => { const k = round(c.tribArea, 1); (byArea[k] = byArea[k] || []).push(c.label); });
      const notes = Object.entries(byArea).sort((a, c) => c[0] - a[0]).map(([a, labs]) => `${labs.sort().join(', ')} @ ${a} ft²`).join('; ');
      columns.push({ MEZZ: id, HEIGHT: round(res.colLen, 3), AREA: round(Math.max(...areas), 1), SECTION: res.colFinal.quoteAs, ENDWT: END_WT_COL, QTY: res.columns.length,
        NOTES: notes + (res.colFinal.quoteAs !== res.colFinal.name ? `; run as ${res.colFinal.name}` : '') });
    }
    const heads = {
      design: [['MEZZ', 'MEZZ.'], ['FF', 'FF El. (ft)'], ['SLAB', 'SLAB (in.)'], ['WT', 'WT-NW/LW'], ['DL', 'DL, (psf)'], ['COL', 'COL, (psf)'], ['LL', 'LL, (psf)'], ['PART', 'PART. (psf)'], ['NOTES', 'ADDITIONAL NOTES']],
      beams: [['MEZZ', 'MEZZ.'], ['SPAN', 'SPAN (ft)'], ['TRIB', 'TRIB. (ft)'], ['DLT', 'DLᴛ (psf)'], ['LLT', 'LLᴛ (psf)'], ['SECTION', 'SECTION'], ['ENDWT', 'END WT (lb)'], ['QTY', 'QTY.'], ['NOTES', 'ADDITIONAL NOTES']],
      columns: [['MEZZ', 'MEZZ.'], ['HEIGHT', 'HEIGHT (ft)'], ['AREA', 'TRIB. AREA (ft²)'], ['SECTION', 'SECTION'], ['ENDWT', 'END WT (lb)'], ['QTY', 'QTY.'], ['NOTES', 'ADDITIONAL NOTES']],
    };
    const tsv = (rows, h) => rows.map(r => h.map(([k]) => r[k]).join('\t')).join('\n');
    return { design, beams, columns, heads, tsv: { design: tsv(design, heads.design), beams: tsv(beams, heads.beams), columns: tsv(columns, heads.columns) } };
  }

  const api = { inputsFromPCS, run, quoteText, quoteSheet, SETTINGS, DEFAULTS, resolveEdition };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_RUN = api;
})(typeof self !== 'undefined' ? self : this);
