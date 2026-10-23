/* Mezzanine Quick-Design — browser UI (Astra skin). */
(function () {
  'use strict';
  const PCS = window.MZ_PCS, FF = window.MZ_FRAMEFILE, BRF = window.MZ_BRACING, XLS = window.MZ_XLS, RUN = window.MZ_RUN, EX = window.MZ_EXTRACT, DESIGN = window.MZ_DESIGN, WF = window.MZ_WF, PLAN = window.MZ_PLAN, M3 = window.MZ_3D, LAYOUT = window.MZ_LAYOUT;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ft = x => PCS.fmtFtIn(x);
  const f = (x, d = 3) => (x == null || !isFinite(x) ? '—' : (+x).toFixed(d));
  const n0 = x => (x == null || !isFinite(x) ? '—' : Math.round(x).toLocaleString('en-US'));
  const MARK_COLORS = ['var(--mark-1)', 'var(--mark-2)', 'var(--mark-3)', 'var(--mark-4)'];
  const HEX = ['#42e5ae', '#67bdf4', '#f6c779', '#c9a2ff'];
  const edLabel = ed => ({ 13: 'AISC 13th', 15: 'AISC 15th', 16: 'AISC 16th' })[ed] || ed;
  const sameSec = (a, b) => a && b && a.d === b.d && a.tw === b.tw && a.bof === b.bof && a.tof === b.tof && a.bif === b.bif && a.tif === b.tif;
  const pct = v => Math.max(0, Math.min(100, v * 100));

  // all: one { inputs, settings } per mezzanine of the job — they are designed together (shared beams / columns);
  // inputs / settings / res are the mezzanine on screen
  let railView = '3d';   // sidebar view: '3d' turning model | 'plan' labelled floor plan
  const state = { pages: null, pcs: null, mi: 0, all: null, job: null, inputs: null, settings: { ...RUN.SETTINGS }, res: null, view: 'upload', mark: 0, markSpan: 0, colGroup: 0, planPaths: null, planReg: null, planKey: null, planPage: null, nbg: { files: [], height: 'A', web: null, br: null }, seis: {} };

  // Beam marks run over the whole job: MB1 is one section, one colour and one MB-sheet run in every mezzanine.
  // state.job.marks is the job's list; r.marks is one mezzanine's share of it (its beams and its count).
  const jobMarks = () => (state.job && state.job.marks) || [];
  // a mark with no section is drawn red everywhere (plan, run labels, 3D, keys) — never in a mark's "pass" colour
  // (a section picked by hand that fails, too)
  const mkBad = mk => !!(mk && (!mk.sec || (mk.optionKey === 'custom' && markFails(mk))));
  const mkHex = mk => (mkBad(mk) ? '#ff6b6b' : HEX[(mk && mk.index > 0 ? mk.index : 0) % 4]);
  const mkVar = mk => (mkBad(mk) ? 'var(--red)' : MARK_COLORS[(mk && mk.index > 0 ? mk.index : 0) % 4]);
  const mkName = mk => (mk ? mk.mark + (mk.kind ? ' · ' + mk.kind : '') : '');
  const mkOf = (r, id) => (r && r.marks ? r.marks.find(mk => mk.beams.includes(id)) : null);
  const manyMezz = () => !!(state.all && state.all.length > 1);
  // loads to the frame of the building on screen (a job can hold mezzanines in two buildings, each in its own coordinates)
  const sameBldg = q => !q || !q.bkey || !state.res || !state.res.bkey || q.bkey === state.res.bkey;
  const bldgFrameLoads = () => ((state.job && state.job.frameLoads) || []).filter(sameBldg);
  // how many beams of a mark's run (one member length) sit on less trib than the mark is designed for
  const mkLessTrib = (mk, run) => (mk.beamsAll || []).filter(x => Math.abs(x.span - run.span) < 1e-3 && x.trib < mk.trib - 1e-3).length;
  // where a job mark's beams are: "BSW 2 · LEW 2"
  const mkWhere = mk => {
    const ms = state.job ? state.job.mezz : [];
    if (ms.length < 2 || !mk.beamsAll) return '';
    const n = new Map();
    mk.beamsAll.forEach(x => n.set(x.mi, (n.get(x.mi) || 0) + 1));
    return [...n].map(([mi, k]) => `${ms[mi].id} × ${k}`).join(" · ");
  };
  // the shorter members of a mark: same section, own MB-sheet run — "+ 1 at 12'-4\""
  const mkShort = mk => (mk.spanRuns || []).filter(q => q.span < mk.span - 1e-3).map(q => `+ ${q.qty} at ${ft(q.span)}`).join(' · ');
  const runOf = (mk, span) => (mk && mk.spanRuns ? mk.spanRuns.find(q => Math.abs(q.span - span) < 1e-3) : null);
  // a mark's MB-sheet span and trib (set on the Beam calc page) vs the layout's; a run's MB-sheet length
  const mkDz = mk => (mk && mk.design) || { span: mk ? mk.span : 0, trib: mk ? mk.trib : 0, cut: 0, set: false };
  const runL = q => (q && q.L != null ? q.L : q ? q.span : 0);
  // a mark that does not pass (a section picked by hand, or none): the MB sheet ratios, deflection and joist bearing
  const markFails = mk => { const t = state.settings.target, c = mk && mk.check; return !c || !(c.res.CSR <= t && c.res.SRvx <= t && c.llOK && c.tlOK && (!c.conc || c.conc.ok)); };
  const mkDims = mk => { const d = mkDz(mk); return `${ft(d.span)} × ${ft(d.trib)}${d.set ? ` <small class="sub-n">${d.setback ? 'clear span, frame column setback' : 'design'} · layout ${ft(mk.span)} × ${ft(mk.trib)}</small>` : ''}`; };
  // the beam end loads that go to the frame and the columns: the layout span and trib with the mark's section
  const layoutV = (mk, q) => (mk && mk.sec && mk.params ? DESIGN.reactions({ ...mk.params, L: q ? q.span : mk.span, trib: mk.trib }, mk.sec) : null);
  const allSettings = () => (state.all ? state.all.map(a => a.settings) : [state.settings]);
  // a mezzanine's layout edited on the Plan page (lines, columns taken out, frame / mezzanine columns)
  const layEdited = st => !!(st && (st.xLines || st.yLines || (st.drop && st.drop.length) || (st.colKind && Object.keys(st.colKind).length)));

  // ---------- one holistic drawing: every mezzanine of the job in this building, drawn together ----------
  function jobView() {
    const r = state.res;
    if (!r || r.incomplete) return [];
    if (viewCache.job === state.job && viewCache.r === r) return viewCache.ms;
    const ms = [];
    (state.job ? state.job.mezz : [r]).forEach(o => {
      if (o.incomplete) return;
      if (o === r || (o.grid.length === r.grid.length && o.grid.width === r.grid.width)) { ms.push(o); return; }
      // a mezzanine in a building attached to this one (a lean-to): drawn in this building's coordinates
      const mp = viewMapOf(o);
      if (mp) ms.push(Object.assign(Object.create(o), { layout: mapLayout(o.layout, mp, o), _map: mp, _own: o }));
    });
    Object.assign(viewCache, { job: state.job, r, ms: ms.length ? ms : [r] });
    return viewCache.ms;
  }
  // the printout's header: what was designed, to which code and sheets, when, with which build of the tool
  function printHead() {
    const el = $('#printHead'), r = state.res;
    if (!el) return;
    if (!r || !state.pcs) { el.innerHTML = ''; return; }
    const j = state.pcs.job || {}, code = (state.inputs.job && state.inputs.job.code) || {}, ed = r.edition || {};
    const gen = (document.querySelector('meta[name="generator"]') || {}).content || '', build = (gen.match(/build (\S+?);/) || [])[1];
    const sheets = [ed.beamEd && `Mezzanine Beam Design ${ed.beamEd}th`, ed.colEd && `Mezzanine Column ${ed.colEd}th`].filter(Boolean).join(' · ');
    el.innerHTML = `<b>Mezzanine design · ${esc(j.quote || state.fileName || '')}</b><span>${esc(code.text || (code.year ? 'IBC ' + code.year : ''))}${code.spec ? ' → ' + esc(code.spec) : ''}${sheets ? ' → ' + esc(sheets) : ''}</span><span>${esc(r.division || '')}${manyMezz() ? ' · ' + esc(state.job.mezz.map(m => m.id).join(' + ')) : ''}</span><span>Printed ${new Date().toISOString().slice(0, 10)}${build ? ' · tool build ' + esc(build) : ''}</span>`;
  }
  window.addEventListener('beforeprint', printHead);
  const viewCache = {};
  /* how a mezzanine's building sits in the building picked at the top, through the PCS attachment (both mapped to the
     floor plan's building): separable — x maps on its own, y on its own */
  function viewMapOf(m) {
    const r = state.res, pcs = state.pcs;
    if (!pcs || !r || !pcs.mezzanines) return null;
    const pm = i => RUN.planMap(pcs, pcs.mezzanines[i] || {}), a = pm(m.index), b = pm(r.index);
    if (!a || !b) return null;
    const to = (x, y) => { const h = a.toHost(x, y); return b.fromHost(h.x, h.y); }, from = (x, y) => { const h = b.toHost(x, y); return a.fromHost(h.x, h.y); };
    return { to, from, X: v => to(v, 0).x, Y: v => to(0, v).y };
  }
  // a mezzanine's layout drawn in another building's coordinates; every point keeps its own (ox, oy) for the calcs
  function mapLayout(lay, mp, own) {
    const P = p => ({ ...p, x: mp.X(p.x), y: mp.Y(p.y), ox: p.x, oy: p.y }), num = (a, b) => a - b;
    const alongX = lay.joists === 'y', lineMap = alongX ? mp.Y : mp.X, runMap = alongX ? mp.X : mp.Y, fp = lay.footprint;
    const c0 = mp.to(fp.x0, fp.y0), c1 = mp.to(fp.x1, fp.y1);
    return { ...lay, mapped: true,
      footprint: { x0: Math.min(c0.x, c1.x), x1: Math.max(c0.x, c1.x), y0: Math.min(c0.y, c1.y), y1: Math.max(c0.y, c1.y) },
      xLines: lay.xLines.map(mp.X).sort(num), yLines: lay.yLines.map(mp.Y).sort(num),
      beamLines: lay.beamLines.map(lineMap).sort(num), supportLines: lay.supportLines.map(runMap).sort(num),
      beams: lay.beams.map(b => { const f = runMap(b.from), t = runMap(b.to); return { ...b, line: lineMap(b.line), from: Math.min(f, t), to: Math.max(f, t), ends: b.ends.map(P) }; }),
      supports: lay.supports.map(P), mezzCols: lay.mezzCols.map(P), dropped: (lay.dropped || []).map(P), alt: null,
      labX: v => own.grid.xLabel(mp.from(v, 0).x), labY: v => own.grid.yLabel(mp.from(0, v).y),
      bldg: (() => { const a = mp.to(0, 0), b = mp.to(own.grid.length, own.grid.width); return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), name: own.inpBuilding || '' }; })() };
  }
  // a grid line's label in the view: this building's, else an attached building's
  const viewLabX = x => state.res.grid.xLabel(x) || jobView().map(m => m.layout.labX && m.layout.labX(x)).find(Boolean) || null;
  const viewLabY = y => state.res.grid.yLabel(y) || jobView().map(m => m.layout.labY && m.layout.labY(y)).find(Boolean) || null;
  const inpOf = m => (state.all && state.all[m.index] ? state.all[m.index].inputs : state.inputs);
  // a job mark's beams on the drawing in view (one building), not counting a neighbour's edge it carries
  const viewQty = mk => { const ids = new Set(jobView().map(m => m.index)); return (mk.beamsAll || []).filter(x => ids.has(x.mi)).length; };
  const atPt = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;
  // C1, C2 … numbered once over the job (plans, 3D, Column page): along the length, then from the BSW
  // counted in the floor plan's building (the PCS drawing's), so a column keeps its number whichever building is picked
  const colNosRaw = () => {
    const pcs = state.pcs, ms = state.job ? state.job.mezz.filter(m => m && !m.incomplete) : jobView();
    const pts = ms.flatMap(m => { const mp = pcs && pcs.mezzanines ? RUN.planMap(pcs, pcs.mezzanines[m.index] || {}) : null; return m.layout.mezzCols.map(c => ({ label: c.label, ...(mp ? mp.toHost(c.x, c.y) : { x: c.x, y: c.y }) })); });
    return new Map(pts.sort((a, b) => a.x - b.x || b.y - a.y).map((c, i) => [c.label, i + 1]));
  };
  // the numbers the job had before the Plan page edits stay with their columns; new columns are numbered after them
  const colNos = () => {
    const now = colNosRaw();
    if (!state.colBase || !allSettings().some(layEdited)) return now;
    const out = new Map(), next = { n: Math.max(0, ...state.colBase.values()) };
    [...now.keys()].forEach(l => { if (state.colBase.has(l)) out.set(l, state.colBase.get(l)); });
    [...now.keys()].forEach(l => { if (!out.has(l)) { out.set(l, ++next.n); state.colBase.set(l, next.n); } });   // kept for the next edit
    return out;
  };
  // building columns the mezzanine beams frame into, once each over the job
  const bldgCols = () => { const out = []; jobView().forEach(m => m.layout.supports.filter(sp => sp.building).forEach(sp => { if (!out.some(q => atPt(q, sp))) out.push(m._map ? { ...sp, mi: m.index } : sp); })); return out; };
  // a building column's tip key: its own building's coordinates, and the mezzanine when it is an attached building's
  const bcolTip = sp => (sp.mi != null ? `bcol|${sp.ox}|${sp.oy}|${sp.mi}` : `bcol|${sp.x}|${sp.y}`);
  // the frame loads at a building column the view drew (an attached building's in its own coordinates)
  const bcolLoad = sp => (sp.mi != null ? ((state.job && state.job.frameLoads) || []).filter(q => q.bkey === state.job.mezz[sp.mi].bkey).find(q => atPt(q, { x: sp.ox, y: sp.oy })) : bldgFrameLoads().find(q => atPt(q, sp)));
  // the mark that colours a beam: its own, or for an edge carried by a neighbour, the carrying beam's
  const bandMark = (m, b) => (b.absorbed ? mkOf(state.job.mezz[b.absorbed.mi], b.absorbed.into[0]) : mkOf(m, b.id));
  // a column's job record (loads, beams in) and where it is designed
  function colInfo(pt) {
    const job = state.job, c = job && (job.columns.find(q => atPt(q, pt) && (pt.mi == null || q.owner === pt.mi || (q.seenIn || []).includes(pt.mi))) || (pt.mi == null ? null : job.columns.find(q => atPt(q, pt))));
    if (!c) return null;
    const m = job.mezz[c.owner], gi = m.colGroups.findIndex(gp => gp.cols.some(q => q.label === c.label));
    return { c, m, gi };
  }
  function openCol(pt) {
    const ci = colInfo(pt);
    if (!ci) return;
    if (state.all && ci.m.index !== state.mi) switchMezz(ci.m.index);
    if (ci.gi >= 0) state.colGroup = ci.gi;
    go('column'); renderColumn(); renderMiniPlan();
  }

  // the column symbol the PCS floor plan shows at a point (a wall column's I is drawn just inside the steel line)
  function symAt(pt, om) {
    // om: a mezzanine of the building the point is in (an attached building's own coordinates and drawing symbols)
    const inp = om ? inpOf(om) : state.inputs, pc = inp && inp.building && inp.building.planCols, g = om ? om.grid : state.res && state.res.grid;
    if (!pc || !g) return null;
    const wall = (v, ends) => { const e = ends.find(u => Math.abs(v - u) < 2.6); return e == null ? v : e; };
    const hit = pc.map(c => (c.kind === 'I' ? { ...c, x: wall(c.x, [0, g.length]), y: wall(c.y, [0, g.width]) } : c)).filter(c => Math.hypot(c.x - pt.x, c.y - pt.y) <= 1.25).sort((p, q) => Math.hypot(p.x - pt.x, p.y - pt.y) - Math.hypot(q.x - pt.x, q.y - pt.y))[0];
    return hit ? hit.kind : null;
  }
  // ---------- hover cards: what every column takes (Column-sheet D / L, or the load to the frame), each beam's end shears ----------
  // beams are numbered once over the job (run.js): a mezzanine's B1 follows the beams of the ones before it
  const bNo = (m, id) => 'B' + (((m && m.bOff) || 0) + id + 1);
  const sideTxt = sd => (sd === 'left' ? 'Left' : sd === 'right' ? 'Right' : '');
  function partRow(p, side) {
    const m = state.job.mezz[p.mi], id = p.id != null ? p.id : +String(p.beam).slice(1) - 1 - (m.bOff || 0), bm = m.layout.beams[id], mk = mkOf(m, id);
    return `<tr><td class="sd">${sideTxt(side)}</td><td><b>${manyMezz() ? esc(m.id) + ' ' : ''}${bNo(m, id)}</b> <i style="background:${mkHex(mk)}"></i>${mk ? esc(mkName(mk)) : ''}<small>${mk ? esc(mk.desc || 'NO SECTION') + ' · ' : ''}${ft(bm.span)} × ${ft(bm.trib)} trib</small></td><td class="d">${f(p.D, 2)}</td><td class="l">${f(p.L, 2)}</td></tr>`;
  }
  function tipHtml(key) {
    const job = state.job, r = state.res;
    if (!job || !r || r.incomplete) return '';
    const [kind, a, b, c4] = key.split('|'), cno = colNos(), many = manyMezz(), mi4 = c4 != null && c4 !== '' ? +c4 : undefined;
    const head = (t, sub) => `<div class="tip-h"><b>${t}</b><span>${sub}</span></div>`;
    const tbl = rows => `<table><thead><tr><th></th><th>beam framing in</th><th>D k</th><th>L k</th></tr></thead><tbody>${rows}</tbody></table>`;
    const pair = (lab, D, L) => `<div><span>${lab}</span><b class="d">D ${f(D, 2)}</b><b class="l">L ${f(L, 2)}</b></div>`;
    if (kind === 'col') {
      const ci = colInfo({ x: +a, y: +b, mi: mi4 });
      if (!ci) return '';
      const { c, m, gi } = ci, chk = m.colFinal && gi >= 0 ? m.colFinal.checks[gi] : null;
      const rows = ['left', 'right'].map(sd => { const ps = c.parts.filter(p => p.sheetSide === sd); return ps.length ? ps.map((p, i) => partRow(p, i ? '' : sd)).join('') : `<tr><td class="sd">${sideTxt(sd)}</td><td><small>no beam on this side</small></td><td class="d">0.00</td><td class="l">0.00</td></tr>`; }).join('');
      const wc = whereTxt(c.x, c.y, m.grid);
      return head(`C${cno.get(c.label) || '?'} · ${esc(c.label)}`, `mezzanine column${many ? ' · ' + esc(m.id) : ''}`) + `<div class="tip-where">${esc(wc.x)}<br>${esc(wc.y)}</div>` +
        (() => { const g = m.colGroups && gi >= 0 ? m.colGroups[gi] : null;
          return g && g.env ? `<div class="tip-k">This column's beam reactions, unfactored (kips)</div><div class="tip-lr">${pair('Left', c.DL_L, c.LL_L)}${pair('Right', c.DL_R, c.LL_R)}</div>` + tbl(rows) +
            `<div class="tip-k">Column sheet input · the largest of each over its case (${g.cols.length} columns within 0.01 k)</div><div class="tip-lr">${pair('Left', g.loads.DL_L, g.loads.LL_L)}${pair('Right', g.loads.DL_R, g.loads.LL_R)}</div>`
            : `<div class="tip-k">Column sheet input · beam reactions, unfactored (kips)</div><div class="tip-lr">${pair('Left', c.DL_L, c.LL_L)}${pair('Right', c.DL_R, c.LL_R)}</div>` + tbl(rows); })() +
        `<div class="tip-f">${m.colFinal && chk ? `<b>${esc(m.colFinal.quoteAs)}</b> · ${ft(m.colLen)} · CSR ${f(chk.max, 3)}` : `<b class="ng">NOT SIZED</b>${m.colWhy && m.colWhy.marks && m.colWhy.marks.length ? ` — ${esc(m.colWhy.marks.join(', '))} ${m.colWhy.marks.length > 1 ? 'have' : 'has'} no section` : ''}`} · trib ${f(c.tribArea, 0)} ft²${c.shared ? ' · shared by ' + esc(c.mezzes.map(i => job.mezz[i].id).join(' + ')) : ''}</div>`;
    }
    if (kind === 'bcol') {
      // a column of a building attached to this one: its own building's loads and grid
      const om = mi4 != null ? job.mezz[mi4] : null, inB = q => (om ? q.bkey === om.bkey : sameBldg(q));
      const pt = { x: +a, y: +b }, fl = (job.frameLoads || []).filter(inB).find(q => atPt(q, pt)), g = om ? om.grid : r.grid;
      const lab = fl ? fl.label : `${g.xLabel(pt.x) || ft(pt.x)}/${g.yLabel(pt.y) || ft(pt.y)}`;
      const fe = (job.frameEntries || []).filter(inB).flatMap(f => f.entries.map(e => ({ ...e, frame: f.frame }))).find(e => atPt(e, pt));
      const sym = symAt(pt, om), drawn = sym ? `<div class="tip-f">On the PCS floor plan: ${sym === 'star' ? '✱ — interior frame column "designated as Most Economical" (pipe, tube or I-shape, set at final design)' : 'I — frame / endwall column'}.</div>` : '';
      const wb = whereTxt(pt.x, pt.y, g), at = `<div class="tip-where">${esc(wb.x)}<br>${esc(wb.y)}</div>`;
      if (!fl) return head(esc(lab), 'building column') + at + drawn + '<div class="tip-f">No mezzanine beam frames into this column.</div>';
      return head(esc(lab), 'building column · load to the frame') + at + `<div class="tip-k">Mezzanine beam reactions · unfactored (kips)</div><div class="tip-lr one">${pair('Total', fl.D, fl.L)}</div>` +
        tbl(fl.parts.map(p => partRow(p)).join('')) + drawn +
        (fe && fe.eq && fe.eq.length ? `<div class="tip-k">Seismic to the frame · EQR + / EQL − (kips)</div><div class="tip-lr one">${fe.eq.map(q => `<div><span>${esc(q.mezz)}</span><b class="e">±${f(q.F, 2)}</b><small>${q.edited === 'typed' ? `typed · calc. ${f(q.calc, 2)} k` : q.edited === 'scaled' ? `${f(q.calc, 2)} k × ${f(q.F / q.calc, 3)}` : `${Math.round(q.share * 100)} % of ${f(q.frameF, 2)} k`} · at ${ft(q.at)}</small></div>`).join('')}</div>` : '') +
        `<div class="tip-f">${fe ? `NBG Frame: frame line ${esc(fe.frame)}, ${fe.member ? `<b>${esc(fe.member)}</b> (${esc(fe.where)})` : esc(fe.where)}, at ${state.nbg.height === 'beam' ? `${ft(fe.elev)} (T/beam)` : `${ft(fe.A)} (floor level A)`}.` : 'Goes to the frame / endwall design, not the mezzanine Column sheet.'}</div>`;
    }
    if (kind === 'beam' || kind === 'carried') {
      const m = job.mezz[+a], id = +b, bm = m.layout.beams[id];
      const fl = m.layout.joists === 'y' ? m.grid.xLabel : m.grid.yLabel, line = (m.layout.joists === 'y' ? m.grid.yLabel(bm.line) : m.grid.xLabel(bm.line)) || ft(bm.line);
      const where = `line ${esc(line)} · ${esc(fl(bm.from) || ft(bm.from))} → ${esc(fl(bm.to) || ft(bm.to))}`;
      if (kind === 'carried') return head(`${esc(m.id)} edge · ${bNo(m, id)}`, where) + `<div class="tip-f">Carried by ${esc(bm.absorbed.mezz)} ${bm.absorbed.into.map(i => bNo(job.mezz[bm.absorbed.mi], i)).join(', ')} on the same line — its ${ft(bm.tribOwn)} trib is added to that beam, so it is not counted here.</div>`;
      const mk = mkOf(m, id), run = runOf(mk, bm.span), rx = mk && mk.sec ? DESIGN.reactions({ ...m.beamBase, L: bm.span, trib: bm.trib }, mk.sec) : null;
      const trib = bm.extra ? `${ft(bm.trib)} <small>(${ft(bm.tribOwn)} + ${bm.extra.map(x => esc(x.mezz) + ' ' + ft(x.tribOwn)).join(' + ')})</small>` : ft(bm.trib);
      return head(`${many ? esc(m.id) + ' ' : ''}${bNo(m, id)} · ${esc(mkName(mk))}`, where) +
        `<div class="tip-sec"><i style="background:${mkHex(mk)}"></i>${esc(mk ? mk.desc || 'no section' : '—')}</div>` +
        `<dl class="tip-dl"><div><dt>Span</dt><dd>${ft(bm.span)}</dd></div><div><dt>Trib</dt><dd>${trib}</dd></div><div><dt>MB sheet run</dt><dd>${mk && !mk.sec ? '<b class="ng">none — nothing passes</b>' : mk ? `${ft(run ? runL(run) : Math.abs(bm.span - mk.span) < 1e-3 ? mkDz(mk).span : bm.span)} × ${ft(mkDz(mk).trib)}` : '—'}</dd></div></dl>` +
        (rx ? `<div class="tip-k">End shear, each end · own span and trib (MB H6 / H10)</div><div class="tip-lr one">${pair('Each end', rx.D, rx.L)}</div>` : '') +
        `<div class="tip-f">${mk && !mk.sec ? `${esc(mk.mark)}: nothing passes — see Beam calc.` : mk && mk.kind === 'interior' ? 'Interior: more trib than any edge beam — designed at the largest interior trib.' : mk && mk.kind === 'exterior' ? 'Exterior: edge beam, joists on one side — designed at the largest edge trib.' : ''}</div>`;
    }
    return '';
  }
  const tipEl = document.createElement('div');
  tipEl.className = 'hover-tip'; tipEl.hidden = true; document.body.appendChild(tipEl);
  let tipKey = null;
  document.addEventListener('mousemove', e => {
    // no hover card while the plan is being edited, or over the edit menu
    const t = e.target && e.target.closest && !(state.planEdit && e.target.closest('#planSvg, #layPop')) ? e.target.closest('[data-tip]') : null;
    if (!t) { if (tipKey) { tipKey = null; tipEl.hidden = true; } return; }
    if (t.dataset.tip !== tipKey) { tipKey = t.dataset.tip; const h = tipHtml(tipKey); tipEl.innerHTML = h; tipEl.hidden = !h; }
    if (tipEl.hidden) return;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight, pad = 16;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > innerHeight - 8) y = e.clientY - h - pad;
    tipEl.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  });
  window.addEventListener('scroll', () => { if (tipKey) { tipKey = null; tipEl.hidden = true; } }, { passive: true });

  // ---------- theme (Astra default: dark) ----------
  try { const t = localStorage.getItem('mqd-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* storage unavailable */ }
  const syncThemeBtn = () => { $('#themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? 'Light theme' : 'Dark theme'; };
  syncThemeBtn();
  $('#themeBtn').onclick = () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('mqd-theme', t); } catch (e) { /* ignore */ }
    syncThemeBtn();
  };

  // ---------- navigation ----------
  function go(view) {
    state.view = view;
    if (railView === 'plan' || !$('#planPop').hidden) renderMiniPlan();
    $$('.screen').forEach(s => s.classList.toggle('is-active', s.id === 'v-' + view));
    $$('#nav button').forEach(b => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
    window.scrollTo({ top: 0 });
  }
  $$('#nav button').forEach(b => { b.onclick = () => go(b.dataset.view); });
  document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), Math.min(7000, 1900 + 45 * Math.max(0, msg.length - 40)));   // long messages stay long enough to read
  }
  function status(text, cls) { $('#statusText').textContent = text; $('#statusDot').className = 'dot ' + (cls || ''); }
  async function copyText(txt, msg) {
    try { await navigator.clipboard.writeText(txt); toast(msg); } catch (e) {
      const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(msg); } catch (e2) { toast('Copy blocked — select the table'); }
      ta.remove();
    }
  }
  // text and a table together: Excel pastes the table (its merged cells and formats), anything else the text
  async function copyRich(txt, html, msg) {
    let done = false;
    const on = e => { e.clipboardData.setData('text/plain', txt); e.clipboardData.setData('text/html', html); e.preventDefault(); done = true; };
    document.addEventListener('copy', on);
    try { document.execCommand('copy'); } catch (e) { /* the async clipboard below */ }
    document.removeEventListener('copy', on);
    if (done) { toast(msg); return; }
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([txt], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]); toast(msg); }
    catch (e) { copyText(txt, msg); }
  }
  // a quote-sheet table as the MEZZ sheet lays it out, for Excel: B:C (FF El., SPAN, HEIGHT), the columns' D:E (TRIB.
  // AREA) and the note J:K (I:K for columns) are merged on the sheet, so each goes as one merged cell — a plain-text paste
  // splits them — in the sheet's own Arial 8, centred, thin borders with a hairline bottom and its number formats
  const QS_HTML = {
    design: { merge: { 1: 2, 9: 2 }, fmt: { 5: '0\\.0', 6: '0\\.0', 7: '0\\.0', 8: '0\\.0' } },
    beams: { merge: { 1: 2, 9: 2 }, fmt: { 1: '0\\.000', 4: '\\#\\,\\#\\#0', 5: '\\#\\,\\#\\#0', 6: '\\#\\,\\#\\#0' } },
    columns: { merge: { 1: 2, 3: 2, 8: 3 }, fmt: { 1: '0\\.00' } },
  };
  function quoteHtml(k, tsv) {
    const spec = QS_HTML[k] || { merge: {}, fmt: {} }, h = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = String(tsv).split('\n').map(l => l.split('\t'));
    const body = rows.map(cs => {
      let out = '';
      for (let i = 0; i < cs.length;) {
        const span = Math.min(spec.merge[i] || 1, cs.length - i), last = i + span >= cs.length, fmt = spec.fmt[i];
        const css = `font-family:Arial,sans-serif;font-size:8.0pt;text-align:center;vertical-align:bottom;border-top:.5pt solid windowtext;border-bottom:.5pt hairline windowtext;border-left:${i === 0 ? '1.0pt' : '.5pt'} solid windowtext;border-right:${last && cs.length > 9 ? '1.0pt' : '.5pt'} solid windowtext;${fmt ? `mso-number-format:'${fmt}';` : ''}`;
        out += `<td${span > 1 ? ` colspan="${span}"` : ''} style="${css}">${h(cs[i])}</td>`;
        i += span;
      }
      return `<tr>${out}</tr>`;
    }).join('');
    return `<table style="border-collapse:collapse">${body}</table>`;
  }

  // ---------- intake ----------
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', e => { const file = e.dataTransfer.files[0]; if (file) loadFile(file); });
  $('#file').addEventListener('change', e => { const file = e.target.files[0]; if (file) loadFile(file); });
  const prog = p => { $('#prog').style.width = Math.round(p * 100) + '%'; };

  async function loadFile(file) {
    $('#dropTitle').textContent = file.name; state.fileName = file.name;
    state.nbg.files = []; state.bracing = {};
    $('#dropSub').textContent = 'Reading…';
    status('Reading PCS', 'warn');
    prog(0.1);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await window.pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
      // the text layer of every page; a page with none (its words drawn as outlines by a print driver, or a scan) is
      // then read by OCR, in the browser, a few seconds a page
      const t0 = Date.now();
      const pages = await EX.extractDoc(pdf, {
        OPS: window.pdfjsLib.OPS, ocr: () => window.MZ_OCR.webEngine(),
        onPage: (n, N) => prog(0.1 + 0.25 * n / N),
        onOcr: (done, total) => {
          const left = done ? Math.max(1, Math.round((Date.now() - t0) / 1000 / done * (total - done))) : null;
          $('#dropSub').textContent = done ? `Reading by OCR · page ${done} of ${total}${done < total ? ` · about ${left} s left` : ''}` : `${total} page${total > 1 ? 's carry' : ' carries'} no text layer — starting the OCR reader…`;
          status(`Reading ${total} page${total > 1 ? 's' : ''} by OCR`, 'warn');
          prog(0.35 + 0.45 * done / total);
        },
      });
      const ocr = pages.ocr || { pages: [] };
      if (ocr.read) window.MZ_OCR.webEngine().then(e => e.end()).catch(() => {});   // free the workers' memory
      for (const p of PCS.box22Pages(pages)) {           // checkboxes are vector glyphs: render and look (OCR found them already)
        const det = await EX.detectChecks(p, PCS.checkboxTargets(p), p._page);
        p.checks = det.states || {};
      }
      prog(0.8);
      const pcs = PCS.parse(pages);
      pcs.ocr = ocr.read ? { pages: ocr.pages, conf: ocr.conf } : null;
      const span = ns => ns.length > 2 && ns[ns.length - 1] - ns[0] === ns.length - 1 ? `${ns[0]}–${ns[ns.length - 1]}` : ns.join(', ');
      if (!pcs.mezzanines.length) throw new Error(ocr.pages.length && !ocr.read
        ? `Page${ocr.pages.length > 1 ? 's' : ''} ${span(ocr.pages)} carr${ocr.pages.length > 1 ? 'y' : 'ies'} no text layer (the words are drawn as outlines) and the OCR reader could not run: ${ocr.error || 'unknown error'}.`
        : 'No "22) MEZZANINES" box with a Mezzanine ID was found in this PDF.');
      // floor plan: the drawing page (no text, hundreds of vector paths) whose grid bubbles register to the frame lines
      // of the first mezzanine's building — not just the last drawing (a wind-pressure table can be one too)
      state.planPaths = null; state.planReg = null; state.planPage = null; state.planAnnots = [];
      const g0 = planGrid({ pcs, all: null });
      const plan = await PLAN.findPlan(pages, g0 ? PLAN.gridOf(g0) : null, p => p._page.getOperatorList(), window.pdfjsLib.OPS);
      if (plan) { state.planPaths = plan.paths; state.planAnnots = plan.annots; state.planPage = plan.page; }
      prog(0.9);
      state.pages = pages; state.pcs = pcs; state.mi = 0; state.planKey = null; state.colBase = null; state.colBaseN = null; state.seis = seisLoad(); state.seisRestored = Object.keys(state.seis).length ? seisSavedAt() || 'an earlier session' : null;
      readPlan();                                           // grid letters + joist arrows off the drawing
      const keep = keepSettings();
      state.all = pcs.mezzanines.map((m, i) => ({ inputs: RUN.inputsFromPCS(pcs, i), settings: { ...RUN.SETTINGS, ...keep } }));
      state.inputs = state.all[0].inputs; state.settings = state.all[0].settings;
      $('#dropSub').textContent = `${pdf.numPages} pages · ${pcs.mezzanines.length} mezzanine${pcs.mezzanines.length > 1 ? 's' : ''} found${pcs.ocr ? ` · ${pcs.ocr.pages.length} read by OCR` : ''}`;
      $('#intakeMsg').textContent = pcs.ocr
        ? `Parsed. Page${pcs.ocr.pages.length > 1 ? 's' : ''} ${span(pcs.ocr.pages)} had no text layer and ${pcs.ocr.pages.length > 1 ? 'were' : 'was'} read by OCR (${pcs.ocr.conf}% sure on average, ${Math.round((Date.now() - t0) / 1000)} s) — the Design page lists any Box 22 value read with less certainty; check those against the PDF.`
        : 'Parsed. Review the sections, then check the plan against the drawing.';
      prog(1);
      recompute();
      go('results');                                        // open values are asked for at the top of the Design page
    } catch (err) {
      console.error(err);
      status('Could not read PCS', 'bad');
      $('#dropSub').textContent = err.message || String(err);
      prog(0);
    }
  }
  // user-level preferences survive a new file; job-specific ones (grid, overrides) do not
  function keepSettings() {
    const s = state.settings, keep = {};
    // preferences carry to the next PCS; the sheet edition and the stock division are the job's own (its code, its plant) — back to Auto
    ['target', 'dMin', 'dMax', 'symmetric', 'requireConc', 'marks', 'colPerJob', 'colLength', 'includeW818', 'partitionTo', 'optionDefault', 'production', 'setbackRigid', 'setbackPB'].forEach(k => { keep[k] = s[k]; });
    return keep;
  }

  $('#manualBtn').onclick = () => {
    const v = (value, source, note) => ({ value, source, note });
    state.pcs = null; state.planPaths = null; state.planReg = null; state.all = null;
    state.inputs = {
      job: { quote: '', project: 'Manual entry', division: 'NBS-IN', code: { family: 'AISC', edition: '15', spec: 'AISC 360-16', text: 'IBC 2021' } },
      mezz: { id: 'A', provided: {}, material: 'Standard Weight Concrete', concrete: 'NW', deck: '1.0C' },
      loads: { dead: { ...v(43, 'deckGuide', 'Deck guide: 4" NW concrete on 1.0C form deck'), auto: true }, coll: v(5, 'manual'), live: v(125, 'manual'), partition: v(0, 'manual'), joistWt: v(8, 'default') },
      geom: { width: v(40, 'manual'), length: v(40, 'manual'), startLEW: v(0, 'manual'), startFSW: v(0, 'manual'), slab: v(4 / 12, 'manual'), A: v(12, 'manual'), B: v(null, 'missing'), C: v(null, 'missing'), joistSpacing: v(null, 'missing'), seat: v(null, 'missing') },
      building: { width: 60, length: 100, ridge: 30, bays: [20, 20, 20, 20, 20], lewCols: [20, 20, 20], rewCols: [20, 20, 20], frames: [], fswSoldier: [], bswSoldier: [] },
    };
    state.settings = { ...RUN.SETTINGS, ...keepSettings() };
    recompute();
    go('inputs');
    toast('Manual entry — fill in the inputs');
  };

  // ---------- mezzanines of the job: a card each, always in view ----------
  function switchMezz(i) {
    if (!state.all || i === state.mi) return;
    state.all[state.mi] = { inputs: state.inputs, settings: state.settings };
    state.mi = i; state.inputs = state.all[i].inputs; state.settings = state.all[i].settings; state.colGroup = 0;
    recompute();
    // the 3D view on one mezzanine follows the one picked (the whole job stays the whole job)
    const bar = $('#modelFocus'), g = bar && bar.dataset.on && state.scene && (state.scene.groups || []).find(q => q.id === state.inputs.mezz.id);
    if (g && model) { model.focus(g.box); markFocus(g.id); }
  }
  function renderMezzTabs() {
    const nav = $('#mezzTabs'), many = state.all && state.all.length > 1 && state.job;
    nav.hidden = !many;
    if (!many) { nav.innerHTML = ''; return; }
    nav.innerHTML = `<span class="mt-title">${state.all.length} mezzanines<small>designed together</small></span>` + state.job.mezz.map((m, i) => {
      const g = state.all[i].inputs.geom, size = `W ${ft(g.width.value)} × L ${ft(g.length.value)}`;   // width along the endwall, length along the sidewall (Box 22)
      const waits = !m.incomplete && m.marks.some(mk => !mk.sec && mk.rescue);
      const beams = m.incomplete ? '' : m.marks.map(mk => `${mk.mark} ${esc(mk.desc || (mk.rescue ? 'to decide' : 'NO SECTION'))} × ${mk.qty}`).join(' · ');
      const nUn = m.colFinal ? (m.colFinal.unsized || []).length : 0;
      const cols = m.incomplete ? '' : m.colFinal ? `${esc(m.colFinal.quoteAs)} × ${m.columns.length - nUn}${nUn ? ` · ${waits ? `${nUn} after the decision` : `<em class="mt-ng">${nUn} not sized</em>`}` : ''}` : (m.columns.length ? (waits ? `${m.columns.length} column${m.columns.length > 1 ? 's' : ''} after the decision` : `<em class="mt-ng">${m.columns.length} column${m.columns.length > 1 ? 's' : ''} not sized</em>`) : '');
      const st = m.incomplete ? `<em class="mt-need">needs ${m.need.length} input${m.need.length > 1 ? 's' : ''}</em>` : waits ? '<em class="mt-need">one decision to make</em>' : m.warn.some(w => w.level === 'stop') ? '<em class="mt-check">check notes</em>' : '<em class="mt-ok">designed</em>';
      return `<button class="mt ${i === state.mi ? 'is-on' : ''}" data-mi="${i}" aria-pressed="${i === state.mi}"><span class="mt-name">${esc(m.id)}</span><span class="mt-size">${size}</span>${st}<span class="mt-sec">${beams || '—'}${cols ? '<br>' + cols : ''}</span></button>`;
    }).join('');
    $$('#mezzTabs .mt').forEach(b => { b.onclick = () => switchMezz(+b.dataset.mi); });
  }

  // ---------- floor plan ----------
  // Register the drawing to the building grid once per grid: letters as drawn, ⊗ / circled-I columns, joist arrows
  // The drawing is registered to one building (the first mezzanine's); a mezzanine in a building attached to it gets the
  // letters, symbols and joist markup mapped through the attachment, any other building none
  // the grid of the building the drawing shows (the first mezzanine's): its inputs once read, else the PCS
  function planGrid({ pcs, all }) {
    if (pcs.planBuilding == null) pcs.planBuilding = (pcs.mezzanines[0] || {}).building || '';
    const host = (all || []).find(a => (a.inputs.mezz.building || '') === pcs.planBuilding);
    const b = host ? host.inputs.building : { ...(pcs.building || {}), frames: pcs.frames };
    if (!b || !(b.width > 0) || !(b.length > 0)) return null;
    return LAYOUT.buildingGrid({ width: b.width, length: b.length, bays: b.bays, lewCols: b.lewCols, rewCols: b.rewCols, ridge: b.ridge, frames: b.frames || [] });
  }
  function readPlan() {
    const pcs = state.pcs;
    if (pcs && !state.planPaths && !pcs.planRead) { RUN.applyPlan(pcs, null); (state.all || []).forEach(a => { a.inputs.mezz.planRead = pcs.planRead; }); }   // no drawing in the PCS: said on the page
    if (!state.planPaths || !pcs) return;
    const g = planGrid({ pcs, all: state.all });
    if (!g) return;
    const gr = PLAN.gridOf(g), key = gr.xs.join(',') + '|' + gr.colY.join(',');
    if (state.planKey === key) return;
    state.planKey = key;
    state.planReg = PLAN.registerAndRead(state.planPaths, gr, state.planAnnots);
    state.planReg.page = state.planPage;
    RUN.applyPlan(pcs, state.planReg);
    // letters and column symbols (⊗ / circled I / marked X = mezzanine column, bare I / ✱ = frame column) per mezzanine
    (state.all || []).forEach((a, i) => { const pf = RUN.planFor(pcs, i); a.inputs.building.yLetters = pf.yLetters; a.inputs.building.planCols = pf.planCols; a.inputs.mezz.planJoists = pcs.mezzanines[i].planJoists || null; a.inputs.mezz.planJoistsFrom = pcs.mezzanines[i].planJoistsFrom || null; a.inputs.mezz.planArrows = pcs.mezzanines[i].planArrows || 0; a.inputs.mezz.planRead = pcs.planRead; });
  }

  // ---------- compute ----------
  // returns false when the design could not run (the page keeps the last design and says so)
  function recompute() {
    if (!state.inputs) return false;
    if (state.all) { state.all[state.mi] = { inputs: state.inputs, settings: state.settings }; readPlan(); }
    const items = (state.all || [{ inputs: state.inputs, settings: state.settings }]).map(a => ({ inp: a.inputs, settings: a.settings }));
    try { state.job = RUN.runJob(items, { seis: state.seis }); state.res = state.job.mezz[state.all ? state.mi : 0]; } catch (err) { console.error(err); status('Design error: ' + err.message, 'bad'); return false; }
    planCheck();
    if (state.mark >= jobMarks().length) { state.mark = 0; state.markSpan = 0; }
    if (state.colGroup >= state.res.colGroups.length) state.colGroup = 0;
    $$('#nav button').forEach(b => { b.disabled = false; });
    $('#copyQuote').disabled = !!state.res.incomplete || decideMarks().length > 0; $('#printBtn').disabled = false;
    const bad = (state.job.mezz || [state.res]).some(m => (m.warn || []).some(w => w.level === 'stop'));
    const ok = !state.res.incomplete && state.res.marks.length && state.res.marks.every(m => m.sec) && (!state.res.columns.length || state.res.colFinal);
    const open = state.job && state.job.mezz.some(m => m.incomplete), decide = !open && decideMarks().length;
    status(open ? 'Needs input' : decide ? 'One decision to make' : ok ? (bad ? 'Designed · check notes' : 'Designed') : 'Needs attention', open || decide ? 'warn' : ok ? (bad ? 'warn' : 'ok') : 'bad');
    renderAll();
    remember();
    return true;
  }

  // Compare the mezzanine-column symbols on the PCS floor plan with every mezzanine's columns
  const nearest = (arr, v) => arr.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), arr[0]);
  function planCheck() {
    const r = state.res;
    r.planCheck = null;
    if (!state.planPaths || r.incomplete) return;
    const reg = state.planReg;
    if (!reg || !reg.ok) {
      r.planCheck = { ok: false, reason: reg ? reg.reason : 'not read' };   // the design's notes say it (a stop)
      return;
    }
    // labels in the drawing's building (the plan was registered to it)
    const hostRes = state.job.mezz.find(m => !m.incomplete && ((state.pcs.mezzanines[m.index] || {}).building || '') === state.pcs.planBuilding) || r;
    const g = hostRes.grid;
    const lab = c => { const nx = nearest(g.xs, c.x), ly = (g.allY || []).concat((reg.letters || []).map(l => l.y)), ny = nearest(ly, c.y);
      return (Math.abs(nx - c.x) < 0.6 ? g.xLabel(nx) : ft(c.x)) + '/' + (Math.abs(ny - c.y) < 0.6 && g.yLabel(ny) ? g.yLabel(ny) : ft(c.y)); };
    // every mezzanine column the drawing can show, in the drawing's (plan building's) coordinates
    const maps = state.job.mezz.map(m => RUN.planMap(state.pcs, state.pcs.mezzanines[m.index] || {}));
    const jobCols = state.job.columns.filter(q => maps[q.owner]).map(q => ({ ...q, ...maps[q.owner].toHost(q.x, q.y) }));
    const cmp = PLAN.compare(reg.columns, jobCols);
    const labels = cmp.matched.concat(cmp.extra.map(lab)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const mine = maps[r.index], gb = r.grid;
    const seen = mine ? reg.columns.map(c => ({ ...c, ...mine.fromHost(c.x, c.y) })).filter(c => c.x > -1 && c.x < gb.length + 1 && c.y > -1 && c.y < gb.width + 1) : [];
    // drawing columns the job no longer has: made frame columns on the Plan page, or taken out
    const madeFr = (state.job.frameLoads || []).filter(q => q.userKind === 'frame').map(q => { const mi = q.owner != null ? q.owner : q.parts && q.parts[0] && q.parts[0].mi; return maps[mi] ? maps[mi].toHost(q.x, q.y) : null; }).filter(Boolean);
    const isFr = c => madeFr.some(p => Math.hypot(p.x - c.x, p.y - c.y) < 1);
    r.planCheck = { ok: true, cols: seen, labels, ...cmp, drawn: cmp.matched.length + cmp.extra.length, laid: cmp.matched.length + cmp.missing.length, extraLabels: cmp.extra.filter(c => !isFr(c)).map(lab), frameLabels: cmp.extra.filter(isFr).map(lab) };
    if (reg.numberOffset > 0) r.warn.push({ level: 'warn', text: `Frame-line numbers: the PCS floor plan numbers the ${state.pcs.planBuilding || 'building'} frame lines ${1 + reg.numberOffset}–${reg.frameLines + reg.numberOffset}; this design and the NBG Frame files use Box 5's 1–${reg.frameLines} (line 1 here is line ${1 + reg.numberOffset} on the drawing).` });
    // the column comparison itself (ok / stop / edited) is in the design's notes, per mezzanine (RUN drawingCheck)
    if (r.layout.why && /PCS floor plan/.test(r.layout.why)) r.warn.unshift({ level: 'ok', text: `Joists span ${r.layout.joists === 'y' ? 'across the width' : 'along the length'}, read from ${r.layout.why.replace(/^joist arrows/, 'the "Mez. Jst." arrows')}.` });
  }

  // one mezzanine's figures: its own beams (each at its member length) and the columns it owns
  function totals(r = state.res) {
    const own = r.layout.beams.filter(b => !b.absorbed);
    const beams = own.reduce((a, b) => { const mk = mkOf(r, b.id); return a + (mk && mk.check ? b.span * mk.check.res.Wt : 0); }, 0);
    const nB = r.marks.reduce((a, mk) => a + mk.qty, 0), nC = r.columns.length;
    const nCs = r.colFinal ? nC - (r.colFinal.unsized || []).length : 0;   // the columns that are sized
    const cols = r.colFinal ? nCs * r.colLen * r.colFinal.props.W : 0;
    // end plates of the sized members only (what is not sized is named beside the total, not half counted)
    const plates = r.marks.reduce((a, mk) => a + (mk.check ? mk.qty : 0), 0) * 40 + nCs * 46;
    const govBeam = r.marks.filter(mk => mk.check).map(mk => {
      const c = mk.check, parts = [['combined', c.res.CSR], ['shear', c.res.SRvx], ['live deflection', 360 / c.defl.rLL], ['total deflection', 240 / c.defl.rTL], ['joist bearing', c.conc ? c.conc.max : 0]];
      const top = parts.sort((a, b) => b[1] - a[1])[0];
      return { mk, what: top[0], v: top[1] };
    }).sort((a, b) => b.v - a.v)[0] || null;
    const colMax = r.colFinal ? r.colFinal.max : null;
    const gov = govBeam && (colMax == null || govBeam.v >= colMax) ? { v: govBeam.v, who: `${govBeam.mk.mark} ${govBeam.what}` } : colMax != null ? { v: colMax, who: 'column combined' } : null;
    return { beams, cols, plates, total: beams + cols + plates, nB, nC, govBeam, colMax, gov };
  }
  // the whole job: every mezzanine's beams and the columns each owns (a shared column is counted once)
  function jobTotals() {
    const ts = (state.job ? state.job.mezz : [state.res]).filter(m => m && !m.incomplete).map(m => totals(m));
    const sum = k => ts.reduce((a, t) => a + t[k], 0), top = k => ts.map(t => t[k]).filter(Boolean).sort((a, b) => b.v - a.v)[0] || null;
    const cm = ts.map(t => t.colMax).filter(v => v != null);
    return { beams: sum('beams'), cols: sum('cols'), plates: sum('plates'), total: sum('total'), nB: sum('nB'), nC: sum('nC'), govBeam: top('govBeam'), gov: top('gov'), colMax: cm.length ? Math.max(...cm) : null };
  }

  function renderAll() { printHead(); renderRail(); renderResults(); renderPlan(); renderFrameLoads(); renderSeismic(); renderBeam(); renderColumn(); renderInputs(); renderSettings(); renderWorkbooks(); renderDesigner(); renderCalcPack(); }

  // ---------- rail + masthead ----------
  function renderRail() {
    const inp = state.inputs, r = state.res, t = totals();
    const c = inp.job.code || {};
    $('#fCode').textContent = (c.text ? (c.text.match(/IBC\s*\d{4}|NBCC\s*\d{4}/i) || [c.text])[0] + ' → ' : '') + (r.edition.ed ? (r.edition.colEd && r.edition.beamEd && r.edition.colEd !== r.edition.beamEd ? `${edLabel(r.edition.beamEd)} beams · ${r.edition.colEd}th columns` : edLabel(r.edition.ed)) : '—');
    $('#fDiv').textContent = r.division;
    const allIds = state.job && state.job.mezz.length > 1 ? state.job.mezz.map(m => `“${m.id}”`).join(' + ') : null;
    $('#mastContext').textContent = [inp.job.quote, inp.job.project, allIds ? `Mezzanines ${allIds}` : inp.mezz.id ? `Mezzanine “${inp.mezz.id}”` : ''].filter(Boolean).join(' · ');
    $('#stampMezz').hidden = true;
    renderMezzTabs();
    const many = state.all && state.all.length > 1;
    if (r.incomplete) { $('#rsSub').textContent = 'Needs input — see Design'; renderMiniPlan(); return; }
    if (decideMarks().length) { $('#rsSub').textContent = 'One decision to make — see Design'; renderMiniPlan(); return; }
    const jt = many ? jobTotals() : t;
    // the names when they are short ("1 + 2"); else the count, the names on hover — a long list would wrap and take
    // the 3D square's room on a short screen
    const ids = state.job.mezz.filter(m => !m.incomplete).map(m => m.id), names = ids.join(' + ');
    $('#rsSub').textContent = many ? `${names.length <= 18 ? names : `${ids.length} mezzanines`} · ${jt.nB} beams · ${jt.nC} columns` : `${t.nB} beams · ${t.nC} columns`;
    $('#rsSub').title = many ? names : '';
    $('#navPlanCount').hidden = false;
    $('#navPlanCount').textContent = `${jt.nB}·${jt.nC}`;
  }

  // ---------- design (results) ----------
  const chip = (lab, val, ok) => `<span class="chip ${ok === true ? 'ok' : ok === false ? 'bad' : ''}"><b>${lab}</b>${val}</span>`;
  function secParts(sec) {
    if (!sec) return '';
    if (sec.type === 'WF') return sec.d != null ? `W shape · d ${sec.d}" · bf ${sec.bof}" × tf ${sec.tof}" · web ${sec.tw}"` : 'W shape';
    return `${sec.d}" deep · ${DESIGN.plateText(sec)}`;   // the one plate notation (design.js), as on the quote
  }
  // the floor dead / live that goes to the frame: at each building column, the MB-sheet end shears (H6 / H10) of the
  // beams framing in — the same numbers as the frame loads table, the CSV and the .frame files. Columns that take the
  // same load share a row (2/A–5/A).
  function floorCard() {
    // the whole job's: with buildings attached to each other, each column named with its building
    const all = ((state.job && state.job.frameLoads) || []), bks = [...new Set(all.map(q => q.bkey))];
    const bName = q => { const m = state.job.mezz.find(z => z.bkey === q.bkey); return m && state.pcs ? ((state.pcs.mezzanines[m.index] || {}).building || '').trim() : ''; };
    const fls = all.slice().sort((a, b) => bks.indexOf(a.bkey) - bks.indexOf(b.bkey) || a.x - b.x || a.y - b.y), groups = [];
    // columns no .frame file carries: an endwall column beside a rigid end frame (the endwall design), or one made a frame
    // column on the Plan page (a member to add in NBG Frame) — grouped apart from the ones in a frame file
    const inFile = new Set(((state.job && state.job.frameEntries) || []).flatMap(fr => fr.entries.filter(e => e.member).map(e => fr.bkey + '|' + e.label)));
    const tagOf = q => (inFile.has(q.bkey + '|' + q.label) ? '' : q.userKind === 'frame' ? 'add' : 'endwall');
    // the building named once a row (the group is one building's), the columns by their grid points
    fls.forEach(q => { const t = tagOf(q), k = `${q.bkey}|${q.D.toFixed(2)}|${q.L.toFixed(2)}|${t}`, g = groups.find(x => x.k === k); if (g) g.cols.push(q.label); else groups.push({ k, D: q.D, L: q.L, t, b: bks.length > 1 ? bName(q) : '', cols: [q.label] }); });
    const name = cs => { const suf = new Set(cs.map(c => c.split('/')[1])); return cs.length > 2 && suf.size === 1 ? `${cs[0]}–${cs[cs.length - 1].split(' ').pop()}` : cs.length > 4 ? `${cs.slice(0, 3).join(', ')} +${cs.length - 3}` : cs.join(', '); };
    // what is not sized yet comes first, as one row (it is the open item); then the heaviest loads, four rows in all
    const unk = groups.filter(g => !isFinite(g.D)), known = groups.filter(g => isFinite(g.D)).sort((a, b) => b.D - a.D);
    const unkRow = unk.length ? [{ k: 'unk', D: NaN, L: NaN, t: '', b: [...new Set(unk.map(g => g.b))].join(', '), cols: unk.flatMap(g => g.cols) }] : [];
    const shown = unkRow.concat(known.slice(0, 4 - unkRow.length)), more = unk.length + known.length - shown.length - (unk.length ? unk.length - 1 : 0);
    const TAG = { endwall: '<i>endwall</i>', add: '<i>add in Frame</i>' };
    // a small table: the columns (with their building) on the left, dead and live in two aligned columns
    const rows = shown.map(g => `<span class="fl-row"><b title="${esc((g.b ? g.b + ' ' : '') + g.cols.join(', '))}">${g.b ? `<small>${esc(g.b)}</small>` : ''}${esc(name(g.cols))}${TAG[g.t] ? TAG[g.t] : ''}</b>${isFinite(g.D) ? `<span>${f(g.D, 2)}</span><span>${f(g.L, 2)}</span>` : '<span class="ng">beam not sized</span>'}</span>`).join('');
    const used = new Set(shown.map(g => g.t));
    const legend = [used.has('endwall') && '<i>endwall</i>: in no frame file, for the endwall design', used.has('add') && '<i>add in Frame</i>: made a frame column — add it in NBG Frame'].filter(Boolean).join(' · ');
    return `<div class="metric floor"><div class="metric-copy"><span>Floor loads to the frame</span>
      <div class="fl-rows">${rows ? `<span class="fl-row fl-hd"><b>Column</b><span>Dead</span><span>Live</span></span>${rows}` : '<span class="sub-n">No mezzanine beam frames into a building column.</span>'}</div>
      <small>kips at each building column, unfactored MB end shears (H6 / H10)${more ? ` · ${more} more on the Plan page` : ''}${legend ? ' · ' + legend : ''}</small></div></div>`;
  }
  // bad: a member with no section / not sized — a red ring with no ratio, so it never reads as a pass
  const ringCard = (label, value, sub, ratio, color, bad) => `<div class="metric"><div class="metric-copy"><span>${label}</span><b class="nocase">${value}</b><small>${sub}</small></div>${bad ? `<div class="ring bad" title="${esc(bad)}" data-ring="100" style="--ring:0;--ring-color:var(--red)"><span>NG</span></div>` : ratio == null ? '' : `<div class="ring" title="governing ratio ${f(ratio, 3)}" data-ring="${pct(ratio).toFixed(1)}" style="--ring:0;--ring-color:${color || (ratio <= state.settings.target ? 'var(--green)' : ratio <= 1 ? 'var(--amber)' : 'var(--red)')}"><span>${f(ratio, ratio >= 0.995 && ratio < 1.005 ? 3 : 2)}</span></div>`}</div>`;
  // rings sweep in and whole numbers count up, as in the Astra dashboard
  function animateIn() {
    requestAnimationFrame(() => requestAnimationFrame(() => $$('[data-ring]').forEach(el => el.style.setProperty('--ring', el.dataset.ring))));
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;   // the numbers are already written in full
    $$('[data-count]').forEach(el => {
      const to = +el.dataset.count, fmt = el.dataset.fmt || '', dur = 900, t0 = performance.now();
      const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = to * e;
        el.textContent = fmt === 'lb' ? Math.round(v).toLocaleString('en-US') + ' lb' : fmt === 'L' ? 'L/' + Math.round(v) : fmt === 'sr' ? v.toFixed(3) : String(Math.round(v));
        if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  // ---------- jobs remembered on this computer: your entries and choices become the first suggestions ----------
  // (the design math never changes with history — it stays the NBG sheets; history only orders the suggestions)
  const HIST = 'mzd.jobs.v1';
  const histLoad = () => { try { return JSON.parse(localStorage.getItem(HIST) || '[]') || []; } catch (e) { return []; } };
  const histSave = list => { try { localStorage.setItem(HIST, JSON.stringify(list.slice(-300))); } catch (e) { /* private window / storage off */ } };
  const ENTER = ['geom.A', 'geom.B', 'geom.C', 'geom.slab', 'geom.seat', 'geom.joistSpacing', 'loads.dead', 'loads.live', 'loads.coll', 'loads.partition'];
  const jobKey = () => (state.pcs ? (state.pcs.job.quote || state.fileName || '') : '');
  // a remembered value back as it was typed: dimensions (kept in feet) on the 1/16" grid — feet to four places made a
  // 5" seat 5.0004" and cost the beam an inch of room; loads to four places
  const snapVal = (pth, v) => (v === 'none' || v == null || !isFinite(+v) ? v : /^geom\./.test(pth) ? Math.round(+v * 192) / 192 : +(+v).toFixed(4));
  function entered(inp) {
    const o = {};
    ENTER.forEach(pth => { const [g, k] = pth.split('.'), n = inp[g][k]; if (n && (n.source === 'manual' || n.source === 'none')) o[pth] = n.source === 'none' ? 'none' : snapVal(pth, n.value); });
    return o;
  }
  let lastSaved = '';
  function remember() {
    try {
      if (!state.pcs || !state.all || !state.job || state.job.mezz.some(m => m.incomplete)) return;
      // remembered only when fully designed: every mark has a section and every column is sized
      if (jobMarks().some(mk => !mk.check || markFails(mk)) || state.job.mezz.some(m => (m.columns.length && (!m.colFinal || !m.colFinal.ok || (m.colFinal.unsized || []).length)) || (m.clear && m.clear.C && m.clear.C.ok === false))) return;
      const key = jobKey();
      if (!key) return;
      const rec = {
        key, quote: state.pcs.job.quote || '', saved: new Date().toISOString().slice(0, 16), code: (state.pcs.code || {}).text || '', edition: state.res.edition.ed,
        mezz: state.job.mezz.map((m, i) => ({ id: m.id, entered: entered(state.all[i].inputs), joists: m.layout.joists, joistsFrom: /PCS floor plan/.test(m.layout.why || '') ? 'drawing' : (state.all[i].settings.joists || 'auto'),
          option: m.marks.map(mk => mk.optionKey), beams: m.marks.map(mk => `${mk.desc} × ${mk.qty}`), columns: m.colFinal ? `${m.colFinal.quoteAs} × ${m.columns.length}` : '' })),
        settings: { marks: state.settings.marks, optionDefault: state.settings.optionDefault },
      };
      const str = JSON.stringify({ ...rec, saved: '' });
      if (str === lastSaved) return;
      lastSaved = str;
      histSave(histLoad().filter(x => x.key !== key).concat(rec));
      renderSettings();   // the remembered-jobs list shows it at once
    } catch (e) { /* never let remembering break a design */ }
  }
  // the values you have typed most for a field on other jobs
  function usual(path) {
    const cur = jobKey(), cnt = new Map();
    histLoad().filter(r => r.key !== cur).forEach(r => {
      const seen = new Set();
      (r.mezz || []).forEach(m => { const v0 = m.entered && m.entered[path], v = v0 == null ? v0 : snapVal(path, v0); if (v == null || seen.has(String(v))) return; seen.add(String(v)); cnt.set(String(v), (cnt.get(String(v)) || 0) + 1); });
    });
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([v, n]) => ({ v: v === 'none' ? 'none' : +v, n }));
  }
  // this same job, opened before: its entries per mezzanine
  function lastTime() {
    const rec = histLoad().filter(r => r.key === jobKey()).pop();
    return rec ? rec : null;
  }
  // the beam option you usually put on the quote
  function usualOption() {
    const cnt = {};
    let tot = 0;
    histLoad().filter(r => r.key !== jobKey()).forEach(r => (r.mezz || []).forEach(m => (m.option || []).forEach(k => { if (!k) return; cnt[k] = (cnt[k] || 0) + 1; tot++; })));
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    return top && tot >= 3 && top[1] / tot >= 0.6 ? { key: top[0], n: top[1], tot } : null;
  }

  // ---------- values the PCS leaves open: asked for on the Design page, nothing assumed ----------
  const parseKind = (kind, raw) => {
    raw = String(raw).trim();
    if (raw === '') return null;
    if (kind === 'ftin') return PCS.ftin(raw) ?? PCS.ftin(raw + "'");
    if (kind === 'in') { const v = PCS.ftin(/["']/.test(raw) ? raw : raw + '"'); return v != null ? v : parseFloat(raw) / 12; }
    return parseFloat(raw);
  };
  const inputsOf = i => (state.all ? (i === state.mi ? state.inputs : state.all[i].inputs) : state.inputs);
  function needRows() {
    const mz = state.job ? state.job.mezz : [state.res], rows = [];
    mz.forEach((m, i) => (m.need || []).forEach(n => {
      let row = rows.find(q => q.path === n.path);
      if (!row) rows.push(row = { ...n, mezz: [] });
      row.mezz.push(i);
    }));
    return rows;
  }
  function depthLine(i) {
    const inp = inputsOf(i), g = inp.geom, V = k => g[k] && g[k].value;
    const id = esc(inp.mezz.id || 'Mezzanine'), missing = ['A', 'B', 'slab', 'seat'].filter(k => V(k) == null);
    if (missing.length) return `<div><b>${id}</b> · total joist depth = A − B − slab − seat <span class="dim-t">(waiting on ${missing.join(', ')})</span></div>`;
    const d = Math.round(((V('A') - V('B')) * 12 - V('slab') * 12 - V('seat') * 12) * 100) / 100;
    const cNone = g.C && g.C.source === 'none', dc = V('C') != null ? Math.floor((V('A') - V('C')) * 12 - V('slab') * 12 - V('seat') * 12 + 1e-6) : null;
    const cTxt = cNone ? ' · beam depth: no C requirement' : dc != null ? ` · beam depth ≤ ${ft(V('A'))} − ${ft(V('C'))} − slab − seat = <b class="${dc < 10 ? 'bad' : 'good'}">${dc}"</b>` : ' · beam depth limit waiting on C';
    return `<div><b>${id}</b> · ${ft(V('A'))} − ${ft(V('B'))} − ${f(V('slab') * 12, 2)}" − ${f(V('seat') * 12, 2)}" = <b class="${d < 8 ? 'bad' : 'good'}">${d}" total joist depth</b>${cTxt}</div>`;
  }
  function needCard() {
    const rows = needRows();
    if (!rows.length) return '';
    const many = state.all && state.all.length > 1;
    const names = idx => idx.map(i => esc(inputsOf(i).mezz.id || 'Mezzanine ' + (i + 1))).join(', ');
    const ph = { 'geom.B': `e.g. 9'-0"`, 'geom.joistSpacing': `e.g. 4'-0"`, 'geom.seat': 'inches, e.g. 5', 'geom.A': `e.g. 12'-0"`, 'geom.slab': 'inches, e.g. 4' };
    const phK = { ftin: 'ft-in', in: 'inches', psf: 'psf' };
    const mz = state.job ? state.job.mezz.map((m, i) => i) : [0];
    return `<section class="need" id="needCard"><div class="need-head"><div><div class="eyebrow">Needs your input</div>
        <h3>${rows.length} value${rows.length > 1 ? 's' : ''} the PCS leaves open</h3></div>
        <p>TBD on the PCS with no blue note, so nothing is assumed. Type a value or pick a typical one${many ? ' — it fills every mezzanine listed; set them apart on the Inputs page if they differ' : ''}. The design runs as soon as they are in.</p></div>
      <div class="need-rows">${rows.map(q => `<div class="need-row"><label>${esc(q.label)}${many ? `<small>${names(q.mezz)}</small>` : ''}</label>
        <input data-need="${q.path}" data-kind="${q.kind}" placeholder="${esc(ph[q.path] || phK[q.kind] || '')}" autocomplete="off">
        <div class="chips">${chipsFor(q).map(([v, t, why, cls]) => `<button class="chip ${cls || ''}" data-need="${q.path}" data-v="${v}">${t}${why ? `<small>${why}</small>` : ''}</button>`).join('')}</div></div>`).join('')}</div>
      ${againBtn(rows)}<div class="need-foot">${mz.map(depthLine).join('')}</div></section>`;
  }
  function againBtn(rows) {
    const rec = lastTime();
    if (!rec) return '';
    const vals = rows.map(q => { const m = rec.mezz.find(x => q.mezz.some(i => inputsOf(i).mezz.id === x.id) && x.entered && x.entered[q.path] != null); return m ? [q, m.entered[q.path]] : null; }).filter(Boolean);
    if (!vals.length) return '';
    const show = (q, v) => (v === 'none' ? 'none' : q.kind === 'ftin' ? ft(v) : q.kind === 'in' ? `${+(v * 12).toFixed(3)}"` : v);
    const SHORT = { 'geom.A': 'A', 'geom.B': 'B', 'geom.C': 'C', 'geom.slab': 'slab', 'geom.seat': 'seat', 'geom.joistSpacing': 'joists @', 'loads.dead': 'DL', 'loads.live': 'LL' };
    return `<button class="btn-soft again" id="needAgain">Use your entries from ${esc(rec.saved.replace('T', ' '))}: ${vals.map(([q, v]) => `${SHORT[q.path] || esc(q.label)} ${show(q, v)}`).join(' · ')}</button>`;
  }
  function useAgain() {
    const rec = lastTime();
    if (!rec) return;
    needRows().forEach(q => q.mezz.forEach(i => {
      const inp = inputsOf(i), m = rec.mezz.find(x => x.id === inp.mezz.id), v = m && m.entered && m.entered[q.path] != null ? snapVal(q.path, m.entered[q.path]) : null;
      if (v == null) return;
      const [g, k] = q.path.split('.');
      inp[g][k] = v === 'none' ? { value: null, source: 'none' } : { value: v, source: 'manual' };
    }));
    recompute();
  }
  // (C): the same as B once B is in, or an explicit "no requirement" — never filled in silently
  function chipsFor(q) {
    let base = q.suggest;
    if (q.path === 'geom.C') {
      const bs = [...new Set(q.mezz.map(i => inputsOf(i).geom.B.value).filter(v => v != null).map(v => +v.toFixed(4)))];
      base = [...(bs.length === 1 ? [[bs[0], ft(bs[0]), 'same as B']] : []), ['none', 'No requirement', 'depth limited by Settings only']];
    }
    // the quote's Provided column for a TBD requirement: one value, or each mezzanine its own
    const [g, k] = q.path.split('.'), pv = q.mezz.map(i => (inputsOf(i)[g][k] || {}).provided).filter(v => v != null);
    if (pv.length) {
      const one = [...new Set(pv.map(v => +v.toFixed(4)))];
      base = [one.length === 1 && pv.length === q.mezz.length ? [one[0], q.kind === 'ftin' ? ft(one[0]) : `${+(one[0] * 12).toFixed(3)}"`, 'Provided on the quote'] : ['provided', 'Each its Provided value', q.mezz.map(i => `${inputsOf(i).mezz.id || 'Mezzanine'} ${(inputsOf(i)[g][k] || {}).provided != null ? ft(inputsOf(i)[g][k].provided) : '—'}`).join(' · ')]].concat(base);
    }
    const show = v => (v === 'none' ? 'No requirement' : q.kind === 'ftin' ? ft(v) : q.kind === 'in' ? `${+(v * 12).toFixed(3)}"` : String(v));
    const mine = usual(q.path).map(u => [u.v, show(u.v), `your usual · ${u.n} job${u.n > 1 ? 's' : ''}`, 'usual']);
    const same = (a, b) => String(a) === String(b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-4);
    return mine.concat(base.filter(b => !mine.some(m => same(m[0], b[0]))));
  }
  function setNeed(path, value) {
    const [g, k] = path.split('.'), row = needRows().find(q => q.path === path);
    (row ? row.mezz : [state.mi]).forEach(i => {
      const was = inputsOf(i)[g][k] || {}, mine = value === 'provided' ? was.provided : value;
      if (value === 'provided' && mine == null) return;   // no Provided number on this one: left open
      inputsOf(i)[g][k] = mine === 'none' ? { value: null, source: 'none' } : { value: mine, source: 'manual', ...(value === 'provided' ? { note: 'the quote\'s Provided column' } : {}) };
    });
    recompute();
  }
  function wireNeed() {
    $$('#needCard input[data-need]').forEach(el => { el.onchange = () => { if (el.dataset.used) return; const v = parseKind(el.dataset.kind, el.value); if (v == null || !isFinite(v)) { toast('Could not read "' + el.value + '"'); return; } el.dataset.used = '1'; setNeed(el.dataset.need, v); }; });
    $$('#needCard .chip').forEach(b => { b.onclick = () => setNeed(b.dataset.need, b.dataset.v === 'none' || b.dataset.v === 'provided' ? b.dataset.v : +b.dataset.v); });
    const ag = $('#needAgain'); if (ag) ag.onclick = useAgain;
  }
  // notes, grouped: what to check, what was confirmed against the PCS, the design decisions, then how it was read
  // the job's notes — every mezzanine's, not only the one picked at the top: a note once, named with the mezzanines it is
  // about unless it names them itself
  function jobWarn() {
    const ms = state.job && state.job.mezz && state.job.mezz.length > 1 ? state.job.mezz : null;
    if (!ms) return state.res.warn;
    const by = new Map();
    ms.forEach(m => (m.warn || []).forEach(w => { const k = w.level + '|' + w.text, e = by.get(k) || { w, ids: [] }; if (!e.ids.includes(m.id)) e.ids.push(m.id); by.set(k, e); }));
    return [...by.values()].map(({ w, ids }) => (ms.some(m => w.text.includes(m.id)) || ids.length === ms.length ? w : { ...w, text: `${ids.join(', ')}: ${w.text}` }));
  }
  function notesHtml(warn, hideNeed) {
    const ws = hideNeed ? warn.filter(w => !/^Needs input/.test(w.text)) : warn;
    const item = w => `<div class="note ${w.level}">${esc(w.text)}</div>`;
    const grp = (lv, title, open = true) => { const xs = ws.filter(w => lv.includes(w.level)); if (!xs.length) return '';
      return open ? `<div class="note-group"><h5>${title}</h5>${xs.map(item).join('')}</div>` : `<details class="note-group more"><summary>${title} · ${xs.length} note${xs.length > 1 ? 's' : ''}</summary>${xs.map(item).join('')}</details>`; };
    return grp(['stop', 'warn'], 'Check before quoting') + grp(['ok'], 'Confirmed against the PCS', false) + grp(['key'], 'Design decisions', false) + grp(['info'], 'How it was read', false);
  }

  // the design manual (NBG DM 15.1 Mezzanine Systems): every item this job touches, grouped, with its status
  const DM_ICON = { ok: '✓', check: '!', stop: '✕', note: '✎', info: 'i' }, DM_WORD = { ok: 'met', check: 'to check', stop: 'fails', note: 'callout', info: 'scope' };
  function renderDM() {
    const items = (state.job && state.job.dm) || [], el = $('#dmList');
    $('#dmFold').hidden = !items.length;
    if (!items.length) { el.innerHTML = ''; return; }
    const count = st => items.filter(i => i.status === st).length;
    $('#dmSum').innerHTML = `<span class="dm-sum">${['ok', 'check', 'stop', 'note', 'info'].filter(count).map(st => `<span class="dm-chip s-${st}"><b>${count(st)}</b> ${DM_WORD[st]}</span>`).join('')}</span>`;
    el.innerHTML = `<div class="dm-groups">` +
      [...new Set(items.map(i => i.group))].map(gn => `<div class="dm-group"><h5>${esc(gn)}</h5>${items.filter(i => i.group === gn).map(i => `<div class="dm-item s-${i.status}"><span class="dm-ic" title="${DM_WORD[i.status]}">${DM_ICON[i.status]}</span><div><div class="dm-t"><b>${esc(i.title)}</b><span class="dm-ref">${/^\d/.test(i.ref) ? 'DM ' : ''}${esc(i.ref)}</span></div><p>${esc(i.text)}</p></div></div>`).join('')}</div>`).join('') + '</div>';
  }
  // Excel, step by step: the cells to type, in order, then what the workbook shows
  const xlCell = st => (st.where ? (st.where.includes('!') ? st.where : `${st.sheet}!${st.where}`) : `${st.sheet}!${st.cell}`);
  function xlTable(steps, read, readTitle = 'Excel then shows') {
    const rows = steps.map((st, i) => `<tr><td class="num n">${i + 1}</td><td class="mono cell">${esc(xlCell(st))}</td><td>${esc(st.label)}</td><td class="num mono val"><b>${esc(st.show)}</b></td></tr>`).join('');
    const rb = (read || []).map(r => `<tr class="rb"><td class="num n">→</td><td class="mono cell">${esc(r.sheet + '!' + r.cell)}</td><td>${esc(r.label)}</td><td class="num mono val">${esc(String(r.expect))}</td></tr>`).join('');
    return `<table class="xl"><thead><tr><th class="num">#</th><th>Cell</th><th>Field</th><th class="num">Type</th></tr></thead><tbody>${rows}${rb ? `<tr class="rb-h"><td></td><td colspan="3">${readTitle}</td></tr>${rb}` : ''}</tbody></table>`;
  }
  const xlTsv = steps => steps.map(st => `${xlCell(st)}\t${st.label}\t${st.show}`).join('\n');
  const XL_FOOT = 'These are the workbook\'s own input cells. "Download the filled workbook" types them into a copy of your workbook; checked against the real workbooks (LibreOffice, recalculated): every result below is what the workbook shows.';
  function renderXlBeam(mk, run) {
    const books = (state.job && state.job.excel && state.job.excel.beam) || [];
    const book = books.find(b => b.sheets.some(sh => sh.mark === mk.mark && Math.abs(sh.span - run.span) < 1e-3));
    if (!book) { $('#xlBeam').innerHTML = '<div class="empty">No section yet.</div>'; $('#xlBeamSub').textContent = ''; return; }
    const sh = book.sheets.find(x => x.mark === mk.mark && Math.abs(x.span - run.span) < 1e-3), inp = book.inputs.find(x => x.mezz === state.res.id) || book.inputs[0];
    $('#xlBeamSub').textContent = `${book.file}${book.copy > 1 ? ` (copy ${book.copy})` : ''} · ${book.sheets.map(x => `${x.sheet} = ${x.mark}${x.shorter ? ' at ' + ft(x.span) : ''}`).join(' · ')}`;
    $('#xlBeam').innerHTML = `<div class="xl-cols">
      <div><h4><span>1</span>INPUT sheet <small>once for the workbook${book.inputs.length > 1 ? ' · ' + esc(inp.mezz) + ' heights' : ''}</small></h4>${xlTable(inp.steps, inp.read, 'Excel then shows (once every MB sheet is in — D26 is the deepest of MB1–MB4)')}</div>
      <div><h4><span>2</span>${sh.sheet} sheet <small>${esc(mkName(mk))} at ${ft(sh.span)} × ${ft(sh.trib)} trib · ${sh.qty} beam${sh.qty > 1 ? 's' : ''}</small></h4>${xlTable(sh.steps, sh.read)}</div></div>
      <div class="xl-foot"><span>${XL_FOOT}</span><span class="xl-btns">${wbBtn(`beam|${book.copy}|${book.marks.join('+')}`, 'Download the filled workbook')}<button class="btn-soft" id="xlBeamCopy"><svg><use href="#i-copy"/></svg>Copy cells</button></span></div>`;
    $('#xlBeamCopy').onclick = () => copyText(xlTsv(inp.steps.concat(sh.steps)), `INPUT + ${sh.sheet} cells copied`);
  }
  function renderXlCol(r, gi) {
    let cs = null, book = null;
    ((state.job && state.job.excel && state.job.excel.column) || []).forEach(b => b.cases.forEach(c => { if (c.mi === r.index && c.group === gi) { cs = c; book = b; } }));
    if (!cs) { $('#xlCol').innerHTML = '<div class="empty">No column sized yet.</div>'; $('#xlColSub').textContent = ''; return; }
    const cno = colNos(), g = r.colGroups[gi];
    $('#xlColSub').textContent = `${book.file} · Column sheet for ${g ? g.cols.map(c => `C${cno.get(c.label) || '?'} (${c.label})`).join(', ') : 'this case'}`;
    $('#xlCol').innerHTML = xlTable(cs.steps, cs.read) + `<div class="xl-foot"><span>${XL_FOOT} The reactions are the MB-sheet end shears of the beams framing in (H6 / H10), summed per side.</span><span class="xl-btns">${wbBtn(`column|${r.index}|${gi}`, 'Download the filled workbook')}<button class="btn-soft" id="xlColCopy"><svg><use href="#i-copy"/></svg>Copy cells</button></span></div>`;
    $('#xlColCopy').onclick = () => copyText(xlTsv(cs.steps), 'Column cells copied');
  }

  /* ---------- the NBG workbooks themselves ----------
     The engineer drops the real workbooks once (Mezzanine Beam Design, Mezzanine Column, IBC Seismic); they are kept in
     this browser (IndexedDB) and never leave the computer. "Open in the workbook" types this job's entries into a copy
     (src/xls.js) and downloads it: Excel recalculates on opening, so the copy shows the workbook's own answer. */
  const WB_DB = 'mzd-workbooks', WB_STORE = 'books';
  const books = { list: [], loaded: false };
  const wbIdb = () => new Promise((ok, no) => { try { const r = indexedDB.open(WB_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(WB_STORE, { keyPath: 'id' }); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch (e) { no(e); } });
  async function wbLoadAll() {
    try { const db = await wbIdb(); books.list = await new Promise((ok, no) => { const q = db.transaction(WB_STORE).objectStore(WB_STORE).getAll(); q.onsuccess = () => ok(q.result || []); q.onerror = () => no(q.error); }); } catch (e) { /* private window: kept for this session only */ }
    books.loaded = true;
  }
  async function wbPut(it) { try { const db = await wbIdb(); await new Promise((ok, no) => { const t = db.transaction(WB_STORE, 'readwrite'); t.objectStore(WB_STORE).put(it); t.oncomplete = ok; t.onerror = () => no(t.error); }); } catch (e) { /* session only */ } }
  async function wbDel(id) { try { const db = await wbIdb(); await new Promise(ok => { const t = db.transaction(WB_STORE, 'readwrite'); t.objectStore(WB_STORE).delete(id); t.oncomplete = ok; t.onerror = ok; }); } catch (e) { /* session only */ } }
  // which workbook a file is: by its sheets (and the edition from the name, else from the sheets)
  function wbKind(name, bytes) {
    const cf = XLS.cfbRead(bytes), wb = cf.stream('Workbook') || cf.stream('Book');
    if (!wb) throw new Error('not an Excel 97–2003 workbook');
    const sh = XLS.sheetsOf(XLS.records(wb)).map(x => x.name), has = n => sh.includes(n), nm = String(name);
    if (has('Input Data') && has('Lateral Calcs. (1)') && has('Longitudinal Calcs.')) return { kind: 'seismic', ed: null, label: 'IBC Seismic' };
    if (has('INPUT') && has('MB1')) {
      if (/S16/i.test(nm) || has('Section Properties')) return { kind: 'beam', ed: 'S16', label: 'Mezzanine Beam Design (CSA S16)' };
      const ed = /13th/i.test(nm) ? '13' : /15th/i.test(nm) ? '15' : /16th/i.test(nm) ? '16' : has('D2D') ? '16' : has('Chapter B') && !has('ReadMe') ? '13' : '15';
      return { kind: 'beam', ed, label: `Mezzanine Beam Design ${ed}th` };
    }
    if (has('Column') && has('Base Plate')) {
      const ed = /16th/i.test(nm) ? '16' : /15th/i.test(nm) ? '15' : (XLS.read(bytes, [{ sheet: 'Column', cell: 'C10' }])['Column!C10'] === '(formula)' ? '15' : '16');
      return { kind: 'column', ed, label: `Mezzanine Column ${ed}th` };
    }
    return { kind: null, ed: null, label: 'not an NBG mezzanine / seismic workbook' };
  }
  async function wbAdd(files) {
    let n = 0;
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer()), k = wbKind(file.name, bytes);
        if (!k.kind || k.ed === 'S16') { toast(`${file.name}: ${k.kind ? 'the CSA S16 sheets are not used by this tool' : k.label}`); continue; }
        const it = { id: k.kind + '|' + (k.ed || ''), name: file.name, kind: k.kind, ed: k.ed, label: k.label, bytes, added: Date.now() };
        books.list = books.list.filter(x => x.id !== it.id).concat(it);
        await wbPut(it); n++;
      } catch (e) { toast(`${file.name}: ${e.message || e}`); }
    }
    if (n) toast(`${n} workbook${n > 1 ? 's' : ''} kept on this computer`);
    renderAll();
  }
  const wbFind = (kind, ed) => books.list.find(x => x.kind === kind && (!ed || x.ed === String(ed))) || null;
  const WB_NAME = { beam: ed => `Mezzanine Beam Design ${ed}th`, column: ed => `Mezzanine Column ${ed}th`, seismic: () => 'IBC Seismic' };
  // every copy the job can open in a workbook: { key, kind, ed, title, name, edits, entries, read }
  function wbJobs() {
    const out = [], q = (state.pcs && state.pcs.job.quote) || 'mezzanine', ex = (state.job && state.job.excel) || { beam: [], column: [] }, cno = colNos();
    ex.beam.forEach(b => {
      const inp = b.inputs[0], steps = inp.steps.concat(b.sheets.flatMap(sh => sh.steps));
      out.push({ key: `beam|${b.copy}|${b.marks.join('+')}`, kind: 'beam', ed: b.edition === '13' ? '13' : b.edition === '16' ? '16' : '15', title: b.sheets.map(x => `${x.mark} ${ft(x.span)}`).join(' · '), sub: `workbook tabs: ${b.sheets.map(x => `${x.sheet} ← ${x.mark}${x.shorter ? ' ' + ft(x.span) : ''}`).join(', ')}`,
        note: b.inputs.length > 1 ? `INPUT carries ${inp.mezz}'s heights (the MB results do not use them)` : '', name: `${q}-MB${b.copy > 1 ? '-' + b.copy : ''}.xls`, steps, read: b.sheets.flatMap(sh => sh.read).concat(inp.read) });
    });
    const cMin = c => { const r = (state.job.mezz || [])[c.mi], g = r && r.colGroups[c.group]; return g ? Math.min(...g.cols.map(x => cno.get(x.label) || 1e9)) : 1e9; };
    ex.column.forEach(b => b.cases.slice().sort((a1, a2) => cMin(a1) - cMin(a2)).forEach(c => {
      const r = (state.job.mezz || [])[c.mi], g = r && r.colGroups[c.group];
      const cs = g ? g.cols.slice().sort((a, b) => (cno.get(a.label) || 1e9) - (cno.get(b.label) || 1e9)) : null, nos = cs ? cs.map(x => `C${cno.get(x.label) || '?'}`) : c.labels, lab = nos.join(', ');
      // a run of numbers reads as a range (C3-C6); a broken run as its first and the count (C2-and-3-more)
      const nn = cs ? cs.map(x => cno.get(x.label) || 0) : [], run = nn.length > 3 && nn[nn.length - 1] - nn[0] + 1 === nn.length;
      const short = nos.length <= 3 ? nos.join('') : run ? `${nos[0]}-${nos[nos.length - 1]}` : `${nos[0]}-and-${nos.length - 1}-more`;
      out.push({ key: `column|${c.mi}|${c.group}`, kind: 'column', ed: b.edition === '16' ? '16' : '15', title: `${lab}${manyMezz() ? ' · ' + c.mezz : ''}`, sub: cs ? cs.map(x => x.label).join(', ') : c.labels.join(', '), note: '', name: `${q}-Column-${manyMezz() ? c.mezz.replace(/[^A-Za-z0-9]+/g, '') + '-' : ''}${short.replace(/[^A-Za-z0-9-]+/g, '')}.xls`, steps: c.steps, read: c.read });
    }));
    const sj = state.job && state.job.seismic;
    (sj && sj.ok ? sj.buildings : []).forEach(b => (b.workbook ? b.workbook.frames : []).forEach(fr => out.push({
      key: `seismic|${b.bkey}|${fr.label}`, kind: 'seismic', ed: null, title: `${sj.buildings.length > 1 ? b.name + ' · ' : ''}Frame line ${fr.label}`, sub: 'Lateral Calcs. (1)', note: b.workbook.notes.join(' '),
      name: `${q}-Seismic-${sj.buildings.length > 1 ? b.name.replace(/[^A-Za-z0-9]+/g, '') + '-' : ''}F${fr.label}.xls`, steps: b.workbook.input.concat(b.workbook.long, fr.steps), read: fr.read.concat(b.workbook.longRead) })));
    return out;
  }
  // a button for one copy; clicking it fills and downloads (or asks for the workbook first)
  const wbBtn = (key, label = 'Open in the workbook') => `<button class="btn-soft wb-btn" data-wb="${esc(key)}"><svg><use href="#i-file"/></svg>${esc(label)}</button>`;
  async function wbDownload(key) {
    const j = wbJobs().find(x => x.key === key);
    if (!j) { toast('Nothing to fill yet — this member has no section'); return; }
    let bk = wbFind(j.kind, j.ed);
    if (!bk) {
      const pick = document.createElement('input'); pick.type = 'file'; pick.accept = '.xls'; pick.multiple = true;
      toast(`Choose the ${WB_NAME[j.kind](j.ed)} workbook (.xls) — it is kept on this computer for next time`);
      pick.onchange = async () => { await wbAdd(Array.from(pick.files || [])); if (wbFind(j.kind, j.ed)) wbDownload(key); };
      pick.click();
      return;
    }
    try {
      const r = XLS.fill(bk.bytes, j.steps.map(st => ({ sheet: st.sheet, cell: st.cell, value: st.value })));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.bytes], { type: 'application/vnd.ms-excel' })); a.download = j.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`${j.name} — ${r.done.length} cells typed into ${bk.name}${r.missing.length ? ` · not typed: ${r.missing.map(m => m.sheet + '!' + m.cell).join(', ')}` : ''}. Excel recalculates when it opens.`);
    } catch (e) { toast(`${bk.name}: ${e.message || e}`); }
  }
  // the workbook buttons anywhere on the page
  document.addEventListener('click', ev => { const b = ev.target.closest('[data-wb]'); if (b) { ev.preventDefault(); ev.stopPropagation(); wbDownload(b.dataset.wb); } });
  // the panel: which workbooks this computer has, and every copy for this job
  function renderWorkbooks() {
    const el = $('#wbPanel');
    if (!el) return;
    const jobs = state.job ? wbJobs() : [];
    const kinds = [['beam', '13'], ['beam', '15'], ['beam', '16'], ['column', '15'], ['column', '16'], ['seismic', null]];
    const needed = new Set(jobs.map(j => j.kind + '|' + (j.ed || '')));
    const have = kinds.filter(([k, e]) => needed.has(k + '|' + (e || '')) || wbFind(k, e)).map(([k, e]) => { const b = wbFind(k, e); return `<span class="wb-chip ${b ? 'ok' : 'miss'}">${b ? '✓' : '+'} ${esc(WB_NAME[k](e))}${b ? `<small>${esc(b.name)}</small><button class="wb-x" data-wbdel="${esc(b.id)}" title="Forget it on this computer">✕</button>` : '<small>not added yet</small>'}</span>`; }).join('');
    const groups = [['beam', 'Beam design'], ['column', 'Columns'], ['seismic', 'Seismic']].map(([k, t]) => { const xs = jobs.filter(j => j.kind === k); return xs.length ? `<div class="wb-group"><h5>${t} <small>${esc(WB_NAME[k](xs[0].ed))}</small></h5><div class="wb-rows" data-k="${k}">${xs.map(j => `<div class="wb-row"><div><b>${esc(j.title)}</b><small>${esc(j.sub || '')} · ${j.steps.length} cells${j.note ? ' · ' + esc(j.note) : ''}</small></div>${wbBtn(j.key, 'Download')}</div>`).join('')}</div></div>` : ''; }).join('');
    el.innerHTML = `${jobs.length ? `<div class="cp-lead"><button class="btn-soft" data-cpdl="xlsx"><svg><use href="#i-file"/></svg>Design basis (.xlsx)</button><button class="btn-ghost" data-cpdl="all" ${books.list.length ? '' : 'disabled title="Add the workbooks below to zip them with the design basis"'}>Everything (.zip)</button><small>The design basis workbook: every input and its source, the MB and Column sheet cells and results, the options and how they were found, the shop rules, stock, flange economy, frame and seismic loads, and the sources. Everything adds the filled workbooks below.</small></div>` : ''}
      <div class="wb-have">${have || '<span class="sub-n">No workbooks added yet.</span>'}<label class="btn-ghost wb-add"><input type="file" accept=".xls" multiple hidden id="wbFile">Add workbooks…</label></div>
      ${jobs.length && state.job && !(state.job.seismic && state.job.seismic.ok) && wbFind('seismic', null) ? '<small class="cp-note">IBC Seismic joins the zip once the Seismic page is finished</small>' : ''}
      ${jobs.length ? `<div class="wb-groups">${groups}</div>` : '<div class="empty">Load a PCS to fill the workbooks with its design.</div>'}
      <small class="sub-n">Each download is a copy of your own workbook with this job's entries typed into its input cells (the same cells as "Excel, step by step") — nothing else in it changes. Excel recalculates when it opens the copy, so every result you see is the workbook's. The workbooks stay on this computer; nothing is uploaded.</small>`;
    const inp = $('#wbFile'); if (inp) inp.onchange = () => { wbAdd(Array.from(inp.files || [])); inp.value = ''; };
    $$('#wbPanel [data-wbdel]').forEach(b => { b.onclick = async () => { await wbDel(b.dataset.wbdel); books.list = books.list.filter(x => x.id !== b.dataset.wbdel); renderAll(); }; });
  }

  /* ---------- the calc package: a design-basis workbook (inputs and their sources, the MB / Column sheet cells and
     results, the options and how they were found, the shop rules, stock, flange economy, frame and seismic loads) and
     the filled NBG workbooks — at the bottom of the Beam and Column pages, and on the Design page ---------- */
  const cpName = () => ((state.pcs && state.pcs.job.quote) || 'mezzanine').replace(/[^A-Za-z0-9-]+/g, '');
  function cpXlsx() {
    const sheets = window.MZ_CALCPACK.sheets(state.job, { cno: colNos(), inputs: state.all ? state.all.map(a => a.inputs) : [state.inputs], settings: state.settings, codeText: state.inputs && state.inputs.job && state.inputs.job.code ? state.inputs.job.code.text : '', generated: new Date().toISOString().slice(0, 10) });
    return window.MZ_XLSX.book(sheets, { title: `${cpName()} calc package` });
  }
  const cpSave = (bytes, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  async function cpDownload(what) {
    if (!state.job) { toast('Load a PCS first'); return; }
    try {
      const xlsx = cpXlsx(), name = `${cpName()}-calc-package`;
      if (what === 'xlsx') { cpSave(xlsx, name + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast(`${name}.xlsx — inputs, sources, MB / Column sheets, options, shop rules`); return; }
      // everything: the package and every filled workbook this computer has
      const files = [{ name: name + '.xlsx', data: xlsx }], missing = new Set();
      wbJobs().forEach(j => { const bk = wbFind(j.kind, j.ed); if (!bk) { missing.add(WB_NAME[j.kind](j.ed)); return; } try { files.push({ name: 'workbooks/' + j.name, data: XLS.fill(bk.bytes, j.steps.map(st => ({ sheet: st.sheet, cell: st.cell, value: st.value }))).bytes }); } catch (e) { missing.add(`${bk.name} (${e.message})`); } });
      if (zipIO.ok) for (const f of files) f.packed = await zipIO.deflate(f.data);   // compressed where the browser can
      cpSave(window.MZ_XLSX.zip(files), name + '.zip', 'application/zip');
      const seisOut = state.job.seismic && !state.job.seismic.ok ? ' · IBC Seismic is left out until the Seismic page is complete' : '';
      toast(`${name}.zip — the package and ${files.length - 1} filled workbook${files.length === 2 ? '' : 's'}${missing.size ? ` · add ${[...missing].join(', ')} to include ${missing.size > 1 ? 'them' : 'it'}` : ''}${seisOut}`);
    } catch (e) { toast('Calc package: ' + (e.message || e)); }
  }
  document.addEventListener('click', ev => { const b = ev.target.closest('[data-cpdl]'); if (b) { ev.preventDefault(); cpDownload(b.dataset.cpdl); } });
  function renderCalcPack() {
    const ready = !!(state.job && state.job.marks && state.job.marks.length);
    const nWb = state.job ? wbJobs().filter(j => wbFind(j.kind, j.ed)).length : 0, nAll = state.job ? wbJobs().length : 0;
    // the IBC Seismic workbook is added, but the Seismic page is not finished: the zip leaves it out — say so
    const seisWait = !!(state.job && !(state.job.seismic && state.job.seismic.ok) && wbFind('seismic', null));
    $$('.calcpack').forEach(el => {
      el.innerHTML = !ready ? '' : `<div class="cp-bar"><div class="cp-t"><b>Calc package</b><small>The inputs and where each came from, the ${el.dataset.cp === 'col' ? 'Column' : 'MB'} sheet cells and results, the options, the shop rules, stock and flange economy — for the engineer checking the design.</small></div>
        <div class="cp-btns"><button class="btn-soft" data-cpdl="xlsx"><svg><use href="#i-file"/></svg>Design basis (.xlsx)</button>${el.dataset.cp === 'col' ? (colShown() && colShown().colFinal && colShown().colFinal.checks[state.colGroup] ? wbBtn(`column|${colShown().index}|${state.colGroup}`, 'Column workbook') : '') : (() => { const mk = jobMarks()[state.mark], b = mk && (state.job.excel.beam || []).find(x => x.marks.includes(mk.mark)); return b ? wbBtn(`beam|${b.copy}|${b.marks.join('+')}`, 'MB workbook') : ''; })()}<button class="btn-ghost" data-cpdl="all" ${nWb ? `title="the design basis and ${nWb} filled workbook${nWb > 1 ? 's' : ''}${seisWait ? ' — IBC Seismic is not in it until the Seismic page is finished' : ''}"` : 'disabled title="Add the NBG workbooks (Design page → Calc package) to zip them with the design basis"'}>Everything (.zip)${nWb ? ` · ${nWb}` : ''}</button>${seisWait && nWb ? '<small class="cp-note">IBC Seismic joins the zip once the Seismic page is finished</small>' : ''}</div></div>`;
    });
  }

  function setNeedSlot(html) {
    const had = { need: !!$('#needCard'), dec: !!$('#decideCard') };
    $('#needSlot').innerHTML = html;
    if (!had.need && $('#needCard')) $('#needCard').classList.add('enter');
    if (!had.dec && $('#decideCard')) $('#decideCard').classList.add('enter');
  }
  function renderResults() {
    const r = state.res, inp = state.inputs, s = state.settings;
    $('#resEyebrow').textContent = [inp.job.quote, inp.job.project].filter(Boolean).join(' / ') || 'Design result';
    const card = needCard();
    if (r.incomplete) {
      $('#resTitle').innerHTML = `Mezzanine “${esc(inp.mezz.id || '—')}”<br><em>needs input.</em>`;
      $('#metrics').innerHTML = ''; $('#field').innerHTML = ''; $('#options').innerHTML = ''; $('#readout').innerHTML = '';
      $('#modelSec').hidden = true; $('#optHead').hidden = true; $('#checkPill').hidden = true; $('#wbHead').hidden = true; $('#wbPanel').hidden = true;
      renderMini(null);
      setNeedSlot(card);
      $('#warnings').innerHTML = notesHtml(jobWarn(), !!card);
      wireNeed();
      renderDM();
      const anyDone = state.all && state.all.length > 1 && state.job.mezz.some(m => !m.incomplete);
      $('#qsHead').hidden = !anyDone;
      if (anyDone) renderQuoteSheet(); else $('#quoteSheet').innerHTML = '';
      return;
    }
    // a beam mark with no section: the decision is asked for like a missing value — what stops it and the two ways
    // forward, with their inputs, at the top; the design shows once it is made
    const dec = decideMarks();
    $('#wbHead').hidden = !!dec.length; $('#wbPanel').hidden = !!dec.length;
    if (dec.length) {
      const doneIds = (state.job ? state.job.mezz.filter(m => !m.incomplete) : [r]).map(m => `“${esc(m.id).replace(/ /g, '\u00a0')}”`);
      $('#resTitle').innerHTML = `Mezzanine${doneIds.length > 1 ? 's' : ''} ${doneIds.join(' + ')}<br><em>one decision to make.</em>`;
      $('#metrics').innerHTML = ''; $('#field').innerHTML = ''; $('#options').innerHTML = ''; $('#readout').innerHTML = '';
      $('#modelSec').hidden = true; $('#optHead').hidden = true; $('#checkPill').hidden = true; $('#qsHead').hidden = true; $('#quoteSheet').innerHTML = '';
      setNeedSlot(card + decideCard(dec));
      $('#warnings').innerHTML = notesHtml(jobWarn().filter(w => w.tag !== 'nosec'), true);
      wireNeed(); wireDecide($('#needSlot'), dec);
      renderDM();
      if (M3) renderMini(buildScene({ calm: true }));   // the sidebar keeps the layout turning, the beams to decide in amber
      return;
    }
    // a job of several mezzanines is one design: the beam marks, counts, columns and steel are the whole job's
    const many = manyMezz(), t = many ? jobTotals() : totals(), cf = r.colFinal, marks = jobMarks(), mk0 = marks[0];
    const done = many ? state.job.mezz.filter(m => !m.incomplete) : [r];
    // each section in the headline red only when it is the one that does not pass; a fixed order (sections, then not sized)
    const tgt0 = s.target, bad0 = mk => !mk.check || !(mk.check.res.CSR <= tgt0 && mk.check.res.SRvx <= tgt0 && mk.check.llOK && mk.check.tlOK && (!mk.check.conc || mk.check.conc.ok));
    const secItems = [...new Map(marks.map(mk => [mk.desc || 'NO SECTION', bad0(mk)])).entries()];
    const colMz = done.filter(m => m.columns.length), colItems = [...new Map(colMz.filter(m => m.colFinal).map(m => [m.colFinal.quoteAs, !m.colFinal.ok])).entries()].concat(colMz.some(m => !m.colFinal || (m.colFinal.unsized || []).length) ? [['columns not sized', true]] : []);
    const secs = secItems.map(([t]) => t).join(' / '), cols = colItems.map(([t]) => t).join(' / ');
    const redList = items => items.map(([t, bad]) => (bad ? `<span class="ng">${esc(t)}</span>` : esc(t))).join(' / ');
    // red when anything on the quote does not pass: a mark with no section or a failing pick, a column not sized or failing
    const tgt = s.target, mkFails = mk => !mk.check || !(mk.check.res.CSR <= tgt && mk.check.res.SRvx <= tgt && mk.check.llOK && mk.check.tlOK && (!mk.check.conc || mk.check.conc.ok));
    const failing = marks.some(mkFails) || done.some(m => m.columns.length && (!m.colFinal || !m.colFinal.ok || (m.colFinal.unsized || []).length)) || done.some(m => m.clear && m.clear.C && m.clear.C.ok === false);
    const colLens = [...new Set(done.filter(m => m.columns.length).map(m => ft(m.colLen)))].join(' / ') || ft(r.colLen);
    // member lengths: the MB runs, or with no section the layout's own (every length the plan and the quote have)
    const spans = [...new Set(marks.flatMap(mk => (mk.spanRuns && mk.spanRuns.length ? mk.spanRuns : mk.beamsAll && mk.beamsAll.length ? mk.beamsAll : [mk]).map(q => +q.span.toFixed(3))))].sort((x, y) => y - x).map(ft).join(' / ');
    const nb = t2 => esc(t2).replace(/ /g, '\u00a0');   // a name never breaks across lines ("Lean To")
    const ids = many ? done.map(m => `“${nb(m.id)}”`).join(' + ') : `“${nb(inp.mezz.id || '—')}”`;
    $('#resTitle').innerHTML = `Mezzanine${many && done.length > 1 ? 's' : ''} ${ids}<br><em class="nocase"${failing ? ' title="Something on the quote does not pass — see Check before quoting"' : ''}>${redList(secItems)}${cols ? ' · ' + redList(colItems) : ''}</em>`;

    // metric ring cards
    const foreign = !many && (r.foreignCols || []).length ? ` · + ${r.foreignCols.map(c => `${c.label} with ${esc(c.ownerId)}`).join(', ')}` : '';
    // what has no section yet: said on the cards, never counted as a pass or left out of the steel silently
    const noSec = marks.filter(mk => !mk.check), nNoCol = done.reduce((a, m) => a + (!m.columns.length ? 0 : m.colFinal ? (m.colFinal.unsized || []).length : m.columns.length), 0);
    const sized = cols.split(' / ').filter(c => c && c !== 'columns not sized').join(' / ');
    const colSub = [nNoCol ? `<b class="ng">${nNoCol} not sized</b>${noSec.length ? ` — ${esc(noSec.map(mk => mk.mark).join(', '))} ${noSec.length > 1 ? 'have' : 'has'} no section` : ''}` : '', sized ? `${esc(sized)} · ${colLens}${t.colMax != null ? ` · CSR ${f(t.colMax, 3)}` : ''}` : ''].filter(Boolean).join(' · ') || 'every beam end lands on a building column';
    const missing = [noSec.length ? noSec.map(mk => mk.mark).join(', ') : '', nNoCol ? `${nNoCol} column${nNoCol > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
    $('#metrics').innerHTML = [
      ringCard(many ? 'Beams · whole job' : 'Mezzanine beams', `<span data-count="${t.nB}">${t.nB}</span>`, `${marks.map(mk => `${mk.mark} ${esc(mk.desc || 'NO SECTION')} × ${mk.qtyAll}`).join(' · ')} · ${spans} span`, t.govBeam ? t.govBeam.v : null, t.govBeam && /deflection/.test(t.govBeam.what) && t.govBeam.v <= 1 + 1e-9 ? 'var(--green)' : null, noSec.length ? `${noSec.map(mk => mk.mark).join(', ')}: no passing section` : null),
      ringCard(many ? 'Columns · whole job' : 'Mezzanine columns', `<span data-count="${t.nC}">${t.nC}</span>`, colSub + foreign, t.colMax, null, nNoCol ? `${nNoCol} columns not sized` : null),
      floorCard(),
      ringCard(many ? 'Steel · whole job' : 'Mezzanine steel', `<span data-count="${Math.round(t.total)}" data-fmt="lb">${n0(t.total)} lb</span>${missing ? '<small class="ng"> at least</small>' : ''}`, `${missing ? `<b class="ng">${esc(missing)} not sized — not in this total</b> · ` : ''}beams ${n0(t.beams)} · columns ${n0(t.cols)} · end plates ${n0(t.plates)}`, null),
    ].join('');
    setNeedSlot(card);
    $('#warnings').innerHTML = notesHtml(jobWarn(), !!card);
    wireNeed();
    renderDM();
    $('#modelSec').hidden = false; $('#optHead').hidden = false; $('#qsHead').hidden = false;
    const jw = jobWarn(), nCheck = jw.filter(w => w.level === 'stop' || w.level === 'warn').length;
    $('#checkPill').hidden = !nCheck;
    $('#checkPill').textContent = `${nCheck} to check before quoting ↓`;
    $('#checkPill').className = 'check-pill ' + (jw.some(w => w.level === 'stop') ? 'stop' : 'warn');

    // hero field: beam marks -> governing ratio -> columns + plan check
    const pc = r.planCheck;
    const gv = t.gov ? t.gov.v : 0, c0 = t.govBeam ? t.govBeam.mk.check : mk0 && mk0.check;
    // a mark with no section or a column not sized: the dial says NG — the ratio of what did size is not the answer
    const unsized = noSec.length || nNoCol, ngWhat = [noSec.length ? `${noSec.map(mk => mk.mark).join(', ')}: no passing section` : '', nNoCol ? `${nNoCol} column${nNoCol > 1 ? 's' : ''} not sized` : ''].filter(Boolean).join(' · ');
    const edited = allSettings().some(layEdited);
    const nCases = done.reduce((a, m) => a + m.colGroups.length, 0);
    const mkRows = marks.map(mk => `<div class="mk-row" style="--mk:${mkHex(mk)}"><div class="mk-id"><b>${mk.mark}</b><small>${mk.kind || (mk.optionKey && mk.optionKey !== 'lightest' ? ({ fit: 'best fit', econ: 'economical', custom: 'picked' })[mk.optionKey] || mk.optionKey : '')}</small></div>
        <div class="mk-sec"><span class="nocase${mk.sec ? '' : ' ng'}">${esc(mk.desc || 'NO SECTION')}</span></div><div class="mk-qty"><b>${mk.qtyAll}</b></div>
        <div class="mk-meta">${mkDims(mk)} trib${mkShort(mk) ? ' · ' + mkShort(mk) : ''}${mkWhere(mk) ? ' · ' + mkWhere(mk) : ''}</div></div>`).join('');
    const kinds = marks.some(mk => mk.kind) ? '<div class="sub mk-why">interior: more trib than any edge beam · exterior: edge beams, joists on one side — each designed at its largest trib and longest span</div>' : '';
    const joistTxt = done.map(m => `${many ? esc(m.id) + ': ' : ''}joists @ ${ft(m.beamBase.Lb)} span ${ft(m.layout.joistSpan)} ${m.layout.joists === 'y' ? 'across the width' : 'along the length'} onto ${m.layout.beamLines.length} beam lines`).join(' · ');
    $('#field').innerHTML = `
      <div class="field-head"><div><div class="eyebrow">Framing summary${many ? ' · whole job' : ''}</div><h3>Floor load → beams → columns</h3></div></div>
      <div class="field-stage"><div class="atlas">
        <div class="fcard"><div class="step">01 / Mezzanine beams</div><h4>${t.nB} beam${t.nB === 1 ? '' : 's'} · ${marks.length} mark${marks.length === 1 ? '' : 's'}</h4>
          <div class="mk-list">${mkRows || '<div class="sub">no beams</div>'}</div>${kinds}</div>
        <div class="disc-wrap"><div class="step">Governing ratio</div><div class="orbit"></div>
          ${unsized ? `<div class="disc ng" data-ring="100" style="--ring:0;--disc-a:#ff6b6b"><div class="disc-inner"><span>Not sized</span><strong>NG</strong><b>${esc(ngWhat)}</b></div></div>`
            : `<div class="disc" data-ring="${pct(gv).toFixed(1)}" style="--ring:0;--disc-a:${gv <= (/deflection/i.test(t.gov ? t.gov.who : '') ? 1 : s.target) + 1e-9 ? '#64ffd0' : gv <= 1 ? '#ffd27a' : '#ff9d7a'}"><div class="disc-inner"><span>Max ratio</span><strong data-count="${gv}" data-fmt="sr">${f(gv, 3)}</strong><b>${esc(t.gov ? t.gov.who : '')}</b></div></div>`}
          <div class="disc-caption">Stress ratios ≤ ${s.target}; deflection L/360 live and L/240 total (ratio ≤ 1.000); columns &lt; 1.00 on all three combinations.</div>
          <div class="disc-proof">${unsized ? (c0 || t.colMax != null ? `sized so far: ${c0 ? `${esc(t.govBeam ? t.govBeam.mk.mark : mk0 ? mk0.mark : '')} combined <b>${f(c0.res.CSR, 3)}</b>` : ''}${t.colMax != null ? `${c0 ? ' · ' : ''}columns <b>${f(t.colMax, 3)}</b>` : ''}` : '') : `${c0 ? `combined <b>${f(c0.res.CSR, 3)}</b> · shear <b>${f(c0.res.SRvx, 3)}</b>` : ''}${t.colMax != null ? ` · column <b>${f(t.colMax, 3)}</b>` : ''}`}</div></div>
        <div class="tallies">
          <div class="tally ${nNoCol ? 'ng' : ''}"><div class="step">02 / Mezzanine columns</div><div class="tally-row"><div><h4 class="nocase">${nNoCol ? `<span class="ng">${nNoCol} not sized</span>${sized ? ' · ' + esc(sized) : ''}` : cols ? esc(cols) : 'None needed'}</h4><p>${nNoCol ? esc(noSec.length ? `${noSec.map(mk => mk.mark).join(', ')} ${noSec.length > 1 ? 'have' : 'has'} no section, so the reactions are unknown` : 'see Check before quoting') : cols ? `${colLens} · ${nCases} load case${nCases > 1 ? 's' : ''}${many && s.colPerJob !== false ? ' · one section, whole job' : ''}` : 'beams frame into building columns'}</p></div><div><strong>${t.nC}</strong><small>${t.colMax != null ? 'CSR ' + f(t.colMax, 3) : ''}</small></div></div></div>
          <div class="tally ${pc && pc.ok && pc.agree ? '' : 'warn'}"><div class="step">03 / Floor plan check</div><div class="tally-row"><div><h4>${pc ? (pc.ok ? (pc.agree ? 'Matches the drawing' : edited ? 'Edited on the Plan page' : 'Differs from the drawing') : 'Not read') : 'No floor plan'}</h4><p>${pc && pc.ok ? (edited && !pc.agree ? esc([pc.extraLabels.length ? `on the drawing, taken out: ${pc.extraLabels.join(', ')}` : '', (pc.frameLabels || []).length ? `made frame columns: ${pc.frameLabels.join(', ')}` : '', pc.missing.length ? `added: ${pc.missing.join(', ')}` : ''].filter(Boolean).join(' · ')) : '⊗ at ' + esc(pc.labels.join(', '))) : pc ? esc(pc.reason) : 'confirm the layout by eye'}</p></div><div><strong>${pc && pc.ok ? (edited && !pc.agree ? `${pc.drawn} / ${pc.laid}` : pc.matched.length + '/' + pc.labels.length) : '—'}</strong><small>${pc && pc.ok ? (edited && !pc.agree ? 'drawing / layout' : 'columns found') : ''}</small></div></div></div>
        </div></div>
        <div class="field-foot"><b>Field readout</b><span>${joistTxt}; ${t.nB} beams frame into ${t.nC} mezzanine column${t.nC === 1 ? '' : 's'} and the building columns.</span></div>
      </div>`;

    renderOptions();
    renderQuoteSheet();
    renderModel();
    animateIn();

    // readout
    const mkTxt = marks.map(mk => `<em>${mk.qtyAll}</em> ${mk.kind ? mk.kind + ' ' : ''}${esc(mk.desc || 'NO SECTION')} (${mk.mark}) at <em>${ft(mkDz(mk).span)}</em> × <em>${ft(mkDz(mk).trib)}</em> trib${mkDz(mk).set ? ` (design; layout ${ft(mk.span)} × ${ft(mk.trib)})` : ''}${mkShort(mk) ? ' ' + mkShort(mk) : ''}`).join('; ');
    $('#readout').innerHTML = `<div class="eyebrow">What the design establishes</div>
      <p>${mkTxt || 'No beams'} carry the floor into <em>${t.nC}</em> ${nNoCol ? `columns (${nNoCol} not sized${sized ? '; ' + esc(sized) : ''})` : `${esc(cols)} column${t.nC === 1 ? '' : 's'}`} <em>${colLens}</em> tall — ${unsized ? `<em class="ng">${esc(ngWhat)}</em>` : `governing ratio <em>${f(gv, 2)}</em>`}${c0 && !unsized ? `, live-load deflection <em>L/${f(c0.defl.rLL, 0)}</em>` : ''}.</p>
      <div class="readout-facts"><span><b>${marks.filter(mk => mk.check).map(mk => f(mk.check.res.Wt, 1)).join(' / ') || '—'}</b>plf beam${marks.length > 1 ? 's' : ''}</span><span><b>${n0(t.total)}</b>lb mezzanine steel${unsized ? ' — at least' : ''}</span><span><b>${r.joistDepthIn != null ? f(r.joistDepthIn, 0) + '"' : '—'}</b>total joist depth</span><span><b>${edLabel(r.edition.beamEd || r.edition.ed)}</b>ASD sheets</span></div>`;
  }

  function renderOptions() {
    const inp = state.inputs;
    const A = inp.geom.A.value, slabIn = (inp.geom.slab.value || 0) * 12, seatIn = (inp.geom.seat.value || 0) * 12;
    const uo = usualOption(), uoLab = uo && { lightest: 'Lightest', fit: 'Best fit', econ: 'Most economical' }[uo.key];
    const marks = jobMarks();
    $('#optSub').textContent = (marks[0] && marks[0].search ? `every stocked web and flange within the production rules, through the MB sheet — ${marks[0].search.evaluated.toLocaleString()} combinations a mark · pick one for the quote${manyMezz() ? ' (it goes on every mezzanine)' : ''}` : '') + (uo ? ` · you usually quote ${uoLab} (${uo.n} of ${uo.tot})` : '');
    const TIERW = { G: 'economical', Y: 'somewhat economical', R: 'non-economical' };
    $('#options').innerHTML = marks.map(mk => {
      if (!mk.options || !mk.options.length) return `<div class="mark-block"><p class="mark-label"><b>${mkName(mk)}</b> — ${mk.sec ? `no passing section in the depth range. On the quote: <b class="${markFails(mk) ? 'ng' : ''}">${esc(mk.desc)}</b>, picked by hand${markFails(mk) ? ' — does not pass (see Beam calc)' : ''}.` : 'waits on the decision at the top of the page (setback or clear height).'}</p></div>`;
      const len = (mk.beamsAll || []).reduce((a, x) => a + x.span, 0) || mk.qtyAll * mk.span;   // every member at its own length
      const where = mkWhere(mk), short = mkShort(mk);
      // one card per different section; the options that land on it are named together
      const groups = [];
      mk.options.forEach(o => { const g = groups.find(x => sameSec(x.sec, o.pick.sec)); if (g) g.roles.push(o); else groups.push({ sec: o.pick.sec, pick: o.pick, roles: [o] }); });
      const one = groups.length === 1, sr = mk.search, capped = sr && sr.dTop < sr.options.dMax;
      const card = g => {
        const p = g.pick, o = g.roles[0], chosen = sameSec(p.sec, mk.sec);
        // the bottom of the beam at midspan, under the total load: A − slab − seat − depth − sag
        const under = A != null ? A - (slabIn + seatIn + p.sec.d + (p.dTL || 0)) / 12 : null;
        const dLbs = o.dWt * len;
        return `<article class="option ${chosen ? 'is-chosen' : ''} ${g.roles.length > 1 ? 'is-merged' : ''}">
          <div class="option-top"><span class="option-tags">${g.roles.map(x => `<span class="option-tag">${esc(x.label)}</span>`).join('')}</span><span class="option-delta ${o.dWt > 0 ? '' : 'zero'}">${o.dWt > 1e-9 ? `+${f(o.dPct * 100, 1)}% · +${n0(dLbs)} lb` : o.dWt < -1e-9 ? `${f(o.dPct * 100, 1)}% · ${n0(dLbs)} lb` : 'least weight'}</span></div>
          ${o.needC != null ? `<div class="option-flag">Needs clearance C ≤ ${ft(o.needC)} — the PCS asks ${ft(inp.geom.C.value)}</div>` : ''}
          <div class="option-sec nocase">${esc(p.desc)}</div><div class="option-parts">${secParts(p.sec)} · flange ${TIERW[p.tier] || p.tier}</div>
          <div class="option-grid">
            <div><span>Weight</span><b>${f(p.wt, 1)} plf</b></div><div><span>Depth</span><b>${p.sec.d}"</b></div><div title="The bottom of the beam at midspan under the total load: A − slab − seat − depth − ${f(p.dTL || 0, 2)}&quot; sag"><span>Under beam, mid</span><b>${under != null ? ft(under) : '—'}</b></div>
            <div><span>Combined</span><b class="${p.CSR <= state.settings.target ? 'ok' : 'bad'}">${f(p.CSR, 3)}</b></div><div><span>Shear</span><b class="${p.SRv <= state.settings.target ? 'ok' : 'bad'}">${f(p.SRv, 3)}</b></div><div><span>Live defl.</span><b class="ok">L/${f(p.rLL, 0)}</b></div>
          </div>
          <ul class="option-why">${g.roles.map(x => `<li><b>${esc(x.label)}</b> — ${esc(x.why)}</li>`).join('')}</ul>
          <div class="option-actions">${chosen ? '<span class="chosen-pill">In the quote</span>' : (o.needC != null ? `<button class="btn-ghost" data-opt="${o.key}" data-mark="${mk.mark}" title="Breaks the clearance C on the PCS — use it only with C lowered to ${esc(ft(o.needC))} or less">Use with C ≤ ${esc(ft(o.needC))}</button>` : `<button class="btn-soft" data-opt="${o.key}" data-mark="${mk.mark}">Use this</button>`)}<button class="btn-ghost" data-go="beam">Calc</button></div>
        </article>`;
      };
      // why only one: the lighter plates that fail at that depth (from the step-by-step tries)
      const fitO = mk.options.find(o => o.key === 'fit'), flStep = fitO && fitO.steps && fitO.steps.find(x => x.step === 'flange');
      const lastFail = flStep && flStep.tries ? flStep.tries.filter(t => !t.ok && t.why && !/production|no web/.test(t.why)).pop() : null;
      const oneTxt = one && !(mk.options || []).some(o => o.needC != null) ? `<div class="option-one"><b>One design for these inputs.</b> ${capped ? `The clearance C leaves ${sr.room != null ? `${f(sr.room, 2)}" for the beam and its sag (A − C − slab − seat; depth + total-load deflection has to fit)` : `${sr.dTop}" for the beam (A − C − slab − seat)`}${lastFail ? `; at ${sr.dTop}" the next lighter plate fails (${esc(lastFail.sec)}: ${esc(lastFail.why)})` : ''}, so ` : ''}every way of building it — the lightest, the step-by-step method, the economical flanges — lands on the same section.${mk.deeper && mk.deeper.length ? ` More depth would take less steel, but needs the clearance under the beams lowered:` : ''}</div>
        ${mk.deeper && mk.deeper.length ? `<table class="fl-t deeper"><thead><tr><th class="num">Depth</th><th>Section</th><th class="num">plf</th><th class="num">Saves</th><th class="num">Combined</th><th class="num">Live</th><th class="num">Depth + sag</th><th class="num">C would be at most</th></tr></thead><tbody>${mk.deeper.map(z => `<tr><td class="num mono">${z.d}"</td><td class="mono">${esc(z.desc)} <small class="sub-n">${esc(z.flange)} · ${esc(z.web)}</small></td><td class="num mono">${f(z.wt, 1)}</td><td class="num mono">${f(groups[0].pick.wt - z.wt, 1)} plf (${f((1 - z.wt / groups[0].pick.wt) * 100, 0)} %)</td><td class="num mono">${f(z.CSR, 3)}</td><td class="num mono">L/${f(z.rLL, 0)}</td><td class="num mono">${f(z.need, 2)}"</td><td class="num mono">${ft(z.needC)}</td></tr>`).join('')}</tbody></table>` : ''}` : '';
      // a section picked by depth or by hand (Design your own): its own card, so the quote's section is always on the page
      const handCard = () => {
        if (!mk.sec || !mk.check || groups.some(g => sameSec(g.sec, mk.sec))) return '';
        const c = mk.check, x = c.res, light = groups.find(g => g.roles.some(o => o.key === 'lightest')) || groups[0], dW = x.Wt - light.pick.wt;
        const under = A != null ? A - (slabIn + seatIn + mk.sec.d + mk.check.defl.TL) / 12 : null, tg = state.settings.target, Cq = inp.geom.C.value;
        const flags = [x.CSR > tg && `combined ${f(x.CSR, 3)} over ${f(tg, 2)}`, x.SRvx > tg && `shear ${f(x.SRvx, 3)} over ${f(tg, 2)}`, !c.llOK && `live L/${f(c.defl.rLL, 0)} under L/360`, !c.tlOK && `total L/${f(c.defl.rTL, 0)} under L/240`,
          under != null && Cq != null && under < Cq - 1e-9 && `${ft(under)} under the beam at midspan, with its ${f(mk.check.defl.TL, 2)}" sag < C ${ft(Cq)}`].filter(Boolean);
        return `<article class="option is-chosen is-hand ${flags.length ? 'has-flags' : ''}">
          <div class="option-top"><span class="option-tags"><span class="option-tag">Picked by hand</span></span><span class="option-delta ${dW > 0 ? '' : 'zero'}">${dW > 1e-9 ? `+${f(dW / light.pick.wt * 100, 1)}% · +${n0(dW * len)} lb` : dW < -1e-9 ? `${f(dW / light.pick.wt * 100, 1)}% · ${n0(dW * len)} lb` : 'same weight'} vs lightest</span></div>
          ${flags.length ? `<div class="option-flag">${esc(flags.join(' · '))}</div>` : ''}
          <div class="option-sec nocase">${esc(mk.desc)}</div><div class="option-parts">${secParts(mk.sec)}</div>
          <div class="option-grid">
            <div><span>Weight</span><b>${f(x.Wt, 1)} plf</b></div><div><span>Depth</span><b>${mk.sec.d}"</b></div><div title="The bottom of the beam at midspan under the total load: A − slab − seat − depth − ${f(mk.check.defl.TL, 2)}&quot; sag"><span>Under beam, mid</span><b class="${flags.some(t => / < C /.test(t)) ? 'bad' : ''}">${under != null ? ft(under) : '—'}</b></div>
            <div><span>Combined</span><b class="${x.CSR <= tg ? 'ok' : 'bad'}">${f(x.CSR, 3)}</b></div><div><span>Shear</span><b class="${x.SRvx <= tg ? 'ok' : 'bad'}">${f(x.SRvx, 3)}</b></div><div><span>Live defl.</span><b class="${c.llOK ? 'ok' : 'bad'}">L/${f(c.defl.rLL, 0)}</b></div>
          </div>
          <ul class="option-why"><li><b>Picked by hand</b> — ${mk.optionKey === 'custom' ? 'chosen from the depth table or Design your own' : 'the engineer\u2019s section'}; Beam calc runs it on the MB sheet. "Use this" on an option puts the tool's answer back.</li></ul>
          <div class="option-actions"><span class="chosen-pill">In the quote</span><button class="btn-ghost" data-go="beam">Calc</button></div>
        </article>`;
      };
      return `<div class="mark-block"><p class="mark-label"><i class="mk-dot" style="background:${mkHex(mk)}"></i><b>${mkName(mk)}</b> · ${mk.qtyAll} beam${mk.qtyAll > 1 ? 's' : ''}${where ? ' (' + where + ')' : ''} · designed ${mkDims(mk)} trib${short ? ' · ' + short + ', same section' : ''}</p><div class="options ${one && !handCard() ? 'is-one' : ''}">${handCard()}${groups.map(card).join('')}</div>${oneTxt}</div>`;
    }).join('');
    $$('#options [data-opt]').forEach(b => { b.onclick = () => pickOption(b.dataset.mark, b.dataset.opt); });
  }
  // ---------- a mark with no passing section: one decision, asked the way the values the PCS leaves open are ----------
  // It says what stops it (the clear height, as a rule) and puts both ways forward on the card with their inputs:
  // set the beams back at the wall columns (the girts: 1'-4" at a rigid frame, 1'-0" at a post-and-beam frame), or
  // a new clear height. run.js works out each option (m.rescue); nothing is applied until it is picked.
  const decideMarks = () => (state.job ? jobMarks() : []).filter(m => !m.sec && m.rescue);
  // the clear-height result of a mark at the span as it is (no setback added), and with the setback added — run.js gives
  // the second (and the first as .grid) only when the setback is offered and not enough on its own
  const clearNow = m => { const c = m.rescue.clear; return c ? c.grid || c : null; };
  const clearSb = m => { const c = m.rescue.clear; return c && c.grid ? c : null; };
  const inpOfMark = mk => inputsOf((mk.mezzIds || [state.mi])[0]);
  // the needs of several marks, per mezzanine: the strictest C and A of each
  function needBy(list) {
    const by = new Map();
    list.forEach(q => { if (q && !q.none) (q.per || []).forEach(p => { const e = by.get(p.mi), up = !e || q.needIn > e.need; by.set(p.mi, e ? { ...e, needC: Math.min(e.needC, p.needC), needA: Math.max(e.needA, p.needA), d: up ? q.d : e.d, dTL: up ? q.dTL : e.dTL, need: up ? q.needIn : e.need } : { ...p, d: q.d, dTL: q.dTL, need: q.needIn }); }); });
    return [...by.values()];
  }
  const oneVal = (xs, k) => { const v = [...new Set(xs.map(x => +x[k].toFixed(4)))]; return v.length === 1 ? ft(v[0]) : xs.map(x => `${esc(x.id)} ${ft(x[k])}`).join(', '); };
  // inches as the drawings write them: 14", 2 1/2", 17 1/2"
  const inch = x => { const r = Math.round(x * 8) / 8, w = Math.floor(r + 1e-9), fr = Math.round((r - w) * 8), F = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'][fr]; return `${w || !F ? w : ''}${F ? (w ? ' ' : '') + F : ''}"`; };
  // the room for the beam at a joist seat (in): the least over the mezzanines of a clear-height result
  const roomAt = (q, seatIn) => Math.min(...(q.per || []).map(p => (p.A - p.C) * 12 - p.slabIn - (seatIn ?? p.seatIn)));
  function decideCard(ms, id = 'decideCard') {
    if (!ms.length) return '';
    const s = state.settings, names = ms.map(m => m.mark).join(' and ');
    const now = clearNow, withSb = clearSb;
    const caps = ms.map(m => m.rescue.cap).filter(v => v != null), cap = caps.length ? Math.min(...caps) : null;
    const cl0 = ms.map(m => m.rescue.clear).find(Boolean), g = inpOfMark(ms[0]).geom;
    const cause = cap == null ? 'range' : cap < s.dMin ? 'min' : 'clear';
    const needD = m => { const q = now(m); return q && !q.none ? q.d : null; };
    const needIn = m => { const q = now(m); return q && !q.none ? q.needIn : null; };   // depth + total-load sag
    const in2 = x => `${(+x).toFixed(2)}"`;
    // what stops it, in a line
    const eyebrow = { clear: 'Clear height not met', min: 'Clear height below the minimum beam depth', range: 'No beam section in the depth range' }[cause];
    // the room for the beam, term by term: the top of the mezzanine less the clear height under the beams, the slab and
    // deck, and the joist seat — and what the beam takes of it: its depth plus its sag under the total load (the MB
    // sheet's TOTAL LOAD max deflection), so the bottom of the beam at midspan stays at or above C
    const st = cl0 && cl0.stack, room = st ? st.room : cap;
    const needTxt = m => (needIn(m) ? in2(needIn(m)) : `more than ${s.dMax}"`);
    const h3 = cause === 'range' ? `${names}: no section up to ${s.dMax}" deep`
      : `${ms.length === 1 ? `${names} needs ${needTxt(ms[0])}` : ms.map(m => `${m.mark} needs ${needTxt(m)}`).join(', ')} — there is ${inch(room)} of room`;
    const SRC = { manual: 'typed', pcs: 'from the PCS', annotation: 'blue note', default: 'default', estimate: 'estimate' };
    const seatSrc = st ? (inputsOf(st.mi).geom.seat || {}).source : null;
    const others = st ? [...new Map(ms.flatMap(m => (m.rescue.clear && m.rescue.clear.per) || []).filter(p => p.mi !== st.mi).map(p => [p.mi, p])).values()].filter(p => Math.abs(roomAt({ per: [p] }) - st.room) > 1e-6) : [];
    const stackHtml = cause === 'range' || !st ? '' : `<div class="dc-stack" aria-label="Room for the beam">
        <span class="dc-t"><b>${ft(st.A)}</b><small>top of mezzanine (A)</small></span><i>−</i>
        <span class="dc-t"><b>${ft(st.C)}</b><small>clear under the beams (C)</small></span><i class="dc-mid">= ${inch((st.A - st.C) * 12)}</i><i>−</i>
        <span class="dc-t"><b>${inch(st.slabIn)}</b><small>slab &amp; deck</small></span><i>−</i>
        <span class="dc-t dc-seat"><b>${inch(st.seatIn)}</b><small>joist seat${SRC[seatSrc] ? ' · ' + SRC[seatSrc] : ''}</small></span><i>=</i>
        <span class="dc-t dc-room"><b>${inch(st.room)}</b><small>room for the beam${manyMezz() ? ' · ' + esc(st.id) : ''}</small></span>
        ${others.length ? `<span class="dc-others">${others.map(p => `${esc(p.id)}: ${inch(roomAt({ per: [p] }))} of room`).join(' · ')}</span>` : ''}</div>
      ${ms.filter(m => needIn(m)).map(m => { const q = now(m); return `<div class="dc-stack dc-needs" aria-label="What ${m.mark} needs">
        <span class="dc-t"><b>${q.d}"</b><small>${m.mark} · ${esc(q.best.desc)}, the least room of any that works</small></span><i>+</i>
        <span class="dc-t"><b>${in2(q.dTL)}</b><small>sag under the total load</small></span><i>=</i>
        <span class="dc-t dc-room"><b>${in2(q.needIn)}</b><small>room it needs</small></span></div>`; }).join('')}`;
    const why = cause === 'range' ? `${ms.map(m => `${m.mark}: ${m.qtyAll} beam${m.qtyAll > 1 ? 's' : ''}, ${ft(mkDz(m).span)} × ${ft(mkDz(m).trib)} trib`).join('; ')}. Nothing stocked passes at that span and trib within the ${s.dMin}"–${s.dMax}" range (Settings).`
      : `${ms.map(m => `${m.mark}: ${m.qtyAll} beam${m.qtyAll > 1 ? 's' : ''}, ${ft(mkDz(m).span)} × ${ft(mkDz(m).trib)} trib`).join('; ')}. The beam has to fit in the room with its sag, so its bottom at midspan stays at or above C. Pick a way below — the design runs as soon as you do.`;
    // 1 · the setback at the wall columns
    const offer = ms.filter(m => m.rescue.setback.state === 'offer'), applied = ms.filter(m => m.rescue.setback.state === 'applied');
    const also = jobMarks().filter(o => !ms.includes(o) && o.design && o.design.sbSpan < o.span - 1e-6 && !o.design.setback);
    const endsTxt = m => { const by = new Map(); (m.rescue.setback.ends || []).forEach(e => { const k = `${e.wall}|${e.kind}`; if (!by.has(k)) by.set(k, { e, mz: new Map() }); const b = by.get(k); if (!b.mz.has(e.mezz)) b.mz.set(e.mezz, []); if (!b.mz.get(e.mezz).includes(e.label)) b.mz.get(e.mezz).push(e.label); });
      return [...by.values()].map(({ e, mz }) => { const n = [...mz.values()].flat().length; return `${e.wall} column${n > 1 ? 's' : ''} ${[...mz].map(([m2, ls]) => ls.join(', ') + (manyMezz() ? ` (${m2})` : '')).join('; ')} — ${e.kind === 'rigid' ? 'rigid frame' : /soldier/.test(e.why) ? 'soldier column' : 'post-and-beam'}, ${ft(e.ft)}`; }).join(' · '); };
    const kinds = [...new Set(offer.concat(applied).flatMap(m => (m.rescue.setback.ends || []).map(e => e.kind)))];
    const amtIn = k => `<label class="dc-amt"><span>${k === 'rigid' ? 'rigid frame' : 'post-and-beam'}</span><input data-sbamt="${k === 'rigid' ? 'setbackRigid' : 'setbackPB'}" value="${esc(ft(k === 'rigid' ? s.setbackRigid : s.setbackPB))}" spellcheck="false" autocomplete="off"></label>`;
    const res = m => { const sb = m.rescue.setback; return sb.best ? `<span class="dc-ok">${m.mark} ${ft(sb.from)} → ${ft(sb.span)}: ${esc(sb.best.desc)} fits, ${sb.best.d}" + ${in2(sb.best.dTL)} sag = ${in2(sb.best.need)}</span>` : `<span class="dc-no">${m.mark} ${ft(sb.from)} → ${ft(sb.span)}: still needs ${withSb(m) && !withSb(m).none ? in2(withSb(m).needIn) : 'more depth'}</span>`; };
    const row1 = offer.length
      ? `<div class="need-row dc-row"><label>Set the beams back at the wall columns<small>${offer.map(m => `${m.mark} ends at the ${esc(endsTxt(m))}`).join(' · ')}. The girts hold those columns in from the grid line, so the beam is that much shorter.</small></label>
          <div class="dc-in">${kinds.map(amtIn).join('')}</div>
          <div class="chips"><button class="chip chip-go" data-dc="setback">Use the setback<small>${offer.map(m => `${m.mark} at ${ft(m.rescue.setback.span)}`).concat(also.map(o => `${o.mark} at ${ft(o.design.sbSpan)}`)).join(' · ')}</small></button><div class="dc-res">${offer.map(res).join('')}</div></div></div>`
      : applied.length
        ? `<div class="need-row dc-row"><label>Beams set back at the wall columns<small>${applied.map(m => `${m.mark} at ${ft(m.rescue.setback.span)} (${esc(endsTxt(m))})`).join(' · ')} — in use, and not enough on its own.</small></label>
            <div class="dc-in">${kinds.map(amtIn).join('')}</div><div class="chips"><button class="chip" data-dc="unsetback">Undo the setback</button></div></div>`
        : `<div class="need-row dc-row is-na"><label>Set the beams back at the wall columns<small>${ms.map(m => m.rescue.setback.state === 'typed' ? `${m.mark}: a design span typed on Beam calc (${ft(mkDz(m).span)}) is already shorter` : `${m.mark}: its longest beams do not end at a wall column (mezzanine or interior columns, or along a wall) — no setback`).join(' · ')}.</small></label><div></div><div></div></div>`;
    // 2 · the clear height (or, with no clearance limit, a shorter span)
    let row2;
    if (cause === 'range') {
      const sh = ms.find(m => m.splitHelps);
      row2 = `<div class="need-row dc-row"><label>Shorten the span or the trib<small>Put a column back under the long beams, or add a beam line, on the Plan page${sh ? `; or give the ${ft(sh.splitHelps.span)} beam its own mark — the rest pass (${esc(sh.splitHelps.restDesc)})` : ''}.</small></label><div></div>
        <div class="chips"><button class="chip" data-dc="plan">Edit the layout<small>Plan page</small></button>${sh ? `<button class="chip" data-dc="own" data-mark="${sh.mark}">Own mark for the ${ft(sh.splitHelps.span)} beam</button>` : ''}</div></div>`;
    } else {
      const fixed = m => m.rescue.setback.state === 'offer' && m.rescue.setback.best;
      const plain = needBy(ms.map(now)), both = offer.length && ms.some(m => !fixed(m)) ? needBy(ms.filter(m => !fixed(m)).map(m => withSb(m) || now(m))) : [];
      const none = !plain.length && !both.length;
      const chip = (q, sb, label) => `<button class="chip" data-dc="setC" data-sb="${sb ? 1 : 0}" data-v='${esc(JSON.stringify(q.map(x => [x.mi, x.needC])))}'>${label}<small>clear ${oneVal(q, 'needC')}</small></button>`;
      const primary = both.length ? both : plain, top = q => q.reduce((a, x) => (x.need > a.need ? x : a)), dOf = q => top(q).d;
      const sagTxt = q => `${top(q).d}" deep, sags ${in2(top(q).dTL)} under the total load — ${in2(top(q).need)} with its sag`;
      // how much less clear height (or how much higher a floor) the beam needs, when it is the same on every mezzanine
      const by = (q, k) => { const v = [...new Set(q.map(x => +((k === 'needC' ? x.C - x.needC : x.needA - x.A) * 12).toFixed(3)))]; return v.length === 1 ? inch(v[0]) : null; };
      const less = q => (by(q, 'needC') ? ` — ${by(q, 'needC')} less than the ${ft(cl0.C)} the PCS asks` : '');
      row2 = none ? `<div class="need-row dc-row is-na"><label>Make room for a deeper beam<small>No stocked section passes up to ${s.dMax}" deep either — shorten the span or the trib (Plan page).</small></label><div></div><div class="chips"><button class="chip" data-dc="plan">Edit the layout<small>Plan page</small></button></div></div>`
        : `<div class="need-row dc-row"><label>Make room for a deeper beam<small>${both.length ? `With the setback the beam is ${sagTxt(both)}: it fits with ${oneVal(both, 'needC')} clear under the beams${less(both)}${plain.length ? `; without the setback, ${sagTxt(plain)}, it needs ${oneVal(plain, 'needC')}` : ''}.` : `The beam is ${sagTxt(plain)}: it fits with ${oneVal(plain, 'needC')} clear under the beams${less(plain)} — or with the floor ${by(plain, 'needA') || 'raised'}${by(plain, 'needA') ? ' higher' : ''}.`} Ask the estimator, then type the clear height they give.</small></label>
          <input data-dc="C" placeholder="clear, e.g. ${esc(ft(primary[0].needC))}" aria-label="New clear height under the beams" autocomplete="off">
          <div class="chips">${both.length ? chip(both, true, `${dOf(both)}" beam + setback`) + (plain.length ? chip(plain, false, `${dOf(plain)}" beam`) : '') : chip(plain, false, `Use the ${dOf(plain)}" beam`)}<button class="chip" data-dc="setA" data-sb="${both.length ? 1 : 0}" data-v='${esc(JSON.stringify(primary.map(x => [x.mi, x.needA])))}'>Raise the floor to ${oneVal(primary, 'needA')}<small>keeps ${ft(cl0.C)} clear</small></button><button class="chip" data-dc="copy">Copy request<small>for the estimator</small></button></div></div>`;
    }
    // 3 · the joist seat: the room for the beam is measured down from the joist seat, so a shallower seat (when the joists
    // allow it) gives the beam that much more room — the standard seats, what each leaves and whether the beam then fits
    let row3 = '';
    if (cause !== 'range' && st && ms.some(m => needIn(m))) {
      const fit = seatIn => ms.every(m => needIn(m) && roomAt(now(m), seatIn) + 1e-3 >= needIn(m));
      // or with the setback: every mark the setback alone does, or whose set-back beam then fits
      const fitSb = seatIn => offer.length > 0 && ms.every(m => { const sb = m.rescue.setback; if (sb.state === 'offer' && sb.best) return true; const q = withSb(m) || now(m); return q && !q.none && roomAt(q, seatIn) + 1e-3 >= q.needIn; });
      const std = [[2.5, 'K-series'], [5, 'LH-series']].filter(([v]) => v < st.seatIn - 1e-6);
      const seatChip = ([v, series]) => { const r = (st.A - st.C) * 12 - st.slabIn - v, ok = fit(v), okSb = !ok && fitSb(v); return `<button class="chip${ok || okSb ? ' chip-fit' : ''}" data-dc="seat" data-v="${v / 12}">${inch(v)} seat · ${series}<small>${inch(r)} of room — ${ok ? `the ${Math.max(...ms.map(needD).filter(Boolean))}" beam fits with its sag` : okSb ? 'enough with the setback' : 'still short'}</small></button>`; };
      row3 = std.length
        ? `<div class="need-row dc-row"><label>Check the joist seat<small>The room is measured down from the joist seat, ${inch(st.seatIn)} here${SRC[seatSrc] ? ` (${SRC[seatSrc]})` : ''}. K-series joists sit on a 2 1/2" seat and LH-series on 5"; if the joists on this job have a shallower seat, the beam gets that much more room.</small></label>
            <input data-dc="seatIn" placeholder="seat, e.g. ${std[std.length - 1][0]}&quot;" aria-label="Joist seat depth" autocomplete="off">
            <div class="chips">${std.slice().reverse().map(seatChip).join('')}</div></div>`
        : `<div class="need-row dc-row is-na"><label>Check the joist seat<small>The joist seat is ${inch(st.seatIn)} — the shallowest standard seat (K-series), so it gives no more room.</small></label><div></div><div></div></div>`;
    }
    const sh = cause !== 'range' ? ms.find(m => m.splitHelps) : null;
    const foot = `${sh ? `<span>${sh.mark}'s ${ft(sh.splitHelps.span)} beam${sh.splitHelps.n > 1 ? 's set' : ' sets'} it; the other ${sh.splitHelps.rest} pass on their own (${esc(sh.splitHelps.restDesc)}). <button class="chip" data-dc="own" data-mark="${sh.mark}">Own mark for the ${ft(sh.splitHelps.span)} beam${sh.splitHelps.n > 1 ? 's' : ''}</button></span>` : ''}<span>Other ways: put a column back or add a beam line on the Plan page, or pick a section by hand (Design your own). ${ms.length === 1 ? `Beam calc shows ${ms[0].mark} at every depth.` : 'Beam calc shows each mark at every depth.'}</span>`;
    return `<section class="need decide" id="${id}"><div class="need-head"><div><div class="eyebrow">${eyebrow}</div><h3>${h3}</h3></div><p>${why}</p></div>
      ${stackHtml}<div class="need-rows">${row1}${row2}${row3}</div><div class="need-foot dc-foot">${foot}</div></section>`;
  }
  // the request for the estimator, from the card's numbers: a short note in plain words — what is tight, by how much,
  // and the two things that would fix it
  function decideRequest(ms) {
    const fixed = m => m.rescue.setback.state === 'offer' && m.rescue.setback.best;
    const offer = ms.some(m => m.rescue.setback.state === 'offer'), useSb = offer && ms.some(m => !fixed(m));
    const q = m => (useSb && !fixed(m) ? m.rescue.clear : clearNow(m));
    const list = ms.filter(m => !(useSb && fixed(m)) && q(m) && !q(m).none), by = needBy(list.map(q)), st = ms.map(m => m.rescue.clear).find(Boolean).stack, job = state.inputs.job;
    if (!list.length || !st) return `${job.quote ? job.quote + ': ' : ''}the mezzanine beams need more depth than the clear height under them leaves — the span or the trib has to come down (Plan page).`;
    const name = i => { const id = inputsOf(i).mezz.id; return !id ? 'Mezzanine ' + (i + 1) : /^\d+$/.test(id) ? 'Mezzanine ' + id : id; };
    const mz = [...new Set(ms.flatMap(m => (m.mezzIds || []).map(name)))].join(' and ');
    const deep = list.reduce((a, m) => (q(m).needIn > q(a).needIn ? m : a), list[0]), d = q(deep).d, sag = q(deep).dTL, needR = q(deep).needIn;
    const sbDeep = useSb && deep.rescue.setback.state === 'offer', sbIn = deep.rescue.setback.state === 'applied';
    const span = ft(sbDeep ? deep.rescue.setback.span : mkDz(deep).span), several = list.length > 1;
    // the same change on every mezzanine reads as one value; otherwise each mezzanine's own
    const ask = (k, verb, word) => { const v = [...new Set(by.map(x => +x[k].toFixed(4)))], dv = [...new Set(by.map(x => +((k === 'needC' ? x.C - x.needC : x.needA - x.A) * 12).toFixed(3)))];
      return v.length === 1 ? `${verb} to ${ft(v[0])}${dv.length === 1 ? ` (${inch(dv[0])} ${word})` : ''}` : `${verb}: ${by.map(x => `${name(x.mi)} to ${ft(x[k])}`).join(', ')}`; };
    const sagTxt = `the beam that needs the least room is ${d}" deep and sags ${sag.toFixed(2)}" under the full load, so it needs ${needR.toFixed(2)}"`;
    const beams = sbDeep ? `Even with the beams shortened to a ${span} span at the wall columns, ${sagTxt}.` : sbIn ? `With the beams already set back at the wall columns (a ${span} span), ${sagTxt}.` : `The beams span ${several ? 'up to ' : ''}${span}; ${sagTxt}.`;
    return [
      'Hi,',
      '',
      `On ${job.quote || 'this job'}${mz ? ` (${mz})` : ''}, the mezzanine beams need a little more depth than the current clear height allows.`,
      '',
      `With the top of the mezzanine at ${ft(st.A)} and ${ft(st.C)} clear under the beams, there is ${inch(st.room)} left for the beam once the ${inch(st.slabIn)} slab and the ${inch(st.seatIn)} joist seat are taken out. ${beams}`,
      '',
      'Could we do one of the following?',
      `  - ${ask('needC', 'Lower the clear height under the beams', 'less')}, or`,
      `  - ${ask('needA', 'Raise the top of the mezzanine', 'higher')}.`,
      '',
      `Either one lets us use a ${d}" beam. Let me know which works best for the customer and I'll finish the design.`,
      '',
      'Thanks,',
    ].join('\n');
  }
  function wireDecide(root, ms) {
    if (!root) return;
    const applySetback = list => list.forEach(m => { const { span, ...rest } = (state.settings.markInput || {})[m.mark] || {}; setMarkInput(m.mark, { ...rest, setback: true }); });
    const sbMarks = () => [...ms.filter(m => m.rescue.setback.state === 'offer'), ...jobMarks().filter(o => !ms.includes(o) && o.design && o.design.sbSpan < o.span - 1e-6 && !o.design.setback)];
    const after = what => { const out = jobMarks().map(o => `${o.mark} ${o.desc || 'no section yet'}`).join(' · '); toast(`${what} → ${out}`); };
    const seatMis = () => [...new Set(ms.flatMap(m => ((m.rescue.clear && m.rescue.clear.per) || []).map(p => p.mi)))];
    root.querySelectorAll('[data-dc]').forEach(el => {
      const k = el.dataset.dc;
      if (el.tagName === 'INPUT') {
        // the clear height C (ft-in), or the joist seat (in) — on the mezzanines the marks are in
        const seat = k === 'seatIn';
        el.onchange = () => { if (el.dataset.used) return; const v = parseKind(seat ? 'in' : 'ftin', el.value);
          if (v == null || !(seat ? v >= 0 && v < 2 : v > 0)) { toast(`Could not read "${el.value}" — e.g. ${seat ? '5"' : `9'-5"`}`); return; }
          el.dataset.used = '1';
          seatMis().forEach(i => { inputsOf(i).geom[seat ? 'seat' : 'C'] = { value: v, source: 'manual' }; }); recompute(); after(seat ? `Joist seat ${inch(v * 12)}` : `C ${ft(v)}`); };
        el.onkeydown = e => { if (e.key === 'Enter') el.blur(); };
        return;
      }
      el.onclick = () => {
        if (k === 'setback') { applySetback(sbMarks()); recompute(); after('Beams set back at the wall columns'); }
        else if (k === 'unsetback') { ms.forEach(m => { const { setback, ...rest } = (state.settings.markInput || {})[m.mark] || {}; setMarkInput(m.mark, Object.keys(rest).length ? rest : null); }); recompute(); toast('Setback taken off'); }
        else if (k === 'setC' || k === 'setA') {
          const vals = JSON.parse(el.dataset.v), key = k === 'setC' ? 'C' : 'A';
          vals.forEach(([mi, v]) => { inputsOf(mi).geom[key] = { value: v, source: 'manual' }; });
          if (el.dataset.sb === '1') applySetback(ms.filter(m => m.rescue.setback.state === 'offer'));
          recompute(); after(`${key} ${[...new Set(vals.map(x => ft(x[1])))].join(' / ')}${el.dataset.sb === '1' ? ' + setback' : ''} (Inputs page) — confirm it with the estimator`);
        }
        else if (k === 'seat') { const v = +el.dataset.v; seatMis().forEach(i => { inputsOf(i).geom.seat = { value: v, source: 'manual' }; }); recompute(); after(`Joist seat ${inch(v * 12)}`); }
        else if (k === 'copy') copyText(decideRequest(ms), 'Request copied — paste it into your note to the estimator');
        else if (k === 'plan') { go('plan'); if (!state.planEdit) { const b = $('#layEdit'); if (b) b.click(); } }
        else if (k === 'own') { const m = ms.find(x => x.mark === el.dataset.mark), v = +m.splitHelps.span.toFixed(4); allSettings().forEach(st => { st.ownSpan = [...new Set([...(st.ownSpan || []), v])]; }); recompute(); after(`The ${ft(m.splitHelps.span)} beam on its own mark`); }
      };
    });
    root.querySelectorAll('[data-sbamt]').forEach(inp => {
      inp.onchange = () => {
        if (inp.dataset.used) return;
        // 1'-4", 1' 4", 16" or 1.333 (ft)
        const raw = inp.value.trim(), v = raw === '' ? null : PCS.ftin(raw.replace(/'\s+(?=\d)/, "'-")) ?? (/^\d*\.?\d+$/.test(raw) ? +raw : null);
        if (v == null || !(v >= 0) || v > 5) { toast(`${raw} is not a setback — e.g. 1'-4"`); inp.value = ft(state.settings[inp.dataset.sbamt]); return; }
        inp.dataset.used = '1';
        allSettings().forEach(st => { st[inp.dataset.sbamt] = v; });
        recompute(); toast(`Setback at a ${inp.dataset.sbamt === 'setbackRigid' ? 'rigid frame' : 'post-and-beam'} column: ${ft(v)}`);
      };
      inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
    });
  }
  // a mark is one member over the job, so its pick goes into every mezzanine's settings
  const setOverride = (mark, ov) => allSettings().forEach(st => { st.override = { ...(st.override || {}), [mark]: ov }; });
  function pickOption(mark, key) {
    const mk = jobMarks().find(m => m.mark === mark), o = mk.options.find(x => x.key === key);
    setOverride(mark, { key });
    recompute(); toast(`${mark} → ${o.pick.desc} (${o.label.toLowerCase()})`);
  }
  function pickDepth(mark, d) {
    const mk = jobMarks().find(m => m.mark === mark), a = mk.search.byDepth.find(z => String(z.d) === String(d));
    setOverride(mark, { d: +d });
    recompute(); toast(`${mark} → ${a.desc} (lightest at ${d}")`);
  }

  // ---------- 3D framing model ----------
  let model = null;
  // the whole job in one scene: every mezzanine at its own elevation, beams in their mark's colour (interior / exterior)
  // with a mark tag at mid-span, every column once (numbered over the job), the building columns beams frame into
  function buildScene(opt = {}) {
    const r = state.res, g = r.grid, ms = jobView(), many = ms.length > 1, cno = colNos();
    const NG = opt.calm ? '#f6c779' : '#ff6b6b';   // no section yet: red on the Design page, amber while the decision is open
    const members = [], labels = [], floor = [];
    let Atop = 0;
    ms.forEach(m => {
      const inp = inpOf(m), lay = m.layout, fp = lay.footprint, pre = many ? m.id + ' ' : '';
      const A = inp.geom.A.value ?? 12, slab = (inp.geom.slab.value || 4 / 12), seat = (inp.geom.seat.value || 2.5 / 12);
      const zDeck = A - slab, zTop = zDeck - seat, J = m.joistDepthIn != null && m.joistDepthIn > 0 ? m.joistDepthIn / 12 : 1.33;
      const alongX = lay.joists === 'y';
      Atop = Math.max(Atop, A);
      // beams: I-shapes (top flange, web, bottom flange) — web drawn at least 0.9" so it reads; an edge carried by a
      // neighbour's beam is that beam, drawn once by its owner
      lay.beams.filter(bm => !bm.absorbed).forEach(bm => {
        const mk = mkOf(m, bm.id), sec0 = mk && mk.sec;
        // no section: drawn at a nominal 18" × 6" in red, see-through, so the floor has no gap and the beam still selects
        const sec = sec0 || { d: 18, tw: 0.25, bof: 6, tof: 0.375, bif: 6, tif: 0.375 }, ng = !sec0;
        const d = sec.d / 12, bf = sec.bof / 12, tf = sec.tof / 12, bi = sec.bif / 12, ti = sec.tif / 12, tw = Math.max(sec.tw, 0.9) / 12;
        const box = (a0, a1, w, z0, z1) => (alongX ? { x0: a0, x1: a1, y0: bm.line - w / 2, y1: bm.line + w / 2, z0, z1 } : { x0: bm.line - w / 2, x1: bm.line + w / 2, y0: a0, y1: a1, z0, z1 });
        members.push({ id: pre + bNo(m, bm.id), kind: 'beam', color: ng ? NG : mkHex(mk), ...(ng ? { alpha: 0.45 } : {}), boxes: [box(bm.from, bm.to, bf, zTop - tf, zTop), box(bm.from, bm.to, tw, zTop - d + ti, zTop - tf), box(bm.from, bm.to, bi, zTop - d, zTop - d + ti)], ref: { type: 'beam', m, b: bm, mk } });
      });
      // one tag per run of beams of one mark on one line (not one per beam), at the middle of the run
      const runs = [];
      lay.beams.filter(bm => !bm.absorbed).slice().sort((a2, b2) => a2.line - b2.line || a2.from - b2.from).forEach(bm => {
        const mk = mkOf(m, bm.id), last = runs[runs.length - 1];
        if (!mk) return;   // a mark with no section is tagged too (red, see-through beam)
        if (last && last.mk === mk && Math.abs(last.line - bm.line) < 1e-6 && Math.abs(last.to - bm.from) < 0.05) last.to = bm.to; else runs.push({ mk, line: bm.line, from: bm.from, to: bm.to });
      });
      runs.forEach(rn => { const mid = (rn.from + rn.to) / 2; labels.push({ p: alongX ? [mid, rn.line, zTop + 0.2] : [rn.line, mid, zTop + 0.2], text: rn.mk.mark + (rn.mk.kind ? ' ' + rn.mk.kind.slice(0, 3).toUpperCase() : '') + (rn.mk.sec ? '' : ' · NO SECTION'), kind: 'tag', color: mkHex(rn.mk) }); });
      // mezzanine columns: W shape, web parallel to the beam web, from the floor to the underside of the beam
      const cf = m.colFinal, w = cf ? cf.props : null, dBeam = Math.max(0, ...m.marks.filter(q => q.sec).map(q => q.sec.d)) / 12;
      lay.mezzCols.forEach(c => {
        const cd = (w ? w.d : 10) / 12, cb = (w ? w.bf : 6) / 12, ctf = Math.max(w ? w.tf : 0.4, 0.5) / 12, ctw = Math.max(w ? w.tw : 0.25, 0.9) / 12, zc = zTop - dBeam;
        const bx = (dx0, dx1, dy0, dy1, z0, z1) => (alongX ? { x0: c.x + dx0, x1: c.x + dx1, y0: c.y + dy0, y1: c.y + dy1, z0, z1 } : { x0: c.x + dy0, x1: c.x + dy1, y0: c.y + dx0, y1: c.y + dx1, z0, z1 });
        const unsz = !cf || (cf.unsized || []).includes(c.label);   // not sized: red and see-through, like a beam with no section
        members.push({ id: 'C' + cno.get(c.label), kind: 'col', color: unsz ? NG : '#ff9f7a', ...(unsz ? { alpha: 0.45 } : {}), boxes: [
          bx(-cd / 2, -cd / 2 + ctf, -cb / 2, cb / 2, 0, zc), bx(cd / 2 - ctf, cd / 2, -cb / 2, cb / 2, 0, zc), bx(-cd / 2 + ctf, cd / 2 - ctf, -ctw / 2, ctw / 2, 0, zc),
          bx(-cd / 2 - 0.12, cd / 2 + 0.12, -cb / 2 - 0.12, cb / 2 + 0.12, zc - 0.06, zc), bx(-cd / 2 - 0.25, cd / 2 + 0.25, -cb / 2 - 0.25, cb / 2 + 0.25, 0, 0.07),
        ], ref: { type: 'col', m, c, no: cno.get(c.label) } });
      });
      // joists: open-web lines between beam lines at the joist spacing
      const sp = m.beamBase.Lb;
      if (sp > 0) {
        const a0 = alongX ? fp.x0 : fp.y0, a1 = alongX ? fp.x1 : fp.y1;
        let k = 0;
        for (let t = a0; t <= a1 + 1e-6; t += sp) {
          lay.beamLines.slice(1).forEach((l1, i) => {
            const l0 = lay.beamLines[i], lines = [], P = (u, z) => (alongX ? [t, u, z] : [u, t, z]);
            const b0 = l0 + 0.5, b1 = l1 - 0.5;
            lines.push([P(l0, zDeck), P(l1, zDeck)], [P(b0, zDeck - J), P(b1, zDeck - J)]);
            const n = Math.max(2, Math.round((b1 - b0) / 2.2));
            for (let q = 0; q < n; q++) { const t0 = b0 + (b1 - b0) * q / n, t1 = b0 + (b1 - b0) * (q + 0.5) / n, t2 = b0 + (b1 - b0) * (q + 1) / n; lines.push([P(t0, zDeck - J), P(t1, zDeck)], [P(t1, zDeck), P(t2, zDeck - J)]); }
            lines.push([P(l0, zDeck), P(b0, zDeck - J)], [P(l1, zDeck), P(b1, zDeck - J)]);
            members.push({ id: pre + 'J' + (++k), kind: 'joist', color: '#a9cbe0', alpha: 0.55, width: 1, lines, ref: { type: 'joist' } });
          });
        }
      }
      // slab (translucent), footprint on the floor, the mezzanine's name
      members.push({ id: pre + 'slab', kind: 'slab', color: '#8fd3ff', alpha: 0.09, boxes: [{ x0: fp.x0, x1: fp.x1, y0: fp.y0, y1: fp.y1, z0: zDeck, z1: A }] });
      [[fp.x0, fp.y0], [fp.x1, fp.y0], [fp.x1, fp.y1], [fp.x0, fp.y1]].forEach((p, i, arr) => { const q = arr[(i + 1) % 4]; floor.push([[p[0], p[1], 0], [q[0], q[1], 0], 'rgba(105,250,197,.45)', false]); });
      if (many) labels.push({ p: [(fp.x0 + fp.x1) / 2, (fp.y0 + fp.y1) / 2, 0], text: m.id, kind: 'text', color: '#9fe9cf' });
      if (m === r || !many) {
        labels.push({ p: [fp.x1, fp.y0, A], text: `T/slab ${ft(A)}`, kind: 'text', color: '#9fe9cf', dy: -8 });
        labels.push({ p: [fp.x1, fp.y0, zTop], text: `T/beam ${ft(zTop)}`, kind: 'text', color: '#8fc0dc', dy: 8 });
      }
    });
    // building columns the beams frame into (stubs to just above the mezzanine), once each
    bldgCols().forEach(sp => members.push({ id: 'BC ' + sp.label, kind: 'bcol', color: '#6f89a3', boxes: [{ x0: sp.x - 0.33, x1: sp.x + 0.33, y0: sp.y - 0.33, y1: sp.y + 0.33, z0: 0, z1: Atop + 2.5 }], ref: { type: 'bcol', sp } }));
    // floor: grid lines + bubbles around every mezzanine
    const u = { x0: Math.min(...ms.map(m => m.layout.footprint.x0)), x1: Math.max(...ms.map(m => m.layout.footprint.x1)), y0: Math.min(...ms.map(m => m.layout.footprint.y0)), y1: Math.max(...ms.map(m => m.layout.footprint.y1)) };
    const pad = 6, xLo = u.x0 - pad, xHi = u.x1 + pad, yLo = u.y0 - pad, yHi = u.y1 + pad;
    // an attached building beside a sidewall: its own frame numbers on its side, its own letters on its lines (as on the plan)
    const att3 = [...new Map(ms.filter(m => m.layout.mapped && m._own).map(m => [m.bkey, m])).values()];
    const aBot = att3.find(m => m.layout.bldg.y0 < -0.05), aTop = att3.find(m => m.layout.bldg.y1 > g.width + 0.05);
    const hostXY = aBot && !aTop ? yHi + 2.2 : yLo - 2.2;
    g.xs.filter(x => x >= xLo - 1e-6 && x <= xHi + 1e-6).forEach(x => { floor.push([[x, yLo, 0], [x, yHi, 0], 'rgba(140,200,235,.22)', true]); labels.push({ p: [x, hostXY, 0], text: g.xLabel(x), kind: 'bubble' }); });
    [[aBot, yLo - 2.2], [aTop, yHi + 2.2]].forEach(([m, yb]) => { if (!m) return; const own = m._own;
      own.grid.xs.forEach(v => { const x = m._map.X(v); if (x >= xLo - 1e-6 && x <= xHi + 1e-6 && own.grid.xLabel(v)) labels.push({ p: [x, yb, 0], text: own.grid.xLabel(v), kind: 'bubble' }); }); });
    const colY = [...new Set([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()])];
    colY.filter(y => y >= yLo - 1e-6 && y <= yHi + 1e-6).forEach(y => { floor.push([[xLo, y, 0], [xHi, y, 0], 'rgba(140,200,235,.22)', true]); labels.push({ p: [xLo - 2.2, y, 0], text: g.yLabel(y), kind: 'bubble' }); });
    att3.forEach(m => { const og = m._own.grid; [...new Set([0, og.width, ...og.lewY, ...og.rewY, ...og.interior.flat()])].forEach(v => { const y = m._map.Y(v);
      if (y < yLo - 1e-6 || y > yHi + 1e-6 || colY.some(c => Math.abs(c - y) < 0.5) || !og.yLabel(v)) return;
      floor.push([[xLo, y, 0], [xHi, y, 0], 'rgba(240,190,110,.22)', true]); labels.push({ p: [xLo - 2.2, y, 0], text: og.yLabel(v), kind: 'bubble' }); }); });
    const Z = Atop + 2.5;
    const box = { x0: xLo - 3.4, x1: xHi, y0: yLo - 3.4, y1: yHi + (att3.length ? 3.4 : 0), z0: 0, z1: Z };   // bubbles sit 2.2' outside the grid ends
    // each mezzanine's own box, for the view to fly to (far apart in a long building, the whole job shows them small)
    const groups = ms.map(m => { const fp = m.layout.footprint; return { id: m.id, box: { x0: fp.x0, x1: fp.x1, y0: fp.y0, y1: fp.y1, z0: 0, z1: inpOf(m).geom.A.value ?? 12 } }; });
    return { center: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, Z / 2], radius: Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2, box, members, labels, floor, groups };
  }
  // the sidebar orb: the same scene, small, turning; click it to jump to the framing model
  let mini = null;
  railView = (() => { try { return localStorage.getItem('mzd.railView') || '3d'; } catch (e) { return '3d'; } })();
  function setRailView(v) {
    railView = v;
    try { localStorage.setItem('mzd.railView', v); } catch (e) { /* storage off */ }
    $$('#rvToggle button[data-v]').forEach(b => b.classList.toggle('is-on', b.dataset.v === v));
    const has = !!(state.res && !state.res.incomplete);
    $('#miniModel').style.display = v === '3d' && has ? '' : 'none';
    $('#miniPlan').toggleAttribute('hidden', v !== 'plan' || !has);
    if (v === 'plan') renderMiniPlan();
  }
  $$('#rvToggle button[data-v]').forEach(b => { b.onclick = e => { e.stopPropagation(); setRailView(b.dataset.v); }; });
  const openPop = on => { $('#planPop').hidden = !on; if (on) renderMiniPlan(); };
  $('#rvBig').onclick = e => { e.stopPropagation(); openPop($('#planPop').hidden); };
  $('#ppClose').onclick = () => openPop(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#planPop').hidden) openPop(false); });
  // the sidebar fits the window: on a short screen it tightens in steps, then the 3D / plan square takes the height
  // that is left (never wider than the rail) — nothing in it is squeezed or cut off
  function fitRail() {
    const rail = $('.rail'), score = rail && rail.querySelector('.rail-score'), view = $('#railView');
    if (!rail || !score || !view) return;
    if (getComputedStyle(score).display === 'none') { delete rail.dataset.fit; view.style.removeProperty('--rv'); return; }
    let size = 0;
    for (const lv of [0, 1, 2, 3]) {
      if (lv) rail.dataset.fit = [1, 2, 3].slice(0, lv).join(' '); else delete rail.dataset.fit;
      const cs = getComputedStyle(score), full = Math.floor(score.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
      view.style.setProperty('--rv', full + 'px');
      const over = rail.scrollHeight - rail.clientHeight;
      size = Math.max(128, full - Math.max(0, over));
      // fits; or a little short, and a slightly smaller square (not under 128 px) takes it before the next step
      if (over <= 0 || (lv < 3 && over <= full * (lv ? 0.25 : 0.1) && full - over >= 128)) break;
    }
    view.style.setProperty('--rv', size + 'px');
  }
  let fitQueued = false;
  const queueFit = () => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fitRail(); }); };
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(queueFit); ['.rail', '#rsSub', '.rail-nav'].forEach(q => $(q) && ro.observe($(q))); }
  window.addEventListener('resize', queueFit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueFit);
  queueFit();
  function renderMini(scene) {
    const cv = $('#miniModel');
    if (!cv || !M3) return;
    $('#orbEmpty').hidden = !!scene;
    $('#orbEmpty').textContent = state.res && state.res.incomplete ? 'Needs input' : 'Drop a PCS';
    $('#rvToggle').hidden = !scene;
    if (!scene) { cv.style.display = 'none'; $('#miniPlan').setAttribute('hidden', ''); return; }
    if (!mini) {
      mini = M3.mount(cv, { pad: [8, 8], min: [60, 60], speed: 0.00035, fitScale: 1.04, onSelect: () => { go('results'); setTimeout(() => $('#modelSec').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); } });
      mini.toggle('joists', false);
    }
    // frame on the steel itself (not the grid bubbles), so it sits in the middle of the square
    const bb = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z1: 0 };
    scene.members.forEach(m => (m.boxes || []).forEach(b => { bb.x0 = Math.min(bb.x0, b.x0); bb.x1 = Math.max(bb.x1, b.x1); bb.y0 = Math.min(bb.y0, b.y0); bb.y1 = Math.max(bb.y1, b.y1); bb.z1 = Math.max(bb.z1, b.z1); }));
    const box = { x0: bb.x0 - 1, x1: bb.x1 + 1, y0: bb.y0 - 1, y1: bb.y1 + 1, z0: 0, z1: bb.z1 };
    mini.set({ ...scene, labels: [], floor: (scene.floor || []).filter(g => !g[3]), box, center: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, box.z1 / 2], radius: Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2 });
    setRailView(railView);
  }
  /* sidebar floor plan, the whole job: grid bubbles, beams in their mark's colour, C# columns (numbered over the job),
     building columns. What is under review is lit (the column case on the Column page, the mark and member length on
     the Beam page). Hover a column for the dead / live it takes; click a column or beam to open its calc. ⤢ shows it large. */
  function planMarkup(Vw, Vh, k, padTop = 0) {
    const r = state.res, g = r.grid, ms = jobView(), many = ms.length > 1, M = 24 * k, cno = colNos();
    const lays = ms.map(m => m.layout);
    const x0 = Math.min(...lays.map(l => Math.min(l.footprint.x0, ...l.xLines))), x1 = Math.max(...lays.map(l => Math.max(l.footprint.x1, ...l.xLines)));
    const y0 = Math.min(...lays.map(l => Math.min(l.footprint.y0, ...l.yLines))), y1 = Math.max(...lays.map(l => Math.max(l.footprint.y1, ...l.yLines)));
    // an attached building beside a sidewall: its own frame numbers on its side, this building's on the other
    const W0 = r.grid.width, attM = ms.filter(m => m.layout.mapped && m.layout.bldg);
    const aTop = attM.find(m => m.layout.bldg.y1 > W0 + 0.05), aBot = attM.find(m => m.layout.bldg.y0 < -0.05), botPad = aTop || aBot ? 14 * k : 0;
    const s = Math.min((Vw - 2 * M) / Math.max(1, x1 - x0), (Vh - 2 * M - 10 * k - padTop - botPad) / Math.max(1, y1 - y0));
    const ox = (Vw - (x1 - x0) * s) / 2, oy = padTop + (Vh - padTop - 10 * k - botPad - (y1 - y0) * s) / 2;
    const X = x => ox + (x - x0) * s, Y = y => oy + (y1 - y) * s;
    const cr = state.view === 'column' ? colShown() : null, grp = cr && cr.colGroups[state.colGroup] ? cr.colGroups[state.colGroup].cols.map(c => c.label) : null;
    // on the Beam page: the job's beams of the mark (and member length) under review
    const jm = state.view === 'beam' ? jobMarks()[state.mark] : null, run = jm && jm.spanRuns && jm.spanRuns.length > 1 ? jm.spanRuns[state.markSpan] : null;
    const isOn = (m, b) => !!jm && (mkOf(m, b.id) || {}).mark === jm.mark && (!run || Math.abs(b.span - run.span) < 1e-3);
    const o = [], br = 6.5 * k;
    const xL = [...new Set(lays.flatMap(l => l.xLines).map(v => +v.toFixed(3)))], yL = [...new Set(lays.flatMap(l => l.yLines).map(v => +v.toFixed(3)))];
    const bubX = (x, cy, lb, cls = '') => `<g class="mp-bub${cls}"><circle cx="${X(x)}" cy="${cy}" r="${br}"/><text x="${X(x)}" y="${cy}">${esc(lb)}</text></g>`;
    xL.forEach(x => {
      o.push(`<line class="mp-grid" x1="${X(x)}" y1="${Y(y1) - 8 * k}" x2="${X(x)}" y2="${Y(y0) + 8 * k}"/>`);
      const top = aTop ? aTop.layout.labX(x) : viewLabX(x);
      if (top) o.push(bubX(x, Y(y1) - 15 * k, top, aTop ? ' att' : '')); else if (!aTop) o.push(`<text class="mp-off" x="${X(x)}" y="${Y(y1) - 13 * k}">${ft(x)}</text>`);
      const bot = aBot ? aBot.layout.labX(x) : aTop ? r.grid.xLabel(x) : null;
      if (bot) o.push(bubX(x, Y(y0) + 15 * k, bot, aBot ? ' att' : ''));
    });
    yL.forEach(y => { o.push(`<line class="mp-grid" x1="${X(x0) - 8 * k}" y1="${Y(y)}" x2="${X(x1) + 8 * k}" y2="${Y(y)}"/>`); const lb = viewLabY(y); if (lb) o.push(`<g class="mp-bub"><circle cx="${X(x0) - 15 * k}" cy="${Y(y)}" r="${br}"/><text x="${X(x0) - 15 * k}" y="${Y(y)}">${lb}</text></g>`); });
    ms.forEach(m => { const fp = m.layout.footprint; o.push(`<rect class="mp-foot" x="${X(fp.x0)}" y="${Y(fp.y1)}" width="${(fp.x1 - fp.x0) * s}" height="${(fp.y1 - fp.y0) * s}" rx="2"/>`); });
    ms.forEach(m => m.layout.beams.forEach(b => {
      const [p, q] = b.ends;
      if (b.absorbed) { o.push(`<line class="mp-beam carried" data-tip="carried|${m.index}|${b.id}" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}"/>`); return; }
      const mk = mkOf(m, b.id), on = jm ? isOn(m, b) : null;
      o.push(`<line class="mp-beam ${on === true ? 'hi' : on === false || grp ? 'dim' : ''}" data-beam="${m.index}:${b.id}" data-tip="beam|${m.index}|${b.id}" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}" stroke="${mkHex(mk)}"/>`);
    }));
    ms.forEach(m => m.layout.beams.filter(b => !b.absorbed).forEach(b => { const [p, q] = b.ends, mk = mkOf(m, b.id); o.push(`<text class="mp-bl" x="${(X(p.x) + X(q.x)) / 2}" y="${(Y(p.y) + Y(q.y)) / 2}">${bNo(m, b.id)}</text>`); }));
    const fls = bldgFrameLoads();
    bldgCols().forEach(sp => { const ld = !!bcolLoad(sp); o.push(`<g class="mp-bc ${ld ? 'ld' : ''}" data-tip="${bcolTip(sp)}"><circle class="mp-hit" cx="${X(sp.x)}" cy="${Y(sp.y)}" r="${6 * k}"/><rect x="${X(sp.x) - 2.5 * k}" y="${Y(sp.y) - 2.5 * k}" width="${5 * k}" height="${5 * k}"/></g>`); });
    const xm = (cx, cy, R) => { const d = R * 0.68; return `<circle cx="${cx}" cy="${cy}" r="${R}"/><path d="M${cx - d},${cy - d} L${cx + d},${cy + d} M${cx - d},${cy + d} L${cx + d},${cy - d}"/>`; };
    const lbl = (cx, cy, t, t2) => `<text class="mp-cl" x="${cx}" y="${cy + 13 * k}" text-anchor="middle">${t}${t2 ? `<tspan class="mp-cl2" x="${cx}" dy="${9 * k}">${t2}</tspan>` : ''}</text>`;
    ms.forEach(m => m.layout.mezzCols.forEach(c => { const on = grp ? m.index === cr.index && grp.includes(c.label) : null, cx = X(c.x), cy = Y(c.y);
      const cd = `${c.ox ?? c.x}|${c.oy ?? c.y}|${m.index}`;
      o.push(`<g class="mp-col ${on === true ? 'hi' : on === false || jm ? 'dim' : ''}" data-col="${cd}" data-tip="col|${cd}">${xm(cx, cy, 5 * k)}</g>${lbl(cx, cy, 'C' + cno.get(c.label), k > 1.2 ? c.label : '')}`); }));
    if (many) ms.forEach(m => { const fp = m.layout.footprint, bl = m.layout.beamLines, alongX = m.layout.joists === 'y';
      // between two beam lines one way, mid-bay between support lines the other, so it sits on no column or beam
      const sl = m.layout.supportLines || [], c0 = alongX ? (fp.x0 + fp.x1) / 2 : (fp.y0 + fp.y1) / 2, i0 = sl.findIndex((v, i) => i < sl.length - 1 && v <= c0 && sl[i + 1] >= c0);
      const midS = i0 >= 0 ? sl[i0] + (sl[i0 + 1] - sl[i0]) * (alongX ? 0.5 : 0.28) : c0;
      const mid = bl.length > 1 ? (bl[0] + bl[1]) / 2 : null, cx = alongX ? midS : mid ?? (fp.x0 + fp.x1) / 2, cy = alongX ? mid ?? (fp.y0 + fp.y1) / 2 : midS;
      o.push(`<text class="mp-mz" x="${X(cx)}" y="${Y(cy)}">${esc(m.id)}</text>`); });
    const cap = grp ? ' · reviewing ' + grp.map(l => 'C' + cno.get(l)).join(', ') : jm ? ' · reviewing ' + jm.mark + (run ? ' at ' + ft(run.span) : '') : '';
    o.push(`<text class="mp-cap" x="${Vw / 2}" y="${Vh - 6 * k}">${many ? esc(ms.map(m => m.id).join(' + ')) : esc(state.inputs.mezz.id || 'Mezzanine')}${k > 1.2 && jobMarks().some(mk => mk.kind) ? ' · ' + jobMarks().filter(mk => mk.kind).map(mk => mk.mark + ' ' + mk.kind).join(' / ') : ''}${cap}</text>`);
    return o.join('');
  }
  function wirePlan(svg) {
    svg.querySelectorAll('[data-col]').forEach(el => { el.onclick = () => { const [x, y, mi] = el.dataset.col.split('|').map(Number); openCol({ x, y, mi: Number.isFinite(mi) ? mi : undefined }); }; });
    svg.querySelectorAll('[data-beam]').forEach(el => { el.onclick = () => { const [mi, id] = el.dataset.beam.split(':').map(Number); openBeam(state.job.mezz[mi], id); }; });
  }
  function renderMiniPlan() {
    const svg = $('#miniPlan'), r = state.res, ok = !!(svg && r && !r.incomplete);
    if (svg) { svg.innerHTML = ok ? planMarkup(200, 200, 1, 18) : ''; svg.setAttribute('viewBox', '0 0 200 200'); if (ok) wirePlan(svg); }
    const pop = $('#planPop');
    if (!pop || pop.hidden) return;
    if (!ok) { pop.hidden = true; return; }
    const lays = jobView().map(m => m.layout), ext = (k, lo) => lays.map(l => (lo ? Math.min : Math.max)(l.footprint[k], ...(k[0] === 'x' ? l.xLines : l.yLines)));
    // drawn at the popup's own width and within the window's height: the labels keep their size, the plan gets the room
    const w = Math.max(680, Math.round(pop.clientWidth - 28)), ratio = (Math.max(...ext('y1')) - Math.min(...ext('y0', 1))) / Math.max(1, Math.max(...ext('x1')) - Math.min(...ext('x0', 1)));
    const h = Math.round(Math.max(240, Math.min(Math.max(320, innerHeight - 176), (w - 80) * ratio + 110)));
    const big = $('#planPopSvg');
    big.setAttribute('viewBox', `0 0 ${w} ${h}`); big.style.setProperty('--k', 1.8);
    big.innerHTML = planMarkup(w, h, 1.8); wirePlan(big);
    $('#ppTitle').textContent = `${jobView().map(m => m.id).join(' + ') || 'Mezzanine'} · floor plan`;
  }
  function renderModel() {
    const canvas = $('#model3d');
    if (!canvas || !M3) return;
    if (!model) {
      model = M3.mount(canvas, {
        onSelect: id => showMember(id), onHover: id => { if (!model.pinned) showMember(id, true); },
        // panning, zooming or flying to a mezzanine stops the turn (it would swing the mezzanine away)
        onAuto: on => { $('#m3Pause').textContent = on ? 'Pause rotation' : 'Resume rotation'; },
        onFocus: id => markFocus(id),
        // a mezzanine flown to is framed below the caption and the View chips laid over the canvas's top
        overlay: () => { const t = $('#modelSec .model-top'), cv = $('#model3d'); return t && cv ? t.getBoundingClientRect().bottom - cv.getBoundingClientRect().top + 6 : 0; },
      });
      $('#m3Pause').onclick = () => { const on = model.auto; model.pause(on); $('#m3Pause').textContent = on ? 'Resume rotation' : 'Pause rotation'; };
      $('#m3Reset').onclick = () => { model.reset(); markFocus(null); };
      $('#m3In').onclick = () => model.zoom(1.15); $('#m3Out').onclick = () => model.zoom(1 / 1.15);
      $$('#modelToggles button').forEach(b => { b.onclick = () => { const on = !b.classList.contains('is-on'); b.classList.toggle('is-on', on); model.toggle(b.dataset.t, on); }; });
    }
    state.scene = buildScene();
    model.set(state.scene);
    renderFocus(state.scene);
    renderMini(state.scene);
    window.MZ_DEBUG = { modelPoint: id => (model ? model.screenOf(id) : null), beams: () => state.scene.members.filter(x => x.kind === 'beam').map(x => x.id), view: () => (model ? model.state() : null), groups: () => state.scene.groups };
    const ms = jobView(), many = ms.length > 1, t = many ? jobTotals() : totals(), marks = jobMarks();
    const cols = [...new Set(ms.filter(m => m.colFinal && m.columns.length).map(m => m.colFinal.quoteAs))].join(' / ');
    const nUnC = ms.reduce((a, m) => a + (!m.columns.length ? 0 : m.colFinal ? (m.colFinal.unsized || []).length : m.columns.length), 0);
    $('#modelTitle').textContent = `${many ? ms.map(m => m.id).join(' + ') + ' · ' : ''}${t.nB} beams · ${t.nC} columns · ${state.scene.members.filter(m => m.kind === 'joist').length} joist runs`;
    $('#modelCount').textContent = ms.map(m => `${many ? m.id + ' ' : ''}${ft(m.layout.footprint.x1 - m.layout.footprint.x0)} long × ${ft(m.layout.footprint.y1 - m.layout.footprint.y0)} wide · T/slab ${ft(inpOf(m).geom.A.value)}`).join(' · ');
    $('#modelKey').innerHTML = marks.map(mk => `<span class="mk-key"><i style="background:${mkHex(mk)}"></i><b>${mk.mark}${mk.kind ? ' · ' + mk.kind : ''}</b> ${esc(mk.desc || 'NO SECTION')} × ${mk.qtyAll}</span>`).join('') +
      `<span><i style="background:#ff9f7a"></i>Mezzanine column ${cols && t.nC > nUnC ? `${esc(cols)} × ${t.nC - nUnC}` : ''}${nUnC ? `${cols && t.nC > nUnC ? ' · ' : ''}<b class="ng">${nUnC} not sized</b>` : ''}</span><span><i style="background:#6f89a3"></i>Building column</span><span><i style="background:#a9cbe0"></i>Joists @ ${[...new Set(ms.map(m => ft(m.beamBase.Lb)))].join(' / ')}</span><span><i style="background:#8fd3ff55;border:1px solid #8fd3ff"></i>Slab ${[...new Set(ms.map(m => f((inpOf(m).geom.slab.value || 0) * 12, 1) + '"'))].join(' / ')}</span>`;
    model.pinned = null;
    showMember(null);
  }
  // the view chips: the whole job, or one mezzanine framed on its own (several mezzanines only)
  function renderFocus(scene) {
    const bar = $('#modelFocus'), gs = (scene && scene.groups) || [];
    bar.hidden = gs.length < 2;
    if (gs.length < 2) { bar.innerHTML = ''; return; }
    const on = bar.dataset.on && gs.some(g => g.id === bar.dataset.on) ? bar.dataset.on : '';
    bar.innerHTML = `<span>View</span><button data-f="" class="${on ? '' : 'is-on'}">Whole job</button>` + gs.map(g => `<button data-f="${esc(g.id)}" class="${on === g.id ? 'is-on' : ''}" title="Fly to ${esc(g.id)}">${esc(g.id)}</button>`).join('');
    bar.querySelectorAll('button').forEach(b => { b.onclick = () => { const g = gs.find(q => q.id === b.dataset.f); model.focus(g ? g.box : null); markFocus(g ? g.id : null); }; });
  }
  function markFocus(id) {
    const bar = $('#modelFocus');
    bar.dataset.on = id || '';
    bar.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.f === (id || '')));
  }
  function showMember(id, hover) {
    const r = state.res, m = id && state.scene ? state.scene.members.find(x => x.id === id) : null;
    if (!hover && model) model.pinned = id || null;
    const card = $('#modelCard'), many = manyMezz(), eb = hover ? 'Member' : 'Selected member';
    const lr = (D, L) => `${f(D, 2)} / ${f(L, 2)}`;
    if (!m || !m.ref || m.ref.type === 'joist') {
      if (hover && model && model.pinned) return;
      const ms = jobView(), t = many ? jobTotals() : totals(), marks = jobMarks();
      card.innerHTML = `<div class="eyebrow">Selected member</div><h4>${esc(ms.map(q => q.id).join(' + ') || 'Mezzanine')}</h4><div class="kind">${many ? 'The whole job' : 'Mezzanine'} · click a beam or column</div>
        <div class="mk-mini">${marks.map(mk => `<div style="--mk:${mkHex(mk)}"><b>${mk.mark}</b><span>${esc(mk.kind || 'beams')}</span><em class="nocase">${esc(mk.desc || 'NO SECTION')}</em><small>× ${mk.qtyAll}</small></div>`).join('')}</div>
        <dl><div><dt>Beams</dt><dd>${t.nB}</dd></div><div><dt>Columns</dt><dd>${t.nC}</dd></div></dl>
        <div class="foot">${(() => { const ks = jobMarks(); return ks.length ? `Beam colours are the marks (${ks.map(k => k.mark + (k.kind ? ' ' + k.kind : '')).join(', ')}) — key below${ks.some(k => !k.sec) ? '; red, see-through: no section' : ''}.` : ''; })()} Click a column to see the left / right dead and live it takes from the beams.</div>`;
      return;
    }
    const ref = m.ref;
    if (ref.type === 'beam') {
      const o = ref.m, b = ref.b, mk = ref.mk, run = runOf(mk, b.span), c = run ? run.check : mk.check, rx = mk.sec ? DESIGN.reactions({ ...o.beamBase, L: b.span, trib: b.trib }, mk.sec) : null;
      const g = o.grid, lay = o.layout, lab = (lay.joists === 'y' ? g.yLabel(b.line) : g.xLabel(b.line)) || ft(b.line), fl = lay.joists === 'y' ? g.xLabel : g.yLabel;
      card.innerHTML = `<div class="eyebrow">${eb}${many ? ' · ' + esc(o.id) : ''}</div><h4>${bNo(o, b.id)} · ${mkName(mk)}</h4><div class="kind">Beam on line ${esc(lab)} · ${esc(fl(b.from) || ft(b.from))} → ${esc(fl(b.to) || ft(b.to))}</div>
        <div class="sec nocase${mk.sec ? '' : ' ng'}">${esc(mk.desc || 'NO SECTION')}</div>
        <dl><div><dt>Span</dt><dd>${ft(b.span)}</dd></div><div><dt>Trib</dt><dd>${ft(b.trib)}</dd></div>
        <div><dt>R dead</dt><dd>${rx ? f(rx.D, 2) + 'k' : '—'}</dd></div><div><dt>R live</dt><dd>${rx ? f(rx.L, 2) + 'k' : '—'}</dd></div>
        ${c ? `<div><dt>Combined</dt><dd>${f(c.res.CSR, 3)}</dd></div><div><dt>Shear</dt><dd>${f(c.res.SRvx, 3)}</dd></div>
        <div><dt>Live defl.</dt><dd>L/${f(c.defl.rLL, 0)}</dd></div><div><dt>Weight</dt><dd>${f(c.res.Wt, 1)} plf</dd></div>` : ''}</dl>
        <span class="pill">${!mk.sec ? `nothing passes — drawn at a nominal 18" depth (see Beam calc)` : b.span < mk.span - 1e-3 ? `shorter member — ${mk.mark} section, MB sheet at ${ft(runL(runOf(mk, b.span) || { span: b.span }))}` : b.trib < mk.trib - 1e-3 ? `designed for ${ft(mk.trib)} trib (${mk.mark} governing)` : `governing ${mk.mark} beam`}</span>
        <div class="foot">${secParts(mk.sec)}</div>`;
    } else if (ref.type === 'col') {
      const ci = colInfo({ x: ref.c.ox ?? ref.c.x, y: ref.c.oy ?? ref.c.y, mi: ref.m.index }), col = ci && ci.c, o = ci ? ci.m : ref.m, cf = o.colFinal, chk = cf && ci && ci.gi >= 0 ? cf.checks[ci.gi] : null;
      const from = sd => (col ? col.parts.filter(p => p.sheetSide === sd).map(p => `${many ? esc(p.mezz) + ' ' : ''}${p.beam}${p.mark ? ' ' + p.mark : ''}`).join(' + ') || 'no beam' : '—');
      const wcol = col ? whereTxt(col.x, col.y, o.grid) : null;
      card.innerHTML = `<div class="eyebrow">${eb}${many ? ' · ' + esc(o.id) : ''}</div><h4>C${ref.no} · ${esc(ref.c.label)}</h4><div class="kind">Mezzanine column ⊗ · Column sheet input</div>${wcol ? `<div class="where">${esc(wcol.x)}<br>${esc(wcol.y)}</div>` : ''}
        <div class="sec nocase${cf && chk ? '' : ' ng'}">${cf && chk ? esc(cf.quoteAs) : 'NOT SIZED'}</div>${cf && chk ? '' : `<div class="kind">${o.colWhy && o.colWhy.marks && o.colWhy.marks.length ? `${esc(o.colWhy.marks.join(', '))} ${o.colWhy.marks.length > 1 ? 'have' : 'has'} no section, so the beam reactions are unknown` : 'the beam reactions are unknown'}</div>`}
        <dl><div><dt>Left D / L (k)</dt><dd>${col ? lr(col.DL_L, col.LL_L) : '—'}</dd></div><div><dt>Right D / L (k)</dt><dd>${col ? lr(col.DL_R, col.LL_R) : '—'}</dd></div>
        <div><dt>Left from</dt><dd>${from('left')}</dd></div><div><dt>Right from</dt><dd>${from('right')}</dd></div>
        <div><dt>Height</dt><dd>${ft(o.colLen)}</dd></div><div><dt>Max CSR</dt><dd>${chk ? f(chk.max, 3) : '—'}</dd></div></dl>
        <div class="foot">Unfactored beam reactions (MB H6 / H10) · e = d/2 · three load combinations · column self-weight included, as on the Column sheet.</div>`;
    } else if (ref.type === 'bcol') {
      const fl = bcolLoad(ref.sp);
      card.innerHTML = `<div class="eyebrow">${eb}</div><h4>${esc(ref.sp.label)}</h4><div class="kind">Building column · load to the frame</div>
        <div class="sec nocase">${fl ? `D ${f(fl.D, 2)} · L ${f(fl.L, 2)} k` : '—'}</div>
        ${fl ? `<dl>${fl.parts.map(p => `<div><dt>${many ? esc(p.mezz) + ' ' : ''}${p.beam}${p.mark ? ' · ' + p.mark : ''}</dt><dd>${lr(p.D, p.L)}</dd></div>`).join('')}</dl>` : ''}
        <div class="foot">Unfactored mezzanine beam reactions (MB H6 / H10) that land on this column — they go to the frame / endwall design, not the mezzanine Column sheet.</div>`;
    }
  }

  // ---------- quote sheet (the MEZZ sheet of the quote workbook, cell for cell) ----------
  function renderQuoteSheet() {
    // one holistic set of rows for the job: a row per beam mark and member length, a row per column section
    const q = RUN.quoteJob(state.job ? state.job.mezz : [state.res], state.all ? state.all.map(a => a.inputs) : [state.inputs]);
    state.quote = q;
    const cur = state.res && state.res.id, many = manyMezz();
    const names = { design: 'Design information rows', beams: 'Beam rows', columns: 'Column rows' };
    const block = (key, title, sub, foot) => {
      const h = q.heads[key], rows = q[key], sh = q.sheet[key], fx = q.formulas[key] || {};
      const cls = k => (k === 'SECTION' ? 'sec' : fx[k] ? 'calc' : '');
      const noteAt = sh.withNote ? (key === 'columns' ? 'I:K' : 'J:K') : '';
      const isCur = r => many && String(r.MEZZID).split(' / ').includes(cur);
      const warn = [sh.over ? `${sh.rows} rows — the sheet has room for ${sh.room} (rows ${sh.first}–${sh.last}). Insert ${sh.over} row${sh.over > 1 ? 's' : ''} above row ${sh.last + 1} first, or the paste runs over the lines under the table.` : '',
        key === 'beams' && rows.some(r => r.partLive) ? 'Partition is carried as live load (Settings), so these rows paste DLT = DLF + COLF and LLF = LLF + PART. — not the sheet’s own DLT formula, which adds PART. to the dead load.' : ''].filter(Boolean);
      const detail = rows.filter(r => r.DETAIL).map((r, i) => `<li><b>Row ${sh.first + rows.indexOf(r)}</b> ${esc(r.DETAIL)}</li>`).join('');
      return `<div class="qs-block"><div class="qs-head"><div><h4>${title}</h4>${sub ? `<small>${sub}</small>` : ''}</div>
          <div class="qs-act"><span class="qs-at">Paste at <b>${sh.at}</b></span><button class="btn-soft" data-copy="${key}"><svg><use href="#i-copy"/></svg>Copy rows</button></div></div>
        <div class="qs-wrap"><table><thead><tr class="qs-letters"><th class="rn"></th>${h.map(([k]) => `<th>${sh.letters[k]}</th>`).join('')}${noteAt ? `<th>${noteAt}</th>` : ''}</tr>
          <tr><th class="rn"></th>${h.map(([k, t]) => `<th class="${k === 'MEZZ' ? 'left' : ''}">${t}</th>`).join('')}${noteAt ? '<th class="left">ADDITIONAL NOTES</th>' : ''}</tr></thead>
        <tbody>${rows.length ? rows.map((row, i) => `<tr class="${isCur(row) ? 'is-cur' : ''}"><th class="rn">${sh.first + i}</th>${h.map(([k]) => {
          const f = fx[k] ? fx[k](sh.first + i, row) : null;
          return `<td class="${cls(k)}${k === 'MEZZ' ? ' left' : ''}${k === 'SECTION' && (/^(NO SECTION|NOT SIZED)$/.test(row[k]) || row.FLAG) ? ' ng' : ''}"${f ? ` title="Pasted as the sheet's formula ${esc(f)}"` : ''}>${esc(row[k])}</td>`; }).join('')}${noteAt ? `<td class="qnotes ng">${esc(row.FLAG || '')}</td>` : ''}</tr>`).join('') : `<tr><td colspan="${h.length + 1}" class="qnotes">No rows.</td></tr>`}</tbody></table></div>
        ${warn.map(w => `<div class="qs-warn">${esc(w)}</div>`).join('')}
        <div class="qs-foot"><span>${foot}</span>${detail ? `<details class="qs-detail"><summary>What each row is</summary><ul>${detail}</ul></details>` : ''}</div></div>`;
    };
    const legend = q.mezzNos.length > 1 && !q.mezzNos[0].own ? ` · MEZZ ${q.mezzNos.map(m => `${m.no} = ${esc(m.id)}`).join(', ')}` : '';
    $('#quoteSheet').innerHTML =
      block('design', 'Mezz. Design Information', '', `**DEAD LOAD DOES NOT INCLUDE THE WEIGHT OF THE FLOOR JOISTS OR BEAMS**${legend}`) +
      block('beams', 'Mezz. Beams', 'U.N.O., live load deflection limit = L/360; total load deflection limit = L/240', 'DLT = DLF + COLF · END PL. WT. = 40 lb PER BEAM · DLT, LLF and END WT paste as the sheet’s own formulas') +
      block('columns', 'Mezz. Columns', '', 'END PL. WT. = 46 lb PER COLUMN · trib area: the floor area of the worst column · END WT pastes as the sheet’s formula');
    $$('#quoteSheet [data-copy]').forEach(b => { b.onclick = () => { const k = b.dataset.copy; copyRich(q.tsv[k], quoteHtml(k, q.tsv[k]), `${names[k]} copied — click ${q.sheet[k].at} on the MEZZ sheet, then paste (merged cells stay merged)`); }; });
  }
  // the rail button: to the quote sheet, where each table is copied for its own cell
  $('#copyQuote').onclick = () => { go('results'); setTimeout(() => $('#qsHead').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); };
  $('#printBtn').onclick = () => window.print();

  // ---------- plan ----------
  $$('#joistSeg button').forEach(b => { b.onclick = () => { state.settings.joists = b.dataset.j; delete state.settings.xLines; delete state.settings.yLines; recompute(); }; });
  $('#gridReset').onclick = () => { ['xLines', 'yLines', 'drop', 'colKind'].forEach(k => delete state.settings[k]); recompute(); };
  const listIn = str => str.split(/[,;\s]+/).map(t => PCS.ftin(t) ?? parseFloat(t)).filter(v => isFinite(v));
  function onGridEdit() {
    const lay = state.res.layout, bl = listIn($('#beamLinesIn').value), sl = listIn($('#supLinesIn').value);
    if (bl.length < 1 || sl.length < 2) { toast('Need at least 1 beam line and 2 support lines'); return; }
    state.settings.joists = lay.joists;
    if (lay.joists === 'y') { state.settings.yLines = bl; state.settings.xLines = sl; } else { state.settings.xLines = bl; state.settings.yLines = sl; }
    recompute();
  }
  $('#beamLinesIn').onchange = onGridEdit; $('#supLinesIn').onchange = onGridEdit;

  // a long column list in a line: C1–C28 on the grid lines they stand on (the full list on hover)
  function colListShort(cols, cno) {
    if (!cols.length) return 'none';
    if (cols.length <= 8) return esc(cols.map(c => `C${cno.get(c.label)} ${c.label}`).join(' · '));
    const nos = cols.map(c => cno.get(c.label)).filter(Boolean).sort((a, b) => a - b), parts = cols.map(c => String(c.label).split('/'));
    const uniq = k => [...new Set(parts.map(p => p[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const run = nos.length && nos[nos.length - 1] - nos[0] + 1 === nos.length ? `C${nos[0]}–C${nos[nos.length - 1]}` : `${nos.length} columns`;
    // "lines 2–8 × C–F" only when the columns fill that grid; otherwise the first few (the rest on hover)
    const ux = uniq(0), uy = uniq(1);
    return esc(ux.length * uy.length === cols.length ? `${run} · lines ${ux.join(', ')} × ${uy.join(', ')}` : `${run} · ${cols.slice(0, 4).map(c => c.label).join(', ')} …`);
  }
  function renderPlan() {
    const r = state.res, g = r.grid, lay = r.layout, inp = state.inputs;
    if (r.incomplete) {
      $('#planStats').innerHTML = '';
      $('#planSvg').setAttribute('viewBox', '0 0 1100 120');
      $('#planSvg').innerHTML = '<text x="550" y="60" text-anchor="middle" class="dim" style="font-size:14px">Inputs incomplete — see Inputs read.</text>';
      $('#planLegend').innerHTML = ''; $('#beamTable').innerHTML = ''; $('#supTable').innerHTML = ''; $('#layWhy').textContent = '';
      return;
    }
    // one holistic plan for the job: every mezzanine of this building, every beam in its mark's colour, every column
    // once; the controls (joist direction, beam / support lines) edit the mezzanine picked at the top
    const ms = jobView(), many = ms.length > 1, cno = colNos(), t = many ? jobTotals() : totals(), marks = jobMarks(), job = state.job;
    const lineOf = (m, v) => (m.layout.joists === 'y' ? (m.layout.labY || g.yLabel)(v) : (m.layout.labX || g.xLabel)(v)) || ft(v);
    const spans = [...new Set(ms.flatMap(m => m.layout.beams.filter(b => !b.absorbed).map(b => +b.span.toFixed(3))))].sort((x, y) => y - x);
    const allCols = ms.flatMap(m => m.layout.mezzCols).sort((x, y) => cno.get(x.label) - cno.get(y.label));
    const uniq = a2 => [...new Set(a2)].join(' / ');
    $('#planStats').innerHTML = `
      <div class="pstat beams"><span>Mezzanine beams${many ? ' · whole job' : ''}</span><strong>${t.nB}<small>beams</small></strong><em>${marks.filter(m => viewQty(m)).map(m => `${mkName(m)} ${esc(m.desc || 'NO SECTION')} × ${viewQty(m)}`).join(' · ')}</em></div>
      <div class="pstat cols"><span>Mezzanine columns ⊗${many ? ' · whole job' : ''}</span><strong>${t.nC}<small>columns</small></strong><em title="${esc(allCols.map(c => `C${cno.get(c.label)} ${c.label}`).join(' · '))}">${colListShort(allCols, cno)}</em></div>
      <div class="pstat"><span>Beam spans</span><strong>${spans.length ? ft(spans[0]) : '—'}${spans.length > 1 ? `<small>+ ${spans.slice(1).map(ft).join(' · ')}</small>` : ''}</strong><em>${ms.map(m => `${many ? esc(m.id) + ': ' : ''}${m.layout.supportLines.length - 1} bay${m.layout.supportLines.length > 2 ? 's' : ''} × ${m.layout.beamLines.length} beam lines (${m.layout.beamLines.map(v => lineOf(m, v)).join(', ')})`).join(' · ')}</em></div>
      <div class="pstat"><span>Joists</span><strong>${uniq(ms.map(m => ft(m.layout.joistSpan)))}</strong><em>span · @ ${uniq(ms.map(m => ft(m.beamBase.Lb)))} · ${uniq(ms.map(m => (m.layout.joists === 'y' ? 'across the width' : 'along the length')))}</em></div>`;
    $$('#joistSeg button').forEach(b => b.classList.toggle('is-active', b.dataset.j === (state.settings.joists || 'auto')));
    const gridOf = ((state.pcs && state.pcs.mezzanines[r.index]) || {}).building || '';
    $('#planTitle').textContent = (many ? `Framing plan · ${ms.map(m => m.id).join(' + ')}` : `Framing plan · ${inp.mezz.id || 'mezzanine'}`) + (ms.some(m => m.layout.mapped) && gridOf ? ` · on the ${gridOf} grid` : '');
    $('#layWhy').textContent = `${many ? 'editing ' + (inp.mezz.id || '') + ' (pick at the top) · ' : ''}joists span ${lay.joists === 'y' ? 'across the width' : 'along the length'} — ${lay.why}`;
    $('#beamLinesIn').value = lay.beamLines.map(v => +v.toFixed(3)).join(', ');
    $('#supLinesIn').value = lay.supportLines.map(v => +v.toFixed(3)).join(', ');
    const L = g.length || 1, W = g.width || 1;
    const ux0 = Math.min(...ms.map(m => m.layout.footprint.x0)), ux1 = Math.max(...ms.map(m => m.layout.footprint.x1));
    let xa = 0, xb = L, ya = 0, yb = W;
    if ((ux1 - ux0) / L < 0.4) { xa = Math.max(0, ux0 - 30); xb = Math.min(L, ux1 + 30); }
    // crop to the mezzanines across the width too, out to the next column line, so the framing reads large
    const uy0 = Math.min(...ms.map(m => m.layout.footprint.y0)), uy1 = Math.max(...ms.map(m => m.layout.footprint.y1));
    const lineY = [...new Set([0, W, ...g.lewY, ...g.rewY, ...g.interior.flat()])].sort((p2, q2) => p2 - q2);
    if ((uy1 - uy0) / W < 0.75) { ya = Math.max(0, ...lineY.filter(y => y <= uy0 - 6)); yb = Math.min(W, ...lineY.filter(y => y >= uy1 + 6)); }
    // a building attached to this one (a lean-to), drawn with it: the view takes in its mezzanines and its depth
    const att = ms.filter(m => m.layout.mapped);
    if (att.length) {
      xa = Math.min(xa, ...att.map(m => m.layout.footprint.x0)); xb = Math.max(xb, ...att.map(m => m.layout.footprint.x1));
      ya = Math.min(ya, ...att.map(m => m.layout.bldg.y0)); yb = Math.max(yb, ...att.map(m => m.layout.bldg.y1));
    }
    const VW = 1100, M = 78, s = Math.min((VW - 2 * M) / (xb - xa), 600 / (yb - ya)), VH = (yb - ya) * s + 2 * M + 24;
    const X = x => M + (x - xa) * s, Y = y => M + 12 + (yb - y) * s;
    state.planXf = { xa, xb, ya, yb, s, M };   // the edit mode maps a click back to feet
    // the columns' hover / click targets shrink on a long job drawn small (490 ft across), so the beam between two
    // columns keeps a middle to point at: at most a third of the shortest beam each, never under 5
    const minBeam = Math.min(...ms.flatMap(m => m.layout.beams.filter(b => !b.absorbed).map(b => Math.abs(b.to - b.from))).filter(v => v > 0.5), Infinity);
    const hitR = r0 => Math.max(5, Math.min(r0, isFinite(minBeam) ? minBeam * s / 3 : r0));
    const inX = x => x >= xa - 0.01 && x <= xb + 0.01, inY = y => y >= ya - 0.01 && y <= yb + 0.01;
    const o = [];
    o.push(`<defs><pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="var(--hatch)"/><line x1="0" y1="0" x2="0" y2="9" stroke="var(--green)" stroke-width=".7" opacity=".3"/></pattern>
      <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink)"/></marker></defs>`);
    // an attached building beside a sidewall takes that side's frame-line bubbles with its own numbers, so its columns
    // (named by its own grid) read against the right bubble; this building's numbers stay on the other side
    const attSide = { top: att.find(m => m.layout.bldg.y1 > W + 0.05), bot: att.find(m => m.layout.bldg.y0 < -0.05) };
    let lastX = null, steppedX = false;
    g.xs.filter(inX).forEach(x => {
      const close = lastX != null && Math.abs(X(x) - lastX) < 24, off = close && !steppedX ? 26 : 0;
      steppedX = off > 0; lastX = X(x);
      o.push(`<line class="grid-line" x1="${X(x)}" y1="${Y(yb) - 26 - off}" x2="${X(x)}" y2="${Y(ya) + 26 + off}"/>`);
      [[Y(yb) - 38 - off, attSide.top], [Y(ya) + 38 + off, attSide.bot]].filter(([, a]) => !a).forEach(([cy]) => o.push(`<g class="bubble"><circle cx="${X(x)}" cy="${cy}" r="11"/><text x="${X(x)}" y="${cy}">${g.xLabel(x)}</text></g>`));
    });
    [['top', Y(yb) - 38], ['bot', Y(ya) + 38]].forEach(([k, cy]) => {
      const m = attSide[k]; if (!m) return;
      const own = m._own, xs = own.grid.xs.map(v => ({ x: m._map.X(v), lab: own.grid.xLabel(v) })).filter(q => inX(q.x) && q.lab);
      xs.forEach(q => { if (!g.xs.some(v => Math.abs(v - q.x) < 0.05)) o.push(`<line class="grid-line" x1="${X(q.x)}" y1="${Y(m.layout.bldg.y1)}" x2="${X(q.x)}" y2="${Y(m.layout.bldg.y0)}"/>`); o.push(`<g class="bubble att"><circle cx="${X(q.x)}" cy="${cy}" r="11"/><text x="${X(q.x)}" y="${cy}">${esc(q.lab)}</text></g>`); });
      // whose numbers each row is
      const nmOf = mi => ((state.pcs.mezzanines[mi] || {}).building || '').trim();
      const xMin = Math.min(...xs.map(q => X(q.x)), ...g.xs.filter(inX).map(X));
      if (nmOf(m.index)) o.push(`<text class="row-name att" x="${xMin - 18}" y="${cy}">${esc(nmOf(m.index))}</text>`);
      if (nmOf(r.index) && !(attSide.top && attSide.bot)) o.push(`<text class="row-name" x="${xMin - 18}" y="${k === 'top' ? Y(ya) + 38 : Y(yb) - 38}">${esc(nmOf(r.index))}</text>`);
    });
    // letters run over every column line (ridge included, as on the drawings); only column lines get a bubble
    const colY = new Set([0, W, ...g.lewY, ...g.rewY, ...g.interior.flat()].map(v => v.toFixed(2)));
    // bubbles of lines closer than a bubble apart (C and D a foot apart) step outward so both read
    let lastY = null, stepped = false;
    g.allY.filter(y => colY.has(y.toFixed(2)) && inY(y)).sort((p2, q2) => q2 - p2).forEach(y => {
      const close = lastY != null && Math.abs(Y(y) - lastY) < 24, off = close && !stepped ? 26 : 0;
      stepped = off > 0; lastY = Y(y);
      o.push(`<line class="grid-line" x1="${X(xa) - 26 - off}" y1="${Y(y)}" x2="${X(xb) + 26 + off}" y2="${Y(y)}"/>`);
      [X(xa) - 38 - off, X(xb) + 38 + off].forEach(cx => o.push(`<g class="bubble"><circle cx="${cx}" cy="${Y(y)}" r="11"/><text x="${cx}" y="${Y(y)}">${g.yLabel(y)}</text></g>`));
    });
    const xsw = g.xs.filter(inX);
    xsw.slice(1).forEach((x, i) => { const a2 = xsw[i]; o.push(`<text class="dim" x="${(X(a2) + X(x)) / 2}" y="${attSide.top && !attSide.bot ? Y(ya) + 62 : Y(yb) - 52}">${ft(x - a2)}</text>`); });
    // the building: walls solid where they are in view, the cut edges of a cropped view dashed
    o.push(`<rect class="bldg-cut" x="${X(xa)}" y="${Y(yb)}" width="${(xb - xa) * s}" height="${(yb - ya) * s}"/>`);
    { const hx0 = Math.max(xa, 0), hx1 = Math.min(xb, L), hy0 = Math.max(ya, 0), hy1 = Math.min(yb, W);   // this building's walls in view
      [[xa <= 0.01, X(0), Y(hy1), X(0), Y(hy0)], [xb >= L - 0.01, X(L), Y(hy1), X(L), Y(hy0)], [yb >= W - 0.01, X(hx0), Y(W), X(hx1), Y(W)], [ya <= 0.01, X(hx0), Y(0), X(hx1), Y(0)]].forEach(([on, x1, y1, x2, y2]) => { if (on) o.push(`<line class="bldg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`); }); }
    // the attached building: its walls and its own column lines, lettered as on the drawing
    [...new Map(att.map(m => [m.bkey, m])).values()].forEach(m => {
      const bd = m.layout.bldg, xs0 = Math.max(xa, bd.x0), xs1 = Math.min(xb, bd.x1), own = m._own;
      [bd.y0, bd.y1].filter(y => Math.abs(y) > 0.05 && Math.abs(y - W) > 0.05).forEach(y => o.push(`<line class="bldg att" x1="${X(xs0)}" y1="${Y(y)}" x2="${X(xs1)}" y2="${Y(y)}"/>`));
      [bd.x0, bd.x1].filter(x => inX(x)).forEach(x => o.push(`<line class="bldg att" x1="${X(x)}" y1="${Y(bd.y0)}" x2="${X(x)}" y2="${Y(bd.y1)}"/>`));
      const oy = [...new Set([0, own.grid.width, ...own.grid.lewY, ...own.grid.rewY, ...own.grid.interior.flat()])].map(v => ({ y: m._map.Y(v), lab: own.grid.yLabel(v) }));
      oy.filter(q => !colY.has(q.y.toFixed(2)) && ![0, W].some(v => Math.abs(v - q.y) < 0.5)).forEach(q => {
        o.push(`<line class="grid-line" x1="${X(xs0) - 26}" y1="${Y(q.y)}" x2="${X(xs1) + 26}" y2="${Y(q.y)}"/>`);
        if (q.lab) [X(xs0) - 38, X(xs1) + 38].forEach(cx => o.push(`<g class="bubble att"><circle cx="${cx}" cy="${Y(q.y)}" r="11"/><text x="${cx}" y="${Y(q.y)}">${esc(q.lab)}</text></g>`));
      });
      const nm = ((state.pcs.mezzanines[m.index] || {}).building || '').trim();
      if (nm && !(attSide.top === m || attSide.bot === m)) o.push(`<text class="dim att-name" x="${X(xs0) + 6}" y="${Y(bd.y0 < 0 ? bd.y0 : bd.y1) + (bd.y0 < 0 ? -6 : 14)}" text-anchor="start">${esc(nm)}</text>`);
    });
    if (xa > 0) o.push(`<text class="dim" x="${X(xa) - 6}" y="${Y(yb) - 8}" text-anchor="start">⟵ ${ft(xa)} more to LEW</text>`);
    if (xb < L) o.push(`<text class="dim" x="${X(xb) + 6}" y="${Y(yb) - 8}" text-anchor="end">${ft(L - xb)} more to REW ⟶</text>`);
    if (ya > 0) o.push(`<text class="dim" x="${X(xa) + 6}" y="${Y(ya) - 6}" text-anchor="start">${ft(ya)} more to the FSW ↓</text>`);
    if (yb < W) o.push(`<text class="dim" x="${X(xa) + 6}" y="${Y(yb) + 14}" text-anchor="start">${ft(W - yb)} more to the BSW ↑</text>`);
    if (ya <= 0.01) o.push(`<text class="dim" x="${X(Math.max(xa, 0)) + 4}" y="${Y(0) - 6}" text-anchor="start">FSW</text>`);
    if (yb >= W - 0.01) o.push(`<text class="dim" x="${X(Math.max(xa, 0)) + 4}" y="${Y(W) + 14}" text-anchor="start">BSW</text>`);
    // footprints, then every beam's floor (trib band) in its mark's colour: interior and exterior read at a glance
    ms.forEach(m => { const f2 = m.layout.footprint; o.push(`<rect class="foot" x="${X(f2.x0)}" y="${Y(f2.y1)}" width="${(f2.x1 - f2.x0) * s}" height="${(f2.y1 - f2.y0) * s}"/>`); });
    ms.forEach(m => {
      const ly = m.layout;
      ly.beams.forEach(b => {
        const mk = bandMark(m, b), i = ly.beamLines.indexOf(b.line);
        const a2 = i > 0 ? (ly.beamLines[i - 1] + b.line) / 2 : b.line, c = i < ly.beamLines.length - 1 ? (b.line + ly.beamLines[i + 1]) / 2 : b.line;
        const key = b.absorbed ? `${b.absorbed.mi}:${b.absorbed.into[0]}` : `${m.index}:${b.id}`;
        if (ly.joists === 'y') o.push(`<rect class="trib" data-band="${key}" x="${X(b.from)}" y="${Y(c)}" width="${(b.to - b.from) * s}" height="${(c - a2) * s}" fill="${mkVar(mk)}"/>`);
        else o.push(`<rect class="trib" data-band="${key}" x="${X(a2)}" y="${Y(b.to)}" width="${(c - a2) * s}" height="${(b.to - b.from) * s}" fill="${mkVar(mk)}"/>`);
      });
      const sp = m.beamBase.Lb, fp = ly.footprint;
      if (sp > 0) {
        if (ly.joists === 'y') for (let x = fp.x0 + sp; x < fp.x1 - 0.01; x += sp) o.push(`<line class="joist" x1="${X(x)}" y1="${Y(fp.y0)}" x2="${X(x)}" y2="${Y(fp.y1)}"/>`);
        else for (let y = fp.y0 + sp; y < fp.y1 - 0.01; y += sp) o.push(`<line class="joist" x1="${X(fp.x0)}" y1="${Y(y)}" x2="${X(fp.x1)}" y2="${Y(y)}"/>`);
      }
    });
    // beams; an edge carried by the neighbour's beam is dashed, under the beam that carries it
    ms.forEach(m => m.layout.beams.filter(b => b.absorbed).forEach(b => { const [p, q] = b.ends; o.push(`<line class="beam carried" data-tip="carried|${m.index}|${b.id}" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}"/>`); }));
    ms.forEach(m => m.layout.beams.filter(b => !b.absorbed).forEach(b => {
      const [p, q] = b.ends;
      const mk = mkOf(m, b.id);
      o.push(`<line class="beam ${mk && mk.kind ? mk.kind : ''}" data-beam="${m.index}:${b.id}" data-tip="beam|${m.index}|${b.id}" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}" stroke="${mkVar(mk)}"/>`);
    }));
    // mark labels along each run of beams of one mark on one line: "MB1 · INTERIOR · BU28x50"
    ms.forEach(m => {
      const bs = m.layout.beams.filter(b => !b.absorbed).slice().sort((a2, b2) => a2.line - b2.line || a2.from - b2.from), runs = [];
      bs.forEach(b => { const mk = mkOf(m, b.id), last = runs[runs.length - 1];
        if (last && last.mk === mk && Math.abs(last.line - b.line) < 1e-6 && Math.abs(last.to - b.from) < 0.05) last.to = b.to; else runs.push({ mk, line: b.line, from: b.from, to: b.to, dir: b.dir }); });
      runs.forEach(rn => {
        if (!rn.mk) return;
        const len = (rn.to - rn.from) * s - 16, long = `${rn.mk.mark}${rn.mk.kind ? ' · ' + rn.mk.kind.toUpperCase() : ''} · ${rn.mk.desc || 'NO SECTION'}`, short = `${rn.mk.mark}${rn.mk.kind ? ' ' + rn.mk.kind.slice(0, 3).toUpperCase() : ''}`;
        const txt = long.length * 6.4 < len ? long : short.length * 6.4 < len ? short : '';
        if (!txt) return;
        // clear of the column symbols on the line (⊗ and its drawing ring reach 14 px)
        if (rn.dir === 'x') o.push(`<text class="run-lab" x="${X(rn.from) + 8}" y="${Y(rn.line) - 18}" fill="${mkVar(rn.mk)}">${esc(txt)}</text>`);
        else o.push(`<text class="run-lab" transform="translate(${X(rn.line) - 18},${Y(rn.from) - 8}) rotate(-90)" fill="${mkVar(rn.mk)}">${esc(txt)}</text>`);
      });
    });
    // building columns (the ones mezzanine beams frame into carry a load to the frame — hover for it)
    const fls = bldgFrameLoads(), bcols = [];
    g.xs.filter(inX).forEach(x => { bcols.push([x, 0], [x, W]); const fi = g.xs.indexOf(x); (g.interior[fi] || []).forEach(y => bcols.push([x, y])); });
    if (inX(0)) g.lewY.forEach(y => bcols.push([0, y]));
    if (inX(L)) g.rewY.forEach(y => bcols.push([L, y]));
    (g.fswX || []).filter(inX).forEach(x => bcols.push([x, 0])); (g.bswX || []).filter(inX).forEach(x => bcols.push([x, W]));
    fls.forEach(q => { if (inX(q.x) && !bcols.some(([x, y]) => atPt({ x, y }, q))) bcols.push([q.x, q.y]); });
    bcols.filter(([, y]) => inY(y)).forEach(([x, y]) => { const ld = fls.some(q => atPt(q, { x, y }));
      o.push(`<g class="bcol-g ${ld ? 'ld' : ''}" data-tip="bcol|${x}|${y}"><circle class="hit" cx="${X(x)}" cy="${Y(y)}" r="${hitR(11)}"/><rect class="bcol" x="${X(x) - (ld ? 5 : 4)}" y="${Y(y) - (ld ? 5 : 4)}" width="${ld ? 10 : 8}" height="${ld ? 10 : 8}"/></g>`); });
    // the attached building's columns the beams frame into, with its own loads to its frames (tips by its own coordinates)
    att.forEach(m => {
      const own = ((state.job && state.job.frameLoads) || []).filter(q => q.bkey === m.bkey);
      m.layout.supports.filter(sp => sp.building).forEach(sp => {
        if (bcols.some(([x, y]) => atPt({ x, y }, sp))) return;
        const ld = own.some(q => atPt(q, { x: sp.ox, y: sp.oy }));
        o.push(`<g class="bcol-g ${ld ? 'ld' : ''}" data-tip="bcol|${sp.ox}|${sp.oy}|${m.index}"><circle class="hit" cx="${X(sp.x)}" cy="${Y(sp.y)}" r="${hitR(11)}"/><rect class="bcol" x="${X(sp.x) - (ld ? 5 : 4)}" y="${Y(sp.y) - (ld ? 5 : 4)}" width="${ld ? 10 : 8}" height="${ld ? 10 : 8}"/></g>`);
      });
    });
    // beam number tags (B1..) at mid-span, in the mark's colour — not on a beam drawn too short to carry one (a long job
    // drawn small): the tag would cover the columns at its ends; its number is in the beam's hover card
    ms.forEach(m => m.layout.beams.filter(b => !b.absorbed).forEach(b => {
      const [p, q] = b.ends, mk = mkOf(m, b.id), mc = mkVar(mk);
      const mx = (X(p.x) + X(q.x)) / 2, my = (Y(p.y) + Y(q.y)) / 2, lab = bNo(m, b.id), w = 12 + lab.length * 6.5;
      if (Math.hypot(X(q.x) - X(p.x), Y(q.y) - Y(p.y)) < w + 2 * hitR(13) + 4) return;
      o.push(`<g class="tag b ${mk && mk.kind === 'interior' ? 'int' : ''}" data-tip="beam|${m.index}|${b.id}" data-beam="${m.index}:${b.id}"><rect x="${mx - w / 2}" y="${my - 9}" width="${w}" height="18" rx="9" style="stroke:${mc}${mk && mk.kind === 'interior' ? ';fill:' + mc : ''}"/><text x="${mx}" y="${my + .5}" style="fill:${mk && mk.kind === 'interior' ? 'var(--surface)' : mc}">${lab}</text></g>`);
    }));
    // mezzanine columns, numbered once over the job (C1..) — hover for the Column-sheet left / right D and L
    ms.forEach(m => m.layout.mezzCols.forEach(c => {
      const cx = X(c.x), cy = Y(c.y), R = 8, d = R * 0.7, lab = 'C' + cno.get(c.label);
      const cd = `${c.ox ?? c.x}|${c.oy ?? c.y}|${m.index}`;
      o.push(`<g class="mcol" data-col="${cd}" data-tip="col|${cd}"><circle class="hit" cx="${cx}" cy="${cy}" r="${hitR(13)}"/><circle cx="${cx}" cy="${cy}" r="${R}"/><path d="M${cx - d},${cy - d} L${cx + d},${cy + d} M${cx - d},${cy + d} L${cx + d},${cy - d}"/></g>`);
      o.push(`<g class="tag c" data-col="${cd}" data-tip="col|${cd}"><rect x="${cx + 11}" y="${cy + 7}" width="26" height="16" rx="8"/><text x="${cx + 24}" y="${cy + 15.5}">${lab}</text></g><text class="lbl" x="${cx + 41}" y="${cy + 19}">${c.label}</text>`);
    }));
    // columns taken out on the Plan page: a ghost, click it (edit mode) to put it back
    ms.forEach(m => (m.layout.dropped || []).forEach(d => { const cx = X(d.x), cy = Y(d.y), dd = 5.6;
      o.push(`<g class="mcol dropped" data-dropped="${m.index}|${d.ox ?? d.x}|${d.oy ?? d.y}"><circle class="hit" cx="${cx}" cy="${cy}" r="${hitR(13)}"/><circle cx="${cx}" cy="${cy}" r="8"/><path d="M${cx - dd},${cy - dd} L${cx + dd},${cy + dd} M${cx - dd},${cy + dd} L${cx + dd},${cy - dd}"/><title>${esc(d.label)} taken out — the beam spans through</title></g>`); }));
    if (r.planCheck && r.planCheck.ok) r.planCheck.cols.forEach(c => o.push(`<circle class="seen" cx="${X(c.x)}" cy="${Y(c.y)}" r="14"><title>Mezzanine column on the PCS floor plan</title></circle>`));
    // joist direction, and the mezzanine's name in its first joist bay (click it to edit that mezzanine)
    ms.forEach(m => {
      const ly = m.layout, fp = ly.footprint, sp = m.beamBase.Lb, bl = ly.beamLines;
      // in the last bay: the mark labels start at the first one
      const sl = ly.supportLines || [];
      if (ly.joists === 'y') {
        const x = (Math.max(fp.x0, sl[sl.length - 2] ?? fp.x0) + fp.x1) / 2 + sp / 2, y0 = bl[0], y1 = bl[1] ?? fp.y1;
        o.push(`<line class="arrow" x1="${X(x)}" y1="${Y(y0) - 12}" x2="${X(x)}" y2="${Y(y1) + 12}" marker-start="url(#ah)" marker-end="url(#ah)"/><text class="arrow-t" x="${X(x) - 7}" y="${(Y(y0) + Y(y1)) / 2}" text-anchor="end">JOISTS @ ${ft(sp)}</text>`);
      } else {
        const y = (Math.max(fp.y0, sl[sl.length - 2] ?? fp.y0) + fp.y1) / 2 + sp / 2, x0 = bl[0], x1 = bl[1] ?? fp.x1;
        o.push(`<line class="arrow" x1="${X(x0) + 12}" y1="${Y(y)}" x2="${X(x1) - 12}" y2="${Y(y)}" marker-start="url(#ah)" marker-end="url(#ah)"/><text class="arrow-t" x="${(X(x0) + X(x1)) / 2}" y="${Y(y) - 7}" text-anchor="middle">JOISTS @ ${ft(sp)}</text>`);
      }
      if (many) {
        // in the second joist bay when there is one (the first has the joist arrow), else toward the far end of the bay
        const bi = bl.length > 2 ? 1 : 0, mid = bl.length > 1 ? (bl[bi] + bl[bi + 1]) / 2 : null, alongX = ly.joists === 'y';
        // along the beams: in the middle of a bay between support lines, clear of the columns and their tags
        const along = bi ? 0.5 : 0.7, c0 = alongX ? fp.x0 + (fp.x1 - fp.x0) * along : fp.y0 + (fp.y1 - fp.y0) * along;
        // (not mid-bay: the beam tags are there; toward the far end, away from the column tags)
        const k0 = sl.findIndex((v, i) => i < sl.length - 1 && v <= c0 && sl[i + 1] >= c0), midS = k0 >= 0 ? sl[k0] + (sl[k0 + 1] - sl[k0]) * (alongX ? 0.5 : 0.25) : c0;
        const cx = alongX ? midS : mid ?? (fp.x0 + fp.x1) / 2, cy = alongX ? mid ?? (fp.y0 + fp.y1) / 2 : midS;
        o.push(`<text class="mz-name ${m === r ? 'is-cur' : ''}" data-mezz="${m.index}" x="${X(cx)}" y="${Y(cy)}">${esc(m.id)}${m === r && state.planEdit ? ' · editing' : ''}</text>`);
      }
    });
    o.push('<g id="planCursor" class="plan-cursor"></g>');   // edit mode: the cross-hair, a dragged column, its distances
    $('#planSvg').setAttribute('viewBox', `0 0 ${VW} ${VH}`);
    $('#planSvg').innerHTML = o.join('');
    $$('#planSvg [data-beam]').forEach(el => {
      const tb = $$(`#planSvg .trib[data-band="${el.dataset.beam}"]`);   // its own floor, and a neighbour's edge it carries
      el.addEventListener('mouseenter', () => tb.forEach(x => x.classList.add('on')));
      el.addEventListener('mouseleave', () => tb.forEach(x => x.classList.remove('on')));
      el.addEventListener('click', () => { if (state.planEdit) return; const [mi, id] = el.dataset.beam.split(':').map(Number); openBeam(job.mezz[mi], id); });
    });
    $$('#planSvg [data-col]').forEach(el => { el.addEventListener('click', () => { if (state.planEdit) return; const [x, y, mi] = el.dataset.col.split('|').map(Number); openCol({ x, y, mi }); }); });
    $$('#planSvg [data-mezz]').forEach(el => { el.addEventListener('click', () => { if (!state.planEdit) switchMezz(+el.dataset.mezz); }); });
    layBarSync();
    $('#planLegend').innerHTML = marks.map(mk => `<span class="lg-mk"><svg width="26" height="12"><rect width="26" height="12" rx="2" fill="${mkVar(mk)}" opacity=".22"/><line x1="0" y1="6" x2="26" y2="6" stroke="${mkVar(mk)}" stroke-width="5"/></svg><b>${mk.mark}${mk.kind ? ' · ' + mk.kind : ''}</b> ${esc(mk.desc || 'NO SECTION')} · ${mk.qtyAll} beam${mk.qtyAll === 1 ? '' : 's'} · ${ft(mkDz(mk).span)} × ${ft(mkDz(mk).trib)}${mkDz(mk).set ? ' design' : ''}${mkShort(mk) ? ' (' + mkShort(mk) + ')' : ''}</span>`).join('') +
      `<span><svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--col)" stroke-width="2"/><path d="M4,4 L12,12 M4,12 L12,4" stroke="var(--col)" stroke-width="2"/></svg>Mezzanine column · qty ${t.nC}</span>` +
      (r.planCheck && r.planCheck.ok && r.planCheck.cols.length ? `<span><svg width="18" height="18"><circle cx="9" cy="9" r="7" fill="none" stroke="var(--steel)" stroke-width="1.6" stroke-dasharray="3 2"/></svg>Column read from the PCS drawing (${r.planCheck.cols.length})</span>` : '') +
      (ms.some(m => m.layout.beams.some(b => b.absorbed)) ? `<span><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" class="beam carried"/></svg>Edge carried by the neighbour's beam</span>` : '') +
      `<span><svg width="12" height="12"><rect width="10" height="10" x="1" y="1" fill="var(--amber)"/></svg>Building column with a load to the frame</span><span><svg width="10" height="10"><rect width="8" height="8" x="1" y="1" fill="var(--ink)"/></svg>Building column</span><span class="lg-hint">Hover any column for the dead / live it takes · hover a beam for its trib and end shear</span>`;
    // columns added on the Plan page are numbered after the drawing's, so the others keep their numbers
    { const cno = colNos(), nw = state.colBaseN && allSettings().some(layEdited) ? [...cno.values()].filter(n => n > state.colBaseN).sort((a, b) => a - b) : [];
      if (nw.length) $('#planLegend').insertAdjacentHTML('beforeend', `<span class="lg-hint">${nw.map(n => 'C' + n).join(', ')}: added on the Plan page — numbered after the ${state.colBaseN} columns before the edit, which keep their numbers</span>`); }
    // every beam of the job, with its end shear (what the columns take)
    $('#beamTable').innerHTML = `<thead><tr>${many ? '<th>Mezz.</th>' : ''}<th>Beam</th><th>Line</th><th>From → to</th><th class="num">Span</th><th class="num">Trib</th><th>Mark</th><th>Section</th><th class="num">End shear D / L (k)</th></tr></thead><tbody>` +
      ms.flatMap(m => m.layout.beams.map(b => {
        const mk = mkOf(m, b.id), fl = m.layout.joists === 'y' ? g.xLabel : g.yLabel, rx = !b.absorbed && mk && mk.sec ? DESIGN.reactions({ ...m.beamBase, L: b.span, trib: b.trib }, mk.sec) : null;
        const trib = b.extra ? `${ft(b.trib)}<small class="sub-n"> ${ft(b.tribOwn)} + ${b.extra.map(x => esc(x.mezz) + ' ' + ft(x.tribOwn)).join(' + ')}</small>` : ft(b.trib);
        return `<tr class="${b.absorbed ? 'muted' : ''}">${many ? `<td>${esc(m.id)}</td>` : ''}<td class="mono"><b>${bNo(m, b.id)}</b></td><td>${lineOf(m, b.line)}</td><td>${fl(b.from) || ft(b.from)} → ${fl(b.to) || ft(b.to)}</td><td class="num">${ft(b.span)}</td><td class="num">${trib}</td><td>${b.absorbed ? 'carried by ' + esc(b.absorbed.mezz) : mk ? `<i class="mk-dot" style="background:${mkHex(mk)}"></i>${mkName(mk)}` + (b.span < mk.span - 1e-3 ? ' <small class="sub-n">own run at ' + ft(b.span) + '</small>' : '') : ''}</td><td class="mono">${b.absorbed ? '—' : mk && mk.desc ? mk.desc : '—'}</td><td class="num">${rx ? f(rx.D, 2) + ' / ' + f(rx.L, 2) : ''}</td></tr>`; })).join('') + '</tbody>';
    // every column of the job: the Column-sheet inputs of each mezzanine column, the load to the frame at each building column
    const jcols = (job ? job.columns : []).filter(c => ms.some(m => m.index === c.owner)).sort((x, y) => (cno.get(x.label) || 0) - (cno.get(y.label) || 0));
    $('#supTable').innerHTML = `<thead><tr><th>Column</th><th>Type · beams framing in</th><th class="num">Trib area</th><th class="num">Left D / L (k)</th><th class="num">Right D / L (k)</th></tr></thead><tbody>` +
      jcols.map(c => `<tr><td class="mono"><b>C${cno.get(c.label)}</b> · ${c.label}</td><td><b style="color:var(--col)">Mezzanine column ⊗</b>${many ? ' · ' + esc(c.ownerId) : ''}${c.shared ? ' · shared' : ''}<br><small class="sub-n">${c.parts.map(p => `${p.sheetSide}: ${many ? esc(p.mezz) + ' ' : ''}${p.beam}${p.mark ? ' · ' + p.mark : ''}`).join(' · ')}</small></td><td class="num">${f(c.tribArea, 0)} ft²</td><td class="num">${f(c.DL_L, 2)} / ${f(c.LL_L, 2)}</td><td class="num">${f(c.DL_R, 2)} / ${f(c.LL_R, 2)}</td></tr>`).join('') +
      fls.filter(q => ms.some(m => q.seenIn.includes(m.index))).map(q => `<tr class="frame-row"><td class="mono">${q.label}</td><td>Building column · <b>load to the frame</b><br><small class="sub-n">${q.parts.map(p => `${many ? esc(p.mezz) + ' ' : ''}${p.beam}${p.mark ? ' · ' + p.mark : ''}`).join(' + ')}</small></td><td class="num"></td><td class="num" colspan="2"><b>D ${f(q.D, 2)} · L ${f(q.L, 2)} k</b></td></tr>`).join('') + '</tbody>';
  }

  // ---------- layout edits on the plan: a column made a frame / mezzanine column or taken out, beam and column lines
  //            added or removed. Each is a setting of that mezzanine (lines, drop, colKind), undoable, and the whole job
  //            re-designs from it: beams, columns, frame loads, seismic, the quote ----------
  const LAY_KEYS = ['xLines', 'yLines', 'drop', 'colKind', 'joists', 'ownSpan'], layUndo = [];   // ownSpan: a long beam's own mark goes with the layout it was made for
  const ptKey = (x, y) => `${(+x).toFixed(2)},${(+y).toFixed(2)}`;
  const laySnap = () => allSettings().map(st => JSON.stringify(Object.fromEntries(LAY_KEYS.filter(k => st[k] !== undefined).map(k => [k, st[k]]))));
  const layRestore = snap => allSettings().forEach((st, i) => { LAY_KEYS.forEach(k => delete st[k]); Object.assign(st, JSON.parse(snap[i] || '{}')); });
  function layDo(msg, fn) {
    if (!state.colBase || !allSettings().some(layEdited)) { state.colBase = colNosRaw(); state.colBaseN = Math.max(0, ...state.colBase.values()); }
    layUndo.push(laySnap()); if (layUndo.length > 60) layUndo.shift();
    fn(); hideLayPop(); recompute(); toast(msg);
  }
  // the lines as they are now, kept: an added or removed line edits that list
  const layFreeze = (st, ly) => { st.joists = ly.joists; st[ly.joists === 'y' ? 'yLines' : 'xLines'] = ly.beamLines.slice(); st[ly.joists === 'y' ? 'xLines' : 'yLines'] = ly.supportLines.slice(); };
  const layLine = (m, axis, v) => ((axis === 'y' ? m.grid.yLabel(v) : m.grid.xLabel(v)) ? `line ${axis === 'y' ? m.grid.yLabel(v) : m.grid.xLabel(v)}` : `${ft(v)} from the ${axis === 'y' ? 'FSW' : 'LEW'}`);
  const hideLayPop = () => { const p = $('#layPop'); if (p) { p.hidden = true; p.innerHTML = ''; } $$('#planSvg .edit-ring').forEach(e => e.remove()); };
  function layBarSync() {
    const on = !!state.planEdit;
    $('#layEdit').setAttribute('aria-pressed', on); $('#layBar').hidden = !on;
    $('#v-plan .panel.plan').classList.toggle('is-editing', on);
    $('#layUndo').disabled = !layUndo.length;
  }
  $('#layEdit').onclick = () => { state.planEdit = !state.planEdit; hideLayPop(); layBarSync(); renderPlan(); if (state.planEdit) $('#layBar').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  $('#layDone').onclick = () => { state.planEdit = false; hideLayPop(); layBarSync(); renderPlan(); };
  $('#layUndo').onclick = () => { const snap = layUndo.pop(); if (!snap) return; layRestore(snap); hideLayPop(); recompute(); toast('Undone'); };
  $('#layReset').onclick = () => layDo('Layout back to the building grid and the PCS drawing', () => { allSettings().forEach(st => LAY_KEYS.forEach(k => delete st[k])); state.colBase = null; state.colBaseN = null; });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') hideLayPop(); });
  document.addEventListener('click', ev => { const p = $('#layPop'); if (p && !p.hidden && !p.contains(ev.target) && !ev.target.closest('#planSvg')) hideLayPop(); });

  // ---- where things are while editing: a point on the plan in building feet, read from the LEW and both sidewalls ----
  function planPt(ev) {
    const svg = $('#planSvg'), q = svg.createSVGPoint(); q.x = ev.clientX; q.y = ev.clientY;
    const v = q.matrixTransform(svg.getScreenCTM().inverse()), xf = state.planXf;
    return { v, x: xf.xa + (v.x - xf.M) / xf.s, y: xf.yb - (v.y - xf.M - 12) / xf.s };
  }
  // the lines a point snaps to along an axis: the building grid and the mezzanine's beam and column lines
  const ptLines = (m, ax) => { const g = state.res.grid, ly = m && m.layout; return ax === 'x' ? [...g.xs, ...(ly ? ly.xLines : [])] : [...g.allY, ...(ly ? ly.yLines : [])]; };
  // as it would be placed: onto a line within 6", else to the inch
  const snapFt = (v, lines) => { const l = lines.filter(u => Math.abs(u - v) <= 0.5).sort((a, b) => Math.abs(a - v) - Math.abs(b - v))[0]; return l != null ? l : Math.round(v * 12) / 12; };
  // "31'-0" from the LEW (line 2)" · "76'-0" from the FSW · 26'-0" from the BSW (line B)"
  function whereTxt(x, y, g = state.res.grid) {
    const on = (arr, v) => arr.find(u => Math.abs(u - v) < 0.01), lx = on(g.xs, x), ly = on(g.allY, y);
    return { x: `${ft(x)} from the LEW${lx != null ? ` (line ${g.xLabel(lx)})` : ''}`, y: `${ft(y)} from the FSW · ${ft(g.width - y)} from the BSW${ly != null && g.yLabel(ly) ? ` (line ${g.yLabel(ly)})` : ''}` };
  }
  // the cross-hair over the plan, the distances in the edit bar and beside the point; a dragged column drawn where it goes
  function drawCursor(p, ghost) {
    const gEl = $('#planCursor'), xf = state.planXf, bar = $('#layCoord');
    if (!gEl || !xf) return;
    if (!p) { gEl.innerHTML = ''; if (bar) bar.textContent = ''; return; }
    const X = x => xf.M + (x - xf.xa) * xf.s, Y = y => xf.M + 12 + (xf.yb - y) * xf.s, w = whereTxt(p.x, p.y);
    if (bar) bar.textContent = `${ghost ? ghost + ' → ' : ''}${w.x} · ${w.y}`;
    const tx = X(p.x) + 12, right = tx + 150 > X(xf.xb);
    gEl.innerHTML = `<line x1="${X(p.x)}" y1="${Y(xf.yb)}" x2="${X(p.x)}" y2="${Y(xf.ya)}"/><line x1="${X(xf.xa)}" y1="${Y(p.y)}" x2="${X(xf.xb)}" y2="${Y(p.y)}"/>` +
      (ghost ? `<circle class="ghost" cx="${X(p.x)}" cy="${Y(p.y)}" r="9"/>` : '') +
      `<text x="${right ? X(p.x) - 12 : tx}" y="${Y(p.y) - 10}" text-anchor="${right ? 'end' : 'start'}">${ft(p.x)} · ${ft(p.y)}</text>`;
  }

  /* A mezzanine column moved to, or added at, a point on a beam line. The layout is lines, so a point on no column line
     gets a new column line through it, taken out on every other beam line; the column's old place is taken out (a column
     line with no column left on it goes). A column where the beams end can't leave — its whole column line moves
     (moveLine). Returns why not, or null once done. */
  function layColumnTo(m, from, to, name) {
    const ly = m.layout, bAx = ly.joists === 'y' ? 'y' : 'x', sAx = bAx === 'y' ? 'x' : 'y', bl = ly.beamLines, sl = ly.supportLines;
    const P = (sv, bv) => (bAx === 'y' ? { x: sv, y: bv } : { x: bv, y: sv }), wall = sAx === 'x' ? 'LEW' : 'FSW';
    const line = bl.find(u => Math.abs(u - to[bAx]) < 0.26);
    if (line == null) return `A column stands under a beam: put it on a beam line (${bl.map(v => layLine(m, bAx, v).replace(/^line /, '')).join(', ')}) or add a beam line there first.`;
    let at = to[sAx];
    if (at < sl[0] - 0.01 || at > sl[sl.length - 1] + 0.01) return `Put it between the beams' end supports, ${ft(sl[0])} to ${ft(sl[sl.length - 1])} from the ${wall}.`;
    const onLine = sl.find(u => Math.abs(u - at) < 0.26);
    if (onLine != null) at = onLine;
    else { const close = sl.find(u => Math.abs(u - at) < 1 && !(from && Math.abs(u - from[sAx]) < 0.01)); if (close != null) return `${ft(at)} is within 1'-0" of the column line at ${ft(close)} from the ${wall}: put it on that line, or further away.`; }
    const tp = P(at, line), kTo = ptKey(tp.x, tp.y), kFrom = from ? ptKey(from.x, from.y) : null;
    if (from && kFrom === kTo) return null;
    if (from) {
      const fi = sl.findIndex(u => Math.abs(u - from[sAx]) < 0.01);
      if (fi <= 0 || fi >= sl.length - 1) return `${name} is where the beams end: an end support stays. Move its whole column line instead.`;
      const owners = jobView().filter(z => !z._map && z.layout.supports.some(q => atPt(q, from)));
      if (owners.length > 1) return `${name} is shared by ${owners.map(z => z.id).join(' and ')}: change each mezzanine's lines instead.`;
    }
    const there = ly.supports.find(q => atPt(q, tp));
    if (there) return `There is a column at ${there.label} already.`;
    const w = whereTxt(tp.x, tp.y);
    layDo(`${from ? name + ' moved to' : 'Mezzanine column added at'} ${w.x}, ${w.y.split(' · ')[0]}`, () => {
      const st = allSettings()[m.index], key = sAx === 'y' ? 'yLines' : 'xLines';
      layFreeze(st, ly);
      const drop = new Set(st.drop || []);
      let lines = st[key].slice();
      if (from) drop.add(kFrom);
      if (onLine != null) drop.delete(kTo);
      else { lines.push(at); bl.forEach(u => { if (Math.abs(u - line) > 0.01) { const q = P(at, u); drop.add(ptKey(q.x, q.y)); } }); }
      lines.sort((a, c) => a - c);
      // a column line with no column left on it is gone (its "taken out" marks with it)
      const keysOn = u => bl.map(b => { const q = P(u, b); return ptKey(q.x, q.y); });
      lines = lines.filter((u, i) => { if (i === 0 || i === lines.length - 1 || !keysOn(u).every(k => drop.has(k))) return true; keysOn(u).forEach(k => drop.delete(k)); return false; });
      if (from && st.colKind && st.colKind[kFrom]) { st.colKind = { ...st.colKind, [kTo]: st.colKind[kFrom] }; delete st.colKind[kFrom]; }
      st[key] = lines;
      st.drop = [...drop]; if (!st.drop.length) delete st.drop;
    });
    return null;
  }
  // a typed position: ft-in or feet; a y from the BSW turned into one from the FSW (the wall picked beside it)
  const typedFt = raw => { const t = String(raw || '').trim(); return t === '' ? NaN : (PCS.ftin(t) ?? PCS.ftin(t + "'") ?? NaN); };
  const fromWall = (id, v) => { const sel = $('#' + id + 'W'); return sel && sel.value === 'BSW' ? state.res.grid.width - v : v; };
  const readAt = id => fromWall(id, typedFt(($('#' + id) || {}).value));
  function readXY(id) {
    const x = typedFt(($('#' + id + 'X') || {}).value), y = fromWall(id + 'Y', typedFt(($('#' + id + 'Y') || {}).value));
    if (!isFinite(x) || !isFinite(y)) { toast('Type both distances: from the LEW, and from the FSW or the BSW'); return null; }
    return { x, y };
  }
  // a whole column line moved (every column on it, the beams' ends with it when it is an end line)
  function moveLine(m, from, at) {
    const ly = m.layout, sAx = ly.joists === 'y' ? 'x' : 'y', sl = ly.supportLines, wall = sAx === 'x' ? 'LEW' : 'FSW', fp = ly.footprint;
    const i = sl.findIndex(u => Math.abs(u - from) < 0.01), lo = sAx === 'x' ? fp.x0 : fp.y0, hi = sAx === 'x' ? fp.x1 : fp.y1;
    if (i < 0 || !isFinite(at)) return 'Type where the line goes.';
    if (Math.abs(at - from) < 0.01) return null;
    if (at < lo - 3 || at > hi + 3) return `Keep the line on the mezzanine: ${ft(lo)} to ${ft(hi)} from the ${wall} (an end line up to 3'-0" in from the slab edge).`;
    const close = sl.find((u, k) => k !== i && Math.abs(u - at) < 1);
    if (close != null) return `${ft(at)} is within 1'-0" of the column line at ${ft(close)} from the ${wall}.`;
    if ((i > 0 && at <= sl[i - 1]) || (i < sl.length - 1 && at >= sl[i + 1])) return `A column line keeps its place between its neighbours (${ft(sl[i - 1] ?? lo)} and ${ft(sl[i + 1] ?? hi)} from the ${wall}) — add a column line instead.`;
    // a line whose columns another mezzanine shares (the edge between two) would split in two: each mezzanine's lines then
    const onLine = ly.supports.filter(q => Math.abs((sAx === 'x' ? q.x : q.y) - from) < 0.01);
    const others = jobView().filter(z => !z._map && z.index !== m.index && z.layout.supports.some(q => onLine.some(p => atPt(p, q))));
    if (others.length) return `${layLine(m, sAx, from).replace(/^line/, 'Line')} is shared with ${others.map(z => z.id).join(' and ')}: change each mezzanine's lines instead (support lines, above the plan).`;
    layDo(`Column line ${layLine(m, sAx, from)} moved to ${ft(at)} from the ${wall}`, () => {
      const st = allSettings()[m.index], key = sAx === 'y' ? 'yLines' : 'xLines';
      layFreeze(st, ly);
      st[key] = st[key].map(u => (Math.abs(u - from) < 0.01 ? at : u)).sort((a, c) => a - c);
      // its taken-out marks and column kinds move with it
      const mv = k => { const [x, y] = k.split(',').map(Number), v = sAx === 'x' ? x : y; if (Math.abs(v - from) >= 0.01) return k; return sAx === 'x' ? ptKey(at, y) : ptKey(x, at); };
      if (st.drop) st.drop = st.drop.map(mv);
      if (st.colKind) st.colKind = Object.fromEntries(Object.entries(st.colKind).map(([k, v]) => [mv(k), v]));
    });
    return null;
  }
  // dragging a mezzanine column along its beam (an end column takes its column line with it)
  let drag = null, dragEnd = 0;
  $('#planSvg').addEventListener('pointerdown', ev => {
    if (!state.planEdit || ev.button !== 0 || !state.job || !state.planXf) return;
    const el = ev.target.closest('[data-col]');
    if (!el) return;
    const [x, y, mi] = el.dataset.col.split('|').map(Number), m = jobView().find(z => z.index === mi);
    if (!m || m._map) return;
    const sp = m.layout.supports.find(z => atPt(z, { x, y }));
    if (!sp || sp.building) return;
    const ax = m.layout.joists === 'y' ? 'x' : 'y', sl = m.layout.supportLines, si = sl.findIndex(u => Math.abs(u - sp[ax]) < 0.01);
    drag = { m, sp, ax, end: si <= 0 || si >= sl.length - 1, from: { x: sp.x, y: sp.y }, id: ev.pointerId, start: planPt(ev), moved: false, to: null, name: `C${colNos().get(sp.label) || '?'} ${sp.label}` };
  });
  // one update a frame, with the latest pointer
  let moveEv = null;
  $('#planSvg').addEventListener('pointermove', ev => { if (!moveEv) requestAnimationFrame(() => { const e2 = moveEv; moveEv = null; onPlanMove(e2); }); moveEv = ev; });
  function onPlanMove(ev) {
    if (!ev || !state.planEdit || !state.planXf || !state.res || state.res.incomplete) return;
    const p = planPt(ev);
    if (drag) {
      if (!drag.moved && Math.hypot(p.v.x - drag.start.v.x, p.v.y - drag.start.v.y) < 5) return;
      if (!drag.moved) { drag.moved = true; hideLayPop(); try { $('#planSvg').setPointerCapture(drag.id); } catch (e) { /* the pointer is gone */ } }
      const fp = drag.m.layout.footprint, lo = drag.ax === 'x' ? fp.x0 - 3 : fp.y0 - 3, hi = drag.ax === 'x' ? fp.x1 + 3 : fp.y1 + 3;
      const v = snapFt(Math.min(hi, Math.max(lo, p[drag.ax])), ptLines(drag.m, drag.ax));
      drag.to = drag.ax === 'x' ? { x: v, y: drag.from.y } : { x: drag.from.x, y: v };
      drawCursor(drag.to, drag.end ? `${drag.name} and its column line` : drag.name);
      return;
    }
    const m = jobView().find(z => { const f2 = z.layout.footprint; return !z._map && p.x >= f2.x0 - 0.5 && p.x <= f2.x1 + 0.5 && p.y >= f2.y0 - 0.5 && p.y <= f2.y1 + 0.5; });
    drawCursor({ x: snapFt(p.x, ptLines(m, 'x')), y: snapFt(p.y, ptLines(m, 'y')) });
  }
  $('#planSvg').addEventListener('pointerleave', () => { if (!drag) drawCursor(null); });
  const endDrag = () => {
    if (!drag) return;
    if (moveEv) { const e2 = moveEv; moveEv = null; onPlanMove(e2); }   // the last move before the release, not a frame late
    const d = drag; drag = null;
    try { $('#planSvg').releasePointerCapture(d.id); } catch (e) { /* not captured */ }
    if (!d.moved) return;   // a click: the menu opens on the click
    dragEnd = Date.now(); drawCursor(null);
    if (!d.to) return;
    const err = d.end ? moveLine(d.m, d.from[d.ax], d.to[d.ax]) : layColumnTo(d.m, d.from, d.to, d.name);
    if (err) toast(err);
  };
  $('#planSvg').addEventListener('pointerup', endDrag);
  const cancelDrag = () => { if (!drag) return; try { $('#planSvg').releasePointerCapture(drag.id); } catch (e) { /* not captured */ } if (drag.moved) dragEnd = Date.now(); drag = null; drawCursor(null); };
  $('#planSvg').addEventListener('pointercancel', cancelDrag);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cancelDrag(); });   // Escape drops a drag where it started

  function layMenu(ev) {
    if (Date.now() - dragEnd < 400) return;   // the click that ends a drag
    if (!state.planEdit || !state.job || !state.planXf) return;
    const svg = $('#planSvg'), pt = planPt(ev), v = pt.v, wx = pt.x, wy = pt.y;
    const ms = jobView(), sets = allSettings(), items = [];
    const ring = (cx, cy) => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('class', 'edit-ring'); c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 17); svg.appendChild(c); };
    let head = '', where = '';
    const tgt = ev.target.closest('[data-dropped],[data-col],[data-tip^="bcol"],[data-beam]');
    hideLayPop();
    // a mezzanine of an attached building is drawn in this building's coordinates: edit it in its own — switch to it
    const tmi = !tgt ? NaN : tgt.dataset.dropped ? +tgt.dataset.dropped.split('|')[0] : tgt.dataset.col ? +tgt.dataset.col.split('|')[2] : tgt.dataset.beam ? +tgt.dataset.beam.split(':')[0] : +((tgt.dataset.tip || '').split('|')[3] ?? NaN);
    const tm = ms.find(z => z.index === tmi) || (!tgt ? ms.find(z => { const f2 = z.layout.footprint; return wx >= f2.x0 - 0.01 && wx <= f2.x1 + 0.01 && wy >= f2.y0 - 0.01 && wy <= f2.y1 + 0.01; }) : null);
    if (tm && tm._map) { switchMezz(tm.index); toast(`Editing ${tm.id} — click again to change its layout`); return; }
    if (tgt && tgt.dataset.dropped) {
      const [mi, x, y] = tgt.dataset.dropped.split('|').map(Number), m = state.job.mezz[mi], d = (m.layout.dropped || []).find(z => atPt(z, { x, y }));
      head = `${esc(d ? d.label : '')} · taken out`;
      items.push({ t: 'Put the column back', sub: 'the beam stops here again', go: () => layDo(`${d.label}: column back`, () => { const st = sets[mi]; st.drop = (st.drop || []).filter(k => k !== ptKey(x, y)); if (!st.drop.length) delete st.drop; }) });
    } else if (tgt && (tgt.dataset.col || /^bcol/.test(tgt.dataset.tip || ''))) {
      const [x, y] = (tgt.dataset.col || tgt.dataset.tip.replace(/^bcol\|/, '')).split('|').map(Number), p = { x, y };
      const owners = ms.filter(m => !m._map && m.layout.supports.some(sp => atPt(sp, p)));
      if (!owners.length) { head = 'Building column'; items.push({ t: 'No mezzanine beam frames in here', sub: 'nothing to change at this column', off: true }); }
      else {
        const m0 = owners[0], sp = m0.layout.supports.find(z => atPt(z, p)), ly = m0.layout, k = ptKey(x, y);
        // supports carry coordinates rounded to 0.001 ft (layout.js): lines are matched to 0.01 ft, as atPt does
        const along = ly.joists === 'y' ? sp.x : sp.y, si = ly.supportLines.findIndex(u => Math.abs(u - along) < 0.01), inner = si > 0 && si < ly.supportLines.length - 1;
        const cn = colNos().get(sp.label);
        head = `${sp.building ? 'Frame column' : 'Mezzanine column'}${cn && !sp.building ? ' C' + cn : ''} · ${esc(sp.label)}`;
        const user = owners.some(m => (m.layout.supports.find(z => atPt(z, p)) || {}).userKind);
        items.push(sp.building
          ? { t: user ? 'Back to a mezzanine column' : 'Make it a mezzanine column ⊗', sub: 'designed on the Column sheet; the frame takes no mezzanine load here', go: () => layDo(`${sp.label}: mezzanine column`, () => owners.forEach(m => { const st = sets[m.index], cur = (m.layout.supports.find(z => atPt(z, p)) || {}); st.colKind = { ...(st.colKind || {}) }; if (cur.userKind) delete st.colKind[k]; else st.colKind[k] = 'mezz'; if (!Object.keys(st.colKind).length) delete st.colKind; })) }
          : { t: user ? 'Back to a frame column' : 'Make it a frame column', sub: 'its beam reactions go to the frame design (FDL / FLL) — add the column in NBG Frame if the frame has none here', go: () => layDo(`${sp.label}: frame column`, () => owners.forEach(m => { const st = sets[m.index], cur = (m.layout.supports.find(z => atPt(z, p)) || {}); st.colKind = { ...(st.colKind || {}) }; if (cur.userKind) delete st.colKind[k]; else st.colKind[k] = 'frame'; if (!Object.keys(st.colKind).length) delete st.colKind; })) });
        if (inner) {
          const bs = ly.beams.filter(b => Math.abs(b.line - (ly.joists === 'y' ? sp.y : sp.x)) < 0.01 && (Math.abs(b.from - along) < 0.01 || Math.abs(b.to - along) < 0.01));
          const span = bs.reduce((a, b) => a + b.span, 0);
          items.push({ t: 'Take the column out', sub: `the beam spans through${span ? `: ${ft(span)}` : ''} — one beam instead of two`, go: () => layDo(`${sp.label}: column taken out`, () => owners.forEach(m => { const st = sets[m.index]; st.drop = [...new Set([...(st.drop || []), k])]; })) });
          items.push({ t: 'Remove the whole column line', sub: `${layLine(m0, ly.joists === 'y' ? 'x' : 'y', along)} — every beam spans through it`, go: () => layDo(`Column line removed (${layLine(m0, ly.joists === 'y' ? 'x' : 'y', along)})`, () => { const st = sets[m0.index]; layFreeze(st, ly); st[ly.joists === 'y' ? 'xLines' : 'yLines'] = ly.supportLines.filter((u, i) => i !== si); }) });
        } else items.push({ t: 'A beam ends here', sub: 'an end support stays (no cantilever) — make it a frame or a mezzanine column', off: true });
        const w = whereTxt(sp.x, sp.y), nm = `${cn && !sp.building ? 'C' + cn + ' ' : ''}${sp.label}`;
        where = `${w.x}<br>${w.y}`;
        if (!sp.building && owners.length === 1) {
          const sAx = ly.joists === 'y' ? 'x' : 'y';
          if (inner) items.push({ t: 'Move this column to', sub: 'on a beam line — the beam splits there; its old place spans through', xy: { id: 'layMv', x: sp.x, y: sp.y }, go: () => { const t2 = readXY('layMv'); if (!t2) return; const e = layColumnTo(m0, { x: sp.x, y: sp.y }, t2, nm); if (e) toast(e); } });
          items.push({ t: `Move its column line to`, sub: `every column on ${layLine(m0, sAx, along)} moves${inner ? '' : ' — the beams end there'}`, at: { id: 'layMl', v: ft(along), from: sAx === 'x' ? 'LEW' : 'FSW', W: m0.grid.width }, go: () => { const at = readAt('layMl'); const e = moveLine(m0, along, at); if (e) toast(e); } });
        }
      }
      ring(v.x, v.y);
    } else if (tgt && tgt.dataset.beam) {
      const [mi, id] = tgt.dataset.beam.split(':').map(Number), m = state.job.mezz[mi], ly = m.layout, b = ly.beams[id];
      const bi = ly.beamLines.findIndex(u => Math.abs(u - b.line) < 0.01), inner = bi > 0 && bi < ly.beamLines.length - 1, ax = ly.joists === 'y' ? 'y' : 'x';
      const mk = mkOf(m, id);
      head = `${bNo(m, id)}${mk ? ' · ' + esc(mk.mark) : ''} · ${esc(layLine(m, ax, b.line))}`;
      if (inner) items.push({ t: `Remove the beam line`, sub: `joists span ${ft(ly.beamLines[bi + 1] - ly.beamLines[bi - 1])} across it — the beams either side carry more`, go: () => layDo(`${layLine(m, ax, b.line)}: beam line removed`, () => { const st = sets[mi]; layFreeze(st, ly); st[ax === 'y' ? 'yLines' : 'xLines'] = ly.beamLines.filter((u, i) => i !== bi); }) });
      else items.push({ t: 'An edge beam stays', sub: 'it carries the slab edge', off: true });
      if (!m._map) {
        const sAx = ax === 'y' ? 'x' : 'y', clk = snapFt(Math.min(b.to, Math.max(b.from, sAx === 'x' ? wx : wy)), ptLines(m, sAx));
        items.push({ t: 'Add a mezzanine column on this beam at', sub: `${ft(b.from)} to ${ft(b.to)} from the ${sAx === 'x' ? 'LEW' : 'FSW'} — the beam splits there`, at: { id: 'layAc', v: ft(clk), from: sAx === 'x' ? 'LEW' : 'FSW', W: m.grid.width },
          go: () => { const at = readAt('layAc'); if (!isFinite(at)) { toast('Type where the column goes'); return; } const e = layColumnTo(m, null, sAx === 'x' ? { x: at, y: b.line } : { x: b.line, y: at }, ''); if (e) toast(e); } });
        where = `${ax === 'y' ? whereTxt(b.from, b.line).y : whereTxt(b.line, b.from).x}`;
      }
      items.push({ t: 'Open its calc', sub: 'the MB sheet for this mark', go: () => { hideLayPop(); openBeam(m, id); } });
    } else {
      const m = ms.find(z => { const f2 = z.layout.footprint; return wx >= f2.x0 - 0.01 && wx <= f2.x1 + 0.01 && wy >= f2.y0 - 0.01 && wy <= f2.y1 + 0.01; });
      if (!m) return;
      const ly = m.layout, bAx = ly.joists === 'y' ? 'y' : 'x', sAx = bAx === 'y' ? 'x' : 'y', snap = val => Math.round(val * 2) / 2;
      // the point clicked, or the middle of its bay when that is within 1'-0" of a line already there
      const free = (v, lines) => { if (!lines.some(u => Math.abs(u - v) < 1)) return v; const lo = Math.max(...lines.filter(u => u <= v + 1e-6)), hi = Math.min(...lines.filter(u => u > v + 1e-6)); return isFinite(lo) && isFinite(hi) ? snap((lo + hi) / 2) : v; };
      const bAt = free(snap(bAx === 'y' ? wy : wx), ly.beamLines), sAt = free(snap(sAx === 'y' ? wy : wx), ly.supportLines);
      head = `${esc(m.id)} · floor`;
      const add = (kind, inputId) => {
        const lines = kind === 'beam' ? ly.beamLines : ly.supportLines, ax = kind === 'beam' ? bAx : sAx, at = readAt(inputId);
        if (!isFinite(at) || at <= lines[0] + 1 || at >= lines[lines.length - 1] - 1) { toast(`Put it inside the mezzanine, more than 1'-0" in from its edges`); return; }
        if (lines.some(u => Math.abs(u - at) < 1)) { toast(`There is a line within 1'-0" of ${ft(at)} already`); return; }
        layDo(`${kind === 'beam' ? 'Beam' : 'Column'} line added at ${ft(at)} from the ${ax === 'y' ? 'FSW' : 'LEW'}`, () => { const st = sets[m.index]; layFreeze(st, ly); st[ax === 'y' ? 'yLines' : 'xLines'] = [...lines, at].sort((a, c) => a - c); });
      };
      items.push({ t: 'Add a beam line', sub: 'joists span shorter; new beams, and columns at their ends', at: { id: 'layAtB', v: ft(bAt), from: bAx === 'y' ? 'FSW' : 'LEW', W: m.grid.width }, go: () => add('beam', 'layAtB') });
      items.push({ t: 'Add a column line', sub: 'the beams span shorter; new columns along it', at: { id: 'layAtS', v: ft(sAt), from: sAx === 'y' ? 'FSW' : 'LEW', W: m.grid.width }, go: () => add('support', 'layAtS') });
      { const w = whereTxt(snapFt(wx, ptLines(m, 'x')), snapFt(wy, ptLines(m, 'y'))); where = `${w.x}<br>${w.y}`; }
      ring(v.x, v.y);
    }
    const pop = $('#layPop'), wrap = pop.parentElement, wr = wrap.getBoundingClientRect();
    // a y position reads from the FSW or the BSW (the wall picked beside it)
    const wallSel = (id, from) => (from === 'FSW' ? `<select id="${id}W" aria-label="measured from"><option>FSW</option><option>BSW</option></select>` : `<span>the ${from}</span>`);
    const atRow = it => `<div class="lay-at"><span>at</span><input id="${it.at.id}" value="${esc(it.at.v)}" aria-label="${esc(it.t)}"><span>from</span>${wallSel(it.at.id, it.at.from)}</div>`;
    const xyRow = it => `<div class="lay-at lay-xy"><span>x</span><input id="${it.xy.id}X" value="${esc(ft(it.xy.x))}" aria-label="distance from the LEW"><span>from the LEW</span></div><div class="lay-at lay-xy"><span>y</span><input id="${it.xy.id}Y" value="${esc(ft(it.xy.y))}" aria-label="distance from the sidewall">${wallSel(it.xy.id + 'Y', 'FSW')}</div>`;
    pop.innerHTML = `<h6>${head}</h6>${where ? `<p class="lay-where">${where}</p>` : ''}` + items.map((it, i) => `<button type="button" data-i="${i}" ${it.off ? 'disabled' : ''}>${esc(it.t)}<small>${esc(it.sub || '')}</small></button>${it.at ? atRow(it) : ''}${it.xy ? xyRow(it) : ''}`).join('');
    pop.hidden = false;
    const left = Math.min(ev.clientX - wr.left + 10, wr.width - pop.offsetWidth - 8), top = Math.min(ev.clientY - wr.top + 10, wr.height - pop.offsetHeight - 8);
    pop.style.left = Math.max(8, left) + 'px'; pop.style.top = Math.max(8, top) + 'px';
    // below the fold: open it above the click instead, and keep it in view
    if (pop.getBoundingClientRect().bottom > innerHeight - 8) pop.style.top = Math.max(8, ev.clientY - wr.top - pop.offsetHeight - 10) + 'px';
    pop.scrollIntoView({ block: 'nearest' });
    $$('#layPop button[data-i]').forEach(bt => { bt.onclick = e2 => { e2.stopPropagation(); const it = items[+bt.dataset.i]; if (it.go) it.go(); }; });
    $$('#layPop input').forEach(inp => inp.addEventListener('keydown', e2 => { if (e2.key === 'Enter') { const it = items.find(z => (z.at && z.at.id === inp.id) || (z.xy && inp.id.startsWith(z.xy.id))); if (it) it.go(); } }));
  }
  $('#planSvg').addEventListener('click', layMenu);

  // ---------- seismic: the mezzanine on the frames (EQR / EQL) and the bracing, as the IBC Seismic workbook ----------
  const SEIS_TYPE = t => (window.MZ_SEISMIC && window.MZ_SEISMIC.frameType(t)) || 'Rigid Frame';
  // ---------- the Seismic page: NBG Design Calcs (Seismic), section by section, then the loads into the files ----------
  const CODE_OPTS = [['7-16', 'ASCE 7-16 — IBC 2018 / 2021'], ['7-22', 'ASCE 7-22 — IBC 2024'], ['7-10', 'ASCE 7-10 — IBC 2012 / 2015'], ['7-05', 'ASCE 7-05 — IBC 2006 / 2009']];
  const RISK_OPTS = [['I', 'I-Low Hazard'], ['II', 'II-Standard Buildings'], ['III', 'III-Substantial Hazard'], ['IV', 'IV-Essential Facilities']];
  const WALLS = [['LEW', 'Left EW'], ['REW', 'Right EW'], ['FSW', 'Front SW'], ['BSW', 'Back SW']];
  function renderSeismic() {
    const sj = state.job && state.job.seismic, box = $('#seisInputs');
    if (!box) return;
    const clear = () => ['#seisFrames', '#seisApply', '#seisBracing', '#seisFlags', '#seisHow'].forEach(q => { $(q).innerHTML = ''; });
    if (!sj || sj.error) { $('#seisStatus').innerHTML = sj && sj.error ? `<div class="seis-msg stop">${esc(sj.notes[0].text)}</div>` : ''; box.innerHTML = '<div class="empty">Load a PCS first.</div>'; clear(); return; }
    const cfg = state.seis, d = sj.design, F2 = v => f(v, 2), F3 = v => f(v, 3), lb = v => n0(v), srcTag = o => `<small class="src src-${esc(String(o.source).replace(/\s+/g, '-'))}">${esc(o.source === 'missing' ? 'needed' : o.source)}</small>`;
    const num = (key, v, extra = '') => `<input class="seis-in ${v == null ? 'need' : ''}" data-seis="${esc(key)}" value="${v == null ? '' : +(+v).toFixed(4)}" inputmode="decimal" ${extra}>`;
    const sel = (key, val, opts) => `<select data-seis="${esc(key)}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const chk = (key, on, label, dis) => `<label class="seis-chk"><input type="checkbox" data-seis="${esc(key)}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}> <span>${label}</span></label>`;
    const I = sj.inputs, FL = sj.flags, live = sj.ok, many = sj.buildings.length > 1;
    const notes = (sj.notes || []).filter(n => n.level !== 'info').map(n => `<div class="seis-msg ${n.level}">${esc(n.text)}</div>`).join('');
    const infos = (sj.notes || []).filter(n => n.level === 'info');
    const back = state.seisRestored ? `<div class="seis-msg info">Your Seismic entries for this quote from ${esc(String(state.seisRestored))} are back. <button class="btn-ghost" id="seisForget" type="button">Clear them</button></div>` : '';
    $('#seisStatus').innerHTML = back + (sj.need.length ? `<div class="seis-msg warn"><b>Needs input:</b> ${sj.need.map(esc).join(' · ')}</div>` : '')
      + (d && d.ok ? `<div class="seis-sum"><span>ASCE ${esc(d.ed)}</span>${d.Fa != null ? `<span>Fa <b>${F3(d.Fa)}</b> · Fv <b>${F2(d.Fv)}</b></span>` : ''}<span>SMS <b>${F3(d.SMS)}</b> · SM1 <b>${F3(d.SM1)}</b></span><span>SDS <b>${F3(d.SDS)}</b> · SD1 <b>${F3(d.SD1)}</b></span><span>SDC <b>${esc(d.SDC)}</b></span><span>Ie <b>${F2(d.Ie)}</b></span><span>ρ <b>${F2(d.rho)}</b></span></div>` : '') + notes;

    // ---- the job's NBG files: a bracing run (per building) and the eScope — their code, site and roof loads ----
    const fileRows = sj.buildings.map(b => { const fx = (cfg.files || {})[b.bkey]; return fx ? `<li><b>${esc(fx.from)}</b>${many ? ` · ${esc(b.name)}` : ''}: ${esc([fx.code && `code ${fx.code}`, fx.Ss != null && `Ss ${fx.Ss} / S1 ${fx.S1}`, fx.siteClass && `site ${fx.siteClass}`, fx.roofDead != null && `roof dead ${F2(fx.roofDead)}`, fx.collateral != null && `collateral ${F2(fx.collateral)}`, fx.snow != null && `snow ${F2(fx.snow)} psf`].filter(Boolean).join(' · '))} <button class="btn-ghost sm" data-seisfile-rm="${esc(b.bkey)}">Remove</button></li>` : ''; }).join('');
    const filesBox = `<div class="seis-files"><label class="nbg-drop seis-drop" id="seisDrop"><input type="file" id="seisFile" accept=".bracing,.nbgscope" multiple><svg><use href="#i-file"/></svg><span><strong>Drop the job's bracing (.bracing) or eScope (.nbgscope) file</strong><small>the building code, Ss / S1, site class, roof dead, collateral and snow are taken from it — the bracing file also gets the mezzanine loads in step 9</small></span></label>${fileRows ? `<ul class="seis-filelist">${fileRows}</ul>` : ''}</div>`;

    // ---- 1–2: building data and seismic data (job-wide) ----
    const sig = sj.buildings.map(b => `${many ? esc(b.name) + ': ' : ''}${n0(b.mzArea)} sq ft of mezzanine in ${n0(b.bd.width * b.bd.length)} sq ft (${Math.round(100 * b.mzArea / (b.bd.width * b.bd.length))} %)${b.sigHint ? ' — over ⅓: a story under IBC 505.2.1' : ''}`).join(' · ');
    const sigOn = sj.buildings.some(b => b.significant), rigidAny = FL.roofDiaphragm === 'Rigid' || FL.mezzDiaphragm === 'Rigid';
    const seisData = `<div class="seis-group"><h4><span class="step-no sm">1</span>Building data</h4>
      <div class="seis-grid"><label><span class="lab">Building code ${srcTag(I.ed)}</span>${sel('ed', I.ed.value, CODE_OPTS)}${I.code.pcs ? `<small class="sub-n">PCS: ${esc(I.code.pcs)}${I.code.file ? ` · file: ${esc(I.code.file)}` : ''}</small>` : ''}</label></div>
      ${sj.buildings.map(b => { const bd = b.bd, g = b.g; return `<div class="seis-echo">${many ? `<b>${esc(b.name)}</b>` : ''}<span>${esc(bd.type)}</span><span>Width <b>${ft(bd.width)}</b></span><span>Length <b>${ft(bd.length)}</b></span>${bd.type === 'Gable' ? `<span>BSW distance to ridge <b>${ft(bd.dtr)}</b></span><span>BSW slope <b>${F2(g ? g.slopeBSW : bd.slope)}:12</b> · FSW <b>${g ? F2(g.slopeFSW) : '—'}:12</b></span>` : ''}<span>Eaves FSW <b>${ft(bd.eaveFSW)}</b> · BSW <b>${ft(bd.eaveBSW)}</b></span><span>Mean roof height <b>${g ? ft(g.mrh) : '—'}</b></span><small class="sub-n">PCS Box 2</small></div>${b.geoNote ? `<div class="seis-msg info">${esc(b.geoNote)}</div>` : ''}`; }).join('')}</div>
      <div class="seis-group"><h4><span class="step-no sm">2</span>Seismic data</h4><div class="seis-grid">
        <label><span class="lab">Nature of occupancy ${srcTag(I.risk)}</span>${sel('risk', I.risk.value, RISK_OPTS)}</label>
        <label><span class="lab">Site classification ${srcTag(I.siteClass)}</span>${sel('siteClass', I.siteClass.value, ['A', 'B', 'C', 'D', 'E', 'F'].map(x => [x, x]))}</label>
        <label><span class="lab">Roof level diaphragm</span>${sel('roofDiaphragm', FL.roofDiaphragm, [['Flexible', 'Flexible'], ['Rigid', 'Rigid']])}</label>
        <label><span class="lab">Mezzanine level diaphragm</span>${sel('mezzDiaphragm', FL.mezzDiaphragm, [['None', 'None'], ['Flexible', 'Flexible'], ['Rigid', 'Rigid']])}</label>
        <label><span class="lab">Short period, Ss ${srcTag(I.Ss)}</span>${num('Ss', I.Ss.value)}</label>
        <label><span class="lab">1-sec period, S1 ${srcTag(I.S1)}</span>${num('S1', I.S1.value)}</label>
        ${I.ed.value === '7-22' ? `<label><span class="lab">SMS (hazard tool) ${srcTag(I.SMS)}</span>${num('SMS', I.SMS.value)}</label><label><span class="lab">SM1 (hazard tool) ${srcTag(I.SM1)}</span>${num('SM1', I.SM1.value)}</label>` : ''}
      </div><div class="seis-grid seis-checks">
        ${chk('ndfs', FL.ndfs, `Default to use "Not Detailed for Seismic" SFRS <small class="sub-n">R = 3 in SDC A–C</small>`)}
        ${chk('significant', sigOn, `Significant mezzanine exists <small class="sub-n">${esc(sig)}. Checked: the vertical distribution, k from Ta (12.8.3); unchecked (NBG Design Calcs' default): each weight takes Cs × W, k = 0</small>`)}
        ${chk('irregular', FL.irregular, 'Seismic irregularities exist')}
        ${chk('torsionLong', FL.torsionLong, `Use accidental torsion in long. direction <small class="sub-n">1.1 on the bracing's ${rigidAny ? 'rigid' : ''} diaphragm force — only with a rigid roof or mezzanine diaphragm</small>`)}
        ${chk('torsionLat', FL.torsionLat, 'Use accidental torsion in lateral direction')}
      </div></div>`;
    // ---- 3–6 per building: roof loading, walls, mezzanine loads, force resisting systems ----
    const bldg = sj.buildings.map(b => {
      const k = 'b.' + b.bkey, ffl = ((cfg.buildings || {})[b.bkey] || {}).frameFile, bw = ((cfg.buildings || {})[b.bkey] || {}).walls || {};
      const roofT = `<div class="seis-group"><h4><span class="step-no sm">3</span>Roof loading${many ? ` — ${esc(b.name)}` : ''}</h4><div class="seis-grid">
          <label><span class="lab">Lateral frame self-weight, SW (psf) ${srcTag(b.roof.SW)}</span>${num(k + '.SW', b.roof.SW.value)}</label>
          <label><span class="lab">Roof dead load, RDL (psf) ${srcTag(b.roof.RDL)}</span>${num(k + '.RDL', b.roof.RDL.value)}${b.roof.RDL.source === 'frame file' && ffl ? `<small class="sub-n">from ${esc(ffl.from)}</small>` : b.roof.RDL.value == null ? '<small class="sub-n">"Per Seller" on the PCS — drop the bracing or frame files, or type it</small>' : ''}</label>
          <label><span class="lab">Roof collateral load, CDL (psf) ${srcTag(b.roof.CDL)}</span>${num(k + '.CDL', b.roof.CDL.value)}</label>
          <label><span class="lab">Roof self-weight — bracing, beams (psf) ${srcTag(b.roof.RSW)}</span>${num(k + '.RSW', b.roof.RSW.value)}</label>
          <label><span class="lab">Roof snow, Pf (psf) ${srcTag(b.roof.Pf)}</span>${num(k + '.Pf', b.roof.Pf.value)}<small class="sub-n">${I.ed.value === '7-22' ? '15 % in the weight when over 45 psf (ASCE 7-22)' : '20 % in the weight when over 30 psf'}</small></label>
        </div></div>`;
      const wallT = `<div class="seis-group"><h4><span class="step-no sm">4</span>Walls${many ? ` — ${esc(b.name)}` : ''}</h4><div class="table-wrap"><table class="fl-t seis-wall-t"><thead><tr><th>Wall</th><th>Height</th><th>Self supporting shear wall</th><th>Parapet</th><th class="num">Top elevation</th><th class="num">Wall weight (psf)</th><th class="num">Top of masonry</th><th class="num">Lower wall weight (psf)</th></tr></thead><tbody>${WALLS.map(([key, lab]) => {
          const w = b.walls[key] || {}, t = bw[key] || {}, part = w.kind === 'partial', end = key === 'LEW' || key === 'REW';
          return `<tr><td><b>${esc(lab)}</b></td><td>${sel(`${k}.walls.${key}.kind`, w.kind || 'full', [['full', 'Full height wall'], ['partial', 'Partial height hardwall']])}</td>
            <td>${chk(`${k}.walls.${key}.shear`, w.shear, `<small class="sub-n">${end ? 'left out of the end frame' : 'left out of the bracing'}</small>`)}</td><td>${chk(`${k}.walls.${key}.parapet`, w.parapet, '')}</td>
            <td class="num">${w.parapet || part ? num(`${k}.walls.${key}.top`, t.top != null ? t.top : w.top) : `<span class="mono">${ft(w.top)}</span><small class="sub-n">${end ? 'the roof line' : 'the eave'}</small>`}</td>
            <td class="num">${num(`${k}.walls.${key}.${part ? 'upperWeight' : 'weight'}`, part ? w.upperWeight : w.weight)}</td>
            <td class="num">${part ? num(`${k}.walls.${key}.masonryTop`, w.masonryTop) : '—'}</td><td class="num">${part ? num(`${k}.walls.${key}.lowerWeight`, w.lowerWeight) : '—'}</td></tr>`; }).join('')}</tbody></table></div>
          <small class="sub-n">3 psf metal panel, full height: an endwall to the roof line, a sidewall to its eave. A parapet runs the wall to the top elevation typed; a partial height hardwall is masonry to its top with the panel above.</small></div>`;
      const mzT = `<div class="seis-group"><h4><span class="step-no sm">5</span>Mezzanine loads${many ? ` — ${esc(b.name)}` : ''}</h4><div class="table-wrap"><table class="fl-t seis-mz"><thead><tr><th>Mezzanine</th><th class="num">Elevation</th><th>Floor dead (psf)</th><th class="num">Floor collateral</th><th class="num">Est. joist weight</th><th>Storage loading · floor live</th><th>Partition loading</th><th class="num">Seismic psf</th><th class="num">W (lb)</th></tr></thead><tbody>${b.mezz.map(m => `<tr>
          <td><b>${esc(m.id)}</b><small class="sub-n">${n0(m.area)} sq ft${m.useText ? ' · ' + esc(m.useText) : ''}</small></td><td class="num mono">${ft(m.elev)}</td>
          <td>${num('m.' + m.id + '.FDL', m.FDL)}<small class="src src-${esc(m.FDLsrc)}">${esc(m.FDLsrc === 'missing' ? 'needed' : m.FDLsrc)}</small>${m.FDLsrc === 'design' && m.framing ? `<small class="sub-n">${F2(m.dead)} floor + ${F2(m.framing)} beams and columns</small>` : m.framing == null && m.framingWaits ? `<small class="sub-n ng">framing not known — ${esc(m.framingWaits.join(', '))} ${m.framingWaits.length > 1 ? 'have' : 'has'} no section</small>` : ''}</td>
          <td class="num">${num('m.' + m.id + '.FLC', m.FLC)}</td><td class="num">${num('m.' + m.id + '.FLJ', m.FLJ)}</td>
          <td>${chk('m.' + m.id + '.storage', m.storage, '')}${num('m.' + m.id + '.FLL', m.FLL, m.storage ? '' : 'disabled')}<small class="sub-n">${m.storage ? `25 % = ${F2(0.25 * m.FLL)} psf in the weight` : 'not storage: no live in the weight'}</small></td>
          <td>${chk('m.' + m.id + '.partition', m.partition, '')}${num('m.' + m.id + '.FLP', m.FLP, m.partition ? '' : 'disabled')}</td>
          <td class="num mono"><b>${m.psf == null ? '—' : F2(m.psf)}</b></td><td class="num mono">${m.psf == null ? '—' : lb(m.psf * m.area)}</td></tr>`).join('')}</tbody></table></div>
          <small class="sub-n">Floor dead is the design's dead load with this design's beams and half its columns; type your own (e.g. 10) to use it as it is.</small></div>`;
      const sysT = `<div class="seis-group"><h4><span class="step-no sm">6</span>Seismic force resisting systems${many ? ` — ${esc(b.name)}` : ''}</h4><div class="seis-grid">
          <label><span class="lab">FSW force resisting system <small class="sub-n">longitudinal</small></span>${sel(k + '.sfrs.FSW', b.sfrs.FSW, RUN.SEIS_SYSTEMS.map(x => [x, x.replace('X-Bracing', 'X - Bracing')]))}</label>
          <label><span class="lab">BSW force resisting system <small class="sub-n">longitudinal</small></span>${sel(k + '.sfrs.BSW', b.sfrs.BSW, RUN.SEIS_SYSTEMS.map(x => [x, x.replace('X-Bracing', 'X - Bracing')]))}</label></div>
          <div class="table-wrap"><table class="fl-t seis-lines"><thead><tr><th>Frameline</th><th>Seismic force resisting system <small class="sub-n">lateral · PCS Box 5</small></th><th class="num">Tributary width</th></tr></thead><tbody>${b.lines.length ? b.lines.map(l => `<tr><td><b class="mono">Line ${esc(l.label)}</b><small class="sub-n">${esc(l.bayType)}</small></td><td>${sel(`${k}.lines.${l.label}`, l.type, RUN.LINE_SYSTEMS.map(x => [x, x]))}</td><td class="num mono">${ft(l.bay)}</td></tr>`).join('') : '<tr><td colspan="3" class="sub-n">The frame lines follow once the inputs above are complete.</td></tr>'}</tbody></table></div></div>`;
      return roofT + wallT + mzT + sysT;
    }).join('');
    box.innerHTML = filesBox + seisData + bldg;

    // ---- 7: lateral calculations — NBG Frame, every frame line ----
    const factorsT = (fa, R) => `<div class="seis-factors">${[['Ie', F2(fa.Ie)], fa.Fa != null && ['Fa', F2(fa.Fa)], fa.Fv != null && ['Fv', F2(fa.Fv)], ['Sms', F3(fa.Sms)], ['Sm1', F3(fa.Sm1)], ['Sds', F3(fa.Sds)], ['Sd1', F3(fa.Sd1)], ['SDC', esc(fa.SDC)], ['R', +fa.R.toFixed(2)], ['Ω0', +fa.Om.toFixed(2)], ['Cd', +fa.Cd.toFixed(2)], ['Ct', fa.Ct ? f(fa.Ct, 3) : '—'], ['Ta', F3(fa.Ta)], ['ρ', F3(fa.rho)], ['k', F3(fa.k)], ['Cs', `<b>${F3(R.Cs)}</b>`]].filter(Boolean).map(([a, v]) => `<span>${a} <b>${v}</b></span>`).join('')}<small class="sub-n">Cs by ${esc(R.cs.governs)}${R.cs.note ? ' · ' + esc(R.cs.note) : ''} · ${esc(R.sys.label)}${R.sys.via ? ' (the least R of the lines, 12.2.3.3)' : ''}</small></div>`;
    const distT = R => `<table class="fl-t seis-dist"><thead><tr><th>Portion of the structure</th><th class="num">Eff. seismic weight (lb)</th><th class="num">Elevation hx (ft)</th><th class="num">Vertical dist. factor</th><th class="num">Fx (kips)</th><th class="num">Mx (ft-kips)</th></tr></thead><tbody>${R.rows.map(r => `<tr class="${r.key === 'mezz' ? 'mz' : ''}"><td>${esc(r.name)}${r.key === 'mezz' ? ` <small class="sub-n">${n0(r.area)} sq ft × ${F2(r.psf)} psf</small>` : r.excluded ? ' <small class="sub-n">shear wall — left out</small>' : ''}</td><td class="num mono">${lb(r.W)}</td><td class="num mono">${F2(r.h)}</td><td class="num mono">${lb(r.num)}</td><td class="num mono"><b>${F2(r.Fx)}</b></td><td class="num mono">${F2(r.Mx)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Totals</td><td class="num mono">${lb(R.totals.W)}</td><td></td><td class="num mono">${lb(R.totals.num)}</td><td class="num mono"><b>${F2(R.totals.Fx)}</b></td><td class="num mono">${F2(R.totals.Mx)}</td></tr></tfoot></table>`;
    const concT = cs => cs.map(c => `<span class="seis-conc ${c.key === 'mezz' ? 'mz' : ''}">${esc(c.key === 'mezz' || c.key === 'crane' ? c.name.replace(' Loads', '') : c.name)} <b>${F2(c.F)} k</b> at ${ft(c.at)}</span>`).join('');
    $('#seisFrames').innerHTML = !live ? '<div class="empty">Complete the inputs above.</div>' : sj.buildings.map(b => {
      if (!b.lines.length) return '';
      const ids = b.mezz.map(m => m.id);
      return `${many ? `<h4 class="seis-bh">${esc(b.name)}</h4>` : ''}<div class="table-wrap"><table class="fl-t seis-frames"><thead><tr><th>Frameline</th><th>System</th><th class="num">Trib. width</th>${ids.map(id => `<th class="num">${esc(id)} loading area</th>`).join('')}<th class="num">Cs</th><th class="num">Roof weight <small class="sub-n">alt.</small></th><th>Frame concentrated loads</th><th class="num">Base shear</th><th></th></tr></thead><tbody>${b.lines.map(l => { const L = l.lat, u = L.frame, fr = b.frames.find(x => x.label === l.label); return `<tr class="seis-fr ${fr ? 'has-mz' : ''}" data-fr="${esc(b.bkey + '|' + l.label)}">
        <td><b class="mono">${esc(l.label)}</b><small class="sub-n">${esc(l.bayType)}</small></td><td>${esc(l.type)}<small class="sub-n">${esc(L.sys.label)} · R ${+L.R.toFixed(2)}</small></td><td class="num mono">${ft(l.bay)}</td>
        ${ids.map(id => `<td class="num mono">${l.areas[id] ? n0(l.areas[id]) : '—'}</td>`).join('')}<td class="num mono">${F3(L.Cs)}</td>
        <td class="num mono">${F2(u.roofPsf)} psf<small class="sub-n">${F2(u.altRoofPsf)} psf</small></td><td class="seis-concs">${concT(u.conc)}</td><td class="num mono"><b>${F2(L.V)}</b> k</td>
        <td>${fr ? wbBtn(`seismic|${b.bkey}|${l.label}`, 'Workbook') : ''}</td></tr>
        <tr class="seis-dist-row" hidden><td colspan="${8 + ids.length}"><div class="seis-dist-wrap">${factorsT(L.factors, L)}${distT(L)}
          <div class="seis-out"><b>For NBG Frame</b> — roof seismic weight <b>${F2(u.roofPsf)} psf</b> (alt. ${F2(u.altRoofPsf)} psf with the sidewalls) with seismic factor <b>${F3(u.factor)}</b>; panel load ${f(u.panel, 4)} klf (alt. ${f(u.altPanel, 4)}); equivalent roof force ${F2(u.equivRoof)} k. Concentrated: ${u.conc.map(c => `${esc(c.name.replace(' Loads', ''))} ${F2(c.F)} k at ${ft(c.at)}`).join(' · ')}.${fr && fr.loose.length ? `<div class="bad">${fr.loose.map(x => `${esc(x.id)} ${F2(x.F)} k has no frame column on this line — ${esc(x.why)}`).join('<br>')}</div>` : ''}</div></div></td></tr>`; }).join('')}</tbody></table></div>`;
    }).join('') + (live && infos.length ? `<div class="seis-notes"><b>Notes</b><ul>${infos.map(n => `<li>${esc(n.text)}</li>`).join('')}</ul></div>` : '');
    $$('#seisFrames .seis-fr').forEach(tr => { tr.onclick = ev => { if (ev.target.closest('button')) return; const nx = tr.nextElementSibling; nx.hidden = !nx.hidden; tr.classList.toggle('open', !nx.hidden); }; });

    // ---- 8: into NBG Frame — one row per frame line × column × level; Applied is what the files get ----
    const nEdit = Object.keys(cfg.eqOverride || {}).length, scale = cfg.eqScale > 0 ? +cfg.eqScale : 1;
    const usedKeys = new Set(live ? sj.buildings.flatMap(b => b.frames.flatMap(fr => fr.eqs.map(e => e.key))) : []);
    const stale = Object.keys(cfg.eqOverride || {}).filter(k => !usedKeys.has(k)).length;
    const fileFor = (b, fr) => state.nbg.files.find(x => x.ff && (!x.ff.info.building || sameName(x.ff.info.building, b.name) || !many) && parseLines(x.lines).map(String).includes(String(fr.label)));
    $('#seisApply').innerHTML = !live ? '<div class="empty">Complete the inputs above.</div>' : `<div class="eq-bar"><label>All loads × <input class="seis-in" data-seis="eqScale" value="${scale}" inputmode="decimal"></label>
        <span>Type a value in <b>Applied</b> to use your own load for that column (↺ goes back). The multiplier changes every calculated load. What this table shows is exactly what goes into the frame files: EQR = +Applied, EQL = −Applied, on that member at the mezzanine level.${nEdit - stale ? ` <b>${nEdit - stale} typed.</b>` : ''}${stale ? ` <b class="bad">${stale} typed value${stale > 1 ? 's' : ''} no longer match${stale > 1 ? '' : 'es'} a column — not used.</b>` : ''}</span>
        <button class="btn-ghost" id="eqResetAll" ${nEdit || scale !== 1 ? '' : 'disabled'}>Back to the calculated loads</button></div>` + sj.buildings.map(b => {
      const rows = b.frames.flatMap(fr => {
        const byKey = new Map();
        fr.eqs.forEach(e => { const r = byKey.get(e.key) || { fr, e, F: 0, calc: 0, mezz: [], shares: [], edited: null }; r.F += e.F; r.calc += e.calc; r.mezz.push(e.mezz); r.shares.push(e.share); r.edited = r.edited || e.edited; byKey.set(e.key, r); });
        return [...byKey.values()].concat(fr.loose.map(l => ({ fr, loose: l })));
      });
      if (!rows.length) return '';
      return `${many ? `<h4 class="seis-bh">${esc(b.name)}</h4>` : ''}<div class="table-wrap"><table class="fl-t seis-apply"><thead><tr><th>Frame line</th><th>Column</th><th>NBG Frame member</th><th class="num">At</th><th>From</th><th class="num">Calculated (k)</th><th class="num">Applied (k)</th><th>In the frame file</th></tr></thead><tbody>${rows.map(r => {
        if (r.loose) return `<tr class="bad-row"><td class="mono"><b>${esc(r.fr.label)}</b></td><td colspan="7"><span class="bad">${esc(r.loose.id)} ${F2(r.loose.F)} k — no frame column on this line: ${esc(r.loose.why)}. Brace the mezzanine here (independent X-bracing) or carry it to the next frames.</span></td></tr>`;
        const e = r.e, it = fileFor(b, r.fr), from = r.mezz.map((m, i) => `${m} ${Math.round(r.shares[i] * 100)} %`).join(' + ') + (r.edited === 'typed' ? ' · typed' : '');
        return `<tr class="${r.edited ? 'is-' + r.edited : ''}" data-fr="${esc(b.bkey + '|' + r.fr.label)}" data-member="${esc(e.member)}"><td class="mono"><b>${esc(r.fr.label)}</b></td><td class="mono">${esc(e.label)}</td><td class="mono"><b>${esc(e.member)}</b></td><td class="num mono">${ft(e.at)}</td>
          <td class="sub-n">${esc(from)}${r.edited !== 'typed' && r.shares.some(x => x < 0.999) ? ` <small>of the frame's ${esc(r.mezz.join(' / '))} load (${cfg.split === 'equal' ? 'equally' : 'by dead load'})</small>` : ''}</td>
          <td class="num mono">${F2(r.calc)}</td>
          <td class="num"><span class="eq-edit ${r.edited ? 'is-' + r.edited : ''}">± <input class="seis-in eq-in" data-eqkey="${esc(e.key)}" value="${f(r.F, 3)}" inputmode="decimal" title="kips — EQR +, EQL −">${r.edited === 'typed' ? `<button class="eq-x" data-eqclear="${esc(e.key)}" title="back to the calculated load">↺</button>` : ''}</span>${r.edited ? `<small class="sub-n eq-tag">${r.edited === 'typed' ? 'typed' : '× ' + scale}</small>` : ''}</td>
          <td>${it ? `<small class="mono">${esc(outName(it, parseLines(it.lines)))}</small><small class="sub-n">EQR +${F2(r.F)} / EQL −${F2(r.F)}</small>` : '<small class="sub-n">drop its .frame file on the Plan page</small>'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    }).join('');
    $$('#seisApply [data-eqkey]').forEach(el => { el.onchange = () => setEq([el.dataset.eqkey], el.value); });
    $$('#seisApply [data-eqclear]').forEach(el => { el.onclick = ev => { ev.stopPropagation(); setEq([el.dataset.eqclear], ''); }; });
    const ra = $('#eqResetAll');
    if (ra) ra.onclick = () => { delete state.seis.eqOverride; delete state.seis.eqScale; seisSave(); recompute(); toast('EQ loads back to the calculated values'); };

    // ---- 9: longitudinal — NBG Bracing, and the loads into the bracing file ----
    $('#seisBracing').innerHTML = !live ? '<div class="empty">Complete the inputs above.</div>' : sj.buildings.map(b => {
      const G = b.long;
      if (!G) return '';
      const u = G.bracing, bf = (state.bracing || {})[b.bkey], plan = bracingPlan(b);
      const tor = u.torsionMezz > 1 || u.torsionRoof > 1;
      const fileUI = !zipIO.ok ? '<div class="seis-msg warn">This browser cannot open .bracing files — use a current Chrome or Edge.</div>'
        : !bf ? `<div class="seis-msg info">Drop this building's <b>.bracing</b> file in step 1 (or here) to have the mezzanine loads and the strut line written into it. <label class="btn-soft sm seis-pick">Choose the .bracing file<input type="file" class="seis-file-in" accept=".bracing" hidden></label></div>`
          : `<div class="seis-bfile"><div class="seis-bfile-h"><b class="mono">${esc(bf.name)}</b> <small class="sub-n">${esc(bf.file.info.run || '')} · NBG Bracing ${esc(bf.file.info.version || '')} · ${bf.file.info.lines.length} frame lines · braced bays: ${['FSW', 'BSW'].map(w => `${w} ${(bf.file.info.walls[w] ? bf.file.info.walls[w].bays.filter(x => x.braced).map(x => `${lineName(bf, x.from)}–${lineName(bf, x.to)}`).join(', ') : '') || 'none'}`).join(' · ')}</small>${bf.file.info.loads.filter(x => x.name === BRF.LOAD_NAME).length ? `<small class="sub-n">${bf.file.info.loads.filter(x => x.name === BRF.LOAD_NAME).length} "Mezz. Seismic" loads in it now (${bf.file.info.loads.filter(x => x.name === BRF.LOAD_NAME).map(x => `${x.caseId} ${x.F > 0 ? '+' : ''}${f(x.F, 3)} line ${lineName(bf, x.line)} @ ${f(x.elev, 2)}'`).join(' · ')}) — replaced by these</small>` : ''}</div>
            <div class="table-wrap"><table class="fl-t seis-bload"><thead><tr><th>Load name</th><th>Load case</th><th>Panel</th><th>Frame line</th><th>Grid line</th><th class="num">Elevation</th><th class="num">Magnitude (kips)</th><th>Direction</th></tr></thead><tbody>${plan.loads.map(l => `<tr><td>${esc(BRF.LOAD_NAME)}</td><td class="mono"><b>${l.caseId}</b></td><td>Wall ${bf.file.info.walls[l.wall].plane + 1} <small class="sub-n">${l.wall}</small></td><td class="mono">${esc(l.lineName)}</td><td class="mono">${String.fromCharCode(65 + (bf.file.info.walls[l.wall].grid || 0))}</td><td class="num mono">${f(l.elev, 3)}</td><td class="num mono"><b>${f(l.F, 3)}</b></td><td>X - Longitudinal</td></tr>`).join('')}</tbody></table></div>
            <div class="seis-strut">${chk('strutLine', cfg.strutLine !== false, `<b>Add the wall strut line${plan.struts.length > 1 ? 's' : ''}</b> — ${plan.struts.map(s => `Wall ${bf.file.info.walls[s.wall].plane + 1} (${s.wall}), frame line ${esc(s.fromName)} to ${esc(s.toName)}, at ${f(s.elev, 3)} ft${s.bay ? ` <small class="sub-n">to the braced bay ${esc(s.bay)}</small>` : ''}`).join(' · ') || 'none needed'}`)}<small class="sub-n">As Tools → Add Wall Strut Line does, so the loads have joints at the mezzanine level. New: if NBG Bracing does not take it, untick it and add the strut line there by hand.</small></div>
            ${plan.notes.map(t => `<div class="seis-msg warn">${esc(t)}</div>`).join('')}
            <div class="seis-bfile-a"><button class="btn-soft" data-brdl="${esc(b.bkey)}" ${plan.loads.length ? '' : 'disabled'}><svg><use href="#i-file"/></svg>Download ${esc(bracingOutName(bf))}</button><button class="btn-ghost" data-brrm="${esc(b.bkey)}">Remove the file</button><small class="sub-n">The model is left as it is apart from these loads and the strut line; open it in NBG Bracing and design.</small></div></div>`;
      return `${many ? `<h4 class="seis-bh">${esc(b.name)}</h4>` : ''}
      <div class="seis-sum"><span>${esc(G.sys.label)} · R <b>${+G.R.toFixed(2)}</b></span><span>Ta <b>${F3(G.Ta)}</b> s · k <b>${F3(G.k)}</b></span><span>Cs <b>${F3(G.Cs)}</b></span><span>Base shear <b>${F2(G.V)} k</b></span><span>FSW ${esc(b.sfrs.FSW)} · BSW ${esc(b.sfrs.BSW)}</span></div>
      <div class="table-wrap"><table class="fl-t seis-bvals"><thead><tr><th colspan="2">For NBG Bracing — bracing uniform loads</th><th colspan="2">Bracing concentrated loads</th></tr></thead><tbody>
        <tr><td>Roof snow</td><td class="num mono">${F2(u.snow)} psf</td><td rowspan="5" colspan="2"><div class="seis-concs">${concT(u.conc)}</div>${tor ? `<small class="sub-n">${u.torsionMezz > 1 ? 'mezzanine force × 1.1 (accidental torsion, rigid mezzanine diaphragm)' : ''}${u.torsionRoof > 1 ? ' · seismic factor × 1.1 (rigid roof diaphragm)' : ''}</small>` : ''}</td></tr>
        <tr><td>Roof dead</td><td class="num mono">${F2(u.deadPsf)} psf</td></tr><tr><td>Roof total</td><td class="num mono"><b>${F2(u.totalPsf)} psf</b></td></tr><tr><td>Alt. roof total <small class="sub-n">with the sidewalls</small></td><td class="num mono">${F2(u.altTotalPsf)} psf</td></tr><tr><td>Seismic factor</td><td class="num mono"><b>${F3(u.factor)}</b></td></tr></tbody></table></div>
      <details class="seis-d"><summary>Seismic factors and the multistory distribution</summary>${factorsT(G.factors, G)}${distT(G)}</details>
      <div class="table-wrap"><table class="fl-t"><thead><tr><th>Line at the mezzanine level</th><th>Along</th><th>Holds it</th><th class="num">Seismic (k)</th><th class="num">1 % (FDL+FLL) (k)</th><th class="num">Design (k)</th></tr></thead><tbody>${b.braceLines.map(l => `<tr class="${l.independent ? 'indep' : ''}"><td><b>${esc(l.edge)}</b><small class="sub-n">${esc(l.mezz.join(' + '))} · at ${ft(l.at)}</small></td><td class="mono">${l.segs.map(([a, c]) => `${ft(a)} – ${ft(c)}`).join(', ')}</td><td>${esc(l.element)}</td><td class="num mono">${F2(l.F)}</td><td class="num mono">${l.independent ? F2(l.stab) : '—'}</td><td class="num mono"><b>${F2(l.design)}</b><small class="sub-n">${esc(l.governs)}</small></td></tr>`).join('')}</tbody></table></div>
      <small class="sub-n">The mezzanine floor spans across the building between these lines (lever rule): a sidewall line is the building's bracing, loaded at the mezzanine level; any other line needs independent X-bracing, for the larger of the seismic and the DM's 1 % stability force.</small>
      ${fileUI}`;
    }).join('');
    $$('#seisBracing [data-brdl]').forEach(btn => { btn.onclick = async () => { const b = sj.buildings.find(x => x.bkey === btn.dataset.brdl), bf = state.bracing[b.bkey], plan = bracingPlan(b); try { const o = await BRF.write(bf.file, { loads: plan.loads, struts: cfg.strutLine === false ? [] : plan.struts }, zipIO); cpSave(o.bytes, bracingOutName(bf), 'application/octet-stream'); toast(`${bracingOutName(bf)} — ${o.added.loads} Mezz. Seismic loads${o.replaced ? ` (in place of ${o.replaced})` : ''}${cfg.strutLine === false ? '' : `, ${o.added.struts} strut${o.added.struts === 1 ? '' : 's'} added${o.kept.struts ? `, ${o.kept.struts} already there` : ''}`}`); } catch (e) { console.error(e); toast('Bracing file: ' + e.message, 'bad'); } }; });
    $$('#seisBracing [data-brrm]').forEach(btn => { btn.onclick = () => { delete state.bracing[btn.dataset.brrm]; renderSeismic(); }; });
    $$('#v-seismic .seis-file-in, #seisFile').forEach(inp => { inp.onchange = () => { addSeisFiles(Array.from(inp.files || [])); inp.value = ''; }; });
    const sd = $('#seisDrop');
    if (sd && !sd.dataset.wired) {
      sd.dataset.wired = '1';
      ['dragenter', 'dragover'].forEach(ev => sd.addEventListener(ev, e => { e.preventDefault(); sd.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach(ev => sd.addEventListener(ev, e => { e.preventDefault(); sd.classList.remove('is-over'); }));
      sd.addEventListener('drop', e => addSeisFiles(Array.from(e.dataTransfer.files || [])));
    }
    $$('[data-seisfile-rm]').forEach(btn => { btn.onclick = () => { const k = btn.dataset.seisfileRm; if (state.seis.files) delete state.seis.files[k]; if (state.bracing) delete state.bracing[k]; seisSave(); recompute(); }; });

    // ---- what the tool does beyond NBG Design Calcs ----
    const flags = [];
    if (live) {
      const fOn = sj.buildings.some(b => b.mezz.some(m => m.framing > 0 && m.FDLsrc === 'design'));
      flags.push(`<b>Framing weight in the floor dead.</b> ${fOn ? `${sj.buildings.flatMap(b => b.mezz.filter(m => m.framing > 0 && m.FDLsrc === 'design').map(m => `${esc(m.id)}: ${F2(m.dead)} + ${F2(m.framing)} psf for this design's beams and half its columns = ${F2(m.FDL)}`)).join(' · ')}.` : 'Off — the floor dead is used as typed.'} ${chk('framingAll', fOn, 'add the framing weight')} — untick, or type the floor dead in step 5, when yours already includes it.`);
      if (sj.buildings.some(b => b.sigHint && !b.significant)) flags.push(`<b>Significant mezzanine?</b> ${sj.buildings.filter(b => b.sigHint && !b.significant).map(b => `${esc(b.name)}: ${n0(b.mzArea)} sq ft of mezzanine is over a third of the building's ${n0(b.bd.width * b.bd.length)} sq ft — a story under IBC 505.2.1`).join(' · ')}. Left unchecked as NBG Design Calcs leaves it; check it in step 2 for the vertical distribution.`);
      flags.push(`<b>Loading areas.</b> Each frame line's mezzanine loading area is the floor inside its strip (half the bay each side, an end frame half the end bay), from the layout.`);
      flags.push(`<b>Each frame's mezzanine load split between its columns</b> ${sel('split', cfg.split || 'dead', [['dead', 'by the dead load each column takes'], ['equal', 'equally']])} — or type each column's load in step 8.`);
      flags.push(`<b>Bracing lines.</b> The split of the bracing force to the lines that hold the floor, the EQB / EQF rows and the strut line, and the DM 15.1.3 1 % check for independent bracing, are the tool's own — NBG Design Calcs gives the total.`);
      flags.push(`<b>EQR Ecc. Loc.</b> ${brCode().code ? `Bottom/Right = code ${esc(brCode().code)} (${brCode().how}).` : 'Written Top/Left (as NBG Frame writes its own lean-to seismic rows) until the Bottom/Right code is confirmed on the Plan page — an X force with no offset takes no moment from the flange it is drawn at.'}`);
    }
    $('#seisFlags').innerHTML = flags.length ? `<ol class="seis-flags">${flags.map(t => `<li>${t}</li>`).join('')}</ol>` : '';
    $('#seisFlagsPanel').hidden = !flags.length;
    $('#seisHow').innerHTML = `<ol>
      <li><b>NBG Design Calcs, section by section</b> — building data from PCS Box 2 and the code (the PCS's, or the bracing / eScope file's, or yours); seismic data from Box 3 (ASCE 7-22: SMS and SM1 as listed); roof dead, collateral and snow from Box 4 or the files; walls 3 psf full height; each mezzanine's elevation (A), floor dead, collateral, joists, 25 % of the live where it is storage, partitions; the sidewalls' and each frame line's system.</li>
      <li><b>As NBG Design Calcs works it</b> — Fa as interpolated and Fv to two decimals, SDS = 0.6667 SMS, SD1 = 0.6667 SM1; "not detailed for seismic" in SDC A–C; the least R of a direction (12.2.3.3) for Risk Category III / IV or a rigid diaphragm; Ω0 less 0.5 with flexible diaphragms; ASCE 7-16's 11.4.8 exception (1.5 × Eq. 12.8-3) for Site Class D with S1 ≥ 0.2 when T > 1.5 Ts; k = 0 unless a significant mezzanine exists; the roof on its sloped length with the snow on plan; an endwall to the roof line, a parapet or partial hardwall to its top; NBG Frame's sidewall loads at eave − 16", NBG Bracing's at the eave; 1.1 accidental torsion on a rigid diaphragm.</li>
      <li><b>Checked</b> against NBG's own validation examples — 22 of them (ASCE 7-16 and 7-22: walls, parapets, hardwalls, shear walls, partitions, cranes, mezzanines, overrides, site classes D and E, SDC B to D, Risk Category III): 4,985 of 4,985 printed values; and a .nbgcalcs file to full precision (oracle/nbg_seismic.js).</li>
      <li><b>Into the frame</b> — each frame line's mezzanine load on the frame columns its beams frame into (DM 15.1.3), shared by the dead load each takes: EQR = +F, EQL = −F as X forces at the mezzanine elevation.</li>
      <li><b>Into the bracing</b> — the longitudinal mezzanine force to the floor's two long edges; on a sidewall, "Mezz. Seismic" EQB +F at the mezzanine's first frame line and EQF −F at its last, at its elevation, with a wall strut line from it to the braced bay.</li>
      <li><b>Load level.</b> These are Q<sub>E</sub> (12.8), before ρ and the ASD 0.7 — NBG Frame's and NBG Bracing's load combinations apply them.</li></ol>`;
    // input handlers: a check box is true / false, a drop-down text, a box a number ('' takes the value back)
    const sfg = $('#seisForget');
    if (sfg) sfg.onclick = () => { const k = seisKey(); try { if (k) { localStorage.removeItem(k); localStorage.removeItem(k + '.t'); } } catch (e) { /* nothing kept */ } state.seis = {}; state.seisRestored = null; recompute(); toast('Seismic entries cleared — back to the PCS values'); };
    $$('#v-seismic [data-seis]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.seis, raw = el.type === 'checkbox' ? el.checked : el.value.trim(), c = state.seis;
        const v = el.type === 'checkbox' || el.tagName === 'SELECT' ? raw : raw === '' ? '' : +raw;
        const setPath = (obj, path, val) => { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(x => { o = o[x] = o[x] || {}; }); if (val === '' || val == null || (typeof val === 'number' && !isFinite(val))) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = val; };
        if (k.startsWith('b.')) { const rest = k.slice(2), bk = sj.buildings.map(b => b.bkey).find(x => rest.startsWith(x + '.')); c.buildings = c.buildings || {}; c.buildings[bk] = c.buildings[bk] || {}; setPath(c.buildings[bk], rest.slice(bk.length + 1), v); }
        else if (k.startsWith('m.')) { const id = sj.buildings.flatMap(b => b.mezz.map(m => m.id)).find(x => k.startsWith('m.' + x + '.')); c.mezz = c.mezz || {}; c.mezz[id] = c.mezz[id] || {}; setPath(c.mezz[id], k.slice(2 + id.length + 1), v); }
        else if (k === 'eqScale') { if (v === '' || !(+v > 0)) delete c.eqScale; else c.eqScale = +v; }
        else if (k === 'framingAll') { c.mezz = c.mezz || {}; sj.buildings.forEach(b => b.mezz.forEach(m => { c.mezz[m.id] = { ...(c.mezz[m.id] || {}), framing: !!v }; if (v) delete c.mezz[m.id].framing; })); }
        else if (k === 'significant') { if (v) c.significant = true; else delete c.significant; }
        else if (k === 'strutLine') { if (v) delete c.strutLine; else c.strutLine = false; seisSave(); renderSeismic(); return; }
        else if (v === '' || v == null) delete c[k];
        else c[k] = v;
        seisSave(); recompute();
      };
    });
  }
  // the bracing file's frame line name (shown 1-based in NBG Bracing) for a 0-based index
  const lineName = (bf, i) => ((bf.file.info.lines.find(l => l.index === i) || {}).name) ?? String(i + 1);
  const bracingOutName = bf => bf.name.replace(/\.bracing$/i, '') + '_mz.bracing';
  // what goes into a building's bracing file: its sidewall lines at the mezzanine level
  function bracingPlan(b) {
    const bf = (state.bracing || {})[b.bkey];
    if (!bf) return { loads: [], struts: [], notes: [] };
    return BRF.planFor(bf.file, b.braceLines.filter(l => l.wall).map(l => ({ wall: l.wall, F: l.F, at: l.at, x0: l.x0, x1: l.x1, mezz: l.mezz.join(' + ') })));
  }
  // a dropped .bracing (one building's run: its frame lines, walls, bracing, code and roof loads) or .nbgscope (the
  // job's eScope: the project loads and each building's roof loads)
  async function addSeisFiles(list) {
    const sj = state.job && state.job.seismic;
    if (!sj || !sj.buildings.length) { toast('Load a PCS first', 'bad'); return; }
    const bOf = (w, l, name) => sj.buildings.find(b => name && sameName(b.name, name)) || sj.buildings.find(b => Math.abs(b.bd.width - w) < 0.6 && Math.abs(b.bd.length - l) < 0.6) || (sj.buildings.length === 1 ? sj.buildings[0] : null);
    const risk = t => (String(t || '').match(/^(IV|III|II|I)\b/) || [])[1] || null;
    state.seis.files = state.seis.files || {};
    state.bracing = state.bracing || {};
    for (const file of list) {
      try {
        if (/\.bracing$/i.test(file.name)) {
          if (!zipIO.ok) { toast('This browser cannot open .bracing files — use a current Chrome or Edge', 'bad'); continue; }
          const br = await BRF.read(new Uint8Array(await file.arrayBuffer()), zipIO, file.name), i = br.info, b = bOf(i.width, i.length);
          if (!b) { toast(`${file.name}: no building of ${ft(i.width)} × ${ft(i.length)} in this job`, 'bad'); continue; }
          if (i.job && state.pcs && state.pcs.job && state.pcs.job.quote && i.job !== state.pcs.job.quote) toast(`${file.name} is for ${i.job}, this PCS is ${state.pcs.job.quote}`, 'warn');
          state.bracing[b.bkey] = { name: file.name, file: br };
          const s = i.seismic || {}, ed722 = /2024|7-?22/.test(i.code || '');
          state.seis.files[b.bkey] = { ...(state.seis.files[b.bkey] || {}), from: 'bracing file', code: i.code, risk: risk(i.risk), Ss: s.Ss != null ? +s.Ss.toFixed(4) : null, S1: s.S1 != null ? +s.S1.toFixed(4) : null,
            SMS: ed722 && s.Sms != null ? +s.Sms.toFixed(4) : null, SM1: ed722 && s.Sm1 != null ? +s.Sm1.toFixed(4) : null, siteClass: s.siteClass || null,
            roofDead: i.roofDead != null ? +i.roofDead.toFixed(4) : null, collateral: i.collateral, snow: i.snow != null ? +i.snow.toFixed(4) : null };
          toast(`${file.name} — ${i.code || 'code ?'}, Ss ${s.Ss != null ? +s.Ss.toFixed(3) : '?'} / S1 ${s.S1 != null ? +s.S1.toFixed(3) : '?'}, roof dead ${i.roofDead != null ? +i.roofDead.toFixed(3) : '?'} psf; the mezzanine loads are ready in step 9`);
        } else if (/\.nbgscope$/i.test(file.name)) {
          const sc = BRF.readScope(await file.text());
          sc.buildings.forEach(bs => {
            const b = bOf(bs.width, bs.length, bs.name);
            if (!b) return;
            const ed722 = /2024/.test(sc.code || '');
            state.seis.files[b.bkey] = { from: 'eScope', code: sc.code, risk: risk(sc.risk), Ss: sc.Ss, S1: sc.S1, SMS: ed722 ? sc.Sms : null, SM1: ed722 ? sc.Sm1 : null, siteClass: sc.siteClass,
              roofDead: bs.roofDead, collateral: bs.collateral, snow: bs.snow, ...(state.seis.files[b.bkey] && state.seis.files[b.bkey].from === 'bracing file' ? state.seis.files[b.bkey] : {}) };
          });
          toast(`${file.name} — eScope: ${sc.code || `code id ${sc.codeId}`}, Ss ${sc.Ss} / S1 ${sc.S1}, site ${sc.siteClass}`);
        }
      } catch (e) { console.error(e); toast(`${file.name}: ${e.message}`, 'bad'); }
    }
    seisSave(); recompute();
  }
  // a typed EQ load (kips) for one or more frame line × column × elevation keys; '' goes back to the calculated load
  function setEq(keys, val) {
    const o = state.seis.eqOverride = state.seis.eqOverride || {};
    const v = String(val).trim().replace(/^[-−±+]/, '');
    keys.forEach(k => { if (v === '' || !isFinite(+v)) delete o[k]; else o[k] = Math.abs(+v); });
    if (!Object.keys(o).length) delete state.seis.eqOverride;
    seisSave(); recompute();
    toast(v === '' ? 'Back to the calculated EQ load' : `EQ load ${(+v).toFixed(2)} k — in the frame file as EQR +${(+v).toFixed(2)} / EQL −${(+v).toFixed(2)}`);
  }
  // the seismic page's values for this job kept on this computer (not the frame-file data, read again from the files)
  const seisKey = () => (state.pcs && state.pcs.job && state.pcs.job.quote ? 'mzd.seis.' + state.pcs.job.quote : null);
  function seisSave() {
    const k = seisKey();
    if (!k) return;
    try {
      const keep = JSON.parse(JSON.stringify(state.seis || {}));
      Object.values(keep.buildings || {}).forEach(b => { delete b.frameFile; });
      localStorage.setItem(k, JSON.stringify(keep)); localStorage.setItem(k + '.t', new Date().toISOString().slice(0, 16).replace('T', ' '));
    } catch (e) { /* private window: kept for this session */ }
  }
  const seisSavedAt = () => { const k = seisKey(); try { return k ? localStorage.getItem(k + '.t') : null; } catch (e) { return null; } };
  function seisLoad() {
    const k = seisKey();
    let c = {};
    try { c = (k && JSON.parse(localStorage.getItem(k) || 'null')) || {}; } catch (e) { return {}; }
    // entries kept by the workbook-based page: its switches in NBG Design Calcs' terms
    if (c.ignoreNDFS != null) { c.ndfs = !c.ignoreNDFS; delete c.ignoreNDFS; }
    if (c.diaphragm) { if (c.diaphragm === 'rigid') c.mezzDiaphragm = 'Rigid'; delete c.diaphragm; }
    ['vertical', 'types', 'SDS', 'SD1'].forEach(x => delete c[x]);
    Object.values(c.buildings || {}).forEach(b => { delete b.story; if (b.walls && ('fsw' in b.walls || 'lew' in b.walls)) delete b.walls; });
    return c;
  }

  // ---------- frame loads for NBG Frame: by frame line, on the frame's own members ----------
  function renderFrameLoads() {
    const el = $('#frameLoads'), fr = (state.job && state.job.frameEntries) || [];
    $('#frameLoadsPanel').hidden = !(state.res && !state.res.incomplete);
    renderNbg();
    if (!fr.length) { el.innerHTML = '<div class="empty">No mezzanine beam frames into a building column.</div>'; return; }
    const many = manyMezz(), F2 = v => f(v, 2), sj = state.job && state.job.seismic;
    const atLab = state.nbg.height === 'beam' ? 'T/beam' : 'floor A', atOf = e => (state.nbg.height === 'beam' ? e.elev : e.A != null ? e.A : e.elev);
    const bldgs = [...new Set(fr.map(x => x.building || ''))], twoB = bldgs.length > 1;
    const rows = fr.map((fl, fi) => {
      const typ = fl.type ? `${esc(fl.type.type.replace(/\s*-\s*$/, ''))}${fl.type.intType ? ' · interior columns ' + esc(fl.type.intType) + ' (✱)' : ''}` : '';
      const sum = (k, onlyMembers) => fl.entries.filter(e => !onlyMembers || e.member).reduce((a, e) => a + e[k], 0);
      return `<div class="fl-frame"><div class="fl-head"><span class="fl-no">${esc(fl.frame)}</span><div><b>${twoB ? esc(fl.building) + ' · ' : ''}Frame line ${esc(fl.frame)}</b><small>${typ}</small></div>
          <button class="btn-soft" data-fl="${fi}"><svg><use href="#i-copy"/></svg>Copy</button></div>
        <table class="fl-t fl-fr"><colgroup><col class="c-lab"><col class="c-mem"><col class="c-at"><col class="c-n"><col class="c-n"><col class="c-eq"><col class="c-from"></colgroup><thead><tr><th>Column</th><th>NBG Frame member</th><th class="num">At (${atLab})</th><th class="num">Floor dead (k)</th><th class="num">Floor live (k)</th><th class="num" title="Seismic: the mezzanine's share of the frame (Seismic page), EQR +X / EQL −X">EQR / EQL (k)${sj && sj.ok ? '' : '<small class="sub-n eq-tag">pending · Seismic page</small>'}</th><th>From</th></tr></thead><tbody>${fl.entries.map(e => `<tr class="${e.member ? '' : 'not-member'}" data-tip="bcol|${e.x}|${e.y}|${e.parts[0].mi}"><td class="mono"><b>${esc(e.label)}</b>${e.planKind === 'star' ? ' <span class="star" title="Most Economical (✱) on the drawing">✱</span>' : ''}</td><td>${e.member ? `<b class="mono">${esc(e.member)}</b> · ${esc(e.where)}` : `<span class="sub-n">${esc(e.where)}</span>`}</td><td class="num mono">${ft(atOf(e))}</td><td class="num mono d">${F2(e.D)}</td><td class="num mono l">${F2(e.L)}</td><td class="num mono e">${e.eq && e.eq.length ? '±' + F2(e.eq.reduce((a, q) => a + q.F, 0)) + (e.eq.some(q => q.edited) ? `<small class="sub-n eq-tag">${e.eq.some(q => q.edited === 'typed') ? 'typed' : 'scaled'} · calc. ${F2(e.eq.reduce((a, q) => a + q.calc, 0))}</small>` : '') : '—'}</td><td class="sub-n">${esc(e.parts.map(p => `${many ? p.mezz + ' ' : ''}${p.beam}${p.mark ? ' ' + p.mark : ''}`).join(' + '))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Frame members</td><td class="num mono d">${F2(sum('D', true))}</td><td class="num mono l">${F2(sum('L', true))}</td><td class="num mono e">${fl.seismic ? (() => { const qs = fl.entries.filter(e => e.member).flatMap(e => e.eq || []), F = qs.reduce((a, q) => a + q.F, 0), calc = qs.reduce((a, q) => a + q.calc, 0); return '±' + F2(F) + (qs.some(q => q.edited) ? `<small class="sub-n eq-tag">edited · calc. ${F2(calc)}</small>` : ''); })() : ''}</td><td>${fl.seismic ? `<small class="sub-n">roof seismic DL ${F2(fl.seismic.roofPsf)} psf · Cs ${f(fl.seismic.Cs, 4)}</small>` : ''}</td></tr></tfoot></table></div>`;
    }).join('');
    el.innerHTML = `<div class="name-key"><b>Column names</b> · <span class="mono">2/A</span> the grid point, frame line 2 × column line A · <span class="mono">COL03</span> the member in that frame's NBG Frame file: COL01 at the FSW, then each interior column, the BSW column last · mezzanine columns (C1, C2 … on the plan) are not frame members and are not listed here.</div><div class="fl-frames">${rows}</div><div class="xl-foot"><span>Unfactored mezzanine beam end shears (MB sheet H6 / H10), summed at each column; enter them as concentrated floor dead / floor live loads on the member at that height (the floor level A by default — set T/beam below). Seismic: the mezzanine's share of each frame (Seismic page), EQR +X / EQL −X. Members are numbered as NBG Frame does: COL01 at the FSW, then each interior column, the BSW column last.</span><button class="btn-soft" id="flCsv"><svg><use href="#i-copy"/></svg>Download CSV</button></div>`;
    const eqOf = e => (e.eq && e.eq.length ? +e.eq.reduce((a, q) => a + q.F, 0).toFixed(3) : '');
    const tsv = fl => [(twoB ? 'Building\t' : '') + `Frame line\tColumn\tMember\tWhere\tAt ${atLab} (ft)\tFloor dead (k)\tFloor live (k)\tSeismic EQR/EQL (k)\tFrom`].concat(fl.entries.map(e => [...(twoB ? [fl.building] : []), fl.frame, e.label, e.member || '', e.where, (+atOf(e).toFixed(3)), (+e.D.toFixed(3)), (+e.L.toFixed(3)), eqOf(e), e.parts.map(p => `${p.mezz} ${p.beam}`).join(' + ')].join('\t'))).join('\n');
    $$('#frameLoads [data-fl]').forEach(b => { const fl = fr[+b.dataset.fl]; b.onclick = () => copyText(tsv(fl), `${twoB ? fl.building + ' ' : ''}Frame line ${fl.frame} loads copied`); });
    $('#flCsv').onclick = () => {
      const csv = [(twoB ? 'Building,' : '') + `Frame line,Column,Member,Where,At ${atLab} (ft),Floor dead (k),Floor live (k),Seismic EQR/EQL (k),From`].concat(fr.flatMap(fl => fl.entries.map(e => [...(twoB ? [fl.building] : []), fl.frame, e.label, e.member || '', e.where, +atOf(e).toFixed(3), +e.D.toFixed(3), +e.L.toFixed(3), eqOf(e), e.parts.map(p => `${p.mezz} ${p.beam}`).join(' + ')].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')))).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `${(state.pcs && state.pcs.job.quote) || 'mezzanine'}-frame-loads.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      toast('Frame loads CSV downloaded');
    };
  }

  // ---------- NBG Frame files: the FDL / FLL concentrated loads written into the job's own .frame files ----------
  // raw DEFLATE through the browser's streams (Chrome / Edge 103+, Firefox 113+, Safari 16.4+)
  const zipIO = {
    ok: typeof DecompressionStream !== 'undefined' && (() => { try { new DecompressionStream('deflate-raw'); return true; } catch (e) { return false; } })(),
    inflate: u => new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(b => new Uint8Array(b)),
    deflate: u => new Response(new Blob([u]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer().then(b => new Uint8Array(b)),
  };
  const linesText = ls => { const a = ls.map(Number).sort((x, y) => x - y); return a.length > 2 && a.every((v, i) => !i || v === a[i - 1] + 1) ? `${a[0]}-${a[a.length - 1]}` : a.join(', '); };
  const parseLines = t => String(t || '').split(/[,\s]+/).filter(Boolean).flatMap(p => { const m = /^(\d+)(?:-(\d+))?$/.exec(p); if (!m) return []; const out = []; for (let k = +m[1]; k <= +(m[2] || m[1]); k++) out.push(k); return out; });
  // NBG Frame's analysis reads the file's full path into 64 characters ("No input file …(3.f" past that — the
  // modeller opens the file, the run fails), and the browser adds " (1)" to a name already in Downloads: so a short
  // name with no spaces — job, building, frame lines: 1234567-B1-2_mz.frame
  const outName = (it, lines, tail = 'mz') => {
    const info = (it.ff && it.ff.info) || {};
    const job = String((/(\d{6,})/.exec(it.name) || [])[1] || info.job || '').replace(/[^A-Za-z0-9]+/g, '');   // the frame number, else the quote
    const b = String(info.building || '').trim(), bt = /^bldg\.?\s*\w+$/i.test(b) ? 'B' + b.replace(/^bldg\.?\s*/i, '') : b.replace(/[^A-Za-z0-9]+/g, '').slice(0, 4);
    const ln = lines && lines.length ? String(lines[0]) + (lines.length > 1 ? '-' + lines[lines.length - 1] : '') : '';
    const parts = [job, bt, ln].filter(Boolean);
    return (parts.length ? parts.join('-') : it.name.replace(/\.frame$/i, '').replace(/[^A-Za-z0-9]+/g, '').slice(0, 16)) + `_${tail}.frame`;
  };
  const sameName = (a, b) => FF.bldgKey(a) === FF.bldgKey(b);
  // the Ecc. Loc. code NBG Frame uses for WebCenterline: learned from a saved file or confirmed once, then kept (this browser)
  const WEB_KEY = 'mz.nbg.webCenterline';
  function webCode() {
    if (!state.nbg.web) {
      let v = null;
      try { v = JSON.parse(localStorage.getItem(WEB_KEY) || 'null'); } catch (e) { v = null; }
      state.nbg.web = v && /^-?\d+$/.test(v.code) && v.code !== '0' ? v : { code: FF.WEB_GUESS, how: 'guess' };
    }
    return state.nbg.web;
  }
  function setWebCode(v) {
    state.nbg.web = v;
    try { if (v.how === 'guess') localStorage.removeItem(WEB_KEY); else localStorage.setItem(WEB_KEY, JSON.stringify(v)); } catch (e) { /* kept for this session only */ }
  }
  async function addFrameFiles(list) {
    if (!zipIO.ok) { toast('This browser cannot open .frame files (no deflate-raw streams) — use a current Chrome or Edge'); return; }
    for (const file of list) {
      const item = { name: file.name, include: true, err: null, ff: null, lines: '' };
      try {
        item.bytes = new Uint8Array(await file.arrayBuffer());
        item.ff = await FF.read(item.bytes, zipIO, file.name);
        item.lines = linesText(item.ff.info.lines);
        // FDL / FLL rows set to WebCenterline by hand in NBG Frame give its code (only while it is unconfirmed, so an
        // old export never overrides a code already learned or confirmed — Reset starts over)
        const learnt = webCode().how === 'guess' ? FF.learnWebCode(item.ff.info.cloads, webCode().code) : null;
        if (learnt) { setWebCode({ code: learnt.code, how: 'learned', from: file.name }); toast(`Ecc. Loc. WebCenterline learned from ${file.name}: code ${learnt.code}`); }
        // EQR rows set to Bottom/Right by hand (the seismic right case): that code, once
        const br = !brCode().code ? FF.learnBottomRight(item.ff.info.cloads, webCode().how !== 'guess' ? webCode().code : null) : null;
        if (br) { setBrCode({ code: br.code, how: 'learned', from: file.name }); toast(`Ecc. Loc. Bottom/Right learned from ${file.name}: code ${br.code}`); }
      } catch (e) { item.err = e.message || String(e); }
      // the same file dropped again replaces the first
      const at = state.nbg.files.findIndex(x => x.name === item.name);
      if (at >= 0) state.nbg.files[at] = item; else state.nbg.files.push(item);
    }
    state.nbg.files.sort((a, b) => ((a.ff && a.ff.info.lines[0]) || 99) - ((b.ff && b.ff.info.lines[0]) || 99));
    // NBG Frame's roof dead / collateral for the seismic weight of the roof ("Per Seller" on the PCS)
    if (seisFromFrames()) { recompute(); return; }
    renderNbg();
  }
  // the roof loads a dropped frame file carries, to the seismic page's building (not over a value typed there)
  function seisFromFrames() {
    const sj = state.job && state.job.seismic;
    if (!sj || !sj.buildings) return false;
    let changed = false;
    sj.buildings.forEach(b => {
      const it = state.nbg.files.find(x => x.ff && x.ff.info.seismic && x.ff.info.seismic.roofDead != null && (sameName(x.ff.info.building, b.name) || sj.buildings.length === 1));
      if (!it) return;
      const bo = state.seis.buildings = state.seis.buildings || {}, cur = bo[b.bkey] = bo[b.bkey] || {}, s = it.ff.info.seismic;
      const ff = { roofDead: s.roofDead, roofCollateral: s.roofCollateral, from: it.name, roofSeismicDeadLoad: s.roofSeismicDeadLoad, roofSeismicFactor: s.roofSeismicFactor, R: s.R, framing: s.framing };
      if (JSON.stringify(cur.frameFile) !== JSON.stringify(ff)) { cur.frameFile = ff; changed = true; }
    });
    return changed;
  }
  // the Ecc. Loc. code for Bottom/Right (EQR rows, the user's convention): learned or confirmed once, kept (this browser)
  const BR_KEY = 'mz.nbg.bottomRight';
  function brCode() {
    if (!state.nbg.br) { let v = null; try { v = JSON.parse(localStorage.getItem(BR_KEY) || 'null'); } catch (e) { v = null; } state.nbg.br = v && /^-?\d+$/.test(v.code) && v.code !== '0' && v.code !== '1' ? v : { code: null, how: 'unknown' }; }
    return state.nbg.br;
  }
  function setBrCode(v) { state.nbg.br = v; try { if (v.code) localStorage.setItem(BR_KEY, JSON.stringify(v)); else localStorage.removeItem(BR_KEY); } catch (e) { /* private window */ } }
  // what one file gets: its frame lines, the side COL01 is on, the rows, what is left out, the checks
  function nbgPlan(item) {
    const fr = (state.job && state.job.frameEntries) || [], info = item.ff.info, pcs = state.pcs || {};
    const lines = parseLines(item.lines);
    const grid = state.res && state.res.grid;
    const fe = fr.find(x => lines.map(String).includes(String(x.frame)));
    const interior = fe ? fe.interior : grid && lines[0] && grid.interior[lines[0] - 1] ? grid.interior[lines[0] - 1] : [];
    const att = (pcs.attachments || []).find(a => /^(FSW|BSW)$/.test(a.toWall) && (sameName(a.to, info.building) || (pcs.attachments || []).length === 1));
    const o = FF.orient(info, { interior, leanToWall: att ? att.toWall : null });
    const bldgs = [...new Set(fr.map(x => x.building).filter(Boolean))];
    const building = bldgs.length && info.building ? info.building : null;   // a file for another building takes none of these loads
    const r = FF.rowsFor(info, fr, { lines, mirrored: o.mirrored, height: state.nbg.height, building, bottomRight: brCode().code || null });
    const add = FF.addLoads(item.ff.xml, r.rows, { toFlange: webCode().code });
    const checks = [];
    const quote = pcs.job && pcs.job.quote;
    if (quote && info.job && !sameName(quote, info.job)) checks.push(['bad', `job ${info.job} in the file, ${quote} on the PCS`]);
    else if (info.job) checks.push(['ok', `job ${info.job}`]);
    if (bldgs.length && info.building && !bldgs.some(b => sameName(b, info.building))) checks.push(['bad', `file is for ${info.building}; the mezzanines are in ${bldgs.join(', ')}`]);
    else if (info.building) checks.push(['ok', info.building]);
    if (grid && info.width && Math.abs(info.width - grid.width) > 0.05) checks.push(['bad', `width ${ft(info.width)} in the file, ${ft(grid.width)} on the PCS`]);
    if (!lines.length) checks.push(['bad', 'frame lines not in the file name — type them']);
    checks.push([o.how === 'assumed' ? 'warn' : 'ok', `${o.mirrored ? 'COL01 is the BSW column' : 'COL01 is the FSW column'} — ${o.text}`]);
    return { lines, o, r, add, checks };
  }
  // where an EQR / EQL row's force comes from: each mezzanine's share at this column, per frame line
  function seisFrom(m, x) {
    if (!m) return '';
    const at = +(+x.location).toFixed(3);
    const parts = m.from.flatMap(fr => (fr.eq || []).filter(q => Math.abs(q.at - at) < 1e-3).map(q => `${fr.label}: ${q.mezz} ${f(q.F, 2)} k (${q.edited === 'typed' ? `typed · calc. ${f(q.calc, 2)} k` : q.edited === 'scaled' ? `${f(q.calc, 2)} k × ${f(q.F / q.calc, 3)}` : `${Math.round(q.share * 100)} % of ${f(q.frameF, 2)} k`})`));
    return parts.join(' · ') + (new Set(m.from.map(z => z.frame)).size > 1 ? ' · the largest of the lines' : '');
  }
  // the EQ loads of one file member at one level: their keys (frame line × column × level) and whether any was edited
  const eqAt = (m, loc) => (m ? m.from.flatMap(fr => (fr.eq || []).filter(q => Math.abs(q.at - +loc) < 1e-3)) : []);
  const eqState = (m, loc) => { const qs = eqAt(m, loc); return qs.some(q => q.edited === 'typed') ? 'typed' : qs.some(q => q.edited === 'scaled') ? 'scaled' : ''; };
  const eqKeys = (m, loc) => [...new Set(eqAt(m, loc).map(q => q.key).filter(Boolean))];
  // the frame's roof seismic override for a file's lines (the largest roof weight of them), and what the file has now
  function seisFor(p, info) {
    const sj = state.job && state.job.seismic;
    if (!sj || !sj.ok) return null;
    const fr = ((state.job && state.job.frameEntries) || []).filter(x => x.seismic && p.lines.map(String).includes(String(x.frame)) && (!info.building || !x.building || sameName(x.building, info.building)));
    if (!fr.length) return null;
    const top = fr.slice().sort((a, b) => b.seismic.roofPsf - a.seismic.roofPsf)[0].seismic, now = info.seismic || {};
    const mezz = [...new Set(fr.flatMap(x => x.seismic.mezzLoads.map(m => `${m.id} ${f(m.F, 2)} k at ${ft(m.at)}`)))].join(', ');
    const set = now.roofSeismicDeadLoad != null && Math.abs(now.roofSeismicDeadLoad - top.roofPsf) <= 0.01 * top.roofPsf && Math.abs((now.roofSeismicFactor || 0) - top.Cs) <= 0.001;
    const edited = fr.some(x => x.entries.some(e => (e.eq || []).some(q => q.edited)));
    return { roofPsf: top.roofPsf, Cs: top.Cs, R: top.R, V: Math.max(...fr.map(x => x.seismic.V)), mezz, edited, many: fr.length > 1, now: { dead: now.roofSeismicDeadLoad, factor: now.roofSeismicFactor, R: now.R }, set };
  }
  // EQR rows: Top/Left until the Bottom/Right code is known (an X force with no offset takes no moment from it)
  function brPanel(firstOk) {
    const b = brCode(), sj = state.job && state.job.seismic;
    if (!sj || !sj.ok) return '';
    if (b.code) return `<div class="nbg-ecc ok"><div><b>EQR Ecc. Loc. Bottom/Right = code ${esc(b.code)}</b> — ${b.how === 'learned' ? `learned from ${esc(b.from || 'a saved file')}` : 'confirmed in NBG Frame'}; EQL rows Top/Left.</div><button class="btn-ghost" id="nbgBrReset">Reset</button></div>`;
    return `<div class="nbg-ecc note"><div><b>EQR / EQL rows go in Top/Left</b>, as NBG Frame writes its own lean-to seismic rows — an X force with no offset takes no moment from the flange it is drawn at. To write EQR as Bottom/Right (your convention), open the check file and pick the row that reads <i>Bottom/Right</i>, or drop a frame where EQR rows were set to Bottom/Right by hand.</div>
      <div class="nbg-eccbtns"><button class="btn-soft" id="nbgEccFile2" ${firstOk ? '' : 'disabled'}><svg><use href="#i-file"/></svg>Make the check file</button><div class="nbg-eccpick"><small>Reads Bottom/Right:</small>${FF.ECC_CANDIDATES.filter(c => c !== String(webCode().code)).map(c => `<button class="chip" data-br="${esc(c)}">ECC ${esc(c)}</button>`).join('')}</div></div></div>`;
  }
  function renderNbg() {
    const box = $('#nbgFrame');
    if (!box) return;
    const fr = (state.job && state.job.frameEntries) || [];
    box.hidden = !fr.length;
    $$('#nbgHeight button').forEach(b => { b.classList.toggle('is-active', b.dataset.h === state.nbg.height); b.onclick = () => { state.nbg.height = b.dataset.h; renderFrameLoads(); }; });
    $('#nbgDropSub').textContent = zipIO.ok ? 'one per frame line or group of lines · e.g. Frame_…_Bldg_1_3-5.frame' : 'this browser cannot open .frame files — use a current Chrome or Edge';
    const files = state.nbg.files, F2 = v => f(v, 2), many = manyMezz();
    const plans = files.map(it => (it.ff ? nbgPlan(it) : null));
    // frame lines with mezzanine loads on frame members, and which of them have a file
    const loaded = new Set(plans.filter(Boolean).flatMap(p => p.lines.map(String)));
    const needLines = fr.filter(x => x.entries.some(e => e.member)).map(x => String(x.frame));
    const missing = needLines.filter(l => !loaded.has(l));
    const cover = files.length ? `<div class="nbg-cover ${missing.length ? 'warn' : 'ok'}">${missing.length ? `<b>No file yet for frame line${missing.length > 1 ? 's' : ''} ${esc(missing.join(', '))}</b> — the loads there are in the cards above.` : `<b>Every frame line with mezzanine load has its file</b> (${esc(needLines.join(', '))}).`}</div>` : '';
    const card = (it, i) => {
      if (!it.ff) return `<div class="nbg-file bad"><div class="nbg-fh"><svg><use href="#i-file"/></svg><div><b>${esc(it.name)}</b><small>${esc(it.err || 'could not be read')}</small></div><button class="btn-ghost" data-nbg-rm="${i}">Remove</button></div></div>`;
      const p = plans[i], info = it.ff.info, a = p.add;
      const head = `<div class="nbg-fh"><label class="nbg-inc"><input type="checkbox" data-nbg-inc="${i}" ${it.include ? 'checked' : ''}></label><div><b>${esc(it.name)}</b><small>${esc(info.title || '')} · ${esc(info.type || '')} · bay ${ft(info.bayWidth)} · ${info.columns.map(c => `${esc(c.id)} at ${ft(c.x)}`).join(', ')}</small></div>
        <label class="nbg-lines">Frame lines<input data-nbg-lines="${i}" value="${esc(it.lines)}" inputmode="numeric" spellcheck="false"></label>
        <button class="btn-soft" data-nbg-dl="${i}" ${p.r.rows.length && webCode().how !== 'guess' ? '' : 'disabled'} title="${webCode().how === 'guess' ? 'Confirm the Ecc. Loc. code first (above)' : ''}"><svg><use href="#i-file"/></svg>Download</button><button class="btn-ghost" data-nbg-rm="${i}" aria-label="Remove">✕</button></div>`;
      const checks = `<div class="nbg-checks">${p.checks.map(([k, t]) => `<span class="chip ${k === 'ok' ? 'ok' : k === 'bad' ? 'bad' : 'warn'}">${esc(t)}</span>`).join('')}</div>`;
      const from = m => { const fs = [...new Set(m.from.map(x => x.frame))]; return m.from.map(x => x.label).join(', ') + (fs.length > 1 ? ' · the largest of the lines' : ''); };
      const eccName = code => (String(code) === '1' ? 'Top/Left' : String(code) === String(webCode().code) ? 'WebCenterline' : String(code) === String(brCode().code) ? 'Bottom/Right' : 'code ' + code);
      const rowsT = p.r.rows.length ? `<div class="table-wrap"><table class="fl-t nbg-t"><thead><tr><th>Description</th><th>Load Case</th><th>Member</th><th class="num">X Force (kip)</th><th class="num">Y Force (kip)</th><th class="num">Moment (kip·ft)</th><th class="num">Location (ft)</th><th>Ecc. Loc.</th><th class="num">Ecc. Offset (in)</th><th>Loc. Sys.</th><th>From</th></tr></thead><tbody>${p.r.rows.map(x => { const m = p.r.members.find(q => q.member === x.member); const eq = /^EQ/.test(x.caseId); const code = x.toFlange != null ? x.toFlange : webCode().code; return `<tr class="${eq ? 'eq-row' : ''}"><td class="mono"><b>${esc(x.name)}</b></td><td class="mono">${x.caseId}</td><td class="mono">${esc(x.member)}</td><td class="num mono ${eq ? 'e' : ''}">${x.caseId === 'EQR' ? `<input class="seis-in eq-in card-eq ${eqState(m, x.location) ? 'is-' + eqState(m, x.location) : ''}" data-cardeq="${i}|${esc(x.member)}|${x.location}" value="${f(x.x, 3)}" inputmode="decimal" title="kips — EQR + / EQL − (typed here: every frame line of this file at this column, this level)">${eqState(m, x.location) === 'typed' ? `<button class="eq-x" data-cardeqclear="${i}|${esc(x.member)}|${x.location}" title="back to the calculated load">↺</button>` : ''}` : f(x.x || 0, 3)}</td><td class="num mono ${x.caseId === 'FDL' ? 'd' : x.caseId === 'FLL' ? 'l' : ''}">${f(x.y || 0, 3)}</td><td class="num mono">0.000</td><td class="num mono">${f(x.location, 2)}</td><td>${eccName(code)} <small class="sub-n">${esc(code)}${!eq && webCode().how === 'guess' ? '?' : ''}</small></td><td class="num mono">0.000</td><td>Global</td><td class="sub-n">${eq ? esc(seisFrom(m, x)) : esc(from(m))}</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty">No mezzanine load on the columns of this frame${p.lines.length ? ` (line${p.lines.length > 1 ? 's' : ''} ${esc(linesText(p.lines))})` : ''}.</div>`;
      // the roof seismic weight and factor NBG Frame needs for these lines (the workbook's override), against the file's own
      const sz = seisFor(p, info), sj = state.job && state.job.seismic;
      const seisT = !sz ? (sj && !sj.ok && p.r.rows.length ? `<div class="nbg-seis warn"><b>Seismic not added yet</b> — the Seismic page needs: ${esc(sj.need.join('; '))}.</div>` : '')
        : `<div class="nbg-seis note"><b>Seismic for line${p.lines.length > 1 ? 's' : ''} ${esc(linesText(p.lines))}:</b> the EQR / EQL rows above are the mezzanine's load from the workbook (${sz.mezz}${sz.edited ? ' as calculated; the rows carry your edited values' : ''}). The roof seismic stays NBG Frame's own (file: ${f(sz.now.dead, 2)} psf · ${f(sz.now.factor, 3)}).
          <small>Workbook alt. roof weight (Lateral G64, info): ${f(sz.roofPsf, 2)} psf · Cs ${f(sz.Cs, 4)} · base shear ${f(sz.V, 2)} k.</small></div>`;
      const left = p.r.unplaced.length ? `<div class="nbg-left"><b>Not in this file</b> — the frame has no member at these columns, so their loads are not put on it (an endwall column goes with the endwall design; a column made a frame column on the Plan page has to be added in NBG Frame first):${p.r.unplaced.map(u => `<div><span class="mono"><b>${esc(u.label)}</b></span> ${esc(u.where.replace(/\s*—\s*not a member.*$/, ''))} · <span class="mono d">D ${F2(u.D)} k</span> · <span class="mono l">L ${F2(u.L)} k</span> at ${ft(state.nbg.height === 'A' && u.A != null ? u.A : u.elev)}<small>${esc(u.parts.map(q => `${many ? q.mezz + ' ' : ''}${q.beam}${q.mark ? ' ' + q.mark : ''}`).join(' + '))}</small></div>`).join('')}</div>` : '';
      const fl = a.floors, flTxt = ['FloorDead', 'FloorLive'].filter(k => fl[k]).map(k => `${k === 'FloorDead' ? 'Floor Dead' : 'Floor Live'} ${fl[k].was > 0 ? `${f(fl[k].was, 3)} psf (left as it is)` : '0 → 1.000 psf'}`).join(' · ');
      const notes = [flTxt, a.replaced ? `${a.replaced} earlier FDL / FLL row${a.replaced > 1 ? 's' : ''} replaced` : '', a.others.length ? `kept ${a.others.length} other FDL / FLL / EQ row${a.others.length > 1 ? 's' : ''} already in the file (${a.others.map(o => `${o.name} ${o.memberID} ${(+(+o.yMag || +o.xMag)).toFixed(2)}`).join(', ')}) — check they are not the same loads` : '', a.replaced ? '' : ''].filter(Boolean);
      return `<div class="nbg-file ${it.include ? '' : 'off'}">${head}${checks}${rowsT}${seisT}${left}<div class="nbg-notes">${notes.map(t => `<span>${esc(t)}</span>`).join('')}</div></div>`;
    };
    const anyRows = webCode().how !== 'guess' && plans.some((p, i) => p && files[i].include && p.r.rows.length);
    const steps = files.length ? `<div class="nbg-steps"><b>In NBG Frame</b><ol><li>Open the file. Frame Loads shows Floor Dead and Floor Live at 1.000 psf.</li><li>Process → Get Applied Loads → final pass, so the FDL and FLL cases exist.</li><li>Tools → Concentrated (Panel) Loads: the rows above are there — check them against this table (FDL / FLL Ecc. Loc. WebCenterline; EQR +X, EQL −X at the mezzanine level), then Save and Gen Loads.</li><li>Seismic: the EQR / EQL rows are the mezzanine's seismic load (EQR + Bottom/Right or Top/Left, EQL −) — check them against the Seismic page. The roof seismic stays NBG Frame's own.</li><li>Run the frame as usual.</li></ol><small class="nbg-path">Files are named short on purpose (e.g. <code>${esc(files.find(x => x.ff) ? outName(files.find(x => x.ff), parseLines(files.find(x => x.ff).lines)) : '1234567-B1-2_mz.frame')}</code>): NBG Frame's analysis only reads a file path up to <b>64 characters</b>, folder included — past that the frame opens but the run stops with “No input file …”. Keep the file in a short folder (Downloads is fine) and delete older copies first, so the browser does not add “ (1)”, “ (2)” to the name.</small></div>` : '';
    const w = webCode();
    const firstOk = files.find(x => x.ff);
    const ecc = files.length ? (w.how === 'guess'
      ? `<div class="nbg-ecc warn"><div><b>One-time setup: the Ecc. Loc. code.</b> NBG Frame stores Ecc. Loc. as a number, and the one for <i>WebCenterline</i> is not written anywhere the tool can read. A wrong number is what made the "Invalid data" message. So frame files are only made once it is confirmed:
          <ol><li><b>Make the check file</b> (a copy of ${firstOk ? esc(firstOk.name) : 'your frame'} with ${FF.ECC_CANDIDATES.length} zero-load rows named ECC ${FF.ECC_CANDIDATES.join(', ECC ')}).</li>
          <li>Open it in NBG Frame → Tools → Concentrated (Panel) Loads. Rows with a number NBG does not have come up blank with the same message — click OK. Close without saving.</li>
          <li>Click the row that reads <i>WebCenterline</i> below. Done for good on this computer.</li></ol></div>
          <div class="nbg-eccbtns"><button class="btn-soft" id="nbgEccFile" ${firstOk ? '' : 'disabled'}><svg><use href="#i-file"/></svg>Make the check file</button>
          <div class="nbg-eccpick"><small>Reads WebCenterline:</small>${FF.ECC_CANDIDATES.map(c => `<button class="chip" data-ecc="${esc(c)}">ECC ${esc(c)}</button>`).join('')}</div></div></div>`
      : `<div class="nbg-ecc ok"><div><b>Ecc. Loc. WebCenterline = code ${esc(w.code)}</b> — ${w.how === 'learned' ? `learned from ${esc(w.from || 'a saved file')}` : 'confirmed in NBG Frame'}; kept on this computer.</div><button class="btn-ghost" id="nbgEccReset">Reset</button></div>${brPanel(firstOk)}`) : '';
    $('#nbgList').innerHTML = ecc + cover + files.map(card).join('') + (files.length ? `<div class="xl-foot">${steps}<div class="nbg-all"><button class="btn-soft" id="nbgAll" ${anyRows ? '' : 'disabled'}><svg><use href="#i-file"/></svg>Download checked (.zip)</button><button class="btn-ghost" id="nbgClear">Clear files</button></div></div>` : '');
    // events
    const input = $('#nbgFile'), drop = $('#nbgDrop');
    input.onchange = () => { addFrameFiles(Array.from(input.files || [])); input.value = ''; };
    if (!drop.dataset.wired) {
      drop.dataset.wired = '1';
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
      drop.addEventListener('drop', e => addFrameFiles(Array.from(e.dataTransfer.files || []).filter(x => /\.frame$/i.test(x.name))));
    }
    $$('[data-nbg-rm]').forEach(b => { b.onclick = () => { files.splice(+b.dataset.nbgRm, 1); renderNbg(); }; });
    $$('[data-nbg-inc]').forEach(b => { b.onchange = () => { files[+b.dataset.nbgInc].include = b.checked; renderNbg(); }; });
    $$('[data-nbg-lines]').forEach(b => { b.onchange = () => { files[+b.dataset.nbgLines].lines = b.value; renderNbg(); }; });
    const build = async i => { const it = files[i], p = plans[i]; return { name: outName(it, p.lines), bytes: await FF.write(it.ff, p.add.xml, zipIO) }; };
    const save = (bytes, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    $$('[data-nbg-dl]').forEach(b => { b.onclick = async () => { const o = await build(+b.dataset.nbgDl); save(o.bytes, o.name, 'application/octet-stream'); toast(`${o.name} — ${plans[+b.dataset.nbgDl].r.rows.length} rows`); }; });
    const all = $('#nbgAll');
    if (all) all.onclick = async () => {
      const out = [];
      for (let i = 0; i < files.length; i++) if (plans[i] && files[i].include && plans[i].r.rows.length) out.push(await build(i));
      save(FF.bundle(out), `${(state.pcs && state.pcs.job.quote) || 'mezzanine'}-frames-mezz.zip`, 'application/zip');
      toast(`${out.length} frame file${out.length > 1 ? 's' : ''} with the mezzanine loads`);
    };
    const clr = $('#nbgClear');
    if (clr) clr.onclick = () => { state.nbg.files = []; renderNbg(); };
    const brr = $('#nbgBrReset');
    if (brr) brr.onclick = () => { setBrCode({ code: null, how: 'unknown' }); renderNbg(); };
    // an EQ load typed on a card: every frame line this file designs, at that column and level (EQR + / EQL − as typed)
    const cardEq = (v, el) => { const [fi, member, loc] = v.split('|'), p = plans[+fi], m = p && p.r.members.find(q => q.member === member); const keys = eqKeys(m, loc); if (keys.length) setEq(keys, el ? el.value : ''); };
    $$('#nbgList [data-cardeq]').forEach(el => { el.onchange = () => cardEq(el.dataset.cardeq, el); });
    $$('#nbgList [data-cardeqclear]').forEach(el => { el.onclick = () => cardEq(el.dataset.cardeqclear, null); });
    $$('#nbgList [data-br]').forEach(b => { b.onclick = () => { setBrCode({ code: b.dataset.br, how: 'confirmed' }); renderNbg(); toast(`Ecc. Loc. Bottom/Right = code ${b.dataset.br} — EQR rows use it now`); }; });
    const eccFile = async what => {
      const it = files.find(x => x.ff), name = outName(it, parseLines(it.lines), 'ECC');
      save(await FF.write(it.ff, FF.eccCheck(it.ff), zipIO), name, 'application/octet-stream');
      toast(`${name} — open it in NBG Frame, then click the row that reads ${what}`);
    };
    const ef2 = $('#nbgEccFile2');
    if (ef2) ef2.onclick = () => eccFile('Bottom/Right');
    const rs = $('#nbgEccReset'), ef = $('#nbgEccFile');
    if (rs) rs.onclick = () => { setWebCode({ code: FF.WEB_GUESS, how: 'guess' }); renderNbg(); };
    if (ef) ef.onclick = () => eccFile('WebCenterline');
    $$('#nbgList [data-ecc]').forEach(b => { b.onclick = () => { setWebCode({ code: b.dataset.ecc, how: 'confirmed' }); renderNbg(); toast(`Ecc. Loc. WebCenterline = code ${b.dataset.ecc} — frame files can be made now`); }; });
  }

  // ---------- beam calc (MB sheet mirror) ----------
  const kv = rows => `<div class="kv">${rows.map(([k, v, cls, row]) => `<span class="${row || ''}">${k}</span><span class="${cls || ''} ${row || ''}">${v}</span>`).join('')}</div>`;
  // open the Beam page on the mark, and the member length, of beam id of mezzanine r
  function openBeam(r, id) {
    const mk = mkOf(r, id), b = r.layout.beams[id], i = mk ? jobMarks().findIndex(m => m.mark === mk.mark) : -1;
    if (i >= 0) { state.mark = i; state.markSpan = Math.max(0, (jobMarks()[i].spanRuns || []).findIndex(q => Math.abs(q.span - b.span) < 1e-3)); }
    go('beam'); renderBeam();
  }
  // where the beams of one member length sit: "BSW B1, B2 (line C) · LEW B3 (line D)"
  function runBeams(mk, span) {
    const ms = state.job ? state.job.mezz : [state.res], many = ms.length > 1;
    const xs = (mk.beamsAll || []).filter(x => span == null || Math.abs(x.span - span) < 1e-3), by = new Map();
    xs.forEach(x => { if (!by.has(x.mi)) by.set(x.mi, []); by.get(x.mi).push(x); });
    return [...by].map(([mi, bs]) => { const m = ms[mi], lines = [...new Set(bs.map(x => { const b = m.layout.beams[x.id]; return (m.layout.joists === 'y' ? m.grid.yLabel(b.line) : m.grid.xLabel(b.line)) || ft(b.line); }))];
      // many beams: how many and on which lines (each beam's number is on the plan)
      const ids = bs.length > 6 ? `${bs.length} beams` : bs.map(x => bNo(m, x.id)).join(', ');
      return `${many ? esc(m.id) + ' ' : ''}${ids} (line${lines.length > 1 ? 's' : ''} ${lines.join(', ')})`; }).join(' · ');
  }
  // Beam inputs: the span and trib on the MB sheet for a mark (e.g. the member length between column faces). They change
  // the beam design only — the plan, the columns and the loads to the frame keep the layout. One member over the job.
  const setMarkInput = (mark, v) => allSettings().forEach(st => { const mi = { ...(st.markInput || {}) }; if (v) mi[mark] = v; else delete mi[mark]; st.markInput = mi; });
  function renderBeamInputs(mk) {
    const dz = mkDz(mk), cur = (state.settings.markInput || {})[mk.mark] || {};
    const runs = (mk.spanRuns || []).slice(1);
    $('#beamInputs').innerHTML = `<div class="bi-head"><div><span class="eyebrow">Beam inputs · ${mk.mark}</span><small>MB sheet only — the plan, the columns and the loads to the frame keep the layout (${ft(mk.span)} × ${ft(mk.trib)})</small></div>
        <span class="bi-btns">${dz.sbSpan < mk.span - 1e-6 && !dz.setback ? `<button class="btn-soft" id="biSetback" title="The beams that frame into frame columns stop at the column faces: each member length less its own setback (Settings: rigid frame ${esc(ft(state.settings.setbackRigid))}, post-and-beam ${esc(ft(state.settings.setbackPB))})">Frame column setback → ${ft(dz.sbSpan)}</button>` : ''}<button class="btn-soft" id="biTry">Try another section</button><button class="btn-ghost" id="biReset" ${dz.set ? '' : 'disabled'}>Back to the layout</button></span></div>
      <div class="bi-row">
        <label class="bi-f ${cur.span || cur.setback ? 'is-set' : ''}"><span>Design span <small>member length</small></span><input data-bi="span" value="${esc(ft(dz.span))}" spellcheck="false" autocomplete="off"><small>${dz.setback ? `frame column setback: each member less its own (layout ${ft(mk.span)}${runs.length ? '; ' + runs.map(q => ft(q.span) + ' → ' + ft(runL(q))).join(', ') : ''})` : dz.cut ? `${dz.cut > 0 ? '−' : '+'}${ft(Math.abs(dz.cut))} from ${ft(mk.span)}${runs.length ? ', also on the ' + runs.map(q => ft(q.span) + ' → ' + ft(runL(q))).join(', ') + ' run' + (runs.length > 1 ? 's' : '') : ''}` : `layout ${ft(mk.span)}`}</small></label>
        <label class="bi-f ${cur.trib ? 'is-set' : ''}"><span>Design trib <small>tributary width</small></span><input data-bi="trib" value="${esc(ft(dz.trib))}" spellcheck="false" autocomplete="off"><small>layout ${ft(mk.trib)}</small></label>
        <div class="bi-out${mk.check ? '' : ' ng'}">${mk.check ? `<b class="nocase">${esc(mk.desc)}</b><small>combined ${f(mk.check.res.CSR, 3)} · shear ${f(mk.check.res.SRvx, 3)} · L/${f(mk.check.defl.rLL, 0)}</small>` : '<b>NO SECTION</b><small>nothing passes — the depth table gives the closest at each depth</small>'}</div>
      </div>`;
    const lay = { span: mk.span, trib: mk.trib };
    $$('#beamInputs input[data-bi]').forEach(inp => {
      inp.onchange = () => {
        const k = inp.dataset.bi, raw = inp.value.trim();
        const v = raw === '' ? lay[k] : (PCS.ftin(raw) ?? PCS.ftin(raw + "'"));
        if (v == null || !(v > 0)) { toast(`${raw} is not a length — e.g. 22'-4" or 22.333`); inp.value = ft(mkDz(mk)[k]); return; }
        const next = { ...((state.settings.markInput || {})[mk.mark] || {}) };
        if (k === 'span') delete next.setback;   // a span typed in replaces the setback
        if (Math.abs(v - lay[k]) < 1e-4) delete next[k]; else next[k] = v;
        setMarkInput(mk.mark, Object.keys(next).length ? next : null);
        recompute();
        const nm = jobMarks().find(m => m.mark === mk.mark);
        toast(`${mk.mark} at ${ft(mkDz(nm).span)} × ${ft(mkDz(nm).trib)} → ${nm && nm.desc ? nm.desc : 'no section'}`);
      };
      inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
    });
    $('#biReset').onclick = () => { setMarkInput(mk.mark, null); recompute(); toast(`${mk.mark} back to the layout ${ft(mk.span)} × ${ft(mk.trib)}`); };
    $('#biTry').onclick = () => dzOpen('beam', mk.mark);
    const sbb = $('#biSetback');
    if (sbb) sbb.onclick = () => { const { span, ...rest } = (state.settings.markInput || {})[mk.mark] || {}; setMarkInput(mk.mark, { ...rest, setback: true }); recompute(); const nm = jobMarks().find(m => m.mark === mk.mark); toast(`${mk.mark} at the ${ft(mkDz(nm).span)} clear span (frame column setback) → ${nm && nm.desc ? nm.desc : 'no section'}`); };
  }
  // ---------- how a beam / a column was arrived at: the steps, with this job's numbers (folded under the tabs) ----------
  const RULE_TXT = DESIGN.RULE_TXT;
  function renderBeamHow(mk, r, inp) {
    const el = $('#beamHow');
    if (!el) return;
    $('#beamExplainHead').innerHTML = `How ${esc(mk.mark)} was designed <small>${esc(mk.desc || 'no section')} · the steps, with this job's numbers</small>`;
    const p = mk.params, sr = mk.search, dz = mkDz(mk), s = state.settings;
    if (!p || !sr) { el.innerHTML = '<p>No section search for this mark.</p>'; return; }
    const D = p.dead + p.coll + p.joistWt, A = inp.geom.A.value, C = inp.geom.C.value, slab = (inp.geom.slab.value || 0) * 12, seat = (inp.geom.seat.value || 0) * 12;
    const div = (state.res.division || 'NBS-IN'), stock = DESIGN.candidates(div, { minFlangeWidth: 6, minFlangeThk: 0.25 });
    const removed = Object.entries(sr.removed || {}).sort((a, b) => b[1] - a[1]);
    const nPass = (sr.all || []).length, opt = k => mk.options.find(o => o.key === k), fit = opt('fit');
    const pick = mk.options.find(o => o.key === mk.optionKey);
    el.innerHTML = `<ol>
      <li><b>The load on the beam.</b> Floor dead ${f(p.dead, 1)} + collateral ${f(p.coll, 1)} + joists ${f(p.joistWt, 1)} = <span class="eq">${f(D, 1)} psf</span>, live <span class="eq">${f(p.live, 1)} psf</span>${s.partitionTo === 'live' && +inp.loads.partition.value ? ` (partition ${f(+inp.loads.partition.value, 1)} psf in it)` : ''}, over a <span class="eq">${ft(dz.trib)}</span> trib${mk.kind ? ` — the largest ${esc(mk.kind)} trib of the mark` : ''}: <span class="eq">w = ${f(D * dz.trib / 1000, 3)} k/ft dead, ${f(p.live * dz.trib / 1000, 3)} k/ft live</span> (+ the beam's own weight, as the MB sheet adds it), on a <span class="eq">${ft(dz.span)}</span> span${dz.set ? ' (design span set above)' : ''}. The joists brace the top flange every <span class="eq">${ft(p.Lb)}</span>.</li>
      <li><b>How deep it can be.</b> ${sr.dTop < sr.options.dMax ? `Clearance (C) under the floor beams leaves the room for the beam and its sag: <span class="eq">(A − C) × 12 − slab − seat = (${ft(A)} − ${ft(C)}) × 12 − ${f(slab, 2)} − ${f(seat, 2)} = ${f(sr.room != null ? sr.room : mk.maxDepth, 2)}"</span>. A section fits when its depth plus its total-load deflection (the MB sheet's TOTAL LOAD max deflection) is within that — the bottom of the beam at midspan, sagged, stays at or above C${mk.check ? `: ${esc(mk.desc)} is <span class="eq">${mk.sec.d}" + ${f(mk.check.defl.TL, 2)}" = ${f(mk.sec.d + mk.check.defl.TL, 2)}"</span>` : ''}.` : `No clearance (C) limit below the ${sr.options.dMax}" top of the range (Settings).`} Depths ${sr.options.dMin}"–${sr.dTop}" are searched, an inch at a time.</li>
      <li><b>The plates.</b> ${esc(div)} stock (DM 5.1): webs ${stock.webs.map(t => 'W' + String(Math.round(t * 1000)).padStart(3, '0')).join(', ')}; flanges ${stock.flanges.length} widths × thicknesses, 6"–12" × ¼"–1"${s.symmetric ? ', the same plate top and bottom' : ''}. <b>${sr.evaluated.toLocaleString()}</b> combinations were run through the MB sheet${removed.length ? `; ${removed.reduce((a, x) => a + x[1], 0).toLocaleString()} more were left out by the NBG Production Guidelines: ${removed.map(([k, n]) => `${n.toLocaleString()} ${RULE_TXT[k] || k}`).join(' · ')}` : ''}.</li>
      <li><b>What has to pass</b> (each combination, MB sheet, ASD ${esc(edLabel(state.res.edition.beamEd || ''))}): combined stress ratio ≤ ${s.target} (flexure with the joists bracing the top flange), shear ≤ ${s.target}, live deflection ≤ L/360, total ≤ L/240${s.requireConc ? ', and the joist-seat concentrated-load (bearing) check' : ''}. <b>${nPass.toLocaleString()}</b> pass.</li>
      <li><b>The options.</b> ${(() => { const gs = []; mk.options.forEach(o => { const g = gs.find(x => sameSec(x.sec, o.pick.sec)); if (g) g.roles.push(o); else gs.push({ sec: o.pick.sec, pick: o.pick, roles: [o] }); }); return !gs.length ? 'None: no stocked section passes for these loads within the depth the clearance allows.<ul>' : `${gs.length === 1 ? 'They all land on one section' : `${gs.length} different sections`}:<ul>${gs.map(g => `<li><b>${esc(g.pick.desc)}</b> (${f(g.pick.wt, 1)} plf, ${esc(g.pick.flange)} on ${esc(g.pick.web)}) — ${g.roles.map(o => `<b>${esc(o.label)}</b>: ${esc(o.why)}`).join(' ')}</li>`).join('')}</ul>`; })()}
        ${fit && fit.steps ? `<h5>Best fit, step by step (the quote engineer's method)</h5><ol class="fit-steps">${fit.steps.map(st => `<li>${esc(st.text)}${st.tries && st.tries.length > 1 ? `<div class="fit-tries">${st.tries.map(t => `<span class="${t.ok ? 'ok' : 'no'}">${esc(t.sec || t.web || (t.d != null ? t.d + '"' : ''))}${t.CSR != null ? ` · ${f(t.CSR, 2)}` : t.shear != null ? ` · shear ${f(t.shear, 2)}` : ''}${!t.ok && t.why ? ` — ${esc(t.why)}` : ''}</span>`).join('')}</div>` : ''}</li>`).join('')}</ol>` : ''}
        ${mk.deeper && mk.deeper.length ? `<h5>Lighter, but needs a lower clearance C (depth + sag over the room)</h5><p>${mk.deeper.map(z => `${z.d}" ${esc(z.desc)} ${f(z.wt, 1)} plf, ${f(z.need, 2)}" with its sag (C ≤ ${ft(z.needC)})`).join(' · ')}</p>` : ''}</li>
      <li><b>On the quote:</b> ${pick ? `<b>${esc(pick.label)}</b> — ${mk.pinned && mk.pinned.key ? 'picked on the Design page' : (pick.key !== s.optionDefault ? `the default option (Settings: ${esc(({ lightest: 'Lightest', fit: 'Best fit', econ: 'Most economical' })[s.optionDefault] || s.optionDefault)}) lands on this same section` : 'the default option (Settings)')}` : mk.optionKey === 'custom' ? 'a section picked by depth or by hand' : 'nothing passes'}: <b>${esc(mk.desc || 'NO SECTION')}</b>${mk.check ? ` — combined ${f(mk.check.res.CSR, 3)}, shear ${f(mk.check.res.SRvx, 3)}, live L/${f(mk.check.defl.rLL, 0)}, total L/${f(mk.check.defl.rTL, 0)}; end shear ${f(mk.check.V.D, 2)} k dead, ${f(mk.check.V.L, 2)} k live to the column or frame` : ''}.${(mk.spanRuns || []).length > 1 ? ` The shorter members of the mark (${mkShort(mk)}) take the same section, each checked at its own length.` : ''}</li>
    </ol>`;
  }
  function renderColHow(r, g, cno, nm) {
    const el = $('#colHow');
    if (!el) return;
    const cf = r.colFinal, tried = (g.design ? g.design.tried : (cf && cf.tried) || []);
    $('#colExplainHead').innerHTML = `How the column was chosen <small>${cf ? esc(cf.quoteAs) : 'not sized'} · ${esc(g.cols.map(nm).join(', '))}</small>`;
    const s = r.settings || state.settings, inp = inpOf(r);
    const gc = g.gov || g.cols[0];   // the column drawn beside it: the case's governing column
    const parts = side => (gc.parts || []).filter(q => q.sheetSide === side).map(q => `${esc(q.mezz)} ${esc(q.beam)}${q.mark ? ' (' + esc(q.mark) + ')' : ''}`).join(' + ') || 'no beam';
    el.innerHTML = `<ol>
      <li><b>Which column.</b> ${esc(g.cols.slice().sort((a, b) => (cno.get(a.label) || 1e9) - (cno.get(b.label) || 1e9)).map(nm).join(', '))} — a mezzanine column (not a frame member) under ${g.cols.length > 1 ? (g.env ? 'these grid points, whose reactions agree within 0.01 k, so one Column-sheet case covers them, typed with the largest of each' : 'these grid points, which carry the same loads, so one Column-sheet case covers them') : 'this grid point'}. The C-number counts the job's mezzanine columns on the plan; the grid label is the frame line / column line it stands on.</li>
      <li><b>Its loads.</b> The unfactored end shears (MB sheet H6 / H10) of the beams framing in. ${g.env ? `For ${esc(nm(gc))}, left: ${parts('left')} → <span class="eq">D ${f(gc.DL_L, 2)} / L ${f(gc.LL_L, 2)} k</span>; right: ${parts('right')} → <span class="eq">D ${f(gc.DL_R, 2)} / L ${f(gc.LL_R, 2)} k</span>. The case is typed with the largest of each over its columns: left <span class="eq">D ${f(g.loads.DL_L, 2)} / L ${f(g.loads.LL_L, 2)} k</span>, right <span class="eq">D ${f(g.loads.DL_R, 2)} / L ${f(g.loads.LL_R, 2)} k` : `Left: ${parts('left')} → <span class="eq">D ${f(g.loads.DL_L, 2)} / L ${f(g.loads.LL_L, 2)} k</span>; right: ${parts('right')} → <span class="eq">D ${f(g.loads.DL_R, 2)} / L ${f(g.loads.LL_R, 2)} k`}</span>. Each reaction acts at e = d/2 off the column centre (the Column sheet's eccentricity), and the column's own weight is added.</li>
      <li><b>Its length.</b> <span class="eq">${ft(r.colLen)}</span> — ${s.colLength === 'clear' ? 'the clear height to the underside of the beams (A − slab − seat − beam depth)' : `the top of the mezzanine floor, A = ${ft(inp.geom.A.value)} (the Column sheet's L, braced at the ends only: Lbx = Lby = L). <em class="flag">Not the training guide's:</em> the guide takes the clear height below the beams; A follows your instruction and is the longer (conservative) length — Settings → Column length switches it`}.</li>
      <li><b>The three combinations</b> (DM 15.1.1.4.2): dead + live on the left with dead only on the right, the same the other way, and dead + live on both — the unbalanced cases put the most moment in the column. Each must read OK with CSR ≤ 1.00.</li>
      <li><b>Sizes, in order.</b> The common columns first, lightest first: ${DESIGN.COMMON_COLUMNS.slice().sort((a, b) => WF[a].W - WF[b].W).map(n => `${n} (${WF[n].W} plf)`).join(' → ')}${s.includeW818 ? ', with W8X18 ahead of them' : ''}. The first that passes every case is used${manyMezz() && s.colPerJob !== false ? ' — one section for every mezzanine column of the job' : ''}. If none does, the next heavier W8–W14 that passes is used and quoted as BU (training guide).
        <table><thead><tr><th>Tried</th><th class="num">plf</th><th class="num">Max CSR</th><th>Result</th></tr></thead><tbody>${tried.map(t => `<tr class="${t.ok ? 'pass' : 'fail'}"><td class="mono">${esc(t.name)}</td><td class="num">${f(WF[t.name].W, 0)}</td><td class="num">${f(t.max, 3)}</td><td>${t.ok ? (cf && cf.name === t.name ? 'passes — used' : 'passes') : 'fails'}</td></tr>`).join('')}</tbody></table></li>
      ${cf && cf.picked ? `<li><b>On the quote: ${esc(cf.quoteAs)}${cf.quoteAs !== cf.name ? ` (run as ${esc(cf.name)})` : ''}, picked by hand</b>${cf.sec.type === 'BU' ? ` — on the Column sheet's Built-Up input (C16 "Built-Up": ${cf.sec.d}" deep, ${DESIGN.plateText(cf.sec)})` : ''}, max CSR ${f(cf.max, 3)}${cf.auto ? `. The method above gives ${esc(cf.auto.name)}${cf.auto.quoteAs !== cf.auto.name ? `, quoted ${esc(cf.auto.quoteAs)}` : ''}; "Back to the guide's column" at the top of the page puts it back` : ''}.</li>` : ''}
      <li><b>Tubes / pipe.</b> When a customer asks for tube (HSS) or pipe columns, they are not on the Column sheet — size them separately and note it on the quote; this page designs W / BU only.</li>
    </ol>`;
  }

  function renderBeam() {
    const marks = jobMarks();
    $('#markTabs').innerHTML = marks.map((m, i) => `<button class="tab ${i === state.mark ? 'is-active' : ''}" data-i="${i}"><i class="mk-dot" style="background:${mkHex(m)}"></i>${mkName(m)} · ${esc(m.desc || 'NO SECTION')} · ${m.qtyAll} beam${m.qtyAll === 1 ? '' : 's'}</button>`).join('');
    $$('#markTabs .tab').forEach(t => { t.onclick = () => { state.mark = +t.dataset.i; state.markSpan = 0; renderBeam(); renderMiniPlan(); renderCalcPack(); }; });
    const mk = marks[state.mark];
    if (!mk) { $('#beamInputs').innerHTML = ''; $('#spanRuns').innerHTML = ''; $('#mbSheet').innerHTML = '<div class="empty">No beams.</div>'; $('#altTable').innerHTML = ''; $('#xlBeam').innerHTML = ''; $('#xlBeamSub').textContent = ''; return; }
    // every member length of the mark: the governing run (longest span, largest trib) and the shorter beams — same section, own MB sheet
    // with no section there are no MB runs yet: the member lengths and their counts still come from the layout
    const byLen = () => { const g = new Map(); (mk.beamsAll || []).forEach(x => { const k = +x.span.toFixed(3); g.set(k, (g.get(k) || 0) + 1); }); return [...g].sort((a, b) => b[0] - a[0]).map(([span, qty], i) => ({ span, qty, check: i ? null : mk.check, params: i ? null : mk.params })); };
    const runs = mk.spanRuns && mk.spanRuns.length ? mk.spanRuns : (mk.beamsAll && mk.beamsAll.length ? byLen() : [{ span: mk.span, qty: mk.qtyAll, check: mk.check, params: mk.params }]);
    if (state.markSpan >= runs.length) state.markSpan = 0;
    const run = runs[state.markSpan], gov = state.markSpan === 0, dz = mkDz(mk);
    renderBeamInputs(mk);
    $('#spanRuns').innerHTML = `<div class="sr-head"><span class="eyebrow">MB sheet runs · ${mk.mark}</span><small>${runs.length > 1 ? 'one section; each member length is its own run' : 'one member length'} · trib ${ft(dz.trib)}${mk.kind ? ' (largest ' + mk.kind + ')' : ''}${dz.set ? ' · design inputs set above' : ''}</small>${mk.own ? `<button class="btn-ghost sr-back" id="ownBack" type="button">Back into one mark</button>` : ''}</div>` +
      runs.map((q, i) => `<button class="sr ${i === state.markSpan ? 'is-on' : ''}" data-i="${i}"><b>${ft(runL(q))}</b><span>${q.qty} beam${q.qty === 1 ? '' : 's'}${i === 0 ? ' · designed' : ''}</span><small>${runBeams(mk, q.span)}${Math.abs(runL(q) - q.span) > 1e-3 ? ' · layout ' + ft(q.span) : ''}</small>${q.check ? (() => { const k = q.check, t = state.settings.target, srOK = k.res.CSR <= t && k.res.SRvx <= t, ok = srOK && k.llOK && k.tlOK;   // the failing check: a ratio, or the deflection that fails
        return `<em class="${ok ? 'ok' : 'ng'}">${!srOK || ok ? f(Math.max(k.res.CSR, k.res.SRvx), 3) : !k.llOK ? `L/${f(k.defl.rLL, 0)} live` : `L/${f(k.defl.rTL, 0)} total`}</em>`; })() : ''}</button>`).join('');
    $$('#spanRuns .sr').forEach(b => { b.onclick = () => { state.markSpan = +b.dataset.i; renderBeam(); renderMiniPlan(); }; });
    const ob = $('#ownBack');
    if (ob) ob.onclick = () => {
      // own marks after this one move down a number: their picks and design inputs go with them
      const later = jobMarks().filter(o => o.own && o.index > mk.index).sort((a, b) => a.index - b.index);
      const spans = [...new Set((mk.beamsAll || []).map(x => x.span))];   // an own mark can hold more than one long span
      allSettings().forEach(st => { st.ownSpan = (st.ownSpan || []).filter(v => !spans.some(sp => Math.abs(v - sp) < 1e-3));
        ['override', 'markInput'].forEach(k => { const o = st[k]; if (!o) return; delete o[mk.mark]; later.forEach(l => { const to = 'MB' + l.index; if (o[l.mark] !== undefined) { o[to] = o[l.mark]; delete o[l.mark]; } }); }); }); state.mark = 0; state.markSpan = 0; recompute(); toast(`The ${spans.map(ft).join(' and ')} beam${mk.qtyAll > 1 ? 's are' : ' is'} back in ${mk.qtyAll > 1 ? 'their' : 'its'} mark`); };
    // INPUT-sheet values (A, slab, seat, clearances) of a mezzanine that has this mark — the one on screen when it does
    const r = mk.mezzIds && !mk.mezzIds.includes(state.res.index) && state.job ? state.job.mezz[mk.mezzIds[0]] : state.res;
    const inp = state.all ? state.all[r.index].inputs : state.inputs;
    $('#beamCalcTitle').innerHTML = `${mkName(mk)} · <em class="nocase${mk.sec && !markFails(mk) ? '' : ' ng'}">${esc(mk.desc || 'no section')}${mk.sec && markFails(mk) ? ' · FAILS' : ''}</em>${gov ? '' : ` <small class="bc-run">at ${ft(runL(run))}</small>`}`;
    renderBeamHow(mk, r, inp);
    const c = run.check, p = run.params;
    if (!c) {
      // offered only when the shorter beams would pass on their own (run.js designs them): only the long beam(s) leave the mark
      const sh = mk.splitHelps, nL = sh ? sh.n : 0;
      $('#mbSheet').innerHTML = (mk.rescue ? decideCard([mk], 'decideCardBeam') : `<div class="empty">No stocked section passes for ${esc(mk.mark)} in the depth range — the table below gives the closest at each depth. Add a column, or design one by hand (Design your own).</div>`)
        + (sh && !mk.rescue ? `<div class="split-wrap"><button class="btn-soft" id="splitMarks" type="button">Give the ${ft(sh.span)} beam${nL > 1 ? 's' : ''} ${nL > 1 ? 'their' : 'its'} own mark</button><small class="split-why">the other ${sh.rest} pass on their own (${esc(sh.restDesc)}); no other mark changes</small></div>` : '');
      if (mk.rescue) wireDecide($('#mbSheet'), [mk]);
      const sm = $('#splitMarks');
      if (sm) sm.onclick = () => { const v = +sh.span.toFixed(4), had = jobMarks().find(o => o.own && o.kind === mk.kind); allSettings().forEach(st => { st.ownSpan = [...new Set([...(st.ownSpan || []), v])]; }); recompute(); toast(had ? `The ${ft(sh.span)} beam${nL > 1 ? 's join' : ' joins'} ${had.mark}, the long beams' own mark — the rest keep theirs` : `The ${ft(sh.span)} beam${nL > 1 ? 's have their' : ' has its'} own mark — the rest keep theirs`); };
    }
    else {
      const x = c.res, clear = r.clear;
      // the sheet's own rows (C from the depth alone, as the MB sheet's INPUT has it), then C at midspan with the sag
      const clr = (k, lab) => { const ok = k === 'C' ? clear[k].okSheet : clear[k].ok; return [lab, `${clear[k].req != null ? f(clear[k].req, 2) : '—'} req · ${clear[k].prov != null ? f(clear[k].prov, 2) : '—'} prov ${ok === false ? '· NO GOOD' : ok ? '· OK' : ''}`, ok === false ? 'ng' : '']; };
      const mid = clear.C && clear.C.mid != null && clear.C.sag ? [`C at midspan, less the beam's sag (${clear.C.sag.mark} ${f(clear.C.sag.d, 0)}" + ${f(clear.C.sag.tl, 2)}")`, `${clear.C.req != null ? f(clear.C.req, 2) : '—'} req · ${f(clear.C.mid, 2)} prov ${clear.C.ok === false ? '· NO GOOD' : clear.C.ok ? '· OK' : ''}`, clear.C.ok === false ? 'ng' : 'hl'] : null;
      const lv = dz.set ? layoutV(mk, run) : null;
      $('#mbSheet').innerHTML = beamViz(mk, r, run) + (lv
        ? `<div class="frame-strip"><span class="eyebrow">Floor loads to the frame and columns · ${mk.mark} at the layout ${ft(run.span)} × ${ft(mk.trib)}</span><b>Dead ${f(lv.D, 3)} k</b><b>Live ${f(lv.L, 3)} k</b><small>per beam end, ${esc(mk.desc)} — the MB sheet below is at the design ${ft(runL(run))} × ${ft(dz.trib)} (shear D ${f(c.V.D, 3)} / L ${f(c.V.L, 3)} k, highlighted)</small></div>`
        : `<div class="frame-strip"><span class="eyebrow">MB sheet end shear · ${mk.mark}${runs.length > 1 ? ' at ' + ft(run.span) : ''} × ${ft(mk.trib)} trib</span><b>Dead ${f(c.V.D, 3)} k</b><b>Live ${f(c.V.L, 3)} k</b><small>unfactored, per beam end — highlighted below${mkLessTrib(mk, run) ? ` · ${mkLessTrib(mk, run)} of these beams carry less trib and send less to the frame (each beam's own trib is in the frame loads, Plan page)` : ''}</small></div>`) + mbSheetBody(c, p, mk.sec, [
          ['Dead, (psf)', f(p.dead, 1)], ['Collateral, (psf)', f(p.coll, 1)], ['Live, (psf)', f(p.live, 1)], ['Est. Joist Wt., (psf)', f(p.joistWt, 1)],
          ['Top of Mezzanine, (ft.)', f(inp.geom.A.value, 3)], ['Slab & Deck Thickness, (in.)', f(inp.geom.slab.value * 12, 3)], ['Joist Seat Depth, (in.)', f(inp.geom.seat.value * 12, 3)],
          ['Total Joist Depth, (in.)', r.joistDepthIn != null ? f(r.joistDepthIn, 2) : '—'], ['Beam Depth, (in.)', mk.sec.d],
          clr('A', 'A - Finish floor to top of mezz'), clr('B', 'B - Clearance under joist'), clr('C', 'C - Clearance under support beams'), ...(mid ? [mid] : []),
        ]);
    }
    renderXlBeam(mk, run);
    const sr = mk.search;
    if (!sr) { $('#altTable').innerHTML = ''; $('#altSub').textContent = ''; return; }
    $('#altSub').textContent = `${sr.evaluated.toLocaleString()} stocked combinations checked for ${ft(dz.span)} span × ${ft(dz.trib)} trib${dz.set ? ' (design inputs)' : ''}${sr.best ? ' · click a row to use it' : ' · none passes: the closest at each depth'}`;
    const nearRow = a => { const z = a.near; if (!z) return `<tr class="none"><td class="num">${a.d}"</td><td colspan="10">nothing stocked fits at this depth</td></tr>`;
      return `<tr class="none"><td class="num">${a.d}"</td><td class="mono">${esc(z.desc)} <span class="status-text ng">${f(z.over * 100 - 100, 0)}% over</span></td><td class="mono">${z.web}</td><td class="mono">${z.flange}</td><td>${z.tier}</td><td class="num">${f(z.wt, 2)}</td><td class="num">${f(z.CSR, 3)}</td><td class="num">${f(z.SRv, 3)}</td><td class="num">${f(z.rLL, 0)}</td><td class="num">${f(z.rTL, 0)}</td><td class="num">${z.conc != null ? f(z.conc, 2) : '—'}</td></tr>`; };
    const optAt = sec => (mk.options.find(o => sameSec(o.pick.sec, sec)) || {}).label;
    $('#altTable').innerHTML = `<thead><tr><th class="num">Depth</th><th>Section</th><th>Web</th><th>Flanges</th><th>Econ.</th><th class="num">Wt plf</th><th class="num">Combined</th><th class="num">Shear</th><th class="num">LL L/</th><th class="num">TL L/</th><th class="num">Bearing</th></tr></thead><tbody>` +
      sr.byDepth.map(a => a.none ? (sr.best ? `<tr class="none"><td class="num">${a.d}"</td><td colspan="10">nothing stocked passes at this depth</td></tr>` : nearRow(a)) :
        `<tr class="pick ${sameSec(a.sec, sr.best.sec) ? 'is-best' : ''} ${mk.sec && sameSec(a.sec, mk.sec) ? 'is-chosen' : ''}" data-d="${a.d}"><td class="num">${a.d}"</td><td class="mono"><b>${a.desc}</b>${optAt(a.sec) ? ` <span class="src pcs">${optAt(a.sec)}</span>` : ''}</td><td class="mono">${a.web} (${a.sec.tw})</td><td class="mono">${a.flange}</td><td>${a.tier}</td><td class="num">${f(a.wt, 2)}</td><td class="num">${f(a.CSR, 3)}</td><td class="num">${f(a.SRv, 3)}</td><td class="num">${f(a.rLL, 0)}</td><td class="num">${f(a.rTL, 0)}</td><td class="num">${f(a.conc, 2)}</td></tr>`).join('') + '</tbody>';
    $$('#altTable tr.pick').forEach(tr => { tr.onclick = () => pickDepth(mk.mark, tr.dataset.d); });
  }

  // the MB sheet's results for a check c of section sec under params p (inputRows: the INPUT sheet rows, when there is a job)
  function mbSheetBody(c, p, sec, inputRows) {
    const x = c.res;
    return `<div class="sheet">
        <div>${inputRows ? `<h4>INPUT sheet</h4>${kv(inputRows)}<h4 style="margin-top:16px">Loading and geometric input</h4>` : '<h4>Loading and geometric input</h4>'}${kv([
          ['Member Length, ft. =', f(p.L, 3)], ['Unbraced Length, ft. =', f(p.Lb, 3)], ['Tributary Width, ft. =', f(p.trib, 3)],
          ['Floor Dead + Col. Load, psf =', f(p.dead + p.coll, 3)], ['Floor Live Load, psf =', f(p.live, 3)], ['Dead + Col. + Live Load, psf =', f(p.dead + p.coll + p.live, 2)],
          ['Estimated Joist Weight, psf =', f(p.joistWt, 3)], ['Moment of Inertia (I), in.^4 =', f(x.Ix, 3)],
          ['JOIST WEIGHT', 'w=' + f(c.w.joist, 3) + 'KLF'], ['BEAM WEIGHT', 'w=' + f(c.w.beam, 3) + 'KLF'], ['FDL', 'w=' + f(c.w.FDL, 3) + 'KLF'], ['FLL', 'w=' + f(c.w.FLL, 3) + 'KLF'], ['TOTAL', 'w=' + f(c.w.total, 3) + 'KLF'],
        ])}</div>
        <div><h4>Floor dead load (unfactored)</h4>${kv([['Shear at left / right, kips', f(c.V.D, 3), '', 'hl'], ['Moment, ft.-kips', f(c.M.D, 3)], ['Max. deflection (in)', f(c.defl.DL, 3)], ['Deflection', 'L / ' + f(c.defl.rDL, 0)]])}
          <h4 style="margin-top:14px">Floor live load (unfactored)</h4>${kv([['Shear at left / right, kips', f(c.V.L, 3), '', 'hl'], ['Moment, ft.-kips', f(c.M.L, 3)], ['Max. deflection (in)', f(c.defl.LL, 3)], ['Deflection', 'L / ' + f(c.defl.rLL, 0) + (c.llOK ? '' : '  < L/360'), c.llOK ? 'okc' : 'ng']])}
          <h4 style="margin-top:14px">Total load (unfactored)</h4>${kv([['Shear at left / right, kips', f(c.V.T, 3)], ['Moment, ft.-kips', f(c.M.T, 3)], ['Max. deflection (in)', f(c.defl.TL, 3)], ['Deflection', 'L / ' + f(c.defl.rTL, 0) + (c.tlOK ? '' : '  < L/240'), c.tlOK ? 'okc' : 'ng']])}
          <h4 style="margin-top:14px">Strength results</h4><span class="status-line ${/NG/.test(c.combinedText) ? 'ng' : 'ok'}">${esc(c.combinedText)}</span><span class="status-line ${/NG/.test(c.shearText) ? 'ng' : 'ok'}">${esc(c.shearText)}</span>
          ${kv([['Main Report (MAX SR &gt; 1 = NG)', x.maxSR > 1 ? 'NG' : 'OK', x.maxSR > 1 ? 'ng' : 'okc']])}</div>
        <div><h4>Section geometry</h4>${kv([
          ...(sec.type === 'WF' ? [['Wide-flange/Built-up Sect.:', 'WF'], ['Section Description:', `<b>${esc(c.desc)}</b>`], ['Total Depth, in. =', f(c.res.d, 3)], ['Weight, plf =', f(c.res.Wt, 2)]] : [['Wide-flange/Built-up Sect.:', 'BU'], ['Section Description:', `<b>${esc(c.desc)}</b>`], ['Total Depth, in. =', f(sec.d, 3)], ['Web Thickness, in. =', f(sec.tw, 3)],
          ['O. Flange Width, in. =', f(sec.bof, 3)], ['O. Flange Thickness, in. =', f(sec.tof, 3)], ['I. Flange Width, in. =', f(sec.bif, 3)], ['I. Flange Thickness, in. =', f(sec.tif, 3)]]),
          ['Material Strength Fy, ksi =', sec.type === 'WF' ? '50' : '55'], ['Ultimate Strength Fu, ksi =', sec.type === 'WF' ? '65' : '70'],
        ])}
          <h4 style="margin-top:14px">Main Report detail</h4>${kv([
            ['Tension flange / class', `${x.TfCode} · ${x.flexClass}`], ['h/tw · kc', `${f(x.htw, 1)} · ${f(x.kc, 3)}`], ['Mn (k-in) · Mn/Ω (k-ft)', `${f(x.Mn, 0)} · ${f(x.McxASD / 12, 1)}`],
            ['Rpg · Rpc', `${f(x.Rpg, 3)} · ${f(x.Rpc, 3)}`], ['kv · Cv', `${f(x.kv, 2)} · ${f(x.Cv1, 3)}`], ['Vn/Ω (k)', f(x.VcxASD, 2)],
          ])}
          <h4 style="margin-top:14px">Concentrated load checks (joist bearing)</h4>${c.conc ? kv([
            ['Ru = (D+coll+joist+L)·spacing·trib', f(c.conc.Ru, 2) + ' k'], ['Web local yielding SR', f(c.conc.WLY, 3)], ['Web crippling SR', f(c.conc.WC, 3)],
            ['Web sidesway SR', c.conc.WSB == null ? '--' : f(c.conc.WSB, 3)], ['Result', c.conc.ok ? 'OK' : 'NG — L7 warning', c.conc.ok ? 'okc' : 'ng'],
          ]) : '<div class="faint">not on the 13th-edition sheet</div>'}</div></div>`;
  }

  // ---------- column calc (Column sheet mirror) ----------
  // plate sizes as the shop says them: 0.375 → 3/8, 0.1875 → 3/16, 1 → 1
  const frac = v => {
    const n = Math.round(v * 16);
    if (Math.abs(v * 16 - n) > 0.02) return String(+v.toFixed(4));
    const whole = Math.floor(n / 16), r16 = n % 16, gcd = (a, b) => (b ? gcd(b, a % b) : a), g = gcd(r16, 16);
    return r16 ? `${whole ? whole + ' ' : ''}${r16 / g}/${16 / g}` : String(whole);
  };
  // the beam of a mark, drawn: load, joists at Lb, reactions, deflected shape, moment and shear — and its section to scale
  function beamViz(mk, r, run) {
    const c = run.check, sec = mk.sec, L = runL(run), Lb = r.beamBase.Lb, col = mkHex(mk);
    const x0 = 80, x1 = 660, X = t => x0 + (x1 - x0) * t / L, yB = 150, dp = 28, tfp = 5;
    const wD = c.w.joist + c.w.beam + c.w.FDL, wL = c.w.FLL;
    const o = [];
    o.push(`<text class="bv-cap" x="${x0}" y="22" text-anchor="start">${mkName(mk)} · ${esc(c.desc)} · ${run.qty} beam${run.qty > 1 ? 's' : ''} at ${ft(L)}</text>`);
    // uniform load
    o.push(`<line class="bv-load" x1="${x0}" y1="62" x2="${x1}" y2="62"/>`);
    for (let i = 0; i <= 16; i++) { const x = x0 + (x1 - x0) * i / 16; o.push(`<path class="bv-arr" d="M${x},62 L${x},96 M${x - 4},89 L${x},96 L${x + 4},89"/>`); }
    o.push(`<text class="bv-t" x="${x0}" y="52" text-anchor="start">w = ${f(wD, 3)} D + ${f(wL, 3)} L = <tspan class="bv-b">${f(c.w.total, 3)} klf</tspan>  (trib ${ft(mkDz(mk).trib)})</text>`);
    // joists bearing at the spacing (= unbraced length)
    for (let t = Lb; t < L - 1e-6; t += Lb) o.push(`<line class="bv-joist" x1="${X(t)}" y1="106" x2="${X(t)}" y2="${yB - 3}"/><rect class="bv-seat" x="${X(t) - 3}" y="${yB - 4}" width="6" height="4"/>`);
    o.push(`<text class="bv-s" x="${x1}" y="52" text-anchor="end">joists @ ${ft(Lb)} = unbraced Lb</text>`);
    // the beam (depth exaggerated so it reads)
    o.push(`<rect x="${x0}" y="${yB}" width="${x1 - x0}" height="${tfp}" fill="${col}"/><rect class="bv-web" x="${x0}" y="${yB + tfp}" width="${x1 - x0}" height="${dp - 2 * tfp}" style="fill:${col}"/><rect x="${x0}" y="${yB + dp - tfp}" width="${x1 - x0}" height="${tfp}" fill="${col}"/>`);
    // supports and reactions
    [x0, x1].forEach((x, i) => {
      o.push(`<rect class="bv-col" x="${x - 8}" y="${yB + dp}" width="16" height="46"/><path class="bv-r" d="M${x},${yB + dp + 76} L${x},${yB + dp + 50} M${x - 5},${yB + dp + 57} L${x},${yB + dp + 50} L${x + 5},${yB + dp + 57}"/>`);
      o.push(`<text class="bv-t" x="${x + (i ? -12 : 12)}" y="${yB + dp + 92}" text-anchor="${i ? 'end' : 'start'}">R = D <tspan class="bv-b">${f(c.V.D, 2)}</tspan> · L <tspan class="bv-b">${f(c.V.L, 2)}</tspan> k</text>`);
    });
    // deflected shape
    const yD = yB + dp;
    o.push(`<path class="bv-defl" d="M${x0},${yD} Q${(x0 + x1) / 2},${yD + 34} ${x1},${yD}"/><text class="bv-s" x="${(x0 + x1) / 2}" y="${yD + 30}">Δ live ${f(c.defl.LL, 3)}" = L/${f(c.defl.rLL, 0)} · total L/${f(c.defl.rTL, 0)}</text>`);
    // span
    const yS = yB + dp + 118;
    o.push(`<path class="bv-dim" d="M${x0},${yS - 6} L${x0},${yS + 6} M${x1},${yS - 6} L${x1},${yS + 6} M${x0},${yS} L${x1},${yS}"/><text class="bv-t" x="${(x0 + x1) / 2}" y="${yS - 7}">member length (span) <tspan class="bv-b">${ft(L)}</tspan></text>`);
    // moment and shear
    const yM = yS + 26, yV = yM + 86;
    o.push(`<path class="bv-m" d="M${x0},${yM} Q${(x0 + x1) / 2},${yM + 92} ${x1},${yM} Z"/><text class="bv-t" x="${(x0 + x1) / 2}" y="${yM + 60}">M max <tspan class="bv-b">${f(c.M.T, 1)} ft-k</tspan>  (D ${f(c.M.D, 1)} + L ${f(c.M.L, 1)})</text>`);
    o.push(`<path class="bv-v" d="M${x0},${yV} L${x0},${yV - 22} L${x1},${yV + 22} L${x1},${yV} Z"/><line class="bv-axis" x1="${x0}" y1="${yV}" x2="${x1}" y2="${yV}"/><text class="bv-s" x="${x0 + 8}" y="${yV - 26}" text-anchor="start">V = ${f(c.V.T, 2)} k</text><text class="bv-s" x="${x1 - 8}" y="${yV + 34}" text-anchor="end">−${f(c.V.T, 2)} k</text>`);
    o.push(`<text class="bv-lab" x="20" y="${yM + 22}">M</text><text class="bv-lab" x="20" y="${yV + 4}">V</text>`);
    const H = yV + 44;
    // section to scale
    const bmax = Math.max(sec.bof, sec.bif), k = Math.min(150 / bmax, 290 / sec.d), cx = 140, top = 54, dpx = sec.d * k;
    const fl = (b, t, y) => `<rect x="${cx - b * k / 2}" y="${y}" width="${b * k}" height="${Math.max(2, t * k)}" fill="${col}"/>`;
    const sv = [];
    sv.push(fl(sec.bof, sec.tof, top), `<rect class="bv-web" x="${cx - Math.max(1.6, sec.tw * k) / 2}" y="${top + sec.tof * k}" width="${Math.max(1.6, sec.tw * k)}" height="${(sec.d - sec.tof - sec.tif) * k}" style="fill:${col}"/>`, fl(sec.bif, sec.tif, top + dpx - Math.max(2, sec.tif * k)));
    const xl = cx - bmax * k / 2 - 22;
    sv.push(`<path class="bv-dim" d="M${xl - 5},${top} L${xl + 5},${top} M${xl - 5},${top + dpx} L${xl + 5},${top + dpx} M${xl},${top} L${xl},${top + dpx}"/><text class="bv-t" transform="translate(${xl - 9},${top + dpx / 2}) rotate(-90)">d = ${sec.d}"</text>`);
    sv.push(`<text class="bv-t" x="${cx}" y="${top - 12}">top flange ${frac(sec.bof)} × ${frac(sec.tof)}"</text><text class="bv-t" x="${cx}" y="${top + dpx + 22}">bottom flange ${frac(sec.bif)} × ${frac(sec.tif)}"</text>`);
    sv.push(`<path class="bv-lead" d="M${cx + 2},${top + dpx / 2} L${cx + 46},${top + dpx / 2 - 14}"/><text class="bv-t" x="${cx + 50}" y="${top + dpx / 2 - 16}" text-anchor="start">web ${frac(sec.tw)}"</text>`);
    sv.push(`<text class="bv-cap" x="${cx}" y="22" text-anchor="middle">${esc(c.desc)} · ${f(c.res.Wt, 1)} plf</text><text class="bv-s" x="${cx}" y="${top + dpx + 42}">Fy ${c.Fy || 55} ksi · Ix ${f(c.res.Ix || 0, 0)} in⁴ · drawn to scale</text>`);
    return `<div class="viz"><svg class="bviz" viewBox="0 0 700 ${H}" role="img" aria-label="${mk.mark} elevation">${o.join('')}</svg><svg class="bsec" viewBox="0 0 280 ${H}" role="img" aria-label="${esc(c.desc)} section">${sv.join('')}</svg></div>`;
  }
  // a column case, drawn: the W column with cap and base plates, the beams sitting on it, the two reactions at e = d/2
  function colViz(g, r, cno) {
    const cf = r.colFinal, w = cf.props, c = g.gov || g.cols[0], parts = c.parts || [];   // the case's governing column
    const info = p => { const m = state.job.mezz[p.mi], bm = m.layout.beams[p.id], mk = m.marks.find(q => q.beams.includes(p.id)); return { bm, mk }; };
    const side = sd => parts.filter(p => p.sheetSide === sd);
    const cx = 380, yT = 176, yF = 372, cw = Math.max(26, w.d * 3.3), o = [];
    // slab and joists over the beams
    const dMax = Math.max(1, ...parts.map(p => { const i = info(p); return i.mk && i.mk.sec ? i.mk.sec.d : 18; }));
    const dpx = d => Math.min(84, d * 3.3), ySlab = yT - dpx(dMax) - 30;
    o.push(`<rect class="cv-slab" x="40" y="${ySlab}" width="680" height="12" rx="2"/><text class="cv-s" x="48" y="${ySlab - 6}" text-anchor="start">slab + joists</text>`);
    for (let x = 70; x < 700; x += 46) o.push(`<line class="cv-joist" x1="${x}" y1="${ySlab + 12}" x2="${x}" y2="${ySlab + 22}"/>`);
    // beams: left ends at the column centreline from the left, right from the right
    const beam = (sd, x0, x1) => {
      const ps = side(sd);
      if (!ps.length) return `<rect class="cv-none" x="${Math.min(x0, x1)}" y="${yT - 40}" width="${Math.abs(x1 - x0)}" height="40" rx="3"/><text class="cv-s" x="${(x0 + x1) / 2}" y="${yT - 16}">no beam on this side</text>`;
      const i = info(ps[0]), d = i.mk && i.mk.sec ? i.mk.sec.d : 18, h = dpx(d), col = mkHex(i.mk);
      const a = Math.min(x0, x1), wdt = Math.abs(x1 - x0);
      return `<rect x="${a}" y="${yT - h}" width="${wdt}" height="4" fill="${col}"/><rect class="cv-web" x="${a}" y="${yT - h + 4}" width="${wdt}" height="${h - 8}" style="fill:${col}"/><rect x="${a}" y="${yT - 4}" width="${wdt}" height="4" fill="${col}"/>
        <text class="cv-bl" x="${(x0 + x1) / 2}" y="${yT - h / 2 + 4}">${esc(ps.map(p => `${p.mezz !== r.id ? p.mezz + ' ' : ''}${p.beam}`).join(' + '))} · ${esc(i.mk ? i.mk.mark + ' ' + (i.mk.desc || '') : '')}</text>`;
    };
    o.push(beam('left', 46, cx - 2), beam('right', cx + 2, 714));
    o.push(`<path class="cv-brk" d="M46,${yT - 70} l-6,10 l8,8 l-8,8 l6,10 M714,${yT - 70} l6,10 l-8,8 l8,8 l-6,10"/>`);
    // column, plates, bolts, floor
    o.push(`<rect class="cv-cap" x="${cx - cw / 2 - 9}" y="${yT}" width="${cw + 18}" height="6"/><rect class="cv-col" x="${cx - cw / 2}" y="${yT + 6}" width="${cw}" height="${yF - yT - 14}"/>`);
    o.push(`<rect class="cv-fl" x="${cx - cw / 2}" y="${yT + 6}" width="3.5" height="${yF - yT - 14}"/><rect class="cv-fl" x="${cx + cw / 2 - 3.5}" y="${yT + 6}" width="3.5" height="${yF - yT - 14}"/>`);
    o.push(`<rect class="cv-cap" x="${cx - cw / 2 - 16}" y="${yF - 8}" width="${cw + 32}" height="8"/><line class="cv-bolt" x1="${cx - cw / 2 - 8}" y1="${yF - 10}" x2="${cx - cw / 2 - 8}" y2="${yF + 14}"/><line class="cv-bolt" x1="${cx + cw / 2 + 8}" y1="${yF - 10}" x2="${cx + cw / 2 + 8}" y2="${yF + 14}"/>`);
    o.push(`<line class="cv-floor" x1="30" y1="${yF}" x2="730" y2="${yF}"/>`);
    for (let x = 34; x < 730; x += 12) o.push(`<line class="cv-hatch" x1="${x}" y1="${yF + 1}" x2="${x - 8}" y2="${yF + 9}"/>`);
    // reactions at the flange faces (e = d/2 from the centreline)
    const react = (sd, x, bx) => {
      const ps = side(sd); if (!ps.length) return '';
      const D = sd === 'left' ? g.loads.DL_L : g.loads.DL_R, Lv = sd === 'left' ? g.loads.LL_L : g.loads.LL_R, yA = ySlab - 54;
      return `<path class="cv-arr" d="M${x},${yA + 30} L${x},${yT - 2} M${x - 5},${yT - 10} L${x},${yT - 2} L${x + 5},${yT - 10}"/>
        <rect class="cv-box" x="${bx}" y="${yA - 26}" width="230" height="44" rx="10"/><text class="cv-t" x="${bx + 115}" y="${yA - 8}">${sd.toUpperCase()} REACTION</text><text class="cv-v" x="${bx + 115}" y="${yA + 10}">D ${f(D, 2)} k · L ${f(Lv, 2)} k</text>
        <path class="cv-lead" d="M${bx + (sd === 'left' ? 230 : 0)},${yA - 4} L${x},${yA + 30}"/>`;
    };
    o.push(react('left', cx - cw / 2, 70), react('right', cx + cw / 2, 460));
    // e = d/2 and the height
    const yE = yT + 26;
    o.push(`<path class="cv-dim" d="M${cx},${yE - 5} L${cx},${yE + 5} M${cx - cw / 2},${yE - 5} L${cx - cw / 2},${yE + 5} M${cx - cw / 2},${yE} L${cx},${yE}"/><text class="cv-s" x="${cx - cw / 2 - 6}" y="${yE + 4}" text-anchor="end">e = d/2 = ${f(w.d / 2, 2)}"</text>`);
    const xH = 650;
    o.push(`<path class="cv-dim" d="M${xH - 5},${yT} L${xH + 5},${yT} M${xH - 5},${yF} L${xH + 5},${yF} M${xH},${yT} L${xH},${yF}"/><text class="cv-t" x="${xH + 10}" y="${(yT + yF) / 2}" text-anchor="start">L = ${ft(r.colLen)}</text>`);
    o.push(`<path class="cv-lead" d="M${cx + cw / 2 + 4},${yT + 110} L${cx + cw / 2 + 40},${yT + 96}"/><text class="cv-cl" x="${cx + cw / 2 + 44}" y="${yT + 94}" text-anchor="start">C${cno.get(c.label) || '?'} · ${esc(c.label)} · ${esc(cf.quoteAs)}</text>`);
    const P = g.loads.DL_L + g.loads.LL_L + g.loads.DL_R + g.loads.LL_R;
    o.push(`<text class="cv-s" x="${cx + cw / 2 + 44}" y="${yT + 114}" text-anchor="start">axial P = ${f(P, 2)} k + self-weight</text>`);
    // the section to scale (a W, or a built-up column's plates)
    const k = Math.min(150 / w.bf, 210 / w.d), sx = 140, top = 70, sv = [];
    sv.push(`<rect class="cv-fl" x="${sx - w.bf * k / 2}" y="${top}" width="${w.bf * k}" height="${Math.max(2.5, w.tf * k)}"/><rect class="cv-col" x="${sx - Math.max(2, w.tw * k) / 2}" y="${top + w.tf * k}" width="${Math.max(2, w.tw * k)}" height="${(w.d - 2 * w.tf) * k}"/><rect class="cv-fl" x="${sx - w.bf * k / 2}" y="${top + (w.d - w.tf) * k}" width="${w.bf * k}" height="${Math.max(2.5, w.tf * k)}"/>`);
    const xl = sx - w.bf * k / 2 - 20;
    sv.push(`<path class="cv-dim" d="M${xl - 5},${top} L${xl + 5},${top} M${xl - 5},${top + w.d * k} L${xl + 5},${top + w.d * k} M${xl},${top} L${xl},${top + w.d * k}"/><text class="cv-t" transform="translate(${xl - 9},${top + w.d * k / 2}) rotate(-90)">d = ${w.d}"</text>`);
    sv.push(`<text class="cv-t" x="${sx}" y="${top - 12}">bf = ${w.bf}" · tf = ${w.tf}"</text><text class="cv-t" x="${sx}" y="${top + w.d * k + 24}">tw = ${w.tw}"</text>`);
    sv.push(`<text class="cv-cap2" x="${sx}" y="34">${esc(cf.name)}${cf.quoteAs !== cf.name ? ' (quote ' + esc(cf.quoteAs) + ')' : ''}</text><text class="cv-s" x="${sx}" y="${top + w.d * k + 44}">${f(w.W, 0)} plf · Fy ${cf.Fy || 50} ksi · to scale</text>`);
    // why this case carries what it does: each beam, its span and trib
    const rows = parts.map(p => { const i = info(p); return `<tr><td>${p.sheetSide}</td><td class="mono"><b>${p.mezz !== r.id ? esc(p.mezz) + ' ' : ''}${p.beam}</b></td><td class="mono">${i.mk ? esc(i.mk.mark + ' ' + (i.mk.desc || '')) : '—'}</td><td class="num">${ft(i.bm.span)}</td><td class="num">${ft(i.bm.trib)}${i.bm.extra ? ' <small class="sub-n">incl. ' + esc(i.bm.extra.map(x => x.mezz).join(', ')) + '</small>' : ''}</td><td class="num">${f(p.D, 2)}</td><td class="num">${f(p.L, 2)}</td></tr>`; }).join('');
    const byC = g.cols.slice().sort((a, b) => (cno.get(a.label) || 1e9) - (cno.get(b.label) || 1e9)).map(q => 'C' + (cno.get(q.label) || '?') + ' · ' + esc(q.label)).join(', ');
    const same = g.cols.length > 1 ? `<p class="foot-note">${byC} ${g.env ? `carry reactions within 0.01 k of each other: one case on the sheet, typed with the largest of each (left D ${f(g.loads.DL_L, 2)} / L ${f(g.loads.LL_L, 2)}, right D ${f(g.loads.DL_R, 2)} / L ${f(g.loads.LL_R, 2)} k)${g.ownMax != null && cf.checks[r.colGroups.indexOf(g)] ? `; checked on its own reactions each column reads max CSR ${f(g.ownMax, 3)}${Math.abs(g.ownMax - cf.checks[r.colGroups.indexOf(g)].max) < 5e-4 ? ', the same as the case' : ` or less, against the case's ${f(cf.checks[r.colGroups.indexOf(g)].max, 3)}`}` : ''}. The drawing shows C${cno.get((g.gov || g.cols[0]).label) || '?'} · ${esc((g.gov || g.cols[0]).label)}, the one that carries the most.` : 'carry the same reactions, so they are one case on the sheet.'}</p>` : '';
    return `<div class="viz"><svg class="cviz" viewBox="0 0 760 ${yF + 26}" role="img" aria-label="Column elevation">${o.join('')}</svg><svg class="csec" viewBox="0 0 280 ${yF + 26}" role="img" aria-label="${esc(cf.name)} section">${sv.join('')}</svg></div>
      <div class="table-wrap cv-table"><table><thead><tr><th>Side</th><th>Beam</th><th>Mark · section</th><th class="num">Span</th><th class="num">Trib</th><th class="num">Dead (k)</th><th class="num">Live (k)</th></tr></thead><tbody>${rows}</tbody></table></div>${same}`;
  }
  const colMezz = () => (manyMezz() ? state.job.mezz.filter(m => m && !m.incomplete && m.colGroups && m.colGroups.length) : [state.res].filter(m => m && m.colGroups && m.colGroups.length));
  const colShown = () => { const w = colMezz(); return w.includes(state.res) ? state.res : w[0]; };
  function renderColumn() {
    // every mezzanine's column cases, grouped by mezzanine: the picked mezzanine's when it has columns, else the first
    // that does (an attached lean-to without columns still shows the job's)
    const withCols = colMezz(), r = colShown();
    const clear = msg => { $('#colTabs').innerHTML = ''; $('#colSheet').innerHTML = `<div class="empty">${msg}</div>`; $('#colTried').innerHTML = ''; $('#xlCol').innerHTML = ''; $('#xlColSub').textContent = ''; const h = $('#colHow'); if (h) h.innerHTML = ''; };
    if (!r) { clear('No mezzanine columns in this layout — every beam ends on a building column or wall.'); return; }
    if (r !== state.res) state.colGroup = Math.min(state.colGroup, r.colGroups.length - 1);
    const cf = r.colFinal, cno = colNos();
    const nm = c => `C${cno.get(c.label) || '?'} · ${c.label}`, byNo = cs => cs.slice().sort((a, b) => (cno.get(a.label) || 1e9) - (cno.get(b.label) || 1e9));
    const tabOf = (m, g, i) => { const mf = m.colFinal, on = m === r && i === state.colGroup; return `<button class="tab ${on ? 'is-active' : ''}" data-mi="${m.index}" data-i="${i}">${esc(byNo(g.cols).map(nm).join(', '))}${mf && mf.checks[i] ? `<small class="tab-ratio ${mf.checks[i].ok ? 'ok' : 'ng'}">${f(mf.checks[i].max, 3)}</small>` : '<small class="tab-ratio ng">not sized</small>'}</button>`; };
    $('#colTabs').innerHTML = (r !== state.res ? `<p class="col-note">${esc(state.res.id)} has no mezzanine columns of its own — showing ${esc(r.id)}.</p>` : '') +
      withCols.map(m => (withCols.length > 1 ? `<span class="tab-group">${esc(m.id)}</span>` : '') + m.colGroups.map((g, i) => [g, i]).sort((a, b) => Math.min(...a[0].cols.map(c => cno.get(c.label) || 1e9)) - Math.min(...b[0].cols.map(c => cno.get(c.label) || 1e9))).map(([g, i]) => tabOf(m, g, i)).join('')).join('');
    const exCol = ((r.colGroups[state.colGroup] || {}).cols || []).slice().sort((a, b) => (cno.get(a.label) || 1e9) - (cno.get(b.label) || 1e9))[0], exNo = exCol ? cno.get(exCol.label) : null, exPt = exCol ? exCol.label.split('/') : ['2', 'B'];
    $('#colTabs').insertAdjacentHTML('beforeend', `<div class="name-key"><b>Column names</b> · <span class="mono">C${exNo || 1}</span> the mezzanine column's number on the plan · <span class="mono">${esc(exPt.join('/'))}</span> the grid point, frame line ${esc(exPt[0])} × column line ${esc(exPt[1] || '')} · a tab holds the columns with the same loads (one Column-sheet case). Frame columns are named by their NBG Frame member, <span class="mono">COL02</span>, on the Plan page.</div>`);
    // a case with unknown loads (a beam framing in has no section) has nothing to try yet
    const gNow = r.colGroups[state.colGroup], gKnown = gNow && [gNow.loads.DL_L, gNow.loads.LL_L, gNow.loads.DL_R, gNow.loads.LL_R].every(isFinite);
    if (gKnown) {
      $('#colTabs').insertAdjacentHTML('beforeend', `<button class="btn-soft col-try" id="colTry">Try another column</button>`);
      $('#colTry').onclick = () => dzOpen('col', `${r.index}|${state.colGroup}`);
    }
    $$('#colTabs .tab').forEach(t => { t.onclick = () => { const mi = +t.dataset.mi; if (state.all && mi !== state.mi) switchMezz(mi); state.colGroup = +t.dataset.i; renderColumn(); renderMiniPlan(); renderCalcPack(); }; });
    const g = r.colGroups[state.colGroup];
    const st = r.index === state.mi ? state.settings : (state.all ? state.all[r.index].settings : state.settings);
    // the guide's answer is quoted as BU anyway: a lighter built-up column on the sheet's own Built-Up input, offered
    const alt = state.job.colAlt && state.job.colAlt.over.includes(r.index) ? state.job.colAlt : null, pickBU = !!(st.colOverride && typeof st.colOverride === 'object');
    const altCard = alt ? `<div class="col-alt"><div><b>Lighter built-up column: ${esc(alt.name)}</b><span>${alt.sec.d}" deep · ${DESIGN.plateText(alt.sec)} · max CSR ${f(alt.max, 3)} over ${alt.unsized ? 'the sized cases' : 'every case'} on the Column sheet's Built-Up input · about ${n0(alt.saves)} lb less steel than ${esc(cf ? cf.quoteAs : '')}. The quote keeps the guide's method until you pick it.</span></div><span class="col-alt-btns"><button class="btn-soft" id="colAltUse" type="button">Use ${esc(alt.name)}</button><button class="btn-ghost" id="colAltTry" type="button">Open in Design your own</button></span></div>` : '';
    // a column picked by hand (Design your own, the built-up offer, the W list): said first, with the way back
    const picked = cf && cf.picked ? `<div class="col-alt picked"><div><b>Picked by hand · in the quote: ${esc(cf.quoteAs)}</b><span>${cf.sec.type === 'BU' ? `the Column sheet's Built-Up input — ${cf.sec.d}" deep, ${DESIGN.plateText(cf.sec)}` : `${esc(cf.name)}, Fy 50${cf.quoteAs !== cf.name ? ` — not a common size, so quoted ${esc(cf.quoteAs)} (training guide)` : ''}`} · max CSR ${f(cf.max, 3)}${cf.ok ? '' : ' — fails'}${cf.auto ? ` · the guide's answer is ${esc(cf.auto.name)}${cf.auto.quoteAs !== cf.auto.name ? `, quoted ${esc(cf.auto.quoteAs)}` : ''}` : ''}.</span></div><span class="col-alt-btns"><button class="btn-soft" id="colBack" type="button">Back to the guide's column</button></span></div>` : '';
    if (!cf || !cf.checks[state.colGroup]) $('#colSheet').innerHTML = `<div class="empty ng">${esc((r.colWhy && r.colWhy.text) || 'No column passes.')}</div>`;
    else {
      const chk = cf.checks[state.colGroup], w = cf.props;
      const names = ['DLt+LLt+DRt', 'DLt+DRt+LRt', 'DLt+LLt+DRt+LRt'];
      $('#colSheet').innerHTML = picked + altCard + colViz(g, r, cno) + `<div class="sheet two">
        <div><h4>Span and loading conditions</h4>${kv([
          ['Column Mark:', (() => { const ord = g.cols.slice().sort((a, b) => a.x - b.x || b.y - a.y); return `${esc(ord.map(c => c.label).join(' '))} <small class="sub-n">(${ord.map(c => 'C' + (cno.get(c.label) || '?')).join(', ')})</small>`; })()], ['Column Length, L', f(r.colLen, 4) + ' ft.'], ['X-Axis Unbraced Length, Lbx', f(r.colLen * 12, 2) + ' in.'], ['Y-Axis Unbraced Length, Lby', f(r.colLen * 12, 2) + ' in.'],
          ['Kx / Ky / Kz', '1.000 / 1.000 / 1.000'], ['Section:', `<b>${cf.sec.type === 'BU' ? 'Built-Up · ' + esc(cf.name) : cf.name}</b>`], ['Fy (ksi)', String(cf.Fy || 50)],
          ['Total Depth, d', f(w.d, 3) + ' in.'], ['Flange Width, b', f(w.bf, 3) + ' in.'], ['Flange Thickness, tf', f(w.tf, 3) + ' in.'], ['Web Thickness, tw', f(w.tw, 3) + ' in.'],
        ])}</div>
        <div><h4>Applied loads (beam reactions)</h4>${kv([
          ['Left Beam Reaction — Dead', f(g.loads.DL_L, 2) + ' kip'], ['Left Beam Reaction — Live', f(g.loads.LL_L, 2) + ' kip'],
          ['Right Beam Reaction — Dead', f(g.loads.DL_R, 2) + ' kip'], ['Right Beam Reaction — Live', f(g.loads.LL_R, 2) + ' kip'],
          ['X-Axis Eccentricity, e (d/2)', f(chk.ex, 2) + ' in.'], ['Column self-weight (Wt·L/1000)', f(chk.wt, 3) + ' kip'], ['Columns in this case', esc(byNo(g.cols).map(nm).join(', '))],
        ])}</div>
        <div class="full"><h4>Load combinations</h4><div class="table-wrap"><table><thead><tr><th></th>${names.map(n => `<th class="num">${n}</th>`).join('')}</tr></thead><tbody>
          <tr><td>Mx (ft-kip)</td>${chk.combos.map(k => `<td class="num">${f(k.Mx, 2)}</td>`).join('')}</tr>
          <tr><td>Axial (kip)</td>${chk.combos.map(k => `<td class="num">${f(k.P, 2)}</td>`).join('')}</tr>
          <tr><td>Maximum CSR</td>${chk.combos.map(k => `<td class="num">${f(k.csr, 3)}</td>`).join('')}</tr>
          <tr><td>Design results</td>${chk.combos.map(k => `<td class="num"><span class="status-text ${k.ok ? 'ok' : 'ng'}">${k.okText}</span></td>`).join('')}</tr>
        </tbody></table></div>
        <p class="foot-note">The three combinations are DM 15.1.1.4.2's two loading conditions for a column with beams on both sides: DL + LL one side with DL only on the other (each way), and full DL + LL both sides. ${r.edition.colEd === '16' ? '16th-edition sheet: C10 (Lby) is hard-coded to 120 in. and Fy opens at 55 ksi — type L × 12 and pick Fy 50 (see the steps below).' : 'Run in the Mezzanine Column (AISC ' + (r.edition.colEd || '15') + 'th) sheet.'}</p></div>
      </div>`;
    }
    renderXlCol(r, state.colGroup);
    renderColHow(r, g, cno, nm);
    const tried = g.design ? g.design.tried : [];
    $('#colTried').innerHTML = `<thead><tr><th>Section</th><th class="num">Wt plf</th><th class="num">bf</th><th class="num">Max CSR</th><th>Result</th><th>Quote as</th></tr></thead><tbody>` +
      (tried.length ? '' : `<tr><td colspan="6" class="sub-n">Nothing tried for this case — ${esc((r.colWhy && r.colWhy.text) || 'its loads are not known yet')}</td></tr>`) +
      tried.map(t => { const q = DESIGN.COMMON_COLUMNS.includes(t.name) || t.name === 'W8X18' ? t.name : t.name.replace(/^W(\d+)X/, 'BU$1x');
        return `<tr class="pick ${cf && cf.name === t.name ? 'is-chosen' : ''}" data-n="${t.name}"><td class="mono"><b>${t.name}</b></td><td class="num">${f(WF[t.name].W, 0)}</td><td class="num">${WF[t.name].bf}</td><td class="num">${f(t.max, 3)}</td><td><span class="status-text ${t.ok ? 'ok' : 'ng'}">${t.ok ? 'OK' : 'NG'}</span></td><td class="mono">${q}</td></tr>`; }).join('') +
      `<tr><td colspan="6"><div class="field-row wide" style="border:0"><label>Use a different W for every mezzanine column${manyMezz() && st.colPerJob !== false ? ' of the job' : ''}</label><select id="colPick"><option value="">Automatic${!st.colOverride && cf ? ' (' + cf.name + ')' : ''}</option>${pickBU ? `<option value="__bu" selected>${esc(cf ? cf.name : 'Built-up')} (picked)</option>` : ''}${Object.keys(WF).filter(k => /^W(6|8|10|12|14)X/.test(k)).sort((a, b) => WF[a].W - WF[b].W).map(k => `<option ${st.colOverride === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></td></tr></tbody>`;
    // one column section for the job (Settings): the pick goes on every mezzanine
    const setCol = n => { (st.colPerJob !== false ? allSettings() : [st]).forEach(st => { st.colOverride = n; }); recompute(); };
    $$('#colTried tr.pick').forEach(tr => { tr.onclick = () => setCol(tr.dataset.n === (g.design && g.design.name) ? undefined : tr.dataset.n); });
    $('#colPick').onchange = e => { if (e.target.value !== '__bu') setCol(e.target.value || undefined); };
    const back = $('#colBack');
    if (back) back.onclick = () => { setCol(undefined); toast(`Mezzanine columns → ${cf.auto ? cf.auto.quoteAs : 'the guide\'s column'}`); };
    const au = $('#colAltUse'), at = $('#colAltTry');
    if (au) au.onclick = () => { setCol({ type: 'BU', d: alt.sec.d, tw: alt.sec.tw, bf: alt.sec.bof, tf: alt.sec.tof }); toast(`Mezzanine columns → ${alt.name}`); };
    if (at) at.onclick = () => { dzOpen('col', `${r.index}|${state.colGroup}`); Object.assign(state.dz.col, { type: 'BU', d: alt.sec.d, tw: alt.sec.tw, bf: alt.sec.bof, tf: alt.sec.tof, from: '' }); dzSave(); renderDesigner(); };
  }

  // ---------- design your own: any section and loads through the same MB / Column sheets ----------
  const ENG = window.MZ;
  const DZ_KEY = 'mzd.designer';
  const dzDefault = () => ({
    tab: 'beam',
    beam: { ed: '15', div: 'NBS-IN', dead: 43, coll: 5, live: 125, joistWt: 8, L: 20, Lb: 4, trib: 20, type: 'BU', d: 24, tw: 0.1875, bof: 6, tof: 0.375, sym: true, bif: 6, tif: 0.375, wf: 'W12X26', from: '' },
    col: { ed: '15', L: 11.5, type: 'WF', wf: 'W8X24', d: 10, tw: 0.1875, bf: 8, tf: 0.3125, DL_L: 10, LL_L: 20, DL_R: 10, LL_R: 20, from: '' },
    near: null,
  });
  state.dz = (() => { try { const v = JSON.parse(localStorage.getItem(DZ_KEY) || 'null'); if (v && v.beam && v.col) return { ...dzDefault(), ...v, near: null }; } catch (e) { /* storage off */ } return dzDefault(); })();
  const dzSave = () => { try { const { near, ...keep } = state.dz; localStorage.setItem(DZ_KEY, JSON.stringify(keep)); } catch (e) { /* storage off */ } };
  const PLATE = [0.1875, 0.25, 0.3125, 0.375, 0.5, 0.625, 0.75, 1];
  const WEB = [0.125, 0.135, 0.15, 0.1644, 0.1875, 0.22, 0.25, 0.275, 0.3125, 0.375, 0.5];
  const TIER_WORD = ['economical', 'somewhat economical', 'non-economical'];
  const dzBeamSec = b => (b.type === 'WF' ? { type: 'WF', name: b.wf } : { type: 'BU', d: +b.d, tw: +b.tw, bof: +b.bof, tof: +b.tof, bif: b.sym ? +b.bof : +b.bif, tif: b.sym ? +b.tof : +b.tif });
  const dzBeamP = b => ({ dead: +b.dead, coll: +b.coll, live: +b.live, joistWt: +b.joistWt, L: +b.L, Lb: +b.Lb, trib: +b.trib, edition: b.ed });
  // where the job's numbers can come from: each mark (at its design span / trib) and each column case
  // every mark of the job, a mark with no section too (its loads, span and trib — the section is yours to give)
  const dzBeamSources = () => (state.job ? jobMarks().filter(m => m.params).map(m => ({ key: m.mark, label: `${mkName(m)} · ${m.desc || 'NO SECTION'} · ${ft(m.params.L)} × ${ft(m.params.trib)}`, m })) : []);
  const dzColSources = () => {
    if (!state.job) return [];
    const cno = colNos();
    // the cases with known loads (a column under a beam with no section has none yet), in C-number order
    const known = g => [g.loads.DL_L, g.loads.LL_L, g.loads.DL_R, g.loads.LL_R].every(isFinite), no = g => Math.min(...g.cols.map(c => cno.get(c.label) || 1e9));
    return (state.job.mezz || []).flatMap(r => (r.colGroups || []).map((g, gi) => ({ key: `${r.index}|${gi}`, g, r, gi })).filter(x => known(x.g)))
      .sort((a, b) => no(a.g) - no(b.g)).map(({ key, r, g }) => ({ key, label: `${g.cols.slice().sort((a, b) => (cno.get(a.label) || 1e9) - (cno.get(b.label) || 1e9)).map(c => `C${cno.get(c.label) || '?'} ${c.label}`).join(', ')}${manyMezz() ? ' · ' + r.id : ''}`, r, g }));
  };
  function dzLoadBeam(key) {
    const src = dzBeamSources().find(x => x.key === key);
    if (!src) return;
    const m = src.m, p = m.params, sec = m.sec, b = state.dz.beam;
    Object.assign(b, { from: key, useMark: m.mark, ed: p.edition || b.ed, div: (state.res && state.res.division) || b.div, dead: p.dead, coll: p.coll, live: p.live, joistWt: p.joistWt, L: +(+p.L).toFixed(4), Lb: p.Lb, trib: +(+p.trib).toFixed(4) });
    if (!sec) { /* no section on this mark: keep the section on screen */ }
    else if (sec.type === 'WF') Object.assign(b, { type: 'WF', wf: sec.name });
    else Object.assign(b, { type: 'BU', d: sec.d, tw: sec.tw, bof: sec.bof, tof: sec.tof, bif: sec.bif, tif: sec.tif, sym: sec.bof === sec.bif && sec.tof === sec.tif });
    state.dz.near = null;
  }
  function dzLoadCol(key) {
    const src = dzColSources().find(x => x.key === key);
    if (!src) return;
    const c = state.dz.col, ld = src.g.loads, cf = src.r.colFinal;
    Object.assign(c, { from: key, ed: (src.r.edition && src.r.edition.colEd) || c.ed, L: +(+src.r.colLen).toFixed(4), DL_L: +ld.DL_L.toFixed(3), LL_L: +ld.LL_L.toFixed(3), DL_R: +ld.DL_R.toFixed(3), LL_R: +ld.LL_R.toFixed(3) });
    if (cf && cf.sec.type === 'BU') Object.assign(c, { type: 'BU', d: cf.sec.d, tw: cf.sec.tw, bf: cf.sec.bof, tf: cf.sec.tof });
    else Object.assign(c, { type: 'WF', wf: cf ? cf.name : c.wf });
    state.dz.colNear = null;
  }
  // open the designer on a mark or a column case of the job (the Beam / Column pages' "Try another section")
  function dzOpen(tab, key) { state.dz.tab = tab; if (tab === 'beam') dzLoadBeam(key); else dzLoadCol(key); dzSave(); go('designer'); renderDesigner(); }

  function renderDesigner() {
    const el = $('#dzBody');
    if (!el) return;
    const dz = state.dz;
    // a new job opens the designer on its first mark and column case, not on the last job's numbers
    const jk = state.pcs ? state.pcs.job.quote || state.pcs.job.project || 'job' : null;
    if (jk && state.job && state.dzJob !== jk) {
      // the column case that governs (the job's column at its highest CSR), not just the first C-number
      const cs0 = dzColSources(), gv = x => { const cf = x.r.colFinal, k = cf && cf.checks[x.r.colGroups.indexOf(x.g)]; return k ? k.max : -1; };
      const b0 = dzBeamSources()[0], c0 = cs0.slice().sort((a, b) => gv(b) - gv(a))[0];
      // only once the job has a designed mark: while it still asks for inputs there is nothing to load yet
      if (b0) { state.dzJob = jk; dzLoadBeam(b0.key); if (c0) dzLoadCol(c0.key); dzSave(); }
    }
    $$('#dzTabs button').forEach(b => { b.classList.toggle('is-active', b.dataset.t === dz.tab); b.onclick = () => { dz.tab = b.dataset.t; dzSave(); renderDesigner(); }; });
    el.innerHTML = dz.tab === 'beam' ? dzBeamHTML() : dzColHTML();
    // inputs: every field writes its value and re-checks
    $$('#dzBody [data-dz]').forEach(inp => {
      const ev = inp.tagName === 'SELECT' || inp.type === 'checkbox' ? 'change' : 'input';
      inp.addEventListener(ev, () => {
        const [grp, k] = inp.dataset.dz.split('.'), o = dz[grp];
        o[k] = inp.type === 'checkbox' ? inp.checked : inp.dataset.num != null ? (inp.value === '' ? '' : +inp.value) : inp.value;
        if (k !== 'from') o.from = '';
        dz.near = null; dzSave();
        if (inp.tagName === 'SELECT' || inp.type === 'checkbox') renderDesigner(); else dzResults();
      });
    });
    const ld = $('#dzFrom');
    if (ld) ld.onchange = () => { if (dz.tab === 'beam') dzLoadBeam(ld.value); else dzLoadCol(ld.value); dzSave(); renderDesigner(); };
    const rs = $('#dzReset');
    if (rs) rs.onclick = () => { const d0 = dzDefault(); dz[dz.tab] = d0[dz.tab]; dz.near = null; dzSave(); renderDesigner(); };
    dzResults();
  }
  const dzNum = (key, val, unit, step = 'any', extra = '') => `<label class="dz-f"><span>${unit}</span><input data-dz="${key}" data-num value="${val === '' || val == null ? '' : +(+val).toFixed(4)}" inputmode="decimal" step="${step}" ${extra}></label>`;
  const dzSel = (key, val, opts) => `<select data-dz="${key}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  function dzBeamHTML() {
    const b = state.dz.beam, srcs = dzBeamSources();
    const plates = PLATE.map(t => [t, `${frac(t)}"`]), widths = [5, 6, 8, 10, 12, 14, 16].map(w => [w, `${w}"`]);
    // beam W shapes up to 200 plf (the heavy column shapes are not mezzanine beams, and some are not in every MB sheet's WF database)
    const wfs = Object.keys(WF).filter(k => /^W(8|10|12|14|16|18|21|24)X/.test(k) && WF[k].W <= 200).sort((a, c) => WF[a].d - WF[c].d || WF[a].W - WF[c].W);
    const flange = (pb, pt, label) => `<div class="dz-row"><span class="dz-lab">${label}</span>${dzSel('beam.' + pb, b[pb], widths)}<span class="dz-x">×</span>${dzSel('beam.' + pt, b[pt], plates)}</div>`;
    return `<div class="dz-grid">
      <form class="dz-in panel" onsubmit="return false">
        <div class="dz-head"><h3>Inputs</h3>${srcs.length ? `<select id="dzFrom"><option value="">Start from this job…</option>${srcs.map(x => `<option value="${esc(x.key)}" ${b.from === x.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>` : ''}<button class="btn-ghost" id="dzReset" type="button">Clear</button></div>
        <div class="dz-group"><h5>Sheet</h5><div class="dz-row">${dzSel('beam.ed', b.ed, [['13', '13th · IBC ≤ 2015'], ['15', '15th · IBC 2018/21'], ['16', '16th · IBC 2024']])}${dzSel('beam.div', b.div, DESIGN.DIVISIONS.map(d => [d, d === 'West' ? 'West (NBG-UT)' : d]))}</div></div>
        <div class="dz-group"><h5>Loads (psf) <small>INPUT D14–D17</small></h5><div class="dz-cells">${dzNum('beam.dead', b.dead, 'Dead')}${dzNum('beam.coll', b.coll, 'Collateral')}${dzNum('beam.live', b.live, 'Live')}${dzNum('beam.joistWt', b.joistWt, 'Joist wt.')}</div></div>
        <div class="dz-group"><h5>Geometry (ft) <small>MB D7–D9</small></h5><div class="dz-cells three">${dzNum('beam.L', b.L, 'Member length')}${dzNum('beam.Lb', b.Lb, 'Unbraced (joists @)')}${dzNum('beam.trib', b.trib, 'Trib width')}</div></div>
        <div class="dz-group"><h5>Section <small>MB K19, M22–M27</small></h5>
          <div class="seg dz-type"><button type="button" data-type="BU" class="${b.type === 'BU' ? 'is-active' : ''}">Built-up</button><button type="button" data-type="WF" class="${b.type === 'WF' ? 'is-active' : ''}">Wide flange</button></div>
          ${b.type === 'WF' ? `<div class="dz-row">${dzSel('beam.wf', b.wf, wfs.map(k => [k, `${k} · ${WF[k].W} plf`]))}</div>` : `
          <div class="dz-cells two">${dzNum('beam.d', b.d, 'Depth d (in)', '1')}<label class="dz-f"><span>Web tw (in)</span>${dzSel('beam.tw', b.tw, WEB.map(t => [t, `${t}" · W${String(Math.round(t * 1000)).padStart(3, '0')}`]))}</label></div>
          ${flange('bof', 'tof', b.sym ? 'Flanges (top = bottom)' : 'Top flange')}
          ${b.sym ? '' : flange('bif', 'tif', 'Bottom flange')}
          <label class="dz-chk"><input type="checkbox" data-dz="beam.sym" ${b.sym ? 'checked' : ''}> Same plate top and bottom</label>`}
        </div>
      </form>
      <div class="dz-out" id="dzOut"></div></div>`;
  }
  function dzColHTML() {
    const c = state.dz.col, srcs = dzColSources();
    const wfs = Object.keys(WF).filter(k => /^W(6|8|10|12|14)X/.test(k)).sort((a, b) => WF[a].W - WF[b].W);
    return `<div class="dz-grid">
      <form class="dz-in panel" onsubmit="return false">
        <div class="dz-head"><h3>Inputs</h3>${srcs.length ? `<select id="dzFrom"><option value="">Start from this job…</option>${srcs.map(x => `<option value="${esc(x.key)}" ${c.from === x.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>` : ''}<button class="btn-ghost" id="dzReset" type="button">Clear</button></div>
        <div class="dz-group"><h5>Sheet</h5><div class="dz-row">${dzSel('col.ed', c.ed, [['15', '15th · IBC 2018/21'], ['16', '16th · IBC 2024']])}</div></div>
        <div class="dz-group"><h5>Column <small>Column sheet cells C8, C16${c.type === 'BU' ? '–C20' : ''}</small></h5>
          <div class="seg dz-ctype"><button type="button" data-ctype="WF" class="${c.type !== 'BU' ? 'is-active' : ''}">Wide flange</button><button type="button" data-ctype="BU" class="${c.type === 'BU' ? 'is-active' : ''}">Built-up</button></div>
          <div class="dz-cells two">${dzNum('col.L', c.L, 'Length L (ft)')}${c.type === 'BU' ? dzNum('col.d', c.d, 'Depth d (in)', '1') : `<label class="dz-f"><span>Section</span>${dzSel('col.wf', c.wf, wfs.map(k => [k, `${k} · ${WF[k].W} plf`]))}</label>`}</div>
          ${c.type === 'BU' ? `<div class="dz-row"><span class="dz-lab">Flanges (both)</span>${dzSel('col.bf', c.bf, [6, 8, 10, 12].map(w => [w, `${w}"`]))}<span class="dz-x">×</span>${dzSel('col.tf', c.tf, PLATE.map(t => [t, `${frac(t)}"`]))}</div>
          <div class="dz-row"><span class="dz-lab">Web</span>${dzSel('col.tw', c.tw, WEB.map(t => [t, `${t}" · W${String(Math.round(t * 1000)).padStart(3, '0')}`]))}</div>` : ''}</div>
        <div class="dz-group"><h5>Beam reactions (kip) <small>Column sheet cells C27–D28 · from MB H6 / H10</small></h5><div class="dz-cells">${dzNum('col.DL_L', c.DL_L, 'Left dead')}${dzNum('col.LL_L', c.LL_L, 'Left live')}${dzNum('col.DL_R', c.DL_R, 'Right dead')}${dzNum('col.LL_R', c.LL_R, 'Right live')}</div></div>
      </form>
      <div class="dz-out" id="dzOut"></div></div>`;
  }
  // the beam: the MB sheet's answer, the shop rules, stock and flange economy, and lighter sections near it
  function dzResults() {
    const out = $('#dzOut'), dz = state.dz;
    if (!out) return;
    $$('#dzBody .dz-type button').forEach(btn => { btn.onclick = () => { dz.beam.type = btn.dataset.type; dz.beam.from = ''; dz.near = null; dzSave(); renderDesigner(); }; });
    if (dz.tab === 'col') return dzColResults(out);
    const b = dz.beam, sec = dzBeamSec(b), p = dzBeamP(b);
    const bad = ['dead', 'live', 'L', 'Lb', 'trib'].filter(k => !(+b[k] > 0)).concat(sec.type === 'BU' && !(sec.d > sec.tof + sec.tif) ? ['d'] : []);
    if (bad.length) { out.innerHTML = `<div class="panel dz-empty">Enter ${bad.join(', ')}.</div>`; return; }
    let c;
    try { c = ENG.beamCheck({ ...p, sec }, WF); } catch (e) { out.innerHTML = `<div class="panel dz-empty">That section cannot be analysed: ${esc(e.message || e)}.</div>`; return; }
    const tgt = state.settings.target, x = c.res;
    const okC = isFinite(x.CSR) && x.CSR <= tgt, okV = isFinite(x.SRvx) && x.SRvx <= tgt, okBear = !c.conc || c.conc.ok;
    const pass = okC && okV && c.llOK && c.tlOK && okBear;
    const gov = [['combined', x.CSR, okC], ['shear', x.SRvx, okV], ['live deflection', 360 / c.defl.rLL, c.llOK], ['total deflection', 240 / c.defl.rTL, c.tlOK], ['joist bearing', c.conc ? c.conc.max : 0, okBear]].filter(g => isFinite(g[1])).sort((a1, a2) => a2[1] - a1[1])[0];
    const tile = (lab, val, ok, sub) => `<div class="dz-tile ${ok === false ? 'ng' : ok ? 'ok' : ''}"><span>${lab}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    // the shop: production rules, stock, economical flange plate
    let shop = '';
    if (sec.type === 'BU') {
      const pr = DESIGN.prodChecks(sec, b.div, p.L, x.Wt);
      const plate = (bw, t) => `${bw} × ${frac(t)}`;
      const flanges = [[sec.bof, sec.tof, 'Top flange']].concat(sec.bof !== sec.bif || sec.tof !== sec.tif ? [[sec.bif, sec.tif, 'Bottom flange']] : []);
      const stock = flanges.map(([bw, t, lab]) => ({ lab: `${lab} ${plate(bw, t)}`, ok: DESIGN.inStock(DESIGN.FLANGE_STOCK, bw + 'x' + t, b.div) })).concat([{ lab: `Web ${frac(sec.tw)}" (W${String(Math.round(sec.tw * 1000)).padStart(3, '0')})`, ok: DESIGN.inStock(DESIGN.WEB_STOCK, sec.tw, b.div) }]);
      const econ = flanges.map(([bw, t, lab]) => ({ lab: `${lab} ${DESIGN.flangeName(bw, t) || plate(bw, t)}`, tier: DESIGN.inChart(bw, t) ? DESIGN.tierOf(bw, t) : null }));
      shop = `<div class="dz-checks">
        <div><h5>NBG Production Guidelines · ${esc(b.div)}</h5><ul>${pr.map(r => `<li class="${r.ok ? 'ok' : 'ng'}"><i>${r.ok ? '✓' : '✕'}</i>${esc(r.text)}<em>${esc(r.val)}</em></li>`).join('')}</ul></div>
        <div><h5>DM 5.1 stock · ${esc(b.div)}</h5><ul>${stock.map(r => `<li class="${r.ok ? 'ok' : 'ng'}"><i>${r.ok ? '✓' : '✕'}</i>${esc(r.lab)}<em>${r.ok ? 'stocked' : 'not stocked'}</em></li>`).join('')}</ul>
          <h5>Economical Flange Sections</h5><ul>${econ.map(r => `<li class="${r.tier === 0 ? 'ok' : r.tier === 1 ? 'warn' : 'ng'}"><i>${r.tier === 0 ? '✓' : '!'}</i>${esc(r.lab)}<em>${r.tier == null ? 'not flange material' : TIER_WORD[r.tier]}</em></li>`).join('')}</ul></div></div>`;
    } else {
      shop = `<div class="dz-checks"><div><h5>DM 5.1 stock · ${esc(b.div)}</h5><ul><li class="${DESIGN.inStock(DESIGN.WF_STOCK, sec.name, b.div) ? 'ok' : 'warn'}"><i>${DESIGN.inStock(DESIGN.WF_STOCK, sec.name, b.div) ? '✓' : '!'}</i>${esc(sec.name)}<em>${DESIGN.inStock(DESIGN.WF_STOCK, sec.name, b.div) ? 'stocked' : 'not a stocked W'}</em></li></ul></div></div>`;
    }
    const marks = state.job ? jobMarks() : [];
    const near = dz.near;
    // the clearance C of the mark it would be used for caps the depth: say so on anything deeper
    const um0 = marks.find(m => m.mark === (b.useMark || b.from)) || marks[0], sr0 = um0 && um0.search;
    const cap = sr0 && sr0.dTop < sr0.options.dMax ? sr0.dTop : null;
    // the near-section search stops at the clearance cap of the mark it would go on (never below the low end)
    const nearHi = sc => { const lo = Math.max(state.settings.dMin, sc.d - 3), hi = Math.min(state.settings.dMax, sc.d + 3); return cap != null ? Math.max(lo, Math.min(hi, cap)) : hi; };
    const room0 = sr0 && sr0.room != null ? sr0.room : null;
    const overC = (d, tl) => (room0 != null && tl != null ? (d + tl > room0 + 1e-3 ? `<small class="dz-flag">${d}" deep + ${f(tl, 2)}" sag = ${f(d + tl, 2)}" — more than the ${f(room0, 2)}" of room under ${esc(um0.mark)}'s clearance C</small>` : '') : cap != null && d > cap ? `<small class="dz-flag">deeper than ${esc(um0.mark)}'s clearance allows (${cap}")</small>` : '');
    out.innerHTML = `<div class="panel dz-res">
      <div class="dz-res-head"><div><div class="eyebrow">MB sheet · AISC ${esc(b.ed)}th</div><h3 class="nocase">${esc(c.desc)} <small>${f(x.Wt, 1)} plf · ${secParts(DESIGN.secDims(sec))}</small></h3>${overC(DESIGN.secDims(sec).d, c.defl ? c.defl.TL : null)}</div>
        <span class="dz-pill ${pass ? 'ok' : 'ng'}">${pass ? 'Passes' : 'Does not pass'}${gov ? ` · ${gov[0]} ${gov[0].includes('deflection') ? `L/${f(gov[0] === 'live deflection' ? c.defl.rLL : c.defl.rTL, 0)}` : f(gov[1], 3)}` : ''}</span></div>
      <div class="dz-tiles">
        ${tile('Floor dead · each end', `${f(c.V.D, 3)} k`, null, 'MB H6 · to the column / frame')}
        ${tile('Floor live · each end', `${f(c.V.L, 3)} k`, null, 'MB H10')}
        ${tile('Combined SR', f(x.CSR, 3), okC, `≤ ${tgt}`)}
        ${tile('Shear SR', f(x.SRvx, 3), okV, `≤ ${tgt}`)}
        ${tile('Live deflection', `L/${f(c.defl.rLL, 0)}`, c.llOK, '≥ L/360')}
        ${tile('Total deflection', `L/${f(c.defl.rTL, 0)}`, c.tlOK, '≥ L/240')}
        ${tile('Joist bearing', c.conc ? f(c.conc.max, 3) : '—', c.conc ? okBear : null, c.conc ? 'MB L7' : '13th sheet: none')}
        ${tile('Moment', `${f(c.M.T, 1)} ft-k`, null, `D ${f(c.M.D, 1)} + L ${f(c.M.L, 1)}`)}
      </div>
      ${shop}
      <div class="dz-actions">
        ${marks.length ? `<label class="dz-use">Use for ${dzSel('beam.useMark', b.useMark || (marks.find(m => m.mark === b.from) || marks[0]).mark, marks.map(m => [m.mark, `${m.mark}${m.kind ? ' · ' + m.kind : ''} (now ${m.desc || 'NO SECTION'})`]))}</label><button class="btn-soft" id="dzUse" type="button" ${pass ? '' : 'title="It does not pass — it can still be used, flagged on the Design page"'}>Use this section</button>` : '<span class="sub-n">Load a PCS to use this section for a beam mark.</span>'}
        ${sec.type === 'BU' ? `<button class="btn-ghost" id="dzNear" type="button">Sections that pass, ${Math.max(state.settings.dMin, sec.d - 3)}"–${nearHi(sec)}"${cap != null && cap < Math.min(state.settings.dMax, sec.d + 3) ? ` (${esc(um0.mark)}'s clearance)` : ''}, lightest first</button>` : ''}
      </div>
      ${near ? `<div class="table-wrap"><table class="fl-t dz-near"><thead><tr><th class="num">Depth</th><th>Section</th><th>Web</th><th>Flanges</th><th>Econ.</th><th class="num">plf</th><th class="num">Combined</th><th class="num">Shear</th><th class="num">Live</th><th></th></tr></thead><tbody>${near.length ? near.map((z, i) => `<tr><td class="num mono">${z.d}"</td><td class="mono"><b>${esc(z.desc)}</b>${overC(z.d, z.dTL)}</td><td class="mono">${esc(z.web)}</td><td class="mono">${esc(z.flange)}</td><td>${z.tier}</td><td class="num mono">${f(z.wt, 1)}</td><td class="num mono">${f(z.CSR, 3)}</td><td class="num mono">${f(z.SRv, 3)}</td><td class="num mono">L/${f(z.rLL, 0)}</td><td><button class="btn-ghost dz-take" data-i="${i}" type="button">Load</button></td></tr>`).join('') : '<tr><td colspan="10" class="sub-n">Nothing stocked passes in this depth range.</td></tr>'}</tbody></table></div>` : ''}
      <details class="dz-sheet"><summary>The full MB sheet</summary>${mbSheetBody(c, p, sec, null)}</details>
    </div>`;
    const use = $('#dzUse');
    if (use) use.onclick = () => {
      const mark = $('#dzBody [data-dz="beam.useMark"]').value, before = allSettings().map(st => st.override && st.override[mark]);
      setOverride(mark, { sec });
      if (recompute()) { toast(`${mark} → ${c.desc}${pass ? '' : ' (does not pass — flagged)'}`); return; }
      // the design could not take it: put the mark back as it was and say so
      allSettings().forEach((st, i) => { st.override = { ...(st.override || {}) }; if (before[i] === undefined) delete st.override[mark]; else st.override[mark] = before[i]; });
      recompute(); toast(`${c.desc} could not be put on ${mark} — the mark is unchanged`);
    };
    const nb = $('#dzNear');
    if (nb) nb.onclick = () => {
      const z = DESIGN.designBeam(p, { division: b.div, target: tgt, dMin: Math.max(state.settings.dMin, sec.d - 3), dMax: nearHi(sec), symmetric: state.settings.symmetric, requireConc: state.settings.requireConc, production: state.settings.production !== false });
      // the ones that fit under the mark's clearance first, then the lightest
      const over = e => (cap != null && e.d > cap ? 1 : 0);
      dz.near = (z.all || []).filter(e => e.pass).sort((a1, a2) => over(a1) - over(a2) || a1.wt - a2.wt || a1.d - a2.d).slice(0, 8).map(e => ({ ...e, desc: e.r.desc, web: 'W' + String(Math.round(e.sec.tw * 1000)).padStart(3, '0'), flange: DESIGN.flangeName(e.sec.bof, e.sec.tof), tier: DESIGN.TIER[e.tier], CSR: e.r.res.CSR, SRv: e.r.res.SRvx, rLL: e.r.defl.rLL }));
      dzResults();
    };
    $$('#dzBody .dz-take').forEach(btn => { btn.onclick = () => { const z = dz.near[+btn.dataset.i].sec; Object.assign(dz.beam, { type: 'BU', d: z.d, tw: z.tw, bof: z.bof, tof: z.tof, bif: z.bif, tif: z.tif, sym: z.bof === z.bif && z.tof === z.tif, from: '' }); dzSave(); renderDesigner(); }; });
    const um = $('#dzBody [data-dz="beam.useMark"]');
    if (um) um.onchange = () => { dz.beam.useMark = um.value; dzSave(); };
  }
  // the column: the Column sheet's three combinations, and the common sizes beside it
  function dzColResults(out) {
    const cc = state.dz.col, bu = cc.type === 'BU';
    $$('#dzBody .dz-ctype button').forEach(btn => { btn.onclick = () => { cc.type = btn.dataset.ctype; state.dz.colNear = null; dzSave(); renderDesigner(); }; });   // the loads are still that case's
    const bad = ['L', 'DL_L', 'DL_R'].filter(k => !(+cc[k] >= 0) || cc[k] === '').concat(+cc.L > 0 ? [] : ['L']).concat(bu && !(+cc.d > 0) ? ['d'] : []);
    if (bad.length) { out.innerHTML = `<div class="panel dz-empty">Enter ${[...new Set(bad)].join(', ')}.</div>`; return; }
    const ld = { DL_L: +cc.DL_L, LL_L: +cc.LL_L || 0, DL_R: +cc.DL_R, LL_R: +cc.LL_R || 0 };
    const buSec = bu ? { type: 'BU', d: +cc.d, tw: +cc.tw, bof: +cc.bf, tof: +cc.tf, bif: +cc.bf, tif: +cc.tf } : null;
    const runSec = (sec, Fy) => ENG.columnCheck({ sec, Fy, Fu: Fy === 55 ? 70 : 65, L: +cc.L, Lby: +cc.L * 12, ...ld, edition: cc.ed }, WF);
    const run = name => runSec({ type: 'WF', name }, 50);
    const k = bu ? runSec(buSec, 55) : run(cc.wf), w = bu ? { W: k.Wt, d: buSec.d, bf: buSec.bof, tf: buSec.tof } : WF[cc.wf];
    const name = bu ? DESIGN.buColName(buSec, k.Wt) : cc.wf, div = (state.res && state.res.division) || 'NBS-IN';
    const names = ['DLt+LLt+DRt', 'DLt+DRt+LRt', 'DLt+LLt+DRt+LRt'];
    const common = [...new Set(['W8X18', ...DESIGN.COMMON_COLUMNS, ...(bu ? [] : [cc.wf])])].sort((a, c2) => WF[a].W - WF[c2].W).map(n => ({ n, c: run(n) }));
    const can = state.job && (state.job.mezz || []).some(r => r.columns && r.columns.length);
    // "Use" puts it on every mezzanine column of the job: check it on every case with known loads, each at its own length
    // "Per mezzanine" (Settings): Use goes to the mezzanine on screen only, so only its cases are checked
    const perMz = state.settings.colPerJob === false, mzOn = state.res, scopeTxt = perMz ? `${esc(mzOn.id)}'s` : `the job's`;
    const jobSets = can ? (state.job.mezz || []).filter(r => r && !r.incomplete && r.columns.length && r.colLen && (!perMz || r.index === mzOn.index)).flatMap(r => r.colGroups.filter(g => [g.loads.DL_L, g.loads.LL_L, g.loads.DL_R, g.loads.LL_R].every(isFinite)).map(g => ({ ...g.loads, L: r.colLen, r, g }))) : [];
    const jobK = jobSets.map(q => ({ q, k: ENG.columnCheck({ sec: bu ? buSec : { type: 'WF', name: cc.wf }, Fy: bu ? 55 : 50, Fu: bu ? 70 : 65, L: q.L, Lby: q.L * 12, DL_L: q.DL_L, LL_L: q.LL_L, DL_R: q.DL_R, LL_R: q.LL_R, edition: cc.ed }, WF) }));
    const jobMax = jobK.length ? Math.max(...jobK.map(x => x.k.max)) : null, jobOK = jobK.every(x => x.k.ok), cnoJ = colNos();
    const cOf = c => cnoJ.get(c.label) || 1e9;
    const jobBad = jobK.filter(x => !x.k.ok).sort((a, b) => Math.min(...a.q.g.cols.map(cOf)) - Math.min(...b.q.g.cols.map(cOf))).map(x => x.q.g.cols.slice().sort((a, b) => cOf(a) - cOf(b)).map(c => `C${cOf(c)}`).join(', '));
    // built-up: the shop's limits and the 8" × 1/4" flange for beams on the flange, beside the sheet's answer
    const prod = bu ? DESIGN.prodChecks(buSec, div, +cc.L, k.Wt).filter(q => !['length', 'weight', 'handling'].includes(q.rule) || !q.ok) : [];
    // DM 15.1.1.4.2: a built-up column, or a W quoted as BU, needs an 8" × 1/4" flange (2A); a W quoted as itself (the common
    // sizes, W8X18) is hot-rolled: 7" (2B), and under 7" is acceptable with the standard 4" bolt gage — a note, not a fail
    const quotedBU = bu || !(DESIGN.COMMON_COLUMNS.includes(cc.wf) || cc.wf === 'W8X18'), wfR = WF[cc.wf] || {};
    const flOK = quotedBU ? (bu ? buSec.bof >= 8 && buSec.tof >= 0.25 : wfR.bf >= 8 && wfR.tf >= 0.25) : true;
    const flTile = quotedBU ? { cls: flOK ? 'ok' : 'ng', lab: 'Flange for beams on it (DM 15.1.1.4.2 (2A), built-up)', val: flOK ? '8" × 1/4" or more' : `under 8" × 1/4"${bu ? '' : ` (${f(wfR.bf, 2)}" × ${f(wfR.tf, 3)}")`}` }
      : { cls: wfR.bf >= 7 ? 'ok' : '', lab: 'Flange for beams on it (DM 15.1.1.4.2 (2B), hot-rolled)', val: wfR.bf >= 7 ? `${f(wfR.bf, 2)}" — 7" or more` : `${f(wfR.bf, 2)}" — under 7": acceptable with the standard 4" bolt gage` };
    const near = state.dz.colNear;
    out.innerHTML = `<div class="panel dz-res">
      <div class="dz-res-head"><div><div class="eyebrow">Column sheet · ${esc(cc.ed)}th${bu ? ' · Built-Up input' : ''}</div><h3 class="nocase">${esc(name)} <small>${f(w.W, 1)} plf · d ${f(w.d, 2)}" · bf ${f(w.bf, 2)}"${bu ? ` · tf ${f(w.tf, 4)}" · tw ${f(buSec.tw, 4)}" · Fy 55` : ''} · L ${ft(+cc.L)}</small></h3></div>
        <span class="dz-pill ${k.ok ? 'ok' : 'ng'}">${k.ok ? 'Passes' : 'Does not pass'} · max CSR ${f(k.max, 3)}</span></div>
      <div class="table-wrap"><table class="fl-t dz-combos"><thead><tr><th></th>${names.map(n => `<th class="num">${n}</th>`).join('')}</tr></thead><tbody>
        <tr><td>Mx (ft-kip)</td>${k.combos.map(q => `<td class="num mono">${f(q.Mx, 2)}</td>`).join('')}</tr>
        <tr><td>Axial (kip)</td>${k.combos.map(q => `<td class="num mono">${f(q.P, 2)}</td>`).join('')}</tr>
        <tr><td>Maximum CSR</td>${k.combos.map(q => `<td class="num mono"><b>${f(q.csr, 3)}</b></td>`).join('')}</tr>
        <tr><td>Design result</td>${k.combos.map(q => `<td class="num"><span class="status-text ${q.ok ? 'ok' : 'ng'}">${q.okText}</span></td>`).join('')}</tr></tbody></table></div>
      <div class="dz-tiles four">
        <div class="dz-tile"><span>Eccentricity e = d/2</span><b>${f(k.ex, 2)} in</b></div>
        <div class="dz-tile"><span>Self-weight</span><b>${f(k.wt, 3)} k</b></div>
        <div class="dz-tile"><span>Unbraced Lbx = Lby</span><b>${f(+cc.L * 12, 1)} in</b></div>
        <div class="dz-tile ${flTile.cls}"><span>${flTile.lab}</span><b>${flTile.val}</b></div>${bu ? '' : `<div class="dz-tile ${DESIGN.inStock(DESIGN.WF_STOCK, cc.wf, div) ? 'ok' : ''}"><span>DM 5.1 stock</span><b>${DESIGN.inStock(DESIGN.WF_STOCK, cc.wf, div) ? 'stocked' : 'not stocked'}</b></div>`}
      </div>
      ${bu ? `<div class="dz-checks"><div><h5>NBG Production Guidelines · ${esc(div)}</h5><ul>${prod.map(r => `<li class="${r.ok ? 'ok' : 'ng'}"><i>${r.ok ? '✓' : '✕'}</i>${esc(r.text)}<em>${esc(r.val)}</em></li>`).join('')}</ul></div>
        <div><h5>DM 5.1 stock · ${esc(div)}</h5><ul>${[[`Flanges ${buSec.bof} × ${frac(buSec.tof)}`, DESIGN.inStock(DESIGN.FLANGE_STOCK, buSec.bof + 'x' + buSec.tof, div)], [`Web ${frac(buSec.tw)}" (W${String(Math.round(buSec.tw * 1000)).padStart(3, '0')})`, DESIGN.inStock(DESIGN.WEB_STOCK, buSec.tw, div)]].map(([lab, ok]) => `<li class="${ok ? 'ok' : 'ng'}"><i>${ok ? '✓' : '✕'}</i>${esc(lab)}<em>${ok ? 'stocked' : 'not stocked'}</em></li>`).join('')}</ul></div></div>` : ''}
      <h5 class="dz-h">The common sizes with these loads</h5>
      <div class="table-wrap"><table class="fl-t"><thead><tr><th>Section</th><th class="num">plf</th><th class="num">Max CSR</th><th>Result</th><th></th></tr></thead><tbody>${common.map(q => `<tr class="${!bu && q.n === cc.wf ? 'is-chosen' : ''}"><td class="mono"><b>${q.n}</b></td><td class="num mono">${WF[q.n].W}</td><td class="num mono">${f(q.c.max, 3)}</td><td><span class="status-text ${q.c.ok ? 'ok' : 'ng'}">${q.c.ok ? 'OK' : 'NG'}</span></td><td>${!bu && q.n === cc.wf ? '' : `<button class="btn-ghost dz-pick" data-n="${q.n}" type="button">Load</button>`}</td></tr>`).join('')}</tbody></table></div>
      ${jobK.length ? `<p class="dz-jobchk ${jobOK ? 'ok' : 'ng'}">Across ${scopeTxt} ${jobK.length} column case${jobK.length > 1 ? 's' : ''}: max CSR <b>${f(jobMax, 3)}</b> — ${jobOK ? 'passes every one' : `does not pass ${esc(jobBad.slice(0, 4).join(' · '))}${jobBad.length > 4 ? ' …' : ''}`}</p>` : ''}
      <div class="dz-actions">${can ? `<button class="btn-soft" id="dzUseCol" type="button">Use ${esc(name)} for ${scopeTxt} mezzanine columns</button>` : '<span class="sub-n">Load a PCS to use this column for the job.</span>'}<button class="btn-ghost" id="dzColNear" type="button">Built-up columns that pass${jobSets.length > 1 ? ` every case of ${perMz ? esc(mzOn.id) : 'the job'}` : ''}, lightest first</button></div>
      ${near ? `<div class="table-wrap"><table class="fl-t dz-near"><thead><tr><th class="num">Depth</th><th>Section</th><th>Flanges</th><th>Web</th><th class="num">plf</th><th class="num">Max CSR</th><th></th></tr></thead><tbody>${near.length ? near.map((z, i) => `<tr><td class="num mono">${z.sec.d}"</td><td class="mono"><b>${esc(z.name)}</b></td><td class="mono">${z.sec.bof}" × ${frac(z.sec.tof)}"</td><td class="mono">${z.sec.tw}"</td><td class="num mono">${f(z.W, 1)}</td><td class="num mono">${f(z.max, 3)}</td><td><button class="btn-ghost dz-take-col" data-i="${i}" type="button">Load</button></td></tr>`).join('') : '<tr><td colspan="7" class="sub-n">No stocked built-up column within the shop limits passes these loads.</td></tr>'}</tbody></table><p class="foot-note">Stocked plates for ${esc(div)}, inside the production limits, flanges at least 8" × 1/4" (beams frame to the flange), Fy 55, through the Column sheet's Built-Up input, CSR ≤ ${f(state.settings.target, 2)}.</p></div>` : ''}
    </div>`;
    $$('#dzBody .dz-pick').forEach(btn => { btn.onclick = () => { Object.assign(cc, { type: 'WF', wf: btn.dataset.n }); dzSave(); renderDesigner(); }; });
    $$('#dzBody .dz-take-col').forEach(btn => { btn.onclick = () => { const z = near[+btn.dataset.i].sec; Object.assign(cc, { type: 'BU', d: z.d, tw: z.tw, bf: z.bof, tf: z.tof }); dzSave(); renderDesigner(); }; });
    const nb = $('#dzColNear');
    if (nb) nb.onclick = () => { const sets = jobSets.length ? jobSets.map(({ r, g, ...q }) => q) : [ld]; state.dz.colNear = DESIGN.designBUColumn(sets, { L: +cc.L, edition: cc.ed, division: div, target: state.settings.target, count: 8 }); dzColResults(out); };
    const u = $('#dzUseCol');
    if (u) u.onclick = () => {
      const pick = bu ? { type: 'BU', d: buSec.d, tw: buSec.tw, bf: buSec.bof, tf: buSec.tof } : cc.wf;
      (state.settings.colPerJob !== false ? allSettings() : [state.settings]).forEach(st => { st.colOverride = pick; });
      const qName = !bu && !(DESIGN.COMMON_COLUMNS.includes(cc.wf) || cc.wf === 'W8X18') ? `${name} (quoted ${name.replace(/^W(\d+)X/, 'BU$1x')})` : name;
      recompute(); toast(`${perMz ? esc(mzOn.id) + ' m' : 'M'}ezzanine columns → ${qName}${(jobK.length ? jobOK : k.ok) ? '' : ` — does not pass ${jobK.length ? jobBad.join(' · ') : 'this case'} (max CSR ${f(jobK.length ? jobMax : k.max, 3)}), flagged`}`);
    };
  }

  // ---------- inputs ----------
  const compress = arr => {
    if (!arr || !arr.length) return '';
    const out = []; let i = 0;
    while (i < arr.length) { let j = i; while (j + 1 < arr.length && Math.abs(arr[j + 1] - arr[i]) < 1e-6) j++; out.push(`${j - i + 1}@${ft(arr[i])}`); i = j + 1; }
    return out.join(', ');
  };
  const parseSpacing = str => { const l = PCS.spacingList(str); return l.length ? l : listIn(str); };
  const SRC = { pcs: 'PCS', annotation: 'note', deckGuide: 'guide', default: 'std', estimate: 'est.', missing: 'missing', manual: 'edit', none: 'none' };
  function fieldRow(path, label, kind, sub) {
    const [grp, key] = path.split('.');
    const node = state.inputs[grp][key];
    const isObj = node && typeof node === 'object' && !Array.isArray(node) && 'value' in node;
    const val = isObj ? node.value : node;
    const shown = val == null ? '' : kind === 'ftin' ? ft(val) : kind === 'in' ? +(val * 12).toFixed(4) : kind === 'list' ? compress(val) : val;
    const src = isObj ? node.source : (grp === 'building' ? 'pcs' : '');
    const badge = src ? `<span class="src ${src}" title="${esc(isObj && node.note ? node.note : '')}">${SRC[src] || src}</span>` : '';
    const note = isObj && node.note ? `<small>${esc(node.note)}</small>` : sub ? `<small>${esc(sub)}</small>` : '';
    return `<div class="field-row ${kind === 'list' ? 'wide' : ''}"><label>${label}${badge}${note}</label><input data-path="${path}" data-kind="${kind}" value="${esc(shown)}"></div>`;
  }
  function renderInputs() {
    const inp = state.inputs, r = state.res;
    const checks = (grp, title) => {
      const m = state.pcs && state.pcs.mezzanines[state.mi], c = m && m.checks && m.checks[grp];
      if (!c || !Object.keys(c).length) return '';
      return `<div class="field-row full"><label>${title}</label><div class="checks">${Object.entries(c).map(([k, v]) => `<span class="check ${v ? 'on' : ''}">${v ? '☑' : '☐'} ${esc(k)}</span>`).join('')}</div></div>`;
    };
    const deckSel = `<div class="field-row"><label>Deck type<small>${inp.mezz.deckText ? 'PCS: ' + esc(inp.mezz.deckText) : 'Per seller → 1.0C (training guide)'}</small></label><select data-mezz="deck">${Object.entries(DESIGN.DECKS).map(([k, d]) => `<option value="${k}" ${inp.mezz.deck === k ? 'selected' : ''} title="${d.label}">${k} ${d.label.includes('composite') ? 'comp.' : 'form'}</option>`).join('')}</select></div>`;
    const concSel = `<div class="field-row"><label>Concrete<small>${inp.mezz.concrete === 'LW' ? 'lightweight' : 'standard weight'} · from the material checkbox</small></label><select data-mezz="concrete"><option value="NW" ${inp.mezz.concrete !== 'LW' ? 'selected' : ''}>NW · 145 pcf</option><option value="LW" ${inp.mezz.concrete === 'LW' ? 'selected' : ''}>LW · 110 pcf</option></select></div>`;
    const deadReset = inp.loads.dead && !inp.loads.dead.auto && inp.loads.dead.source === 'manual' ? `<div class="field-row"><label>Dead load<small>typed by hand</small></label><button class="btn-ghost" id="deadReset">Back to deck guide</button></div>` : '';
    const ck = checks('material', 'Material (not by seller)') + checks('use', 'Floor use') + checks('provided', 'Materials provided by seller') + checks('joists', 'Bar joist and bridging');
    const many = state.all && state.all.length > 1;
    const link = many ? `<div class="field-row full link-row"><label>Edits apply to<small>loads, elevations, clearances and joists; the footprint is always per mezzanine</small></label>
      <div class="seg" id="linkSeg"><button data-l="1" class="${state.linkEdits !== false ? 'is-active' : ''}">Every mezzanine (${state.all.length})</button><button data-l="0" class="${state.linkEdits === false ? 'is-active' : ''}">Only ${esc(inp.mezz.id || 'this one')}</button></div></div>` : '';
    $('#inputsGrid').innerHTML = [
      link,
      '<div class="group-title">Mezzanine loading (Box 22)</div>',
      fieldRow('loads.dead', 'Dead, (psf)', 'num'), deadReset, concSel, deckSel, fieldRow('loads.coll', 'Collateral, (psf)', 'num'), fieldRow('loads.live', 'Live, (psf)', 'num'),
      fieldRow('loads.partition', 'Partition, (psf)', 'num', `added to ${state.settings.partitionTo}`), fieldRow('loads.joistWt', 'Est. joist wt., (psf)', 'num'),
      '<div class="group-title">Elevations &amp; joists</div>',
      fieldRow('geom.A', '(A) Finish floor to top of mezzanine', 'ftin'), fieldRow('geom.B', '(B) Min. clearance under joist', 'ftin'), fieldRow('geom.C', '(C) Min. clearance under support beams', 'ftin', state.inputs.geom.C && state.inputs.geom.C.source === 'none' ? 'no requirement (entered)' : 'the beam and its sag fit in A − C − slab − seat'),
      fieldRow('geom.slab', 'Slab & deck thickness, (in.)', 'in'), fieldRow('geom.seat', 'Joist seat depth, (in.)', 'in'), fieldRow('geom.joistSpacing', 'Joist spacing (= beam Lb)', 'ftin'),
      `<div class="field-row"><label>Total joist depth, (in.)<small>A − B − slab − seat</small></label><div class="calc">${r.joistDepthIn != null ? f(r.joistDepthIn, 2) + '"' : '—'}</div></div>`,
      '<div class="group-title">Mezzanine footprint</div>',
      fieldRow('geom.width', 'Width (along endwall)', 'ftin'), fieldRow('geom.length', 'Length (along sidewall)', 'ftin'), fieldRow('geom.startLEW', 'Start from LEW', 'ftin'), fieldRow('geom.startFSW', 'Start from FSW', 'ftin'),
      ck ? '<div class="group-title">PCS checkboxes</div>' + ck : '',
      '<div class="group-title">Building (Box 2 / Box 5)</div>',
      fieldRow('building.width', 'Building width', 'ftin'), fieldRow('building.length', 'Building length', 'ftin'),
      fieldRow('building.bays', 'Sidewall bay spacing (from LEW)', 'list'), fieldRow('building.lewCols', 'LEW column spacing (from FSW)', 'list'), fieldRow('building.rewCols', 'REW column spacing (from FSW)', 'list'),
      `<div class="field-row wide"><label>Frames<small>interior modules from FSW</small></label><div class="calc" style="font-weight:400;font-size:12px;color:var(--ink-muted)">${(inp.building.frames || []).map(fr => `${fr.from}${fr.to !== fr.from ? '–' + fr.to : ''}: ${compress(fr.interior) || '—'}`).join(' · ') || 'clear span'}</div></div>`,
    ].join('');
    $$('#inputsGrid input').forEach(el => { el.onchange = () => onInput(el); });
    $$('#inputsGrid select[data-mezz]').forEach(el => { el.onchange = () => { targets('mezz.' + el.dataset.mezz).forEach(t => { t.mezz[el.dataset.mezz] = el.value; }); recompute(); }; });
    $$('#linkSeg button').forEach(b => { b.onclick = () => { state.linkEdits = b.dataset.l === '1'; renderInputs(); }; });
    const dr = $('#deadReset'); if (dr) dr.onclick = () => { targets('loads.dead').forEach(t => { t.loads.dead = { value: null, source: 'deckGuide', auto: true }; }); recompute(); };
  }
  function onInput(el) {
    const [grp, key] = el.dataset.path.split('.'), kind = el.dataset.kind, raw = el.value.trim();
    let val;
    if (kind === 'ftin') val = raw === '' ? null : (PCS.ftin(raw) ?? PCS.ftin(raw + "'"));
    else if (kind === 'in') val = parseKind('in', raw);
    else if (kind === 'list') val = parseSpacing(raw);
    else val = raw === '' ? null : parseFloat(raw);
    if (kind !== 'list' && raw !== '' && (val == null || !isFinite(val))) { toast('Could not read "' + raw + '"'); renderInputs(); return; }
    targets(el.dataset.path).forEach(t => {
      const node = t[grp][key];
      if (node && typeof node === 'object' && !Array.isArray(node) && 'value' in node) t[grp][key] = { value: val, source: 'manual' };
      else t[grp][key] = val;
    });
    delete state.settings.xLines; delete state.settings.yLines;
    recompute();
  }
  // which mezzanines an Inputs edit goes to: the footprint is per mezzanine; the building is shared by the
  // mezzanines in it; everything else follows the "Edits apply to" choice
  const FOOTPRINT = ['geom.width', 'geom.length', 'geom.startLEW', 'geom.startFSW'];
  function targets(path) {
    if (!state.all || state.all.length < 2 || FOOTPRINT.includes(path)) return [state.inputs];
    const all = state.all.map((a, i) => inputsOf(i));
    if (path.startsWith('building.')) return all.filter(t => (t.mezz.building || '') === (state.inputs.mezz.building || ''));
    return state.linkEdits === false ? [state.inputs] : all;
  }

  // ---------- settings ----------
  function jobsRow() {
    const list = histLoad();
    const last = list.slice(-6).reverse().map(r => `<li><b>${esc(r.quote || r.key)}</b> <span>${esc(r.saved.replace('T', ' '))}</span><small>${esc((r.mezz || []).map(m => `${m.id}: ${(m.beams || []).join(', ')}${m.columns ? ' · ' + m.columns : ''}`).join(' | '))}</small></li>`).join('');
    return `<div class="field-row full jobs-row"><label>${list.length} job${list.length === 1 ? '' : 's'} remembered<small>Saved automatically when a job is fully designed: what you typed for open values, the option you picked, the joist direction and the sections. They make your usual values the first suggestions next time; opening a PCS again starts fresh — a hand-picked section or column and layout edits are not put back (the calc package keeps a record of them). The Seismic page's entries are kept per quote and come back when the same quote opens, with a note and a Clear button. Nothing leaves this computer unless you export it.</small></label>
      <div class="jobs"><ul>${last || '<li class="dim-t">None yet — design a job and it is remembered.</li>'}</ul>
      <div class="jobs-btns"><button class="btn-soft" id="jobsExport" ${list.length ? '' : 'disabled'}>Export (.json)</button><label class="btn-ghost file-btn">Import<input type="file" id="jobsImport" accept=".json,application/json" hidden></label><button class="btn-ghost" id="jobsClear" ${list.length ? '' : 'disabled'}>Forget all</button></div></div></div>`;
  }
  function wireJobs() {
    const ex = $('#jobsExport'), im = $('#jobsImport'), cl = $('#jobsClear');
    if (ex) ex.onclick = () => {
      const blob = new Blob([JSON.stringify({ app: 'mezzanine-design', version: 1, jobs: histLoad() }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mezzanine-jobs.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    if (im) im.onchange = async () => {
      try {
        const data = JSON.parse(await im.files[0].text()), jobs = Array.isArray(data) ? data : data.jobs || [];
        const keep = histLoad().filter(x => !jobs.some(j => j.key === x.key));
        histSave(keep.concat(jobs.filter(j => j && j.key && Array.isArray(j.mezz))));
        toast(`${jobs.length} job${jobs.length === 1 ? '' : 's'} imported`); renderSettings();
      } catch (e) { toast('Could not read that file'); }
    };
    if (cl) cl.onclick = () => { if (confirm('Forget every remembered job on this computer?')) { histSave([]); lastSaved = ''; try { Object.keys(localStorage).filter(k => k.startsWith('mzd.seis.')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* nothing kept */ } state.seisRestored = null; renderSettings(); } };
  }
  function renderSettings() {
    const s = state.settings;
    const sel = (key, label, opts, sub) => `<div class="field-row"><label>${label}${sub ? `<small>${sub}</small>` : ''}</label><select data-set="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    const num = (key, label, sub, step) => `<div class="field-row"><label>${label}${sub ? `<small>${sub}</small>` : ''}</label><input type="number" step="${step || 1}" data-set="${key}" data-num="1" value="${s[key]}"></div>`;
    const code = state.inputs && state.inputs.job.code;
    $('#settingsGrid').innerHTML = [
      '<div class="group-title">Code &amp; stock</div>',
      sel('edition', 'Workbook edition', [['auto', 'Auto from PCS' + (code && code.edition ? ' (' + code.edition + 'th)' : '')], ['15', 'AISC 15th (360-16)'], ['16', 'AISC 16th (360-22)'], ['13', 'AISC 13th (360-05)']], 'IBC 2018/2021 → 15th · IBC 2024 → 16th · ≤ 2015 → 13th'),
      sel('division', 'Division stock', [['auto', 'Auto from PCS'], ...DESIGN.DIVISIONS.map(d => [d, d])], 'DM 5.1 flange / web / WF stock'),
      '<div class="group-title">Beam search</div>',
      sel('optionDefault', 'Option on the quote', [['lightest', 'Lightest'], ['fit', 'Best fit (the step-by-step method)'], ['econ', 'Most economical (Economical Flange Sections)']], 'per job you can still pick any option'),
      num('target', 'Target SR (combined & shear)', '≤ this; the sheet says NG at 1.00', 0.01),
      num('dMin', 'Min. depth, (in.)'), num('dMax', 'Max. depth, (in.)', 'also capped by clearance (C) when given'),
      sel('symmetric', 'Flanges', [['true', 'Same top and bottom'], ['false', 'Allow unequal (IF ≤ OF width)']]),
      sel('production', 'Production Guidelines', [['true', 'Apply'], ['false', 'Off (stock and MB sheet only)']], 'NBG Production Guidelines by division: tw ≤ tf, tw/tf ≥ 0.30, bf ≤ d, d/bf ≤ 7, part limits'),
      sel('requireConc', 'Joist bearing check (MB L7)', [['true', 'Must pass'], ['false', 'Report only']]),
      sel('marks', 'Beam marks', [['intext', 'Interior / exterior'], ['single', 'One governing mark'], ['split', 'Split by trib / span']], 'over the whole job · shorter beams keep the section, own MB run'),
      sel('partitionTo', 'Partition load', [['live', 'Add to live'], ['dead', 'Add to dead']]),
      `<div class="field-row"><label>Frame column setback, rigid frame (ft)<small>a beam that runs into a wall column stops at it, the column held inside the steel line by the girts — offered when a beam does not work; 1.3333 = 1'-4"</small></label><input type="number" step="0.0833" data-set="setbackRigid" data-num="1" value="${+(+s.setbackRigid).toFixed(4)}"></div>`,
      `<div class="field-row"><label>Frame column setback, post-and-beam (ft)<small>also soldier and endwall wind columns; 1.0 = 1'-0"</small></label><input type="number" step="0.0833" data-set="setbackPB" data-num="1" value="${+(+s.setbackPB).toFixed(4)}"></div>`,
      '<div class="group-title">Columns</div>',
      sel('colPerJob', 'Column section', [['true', 'One W for the whole job'], ['false', 'Per mezzanine']], 'several mezzanines: the lightest W that passes every column case'),
      sel('colLength', 'Column length L', [['A', 'Finish floor to top of mezzanine (A)'], ['clear', 'Clear below mezzanine beam (guide)']]),
      sel('includeW818', 'Also try W8X18', [['false', 'No'], ['true', 'Yes']], 'the common sizes are W10X22, W8X24, W12X26; W8X18 is stocked at most divisions'),
      '<div class="group-title">Jobs remembered on this computer</div>',
      jobsRow(),
    ].join('');
    wireJobs();
    $$('#settingsGrid [data-set]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.set; let v = el.value;
        if (el.dataset.num) v = parseFloat(v); else if (v === 'true' || v === 'false') v = v === 'true';
        state.settings[k] = v;
        if (k === 'marks' || k === 'optionDefault') { state.settings.override = {}; state.mark = 0; state.markSpan = 0; }
        if (k === 'marks') { const had = allSettings().some(st => st.override && Object.keys(st.override).length); allSettings().forEach(st => { st.ownSpan = []; }); if (had) setTimeout(() => toast('Beam marks regrouped — sections picked by hand were on the old marks and are cleared'), 0); }
        if (state.all) state.all.forEach(a => { a.settings[k] = v; if (k === 'marks' || k === 'optionDefault') a.settings.override = {}; });
        if (state.inputs) recompute(); else renderSettings();
      };
    });
  }
  renderSettings();
  renderDesigner();
  wbLoadAll().then(() => renderWorkbooks());
})();
