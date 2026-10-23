/* Job runner: parsed PCS -> inputs (with provenance) -> layout -> beam marks -> column groups -> quote lines. */
(function (root) {
  'use strict';
  const req = n => (typeof require !== 'undefined' ? require(n) : null);
  const MZ = root.MZ || req('./engine.js');
  const WF = root.MZ_WF || req('./wf-db.js');
  const LAYOUT = root.MZ_LAYOUT || req('./layout.js');
  const DESIGN = root.MZ_DESIGN || req('./design.js');
  const PCS = root.MZ_PCS || req('./pcs.js');
  const SEIS = root.MZ_SEISMIC || req('./seismic.js');

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
    production: true,          // NBG Production Guidelines (built-up) as a hard filter on the beam search
    setbackRigid: 4 / 3,       // ft: grid line to the inside face of a rigid frame column (a beam framing into it is that much shorter)
    setbackPB: 1,              // ft: the same at a post-and-beam column (and a soldier or endwall column)
  };

  const v = (value, source, note) => ({ value, source, note });

  /* Floor-plan reading → PCS: grid letters as drawn, and each mezzanine's joist direction from the "Mez. Jst."
     arrows inside its footprint. reg is PLAN.registerAndRead(...) for the building the drawing shows. */
  /* A building attached to another along a sidewall (Box 2 "Building Attachment"): where its points sit in the other
     building's coordinates. Seen from outside the wall attached to, its left steel line is the LEW end of an FSW and the
     REW end of a BSW; "at" runs from there. Back to back (BSW to BSW, FSW to FSW) the attached building is turned 180°.
     att: { wall, toWall, at }; host / own: { width, length }. Returns { toHost(x, y), fromHost(x, y), rot180 } or null. */
  const bkeyName = t => String(t || '').toUpperCase().replace(/BUILDING/g, 'BLDG').replace(/[^A-Z0-9]/g, '');
  function attachMap(att, host, own) {
    if (!att || !/^(FSW|BSW)$/.test(att.wall) || !/^(FSW|BSW)$/.test(att.toWall) || !(host.width > 0) || !(host.length > 0) || !(own.width > 0) || !(own.length > 0)) return null;
    const Wh = host.width, Lh = host.length, Wa = own.width, La = own.length, at = att.at || 0;
    const sh = att.toWall === 'BSW' ? 1 : -1, yWall = att.toWall === 'BSW' ? Wh : 0, rot180 = att.wall === att.toWall;
    const start = att.toWall === 'BSW' ? Lh - at - La : at;
    const d = y => (att.wall === 'BSW' ? Wa - y : y);
    return {
      rot180, host: att.to,
      toHost: (x, y) => ({ x: rot180 ? start + La - x : start + x, y: yWall + sh * d(y) }),
      fromHost: (x, y) => { const dd = (y - yWall) * sh; return { x: rot180 ? start + La - x : x - start, y: att.wall === 'BSW' ? Wa - dd : dd }; },
    };
  }
  // the building the floor plan was registered to, and how a mezzanine's building sits in it (identity, attached, none)
  function planMap(pcs, m) {
    const hostName = pcs.planBuilding != null ? pcs.planBuilding : ((pcs.mezzanines[0] || {}).building || '');
    if (bkeyName(m.building || '') === bkeyName(hostName)) return { toHost: (x, y) => ({ x, y }), fromHost: (x, y) => ({ x, y }), rot180: false, identity: true };
    const att = (pcs.attachments || []).find(a => bkeyName(a.building) === bkeyName(m.building) && bkeyName(a.to) === bkeyName(hostName));
    const own = pcs.buildings && pcs.buildings[m.building || ''], host = pcs.buildings && pcs.buildings[hostName];
    return att && own && host ? attachMap(att, host.building || {}, own.building || {}) : null;
  }
  // the plan's letters and column symbols in this mezzanine's building coordinates
  function planFor(pcs, mi) {
    const m = pcs.mezzanines[mi], map = pcs.plan && m ? planMap(pcs, m) : null;
    if (!map) return { yLetters: undefined, planCols: undefined };
    const pt = c => ({ ...c, ...map.fromHost(c.x, c.y) });
    return { yLetters: pcs.plan.letters.map(l => ({ ...l, y: map.fromHost(0, l.y).y })), planCols: pcs.plan.columns.concat(pcs.plan.frameCols || []).map(pt) };
  }

  function applyPlan(pcs, reg) {
    if (!pcs) return;
    pcs.plan = reg && reg.ok ? { letters: reg.letters, arrows: reg.arrows, columns: reg.columns, frameCols: reg.frameCols || [], numberOffset: reg.numberOffset || 0, markup: reg.markup || null } : null;
    // for the reading checks: was a floor plan found in the PCS (reg null: none), and did it register to the grid
    pcs.planRead = reg ? { found: true, ok: !!reg.ok, reason: reg.ok ? null : reg.reason || 'not read', page: reg.page ?? null } : { found: false };
    if (pcs.planBuilding == null) pcs.planBuilding = (pcs.mezzanines[0] || {}).building || '';
    pcs.mezzanines.forEach(m => {
      m.planJoists = null; m.planArrows = 0; m.planJoistsFrom = null;
      if (!pcs.plan || m.width == null || m.length == null) return;
      // joist markup / arrows inside the mezzanine, in the plan building's coordinates (an attached building mapped there)
      const map = planMap(pcs, m);
      if (!map) return;
      const x0 = m.startLEW || 0, y0 = m.startFSW || 0;
      const cs = [[x0, y0], [x0 + m.length, y0 + m.width]].map(([x, y]) => map.toHost(x, y));
      const bx = [Math.min(cs[0].x, cs[1].x), Math.max(cs[0].x, cs[1].x)], by = [Math.min(cs[0].y, cs[1].y), Math.max(cs[0].y, cs[1].y)];
      // an arrow centred in the mezzanine, or a marked-up joist line running at least 5'-0" across it
      const crosses = a => {
        if (!a.ends) return false;
        const [p, q] = a.ends, along = a.dir === 'y' ? [Math.min(p.y, q.y), Math.max(p.y, q.y), by] : [Math.min(p.x, q.x), Math.max(p.x, q.x), bx];
        const at = a.dir === 'y' ? (p.x + q.x) / 2 : (p.y + q.y) / 2, span = a.dir === 'y' ? bx : by;
        return at > span[0] - 0.5 && at < span[1] + 0.5 && Math.min(along[1], along[2][1]) - Math.max(along[0], along[2][0]) >= Math.min(5, (along[2][1] - along[2][0]) / 2);
      };
      const inside = pcs.plan.arrows.filter(a => (a.x > bx[0] - 0.5 && a.x < bx[1] + 0.5 && a.y > by[0] - 0.5 && a.y < by[1] + 0.5) || crosses(a));
      const nx = inside.filter(a => a.dir === 'x').length, ny = inside.filter(a => a.dir === 'y').length;
      m.planArrows = inside.length;
      m.planJoistsFrom = inside.some(a => a.kind === 'markup') ? 'markup' : inside.some(a => a.kind === 'truss') ? 'truss' : inside.length ? 'arrows' : null;
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
    // deck: the Deck Type box, or the "Other Deck Type" written out ("22ga B deck 1.5\"")
    const deckText = m.deckOther ? `${m.deckType || 'Other'}: ${m.deckOther}` : m.deckType;
    const deck = DESIGN.deckKey(m.deckType) || DESIGN.deckKey(m.deckOther) || '1.0C';
    // dead load: the PCS number; "Per Seller" with a blue note over it → the note; else the deck guide
    const dl = typeof m.dead === 'number' ? v(m.dead, 'pcs') : m.deadNote > 0 ? (() => {
      const d = DESIGN.deadLoadFor(slabIn, concrete, deck);
      return v(m.deadNote, 'annotation', `PCS "Per Seller"; blue note ${m.deadNote} psf${d.psf != null ? ` (the deck guide gives ${d.psf.toFixed(1)} psf for ${slabIn}" ${concrete} on ${deck})` : ''}`);
    })() : (() => {
      const d = DESIGN.deadLoadFor(slabIn, concrete, deck);
      return { ...v(d.psf, d.estimate ? 'estimate' : 'deckGuide', d.note), auto: true };   // follows slab / deck / concrete edits
    })();
    const dim = k => (m.dims && m.dims[k]) || {};
    // a value the engineer changed on the PCS: struck through, the new one written in red beside it
    // and a value read by OCR at under 85 %: said beside the field, to check against the PDF
    const mkNote = k => {
      const x = (m.markups || []).find(q => q.field === k && q.now), r = m.read && m.read[k];
      const ocr = r && r.conf < 85 ? `read by OCR, ${r.conf}% sure — check it against the PDF` : null;
      return x ? `PCS markup: ${x.was} struck through, ${x.now} written in red — the red value is used${ocr ? `; ${ocr}` : ''}` : ocr ? ocr[0].toUpperCase() + ocr.slice(1) : null;
    };
    const dimV = (k, def, defNote) => {
      const d = dim(k), prov = PCS.ftin(d.provided);
      if (d.value != null) return v(d.value, d.source === 'annotation' ? 'annotation' : 'pcs', mkNote(k) || (d.source === 'annotation' ? `PCS "${d.requested}"; blue note ${d.annotation}` : d.source === 'provided' ? `PCS Requested "${d.requested || 'blank'}"; the Provided column's ${d.provided}` : null));
      // a TBD minimum clearance: asked, with the quote's Provided number offered
      return def != null ? v(def, 'default', defNote) : { ...v(null, 'missing'), ...(prov != null ? { provided: prov } : {}) };
    };
    const provided = (m.checks && m.checks.provided) || {};
    return {
      job: { ...pcs.job, code: pcs.code },
      // Box 3: seismic site data and risk category (the seismic loads to the frames and the bracing)
      seismic: { ...(pcs.seismic || {}) },
      mezz: { id: m.id, building: m.building, page: m.page, notes: m.notes || [], read: m.read || null, markups: m.markups || [], ocr: pcs.ocr || null, deckBy: m.deckBy || null, joistsBy: m.joistsBy || null, material, concrete, deck, deckText, ecospan: pcs.ecospan || null, colRequest: pcs.columnRequest || null, use: Object.keys((m.checks && m.checks.use) || {}).find(k => m.checks.use[k]) || null, useRead: !!(m.checks && m.checks.use), provided, joists: (m.checks && m.checks.joists) || null, deckAttach: m.deckAttach || null, deckFinish: m.deckFinish || null, primer: m.primer || null, openings: m.openings, planJoists: m.planJoists || null, planJoistsFrom: m.planJoistsFrom || null, planArrows: m.planArrows || 0, planRead: pcs.planRead || null },
      loads: {
        dead: dl.source === 'pcs' && mkNote('dead') ? { ...dl, note: mkNote('dead') } : dl, coll: v(m.collateral ?? 0, m.collateral != null ? 'pcs' : 'default', mkNote('collateral')),
        live: v(m.live, m.live != null ? 'pcs' : 'missing', mkNote('live')), partition: v(m.partition ?? 0, m.partition != null ? 'pcs' : 'default', mkNote('partition')),
        joistWt: v(DEFAULTS.joistWt, 'default', 'Standard estimate (8 psf)'),
      },
      geom: {
        width: v(m.width, 'pcs', mkNote('width')), length: v(m.length, 'pcs', mkNote('length')), startLEW: v(m.startLEW ?? 0, 'pcs', mkNote('startLEW')), startFSW: v(m.startFSW ?? 0, 'pcs', mkNote('startFSW')),
        slab: v(m.slab, m.slab != null ? 'pcs' : 'missing', mkNote('slab')),
        A: dimV('A'), B: dimV('B'), C: dimV('C'),
        // no silent defaults: TBD with no blue note means the quote engineer enters it (the Design page asks)
        joistSpacing: dimV('joistSpacing'), seat: dimV('seat'),
        // read for the record and carried to the frame / edge design (not used by the mezzanine beams or columns)
        D: dimV('D'), E: dimV('E'), F: dimV('F'),
      },
      building: {
        width: b.width, length: b.length, ridge: b.ridge, bays: b.bays || [], lewCols: b.lewCols || [], rewCols: b.rewCols || [],
        fswSoldier: b.fswSoldier || [], bswSoldier: b.bswSoldier || [], frames, fromPCS: true, rows: b.rows || null,
        yLetters: planFor(pcs, mi).yLetters,
        // column symbols on the floor plan: ⊗ / circled I = mezzanine column, bare I / ✱ = frame column
        planCols: planFor(pcs, mi).planCols,
        attach: (pcs.attachments || []).find(a => bkeyName(a.building) === bkeyName(m.building)) || null,
        bracing: (own && own.bracing) || null,
        // Box 2 roof shape and Box 4 roof loads, for the seismic weight of the roof and walls
        geo: { profile: b.profile || null, eaveFSW: b.eaveFSW ?? b.eave ?? null, eaveBSW: b.eaveBSW ?? b.eave ?? null, slopeFSW: b.slopeFSW ?? null, slopeBSW: b.slopeBSW ?? null },
        roofLoads: (own && own.roof) || null,
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
    else soft.push(...buildingChecks(inp));
    return { miss, soft, need };
  }

  /* Reading checks on the building data: each Box 2 list against the building's own size, and Box 5 against Box 2. A
     misread list moves frame lines and columns, so it stops the layout until it is confirmed or fixed on the Inputs
     page — never designed on silently. */
  function buildingChecks(inp) {
    const out = [], b = inp.building, F = PCS.fmtFtIn, sum = a => a.reduce((p, q) => p + q, 0), list = a => a.map(F).join(', ');
    const who = inp.mezz && inp.mezz.building ? `"${inp.mezz.building}"` : 'the building';
    const stop = text => out.push({ level: 'stop', text });
    // Box 22's building name against the Box 2 rows it was read from
    Object.values(b.rows || {}).filter(rw => rw.matched === 'prefix' || rw.matched === 'only').slice(0, 1).forEach(rw => out.push({ level: 'warn', text: `Box 22 names the building ${who}; Box 2 lists "${rw.name}" — read as the same building (${rw.matched === 'only' ? 'the only one listed' : 'the one name that matches'}). Confirm.` }));
    // the footprint inside the building (an edge may run up to 2'-0" past an end line, framed on it)
    const gm = inp.geom || {}, x0 = val(gm.startLEW) || 0, y0 = val(gm.startFSW) || 0, mL = val(gm.length), mW = val(gm.width), mid = inp.mezz && inp.mezz.id != null ? mezzName(inp.mezz.id) : 'the mezzanine';
    if (mL > 0 && (x0 < -0.01 || x0 + mL > b.length + 2 + 1e-6)) stop(`Box 22: ${mid} runs from ${F(x0)} to ${F(x0 + mL)} from the LEW, past the ends of ${who} (${F(b.length)} long) — its start or length was misread, or it is in another building. Check Box 22.`);
    if (mW > 0 && (y0 < -0.01 || y0 + mW > b.width + 2 + 1e-6)) stop(`Box 22: ${mid} runs from ${F(y0)} to ${F(y0 + mW)} from the FSW, past the sidewalls of ${who} (${F(b.width)} wide) — its start or width was misread, or it is in another building. Check Box 22.`);
    const bays = b.bays || [];
    if (!bays.length) stop(`Box 2: the sidewall bay spacing of ${who} was not read — the frame lines are unknown, so the layout takes the building as one ${F(b.length)} bay. Enter the bays on the Inputs page (Building) or check Box 2.`);
    else if (Math.abs(sum(bays) - b.length) > 2 + 1e-6) stop(`Box 2: the bays of ${who} (${list(bays)}) add to ${F(sum(bays))}, but the building is ${F(b.length)} long — part of the bay list was not read, or Box 2 is inconsistent. A frame line is put at ${F(b.length)}; check the bays on the Inputs page.`);
    [['lewCols', 'LEW'], ['rewCols', 'REW']].forEach(([k, w]) => {
      const c = b[k] || [];
      if (!c.length) stop(`Box 2: the ${w} column spacing of ${who} was not read — only its corner columns are known, so beam and column lines along the ${w} may be missing. Enter it on the Inputs page (Building) or check Box 2.`);
      else if (Math.abs(sum(c) - b.width) > 0.1) stop(`Box 2: the ${w} column spacing of ${who} (${list(c)}) adds to ${F(sum(c))}, but the building is ${F(b.width)} wide — part of the list was not read. Check it on the Inputs page.`);
    });
    const fr = b.frames || [];
    if (b.fromPCS && !fr.length) stop(`Box 5: no frame information was read for ${who} — whether its frames have interior columns is unknown, so the layout puts none. Check Box 5 (Frame Information) before using this layout.`);
    if (fr.length) {
      const n = LAYOUT.buildingGrid({ width: b.width, length: b.length, bays, lewCols: b.lewCols, rewCols: b.rewCols, frames: fr }).xs.length;
      const miss = [];
      for (let i = 1; i <= n; i++) if (!fr.some(f => i >= f.from && i <= f.to)) miss.push(i);
      if (miss.length) stop(`Box 5: frame line${miss.length > 1 ? 's' : ''} ${miss.join(', ')} of ${who} ${miss.length > 1 ? 'have' : 'has'} no frame row, but Box 2's bays give ${n} frame lines — a frame row was not read, or the bays were misread.`);
      const top = Math.max(...fr.map(f => f.to));
      if (top > n) stop(`Box 5 lists frame line ${top} for ${who}, but Box 2's bays give only ${n} frame lines — a bay was not read, or Box 5 was misread.`);
      const cum = a => a.reduce((acc, v) => (acc.push(acc[acc.length - 1] + v), acc), [0]);
      fr.forEach(f => {
        const t = sum(f.interior || []), lines = f.from === f.to ? `frame line ${f.from}` : `frames ${f.from}–${f.to}`;
        if ((f.interior || []).length && Math.abs(t - b.width) > 0.1) stop(`Box 5: the interior module spacing of ${lines} (${list(f.interior)}) adds to ${F(t)}, but ${who} is ${F(b.width)} wide — part of the list was not read. Check Box 5.`);
        // a post-and-beam end frame stands on the endwall columns: Box 5's modules and Box 2's endwall spacing are one list
        const ew = f.wall === 'LEW' ? b.lewCols : f.wall === 'REW' ? b.rewCols : null;
        if (ew && ew.length && (f.interior || []).length > 1 && /post|bearing/i.test(f.type || '')) {
          const a = cum(f.interior), c = cum(ew);
          if (a.length !== c.length || a.some((v, i) => Math.abs(v - c[i]) > 0.1)) stop(`Box 5 (${lines}, ${f.type}) puts the end-frame columns at ${list(a.slice(1, -1))} from the FSW, but Box 2's ${f.wall} column spacing puts them at ${list(c.slice(1, -1))} — one of the two was misread.`);
        }
      });
    }
    return out;
  }

  // Dead load from the deck guide tracks slab / deck / concrete edits until someone types a dead load
  function refreshDeadLoad(inp) {
    const d = inp.loads.dead;
    if (!d || !d.auto) return;
    const slab = val(inp.geom.slab);
    const r = DESIGN.deadLoadFor(slab != null ? slab * 12 : null, inp.mezz.concrete || 'NW', inp.mezz.deck || '1.0C');
    inp.loads.dead = { value: r.psf, source: r.estimate ? 'estimate' : 'deckGuide', note: r.note, auto: true };
  }

  /* What the PCS says around Box 22 that changes the job: the special notes (Box 27) about this mezzanine — with the
     qualification a note points to — and who supplies the deck and the joists. A note that describes framing this
     tool does not lay out (no floor / MEP support only, a hanging grid, cantilever or hot-rolled beams under grating)
     is a must-fix: the beams and columns here are then the Box 22 loads on a floor layout, a check only. */
  const OTHER_FRAMING = /not have any floor|\bno floor\b|mep support|hanging grid|cantilever|hot[- ]rolled|grating/i;
  function scopeNotes(inp) {
    const out = [], mz = inp.mezz || {}, id = mz.id || 'This mezzanine';
    (mz.notes || []).forEach(n => {
      const q = n.qual ? ` Qualification ${n.qualN} (Box 28): "${n.qual}"` : '';
      if (OTHER_FRAMING.test(n.text)) out.push({ level: 'stop', tag: 'note', text: `${id}: the PCS special notes describe framing this tool does not lay out — the beams, joists and columns here are the Box 22 loads on a floor layout, a check of those loads only; design the framing as the note says. Special note ${n.n} (page ${n.page}): "${n.text}"${q}` });
      else out.push({ level: 'warn', tag: 'note', text: `PCS special note ${n.n} (page ${n.page}): "${n.text}"${q}` });
    });
    if (mz.joistsBy === 'others' || mz.deckBy === 'others') {
      const what = [mz.deckBy === 'others' ? 'the deck' : null, mz.joistsBy === 'others' ? 'the bar joists and bridging' : null].filter(Boolean).join(' and ');
      out.push({ level: 'warn', text: `${id}: ${what} ${mz.deckBy === 'others' && mz.joistsBy === 'others' ? 'are' : 'is'} not by the seller (Box 22).${mz.joistsBy === 'others' ? ` The beams still carry the joists' weight — ${val(inp.loads.joistWt) ?? DEFAULTS.joistWt} psf, an estimate — and are braced at the joist spacing: confirm both with whoever supplies the floor members.` : ''}` });
    }
    return out;
  }

  /* A Box 22 read by OCR (the PCS pages carry no text layer): the values Tesseract was less than 85 % sure of, still as
     they stand in the inputs, to check against the PDF; and each value changed by a markup on the PCS. */
  const READ_LABEL = { width: 'Width', length: 'Length', slab: 'Slab/deck', startLEW: 'Start from LEW', startFSW: 'Start from FSW', dead: 'Dead load', live: 'Live load', collateral: 'Collateral', partition: 'Partition',
    A: '(A)', B: '(B)', C: '(C)', D: '(D)', E: '(E)', F: '(F)', joistSpacing: 'Joist spacing', seat: 'Joist seat' };
  function ocrNotes(inp) {
    const out = [], mz = inp.mezz || {}, id = mz.id || 'This mezzanine';
    (mz.markups || []).filter(x => x.now).forEach(x => out.push({ level: 'warn', text: `${id}: PCS markup on page ${x.page} — ${x.label || READ_LABEL[x.field] || 'a value'} ${x.was} struck through, ${x.now} written in red. The red value is used.` }));
    if (!mz.read) return out;
    const node = k => ({ dead: inp.loads.dead, live: inp.loads.live, collateral: inp.loads.coll, partition: inp.loads.partition })[k] || inp.geom[k];
    const shown = k => { const n = node(k), x = val(n); return x == null ? 'not read' : /^(dead|live|collateral|partition)$/.test(k) ? `${+x.toFixed(2)} psf` : PCS.fmtFtIn(x); };
    // still the PCS value (not typed over since) and read at under 85 %
    const low = Object.entries(mz.read).filter(([k, r]) => r.conf < 85 && READ_LABEL[k] && node(k) && !/manual|none/.test(node(k).source || ''));
    if (low.length) out.push({ level: 'warn', text: `${id}: this PCS has no text layer — Box 22 was read by OCR. Check these against the PDF (how sure the reader was): ${low.map(([k, r]) => `${READ_LABEL[k]} ${shown(k)} (${r.conf}%)`).join(', ')}.` });
    else out.push({ level: 'info', text: `${id}: Box 22 was read by OCR (the PCS pages carry no text layer); every value read at 85% or better.` });
    return out;
  }

  /* ---------- one mezzanine: inputs → loads → layout (no section sizes yet) ---------- */
  function prepare(inp, settings = {}, index = 0) {
    const s = { ...SETTINGS, ...settings };
    const warn = [];
    refreshDeadLoad(inp);
    const chk = validate(inp);
    chk.soft.forEach(t => warn.push(typeof t === 'string' ? { level: 'warn', text: t } : t));
    scopeNotes(inp).forEach(w => warn.push(w));
    ocrNotes(inp).forEach(w => warn.push(w));
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
    // the dead load from the deck guide, and a deck the guide does not know ("Other", "Per Seller", blank): one item
    const deckOpen = inp.mezz.deckText && !DESIGN.deckKey(inp.mezz.deckText) && inp.loads.dead.auto;
    const est = inp.loads.dead.source === 'estimate', what = est ? String(inp.loads.dead.note).replace(/ — estimated from the deck guide \((.*)\); confirm\.$/, ' (deck-guide estimate from $1)') : '';
    if (est || deckOpen) warn.push({ level: 'warn', text: `Dead load ${val(inp.loads.dead)} psf${est ? ` for ${what}` : ''}${deckOpen ? ` — the PCS deck reads "${inp.mezz.deckText}", so ${inp.mezz.deck} form deck is assumed` : ''}. Confirm the ${deckOpen ? 'deck and ' : ''}dead load on the Inputs page.` });
    if (part > 0) warn.push({ level: 'info', text: `Partition load ${part} psf added to the ${s.partitionTo} load.` });
    ['joistSpacing', 'seat'].forEach(k => { if (inp.geom[k].source === 'default') warn.push({ level: 'warn', text: inp.geom[k].note }); });
    if (inp.mezz.openings) warn.push({ level: 'warn', text: `Floor openings listed: ${inp.mezz.openings} — frame openings by hand. An opening wider than one joist spacing needs a joist header; its size and exact location must be on the order documents, and the header locations go to the joist manufacturer (DM 15.1.2).${/@\s*[\d,]+\s*lb/i.test(inp.mezz.openings) ? ` The ${(inp.mezz.openings.match(/@\s*([\d,]+)\s*lb/i) || [])[1]} lb listed with it is not in this design — the beams and quote rows carry the uniform floor load only: check the beams and joists around the opening for it.` : ''}` });

    // layout — joist direction: Plan-page choice, else the "Mez. Jst." arrows on the PCS floor plan, else auto
    const bl = inp.building;
    const grid = LAYOUT.buildingGrid({ width: bl.width, length: bl.length, bays: bl.bays, lewCols: bl.lewCols, rewCols: bl.rewCols, ridge: bl.ridge, frames: bl.frames, fswSoldier: bl.fswSoldier, bswSoldier: bl.bswSoldier, yLetters: bl.yLetters });
    const mz = { length: val(inp.geom.length), width: val(inp.geom.width), startLEW: val(inp.geom.startLEW) || 0, startFSW: val(inp.geom.startFSW) || 0 };
    if (grid.lengthGap) warn.push({ level: 'warn', text: `${inp.mezz.building || 'The building'}: Box 2 length ${PCS.fmtFtIn(grid.boxLength)}, but the bays add to ${PCS.fmtFtIn(grid.length)} (${PCS.fmtFtIn(Math.abs(grid.lengthGap))} ${grid.lengthGap > 0 ? 'more' : 'less'}) — the frames are taken on the bay lines, no extra frame line. Confirm the PCS dimensions.` });
    const fromPlan = s.joists === 'auto' && (inp.mezz.planJoists === 'x' || inp.mezz.planJoists === 'y');
    // the column symbols on the PCS floor plan frame the edges the way the drawing does (a wall column's I sits on the wall)
    const drawn = planSymbols(bl.planCols, grid);
    const lay = LAYOUT.layout(grid, mz, { joists: fromPlan ? inp.mezz.planJoists : s.joists, xLines: s.xLines, yLines: s.yLines, drop: s.drop, drawn });
    // a line added on the Plan page very close to another: short beams and extra columns there — say so
    if (s.xLines || s.yLines) {
      const base = LAYOUT.layout(grid, mz, { joists: fromPlan ? inp.mezz.planJoists : s.joists, drawn });
      [['xLines', 'LEW'], ['yLines', 'FSW']].forEach(([k, from]) => { if (!s[k]) return; const ls = lay[k].slice().sort((a, b) => a - b), own = v => base[k].some(u => Math.abs(u - v) < 0.01);
        ls.slice(1).forEach((v, i) => { const gap = v - ls[i]; if (gap > 0.05 && gap < 6 && !(own(v) && own(ls[i]))) { const beamLine = (k === 'yLines') === (lay.joists === 'y');
          warn.push({ level: 'warn', text: `${beamLine ? 'Beam' : 'Column'} lines at ${PCS.fmtFtIn(ls[i])} and ${PCS.fmtFtIn(v)} from the ${from} are only ${PCS.fmtFtIn(gap)} apart (a line added on the Plan page) — ${beamLine ? `joists spanning ${PCS.fmtFtIn(gap)} between them` : `${PCS.fmtFtIn(gap)} beams and extra columns there`}; confirm it is intended.` }); } }); });
    }
    if (fromPlan) {
      lay.why = ({ markup: 'the JOISTS markup on the PCS floor plan', truss: 'the joist symbol on the PCS floor plan' })[inp.mezz.planJoistsFrom] || 'joist arrows on the PCS floor plan';
      const alt = lay.alt, n = o => o.beams.length;
      if (alt && (alt.beamSpan < lay.beamSpan - 1e-6 || n(alt) < n(lay))) warn.push({ level: 'key', text: `Joist direction follows ${lay.why} (${lay.joists === 'y' ? 'across the width' : 'along the length'}). The other direction would use ${n(alt)} beams spanning ${PCS.fmtFtIn(alt.beamSpan)} — switch it on the Plan page if that is what will be quoted.` });
    }
    lay.beams.forEach(b => { b.tribOwn = b.trib; });
    readColumnSymbols(lay, bl.planCols, grid, warn);
    userColumns(lay, s.colKind, grid, warn);
    planChecks(inp, grid, lay, s, warn);
    lay.snaps.forEach(sn => {
      const lab = (sn.axis === 'y' ? grid.yLabel(sn.line) : grid.xLabel(sn.line)), past = (sn.axis === 'y' ? (sn.edge < sn.line) === (sn.edge === mz.startFSW) : (sn.edge < sn.line) === (sn.edge === mz.startLEW));
      const along = (sn.axis === 'x') === (lay.joists === 'y');   // the overhang runs along the beams (else along the joists)
      warn.push({ level: 'key', text: `The mezzanine edge ${PCS.fmtFtIn(sn.edge)} from the ${sn.axis === 'y' ? 'FSW' : 'LEW'} is framed on the grid line ${lab ? lab + ' (' + PCS.fmtFtIn(sn.line) + ')' : 'at ' + PCS.fmtFtIn(sn.line)} — the slab ${past ? 'overhangs it' : 'stops short of it'} by ${PCS.fmtFtIn(Math.abs(sn.line - sn.edge))}${sn.drawn ? ', as the PCS floor plan draws it: no column on the edge, columns on that line' : ''}.${past && along ? ` The end beams cantilever it, and the columns on that line take its load as well (w × ${PCS.fmtFtIn(Math.abs(sn.line - sn.edge))} added to their reactions).` : past ? ' The edge beam carries it (added to its trib).' : ''}` });
    });
    // an edge just past the 1'-0" snap of a line of building columns: the layout frames it with new mezzanine columns, and
    // the beams there stop loading the frame (a footprint cut to a beam's clear length does this). Say so.
    {
      const fp = lay.footprint, F = PCS.fmtFtIn, W = grid.width, Lg = grid.length;
      const inX = grid.xs.map((x, i) => (x >= fp.x0 - 1 && x <= fp.x1 + 1 ? grid.interior[i] || [] : [])).flat();
      const yLines = [...new Set([0, W, ...inX].map(v => +v.toFixed(3)))], xLines = grid.xs;
      const off = (edge, lines, out) => lines.map(l => ({ l, d: Math.abs(l - edge) })).filter(o => o.d > 1 + 1e-6 && o.d <= 3 + 1e-6 && (out ? o.l > edge : o.l < edge)).sort((a, b) => a.d - b.d)[0];
      [['y', fp.y0, false, 'FSW-side'], ['y', fp.y1, true, 'BSW-side'], ['x', fp.x0, false, 'LEW-side'], ['x', fp.x1, true, 'REW-side']].forEach(([ax, edge, out, side]) => {
        if (ax === 'y' ? (edge < 1e-6 || edge > W - 1e-6) : (edge < 1e-6 || edge > Lg - 1e-6)) return;
        const o = off(edge, ax === 'y' ? yLines : xLines, out);
        if (!o) return;
        const lab = (ax === 'y' ? grid.yLabel(o.l) : grid.xLabel(o.l)) || F(o.l);
        warn.push({ level: 'warn', text: `${inp.mezz.id || 'This mezzanine'}'s ${side} edge is at ${F(edge)}, ${F(o.d)} short of the building column line ${lab} (${F(o.l)}), more than the 1'-0" the layout frames on a line. Its beams there go on new mezzanine columns along ${F(edge)}, and no load reaches line ${lab}. If only the beams are shorter (clear span between column faces), keep the footprint on line ${lab} and set the design span on the Beam calc page.` });
      });
    }
    // grid lines that only some frames share (interior frame columns off the endwall grid) can put beam lines close together
    const tight = lay.beamLines.slice(1).map((v, i) => [lay.beamLines[i], v]).filter(([a, b]) => b - a < 12 - 1e-6);
    if (tight.length && !(s.xLines || s.yLines)) warn.push({ level: 'key', text: `Beam lines ${tight.map(([a, b]) => `${PCS.fmtFtIn(a)} / ${PCS.fmtFtIn(b)}`).join(', ')} are under 12'-0" apart — joists span only ${PCS.fmtFtIn(Math.min(...tight.map(([a, b]) => b - a)))} there. Drop a line on the Plan page if the joists should span past it.` });

    // joist span against the total joist depth: SJI limits a K-series joist to 24 × its depth (a removed beam line on the
    // Plan page, or a wide bay, can go past it)
    if (joistDepthIn > 0 && lay.joistSpan * 12 / joistDepthIn > 24 + 1e-6) warn.push({ level: 'warn', text: `Joists span ${PCS.fmtFtIn(lay.joistSpan)} on a ${+joistDepthIn.toFixed(2)}" total joist depth — ${(lay.joistSpan * 12 / joistDepthIn).toFixed(1)} × the depth, over the 24 × depth SJI allows for K-series joists. Add a beam line or deepen the joists; confirm with the joist supplier.` });
    // the room under C for the beam and its sag, in inches: A − C − slab − seat (a 1/1000" tolerance absorbs rounding)
    const roomIn = Cq != null && A != null ? (A - Cq) * 12 - slabIn - seatIn : null;
    const maxDepthByC = roomIn != null ? Math.floor(roomIn + 1e-3) : null;
    const beamBase = { dead: deadUsed, coll, live, joistWt, Lb: spacing, edition: ed.beamEd };
    const bkey = [inp.mezz.building || '', bl.width, bl.length, (bl.bays || []).join(',')].join('|');
    return { index, inp, s, warn, ed, division, A, slabIn, seatIn, Bq, Cq, joistDepthIn, grid, mz, lay, roomIn, maxDepthByC, beamBase, bkey, id: inp.mezz.id || `Mezzanine ${index + 1}` };
  }

  /* Reading checks against the PCS floor plan: was it found and matched to the grid, does it show this mezzanine's
     joist direction and columns, and does it agree with Box 5's interior frame columns. */
  function planChecks(inp, grid, lay, s, warn) {
    const pr = inp.mezz.planRead, F = PCS.fmtFtIn, id = inp.mezz.id ? mezzName(inp.mezz.id) : 'this mezzanine';
    if (!pr) return;   // not from a PCS (manual entry)
    if (pr.found === false) { warn.push({ level: 'warn', text: 'No floor plan drawing was found in the PCS — the layout comes from Box 2, Box 5 and Box 22 alone. Check the frame lines, columns and joist direction against the drawing before using it.' }); return; }
    if (!pr.ok) { warn.push({ level: 'stop', text: `The PCS floor plan${pr.page ? ` (page ${pr.page})` : ''} could not be matched to the building grid from Box 2 / Box 5 (${pr.reason}). The building data may be misread or the drawing laid out differently — check the frame lines, the columns and the joist direction against the drawing before using this layout.` }); return; }
    const pc = planSymbols(inp.building.planCols, grid);
    if (!pc) return;   // a building the drawing does not show (not attached to the drawn one)
    const fp = lay.footprint, inFp = c => c.x > fp.x0 - 1 && c.x < fp.x1 + 1 && c.y > fp.y0 - 1 && c.y < fp.y1 + 1, dir = lay.joists === 'y' ? 'across the width' : 'along the length';
    const near = (arr, v) => arr.find(u => Math.abs(u - v) < 1), lab = c => { const nx = near(grid.xs, c.x), ny = near(grid.allY, c.y); return (nx != null ? grid.xLabel(nx) : F(c.x)) + '/' + (ny != null && grid.yLabel(ny) ? grid.yLabel(ny) : F(c.y)); };
    if ((s.joists || 'auto') === 'auto' && !inp.mezz.planJoists) warn.push({ level: 'warn', text: `${inp.mezz.planArrows ? `The PCS floor plan has joist arrows both ways inside ${id}` : `The PCS floor plan shows no joist arrow inside ${id}`} — the joists span ${dir} by rule (${lay.why}). Confirm the joist direction against the drawing (Plan page).` });
    // the mezzanine columns drawn against the layout's: drawingCheck, once the job's columns are known
    // ✱ (Box 5's "Most Economical" interior columns) drawn where Box 5 has no interior column
    const off = pc.filter(c => c.kind === 'star' && inFp(c) && c.y > 0.5 && c.y < grid.width - 0.5).filter(c => { const i = grid.xs.findIndex(x => Math.abs(x - c.x) < 1); return i >= 0 && !(grid.interior[i] || []).some(y => Math.abs(y - c.y) < 1); });
    if (off.length) warn.push({ level: 'stop', text: `The PCS floor plan shows ✱ interior frame column${off.length > 1 ? 's' : ''} at ${off.map(lab).join(', ')}, where Box 5 lists no interior column — Box 5 was misread or differs from the drawing. Check the frame information before using this layout.` });
  }

  // "mezzanine 1", "Mezz 2": a mezzanine ID read as a name in a sentence
  const mezzName = id => (/^mezz/i.test(String(id)) ? String(id) : `mezzanine ${id}`);
  /* The PCS floor plan against the layout, per mezzanine: every mezzanine column symbol drawn inside it (⊗ / ⊘ / circled I
     / marked-up X) is one of the job's mezzanine columns there, and every one of those is drawn. As read they must
     agree — a stop when they do not; once the layout was edited on the Plan page, a note of how it differs. */
  function drawingCheck(ctxs, mezz, cols) {
    mezz.forEach((r, i) => {
      const c = ctxs[i], pc = !r.incomplete && c.inp.building.planCols, pr = c.inp.mezz.planRead;
      if (!pc || !(pr && pr.ok)) return;
      const F = PCS.fmtFtIn, g = c.grid, fp = c.lay.footprint, inFp = q => q.x > fp.x0 - 1 && q.x < fp.x1 + 1 && q.y > fp.y0 - 1 && q.y < fp.y1 + 1;
      const near = (arr, v) => arr.find(u => Math.abs(u - v) < 0.6);
      const lab = q => { const nx = near(g.xs, q.x), ny = near(g.allY.concat((c.inp.building.yLetters || []).map(l => l.y)), q.y); return (nx != null ? g.xLabel(nx) : F(q.x)) + '/' + (ny != null && g.yLabel(ny) ? g.yLabel(ny) : F(q.y)); };
      const drawn = pc.filter(q => MEZZ_SYM[q.kind] && inFp(q)), laid = cols.filter(q => ctxs[q.owner].bkey === c.bkey && inFp(q));
      const used = new Set(), extra = [];
      drawn.forEach(d => { const k = laid.findIndex((q, j) => !used.has(j) && Math.hypot(q.x - d.x, q.y - d.y) <= 1.5); if (k >= 0) used.add(k); else extra.push(d); });
      const missing = laid.filter((q, j) => !used.has(j));
      const sym = drawn.some(q => q.markup) ? 'marked-up X' : drawn.some(q => q.kind === 'i') ? 'circled-I' : drawn.some(q => q.kind === 's') ? '⊘' : '⊗';
      // the layout's own labels where it has the column; the drawn position where only the drawing does
      const id = mezzName(c.id), sort = a => a.sort((p, q) => p.localeCompare(q, undefined, { numeric: true })).join(', '), list = a => sort(a.map(q => q.label || lab(q)));
      r.planAgree = !extra.length && !missing.length;
      if (!drawn.length && !laid.length) return;
      if (r.planAgree) { r.warn.unshift({ level: 'ok', text: `Floor plan check: the drawing shows ${drawn.length} ${sym} mezzanine column${drawn.length === 1 ? '' : 's'} in ${id}, at ${list(laid)} — the same as the layout.` }); return; }
      const st = c.s, edited = !!(st.xLines || st.yLines || (st.drop && st.drop.length) || (st.colKind && Object.keys(st.colKind).length) || (st.joists && st.joists !== 'auto'));
      const diff = [extra.length ? `drawn but not in the layout: ${list(extra)}` : '', missing.length ? `in the layout but not drawn: ${list(missing)}` : ''].filter(Boolean).join('; ');
      if (edited) { r.warn.push({ level: 'info', text: `Floor plan check: ${id} was edited on the Plan page — against the drawing's ${sym} columns, ${diff}.` }); return; }
      // the other joist direction, if it is the one that matches
      const alt = c.lay.alt && c.lay.alt.mezzCols, altOk = alt && drawn.length === alt.filter(inFp).length && drawn.every(d => alt.some(q => Math.hypot(q.x - d.x, q.y - d.y) <= 1.5));
      r.warn.unshift({ level: 'stop', text: `Floor plan check: the layout of ${id} does not match the PCS drawing's ${sym} mezzanine columns — ${diff}. ${altOk ? 'The other joist direction matches the drawing: switch it on the Plan page.' : 'Do not use this layout until it matches: check the building data (Box 2 / Box 5), then set the columns on the Plan page.'}` });
    });
  }

  /* The engineer's layout edits on the Plan page, after the drawing: a column made a frame column (its beam reactions go
     to the frame design) or a mezzanine column (designed on the Column sheet), and columns taken out (the beam spans
     through). kinds: { 'x,y': 'frame' | 'mezz' } */
  function userColumns(lay, kinds, grid, warn) {
    const F = PCS.fmtFtIn, k = sp => `${(+sp.x).toFixed(2)},${(+sp.y).toFixed(2)}`;
    [lay, lay.alt].filter(Boolean).forEach((L, li) => {
      if (kinds) L.supports.forEach(sp => {
        const want = kinds[k(sp)];
        if (!want || sp.building === (want === 'frame')) return;
        sp.building = want === 'frame'; sp.userKind = want;
        if (li) return;
        const fi = grid.xs.findIndex(x => Math.abs(x - sp.x) < 0.05), member = LAYOUT.isBuildingColumn(grid, sp.x, sp.y);
        warn.push({ level: 'key', text: sp.building
          ? `${sp.label}: made a frame column on the Plan page — its beam reactions go to the frame design${member ? '' : fi >= 0 ? `; frame line ${grid.xLabel(sp.x)} has no column at ${F(sp.y)}: add it in NBG Frame` : ' — it is not on a frame line: the load goes to whatever carries it there'}.`
          : `${sp.label}: made a mezzanine column on the Plan page — designed on the Column sheet; the frame takes no mezzanine load there.` });
      });
      L.mezzCols = L.supports.filter(sp => !sp.building);
    });
    (lay.dropped || []).forEach(d => {
      const b = lay.beams.find(x => Math.abs(x.line - d.line) < 1e-6 && x.from < (lay.joists === 'y' ? d.x : d.y) && x.to > (lay.joists === 'y' ? d.x : d.y));
      warn.push({ level: 'key', text: `${d.label}: column taken out on the Plan page — the beam spans through${b ? `, ${F(b.span)}` : ''}.` });
    });
  }

  /* The floor plan decides frame vs mezzanine column where it disagrees with the building data (Box 2 / Box 5):
     ⊗ or a circled I is a mezzanine column; a bare I, or ✱ ("Most Economical" interior frame column), is a building
     column whose beam reactions go to the frame design. Every support also keeps the symbol drawn at it. */
  const MEZZ_SYM = { x: '⊗', s: '⊘', i: 'circled I' };
  // the floor plan's column symbols in building ft; a wall column's I is drawn about 1'-9" inside the steel line, and an
  // end frame's ✱ about 1'-4" inside its endwall: they stand on the wall line
  function planSymbols(planCols, grid) {
    if (!planCols || !planCols.length) return null;
    const W = grid.width, Lg = grid.length, wall = (v, ends) => { const e = ends.find(u => Math.abs(v - u) < 2.6); return e == null ? v : e; };
    return planCols.map(c => (c.kind === 'I' ? { ...c, x: wall(c.x, [0, Lg]), y: wall(c.y, [0, W]) } : c.kind === 'star' ? { ...c, x: wall(c.x, [0, Lg]) } : c));
  }
  function readColumnSymbols(lay, planCols, grid, warn) {
    if (!planCols || !planCols.length) return;
    const W = grid.width, Lg = grid.length, syms = planSymbols(planCols, grid);
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
    // spans are kept to 0.001 ft, so a neighbour edge over the whole span may end a hair short of L
    if (extras.every(x => x.s <= 1e-3 && x.e >= L - 1e-3)) return base + extras.reduce((a, x) => a + x.trib, 0);
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
    // a beam as the pair sees it: in its own building, or an attached building's beam in the host's coordinates
    const ident = b => ({ dir: b.dir, line: b.line, from: b.from, to: b.to, flip: false });
    const viaSite = map => b => {
      const p = (u, line) => (b.dir === 'x' ? map.toHost(u, line) : map.toHost(line, u));
      const a = p(b.from, b.line), z = p(b.to, b.line);
      return b.dir === 'x' ? { dir: 'x', line: a.y, from: Math.min(a.x, z.x), to: Math.max(a.x, z.x), flip: a.x > z.x } : { dir: 'y', line: a.x, from: Math.min(a.y, z.y), to: Math.max(a.y, z.y), flip: a.y > z.y };
    };
    for (let i = 0; i < ctxs.length; i++) for (let j = i + 1; j < ctxs.length; j++) {
      const ci = ctxs[i], cj = ctxs[j];
      if (ci.incomplete || cj.incomplete) continue;
      let pi = ident, pj = ident, hostOwns = null;
      if (ci.bkey === cj.bkey) { /* one building */ }
      else if (cj.site && cj.site.host === ci.bkey) { pj = viaSite(cj.site.map); hostOwns = ci; }
      else if (ci.site && ci.site.host === cj.bkey) { pi = viaSite(ci.site.map); hostOwns = cj; }
      else continue;
      const P = new Map();
      const pr = (c, b) => { const k = c.index + ':' + b.id; if (!P.has(k)) P.set(k, (c === ci ? pi : pj)(b)); return P.get(k); };
      const keyOf = q => q.dir + ':' + q.line.toFixed(2);
      const lines = new Set(ci.lay.beams.map(b => keyOf(pr(ci, b))));
      lines.forEach(key => {
        const on = c => c.lay.beams.filter(b => !b.absorbed && keyOf(pr(c, b)) === key);
        const bi = on(ci), bj = on(cj);
        if (!bj.length || !bi.some(a => bj.some(b => ov(pr(ci, a), pr(cj, b)) > 0.25))) return;
        const ext = bs => bs.reduce((a, b) => a + b.span, 0);
        // across attached buildings the host keeps the line (its columns carry it); in one building, the longer side
        const [own, oc, sub, sc] = hostOwns ? (hostOwns === ci ? [bi, ci, bj, cj] : [bj, cj, bi, ci]) : ext(bi) >= ext(bj) - 1e-6 ? [bi, ci, bj, cj] : [bj, cj, bi, ci];
        sub.forEach(b => {
          const qb = pr(sc, b), cover = own.filter(o => ov(pr(oc, o), qb) > 1e-6);
          if (cover.reduce((a, o) => a + ov(pr(oc, o), qb), 0) < b.span - 0.05) {
            if (cover.length) [oc, sc].forEach(c => c.warn.push({ level: 'warn', text: `Beams of ${oc.id} and ${sc.id} overlap on the line at ${PCS.fmtFtIn(b.line)} with different supports — frame that line by hand.` }));
            return;
          }
          const ratio = Math.max(qD(oc) ? qD(sc) / qD(oc) : 1, qL(oc) ? qL(sc) / qL(oc) : 1);
          b.absorbed = { mi: oc.index, mezz: oc.id, into: cover.map(o => o.id) };
          cover.forEach(o => {
            const qo = pr(oc, o), lo = Math.max(qo.from, qb.from), hi = Math.min(qo.to, qb.to);
            const s0 = qo.flip ? qo.to - hi : lo - qo.from, e0 = qo.flip ? qo.to - lo : hi - qo.from;   // along the owner beam, its own way
            (o.extra = o.extra || []).push({ mi: sc.index, mezz: sc.id, beam: b.id, tribOwn: b.tribOwn, trib: b.tribOwn * ratio, ratio, s: s0, e: e0 });
          });
          merges.push({ line: b.line, dir: b.dir, from: b.from, to: b.to, owner: oc.index, ownerId: oc.id, sub: sc.index, subId: sc.id, trib: b.tribOwn, ratio, into: cover.map(o => o.id), across: !!hostOwns });
        });
      });
    }
    ctxs.forEach(c => { if (c.incomplete) return; c.lay.beams.forEach(o => { if (o.extra) o.trib = Math.round(equivTrib(o.span, o.tribOwn, o.extra) * 1000) / 1000; }); });
    // notes on both sides of every merge: one a beam line (the beams of a line that do the same thing, together)
    const rangeTxt = (fl, xs) => { const lo = Math.min(...xs.map(x => x.from)), hi = Math.max(...xs.map(x => x.to)); return `${fl(lo) || PCS.fmtFtIn(lo)} → ${fl(hi) || PCS.fmtFtIn(hi)}${xs.length > 1 ? `, ${xs.length} beams` : ''}`; };
    const byKey = (list, key) => { const g = new Map(); list.forEach(x => { const k = key(x); g.set(k, (g.get(k) || []).concat(x)); }); return [...g.values()]; };
    byKey(merges, m => [m.sub, m.owner, m.dir, m.line.toFixed(3), m.trib.toFixed(3)].join('|')).forEach(ms => {
      const m = ms[0], sc = ctxs[m.sub], lab = (m.dir === 'x' ? sc.grid.yLabel(m.line) : sc.grid.xLabel(m.line)) || PCS.fmtFtIn(m.line);
      const fl = m.dir === 'x' ? sc.grid.xLabel : sc.grid.yLabel, many = ms.length > 1;
      sc.warn.push({ level: 'key', text: `Edge beam${many ? 's' : ''} on line ${lab} (${rangeTxt(fl, ms)}) ${many ? 'are' : 'is'} the ${m.ownerId} beam${many ? 's' : ''} on the same line — ${many ? 'their' : 'its'} ${PCS.fmtFtIn(m.trib)} trib is carried there, not counted here.` });
    });
    ctxs.forEach(c => {
      if (c.incomplete) return;
      const fl = c.lay.joists === 'y' ? c.grid.xLabel : c.grid.yLabel;
      const partOf = o => x => `${x.mezz} ${PCS.fmtFtIn(x.tribOwn)}${x.ratio > 1 + 1e-9 ? ` × ${x.ratio.toFixed(2)} (heavier loads)` : ''}${x.e - x.s < o.span - 0.05 ? ` over ${PCS.fmtFtIn(x.e - x.s)} of ${PCS.fmtFtIn(o.span)}` : ''}`;
      byKey(c.lay.beams.filter(o => o.extra), o => [o.line.toFixed(3), o.tribOwn.toFixed(3), o.trib.toFixed(3), o.extra.map(partOf(o)).join('+')].join('|')).forEach(os => {
        const o = os[0], lab = (c.lay.joists === 'y' ? c.grid.yLabel(o.line) : c.grid.xLabel(o.line)) || PCS.fmtFtIn(o.line), many = os.length > 1;
        c.warn.push({ level: 'key', text: `Beam${many ? 's' : ''} on line ${lab} (${rangeTxt(fl, os)}) also carr${many ? 'y' : 'ies'} ${o.extra.map(partOf(o)).join(' + ')}: trib ${PCS.fmtFtIn(o.tribOwn)} → ${PCS.fmtFtIn(o.trib)}${o.extra.some(x => x.e - x.s < o.span - 0.05) ? ' (uniform trib with the same max moment and end shear)' : ''}.` });
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
        // by where the beam is: on the floor's edge with joists one side (exterior), or joists both sides (interior) —
        // an interior line added near the edge keeps its name even when its trib is the smaller
        sets = [[bs.filter(x => !x.edgeOnly), 'interior'], [bs.filter(x => x.edgeOnly), 'exterior']].filter(([xs]) => xs.length);
        if (sets.length === 1) sets[0][1] = '';
      } else if (mode === 'split') {
        // at most 4 marks (MB1..MB4): the lightest-loaded groups are carried by the next heavier mark — kept, to be said
        sets = LAYOUT.beamMarks(bs.map((x, i) => ({ id: i, span: x.span, trib: x.trib })), 'split').map(m => [m.beams.map(u => bs[u]), '', false, (m.merged || []).map(q => ({ span: q.span, trib: q.trib, covered: q.covered, beams: q.beams.map(u => bs[u]) }))]);
      } else sets = [[bs, '']];
      // a long beam given its own mark (Beam calc → "Give the … beam its own mark"): only those beams leave their mark,
      // every other mark stays as it was
      const own = (g.ctxs[0].s.ownSpan || []).map(Number).filter(v => v > 0);
      // the marks keep the names they had before (numbered by the whole set's span × trib); the own mark takes the next
      // free number — so a section picked by hand on a mark stays on that mark
      const keyOf = xs => Math.max(...xs.map(x => x.span)) * Math.max(...xs.map(x => x.trib));
      sets = sets.map(([xs, kind, , merged]) => [xs, kind, false, merged, keyOf(xs)]);
      if (own.length) sets = sets.flatMap(([xs, kind, , merged, k0]) => {
        const isOwn = x => own.some(v => Math.abs(x.span - v) < 1e-3), rest = xs.filter(x => !isOwn(x));
        return rest.length && rest.length < xs.length ? [[rest, kind, false, merged, k0], [xs.filter(isOwn), kind, true, null, k0]] : [[xs, kind, false, merged, k0]];
      });
      sets.forEach(([xs, kind, ownMark, merged, k0]) => marks.push({ group: g, groupKey: g.key, kind, own: !!ownMark, sortKey: k0, merged: merged && merged.length ? merged : null, beamsAll: xs, span: Math.max(...xs.map(x => x.span)), trib: Math.max(...xs.map(x => x.trib)) }));
    });
    marks.sort((a, b) => (a.own ? 1 : 0) - (b.own ? 1 : 0) || b.sortKey - a.sortKey || (a.kind === 'interior' ? -1 : 1));
    marks.forEach((m, i) => { m.mark = 'MB' + (i + 1); m.index = i; m.qtyAll = m.beamsAll.length; m.mezzIds = [...new Set(m.beamsAll.map(x => x.mi))]; });
    return marks;
  }

  /* The frame column setback at each end of a beam. A beam that runs into a wall ends at that wall's column, and the
     girts hold the column inside the steel line (the grid line), so the beam stops short of the grid by the girts and
     the column: 1'-4" at a rigid frame column, 1'-0" at a post-and-beam column (Settings; a soldier column between
     sidewall frames counts as a post). The wall is the one the beam runs into: a sidewall for a beam across the
     building, an endwall for one along it. A beam running along a wall, an interior column (on its grid line) and a
     mezzanine column take none. */
  function beamEnds(c, id, s) {
    const L = c.lay, g = c.grid, W = g.width, Lg = g.length, near = (a, v) => Math.abs(a - v) < 0.05;
    const frames = c.inp.building.frames || [], across = L.joists === 'x';   // joists along x: the beams run across (y)
    const frameAt = x => { const fi = g.xs.findIndex(v => near(v, x)); return fi < 0 ? null : frames.find(f => fi + 1 >= f.from && fi + 1 <= f.to) || null; };
    const amt = { rigid: +s.setbackRigid || 0, pb: +s.setbackPB || 0 };
    return L.supports.filter(sp => sp.beams.L === id || sp.beams.R === id).map(sp => {
      const at = { label: sp.label, x: sp.x, y: sp.y, kind: null, ft: 0 };
      if (!sp.building) return { ...at, why: 'mezzanine column' };
      const wall = across ? (near(sp.y, 0) ? 'FSW' : near(sp.y, W) ? 'BSW' : null) : (near(sp.x, 0) ? 'LEW' : near(sp.x, Lg) ? 'REW' : null);
      if (!wall) return { ...at, why: (across ? near(sp.x, 0) || near(sp.x, Lg) : near(sp.y, 0) || near(sp.y, W)) ? 'the beam runs along the wall' : 'interior column, on its grid line' };
      const fr = frameAt(sp.x), kind = fr && !/post|bearing/i.test(fr.type || '') ? 'rigid' : 'pb';
      return { ...at, kind, wall, ft: amt[kind], why: `${wall} column, ${fr ? `${kind === 'rigid' ? 'rigid frame' : 'post-and-beam'} (${fr.type})` : 'soldier column (a post)'}` };
    });
  }

  /* Nothing passes for a mark: what the engineer can do next, in this order — neither is applied until picked.
     1. The frame column setback: the beams that frame into building columns are shorter than their grid span. Designed
        at that clear span (the longest of the mark's beams, each less its own setbacks), does a section pass?
     2. More clear height: the beam that takes the least room — its depth plus its total-load sag — and the clearance C,
        or the floor height A, it needs: a request to the estimator. With the setback when it is in use, or offered and
        not enough on its own; at the grid span when the setback alone does it (the other way, then). */
  function rescueMark(m, members, p, o) {
    const { s, c0, maxDepth, dSpan, sbSpan } = o, F = PCS.fmtFtIn, F2 = v => String(+(+v).toFixed(2));
    const search = (L, extra) => DESIGN.designBeam({ ...p, L }, { division: c0.division, target: s.target, dMin: s.dMin, dMax: s.dMax, symmetric: s.symmetric, requireConc: s.requireConc, production: s.production !== false, ...extra });
    // the building columns the mark's beams frame into, by setback: "2/A, 3/A (BSW column of frame 2 …) 1'-4""
    const ends = [];
    m.beamsAll.forEach(x => (x.ends || []).filter(e => e.ft > 0).forEach(e => {
      const c = members.find(k => k.index === x.mi), key = x.mi + '|' + e.label;
      if (!ends.some(q => q.key === key)) ends.push({ key, mi: x.mi, mezz: c ? c.id : '', label: e.label, kind: e.kind, wall: e.wall, ft: e.ft, why: e.why });
    }));
    // offer: it would shorten the design span · applied: in use, and still nothing passes · typed: a design span typed on
    // Beam calc is already at or under the clear span · none: no beam frames into a frame column's face · short: only
    // shorter beams do, the longest keep the span
    const state = m.design.setback ? 'applied' : sbSpan < dSpan - 1e-3 ? 'offer' : !ends.length ? 'none' : m.design.set && dSpan <= sbSpan + 1e-3 ? 'typed' : 'short';
    let setback = { state, span: state === 'applied' ? dSpan : sbSpan, from: m.span, ends, best: null };
    if (state === 'offer') {
      const dz = search(sbSpan, { maxDepth: maxDepth ?? undefined, room: o.room ?? undefined });
      setback.best = dz && dz.best ? dz.best : null;
    }
    // the clear-height route is with the setback when it is in use or offered and not enough; when the setback alone
    // does it, the route is the other way — at the span as it is
    const withSb = state === 'applied' || (state === 'offer' && !setback.best);
    // more depth: each mezzanine of the mark with a clearance C has its own A, C, slab and seat — the request is the
    // strictest of them
    let clear = null;
    const capped = members.filter(c => c.Cq != null && c.A != null);
    if (o.room != null && capped.length) {
      // what a beam of depth d and total-load sag tl needs, per mezzanine: C lowered to A − slab − seat − d − tl (on the
      // 1/8" grid, never more than that) or A raised to C + slab + seat + d + tl (on the grid, never less)
      const L = state === 'offer' && withSb ? sbSpan : dSpan, need = (d, tl) => {
        const per = capped.map(c => { const tot = c.slabIn + c.seatIn + d + tl; return { mi: c.index, id: c.id, A: c.A, C: c.Cq, slabIn: c.slabIn, seatIn: c.seatIn, needC: Math.floor((c.A * 12 - tot) * 8 + 1e-6) / 96, needA: Math.ceil((c.Cq * 12 + tot) * 8 - 1e-6) / 96 }; });
        return { needC: Math.min(...per.map(q => q.needC)), needA: Math.max(...per.map(q => q.needA)), per };
      };
      // the beam alone, with no clearance: of every section that passes and takes more room than there is (a request
      // always asks for more than now), the one that takes the least — its depth plus its sag — so the least clear height
      // to give up; and the lightest that takes up to 6" more
      const at = Lx => {
        const dz = search(Lx, {}), ok = (dz.all || []).map(e => ({ e, need: e.d + e.r.defl.TL })).filter(x => x.need > o.room + 1e-3);
        if (!ok.length) return { span: Lx, none: true, dMax: s.dMax };
        const f = ok.slice().sort((a, b) => a.need - b.need || a.e.r.res.Wt - b.e.r.res.Wt)[0];
        const lt = ok.filter(x => x.need <= f.need + 6 && x.e.r.res.Wt < f.e.r.res.Wt - 1e-9).sort((a, b) => a.e.r.res.Wt - b.e.r.res.Wt)[0];
        const first = DESIGN.summarize(f.e), light = lt ? { ...DESIGN.summarize(lt.e), ...need(lt.e.d, lt.e.r.defl.TL) } : null;
        return { span: Lx, d: first.d, dTL: first.dTL, needIn: first.need, best: first, ...need(first.d, first.dTL), light };
      };
      // the room for the beam, term by term, on the mezzanine that has the least: A − C − slab & deck − joist seat
      const roomOf = c => (c.A - c.Cq) * 12 - c.slabIn - c.seatIn, tight = capped.reduce((a, c) => (roomOf(c) < roomOf(a) - 1e-9 ? c : a));
      const stack = { mi: tight.index, id: tight.id, A: tight.A, C: tight.Cq, slabIn: tight.slabIn, seatIn: tight.seatIn, room: roomOf(tight) };
      // nothing passes even with all the room it wants: the clear height is not what stops it (the span or trib is)
      const first = at(L);
      if (!first.none) clear = { withSetback: withSb, A: Math.min(...capped.map(c => c.A)), C: Math.min(...capped.map(c => c.Cq)), cap: maxDepth, stack, ...first };
      if (clear && state === 'offer' && withSb) clear.grid = at(dSpan);
      // the request, ready to send
      const span = F(L), mezz = [...new Set(capped.map(c => (/^\d+$/.test(c.id) ? 'Mezzanine ' + c.id : c.id)))].join(' / ');
      if (clear) clear.request = `${mezz}: ${m.mark} (${m.qtyAll} beam${m.qtyAll > 1 ? 's' : ''}, ${span}${withSb ? ` clear span with the frame column setback` : ' span'} × ${F(m.design.trib)} trib) has no beam section that fits, with its total-load sag, in the ${F2(stack.room)}" the clear height under the mezzanine beams leaves (C ${F(clear.C)}, floor at ${F(clear.A)}). Requesting C ${F(clear.needC)} clear under the beams, or the floor raised to ${F(clear.needA)}: a ${clear.d}" beam (${clear.best.desc}, ${F2(clear.dTL)}" sag) then works.`;
    }
    return { setback, clear, cap: clear ? maxDepth : null };
  }

  /* one mark: section search → three options → the pick (stored as intent) → MB-sheet runs at every span in it */
  function designMark(m) {
    const members = m.group.ctxs.filter(c => m.mezzIds.includes(c.index)), c0 = members[0], s = c0.s, ed = c0.ed;
    const say = (level, text, tag) => members.forEach(c => c.warn.push(tag ? { level, text, tag } : { level, text }));
    const caps = members.map(c => c.maxDepthByC).filter(v => v != null), maxDepth = caps.length ? Math.min(...caps) : null;
    const rooms = members.map(c => c.roomIn).filter(v => v != null), room = rooms.length ? Math.min(...rooms) : null;
    const jd = members.map(c => c.joistDepthIn).filter(v => v != null), dLimit = jd.length ? Math.floor(Math.min(...jd) + 1e-6) : null;
    // the design span / trib set on the Beam calc page (e.g. the member length between column faces): they go on the MB
    // sheet only. The plan, the columns and the loads to the frame keep the layout's spans and tribs. A typed span's
    // change is applied to every member length of the mark; with the frame column setback ("setback" on the mark) each
    // member length is its layout length less its own setbacks, and the mark is designed at the longest of them
    m.beamsAll.forEach(x => { const c = members.find(k => k.index === x.mi); x.ends = c ? beamEnds(c, x.id, s) : []; x.sb = x.ends.reduce((a, e) => a + e.ft, 0); });
    const sbSpan = Math.max(...m.beamsAll.map(x => x.span - x.sb));
    const mi = s.markInput && s.markInput[m.mark];
    const useSb = !!(mi && mi.setback) && sbSpan < m.span - 1e-6;
    const dSpan = useSb ? sbSpan : mi && +mi.span > 0 ? +mi.span : m.span, dTrib = mi && +mi.trib > 0 ? +mi.trib : m.trib, cut = m.span - dSpan;
    m.design = { span: dSpan, trib: dTrib, cut, set: dSpan !== m.span || dTrib !== m.trib, setback: useSb, sbSpan };
    // a member length on the MB sheet: the longest of these beams less their own setbacks, or less the design span's cut
    const lenOf = xs => Math.max(1, useSb ? Math.max(...xs.map(x => x.span - (x.sb || 0))) : Math.max(...xs.map(x => x.span)) - cut);
    const p = { ...c0.beamBase, L: dSpan, trib: dTrib };
    const dz = DESIGN.designBeam(p, { division: c0.division, target: s.target, dMin: s.dMin, dMax: s.dMax, symmetric: s.symmetric, requireConc: s.requireConc, maxDepth: maxDepth ?? undefined, room: room ?? undefined, production: s.production !== false });
    // the clearance caps the depth: what more depth would give (each needs C lowered to suit) — shown when the capped
    // search leaves fewer than three different designs
    let deeper = null;
    if (dz && dz.best && maxDepth != null && maxDepth < s.dMax) {
      const up = DESIGN.designBeam(p, { division: c0.division, target: s.target, dMin: s.dMin, dMax: Math.min(s.dMax, maxDepth + 6), symmetric: s.symmetric, requireConc: s.requireConc, production: s.production !== false });
      const A = Math.min(...members.map(c => c.A)), lose = Math.max(...members.map(c => c.slabIn + c.seatIn));
      // C to ask for, on the 1/8" grid and never more than the beam leaves: A − slab − seat − depth − sag
      deeper = up.byDepth.filter(z => !z.none && z.wt < dz.best.wt - 1e-9 && z.need > room + 1e-3).map(z => ({ ...z, needC: Math.floor((A * 12 - lose - z.need) * 8 + 1e-6) / 96 }));
    }
    const options = dz ? DESIGN.beamOptions(dz, { dLimit, span: dSpan, deeper }) : [];
    // a pick is stored as intent — an option key or a depth — so every input change re-runs the search:
    //   { key: 'fit' } → that option for the current loads; { d: 20 } → lightest passing section at 20";
    //   { sec } → that exact section (checked, flagged if it fails)
    const ov = s.override && s.override[m.mark];
    const preferred = options.find(o => o.key === ((ov && ov.key) || s.optionDefault));
    const atDepth = ov && ov.d != null && dz ? dz.byDepth.find(z => z.d === +ov.d && !z.none) : null;
    const chosen = ov && ov.sec ? DESIGN.secDims(ov.sec) : atDepth ? atDepth.sec : preferred ? preferred.pick.sec : dz && dz.best ? dz.best.sec : null;
    if (ov && ov.d != null && !atDepth && chosen) say('warn', `${m.mark}: nothing passes at ${ov.d}" deep for these loads — back to the ${preferred ? preferred.label.toLowerCase() : 'lightest'} section.`);
    if (ov && ov.key && !options.some(o => o.key === ov.key) && chosen) say('info', `${m.mark}: no ${ov.key} option for these inputs — using the lightest.`);
    const check = chosen ? MZ.beamCheck({ ...p, sec: chosen }, WF) : null;
    const same = (a, b) => a && b && ['d', 'tw', 'bof', 'tof', 'bif', 'tif'].every(k => a[k] === b[k]);
    const optionKey = (options.find(o => same(o.pick.sec, chosen)) || {}).key || (chosen ? 'custom' : null);
    const Fi = PCS.fmtFtIn;
    // Beam marks "split by trib / span" keeps at most four marks: a lighter group carried by this mark costs weight — said, with how much
    if (m.merged && check) m.merged.forEach(q => {
      const dzq = DESIGN.designBeam({ ...c0.beamBase, L: lenOf(q.beams), trib: q.trib }, { division: c0.division, target: s.target, dMin: s.dMin, dMax: s.dMax, symmetric: s.symmetric, requireConc: s.requireConc, maxDepth: maxDepth ?? undefined, room: room ?? undefined, production: s.production !== false });
      const n = q.beams.length, len = q.beams.reduce((a, x) => a + x.span, 0), own = dzq && dzq.best, dW = own ? (check.res.Wt - own.wt) * len : 0;
      say('key', `${m.mark} also carries ${n} beam${n > 1 ? 's' : ''} of ${n > 1 ? 'up to ' : ''}${Fi(q.span)} × ${Fi(q.trib)} trib: Beam marks "split by trib / span" keeps at most four marks (MB1–MB4 of one MB workbook), so the lightest-loaded group rides on ${m.mark}${q.covered ? ', whose span and trib already cover it' : ', raising its design point to cover it'}${own && dW > 1 ? ` — on their own they would be ${own.desc}, about ${Math.round(dW).toLocaleString('en-US')} lb lighter` : ''}.`);
    });
    if (m.own) say('key', `${m.mark}: the ${[...new Set(m.beamsAll.map(x => +x.span.toFixed(4)))].sort((a, b) => b - a).map(Fi).join(' and ')} beam${m.beamsAll.length > 1 ? 's' : ''} given ${m.beamsAll.length > 1 ? 'their' : 'its'} own mark on Beam calc — the shorter ${m.kind ? m.kind + ' ' : ''}beams keep their mark.`);
    if (check && ov && ov.sec) {
      const okB = check.res.CSR <= s.target && check.res.SRvx <= s.target && check.llOK && check.tlOK && (!check.conc || check.conc.ok);
      if (!okB) say('stop', `${m.mark}: ${check.desc}, the section picked by hand, does not pass for these loads (${[!(check.res.CSR <= s.target) ? `combined ${check.res.CSR.toFixed(3)}` : '', !(check.res.SRvx <= s.target) ? `shear ${check.res.SRvx.toFixed(3)}` : '', !check.llOK ? `live deflection L/${Math.round(check.defl.rLL)} < L/360` : '', !check.tlOK ? `total deflection L/${Math.round(check.defl.rTL)} < L/240` : '', check.conc && !check.conc.ok ? 'joist bearing' : ''].filter(Boolean).join(', ')}) — pick another or go back to an option.`);
    }
    if (!chosen) {
      // the mark fails at its longest beam: when its other beams are shorter, giving the long one(s) its own mark
      // (Settings → Beam marks → split by trib / span) keeps the rest sized — say so
      const lens = m.beamsAll.map(x => x.span), longest = Math.max(...lens), nLong = lens.filter(v => v > longest - 1e-3).length;
      if (nLong < lens.length) {
        // would the shorter beams pass on their own? only then is giving the long one(s) their own mark worth offering
        const rest = lenOf(m.beamsAll.filter(x => x.span < longest - 1e-3));
        const dzr = DESIGN.designBeam({ ...c0.beamBase, L: rest, trib: dTrib }, { division: c0.division, target: s.target, dMin: s.dMin, dMax: s.dMax, symmetric: s.symmetric, requireConc: s.requireConc, maxDepth: maxDepth ?? undefined, room: room ?? undefined, production: s.production !== false });
        if (dzr && dzr.best) {
          m.splitHelps = { span: longest, n: nLong, rest: lens.length - nLong, restDesc: dzr.best.desc || (dzr.best.r && dzr.best.r.desc) || '' };
          say('warn', `${m.mark}: its ${nLong === 1 ? 'one' : nLong} ${PCS.fmtFtIn(longest)} beam${nLong > 1 ? 's set' : ' sets'} the design and nothing passes there; the other ${lens.length - nLong} ${m.mark} beams are shorter and would pass on their own (${m.splitHelps.restDesc}). Give the ${PCS.fmtFtIn(longest)} beam${nLong > 1 ? 's' : ''} ${nLong > 1 ? 'their' : 'its'} own mark (the button on Beam calc) to size the rest, and the columns they carry — no other mark changes.`, 'nosec');
        }
      }
      const cap = maxDepth != null && maxDepth < s.dMax;
      // what next, in order: the frame column setback, then more clear height (Design page → Beam options)
      const rs = m.rescue = rescueMark(m, members, p, { s, c0, maxDepth, room, dSpan, sbSpan });
      const F = PCS.fmtFtIn, sb = rs.setback, cl = rs.clear;
      const next = [sb.state === 'offer' ? (sb.best ? `the frame column setback — at the ${F(sb.span)} clear span ${sb.best.desc} passes and fits with its sag (${sb.best.d}" + ${sb.best.dTL.toFixed(2)}")` : `the frame column setback (${F(sb.span)} clear span) does not do it on its own`) : sb.state === 'applied' ? `the frame column setback is in use (${F(sb.span)} clear span)` : '',
        cl && !cl.none ? `more clear height${cl.withSetback && sb.state === 'offer' ? ' with the setback' : ''} — a ${cl.d}" beam (${cl.dTL.toFixed(2)}" sag) needs C ${F(cl.needC)} (now ${F(cl.C)}) or the floor at ${F(cl.needA)}` : ''].filter(Boolean);
      say('stop', cap && maxDepth < s.dMin
        ? `${m.mark}: clearance (C) under the floor beams leaves only ${maxDepth}" of beam depth (A − C − slab − seat) — below the ${s.dMin}" minimum. ${next.length ? `What next (the card at the top of the Design page): ${next.join('; or ')}.` : 'Check the clearance or the minimum depth in Settings.'}`
        : `${m.mark}: no stocked BU section between ${s.dMin}" and ${Math.min(s.dMax, maxDepth ?? Infinity)}" deep meets SR ≤ ${s.target}, L/360 and L/240${cap || cl ? ` and fits the ${+(+room).toFixed(2)}" of room under clearance C with its total-load sag` : ''}. ${next.length ? `What next (the card at the top of the Design page): ${next.join('; or ')}. Otherwise shorten the span (put a column back) or add a beam line to cut the trib.` : cap ? `Clearance C caps it at ${maxDepth}": lower C, shorten the span (put a column back) or add a beam line to cut the trib.` : 'Widen the depth range, shorten the span or cut the trib.'}`, 'nosec');
    }
    // every member length in the mark: the governing run plus the shorter beams (same section, own MB-sheet run)
    const spans = [];   // distinct member lengths, kept exact (12'-4" = 12.3333 ft, not 12.333)
    m.beamsAll.forEach(x => { if (!spans.some(L => Math.abs(L - x.span) < 1e-3)) spans.push(x.span); });
    spans.sort((a, b) => b - a);
    // span: the layout length (which beams are in the run); L: the length on the MB sheet (the design span's change applied)
    const spanRuns = chosen ? spans.map(Ly => {
      const xs = m.beamsAll.filter(x => Math.abs(x.span - Ly) < 1e-3), L = lenOf(xs);
      const ck = Math.abs(L - dSpan) < 1e-6 ? check : MZ.beamCheck({ ...p, L, sec: chosen }, WF);
      return { span: Ly, L, qty: xs.length, check: ck, params: { ...p, L } };
    }).sort((a, b) => b.L - a.L || b.span - a.span) : [];
    const F = PCS.fmtFtIn;
    if (m.design.set) say('key', `${m.mark} is designed at ${F(dSpan)} span${cut ? ` (layout ${F(m.span)}; ${cut > 0 ? '−' : '+'}${F(Math.abs(cut))} on every member length of the mark)` : ''} × ${F(dTrib)} trib${dTrib !== m.trib ? ` (layout ${F(m.trib)})` : ''}, set on the Beam calc page. The plan, the columns and the loads to the frame stay at the layout spans and tribs.`);
    spanRuns.filter(r => r.check !== check).forEach(r => {
      const c = r.check, ok = c.res.CSR <= s.target && c.res.SRvx <= s.target && c.llOK && c.tlOK;
      say(ok ? 'key' : 'stop', `${m.mark} also has ${r.qty} beam${r.qty > 1 ? 's' : ''} at ${F(r.span)} — same ${check.desc}; MB sheet at member length ${F(r.L)}: combined ${c.res.CSR.toFixed(2)}, shear ${c.res.SRvx.toFixed(2)}, L/${Math.round(c.defl.rLL)}.`);
    });
    Object.assign(m, { params: p, search: dz, options, deeper, optionKey, pinned: ov || null, sec: chosen, check, desc: check ? check.desc : null, spanRuns, maxDepth, dLimit });
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
    if (maxDepthByC != null && maxDepthByC < s.dMax && maxDepthByC >= s.dMin) warn.push({ level: 'key', text: `Clearance (C) ${PCS.fmtFtIn(Cq)} leaves ${+c.roomIn.toFixed(2)}" for the beam and its sag (A − C − slab − seat): a section fits when its depth plus its total-load deflection is within that.` });
    c.designed = designed;
    c.markOf = id => designed.find(mk => mk.beams.includes(id));
    // clearances (INPUT sheet)
    const { A, Bq, slabIn, seatIn } = c;
    const dBeam = Math.max(0, ...designed.filter(mk => mk.sec).map(mk => mk.sec.d));
    // C at midspan: the beam bottom sags by its total-load deflection (the MB sheet's TOTAL LOAD max deflection), so the
    // lowest point is the depth plus the sag — taken on this mezzanine's own member lengths (each MB-sheet run of a mark
    // with a beam here); the sheet's own C row (prov) uses the depth alone
    const sag = designed.filter(mk => mk.sec).flatMap(mk => (mk.spanRuns || []).filter(run => run.check && (mk.beamsAll || []).some(x => x.mi === c.index && Math.abs(x.span - run.span) < 1e-3))
      .map(run => ({ mk, d: mk.sec.d, tl: run.check.defl.TL, need: mk.sec.d + run.check.defl.TL, L: run.L }))).sort((a, b) => b.need - a.need)[0] || null;
    c.clear = {
      A: { req: A, prov: A },
      B: { req: Bq, prov: joistDepthIn != null && A != null ? A - (slabIn + joistDepthIn) / 12 : null },
      C: { req: Cq, prov: A != null && dBeam ? A - (slabIn + seatIn + dBeam) / 12 : null, mid: A != null && sag ? A - (slabIn + seatIn + sag.need) / 12 : null, sag: sag ? { mark: sag.mk.mark, desc: sag.mk.desc, d: sag.d, tl: sag.tl, L: sag.L } : null },
    };
    Object.entries(c.clear).forEach(([k, q]) => {
      const at = k === 'C' && q.mid != null ? q.mid : q.prov;
      q.ok = q.req == null || at == null ? null : at >= q.req - 1e-9;
      if (k === 'C') q.okSheet = q.req == null || q.prov == null ? null : q.prov >= q.req - 1e-9;   // the sheet's own verdict
      if (q.ok === false) warn.push({ level: 'stop', text: k === 'C' && sag ? `Clearance C at midspan: ${sag.mk.mark} ${sag.mk.desc} (${PCS.fmtFtIn(sag.L)} member) is ${sag.d}" deep and sags ${sag.tl.toFixed(2)}" under the total load, so its bottom is at ${PCS.fmtFtIn(q.mid)} — under the ${PCS.fmtFtIn(q.req)} asked for${q.okSheet ? ` (the MB sheet's C row, without the sag, shows ${PCS.fmtFtIn(q.prov)} OK)` : ''}.` : `Clearance ${k}: provided ${PCS.fmtFtIn(q.prov)} < requested ${PCS.fmtFtIn(q.req)}.` });
    });
    // a tight fit: the bottom of the beam at midspan within 1/8" of C — said, so the heights are confirmed before quoting
    const Cc = c.clear.C;
    if (Cc.ok && sag && Cc.req != null && Cc.mid != null && c.roomIn != null && (Cc.mid - Cc.req) * 12 < 0.125 - 1e-9) {
      const spare = (Cc.mid - Cc.req) * 12, dp = spare < 0.01 ? 3 : 2;
      warn.push({ level: 'warn', text: `Clearance C is tight: ${sag.mk.mark} ${sag.mk.desc} (${PCS.fmtFtIn(sag.L)} member) is ${sag.d}" deep and sags ${sag.tl.toFixed(dp)}" under the total load, ${sag.need.toFixed(dp)}" of the ${+c.roomIn.toFixed(3)}" of room — ${spare.toFixed(dp)}" to spare (C at midspan ${PCS.fmtFtIn(Cc.mid)}). Confirm A, C, the slab and the joist seat before quoting.` });
    }
    c.colLen = s.colLength === 'clear' && A != null && dBeam ? A - (slabIn + seatIn + dBeam) / 12 : A;
  }

  /* ---------- columns over the whole job: one column per location, every beam that frames in ---------- */
  function jobColumns(ctxs) {
    const at = new Map();
    ctxs.forEach(c => {
      if (c.incomplete) return;
      c.lay.supports.forEach(sp => {
        const key = c.bkey + '|' + sp.x.toFixed(2) + ',' + sp.y.toFixed(2);
        const e = at.get(key) || { key, bkey: c.bkey, x: sp.x, y: sp.y, building: sp.building, label: sp.label, planKind: sp.planKind || null, userKind: sp.userKind || null, ends: [], seenIn: [] };
        e.seenIn.push(c.index);
        ['L', 'R'].forEach(side => {
          const id = sp.beams[side];
          if (id == null || c.lay.beams[id].absorbed) return;
          e.ends.push({ mi: c.index, id, side, dir: c.lay.beams[id].dir });
        });
        at.set(key, e);
      });
    });
    // a beam's end reaction at the support on its `side` (L: the beam lies before the support, its `to` end). Slab past
    // the last support along the beam (an overhang framed on that line) is cantilevered to it: R = V (1 + 2a/L (1 + a/2L))
    const reaction = (c, id, side) => {
      const bm = c.lay.beams[id], mk = c.markOf(id);
      if (!mk || !mk.sec) return { D: NaN, L: NaN, mark: mk && mk.mark };
      const r = DESIGN.reactions({ ...c.beamBase, L: bm.span, trib: bm.trib }, mk.sec);
      const a = side && bm.ov ? bm.ov[side === 'L' ? 1 : 0] : 0, k = a > 0 ? 2 * a / bm.span * (1 + a / (2 * bm.span)) : 0;
      return { D: r.D * (1 + k), L: r.L * (1 + k), mark: mk.mark, ov: a };
    };
    const cols = [], frame = [];
    at.forEach(e => {
      if (e.building && e.ends.length) {
        // mezzanine beam reactions at a building column: the loads the frame / endwall design has to take
        const parts = e.ends.map(en => { const c = ctxs[en.mi], r = reaction(c, en.id, en.side); return { mi: en.mi, id: en.id, mezz: c.id, beam: 'B' + (c.bOff + en.id + 1), mark: r.mark, D: r.D, L: r.L, ov: r.ov }; });
        frame.push({ label: e.label, bkey: e.bkey, x: e.x, y: e.y, planKind: e.planKind, userKind: e.userKind, D: parts.reduce((a, p) => a + p.D, 0), L: parts.reduce((a, p) => a + p.L, 0), parts, seenIn: e.seenIn });
        return;
      }
      if (e.building || !e.ends.length) return;
      const parts = e.ends.map(en => { const c = ctxs[en.mi], r = reaction(c, en.id, en.side), bm = c.lay.beams[en.id]; return { ...en, mezz: c.id, D: r.D, L: r.L, mark: r.mark, ov: r.ov, beam: 'B' + (c.bOff + en.id + 1), area: (bm.tribOwn * bm.span + (bm.extra || []).reduce((a, x) => a + x.tribOwn * (x.e - x.s), 0)) / 2 + bm.tribOwn * (r.ov || 0) }; });
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
    // one Column-sheet case for columns whose four reactions agree within 0.01 k (not split on a rounding edge); the case
    // carries the largest of each, so it covers every column in it
    const LK = ['DL_L', 'LL_L', 'DL_R', 'LL_R'], key = q => LK.map(k => q[k].toFixed(2)).join('|');
    const close = (g, q) => LK.every(k => (isFinite(g.loads[k]) && isFinite(q[k]) ? Math.abs(g.first[k] - q[k]) <= 0.01 + 1e-9 : !isFinite(g.loads[k]) && !isFinite(q[k])));
    const groups = [];
    cols.forEach(q => { const g = groups.find(g2 => close(g2, q));
      if (g) { g.cols.push(q); LK.forEach(k => { if (isFinite(q[k])) g.loads[k] = Math.max(g.loads[k], q[k]); }); g.key = key(g.loads); }
      else groups.push({ key: key(q), cols: [q], first: { DL_L: q.DL_L, LL_L: q.LL_L, DL_R: q.DL_R, LL_R: q.LL_R }, loads: { DL_L: q.DL_L, LL_L: q.LL_L, DL_R: q.DL_R, LL_R: q.LL_R } }); });
    // the case's loads are the largest of each over its columns: whether they differ at all, and which column carries the most
    groups.forEach(g => { g.env = g.cols.some(q => LK.some(k2 => isFinite(q[k2]) && Math.abs(q[k2] - g.loads[k2]) > 5e-4)); g.gov = g.cols.slice().sort((a, b) => LK.reduce((t, k2) => t + (b[k2] || 0), 0) - LK.reduce((t, k2) => t + (a[k2] || 0), 0))[0]; });
    // a column under a beam with no section yet has unknown loads: it is not sized; every other case still is
    const known = l => [l.DL_L, l.LL_L, l.DL_R, l.LL_R].every(isFinite);
    const noBeam = cols.some(q => !known(q));
    groups.forEach(g => { g.known = known(g.loads); g.design = ed.colEd && colLen && g.known ? DESIGN.designColumn(g.loads, { L: colLen, includeW818: s.includeW818, edition: ed.colEd }, WF) : null; });
    const kg = groups.filter(g => g.known);
    // one section for every mezzanine column on the quote: the lightest W (same try order) that passes every sized group
    const allOK = kg.length && kg.every(g => g.design && g.design.name);
    const env = allOK && kg.length > 1 ? DESIGN.designColumn(kg.map(g => g.loads), { L: colLen, includeW818: s.includeW818, edition: ed.colEd }, WF) : null;
    const govCol = allOK ? (env ? (env.name ? { design: env } : null) : kg[0]) : null;
    let colFinal = null;
    // the engineer's pick (a W name, or a built-up column from Design your own / the Column page) over the automatic W
    const ov = s.colOverride, ovBU = !!(ov && typeof ov === 'object' && ov.type === 'BU');
    if (govCol || (ov && kg.length && colLen && ed.colEd)) {
      const sec = ovBU ? { type: 'BU', d: +ov.d, tw: +ov.tw, bof: +ov.bf, tof: +ov.tf, bif: +ov.bf, tif: +ov.tf } : { type: 'WF', name: ov || jobName || govCol.design.name };
      const Fy = ovBU ? 55 : 50, Fu = ovBU ? 70 : 65;
      const checks = groups.map(g => (g.known ? MZ.columnCheck({ sec, Fy, Fu, L: colLen, Lby: colLen * 12, ...g.loads, edition: ed.colEd }, WF) : null)), done = checks.filter(Boolean);
      // a case typed with the largest of each: each column on its own reactions too, so the page can say how they compare
      groups.forEach((g, gi) => { if (g.env && checks[gi]) g.ownMax = Math.max(...g.cols.map(q => MZ.columnCheck({ sec, Fy, Fu, L: colLen, Lby: colLen * 12, DL_L: q.DL_L, LL_L: q.LL_L, DL_R: q.DL_R, LL_R: q.LL_R, edition: ed.colEd }, WF).max)); });
      let name, quoteAs, props;
      if (ovBU) { name = quoteAs = DESIGN.buColName(sec, done[0].Wt); props = { d: sec.d, bf: sec.bof, tf: sec.tof, tw: sec.tw, W: done[0].Wt }; }
      else { name = sec.name; const [, dn, wt] = name.match(/^W(\d+)X([\d.]+)/); quoteAs = DESIGN.COMMON_COLUMNS.includes(name) || name === 'W8X18' ? name : 'BU' + dn + 'x' + wt; props = WF[name]; }
      // the guide's own answer, kept beside a pick so the page can say what was replaced and put it back
      const autoName = jobName || (govCol && govCol.design.name) || null;
      const auto = autoName ? { name: autoName, quoteAs: DESIGN.COMMON_COLUMNS.includes(autoName) || autoName === 'W8X18' ? autoName : autoName.replace(/^W(\d+)X/, 'BU$1x') } : null;
      const unsized = groups.filter(g => !g.known).flatMap(g => g.cols.map(q => q.label));
      colFinal = { name, quoteAs, sec, props, Fy, picked: !!ov, auto, checks, unsized, max: Math.max(...done.map(q => q.max)), ok: done.every(q => q.ok) };
      if (!colFinal.ok) warn.push({ level: 'stop', text: `${name} fails on the Column sheet (max CSR ${colFinal.max.toFixed(3)})${ov ? ' — the column picked by hand overrides the automatic W' : ''}.` });
      // a W on the quote has to be stocked; a larger one quoted as BU is built from plates
      if (sec.type === 'WF' && colFinal.quoteAs === name && !DESIGN.inStock(DESIGN.WF_STOCK, name, division)) warn.push({ level: 'warn', text: `${name} is not a stocked W at ${division} (DM 5.1) — confirm it, or quote a stocked size.` });
      if (ovBU) warn.push({ level: 'key', text: `Columns: ${name} picked by hand — ${sec.d}" deep, ${DESIGN.plateText(sec)}, on the Column sheet's Built-Up input (max CSR ${colFinal.max.toFixed(3)}).` });
      else if (ov) warn.push({ level: 'key', text: `Columns: ${name} picked by hand${quoteAs !== name ? `, quoted ${quoteAs} (not a common size — training guide)` : ''} (max CSR ${colFinal.max.toFixed(3)}).` });
    }
    // why the columns have no section: the page and the quote say it in these words
    const noSec = [...new Set(cols.flatMap(q => q.parts.filter(p => !isFinite(p.D) || !isFinite(p.L)).map(p => `${p.mezz} ${p.mark || p.beam}`)))];
    let why = null;
    if (cols.length && !colLen) why = { kind: 'length', text: 'Column length unknown — enter the top of mezzanine (A) to size the columns.' };
    else if (cols.length && noBeam) { const nU = cols.filter(q => !known(q)); why = { kind: 'beam', marks: noSec, text: `${nU.length === cols.length ? 'Columns' : `${nU.length} of ${cols.length} columns (${colOrder(nU).map(q => q.label).join(', ')})`} not sized — ${noSec.join(', ')} ${noSec.length > 1 ? 'have' : 'has'} no section yet, so the reactions are unknown${nU.length < cols.length ? '; the others are sized' : ''}.` }; }
    else if (cols.length && !colFinal) why = { kind: 'pass', text: 'No W8–W14 column passes — check the loads or design a built-up column (Design your own).' };
    if (why) warn.push(why.kind === 'beam' ? { level: 'stop', text: why.text, tag: 'nosec' } : { level: 'stop', text: why.text });
    return { colLen, groups, colFinal, why };
  }

  function finish(c, owned, foreign, merges, jobName) {
    const { s, warn, ed, division, grid, lay, designed } = c;
    const { colLen, groups, colFinal, why: colWhy } = designColumns(c, owned, jobName);
    foreign.forEach(q => warn.push({ level: 'key', text: `Column ${q.label} under ${c.id} is counted with ${q.ownerId} (${q.parts.map(p => `${p.mezz} ${p.beam}`).join(' + ')}).` }));
    // this mezzanine's supports as the job sees them: owned columns, other mezzanines' columns, building columns
    const keep = sp => sp.building ? ['L', 'R'].some(k => sp.beams[k] != null && !lay.beams[sp.beams[k]].absorbed) : owned.some(q => near2(q, sp)) || foreign.some(q => near2(q, sp));
    const layout = { ...lay, supports: lay.supports.filter(keep), mezzCols: owned.map(q => ({ ...(lay.supports.find(sp => near2(q, sp)) || { x: q.x, y: q.y, beams: { L: null, R: null } }), label: q.label, building: false })) };
    const quote = {
      beams: designed.map(mk => ({ mark: mk.mark, section: mk.desc, span: (mk.design || mk).span, trib: (mk.design || mk).trib, qty: mk.qty })),
      columns: colFinal ? [{ mark: 'MC1', section: colFinal.quoteAs, length: colLen, qty: owned.length }] : [],
    };
    return { settings: s, edition: ed, division, warn, grid, layout, marks: designed, clear: c.clear, roomIn: c.roomIn, joistDepthIn: c.joistDepthIn, maxDepthByC: c.maxDepthByC, colLen, columns: owned, colGroups: groups, colFinal, colWhy, foreignCols: foreign, merges: merges.filter(m => m.owner === c.index || m.sub === c.index), quote, beamBase: c.beamBase, id: c.id, index: c.index };
  }
  const near2 = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;
  // columns in plan order, as the C-numbers count them: along the length, then from the BSW
  const colOrder = cs => cs.slice().sort((a, b) => a.x - b.x || b.y - a.y);

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

    // and across an attachment (a lean-to's edge beams carried by the other building's beams on the same line): from the
    // merges, each side in its own building's coordinates (own: whose coordinates the entry is in)
    const seenB = new Set();
    [...new Map(mezz.filter(r => r && !r.incomplete).flatMap(r => r.merges || []).map(m => [`${m.owner}|${m.sub}|${m.line}|${m.from}`, m])).values()].forEach(m => {
      const oc = ctxs[m.owner], sc = ctxs[m.sub];
      if (!oc || !sc || oc.bkey === sc.bkey) return;
      shared.push({ a: sc.index, b: oc.index, own: sc.index, axis: m.dir === 'x' ? 'y' : 'x', at: m.line, from: m.from, to: m.to });
      m.into.forEach(id => { const bm = oc.lay.beams[id], k = oc.index + '|' + id; if (!bm || seenB.has(k)) return; seenB.add(k);
        shared.push({ a: oc.index, b: sc.index, own: oc.index, axis: bm.dir === 'x' ? 'y' : 'x', at: bm.line, from: bm.from, to: bm.to }); });
    });

    // ---- layout (15.1.1.3, 15.1.1.4)
    live.forEach(c => {
      const L = c.lay, alt = L.alt, sp = c.beamBase.Lb, shorter = !alt || alt.beamSpan >= L.beamSpan - 1e-6;
      add('15.1.1.3', 'Layout', 'Beams on the shorter span, joists the longer', shorter ? 'ok' : 'info',
        `${tag(c)}beams span ${F(L.beamSpan)}, joists ${F(L.joistSpan)}${/PCS floor plan/.test(L.why || '') ? `, as ${L.why} shows` : ''}${shorter ? '.' : ` — the other direction would put the beams on ${F(alt.beamSpan)}; the drawing governs, confirm it was intended.`}`, c.index);
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
    // floor use (the Box 22 checkbox) against the code minimum live load, IBC 1607.1 / ASCE 7 Table 4.3-1
    const USE_LL = {
      Storage: [125, 'light storage 125 psf, heavy storage 250'], Manufacturing: [125, 'light manufacturing 125 psf, heavy 250'],
      Office: [50, 'offices 50 psf (corridors above the first floor 80, lobbies 100)'], 'Retail Store': [75, 'retail upper floors 75 psf (first floor 100)'],
      Classroom: [40, 'classrooms 40 psf (corridors above the first floor 80)'], Theater: [100, 'assembly: balconies, lobbies and movable seats 100 psf (fixed seats only 60)'],
    };
    live.forEach(c => {
      const use = c.inp.mezz.use, ll = val(c.inp.loads.live), part = val(c.inp.loads.partition) || 0, u = USE_LL[use];
      if (!use) return add('IBC 1607.1', 'Loads', 'Floor use and live load', 'check', `${tag(c)}${c.inp.mezz.useRead ? 'no floor use is ticked in Box 22' : 'the floor use checkboxes were not read (the page is not rendered here)'} — confirm ${ll} psf live suits what the floor is for.`, c.index);
      const low = ll < u[0], noPart = use === 'Office' && ll <= 80 && part < 15;
      add('IBC 1607.1', 'Loads', `Floor use: ${use}`, low || noPart ? 'check' : 'ok', `${tag(c)}${ll} psf live${part ? ` + ${part} psf partition` : ''} for ${use.toLowerCase()} — code minimum ${u[1]}${low ? `: ${ll} psf is below it, confirm the load with the customer` : ''}${noPart ? '; an office floor at 80 psf live or less also carries a 15 psf partition load (IBC 1607.5)' : ''}. The building code on the PCS governs.`, c.index);
    });
    live.forEach(c => {
      const r = mezz[c.index], cl = r && r.clear;
      if (!cl) return;
      const bad = ['A', 'B', 'C'].filter(k => cl[k].ok === false);
      // D / F: clearances under the frame — the frame design has to hold them; E: where the slab edge sits
      const gv = k => { const n = c.inp.geom[k]; return n && n.value != null ? `${F(n.value)}${n.source === 'annotation' ? ' (blue note)' : ''}` : null; };
      const DF = [['D', 'minimum clearance under the frame'], ['F', 'clearance under the frame']].filter(([k]) => gv(k));
      if (DF.length) add('15.1.1', 'Layout', 'Clearance under the frame (D, F) — for the frame design', 'note', `${tag(c)}${DF.map(([k, t]) => `${k} ${t} ${gv(k)}`).join(' · ')} — not part of the mezzanine design: carry ${DF.length > 1 ? 'them' : 'it'} to the frame design (NBG Frame clear height under the rafters).`, c.index, { mirror: false });
      if (gv('E')) add('15.1.1', 'Layout', 'Slab edge setback (E)', 'note', `${tag(c)}E edge of slab / deck ${gv('E')} from the steel line — the edge angle / pour stop line; the edge beams stay on the column lines.`, c.index, { mirror: false });
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
        ms.map(mk => `${mk.mark} ${plates(mk.sec.bof)} × ${plates(mk.sec.tof)}"${mk.check.conc ? `, joist bearing SR ${jb(mk).toFixed(2)}` : ''}`).join(' · ') + (conc ? ' (web local yielding, crippling and sidesway under the joist reaction, J10 — Concentrated Load Checks).' : ms.some(mk => !mk.check.conc && mk.sec.type === 'WF') ? ` — the joist-bearing check here covers built-up sections; ${ms.filter(mk => !mk.check.conc && mk.sec.type === 'WF').map(mk => `${mk.mark} ${mk.desc}`).join(', ')} (a W): check J10 by hand.` : ' — the 13th-edition sheet has no joist-bearing check: check J10 by hand.'));
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
        const name = r.colFinal.name, w = r.colFinal.props, bu = /^BU/.test(r.colFinal.quoteAs), own = r.colFinal.sec.type === 'BU';
        if (bu) add('15.1.1.4.2 (2A)', 'Connections & columns', 'Built-up column: flange at least 8" × ¼" for beams on the flange', w.bf >= 8 && w.tf >= 0.25 ? 'ok' : 'check',
          `${own ? `${name}: built up from plate (d ${w.d}", tw ${w.tw}")` : `Quoted as ${r.colFinal.quoteAs}, sized as ${name}`} (flange ${w.bf}" × ${w.tf}")${w.bf >= 8 && w.tf >= 0.25 ? '.' : ' — a built-up column with beams on its flange needs an 8" × ¼" flange: build it with an 8" flange, or frame the beams onto a cap plate.'}`);
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

    // the joist and deck order as Box 22 asks for it: not part of the beam / column design, carried to the joist and deck
    // purchase and the D2D sheet (bolted joists put the seat holes in the beam top flange)
    live.forEach(c => {
      const z = c.inp.mezz, j = z.joists || {}, pick = (a, b) => (j[a] ? a.split(' ')[0].toLowerCase() : j[b] ? b.split(' ')[0].toLowerCase() : null);
      const jc = pick('Bolted Joists', 'Welded Joists'), bc = pick('Bolted Bridging', 'Welded Bridging');
      const parts = [z.joists ? `joists ${jc || 'not ticked'}, bridging ${bc || 'not ticked'}` : 'joist / bridging connection not read (the page is not rendered here)',
        `deck ${z.deckText || z.deck}${z.deckAttach ? `, ${z.deckAttach.toLowerCase()}` : ''}${z.deckFinish ? `, ${z.deckFinish}` : ''}`, z.primer ? `joist primer ${z.primer}` : null].filter(Boolean);
      const open = z.joists && (!jc || !bc);
      add('PCS Box 22', 'Deck & pour stop', 'Joists, bridging and deck as ordered', open ? 'check' : 'note', `${tag(c)}${parts.join(' · ')} — for the joist and deck order and the D2D sheet${jc === 'bolted' ? '; bolted joists: the beam top flanges carry the joist seat holes' : ''}${open ? '; tick bolted or welded before the joists are ordered' : ''}.`, c.index, { mirror: !!open });
    });

    // ---- bracing (15.1.3): each side of the framed floor (the outermost beam / column lines, not a slab overhang)
    live.forEach(c => {
      const g = c.grid, W = g.width, L = g.length, area = c.mz.length * c.mz.width, xl = c.lay.xLines, yl = c.lay.yLines;
      const fp = xl.length && yl.length ? { x0: Math.min(...xl), x1: Math.max(...xl), y0: Math.min(...yl), y1: Math.max(...yl) } : c.lay.footprint;
      const fdl = c.beamBase.dead + c.beamBase.coll, fll = c.beamBase.live, H = area * (fdl + fll) / 1000 * 0.01;
      const frames = (g.xs || []).filter(x => x > 0.5 && x < L - 0.5);
      // a line with no grid letter or number is named by where it is
      const lab = (axis, at) => (axis === 'y' ? g.yLabel(at) : g.xLabel(at)) || `${F(at)} from the ${axis === 'y' ? 'FSW' : 'LEW'}`;
      const sides = [['y', fp.y0, fp.x0, fp.x1], ['y', fp.y1, fp.x0, fp.x1], ['x', fp.x0, fp.y0, fp.y1], ['x', fp.x1, fp.y0, fp.y1]];
      const by = { side: [], end: [], rigid: [], free: [] }, joins = [];
      const KIND = { side: 'sidewall bracing tiered at the mezzanine level', end: 'endwall bracing tiered at the mezzanine level, or a rigid end frame', rigid: 'rigid frame', free: 'free — independent X-bracing' };
      sides.forEach(([axis, at, s0, s1]) => {
        const sh = shared.filter(e => (e.own == null ? e.a === c.index || e.b === c.index : e.own === c.index) && e.axis === axis && Math.abs(e.at - at) < 0.6);
        const shLen = Math.min(s1 - s0, sh.reduce((a, e) => a + (e.to - e.from), 0)), rest = s1 - s0 - shLen, nm = lab(axis, at);
        const kind = axis === 'y' && (Math.abs(at) < 0.6 || Math.abs(at - W) < 0.6) ? 'side' : axis === 'x' && (Math.abs(at) < 0.6 || Math.abs(at - L) < 0.6) ? 'end' : axis === 'x' && frames.some(x => Math.abs(x - at) < 0.6) ? 'rigid' : 'free';
        // a line shared with another floor: one clause — what it shares, and what the rest of the line needs
        if (sh.length) { joins.push(`line ${nm}: one floor with ${[...new Set(sh.map(e => idOf(e.a === c.index ? e.b : e.a)))].join(', ')}${rest < 1 ? '' : ` for ${F(shLen)}; the other ${F(rest)} ${KIND[kind]}`}`); if (rest >= 1) by[kind + 'Part'] = true; return; }
        by[kind].push(nm);
      });
      const ln = a => (a.length > 1 ? 'lines ' : 'line ') + a.join(', ');
      const anyFree = by.free.length || by.freePart;
      const desc = [by.side.length && `${ln(by.side)}: ${KIND.side}`, by.end.length && `${ln(by.end)}: ${KIND.end}`, by.rigid.length && `${ln(by.rigid)}: ${KIND.rigid}`, by.free.length && `${ln(by.free)}: ${KIND.free}, mezzanine level to the floor`, ...joins,
        anyFree && `X-bracing for 1% of FDL + FLL = ${H.toFixed(2)} k (${Math.round(area).toLocaleString('en-US')} ft² × ${n3(fdl + fll)} psf)`].filter(Boolean);
      const needs = by.side.length || by.end.length || by.free.length || by.sidePart || by.endPart || by.freePart;
      add('15.1.3', 'Bracing', 'Mezzanine braced on all four sides', needs ? 'check' : 'ok', `${tag(c)}${desc.join(' · ')}.`, c.index);
    });

    // a tube / pipe column request on the PCS: not on the Column sheet
    const req = live.map(c => c.inp.mezz.colRequest).find(Boolean);
    if (req) add('15.1.1.4.2', 'Columns', 'Tube / pipe columns asked for', 'check', `The PCS reads: "${req}". The Column sheet sizes W and BU columns only — size the tube (HSS) or pipe column separately (AISC 360 Chapter E / H, the same loads and e = d/2 eccentricity) and note it on the quote.`);
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
      // dRead: the beam depth the sheet's C check uses — the 13th takes it typed (the job's deepest beam); the 15th / 16th
      // INPUT sheet takes the deepest of the four MB sheets in that copy (D26 = MAX(MB1..MB4!M22))
      const inputFor = (c, dRead) => {
        const v = { dead: c.beamBase.dead, coll: c.beamBase.coll, live: c.beamBase.live, joistWt: c.beamBase.joistWt, A: c.A, slab: c.slabIn, seat: c.seatIn, joistDepth: c.joistDepthIn, beamDepth: dMax, B: c.Bq, C: c.Cq };
        const steps = map.map(([k, cell, label]) => ({ sheet: 'INPUT', cell, label, value: n3(v[k]), show: v[k] == null ? '(leave blank)' : String(n3(v[k])) }));
        const read = XL.clear[e13 ? 13 : 15].map(([k, prov, ok]) => {
          const p = k === 'B' ? c.A - (c.slabIn + c.joistDepthIn) / 12 : c.A - (c.slabIn + c.seatIn + dRead) / 12, req = k === 'B' ? c.Bq : c.Cq;
          return [{ sheet: 'INPUT', cell: prov, label: `${k} provided (ft.)`, expect: n3(p) }, { sheet: 'INPUT', cell: ok, label: `${k} check`, expect: req == null || p >= req - 1e-9 ? 'OK' : 'No Good' }];
        }).flat();
        return { mezz: c.id, steps, read };
      };
      const members = live.filter(c => ms.some(m => m.mezzIds.includes(c.index)));
      for (let k = 0; k < runs.length; k += 4) {
        const sheets = runs.slice(k, k + 4).map(({ m, q, i }, j) => {
          const sheet = 'MB' + (j + 1), c = q.check, sec = m.sec;
          const steps = [
            { sheet, cell: 'D5', label: 'Beam Mark', value: i ? `${m.mark} ${F(q.params.L)}` : m.mark, show: i ? `${m.mark} ${F(q.params.L)}` : m.mark },
            { sheet, cell: 'D7', label: 'Member Length, ft.', value: n3(q.params.L), show: String(n3(q.params.L)) },
            { sheet, cell: 'D8', label: 'Unbraced Length, ft. (joist spacing)', value: n3(q.params.Lb), show: String(n3(q.params.Lb)) },
            { sheet, cell: 'D9', label: 'Tributary Width, ft.', value: n3(q.params.trib), show: String(n3(q.params.trib)) },
          ].concat(e13 ? [] : [{ sheet, cell: 'D15', label: 'Axial Load, Kip', value: null, show: '(leave blank)' }]).concat([
          ].concat(sec.type === 'WF' ? [
            // a W picked by hand: the sheet's own WF input (M19 = "WF" when Q4 = 3; M20 shows the name typed in M21)
            { sheet, cell: 'Q4', where: 'K19 drop-down', label: 'Wide-flange/Built-up Sect.', value: 3, show: 'WF' },
            { sheet, cell: 'M21', label: 'Enter WF-Section', value: sec.name, show: sec.name },
            // a W is A992: the sheet's material drop-down to 50 ksi (M30 = 50 when Q11 = 2) and the strengths typed below it
            { sheet, cell: 'Q11', where: 'M30 drop-down', label: 'Material Strength Fy, ksi', value: 2, show: '50' },
            { sheet, cell: 'M31', label: 'Flange Yield Strength Fyf, ksi', value: 50, show: '50' },
            { sheet, cell: 'M32', label: 'Web Yield Strength Fyw, ksi', value: 50, show: '50' },
            { sheet, cell: 'M33', label: 'Ultimate Strength Fu, ksi', value: 65, show: '65' },
          ] : [
            { sheet, cell: 'Q4', where: 'K19 drop-down', label: 'Wide-flange/Built-up Sect.', value: 2, show: 'BU' },
          ]).concat([
            // the plate cells: the sheet's WF path reads them too (Chapter B h/tw, the flange checks) — a W's own d, tw, bf, tf
            { sheet, cell: 'M22', label: 'Total Depth, in.', value: sec.d, show: String(sec.d) },
            { sheet, cell: 'M23', label: 'Web Thickness, in.', value: sec.tw, show: String(sec.tw) },
            { sheet, cell: 'M24', label: 'O. Flange Width, in.', value: sec.bof, show: String(sec.bof) },
            { sheet, cell: 'M25', label: 'O. Flange Thickness, in.', value: sec.tof, show: String(sec.tof) },
            { sheet, cell: 'M26', label: 'I. Flange Width, in.', value: sec.bif, show: String(sec.bif) },
            { sheet, cell: 'M27', label: 'I. Flange Thickness, in.', value: sec.tif, show: String(sec.tif) },
          ]));
          const read = [
            { sheet, cell: 'M20', label: 'Section Description', expect: c.desc },
            { sheet, cell: 'H6', label: 'Floor dead load — shear at left / right, kips', expect: n3(c.V.D) },
            { sheet, cell: 'H10', label: 'Floor live load — shear at left / right, kips', expect: n3(c.V.L) },
            { sheet, cell: 'K11', label: 'Live load deflection, L /', expect: Math.round(c.defl.rLL) },
            { sheet, cell: 'K15', label: 'Total load deflection, L /', expect: Math.round(c.defl.rTL) },
            { sheet, cell: 'G19', label: 'Combined', expect: c.combinedText },
            { sheet, cell: 'G20', label: 'Shear', expect: c.shearText },
          ];
          return { sheet, mark: m.mark, kind: m.kind, desc: m.desc, span: q.span, L: q.params.L, trib: q.params.trib, qty: q.qty, shorter: i > 0, mezzIds: m.mezzIds, steps, read };
        });
        const dCopy = e13 ? dMax : Math.max(...runs.slice(k, k + 4).map(({ m }) => m.sec.d));
        beam.push({ file: XL.beamBook[e13 ? 13 : ed === '16' ? 16 : 15], edition: ed, copy: k / 4 + 1, marks: ms.map(m => m.mark), inputs: members.map(c => inputFor(c, dCopy)), sheets });
      }
    });
    // Column sheet: one run per column case
    const column = [];
    mezz.filter(r => r && !r.incomplete && r.colFinal).forEach(r => {
      const c = ctxs[r.index], ed = c.ed.colEd, name = r.colFinal.name, L = r.colLen;
      let book = column.find(b => b.edition === ed);
      if (!book) column.push(book = { file: XL.colBook[ed] || XL.colBook[15], edition: ed, cases: [] });
      r.colGroups.forEach((gp, gi) => {
        if (!r.colFinal.checks[gi]) return;   // not sized yet (a beam framing in has no section): nothing to type
        const ck = r.colFinal.checks[gi], ld = gp.loads, bsec = r.colFinal.sec.type === 'BU' ? r.colFinal.sec : null, n4 = v => +(+v).toFixed(4);   // plate sizes exact (0.3125, 0.1644)
        // the section: a W by name, or the sheet's Built-Up input (one flange size, both flanges)
        const secSteps = bsec ? [
          { sheet: 'Column', cell: 'C16', label: `Section — Built-Up (${name})`, value: 'Built-Up', show: 'Built-Up' },
          { sheet: 'Column', cell: 'C17', label: 'Total Depth, d (in.)', value: n4(bsec.d), show: String(n4(bsec.d)) },
          { sheet: 'Column', cell: 'C18', label: 'Flange Width, b (in.)', value: n4(bsec.bof), show: String(n4(bsec.bof)) },
          { sheet: 'Column', cell: 'C19', label: 'Flange Thickness, tf (in.)', value: n4(bsec.tof), show: String(n4(bsec.tof)) },
          { sheet: 'Column', cell: 'C20', label: 'Web Thickness, tw (in.)', value: n4(bsec.tw), show: String(n4(bsec.tw)) },
          { sheet: 'Miscellaneous', cell: 'K8', where: 'Column!D16 Fy (ksi) drop-down', label: 'Fy (ksi) — 55 for plate', value: '55', show: '55' },
        ] : [
          { sheet: 'Column', cell: 'C16', label: `Section${r.colFinal.quoteAs !== name ? ` (quoted as ${r.colFinal.quoteAs})` : ''}`, value: name, show: name },
          // the Fy drop-down beside the section writes Miscellaneous!K8; the 16th sheet opens at 55 ksi, a W column is 50
          { sheet: 'Miscellaneous', cell: 'K8', where: 'Column!D16 Fy (ksi) drop-down', label: `Fy (ksi) — 50 for a W column${ed === '16' ? ' (this sheet opens at 55)' : ''}`, value: '50', show: '50' },
        ];
        const steps = [
          { sheet: 'Column', cell: 'C7', label: 'Column Mark (the grid points of this case)', value: colOrder(gp.cols).map(q => q.label).join(' '), show: colOrder(gp.cols).map(q => q.label).join(' ') },
          { sheet: 'Column', cell: 'C8', label: 'Column Length, L (ft.)', value: n3(L), show: String(n3(L)) },
        ].concat(ed === '16' ? [{ sheet: 'Column', cell: 'C10', label: 'Y-Axis Unbraced Length, Lby (in.) — hard-coded 120 on this sheet: type L × 12', value: n3(L * 12), show: String(n3(L * 12)) }] : []).concat(secSteps, [
          { sheet: 'Column', cell: 'C27', label: 'Left Beam Reaction — Dead (kip)', value: n3(ld.DL_L), show: String(n3(ld.DL_L)) },
          { sheet: 'Column', cell: 'D27', label: 'Left Beam Reaction — Live (kip)', value: n3(ld.LL_L), show: String(n3(ld.LL_L)) },
          { sheet: 'Column', cell: 'C28', label: 'Right Beam Reaction — Dead (kip)', value: n3(ld.DL_R), show: String(n3(ld.DL_R)) },
          { sheet: 'Column', cell: 'D28', label: 'Right Beam Reaction — Live (kip)', value: n3(ld.LL_R), show: String(n3(ld.LL_R)) },
        ]);
        const read = ['C', 'D', 'E'].flatMap((col, k) => [{ sheet: 'Column', cell: col + '39', label: `${['DLt+LLt+DRt', 'DLt+DRt+LRt', 'DLt+LLt+DRt+LRt'][k]} result`, expect: ck.combos[k].okText }, { sheet: 'Column', cell: col + '40', label: 'Maximum CSR', expect: n3(ck.combos[k].csr) }]);
        if (ed !== '16') read.unshift({ sheet: 'Column', cell: 'C10', label: 'Lby follows C8 × 12 (in.)', expect: n3(L * 12) });
        book.cases.push({ mezz: r.id, mi: r.index, group: gi, labels: colOrder(gp.cols).map(q => q.label), steps, read });
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
      const where = q.userKind === 'frame' && mi < 0 ? `column at ${PCS.fmtFtIn(q.y)} — made a frame column on the Plan page: add it in NBG Frame` : near(q.y, 0) ? 'FSW column' : near(q.y, W) ? 'BSW column' : mi >= 0 ? (wall && /post|bearing/i.test(((c.inp.building.frames || []).find(fr => fi + 1 >= fr.from && fi + 1 <= fr.to) || {}).type || '') ? `endwall column at ${PCS.fmtFtIn(q.y)} — a member of the post-and-beam end frame` : `interior column at ${PCS.fmtFtIn(q.y)} from the FSW`) : wall ? `endwall column at ${PCS.fmtFtIn(q.y)} — not a member of this frame (endwall design)` : `column at ${PCS.fmtFtIn(q.y)}`;
      // top of the mezzanine beam bearing there (the higher one when two mezzanines frame in)
      const elev = Math.max(...q.parts.map(p => { const k = ctxs[p.mi]; return k.A - (k.slabIn + k.seatIn) / 12; }));
      const A = Math.max(...q.parts.map(p => ctxs[p.mi].A));
      let f = out.find(e => e.x === g.xs[fi] && e.bkey === c.bkey);
      if (!f) out.push(f = { frame: g.xLabel(g.xs[fi]), x: g.xs[fi], bkey: c.bkey, building: c.inp.mezz.building || '', type: (c.inp.building.frames || []).find(fr => fi + 1 >= fr.from && fi + 1 <= fr.to) || null, width: W, interior: members.slice(1, -1), entries: [] });
      f.entries.push({ label: q.label, x: q.x, y: q.y, member: mi >= 0 ? 'COL' + String(mi + 1).padStart(2, '0') : null, where, elev, A, D: q.D, L: q.L, parts: q.parts, planKind: q.planKind || null, userKind: q.userKind || null });
    });
    out.forEach(f => { f.entries.sort((a, b) => a.y - b.y); f.type = f.type ? { type: f.type.type || '', intType: f.type.intType || null } : null; });
    return out.sort((a, b) => a.x - b.x);
  }

  /* ---------- seismic: NBG Design Calcs (Seismic), section by section, then the loads into the frames and the bracing ----------
     src/seismic.js is NBG Design Calcs' Seismic module, tied to NBG's validation examples and to a .nbgcalcs file value by
     value (oracle/nbg_seismic.js). Here the job is typed into it as the engineer does, in its order:
       1. Building data — PCS Box 2; the code: the PCS's, or the one chosen here, or read from the job's bracing / eScope file.
       2. Seismic data — risk category, Ss and S1 (ASCE 7-22: SMS and SM1 from the hazard tool, on the PCS), site class,
          roof and mezzanine diaphragms, "not detailed for seismic" in SDC A–C, "significant mezzanine exists" (the
          vertical distribution of 12.8.3; unchecked, each weight takes Cs × W — NBG Design Calcs' default),
          irregularities, accidental torsion.
       3. Roof loading — frame self weight 2 psf, roof dead / collateral / snow from the PCS or the files; walls 3 psf
          metal panel, full height.
       4. Mezzanine loads — each mezzanine's floor dead (the design's dead load with its own beams and half its columns),
          collateral, joists, 25 % of the live where it is storage, partitions.
       5. Force resisting systems — the sidewalls (X-bracing unless set) and each frame line's framing (PCS Box 5).
       6. Lateral calculations — every frame line: its tributary width, an endwall at an end frame, each mezzanine's floor
          area in its strip. NBG Frame takes the roof seismic weight and factor, the sidewall loads at eave − 16", and each
          mezzanine's load at its elevation, which goes on the frame columns its beams frame into (DM 15.1.3), shared by
          the dead load each takes, or equally: EQR = +F, EQL = −F.
       7. Longitudinal calculation — NBG Bracing takes the roof total seismic weight and factor, the sidewall loads at the
          eave, and each mezzanine's force (× 1.1 accidental torsion on a rigid floor). That force goes to the mezzanine's
          two long edges as a simply supported flexible diaphragm: an edge on a sidewall is that wall's bracing (EQB + / EQF −
          at the mezzanine's frame lines, with a wall strut line at its elevation); any other edge needs independent X-bracing.
     cfg (the Seismic page): { ed, risk, Ss, S1, SMS, SM1, siteClass, roofDiaphragm, mezzDiaphragm, ndfs, significant,
       irregular, torsionLong, torsionLat, files: { [bkey]: { from, code, risk, Ss, S1, SMS, SM1, siteClass, roofDead,
       collateral, snow } } (read from a dropped bracing / eScope file), buildings: { [bkey]: { SW, RDL, CDL, RSW, Pf,
       walls: { LEW | REW | FSW | BSW: { kind, parapet, shear, top, weight, masonryTop, lowerWeight, upperWeight } },
       sfrs: { FSW, BSW }, lines: { [label]: framing }, frameFile } }, mezz: { [id]: { FDL, FLC, FLJ, FLL, storage,
       partition, FLP, framing: false } }, split: 'dead' | 'equal', eqScale, eqOverride } — anything left out comes from
       the files, the PCS, the design or NBG's defaults. */
  const SEIS_DEFAULTS = { SW: 2, RDL: 3, RSW: 0, wall: 3, split: 'dead', sfrs: ['X-Bracing', 'X-Bracing'] };   // RDL: NBG Bracing's own default when the PCS says Per Seller (NBG Frame works out 2.7–2.8 psf on the jobs seen: 3 is on the safe side)
  const SEIS_SYSTEMS = ['X-Bracing', 'Portal Frame', 'Portal Frame (IMF)', 'Portal Frame (SMF)', 'X-Bracing (SCBF)'];
  const LINE_SYSTEMS = ['Rigid Frame', 'Post & Beam', 'Rigid Frame (IMF)', 'Rigid Frame (SMF)', 'Post & Beam (SCBF)', 'Fixed Base'];
  // one EQ value: building | frame line | column (grid point) | elevation
  const eqKey = (bk, frame, label, at) => `${bk}|${frame}|${label}|${(+at).toFixed(2)}`;
  const secWt = sec => (!sec ? 0 : sec.type === 'WF' ? (WF[sec.name] || {}).W || 0 : (sec.bof * sec.tof + sec.bif * sec.tif + (sec.d - sec.tof - sec.tif) * sec.tw) * 490 / 144);
  // a value with where it came from: typed on the page, a dropped file, the PCS, the design, or NBG's default
  const srcOf = (...tries) => { for (const [v, source] of tries) if (v != null && v !== '' && (typeof v !== 'number' || isFinite(v))) return { value: typeof v === 'string' && isFinite(+v) && source !== 'typed-text' ? +v : v, source: source === 'typed-text' ? 'typed' : source }; return { value: null, source: 'missing' }; };
  // a building of the quote with no mezzanine in it, as the seismic job takes it: its Box 2 / 4 / 5 / 12 facts and its grid
  function siteBuilding(pcs, n) {
    const s = pcs.site[n] || {}, b0 = s.building;
    if (!b0 || !(b0.width > 0) || !(b0.length > 0)) return null;
    const bl = { width: b0.width, length: b0.length, ridge: b0.ridge, bays: b0.bays || [], lewCols: b0.lewCols || [], rewCols: b0.rewCols || [], fswSoldier: b0.fswSoldier || [], bswSoldier: b0.bswSoldier || [],
      frames: s.frames || [], fromPCS: true, bracing: s.bracing || null,
      geo: { profile: b0.profile || null, eaveFSW: b0.eaveFSW ?? b0.eave ?? null, eaveBSW: b0.eaveBSW ?? b0.eave ?? null, slopeFSW: b0.slopeFSW ?? null, slopeBSW: b0.slopeBSW ?? null }, roofLoads: s.roof || null };
    const grid = LAYOUT.buildingGrid({ width: bl.width, length: bl.length, bays: bl.bays, lewCols: bl.lewCols, rewCols: bl.rewCols, ridge: bl.ridge, frames: bl.frames, fswSoldier: bl.fswSoldier, bswSoldier: bl.bswSoldier });
    return { bkey: [n, bl.width, bl.length, bl.bays.join(',')].join('|'), inp: { building: bl, mezz: { building: n } }, grid, noMezz: true };
  }
  /* pcs: every building of the quote is worked, a mezzanine in it or not — NBG Design Calcs runs each building's frame
     lines and bracing; a building whose mezzanine still waits for its inputs waits with it */
  function seismicJob(ctxs, mezz, frames, cfg = {}, pcs = null) {
    const live = ctxs.filter(c => !c.incomplete);
    const geoKey = k => String(k).split('|').slice(1).join('|'), nameOf = k => String(k).split('|')[0];
    const extra = !pcs || !pcs.site ? [] : Object.keys(pcs.site).map(n => siteBuilding(pcs, n)).filter(Boolean)
      .filter(e => !ctxs.some(c => { const n = nameOf(c.bkey); return n ? bkeyName(n) === bkeyName(nameOf(e.bkey)) : geoKey(c.bkey) === geoKey(e.bkey); }));
    if ((!live.length && !extra.length) || !SEIS) return null;
    const F = PCS.fmtFtIn, c0 = live[0] || { inp: { job: { ...(pcs.job || {}), code: pcs.code }, seismic: { ...(pcs.seismic || {}) } } }, px = c0.inp.seismic || {}, need = [], notes = [];
    const files = cfg.files || {}, bkeys = [...new Set(live.map(c => c.bkey))].concat(extra.map(e => e.bkey));
    // a dropped bracing / eScope file belongs to one building; its project values (code, site) stand for the job
    const fx = files[bkeys.find(k => files[k])] || {};
    const fromFile = fx.from || 'file';
    const code = SEIS.editionOf(((c0.inp.job || {}).code || {}).text);
    const fileEd = fx.code ? SEIS.editionOf(fx.code) : null;
    const ed = cfg.ed || (fileEd && !fileEd.assumed ? fileEd.ed : null) || code.ed;
    const inp = {
      ed: { value: ed, source: cfg.ed ? 'typed' : fileEd && !fileEd.assumed ? fromFile : code.assumed ? 'default' : 'PCS' },
      code: { pcs: ((c0.inp.job || {}).code || {}).text || null, pcsEd: code.ed, file: fx.code || null },
      risk: srcOf([cfg.risk, 'typed-text'], [fx.risk, fromFile], [px.risk, 'PCS'], ['II', 'default']),
      siteClass: srcOf([cfg.siteClass, 'typed-text'], [fx.siteClass, fromFile], [px.siteClass, 'PCS'], ['D', 'default']),
    };
    // Ss / S1 (and SMS / SM1 for 7-22) belong to the edition they were looked up for: the PCS's are for its own code
    const pcsHere = code.ed === ed;
    inp.Ss = srcOf([cfg.Ss, 'typed'], [fx.Ss, fromFile], [pcsHere ? px.Ss : null, 'PCS']);
    inp.S1 = srcOf([cfg.S1, 'typed'], [fx.S1, fromFile], [pcsHere ? px.S1 : null, 'PCS']);
    inp.SMS = srcOf([cfg.SMS, 'typed'], [ed === '7-22' ? fx.SMS : null, fromFile], [pcsHere ? px.Sms : null, 'PCS']);
    inp.SM1 = srcOf([cfg.SM1, 'typed'], [ed === '7-22' ? fx.SM1 : null, fromFile], [pcsHere ? px.Sm1 : null, 'PCS']);
    if (code.note && ed === code.ed) notes.push({ level: 'info', text: code.note });
    if (!pcsHere && (inp.Ss.value == null || inp.S1.value == null)) need.push(`Ss and S1 for ASCE ${ed} — the PCS lists them for ASCE ${code.ed} (${px.Ss ?? '—'} / ${px.S1 ?? '—'}); drop the job's bracing or eScope file, or type them`);
    else if (inp.Ss.value == null || inp.S1.value == null) need.push('Ss and S1 (PCS Box 3)');
    if (ed === '7-22' && (inp.SMS.value == null || inp.SM1.value == null)) need.push('SMS and SM1 from the ASCE Hazard Tool (ASCE 7-22)');
    if (px.siteNote && /assumed/i.test(px.siteNote) && inp.siteClass.source === 'PCS') notes.push({ level: 'info', text: `Site Class ${inp.siteClass.value} is "${px.siteNote}" on the PCS — ASCE 7 11.4.2: Site Class D where soil properties are not known.` });
    const flags = {
      roofDiaphragm: cfg.roofDiaphragm || 'Flexible', mezzDiaphragm: cfg.mezzDiaphragm || 'None', ndfs: cfg.ndfs !== false,
      irregular: !!cfg.irregular, torsionLong: cfg.torsionLong !== false, torsionLat: !!cfg.torsionLat,
    };
    const d = need.length ? null : SEIS.design({ ed, Ss: inp.Ss.value, S1: inp.S1.value, siteClass: inp.siteClass.value, risk: inp.risk.value, SMS: inp.SMS.value, SM1: inp.SM1.value });
    if (d && !d.ok) d.flags.forEach(t => need.push(t));
    // the seismic weight of each mezzanine's framing and each frame column's share of the EQ load come from the sized
    // members: a mark with no section leaves both unknown, so the page waits rather than send a frame's load to one column
    const noSec = [...new Set(mezz.filter(r => r && !r.incomplete).flatMap(r => (r.marks || []).filter(mk => !mk.check).map(mk => mk.mark)))];
    const nanF = (frames || []).some(f => (f.entries || []).some(e => (e.parts || []).some(p => !isFinite(p.D))));
    if (noSec.length || nanF) need.push(`${noSec.length ? noSec.join(', ') : 'every beam'} sized on the Design page — with no section the framing weight and each frame column's share of the mezzanine EQ load are unknown`);
    const out = { ok: false, need, notes, inputs: inp, flags, design: d, buildings: [], cfg };
    bkeys.forEach(bk => {
      const cs = live.filter(c => c.bkey === bk), src = cs[0] || extra.find(e => e.bkey === bk), b = src.inp.building, geo = b.geo || {}, rl = b.roofLoads || {}, bo = (cfg.buildings || {})[bk] || {}, bf = files[bk] || {};
      const name = src.inp.mezz.building || (pcs && pcs.site && Object.keys(pcs.site).length === 1 ? Object.keys(pcs.site)[0] : 'Building'), W = b.width, Lg = b.length;
      const eF = geo.eaveFSW ?? b.eave, eB = geo.eaveBSW ?? eF;
      // 1. building data as NBG takes it: the ridge measured from the BSW, the slope on the BSW side
      let bd, geoNote = null;
      if ((geo.profile === 'Gable' || (!geo.profile && b.ridge > 0)) && b.ridge > 0 && b.ridge < W) bd = { ed, type: 'Gable', width: W, length: Lg, dtr: W - b.ridge, slope: geo.slopeBSW ?? geo.slopeFSW ?? 1, eaveFSW: eF, eaveBSW: eB };
      else bd = { ed, type: 'Single Slope', width: W, length: Lg, dtr: 0, slope: 0, eaveFSW: eF, eaveBSW: eB };
      if (bd.type === 'Gable' && Math.abs(b.ridge - W / 2) > 0.5) geoNote = `Unequal gable: ridge ${F(b.ridge)} from the FSW on the PCS (${F(bd.dtr)} from the BSW) — confirm the side.`;
      if (!(eF > 0)) need.push(`${name}: eave height (PCS Box 2)`);
      const g = eF > 0 ? SEIS.geometry(bd) : null;
      // 3. roof loading
      const ff = bo.frameFile || {}, bff = bf.from ? bf : fx;
      const roof = {
        SW: srcOf([bo.SW, 'typed'], [SEIS_DEFAULTS.SW, 'default']),
        // NBG Frame works the roof dead out of the panel and purlins it designed — the value the engineer carries into Design
        // Calcs (2.7291 psf on the 3-building job, where the bracing run still had 3); the bracing / eScope value next
        RDL: srcOf([bo.RDL, 'typed'], [ff.roofDead, 'frame file'], [bff.roofDead, bff.from || fromFile], [rl.dead && rl.dead.value, 'PCS'], [SEIS_DEFAULTS.RDL, 'default']),
        CDL: srcOf([bo.CDL, 'typed'], [bff.collateral, bff.from || fromFile], [rl.coll1, 'PCS'], [ff.roofCollateral, 'frame file'], [0, 'default']),
        RSW: srcOf([bo.RSW, 'typed'], [SEIS_DEFAULTS.RSW, 'default']),
        Pf: srcOf([bo.Pf, 'typed'], [bff.snow, bff.from || fromFile], [rl.snow && rl.snow.value, 'PCS'], [0, 'default']),
      };
      if (roof.RDL.source === 'default') notes.push({ level: 'info', text: `${name}: roof dead load ${SEIS_DEFAULTS.RDL} psf assumed ("Per Seller" on the PCS) — NBG Bracing's own default; NBG Frame works it out from the panel and purlins (2.7–2.8 psf on the jobs seen). Drop the job's .frame file on the Project page and its value is used; or type it in step 3.` });
      if (rl.snow && rl.snow.override && roof.Pf.source === 'PCS' && roof.Pf.value > 30) notes.push({ level: 'warn', text: `${name}: roof snow ${roof.Pf.value} psf* (user override on the PCS) is taken as the flat-roof snow. Confirm.` });
      // walls: full height metal panel unless set (an endwall's outline follows the roof; a sidewall runs to its eave)
      const wallIn = (k, top) => { const t = (bo.walls || {})[k] || {}, n = (v, dflt) => (v != null && v !== '' && isFinite(+v) ? +v : dflt);
        return { kind: t.kind === 'partial' ? 'partial' : 'full', parapet: !!t.parapet, shear: !!t.shear, top: t.parapet || t.kind === 'partial' ? n(t.top, top) : top, weight: n(t.weight, SEIS_DEFAULTS.wall),
          masonryTop: n(t.masonryTop, null), lowerWeight: n(t.lowerWeight, null), upperWeight: n(t.upperWeight, SEIS_DEFAULTS.wall), typed: Object.keys(t).length > 0 }; };
      const walls = g ? { LEW: wallIn('LEW', g.mrh), REW: wallIn('REW', g.mrh), FSW: wallIn('FSW', g.eF), BSW: wallIn('BSW', g.eB) } : {};
      Object.entries(walls).forEach(([k, w]) => { if (w.kind === 'partial' && (w.masonryTop == null || w.lowerWeight == null)) need.push(`${name}: ${k} partial height hardwall — top of masonry and its weight`); });
      // 4. mezzanine loads
      const mz = cs.map(c => {
        const r = mezz[c.index], mo = (cfg.mezz || {})[c.id] || {};
        const area = c.mz.length * c.mz.width;
        // framing self weight from the design: every beam of this mezzanine, and half its columns
        const bw = c.lay.beams.filter(bm => !bm.absorbed).reduce((a, bm) => { const mk = c.markOf(bm.id); return a + (mk && mk.sec ? secWt(mk.sec) * bm.span : 0); }, 0);
        const cw = r && r.colFinal && r.colLen ? (r.colFinal.props || {}).W * r.colLen * r.columns.length / 2 : 0;
        const unk = r && ((r.marks || []).filter(mk => !mk.check).map(mk => mk.mark));
        const framing = mo.framing === false ? 0 : unk && unk.length ? null : (bw + cw) / area;
        const dead = val(c.inp.loads.dead);
        const FDL = mo.FDL != null && mo.FDL !== '' ? { value: +mo.FDL, source: 'typed' } : framing == null ? { value: null, source: 'missing' } : { value: dead + framing, source: 'design' };
        const n = (v, dflt) => (v != null && v !== '' && isFinite(+v) ? +v : dflt);
        const FLP0 = val(c.inp.loads.partition) || 0;
        const m = { id: c.id, index: c.index, elev: c.A, FDL: FDL.value, FDLsrc: FDL.source, dead, framing, framingLb: framing == null ? null : bw + cw, framingWaits: framing == null ? unk : null,
          FLC: n(mo.FLC, val(c.inp.loads.coll) || 0), FLJ: n(mo.FLJ, val(c.inp.loads.joistWt) ?? DEFAULTS.joistWt), FLL: n(mo.FLL, val(c.inp.loads.live) || 0),
          storage: mo.storage != null ? !!mo.storage : c.inp.mezz.use === 'Storage', partition: mo.partition != null ? !!mo.partition : FLP0 > 0, FLP: n(mo.FLP, FLP0), area,
          x0: c.mz.startLEW, x1: c.mz.startLEW + c.mz.length, y0: c.mz.startFSW, y1: c.mz.startFSW + c.mz.width, useText: c.inp.mezz.use || null,
          typed: Object.keys(mo).filter(k => k !== 'framing') };
        m.psf = m.FDL == null ? null : SEIS.mezzPsf(m);
        return m;
      });
      // "significant mezzanine exists": the vertical distribution (12.8.3). Unchecked unless set, as in NBG Design Calcs —
      // each weight then takes Cs × W; a floor over a third of the building is a story (IBC 505.2.1): said, not set
      const mzArea = mz.reduce((a, m) => a + m.area, 0), sigHint = mzArea > (W * Lg) / 3;
      const significant = !!cfg.significant;
      // 5. force resisting systems
      const grid = src.grid, xs = grid.xs, nF = xs.length;
      const pcsType = i => SEIS.frameType(((b.frames || []).find(fr => i + 1 >= fr.from && i + 1 <= fr.to) || {}).type);
      const lineSys = i => ((bo.lines || {})[grid.xLabel(xs[i])]) || pcsType(i);
      // the sidewalls' systems: picked on the page, else PCS Box 12's bracing on that wall (portal frames, wall X-bracing), else X-bracing
      const boxSys = w => { const k = b.bracing && b.bracing[w] && b.bracing[w].kind; return k === 'portal' ? 'Portal Frame' : k === 'x' ? 'X-Bracing' : null; };
      const sfrs = { FSW: (bo.sfrs || {}).FSW || boxSys('FSW') || SEIS_DEFAULTS.sfrs[0], BSW: (bo.sfrs || {}).BSW || boxSys('BSW') || SEIS_DEFAULTS.sfrs[1], lines: xs.map((x, i) => lineSys(i)),
        src: { FSW: (bo.sfrs || {}).FSW ? 'typed' : boxSys('FSW') ? 'PCS Box 12' : 'default', BSW: (bo.sfrs || {}).BSW ? 'typed' : boxSys('BSW') ? 'PCS Box 12' : 'default' } };
      const bOut = { bkey: bk, name, bd, g, geoNote, roof, walls, mezz: mz, significant, sigHint, mzArea, sfrs, frames: [], lines: [], long: null, braceLines: [], file: bf.from ? bf : null, noMezz: !cs.length };
      out.buildings.push(bOut);
      if (need.length || !d || !d.ok || !g) return;
      const P = { building: bd, seismic: { ed, risk: inp.risk.value, Ss: inp.Ss.value, S1: inp.S1.value, SMS: inp.SMS.value, SM1: inp.SM1.value, siteClass: inp.siteClass.value, ...flags, significant },
        roof: { SW: roof.SW.value, RDL: roof.RDL.value, CDL: roof.CDL.value, RSW: roof.RSW.value, Pf: roof.Pf.value }, walls,
        mezz: mz.map(m => ({ id: m.id, elev: m.elev, FDL: m.FDL, FLC: m.FLC, FLJ: m.FLJ, FLL: m.FLL, storage: m.storage, partition: m.partition, FLP: m.FLP })), cranes: [], sfrs };
      const J = SEIS.project(P);
      bOut.P = P;
      // 6. lateral calculations: every frame line (its strip: half the bay each side, an end frame half the end bay)
      xs.forEach((x, i) => {
        const lo = i === 0 ? xs[0] : (xs[i - 1] + x) / 2, hi = i === nF - 1 ? xs[nF - 1] : (x + xs[i + 1]) / 2;
        const inStrip = mz.map(m => ({ m, a: Math.max(0, Math.min(hi, m.x1) - Math.max(lo, m.x0)) * (m.y1 - m.y0) })).filter(o => o.a > 0.5);
        const at = i === 0 ? 'lew' : i === nF - 1 ? 'rew' : 'interior';
        const bayType = { lew: 'Left Endwall', rew: 'Right Endwall', interior: 'Interior' }[at];
        const lineIn = { desc: `Line ${grid.xLabel(x)}`, framing: sfrs.lines[i], bay: hi - lo, bayType, roofConc: 0, fswTrib: hi - lo, bswTrib: hi - lo, mezz: inStrip.map(o => ({ id: o.m.id, area: o.a, conc: 0 })) };
        const lat = SEIS.frameLine(J, lineIn);
        bOut.lines.push({ label: grid.xLabel(x), x, bay: hi - lo, at, bayType, type: sfrs.lines[i], lat, lineIn, areas: Object.fromEntries(inStrip.map(o => [o.m.id, o.a])) });
        if (!inStrip.length) return;
        if (lat.limit) notes.push({ level: 'warn', text: `Frame ${grid.xLabel(x)} (${name}): ${lat.limit}` });
        // the frame columns each mezzanine frames into on this line, and its share of the frame's mezzanine load
        const fe = frames.find(f => f.bkey === bk && Math.abs(f.x - x) < 0.05);
        const eqs = [], loose = [];
        lat.mezzLoads.forEach(ml => {
          const m = mz.find(q => q.id === ml.id);
          const cols = (fe ? fe.entries : []).map(e => ({ e, D: e.parts.filter(p => p.mi === m.index).reduce((a, p) => a + p.D, 0) })).filter(o => o.D > 0);
          const members = cols.filter(o => o.e.member), off = cols.filter(o => !o.e.member);
          if (!members.length) { loose.push({ id: ml.id, F: ml.F, at: ml.at, area: ml.area, why: cols.length ? 'its beams on this line bear only on endwall columns that are not members of this frame' : 'none of its beams frame into a column of this frame' }); return; }
          const tot = cfg.split === 'equal' ? members.length : members.reduce((a, o) => a + o.D, 0);
          members.forEach(o => {
            const share = cfg.split === 'equal' ? 1 / tot : o.D / tot, Fc = ml.F * share;
            o.e.eq = o.e.eq || [];
            o.e.eq.push({ mezz: ml.id, F: Fc, at: ml.at, share, frameF: ml.F });
            eqs.push({ member: o.e.member, label: o.e.label, mezz: ml.id, F: Fc, at: ml.at, share });
          });
          if (off.length) notes.push({ level: 'info', text: `Frame ${grid.xLabel(x)}: ${ml.id} also bears on ${off.map(o => o.e.label).join(', ')} — endwall columns, not part of the frame's lateral system. Its seismic on this line goes to ${members.map(o => `${o.e.member} (${o.e.label})`).join(', ')}.` });
        });
        loose.forEach(l => notes.push({ level: 'stop', text: `Frame ${grid.xLabel(x)} (${name}): ${l.id}'s seismic share ${l.F.toFixed(2)} k at ${F(l.at)} (${Math.round(l.area)} sq ft in this frame's strip) has no frame to go to — ${l.why}. Brace the mezzanine on this line (independent X-bracing, DM 15.1.3) or carry it to the next frames.` }));
        // the engineer's edits: every computed load × the job's scale, and a value typed for one column (frame line ×
        // column × elevation) used as typed. What is shown is what goes into the frame file.
        const scale = cfg.eqScale > 0 ? +cfg.eqScale : 1, ovr = cfg.eqOverride || {};
        (fe ? fe.entries : []).filter(e => e.eq && e.eq.length).forEach(e => {
          const byH = new Map();
          e.eq.forEach(q => { const h = (+q.at).toFixed(3); byH.set(h, (byH.get(h) || []).concat(q)); });
          e.eq = [...byH].flatMap(([h, qs]) => {
            const key = eqKey(bk, grid.xLabel(x), e.label, +h), calc = qs.reduce((a, q) => a + q.F, 0), typed = ovr[key];
            if (typed != null && typed !== '' && isFinite(+typed)) return [{ mezz: qs.map(q => q.mezz).join(' + '), F: +typed, at: +h, share: 1, frameF: qs[0].frameF, calc, edited: 'typed', key }];
            return qs.map(q => ({ ...q, calc: q.F, F: q.F * scale, edited: scale !== 1 ? 'scaled' : null, key }));
          });
        });
        eqs.length = 0;
        (fe ? fe.entries : []).filter(e => e.member && e.eq && e.eq.length).forEach(e => e.eq.forEach(q => eqs.push({ member: e.member, label: e.label, mezz: q.mezz, F: q.F, calc: q.calc, at: q.at, share: q.share, edited: q.edited, key: q.key })));
        const fr = { label: grid.xLabel(x), x, bay: hi - lo, at, bayType, type: sfrs.lines[i], lat, lineIn, eqs, loose, areas: Object.fromEntries(inStrip.map(o => [o.m.id, o.a])) };
        if (fe) fe.seismic = { roofPsf: lat.frame.roofPsf, altRoofPsf: lat.frame.altRoofPsf, Cs: lat.Cs, R: lat.R, V: lat.V, wallLoads: lat.wallLoads, mezzLoads: lat.mezzLoads, k: lat.k, Ta: lat.Ta };
        bOut.frames.push(fr);
      });
      // 7. longitudinal: the bracing
      const longIn = { roofConc: 0, fswTrib: Lg, bswTrib: Lg, partQty: 0, mezz: mz.map(m => ({ id: m.id, area: m.area, conc: 0 })) };
      const long = SEIS.bracing(J, longIn);
      bOut.long = long;
      // each mezzanine's longitudinal force to the lines along the length that hold it. The floor is a flexible
      // diaphragm spanning across the building between its edges; where mezzanines meet at one level it spans across
      // all of them. Cut along the length where that changes; in each piece a mezzanine's force (by its length in the
      // piece) goes to the two edges by the lever rule. Then the same for the DM's 1 % (FDL + FLL) stability force.
      const xsCut = [...new Set(mz.flatMap(m => [m.x0, m.x1]).map(v => +v.toFixed(3)))].sort((a, b) => a - b);
      const lines = new Map();
      const add = (y, xa, xb, Fq, st, ids, elev) => {
        const k = y.toFixed(2), L = lines.get(k) || { y, segs: [], F: 0, stab: 0, mezz: new Set(), at: 0 };
        L.F += Fq; L.stab += st; ids.forEach(i => L.mezz.add(i)); L.at = Math.max(L.at, elev);
        const last = L.segs[L.segs.length - 1];
        if (last && Math.abs(last[1] - xa) < 0.01) last[1] = xb; else L.segs.push([xa, xb]);
        lines.set(k, L);
      };
      const force = id => (long.mezzLoads.find(q => q.id === id) || { F: 0 }).F;
      const gravity = m => ((m.FDL + m.FLC + m.FLJ + (m.partition ? m.FLP : 0)) + m.FLL) * m.area / 1000;   // FDL + FLL, kips
      for (let i = 0; i + 1 < xsCut.length; i++) {
        const xa = xsCut[i], xb = xsCut[i + 1], here = mz.filter(m => m.x0 <= xa + 0.01 && m.x1 >= xb - 0.01);
        // floors in this piece: mezzanines at one level whose long edges touch
        const left = here.slice();
        while (left.length) {
          const fl = [left.shift()];
          for (let grew = true; grew;) {
            grew = false;
            for (let q = left.length - 1; q >= 0; q--) {
              const m = left[q];
              if (fl.some(a => Math.abs(a.elev - m.elev) < 0.01 && (Math.abs(a.y1 - m.y0) < 0.6 || Math.abs(a.y0 - m.y1) < 0.6))) { fl.push(m); left.splice(q, 1); grew = true; }
            }
          }
          const yA = Math.min(...fl.map(m => m.y0)), yB = Math.max(...fl.map(m => m.y1)), span = yB - yA;
          let FA = 0, FB = 0, SA = 0, SB = 0;
          fl.forEach(m => {
            const part = (xb - xa) / (m.x1 - m.x0), yc = (m.y0 + m.y1) / 2, a = (yB - yc) / span;
            FA += force(m.id) * part * a; FB += force(m.id) * part * (1 - a);
            SA += 0.01 * gravity(m) * part * a; SB += 0.01 * gravity(m) * part * (1 - a);
          });
          const ids = fl.map(m => m.id), elev = Math.max(...fl.map(m => m.elev));
          add(yA, xa, xb, FA, SA, ids, elev); add(yB, xa, xb, FB, SB, ids, elev);
        }
      }
      [...lines.values()].sort((a, b) => a.y - b.y).forEach(L => {
        const onWall = L.y < 0.6 ? 'FSW' : L.y > W - 0.6 ? 'BSW' : null;
        const lab = onWall ? `${onWall} sidewall` : `${grid.yLabel(L.y) ? 'line ' + grid.yLabel(L.y) + ', ' : ''}${F(L.y)} from the FSW`;
        bOut.braceLines.push({ mezz: [...L.mezz], y: L.y, segs: L.segs, edge: lab, at: L.at, wall: onWall, x0: Math.min(...L.segs.map(s => s[0])), x1: Math.max(...L.segs.map(s => s[1])),
          element: onWall ? `${onWall} sidewall bracing — EQB / EQF at the mezzanine level, wall strut line at ${F(L.at)}` : 'independent X-bracing, mezzanine level to the floor (DM 15.1.3)',
          independent: !onWall, F: L.F, stab: L.stab, design: onWall ? L.F : Math.max(L.F, L.stab), governs: onWall || L.F >= L.stab ? 'seismic' : 'DM 1 % stability' });
      });
      bOut.workbook = seismicSteps({ inp, d, ed, code, g, bd, roof, walls, mz, significant, flags, sfrs, name, quote: (c0.inp.job || {}).quote, J, longIn }, bOut);
    });
    out.ok = !need.length && !!d && d.ok;
    return out;
  }

  /* ---------- the IBC Seismic workbook, typed in: one copy per frame line (its lateral sheet) with the building's
     longitudinal sheet. Every entry is a workbook input cell, as the engineer types them; `read` is what the workbook
     then shows, which the tool's own numbers must equal (oracle/fill_check.py). The workbook stops at IBC 2021. ---------- */
  const OCC = { I: 'Low Hazard', II: 'Standard Buildings', III: 'Substantial Hazard', IV: 'Essential Facilities' };
  const AT = { lew: 1, rew: 2, interior: 3 };
  function seismicSteps(q, bOut) {
    const n3 = v => (v == null || !isFinite(v) ? null : +(+v).toFixed(4));
    const choice = q.code && q.code.ed === q.ed && q.code.choice ? q.code.choice : ({ '7-05': 2, '7-10': 5, '7-16': 7 })[q.ed] || null;
    const notes = [];
    if (!choice) notes.push(`ASCE ${q.ed}: the workbook (rev. 2021.01.20) has no such code — not typed.`);
    if (q.mz.length > 2) notes.push(`${q.mz.length} mezzanines in ${q.name}: the workbook takes two — only ${q.mz[0].id} and ${q.mz[1].id} are typed, so its base shears leave out ${q.mz.slice(2).map(m => m.id).join(', ')} (the tool's frame and bracing loads carry every mezzanine).`);
    const slot = q.mz.slice(0, 2), w = q.walls;
    // what the workbook shows is worked out from what is typed into it: the first two mezzanines
    const typed = new Set(slot.map(m => String(m.id)));
    const asTyped = (fn, input, all) => (q.mz.length > 2 && q.J && input ? fn(q.J, { ...input, mezz: (input.mezz || []).filter(o => typed.has(String(o.id))) }) : all);
    const S = (sheet, cell, label, value, show) => ({ sheet, cell, label, value, show: show != null ? show : value == null ? '(blank)' : typeof value === 'boolean' ? (value ? 'checked' : 'unchecked') : String(value) });
    const I = 'Input Data', LAT = 'Lateral Calcs. (1)', LNG = 'Longitudinal Calcs.';
    const input = [
      S(I, 'B5', 'Building', q.name),
      S(I, 'B7', 'Nature of Occupancy', OCC[q.d.risk] || 'Standard Buildings'),
      S(I, 'B8', 'Gable/Single Slope', q.bd.type),
      S(I, 'B9', 'Building Width (ft)', n3(q.bd.width)), S(I, 'B10', 'Building Length (ft)', n3(q.bd.length)),
      S(I, 'B11', 'Distance to Ridge, from BSW (ft)', n3(q.bd.dtr)), S(I, 'B12', 'Roof Slope, s:12', n3(q.g.slopeBSW)),
      S(I, 'B13', 'Low Eave Height, FSW (ft)', n3(q.bd.eaveFSW)), S(I, 'B14', 'High Eave Height, BSW (ft)', n3(q.bd.eaveBSW)),
      S(I, 'B18', 'Roof Level Diaphragm', q.flags.roofDiaphragm),
      S(I, 'B19', 'Mezzanine Level Diaphragm', q.flags.mezzDiaphragm),
      S(I, 'B21', 'Vertical Distribution Required (NBG Design Calcs: Significant mezzanine exists)', !!q.significant),
      S(I, 'B22', 'Seismic Irregularities Exist', !!q.flags.irregular),
      S(I, 'F16', 'Ignore "Steel Systems Not Detailed for Seismic"', !q.flags.ndfs),
      S(I, 'B26', 'Ss', n3(q.d.Ss)), S(I, 'B27', 'S1', n3(q.d.S1)), S(I, 'B29', 'Site Classification', q.d.siteClass),
      S(I, 'B33', 'Lateral Frame Self weight, SW (psf)', n3(q.roof.SW.value)), S(I, 'B34', 'Roof Dead Load, RDL (psf)', n3(q.roof.RDL.value)),
      S(I, 'B35', 'Roof Collateral Load, CDL (psf)', n3(q.roof.CDL.value)), S(I, 'B36', 'Roof Self Weight — bracing, beams etc. (psf)', n3(q.roof.RSW.value)),
      S(I, 'B37', 'Roof Snow, Pf (psf)', n3(q.roof.Pf.value)),
      S(I, 'B47', 'Left EW Wall Weight (psf)', n3(w.LEW.weight)), S(I, 'F47', 'Right EW Wall Weight (psf)', n3(w.REW.weight)),
      S(I, 'B59', 'Front SW Wall Weight (psf)', n3(w.FSW.weight)), S(I, 'F59', 'Back SW Wall Weight (psf)', n3(w.BSW.weight)),
    ];
    [['B'], ['F']].forEach(([col], k) => {
      const m = slot[k], tag = `Mezzanine #${k + 1}${m ? ' (' + m.id + ')' : ''}`;
      input.push(S(I, col + '89', `${tag} Elevation (ft)`, m ? n3(m.elev) : null),
        S(I, col + '90', `${tag} Floor Dead (psf)${m && m.framing && m.FDLsrc === 'design' ? ` — ${n3(m.dead)} + ${n3(m.framing)} framing` : ''}`, m ? n3(m.FDL) : null),
        S(I, col + '91', `${tag} Floor Collateral (psf)`, m ? n3(m.FLC) : null), S(I, col + '92', `${tag} Estimated Joist weight (psf)`, m ? n3(m.FLJ) : null),
        S(I, col + '94', `${tag} Floor Live (psf)`, m ? n3(m.FLL) : null), S(I, col + '95', `${tag} Partition (psf)`, m && m.partition ? n3(m.FLP) : 0),
        S('Miscellaneous', k ? 'B38' : 'B36', `${tag} designed for storage (check box)`, !!(m && m.storage)));
    });
    if (choice) input.push(S('Seismic Design Calcs.', 'D11', 'Building code (drop-down)', choice, `${choice} — ASCE ${q.ed}`));
    const long = [
      S(LNG, 'B8', 'Low SW (FSW) Force Resisting System', q.sfrs.FSW), S(LNG, 'B9', 'High SW (BSW) Force Resisting System', q.sfrs.BSW),
      ...slot.flatMap((m, k) => [S(LNG, k ? 'B30' : 'B27', `Loading Area — Mezzanine #${k + 1} (sq ft)`, m ? n3(m.area) : 0), S(LNG, k ? 'B31' : 'B28', `Concentrated Loads — Mezzanine #${k + 1} (kips)`, 0)]),
    ];
    const G = bOut.long && asTyped(SEIS.bracing, q.longIn, bOut.long), gm = id => (G && G.mezzLoads.find(x => x.id === id)) || null;
    const longRead = G ? [{ sheet: LNG, cell: 'C58', label: 'Cs', expect: n3(G.Cs) }, { sheet: LNG, cell: 'H79', label: 'Bracing base shear (kips)', expect: n3(G.V) }, { sheet: LNG, cell: 'H66', label: 'Roof seismic dead load for the bracing (psf)', expect: n3(G.bracing.totalPsf) }]
      .concat(slot.map((m, k) => m && gm(m.id) ? { sheet: LNG, cell: k ? 'G78' : 'G77', label: `Mezzanine #${k + 1} seismic load (kips)`, expect: n3(gm(m.id).F) } : null).filter(Boolean)) : [];
    const frames = bOut.frames.map(fr => {
      const L = asTyped(SEIS.frameLine, fr.lineIn, fr.lat), ml = id => L.mezzLoads.find(x => x.id === id);
      const steps = [
        S(LAT, 'B9', 'Seismic Force Resisting System', fr.type || 'Rigid Frame'),
        S(LAT, 'B18', 'Bay Width — this frame\'s strip (ft)', n3(fr.bay)),
        S(LAT, 'Q1', 'Frame Located at Bay (option buttons)', AT[fr.at], ({ lew: '1 — Left Endwall', rew: '2 — Right Endwall', interior: '3 — Interior Frame' })[fr.at]),
        S(LAT, 'B30', 'Is Mez #1 or #2 Considered a Story?', q.significant ? 'YES' : 'NO'),
        ...slot.flatMap((m, k) => [S(LAT, k ? 'B34' : 'B31', `Loading Area — Mezzanine #${k + 1} (sq ft)`, m ? n3(fr.areas[m.id] || 0) : 0), S(LAT, k ? 'B35' : 'B32', `Concentrated Loads — Mezzanine #${k + 1} (kips)`, 0)]),
      ];
      const read = [{ sheet: LAT, cell: 'C62', label: 'Cs', expect: n3(L.Cs) }, { sheet: LAT, cell: 'H79', label: 'Frame base shear (kips)', expect: n3(L.V) },
        { sheet: LAT, cell: 'G64', label: 'Alt. roof seismic weight (psf)', expect: n3(L.frame.altRoofPsf) }]
        .concat(slot.map((m, k) => m && ml(m.id) ? { sheet: LAT, cell: k ? 'G78' : 'G77', label: `Mezzanine #${k + 1} seismic load at this frame (kips)`, expect: n3(ml(m.id).F) } : null).filter(Boolean));
      return { label: fr.label, at: fr.at, steps, read };
    });
    return { file: 'IBC_Seismic.xls', building: q.name, input, long, longRead, frames, notes };
  }

  /* Design every mezzanine of a job together. items: [{ inp, settings }] (one per mezzanine). */
  /* Two mezzanines of one building that overlap, or stop just short of each other, as read (Box 22 start locations and
     sizes): a misread or a markup on one of them that the other did not get. Laid out as read they give two beam lines
     a few inches apart. (S1B-26002: A's width marked up 26'-6" -> 26'-8" runs it to 27'-4" from the FSW; B starts at
     27'-2".) */
  function footprintCheck(ctxs, mezz) {
    const box = c => { const g = c.inp.geom, n = k => val(g[k]); const b = { x0: n('startLEW'), y0: n('startFSW') }; b.x1 = b.x0 + n('length'); b.y1 = b.y0 + n('width'); return [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) ? b : null; };
    const mk = c => (c.inp.mezz.markups || []).filter(x => x.now && /^(width|length|startLEW|startFSW)$/.test(x.field));
    const live = ctxs.filter(c => !c.incomplete);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (bkeyName(a.inp.mezz.building) !== bkeyName(b.inp.mezz.building)) continue;
      const p = box(a), q = box(b);
      if (!p || !q) continue;
      const ox = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0), oy = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0), f = PCS.fmtFtIn;
      // a red markup on what places the edge where they meet (the first one's size or start, the second one's start)
      const why = (m1, m2, ax) => {
        const near = ax === 'y' ? ['width', 'startFSW'] : ['length', 'startLEW'], far = ax === 'y' ? ['startFSW'] : ['startLEW'];
        const ms = [...mk(m1).filter(x => near.includes(x.field)).map(x => [m1, x]), ...mk(m2).filter(x => far.includes(x.field)).map(x => [m2, x])];
        return ms.length ? ` ${ms.map(([m, x]) => `${m.id}'s ${READ_LABEL[x.field].toLowerCase()} is a red markup on the PCS (${x.was} → ${x.now})`).join('; ')} — the other mezzanine's start location may not have been changed with it.` : '';
      };
      const order = ax => ((ax === 'y' ? p.y0 <= q.y0 : p.x0 <= q.x0) ? [a, p, b, q] : [b, q, a, p]);
      let text = null;
      if (ox > 0.04 && oy > 0.04) {
        // the thin way is where they meet: across the width (y) or along the length (x)
        const ax = oy <= ox ? 'y' : 'x', [m1, b1, m2, b2] = order(ax), wall = ax === 'y' ? 'FSW' : 'LEW';
        text = `${m1.id} and ${m2.id} overlap by ${f(ax === 'y' ? oy : ox)}: ${m1.id} runs to ${f(ax === 'y' ? b1.y1 : b1.x1)} from the ${wall} (${f(ax === 'y' ? b1.y0 : b1.x0)} + ${f(ax === 'y' ? b1.y1 - b1.y0 : b1.x1 - b1.x0)}), ${m2.id} starts at ${f(ax === 'y' ? b2.y0 : b2.x0)}. Laid out as read, that is two beam lines ${f(ax === 'y' ? oy : ox)} apart. Check the Box 22 sizes and start locations.${why(m1, m2, ax)}`;
      } else if (ox > 0.04 && oy <= 0 && -oy < 0.5 && -oy > 0.004 || oy > 0.04 && ox <= 0 && -ox < 0.5 && -ox > 0.004) {
        const ax = ox > 0.04 ? 'y' : 'x', [m1, , m2] = order(ax);
        text = `${m1.id} and ${m2.id} stop ${f(ax === 'y' ? -oy : -ox)} short of each other — a sliver of floor between two beam lines. Check the Box 22 sizes and start locations: next to each other they share one line.${why(m1, m2, ax)}`;
      }
      if (text) [a, b].forEach(c => { const r = mezz[c.index]; if (r && r.warn) r.warn.push({ level: 'stop', text }); });
    }
  }

  function runJob(items, opts = {}) {
    const ctxs = items.map((it, i) => prepare(it.inp, it.settings || {}, i));
    // beams numbered once over the job (B1..), like the columns: each mezzanine's numbers follow the one before
    let bOff = 0;
    ctxs.forEach(c => { c.bOff = bOff; bOff += !c.incomplete && c.lay ? c.lay.beams.length : 0; });
    // a mezzanine in a building attached to another mezzanine's building: where its beams sit in that building
    ctxs.forEach(c => {
      const att = !c.incomplete && c.inp.building && c.inp.building.attach;
      if (!att) return;
      const host = ctxs.find(h => h !== c && !h.incomplete && bkeyName(h.inp.mezz.building) === bkeyName(att.to));
      const map = host ? attachMap(att, host.inp.building, c.inp.building) : null;
      if (map) c.site = { host: host.bkey, hostId: host.id, map };
    });
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
    mezz.forEach((r, i) => { r.bkey = ctxs[i].bkey; r.bOff = ctxs[i].bOff; if (!r.incomplete) r.frameLoads = cols.frame.filter(q => q.seenIn.includes(r.index)); });
    drawingCheck(ctxs, mezz, cols);
    footprintCheck(ctxs, mezz);
    // a column picked by hand replaces the guide's job-wide column: say which is on the quote
    if (jobName) mezz.forEach(r => { if (!r.incomplete && r.columns.length) { const q = DESIGN.COMMON_COLUMNS.includes(jobName) || jobName === 'W8X18' ? '' : ` (quoted ${jobName.replace(/^W(\d+)X/, 'BU$1x')})`, pk = r.colFinal && r.colFinal.picked ? r.colFinal.quoteAs : null;
      const nUn = mezz.reduce((a, z) => a + (!z || z.incomplete ? 0 : z.colFinal ? (z.colFinal.unsized || []).length : z.columns.length), 0);
      const scope = nUn ? `passes the column cases that are sized; ${nUn} column${nUn > 1 ? 's are' : ' is'} not sized yet, and the section may change once ${nUn > 1 ? 'they are' : 'it is'}` : 'passes every column case of every mezzanine';
      r.warn.push({ level: 'key', text: pk ? `One column section for the whole job: the guide's would be ${jobName}${q}; ${pk}, picked by hand, is on the quote.` : `One column section for the whole job: ${jobName}${q} ${scope}.` }); } });
    // a column quoted BU anyway (no common W passes): the lightest built-up column on the Column sheet's own Built-Up input,
    // offered beside the guide's answer (the next heavier W, quoted as BU) — not put on the quote unless picked
    let colAlt = null;
    const buQuoted = mezz.filter(r => r && !r.incomplete && r.colFinal && !r.colFinal.picked && r.colFinal.sec.type === 'WF' && r.colFinal.quoteAs !== r.colFinal.name);
    if (buQuoted.length) {
      const c1 = ctxs[buQuoted[0].index], sets = [];
      buQuoted.forEach(r => r.colGroups.forEach(g => { if (g.known !== false) sets.push({ ...g.loads, L: r.colLen }); }));
      try { colAlt = DESIGN.designBUColumn(sets, { L: buQuoted[0].colLen, edition: c1.ed.colEd, division: c1.division, target: c1.s.target }); } catch (e) { colAlt = null; }
      if (colAlt) {
        const nUnAlt = buQuoted.reduce((a, r) => a + (r.colFinal.unsized || []).length, 0);
        const saves = buQuoted.reduce((a, r) => a + (r.colFinal.props.W - colAlt.W) * r.colLen * (r.columns.length - (r.colFinal.unsized || []).length), 0);
        if (saves > 1) {
          const now = [...new Set(buQuoted.map(r => `${r.colFinal.quoteAs} (sized as ${r.colFinal.name})`))].join(', ');
          colAlt = { ...colAlt, saves, over: buQuoted.map(r => r.index), unsized: nUnAlt };
          buQuoted.forEach(r => r.warn.push({ level: 'key', text: `Lighter built-up column: ${colAlt.name} — ${colAlt.sec.d}" deep, ${DESIGN.plateText(colAlt.sec)} — passes ${nUnAlt ? 'the sized column cases' : 'every column case'} at CSR ${colAlt.max.toFixed(3)} (held to the ${c1.s.target} stress-ratio limit; the guide's W column goes by the sheet's OK, < 1.00) on the Column sheet's Built-Up input, about ${Math.round(saves).toLocaleString('en-US')} lb less than ${now}. The quote keeps the guide's method; use it on the Column page.` }));
        } else colAlt = null;
      }
    }
    // the design manual items, and the Excel cells to type
    const dm = dmChecklist(ctxs, mezz, marks, cols);
    mezz.forEach(r => {
      if (r.incomplete) return;
      r.dm = dm.filter(it => it.mi == null || it.mi === r.index);
      r.dm.filter(it => (it.status === 'stop' || it.status === 'check') && it.mirror !== false).forEach(it => r.warn.push({ level: it.status === 'stop' ? 'stop' : 'warn', text: `${it.title} (${/^\d/.test(it.ref) ? 'DM ' : ''}${it.ref}): ${it.text}` }));
    });
    const excel = excelSteps(ctxs, mezz, marks);
    const fEntries = frameEntries(ctxs, cols.frame);
    // building columns that take mezzanine load but are no member of a frame (endwall columns beside a rigid end frame,
    // soldier columns): no .frame file carries it — the endwall / sidewall design has to
    {
      const inFile = new Set(fEntries.flatMap(f => f.entries.filter(e => e.member).map(e => e.label + '|' + f.bkey)));
      const off = cols.frame.filter(q => !inFile.has(q.label + '|' + q.bkey));
      const say = (mi, text) => { if (mezz[mi] && mezz[mi].warn) mezz[mi].warn.push({ level: 'warn', text }); };
      // a column made a frame column on the Plan page: a new member in its frame's NBG Frame file
      off.filter(q => q.userKind === 'frame').forEach(q => {
        const fr = fEntries.find(f => f.bkey === q.bkey && f.entries.some(e => e.label === q.label));
        // its load is known once every beam framing in has a section
        const unk = [...new Set(q.parts.filter(p => !isFinite(p.D)).map(p => p.mark || p.beam))], ld = unk.length ? `the load once ${unk.join(', ')} ${unk.length > 1 ? 'are' : 'is'} sized` : `D ${q.D.toFixed(2)} / L ${q.L.toFixed(2)} k`;
        say(q.parts[0].mi, fr ? `${q.label} made a frame column on the Plan page: add a column at ${PCS.fmtFtIn(q.y)} from the FSW in the frame line ${fr.frame} NBG Frame file, then load it with ${ld}.`
          : `${q.label} made a frame column on the Plan page, but it is not on a frame line — design it as a building column (endwall / sidewall) for ${ld}.`);
      });
      const byMi = new Map();
      off.filter(q => q.userKind !== 'frame').forEach(q => { const mi = q.parts[0].mi; byMi.set(mi, (byMi.get(mi) || []).concat(q)); });
      byMi.forEach((qs, mi) => say(mi, `Mezzanine load on building columns that are in no NBG Frame file — give it to the endwall / sidewall design: ${qs.map(q => `${q.label} ${isFinite(q.D) ? `D ${q.D.toFixed(2)} / L ${q.L.toFixed(2)} k` : 'load not known yet (a beam framing in has no section)'}`).join(' · ')}.`));
    }
    let seismic = null;
    try { seismic = seismicJob(ctxs, mezz, fEntries, opts.seis || {}, opts.pcs || null); } catch (e) { seismic = { ok: false, need: [], notes: [{ level: 'stop', text: 'Seismic: ' + (e.message || e) }], error: true }; }
    return { mezz, merges, columns: cols, colAlt, frameLoads: cols.frame, frameEntries: fEntries, marks: marks.map(({ group, ...m }) => m), dm, excel, seismic };
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

  /* Rows for the MEZZ sheet of the quote workbook (NBS-IN Eng Quote Sheet), cell for cell:
       Mezz. Design Information, rows 7–12:  A MEZZ. · B:C FF El. · D SLAB · E WT-NW/LW · F DLF · G COLF · H LLF · I PART.
       Mezz. Beams, rows 17–31:              A MEZZ. · B:C SPAN · D TRIB. · E DLT · F LLF · G SECTION · H END WT · I QTY.
       Mezz. Columns, rows 37–39:            A MEZZ. · B:C HEIGHT · D:E TRIB. AREA · F SECTION · G END WT · H QTY.
     Each table is copied as tab-separated rows to paste at its first cell (A7 / A17 / A37). A merged cell gets an empty
     field for its hidden column, and the beams' E, F, H and the columns' G get the sheet's own formulas, so nothing
     shifts and the sheet stays live. MEZZ is the mezzanine's number (1, 2; "1&2" for a row of both). No notes, except
     a short one on a row that fails.
     Beams: a row per mark and member length, by mezzanine. SPAN is the member as laid out; the mark is designed at its
     design span (the MB sheet). DLT = DL + COL (+ PART when it is carried as dead load); LLF = LL (+ PART when live).
     Columns: a row per section and height over the job. End plates: 40 lb per beam, 46 lb per column. */
  const END_WT_BEAM = 40, END_WT_COL = 46;
  const round = (v, n = 2) => (v == null || !isFinite(v) ? '' : +(+v).toFixed(n));
  // where each table starts on the MEZZ sheet, how many rows it has, its cells (null: the hidden half of a merged
  // cell) and how wide its notes cell is (J:K, I:K)
  const SHEET = {
    design: { row: 7, room: 6, cells: ['MEZZ', 'FF', null, 'SLAB', 'WT', 'DL', 'COL', 'LL', 'PART'], note: 2 },
    beams: { row: 17, room: 15, cells: ['MEZZ', 'SPAN', null, 'TRIB', 'DLT', 'LLT', 'SECTION', 'ENDWT', 'QTY'], note: 2 },
    columns: { row: 37, room: 3, cells: ['MEZZ', 'HEIGHT', null, 'AREA', null, 'SECTION', 'ENDWT', 'QTY'], note: 3 },
  };
  const HEADS = {
    design: [['MEZZ', 'MEZZ.'], ['FF', 'FF El. (ft)'], ['SLAB', 'SLAB (in.)'], ['WT', 'WT-NW/LW'], ['DL', 'DLF (psf)'], ['COL', 'COLF (psf)'], ['LL', 'LLF (psf)'], ['PART', 'PART. (psf)']],
    beams: [['MEZZ', 'MEZZ.'], ['SPAN', 'SPAN (ft)'], ['TRIB', 'TRIB. (ft)'], ['DLT', 'DLT (psf)'], ['LLT', 'LLF (psf)'], ['SECTION', 'SECTION'], ['ENDWT', 'END WT (lb)'], ['QTY', 'QTY.']],
    columns: [['MEZZ', 'MEZZ.'], ['HEIGHT', 'HEIGHT (ft)'], ['AREA', 'TRIB. AREA (ft²)'], ['SECTION', 'SECTION'], ['ENDWT', 'END WT (lb)'], ['QTY', 'QTY.']],
  };
  // the sheet's own formulas, at sheet row r (row.ref: the mezzanine's Design Information row)
  const FORMULA = {
    beams: {
      DLT: (r, row) => `=IF(B${r}="","",F$${row.ref}+G$${row.ref}${row.partLive ? '' : `+I$${row.ref}`})`,
      LLT: (r, row) => `=IF(B${r}="","",H${row.ref}${row.partLive ? `+I${row.ref}` : ''})`,
      ENDWT: r => `=IF(B${r}="","",${END_WT_BEAM})`,
    },
    columns: { ENDWT: r => `=IF(B${r}="","",${END_WT_COL})` },
  };
  const colName = i => String.fromCharCode(65 + i);
  function pack(design, beams, columns, mezzNos) {
    const tables = { design, beams, columns }, tsv = {}, sheet = {};
    Object.entries(tables).forEach(([key, rows]) => {
      const sh = SHEET[key], withNote = rows.some(r => r.FLAG), fx = FORMULA[key] || {};
      tsv[key] = rows.map((r, k) => {
        const at = sh.row + k;
        const cells = sh.cells.map(c => (c == null ? '' : fx[c] ? fx[c](at, r) : r[c] == null ? '' : r[c]));
        if (withNote) cells.push(r.FLAG || '', ...Array(sh.note - 1).fill(''));
        return cells.join('\t');
      }).join('\n');
      // the sheet's column letters of each field (B:C for a merged cell), the paste cell, the room left
      const letters = {};
      sh.cells.forEach((c, i) => { if (c == null) return; let j = i; while (sh.cells[j + 1] === null) j++; letters[c] = colName(i) + (j > i ? ':' + colName(j) : ''); });
      const last = sh.cells.length - 1 + (withNote ? sh.note : 0);
      sheet[key] = { at: 'A' + sh.row, first: sh.row, last: sh.row + sh.room - 1, room: sh.room, rows: rows.length, over: Math.max(0, rows.length - sh.room), to: colName(last), letters, withNote };
    });
    return { design, beams, columns, heads: HEADS, tsv, sheet, mezzNos, formulas: FORMULA };
  }
  function designRow(res, inp, no) {
    const conc = /light/i.test(inp.mezz.material || '') ? 'LW' : 'NW';
    const part = val(inp.loads.partition) || 0, dl = val(inp.loads.dead), col = val(inp.loads.coll) || 0, ll = val(inp.loads.live);
    const dlNote = inp.loads.dead.source === 'pcs' ? 'DL per PCS' : inp.loads.dead.source === 'manual' ? 'DL entered by QE'
      : `DL per seller: ${val(inp.loads.dead)} psf = ${(inp.loads.dead.note || '').replace(/^Deck guide: /, '').replace(/ — estimated.*$/, ' (est.)')}`;
    return { MEZZ: no, MEZZID: res.id || inp.mezz.id || '', FF: round(val(inp.geom.A), 3), SLAB: round(val(inp.geom.slab) * 12, 3), WT: conc, DL: dl, COL: col, LL: ll, PART: part || '',
      DETAIL: [dlNote, part ? `partition ${part} psf carried as ${res.settings.partitionTo} load` : ''].filter(Boolean).join('; '), FLAG: '' };
  }
  // a W section as the quote sheet writes it (W8x24)
  const sheetSec = name => String(name || '').replace(/^(W\d+(?:\.\d+)?)X/, '$1x');
  function quoteJob(results, inputs) {
    const done = results.map((r, i) => (r && !r.incomplete ? i : -1)).filter(i => i >= 0);
    const idOf = mi => (results[mi] && results[mi].id) || (inputs[mi] && inputs[mi].mezz.id) || 'A';
    // the sheet numbers the mezzanines: the number in each one's name ("Mezz 2" → 2) when every name has its own,
    // else 1, 2, 3 in the order of the Design Information rows
    const nums = done.map(i => { const m = String(idOf(i)).match(/(\d+)\s*$/); return m ? +m[1] : null; });
    const own = nums.every(n => n != null) && new Set(nums).size === nums.length;
    const noOf = mi => (own ? nums[done.indexOf(mi)] : done.indexOf(mi) + 1);
    const mezzCell = mis => { const xs = [...new Set(mis.map(noOf))].sort((a, b) => a - b); return xs.length === 1 ? xs[0] : xs.join('&'); };
    const rowOf = mi => SHEET.design.row + done.indexOf(mi);
    const design = done.map(i => designRow(results[i], inputs[i], noOf(i)));
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
      // no section: no MB runs either — still one row per member length, so every beam is on the quote
      const runs = mk.spanRuns && mk.spanRuns.length ? mk.spanRuns : [...new Set((mk.beamsAll || []).map(x => +x.span.toFixed(3)))].sort((a, b) => b - a).map(span => ({ span, qty: (mk.beamsAll || []).filter(x => Math.abs(x.span - span) < 1e-3).length }));
      if (!runs.length) runs.push({ span: mk.span, qty: mk.qtyAll || mk.qty });
      const tgt = r0.settings.target;
      // a section that does not pass, or breaks the clearance C, says so on the row that gets pasted
      const fails = run => { const c = run.check || mk.check; if (!c) return ''; const bad = []; if (!(c.res.CSR <= tgt)) bad.push(`combined ${c.res.CSR.toFixed(3)}`); if (!(c.res.SRvx <= tgt)) bad.push(`shear ${c.res.SRvx.toFixed(3)}`); if (!c.llOK) bad.push(`live L/${Math.round(c.defl.rLL)} < L/360`); if (!c.tlOK) bad.push(`total L/${Math.round(c.defl.rTL)} < L/240`); if (c.conc && !c.conc.ok) bad.push('joist bearing'); return bad.length ? `FAILS — ${bad.join(', ')}` : ''; };
      // C at midspan on the row's own beams: the depth plus the total-load sag at that member length, within each of its
      // mezzanines' room (A − C − slab − seat) — the bottom of the beam under the full load is then at C + (room − that)
      const clearC = (run, mis) => { const c = run.check || mk.check; if (!mk.sec || !c) return '';
        const need = mk.sec.d + c.defl.TL, low = mis.map(mi => results[mi]).filter(r => r && r.roomIn != null && r.clear && r.clear.C && r.clear.C.req != null && need > r.roomIn + 1e-3)
          .map(r => ({ C: r.clear.C.req, mid: r.clear.C.req + (r.roomIn - need) / 12 })).sort((a, b) => a.mid - a.C - (b.mid - b.C))[0];
        return low ? `C at midspan ${PCS.fmtFtIn(low.mid)} < ${PCS.fmtFtIn(low.C)} asked (${mk.sec.d}" deep + ${c.defl.TL.toFixed(2)}" sag)` : ''; };
      runs.forEach(run => {
        const bs = (mk.beamsAll || []).filter(x => Math.abs(x.span - run.span) < 1e-3);
        const mis = [...new Set(bs.map(x => x.mi))].sort((a, b) => done.indexOf(a) - done.indexOf(b));
        const byMezz = mis.map(mi => {
          const xs = bs.filter(x => x.mi === mi), lines = [...new Set(xs.map(x => lineOf(mi, x)))];
          return `${results.length > 1 ? idOf(mi) + ' ' : ''}${xs.map(x => 'B' + ((results[mi].bOff || 0) + x.id + 1)).join(', ')} (line ${lines.join(', ')})`;
        });
        const carried = bs.some(x => { const b = results[x.mi].layout.beams[x.id]; return b && b.extra; });
        const dz = mk.design || { span: mk.span, trib: mk.trib, set: false }, Lrun = run.L != null ? run.L : run.span;
        // a BU name (depth x weight) can fit more than one plate set: the plates go with every row
        const sc = mk.sec, plates = sc && sc.type !== 'WF' ? `plates: ${DESIGN.plateText(sc)}` : '';
        const flag = [fails(run), clearC(run, mis)].filter(Boolean).join('; ');
        const detail = [`${mk.mark}${mk.kind ? ' ' + mk.kind : ''}: ${byMezz.join('; ')}`, plates,
          !mk.sec ? `nothing passes at ${PCS.fmtFtIn(dz.span)}` : Math.abs(Lrun - dz.span) > 1e-3 ? `same section, MB sheet at ${PCS.fmtFtIn(Lrun)}` : `designed ${PCS.fmtFtIn(dz.span)} × ${PCS.fmtFtIn(dz.trib)} trib`,
          dz.set ? `design span / trib set on Beam calc (${PCS.fmtFtIn(dz.span)} × ${PCS.fmtFtIn(dz.trib)}; layout ${PCS.fmtFtIn(mk.span)} × ${PCS.fmtFtIn(mk.trib)})` : '',
          carried ? 'trib incl. neighbouring mezzanine edge' : '', mk.optionKey === 'custom' ? 'section picked by the engineer' : mk.optionKey && mk.optionKey !== 'lightest' && mk.options && mk.options.find(o => o.key === mk.optionKey) ? mk.options.find(o => o.key === mk.optionKey).label + ' option' : ''].filter(Boolean).join('; ');
        beams.push({ MEZZ: mezzCell(mis), MEZZID: mis.map(idOf).join(' / '), mis, ref: rowOf(mis[0]), partLive: part > 0 && r0.settings.partitionTo === 'live',
          SPAN: round(run.span, 3), TRIB: round(dz.trib, 3), DLT: round(dlT, 2), LLT: round(llT, 2), SECTION: mk.desc ? sheetSec(mk.desc) : 'NO SECTION', ENDWT: END_WT_BEAM, QTY: bs.length || run.qty,
          L: round(Lrun, 3), mark: mk.mark, FLAG: flag, DETAIL: detail, _o: [done.indexOf(mis[0]), mk.index ?? 0, -run.span] });
      });
    });
    // by mezzanine (the first one on the row), then mark, then the longer member first
    beams.sort((a, b) => a._o[0] - b._o[0] || a._o[1] - b._o[1] || a._o[2] - b._o[2]);
    beams.forEach(b => delete b._o);
    // columns: one row per section and height over the job
    const colRows = new Map();
    done.forEach(i => {
      const r = results[i];
      if (!r.columns.length) return;
      // columns the design could not size yet (a beam framing in has no section): on the quote, marked — all of them,
      // or the ones under that beam while the rest are sized
      const un = r.colFinal ? r.columns.filter(c => (r.colFinal.unsized || []).includes(c.label)) : r.columns;
      if (un.length) {
        const k = 'NOT SIZED|' + round(r.colLen || 0, 3), row = colRows.get(k) || { mis: [], HEIGHT: round(r.colLen || 0, 3), AREA: 0, SECTION: 'NOT SIZED', ENDWT: END_WT_COL, QTY: 0, notes: ['NOT SIZED — see the Design page'], runAs: '' };
        row.mis.push(i); row.QTY += un.length; row.AREA = Math.max(row.AREA, ...un.map(c => c.tribArea || 0));
        row.notes.push(`${results.length > 1 ? r.id + ' ' : ''}${colOrder(un).map(c => c.label).join(', ')}`);
        colRows.set(k, row);
      }
      if (!r.colFinal) return;
      const sz = r.columns.filter(c => !un.includes(c));
      if (!sz.length) return;
      const k = r.colFinal.quoteAs + '|' + round(r.colLen, 3);
      const row = colRows.get(k) || { mis: [], HEIGHT: round(r.colLen, 3), AREA: 0, SECTION: sheetSec(r.colFinal.quoteAs), ENDWT: END_WT_COL, QTY: 0, notes: [], runAs: r.colFinal.quoteAs !== r.colFinal.name ? r.colFinal.name : '' };
      row.mis.push(i); row.QTY += sz.length; row.AREA = Math.max(row.AREA, ...sz.map(c => c.tribArea));
      if (!r.colFinal.ok) (row.fails = row.fails || []).push({ id: r.id, max: r.colFinal.max });   // said once, first, below
      // a built-up column's name (depth x weight) can fit two plate sets: the plates go with it
      const bs = r.colFinal.sec.type === 'BU' ? r.colFinal.sec : null;
      if (bs && !row.notes.some(n => /^built up/.test(n))) row.notes.unshift(`built up: ${bs.d}" deep, ${DESIGN.plateText(bs)}`);
      row.notes.push(`${results.length > 1 ? r.id + ' ' : ''}${colOrder(sz).map(c => c.label).join(', ')}`);
      sz.filter(c => c.shared).forEach(c => row.notes.push(`${c.label} shared with ${[...new Set(c.parts.map(p => p.mezz).filter(m => m !== r.id))].join(', ')}`));
      colRows.set(k, row);
    });
    // a failing column, said once: the row's max CSR to 3 decimals, each mezzanine's when they differ
    const failNote = row => { const fs = (row.fails || []).slice().sort((a, b) => b.max - a.max); return !fs.length ? '' : `FAILS — max CSR ${fs.length > 1 && results.length > 1 ? fs.map(q => `${q.max.toFixed(3)} (${q.id})`).join(', ') : fs[0].max.toFixed(3)}`; };
    const columns = [...colRows.values()].map(row => ({ MEZZ: mezzCell(row.mis), MEZZID: row.mis.map(idOf).join(' / '), mis: row.mis, HEIGHT: row.HEIGHT, AREA: round(row.AREA, 1), SECTION: row.SECTION, ENDWT: row.ENDWT, QTY: row.QTY,
      FLAG: failNote(row), DETAIL: [...row.notes, row.runAs ? `run as ${row.runAs}${WF[row.runAs] ? ` (d ${WF[row.runAs].d}", flanges ${WF[row.runAs].bf}" × ${WF[row.runAs].tf}", web ${WF[row.runAs].tw}", Fy 50)` : ''}` : ''].filter(Boolean).join('; ') }))
      .sort((a, b) => Math.min(...a.mis.map(mi => done.indexOf(mi))) - Math.min(...b.mis.map(mi => done.indexOf(mi))));
    return pack(design, beams, columns, done.map(i => ({ no: noOf(i), id: idOf(i), own })));
  }
  // one mezzanine (or a job of one)
  function quoteSheet(res, inp) { return quoteJob([res], [inp]); }

  const api = { SEIS_DEFAULTS, SEIS_SYSTEMS, LINE_SYSTEMS, seismicJob, siteBuilding, eqKey, REQUIRED, inputsFromPCS, applyPlan, planFor, planMap, attachMap, run, runJob, quoteText, quoteSheet, quoteJob, equivTrib, SETTINGS, DEFAULTS, resolveEdition, XL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_RUN = api;
})(typeof self !== 'undefined' ? self : this);
