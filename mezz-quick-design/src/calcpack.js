/* The calc package: one Excel workbook an engineer can check the design from. Every number is an input to, or a
   result of, NBG's own workbooks (the MB sheet, the Column sheet, IBC Seismic), and every rule the design follows is
   listed with its source — the shop's production limits, the economical flange chart, the stocked plates.

   sheets(job, ctx) → [{ name, rows, cols, freeze }] for src/xlsx.js
   ctx: { inputs: [the inputs of each mezzanine], settings, quote (RUN.quoteJob), codeText, generated (date text) } */
(function (root) {
  'use strict';
  const DESIGN = root.MZ_DESIGN || (typeof require !== 'undefined' ? require('./design.js') : null);
  const PCS = root.MZ_PCS || (typeof require !== 'undefined' ? require('./pcs.js') : null);
  const ft = v => (v == null || !isFinite(v) ? '—' : PCS.fmtFtIn(v));
  const num = (v, s = 'n3') => (v == null || v === '' || (typeof v === 'number' && !isFinite(v)) ? '—' : typeof v === 'number' ? { v, s } : v);
  const H = list => list.map(v => ({ v, s: 'h' }));
  const band = (text, n = 3) => [{ v: text, s: 'sec' }, ...Array.from({ length: n - 1 }, () => ({ v: '', s: 'sec' }))];
  // a number as the workbook would hold it: whole numbers plain, else to three places
  const auto = v => (typeof v === 'number' && isFinite(v) ? { v, s: Math.abs(v - Math.round(v)) < 1e-9 ? '' : 'n3' } : v == null ? '—' : v);
  const typed = v => (v == null ? '(blank)' : { v, s: typeof v === 'number' ? 'inpG' : 'inp' });
  // a long note across the sheet from the column 'from': merged and wrapped (src/xlsx.js sizes the row)
  const longRow = (sheet, cells, from, text, style = '') => { const r = cells.concat([{ v: text, s: style }]); r.fullFrom = from; sheet.rows.push(r); };
  // a note under a heading: one cell across the sheet, wrapped
  const note = text => { const r = [{ v: text, s: 'note' }]; r.full = true; return r; };
  // a row whose text from the column k on spans the rest of the sheet, wrapped
  const spanRow = (k, cells) => { cells.fullFrom = k; return cells; };
  const head = text => { const r = [{ v: text, s: 'b' }]; r.full = true; return r; };
  const okc = ok => ({ v: ok ? 'OK' : 'NG', s: ok ? 'ok' : 'ng' });
  const webName = tw => 'W' + String(Math.round(tw * 1000)).padStart(3, '0');
  const frac = v => { const n = Math.round(v * 16); if (Math.abs(v * 16 - n) > 0.02) return String(+(+v).toFixed(4)); const w = Math.floor(n / 16), r = n % 16, g = (a, b) => (b ? g(b, a % b) : a), q = g(r, 16); return r ? `${w ? w + ' ' : ''}${r / q}/${16 / q}` : String(w); };
  const secText = s => (!s ? '—' : s.type === 'WF' ? s.name : `d ${s.d}" · web ${frac(s.tw)}" · ${s.bof} × ${frac(s.tof)}${s.bif !== s.bof || s.tif !== s.tof ? ` / ${s.bif} × ${frac(s.tif)}` : ''}`);
  const flName = s => (!s || s.type === 'WF' ? '—' : DESIGN.flangeName(s.bof, s.tof) + (s.bif !== s.bof || s.tif !== s.tof ? ' / ' + DESIGN.flangeName(s.bif, s.tif) : ''));
  const tierWord = t => ({ G: 'economical', Y: 'somewhat economical', R: 'non-economical' })[t] || t || '—';
  const SRC = { pcs: 'PCS', annotation: 'PCS note', deckGuide: 'deck guide', default: 'standard value', estimate: 'estimate (deck guide)', missing: 'missing', manual: 'typed', none: 'no requirement', design: 'design', typed: 'typed', PCS: 'PCS', 'frame file': 'NBG Frame file' };
  const BOOKS = { 13: 'Mezzanine Beam Design (AISC 13th)', 15: 'Mezzanine Beam Design (AISC 15th)', 16: 'Mezzanine Beam Design (AISC 16th)' };
  const COLBOOKS = { 15: 'Mezzanine Column (AISC 15th)', 16: 'Mezzanine Column (AISC 16th)' };

  function sheets(job, ctx = {}) {
    const out = [], s = ctx.settings || {}, live = (job.mezz || []).filter(r => r && !r.incomplete), r0 = live[0] || {};
    const div = r0.division || 'NBS-IN', ed = r0.edition || {}, marks = job.marks || [];
    const inputs = ctx.inputs || [], q = inputs[0] ? inputs[0].job || {} : {};
    const target = s.target ?? 0.99;

    // ---------------- Summary ----------------
    {
      const cols = [13, 10, 22, 13, 6, 11, 11, 5, 8, 7, 6, 6, 8, 8, 13], B = t => band(t, cols.length);
      const rows = [[{ v: 'Mezzanine design — calc package', s: 't' }]];
      const sh = { name: 'Summary', cols, rows, long: [], wrap: [2, 3, 14] };
      longRow(sh, [], 0, `${q.quote || ''}${q.project ? ' · ' + q.project : ''} · generated ${ctx.generated || new Date().toISOString().slice(0, 10)}. Every number here is an input to, or a result of, NBG's own workbooks — the sheet "Sources" says which. These are values: the live calculation is the NBG workbooks themselves — "Everything (.zip)" carries a filled copy of each, where any input can be changed.`, 'note');
      const kv = (label, value) => spanRow(3, [label, '', '', value]);
      rows.push([], B('Job'),
        kv('Quote', q.quote || '—'), kv('Building code (PCS)', ctx.codeText || (q.code && q.code.text) || '—'),
        kv('Beam sheet', BOOKS[ed.beamEd] || '—'), kv('Column sheet', COLBOOKS[ed.colEd] || '—'), kv('Specification', ed.spec || '—'),
        kv('Division (stock and limits)', div), kv('Stress ratio limit', num(target, 'n2l')), kv('Deflection limits', 'L/360 live, L/240 total (MB sheet)'),
        kv('Mezzanines', live.map(r => r.id).join(', ')), kv('Seismic', job.seismic && job.seismic.ok ? 'IBC Seismic workbook, frame by frame (sheet Seismic)' : 'not finished on the Seismic page — no EQ loads in this package'), [],
        B('Beams'));
      rows.push(
        H(['Mark', 'Section', 'Plates', 'Flange economy', 'plf', 'Member length', 'Trib', 'Qty', 'Comb. SR', 'Shear SR', 'Live L/', 'Total L/', 'MB end shear D (k)', 'MB end shear L (k)', 'Chosen as']));
      marks.forEach(m => (m.spanRuns && m.spanRuns.length ? m.spanRuns : []).forEach((run, i) => {
        const c = run.check; if (!c) return;
        const opt = (m.options || []).find(o => o.key === m.optionKey);
        rows.push([i ? `${m.mark} · ${ft(run.L != null ? run.L : run.span)}` : `${m.mark}${m.kind ? ' ' + m.kind : ''}`, c.desc, secText(m.sec), m.sec && m.sec.type !== 'WF' ? `${flName(m.sec)} ${tierWord(DESIGN.TIER[Math.max(DESIGN.tierOf(m.sec.bof, m.sec.tof), DESIGN.tierOf(m.sec.bif, m.sec.tif))])}` : '—',
          num(c.res.Wt, 'n1'), { v: ft(run.L != null ? run.L : run.span), s: 'r' }, { v: ft(run.params ? run.params.trib : m.trib), s: 'r' }, run.qty, num(c.res.CSR), num(c.res.SRvx), num(c.defl.rLL, 'n0'), num(c.defl.rTL, 'n0'), num(c.V.D), num(c.V.L),
          { v: i ? 'same section, own MB run' : m.optionKey === 'custom' ? 'picked by the engineer' : m.pinned && m.pinned.sec ? 'picked by the engineer' : m.pinned && m.pinned.d != null ? `lightest at ${m.pinned.d}"` : opt ? opt.label : m.optionKey || '—', s: 'pad' }]);
      }));
      rows.push([], B('Columns'), H(['Mezzanine', 'Section', 'Columns', 'Quote as', '', 'Length', 'Qty', '', 'Max CSR', 'Result', '', '', '', '', 'Chosen as']));
      const colWhy = cf => (cf.picked ? `picked by the engineer${cf.sec.type === 'BU' ? ' (Built-Up input, Fy 55)' : ''}${cf.auto ? `; the guide's answer ${cf.auto.quoteAs}` : ''}` : cf.quoteAs === cf.name ? 'the guide: lightest common column that passes' : 'the guide: next W that passes, quoted BU');
      live.forEach(r => { if (!r.colFinal) { if (r.columns.length) rows.push([r.id, { v: 'NOT SIZED', s: 'ng' }, r.columns.map(c => c.label).join(', '), '', '', { v: ft(r.colLen || 0), s: 'r' }, r.columns.length, '', '', '', '', '', '', '', (r.colWhy && r.colWhy.text) || '']); return; }
        rows.push([r.id, r.colFinal.name, r.columns.map(c => c.label).join(', '), r.colFinal.quoteAs, '', { v: ft(r.colLen), s: 'r' }, r.columns.length, '', num(r.colFinal.max), okc(r.colFinal.ok), '', '', '', '', colWhy(r.colFinal)]); });
      if (job.colAlt) rows.push(spanRow(1, ['', { v: `Offered, not on the quote: ${job.colAlt.name} — ${job.colAlt.sec.d}" deep, ${job.colAlt.sec.bof}" × ${job.colAlt.sec.tof}" flanges, ${job.colAlt.sec.tw}" web, Fy 55, max CSR ${job.colAlt.max.toFixed(3)} on the Built-Up input, about ${Math.round(job.colAlt.saves).toLocaleString('en-US')} lb less.`, s: 'note' }]));
      const notes = live.flatMap(r => (r.warn || []).filter(w => w.level === 'stop' || w.level === 'warn').map(w => [r.id, w.level === 'stop' ? 'must fix' : 'check', w.text]));
      // a note several mezzanines share is listed once, with every mezzanine it is for
      const once = list => { const m = new Map(); list.forEach(([id, ...rest]) => { const k = rest[rest.length - 1], e = m.get(k); if (e) { if (!e[0].includes(id)) e[0].push(id); } else m.set(k, [[id], ...rest]); }); return [...m.values()].map(([ids, ...rest]) => [ids.join(', '), ...rest]); };
      if (notes.length) { rows.push([], B('To check before quoting'), H(['Mezzanine', 'Level', 'Note'])); once(notes).forEach(n => longRow(sh, [n[0], { v: n[1], s: n[1] === 'must fix' ? 'ng' : 'warn' }], 2, n[2])); }
      // the design decisions the tool made (the Design page's list): what an engineer checking it needs to know
      const keys = live.flatMap(r => (r.warn || []).filter(w => w.level === 'key').map(w => [r.id, w.text]));
      if (keys.length) { rows.push([], B('Design decisions'), H(['Mezzanine', '', 'Decision'])); once(keys).forEach(n => longRow(sh, [n[0], ''], 2, n[1])); }
      delete sh.long;
      out.push(sh);
    }

    // ---------------- Inputs ----------------
    {
      const rows = [[{ v: 'Inputs — what was read, where it came from, where it goes', s: 't' }], note('Source: PCS = read off the Project Confirmation Summary; typed = entered on the page; standard value = the training guide default; deck guide = NBG deck guide. "Goes into" is the cell in the workbook.'), [],
        H(['Mezzanine', 'Group', 'Input', 'Value', 'Unit', 'Source', 'Goes into', 'Note'])];
      const GEOM = [['A', 'A — finish floor to top of mezzanine', 'ft', 'INPUT D22'], ['B', 'B — clearance under joists', 'ft', 'INPUT F37'], ['C', 'C — clearance under support beams', 'ft', 'INPUT F38'], ['slab', 'Slab and deck thickness', 'in', 'INPUT D23'], ['seat', 'Joist seat depth', 'in', 'INPUT D24'], ['joistSpacing', 'Joist spacing (= unbraced length Lb)', 'ft', 'MB D8'], ['width', 'Mezzanine width', 'ft', 'layout'], ['length', 'Mezzanine length', 'ft', 'layout'], ['startLEW', 'From the left endwall', 'ft', 'layout'], ['startFSW', 'From the front sidewall', 'ft', 'layout'], ['D', 'D — clearance under the frame', 'ft', 'frame design'], ['F', 'F — clearance under the frame', 'ft', 'frame design']];
      const LOADS = [['dead', 'Dead (slab and deck)', 'psf', 'INPUT D14'], ['coll', 'Collateral', 'psf', 'INPUT D15'], ['live', 'Live', 'psf', 'INPUT D16'], ['partition', 'Partition', 'psf', `added to ${s.partitionTo || 'live'}`], ['joistWt', 'Estimated joist weight', 'psf', 'INPUT D17']];
      inputs.forEach((inp, i) => {
        const r = (job.mezz || [])[i], id = (r && r.id) || inp.mezz.id || `Mezzanine ${i + 1}`;
        const row = (grp, [k, lab, unit, cell], node) => {
          const v = node && typeof node === 'object' && 'value' in node ? node.value : node, src = node && node.source;
          const shown = v == null ? '—' : unit === 'ft' && typeof v === 'number' ? ft(v) : unit === 'in' && (k === 'slab' || k === 'seat') ? auto(+(v * 12).toFixed(4)) : typeof v === 'number' ? auto(v) : String(v);
          rows.push([id, grp, lab, shown, unit === 'ft' ? '' : unit, SRC[src] || src || '', cell, (node && node.note) || '']);
        };
        GEOM.forEach(g => row('Geometry', g, inp.geom[g[0]]));
        LOADS.forEach(g => row('Loads', g, inp.loads[g[0]]));
        rows.push([id, 'Floor', 'Deck', inp.mezz.deck || '—', '', inp.mezz.deckText ? `PCS: ${inp.mezz.deckText}` : 'per seller', 'dead load', ''], [id, 'Floor', 'Concrete', inp.mezz.concrete || '—', '', 'PCS', 'dead load', ''], [id, 'Floor', 'Use', inp.mezz.use || '—', '', 'PCS Box 22', 'live load / seismic', '']);
      });
      const set = (lab, v, note = '') => ['', '', lab, v, '', '', '', note];
      rows.push([], band('Design settings', 8), H(['', '', 'Setting', 'Value', '', '', '', 'Note']),
        set('Stress ratio limit', num(target, 'n2l'), 'combined and shear, as the MB sheet reads OK below 1.00'),
        set('Depth range searched', `${s.dMin ?? 10}"–${s.dMax ?? 30}"`, 'capped by the clearance C'),
        set('Flanges', s.symmetric === false ? 'top and bottom may differ' : 'same plate top and bottom'),
        set('Production Guidelines', s.production === false ? 'off' : 'applied'), set('Joist bearing check (MB L7)', s.requireConc === false ? 'report only' : 'must pass'),
        set('Beam marks', ({ intext: 'interior / exterior', single: 'one governing mark', split: 'split by trib / span' })[s.marks] || s.marks || 'interior / exterior'),
        set('Column length', s.colLength === 'clear' ? 'clear below the beams' : 'finish floor to top of mezzanine (A)'), set('Column section', s.colPerJob === false ? 'per mezzanine' : 'one section for the whole job'),
        ...(s.colOverride ? [set('Column picked', typeof s.colOverride === 'object' ? `built-up d ${s.colOverride.d}" · ${s.colOverride.bf}" × ${s.colOverride.tf}" flanges · ${s.colOverride.tw}" web` : String(s.colOverride), 'picked by the engineer over the guide\'s column')] : []));
      out.push({ name: 'Inputs', cols: [12, 10, 34, 13, 6, 18, 13, 40], wrap: [2, 5, 7], rows, freeze: 4 });
    }

    // ---------------- MB sheets: the cells typed, and what the sheet shows ----------------
    {
      const rows = [[{ v: 'MB sheets — the cells typed into the Mezzanine Beam Design workbook, and what it shows', s: 't' }], note('Typed into the real workbook and read back (LibreOffice, recalculated): every "shows" value equals what Excel shows.'), []];
      (job.excel && job.excel.beam || []).forEach(b => {
        rows.push(band(`${BOOKS[b.edition] || b.file} — copy ${b.copy}: ${b.sheets.map(x => `${x.sheet} = ${x.mark}${x.shorter ? ' at ' + ft(x.span) : ''}`).join(', ')}`, 3));
        const inp = b.inputs[0];
        rows.push([{ v: `INPUT sheet${b.inputs.length > 1 ? ` (${inp.mezz}'s heights)` : ''}`, s: 'b' }], H(['Cell', 'Field', 'Value typed']));
        inp.steps.forEach(st => rows.push([`${st.sheet}!${st.cell}`, st.label, typed(st.value)]));
        rows.push(H(['Cell', 'The sheet shows', 'Value']));
        inp.read.forEach(rd => rows.push([`${rd.sheet}!${rd.cell}`, rd.label, auto(rd.expect)]));
        b.sheets.forEach(sh => {
          const m = marks.find(x => x.mark === sh.mark), run = m && (m.spanRuns || []).find(z => Math.abs(z.span - sh.span) < 1e-3), c = run && run.check;
          rows.push([], [{ v: `Sheet ${sh.sheet} · ${sh.mark}${sh.kind ? ' ' + sh.kind : ''}: ${sh.desc}, ${ft(sh.L)} × ${ft(sh.trib)} trib, ${sh.qty} beam${sh.qty > 1 ? 's' : ''}`, s: 'b' }], H(['Cell', 'Field', 'Value typed']));
          sh.steps.forEach(st => rows.push([`${st.sheet}!${st.cell}${st.where ? ' (' + st.where + ')' : ''}`, st.label, typed(st.value)]));
          rows.push(H(['Cell', 'The sheet shows', 'Value']));
          sh.read.forEach(rd => rows.push([`${rd.sheet}!${rd.cell}`, rd.label, auto(rd.expect)]));
          if (c) {
            rows.push(['', 'Uniform loads w: joist / beam / floor dead / floor live / total (klf)', `${c.w.joist.toFixed(3)} / ${c.w.beam.toFixed(3)} / ${c.w.FDL.toFixed(3)} / ${c.w.FLL.toFixed(3)} / ${c.w.total.toFixed(3)}`],
              ['', 'Moment, dead / live / total (ft-kip)', `${c.M.D.toFixed(2)} / ${c.M.L.toFixed(2)} / ${c.M.T.toFixed(2)}`],
              ['', 'Deflection, dead / live / total (in)', `${c.defl.DL.toFixed(3)} / ${c.defl.LL.toFixed(3)} / ${c.defl.TL.toFixed(3)}`],
              ['', 'Moment of inertia Ix (in⁴) · weight (plf)', `${c.res.Ix.toFixed(2)} · ${c.res.Wt.toFixed(2)}`],
              ['', 'Combined SR · shear SR · max SR (Main Report)', `${c.res.CSR.toFixed(3)} · ${c.res.SRvx.toFixed(3)} · ${c.res.maxSR.toFixed(3)}`]);
            if (c.conc) rows.push(['', 'Joist bearing (L7): Ru (k) · web local yielding · crippling · sidesway', `${c.conc.Ru.toFixed(2)} · ${c.conc.WLY.toFixed(3)} · ${c.conc.WC.toFixed(3)} · ${c.conc.WSB == null ? '--' : c.conc.WSB.toFixed(3)}`]);
          }
        });
        rows.push([]);
      });
      out.push({ name: 'MB sheets', cols: [24, 56, 30], wrap: [1], rows });
    }

    // ---------------- Beam options ----------------
    {
      const rows = [[{ v: 'Beam options — how each section was found', s: 't' }], note('Every stocked web and flange for the division, through the MB sheet, inside the production limits; the options are the lightest, the step-by-step "best fit", and the most economical by the flange chart.'), []];
      marks.forEach(m => {
        const sr = m.search; if (!sr) return;
        rows.push(band(`${m.mark}${m.kind ? ' ' + m.kind : ''} — designed ${ft(m.params ? m.params.L : m.span)} × ${ft(m.params ? m.params.trib : m.trib)} trib · ${sr.evaluated.toLocaleString('en-US')} combinations run · depth ${sr.options.dMin}"–${sr.dTop}"${sr.dTop < sr.options.dMax ? ' (clearance C)' : ''}`, 13));
        rows.push(H(['Option', 'Section', 'Depth', 'Web', 'Flanges', 'Economy', 'plf', 'vs lightest', 'Combined', 'Shear', 'Live L/', 'Total L/', 'On the quote']));
        // one row a section: options that land on the same section share it ("Lightest · Best fit")
        const groups = [];
        (m.options || []).forEach(o => { const g = groups.find(x => x.some(y => ['d', 'tw', 'bof', 'tof', 'bif', 'tif'].every(k => y.pick.sec[k] === o.pick.sec[k]))); if (g) g.push(o); else groups.push([o]); });
        groups.map(g => ({ ...g[0], label: g.map(x => x.label).join(' · '), why: g.map(x => (g.length > 1 ? `${x.label}: ` : '') + x.why).join(' '), key: (g.find(x => x.key === m.optionKey) || g[0]).key })).forEach(o => { const p = o.pick; rows.push([{ v: o.label, s: 'b' }, p.desc, `${p.sec.d}"`, p.web, p.flange, tierWord(p.tier), num(p.wt, 'n1'), { v: o.dWt ? `${o.dWt > 0 ? '+' : ''}${(o.dPct * 100).toFixed(1)} %` : 'lightest', s: 'r' }, num(p.CSR), num(p.SRv), num(p.rLL, 'n0'), num(p.rTL, 'n0'), { v: m.optionKey === o.key ? 'yes' : '', s: 'c' }], spanRow(1, ['', { v: o.why + (o.needC != null ? ` Needs C ≤ ${ft(o.needC)}.` : ''), s: 'note' }])); });
        const fit = (m.options || []).find(o => o.key === 'fit') || (m.options || []).find(o => o.steps);
        const steps = fit && fit.steps ? fit.steps : null;
        if (steps) { rows.push(head('Best fit, step by step')); steps.forEach((st, i) => rows.push(spanRow(1, [`${i + 1}`, st.text]))); }
        const removed = Object.entries(sr.removed || {});
        if (removed.length) { rows.push(head('Left out by the production limits')); removed.sort((a, b) => b[1] - a[1]).forEach(([k, n]) => rows.push(spanRow(1, [n.toLocaleString('en-US'), DESIGN.RULE_TXT[k] || k]))); }
        rows.push(head('Lightest section at each depth'), H(['Depth', 'Section', '', 'Web', 'Flanges', 'Economy', 'plf', '', 'Combined', 'Shear', 'Live L/', 'Total L/', 'Joist bearing']));
        sr.byDepth.forEach(z => rows.push(z.none ? (z.near && !sr.best ? [`${z.d}"`, `${z.near.desc} — closest, ${Math.round(z.near.over * 100 - 100)}% over`, '', z.near.web, z.near.flange, tierWord(z.near.tier), num(z.near.wt, 'n1'), '', num(z.near.CSR), num(z.near.SRv), num(z.near.rLL, 'n0'), num(z.near.rTL, 'n0'), num(z.near.conc)] : [`${z.d}"`, 'nothing stocked passes']) : [`${z.d}"`, z.desc, '', z.web, z.flange, tierWord(z.tier), num(z.wt, 'n1'), '', num(z.CSR), num(z.SRv), num(z.rLL, 'n0'), num(z.rTL, 'n0'), num(z.conc)]));
        if (m.deeper && m.deeper.length) { rows.push(head('Deeper than the clearance allows (each needs C lowered)'), H(['Depth', 'Section', '', '', '', '', 'plf', '', 'Combined', '', 'Live L/', '', 'C at most'])); m.deeper.forEach(z => rows.push([`${z.d}"`, z.desc, '', '', '', '', num(z.wt, 'n1'), '', num(z.CSR), '', num(z.rLL, 'n0'), '', ft(z.needC)])); }
        rows.push([]);
      });
      out.push({ name: 'Beam options', cols: [24, 11, 7, 7, 9, 19, 7, 9, 9, 7, 7, 7, 9], wrap: [0], rows });
    }

    // ---------------- Shop rules ----------------
    {
      const rows = [[{ v: 'Shop rules — the limits every section is held to', s: 't' }], []];
      const W = 8;
      rows.push(band('NBG Production Guidelines (rev. 2026.01.15) — Primary & Secondary Steel, built-up members, by division', W),
        H(['Division', 'Part depth (in)', 'Flange width (in)', 'Flange thickness max (in)', 'Thinnest web → flange max', 'Part length max (ft)', 'Part weight max (lb) < 35 ft / ≥ 35 ft', 'Web / flange']));
      DESIGN.DIVISIONS.forEach(dv => { const P = DESIGN.PROD[dv]; rows.push([{ v: dv === 'West' ? 'West (NBG-UT)' : dv, s: dv === div ? 'b' : '' }, `${P.d[0]}–${P.d[1]}`, `${P.bf[0]}–${P.bf[1]}`, `${P.tfMax}"`, P.thin ? `${P.thin.tw}" → ${P.thin.tf}"` : '—', `${P.L}`, `${P.wt[0].toLocaleString('en-US')} / ${P.wt[1].toLocaleString('en-US')}`, P.tfPlus ? 'tf > tw + 1/16" (d < 30") / 1/8"' : 'tw ≤ tf (DG 25)']); });
      rows.push(note('Every division: web / flange thickness ≥ 0.30; flange width ≤ depth (8" deep: ≤ 6"–7" by division); depth / flange width ≤ 7; thickest / thinnest flange ≤ 2.0; handling over 40 ft: a 6 × 3/8 or 8 × 1/4 flange at least.'), []);
      const seen = new Set();
      marks.forEach(m => {
        if (!m.sec || m.sec.type === 'WF' || seen.has(m.desc)) return; seen.add(m.desc);
        const L = Math.max(...(m.spanRuns || [{ L: m.span }]).map(z => z.L || z.span)), wt = m.check ? m.check.res.Wt : 0;
        rows.push(band(`${m.desc} (${m.mark}) against the ${div} limits — part ${ft(L)}, ${Math.round(wt * L).toLocaleString('en-US')} lb`, W), H(['Rule', 'Value', 'Result']));
        DESIGN.prodChecks(m.sec, div, L, wt).forEach(c => rows.push([c.text, c.val, okc(c.ok)]));
        rows.push([]);
      });
      rows.push(band('NBG Economical Flange Sections — G economical · Y somewhat economical · R non-economical · — not flange material', W + 1));
      const TH = [0.1875, 0.25, 0.3125, 0.375, 0.5, 0.625, 0.75, 1];
      rows.push(H(['Width \\ thickness', ...TH.map(t => `${frac(t)}"`)]));
      [5, 6, 8, 10, 12].forEach(w => rows.push([`${w}"`, ...TH.map(t => { if (!DESIGN.inChart(w, t)) return '—'; const g = DESIGN.TIER[DESIGN.tierOf(w, t)]; return { v: g, s: g === 'G' ? 'ok' : g === 'Y' ? 'warn' : 'ng' }; })]));
      rows.push(note('Start considering 10" flanges when F8.50 (IF) and F8.38 (OF) start failing. 12" flanges are good sections but typically more expensive.'), []);
      rows.push(band(`DM 5.1 stock inventory — ${div}`, W), H(['Plate', 'Sizes stocked']));
      rows.push(spanRow(1, ['Webs', Object.keys(DESIGN.WEB_STOCK).map(Number).sort((a, b) => a - b).filter(t => DESIGN.inStock(DESIGN.WEB_STOCK, t, div)).map(t => `${t}" (${webName(t)})`).join(', ')]));
      [6, 8, 10, 12].forEach(w => rows.push(spanRow(1, [`Flanges ${w}" wide`, Object.keys(DESIGN.FLANGE_STOCK).map(k => k.split('x').map(Number)).filter(([b, t]) => b === w && DESIGN.inStock(DESIGN.FLANGE_STOCK, b + 'x' + t, div)).map(([, t]) => `${frac(t)}"`).join(', ') || 'none'])));
      rows.push(spanRow(1, ['Wide flange', Object.keys(DESIGN.WF_STOCK).filter(k => DESIGN.inStock(DESIGN.WF_STOCK, k, div)).join(', ')]));
      out.push({ name: 'Shop rules', cols: [30, 16, 12, 12, 16, 10, 18, 22, 8], wrap: [0, 1, 7], rows });
    }

    // ---------------- Columns ----------------
    {
      const rows = [[{ v: 'Columns — the Column sheet, case by case', s: 't' }], note('Loads: the unfactored MB-sheet end shears (H6 dead, H10 live) of the beams framing in, summed per side. Three combinations (DM 15.1.1.4.2); each must read OK.'), []];
      (job.excel && job.excel.column || []).forEach(b => b.cases.forEach(cs => {
        const r = (job.mezz || [])[cs.mi], g = r && r.colGroups[cs.group], chk = r && r.colFinal && r.colFinal.checks[cs.group];
        rows.push(band(`${COLBOOKS[b.edition] || b.file} — ${cs.labels.join(', ')} (${cs.mezz})${r && r.colFinal ? ' · ' + r.colFinal.name : ''}`, 5), H(['Cell', 'Field', 'Value typed']));
        cs.steps.forEach(st => rows.push([`${st.sheet}!${st.cell}${st.where ? ' (' + st.where + ')' : ''}`, st.label, typed(st.value)]));
        rows.push(H(['Cell', 'The sheet shows', 'Value']));
        cs.read.forEach(rd => rows.push([`${rd.sheet}!${rd.cell}`, rd.label, auto(rd.expect)]));
        if (chk) {
          rows.push(H(['Combination', 'Mx (ft-kip)', 'Axial (kip)', 'Max CSR', 'Result']));
          ['DLt+LLt+DRt', 'DLt+DRt+LRt', 'DLt+LLt+DRt+LRt'].forEach((n, i) => { const k = chk.combos[i]; rows.push([n, num(k.Mx, 'n2'), num(k.P, 'n2'), num(k.csr), okc(k.ok)]); });
          rows.push(['Eccentricity e = d/2 (in) · self-weight (k)', `${chk.ex.toFixed(2)} · ${chk.wt.toFixed(3)}`]);
        }
        if (g && g.design && g.design.tried) {
          rows.push([{ v: 'Sizes tried, lightest first (the guide\'s method)', s: 'b' }], H(['Section', 'Max CSR', 'Result'])); g.design.tried.forEach(t => rows.push([t.name, num(t.max), okc(t.ok)]));
          if (r.colFinal && r.colFinal.picked && chk) rows.push([`${r.colFinal.name} — picked by the engineer (on the quote)`, num(chk.max), okc(chk.ok)]);
        }
        rows.push([]);
      }));
      out.push({ name: 'Columns', cols: [30, 46, 18, 12, 10], wrap: [0, 1], rows });
    }

    // ---------------- Frame loads ----------------
    {
      const rows = [[{ v: 'Loads to the frame — by frame line, on the frame\'s own columns', s: 't' }], note('Unfactored mezzanine beam end shears (MB H6 / H10) summed at each building column; in NBG Frame as FDL / FLL concentrated loads (WebCenterline) and the seismic as EQR + / EQL − at the mezzanine level.'), [],
        H(['Building', 'Frame line', 'Column', 'NBG Frame member', 'Where', 'At A (ft)', 'Floor dead (k)', 'Floor live (k)', 'Seismic applied (k)', 'Seismic calculated (k)', 'From'])];
      (job.frameEntries || []).forEach(fl => fl.entries.forEach(e => {
        const eq = (e.eq || []).reduce((a, x) => a + x.F, 0), calc = (e.eq || []).reduce((a, x) => a + (x.calc ?? x.F), 0);
        rows.push([fl.building || '', fl.frame, e.label, e.member || '—', e.where, num(e.A != null ? e.A : e.elev, 'n2'), num(e.D), num(e.L), e.eq && e.eq.length ? num(eq) : '', e.eq && e.eq.length ? num(calc) : '', e.parts.map(p => `${p.mezz} ${p.beam}${p.mark ? ' ' + p.mark : ''}`).join(' + ')]);
      }));
      out.push({ name: 'Frame loads', cols: [10, 7, 8, 10, 34, 8, 9, 9, 10, 11, 30], wrap: [4, 10], rows, freeze: 4 });
    }

    // ---------------- Seismic ----------------
    const sj = job.seismic;
    if (sj && sj.ok) {
      const rows = [[{ v: 'Seismic — the IBC Seismic workbook, frame line by frame line', s: 't' }], note('The workbook (rev. 2021.01.20) with these cells typed gives these results (checked: every frame of the sample jobs recalculated in the workbook equals the tool). Values are QE — NBG Frame applies ρ and the ASD 0.7.'), []];
      sj.buildings.forEach(b => {
        const w = b.workbook; if (!w) return;
        rows.push(band(`${b.name} — Input Data (the building and the mezzanines)`, 7), H(['Cell', 'Field', 'Value typed']));
        w.input.forEach(st => rows.push([`${st.sheet}!${st.cell}`, st.label, st.show]));
        rows.push([], band(`${b.name} — Longitudinal Calcs. (the bracing)`, 7), H(['Cell', 'Field', 'Value typed']));
        w.long.forEach(st => rows.push([`${st.sheet}!${st.cell}`, st.label, st.show]));
        rows.push(H(['Cell', 'The workbook shows', 'Value']));
        w.longRead.forEach(rd => rows.push([`${rd.sheet}!${rd.cell}`, rd.label, auto(rd.expect)]));
        w.frames.forEach(fr => {
          rows.push([], band(`${b.name} — frame line ${fr.label} on Lateral Calcs. (1)`, 7), H(['Cell', 'Field', 'Value typed']));
          fr.steps.forEach(st => rows.push([`${st.sheet}!${st.cell}`, st.label, st.show]));
          rows.push(H(['Cell', 'The workbook shows', 'Value']));
          fr.read.forEach(rd => rows.push([`${rd.sheet}!${rd.cell}`, rd.label, auto(rd.expect)]));
        });
        rows.push([], band(`${b.name} — applied to NBG Frame (EQR = +, EQL = −, at the mezzanine level)`, 7), H(['Frame line', 'Column', 'Member', 'At (ft)', 'Calculated (k)', 'Applied (k)', 'Edited']));
        b.frames.forEach(fr => fr.eqs.forEach(e => rows.push([fr.label, e.label, e.member, num(e.at, 'n2'), num(e.calc ?? e.F), num(e.F), e.edited || ''])));
        if (b.long) { rows.push([], band(`${b.name} — bracing`, 7), H(['Mezzanine', 'Seismic force for the bracing (k)'])); b.long.mezzLoads.forEach(m => rows.push([m.id, num(m.F)])); }
        rows.push([]);
      });
      out.push({ name: 'Seismic', cols: [26, 50, 20, 10, 12, 11, 10], wrap: [1], rows });
    }
    else {
      // not finished on the Seismic page: said here, so the package never reads as if seismic were checked
      const need = (sj && sj.need) || [];
      out.push({ name: 'Seismic', cols: [26, 70], wrap: [1], rows: [[{ v: 'Seismic — not finished', s: 't' }],
        note('The Seismic page still needs the entries below, so this package has no EQ loads, the frame files carry none and no IBC Seismic workbook is filled. Finish the Seismic page and export the package again.'), [],
        H(['Still needed', '']), ...(need.length ? need.map(t => spanRow(0, [t])) : [spanRow(0, ['the Seismic page has not been run for this job'])])] });
    }

    // ---------------- Sources ----------------
    out.push({ name: 'Sources', cols: [30, 22, 46, 40], wrap: [0, 1, 2, 3], freeze: 3, rows: [
      [{ v: 'Sources — where each number comes from', s: 't' }], [],
      H(['Document / workbook', 'Revision / file', 'Gives', 'Checked by']),
      [BOOKS[ed.beamEd] || 'Mezzanine Beam Design', ed.beamEd ? `Mezzanine_Beam_Design_${ed.beamEd}th.xls` : '', 'INPUT sheet (loads, heights, clearances); MB1–MB4 (member length, Lb, trib, section → end shears H6 / H10, deflections, combined / shear, joist bearing L7)', 'cell-for-cell port; the real workbook run on every option and every job (oracle) — the filled copy reads the same'],
      [COLBOOKS[ed.colEd] || 'Mezzanine Column', ed.colEd ? `Mezzanine_Column_${ed.colEd}th_S16-*.xls` : '', 'Column sheet (L, section, left / right reactions → three combinations, CSR)', 'the real workbook on every column case'],
      ['IBC Seismic', 'rev. 2021.01.20 (IBC_Seismic.xls)', `Input Data, Lateral Calcs. (1) per frame line, Longitudinal Calcs. → mezzanine seismic force per frame and for the bracing${sj && sj.ok ? '' : ' — not used in this package yet (the Seismic page is not finished)'}`, '1,386 of 1,386 values over 15 cases; every frame of the sample jobs recalculated in the workbook'],
      ['NBG Production Guidelines', 'rev. 2026.01.15 (Primary & Secondary Steel, built-up)', 'part depth / width / thickness / length / weight by division; web / flange rules (sheet Shop rules)', 'every section searched is held to them'],
      ['DPM — Production Limitations', '', 'shop limitations behind the guidelines', ''],
      ['NBG Economical Flange Sections', '', 'G / Y / R flange plates; 8" then 10" then 12" (sheet Shop rules)', 'the "most economical" option and the economy column'],
      ['DM 5.1 — Stock Inventory', '', 'webs, flanges and W shapes stocked by division (sheet Shop rules)', 'only stocked plates are searched'],
      ['DM 15.1 — Mezzanine Systems', '', 'beams on the short span, joist spacing, deflection, connections, bracing (DM checklist on the Design page)', ''],
      ['Mezzanine Training Guide', '', 'the input sequence; joist weight 8 psf; common columns W10X22 / W8X24 / W12X26, larger W quoted as BU', ''],
      ['NBG deck guide', '', 'slab + deck dead load (4" NW on 1.0C = 43 psf)', ''],
      ['Project Confirmation Summary (PCS)', q.quote || '', 'Box 2 / 5 building and frames; Box 3 seismic; Box 4 roof loads; Box 22 mezzanines; the floor plan (⊗ mezzanine columns, I frame columns, ✱ most-economical frame columns)', 'every value read is listed on sheet Inputs with its source'],
    ] });
    return out;
  }

  const api = { sheets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_CALCPACK = api;
})(typeof self !== 'undefined' ? self : this);
