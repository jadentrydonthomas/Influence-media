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
    marks: 'intext',          // 'intext' interior / exterior (largest trib of each) | 'single' one governing mark | 'split' by trib / span
    colPerJob: true,          // one column section for every mezzanine column of the job
    colLength: 'A',           // 'A' finish floor to top of mezzanine | 'clear' clear below mezzanine beam
    includeW818: false, joists: 'auto', partitionTo: 'live',
    optionDefault: 'lightest', // which of the three beam options goes on the quote by default
  };

  const v = (value, source, note) => ({ value, source, note });

  /* Floor-plan reading → PCS: grid letters as drawn, and each mezzanine's joist direction from the "Mez. Jst."
     arrows inside its footprint. reg is PLAN.registerAndRead(...) for the building the drawing shows. */
  function applyPlan(pcs, reg) {
    if (!pcs) return;
    pcs.plan = reg && reg.ok ? { letters: reg.letters, arrows: reg.arrows, columns: reg.columns, frameCols: reg.frameCols || [] } : null;
    pcs.mezzanines.forEach(m => {
      m.planJoists = null; m.planArrows = 0;
      if (!pcs.plan || m.width == null || m.length == null) return;
      const x0 = m.startLEW || 0, y0 = m.startFSW || 0;
      const inside = pcs.plan.arrows.filter(a => a.x > x0 - 0.5 && a.x < x0 + m.length + 0.5 && a.y > y0 - 0.5 && a.y < y0 + m.width + 0.5);
      const nx = inside.filter(a => a.dir === 'x').length, ny = inside.filter(a => a.dir === 'y').length;
      m.planArrows = inside.length;
      m.planJoists = nx > ny ? 'x' : ny > nx ? 'y' : null;
    });
  }

  /* Build the editable input set from a parsed PCS (one mezzanine). */
  function inputsFromPCS(pcs, mi = 0) {
    const m = pcs.mezzanines[mi];
    if (!m) return null;
    const own = pcs.buildings && pcs.buildings[m.building || ''];
    const b = (own && own.building) || pcs.building || {};
    const frames = (own && own.frames) || pcs.frames || [];
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
      mezz: { id: m.id, building: m.building, page: m.page, material, concrete, deck, deckText: m.deckType, ecospan: pcs.ecospan || null, use: Object.keys((m.checks && m.checks.use) || {}).find(k => m.checks.use[k]) || null, provided, openings: m.openings, planJoists: m.planJoists || null },
      loads: {
        dead: dl, coll: v(m.collateral ?? 0, m.collateral != null ? 'pcs' : 'default'),
        live: v(m.live, m.live != null ? 'pcs' : 'missing'), partition: v(m.partition ?? 0, m.partition != null ? 'pcs' : 'default'),
        joistWt: v(DEFAULTS.joistWt, 'default', 'Standard estimate (8 psf)'),
      },
      geom: {
        width: v(m.width, 'pcs'), length: v(m.length, 'pcs'), startLEW: v(m.startLEW ?? 0, 'pcs'), startFSW: v(m.startFSW ?? 0, 'pcs'),
        slab: v(m.slab, m.slab != null ? 'pcs' : 'missing'),
        A: dimV('A'), B: dimV('B'), C: dimV('C'),
        // no silent defaults: TBD with no blue note means the quote engineer enters it (the Design page asks)
        joistSpacing: dimV('joistSpacing'), seat: dimV('seat'),
      },
      building: {
        width: b.width, length: b.length, ridge: b.ridge, bays: b.bays || [], lewCols: b.lewCols || [], rewCols: b.rewCols || [],
        fswSoldier: b.fswSoldier || [], bswSoldier: b.bswSoldier || [], frames,
        yLetters: pcs.plan && (!own || own.building === pcs.building) ? pcs.plan.letters : undefined,
        // column symbols on the floor plan: ⊗ / circled I = mezzanine column, bare I / ✱ = frame column
        planCols: pcs.plan && (!own || own.building === pcs.building) ? pcs.plan.columns.concat(pcs.plan.frameCols || []) : undefined,
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

  /* Required inputs: without these the answer would be silently wrong, so stop and ask for them.
     path / kind let the Design page put an input box right in the prompt; suggest = one-click typical values. */
  const REQUIRED = [
    ['loads.dead', 'Dead load', 'psf'], ['loads.live', 'Live load', 'psf'],
    ['geom.width', 'Mezzanine width', 'ftin'], ['geom.length', 'Mezzanine length', 'ftin'],
    ['geom.A', '(A) Finish floor to top of mezzanine', 'ftin'], ['geom.slab', 'Slab & deck thickness', 'in'],
    ['geom.B', '(B) Min. clearance under joist', 'ftin', [[9, `9'-0"`, 'conservative headroom']]],
    ['geom.C', '(C) Min. clearance under support beams', 'ftin', []],   // "= B" / "No requirement" offered on the page
    ['geom.joistSpacing', 'Joist spacing (= beam unbraced length)', 'ftin', [[4, `4'-0"`, ''], [5, `5'-0"`, 'NBG max']]],
    ['geom.seat', 'Joist seat depth', 'in', [[2.5 / 12, '2 1/2"', 'K-series'], [5 / 12, '5"', 'LH-series']]],
  ];
  function validate(inp) {
    const miss = [], soft = [], need = [];
    const num = x => typeof x === 'number' && isFinite(x);
    REQUIRED.forEach(([k, lab, kind, suggest]) => {
      const [g, f] = k.split('.'), x = val(inp[g][f]);
      if (f === 'C' && inp.geom.C && inp.geom.C.source === 'none') return;   // entered as "no requirement"
      if (!num(x) || ((f === 'joistSpacing' || f === 'slab' || f === 'width' || f === 'length') && !(x > 0)) || (f === 'seat' && x < 0)) { miss.push(lab); need.push({ path: k, label: lab, kind, suggest: suggest || [] }); }
    });
    const b = inp.building || {};
    if (!(b.width > 0) || !(b.length > 0)) miss.push('Building width / length (Box 2)');
    if (!b.bays || !b.bays.length) soft.push('Sidewall bay spacing was not read (Box 2) — only the building ends are frame lines. Enter the bays on the Inputs page.');
    if ((!b.lewCols || !b.lewCols.length) && (!b.rewCols || !b.rewCols.length)) soft.push('Endwall column spacing was not read (Box 2) — beam lines fall only on the mezzanine edges. Enter it on the Inputs page.');
    return { miss, soft, need };
  }

  // Dead load from the deck guide tracks slab / deck / concrete edits until someone types a dead load
  function refreshDeadLoad(inp) {
    const d = inp.loads.dead;
    if (!d || !d.auto) return;
    const slab = val(inp.geom.slab);
    const r = DESIGN.deadLoadFor(slab != null ? slab * 12 : null, inp.mezz.concrete || 'NW', inp.mezz.deck || '1.0C');
    inp.loads.dead = { value: r.psf, source: r.estimate ? 'estimate' : 'deckGuide', note: r.note, auto: true };
  }

  /* ---------- one mezzanine: inputs → loads → layout (no section sizes yet) ---------- */
  function prepare(inp, settings = {}, index = 0) {
    const s = { ...SETTINGS, ...settings };
    const warn = [];
    refreshDeadLoad(inp);
    const chk = validate(inp);
    chk.soft.forEach(t => warn.push({ level: 'warn', text: t }));
    if (chk.miss.length) {
      warn.unshift({ level: 'stop', text: `Needs input: ${chk.miss.join(', ')} — not on the PCS (TBD, no blue note). Enter ${chk.miss.length > 1 ? 'them' : 'it'} above to run the design.` });
      const ed0 = resolveEdition(inp, s);
      return { index, inp, incomplete: true, result: { settings: s, edition: ed0, division: s.division === 'auto' ? (inp.job.division || 'NBS-IN') : s.division, warn, incomplete: true, need: chk.need, id: inp.mezz.id || `Mezzanine ${index + 1}`, index,
        grid: { xs: [], allY: [], lewY: [], rewY: [], interior: [], yLabel: () => null, xLabel: () => null, width: 0, length: 0 },
        layout: { beams: [], supports: [], mezzCols: [], beamLines: [], supportLines: [], footprint: { x0: 0, x1: 0, y0: 0, y1: 0 }, joists: 'y', why: 'inputs incomplete', snaps: [] },
        marks: [], clear: { A: {}, B: {}, C: {} }, joistDepthIn: null, colLen: null, columns: [], colGroups: [], colFinal: null, foreignCols: [], merges: [],
        quote: { beams: [], columns: [] }, beamBase: { dead: val(inp.loads.dead), coll: val(inp.loads.coll), live: val(inp.loads.live), joistWt: val(inp.loads.joistWt), Lb: val(inp.geom.joistSpacing) } } };
    }
    const ed = resolveEdition(inp, s);
    const division = s.division === 'auto' ? (inp.job.division || 'NBS-IN') : s.division;
    ed.notes.forEach(n => warn.push({ level: /Lby|C10/.test(n) ? 'key' : /Confirm/.test(n) ? 'warn' : 'info', text: n }));

    const A = val(inp.geom.A), slabFt = val(inp.geom.slab), seatFt = val(inp.geom.seat), Bq = val(inp.geom.B), Cq = val(inp.geom.C);
    const spacing = val(inp.geom.joistSpacing);
    const slabIn = slabFt * 12, seatIn = seatFt * 12;
    const dead = val(inp.loads.dead), coll = val(inp.loads.coll) || 0, part = val(inp.loads.partition) || 0;
    const live = val(inp.loads.live) + (s.partitionTo === 'live' ? part : 0);
    const deadUsed = dead + (s.partitionTo === 'dead' ? part : 0);
    const joistWt = val(inp.loads.joistWt) ?? DEFAULTS.joistWt;

    // Total joist depth (Jaden): A - B - slab - seat
    const joistDepthIn = A != null && Bq != null ? Math.round((A - Bq) * 12 * 1000) / 1000 - slabIn - seatIn : null;
    if (joistDepthIn != null && joistDepthIn < 8) warn.push({ level: 'stop', text: `Total joist depth A − B − slab − seat = ${+joistDepthIn.toFixed(2)}" — too shallow for a joist. Check (B) clearance under joist.` });

    // flags from Box 22
    const prov = inp.mezz.provided || {};
    if (prov['Designed For Load Provisions Only']) warn.push({ level: 'stop', text: 'Designed For Load Provisions Only is checked — NBG supplies no mezzanine beams or columns. The connection hole patterns must be known at order entry, otherwise they are field drilled or field welded (DM 15.1.1, 15.1.1.4.2).' });
    if (prov['Support Beams'] === false) warn.push({ level: 'warn', text: 'Support Beams are not checked under Materials Provided By Seller.' });
    if (prov['Auxiliary Columns'] === false) warn.push({ level: 'warn', text: 'Auxiliary Columns are not checked under Materials Provided By Seller.' });
    const mat = inp.mezz.material;
    if (mat && !/Concrete/i.test(mat)) warn.push({ level: 'stop', text: `Mezzanine material is "${mat}" — per the training guide the quote engineer runs anything other than deck + concrete. Enter the dead load manually.` });
    if (inp.loads.dead.source === 'estimate') warn.push({ level: 'warn', text: `Dead load ${val(inp.loads.dead)} psf: ${inp.loads.dead.note}` });
    // a deck the deck guide does not know ("Other", "Per Seller", blank): the dead load is for the deck on the Inputs page
    if (inp.mezz.deckText && !DESIGN.deckKey(inp.mezz.deckText) && inp.loads.dead.auto) warn.push({ level: 'warn', text: `Deck type on the PCS reads "${inp.mezz.deckText}" — the dead load ${val(inp.loads.dead)} psf is taken for ${inp.mezz.deck} form deck. Confirm the deck on the Inputs page.` });
    if (part > 0) warn.push({ level: 'info', text: `Partition load ${part} psf added to the ${s.partitionTo} load.` });
    ['joistSpacing', 'seat'].forEach(k => { if (inp.geom[k].source === 'default') warn.push({ level: 'warn', text: inp.geom[k].note }); });
    if (inp.mezz.openings) warn.push({ level: 'warn', text: `Floor openings listed: ${inp.mezz.openings} — frame openings by hand. An opening wider than one joist spacing needs a joist header; its size and exact location must be on the order documents, and the header locations go to the joist manufacturer (DM 15.1.2).` });

    // layout — joist direction: Plan-page choice, else the "Mez. Jst." arrows on the PCS floor plan, else auto
    const bl = inp.building;
    const grid = LAYOUT.buildingGrid({ width: bl.width, length: bl.length, bays: bl.bays, lewCols: bl.lewCols, rewCols: bl.rewCols, ridge: bl.ridge, frames: bl.frames, fswSoldier: bl.fswSoldier, bswSoldier: bl.bswSoldier, yLetters: bl.yLetters });
    const mz = { length: val(inp.geom.length), width: val(inp.geom.width), startLEW: val(inp.geom.startLEW) || 0, startFSW: val(inp.geom.startFSW) || 0 };
    const fromPlan = s.joists === 'auto' && (inp.mezz.planJoists === 'x' || inp.mezz.planJoists === 'y');
    const lay = LAYOUT.layout(grid, mz, { joists: fromPlan ? inp.mezz.planJoists : s.joists, xLines: s.xLines, yLines: s.yLines });
    if (fromPlan) {
      lay.why = 'joist arrows on the PCS floor plan';
      const alt = lay.alt, n = o => o.beams.length;
      if (alt && (alt.beamSpan < lay.beamSpan - 1e-6 || n(alt) < n(lay))) warn.push({ level: 'key', text: `Joist direction follows the "Mez. Jst." arrows on the PCS floor plan (${lay.joists === 'y' ? 'across the width' : 'along the length'}). The other direction would use ${n(alt)} beams spanning ${PCS.fmtFtIn(alt.beamSpan)} — switch it on the Plan page if that is what will be quoted.` });
    }
    lay.beams.forEach(b => { b.tribOwn = b.trib; });
    readColumnSymbols(lay, bl.planCols, grid, warn);
    lay.snaps.forEach(sn => warn.push({ level: 'key', text: `Mezzanine edge at ${sn.axis === 'y' ? 'FSW' : 'LEW'} ${PCS.fmtFtIn(sn.edge)} is framed on the grid line at ${PCS.fmtFtIn(sn.line)} — the slab ${(sn.axis === 'y' ? (sn.edge < sn.line) === (sn.edge === mz.startFSW) : (sn.edge < sn.line) === (sn.edge === mz.startLEW)) ? 'overhangs it' : 'stops short of it'} by ${PCS.fmtFtIn(Math.abs(sn.line - sn.edge))}.` }));
    // grid lines that only some frames share (interior frame columns off the endwall grid) can put beam lines close together
    const tight = lay.beamLines.slice(1).map((v, i) => [lay.beamLines[i], v]).filter(([a, b]) => b - a < 12 - 1e-6);
    if (tight.length && !(s.xLines || s.yLines)) warn.push({ level: 'key', text: `Beam lines ${tight.map(([a, b]) => `${PCS.fmtFtIn(a)} / ${PCS.fmtFtIn(b)}`).join(', ')} are under 12'-0" apart — joists span only ${PCS.fmtFtIn(Math.min(...tight.map(([a, b]) => b - a)))} there. Drop a line on the Plan page if the joists should span past it.` });

    const maxDepthByC = Cq != null && A != null ? Math.floor((A - Cq) * 12 - slabIn - seatIn + 1e-6) : null;
    const beamBase = { dead: deadUsed, coll, live, joistWt, Lb: spacing, edition: ed.beamEd };
    const bkey = [inp.mezz.building || '', bl.width, bl.length, (bl.bays || []).join(',')].join('|');
    return { index, inp, s, warn, ed, division, A, slabIn, seatIn, Bq, Cq, joistDepthIn, grid, mz, lay, maxDepthByC, beamBase, bkey, id: inp.mezz.id || `Mezzanine ${index + 1}` };
  }

  /* The floor plan decides frame vs mezzanine column where it disagrees with the building data (Box 2 / Box 5):
     ⊗ or a circled I is a mezzanine column; a bare I, or ✱ ("Most Economical" interior frame column), is a building
     column whose beam reactions go to the frame design. Every support also keeps the symbol drawn at it. */
  const MEZZ_SYM = { x: '⊗', i: 'circled I' };
  function readColumnSymbols(lay, planCols, grid, warn) {
    if (!planCols || !planCols.length) return;
    // a wall column's I is drawn about 1'-9" inside the steel line: it stands on the wall line
    const W = grid.width, Lg = grid.length, wall = (v, ends) => { const e = ends.find(u => Math.abs(v - u) < 2.6); return e == null ? v : e; };
    const syms = planCols.map(c => (c.kind === 'I' ? { ...c, x: wall(c.x, [0, Lg]), y: wall(c.y, [0, W]) } : c));
    const symAt = sp => syms.map(c => ({ c, d: Math.hypot(c.x - sp.x, c.y - sp.y) })).filter(o => o.d <= 1.25).sort((a, b) => a.d - b.d)[0];
    const flips = [];
    [lay, lay.alt].filter(Boolean).forEach((L, li) => {
      L.supports.forEach(sp => {
        const o = symAt(sp);
        if (!o) return;
        sp.planKind = o.c.kind;
        const mezzSym = !!MEZZ_SYM[o.c.kind];
        if (mezzSym !== sp.building) return;   // the drawing agrees with the building data
        // along a wall the building data is firm, and opening marks there can pass for an I: only ⊗ / ✱, or an I
        // standing inside the building, can change a support's class
        const onWall = Math.abs(sp.y) < 0.01 || Math.abs(sp.y - W) < 0.01 || Math.abs(sp.x) < 0.01 || Math.abs(sp.x - Lg) < 0.01;
        if (o.c.kind === 'I' && onWall) return;
        sp.building = !mezzSym; sp.fromPlan = o.c.kind;
        if (li === 0) flips.push(sp);
      });
      L.mezzCols = L.supports.filter(sp => !sp.building);
    });
    flips.forEach(sp => warn.push({ level: 'warn', text: sp.building
      ? `${sp.label}: the PCS floor plan shows a frame column there (${sp.planKind === 'star' ? '✱ — "Most Economical" interior frame column' : 'I'}), not a mezzanine column — taken as a building column; its beam reactions go to the frame design. Box 2 / Box 5 did not list it: confirm the frame data.`
      : `${sp.label}: the PCS floor plan shows a mezzanine column there (${MEZZ_SYM[sp.planKind]}), where the building data (Box 2 / Box 5) has a frame column — designed as a mezzanine column. Confirm the frame data.` }));
  }

  /* Uniform trib that gives a beam the same maximum moment and the same largest end shear as its own trib
     plus partial loads from a neighbouring mezzanine (s..e from the beam start). Rounded up to the inch, so
     the beam sheet (uniform load only) stays conservative. */
  function equivTrib(L, base, extras) {
    const parts = [[0, L, base], ...extras.map(x => [Math.max(0, x.s), Math.min(L, x.e), x.trib])].filter(([a, b, w]) => b > a + 1e-9 && w);
    if (extras.every(x => x.s <= 1e-6 && x.e >= L - 1e-6)) return base + extras.reduce((a, x) => a + x.trib, 0);
    const tot = parts.reduce((a, [p, q, w]) => a + w * (q - p), 0);
    const Rr = parts.reduce((a, [p, q, w]) => a + w * (q - p) * (p + q) / 2, 0) / L, Rl = tot - Rr;
    const M = x => Rl * x - parts.reduce((a, [p, q, w]) => { const e = Math.min(q, x); return e > p ? a + w * (e - p) * (x - (p + e) / 2) : a; }, 0);
    const xs = [...Array(401).keys()].map(i => L * i / 400).concat(parts.flatMap(([p, q]) => [p, q]));
    const Mmax = Math.max(...xs.map(M));
    const t = Math.max(base, 8 * Mmax / (L * L), 2 * Math.max(Rl, Rr) / L);
    return Math.ceil(t * 12 - 1e-6) / 12;
  }

  /* Mezzanines side by side in one building: a beam that lands on another mezzanine's beam line is the same
     member. The mezzanine with more beam length on that line keeps it; the other's trib (its edge joists)
     is added to it, and that beam drops out of the other's count. */
  function mergeBeams(ctxs) {
    const merges = [];
    const ov = (a, b) => Math.min(a.to, b.to) - Math.max(a.from, b.from);
    const qD = c => c.beamBase.dead + c.beamBase.coll + c.beamBase.joistWt, qL = c => c.beamBase.live;
    for (let i = 0; i < ctxs.length; i++) for (let j = i + 1; j < ctxs.length; j++) {
      const ci = ctxs[i], cj = ctxs[j];
      if (ci.incomplete || cj.incomplete || ci.bkey !== cj.bkey) continue;
      const lines = new Set(ci.lay.beams.map(b => b.dir + ':' + b.line.toFixed(2)));
      lines.forEach(key => {
        const on = c => c.lay.beams.filter(b => !b.absorbed && b.dir + ':' + b.line.toFixed(2) === key);
        const bi = on(ci), bj = on(cj);
        if (!bj.length || !bi.some(a => bj.some(b => ov(a, b) > 0.25))) return;
        const ext = bs => bs.reduce((a, b) => a + b.span, 0);
        const [own, oc, sub, sc] = ext(bi) >= ext(bj) - 1e-6 ? [bi, ci, bj, cj] : [bj, cj, bi, ci];
        sub.forEach(b => {
          const cover = own.filter(o => ov(o, b) > 1e-6);
          if (cover.reduce((a, o) => a + ov(o, b), 0) < b.span - 0.05) {
            if (cover.length) [oc, sc].forEach(c => c.warn.push({ level: 'warn', text: `Beams of ${oc.id} and ${sc.id} overlap on the line at ${PCS.fmtFtIn(b.line)} with different supports — frame that line by hand.` }));
            return;
          }
          const ratio = Math.max(qD(oc) ? qD(sc) / qD(oc) : 1, qL(oc) ? qL(sc) / qL(oc) : 1);
          b.absorbed = { mi: oc.index, mezz: oc.id, into: cover.map(o => o.id) };
          cover.forEach(o => { (o.extra = o.extra || []).push({ mi: sc.index, mezz: sc.id, beam: b.id, tribOwn: b.tribOwn, trib: b.tribOwn * ratio, ratio, s: Math.max(o.from, b.from) - o.from, e: Math.min(o.to, b.to) - o.from }); });
          merges.push({ line: b.line, dir: b.dir, from: b.from, to: b.to, owner: oc.index, ownerId: oc.id, sub: sc.index, subId: sc.id, trib: b.tribOwn, ratio, into: cover.map(o => o.id) });
        });
      });
    }
    ctxs.forEach(c => { if (c.incomplete) return; c.lay.beams.forEach(o => { if (o.extra) o.trib = Math.round(equivTrib(o.span, o.tribOwn, o.extra) * 1000) / 1000; }); });
    // notes on both sides of every merge
    merges.forEach(m => {
      const oc = ctxs[m.owner], sc = ctxs[m.sub], lab = c => (m.dir === 'x' ? c.grid.yLabel(m.line) : c.grid.xLabel(m.line)) || PCS.fmtFtIn(m.line);
      const fl = c => v => (m.dir === 'x' ? c.grid.xLabel(v) : c.grid.yLabel(v)) || PCS.fmtFtIn(v);
      sc.warn.push({ level: 'key', text: `Edge beam on line ${lab(sc)} (${fl(sc)(m.from)} → ${fl(sc)(m.to)}) is the ${m.ownerId} beam on the same line — its ${PCS.fmtFtIn(m.trib)} trib is carried there, not counted here.` });
    });
    ctxs.forEach(c => {
      if (c.incomplete) return;
      c.lay.beams.filter(o => o.extra).forEach(o => {
        const lab = (c.lay.joists === 'y' ? c.grid.yLabel(o.line) : c.grid.xLabel(o.line)) || PCS.fmtFtIn(o.line), fl = c.lay.joists === 'y' ? c.grid.xLabel : c.grid.yLabel;
        const parts = o.extra.map(x => `${x.mezz} ${PCS.fmtFtIn(x.tribOwn)}${x.ratio > 1 + 1e-9 ? ` × ${x.ratio.toFixed(2)} (heavier loads)` : ''} over ${PCS.fmtFtIn(x.e - x.s)}${x.e - x.s < o.span - 0.05 ? ` of ${PCS.fmtFtIn(o.span)}` : ''}`).join(' + ');
        c.warn.push({ level: 'key', text: `Beam on line ${lab} (${fl(o.from) || PCS.fmtFtIn(o.from)} → ${fl(o.to) || PCS.fmtFtIn(o.to)}) also carries ${parts}: trib ${PCS.fmtFtIn(o.tribOwn)} → ${PCS.fmtFtIn(o.trib)}${o.extra.some(x => x.e - x.s < o.span - 0.05) ? ' (uniform trib with the same max moment and end shear)' : ''}.` });
      });
    });
    return merges;
  }

  /* ---------- beam marks over the whole job ----------
     Beams under the same floor loads (dead, collateral, live, joist weight, joist spacing, sheet edition) are
     marked together, across mezzanines.
     'intext' (default): an exterior beam sits on an edge beam line with joists on one side only; the largest such
     trib is the exterior design trib. Every beam carrying more than that — interior lines, and edge beams that also
     take a neighbour's joists — is interior, designed for the largest interior trib.
     Each mark is designed at its longest span and largest trib; shorter beams in it keep the section and get their
     own MB-sheet run at their member length. */
  function jobMarks(ctxs) {
    const live = ctxs.filter(c => !c.incomplete && c.ed.beamEd);
    const keyOf = c => [c.beamBase.dead, c.beamBase.coll, c.beamBase.live, c.beamBase.joistWt, c.beamBase.Lb, c.ed.beamEd, c.division].join('|');
    const groups = [];
    live.forEach(c => { const k = keyOf(c); let g = groups.find(x => x.key === k); if (!g) groups.push(g = { key: k, ctxs: [] }); g.ctxs.push(c); });
    const marks = [];
    groups.forEach(g => {
      const bs = g.ctxs.flatMap(c => c.lay.beams.filter(b => !b.absorbed).map(b => ({ mi: c.index, id: b.id, span: b.span, trib: b.trib, line: b.line, edgeOnly: !!(b.edge && !b.extra) })));
      if (!bs.length) return;
      const mode = g.ctxs[0].s.marks;
      let sets;
      if (mode === 'intext') {
        const ext = bs.filter(x => x.edgeOnly), extMax = ext.length ? Math.max(...ext.map(x => x.trib)) : -Infinity;
        sets = [[bs.filter(x => x.trib > extMax + 1e-6), 'interior'], [bs.filter(x => x.trib <= extMax + 1e-6), 'exterior']].filter(([xs]) => xs.length);
        if (sets.length === 1) sets[0][1] = '';
      } else if (mode === 'split') {
        sets = LAYOUT.beamMarks(bs.map((x, i) => ({ id: i, span: x.span, trib: x.trib })), 'split').map(m => [m.beams.map(u => bs[u]), '']);
      } else sets = [[bs, '']];
      sets.forEach(([xs, kind]) => marks.push({ group: g, groupKey: g.key, kind, beamsAll: xs, span: Math.max(...xs.map(x => x.span)), trib: Math.max(...xs.map(x => x.trib)) }));
    });
    marks.sort((a, b) => b.span * b.trib - a.span * a.trib || (a.kind === 'interior' ? -1 : 1));
    marks.forEach((m, i) => { m.mark = 'MB' + (i + 1); m.index = i; m.qtyAll = m.beamsAll.length; m.mezzIds = [...new Set(m.beamsAll.map(x => x.mi))]; });
    return marks;
  }

  /* one mark: section search → three options → the pick (stored as intent) → MB-sheet runs at every span in it */
  function designMark(m) {
    const members = m.group.ctxs.filter(c => m.mezzIds.includes(c.index)), c0 = members[0], s = c0.s, ed = c0.ed;
    const say = (level, text) => members.forEach(c => c.warn.push({ level, text }));
    const caps = members.map(c => c.maxDepthByC).filter(v => v != null), maxDepth = caps.length ? Math.min(...caps) : null;
    const jd = members.map(c => c.joistDepthIn).filter(v => v != null), dLimit = jd.length ? Math.floor(Math.min(...jd) + 1e-6) : null;
    const p = { ...c0.beamBase, L: m.span, trib: m.trib };
    const dz = DESIGN.designBeam(p, { division: c0.division, target: s.target, dMin: s.dMin, dMax: s.dMax, symmetric: s.symmetric, requireConc: s.requireConc, maxDepth: maxDepth ?? undefined });
    const options = dz ? DESIGN.beamOptions(dz, { dLimit, span: m.span }) : [];
    // a pick is stored as intent — an option key or a depth — so every input change re-runs the search:
    //   { key: 'fit' } → that option for the current loads; { d: 20 } → lightest passing section at 20";
    //   { sec } → that exact section (checked, flagged if it fails)
    const ov = s.override && s.override[m.mark];
    const preferred = options.find(o => o.key === ((ov && ov.key) || s.optionDefault));
    const atDepth = ov && ov.d != null && dz ? dz.byDepth.find(z => z.d === +ov.d && !z.none) : null;
    const chosen = ov && ov.sec ? ov.sec : atDepth ? atDepth.sec : preferred ? preferred.pick.sec : dz && dz.best ? dz.best.sec : null;
    if (ov && ov.d != null && !atDepth && chosen) say('warn', `${m.mark}: nothing passes at ${ov.d}" deep for these loads — back to the ${preferred ? preferred.label.toLowerCase() : 'lightest'} section.`);
    if (ov && ov.key && !options.some(o => o.key === ov.key) && chosen) say('info', `${m.mark}: no ${ov.key} option for these inputs — using the lightest.`);
    const check = chosen ? MZ.beamCheck({ ...p, sec: chosen }, WF) : null;
    const same = (a, b) => a && b && ['d', 'tw', 'bof', 'tof', 'bif', 'tif'].every(k => a[k] === b[k]);
    const optionKey = (options.find(o => same(o.pick.sec, chosen)) || {}).key || (chosen ? 'custom' : null);
    if (check && ov && ov.sec) {
      const okB = check.res.CSR <= s.target && check.res.SRvx <= s.target && check.llOK && check.tlOK && (!check.conc || check.conc.ok);
      if (!okB) say('stop', `${m.mark}: the pinned ${check.desc} no longer passes (combined ${check.res.CSR.toFixed(3)}, shear ${check.res.SRvx.toFixed(3)}, L/${Math.round(check.defl.rLL)}) — pick an option again.`);
    }
    if (!chosen) {
      const cap = maxDepth != null && maxDepth < s.dMax;
      say('stop', cap && maxDepth < s.dMin
        ? `${m.mark}: clearance (C) under the floor beams leaves only ${maxDepth}" of beam depth (A − C − slab − seat) — below the ${s.dMin}" minimum. Check the clearance or the minimum depth in Settings.`
        : `${m.mark}: no stocked BU section between ${s.dMin}" and ${Math.min(s.dMax, maxDepth ?? Infinity)}" deep${cap ? ' (capped by clearance C)' : ''} meets SR ≤ ${s.target}, L/360 and L/240. Widen the depth range.`);
    }
    // every member length in the mark: the governing run plus the shorter beams (same section, own MB-sheet run)
    const spans = [];   // distinct member lengths, kept exact (12'-4" = 12.3333 ft, not 12.333)
    m.beamsAll.forEach(x => { if (!spans.some(L => Math.abs(L - x.span) < 1e-3)) spans.push(x.span); });
    spans.sort((a, b) => b - a);
    const spanRuns = chosen ? spans.map(L => {
      const qty = m.beamsAll.filter(x => Math.abs(x.span - L) < 1e-3).length;
      const ck = Math.abs(L - m.span) < 1e-3 ? check : MZ.beamCheck({ ...p, L, sec: chosen }, WF);
      return { span: L, qty, check: ck, params: { ...p, L } };
    }) : [];
    spanRuns.filter(r => r.check !== check).forEach(r => {
      const c = r.check, ok = c.res.CSR <= s.target && c.res.SRvx <= s.target && c.llOK && c.tlOK;
      say(ok ? 'key' : 'stop', `${m.mark} also has ${r.qty} beam${r.qty > 1 ? 's' : ''} at ${PCS.fmtFtIn(r.span)} — same ${check.desc}; MB sheet at member length ${PCS.fmtFtIn(r.span)}: combined ${c.res.CSR.toFixed(2)}, shear ${c.res.SRvx.toFixed(2)}, L/${Math.round(c.defl.rLL)}.`);
    });
    Object.assign(m, { params: p, search: dz, options, optionKey, pinned: ov || null, sec: chosen, check, desc: check ? check.desc : null, spanRuns, maxDepth, dLimit });
    return m;
  }

  /* this mezzanine's view of the job marks: only its beams and its count; the section, checks and options are shared */
  function attachMarks(c, marks) {
    const { s, warn, maxDepthByC, joistDepthIn, Cq } = c;
    const designed = marks.filter(m => m.mezzIds.includes(c.index)).map(m => {
      const mine = m.beamsAll.filter(x => x.mi === c.index);
      const { group, ...rest } = m;
      return { ...rest, beams: mine.map(x => x.id), qty: mine.length };
    });
    if (c.inp.geom.C && c.inp.geom.C.source === 'none') warn.push({ level: 'key', text: 'No minimum clearance under the support beams (entered as no requirement) — beam depth is limited only by the depth range in Settings.' });
    if (maxDepthByC != null && maxDepthByC < s.dMax && maxDepthByC >= s.dMin) warn.push({ level: 'key', text: `Clearance (C) ${PCS.fmtFtIn(Cq)} caps the beam depth at ${maxDepthByC}".` });
    c.designed = designed;
    c.markOf = id => designed.find(mk => mk.beams.includes(id));
    // clearances (INPUT sheet)
    const { A, Bq, slabIn, seatIn } = c;
    const dBeam = Math.max(0, ...designed.filter(mk => mk.sec).map(mk => mk.sec.d));
    c.clear = {
      A: { req: A, prov: A },
      B: { req: Bq, prov: joistDepthIn != null && A != null ? A - (slabIn + joistDepthIn) / 12 : null },
      C: { req: Cq, prov: A != null && dBeam ? A - (slabIn + seatIn + dBeam) / 12 : null },
    };
    Object.entries(c.clear).forEach(([k, q]) => { q.ok = q.req == null || q.prov == null ? null : q.prov >= q.req - 1e-9; if (q.ok === false) warn.push({ level: 'stop', text: `Clearance ${k}: provided ${PCS.fmtFtIn(q.prov)} < requested ${PCS.fmtFtIn(q.req)}.` }); });
    c.colLen = s.colLength === 'clear' && A != null && dBeam ? A - (slabIn + seatIn + dBeam) / 12 : A;
  }

  /* ---------- columns over the whole job: one column per location, every beam that frames in ---------- */
  function jobColumns(ctxs) {
    const at = new Map();
    ctxs.forEach(c => {
      if (c.incomplete) return;
      c.lay.supports.forEach(sp => {
        const key = c.bkey + '|' + sp.x.toFixed(2) + ',' + sp.y.toFixed(2);
        const e = at.get(key) || { key, x: sp.x, y: sp.y, building: sp.building, label: sp.label, planKind: sp.planKind || null, ends: [], seenIn: [] };
        e.seenIn.push(c.index);
        ['L', 'R'].forEach(side => {
          const id = sp.beams[side];
          if (id == null || c.lay.beams[id].absorbed) return;
          e.ends.push({ mi: c.index, id, side, dir: c.lay.beams[id].dir });
        });
        at.set(key, e);
      });
    });
    const reaction = (c, id) => {
      const bm = c.lay.beams[id], mk = c.markOf(id);
      if (!mk || !mk.sec) return { D: NaN, L: NaN };
      const r = DESIGN.reactions({ ...c.beamBase, L: bm.span, trib: bm.trib }, mk.sec);
      return { D: r.D, L: r.L, mark: mk.mark };
    };
    const cols = [], frame = [];
    at.forEach(e => {
      if (e.building && e.ends.length) {
        // mezzanine beam reactions at a building column: the loads the frame / endwall design has to take
        const parts = e.ends.map(en => { const c = ctxs[en.mi], r = reaction(c, en.id); return { mi: en.mi, mezz: c.id, beam: 'B' + (en.id + 1), mark: r.mark, D: r.D, L: r.L }; });
        frame.push({ label: e.label, x: e.x, y: e.y, planKind: e.planKind, D: parts.reduce((a, p) => a + p.D, 0), L: parts.reduce((a, p) => a + p.L, 0), parts, seenIn: e.seenIn });
        return;
      }
      if (e.building || !e.ends.length) return;
      const parts = e.ends.map(en => { const c = ctxs[en.mi], r = reaction(c, en.id), bm = c.lay.beams[en.id]; return { ...en, mezz: c.id, D: r.D, L: r.L, mark: r.mark, beam: 'B' + (en.id + 1), area: (bm.tribOwn * bm.span + (bm.extra || []).reduce((a, x) => a + x.tribOwn * (x.e - x.s), 0)) / 2 }; });
      const sum = ps => ({ D: ps.reduce((a, p) => a + p.D, 0), L: ps.reduce((a, p) => a + p.L, 0) });
      const dirs = ['x', 'y'].filter(d => parts.some(p => p.dir === d));
      const tot = d => { const q = sum(parts.filter(p => p.dir === d)); return q.D + q.L; };
      const prim = dirs.length > 1 ? (tot('x') >= tot('y') ? 'x' : 'y') : dirs[0];
      let Ls = sum(parts.filter(p => p.dir === prim && p.side === 'L')), Rs = sum(parts.filter(p => p.dir === prim && p.side === 'R'));
      const sideOf = p => (p.dir !== prim ? null : p.side);
      // normalise so the heavier side is "left" (the three workbook combinations are symmetric)
      let flip = Ls.D + Ls.L < Rs.D + Rs.L;
      if (flip) [Ls, Rs] = [Rs, Ls];
      // beams from the other direction too: put them on the heavier side (conservative for the sheet's e = d/2 moment)
      const other = sum(parts.filter(p => p.dir !== prim));
      Ls = { D: Ls.D + other.D, L: Ls.L + other.L };
      parts.forEach(p => { const sd = sideOf(p); p.sheetSide = sd == null ? 'left' : (sd === 'L') !== flip ? 'left' : 'right'; });
      const byMezz = {};
      parts.forEach(p => { byMezz[p.mi] = (byMezz[p.mi] || 0) + p.D + p.L; });
      const owner = +Object.entries(byMezz).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      const mezzes = [...new Set(parts.map(p => p.mi))];
      const len = Math.max(...mezzes.map(mi => ctxs[mi].colLen || 0));
      cols.push({ label: e.label, x: e.x, y: e.y, DL_L: Ls.D, LL_L: Ls.L, DL_R: Rs.D, LL_R: Rs.L, sides: (parts.some(p => p.sheetSide === 'left') ? 1 : 0) + (parts.some(p => p.sheetSide === 'right') ? 1 : 0),
        tribArea: Math.round(parts.reduce((a, p) => a + p.area, 0) * 10) / 10, owner, mezzes, shared: mezzes.length > 1, mixed: dirs.length > 1, parts, len, seenIn: e.seenIn });
    });
    cols.frame = frame;
    return cols;
  }

  /* ---------- columns of one mezzanine (the ones it owns) → groups → one W on the quote ---------- */
  function designColumns(c, cols, jobName) {
    const { s, warn, ed, division } = c;
    const colLen = cols.length ? Math.max(...cols.map(q => q.len || 0)) || c.colLen : c.colLen;
    cols.filter(q => q.shared).forEach(q => warn.push({ level: 'key', text: `Column ${q.label} is shared: ${q.parts.map(p => `${p.mezz} ${p.beam} (${p.sheetSide})`).join(' + ')} frame into it. Its Column-sheet input uses both reactions, and it is counted once, here.` }));
    cols.filter(q => q.mixed).forEach(q => warn.push({ level: 'warn', text: `Column ${q.label} has beams from both directions — the cross beams' reactions are put on the heavier side for the sheet's e = d/2 moment. Check biaxial bending by hand.` }));
    if (cols.some(q => q.mezzes.some(mi => mi !== c.index) && q.len !== c.colLen)) warn.push({ level: 'warn', text: `Shared columns run to the higher of the two mezzanines (${PCS.fmtFtIn(colLen)}).` });
    const key = q => [q.DL_L, q.LL_L, q.DL_R, q.LL_R].map(x => x.toFixed(2)).join('|');
    const groups = [];
    cols.forEach(q => { const g = groups.find(g2 => g2.key === key(q)); g ? g.cols.push(q) : groups.push({ key: key(q), cols: [q], loads: { DL_L: q.DL_L, LL_L: q.LL_L, DL_R: q.DL_R, LL_R: q.LL_R } }); });
    const noBeam = cols.some(q => ![q.DL_L, q.LL_L, q.DL_R, q.LL_R].every(isFinite));   // a beam framing in has no section yet
    groups.forEach(g => { g.design = ed.colEd && colLen && !noBeam ? DESIGN.designColumn(g.loads, { L: colLen, includeW818: s.includeW818, edition: ed.colEd }, WF) : null; });
    // one section for every mezzanine column on the quote: the lightest W (same try order) that passes every group
    const allOK = groups.length && groups.every(g => g.design && g.design.name);
    const env = allOK && groups.length > 1 ? DESIGN.designColumn(groups.map(g => g.loads), { L: colLen, includeW818: s.includeW818, edition: ed.colEd }, WF) : null;
    const govCol = allOK ? (env ? (env.name ? { design: env } : null) : groups[0]) : null;
    let colFinal = null;
    if (govCol) {
      const name = s.colOverride || jobName || govCol.design.name;
      const checks = groups.map(g => MZ.columnCheck({ sec: { type: 'WF', name }, Fy: 50, Fu: 65, L: colLen, Lby: colLen * 12, ...g.loads, edition: ed.colEd }, WF));
      const [, dn, wt] = name.match(/^W(\d+)X([\d.]+)/);
      colFinal = { name, quoteAs: DESIGN.COMMON_COLUMNS.includes(name) || name === 'W8X18' ? name : 'BU' + dn + 'x' + wt, checks, max: Math.max(...checks.map(q => q.max)), ok: checks.every(q => q.ok) };
      if (!colFinal.ok) warn.push({ level: 'stop', text: `${name} fails on the Column sheet (max CSR ${colFinal.max.toFixed(3)})${s.colOverride ? ' — the column pick on the Column page overrides the automatic W' : ''}.` });
      if (!DESIGN.inStock(DESIGN.WF_STOCK, name, division)) warn.push({ level: 'info', text: `${name} is not a stocked W at ${division}.` });
    }
    if (cols.length && !colLen) warn.push({ level: 'stop', text: 'Column length unknown — enter the top of mezzanine (A) to size the columns.' });
    else if (cols.length && noBeam) warn.push({ level: 'stop', text: 'Columns not sized — the beams framing into them have no section yet.' });
    else if (cols.length && !govCol) warn.push({ level: 'stop', text: 'No W8–W14 column passes — check the loads or design a BU column.' });
    return { colLen, groups, colFinal };
  }

  function finish(c, owned, foreign, merges, jobName) {
    const { s, warn, ed, division, grid, lay, designed } = c;
    const { colLen, groups, colFinal } = designColumns(c, owned, jobName);
    foreign.forEach(q => warn.push({ level: 'key', text: `Column ${q.label} under this mezzanine is counted with ${q.ownerId} (${q.parts.map(p => `${p.mezz} ${p.beam}`).join(' + ')}).` }));
    // this mezzanine's supports as the job sees them: owned columns, other mezzanines' columns, building columns
    const keep = sp => sp.building ? ['L', 'R'].some(k => sp.beams[k] != null && !lay.beams[sp.beams[k]].absorbed) : owned.some(q => near2(q, sp)) || foreign.some(q => near2(q, sp));
    const layout = { ...lay, supports: lay.supports.filter(keep), mezzCols: owned.map(q => ({ ...(lay.supports.find(sp => near2(q, sp)) || { x: q.x, y: q.y, beams: { L: null, R: null } }), label: q.label, building: false })) };
    const quote = {
      beams: designed.map(mk => ({ mark: mk.mark, section: mk.desc, span: mk.span, trib: mk.trib, qty: mk.qty })),
      columns: colFinal ? [{ mark: 'MC1', section: colFinal.quoteAs, length: colLen, qty: owned.length }] : [],
    };
    return { settings: s, edition: ed, division, warn, grid, layout, marks: designed, clear: c.clear, joistDepthIn: c.joistDepthIn, maxDepthByC: c.maxDepthByC, colLen, columns: owned, colGroups: groups, colFinal, foreignCols: foreign, merges: merges.filter(m => m.owner === c.index || m.sub === c.index), quote, beamBase: c.beamBase, id: c.id, index: c.index };
  }
  const near2 = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;

  /* ---------- NBG DM 15.1 Mezzanine Systems: every item of the manual this job touches, checked or called out ----------
     status  ok    met — read from the design numbers
             check needs a decision, or extra material on the quote (also listed in the notes)
             stop  fails (also listed in the notes)
             note  a callout for detailing / the D2D sheet
             info  scope and standard practice
     mi is the mezzanine an item belongs to (null: the whole job). */
  function dmChecklist(ctxs, mezz, marks, cols) {
    const F = PCS.fmtFtIn, out = [];
    const live = ctxs.filter(c => !c.incomplete), many = live.length > 1;
    if (!live.length) return out;
    const add = (ref, group, title, status, text, mi = null, opt = {}) => out.push({ ref, group, title, status, text, mi, ...opt });
    const tag = c => (many ? c.id + ': ' : '');
    const n3 = v => +(+v).toFixed(3), plates = v => { const n = Math.round(v * 16), g = (a, b) => (b ? g(b, a % b) : a), w = Math.floor(n / 16), r = n % 16; return Math.abs(v * 16 - n) > 0.02 ? String(n3(v)) : r ? `${w ? w + ' ' : ''}${r / g(r, 16)}/${16 / g(r, 16)}` : String(w); };
    const idOf = i => (ctxs[i] ? ctxs[i].id : '');
    // edges two mezzanines share at one floor level (one slab across): from the framed footprints
    const shared = [];
    live.forEach((a, i) => live.slice(i + 1).forEach(b => {
      if (a.bkey !== b.bkey || Math.abs((a.A || 0) - (b.A || 0)) > 0.01) return;
      const fa = a.lay.footprint, fb = b.lay.footprint, ov = (p0, p1, q0, q1) => [Math.max(p0, q0), Math.min(p1, q1)];
      [[fa.y1, fb.y0], [fa.y0, fb.y1]].forEach(([u, v2]) => { const [s0, s1] = ov(fa.x0, fa.x1, fb.x0, fb.x1); if (Math.abs(u - v2) < 0.6 && s1 - s0 > 1) shared.push({ a: a.index, b: b.index, axis: 'y', at: u, from: s0, to: s1 }); });
      [[fa.x1, fb.x0], [fa.x0, fb.x1]].forEach(([u, v2]) => { const [s0, s1] = ov(fa.y0, fa.y1, fb.y0, fb.y1); if (Math.abs(u - v2) < 0.6 && s1 - s0 > 1) shared.push({ a: a.index, b: b.index, axis: 'x', at: u, from: s0, to: s1 }); });
    }));

    // ---- layout (15.1.1.3, 15.1.1.4)
    live.forEach(c => {
      const L = c.lay, alt = L.alt, sp = c.beamBase.Lb, shorter = !alt || alt.beamSpan >= L.beamSpan - 1e-6;
      add('15.1.1.3', 'Layout', 'Beams on the shorter span, joists the longer', shorter ? 'ok' : 'info',
        `${tag(c)}beams span ${F(L.beamSpan)}, joists ${F(L.joistSpan)}${/arrows/.test(L.why || '') ? ', as the "Mez. Jst." arrows on the PCS show' : ''}${shorter ? '.' : ` — the other direction would put the beams on ${F(alt.beamSpan)}; the drawing governs, confirm it was intended.`}`, c.index);
      add('15.1.1.3', 'Layout', 'Joists no more than 5\'-0" on center', sp <= 5 + 1e-9 ? 'ok' : 'stop', `${tag(c)}joists @ ${F(sp)} O.C.${sp <= 5 + 1e-9 ? '' : ' — NBG will not space joists more than 5\'-0" apart.'}`, c.index);
    });
    if (shared.length) {
      const clash = shared.filter(e => ctxs[e.a].lay.joists !== ctxs[e.b].lay.joists);
      add('15.1.1.4', 'Layout', 'One joist direction across a floor level', clash.length ? 'check' : 'ok', clash.length
        ? clash.map(e => `${idOf(e.a)} and ${idOf(e.b)} meet at ${F(e.at)} with their joists running different ways`).join('; ') + ' — the camber of one set holds the deck off the other and off the beam. Keep one direction, or confirm with Engineering Leadership.'
        : `${[...new Set(shared.flatMap(e => [idOf(e.a), idOf(e.b)]))].join(' and ')} meet at one level with their joists running the same way, so no joists run parallel to a beam close by.`);
    }
    const lv = [...new Set(live.map(c => c.beamBase.live))];
    add('15.1.1.4 (4)', 'Layout', 'No live load reduction', 'ok', `${lv.join(' / ')} psf live used unreduced on every beam and column${live.some(c => val(c.inp.loads.partition) > 0 && c.s.partitionTo === 'live') ? ' (partition included)' : ''}.`);
    live.forEach(c => {
      const r = mezz[c.index], cl = r && r.clear;
      if (!cl) return;
      const bad = ['A', 'B', 'C'].filter(k => cl[k].ok === false);
      add('15.1.1', 'Layout', 'Finish floor and clear heights defined', bad.length ? 'stop' : 'ok', `${tag(c)}A ${F(c.A)} · B ${c.Bq != null ? F(c.Bq) : '—'} · C ${c.inp.geom.C && c.inp.geom.C.source === 'none' ? 'no requirement' : c.Cq != null ? F(c.Cq) : '—'}${bad.length ? ` — clearance ${bad.join(', ')} not met` : ', each one met'}.`, c.index, { mirror: false });
    });

    // ---- beams (15.1.1.4.1)
    const ms = marks.filter(mk => mk.sec && mk.check);
    if (ms.length) {
      const runs = mk => (mk.spanRuns && mk.spanRuns.length ? mk.spanRuns : [{ span: mk.span, check: mk.check }]);
      const lo = (mk, k) => Math.min(...runs(mk).map(q => q.check.defl[k]));
      add('15.1.1.4.1.1', 'Beams', 'Deflection L/360 live, L/240 total', ms.every(mk => runs(mk).every(q => q.check.llOK && q.check.tlOK)) ? 'ok' : 'stop',
        ms.map(mk => `${mk.mark} L/${Math.round(lo(mk, 'rLL'))} live · L/${Math.round(lo(mk, 'rTL'))} total`).join(' · ') + ' (MB sheet K11 / K15).');
      add('15.1.1.4.1.2', 'Beams', 'Flange at least 5½" wide (2½" joist seat bearing)', ms.every(mk => mk.sec.bof >= 5.5 - 1e-9) ? 'ok' : 'stop', ms.map(mk => `${mk.mark} ${plates(mk.sec.bof)}"`).join(' · ') + ' top flange.');
      const conc = ms.every(mk => mk.check.conc);
      const jb = mk => Math.max(mk.check.conc.WLY, mk.check.conc.WC, mk.check.conc.WSB || 0);
      add('15.1.1.4.1.3', 'Beams', 'Top flange at least ¼" thick, no stiffeners at the joists', !ms.every(mk => mk.sec.tof >= 0.25 - 1e-9) || (conc && !ms.every(mk => mk.check.conc.ok)) ? 'stop' : conc ? 'ok' : 'check',
        ms.map(mk => `${mk.mark} ${plates(mk.sec.bof)} × ${plates(mk.sec.tof)}"${mk.check.conc ? `, joist bearing SR ${jb(mk).toFixed(2)}` : ''}`).join(' · ') + (conc ? ' (web local yielding, crippling and sidesway under the joist reaction, J10 — Concentrated Load Checks).' : ' — the 13th-edition sheet has no joist-bearing check: check J10 by hand.'));
      add('15.1.1.4.1.4', 'Beams', 'Web without intermediate stiffeners', ms.every(mk => runs(mk).every(q => q.check.res.SRvx <= 1)) ? 'ok' : 'stop',
        ms.map(mk => `${mk.mark} web ${plates(mk.sec.tw)}", shear SR ${Math.max(...runs(mk).map(q => q.check.res.SRvx)).toFixed(2)}`).join(' · ') + ' — unstiffened web shear on the MB sheet (G2).');
      // perimeter beams: joists from one side only (DM 15.1.1.4.1.3 user note)
      const per = ms.map(mk => ({ mk, bs: (mk.beamsAll || []).filter(x => x.edgeOnly) })).filter(x => x.bs.length);
      if (per.length) {
        const R = per.map(({ mk, bs }) => { const c = ctxs[bs[0].mi], b = c.beamBase, w = b.dead + b.coll + b.joistWt + b.live; return Math.max(...bs.map(x => w * b.Lb * ctxs[x.mi].lay.beams[x.id].tribOwn / 1000)); });
        add('15.1.1.4.1.3', 'Beams', 'Perimeter beams: joists bear on one side', 'note',
          per.map(({ mk, bs }) => `${mk.mark}${mk.kind ? ' ' + mk.kind : ''} ${mk.desc} (${bs.length} edge beam${bs.length > 1 ? 's' : ''})`).join(', ') +
          `: carry the joist top-chord extensions to the edge of the beam flange, so the single-sided flange-to-web weld is not overloaded. Half the flange (${per.map(({ mk }) => plates(mk.sec.bof / 2) + '"').join(' / ')}) is more than a 2½" seat — where a seat stops short of the web, check top-flange local bending for the joist reaction, about ${Math.max(...R).toFixed(2)} k per joist (DM 9.7.11). Put it on the D2D sheet.`);
      }
      add('15.1.1.4.1.5', 'Beams', 'Axial load only when a beam is part of a bracing system', 'info', 'No mezzanine beam is part of a bracing system in this layout (MB sheet D15 axial left blank). A beam on a line that gets independent X-bracing (see Bracing) is re-run with the brace axial load, unbraced, and its end connections take that axial too.');
      add('15.1.1.4 (1)', 'Beams', 'No camber in the floor beams', 'info', 'Beams are not cambered (standard). The joists are, so no joist runs parallel to a beam close by.');
      add('15.1.1.4.2', 'Connections & columns', 'Beam end connections (Mezzanine Beam Clips)', 'note',
        `Field bolted: ¾" A325 bearing type, threads included, short horizontal slots in the framing angles; double L4×3×⅜ (A572-50) at building columns, 3" bolt pitch, two bolt rows minimum. End reaction for the clips (MB sheet shear, unfactored): ${ms.map(mk => `${mk.mark} D ${mk.check.V.D.toFixed(2)} + L ${mk.check.V.L.toFixed(2)} = ${(mk.check.V.D + mk.check.V.L).toFixed(2)} k`).join(' · ')}. Call out one bolt-row quantity for most connections (DM 15.1.1.4 item 5).`);
    }

    // ---- columns (15.1.1.4.2, 15.1.1.4.3)
    const withCols = mezz.filter(r => r && !r.incomplete && r.colFinal && r.columns.length);
    if (withCols.length) {
      const nCase = withCols.reduce((a, r) => a + r.colGroups.length, 0);
      add('15.1.1.4.2 (1E)', 'Connections & columns', 'Columns: full DL + LL both sides, and DL + LL one side with DL only on the other', withCols.every(r => r.colFinal.ok) ? 'ok' : 'stop',
        `The Column sheet's three combinations are exactly these: DLt+LLt+DRt and DLt+DRt+LRt (live on one side) and DLt+LLt+DRt+LRt (both sides) — max CSR ${Math.max(...withCols.map(r => r.colFinal.max)).toFixed(3)} over ${nCase} case${nCase > 1 ? 's' : ''}.`);
      [...new Map(withCols.map(r => [r.colFinal.name + '|' + r.colLen, r])).values()].forEach(r => {
        const name = r.colFinal.name, w = WF[name], bu = /^BU/.test(r.colFinal.quoteAs);
        if (bu) add('15.1.1.4.2 (2A)', 'Connections & columns', 'Built-up column: flange at least 8" × ¼" for beams on the flange', w.bf >= 8 && w.tf >= 0.25 ? 'ok' : 'check',
          `Quoted as ${r.colFinal.quoteAs}, sized as ${name} (flange ${w.bf}" × ${w.tf}")${w.bf >= 8 && w.tf >= 0.25 ? '.' : ' — a built-up column with beams on its flange needs an 8" × ¼" flange: build it with an 8" flange, or frame the beams onto a cap plate.'}`);
        else add('15.1.1.4.2 (2B)', 'Connections & columns', 'Hot-rolled column: flange at least 7" for beams on the flange', w.bf >= 7 ? 'ok' : 'note',
          `${name} flange ${w.bf}"${w.bf >= 7 ? '' : ' — under 7": acceptable with the standard 4" bolt gage (DM note 1); the angles may run past the flange edges'}. Beams frame to the flange, column web parallel to the beam web (the preferred orientation)${/^W8X/.test(name) ? '; no W8 has the 7" + tw "T" needed for beams on its web' : ''}.`);
        const shaft = w.W * r.colLen, all = shaft + END_WT_COL;
        add('15.1.1.4.3', 'Connections & columns', 'Posts under 300 lb (OSHA 1926)', 'note',
          `${name} × ${F(r.colLen)} = ${Math.round(shaft)} lb, ${Math.round(all)} lb with the ${END_WT_COL} lb end plates. ${all <= 300 ? 'Under 300 lb: a post, so the four-anchor-rod requirement does not apply.' : shaft <= 300 ? 'The shaft is under 300 lb but not with the plates — confirm which weight the four-anchor-rod requirement is judged on.' : 'Over 300 lb: four anchor rods (OSHA 1926.755).'}`);
      });
      const owned = cols.filter(q => mezz[q.owner] && !mezz[q.owner].incomplete), one = owned.filter(q => !q.mixed);
      if (one.length) add('15.1.1.4.3', 'Connections & columns', 'OSHA stabilizer plate where a column is braced one way', 'note',
        `${one.length === owned.length ? 'Every mezzanine column' : one.map(q => q.label).join(', ')} is braced by beams in one direction only: the joists at ${one.length === 1 ? 'it' : 'those columns'} are bolted (not field welded) with a vertical stabilizer plate — 6" × 6" min., 3" below the joist bottom chord, 13/16" holes in the lower corners (AISC Manual Part 2, Fig. 2-2). The same goes for a joist at a sidewall or endwall column the mezzanine braces.`);
    }

    // ---- deck and pour stop (15.1.1.4.5, 15.1.1.5)
    const decks = [...new Set(live.map(c => c.inp.mezz.deck || '1.0C'))];
    add('15.1.1.4.5', 'Deck & pour stop', 'Floor deck', 'info', `${decks.join(' / ')} non-composite deck per Vulcraft and SDI SD-2022, NBG standard fastening (CED AP0003), concrete diaphragm values; weld washers where the deck is lighter than 22 ga (t < 0.0280", by Vulcraft).`);
    if (live.some(c => (c.inp.mezz.provided || {})['Edge Angle / Pour Stop'])) {
      const perim = live.reduce((a, c) => a + 2 * (c.mz.length + c.mz.width), 0) - 2 * shared.reduce((a, e) => a + (e.to - e.from), 0);
      const slab = [...new Set(live.map(c => n3(c.slabIn)))];
      add('15.1.1.5', 'Deck & pour stop', 'Pour stop (edge angle) by seller', 'note',
        `Standard PST120: 3" horizontal leg, ${slab.join(' / ')}" vertical leg (= slab), 1" return at 45°, gage from the SDI pour stop table at 0" overhang, G60 galvanized from the deck supplier. About ${Math.round(perim)} ft for the slab perimeter${shared.length ? ' (where mezzanines meet at one level the slab runs through)' : ''}, plus framing around any column through the slab and around openings. It carries no vertical load, only the wet-concrete pressure on the vertical leg.`);
    }

    // ---- bracing (15.1.3)
    live.forEach(c => {
      const fp = c.lay.footprint, g = c.grid, W = g.width, L = g.length, area = c.mz.length * c.mz.width;
      const fdl = c.beamBase.dead + c.beamBase.coll, fll = c.beamBase.live, H = area * (fdl + fll) / 1000 * 0.01;
      const frames = (g.xs || []).filter(x => x > 0.5 && x < L - 0.5);
      const lab = (axis, at) => (axis === 'y' ? g.yLabel(at) : g.xLabel(at)) || F(at);
      const sides = [['y', fp.y0, fp.x0, fp.x1], ['y', fp.y1, fp.x0, fp.x1], ['x', fp.x0, fp.y0, fp.y1], ['x', fp.x1, fp.y0, fp.y1]];
      let needs = false;
      const desc = sides.map(([axis, at, s0, s1]) => {
        const sh = shared.filter(e => (e.a === c.index || e.b === c.index) && e.axis === axis && Math.abs(e.at - at) < 0.6);
        const shLen = sh.reduce((a, e) => a + (e.to - e.from), 0), rest = s1 - s0 - shLen;
        const joins = sh.length ? `joins ${sh.map(e => idOf(e.a === c.index ? e.b : e.a)).join(', ')} for ${F(shLen)}` : '';
        if (rest < 1) return `line ${lab(axis, at)}: ${joins} (one floor)`;
        let what;
        if (axis === 'y' && (Math.abs(at) < 0.6 || Math.abs(at - W) < 0.6)) what = 'sidewall — its bracing tiered at the mezzanine level';
        else if (axis === 'x' && (Math.abs(at) < 0.6 || Math.abs(at - L) < 0.6)) what = 'endwall — its bracing tiered at the mezzanine level, or a rigid end frame';
        else if (axis === 'x' && frames.some(x => Math.abs(x - at) < 0.6)) what = 'rigid frame line';
        else what = 'free — independent X-bracing';
        if (what !== 'rigid frame line') needs = true;
        return `line ${lab(axis, at)}: ${joins ? joins + ', then ' : ''}${what}`;
      });
      add('15.1.3', 'Bracing', 'Mezzanine braced on all four sides', needs ? 'check' : 'ok',
        `${tag(c)}${desc.join(' · ')}. Independent X-bracing runs from the mezzanine level to the floor between two adjacent supports and is designed for 1% of the FDL + FLL tributary to it — the whole floor is ${Math.round(area).toLocaleString('en-US')} ft² × (${n3(fdl)} + ${n3(fll)}) psf, 1% = ${H.toFixed(2)} k.`, c.index);
    });

    // ---- scope (15.1.1.2, 15.1.5)
    add('15.1.1.2', 'Scope', 'Not in the NBG scope — carry as quote qualifications', 'info', 'Floor slab design; composite floor design; stairs, handrails and miscellaneous steel; elevator shafts; floor vibration (AISC Design Guide 11); floor deck other than SDI deck (plywood, grating, checker plate); weld washers. The Engineer of Record verifies the joist spacing suits the end use (DM 15.1.1.3).');
    live.forEach(c => { if ((c.inp.mezz.provided || {})['Designed For Load Provisions Only']) add('15.1.1', 'Scope', 'Designed for load provisions only', 'stop', `${tag(c)}NBG supplies no mezzanine beams or columns — the connection hole patterns must be known at order entry, otherwise field drilled or field welded.`, c.index, { mirror: false }); });
    const eco = live.find(c => c.inp.mezz.ecospan);
    if (eco) {
      const thin = live.filter(c => c.slabIn < 3.5 - 1e-9), long = live.filter(c => c.lay.joistSpan > 50 + 1e-9);
      add('15.1.5', 'Scope', 'Ecospan composite joist floor', thin.length || long.length ? 'stop' : 'check',
        `"${eco.inp.mezz.ecospan}" on the PCS. Vulcraft returns the layout (beam and column lines, joist direction and spacing, deck) on the NBG-Vulcraft mezzanine quote sheet: quote the beams and columns on that layout and verify the assumed loads on the Ecospan supplemental sheet before it goes to the customer. E-series joists 10–24" deep, up to about 50'-0" long, typically 4'-0" O.C., 1.0C deck, 3½" slab minimum.${thin.length ? ` Slab under 3½" on ${thin.map(c => c.id).join(', ')}.` : ''}${long.length ? ` Joists over 50'-0" on ${long.map(c => c.id).join(', ')}.` : ''}`);
    }
    return out;
  }

  /* ---------- Excel, step by step: the cells to type in the NBG workbooks, in order, and what to read back ----------
     One beam workbook per load group (INPUT once, a run per MB sheet: the marks on MB1, MB2 …, then their shorter
     member lengths; four MB sheets a workbook). One Column-sheet run per column case. The addresses are the
     workbooks' own input cells, and oracle/steps_oracle.py types exactly these and reads the results back. */
  const XL = {
    input: {
      13: [['dead', 'C11', 'Dead, (psf)'], ['coll', 'C12', 'Collateral, (psf)'], ['live', 'C13', 'Live, (psf)'], ['joistWt', 'C14', 'Est. Joist Wt., (psf)'], ['A', 'C21', 'Top of Mezzanine, (ft.)'], ['slab', 'C22', 'Slab & Deck Thickness, (in.)'], ['seat', 'C23', 'Joist Seat Depth, (in.)'], ['joistDepth', 'C24', 'Total Joist Depth, (in.)'], ['beamDepth', 'C25', 'Beam Depth, (in.)'], ['B', 'E32', 'B - clearance under joist, Requested (ft.)'], ['C', 'E33', 'C - clearance under support beams, Requested (ft.)']],
      15: [['dead', 'D14', 'Dead, (psf)'], ['coll', 'D15', 'Collateral, (psf)'], ['live', 'D16', 'Live, (psf)'], ['joistWt', 'D17', 'Est. Joist Wt., (psf)'], ['A', 'D22', 'Top of Mezzanine, (ft.)'], ['slab', 'D23', 'Slab & Deck Thickness, (in.)'], ['seat', 'D24', 'Joist Seat Depth, (in.)'], ['joistDepth', 'D25', 'Total Joist Depth, (in.)'], ['B', 'F37', 'B - clearance under joist, Requested (ft.)'], ['C', 'F38', 'C - clearance under support beams, Requested (ft.)']],
    },
    clear: { 13: [['B', 'F32', 'G32'], ['C', 'F33', 'G33']], 15: [['B', 'G37', 'H37'], ['C', 'G38', 'H38']] },
    beamBook: { 13: 'Mezzanine_Beam_Design_13th.xls', 15: 'Mezzanine_Beam_Design_15th.xls', 16: 'Mezzanine_Beam_Design_16th.xls' },
    colBook: { 15: 'Mezzanine_Column_15th_S16-14.xls', 16: 'Mezzanine_Column_16th_S16-19.xls' },
  };
  function excelSteps(ctxs, mezz, marks) {
    const F = PCS.fmtFtIn, n3 = v => (v == null || !isFinite(v) ? null : +(+v).toFixed(3));
    const live = ctxs.filter(c => !c.incomplete);
    const beam = [];
    [...new Set(marks.map(m => m.groupKey))].forEach(gk => {
      const ms = marks.filter(m => m.groupKey === gk && m.sec && m.spanRuns && m.spanRuns.length);
      if (!ms.length) return;
      const c0 = live.find(c => ms[0].mezzIds.includes(c.index)), ed = c0.ed.beamEd, e13 = ed === '13', map = XL.input[e13 ? 13 : 15];
      const runs = ms.map(m => ({ m, q: m.spanRuns[0], i: 0 })).concat(ms.flatMap(m => m.spanRuns.slice(1).map((q, i) => ({ m, q, i: i + 1 }))));
      const dMax = Math.max(...ms.map(m => m.sec.d));
      // the INPUT sheet: loads once; heights and clearances of each mezzanine in the group (the MB results do not use them)
      const inputFor = c => {
        const v = { dead: c.beamBase.dead, coll: c.beamBase.coll, live: c.beamBase.live, joistWt: c.beamBase.joistWt, A: c.A, slab: c.slabIn, seat: c.seatIn, joistDepth: c.joistDepthIn, beamDepth: dMax, B: c.Bq, C: c.Cq };
        const steps = map.map(([k, cell, label]) => ({ sheet: 'INPUT', cell, label, value: n3(v[k]), show: v[k] == null ? '(leave blank)' : String(n3(v[k])) }));
        const read = XL.clear[e13 ? 13 : 15].map(([k, prov, ok]) => {
          const p = k === 'B' ? c.A - (c.slabIn + c.joistDepthIn) / 12 : c.A - (c.slabIn + c.seatIn + dMax) / 12, req = k === 'B' ? c.Bq : c.Cq;
          return [{ sheet: 'INPUT', cell: prov, label: `${k} provided (ft.)`, expect: n3(p) }, { sheet: 'INPUT', cell: ok, label: `${k} check`, expect: req == null || p >= req - 1e-9 ? 'OK' : 'No Good' }];
        }).flat();
        return { mezz: c.id, steps, read };
      };
      const members = live.filter(c => ms.some(m => m.mezzIds.includes(c.index)));
      const inputs = members.map(inputFor);
      for (let k = 0; k < runs.length; k += 4) {
        const sheets = runs.slice(k, k + 4).map(({ m, q, i }, j) => {
          const sheet = 'MB' + (j + 1), c = q.check, sec = m.sec;
          const steps = [
            { sheet, cell: 'D5', label: 'Beam Mark', value: i ? `${m.mark} ${F(q.span)}` : m.mark, show: i ? `${m.mark} ${F(q.span)}` : m.mark },
            { sheet, cell: 'D7', label: 'Member Length, ft.', value: n3(q.span), show: String(n3(q.span)) },
            { sheet, cell: 'D8', label: 'Unbraced Length, ft. (joist spacing)', value: n3(q.params.Lb), show: String(n3(q.params.Lb)) },
            { sheet, cell: 'D9', label: 'Tributary Width, ft.', value: n3(q.params.trib), show: String(n3(q.params.trib)) },
          ].concat(e13 ? [] : [{ sheet, cell: 'D15', label: 'Axial Load, Kip', value: null, show: '(leave blank)' }]).concat([
            { sheet, cell: 'Q4', where: 'K19 drop-down', label: 'Wide-flange/Built-up Sect.', value: 2, show: 'BU' },
            { sheet, cell: 'M22', label: 'Total Depth, in.', value: sec.d, show: String(sec.d) },
            { sheet, cell: 'M23', label: 'Web Thickness, in.', value: sec.tw, show: String(sec.tw) },
            { sheet, cell: 'M24', label: 'O. Flange Width, in.', value: sec.bof, show: String(sec.bof) },
            { sheet, cell: 'M25', label: 'O. Flange Thickness, in.', value: sec.tof, show: String(sec.tof) },
            { sheet, cell: 'M26', label: 'I. Flange Width, in.', value: sec.bif, show: String(sec.bif) },
            { sheet, cell: 'M27', label: 'I. Flange Thickness, in.', value: sec.tif, show: String(sec.tif) },
          ]);
          const read = [
            { sheet, cell: 'M20', label: 'Section Description', expect: c.desc },
            { sheet, cell: 'H6', label: 'Floor dead load — shear at left / right, kips', expect: n3(c.V.D) },
            { sheet, cell: 'H10', label: 'Floor live load — shear at left / right, kips', expect: n3(c.V.L) },
            { sheet, cell: 'K11', label: 'Live load deflection, L /', expect: Math.round(c.defl.rLL) },
            { sheet, cell: 'K15', label: 'Total load deflection, L /', expect: Math.round(c.defl.rTL) },
            { sheet, cell: 'G19', label: 'Combined', expect: c.combinedText },
            { sheet, cell: 'G20', label: 'Shear', expect: c.shearText },
          ];
          return { sheet, mark: m.mark, kind: m.kind, desc: m.desc, span: q.span, trib: q.params.trib, qty: q.qty, shorter: i > 0, mezzIds: m.mezzIds, steps, read };
        });
        beam.push({ file: XL.beamBook[e13 ? 13 : ed === '16' ? 16 : 15], edition: ed, copy: k / 4 + 1, marks: ms.map(m => m.mark), inputs, sheets });
      }
    });
    // Column sheet: one run per column case
    const column = [];
    mezz.filter(r => r && !r.incomplete && r.colFinal).forEach(r => {
      const c = ctxs[r.index], ed = c.ed.colEd, name = r.colFinal.name, L = r.colLen;
      let book = column.find(b => b.edition === ed);
      if (!book) column.push(book = { file: XL.colBook[ed] || XL.colBook[15], edition: ed, cases: [] });
      r.colGroups.forEach((gp, gi) => {
        const ck = r.colFinal.checks[gi], ld = gp.loads;
        const steps = [
          { sheet: 'Column', cell: 'C7', label: 'Column Mark', value: 'MC1', show: 'MC1' },
          { sheet: 'Column', cell: 'C8', label: 'Column Length, L (ft.)', value: n3(L), show: String(n3(L)) },
        ].concat(ed === '16' ? [{ sheet: 'Column', cell: 'C10', label: 'Y-Axis Unbraced Length, Lby (in.) — hard-coded 120 on this sheet: type L × 12', value: n3(L * 12), show: String(n3(L * 12)) }] : []).concat([
          { sheet: 'Column', cell: 'C16', label: `Section${r.colFinal.quoteAs !== name ? ` (quoted as ${r.colFinal.quoteAs})` : ''}`, value: name, show: name },
          // the Fy drop-down beside the section writes Miscellaneous!K8; the 16th sheet opens at 55 ksi, a W column is 50
          { sheet: 'Miscellaneous', cell: 'K8', where: 'Column!D16 Fy (ksi) drop-down', label: `Fy (ksi) — 50 for a W column${ed === '16' ? ' (this sheet opens at 55)' : ''}`, value: '50', show: '50' },
          { sheet: 'Column', cell: 'C27', label: 'Left Beam Reaction — Dead (kip)', value: n3(ld.DL_L), show: String(n3(ld.DL_L)) },
          { sheet: 'Column', cell: 'D27', label: 'Left Beam Reaction — Live (kip)', value: n3(ld.LL_L), show: String(n3(ld.LL_L)) },
          { sheet: 'Column', cell: 'C28', label: 'Right Beam Reaction — Dead (kip)', value: n3(ld.DL_R), show: String(n3(ld.DL_R)) },
          { sheet: 'Column', cell: 'D28', label: 'Right Beam Reaction — Live (kip)', value: n3(ld.LL_R), show: String(n3(ld.LL_R)) },
        ]);
        const read = ['C', 'D', 'E'].flatMap((col, k) => [{ sheet: 'Column', cell: col + '39', label: `${['DLt+LLt+DRt', 'DLt+DRt+LRt', 'DLt+LLt+DRt+LRt'][k]} result`, expect: ck.combos[k].okText }, { sheet: 'Column', cell: col + '40', label: 'Maximum CSR', expect: n3(ck.combos[k].csr) }]);
        if (ed !== '16') read.unshift({ sheet: 'Column', cell: 'C10', label: 'Lby follows C8 × 12 (in.)', expect: n3(L * 12) });
        book.cases.push({ mezz: r.id, mi: r.index, group: gi, labels: gp.cols.map(q => q.label), steps, read });
      });
    });
    return { beam, column };
  }

  /* ---------- loads to the frame, as NBG Frame takes them: by frame line, on the frame's own columns ----------
     A frame's members are its sidewall columns and the interior columns Box 5 lists for that frame line, numbered as
     NBG Frame does: COL01 at the FSW, then each interior column from the FSW, the BSW column last. An endwall column
     that is not one of the frame's members (a wind column beside a rigid end frame) is listed apart. Mezzanine columns
     never appear here — they are on the Column sheet. Each load acts at the mezzanine's top of beam (A − slab − seat). */
  function frameEntries(ctxs, frame) {
    const out = [];
    frame.forEach(q => {
      const c = ctxs[q.parts[0].mi], g = c.grid, near = (a, b) => Math.abs(a - b) < 0.05;
      const fi = g.xs.findIndex(x => near(x, q.x));
      if (fi < 0) return;   // a soldier column between frames: listed with the loads to the frame, not in a frame file
      const W = g.width, members = [0, ...(g.interior[fi] || []).filter(y => y > 0.05 && y < W - 0.05), W].sort((a, b) => a - b);
      const mi = members.findIndex(y => near(y, q.y));
      const wall = fi === 0 || fi === g.xs.length - 1;
      const where = near(q.y, 0) ? 'FSW column' : near(q.y, W) ? 'BSW column' : mi >= 0 ? `interior column at ${PCS.fmtFtIn(q.y)} from the FSW` : wall ? `endwall column at ${PCS.fmtFtIn(q.y)} — not a member of this frame (endwall design)` : `column at ${PCS.fmtFtIn(q.y)}`;
      // top of the mezzanine beam bearing there (the higher one when two mezzanines frame in)
      const elev = Math.max(...q.parts.map(p => { const k = ctxs[p.mi]; return k.A - (k.slabIn + k.seatIn) / 12; }));
      const A = Math.max(...q.parts.map(p => ctxs[p.mi].A));
      let f = out.find(e => e.x === g.xs[fi] && e.bkey === c.bkey);
      if (!f) out.push(f = { frame: g.xLabel(g.xs[fi]), x: g.xs[fi], bkey: c.bkey, building: c.inp.mezz.building || '', type: (c.inp.building.frames || []).find(fr => fi + 1 >= fr.from && fi + 1 <= fr.to) || null, width: W, interior: members.slice(1, -1), entries: [] });
      f.entries.push({ label: q.label, x: q.x, y: q.y, member: mi >= 0 ? 'COL' + String(mi + 1).padStart(2, '0') : null, where, elev, A, D: q.D, L: q.L, parts: q.parts, planKind: q.planKind || null });
    });
    out.forEach(f => { f.entries.sort((a, b) => a.y - b.y); f.type = f.type ? { type: f.type.type || '', intType: f.type.intType || null } : null; });
    return out.sort((a, b) => a.x - b.x);
  }

  /* Design every mezzanine of a job together. items: [{ inp, settings }] (one per mezzanine). */
  function runJob(items) {
    const ctxs = items.map((it, i) => prepare(it.inp, it.settings || {}, i));
    const merges = ctxs.length > 1 ? mergeBeams(ctxs) : [];
    const marks = jobMarks(ctxs).map(designMark);
    ctxs.forEach(c => { if (!c.incomplete) attachMarks(c, marks); });
    const cols = jobColumns(ctxs);
    cols.forEach(q => { q.ownerId = ctxs[q.owner].id; });
    // one column section for the whole job: the lightest W, in the usual try order, that passes every case of every mezzanine
    let jobName = null;
    const live = ctxs.filter(c => !c.incomplete), c0 = live[0];
    if (c0 && c0.s.colPerJob !== false && live.length > 1 && c0.ed.colEd) {
      const sets = new Map();
      live.forEach(c => cols.filter(q => q.owner === c.index).forEach(q => {
        const L = q.len || c.colLen, k = [q.DL_L, q.LL_L, q.DL_R, q.LL_R, L].map(x => (+x).toFixed(3)).join('|');
        if (L && [q.DL_L, q.LL_L, q.DL_R, q.LL_R].every(isFinite)) sets.set(k, { DL_L: q.DL_L, LL_L: q.LL_L, DL_R: q.DL_R, LL_R: q.LL_R, L });
      }));
      if (sets.size) { const env = DESIGN.designColumn([...sets.values()], { L: c0.colLen, includeW818: c0.s.includeW818, edition: c0.ed.colEd }, WF); jobName = env.name; }
    }
    const mezz = ctxs.map(c => c.incomplete ? c.result : finish(c, cols.filter(q => q.owner === c.index), cols.filter(q => q.owner !== c.index && q.seenIn.includes(c.index)), merges, jobName));
    mezz.forEach(r => { if (!r.incomplete) r.frameLoads = cols.frame.filter(q => q.seenIn.includes(r.index)); });
    if (jobName) mezz.forEach(r => { if (!r.incomplete && r.columns.length) r.warn.push({ level: 'key', text: `One column section for the whole job: ${jobName} passes every column case of every mezzanine.` }); });
    // the design manual items, and the Excel cells to type
    const dm = dmChecklist(ctxs, mezz, marks, cols);
    mezz.forEach(r => {
      if (r.incomplete) return;
      r.dm = dm.filter(it => it.mi == null || it.mi === r.index);
      r.dm.filter(it => (it.status === 'stop' || it.status === 'check') && it.mirror !== false).forEach(it => r.warn.push({ level: it.status === 'stop' ? 'stop' : 'warn', text: `${it.title} (DM ${it.ref}): ${it.text}` }));
    });
    const excel = excelSteps(ctxs, mezz, marks);
    return { mezz, merges, columns: cols, frameLoads: cols.frame, frameEntries: frameEntries(ctxs, cols.frame), marks: marks.map(({ group, ...m }) => m), dm, excel };
  }

  function run(inp, settings = {}) { return runJob([{ inp, settings }]).mezz[0]; }

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
     Design information: one row per mezzanine (its loads). Beams and columns: one holistic set for the job —
     a row per beam mark and member length (shorter beams of a mark get their own row: same section, own span),
     a row per column section and height. DL_T = DL + COL; LL_T = LL (+ partition when it is carried as live).
     End plates: 40 lb per beam, 46 lb per column. */
  const END_WT_BEAM = 40, END_WT_COL = 46;
  const round = (v, n = 2) => (v == null || !isFinite(v) ? '' : +(+v).toFixed(n));
  const HEADS = {
    design: [['MEZZ', 'MEZZ.'], ['FF', 'FF El. (ft)'], ['SLAB', 'SLAB (in.)'], ['WT', 'WT-NW/LW'], ['DL', 'DL, (psf)'], ['COL', 'COL, (psf)'], ['LL', 'LL, (psf)'], ['PART', 'PART. (psf)'], ['NOTES', 'ADDITIONAL NOTES']],
    beams: [['MEZZ', 'MEZZ.'], ['SPAN', 'SPAN (ft)'], ['TRIB', 'TRIB. (ft)'], ['DLT', 'DLᴛ (psf)'], ['LLT', 'LLᴛ (psf)'], ['SECTION', 'SECTION'], ['ENDWT', 'END WT (lb)'], ['QTY', 'QTY.'], ['NOTES', 'ADDITIONAL NOTES']],
    columns: [['MEZZ', 'MEZZ.'], ['HEIGHT', 'HEIGHT (ft)'], ['AREA', 'TRIB. AREA (ft²)'], ['SECTION', 'SECTION'], ['ENDWT', 'END WT (lb)'], ['QTY', 'QTY.'], ['NOTES', 'ADDITIONAL NOTES']],
  };
  function pack(design, beams, columns) {
    const tsv = (rows, h) => rows.map(r => h.map(([k]) => r[k]).join('\t')).join('\n');
    return { design, beams, columns, heads: HEADS, tsv: { design: tsv(design, HEADS.design), beams: tsv(beams, HEADS.beams), columns: tsv(columns, HEADS.columns) } };
  }
  function designRow(res, inp) {
    const id = inp.mezz.id || 'A';
    const conc = /light/i.test(inp.mezz.material || '') ? 'LW' : 'NW';
    const part = val(inp.loads.partition) || 0, dl = val(inp.loads.dead), col = val(inp.loads.coll) || 0, ll = val(inp.loads.live);
    const dlNote = inp.loads.dead.source === 'pcs' ? 'DL per PCS' : inp.loads.dead.source === 'manual' ? 'DL entered by QE'
      : `DL per seller: ${val(inp.loads.dead)} psf = ${(inp.loads.dead.note || '').replace(/^Deck guide: /, '').replace(/ — estimated.*$/, ' (est.)')}`;
    return { MEZZ: id, FF: round(val(inp.geom.A), 3), SLAB: round(val(inp.geom.slab) * 12, 3), WT: conc, DL: dl, COL: col, LL: ll, PART: part,
      NOTES: [dlNote, part ? `partition to ${res.settings.partitionTo}` : ''].filter(Boolean).join('; ') };
  }
  function quoteJob(results, inputs) {
    const done = results.map((r, i) => (r && !r.incomplete ? i : -1)).filter(i => i >= 0);
    const design = done.map(i => designRow(results[i], inputs[i]));
    const idOf = mi => (results[mi] && results[mi].id) || (inputs[mi] && inputs[mi].mezz.id) || 'A';
    const lineOf = (mi, x) => { const r = results[mi]; if (!r) return ''; const b = r.layout.beams[x.id]; return (r.layout.joists === 'y' ? r.grid.yLabel(b.line) : r.grid.xLabel(b.line)) || PCS.fmtFtIn(b.line); };
    // beams: the job's marks, one row per member length
    const marks = [];
    done.forEach(i => (results[i].marks || []).forEach(m => { if (!marks.some(x => x.mark === m.mark)) marks.push(m); }));
    marks.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const beams = [];
    marks.forEach(mk => {
      const mi0 = mk.beamsAll && mk.beamsAll[0] ? mk.beamsAll[0].mi : done[0];
      const r0 = results[mi0], inp0 = inputs[mi0], part = val(inp0.loads.partition) || 0;
      const dlT = val(inp0.loads.dead) + (val(inp0.loads.coll) || 0) + (r0.settings.partitionTo === 'dead' ? part : 0);
      const llT = val(inp0.loads.live) + (r0.settings.partitionTo === 'live' ? part : 0);
      const runs = mk.spanRuns && mk.spanRuns.length ? mk.spanRuns : [{ span: mk.span, qty: mk.qtyAll || mk.qty }];
      runs.forEach(run => {
        const bs = (mk.beamsAll || []).filter(x => Math.abs(x.span - run.span) < 1e-3);
        const byMezz = [...new Set(bs.map(x => x.mi))].map(mi => {
          const xs = bs.filter(x => x.mi === mi), lines = [...new Set(xs.map(x => lineOf(mi, x)))];
          return `${results.length > 1 ? idOf(mi) + ' ' : ''}${xs.map(x => 'B' + (x.id + 1)).join(', ')} (line ${lines.join(', ')})`;
        });
        const carried = bs.some(x => { const b = results[x.mi].layout.beams[x.id]; return b && b.extra; });
        const notes = [`${mk.mark}${mk.kind ? ' ' + mk.kind : ''}: ${byMezz.join('; ')}`,
          run.span < mk.span - 1e-3 ? `shorter span — same section, MB sheet at ${PCS.fmtFtIn(run.span)}` : `designed ${PCS.fmtFtIn(mk.span)} × ${PCS.fmtFtIn(mk.trib)} trib`,
          carried ? 'trib incl. neighbouring mezzanine edge' : '', mk.optionKey && mk.optionKey !== 'lightest' && mk.options ? (mk.options.find(o => o.key === mk.optionKey) || {}).label + ' option' : ''].filter(Boolean).join('; ');
        beams.push({ MEZZ: [...new Set(bs.map(x => idOf(x.mi)))].join(' / '), SPAN: round(run.span, 3), TRIB: round(mk.trib, 3), DLT: round(dlT, 2), LLT: round(llT, 2), SECTION: mk.desc || '', ENDWT: END_WT_BEAM, QTY: bs.length || run.qty, NOTES: notes });
      });
    });
    // columns: one row per section and height over the job
    const colRows = new Map();
    done.forEach(i => {
      const r = results[i];
      if (!r.colFinal || !r.columns.length) return;
      const k = r.colFinal.quoteAs + '|' + round(r.colLen, 3);
      const row = colRows.get(k) || { MEZZ: [], HEIGHT: round(r.colLen, 3), AREA: 0, SECTION: r.colFinal.quoteAs, ENDWT: END_WT_COL, QTY: 0, notes: [], runAs: r.colFinal.quoteAs !== r.colFinal.name ? r.colFinal.name : '' };
      row.MEZZ.push(r.id); row.QTY += r.columns.length; row.AREA = Math.max(row.AREA, ...r.columns.map(c => c.tribArea));
      row.notes.push(`${results.length > 1 ? r.id + ' ' : ''}${r.columns.map(c => c.label).join(', ')}`);
      r.columns.filter(c => c.shared).forEach(c => row.notes.push(`${c.label} shared with ${[...new Set(c.parts.map(p => p.mezz).filter(m => m !== r.id))].join(', ')}`));
      colRows.set(k, row);
    });
    const columns = [...colRows.values()].map(row => ({ MEZZ: row.MEZZ.join(' / '), HEIGHT: row.HEIGHT, AREA: round(row.AREA, 1), SECTION: row.SECTION, ENDWT: row.ENDWT, QTY: row.QTY, NOTES: [...row.notes, row.runAs ? `run as ${row.runAs}` : ''].filter(Boolean).join('; ') }));
    return pack(design, beams, columns);
  }
  // one mezzanine (or a job of one)
  function quoteSheet(res, inp) { return quoteJob([res], [inp]); }

  const api = { REQUIRED, inputsFromPCS, applyPlan, run, runJob, quoteText, quoteSheet, quoteJob, equivTrib, SETTINGS, DEFAULTS, resolveEdition, XL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_RUN = api;
})(typeof self !== 'undefined' ? self : this);
