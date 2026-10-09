/* Mezzanine Quick-Design — browser UI (Astra skin). */
(function () {
  'use strict';
  const PCS = window.MZ_PCS, FF = window.MZ_FRAMEFILE, XLS = window.MZ_XLS, RUN = window.MZ_RUN, EX = window.MZ_EXTRACT, DESIGN = window.MZ_DESIGN, WF = window.MZ_WF, PLAN = window.MZ_PLAN, M3 = window.MZ_3D, LAYOUT = window.MZ_LAYOUT;
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
  const mkHex = mk => HEX[(mk && mk.index > 0 ? mk.index : 0) % 4];
  const mkVar = mk => MARK_COLORS[(mk && mk.index > 0 ? mk.index : 0) % 4];
  const mkName = mk => (mk ? mk.mark + (mk.kind ? ' · ' + mk.kind : '') : '');
  const mkOf = (r, id) => (r && r.marks ? r.marks.find(mk => mk.beams.includes(id)) : null);
  const manyMezz = () => !!(state.all && state.all.length > 1);
  // loads to the frame of the building on screen (a job can hold mezzanines in two buildings, each in its own coordinates)
  const sameBldg = q => !q || !q.bkey || !state.res || !state.res.bkey || q.bkey === state.res.bkey;
  const bldgFrameLoads = () => ((state.job && state.job.frameLoads) || []).filter(sameBldg);
  // where a job mark's beams are: "BSW 2 · LEW 2"
  const mkWhere = mk => {
    const ms = state.job ? state.job.mezz : [];
    if (ms.length < 2 || !mk.beamsAll) return '';
    const n = new Map();
    mk.beamsAll.forEach(x => n.set(x.mi, (n.get(x.mi) || 0) + 1));
    return [...n].map(([mi, k]) => `${ms[mi].id} ${k}`).join(' · ');
  };
  // the shorter members of a mark: same section, own MB-sheet run — "+ 1 at 12'-4\""
  const mkShort = mk => (mk.spanRuns || []).filter(q => q.span < mk.span - 1e-3).map(q => `+ ${q.qty} at ${ft(q.span)}`).join(' · ');
  const runOf = (mk, span) => (mk && mk.spanRuns ? mk.spanRuns.find(q => Math.abs(q.span - span) < 1e-3) : null);
  // a mark's MB-sheet span and trib (set on the Beam calc page) vs the layout's; a run's MB-sheet length
  const mkDz = mk => (mk && mk.design) || { span: mk ? mk.span : 0, trib: mk ? mk.trib : 0, cut: 0, set: false };
  const runL = q => (q && q.L != null ? q.L : q ? q.span : 0);
  const mkDims = mk => { const d = mkDz(mk); return `${ft(d.span)} × ${ft(d.trib)}${d.set ? ` <small class="sub-n">design · layout ${ft(mk.span)} × ${ft(mk.trib)}</small>` : ''}`; };
  // the beam end loads that go to the frame and the columns: the layout span and trib with the mark's section
  const layoutV = (mk, q) => (mk && mk.sec && mk.params ? DESIGN.reactions({ ...mk.params, L: q ? q.span : mk.span, trib: mk.trib }, mk.sec) : null);
  const allSettings = () => (state.all ? state.all.map(a => a.settings) : [state.settings]);

  // ---------- one holistic drawing: every mezzanine of the job in this building, drawn together ----------
  function jobView() {
    const r = state.res;
    if (!r || r.incomplete) return [];
    const ms = state.job ? state.job.mezz.filter(o => !o.incomplete && o.grid.length === r.grid.length && o.grid.width === r.grid.width) : [];
    return ms.length ? ms : [r];
  }
  const inpOf = m => (state.all && state.all[m.index] ? state.all[m.index].inputs : state.inputs);
  const atPt = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;
  // C1, C2 … numbered once over the job (plans, 3D, Column page): along the length, then from the BSW
  const colNos = () => new Map(jobView().flatMap(m => m.layout.mezzCols).sort((a, b) => a.x - b.x || b.y - a.y).map((c, i) => [c.label, i + 1]));
  // building columns the mezzanine beams frame into, once each over the job
  const bldgCols = () => { const out = []; jobView().forEach(m => m.layout.supports.filter(sp => sp.building).forEach(sp => { if (!out.some(q => atPt(q, sp))) out.push(sp); })); return out; };
  // the mark that colours a beam: its own, or for an edge carried by a neighbour, the carrying beam's
  const bandMark = (m, b) => (b.absorbed ? mkOf(state.job.mezz[b.absorbed.mi], b.absorbed.into[0]) : mkOf(m, b.id));
  // a column's job record (loads, beams in) and where it is designed
  function colInfo(pt) {
    const job = state.job, c = job && job.columns.find(q => atPt(q, pt));
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
  function symAt(pt) {
    const pc = state.inputs && state.inputs.building && state.inputs.building.planCols, g = state.res && state.res.grid;
    if (!pc || !g) return null;
    const wall = (v, ends) => { const e = ends.find(u => Math.abs(v - u) < 2.6); return e == null ? v : e; };
    const hit = pc.map(c => (c.kind === 'I' ? { ...c, x: wall(c.x, [0, g.length]), y: wall(c.y, [0, g.width]) } : c)).filter(c => Math.hypot(c.x - pt.x, c.y - pt.y) <= 1.25).sort((p, q) => Math.hypot(p.x - pt.x, p.y - pt.y) - Math.hypot(q.x - pt.x, q.y - pt.y))[0];
    return hit ? hit.kind : null;
  }
  // ---------- hover cards: what every column takes (Column-sheet D / L, or the load to the frame), each beam's end shears ----------
  const sideTxt = sd => (sd === 'left' ? 'Left' : sd === 'right' ? 'Right' : '');
  function partRow(p, side) {
    const m = state.job.mezz[p.mi], id = p.id != null ? p.id : +String(p.beam).slice(1) - 1, bm = m.layout.beams[id], mk = mkOf(m, id);
    return `<tr><td class="sd">${sideTxt(side)}</td><td><b>${manyMezz() ? esc(m.id) + ' ' : ''}B${id + 1}</b> <i style="background:${mkHex(mk)}"></i>${mk ? esc(mkName(mk)) : ''}<small>${mk ? esc(mk.desc || '') + ' · ' : ''}${ft(bm.span)} × ${ft(bm.trib)} trib</small></td><td class="d">${f(p.D, 2)}</td><td class="l">${f(p.L, 2)}</td></tr>`;
  }
  function tipHtml(key) {
    const job = state.job, r = state.res;
    if (!job || !r || r.incomplete) return '';
    const [kind, a, b] = key.split('|'), cno = colNos(), many = manyMezz();
    const head = (t, sub) => `<div class="tip-h"><b>${t}</b><span>${sub}</span></div>`;
    const tbl = rows => `<table><thead><tr><th></th><th>beam framing in</th><th>D k</th><th>L k</th></tr></thead><tbody>${rows}</tbody></table>`;
    const pair = (lab, D, L) => `<div><span>${lab}</span><b class="d">D ${f(D, 2)}</b><b class="l">L ${f(L, 2)}</b></div>`;
    if (kind === 'col') {
      const ci = colInfo({ x: +a, y: +b });
      if (!ci) return '';
      const { c, m, gi } = ci, chk = m.colFinal && gi >= 0 ? m.colFinal.checks[gi] : null;
      const rows = ['left', 'right'].map(sd => { const ps = c.parts.filter(p => p.sheetSide === sd); return ps.length ? ps.map((p, i) => partRow(p, i ? '' : sd)).join('') : `<tr><td class="sd">${sideTxt(sd)}</td><td><small>no beam on this side</small></td><td class="d">0.00</td><td class="l">0.00</td></tr>`; }).join('');
      return head(`C${cno.get(c.label) || '?'} · ${esc(c.label)}`, `mezzanine column${many ? ' · ' + esc(m.id) : ''}`) +
        `<div class="tip-k">Column sheet input · beam reactions, unfactored (kips)</div><div class="tip-lr">${pair('Left', c.DL_L, c.LL_L)}${pair('Right', c.DL_R, c.LL_R)}</div>` + tbl(rows) +
        `<div class="tip-f">${m.colFinal ? `<b>${esc(m.colFinal.quoteAs)}</b> · ${ft(m.colLen)} · CSR ${chk ? f(chk.max, 3) : '—'}` : 'not sized yet'} · trib ${f(c.tribArea, 0)} ft²${c.shared ? ' · shared by ' + esc(c.mezzes.map(i => job.mezz[i].id).join(' + ')) : ''}</div>`;
    }
    if (kind === 'bcol') {
      const pt = { x: +a, y: +b }, fl = bldgFrameLoads().find(q => atPt(q, pt)), g = r.grid;
      const lab = fl ? fl.label : `${g.xLabel(pt.x) || ft(pt.x)}/${g.yLabel(pt.y) || ft(pt.y)}`;
      const fe = (job.frameEntries || []).filter(sameBldg).flatMap(f => f.entries.map(e => ({ ...e, frame: f.frame }))).find(e => atPt(e, pt));
      const sym = symAt(pt), drawn = sym ? `<div class="tip-f">On the PCS floor plan: ${sym === 'star' ? '✱ — interior frame column "designated as Most Economical" (pipe, tube or I-shape, set at final design)' : 'I — frame / endwall column'}.</div>` : '';
      if (!fl) return head(esc(lab), 'building column') + drawn + '<div class="tip-f">No mezzanine beam frames into this column.</div>';
      return head(esc(lab), 'building column · load to the frame') + `<div class="tip-k">Mezzanine beam reactions · unfactored (kips)</div><div class="tip-lr one">${pair('Total', fl.D, fl.L)}</div>` +
        tbl(fl.parts.map(p => partRow(p)).join('')) + drawn +
        (fe && fe.eq && fe.eq.length ? `<div class="tip-k">Seismic to the frame · EQR + / EQL − (kips)</div><div class="tip-lr one">${fe.eq.map(q => `<div><span>${esc(q.mezz)}</span><b class="e">±${f(q.F, 2)}</b><small>${q.edited === 'typed' ? `typed · calc. ${f(q.calc, 2)} k` : q.edited === 'scaled' ? `${f(q.calc, 2)} k × ${f(q.F / q.calc, 3)}` : `${Math.round(q.share * 100)} % of ${f(q.frameF, 2)} k`} · at ${ft(q.at)}</small></div>`).join('')}</div>` : '') +
        `<div class="tip-f">${fe ? `NBG Frame: frame line ${esc(fe.frame)}, ${fe.member ? `<b>${esc(fe.member)}</b> (${esc(fe.where)})` : esc(fe.where)}, at ${state.nbg.height === 'beam' ? `${ft(fe.elev)} (T/beam)` : `${ft(fe.A)} (floor level A)`}.` : 'Goes to the frame / endwall design, not the mezzanine Column sheet.'}</div>`;
    }
    if (kind === 'beam' || kind === 'carried') {
      const m = job.mezz[+a], id = +b, bm = m.layout.beams[id];
      const fl = m.layout.joists === 'y' ? m.grid.xLabel : m.grid.yLabel, line = (m.layout.joists === 'y' ? m.grid.yLabel(bm.line) : m.grid.xLabel(bm.line)) || ft(bm.line);
      const where = `line ${esc(line)} · ${esc(fl(bm.from) || ft(bm.from))} → ${esc(fl(bm.to) || ft(bm.to))}`;
      if (kind === 'carried') return head(`${esc(m.id)} edge · B${id + 1}`, where) + `<div class="tip-f">Carried by ${esc(bm.absorbed.mezz)} ${bm.absorbed.into.map(i => 'B' + (i + 1)).join(', ')} on the same line — its ${ft(bm.tribOwn)} trib is added to that beam, so it is not counted here.</div>`;
      const mk = mkOf(m, id), run = runOf(mk, bm.span), rx = mk && mk.sec ? DESIGN.reactions({ ...m.beamBase, L: bm.span, trib: bm.trib }, mk.sec) : null;
      const trib = bm.extra ? `${ft(bm.trib)} <small>(${ft(bm.tribOwn)} + ${bm.extra.map(x => esc(x.mezz) + ' ' + ft(x.tribOwn)).join(' + ')})</small>` : ft(bm.trib);
      return head(`${many ? esc(m.id) + ' ' : ''}B${id + 1} · ${esc(mkName(mk))}`, where) +
        `<div class="tip-sec"><i style="background:${mkHex(mk)}"></i>${esc(mk ? mk.desc || 'no section' : '—')}</div>` +
        `<dl class="tip-dl"><div><dt>Span</dt><dd>${ft(bm.span)}</dd></div><div><dt>Trib</dt><dd>${trib}</dd></div><div><dt>MB sheet run</dt><dd>${mk ? `${ft(run ? runL(run) : mkDz(mk).span)} × ${ft(mkDz(mk).trib)}` : '—'}</dd></div></dl>` +
        (rx ? `<div class="tip-k">End shear, each end · own span and trib (MB H6 / H10)</div><div class="tip-lr one">${pair('Each end', rx.D, rx.L)}</div>` : '') +
        `<div class="tip-f">${mk && mk.kind === 'interior' ? 'Interior: more trib than any edge beam — designed at the largest interior trib.' : mk && mk.kind === 'exterior' ? 'Exterior: edge beam, joists on one side — designed at the largest edge trib.' : ''}</div>`;
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
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1900);
  }
  function status(text, cls) { $('#statusText').textContent = text; $('#statusDot').className = 'dot ' + (cls || ''); }
  async function copyText(txt, msg) {
    try { await navigator.clipboard.writeText(txt); toast(msg); } catch (e) {
      const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(msg); } catch (e2) { toast('Copy blocked — select the table'); }
      ta.remove();
    }
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
    state.nbg.files = [];
    $('#dropSub').textContent = 'Reading…';
    status('Reading PCS', 'warn');
    prog(0.1);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await window.pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        pages.push({ num: n, ...(await EX.extractPage(page)), _page: page });
        prog(0.1 + 0.6 * n / pdf.numPages);
      }
      for (const p of PCS.box22Pages(pages)) {           // checkboxes are vector glyphs: render and look
        const det = await EX.detectChecks(p, PCS.checkboxTargets(p), p._page);
        p.checks = det.states || {};
      }
      state.planPaths = null; state.planReg = null; state.planPage = null;
      for (const p of pages.slice().reverse()) {          // floor plan: no text, thousands of vector paths
        if (p.items.length > 40) continue;
        const paths = PLAN.subpaths(await p._page.getOperatorList(), window.pdfjsLib.OPS, p.height);
        if (paths.length > 2000) { state.planPaths = paths; state.planAnnots = p.annots || []; state.planPage = p.num; break; }
      }
      prog(0.85);
      const pcs = PCS.parse(pages);
      if (!pcs.mezzanines.length) throw new Error('No "22) MEZZANINES" box with a Mezzanine ID was found in this PDF.');
      state.pages = pages; state.pcs = pcs; state.mi = 0; state.planKey = null; state.seis = {}; state.seis = seisLoad();
      readPlan();                                           // grid letters + joist arrows off the drawing
      const keep = keepSettings();
      state.all = pcs.mezzanines.map((m, i) => ({ inputs: RUN.inputsFromPCS(pcs, i), settings: { ...RUN.SETTINGS, ...keep } }));
      state.inputs = state.all[0].inputs; state.settings = state.all[0].settings;
      $('#dropSub').textContent = `${pdf.numPages} pages · ${pcs.mezzanines.length} mezzanine${pcs.mezzanines.length > 1 ? 's' : ''} found`;
      $('#intakeMsg').textContent = 'Parsed. Review the sections, then check the plan against the drawing.';
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
    ['target', 'dMin', 'dMax', 'symmetric', 'requireConc', 'marks', 'colPerJob', 'colLength', 'includeW818', 'partitionTo', 'division', 'edition', 'optionDefault', 'production'].forEach(k => { keep[k] = s[k]; });
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
  }
  function renderMezzTabs() {
    const nav = $('#mezzTabs'), many = state.all && state.all.length > 1 && state.job;
    nav.hidden = !many;
    if (!many) { nav.innerHTML = ''; return; }
    nav.innerHTML = `<span class="mt-title">${state.all.length} mezzanines<small>designed together</small></span>` + state.job.mezz.map((m, i) => {
      const g = state.all[i].inputs.geom, size = `${ft(g.width.value)} × ${ft(g.length.value)}`;
      const beams = m.incomplete ? '' : m.marks.map(mk => `${mk.mark} ${esc(mk.desc || '—')} × ${mk.qty}`).join(' · ');
      const cols = m.incomplete ? '' : m.colFinal ? `${esc(m.colFinal.quoteAs)} × ${m.columns.length}` : (m.columns.length ? 'no column' : 'no columns');
      const st = m.incomplete ? `<em class="mt-need">needs ${m.need.length} input${m.need.length > 1 ? 's' : ''}</em>` : m.warn.some(w => w.level === 'stop') ? '<em class="mt-check">check notes</em>' : '<em class="mt-ok">designed</em>';
      return `<button class="mt ${i === state.mi ? 'is-on' : ''}" data-mi="${i}" aria-pressed="${i === state.mi}"><span class="mt-name">${esc(m.id)}</span><span class="mt-size">${size}</span>${st}<span class="mt-sec">${beams || '—'}${cols ? '<br>' + cols : ''}</span></button>`;
    }).join('');
    $$('#mezzTabs .mt').forEach(b => { b.onclick = () => switchMezz(+b.dataset.mi); });
  }

  // ---------- floor plan ----------
  // Register the drawing to the building grid once per grid: letters as drawn, ⊗ / circled-I columns, joist arrows
  // The drawing is registered to one building (the first mezzanine's); a mezzanine in a building attached to it gets the
  // letters, symbols and joist markup mapped through the attachment, any other building none
  function readPlan() {
    const pcs = state.pcs;
    if (!state.planPaths || !pcs) return;
    if (pcs.planBuilding == null) pcs.planBuilding = (pcs.mezzanines[0] || {}).building || '';
    const host = (state.all || []).find(a => (a.inputs.mezz.building || '') === pcs.planBuilding);
    const b = host ? host.inputs.building : { ...(pcs.building || {}), frames: pcs.frames };
    if (!b || !(b.width > 0)) return;
    const g = LAYOUT.buildingGrid({ width: b.width, length: b.length, bays: b.bays, lewCols: b.lewCols, rewCols: b.rewCols, ridge: b.ridge, frames: b.frames || [] });
    const colY = [...new Set([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()].map(v => +v.toFixed(3)))];
    const key = g.xs.join(',') + '|' + colY.join(',');
    if (state.planKey === key) return;
    state.planKey = key;
    state.planReg = PLAN.registerAndRead(state.planPaths, { xs: g.xs, colY, lewY: g.lewY, rewY: g.rewY, width: g.width, letterLines: g.allY }, state.planAnnots);
    RUN.applyPlan(pcs, state.planReg);
    // letters and column symbols (⊗ / circled I / marked X = mezzanine column, bare I / ✱ = frame column) per mezzanine
    (state.all || []).forEach((a, i) => { const pf = RUN.planFor(pcs, i); a.inputs.building.yLetters = pf.yLetters; a.inputs.building.planCols = pf.planCols; a.inputs.mezz.planJoists = pcs.mezzanines[i].planJoists || null; a.inputs.mezz.planJoistsFrom = pcs.mezzanines[i].planJoistsFrom || null; });
  }

  // ---------- compute ----------
  function recompute() {
    if (!state.inputs) return;
    if (state.all) { state.all[state.mi] = { inputs: state.inputs, settings: state.settings }; readPlan(); }
    const items = (state.all || [{ inputs: state.inputs, settings: state.settings }]).map(a => ({ inp: a.inputs, settings: a.settings }));
    try { state.job = RUN.runJob(items, { seis: state.seis }); state.res = state.job.mezz[state.all ? state.mi : 0]; } catch (err) { console.error(err); status('Design error: ' + err.message, 'bad'); return; }
    planCheck();
    if (state.mark >= jobMarks().length) { state.mark = 0; state.markSpan = 0; }
    if (state.colGroup >= state.res.colGroups.length) state.colGroup = 0;
    $$('#nav button').forEach(b => { b.disabled = false; });
    $('#copyQuote').disabled = !!state.res.incomplete; $('#printBtn').disabled = false;
    const bad = state.res.warn.some(w => w.level === 'stop');
    const ok = !state.res.incomplete && state.res.marks.length && state.res.marks.every(m => m.sec) && (!state.res.columns.length || state.res.colFinal);
    const open = state.job && state.job.mezz.some(m => m.incomplete);
    status(open ? 'Needs input' : ok ? (bad ? 'Designed · check notes' : 'Designed') : 'Needs attention', open ? 'warn' : ok ? (bad ? 'warn' : 'ok') : 'bad');
    renderAll();
    remember();
  }

  // Compare the mezzanine-column symbols on the PCS floor plan with every mezzanine's columns
  const nearest = (arr, v) => arr.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), arr[0]);
  function planCheck() {
    const r = state.res;
    r.planCheck = null;
    if (!state.planPaths || r.incomplete) return;
    const reg = state.planReg;
    if (!reg || !reg.ok) {
      r.planCheck = { ok: false, reason: reg ? reg.reason : 'not read' };
      r.warn.push({ level: 'info', text: `Floor plan (page ${state.planPage}): the mezzanine columns could not be read automatically (${r.planCheck.reason}) — confirm the layout against the drawing.` });
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
    r.planCheck = { ok: true, cols: seen, labels, ...cmp };
    const many = state.job.mezz.length > 1;
    const per = many ? ' (' + state.job.mezz.filter(m => !m.incomplete).map(m => `${m.id} ${m.columns.length}`).join(', ') + ')' : '';
    const sym = reg.columns.some(c => c.markup) ? 'marked-up X' : reg.columns.some(c => c.kind === 'i') ? 'circled-I' : '⊗';
    if (reg.numberOffset > 0) r.warn.push({ level: 'info', text: `The floor plan numbers the ${state.pcs.planBuilding || 'building'} frame lines from ${1 + reg.numberOffset} (${reg.numberOffset === 1 ? 'one extra line' : reg.numberOffset + ' extra lines'} drawn ahead of its LEW, such as an attached building's end); this design keeps the PCS frame lines 1–${reg.frameLines} (Box 5, the NBG Frame files).` });
    if (!reg.columns.length) r.warn.push({ level: 'info', text: `Floor plan (page ${state.planPage}): no mezzanine column symbols found on the drawing — confirm the columns by eye.` });
    else if (cmp.agree) r.warn.unshift({ level: 'ok', text: `Floor plan check: the drawing shows ${labels.length} ${sym} mezzanine column${labels.length === 1 ? '' : 's'} at ${labels.join(', ')} — matches ${many ? 'the mezzanines\u2019' : 'this'} layout${per}.` });
    else {
      const others = jobCols.filter(q => q.owner !== r.index);
      const alt = r.layout.alt ? PLAN.compare(reg.columns, others.concat(r.layout.alt.mezzCols)) : null;
      r.warn.unshift({ level: 'stop', text: `Floor plan check: the drawing shows ${sym} columns at ${labels.join(', ') || 'none'}; the layout has ${jobCols.map(c => c.label).sort().join(', ') || 'none'}.` +
        (alt && alt.agree ? ' The other joist direction matches the drawing — switch it on the Plan page.' : ' Adjust the beam / support lines on the Plan page to match the drawing.') });
    }
    if (r.layout.why && /PCS floor plan/.test(r.layout.why)) r.warn.unshift({ level: 'ok', text: `Joists span ${r.layout.joists === 'y' ? 'across the width' : 'along the length'}, read from ${r.layout.why.replace(/^joist arrows/, 'the "Mez. Jst." arrows')}.` });
  }

  // one mezzanine's figures: its own beams (each at its member length) and the columns it owns
  function totals(r = state.res) {
    const own = r.layout.beams.filter(b => !b.absorbed);
    const beams = own.reduce((a, b) => { const mk = mkOf(r, b.id); return a + (mk && mk.check ? b.span * mk.check.res.Wt : 0); }, 0);
    const nB = r.marks.reduce((a, mk) => a + mk.qty, 0), nC = r.columns.length;
    const cols = r.colFinal ? nC * r.colLen * WF[r.colFinal.name].W : 0;
    const plates = nB * 40 + (r.colFinal ? nC * 46 : 0);
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

  function renderAll() { renderRail(); renderResults(); renderPlan(); renderFrameLoads(); renderSeismic(); renderBeam(); renderColumn(); renderInputs(); renderSettings(); renderWorkbooks(); renderDesigner(); renderCalcPack(); }

  // ---------- rail + masthead ----------
  function renderRail() {
    const inp = state.inputs, r = state.res, t = totals();
    const c = inp.job.code || {};
    $('#fCode').textContent = (c.text ? (c.text.match(/IBC\s*\d{4}|NBCC\s*\d{4}/i) || [c.text])[0] + ' → ' : '') + (r.edition.ed ? edLabel(r.edition.ed) : '—');
    $('#fDiv').textContent = r.division;
    $('#mastContext').textContent = [inp.job.quote, inp.job.project, inp.mezz.id ? `Mezzanine “${inp.mezz.id}”` : ''].filter(Boolean).join(' · ');
    $('#stampMezz').hidden = true;
    renderMezzTabs();
    const many = state.all && state.all.length > 1;
    if (r.incomplete) { $('#rsSub').textContent = 'Needs input — see Design'; renderMiniPlan(); return; }
    const jt = many ? jobTotals() : t;
    $('#rsSub').textContent = many ? `${state.job.mezz.filter(m => !m.incomplete).map(m => m.id).join(' + ')} · ${jt.nB} beams · ${jt.nC} columns` : `${t.nB} beams · ${t.nC} columns`;
    $('#navPlanCount').hidden = false;
    $('#navPlanCount').textContent = `${jt.nB}·${jt.nC}`;
  }

  // ---------- design (results) ----------
  const chip = (lab, val, ok) => `<span class="chip ${ok === true ? 'ok' : ok === false ? 'bad' : ''}"><b>${lab}</b>${val}</span>`;
  function secParts(sec) {
    if (!sec) return '';
    const fl = DESIGN.flangeName(sec.bof, sec.tof), fi = DESIGN.flangeName(sec.bif, sec.tif);
    return `${sec.d}" · web ${sec.tw}" · ${fl === fi ? fl + ' (' + sec.bof + ' × ' + sec.tof + ')' : 'OF ' + fl + ' / IF ' + fi}`;
  }
  // MB sheet: floor dead / live load (unfactored) — shear at left / right, kips: the beam end loads that go to the frame
  function floorCard() {
    const rows = jobMarks().filter(mk => mk.check).flatMap(mk => (mk.spanRuns && mk.spanRuns.length ? mk.spanRuns : [{ span: mk.span, check: mk.check }]).map((q, i) =>
      { const v = mkDz(mk).set ? layoutV(mk, q) : q.check.V; return `<span class="fl-row"><b>${mk.mark}${i ? `<small>${ft(q.span)}</small>` : ''}</b><span>D ${f(v.D, 2)}</span><span>L ${f(v.L, 2)}</span></span>`; })).join('');
    return `<div class="metric floor"><div class="metric-copy"><span>Floor loads to the frame</span>
      <div class="fl-rows">${rows || '—'}</div>
      <small>kips · unfactored shear at left &amp; right (MB sheet)</small></div></div>`;
  }
  const ringCard = (label, value, sub, ratio, color) => `<div class="metric"><div class="metric-copy"><span>${label}</span><b class="nocase">${value}</b><small>${sub}</small></div>${ratio == null ? '' : `<div class="ring" data-ring="${pct(ratio).toFixed(1)}" style="--ring:0;--ring-color:${color || (ratio <= state.settings.target ? 'var(--green)' : ratio <= 1 ? 'var(--amber)' : 'var(--red)')}"></div>`}</div>`;
  // rings sweep in and whole numbers count up, as in the Astra dashboard
  function animateIn() {
    requestAnimationFrame(() => requestAnimationFrame(() => $$('[data-ring]').forEach(el => el.style.setProperty('--ring', el.dataset.ring))));
    $$('[data-count]').forEach(el => {
      const to = +el.dataset.count, fmt = el.dataset.fmt || '', dur = 900, t0 = performance.now();
      const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = to * e;
        el.textContent = fmt === 'lb' ? Math.round(v).toLocaleString('en-US') + ' lb' : fmt === 'L' ? 'L/' + Math.round(v) : fmt === 'sr' ? v.toFixed(2) : String(Math.round(v));
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
  function entered(inp) {
    const o = {};
    ENTER.forEach(pth => { const [g, k] = pth.split('.'), n = inp[g][k]; if (n && (n.source === 'manual' || n.source === 'none')) o[pth] = n.source === 'none' ? 'none' : +(+n.value).toFixed(4); });
    return o;
  }
  let lastSaved = '';
  function remember() {
    try {
      if (!state.pcs || !state.all || !state.job || state.job.mezz.some(m => m.incomplete)) return;
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
    } catch (e) { /* never let remembering break a design */ }
  }
  // the values you have typed most for a field on other jobs
  function usual(path) {
    const cur = jobKey(), cnt = new Map();
    histLoad().filter(r => r.key !== cur).forEach(r => {
      const seen = new Set();
      (r.mezz || []).forEach(m => { const v = m.entered && m.entered[path]; if (v == null || seen.has(String(v))) return; seen.add(String(v)); cnt.set(String(v), (cnt.get(String(v)) || 0) + 1); });
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
      const inp = inputsOf(i), m = rec.mezz.find(x => x.id === inp.mezz.id), v = m && m.entered ? m.entered[q.path] : null;
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
    const show = v => (v === 'none' ? 'No requirement' : q.kind === 'ftin' ? ft(v) : q.kind === 'in' ? `${+(v * 12).toFixed(3)}"` : String(v));
    const mine = usual(q.path).map(u => [u.v, show(u.v), `your usual · ${u.n} job${u.n > 1 ? 's' : ''}`, 'usual']);
    const same = (a, b) => String(a) === String(b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-4);
    return mine.concat(base.filter(b => !mine.some(m => same(m[0], b[0]))));
  }
  function setNeed(path, value) {
    const [g, k] = path.split('.'), row = needRows().find(q => q.path === path);
    (row ? row.mezz : [state.mi]).forEach(i => { inputsOf(i)[g][k] = value === 'none' ? { value: null, source: 'none' } : { value, source: 'manual' }; });
    recompute();
  }
  function wireNeed() {
    $$('#needCard input[data-need]').forEach(el => { el.onchange = () => { const v = parseKind(el.dataset.kind, el.value); if (v == null || !isFinite(v)) { toast('Could not read "' + el.value + '"'); return; } setNeed(el.dataset.need, v); }; });
    $$('#needCard .chip').forEach(b => { b.onclick = () => setNeed(b.dataset.need, b.dataset.v === 'none' ? 'none' : +b.dataset.v); });
    const ag = $('#needAgain'); if (ag) ag.onclick = useAgain;
  }
  // notes, grouped: what to check, what was confirmed against the PCS, the design decisions, then how it was read
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
      out.push({ key: `beam|${b.copy}|${b.marks.join('+')}`, kind: 'beam', ed: b.edition === '13' ? '13' : b.edition === '16' ? '16' : '15', title: b.sheets.map(x => `${x.mark} ${ft(x.span)}`).join(' · '), sub: b.sheets.map(x => x.sheet).join(', '),
        note: b.inputs.length > 1 ? `INPUT with ${inp.mezz}'s heights` : '', name: `${q}-MB${b.copy > 1 ? '-' + b.copy : ''}.xls`, steps, read: b.sheets.flatMap(sh => sh.read).concat(inp.read) });
    });
    ex.column.forEach(b => b.cases.forEach(c => {
      const r = (state.job.mezz || [])[c.mi], g = r && r.colGroups[c.group];
      const lab = g ? g.cols.map(x => `C${cno.get(x.label) || '?'}`).join(', ') : c.labels.join(', ');
      out.push({ key: `column|${c.mi}|${c.group}`, kind: 'column', ed: b.edition === '16' ? '16' : '15', title: `${lab}${manyMezz() ? ' · ' + c.mezz : ''}`, sub: c.labels.join(', '), note: '', name: `${q}-Column-${lab.replace(/[^A-Za-z0-9]+/g, '')}.xls`, steps: c.steps, read: c.read });
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
    if (!j) return;
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
    const groups = [['beam', 'Beam design'], ['column', 'Columns'], ['seismic', 'Seismic']].map(([k, t]) => { const xs = jobs.filter(j => j.kind === k); return xs.length ? `<div class="wb-group"><h5>${t} <small>${esc(WB_NAME[k](xs[0].ed))}</small></h5><div class="wb-rows">${xs.map(j => `<div class="wb-row"><div><b>${esc(j.title)}</b><small>${esc(j.sub || '')} · ${j.steps.length} cells${j.note ? ' · ' + esc(j.note) : ''}</small></div>${wbBtn(j.key, 'Download')}</div>`).join('')}</div></div>` : ''; }).join('');
    el.innerHTML = `${jobs.length ? `<div class="cp-lead"><button class="btn-soft" data-cpdl="xlsx"><svg><use href="#i-file"/></svg>Design basis (.xlsx)</button><button class="btn-ghost" data-cpdl="all">Everything (.zip)</button><small>The design basis workbook: every input and its source, the MB and Column sheet cells and results, the options and how they were found, the shop rules, stock, flange economy, frame and seismic loads, and the sources. Everything adds the filled workbooks below.</small></div>` : ''}
      <div class="wb-have">${have || '<span class="sub-n">No workbooks added yet.</span>'}<label class="btn-ghost wb-add"><input type="file" accept=".xls" multiple hidden id="wbFile">Add workbooks…</label></div>
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
    const sheets = window.MZ_CALCPACK.sheets(state.job, { inputs: state.all ? state.all.map(a => a.inputs) : [state.inputs], settings: state.settings, codeText: state.inputs && state.inputs.job && state.inputs.job.code ? state.inputs.job.code.text : '', generated: new Date().toISOString().slice(0, 10) });
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
      toast(`${name}.zip — the package and ${files.length - 1} filled workbook${files.length === 2 ? '' : 's'}${missing.size ? ` · add ${[...missing].join(', ')} to include ${missing.size > 1 ? 'them' : 'it'}` : ''}`);
    } catch (e) { toast('Calc package: ' + (e.message || e)); }
  }
  document.addEventListener('click', ev => { const b = ev.target.closest('[data-cpdl]'); if (b) { ev.preventDefault(); cpDownload(b.dataset.cpdl); } });
  function renderCalcPack() {
    const ready = !!(state.job && state.job.marks && state.job.marks.length);
    const nWb = state.job ? wbJobs().filter(j => wbFind(j.kind, j.ed)).length : 0, nAll = state.job ? wbJobs().length : 0;
    $$('.calcpack').forEach(el => {
      el.innerHTML = !ready ? '' : `<div class="cp-bar"><div class="cp-t"><b>Calc package</b><small>The inputs and where each came from, the ${el.dataset.cp === 'col' ? 'Column' : 'MB'} sheet cells and results, the options, the shop rules, stock and flange economy — for the engineer checking the design.</small></div>
        <div class="cp-btns"><button class="btn-soft" data-cpdl="xlsx"><svg><use href="#i-file"/></svg>Design basis (.xlsx)</button>${el.dataset.cp === 'col' ? (state.res && state.res.colGroups && state.res.colGroups.length ? wbBtn(`column|${state.res.index}|${state.colGroup}`, 'Column workbook') : '') : (() => { const mk = jobMarks()[state.mark], b = mk && (state.job.excel.beam || []).find(x => x.marks.includes(mk.mark)); return b ? wbBtn(`beam|${b.copy}|${b.marks.join('+')}`, 'MB workbook') : ''; })()}<button class="btn-ghost" data-cpdl="all" title="${nWb}/${nAll} workbooks added">Everything (.zip)</button></div></div>`;
    });
  }

  function renderResults() {
    const r = state.res, inp = state.inputs, s = state.settings;
    $('#resEyebrow').textContent = [inp.job.quote, inp.job.project].filter(Boolean).join(' / ') || 'Design result';
    const card = needCard();
    if (r.incomplete) {
      $('#resTitle').innerHTML = `Mezzanine “${esc(inp.mezz.id || '—')}”<br><em>needs input.</em>`;
      $('#metrics').innerHTML = ''; $('#field').innerHTML = ''; $('#options').innerHTML = ''; $('#readout').innerHTML = '';
      $('#modelSec').hidden = true; $('#optHead').hidden = true; $('#checkPill').hidden = true;
      renderMini(null);
      $('#needSlot').innerHTML = card;
      $('#warnings').innerHTML = notesHtml(r.warn, !!card);
      wireNeed();
      renderDM();
      const anyDone = state.all && state.all.length > 1 && state.job.mezz.some(m => !m.incomplete);
      $('#qsHead').hidden = !anyDone;
      if (anyDone) renderQuoteSheet(); else $('#quoteSheet').innerHTML = '';
      return;
    }
    // a job of several mezzanines is one design: the beam marks, counts, columns and steel are the whole job's
    const many = manyMezz(), t = many ? jobTotals() : totals(), cf = r.colFinal, marks = jobMarks(), mk0 = marks[0];
    const done = many ? state.job.mezz.filter(m => !m.incomplete) : [r];
    const secs = [...new Set(marks.map(mk => mk.desc || 'no beam'))].join(' / ');
    const cols = [...new Set(done.filter(m => m.colFinal && m.columns.length).map(m => m.colFinal.quoteAs))].join(' / ');
    const colLens = [...new Set(done.filter(m => m.columns.length).map(m => ft(m.colLen)))].join(' / ') || ft(r.colLen);
    const spans = [...new Set(marks.flatMap(mk => (mk.spanRuns && mk.spanRuns.length ? mk.spanRuns : [mk]).map(q => +q.span.toFixed(3))))].sort((x, y) => y - x).map(ft).join(' / ');
    const ids = many ? done.map(m => `“${esc(m.id)}”`).join(' + ') : `“${esc(inp.mezz.id || '—')}”`;
    $('#resTitle').innerHTML = `Mezzanine${many && done.length > 1 ? 's' : ''} ${ids}<br><em class="nocase">${esc(secs)}${cols ? ' · ' + esc(cols) : ''}</em>`;

    // metric ring cards
    const foreign = !many && (r.foreignCols || []).length ? ` · + ${r.foreignCols.map(c => `${c.label} with ${esc(c.ownerId)}`).join(', ')}` : '';
    $('#metrics').innerHTML = [
      ringCard(many ? 'Beams · whole job' : 'Mezzanine beams', `<span data-count="${t.nB}">${t.nB}</span>`, `${marks.map(mk => `${mk.mark} ${esc(mk.desc || '—')} × ${mk.qtyAll}`).join(' · ')} · ${spans} span`, t.govBeam ? t.govBeam.v : null),
      ringCard(many ? 'Columns · whole job' : 'Mezzanine columns', `<span data-count="${t.nC}">${t.nC}</span>`, (cols ? `${esc(cols)} · ${colLens} · CSR ${f(t.colMax, 3)}` : 'every beam end lands on a building column') + foreign, t.colMax),
      floorCard(),
      ringCard(many ? 'Steel · whole job' : 'Mezzanine steel', `<span data-count="${Math.round(t.total)}" data-fmt="lb">${n0(t.total)} lb</span>`, `beams ${n0(t.beams)} · columns ${n0(t.cols)} · end plates ${n0(t.plates)}`, t.total ? t.beams / t.total : null, 'var(--steel)'),
    ].join('');
    $('#needSlot').innerHTML = card;
    $('#warnings').innerHTML = notesHtml(r.warn, !!card);
    wireNeed();
    renderDM();
    $('#modelSec').hidden = false; $('#optHead').hidden = false; $('#qsHead').hidden = false;
    const nCheck = r.warn.filter(w => w.level === 'stop' || w.level === 'warn').length;
    $('#checkPill').hidden = !nCheck;
    $('#checkPill').textContent = `${nCheck} to check before quoting ↓`;
    $('#checkPill').className = 'check-pill ' + (r.warn.some(w => w.level === 'stop') ? 'stop' : 'warn');

    // hero field: beam marks -> governing ratio -> columns + plan check
    const pc = r.planCheck;
    const gv = t.gov ? t.gov.v : 0, c0 = t.govBeam ? t.govBeam.mk.check : mk0 && mk0.check;
    const nCases = done.reduce((a, m) => a + m.colGroups.length, 0);
    const mkRows = marks.map(mk => `<div class="mk-row" style="--mk:${mkHex(mk)}"><div class="mk-id"><b>${mk.mark}</b><small>${mk.kind || (mk.optionKey && mk.optionKey !== 'lightest' ? ({ fit: 'best fit', econ: 'economical', custom: 'picked' })[mk.optionKey] || mk.optionKey : '')}</small></div>
        <div class="mk-sec"><span class="nocase">${esc(mk.desc || '—')}</span></div><div class="mk-qty"><b>${mk.qtyAll}</b></div>
        <div class="mk-meta">${mkDims(mk)} trib${mkShort(mk) ? ' · ' + mkShort(mk) : ''}${mkWhere(mk) ? ' · ' + mkWhere(mk) : ''}</div></div>`).join('');
    const kinds = marks.some(mk => mk.kind) ? '<div class="sub mk-why">interior: more trib than any edge beam · exterior: edge beams, joists on one side — each designed at its largest trib and longest span</div>' : '';
    const joistTxt = done.map(m => `${many ? esc(m.id) + ': ' : ''}joists @ ${ft(m.beamBase.Lb)} span ${ft(m.layout.joistSpan)} ${m.layout.joists === 'y' ? 'across the width' : 'along the length'} onto ${m.layout.beamLines.length} beam lines`).join(' · ');
    $('#field').innerHTML = `
      <div class="field-head"><div><div class="eyebrow">Framing summary${many ? ' · whole job' : ''}</div><h3>Floor load → beams → columns</h3></div>
        <p>The governing ratio across every beam and column check, with the quantities read from the layout and cross-checked against the floor plan.</p></div>
      <div class="field-stage"><div class="atlas">
        <div class="fcard"><div class="step">01 / Mezzanine beams</div><h4>${t.nB} beam${t.nB === 1 ? '' : 's'} · ${marks.length} mark${marks.length === 1 ? '' : 's'}</h4>
          <div class="mk-list">${mkRows || '<div class="sub">no beams</div>'}</div>${kinds}</div>
        <div class="disc-wrap"><div class="step">Governing ratio</div><div class="orbit"></div>
          <div class="disc" data-ring="${pct(gv).toFixed(1)}" style="--ring:0;--disc-a:${gv <= s.target ? '#64ffd0' : gv <= 1 ? '#ffd27a' : '#ff9d7a'}"><div class="disc-inner"><span>Max ratio</span><strong data-count="${gv}" data-fmt="sr">${f(gv, 2)}</strong><b>${esc(t.gov ? t.gov.who : '')}</b></div></div>
          <div class="disc-caption">Beams ≤ ${s.target} with L/360 live and L/240 total; columns &lt; 1.00 on all three combinations.</div>
          <div class="disc-proof">${c0 ? `combined <b>${f(c0.res.CSR, 3)}</b> · shear <b>${f(c0.res.SRvx, 3)}</b>` : ''}${t.colMax != null ? ` · column <b>${f(t.colMax, 3)}</b>` : ''}</div></div>
        <div class="tallies">
          <div class="tally"><div class="step">02 / Mezzanine columns</div><div class="tally-row"><div><h4 class="nocase">${cols ? esc(cols) : 'None needed'}</h4><p>${cols ? `${colLens} · ${nCases} load case${nCases > 1 ? 's' : ''}${many ? ' · one section, whole job' : ''}` : 'beams frame into building columns'}</p></div><div><strong>${t.nC}</strong><small>${t.colMax != null ? 'CSR ' + f(t.colMax, 3) : ''}</small></div></div></div>
          <div class="tally ${pc && pc.ok && pc.agree ? '' : 'warn'}"><div class="step">03 / Floor plan check</div><div class="tally-row"><div><h4>${pc ? (pc.ok ? (pc.agree ? 'Matches the drawing' : 'Differs from the drawing') : 'Not read') : 'No floor plan'}</h4><p>${pc && pc.ok ? '⊗ at ' + esc(pc.labels.join(', ')) : pc ? esc(pc.reason) : 'confirm the layout by eye'}</p></div><div><strong>${pc && pc.ok ? pc.matched.length + '/' + pc.labels.length : '—'}</strong><small>${pc && pc.ok ? 'columns found' : ''}</small></div></div></div>
        </div></div>
        <div class="field-foot"><b>Field readout</b><span>${joistTxt}; ${t.nB} beams frame into ${t.nC} mezzanine column${t.nC === 1 ? '' : 's'} and the building columns.</span></div>
      </div>`;

    renderOptions();
    renderQuoteSheet();
    renderModel();
    animateIn();

    // readout
    const mkTxt = marks.map(mk => `<em>${mk.qtyAll}</em> ${mk.kind ? mk.kind + ' ' : ''}${esc(mk.desc || '—')} (${mk.mark}) at <em>${ft(mkDz(mk).span)}</em> × <em>${ft(mkDz(mk).trib)}</em> trib${mkDz(mk).set ? ` (design; layout ${ft(mk.span)} × ${ft(mk.trib)})` : ''}${mkShort(mk) ? ' ' + mkShort(mk) : ''}`).join('; ');
    $('#readout').innerHTML = `<div class="eyebrow">What the design establishes</div>
      <p>${mkTxt || 'No beams'} carry the floor into <em>${t.nC}</em> ${esc(cols)} column${t.nC === 1 ? '' : 's'} <em>${colLens}</em> tall — governing ratio <em>${f(gv, 2)}</em>${c0 ? `, live-load deflection <em>L/${f(c0.defl.rLL, 0)}</em>` : ''}.</p>
      <div class="readout-facts"><span><b>${marks.filter(mk => mk.check).map(mk => f(mk.check.res.Wt, 1)).join(' / ') || '—'}</b>plf beam${marks.length > 1 ? 's' : ''}</span><span><b>${n0(t.total)}</b>lb mezzanine steel</span><span><b>${r.joistDepthIn != null ? f(r.joistDepthIn, 0) + '"' : '—'}</b>total joist depth</span><span><b>${edLabel(r.edition.beamEd || r.edition.ed)}</b>ASD sheets</span></div>`;
  }

  function renderOptions() {
    const inp = state.inputs;
    const A = inp.geom.A.value, slabIn = (inp.geom.slab.value || 0) * 12, seatIn = (inp.geom.seat.value || 0) * 12;
    const uo = usualOption(), uoLab = uo && { lightest: 'Lightest', fit: 'Best fit', econ: 'Most economical' }[uo.key];
    const marks = jobMarks();
    $('#optSub').textContent = (marks[0] && marks[0].search ? `every stocked web and flange within the production rules, through the MB sheet — ${marks[0].search.evaluated.toLocaleString()} combinations a mark · pick one for the quote${manyMezz() ? ' (it goes on every mezzanine)' : ''}` : '') + (uo ? ` · you usually quote ${uoLab} (${uo.n} of ${uo.tot})` : '');
    const TIERW = { G: 'economical', Y: 'somewhat economical', R: 'non-economical' };
    $('#options').innerHTML = marks.map(mk => {
      if (!mk.options || !mk.options.length) return `<div class="mark-block"><p class="mark-label"><b>${mkName(mk)}</b> — no passing section in the depth range.</p></div>`;
      const len = (mk.beamsAll || []).reduce((a, x) => a + x.span, 0) || mk.qtyAll * mk.span;   // every member at its own length
      const where = mkWhere(mk), short = mkShort(mk);
      // one card per different section; the options that land on it are named together
      const groups = [];
      mk.options.forEach(o => { const g = groups.find(x => sameSec(x.sec, o.pick.sec)); if (g) g.roles.push(o); else groups.push({ sec: o.pick.sec, pick: o.pick, roles: [o] }); });
      const one = groups.length === 1, sr = mk.search, capped = sr && sr.dTop < sr.options.dMax;
      const card = g => {
        const p = g.pick, o = g.roles[0], chosen = sameSec(p.sec, mk.sec);
        const under = A != null ? A - (slabIn + seatIn + p.sec.d) / 12 : null;
        const dLbs = o.dWt * len;
        return `<article class="option ${chosen ? 'is-chosen' : ''} ${g.roles.length > 1 ? 'is-merged' : ''}">
          <div class="option-top"><span class="option-tags">${g.roles.map(x => `<span class="option-tag">${esc(x.label)}</span>`).join('')}</span><span class="option-delta ${o.dWt > 0 ? '' : 'zero'}">${o.dWt > 1e-9 ? `+${f(o.dPct * 100, 1)}% · +${n0(dLbs)} lb` : o.dWt < -1e-9 ? `${f(o.dPct * 100, 1)}% · ${n0(dLbs)} lb` : 'least weight'}</span></div>
          ${o.needC != null ? `<div class="option-flag">Needs clearance C ≤ ${ft(o.needC)} — the PCS asks ${ft(inp.geom.C.value)}</div>` : ''}
          <div class="option-sec nocase">${esc(p.desc)}</div><div class="option-parts">${secParts(p.sec)} · flange ${TIERW[p.tier] || p.tier}</div>
          <div class="option-grid">
            <div><span>Weight</span><b>${f(p.wt, 1)} plf</b></div><div><span>Depth</span><b>${p.sec.d}"</b></div><div><span>Under beam</span><b>${under != null ? ft(under) : '—'}</b></div>
            <div><span>Combined</span><b class="${p.CSR <= state.settings.target ? 'ok' : 'bad'}">${f(p.CSR, 3)}</b></div><div><span>Shear</span><b class="${p.SRv <= state.settings.target ? 'ok' : 'bad'}">${f(p.SRv, 3)}</b></div><div><span>Live defl.</span><b class="ok">L/${f(p.rLL, 0)}</b></div>
          </div>
          <ul class="option-why">${g.roles.map(x => `<li><b>${esc(x.label)}</b> — ${esc(x.why)}</li>`).join('')}</ul>
          <div class="option-actions">${chosen ? '<span class="chosen-pill">In the quote</span>' : `<button class="btn-soft" data-opt="${o.key}" data-mark="${mk.mark}">Use this</button>`}<button class="btn-ghost" data-go="beam">Calc</button></div>
        </article>`;
      };
      // why only one: the lighter plates that fail at that depth (from the step-by-step tries)
      const fitO = mk.options.find(o => o.key === 'fit'), flStep = fitO && fitO.steps && fitO.steps.find(x => x.step === 'flange');
      const lastFail = flStep && flStep.tries ? flStep.tries.filter(t => !t.ok && t.why && !/production|no web/.test(t.why)).pop() : null;
      const oneTxt = one && !(mk.options || []).some(o => o.needC != null) ? `<div class="option-one"><b>One design for these inputs.</b> ${capped ? `The clearance C leaves ${sr.dTop}" for the beam (A − C − slab − seat)${lastFail ? `; at ${sr.dTop}" the next lighter plate fails (${esc(lastFail.sec)}: ${esc(lastFail.why)})` : ''}, so ` : ''}every way of building it — the lightest, the step-by-step method, the economical flanges — lands on the same section.${mk.deeper && mk.deeper.length ? ` More depth would take less steel, but needs the clearance under the beams lowered:` : ''}</div>
        ${mk.deeper && mk.deeper.length ? `<table class="fl-t deeper"><thead><tr><th class="num">Depth</th><th>Section</th><th class="num">plf</th><th class="num">Saves</th><th class="num">Combined</th><th class="num">Live</th><th class="num">C would be at most</th></tr></thead><tbody>${mk.deeper.map(z => `<tr><td class="num mono">${z.d}"</td><td class="mono">${esc(z.desc)} <small class="sub-n">${esc(z.flange)} · ${esc(z.web)}</small></td><td class="num mono">${f(z.wt, 1)}</td><td class="num mono">${f(groups[0].pick.wt - z.wt, 1)} plf (${f((1 - z.wt / groups[0].pick.wt) * 100, 0)} %)</td><td class="num mono">${f(z.CSR, 3)}</td><td class="num mono">L/${f(z.rLL, 0)}</td><td class="num mono">${ft(z.needC)}</td></tr>`).join('')}</tbody></table>` : ''}` : '';
      return `<div class="mark-block"><p class="mark-label"><i class="mk-dot" style="background:${mkHex(mk)}"></i><b>${mkName(mk)}</b> · ${mk.qtyAll} beam${mk.qtyAll > 1 ? 's' : ''}${where ? ' (' + where + ')' : ''} · designed ${mkDims(mk)} trib${short ? ' · ' + short + ', same section' : ''}</p><div class="options ${one ? 'is-one' : ''}">${groups.map(card).join('')}</div>${oneTxt}</div>`;
    }).join('');
    $$('#options [data-opt]').forEach(b => { b.onclick = () => pickOption(b.dataset.mark, b.dataset.opt); });
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
  function buildScene() {
    const r = state.res, g = r.grid, ms = jobView(), many = ms.length > 1, cno = colNos();
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
        const mk = mkOf(m, bm.id), sec = mk && mk.sec;
        if (!sec) return;
        const d = sec.d / 12, bf = sec.bof / 12, tf = sec.tof / 12, bi = sec.bif / 12, ti = sec.tif / 12, tw = Math.max(sec.tw, 0.9) / 12;
        const box = (a0, a1, w, z0, z1) => (alongX ? { x0: a0, x1: a1, y0: bm.line - w / 2, y1: bm.line + w / 2, z0, z1 } : { x0: bm.line - w / 2, x1: bm.line + w / 2, y0: a0, y1: a1, z0, z1 });
        members.push({ id: pre + 'B' + (bm.id + 1), kind: 'beam', color: mkHex(mk), boxes: [box(bm.from, bm.to, bf, zTop - tf, zTop), box(bm.from, bm.to, tw, zTop - d + ti, zTop - tf), box(bm.from, bm.to, bi, zTop - d, zTop - d + ti)], ref: { type: 'beam', m, b: bm, mk } });
        const mid = (bm.from + bm.to) / 2;
        labels.push({ p: alongX ? [mid, bm.line, zTop + 0.2] : [bm.line, mid, zTop + 0.2], text: mk.mark + (mk.kind ? ' ' + mk.kind.slice(0, 3).toUpperCase() : ''), kind: 'tag', color: mkHex(mk) });
      });
      // mezzanine columns: W shape, web parallel to the beam web, from the floor to the underside of the beam
      const cf = m.colFinal, w = cf ? WF[cf.name] : null, dBeam = Math.max(0, ...m.marks.filter(q => q.sec).map(q => q.sec.d)) / 12;
      lay.mezzCols.forEach(c => {
        const cd = (w ? w.d : 10) / 12, cb = (w ? w.bf : 6) / 12, ctf = Math.max(w ? w.tf : 0.4, 0.5) / 12, ctw = Math.max(w ? w.tw : 0.25, 0.9) / 12, zc = zTop - dBeam;
        const bx = (dx0, dx1, dy0, dy1, z0, z1) => (alongX ? { x0: c.x + dx0, x1: c.x + dx1, y0: c.y + dy0, y1: c.y + dy1, z0, z1 } : { x0: c.x + dy0, x1: c.x + dy1, y0: c.y + dx0, y1: c.y + dx1, z0, z1 });
        members.push({ id: 'C' + cno.get(c.label), kind: 'col', color: '#ff9f7a', boxes: [
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
    g.xs.filter(x => x >= xLo - 1e-6 && x <= xHi + 1e-6).forEach(x => { floor.push([[x, yLo, 0], [x, yHi, 0], 'rgba(140,200,235,.22)', true]); labels.push({ p: [x, yLo - 2.2, 0], text: g.xLabel(x), kind: 'bubble' }); });
    const colY = [...new Set([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()])];
    colY.filter(y => y >= yLo - 1e-6 && y <= yHi + 1e-6).forEach(y => { floor.push([[xLo, y, 0], [xHi, y, 0], 'rgba(140,200,235,.22)', true]); labels.push({ p: [xLo - 2.2, y, 0], text: g.yLabel(y), kind: 'bubble' }); });
    const Z = Atop + 2.5;
    const box = { x0: xLo - 3.4, x1: xHi, y0: yLo - 3.4, y1: yHi, z0: 0, z1: Z };   // bubbles sit 2.2' outside the grid ends
    return { center: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, Z / 2], radius: Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2, box, members, labels, floor };
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
  function renderMini(scene) {
    const cv = $('#miniModel');
    if (!cv || !M3) return;
    $('#orbEmpty').hidden = !!scene;
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
    const s = Math.min((Vw - 2 * M) / Math.max(1, x1 - x0), (Vh - 2 * M - 10 * k - padTop) / Math.max(1, y1 - y0));
    const ox = (Vw - (x1 - x0) * s) / 2, oy = padTop + (Vh - padTop - 10 * k - (y1 - y0) * s) / 2;
    const X = x => ox + (x - x0) * s, Y = y => oy + (y1 - y) * s;
    const grp = state.view === 'column' && r.colGroups[state.colGroup] ? r.colGroups[state.colGroup].cols.map(c => c.label) : null;
    // on the Beam page: the job's beams of the mark (and member length) under review
    const jm = state.view === 'beam' ? jobMarks()[state.mark] : null, run = jm && jm.spanRuns && jm.spanRuns.length > 1 ? jm.spanRuns[state.markSpan] : null;
    const isOn = (m, b) => !!jm && (mkOf(m, b.id) || {}).mark === jm.mark && (!run || Math.abs(b.span - run.span) < 1e-3);
    const o = [], br = 6.5 * k;
    const xL = [...new Set(lays.flatMap(l => l.xLines).map(v => +v.toFixed(3)))], yL = [...new Set(lays.flatMap(l => l.yLines).map(v => +v.toFixed(3)))];
    xL.forEach(x => { o.push(`<line class="mp-grid" x1="${X(x)}" y1="${Y(y1) - 8 * k}" x2="${X(x)}" y2="${Y(y0) + 8 * k}"/>`); const lb = g.xLabel(x); if (lb) o.push(`<g class="mp-bub"><circle cx="${X(x)}" cy="${Y(y1) - 15 * k}" r="${br}"/><text x="${X(x)}" y="${Y(y1) - 15 * k}">${lb}</text></g>`); else o.push(`<text class="mp-off" x="${X(x)}" y="${Y(y1) - 13 * k}">${ft(x)}</text>`); });
    yL.forEach(y => { o.push(`<line class="mp-grid" x1="${X(x0) - 8 * k}" y1="${Y(y)}" x2="${X(x1) + 8 * k}" y2="${Y(y)}"/>`); const lb = g.yLabel(y); if (lb) o.push(`<g class="mp-bub"><circle cx="${X(x0) - 15 * k}" cy="${Y(y)}" r="${br}"/><text x="${X(x0) - 15 * k}" y="${Y(y)}">${lb}</text></g>`); });
    ms.forEach(m => { const fp = m.layout.footprint; o.push(`<rect class="mp-foot" x="${X(fp.x0)}" y="${Y(fp.y1)}" width="${(fp.x1 - fp.x0) * s}" height="${(fp.y1 - fp.y0) * s}" rx="2"/>`); });
    ms.forEach(m => m.layout.beams.forEach(b => {
      const [p, q] = b.ends;
      if (b.absorbed) { o.push(`<line class="mp-beam carried" data-tip="carried|${m.index}|${b.id}" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}"/>`); return; }
      const mk = mkOf(m, b.id), on = jm ? isOn(m, b) : null;
      o.push(`<line class="mp-beam ${on === true ? 'hi' : on === false || grp ? 'dim' : ''}" data-beam="${m.index}:${b.id}" data-tip="beam|${m.index}|${b.id}" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}" stroke="${mkHex(mk)}"/>`);
    }));
    ms.forEach(m => m.layout.beams.filter(b => !b.absorbed).forEach(b => { const [p, q] = b.ends, mk = mkOf(m, b.id); o.push(`<text class="mp-bl" x="${(X(p.x) + X(q.x)) / 2}" y="${(Y(p.y) + Y(q.y)) / 2}">${k > 1.2 && mk ? mk.mark + ' ' : ''}B${b.id + 1}</text>`); }));
    const fls = bldgFrameLoads();
    bldgCols().forEach(sp => { const ld = fls.some(q => atPt(q, sp)); o.push(`<g class="mp-bc ${ld ? 'ld' : ''}" data-tip="bcol|${sp.x}|${sp.y}"><circle class="mp-hit" cx="${X(sp.x)}" cy="${Y(sp.y)}" r="${6 * k}"/><rect x="${X(sp.x) - 2.5 * k}" y="${Y(sp.y) - 2.5 * k}" width="${5 * k}" height="${5 * k}"/></g>`); });
    const xm = (cx, cy, R) => { const d = R * 0.68; return `<circle cx="${cx}" cy="${cy}" r="${R}"/><path d="M${cx - d},${cy - d} L${cx + d},${cy + d} M${cx - d},${cy + d} L${cx + d},${cy - d}"/>`; };
    const lbl = (cx, cy, t, t2) => `<text class="mp-cl" x="${cx}" y="${cy + 13 * k}" text-anchor="middle">${t}${t2 ? `<tspan class="mp-cl2" x="${cx}" dy="${9 * k}">${t2}</tspan>` : ''}</text>`;
    ms.forEach(m => m.layout.mezzCols.forEach(c => { const on = grp ? m === r && grp.includes(c.label) : null, cx = X(c.x), cy = Y(c.y);
      o.push(`<g class="mp-col ${on === true ? 'hi' : on === false || jm ? 'dim' : ''}" data-col="${c.x}|${c.y}" data-tip="col|${c.x}|${c.y}">${xm(cx, cy, 5 * k)}</g>${lbl(cx, cy, 'C' + cno.get(c.label), k > 1.2 ? c.label : '')}`); }));
    if (many) ms.forEach(m => { const fp = m.layout.footprint, bl = m.layout.beamLines, alongX = m.layout.joists === 'y';
      const mid = bl.length > 1 ? (bl[0] + bl[1]) / 2 : null, cx = alongX ? (fp.x0 + fp.x1) / 2 : mid ?? (fp.x0 + fp.x1) / 2, cy = alongX ? mid ?? (fp.y0 + fp.y1) / 2 : (fp.y0 + fp.y1) / 2;
      o.push(`<text class="mp-mz" x="${X(cx)}" y="${Y(cy)}">${esc(m.id)}</text>`); });
    const cap = grp ? ' · reviewing ' + grp.map(l => 'C' + cno.get(l)).join(', ') : jm ? ' · reviewing ' + jm.mark + (run ? ' at ' + ft(run.span) : '') : '';
    o.push(`<text class="mp-cap" x="${Vw / 2}" y="${Vh - 6 * k}">${many ? esc(ms.map(m => m.id).join(' + ')) : esc(state.inputs.mezz.id || 'Mezzanine')}${k > 1.2 && jobMarks().some(mk => mk.kind) ? ' · ' + jobMarks().filter(mk => mk.kind).map(mk => mk.mark + ' ' + mk.kind).join(' / ') : ''}${cap}</text>`);
    return o.join('');
  }
  function wirePlan(svg) {
    svg.querySelectorAll('[data-col]').forEach(el => { el.onclick = () => { const [x, y] = el.dataset.col.split('|').map(Number); openCol({ x, y }); }; });
    svg.querySelectorAll('[data-beam]').forEach(el => { el.onclick = () => { const [mi, id] = el.dataset.beam.split(':').map(Number); openBeam(state.job.mezz[mi], id); }; });
  }
  function renderMiniPlan() {
    const svg = $('#miniPlan'), r = state.res, ok = !!(svg && r && !r.incomplete);
    if (svg) { svg.innerHTML = ok ? planMarkup(200, 200, 1, 18) : ''; svg.setAttribute('viewBox', '0 0 200 200'); if (ok) wirePlan(svg); }
    const pop = $('#planPop');
    if (!pop || pop.hidden) return;
    if (!ok) { pop.hidden = true; return; }
    const lays = jobView().map(m => m.layout), ext = (k, lo) => lays.map(l => (lo ? Math.min : Math.max)(l.footprint[k], ...(k[0] === 'x' ? l.xLines : l.yLines)));
    const w = 680, ratio = (Math.max(...ext('y1')) - Math.min(...ext('y0', 1))) / Math.max(1, Math.max(...ext('x1')) - Math.min(...ext('x0', 1)));
    const h = Math.round(Math.max(240, Math.min(560, (w - 80) * ratio + 110)));
    const big = $('#planPopSvg');
    big.setAttribute('viewBox', `0 0 ${w} ${h}`); big.style.setProperty('--k', 1.8);
    big.innerHTML = planMarkup(w, h, 1.8); wirePlan(big);
    $('#ppTitle').textContent = `${jobView().map(m => m.id).join(' + ') || 'Mezzanine'} · floor plan`;
  }
  function renderModel() {
    const canvas = $('#model3d');
    if (!canvas || !M3) return;
    if (!model) {
      model = M3.mount(canvas, { onSelect: id => showMember(id), onHover: id => { if (!model.pinned) showMember(id, true); } });
      $('#m3Pause').onclick = () => { const on = model.auto; model.pause(on); $('#m3Pause').textContent = on ? 'Resume rotation' : 'Pause rotation'; };
      $('#m3Reset').onclick = () => model.reset();
      $('#m3In').onclick = () => model.zoom(1.15); $('#m3Out').onclick = () => model.zoom(1 / 1.15);
      $$('#modelToggles button').forEach(b => { b.onclick = () => { const on = !b.classList.contains('is-on'); b.classList.toggle('is-on', on); model.toggle(b.dataset.t, on); }; });
    }
    state.scene = buildScene();
    model.set(state.scene);
    renderMini(state.scene);
    window.MZ_DEBUG = { modelPoint: id => (model ? model.screenOf(id) : null), beams: () => state.scene.members.filter(x => x.kind === 'beam').map(x => x.id) };
    const ms = jobView(), many = ms.length > 1, t = many ? jobTotals() : totals(), marks = jobMarks();
    const cols = [...new Set(ms.filter(m => m.colFinal && m.columns.length).map(m => m.colFinal.quoteAs))].join(' / ');
    $('#modelTitle').textContent = `${many ? ms.map(m => m.id).join(' + ') + ' · ' : ''}${t.nB} beams · ${t.nC} columns · ${state.scene.members.filter(m => m.kind === 'joist').length} joist runs`;
    $('#modelCount').textContent = ms.map(m => `${many ? m.id + ' ' : ''}${ft(m.layout.footprint.x1 - m.layout.footprint.x0)} × ${ft(m.layout.footprint.y1 - m.layout.footprint.y0)} · T/slab ${ft(inpOf(m).geom.A.value)}`).join(' · ');
    $('#modelKey').innerHTML = marks.map(mk => `<span class="mk-key"><i style="background:${mkHex(mk)}"></i><b>${mk.mark}${mk.kind ? ' · ' + mk.kind : ''}</b> ${esc(mk.desc || '')} × ${mk.qtyAll}</span>`).join('') +
      `<span><i style="background:#ff9f7a"></i>Mezzanine column ${esc(cols)} × ${t.nC}</span><span><i style="background:#6f89a3"></i>Building column</span><span><i style="background:#a9cbe0"></i>Joists @ ${[...new Set(ms.map(m => ft(m.beamBase.Lb)))].join(' / ')}</span><span><i style="background:#8fd3ff55;border:1px solid #8fd3ff"></i>Slab ${[...new Set(ms.map(m => f((inpOf(m).geom.slab.value || 0) * 12, 1) + '"'))].join(' / ')}</span>`;
    model.pinned = null;
    showMember(null);
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
        <div class="mk-mini">${marks.map(mk => `<div style="--mk:${mkHex(mk)}"><b>${mk.mark}</b><span>${esc(mk.kind || 'beams')}</span><em class="nocase">${esc(mk.desc || '—')}</em><small>× ${mk.qtyAll}</small></div>`).join('')}</div>
        <dl><div><dt>Beams</dt><dd>${t.nB}</dd></div><div><dt>Columns</dt><dd>${t.nC}</dd></div></dl>
        <div class="foot">Green and blue beams are the interior and exterior marks. Click a column to see the left / right dead and live it takes from the beams.</div>`;
      return;
    }
    const ref = m.ref;
    if (ref.type === 'beam') {
      const o = ref.m, b = ref.b, mk = ref.mk, run = runOf(mk, b.span), c = run ? run.check : mk.check, rx = mk.sec ? DESIGN.reactions({ ...o.beamBase, L: b.span, trib: b.trib }, mk.sec) : null;
      const g = o.grid, lay = o.layout, lab = (lay.joists === 'y' ? g.yLabel(b.line) : g.xLabel(b.line)) || ft(b.line), fl = lay.joists === 'y' ? g.xLabel : g.yLabel;
      card.innerHTML = `<div class="eyebrow">${eb}${many ? ' · ' + esc(o.id) : ''}</div><h4>B${b.id + 1} · ${mkName(mk)}</h4><div class="kind">Beam on line ${esc(lab)} · ${esc(fl(b.from) || ft(b.from))} → ${esc(fl(b.to) || ft(b.to))}</div>
        <div class="sec nocase">${esc(mk.desc)}</div>
        <dl><div><dt>Span</dt><dd>${ft(b.span)}</dd></div><div><dt>Trib</dt><dd>${ft(b.trib)}</dd></div>
        <div><dt>R dead</dt><dd>${rx ? f(rx.D, 2) + 'k' : '—'}</dd></div><div><dt>R live</dt><dd>${rx ? f(rx.L, 2) + 'k' : '—'}</dd></div>
        <div><dt>Combined</dt><dd>${f(c.res.CSR, 3)}</dd></div><div><dt>Shear</dt><dd>${f(c.res.SRvx, 3)}</dd></div>
        <div><dt>Live defl.</dt><dd>L/${f(c.defl.rLL, 0)}</dd></div><div><dt>Weight</dt><dd>${f(c.res.Wt, 1)} plf</dd></div></dl>
        <span class="pill">${b.span < mk.span - 1e-3 ? `shorter member — ${mk.mark} section, MB sheet at ${ft(runL(runOf(mk, b.span) || { span: b.span }))}` : b.trib < mk.trib - 1e-3 ? `designed for ${ft(mk.trib)} trib (${mk.mark} governing)` : `governing ${mk.mark} beam`}</span>
        <div class="foot">${secParts(mk.sec)}</div>`;
    } else if (ref.type === 'col') {
      const ci = colInfo(ref.c), col = ci && ci.c, o = ci ? ci.m : ref.m, cf = o.colFinal, chk = cf && ci && ci.gi >= 0 ? cf.checks[ci.gi] : null;
      const from = sd => (col ? col.parts.filter(p => p.sheetSide === sd).map(p => `${many ? esc(p.mezz) + ' ' : ''}${p.beam}${p.mark ? ' ' + p.mark : ''}`).join(' + ') || 'no beam' : '—');
      card.innerHTML = `<div class="eyebrow">${eb}${many ? ' · ' + esc(o.id) : ''}</div><h4>C${ref.no} · ${esc(ref.c.label)}</h4><div class="kind">Mezzanine column ⊗ · Column sheet input</div>
        <div class="sec nocase">${cf ? esc(cf.quoteAs) : '—'}</div>
        <dl><div><dt>Left D / L (k)</dt><dd>${col ? lr(col.DL_L, col.LL_L) : '—'}</dd></div><div><dt>Right D / L (k)</dt><dd>${col ? lr(col.DL_R, col.LL_R) : '—'}</dd></div>
        <div><dt>Left from</dt><dd>${from('left')}</dd></div><div><dt>Right from</dt><dd>${from('right')}</dd></div>
        <div><dt>Height</dt><dd>${ft(o.colLen)}</dd></div><div><dt>Max CSR</dt><dd>${chk ? f(chk.max, 3) : '—'}</dd></div></dl>
        <div class="foot">Unfactored beam reactions (MB H6 / H10) · e = d/2 · three load combinations · column self-weight included, as on the Column sheet.</div>`;
    } else if (ref.type === 'bcol') {
      const fl = bldgFrameLoads().find(q => atPt(q, ref.sp));
      card.innerHTML = `<div class="eyebrow">${eb}</div><h4>${esc(ref.sp.label)}</h4><div class="kind">Building column · load to the frame</div>
        <div class="sec nocase">${fl ? `D ${f(fl.D, 2)} · L ${f(fl.L, 2)} k` : '—'}</div>
        ${fl ? `<dl>${fl.parts.map(p => `<div><dt>${many ? esc(p.mezz) + ' ' : ''}${p.beam}${p.mark ? ' · ' + p.mark : ''}</dt><dd>${lr(p.D, p.L)}</dd></div>`).join('')}</dl>` : ''}
        <div class="foot">Unfactored mezzanine beam reactions (MB H6 / H10) that land on this column — they go to the frame / endwall design, not the mezzanine Column sheet.</div>`;
    }
  }

  // ---------- quote sheet (workbook tables) ----------
  function renderQuoteSheet() {
    // one holistic set of rows for the job: a row per beam mark and member length, a row per column section
    const q = RUN.quoteJob(state.job ? state.job.mezz : [state.res], state.all ? state.all.map(a => a.inputs) : [state.inputs]);
    state.quote = q;
    const cur = state.inputs.mezz.id || 'A', many = manyMezz();
    const block = (key, title, sub, foot) => {
      const h = q.heads[key], rows = q[key];
      const cls = k => (k === 'NOTES' ? 'qnotes' : k === 'SECTION' ? 'sec' : k === 'DLT' || k === 'LLT' || k === 'ENDWT' ? 'calc' : k === 'MEZZ' ? 'left' : '');
      return `<div class="qs-block"><div class="qs-head"><div><h4>${title}</h4>${sub ? `<small>${sub}</small>` : ''}</div><button class="btn-soft" data-copy="${key}"><svg><use href="#i-copy"/></svg>Copy rows</button></div>
        <div class="qs-wrap"><table><thead><tr>${h.map(([k, t]) => `<th class="${k === 'NOTES' || k === 'MEZZ' ? 'left' : ''}">${t}</th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map(row => `<tr class="${many && String(row.MEZZ).split(' / ').includes(cur) ? 'is-cur' : ''}">${h.map(([k]) => `<td class="${cls(k)}">${esc(row[k])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${h.length}" class="qnotes">No rows.</td></tr>`}</tbody></table></div>
        <div class="qs-foot">${foot}</div></div>`;
    };
    $('#quoteSheet').innerHTML =
      block('design', 'Mezz. Design Information', '', '**DEAD LOAD DOES NOT INCLUDE THE WEIGHT OF THE FLOOR JOISTS OR BEAMS**') +
      block('beams', 'Mezz. Beams', 'U.N.O., live load deflection limit = L/360; total load deflection limit = L/240', 'DLᴛ = DL + COL · END PL. WT. = 40 lb PER BEAM') +
      block('columns', 'Mezz. Columns', '', 'END PL. WT. = 46 lb PER COLUMN · trib area = floor area carried by the worst column');
    $$('#quoteSheet [data-copy]').forEach(b => { b.onclick = () => copyText(q.tsv[b.dataset.copy], 'Rows copied — paste into the quote sheet'); });
  }
  $('#copyQuote').onclick = () => {
    const q = state.quote || RUN.quoteJob(state.job ? state.job.mezz : [state.res], state.all ? state.all.map(a => a.inputs) : [state.inputs]);
    copyText([q.tsv.design, '', q.tsv.beams, '', q.tsv.columns].join('\n'), 'Design, beam and column rows copied');
  };
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
    const lineOf = (m, v) => (m.layout.joists === 'y' ? g.yLabel(v) : g.xLabel(v)) || ft(v);
    const spans = [...new Set(ms.flatMap(m => m.layout.beams.filter(b => !b.absorbed).map(b => +b.span.toFixed(3))))].sort((x, y) => y - x);
    const allCols = ms.flatMap(m => m.layout.mezzCols).sort((x, y) => cno.get(x.label) - cno.get(y.label));
    const uniq = a2 => [...new Set(a2)].join(' / ');
    $('#planStats').innerHTML = `
      <div class="pstat beams"><span>Mezzanine beams${many ? ' · whole job' : ''}</span><strong>${t.nB}<small>beams</small></strong><em>${marks.map(m => `${mkName(m)} ${esc(m.desc || '—')} × ${m.qtyAll}`).join(' · ')}</em></div>
      <div class="pstat cols"><span>Mezzanine columns ⊗${many ? ' · whole job' : ''}</span><strong>${t.nC}<small>columns</small></strong><em>${allCols.map(c => `C${cno.get(c.label)} ${c.label}`).join(' · ') || 'none'}</em></div>
      <div class="pstat"><span>Beam spans</span><strong>${spans.map(ft).join(' / ')}</strong><em>${ms.map(m => `${many ? esc(m.id) + ': ' : ''}${m.layout.supportLines.length - 1} bay${m.layout.supportLines.length > 2 ? 's' : ''} × ${m.layout.beamLines.length} beam lines (${m.layout.beamLines.map(v => lineOf(m, v)).join(', ')})`).join(' · ')}</em></div>
      <div class="pstat"><span>Joists</span><strong>${uniq(ms.map(m => ft(m.layout.joistSpan)))}</strong><em>span · @ ${uniq(ms.map(m => ft(m.beamBase.Lb)))} · ${uniq(ms.map(m => (m.layout.joists === 'y' ? 'across the width' : 'along the length')))}</em></div>`;
    $$('#joistSeg button').forEach(b => b.classList.toggle('is-active', b.dataset.j === (state.settings.joists || 'auto')));
    $('#planTitle').textContent = many ? `Framing plan · ${ms.map(m => m.id).join(' + ')}` : `Framing plan · ${inp.mezz.id || 'mezzanine'}`;
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
    const VW = 1100, M = 64, s = Math.min((VW - 2 * M) / (xb - xa), 600 / (yb - ya)), VH = (yb - ya) * s + 2 * M + 24;
    const X = x => M + (x - xa) * s, Y = y => M + 12 + (yb - y) * s;
    state.planXf = { xa, yb, s, M };   // the edit mode maps a click back to feet
    const inX = x => x >= xa - 0.01 && x <= xb + 0.01, inY = y => y >= ya - 0.01 && y <= yb + 0.01;
    const o = [];
    o.push(`<defs><pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="var(--hatch)"/><line x1="0" y1="0" x2="0" y2="9" stroke="var(--green)" stroke-width=".7" opacity=".3"/></pattern>
      <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink)"/></marker></defs>`);
    g.xs.filter(inX).forEach(x => {
      o.push(`<line class="grid-line" x1="${X(x)}" y1="${Y(yb) - 26}" x2="${X(x)}" y2="${Y(ya) + 26}"/>`);
      [Y(yb) - 38, Y(ya) + 38].forEach(cy => o.push(`<g class="bubble"><circle cx="${X(x)}" cy="${cy}" r="11"/><text x="${X(x)}" y="${cy}">${g.xLabel(x)}</text></g>`));
    });
    // letters run over every column line (ridge included, as on the drawings); only column lines get a bubble
    const colY = new Set([0, W, ...g.lewY, ...g.rewY, ...g.interior.flat()].map(v => v.toFixed(2)));
    g.allY.filter(y => colY.has(y.toFixed(2)) && inY(y)).forEach(y => {
      o.push(`<line class="grid-line" x1="${X(xa) - 26}" y1="${Y(y)}" x2="${X(xb) + 26}" y2="${Y(y)}"/>`);
      [X(xa) - 38, X(xb) + 38].forEach(cx => o.push(`<g class="bubble"><circle cx="${cx}" cy="${Y(y)}" r="11"/><text x="${cx}" y="${Y(y)}">${g.yLabel(y)}</text></g>`));
    });
    const xsw = g.xs.filter(inX);
    xsw.slice(1).forEach((x, i) => { const a2 = xsw[i]; o.push(`<text class="dim" x="${(X(a2) + X(x)) / 2}" y="${Y(yb) - 52}">${ft(x - a2)}</text>`); });
    // the building: walls solid where they are in view, the cut edges of a cropped view dashed
    o.push(`<rect class="bldg-cut" x="${X(xa)}" y="${Y(yb)}" width="${(xb - xa) * s}" height="${(yb - ya) * s}"/>`);
    [[xa === 0, X(0), Y(yb), X(0), Y(ya)], [xb === L, X(L), Y(yb), X(L), Y(ya)], [yb === W, X(xa), Y(W), X(xb), Y(W)], [ya === 0, X(xa), Y(0), X(xb), Y(0)]].forEach(([on, x1, y1, x2, y2]) => { if (on) o.push(`<line class="bldg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`); });
    if (xa > 0) o.push(`<text class="dim" x="${X(xa) - 6}" y="${Y(yb) - 8}" text-anchor="start">⟵ ${ft(xa)} more to LEW</text>`);
    if (xb < L) o.push(`<text class="dim" x="${X(xb) + 6}" y="${Y(yb) - 8}" text-anchor="end">${ft(L - xb)} more to REW ⟶</text>`);
    if (ya > 0) o.push(`<text class="dim" x="${X(xa) + 6}" y="${Y(ya) - 6}" text-anchor="start">${ft(ya)} more to the FSW ↓</text>`);
    if (yb < W) o.push(`<text class="dim" x="${X(xa) + 6}" y="${Y(yb) + 14}" text-anchor="start">${ft(W - yb)} more to the BSW ↑</text>`);
    if (ya === 0) o.push(`<text class="dim" x="${X(xa) + 4}" y="${Y(0) - 6}" text-anchor="start">FSW</text>`);
    if (yb === W) o.push(`<text class="dim" x="${X(xa) + 4}" y="${Y(W) + 14}" text-anchor="start">BSW</text>`);
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
        const len = (rn.to - rn.from) * s - 16, long = `${rn.mk.mark}${rn.mk.kind ? ' · ' + rn.mk.kind.toUpperCase() : ''} · ${rn.mk.desc || ''}`, short = `${rn.mk.mark}${rn.mk.kind ? ' ' + rn.mk.kind.slice(0, 3).toUpperCase() : ''}`;
        const txt = long.length * 6.4 < len ? long : short.length * 6.4 < len ? short : '';
        if (!txt) return;
        if (rn.dir === 'x') o.push(`<text class="run-lab" x="${X(rn.from) + 8}" y="${Y(rn.line) - 10}" fill="${mkVar(rn.mk)}">${esc(txt)}</text>`);
        else o.push(`<text class="run-lab" transform="translate(${X(rn.line) - 10},${Y(rn.from) - 8}) rotate(-90)" fill="${mkVar(rn.mk)}">${esc(txt)}</text>`);
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
      o.push(`<g class="bcol-g ${ld ? 'ld' : ''}" data-tip="bcol|${x}|${y}"><circle class="hit" cx="${X(x)}" cy="${Y(y)}" r="11"/><rect class="bcol" x="${X(x) - (ld ? 5 : 4)}" y="${Y(y) - (ld ? 5 : 4)}" width="${ld ? 10 : 8}" height="${ld ? 10 : 8}"/></g>`); });
    // beam number tags (B1..) at mid-span, in the mark's colour
    ms.forEach(m => m.layout.beams.filter(b => !b.absorbed).forEach(b => {
      const [p, q] = b.ends, mk = mkOf(m, b.id), mc = mkVar(mk);
      const mx = (X(p.x) + X(q.x)) / 2, my = (Y(p.y) + Y(q.y)) / 2, lab = 'B' + (b.id + 1), w = 12 + lab.length * 6.5;
      o.push(`<g class="tag b ${mk && mk.kind === 'interior' ? 'int' : ''}" data-tip="beam|${m.index}|${b.id}" data-beam="${m.index}:${b.id}"><rect x="${mx - w / 2}" y="${my - 9}" width="${w}" height="18" rx="9" style="stroke:${mc}${mk && mk.kind === 'interior' ? ';fill:' + mc : ''}"/><text x="${mx}" y="${my + .5}" style="fill:${mk && mk.kind === 'interior' ? 'var(--surface)' : mc}">${lab}</text></g>`);
    }));
    // mezzanine columns, numbered once over the job (C1..) — hover for the Column-sheet left / right D and L
    ms.forEach(m => m.layout.mezzCols.forEach(c => {
      const cx = X(c.x), cy = Y(c.y), R = 8, d = R * 0.7, lab = 'C' + cno.get(c.label);
      o.push(`<g class="mcol" data-col="${c.x}|${c.y}" data-tip="col|${c.x}|${c.y}"><circle class="hit" cx="${cx}" cy="${cy}" r="13"/><circle cx="${cx}" cy="${cy}" r="${R}"/><path d="M${cx - d},${cy - d} L${cx + d},${cy + d} M${cx - d},${cy + d} L${cx + d},${cy - d}"/></g>`);
      o.push(`<g class="tag c" data-col="${c.x}|${c.y}" data-tip="col|${c.x}|${c.y}"><rect x="${cx + 11}" y="${cy + 7}" width="26" height="16" rx="8"/><text x="${cx + 24}" y="${cy + 15.5}">${lab}</text></g><text class="lbl" x="${cx + 41}" y="${cy + 19}">${c.label}</text>`);
    }));
    // columns taken out on the Plan page: a ghost, click it (edit mode) to put it back
    ms.forEach(m => (m.layout.dropped || []).forEach(d => { const cx = X(d.x), cy = Y(d.y), dd = 5.6;
      o.push(`<g class="mcol dropped" data-dropped="${m.index}|${d.x}|${d.y}"><circle class="hit" cx="${cx}" cy="${cy}" r="13"/><circle cx="${cx}" cy="${cy}" r="8"/><path d="M${cx - dd},${cy - dd} L${cx + dd},${cy + dd} M${cx - dd},${cy + dd} L${cx + dd},${cy - dd}"/><title>${esc(d.label)} taken out — the beam spans through</title></g>`); }));
    if (r.planCheck && r.planCheck.ok) r.planCheck.cols.forEach(c => o.push(`<circle class="seen" cx="${X(c.x)}" cy="${Y(c.y)}" r="14"><title>Mezzanine column on the PCS floor plan</title></circle>`));
    // joist direction, and the mezzanine's name in its first joist bay (click it to edit that mezzanine)
    ms.forEach(m => {
      const ly = m.layout, fp = ly.footprint, sp = m.beamBase.Lb, bl = ly.beamLines;
      if (ly.joists === 'y') {
        const x = (fp.x0 + Math.min(fp.x1, ly.supportLines[1] ?? fp.x1)) / 2 + sp / 2, y0 = bl[0], y1 = bl[1] ?? fp.y1;
        o.push(`<line class="arrow" x1="${X(x)}" y1="${Y(y0) - 12}" x2="${X(x)}" y2="${Y(y1) + 12}" marker-start="url(#ah)" marker-end="url(#ah)"/><text class="arrow-t" x="${X(x) + 7}" y="${(Y(y0) + Y(y1)) / 2}">JOISTS @ ${ft(sp)}</text>`);
      } else {
        const y = (fp.y0 + Math.min(fp.y1, ly.supportLines[1] ?? fp.y1)) / 2 + sp / 2, x0 = bl[0], x1 = bl[1] ?? fp.x1;
        o.push(`<line class="arrow" x1="${X(x0) + 12}" y1="${Y(y)}" x2="${X(x1) - 12}" y2="${Y(y)}" marker-start="url(#ah)" marker-end="url(#ah)"/><text class="arrow-t" x="${(X(x0) + X(x1)) / 2}" y="${Y(y) - 7}" text-anchor="middle">JOISTS @ ${ft(sp)}</text>`);
      }
      if (many) {
        // in the second joist bay when there is one (the first has the joist arrow), else toward the far end of the bay
        const bi = bl.length > 2 ? 1 : 0, mid = bl.length > 1 ? (bl[bi] + bl[bi + 1]) / 2 : null, alongX = ly.joists === 'y';
        const along = bi ? 0.5 : 0.7, cx = alongX ? fp.x0 + (fp.x1 - fp.x0) * along : mid ?? (fp.x0 + fp.x1) / 2, cy = alongX ? mid ?? (fp.y0 + fp.y1) / 2 : fp.y0 + (fp.y1 - fp.y0) * along;
        o.push(`<text class="mz-name ${m === r ? 'is-cur' : ''}" data-mezz="${m.index}" x="${X(cx)}" y="${Y(cy)}">${esc(m.id)}${m === r ? ' · editing' : ''}</text>`);
      }
    });
    $('#planSvg').setAttribute('viewBox', `0 0 ${VW} ${VH}`);
    $('#planSvg').innerHTML = o.join('');
    $$('#planSvg [data-beam]').forEach(el => {
      const tb = $$(`#planSvg .trib[data-band="${el.dataset.beam}"]`);   // its own floor, and a neighbour's edge it carries
      el.addEventListener('mouseenter', () => tb.forEach(x => x.classList.add('on')));
      el.addEventListener('mouseleave', () => tb.forEach(x => x.classList.remove('on')));
      el.addEventListener('click', () => { if (state.planEdit) return; const [mi, id] = el.dataset.beam.split(':').map(Number); openBeam(job.mezz[mi], id); });
    });
    $$('#planSvg [data-col]').forEach(el => { el.addEventListener('click', () => { if (state.planEdit) return; const [x, y] = el.dataset.col.split('|').map(Number); openCol({ x, y }); }); });
    $$('#planSvg [data-mezz]').forEach(el => { el.addEventListener('click', () => { if (!state.planEdit) switchMezz(+el.dataset.mezz); }); });
    layBarSync();
    $('#planLegend').innerHTML = marks.map(mk => `<span class="lg-mk"><svg width="26" height="12"><rect width="26" height="12" rx="2" fill="${mkVar(mk)}" opacity=".22"/><line x1="0" y1="6" x2="26" y2="6" stroke="${mkVar(mk)}" stroke-width="5"/></svg><b>${mk.mark}${mk.kind ? ' · ' + mk.kind : ''}</b> ${esc(mk.desc || '')} · ${mk.qtyAll} beam${mk.qtyAll === 1 ? '' : 's'} · ${ft(mkDz(mk).span)} × ${ft(mkDz(mk).trib)}${mkDz(mk).set ? ' design' : ''}${mkShort(mk) ? ' (' + mkShort(mk) + ')' : ''}</span>`).join('') +
      `<span><svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--red)" stroke-width="2"/><path d="M4,4 L12,12 M4,12 L12,4" stroke="var(--red)" stroke-width="2"/></svg>Mezzanine column · qty ${t.nC}</span>` +
      (r.planCheck && r.planCheck.ok ? `<span><svg width="18" height="18"><circle cx="9" cy="9" r="7" fill="none" stroke="var(--steel)" stroke-width="1.6" stroke-dasharray="3 2"/></svg>Column read from the PCS drawing (${r.planCheck.cols.length})</span>` : '') +
      (ms.some(m => m.layout.beams.some(b => b.absorbed)) ? `<span><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" class="beam carried"/></svg>Edge carried by the neighbour's beam</span>` : '') +
      `<span><svg width="12" height="12"><rect width="10" height="10" x="1" y="1" fill="var(--amber)"/></svg>Building column with a load to the frame</span><span><svg width="10" height="10"><rect width="8" height="8" x="1" y="1" fill="var(--ink)"/></svg>Building column</span><span class="lg-hint">Hover any column for the dead / live it takes · hover a beam for its trib and end shear</span>`;
    // every beam of the job, with its end shear (what the columns take)
    $('#beamTable').innerHTML = `<thead><tr>${many ? '<th>Mezz.</th>' : ''}<th>Beam</th><th>Line</th><th>From → to</th><th class="num">Span</th><th class="num">Trib</th><th>Mark</th><th>Section</th><th class="num">End shear D / L (k)</th></tr></thead><tbody>` +
      ms.flatMap(m => m.layout.beams.map(b => {
        const mk = mkOf(m, b.id), fl = m.layout.joists === 'y' ? g.xLabel : g.yLabel, rx = !b.absorbed && mk && mk.sec ? DESIGN.reactions({ ...m.beamBase, L: b.span, trib: b.trib }, mk.sec) : null;
        const trib = b.extra ? `${ft(b.trib)}<small class="sub-n"> ${ft(b.tribOwn)} + ${b.extra.map(x => esc(x.mezz) + ' ' + ft(x.tribOwn)).join(' + ')}</small>` : ft(b.trib);
        return `<tr class="${b.absorbed ? 'muted' : ''}">${many ? `<td>${esc(m.id)}</td>` : ''}<td class="mono"><b>B${b.id + 1}</b></td><td>${lineOf(m, b.line)}</td><td>${fl(b.from) || ft(b.from)} → ${fl(b.to) || ft(b.to)}</td><td class="num">${ft(b.span)}</td><td class="num">${trib}</td><td>${b.absorbed ? 'carried by ' + esc(b.absorbed.mezz) : mk ? `<i class="mk-dot" style="background:${mkHex(mk)}"></i>${mkName(mk)}` + (b.span < mk.span - 1e-3 ? ' <small class="sub-n">own run at ' + ft(b.span) + '</small>' : '') : ''}</td><td class="mono">${b.absorbed ? '—' : mk && mk.desc ? mk.desc : '—'}</td><td class="num">${rx ? f(rx.D, 2) + ' / ' + f(rx.L, 2) : ''}</td></tr>`; })).join('') + '</tbody>';
    // every column of the job: the Column-sheet inputs of each mezzanine column, the load to the frame at each building column
    const jcols = (job ? job.columns : []).filter(c => ms.some(m => m.index === c.owner)).sort((x, y) => (cno.get(x.label) || 0) - (cno.get(y.label) || 0));
    $('#supTable').innerHTML = `<thead><tr><th>Column</th><th>Type · beams framing in</th><th class="num">Trib area</th><th class="num">Left D / L (k)</th><th class="num">Right D / L (k)</th></tr></thead><tbody>` +
      jcols.map(c => `<tr><td class="mono"><b>C${cno.get(c.label)}</b> · ${c.label}</td><td><b style="color:var(--red)">Mezzanine column ⊗</b>${many ? ' · ' + esc(c.ownerId) : ''}${c.shared ? ' · shared' : ''}<br><small class="sub-n">${c.parts.map(p => `${p.sheetSide}: ${many ? esc(p.mezz) + ' ' : ''}${p.beam}${p.mark ? ' · ' + p.mark : ''}`).join(' · ')}</small></td><td class="num">${f(c.tribArea, 0)} ft²</td><td class="num">${f(c.DL_L, 2)} / ${f(c.LL_L, 2)}</td><td class="num">${f(c.DL_R, 2)} / ${f(c.LL_R, 2)}</td></tr>`).join('') +
      fls.filter(q => ms.some(m => q.seenIn.includes(m.index))).map(q => `<tr class="frame-row"><td class="mono">${q.label}</td><td>Building column · <b>load to the frame</b><br><small class="sub-n">${q.parts.map(p => `${many ? esc(p.mezz) + ' ' : ''}${p.beam}${p.mark ? ' · ' + p.mark : ''}`).join(' + ')}</small></td><td class="num"></td><td class="num" colspan="2"><b>D ${f(q.D, 2)} · L ${f(q.L, 2)} k</b></td></tr>`).join('') + '</tbody>';
  }

  // ---------- layout edits on the plan: a column made a frame / mezzanine column or taken out, beam and column lines
  //            added or removed. Each is a setting of that mezzanine (lines, drop, colKind), undoable, and the whole job
  //            re-designs from it: beams, columns, frame loads, seismic, the quote ----------
  const LAY_KEYS = ['xLines', 'yLines', 'drop', 'colKind', 'joists'], layUndo = [];
  const ptKey = (x, y) => `${(+x).toFixed(2)},${(+y).toFixed(2)}`;
  const laySnap = () => allSettings().map(st => JSON.stringify(Object.fromEntries(LAY_KEYS.filter(k => st[k] !== undefined).map(k => [k, st[k]]))));
  const layRestore = snap => allSettings().forEach((st, i) => { LAY_KEYS.forEach(k => delete st[k]); Object.assign(st, JSON.parse(snap[i] || '{}')); });
  function layDo(msg, fn) {
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
  $('#layEdit').onclick = () => { state.planEdit = !state.planEdit; hideLayPop(); layBarSync(); };
  $('#layDone').onclick = () => { state.planEdit = false; hideLayPop(); layBarSync(); };
  $('#layUndo').onclick = () => { const snap = layUndo.pop(); if (!snap) return; layRestore(snap); hideLayPop(); recompute(); toast('Undone'); };
  $('#layReset').onclick = () => layDo('Layout back to the building grid and the PCS drawing', () => allSettings().forEach(st => LAY_KEYS.forEach(k => delete st[k])));
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') hideLayPop(); });
  document.addEventListener('click', ev => { const p = $('#layPop'); if (p && !p.hidden && !p.contains(ev.target) && !ev.target.closest('#planSvg')) hideLayPop(); });

  function layMenu(ev) {
    if (!state.planEdit || !state.job || !state.planXf) return;
    const svg = $('#planSvg'), q = svg.createSVGPoint(); q.x = ev.clientX; q.y = ev.clientY;
    const v = q.matrixTransform(svg.getScreenCTM().inverse()), xf = state.planXf;
    const wx = xf.xa + (v.x - xf.M) / xf.s, wy = xf.yb - (v.y - xf.M - 12) / xf.s;
    const ms = jobView(), sets = allSettings(), items = [];
    const ring = (cx, cy) => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('class', 'edit-ring'); c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 17); svg.appendChild(c); };
    let head = '';
    const tgt = ev.target.closest('[data-dropped],[data-col],[data-tip^="bcol"],[data-beam]');
    hideLayPop();
    if (tgt && tgt.dataset.dropped) {
      const [mi, x, y] = tgt.dataset.dropped.split('|').map(Number), m = state.job.mezz[mi], d = (m.layout.dropped || []).find(z => atPt(z, { x, y }));
      head = `${esc(d ? d.label : '')} · taken out`;
      items.push({ t: 'Put the column back', sub: 'the beam stops here again', go: () => layDo(`${d.label}: column back`, () => { const st = sets[mi]; st.drop = (st.drop || []).filter(k => k !== ptKey(x, y)); if (!st.drop.length) delete st.drop; }) });
    } else if (tgt && (tgt.dataset.col || /^bcol/.test(tgt.dataset.tip || ''))) {
      const [x, y] = (tgt.dataset.col || tgt.dataset.tip.replace(/^bcol\|/, '')).split('|').map(Number), p = { x, y };
      const owners = ms.filter(m => m.layout.supports.some(sp => atPt(sp, p)));
      if (!owners.length) { head = 'Building column'; items.push({ t: 'No mezzanine beam frames in here', sub: 'nothing to change at this column', off: true }); }
      else {
        const m0 = owners[0], sp = m0.layout.supports.find(z => atPt(z, p)), ly = m0.layout, k = ptKey(x, y);
        const along = ly.joists === 'y' ? sp.x : sp.y, si = ly.supportLines.findIndex(u => Math.abs(u - along) < 1e-6), inner = si > 0 && si < ly.supportLines.length - 1;
        const cn = colNos().get(sp.label);
        head = `${sp.building ? 'Frame column' : 'Mezzanine column'}${cn && !sp.building ? ' C' + cn : ''} · ${esc(sp.label)}`;
        const user = owners.some(m => (m.layout.supports.find(z => atPt(z, p)) || {}).userKind);
        items.push(sp.building
          ? { t: user ? 'Back to a mezzanine column' : 'Make it a mezzanine column ⊗', sub: 'designed on the Column sheet; the frame takes no mezzanine load here', go: () => layDo(`${sp.label}: mezzanine column`, () => owners.forEach(m => { const st = sets[m.index], cur = (m.layout.supports.find(z => atPt(z, p)) || {}); st.colKind = { ...(st.colKind || {}) }; if (cur.userKind) delete st.colKind[k]; else st.colKind[k] = 'mezz'; if (!Object.keys(st.colKind).length) delete st.colKind; })) }
          : { t: user ? 'Back to a frame column' : 'Make it a frame column', sub: 'its beam reactions go to the frame design (FDL / FLL) — add the column in NBG Frame if the frame has none here', go: () => layDo(`${sp.label}: frame column`, () => owners.forEach(m => { const st = sets[m.index], cur = (m.layout.supports.find(z => atPt(z, p)) || {}); st.colKind = { ...(st.colKind || {}) }; if (cur.userKind) delete st.colKind[k]; else st.colKind[k] = 'frame'; if (!Object.keys(st.colKind).length) delete st.colKind; })) });
        if (inner) {
          const bs = ly.beams.filter(b => Math.abs(b.line - (ly.joists === 'y' ? sp.y : sp.x)) < 1e-6 && (Math.abs(b.from - along) < 1e-6 || Math.abs(b.to - along) < 1e-6));
          const span = bs.reduce((a, b) => a + b.span, 0);
          items.push({ t: 'Take the column out', sub: `the beam spans through${span ? `: ${ft(span)}` : ''} — one beam instead of two`, go: () => layDo(`${sp.label}: column taken out`, () => owners.forEach(m => { const st = sets[m.index]; st.drop = [...new Set([...(st.drop || []), k])]; })) });
          items.push({ t: `Remove ${layLine(m0, ly.joists === 'y' ? 'x' : 'y', along)} of columns`, sub: 'every beam spans through this line', go: () => layDo(`${layLine(m0, ly.joists === 'y' ? 'x' : 'y', along)}: columns removed`, () => { const st = sets[m0.index]; layFreeze(st, ly); st[ly.joists === 'y' ? 'xLines' : 'yLines'] = ly.supportLines.filter((u, i) => i !== si); }) });
        } else items.push({ t: 'A beam ends here', sub: 'an end support stays (no cantilever) — make it a frame or a mezzanine column', off: true });
      }
      ring(v.x, v.y);
    } else if (tgt && tgt.dataset.beam) {
      const [mi, id] = tgt.dataset.beam.split(':').map(Number), m = state.job.mezz[mi], ly = m.layout, b = ly.beams[id];
      const bi = ly.beamLines.findIndex(u => Math.abs(u - b.line) < 1e-6), inner = bi > 0 && bi < ly.beamLines.length - 1, ax = ly.joists === 'y' ? 'y' : 'x';
      const mk = mkOf(m, id);
      head = `B${id + 1}${mk ? ' · ' + esc(mk.mark) : ''} · ${esc(layLine(m, ax, b.line))}`;
      if (inner) items.push({ t: `Remove the beam line`, sub: `joists span ${ft(ly.beamLines[bi + 1] - ly.beamLines[bi - 1])} across it — the beams either side carry more`, go: () => layDo(`${layLine(m, ax, b.line)}: beam line removed`, () => { const st = sets[mi]; layFreeze(st, ly); st[ax === 'y' ? 'yLines' : 'xLines'] = ly.beamLines.filter((u, i) => i !== bi); }) });
      else items.push({ t: 'An edge beam stays', sub: 'it carries the slab edge', off: true });
      items.push({ t: 'Open its calc', sub: 'the MB sheet for this mark', go: () => { hideLayPop(); openBeam(m, id); } });
    } else {
      const m = ms.find(z => { const f2 = z.layout.footprint; return wx >= f2.x0 - 0.01 && wx <= f2.x1 + 0.01 && wy >= f2.y0 - 0.01 && wy <= f2.y1 + 0.01; });
      if (!m) return;
      const ly = m.layout, bAx = ly.joists === 'y' ? 'y' : 'x', sAx = bAx === 'y' ? 'x' : 'y', snap = val => Math.round(val * 2) / 2;
      const bAt = snap(bAx === 'y' ? wy : wx), sAt = snap(sAx === 'y' ? wy : wx);
      head = `${esc(m.id)} · floor`;
      const add = (kind, inputId) => {
        const lines = kind === 'beam' ? ly.beamLines : ly.supportLines, ax = kind === 'beam' ? bAx : sAx, raw = $('#' + inputId).value.trim();
        const at = PCS.ftin(raw) ?? parseFloat(raw);
        if (!isFinite(at) || at <= lines[0] + 1 || at >= lines[lines.length - 1] - 1) { toast(`Put it inside the mezzanine, more than 1'-0" in from its edges`); return; }
        if (lines.some(u => Math.abs(u - at) < 1)) { toast(`There is a line within 1'-0" of ${ft(at)} already`); return; }
        layDo(`${kind === 'beam' ? 'Beam' : 'Column'} line added at ${ft(at)} from the ${ax === 'y' ? 'FSW' : 'LEW'}`, () => { const st = sets[m.index]; layFreeze(st, ly); st[ax === 'y' ? 'yLines' : 'xLines'] = [...lines, at].sort((a, c) => a - c); });
      };
      items.push({ t: 'Add a beam line', sub: 'joists span shorter; new beams, and columns at their ends', at: { id: 'layAtB', v: ft(bAt), from: bAx === 'y' ? 'FSW' : 'LEW' }, go: () => add('beam', 'layAtB') });
      items.push({ t: 'Add a column line', sub: 'the beams span shorter; new columns along it', at: { id: 'layAtS', v: ft(sAt), from: sAx === 'y' ? 'FSW' : 'LEW' }, go: () => add('support', 'layAtS') });
      ring(v.x, v.y);
    }
    const pop = $('#layPop'), wrap = pop.parentElement, wr = wrap.getBoundingClientRect();
    pop.innerHTML = `<h6>${head}</h6>` + items.map((it, i) => `<button type="button" data-i="${i}" ${it.off ? 'disabled' : ''}>${esc(it.t)}<small>${esc(it.sub || '')}</small></button>${it.at ? `<div class="lay-at"><span>at</span><input id="${it.at.id}" value="${esc(it.at.v)}" aria-label="${esc(it.t)} at"><span>from the ${it.at.from}</span></div>` : ''}`).join('');
    pop.hidden = false;
    const left = Math.min(ev.clientX - wr.left + 10, wr.width - pop.offsetWidth - 8), top = Math.min(ev.clientY - wr.top + 10, wr.height - pop.offsetHeight - 8);
    pop.style.left = Math.max(8, left) + 'px'; pop.style.top = Math.max(8, top) + 'px';
    $$('#layPop button[data-i]').forEach(bt => { bt.onclick = e2 => { e2.stopPropagation(); const it = items[+bt.dataset.i]; if (it.go) it.go(); }; });
    $$('#layPop input').forEach(inp => inp.addEventListener('keydown', e2 => { if (e2.key === 'Enter') { const it = items.find(z => z.at && z.at.id === inp.id); if (it) it.go(); } }));
  }
  $('#planSvg').addEventListener('click', layMenu);

  // ---------- seismic: the mezzanine on the frames (EQR / EQL) and the bracing, as the IBC Seismic workbook ----------
  const SEIS_TYPE = t => (window.MZ_SEISMIC && window.MZ_SEISMIC.frameType(t)) || 'Rigid Frame';
  function renderSeismic() {
    const sj = state.job && state.job.seismic, box = $('#seisInputs');
    if (!box) return;
    const clear = () => ['#seisFrames', '#seisApply', '#seisBracing', '#seisFlags', '#seisHow'].forEach(q => { $(q).innerHTML = ''; });
    if (!sj || sj.error) { $('#seisStatus').innerHTML = sj && sj.error ? `<div class="seis-msg stop">${esc(sj.notes[0].text)}</div>` : ''; box.innerHTML = '<div class="empty">Load a PCS first.</div>'; clear(); return; }
    const cfg = state.seis, d = sj.design, F2 = v => f(v, 2), lb = v => n0(v), srcTag = o => `<small class="src src-${esc(String(o.source).replace(/\s+/g, '-'))}">${esc(o.source === 'missing' ? 'needed' : o.source)}</small>`;
    const num = (key, o, step = 'any', w = '') => `<input class="seis-in ${o.value == null ? 'need' : ''}" data-seis="${esc(key)}" value="${o.value == null ? '' : +(+o.value).toFixed(4)}" inputmode="decimal" step="${step}" ${w}>`;
    const sel = (key, val, opts) => `<select data-seis="${esc(key)}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const chk = (key, on, label) => `<label class="seis-chk"><input type="checkbox" data-seis="${esc(key)}" ${on ? 'checked' : ''}> ${label}</label>`;
    const cell = c => `<small class="wb-cell">${esc(c)}</small>`;
    const I = sj.inputs, live = sj.ok, many = sj.buildings.length > 1;
    // status
    const notes = (sj.notes || []).filter(n => n.level !== 'info').map(n => `<div class="seis-msg ${n.level}">${esc(n.text)}</div>`).join('');
    const infos = (sj.notes || []).filter(n => n.level === 'info');
    $('#seisStatus').innerHTML = (sj.need.length ? `<div class="seis-msg stop"><b>Needs:</b> ${sj.need.map(esc).join(' · ')}</div>` : '')
      + (d && d.ok ? `<div class="seis-sum"><span>ASCE ${esc(d.ed)}</span><span>SDS <b>${f(d.SDS, 4)}</b></span><span>SD1 <b>${f(d.SD1, 4)}</b></span><span>SDC <b>${esc(d.SDC)}</b></span><span>Ie <b>${f(d.Ie, 2)}</b></span><span>Risk Category <b>${esc(d.risk)}</b></span>${d.Fa != null ? `<span>Fa ${f(d.Fa, 3)} · Fv ${f(d.Fv, 3)}</span>` : ''}</div>` : '') + notes;

    // ---- steps 1–3: Input Data ----
    const site = `<div class="seis-group"><h4><span class="step-no sm">1</span>Code and site <small class="sub-n">Input Data B26–B29 · Seismic Design Calcs. D11</small></h4><div class="seis-grid">
        <label><span class="lab">ASCE 7 ${cell('code drop-down')}</span>${sel('ed', I.ed, [['7-05', '7-05 (IBC 2006/09)'], ['7-10', '7-10 (IBC 2012/15)'], ['7-16', '7-16 (IBC 2018/21)'], ['7-22', '7-22 (IBC 2024)']])}</label>
        <label><span class="lab">Ss ${srcTag(I.Ss)} ${cell('B26')}</span>${num('Ss', I.Ss)}</label><label><span class="lab">S1 ${srcTag(I.S1)} ${cell('B27')}</span>${num('S1', I.S1)}</label>
        <label><span class="lab">Site class ${srcTag(I.siteClass)} ${cell('B29')}</span>${sel('siteClass', I.siteClass.value, ['A', 'B', 'C', 'D', 'E', 'F'].map(x => [x, x]))}</label>
        <label><span class="lab">Risk category ${srcTag(I.risk)} ${cell('B7')}</span>${sel('risk', I.risk.value, [['I', 'I — Low Hazard'], ['II', 'II — Standard Buildings'], ['III', 'III — Substantial Hazard'], ['IV', 'IV — Essential Facilities']])}</label>
        ${I.ed === '7-22' ? `<label>SDS ${srcTag(I.SDS)}${num('SDS', I.SDS)}</label><label>SD1 ${srcTag(I.SD1)}${num('SD1', I.SD1)}</label>` : ''}
      </div></div>`;
    const bldg = sj.buildings.map(b => {
      const k = 'b.' + b.bkey, g = b.g, ffl = ((cfg.buildings || {})[b.bkey] || {}).frameFile;
      const mz = b.mezz.map((m, i) => `<tr><td><b>${esc(m.id)}</b>${i < 2 ? `<small class="sub-n">Mezzanine #${i + 1} · ${n0(m.area)} sq ft</small>` : '<small class="bad">the workbook takes two mezzanines</small>'}</td>
          <td class="num mono">${ft(m.elev)}</td>
          <td>${num('m.' + m.id + '.FDL', { value: m.FDL })}<small class="src src-${esc(m.FDLsrc)}">${esc(m.FDLsrc)}</small>${m.framing ? `<small class="sub-n">+ ${F2(m.framing)} framing = <b>${F2(m.FDL + m.framing)}</b> typed</small>` : ''}</td>
          <td class="num mono">${F2(m.FLC)}</td><td class="num mono">${F2(m.FLJ)}</td>
          <td>${chk('m.' + m.id + '.storage', m.storage, `storage: 25 % of ${F2(m.FLL)}`)}</td><td class="num mono">${F2(m.FLP)}</td>
          <td class="num mono"><b>${F2(m.psf)}</b></td><td class="num mono">${lb(m.psf * m.area)}</td></tr>`).join('');
      return `<div class="seis-group"><h4><span class="step-no sm">2</span>${esc(b.name)} <small class="sub-n">Input Data B7–B22 · B33–B37 · walls</small></h4>
        <div class="seis-echo"><span>${esc(g.rooftype)}</span><span>Width <b>${ft(g.width)}</b></span><span>Length <b>${ft(g.length)}</b></span>${g.rooftype === 'Gable' ? `<span>Ridge <b>${ft(g.dtr)}</b> from the BSW</span>` : ''}<span>Slope <b>${f(g.slope, 2)}:12</b></span><span>Eaves <b>${ft(g.leh)}</b> FSW · <b>${ft(g.heh)}</b> BSW</span><span>Mean roof height <b>${b.long ? ft(b.long.hn) : '—'}</b></span><small class="sub-n">PCS Box 2</small></div>
        ${b.geoNote ? `<div class="seis-msg info">${esc(b.geoNote)}</div>` : ''}
        <div class="seis-grid">
          <label><span class="lab">Lateral frame self weight, SW (psf) ${srcTag(b.roof.SW)} ${cell('B33')}</span>${num(k + '.SW', b.roof.SW)}</label>
          <label><span class="lab">Roof self weight — bracing, beams (psf) ${srcTag(b.roof.RSW)} ${cell('B36')}</span>${num(k + '.RSW', b.roof.RSW)}</label>
          <label><span class="lab">Roof dead, RDL (psf) ${srcTag(b.roof.RDL)} ${cell('B34')}</span>${num(k + '.RDL', b.roof.RDL)}${ffl ? `<small class="sub-n">from ${esc(ffl.from)}</small>` : '<small class="sub-n">"Per Seller" on the PCS — read from a dropped frame file, or type it</small>'}</label>
          <label><span class="lab">Roof collateral, CDL (psf) ${srcTag(b.roof.CDL)} ${cell('B35')}</span>${num(k + '.CDL', b.roof.CDL)}</label>
          <label><span class="lab">Roof snow, Pf (psf) ${srcTag(b.roof.Pf)} ${cell('B37')}</span>${num(k + '.Pf', b.roof.Pf)}<small class="sub-n">20 % in the weight when over 30 psf</small></label>
          <label><span class="lab">Wall weight FSW / BSW / LEW / REW (psf) ${cell('B59 F59 B47 F47')}</span><span class="seis-walls">${['fsw', 'bsw', 'lew', 'rew'].map(w => num(k + '.walls.' + w, b.walls[w])).join('')}</span><small class="sub-n">3 psf metal panel (the workbook's default)</small></label>
        </div>
        <div class="seis-grid">
          ${chk('vertical', cfg.vertical !== false, `Vertical distribution required ${cell('B21')}`)}
          ${chk('ndfs', cfg.ignoreNDFS !== true, `"Steel systems not detailed for seismic" in SDC A–C — R = 3 (the workbook's default) ${cell('F16')}`)}
          ${chk(k + '.story', b.story, `Mezzanine considered a story ${cell('Lateral B30')} — ${n0(b.mezz.reduce((a, m) => a + m.area, 0))} of ${n0(g.width * g.length)} sq ft is ${b.mezz.reduce((a, m) => a + m.area, 0) > g.width * g.length / 3 ? 'over' : 'under'} ⅓ of the floor`)}
          <label><span class="lab">Mezzanine level diaphragm ${cell('B19')}</span>${sel('diaphragm', cfg.diaphragm || 'flexible', [['flexible', 'None / flexible (the workbook\'s default)'], ['rigid', 'Rigid — accidental torsion on the bracing']])}</label>
        </div>
        <h4 class="seis-h-mz"><span class="step-no sm">3</span>Mezzanine loads <small class="sub-n">Input Data B89–B95 / F89–F95 · storage check box</small></h4>
        <div class="table-wrap"><table class="fl-t seis-mz"><thead><tr><th>Mezzanine</th><th class="num">Elevation</th><th>Floor dead (psf)</th><th class="num">Collateral</th><th class="num">Joists</th><th>Floor live</th><th class="num">Partition</th><th class="num">Seismic psf</th><th class="num">W (lb)</th></tr></thead><tbody>${mz}</tbody></table></div>
        <small class="sub-n">Floor dead is the design's dead load unless you type it (e.g. 55). The workbook takes 25 % of the floor live where the mezzanine is storage, and the partition load.</small></div>`;
    }).join('');
    box.innerHTML = site + bldg;

    // ---- step 4: each frame (Lateral Calcs. (1)) ----
    const distT = rows => `<table class="fl-t seis-dist"><thead><tr><th>Portion of the structure</th><th class="num">Eff. seismic weight W (lb)</th><th class="num">Elevation hx (ft)</th><th class="num">W·hx^k</th><th class="num">Fx (kips)</th><th class="num">Mx (ft-k)</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.key === 'mezz' ? 'mz' : ''}"><td>${esc(r.name)}${r.key === 'mezz' ? ` <small class="sub-n">${n0(r.area)} sq ft × ${F2(r.psf)} psf</small>` : ''}</td><td class="num mono">${lb(r.W)}</td><td class="num mono">${F2(r.h)}</td><td class="num mono">${lb(r.D)}</td><td class="num mono"><b>${F2(r.Fx)}</b></td><td class="num mono">${F2(r.M)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Totals</td><td class="num mono">${lb(rows.reduce((a, r) => a + r.W, 0))}</td><td></td><td class="num mono">${lb(rows.reduce((a, r) => a + r.D, 0))}</td><td class="num mono"><b>${F2(rows.reduce((a, r) => a + r.Fx, 0))}</b></td><td class="num mono">${F2(rows.reduce((a, r) => a + r.M, 0))}</td></tr></tfoot></table>`;
    const AT = { lew: 'Left Endwall', rew: 'Right Endwall', interior: 'Interior Frame' };
    $('#seisFrames').innerHTML = !live ? '<div class="empty">Complete the inputs above.</div>' : sj.buildings.map(b => {
      if (!b.frames.length) return '';
      const slot = b.mezz.slice(0, 2);
      return `${many ? `<h4 class="seis-bh">${esc(b.name)}</h4>` : ''}<div class="table-wrap"><table class="fl-t seis-frames"><thead><tr><th>Frame line</th><th>System ${cell('B9')}</th><th class="num">Bay width ${cell('B18')}</th><th>Located at ${cell('Q1')}</th>${slot.map((m, k) => `<th class="num">${esc(m.id)} area ${cell(k ? 'B34' : 'B31')}</th>`).join('')}<th class="num">Cs</th>${slot.map((m, k) => `<th class="num">${esc(m.id)} load ${cell(k ? 'G78' : 'G77')}</th>`).join('')}<th class="num">Frame V ${cell('H79')}</th><th></th></tr></thead><tbody>${b.frames.map(fr => { const L = fr.lat, ml = id => L.mezzLoads.find(x => x.id === id); return `<tr class="seis-fr" data-fr="${esc(b.bkey + '|' + fr.label)}">
        <td><b class="mono">${esc(fr.label)}</b></td><td>${esc(SEIS_TYPE(fr.type))}<small class="sub-n">${esc(L.sys.name)} · R ${f(L.R, 2)}</small></td><td class="num mono">${ft(fr.bay)}<small class="sub-n">${fr.at === 'interior' ? 'half the bay each side' : 'half the end bay'}</small></td><td>${AT[fr.at]}</td>
        ${slot.map(m => `<td class="num mono">${n0(fr.areas[m.id] || 0)}</td>`).join('')}<td class="num mono">${f(L.cs.Cs, 4)}</td>
        ${slot.map(m => `<td class="num mono">${ml(m.id) ? `<b>${F2(ml(m.id).F)}</b> k` : '—'}</td>`).join('')}<td class="num mono">${F2(L.frameV)}</td>
        <td>${wbBtn(`seismic|${b.bkey}|${fr.label}`, 'Workbook')}</td></tr>
        <tr class="seis-dist-row" hidden><td colspan="${7 + 2 * slot.length}"><div class="seis-dist-wrap">${distT(L.rows)}
          ${(() => { const w = b.workbook && b.workbook.frames.find(x => x.label === fr.label); return w ? `<details class="seis-d"><summary>What goes into the workbook for frame ${esc(fr.label)} — ${b.workbook.input.length + b.workbook.long.length + w.steps.length} cells</summary><div class="xl-cols"><div><h4><span>1</span>Input Data <small>the building and the mezzanines</small></h4>${xlTable(b.workbook.input, [])}</div><div><h4><span>2</span>Lateral Calcs. (1) <small>this frame</small></h4>${xlTable(w.steps, w.read, 'The workbook then shows')}<h4><span>3</span>Longitudinal Calcs. <small>the bracing</small></h4>${xlTable(b.workbook.long, b.workbook.longRead, 'The workbook then shows')}</div></div></details>` : ''; })()}
          <div class="seis-out">Ta = ${f(L.sys.Ct, 3)} × ${F2(L.hn)}<sup>${L.sys.x}</sup> = ${f(L.Ta, 3)} s → k = ${f(L.k, 2)} · Cs ${f(L.cs.Cs, 4)} by ${esc(L.cs.governs)}${L.cs.note ? ' · ' + esc(L.cs.note) : ''} · ${esc(L.sys.name)} (R ${f(L.R, 2)}, Ω ${f(L.sys.Omega, 1)}, Cd ${f(L.sys.Cd, 1)})${fr.loose.length ? `<div class="bad">${fr.loose.map(l => `${esc(l.id)} ${F2(l.F)} k has no frame column on this line — ${esc(l.why)}`).join('<br>')}</div>` : ''}</div></div></td></tr>`; }).join('')}</tbody></table></div>`;
    }).join('') + (live && infos.length ? `<div class="seis-notes"><b>Notes</b><ul>${infos.map(n => `<li>${esc(n.text)}</li>`).join('')}</ul></div>` : '');
    $$('#seisFrames .seis-fr').forEach(tr => { tr.onclick = ev => { if (ev.target.closest('button')) return; const nx = tr.nextElementSibling; nx.hidden = !nx.hidden; tr.classList.toggle('open', !nx.hidden); }; });

    // ---- step 5: into NBG Frame — one row per frame line × column × level; Applied is what the files get ----
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
        const e = r.e, it = fileFor(b, r.fr), from = r.edited === 'typed' ? `${r.mezz.join(' + ')}` : r.mezz.map((m, i) => `${m} ${Math.round(r.shares[i] * 100)} %`).join(' + ');
        return `<tr class="${r.edited ? 'is-' + r.edited : ''}" data-fr="${esc(b.bkey + '|' + r.fr.label)}" data-member="${esc(e.member)}"><td class="mono"><b>${esc(r.fr.label)}</b></td><td class="mono">${esc(e.label)}</td><td class="mono"><b>${esc(e.member)}</b></td><td class="num mono">${ft(e.at)}</td>
          <td class="sub-n">${esc(from)}${r.edited !== 'typed' && r.shares.some(x => x < 0.999) ? ` <small>of the frame's ${esc(r.mezz.join(' / '))} load (by dead load)</small>` : ''}</td>
          <td class="num mono">${F2(r.calc)}</td>
          <td class="num"><span class="eq-edit ${r.edited ? 'is-' + r.edited : ''}">± <input class="seis-in eq-in" data-eqkey="${esc(e.key)}" value="${f(r.F, 3)}" inputmode="decimal" title="kips — EQR +, EQL −">${r.edited === 'typed' ? `<button class="eq-x" data-eqclear="${esc(e.key)}" title="back to the calculated load">↺</button>` : ''}</span>${r.edited ? `<small class="sub-n eq-tag">${r.edited === 'typed' ? 'typed' : '× ' + scale}</small>` : ''}</td>
          <td>${it ? `<small class="mono">${esc(outName(it, parseLines(it.lines)))}</small><small class="sub-n">EQR +${F2(r.F)} / EQL −${F2(r.F)}</small>` : '<small class="sub-n">drop its .frame file on the Plan page</small>'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    }).join('');
    $$('#seisApply [data-eqkey]').forEach(el => { el.onchange = () => setEq([el.dataset.eqkey], el.value); });
    $$('#seisApply [data-eqclear]').forEach(el => { el.onclick = ev => { ev.stopPropagation(); setEq([el.dataset.eqclear], ''); }; });
    const ra = $('#eqResetAll');
    if (ra) ra.onclick = () => { delete state.seis.eqOverride; delete state.seis.eqScale; seisSave(); recompute(); toast('EQ loads back to the calculated values'); };

    // ---- step 6: bracing (Longitudinal Calcs.) ----
    $('#seisBracing').innerHTML = !live ? '' : sj.buildings.map(b => { const G = b.long; if (!G) return ''; const slot = b.mezz.slice(0, 2), first = b.frames[0];
      return `${many ? `<h4 class="seis-bh">${esc(b.name)}</h4>` : ''}
      <div class="seis-sum"><span>${esc(G.sys.name)} · R ${f(G.sys.R, 2)}</span><span>Ta ${f(G.Ta, 3)} s · k ${f(G.k, 2)}</span><span>Cs <b>${f(G.cs.Cs, 4)}</b></span><span>Base shear <b>${F2(G.V)} k</b></span><span>FSW ${esc((cfg.types || RUN.SEIS_DEFAULTS.types)[0])} ${cell('B8')} · BSW ${esc((cfg.types || RUN.SEIS_DEFAULTS.types)[1])} ${cell('B9')}</span>${first ? wbBtn(`seismic|${b.bkey}|${first.label}`, 'Workbook') : ''}</div>
      <div class="table-wrap"><table class="fl-t seis-brace"><thead><tr><th>Mezzanine</th><th class="num">Loading area ${cell('B27 / B30')}</th><th class="num">At</th><th class="num">Seismic force for the bracing ${cell('G77 / G78')}</th></tr></thead><tbody>${G.mezzLoads.map((m, k) => `<tr><td><b>${esc(m.id)}</b></td><td class="num mono">${n0((slot[k] || {}).area || 0)}</td><td class="num mono">${ft(m.at)}</td><td class="num mono"><b>${F2(m.F)} k</b></td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">Mezzanine total</td><td class="num mono"><b>${F2(G.mezzLoads.reduce((a, m) => a + m.F, 0))} k</b></td></tr></tfoot></table></div>
      <div class="seis-out"><b>For the bracing software</b> — roof seismic dead weight <b>${F2(G.roofPsf)} psf</b> ${cell('H66')} with factor <b>${f(G.cs.Cs, 4)}</b>; sidewalls ${G.wallLoads.map(w => `${w.key.toUpperCase()} ${F2(w.F)} k at ${ft(w.at)}`).join(' · ')}; the mezzanine loads above at their level.</div>
      <details class="seis-d"><summary>Multistory distribution (the workbook's Longitudinal sheet)</summary>${distT(G.rows)}</details>
      <details class="seis-d"><summary>Which bracing lines take it (DM 15.1.3) — the tool's own step</summary>
        <div class="table-wrap"><table class="fl-t"><thead><tr><th>Bracing line at the mezzanine level</th><th>Along</th><th>Holds it</th><th class="num">Seismic (k)</th><th class="num">1 % (FDL+FLL) (k)</th><th class="num">Design (k)</th></tr></thead><tbody>${b.braceLines.map(l => `<tr class="${l.independent ? 'indep' : ''}"><td><b>${esc(l.edge)}</b><small class="sub-n">${esc(l.mezz.join(' + '))} · at ${ft(l.at)}</small></td><td class="mono">${l.segs.map(([a, c]) => `${ft(a)} – ${ft(c)}`).join(', ')}</td><td>${esc(l.element)}</td><td class="num mono">${F2(l.F)}</td><td class="num mono">${l.independent ? F2(l.stab) : '—'}</td><td class="num mono"><b>${F2(l.design)}</b><small class="sub-n">${esc(l.governs)}</small></td></tr>`).join('')}</tbody></table></div>
        <small class="sub-n">The floor spans across the building between these lines (lever rule, piece by piece along the length). A sidewall line is the building's bracing, tiered at the mezzanine level; any other line needs independent X-bracing, for the larger of the seismic and the DM's 1 % stability force.</small></details>`; }).join('');

    // ---- what the tool adds beyond the procedure ----
    const flags = [];
    if (live) {
      const b0 = sj.buildings[0];
      const fOn = sj.buildings.some(b => b.mezz.some(m => m.framing > 0));
      flags.push(`<b>Framing weight in the floor dead.</b> ${fOn ? `${sj.buildings.flatMap(b => b.mezz.filter(m => m.framing > 0).map(m => `${esc(m.id)} + ${F2(m.framing)} psf (this design's beams and half its columns)`)).join(' · ')}, so the workbook's Floor Dead gets ${sj.buildings.flatMap(b => b.mezz.map(m => `${F2(m.FDL + m.framing)}`)).join(' / ')} psf.` : 'Off — the Floor Dead is typed as it is.'} ${chk('framingAll', fOn, 'add the framing weight')} — untick when your floor dead already includes it (e.g. 55).`);
      flags.push(`<b>Self weight.</b> Lateral frame self weight ${F2(b0.roof.SW.value)} psf (B33, the workbook's default) and roof self weight ${F2(b0.roof.RSW.value)} psf (B36). This is how your W1S-26062 longitudinal table reads (roof W 230,283 lb); if "self weight 1 psf" meant the frame's, type B33 = 1 and B36 = 0 in step 2.`);
      flags.push(`<b>Each frame's mezzanine load split between its columns</b> ${sel('split', cfg.split || 'dead', [['dead', 'by the dead load each column takes'], ['equal', 'equally']])} — or type each column's load in step 5.`);
      flags.push(`<b>R.</b> The workbook takes "steel systems not detailed for seismic" (R 3) in SDC A–C; NBG Frame's own seismic uses OMF R 3.5. The EQ loads here are the workbook's (R ${f((b0.frames[0] || { lat: { R: 3 } }).lat.R, 2)}). Untick the check box in step 2 for OMF.`);
      const roofT = sj.buildings.map(b => b.frames.map(fr => `${esc(fr.label)}: ${F2(fr.lat.altRoof)} psf`).join(' · ')).join(' | ');
      flags.push(`<b>Roof seismic for NBG Frame (not in your procedure, not written).</b> The workbook also gives an alternate roof seismic weight (Lateral G64) that lumps the roof, the walls and, with the mezzanine in the building, the extra share the vertical distribution puts at the roof: ${roofT}, with factor Cs. NBG Frame's own roof seismic leaves the mezzanine out. Shown for information; the frame files keep NBG Frame's.`);
      flags.push(`<b>Bracing lines.</b> Step 6's split of the bracing force to the lines that hold the floor, and the DM 15.1.3 1 % check for independent bracing, are the tool's own — the workbook gives the total.`);
      flags.push(`<b>EQR Ecc. Loc.</b> ${brCode().code ? `Bottom/Right = code ${esc(brCode().code)} (${brCode().how}).` : 'Written Top/Left (as NBG Frame writes its own lean-to seismic rows) until the Bottom/Right code is confirmed on the Plan page — an X force with no offset takes no moment from the flange it is drawn at.'}`);
    }
    $('#seisFlags').innerHTML = flags.length ? `<ol class="seis-flags">${flags.map(t => `<li>${t}</li>`).join('')}</ol>` : '';
    $('#seisFlagsPanel').hidden = !flags.length;

    // how
    $('#seisHow').innerHTML = `<ol>
      <li><b>Input Data</b> — the code from the PCS code line (the workbook's drop-down), Ss, S1, site class and occupancy from Box 3; the building from Box 2; roof dead from NBG Frame (the frame file) since the PCS says "Per Seller"; collateral and snow from Box 4; walls at 3 psf; each mezzanine's elevation (A), floor dead, collateral, joists, live (storage) and partition.</li>
      <li><b>Lateral Calcs. (1), one frame at a time</b> — the frame's system, its bay width (the strip it carries: half the bay each side, an end frame half the end bay), where it is (left endwall / interior / right endwall), and each mezzanine's floor area inside that strip. The sheet's mezzanine row (G77 / G78) is that frame's mezzanine seismic force.</li>
      <li><b>Into the frame</b> — that force goes on the frame columns the mezzanine's beams frame into, shared by the dead load each takes (DM 15.1.3: a side on a rigid frame is held by the frame): EQR = +F, EQL = −F as X forces at the mezzanine elevation.</li>
      <li><b>Longitudinal Calcs.</b> — the whole building; the mezzanine rows are the seismic forces the bracing takes at the mezzanine level.</li>
      <li><b>Load level.</b> The workbook's values are Q<sub>E</sub> (12.8), before ρ and the ASD 0.7 — NBG Frame's load combinations apply them.</li>
      <li><b>Checked</b> — the tool's engine against the workbook: 1,386 of 1,386 values over 15 cases; and every frame of the four sample jobs typed into the real workbook and recalculated: the same numbers (oracle/fill_check.py).</li></ol>`;
    // input handlers
    $$('#v-seismic [data-seis]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.seis, v = el.type === 'checkbox' ? el.checked : el.value.trim();
        const c = state.seis;
        const setPath = (obj, path, val) => { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(x => { o = o[x] = o[x] || {}; }); if (val === '' || val == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = val; };
        if (k === 'ndfs') c.ignoreNDFS = !v;
        else if (k === 'vertical') c.vertical = v;
        else if (k === 'split') c.split = v;
        else if (k === 'diaphragm') c.diaphragm = v;
        else if (k.startsWith('types.')) { c.types = (c.types || RUN.SEIS_DEFAULTS.types).slice(); c.types[+k.slice(6)] = v; }
        else if (k.startsWith('b.')) { const rest = k.slice(2), bk = sj.buildings.map(b => b.bkey).find(x => rest.startsWith(x + '.')); const path = rest.slice(bk.length + 1); c.buildings = c.buildings || {}; c.buildings[bk] = c.buildings[bk] || {}; setPath(c.buildings[bk], path, typeof v === 'boolean' ? v : v === '' ? '' : +v); }
        else if (k.startsWith('m.')) { const id = sj.buildings.flatMap(b => b.mezz.map(m => m.id)).find(x => k.startsWith('m.' + x + '.')); const path = k.slice(2 + id.length + 1); c.mezz = c.mezz || {}; c.mezz[id] = c.mezz[id] || {}; c.mezz[id][path] = typeof v === 'boolean' ? v : v === '' ? undefined : +v; if (c.mezz[id][path] === undefined) delete c.mezz[id][path]; }
        else if (k === 'ed' || k === 'siteClass' || k === 'risk') c[k] = v;
        else if (k === 'eqScale') { if (v === '' || !(+v > 0)) delete c.eqScale; else c.eqScale = +v; }
        else if (k === 'framingAll') { c.mezz = c.mezz || {}; sj.buildings.forEach(b => b.mezz.forEach(m => { c.mezz[m.id] = { ...(c.mezz[m.id] || {}), framing: !!v }; if (v) delete c.mezz[m.id].framing; })); }
        else c[k] = v === '' ? undefined : +v;
        seisSave(); recompute();
      };
    });
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
      localStorage.setItem(k, JSON.stringify(keep));
    } catch (e) { /* private window: kept for this session */ }
  }
  function seisLoad() { const k = seisKey(); try { return (k && JSON.parse(localStorage.getItem(k) || 'null')) || {}; } catch (e) { return {}; } }

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
        <table class="fl-t"><thead><tr><th>Column</th><th>NBG Frame member</th><th class="num">At (${atLab})</th><th class="num">Floor dead (k)</th><th class="num">Floor live (k)</th><th class="num">Seismic EQR/EQL (k)</th><th>From</th></tr></thead><tbody>${fl.entries.map(e => `<tr class="${e.member ? '' : 'not-member'}" data-tip="bcol|${e.x}|${e.y}"><td class="mono"><b>${esc(e.label)}</b>${e.planKind === 'star' ? ' <span class="star" title="Most Economical (✱) on the drawing">✱</span>' : ''}</td><td>${e.member ? `<b class="mono">${esc(e.member)}</b> · ${esc(e.where)}` : `<span class="sub-n">${esc(e.where)}</span>`}</td><td class="num mono">${ft(atOf(e))}</td><td class="num mono d">${F2(e.D)}</td><td class="num mono l">${F2(e.L)}</td><td class="num mono e">${e.eq && e.eq.length ? '±' + F2(e.eq.reduce((a, q) => a + q.F, 0)) + (e.eq.some(q => q.edited) ? `<small class="sub-n eq-tag">${e.eq.some(q => q.edited === 'typed') ? 'typed' : 'scaled'} · calc. ${F2(e.eq.reduce((a, q) => a + q.calc, 0))}</small>` : '') : sj && sj.ok ? '—' : '<small class="sub-n">Seismic page</small>'}</td><td class="sub-n">${esc(e.parts.map(p => `${many ? p.mezz + ' ' : ''}${p.beam}${p.mark ? ' ' + p.mark : ''}`).join(' + '))}</td></tr>`).join('')}</tbody>
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
          <small>Not in your procedure, for information: the workbook's alternate roof seismic weight for ${p.lines.length > 1 ? 'these lines' : 'this line'} is ${f(sz.roofPsf, 2)} psf with Cs ${f(sz.Cs, 4)} (Lateral G64 — roof, walls and the extra share the mezzanine puts at the roof); frame base shear ${f(sz.V, 2)} k. See the Seismic page.</small></div>`;
      const left = p.r.unplaced.length ? `<div class="nbg-left"><b>Not in this file</b> — the frame has no member at these columns (endwall columns are designed with the endwall), so their loads are not put on it:${p.r.unplaced.map(u => `<div><span class="mono"><b>${esc(u.label)}</b></span> ${esc(u.where.replace(/\s*—\s*not a member.*$/, ''))} · <span class="mono d">D ${F2(u.D)} k</span> · <span class="mono l">L ${F2(u.L)} k</span> at ${ft(state.nbg.height === 'A' && u.A != null ? u.A : u.elev)}<small>${esc(u.parts.map(q => `${many ? q.mezz + ' ' : ''}${q.beam}${q.mark ? ' ' + q.mark : ''}`).join(' + '))}</small></div>`).join('')}</div>` : '';
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
      return `${many ? esc(m.id) + ' ' : ''}${bs.map(x => 'B' + (x.id + 1)).join(', ')} (line ${lines.join(', ')})`; }).join(' · ');
  }
  // Beam inputs: the span and trib on the MB sheet for a mark (e.g. the member length between column faces). They change
  // the beam design only — the plan, the columns and the loads to the frame keep the layout. One member over the job.
  const setMarkInput = (mark, v) => allSettings().forEach(st => { const mi = { ...(st.markInput || {}) }; if (v) mi[mark] = v; else delete mi[mark]; st.markInput = mi; });
  function renderBeamInputs(mk) {
    const dz = mkDz(mk), cur = (state.settings.markInput || {})[mk.mark] || {};
    const runs = (mk.spanRuns || []).slice(1);
    $('#beamInputs').innerHTML = `<div class="bi-head"><div><span class="eyebrow">Beam inputs · ${mk.mark}</span><small>MB sheet only — the plan, the columns and the loads to the frame keep the layout (${ft(mk.span)} × ${ft(mk.trib)})</small></div>
        <span class="bi-btns"><button class="btn-soft" id="biTry">Try another section</button><button class="btn-ghost" id="biReset" ${dz.set ? '' : 'disabled'}>Back to the layout</button></span></div>
      <div class="bi-row">
        <label class="bi-f ${cur.span ? 'is-set' : ''}"><span>Design span <small>member length</small></span><input data-bi="span" value="${esc(ft(dz.span))}" spellcheck="false" autocomplete="off"><small>${dz.cut ? `${dz.cut > 0 ? '−' : '+'}${ft(Math.abs(dz.cut))} from ${ft(mk.span)}${runs.length ? ', also on the ' + runs.map(q => ft(q.span) + ' → ' + ft(runL(q))).join(', ') + ' run' + (runs.length > 1 ? 's' : '') : ''}` : `layout ${ft(mk.span)}`}</small></label>
        <label class="bi-f ${cur.trib ? 'is-set' : ''}"><span>Design trib <small>tributary width</small></span><input data-bi="trib" value="${esc(ft(dz.trib))}" spellcheck="false" autocomplete="off"><small>layout ${ft(mk.trib)}</small></label>
        <div class="bi-out">${mk.check ? `<b class="nocase">${esc(mk.desc)}</b><small>combined ${f(mk.check.res.CSR, 3)} · shear ${f(mk.check.res.SRvx, 3)} · L/${f(mk.check.defl.rLL, 0)}</small>` : '<b>no section</b><small>nothing passes — see the depth table</small>'}</div>
      </div>`;
    const lay = { span: mk.span, trib: mk.trib };
    $$('#beamInputs input[data-bi]').forEach(inp => {
      inp.onchange = () => {
        const k = inp.dataset.bi, raw = inp.value.trim();
        const v = raw === '' ? lay[k] : (PCS.ftin(raw) ?? PCS.ftin(raw + "'"));
        if (v == null || !(v > 0)) { toast(`${raw} is not a length — e.g. 22'-4" or 22.333`); inp.value = ft(mkDz(mk)[k]); return; }
        const next = { ...((state.settings.markInput || {})[mk.mark] || {}) };
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
      <li><b>How deep it can be.</b> ${sr.dTop < sr.options.dMax ? `Clearance (C) under the floor beams caps it: <span class="eq">(A − C) × 12 − slab − seat = (${ft(A)} − ${ft(C)}) × 12 − ${f(slab, 2)} − ${f(seat, 2)} = ${f(mk.maxDepth, 0)}"</span>.` : `No clearance (C) limit below the ${sr.options.dMax}" top of the range (Settings).`} Depths ${sr.options.dMin}"–${sr.dTop}" are searched, an inch at a time.</li>
      <li><b>The plates.</b> ${esc(div)} stock (DM 5.1): webs ${stock.webs.map(t => 'W' + String(Math.round(t * 1000)).padStart(3, '0')).join(', ')}; flanges ${stock.flanges.length} widths × thicknesses, 6"–12" × ¼"–1"${s.symmetric ? ', the same plate top and bottom' : ''}. <b>${sr.evaluated.toLocaleString()}</b> combinations were run through the MB sheet${removed.length ? `; ${removed.reduce((a, x) => a + x[1], 0).toLocaleString()} more were left out by the NBG Production Guidelines: ${removed.map(([k, n]) => `${n.toLocaleString()} ${RULE_TXT[k] || k}`).join(' · ')}` : ''}.</li>
      <li><b>What has to pass</b> (each combination, MB sheet, ASD ${esc(edLabel(state.res.edition.beamEd || ''))}): combined stress ratio ≤ ${s.target} (flexure with the joists bracing the top flange), shear ≤ ${s.target}, live deflection ≤ L/360, total ≤ L/240${s.requireConc ? ', and the joist-seat concentrated-load (bearing) check' : ''}. <b>${nPass.toLocaleString()}</b> pass.</li>
      <li><b>The options.</b> ${(() => { const gs = []; mk.options.forEach(o => { const g = gs.find(x => sameSec(x.sec, o.pick.sec)); if (g) g.roles.push(o); else gs.push({ sec: o.pick.sec, pick: o.pick, roles: [o] }); }); return `${gs.length === 1 ? 'They all land on one section' : `${gs.length} different sections`}:<ul>${gs.map(g => `<li><b>${esc(g.pick.desc)}</b> (${f(g.pick.wt, 1)} plf, ${esc(g.pick.flange)} on ${esc(g.pick.web)}) — ${g.roles.map(o => `<b>${esc(o.label)}</b>: ${esc(o.why)}`).join(' ')}</li>`).join('')}</ul>`; })()}
        ${fit && fit.steps ? `<h5>Best fit, step by step (the quote engineer's method)</h5><ol class="fit-steps">${fit.steps.map(st => `<li>${esc(st.text)}${st.tries && st.tries.length > 1 ? `<div class="fit-tries">${st.tries.map(t => `<span class="${t.ok ? 'ok' : 'no'}">${esc(t.sec || t.web || (t.d != null ? t.d + '"' : ''))}${t.CSR != null ? ` · ${f(t.CSR, 2)}` : t.shear != null ? ` · shear ${f(t.shear, 2)}` : ''}${!t.ok && t.why ? ` — ${esc(t.why)}` : ''}</span>`).join('')}</div>` : ''}</li>`).join('')}</ol>` : ''}
        ${mk.deeper && mk.deeper.length ? `<h5>More depth (needs a lower clearance C)</h5><p>${mk.deeper.map(z => `${z.d}" ${esc(z.desc)} ${f(z.wt, 1)} plf (C ≤ ${ft(z.needC)})`).join(' · ')}</p>` : ''}</li>
      <li><b>On the quote:</b> ${pick ? `<b>${esc(pick.label)}</b> — ${mk.pinned && mk.pinned.key ? 'picked on the Design page' : `the default option (Settings: ${esc(({ lightest: 'Lightest', fit: 'Best fit', econ: 'Most economical' })[s.optionDefault] || s.optionDefault)})`}` : mk.optionKey === 'custom' ? 'a section picked by depth or by hand' : '—'}: <b>${esc(mk.desc || '—')}</b>${mk.check ? ` — combined ${f(mk.check.res.CSR, 3)}, shear ${f(mk.check.res.SRvx, 3)}, live L/${f(mk.check.defl.rLL, 0)}, total L/${f(mk.check.defl.rTL, 0)}; end shear ${f(mk.check.V.D, 2)} k dead, ${f(mk.check.V.L, 2)} k live to the column or frame` : ''}.${(mk.spanRuns || []).length > 1 ? ` The shorter members of the mark (${mkShort(mk)}) take the same section, each checked at its own length.` : ''}</li>
    </ol>`;
  }
  function renderColHow(r, g, cno, nm) {
    const el = $('#colHow');
    if (!el) return;
    const cf = r.colFinal, tried = (g.design ? g.design.tried : (cf && cf.tried) || []);
    $('#colExplainHead').innerHTML = `How the column was chosen <small>${cf ? esc(cf.quoteAs) : 'none'} · ${esc(g.cols.map(nm).join(', '))}</small>`;
    const s = state.settings, inp = state.inputs;
    const parts = side => (g.cols[0].parts || []).filter(q => q.sheetSide === side).map(q => `${esc(q.mezz)} ${esc(q.beam)}${q.mark ? ' (' + esc(q.mark) + ')' : ''}`).join(' + ') || 'no beam';
    el.innerHTML = `<ol>
      <li><b>Which column.</b> ${esc(g.cols.map(nm).join(', '))} — a mezzanine column (not a frame member) under ${g.cols.length > 1 ? 'these grid points, which carry the same loads, so one Column-sheet case covers them' : 'this grid point'}. The C-number counts the job's mezzanine columns on the plan; the grid label is the frame line / column line it stands on.</li>
      <li><b>Its loads.</b> The unfactored end shears (MB sheet H6 / H10) of the beams framing in. Left: ${parts('left')} → <span class="eq">D ${f(g.loads.DL_L, 2)} / L ${f(g.loads.LL_L, 2)} k</span>; right: ${parts('right')} → <span class="eq">D ${f(g.loads.DL_R, 2)} / L ${f(g.loads.LL_R, 2)} k</span>. Each reaction acts at e = d/2 off the column centre (the Column sheet's eccentricity), and the column's own weight is added.</li>
      <li><b>Its length.</b> <span class="eq">${ft(r.colLen)}</span> — ${s.colLength === 'clear' ? 'the clear height to the underside of the beams (A − slab − seat − beam depth)' : `the top of the mezzanine floor, A = ${ft(inp.geom.A.value)} (the Column sheet's L, braced at the ends only: Lbx = Lby = L)`}.</li>
      <li><b>The three combinations</b> (DM 15.1.1.4.2): dead + live on the left with dead only on the right, the same the other way, and dead + live on both — the unbalanced cases put the most moment in the column. Each must read OK with CSR ≤ 1.00.</li>
      <li><b>Sizes, in order.</b> The common columns first, lightest first: ${DESIGN.COMMON_COLUMNS.slice().sort((a, b) => WF[a].W - WF[b].W).map(n => `${n} (${WF[n].W} plf)`).join(' → ')}${s.includeW818 ? ', with W8X18 ahead of them' : ''}. The first that passes every case is used${manyMezz() && s.colPerJob !== false ? ' — one section for every mezzanine column of the job' : ''}. If none does, the next heavier W8–W14 that passes is used and quoted as BU (training guide).
        <table><thead><tr><th>Tried</th><th class="num">plf</th><th class="num">Max CSR</th><th>Result</th></tr></thead><tbody>${tried.map(t => `<tr class="${t.ok ? 'pass' : 'fail'}"><td class="mono">${esc(t.name)}</td><td class="num">${f(WF[t.name].W, 0)}</td><td class="num">${f(t.max, 3)}</td><td>${t.ok ? (cf && cf.name === t.name ? 'passes — used' : 'passes') : 'fails'}</td></tr>`).join('')}</tbody></table></li>
      <li><b>Tubes / pipe.</b> When a customer asks for tube (HSS) or pipe columns, they are not on the Column sheet — size them separately and note it on the quote; this page designs W / BU only.</li>
    </ol>`;
  }

  function renderBeam() {
    const marks = jobMarks();
    $('#markTabs').innerHTML = marks.map((m, i) => `<button class="tab ${i === state.mark ? 'is-active' : ''}" data-i="${i}"><i class="mk-dot" style="background:${mkHex(m)}"></i>${mkName(m)} · ${esc(m.desc || 'none')} · ${m.qtyAll} beam${m.qtyAll === 1 ? '' : 's'}</button>`).join('');
    $$('#markTabs .tab').forEach(t => { t.onclick = () => { state.mark = +t.dataset.i; state.markSpan = 0; renderBeam(); renderMiniPlan(); renderCalcPack(); }; });
    const mk = marks[state.mark];
    if (!mk) { $('#beamInputs').innerHTML = ''; $('#spanRuns').innerHTML = ''; $('#mbSheet').innerHTML = '<div class="empty">No beams.</div>'; $('#altTable').innerHTML = ''; $('#xlBeam').innerHTML = ''; $('#xlBeamSub').textContent = ''; return; }
    // every member length of the mark: the governing run (longest span, largest trib) and the shorter beams — same section, own MB sheet
    const runs = mk.spanRuns && mk.spanRuns.length ? mk.spanRuns : [{ span: mk.span, qty: mk.qtyAll, check: mk.check, params: mk.params }];
    if (state.markSpan >= runs.length) state.markSpan = 0;
    const run = runs[state.markSpan], gov = state.markSpan === 0, dz = mkDz(mk);
    renderBeamInputs(mk);
    $('#spanRuns').innerHTML = `<div class="sr-head"><span class="eyebrow">MB sheet runs · ${mk.mark}</span><small>${runs.length > 1 ? 'one section; each member length is its own run' : 'one member length'} · trib ${ft(dz.trib)}${mk.kind ? ' (largest ' + mk.kind + ')' : ''}${dz.set ? ' · design inputs set above' : ''}</small></div>` +
      runs.map((q, i) => `<button class="sr ${i === state.markSpan ? 'is-on' : ''}" data-i="${i}"><b>${ft(runL(q))}</b><span>${q.qty} beam${q.qty === 1 ? '' : 's'}${i === 0 ? ' · designed' : ''}</span><small>${runBeams(mk, q.span)}${Math.abs(runL(q) - q.span) > 1e-3 ? ' · layout ' + ft(q.span) : ''}</small>${q.check ? `<em class="${q.check.res.CSR <= state.settings.target && q.check.res.SRvx <= state.settings.target && q.check.llOK && q.check.tlOK ? 'ok' : 'ng'}">${f(Math.max(q.check.res.CSR, q.check.res.SRvx), 2)}</em>` : ''}</button>`).join('');
    $$('#spanRuns .sr').forEach(b => { b.onclick = () => { state.markSpan = +b.dataset.i; renderBeam(); renderMiniPlan(); }; });
    // INPUT-sheet values (A, slab, seat, clearances) of a mezzanine that has this mark — the one on screen when it does
    const r = mk.mezzIds && !mk.mezzIds.includes(state.res.index) && state.job ? state.job.mezz[mk.mezzIds[0]] : state.res;
    const inp = state.all ? state.all[r.index].inputs : state.inputs;
    $('#beamCalcTitle').innerHTML = `${mkName(mk)} · <em class="nocase">${esc(mk.desc || 'no section')}</em>${gov ? '' : ` <small class="bc-run">at ${ft(runL(run))}</small>`}`;
    renderBeamHow(mk, r, inp);
    const c = run.check, p = run.params;
    if (!c) $('#mbSheet').innerHTML = '<div class="empty">No passing section in the depth range.</div>';
    else {
      const x = c.res, clear = r.clear;
      const clr = (k, lab) => [lab, `${clear[k].req != null ? f(clear[k].req, 2) : '—'} req · ${clear[k].prov != null ? f(clear[k].prov, 2) : '—'} prov ${clear[k].ok === false ? '· NO GOOD' : clear[k].ok ? '· OK' : ''}`, clear[k].ok === false ? 'ng' : ''];
      const lv = dz.set ? layoutV(mk, run) : null;
      $('#mbSheet').innerHTML = beamViz(mk, r, run) + (lv
        ? `<div class="frame-strip"><span class="eyebrow">Floor loads to the frame and columns · ${mk.mark} at the layout ${ft(run.span)} × ${ft(mk.trib)}</span><b>Dead ${f(lv.D, 3)} k</b><b>Live ${f(lv.L, 3)} k</b><small>per beam end, ${esc(mk.desc)} — the MB sheet below is at the design ${ft(runL(run))} × ${ft(dz.trib)} (shear D ${f(c.V.D, 3)} / L ${f(c.V.L, 3)} k, highlighted)</small></div>`
        : `<div class="frame-strip"><span class="eyebrow">Floor loads to the frame · ${mk.mark}${runs.length > 1 ? ' at ' + ft(run.span) : ''}</span><b>Dead ${f(c.V.D, 3)} k</b><b>Live ${f(c.V.L, 3)} k</b><small>unfactored shear at left / right, per beam end — highlighted below</small></div>`) + mbSheetBody(c, p, mk.sec, [
          ['Dead, (psf)', f(p.dead, 1)], ['Collateral, (psf)', f(p.coll, 1)], ['Live, (psf)', f(p.live, 1)], ['Est. Joist Wt., (psf)', f(p.joistWt, 1)],
          ['Top of Mezzanine, (ft.)', f(inp.geom.A.value, 3)], ['Slab & Deck Thickness, (in.)', f(inp.geom.slab.value * 12, 3)], ['Joist Seat Depth, (in.)', f(inp.geom.seat.value * 12, 3)],
          ['Total Joist Depth, (in.)', r.joistDepthIn != null ? f(r.joistDepthIn, 2) : '—'], ['Beam Depth, (in.)', mk.sec.d],
          clr('A', 'A - Finish floor to top of mezz'), clr('B', 'B - Clearance under joist'), clr('C', 'C - Clearance under support beams'),
        ]);
    }
    renderXlBeam(mk, run);
    const sr = mk.search;
    if (!sr || !sr.best) { $('#altTable').innerHTML = ''; return; }
    $('#altSub').textContent = `${sr.evaluated.toLocaleString()} stocked combinations checked for ${ft(dz.span)} span × ${ft(dz.trib)} trib${dz.set ? ' (design inputs)' : ''} · click a row to use it`;
    const optAt = sec => (mk.options.find(o => sameSec(o.pick.sec, sec)) || {}).label;
    $('#altTable').innerHTML = `<thead><tr><th class="num">Depth</th><th>Section</th><th>Web</th><th>Flanges</th><th>Econ.</th><th class="num">Wt plf</th><th class="num">Combined</th><th class="num">Shear</th><th class="num">LL L/</th><th class="num">TL L/</th><th class="num">Bearing</th></tr></thead><tbody>` +
      sr.byDepth.map(a => a.none ? `<tr class="none"><td class="num">${a.d}"</td><td colspan="10">nothing stocked passes at this depth</td></tr>` :
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
    sv.push(`<text class="bv-cap" x="${cx}" y="22" text-anchor="middle">${esc(c.desc)} · ${f(c.res.Wt, 1)} plf</text><text class="bv-s" x="${cx}" y="${top + dpx + 42}">Fy 55 ksi · Ix ${f(c.res.Ix || 0, 0)} in⁴ · drawn to scale</text>`);
    return `<div class="viz"><svg class="bviz" viewBox="0 0 700 ${H}" role="img" aria-label="${mk.mark} elevation">${o.join('')}</svg><svg class="bsec" viewBox="0 0 280 ${H}" role="img" aria-label="${esc(c.desc)} section">${sv.join('')}</svg></div>`;
  }
  // a column case, drawn: the W column with cap and base plates, the beams sitting on it, the two reactions at e = d/2
  function colViz(g, r, cno) {
    const cf = r.colFinal, w = WF[cf.name], c = g.cols[0], parts = c.parts || [];
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
    // W section to scale
    const k = Math.min(150 / w.bf, 210 / w.d), sx = 140, top = 70, sv = [];
    sv.push(`<rect class="cv-fl" x="${sx - w.bf * k / 2}" y="${top}" width="${w.bf * k}" height="${Math.max(2.5, w.tf * k)}"/><rect class="cv-col" x="${sx - Math.max(2, w.tw * k) / 2}" y="${top + w.tf * k}" width="${Math.max(2, w.tw * k)}" height="${(w.d - 2 * w.tf) * k}"/><rect class="cv-fl" x="${sx - w.bf * k / 2}" y="${top + (w.d - w.tf) * k}" width="${w.bf * k}" height="${Math.max(2.5, w.tf * k)}"/>`);
    const xl = sx - w.bf * k / 2 - 20;
    sv.push(`<path class="cv-dim" d="M${xl - 5},${top} L${xl + 5},${top} M${xl - 5},${top + w.d * k} L${xl + 5},${top + w.d * k} M${xl},${top} L${xl},${top + w.d * k}"/><text class="cv-t" transform="translate(${xl - 9},${top + w.d * k / 2}) rotate(-90)">d = ${w.d}"</text>`);
    sv.push(`<text class="cv-t" x="${sx}" y="${top - 12}">bf = ${w.bf}" · tf = ${w.tf}"</text><text class="cv-t" x="${sx}" y="${top + w.d * k + 24}">tw = ${w.tw}"</text>`);
    sv.push(`<text class="cv-cap2" x="${sx}" y="34">${esc(cf.name)}${cf.quoteAs !== cf.name ? ' (quote ' + esc(cf.quoteAs) + ')' : ''}</text><text class="cv-s" x="${sx}" y="${top + w.d * k + 44}">${f(w.W, 0)} plf · Fy 50 ksi · to scale</text>`);
    // why this case carries what it does: each beam, its span and trib
    const rows = parts.map(p => { const i = info(p); return `<tr><td>${p.sheetSide}</td><td class="mono"><b>${p.mezz !== r.id ? esc(p.mezz) + ' ' : ''}${p.beam}</b></td><td class="mono">${i.mk ? esc(i.mk.mark + ' ' + (i.mk.desc || '')) : '—'}</td><td class="num">${ft(i.bm.span)}</td><td class="num">${ft(i.bm.trib)}${i.bm.extra ? ' <small class="sub-n">incl. ' + esc(i.bm.extra.map(x => x.mezz).join(', ')) + '</small>' : ''}</td><td class="num">${f(p.D, 2)}</td><td class="num">${f(p.L, 2)}</td></tr>`; }).join('');
    const same = g.cols.length > 1 ? `<p class="foot-note">${g.cols.map(q => 'C' + (cno.get(q.label) || '?') + ' · ' + esc(q.label)).join(', ')} carry the same reactions, so they are one case on the sheet.</p>` : '';
    return `<div class="viz"><svg class="cviz" viewBox="0 0 760 ${yF + 26}" role="img" aria-label="Column elevation">${o.join('')}</svg><svg class="csec" viewBox="0 0 280 ${yF + 26}" role="img" aria-label="${esc(cf.name)} section">${sv.join('')}</svg></div>
      <div class="table-wrap cv-table"><table><thead><tr><th>Side</th><th>Beam</th><th>Mark · section</th><th class="num">Span</th><th class="num">Trib</th><th class="num">Dead (k)</th><th class="num">Live (k)</th></tr></thead><tbody>${rows}</tbody></table></div>${same}`;
  }
  // left beam → column ← right beam, with the dead / live shear each one brings (what goes in C27:D28)
  function lrDiagram(g, cno) {
    const c = g.cols[0];
    if (!c || !c.parts) return '';
    const side = sd => c.parts.filter(p => p.sheetSide === sd);
    const lab = ps => ps.length ? ps.map(p => `${p.mezz !== state.res.id ? p.mezz + ' ' : ''}${p.beam}${p.mark ? ' · ' + p.mark : ''}`).join(' + ') : 'no beam';
    const val = (D, L) => `D ${f(D, 2)} · L ${f(L, 2)} k`;
    return `<svg class="lr" viewBox="0 0 520 132" role="img" aria-label="Left and right beam reactions on ${esc(c.label)}">
      <rect x="236" y="20" width="48" height="104" rx="4" class="lr-col"/><text x="260" y="14" class="lr-c">C${cno.get(c.label) || '?'} · ${esc(c.label)}</text>
      <rect x="20" y="34" width="210" height="16" rx="3" class="lr-beam ${side('left').length ? '' : 'none'}"/><text x="125" y="66" class="lr-t">${esc(lab(side('left')))}</text><text x="125" y="84" class="lr-v">LEFT ${val(g.loads.DL_L, g.loads.LL_L)}</text>
      <rect x="290" y="34" width="210" height="16" rx="3" class="lr-beam ${side('right').length ? '' : 'none'}"/><text x="395" y="66" class="lr-t">${esc(lab(side('right')))}</text><text x="395" y="84" class="lr-v">RIGHT ${val(g.loads.DL_R, g.loads.LL_R)}</text>
      <path d="M222 42 l12 0 m-5 -5 l5 5 l-5 5" class="lr-a"/><path d="M298 42 l-12 0 m5 -5 l-5 5 l5 5" class="lr-a"/></svg>`;
  }
  // which beam (and which mezzanine) each Column-sheet reaction comes from
  function srcRows(c) {
    if (!c || !c.parts) return [];
    const side = sd => c.parts.filter(p => p.sheetSide === sd).map(p => `${esc(p.mezz)} ${p.beam}${p.mark ? ' (' + p.mark + ')' : ''} ${f(p.D, 2)} / ${f(p.L, 2)}`).join(' + ') || '—';
    return [['Left reaction from (D / L)', side('left')], ['Right reaction from (D / L)', side('right')]];
  }
  function renderColumn() {
    const r = state.res, cf = r.colFinal;
    if (!r.colGroups.length) { $('#colTabs').innerHTML = ''; $('#colSheet').innerHTML = '<div class="empty">No mezzanine columns in this layout.</div>'; $('#colTried').innerHTML = ''; $('#xlCol').innerHTML = ''; $('#xlColSub').textContent = ''; return; }
    const cno = colNos();
    const nm = c => `C${cno.get(c.label) || '?'} · ${c.label}`;
    $('#colTabs').innerHTML = r.colGroups.map((g, i) => `<button class="tab ${i === state.colGroup ? 'is-active' : ''}" data-i="${i}">${esc(g.cols.map(nm).join(', '))}${cf && cf.checks[i] ? `<small class="tab-ratio ${cf.checks[i].ok ? 'ok' : 'ng'}">${f(cf.checks[i].max, 2)}</small>` : ''}</button>`).join('');
    $('#colTabs').insertAdjacentHTML('beforeend', `<div class="name-key"><b>Column names</b> · <span class="mono">C3</span> the mezzanine column's number on the plan · <span class="mono">2/B</span> the grid point, frame line 2 × column line B · a tab holds the columns with the same loads (one Column-sheet case). Frame columns are named by their NBG Frame member, <span class="mono">COL02</span>, on the Plan page.</div>`);
    $('#colTabs').insertAdjacentHTML('beforeend', `<button class="btn-soft col-try" id="colTry">Try another column</button>`);
    $('#colTry').onclick = () => dzOpen('col', `${r.index}|${state.colGroup}`);
    $$('#colTabs .tab').forEach(t => { t.onclick = () => { state.colGroup = +t.dataset.i; renderColumn(); renderMiniPlan(); renderCalcPack(); }; });
    const g = r.colGroups[state.colGroup];
    if (!cf) $('#colSheet').innerHTML = '<div class="empty">No column passes.</div>';
    else {
      const chk = cf.checks[state.colGroup], w = WF[cf.name];
      const names = ['DLt+LLt+DRt', 'DLt+DRt+LRt', 'DLt+LLt+DRt+LRT'];
      $('#colSheet').innerHTML = colViz(g, r, cno) + `<div class="sheet two">
        <div><h4>Span and loading conditions</h4>${kv([
          ['Column Mark:', 'MC1'], ['Column Length, L', f(r.colLen, 4) + ' ft.'], ['X-Axis Unbraced Length, Lbx', f(r.colLen * 12, 2) + ' in.'], ['Y-Axis Unbraced Length, Lby', f(r.colLen * 12, 2) + ' in.'],
          ['Kx / Ky / Kz', '1.000 / 1.000 / 1.000'], ['Section:', `<b>${cf.name}</b>`], ['Fy (ksi)', '50'],
          ['Total Depth, d', f(w.d, 3) + ' in.'], ['Flange Width, b', f(w.bf, 3) + ' in.'], ['Flange Thickness, tf', f(w.tf, 3) + ' in.'], ['Web Thickness, tw', f(w.tw, 3) + ' in.'],
        ])}</div>
        <div><h4>Applied loads (beam reactions)</h4>${kv([
          ['Left Beam Reaction — Dead', f(g.loads.DL_L, 2) + ' kip'], ['Left Beam Reaction — Live', f(g.loads.LL_L, 2) + ' kip'],
          ['Right Beam Reaction — Dead', f(g.loads.DL_R, 2) + ' kip'], ['Right Beam Reaction — Live', f(g.loads.LL_R, 2) + ' kip'],
          ['X-Axis Eccentricity, e (d/2)', f(chk.ex, 2) + ' in.'], ['Column self-weight (Wt·L/1000)', f(chk.wt, 3) + ' kip'], ['Columns in this case', esc(g.cols.map(nm).join(', '))],
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
      tried.map(t => { const q = DESIGN.COMMON_COLUMNS.includes(t.name) || t.name === 'W8X18' ? t.name : t.name.replace(/^W(\d+)X/, 'BU$1x');
        return `<tr class="pick ${cf && cf.name === t.name ? 'is-chosen' : ''}" data-n="${t.name}"><td class="mono"><b>${t.name}</b></td><td class="num">${f(WF[t.name].W, 0)}</td><td class="num">${WF[t.name].bf}</td><td class="num">${f(t.max, 3)}</td><td><span class="status-text ${t.ok ? 'ok' : 'ng'}">${t.ok ? 'OK' : 'NG'}</span></td><td class="mono">${q}</td></tr>`; }).join('') +
      `<tr><td colspan="6"><div class="field-row wide" style="border:0"><label>Use a different W for every mezzanine column${manyMezz() && state.settings.colPerJob !== false ? ' of the job' : ''}</label><select id="colPick"><option value="">Automatic${!state.settings.colOverride && cf ? ' (' + cf.name + ')' : ''}</option>${Object.keys(WF).filter(k => /^W(6|8|10|12|14)X/.test(k)).sort((a, b) => WF[a].W - WF[b].W).map(k => `<option ${state.settings.colOverride === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></td></tr></tbody>`;
    // one column section for the job (Settings): the pick goes on every mezzanine
    const setCol = n => { (state.settings.colPerJob !== false ? allSettings() : [state.settings]).forEach(st => { st.colOverride = n; }); recompute(); };
    $$('#colTried tr.pick').forEach(tr => { tr.onclick = () => setCol(tr.dataset.n === (g.design && g.design.name) ? undefined : tr.dataset.n); });
    $('#colPick').onchange = e => setCol(e.target.value || undefined);
  }

  // ---------- design your own: any section and loads through the same MB / Column sheets ----------
  const ENG = window.MZ;
  const DZ_KEY = 'mzd.designer';
  const dzDefault = () => ({
    tab: 'beam',
    beam: { ed: '15', div: 'NBS-IN', dead: 43, coll: 5, live: 125, joistWt: 8, L: 20, Lb: 4, trib: 20, type: 'BU', d: 24, tw: 0.1875, bof: 6, tof: 0.375, sym: true, bif: 6, tif: 0.375, wf: 'W12X26', from: '' },
    col: { ed: '15', L: 11.5, wf: 'W8X24', DL_L: 10, LL_L: 20, DL_R: 10, LL_R: 20, from: '' },
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
  const dzBeamSources = () => (state.job ? jobMarks().filter(m => m.sec && m.params).map(m => ({ key: m.mark, label: `${mkName(m)} · ${m.desc} · ${ft(m.params.L)} × ${ft(m.params.trib)}`, m })) : []);
  const dzColSources = () => {
    if (!state.job) return [];
    const cno = colNos();
    return (state.job.mezz || []).flatMap(r => (r.colGroups || []).map((g, gi) => ({ key: `${r.index}|${gi}`, label: `${g.cols.map(c => `C${cno.get(c.label) || '?'} ${c.label}`).join(', ')}${manyMezz() ? ' · ' + r.id : ''}`, r, g })));
  };
  function dzLoadBeam(key) {
    const src = dzBeamSources().find(x => x.key === key);
    if (!src) return;
    const m = src.m, p = m.params, sec = m.sec, b = state.dz.beam;
    Object.assign(b, { from: key, ed: p.edition || b.ed, div: (state.res && state.res.division) || b.div, dead: p.dead, coll: p.coll, live: p.live, joistWt: p.joistWt, L: +(+p.L).toFixed(4), Lb: p.Lb, trib: +(+p.trib).toFixed(4) });
    if (sec.type === 'WF') Object.assign(b, { type: 'WF', wf: sec.name });
    else Object.assign(b, { type: 'BU', d: sec.d, tw: sec.tw, bof: sec.bof, tof: sec.tof, bif: sec.bif, tif: sec.tif, sym: sec.bof === sec.bif && sec.tof === sec.tif });
    state.dz.near = null;
  }
  function dzLoadCol(key) {
    const src = dzColSources().find(x => x.key === key);
    if (!src) return;
    const c = state.dz.col, ld = src.g.loads, cf = src.r.colFinal;
    Object.assign(c, { from: key, ed: (src.r.edition && src.r.edition.colEd) || c.ed, L: +(+src.r.colLen).toFixed(4), wf: cf ? cf.name : c.wf, DL_L: +ld.DL_L.toFixed(3), LL_L: +ld.LL_L.toFixed(3), DL_R: +ld.DL_R.toFixed(3), LL_R: +ld.LL_R.toFixed(3) });
  }
  // open the designer on a mark or a column case of the job (the Beam / Column pages' "Try another section")
  function dzOpen(tab, key) { state.dz.tab = tab; if (tab === 'beam') dzLoadBeam(key); else dzLoadCol(key); dzSave(); go('designer'); renderDesigner(); }

  function renderDesigner() {
    const el = $('#dzBody');
    if (!el) return;
    const dz = state.dz;
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
    const wfs = Object.keys(WF).filter(k => /^W(8|10|12|14|16|18|21|24)X/.test(k)).sort((a, c) => WF[a].d - WF[c].d || WF[a].W - WF[c].W);
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
        <div class="dz-group"><h5>Column <small>Column C8, C16</small></h5><div class="dz-cells two">${dzNum('col.L', c.L, 'Length L (ft)')}<label class="dz-f"><span>Section</span>${dzSel('col.wf', c.wf, wfs.map(k => [k, `${k} · ${WF[k].W} plf`]))}</label></div></div>
        <div class="dz-group"><h5>Beam reactions (kip) <small>Column C27–D28 · MB H6 / H10</small></h5><div class="dz-cells">${dzNum('col.DL_L', c.DL_L, 'Left dead')}${dzNum('col.LL_L', c.LL_L, 'Left live')}${dzNum('col.DL_R', c.DL_R, 'Right dead')}${dzNum('col.LL_R', c.LL_R, 'Right live')}</div></div>
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
    const marks = state.job ? jobMarks().filter(m => m.sec) : [];
    const near = dz.near;
    // the clearance C of the mark it would be used for caps the depth: say so on anything deeper
    const um0 = marks.find(m => m.mark === (b.useMark || b.from)) || marks[0], sr0 = um0 && um0.search;
    const cap = sr0 && sr0.dTop < sr0.options.dMax ? sr0.dTop : null;
    const overC = d => (cap != null && d > cap ? `<small class="dz-flag">deeper than ${esc(um0.mark)}'s clearance allows (${cap}")</small>` : '');
    out.innerHTML = `<div class="panel dz-res">
      <div class="dz-res-head"><div><div class="eyebrow">MB sheet · AISC ${esc(b.ed)}th</div><h3 class="nocase">${esc(c.desc)} <small>${f(x.Wt, 1)} plf${sec.type === 'BU' ? ` · ${secParts(sec)}` : ''}</small></h3>${sec.type === 'BU' ? overC(sec.d) : ''}</div>
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
        ${marks.length ? `<label class="dz-use">Use for ${dzSel('beam.useMark', b.useMark || (marks.find(m => m.mark === b.from) || marks[0]).mark, marks.map(m => [m.mark, `${m.mark}${m.kind ? ' · ' + m.kind : ''} (now ${m.desc})`]))}</label><button class="btn-soft" id="dzUse" type="button" ${pass ? '' : 'title="It does not pass — it can still be used, flagged on the Design page"'}>Use this section</button>` : '<span class="sub-n">Load a PCS to use this section for a beam mark.</span>'}
        ${sec.type === 'BU' ? `<button class="btn-ghost" id="dzNear" type="button">Sections that pass, ${Math.max(state.settings.dMin, sec.d - 3)}"–${Math.min(state.settings.dMax, sec.d + 3)}", lightest first</button>` : ''}
      </div>
      ${near ? `<div class="table-wrap"><table class="fl-t dz-near"><thead><tr><th class="num">Depth</th><th>Section</th><th>Web</th><th>Flanges</th><th>Econ.</th><th class="num">plf</th><th class="num">Combined</th><th class="num">Shear</th><th class="num">Live</th><th></th></tr></thead><tbody>${near.length ? near.map((z, i) => `<tr><td class="num mono">${z.d}"</td><td class="mono"><b>${esc(z.desc)}</b>${overC(z.d)}</td><td class="mono">${esc(z.web)}</td><td class="mono">${esc(z.flange)}</td><td>${z.tier}</td><td class="num mono">${f(z.wt, 1)}</td><td class="num mono">${f(z.CSR, 3)}</td><td class="num mono">${f(z.SRv, 3)}</td><td class="num mono">L/${f(z.rLL, 0)}</td><td><button class="btn-ghost dz-take" data-i="${i}" type="button">Load</button></td></tr>`).join('') : '<tr><td colspan="10" class="sub-n">Nothing stocked passes in this depth range.</td></tr>'}</tbody></table></div>` : ''}
      <details class="dz-sheet"><summary>The full MB sheet</summary>${mbSheetBody(c, p, sec, null)}</details>
    </div>`;
    const use = $('#dzUse');
    if (use) use.onclick = () => {
      const mark = $('#dzBody [data-dz="beam.useMark"]').value;
      setOverride(mark, { sec });
      recompute(); toast(`${mark} → ${c.desc}${pass ? '' : ' (does not pass — flagged)'}`);
    };
    const nb = $('#dzNear');
    if (nb) nb.onclick = () => {
      const z = DESIGN.designBeam(p, { division: b.div, target: tgt, dMin: Math.max(state.settings.dMin, sec.d - 3), dMax: Math.min(state.settings.dMax, sec.d + 3), symmetric: state.settings.symmetric, requireConc: state.settings.requireConc, production: state.settings.production !== false });
      dz.near = (z.all || []).filter(e => e.pass).sort((a1, a2) => a1.wt - a2.wt || a1.d - a2.d).slice(0, 8).map(e => ({ ...e, desc: e.r.desc, web: 'W' + String(Math.round(e.sec.tw * 1000)).padStart(3, '0'), flange: DESIGN.flangeName(e.sec.bof, e.sec.tof), tier: DESIGN.TIER[e.tier], CSR: e.r.res.CSR, SRv: e.r.res.SRvx, rLL: e.r.defl.rLL }));
      dzResults();
    };
    $$('#dzBody .dz-take').forEach(btn => { btn.onclick = () => { const z = dz.near[+btn.dataset.i].sec; Object.assign(dz.beam, { type: 'BU', d: z.d, tw: z.tw, bof: z.bof, tof: z.tof, bif: z.bif, tif: z.tif, sym: z.bof === z.bif && z.tof === z.tif, from: '' }); dzSave(); renderDesigner(); }; });
    const um = $('#dzBody [data-dz="beam.useMark"]');
    if (um) um.onchange = () => { dz.beam.useMark = um.value; dzSave(); };
  }
  // the column: the Column sheet's three combinations, and the common sizes beside it
  function dzColResults(out) {
    const cc = state.dz.col;
    const bad = ['L', 'DL_L', 'DL_R'].filter(k => !(+cc[k] >= 0) || cc[k] === '').concat(+cc.L > 0 ? [] : ['L']);
    if (bad.length) { out.innerHTML = `<div class="panel dz-empty">Enter ${[...new Set(bad)].join(', ')}.</div>`; return; }
    const run = name => ENG.columnCheck({ sec: { type: 'WF', name }, Fy: 50, Fu: 65, L: +cc.L, Lby: +cc.L * 12, DL_L: +cc.DL_L, LL_L: +cc.LL_L || 0, DL_R: +cc.DL_R, LL_R: +cc.LL_R || 0, edition: cc.ed }, WF);
    const k = run(cc.wf), w = WF[cc.wf];
    const names = ['DLt+LLt+DRt', 'DLt+DRt+LRt', 'DLt+LLt+DRt+LRt'];
    const common = [...new Set(['W8X18', ...DESIGN.COMMON_COLUMNS, cc.wf])].sort((a, c2) => WF[a].W - WF[c2].W).map(n => ({ n, c: run(n) }));
    const can = state.job && (state.job.mezz || []).some(r => r.colFinal);
    out.innerHTML = `<div class="panel dz-res">
      <div class="dz-res-head"><div><div class="eyebrow">Column sheet · ${esc(cc.ed)}th</div><h3 class="nocase">${esc(cc.wf)} <small>${w.W} plf · d ${f(w.d, 2)}" · bf ${f(w.bf, 2)}" · L ${ft(+cc.L)}</small></h3></div>
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
        <div class="dz-tile ${DESIGN.inStock(DESIGN.WF_STOCK, cc.wf, (state.res && state.res.division) || 'NBS-IN') ? 'ok' : ''}"><span>DM 5.1 stock</span><b>${DESIGN.inStock(DESIGN.WF_STOCK, cc.wf, (state.res && state.res.division) || 'NBS-IN') ? 'stocked' : 'not stocked'}</b></div>
      </div>
      <h5 class="dz-h">The common sizes with these loads</h5>
      <div class="table-wrap"><table class="fl-t"><thead><tr><th>Section</th><th class="num">plf</th><th class="num">Max CSR</th><th>Result</th><th></th></tr></thead><tbody>${common.map(q => `<tr class="${q.n === cc.wf ? 'is-chosen' : ''}"><td class="mono"><b>${q.n}</b></td><td class="num mono">${WF[q.n].W}</td><td class="num mono">${f(q.c.max, 3)}</td><td><span class="status-text ${q.c.ok ? 'ok' : 'ng'}">${q.c.ok ? 'OK' : 'NG'}</span></td><td>${q.n === cc.wf ? '' : `<button class="btn-ghost dz-pick" data-n="${q.n}" type="button">Load</button>`}</td></tr>`).join('')}</tbody></table></div>
      <div class="dz-actions">${can ? `<button class="btn-soft" id="dzUseCol" type="button">Use ${esc(cc.wf)} for the job's mezzanine columns</button>` : '<span class="sub-n">Load a PCS to use this column for the job.</span>'}</div>
    </div>`;
    $$('#dzBody .dz-pick').forEach(btn => { btn.onclick = () => { state.dz.col.wf = btn.dataset.n; dzSave(); renderDesigner(); }; });
    const u = $('#dzUseCol');
    if (u) u.onclick = () => { (state.settings.colPerJob !== false ? allSettings() : [state.settings]).forEach(st => { st.colOverride = cc.wf; }); recompute(); toast(`Mezzanine columns → ${cc.wf}${k.ok ? '' : ' (does not pass — flagged)'}`); };
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
      fieldRow('geom.A', '(A) Finish floor to top of mezzanine', 'ftin'), fieldRow('geom.B', '(B) Min. clearance under joist', 'ftin'), fieldRow('geom.C', '(C) Min. clearance under support beams', 'ftin', state.inputs.geom.C && state.inputs.geom.C.source === 'none' ? 'no requirement (entered)' : 'caps the beam depth: A − C − slab − seat'),
      fieldRow('geom.slab', 'Slab & deck thickness, (in.)', 'in'), fieldRow('geom.seat', 'Joist seat depth, (in.)', 'in'), fieldRow('geom.joistSpacing', 'Joist spacing (= beam Lb)', 'ftin'),
      `<div class="field-row"><label>Total joist depth, (in.)<small>A − B − slab − seat · also the Headroom option's depth limit</small></label><div class="calc">${r.joistDepthIn != null ? f(r.joistDepthIn, 2) + '"' : '—'}</div></div>`,
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
    const last = list.slice(-6).reverse().map(r => `<li><b>${esc(r.quote || r.key)}</b> <span>${esc(r.saved.replace('T', ' '))}</span> ${esc((r.mezz || []).map(m => `${m.id}: ${(m.beams || []).join(', ')}${m.columns ? ' · ' + m.columns : ''}`).join(' | '))}</li>`).join('');
    return `<div class="field-row full jobs-row"><label>${list.length} job${list.length === 1 ? '' : 's'} remembered<small>Saved automatically when a job is fully designed: what you typed for open values, the option you picked, the joist direction and the sections. Your usual values come up first next time. Nothing leaves this computer unless you export it.</small></label>
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
    if (cl) cl.onclick = () => { if (confirm('Forget every remembered job on this computer?')) { histSave([]); lastSaved = ''; renderSettings(); } };
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
      sel('production', 'Production Guidelines', [['true', 'Apply (tw ≤ tf, tw/tf ≥ 0.30, bf ≤ d, d/bf ≤ 7, part limits)'], ['false', 'Off — stock and the MB sheet only']], 'NBG Production Guidelines, built-up, by division'),
      sel('requireConc', 'Joist bearing check (MB L7)', [['true', 'Must pass'], ['false', 'Report only']]),
      sel('marks', 'Beam marks', [['intext', 'Interior / exterior (largest trib of each)'], ['single', 'One governing mark (max span & trib)'], ['split', 'Split by trib / span (guide)']], 'over the whole job · shorter beams keep the section, own MB run'),
      sel('partitionTo', 'Partition load', [['live', 'Add to live'], ['dead', 'Add to dead']]),
      '<div class="group-title">Columns</div>',
      sel('colPerJob', 'Column section', [['true', 'One W for the whole job'], ['false', 'Per mezzanine']], 'several mezzanines: the lightest W that passes every column case'),
      sel('colLength', 'Column length L', [['A', 'Finish floor to top of mezzanine (A)'], ['clear', 'Clear below mezzanine beam (guide)']]),
      sel('includeW818', 'Also try W8X18', [['false', 'No — W10X22, W8X24, W12X26'], ['true', 'Yes (stocked at most divisions)']]),
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
        if (state.all) state.all.forEach(a => { a.settings[k] = v; if (k === 'marks' || k === 'optionDefault') a.settings.override = {}; });
        if (state.inputs) recompute(); else renderSettings();
      };
    });
  }
  renderSettings();
  renderDesigner();
  wbLoadAll().then(() => renderWorkbooks());
})();
