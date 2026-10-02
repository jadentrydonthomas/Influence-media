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
    pcs.plan = reg && reg.ok ? { letters: reg.letters, arrows: reg.arrows, columns: reg.columns } : null;
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
      mezz: { id: m.id, building: m.building, page: m.page, material, concrete, deck, deckText: m.deckType, use: Object.keys((m.checks && m.checks.use) || {}).find(k => m.checks.use[k]) || null, provided, openings: m.openings, planJoists: m.planJoists || null },
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
    lay.snaps.forEach(sn => warn.push({ level: 'key', text: `Mezzanine edge at ${sn.axis === 'y' ? 'FSW' : 'LEW'} ${PCS.fmtFtIn(sn.edge)} is framed on the grid line at ${PCS.fmtFtIn(sn.line)} — the slab ${(sn.axis === 'y' ? (sn.edge < sn.line) === (sn.edge === mz.startFSW) : (sn.edge < sn.line) === (sn.edge === mz.startLEW)) ? 'overhangs it' : 'stops short of it'} by ${PCS.fmtFtIn(Math.abs(sn.line - sn.edge))}.` }));
    // grid lines that only some frames share (interior frame columns off the endwall grid) can put beam lines close together
    const tight = lay.beamLines.slice(1).map((v, i) => [lay.beamLines[i], v]).filter(([a, b]) => b - a < 12 - 1e-6);
    if (tight.length && !(s.xLines || s.yLines)) warn.push({ level: 'key', text: `Beam lines ${tight.map(([a, b]) => `${PCS.fmtFtIn(a)} / ${PCS.fmtFtIn(b)}`).join(', ')} are under 12'-0" apart — joists span only ${PCS.fmtFtIn(Math.min(...tight.map(([a, b]) => b - a)))} there. Drop a line on the Plan page if the joists should span past it.` });

    const maxDepthByC = Cq != null && A != null ? Math.floor((A - Cq) * 12 - slabIn - seatIn + 1e-6) : null;
    const beamBase = { dead: deadUsed, coll, live, joistWt, Lb: spacing, edition: ed.beamEd };
    const bkey = [inp.mezz.building || '', bl.width, bl.length, (bl.bays || []).join(',')].join('|');
    return { index, inp, s, warn, ed, division, A, slabIn, seatIn, Bq, Cq, joistDepthIn, grid, mz, lay, maxDepthByC, beamBase, bkey, id: inp.mezz.id || `Mezzanine ${index + 1}` };
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
      sets.forEach(([xs, kind]) => marks.push({ group: g, kind, beamsAll: xs, span: Math.max(...xs.map(x => x.span)), trib: Math.max(...xs.map(x => x.trib)) }));
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
        const e = at.get(key) || { key, x: sp.x, y: sp.y, building: sp.building, label: sp.label, ends: [], seenIn: [] };
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
        frame.push({ label: e.label, x: e.x, y: e.y, D: parts.reduce((a, p) => a + p.D, 0), L: parts.reduce((a, p) => a + p.L, 0), parts, seenIn: e.seenIn });
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
      if (WF[name].bf < 7) warn.push({ level: 'info', text: `${name} flange is ${WF[name].bf}" (< 7" DM 15.1.1.4.2 min for beams to the flange) — relies on the standard 4" bolt gage.` });
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
    return { mezz, merges, columns: cols, frameLoads: cols.frame, marks: marks.map(({ group, ...m }) => m) };
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

  const api = { REQUIRED, inputsFromPCS, applyPlan, run, runJob, quoteText, quoteSheet, quoteJob, equivTrib, SETTINGS, DEFAULTS, resolveEdition };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_RUN = api;
})(typeof self !== 'undefined' ? self : this);
