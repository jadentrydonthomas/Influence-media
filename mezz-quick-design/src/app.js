/* Mezzanine Quick-Design — browser UI (Astra skin). */
(function () {
  'use strict';
  const PCS = window.MZ_PCS, RUN = window.MZ_RUN, EX = window.MZ_EXTRACT, DESIGN = window.MZ_DESIGN, WF = window.MZ_WF, PLAN = window.MZ_PLAN, M3 = window.MZ_3D, LAYOUT = window.MZ_LAYOUT;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ft = x => PCS.fmtFtIn(x);
  const f = (x, d = 3) => (x == null || !isFinite(x) ? '—' : (+x).toFixed(d));
  const n0 = x => (x == null || !isFinite(x) ? '—' : Math.round(x).toLocaleString('en-US'));
  const MARK_COLORS = ['var(--mark-1)', 'var(--mark-2)', 'var(--mark-3)', 'var(--mark-4)'];
  const edLabel = ed => ({ 13: 'AISC 13th', 15: 'AISC 15th', 16: 'AISC 16th' })[ed] || ed;
  const sameSec = (a, b) => a && b && a.d === b.d && a.tw === b.tw && a.bof === b.bof && a.tof === b.tof && a.bif === b.bif && a.tif === b.tif;
  const pct = v => Math.max(0, Math.min(100, v * 100));

  // all: one { inputs, settings } per mezzanine of the job — they are designed together (shared beams / columns);
  // inputs / settings / res are the mezzanine on screen
  const state = { pages: null, pcs: null, mi: 0, all: null, job: null, inputs: null, settings: { ...RUN.SETTINGS }, res: null, view: 'upload', mark: 0, colGroup: 0, planPaths: null, planReg: null, planKey: null, planPage: null };

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
        if (paths.length > 2000) { state.planPaths = paths; state.planPage = p.num; break; }
      }
      prog(0.85);
      const pcs = PCS.parse(pages);
      if (!pcs.mezzanines.length) throw new Error('No "22) MEZZANINES" box with a Mezzanine ID was found in this PDF.');
      state.pages = pages; state.pcs = pcs; state.mi = 0; state.planKey = null;
      readPlan(pcs.building || {}, pcs.frames);                // grid letters + joist arrows off the drawing
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
    ['target', 'dMin', 'dMax', 'symmetric', 'requireConc', 'marks', 'colLength', 'includeW818', 'partitionTo', 'division', 'edition', 'optionDefault'].forEach(k => { keep[k] = s[k]; });
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
    state.mi = i; state.inputs = state.all[i].inputs; state.settings = state.all[i].settings; state.mark = 0; state.colGroup = 0;
    recompute();
  }
  function renderMezzTabs() {
    const nav = $('#mezzTabs'), many = state.all && state.all.length > 1 && state.job;
    nav.hidden = !many;
    if (!many) { nav.innerHTML = ''; return; }
    nav.innerHTML = `<span class="mt-title">${state.all.length} mezzanines<small>designed together</small></span>` + state.job.mezz.map((m, i) => {
      const g = state.all[i].inputs.geom, size = `${ft(g.width.value)} × ${ft(g.length.value)}`;
      const beams = m.incomplete ? '' : m.marks.map(mk => `${esc(mk.desc || '—')} × ${mk.qty}`).join(' · ');
      const cols = m.incomplete ? '' : m.colFinal ? `${esc(m.colFinal.quoteAs)} × ${m.columns.length}` : (m.columns.length ? 'no column' : 'no columns');
      const st = m.incomplete ? `<em class="mt-need">needs ${m.need.length} input${m.need.length > 1 ? 's' : ''}</em>` : m.warn.some(w => w.level === 'stop') ? '<em class="mt-check">check notes</em>' : '<em class="mt-ok">designed</em>';
      return `<button class="mt ${i === state.mi ? 'is-on' : ''}" data-mi="${i}" aria-pressed="${i === state.mi}"><span class="mt-name">${esc(m.id)}</span><span class="mt-size">${size}</span>${st}<span class="mt-sec">${beams || '—'}${cols ? '<br>' + cols : ''}</span></button>`;
    }).join('');
    $$('#mezzTabs .mt').forEach(b => { b.onclick = () => switchMezz(+b.dataset.mi); });
  }

  // ---------- floor plan ----------
  // Register the drawing to the building grid once per grid: letters as drawn, ⊗ / circled-I columns, joist arrows
  function readPlan(b, frames) {
    if (!state.planPaths || !b || !(b.width > 0)) return;
    const g = LAYOUT.buildingGrid({ width: b.width, length: b.length, bays: b.bays, lewCols: b.lewCols, rewCols: b.rewCols, ridge: b.ridge, frames: frames || b.frames || [] });
    const colY = [...new Set([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()].map(v => +v.toFixed(3)))];
    const key = g.xs.join(',') + '|' + colY.join(',');
    if (state.planKey === key) return;
    state.planKey = key;
    state.planReg = PLAN.registerAndRead(state.planPaths, { xs: g.xs, colY, lewY: g.lewY, rewY: g.rewY, width: g.width, letterLines: g.allY });
    if (state.pcs) RUN.applyPlan(state.pcs, state.planReg);
    const letters = state.planReg.ok ? state.planReg.letters : undefined;
    (state.all || []).forEach(a => { a.inputs.building.yLetters = letters; });
  }

  // ---------- compute ----------
  function recompute() {
    if (!state.inputs) return;
    if (state.all) { state.all[state.mi] = { inputs: state.inputs, settings: state.settings }; readPlan(state.inputs.building); }
    const items = (state.all || [{ inputs: state.inputs, settings: state.settings }]).map(a => ({ inp: a.inputs, settings: a.settings }));
    try { state.job = RUN.runJob(items); state.res = state.job.mezz[state.all ? state.mi : 0]; } catch (err) { console.error(err); status('Design error: ' + err.message, 'bad'); return; }
    planCheck();
    if (state.mark >= state.res.marks.length) state.mark = 0;
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
    const g = r.grid;
    const lab = c => { const nx = nearest(g.xs, c.x), ly = (g.allY || []).concat((reg.letters || []).map(l => l.y)), ny = nearest(ly, c.y);
      return (Math.abs(nx - c.x) < 0.6 ? g.xLabel(nx) : ft(c.x)) + '/' + (Math.abs(ny - c.y) < 0.6 && g.yLabel(ny) ? g.yLabel(ny) : ft(c.y)); };
    const jobCols = state.job.columns;
    const cmp = PLAN.compare(reg.columns, jobCols);
    const labels = cmp.matched.concat(cmp.extra.map(lab)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    r.planCheck = { ok: true, cols: reg.columns, labels, ...cmp };
    const many = state.job.mezz.length > 1;
    const per = many ? ' (' + state.job.mezz.filter(m => !m.incomplete).map(m => `${m.id} ${m.columns.length}`).join(', ') + ')' : '';
    const sym = reg.columns.some(c => c.kind === 'i') ? 'circled-I' : '⊗';
    if (!reg.columns.length) r.warn.push({ level: 'info', text: `Floor plan (page ${state.planPage}): no mezzanine column symbols found on the drawing — confirm the columns by eye.` });
    else if (cmp.agree) r.warn.unshift({ level: 'ok', text: `Floor plan check: the drawing shows ${labels.length} ${sym} mezzanine column${labels.length === 1 ? '' : 's'} at ${labels.join(', ')} — matches ${many ? 'the mezzanines\u2019' : 'this'} layout${per}.` });
    else {
      const others = jobCols.filter(q => q.owner !== r.index);
      const alt = r.layout.alt ? PLAN.compare(reg.columns, others.concat(r.layout.alt.mezzCols)) : null;
      r.warn.unshift({ level: 'stop', text: `Floor plan check: the drawing shows ${sym} columns at ${labels.join(', ') || 'none'}; the layout has ${jobCols.map(c => c.label).sort().join(', ') || 'none'}.` +
        (alt && alt.agree ? ' The other joist direction matches the drawing — switch it on the Plan page.' : ' Adjust the beam / support lines on the Plan page to match the drawing.') });
    }
    if (r.layout.why && /arrows/.test(r.layout.why)) r.warn.unshift({ level: 'ok', text: `Joists span ${r.layout.joists === 'y' ? 'across the width' : 'along the length'}, read from the "Mez. Jst." arrows on the PCS floor plan.` });
  }

  // job-level figures used across views
  function totals() {
    const r = state.res;
    const beams = r.marks.reduce((a, mk) => a + (mk.check ? mk.qty * mk.span * mk.check.res.Wt : 0), 0);
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

  function renderAll() { renderRail(); renderResults(); renderPlan(); renderBeam(); renderColumn(); renderInputs(); renderSettings(); }

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
    $('#rsLabel').textContent = [inp.job.quote || 'Manual entry', many ? `${state.all.length} mezzanines` : inp.mezz.id ? `“${inp.mezz.id}”` : ''].filter(Boolean).join(' · ');
    if (r.incomplete) { $('#rsSub').textContent = 'Needs input — see Design'; return; }
    $('#rsSub').textContent = many ? `${esc(inp.mezz.id)} · ${t.nB} beams · ${t.nC} columns` : `${t.nB} beams · ${t.nC} columns`;
    $('#navPlanCount').hidden = false;
    $('#navPlanCount').textContent = `${t.nB}·${t.nC}`;
  }

  // ---------- design (results) ----------
  const chip = (lab, val, ok) => `<span class="chip ${ok === true ? 'ok' : ok === false ? 'bad' : ''}"><b>${lab}</b>${val}</span>`;
  function secParts(sec) {
    if (!sec) return '';
    const fl = DESIGN.flangeName(sec.bof, sec.tof), fi = DESIGN.flangeName(sec.bif, sec.tif);
    return `${sec.d}" · web ${sec.tw}" · ${fl === fi ? fl + ' (' + sec.bof + ' × ' + sec.tof + ')' : 'OF ' + fl + ' / IF ' + fi}`;
  }
  // MB sheet: floor dead / live load (unfactored) — shear at left / right, kips: the beam end loads that go to the frame
  function floorCard(r) {
    const mks = r.marks.filter(mk => mk.check);
    const rows = mks.map(mk => `<span class="fl-row"><b>${mk.mark}</b><span>D ${f(mk.check.V.D, 2)}</span><span>L ${f(mk.check.V.L, 2)}</span></span>`).join('');
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
        mezz: state.job.mezz.map((m, i) => ({ id: m.id, entered: entered(state.all[i].inputs), joists: m.layout.joists, joistsFrom: /arrows/.test(m.layout.why || '') ? 'drawing' : (state.all[i].settings.joists || 'auto'),
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
    return grp(['stop', 'warn'], 'Check before quoting') + grp(['ok'], 'Confirmed against the PCS') + grp(['key'], 'Design decisions') + grp(['info'], 'How it was read', false);
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
      const anyDone = state.all && state.all.length > 1 && state.job.mezz.some(m => !m.incomplete);
      $('#qsHead').hidden = !anyDone;
      if (anyDone) renderQuoteSheet(); else $('#quoteSheet').innerHTML = '';
      return;
    }
    const t = totals(), cf = r.colFinal, mk0 = r.marks[0];
    const beamsTxt = r.quote.beams.map(b => b.section || 'no beam').join(' / ');
    $('#resTitle').innerHTML = `Mezzanine “${esc(inp.mezz.id || '—')}”<br><em class="nocase">${esc(beamsTxt)}${cf ? ' · ' + esc(cf.quoteAs) : ''}</em>`;

    // metric ring cards
    const c0 = mk0 && mk0.check;
    $('#metrics').innerHTML = [
      ringCard('Mezzanine beams', `<span data-count="${t.nB}">${t.nB}</span>`, `${esc(beamsTxt)} · ${r.marks.map(m => ft(m.span)).join(' / ')} span`, t.govBeam ? t.govBeam.v : null),
      ringCard('Mezzanine columns', `<span data-count="${t.nC}">${t.nC}</span>`, (cf ? `${esc(cf.quoteAs)} · ${ft(r.colLen)} · CSR ${f(cf.max, 3)}` : 'every beam end lands on a building column') + ((r.foreignCols || []).length ? ` · + ${r.foreignCols.map(c => `${c.label} with ${esc(c.ownerId)}`).join(', ')}` : ''), cf ? cf.max : null),
      floorCard(r),
      ringCard('Mezzanine steel', `<span data-count="${Math.round(t.total)}" data-fmt="lb">${n0(t.total)} lb</span>`, `beams ${n0(t.beams)} · columns ${n0(t.cols)} · end plates ${n0(t.plates)}`, t.total ? t.beams / t.total : null, 'var(--steel)'),
    ].join('');
    $('#needSlot').innerHTML = card;
    $('#warnings').innerHTML = notesHtml(r.warn, !!card);
    wireNeed();
    $('#modelSec').hidden = false; $('#optHead').hidden = false; $('#qsHead').hidden = false;
    const nCheck = r.warn.filter(w => w.level === 'stop' || w.level === 'warn').length;
    $('#checkPill').hidden = !nCheck;
    $('#checkPill').textContent = `${nCheck} to check before quoting ↓`;
    $('#checkPill').className = 'check-pill ' + (r.warn.some(w => w.level === 'stop') ? 'stop' : 'warn');

    // hero field: beams -> governing ratio -> columns + plan check
    const others = r.marks.slice(1).map(m => `${m.mark} ${esc(m.desc || '—')} × ${m.qty}`).join(' · ');
    const pc = r.planCheck;
    const gv = t.gov ? t.gov.v : 0;
    $('#field').innerHTML = `
      <div class="field-head"><div><div class="eyebrow">Framing summary</div><h3>Floor load → beams → columns</h3></div>
        <p>The governing ratio across every beam and column check, with the quantities read from the layout and cross-checked against the floor plan.</p></div>
      <div class="field-stage"><div class="atlas">
        <div class="fcard"><div class="step">01 / Mezzanine beams</div><h4>${mk0 ? mk0.mark : '—'} · ${mk0 ? mk0.qty : 0} beam${mk0 && mk0.qty === 1 ? '' : 's'}${mk0 && mk0.optionKey && mk0.optionKey !== 'lightest' ? ' · ' + mk0.optionKey.replace('fit', 'best fit') : ''}</h4>
          <span class="big nocase">${esc(mk0 && mk0.desc ? mk0.desc : '—')}</span><div class="sub">${secParts(mk0 && mk0.sec)}</div>
          <div class="ffacts"><div><span>Quantity</span><b class="qty">${mk0 ? mk0.qty : 0}</b></div><div><span>Span</span><b>${mk0 ? ft(mk0.span) : '—'}</b></div><div><span>Trib</span><b>${mk0 ? ft(mk0.trib) : '—'}</b></div></div>
          ${others ? `<div class="sub" style="margin-top:12px">${others}</div>` : ''}</div>
        <div class="disc-wrap"><div class="step">Governing ratio</div><div class="orbit"></div>
          <div class="disc" data-ring="${pct(gv).toFixed(1)}" style="--ring:0;--disc-a:${gv <= s.target ? '#64ffd0' : gv <= 1 ? '#ffd27a' : '#ff9d7a'}"><div class="disc-inner"><span>Max ratio</span><strong data-count="${gv}" data-fmt="sr">${f(gv, 2)}</strong><b>${esc(t.gov ? t.gov.who : '')}</b></div></div>
          <div class="disc-caption">Beams ≤ ${s.target} with L/360 live and L/240 total; columns &lt; 1.00 on all three combinations.</div>
          <div class="disc-proof">${c0 ? `combined <b>${f(c0.res.CSR, 3)}</b> · shear <b>${f(c0.res.SRvx, 3)}</b>` : ''}${cf ? ` · column <b>${f(cf.max, 3)}</b>` : ''}</div></div>
        <div class="tallies">
          <div class="tally"><div class="step">02 / Mezzanine columns</div><div class="tally-row"><div><h4 class="nocase">${cf ? esc(cf.quoteAs) : 'None needed'}</h4><p>${cf ? `${ft(r.colLen)} · ${r.colGroups.length} load case${r.colGroups.length > 1 ? 's' : ''}` : 'beams frame into building columns'}</p></div><div><strong>${t.nC}</strong><small>${cf ? 'CSR ' + f(cf.max, 3) : ''}</small></div></div></div>
          <div class="tally ${pc && pc.ok && pc.agree ? '' : 'warn'}"><div class="step">03 / Floor plan check</div><div class="tally-row"><div><h4>${pc ? (pc.ok ? (pc.agree ? 'Matches the drawing' : 'Differs from the drawing') : 'Not read') : 'No floor plan'}</h4><p>${pc && pc.ok ? '⊗ at ' + esc(pc.labels.join(', ')) : pc ? esc(pc.reason) : 'confirm the layout by eye'}</p></div><div><strong>${pc && pc.ok ? pc.matched.length + '/' + pc.labels.length : '—'}</strong><small>${pc && pc.ok ? 'columns found' : ''}</small></div></div></div>
        </div></div>
        <div class="field-foot"><b>Field readout</b><span>Joists @ ${ft(r.beamBase.Lb)} span ${ft(r.layout.joistSpan)} ${r.layout.joists === 'y' ? 'across the width' : 'along the length'} onto ${r.layout.beamLines.length} beam lines; ${t.nB} beams frame into ${t.nC} mezzanine column${t.nC === 1 ? '' : 's'} and the building columns.</span></div>
      </div>`;

    renderOptions();
    renderQuoteSheet();
    renderModel();
    animateIn();

    // readout
    const fit = mk0 && mk0.options.find(o => o.key === 'fit');
    $('#readout').innerHTML = `<div class="eyebrow">What the design establishes</div>
      <p><em>${t.nB}</em> ${esc(beamsTxt)} beam${t.nB === 1 ? '' : 's'} at <em>${mk0 ? ft(mk0.span) : '—'}</em> carry <em>${mk0 ? ft(mk0.trib) : '—'}</em> of floor into <em>${t.nC}</em> ${cf ? esc(cf.quoteAs) : ''} column${t.nC === 1 ? '' : 's'} <em>${ft(r.colLen)}</em> tall — governing ratio <em>${f(gv, 2)}</em>${c0 ? `, live-load deflection <em>L/${f(c0.defl.rLL, 0)}</em>` : ''}.</p>
      <div class="readout-facts"><span><b>${mk0 && mk0.check ? f(mk0.check.res.Wt, 1) : '—'}</b>plf beam</span>${fit ? `<span><b>+${f(fit.dPct * 100, 1)}%</b>for ${mk0.sec ? mk0.sec.d - fit.pick.d : 0}" less depth (${esc(fit.pick.desc)})</span>` : ''}<span><b>${n0(t.total)}</b>lb mezzanine steel</span><span><b>${r.joistDepthIn != null ? f(r.joistDepthIn, 0) + '"' : '—'}</b>total joist depth</span><span><b>${edLabel(r.edition.beamEd || r.edition.ed)}</b>ASD sheets</span></div>`;
  }

  function renderOptions() {
    const r = state.res, inp = state.inputs;
    const A = inp.geom.A.value, slabIn = (inp.geom.slab.value || 0) * 12, seatIn = (inp.geom.seat.value || 0) * 12;
    const uo = usualOption(), uoLab = uo && { lightest: 'Lightest', fit: 'Best fit', headroom: 'Headroom' }[uo.key];
    $('#optSub').textContent = (r.marks[0] && r.marks[0].search ? `${r.marks[0].search.evaluated.toLocaleString()} stocked combinations checked per mark · pick one for the quote` : '') + (uo ? ` · you usually quote ${uoLab} (${uo.n} of ${uo.tot})` : '');
    $('#options').innerHTML = r.marks.map(mk => {
      if (!mk.options || !mk.options.length) return `<div class="mark-block"><p class="mark-label"><b>${mk.mark}</b> — no passing section in the depth range.</p></div>`;
      return `<div class="mark-block"><p class="mark-label"><b>${mk.mark}</b> · ${mk.qty} beam${mk.qty > 1 ? 's' : ''} · ${ft(mk.span)} span × ${ft(mk.trib)} trib</p><div class="options">${mk.options.map(o => {
        const p = o.pick, chosen = sameSec(p.sec, mk.sec);
        const under = A != null ? A - (slabIn + seatIn + p.sec.d) / 12 : null;
        const dLbs = o.dWt * mk.qty * mk.span;
        return `<article class="option ${chosen ? 'is-chosen' : ''}">
          <div class="option-top"><span class="option-tag">${o.label}</span><span class="option-delta ${o.dWt ? '' : 'zero'}">${o.dWt ? `+${f(o.dPct * 100, 1)}% · +${n0(dLbs)} lb` : 'lightest'}</span></div>
          <div class="option-sec nocase">${esc(p.desc)}</div><div class="option-parts">${secParts(p.sec)} · ${p.tier}</div>
          <p class="option-why">${esc(o.why)}</p>
          <div class="option-grid">
            <div><span>Weight</span><b>${f(p.wt, 1)} plf</b></div><div><span>Depth</span><b>${p.sec.d}"</b></div><div><span>Under beam</span><b>${under != null ? ft(under) : '—'}</b></div>
            <div><span>Combined</span><b class="${p.CSR <= state.settings.target ? 'ok' : 'bad'}">${f(p.CSR, 3)}</b></div><div><span>Shear</span><b class="${p.SRv <= state.settings.target ? 'ok' : 'bad'}">${f(p.SRv, 3)}</b></div><div><span>Live defl.</span><b class="ok">L/${f(p.rLL, 0)}</b></div>
          </div>
          <div class="option-actions">${chosen ? '<span class="chosen-pill">In the quote</span>' : `<button class="btn-soft" data-opt="${o.key}" data-mark="${mk.mark}">Use this option</button>`}<button class="btn-ghost" data-go="beam">Calc</button></div>
        </article>`;
      }).join('')}</div></div>`;
    }).join('');
    $$('#options [data-opt]').forEach(b => { b.onclick = () => pickOption(b.dataset.mark, b.dataset.opt); });
  }
  function pickOption(mark, key) {
    const mk = state.res.marks.find(m => m.mark === mark), o = mk.options.find(x => x.key === key);
    state.settings.override = { ...(state.settings.override || {}) };
    state.settings.override[mark] = { key };
    recompute(); toast(`${mark} → ${o.pick.desc} (${o.label.toLowerCase()})`);
  }
  function pickDepth(mark, d) {
    const mk = state.res.marks.find(m => m.mark === mark), a = mk.search.byDepth.find(z => String(z.d) === String(d));
    state.settings.override = { ...(state.settings.override || {}) };
    state.settings.override[mark] = { d: +d };
    recompute(); toast(`${mark} → ${a.desc} (lightest at ${d}")`);
  }

  // ---------- 3D framing model ----------
  const HEX = ['#42e5ae', '#67bdf4', '#f6c779', '#c9a2ff'];
  let model = null;
  function buildScene() {
    const r = state.res, inp = state.inputs, lay = r.layout, g = r.grid, fp = lay.footprint;
    const A = inp.geom.A.value ?? 12, slab = (inp.geom.slab.value || 4 / 12), seat = (inp.geom.seat.value || 2.5 / 12);
    const zDeck = A - slab, zTop = zDeck - seat, J = r.joistDepthIn != null && r.joistDepthIn > 0 ? r.joistDepthIn / 12 : 1.33;
    const alongX = lay.joists === 'y';
    const members = [], labels = [], floor = [];
    const markOf = id => r.marks.find(mk => mk.beams.includes(id));
    const markIdx = id => r.marks.findIndex(mk => mk.beams.includes(id));
    const colNo = new Map(lay.mezzCols.slice().sort((a, b) => a.x - b.x || b.y - a.y).map((c, i) => [c.label, i + 1]));
    // beams: I-shapes (top flange, web, bottom flange) — web drawn at least 0.9" so it reads
    lay.beams.forEach(b => {
      const mk = markOf(b.id), sec = mk && mk.sec;
      if (!sec) return;
      const d = sec.d / 12, bf = sec.bof / 12, tf = sec.tof / 12, bi = sec.bif / 12, ti = sec.tif / 12, tw = Math.max(sec.tw, 0.9) / 12;
      const box = (a0, a1, w, z0, z1) => (alongX ? { x0: a0, x1: a1, y0: b.line - w / 2, y1: b.line + w / 2, z0, z1 } : { x0: b.line - w / 2, x1: b.line + w / 2, y0: a0, y1: a1, z0, z1 });
      members.push({ id: 'B' + (b.id + 1), kind: 'beam', color: HEX[markIdx(b.id) % 4], boxes: [box(b.from, b.to, bf, zTop - tf, zTop), box(b.from, b.to, tw, zTop - d + ti, zTop - tf), box(b.from, b.to, bi, zTop - d, zTop - d + ti)], ref: { type: 'beam', b, mk } });
    });
    // mezzanine columns: W shape, web parallel to the beam web, from the floor to the underside of the beam
    const cf = r.colFinal, w = cf ? WF[cf.name] : null, dBeam = Math.max(0, ...r.marks.filter(m => m.sec).map(m => m.sec.d)) / 12;
    lay.mezzCols.forEach(c => {
      const cd = (w ? w.d : 10) / 12, cb = (w ? w.bf : 6) / 12, ctf = Math.max(w ? w.tf : 0.4, 0.5) / 12, ctw = Math.max(w ? w.tw : 0.25, 0.9) / 12, zc = zTop - dBeam;
      const bx = (dx0, dx1, dy0, dy1, z0, z1) => (alongX ? { x0: c.x + dx0, x1: c.x + dx1, y0: c.y + dy0, y1: c.y + dy1, z0, z1 } : { x0: c.x + dy0, x1: c.x + dy1, y0: c.y + dx0, y1: c.y + dx1, z0, z1 });
      members.push({ id: 'C' + colNo.get(c.label), kind: 'col', color: '#ff9f7a', boxes: [
        bx(-cd / 2, -cd / 2 + ctf, -cb / 2, cb / 2, 0, zc), bx(cd / 2 - ctf, cd / 2, -cb / 2, cb / 2, 0, zc), bx(-cd / 2 + ctf, cd / 2 - ctf, -ctw / 2, ctw / 2, 0, zc),
        bx(-cd / 2 - 0.12, cd / 2 + 0.12, -cb / 2 - 0.12, cb / 2 + 0.12, zc - 0.06, zc), bx(-cd / 2 - 0.25, cd / 2 + 0.25, -cb / 2 - 0.25, cb / 2 + 0.25, 0, 0.07),
      ], ref: { type: 'col', c, no: colNo.get(c.label) } });
    });
    (r.foreignCols || []).forEach(c => members.push({ id: 'S ' + c.label, kind: 'col', color: '#f6c779', boxes: [{ x0: c.x - 0.35, x1: c.x + 0.35, y0: c.y - 0.35, y1: c.y + 0.35, z0: 0, z1: zTop - dBeam }], ref: { type: 'foreign', c } }));
    // building columns the beams frame into (stubs to just above the mezzanine)
    lay.supports.filter(sp => sp.building).forEach(sp => members.push({ id: 'BC ' + sp.label, kind: 'bcol', color: '#6f89a3', boxes: [{ x0: sp.x - 0.33, x1: sp.x + 0.33, y0: sp.y - 0.33, y1: sp.y + 0.33, z0: 0, z1: A + 2.5 }], ref: { type: 'bcol', sp } }));
    // joists: open-web lines between beam lines at the joist spacing
    const sp = r.beamBase.Lb;
    if (sp > 0) {
      const a0 = alongX ? fp.x0 : fp.y0, a1 = alongX ? fp.x1 : fp.y1;
      let k = 0;
      for (let a = a0; a <= a1 + 1e-6; a += sp) {
        lay.beamLines.slice(1).forEach((l1, i) => {
          const l0 = lay.beamLines[i], lines = [], P = (t, z) => (alongX ? [a, t, z] : [t, a, z]);
          const b0 = l0 + 0.5, b1 = l1 - 0.5;
          lines.push([P(l0, zDeck), P(l1, zDeck)], [P(b0, zDeck - J), P(b1, zDeck - J)]);
          const n = Math.max(2, Math.round((b1 - b0) / 2.2));
          for (let q = 0; q < n; q++) { const t0 = b0 + (b1 - b0) * q / n, t1 = b0 + (b1 - b0) * (q + 0.5) / n, t2 = b0 + (b1 - b0) * (q + 1) / n; lines.push([P(t0, zDeck - J), P(t1, zDeck)], [P(t1, zDeck), P(t2, zDeck - J)]); }
          lines.push([P(l0, zDeck), P(b0, zDeck - J)], [P(l1, zDeck), P(b1, zDeck - J)]);
          members.push({ id: 'J' + (++k), kind: 'joist', color: '#a9cbe0', alpha: 0.55, width: 1, lines, ref: { type: 'joist' } });
        });
      }
    }
    // slab (translucent)
    members.push({ id: 'slab', kind: 'slab', color: '#8fd3ff', alpha: 0.09, boxes: [{ x0: fp.x0, x1: fp.x1, y0: fp.y0, y1: fp.y1, z0: zDeck, z1: A }] });
    // the other mezzanines of the job, in muted steel (their beams on a shared line carry this one's edge)
    const others = (state.job ? state.job.mezz : []).filter(o => o !== r && !o.incomplete && o.grid.length === g.length && o.grid.width === g.width);
    others.forEach(o => {
      const oi = state.all && state.all[o.index] ? state.all[o.index].inputs : null;
      const oA = oi ? oi.geom.A.value ?? A : A, oDeck = oA - (oi ? oi.geom.slab.value || slab : slab), oTop = oDeck - (oi ? oi.geom.seat.value || seat : seat), f2 = o.layout.footprint;
      o.layout.beams.filter(b => !b.absorbed).forEach(b => {
        const mk = o.marks.find(m => m.beams.includes(b.id)), d = mk && mk.sec ? mk.sec.d / 12 : 2, bf = mk && mk.sec ? mk.sec.bof / 12 : 0.5;
        const box = b.dir === 'x' ? { x0: b.from, x1: b.to, y0: b.line - bf / 2, y1: b.line + bf / 2, z0: oTop - d, z1: oTop } : { x0: b.line - bf / 2, x1: b.line + bf / 2, y0: b.from, y1: b.to, z0: oTop - d, z1: oTop };
        members.push({ id: `${o.id} B${b.id + 1}`, kind: 'other', color: '#7d93a8', boxes: [box], ref: { type: 'other', o, b, mk } });
      });
      o.columns.forEach(c => members.push({ id: `${o.id} ${c.label}`, kind: 'other', color: '#8c7f78', boxes: [{ x0: c.x - 0.3, x1: c.x + 0.3, y0: c.y - 0.3, y1: c.y + 0.3, z0: 0, z1: oTop - 2 }], ref: { type: 'otherCol', o, c } }));
      members.push({ id: `${o.id} slab`, kind: 'slab', color: '#b8c7d6', alpha: 0.06, boxes: [{ x0: f2.x0, x1: f2.x1, y0: f2.y0, y1: f2.y1, z0: oDeck, z1: oA }] });
    });
    // floor: grid lines + footprint + bubbles
    const u = { x0: Math.min(fp.x0, ...others.map(o => o.layout.footprint.x0)), x1: Math.max(fp.x1, ...others.map(o => o.layout.footprint.x1)), y0: Math.min(fp.y0, ...others.map(o => o.layout.footprint.y0)), y1: Math.max(fp.y1, ...others.map(o => o.layout.footprint.y1)) };
    const pad = 6, xLo = u.x0 - pad, xHi = u.x1 + pad, yLo = u.y0 - pad, yHi = u.y1 + pad;
    g.xs.filter(x => x >= xLo - 1e-6 && x <= xHi + 1e-6).forEach(x => { floor.push([[x, yLo, 0], [x, yHi, 0], 'rgba(140,200,235,.22)', true]); labels.push({ p: [x, yLo - 2.2, 0], text: g.xLabel(x), kind: 'bubble' }); });
    const colY = [...new Set([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()])];
    colY.filter(y => y >= yLo - 1e-6 && y <= yHi + 1e-6).forEach(y => { floor.push([[xLo, y, 0], [xHi, y, 0], 'rgba(140,200,235,.22)', true]); labels.push({ p: [xLo - 2.2, y, 0], text: g.yLabel(y), kind: 'bubble' }); });
    [[fp.x0, fp.y0], [fp.x1, fp.y0], [fp.x1, fp.y1], [fp.x0, fp.y1]].forEach((p, i, arr) => { const q = arr[(i + 1) % 4]; floor.push([[p[0], p[1], 0], [q[0], q[1], 0], 'rgba(105,250,197,.45)', false]); });
    labels.push({ p: [fp.x1, fp.y0, A], text: `T/slab ${ft(A)}`, kind: 'text', color: '#9fe9cf', dy: -8 });
    labels.push({ p: [fp.x1, fp.y0, zTop], text: `T/beam ${ft(zTop)}`, kind: 'text', color: '#8fc0dc', dy: 8 });
    const Z = A + 2.5;
    const box = { x0: xLo - 3.4, x1: xHi, y0: yLo - 3.4, y1: yHi, z0: 0, z1: Z };   // bubbles sit 2.2' outside the grid ends
    return { center: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, Z / 2], radius: Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2, box, members, labels, floor };
  }
  // the sidebar orb: the same scene, small, turning; click it to jump to the framing model
  let mini = null;
  function renderMini(scene) {
    const cv = $('#miniModel');
    if (!cv || !M3) return;
    $('#orbEmpty').hidden = !!scene;
    cv.style.visibility = scene ? 'visible' : 'hidden';
    if (!scene) return;
    if (!mini) {
      mini = M3.mount(cv, { pad: [6, 6], min: [60, 60], speed: 0.00035, fitScale: 1.3, onSelect: () => { go('results'); setTimeout(() => $('#modelSec').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); } });
      mini.toggle('joists', false);
    }
    mini.set({ ...scene, labels: [], floor: (scene.floor || []).filter(g => !g[3]) });
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
    const r = state.res, t = totals();
    $('#modelTitle').textContent = `${t.nB} beams · ${t.nC} columns · ${state.scene.members.filter(m => m.kind === 'joist').length} joist runs`;
    $('#modelCount').textContent = `${ft(r.layout.footprint.x1 - r.layout.footprint.x0)} × ${ft(r.layout.footprint.y1 - r.layout.footprint.y0)} · T/slab ${ft(state.inputs.geom.A.value)}`;
    $('#modelKey').innerHTML = r.marks.map((mk, i) => `<span><i style="background:${HEX[i % 4]}"></i>${mk.mark} ${esc(mk.desc || '')} × ${mk.qty}</span>`).join('') +
      `<span><i style="background:#ff9f7a"></i>Mezzanine column ${r.colFinal ? esc(r.colFinal.quoteAs) : ''} × ${r.columns.length}</span><span><i style="background:#6f89a3"></i>Building column</span><span><i style="background:#a9cbe0"></i>Joists @ ${ft(r.beamBase.Lb)}</span><span><i style="background:#8fd3ff55;border:1px solid #8fd3ff"></i>Slab ${f((state.inputs.geom.slab.value || 0) * 12, 1)}"</span>`;
    model.pinned = null;
    showMember(null);
  }
  function showMember(id, hover) {
    const r = state.res, m = id && state.scene ? state.scene.members.find(x => x.id === id) : null;
    if (!hover && model) model.pinned = id || null;
    const card = $('#modelCard');
    if (!m || !m.ref || m.ref.type === 'joist') {
      if (hover && model && model.pinned) return;
      const mk = r.marks[0], c = mk && mk.check;
      card.innerHTML = `<div class="eyebrow">Selected member</div><h4>${esc(state.inputs.mezz.id || 'Mezzanine')}</h4><div class="kind">Mezzanine · click a beam or column</div>
        <div class="sec nocase">${esc(r.quote.beams.map(b => b.section).join(' / '))}</div>
        <dl><div><dt>Beams</dt><dd>${totals().nB}</dd></div><div><dt>Columns</dt><dd>${r.columns.length}</dd></div><div><dt>Span</dt><dd>${mk ? ft(mk.span) : '—'}</dd></div><div><dt>Trib</dt><dd>${mk ? ft(mk.trib) : '—'}</dd></div>
        <div><dt>Combined</dt><dd>${c ? f(c.res.CSR, 3) : '—'}</dd></div><div><dt>Live defl.</dt><dd>${c ? 'L/' + f(c.defl.rLL, 0) : '—'}</dd></div></dl>
        <div class="foot">Joists bear on the beams at ${ft(r.beamBase.Lb)}; beams frame into the ⊗ mezzanine columns and the building columns.</div>`;
      return;
    }
    const ref = m.ref;
    if (ref.type === 'beam') {
      const b = ref.b, mk = ref.mk, c = mk.check, rx = mk.sec ? RUN && DESIGN.reactions({ ...r.beamBase, L: b.span, trib: b.trib }, mk.sec) : null;
      const g = r.grid, lay = r.layout, lab = (lay.joists === 'y' ? g.yLabel(b.line) : g.xLabel(b.line)) || ft(b.line), fl = lay.joists === 'y' ? g.xLabel : g.yLabel;
      card.innerHTML = `<div class="eyebrow">${hover ? 'Member' : 'Selected member'}</div><h4>${m.id} · ${mk.mark}</h4><div class="kind">Beam on line ${esc(lab)} · ${esc(fl(b.from) || ft(b.from))} → ${esc(fl(b.to) || ft(b.to))}</div>
        <div class="sec nocase">${esc(mk.desc)}</div>
        <dl><div><dt>Span</dt><dd>${ft(b.span)}</dd></div><div><dt>Trib</dt><dd>${ft(b.trib)}</dd></div>
        <div><dt>R dead</dt><dd>${rx ? f(rx.D, 2) + 'k' : '—'}</dd></div><div><dt>R live</dt><dd>${rx ? f(rx.L, 2) + 'k' : '—'}</dd></div>
        <div><dt>Combined</dt><dd>${f(c.res.CSR, 3)}</dd></div><div><dt>Shear</dt><dd>${f(c.res.SRvx, 3)}</dd></div>
        <div><dt>Live defl.</dt><dd>L/${f(c.defl.rLL, 0)}</dd></div><div><dt>Weight</dt><dd>${f(c.res.Wt, 1)} plf</dd></div></dl>
        <span class="pill">${b.trib < mk.trib ? `designed for ${ft(mk.trib)} trib (governing)` : 'governing trib'}</span>
        <div class="foot">${secParts(mk.sec)}</div>`;
    } else if (ref.type === 'col') {
      const col = r.columns.find(x => x.label === ref.c.label), cf = r.colFinal, gi = r.colGroups.findIndex(gp => gp.cols.some(x => x.label === ref.c.label));
      const chk = cf && gi >= 0 ? cf.checks[gi] : null;
      card.innerHTML = `<div class="eyebrow">${hover ? 'Member' : 'Selected member'}</div><h4>C${ref.no} · ${esc(ref.c.label)}</h4><div class="kind">Mezzanine column ⊗</div>
        <div class="sec nocase">${cf ? esc(cf.quoteAs) : '—'}</div>
        <dl><div><dt>Height</dt><dd>${ft(r.colLen)}</dd></div><div><dt>Trib area</dt><dd>${col ? f(col.tribArea, 0) + ' ft²' : '—'}</dd></div>
        <div><dt>Left D / L</dt><dd>${col ? f(col.DL_L, 1) + ' / ' + f(col.LL_L, 1) : '—'}</dd></div><div><dt>Right D / L</dt><dd>${col ? f(col.DL_R, 1) + ' / ' + f(col.LL_R, 1) : '—'}</dd></div>
        <div><dt>Max CSR</dt><dd>${chk ? f(chk.max, 3) : '—'}</dd></div><div><dt>Beams in</dt><dd>${col ? col.sides : '—'} side${col && col.sides === 1 ? '' : 's'}</dd></div></dl>
        <div class="foot">e = d/2 · three load combinations · column self-weight included, as on the Column sheet.</div>`;
    } else if (ref.type === 'other' || ref.type === 'otherCol' || ref.type === 'foreign') {
      const who = ref.type === 'foreign' ? ref.c.ownerId : ref.o.id;
      card.innerHTML = `<div class="eyebrow">${hover ? 'Member' : 'Selected member'}</div><h4>${esc(ref.type === 'other' ? 'B' + (ref.b.id + 1) : ref.c.label)}</h4><div class="kind">Mezzanine ${esc(who)}${ref.type === 'foreign' ? ' · shared column' : ''}</div>
        <div class="sec nocase">${esc(ref.type === 'other' ? (ref.mk && ref.mk.desc) || '—' : (state.job.mezz.find(m => m.id === who) || {}).colFinal ? state.job.mezz.find(m => m.id === who).colFinal.quoteAs : '—')}</div>
        ${ref.type === 'other' ? `<dl><div><dt>Span</dt><dd>${ft(ref.b.span)}</dd></div><div><dt>Trib</dt><dd>${ft(ref.b.trib)}</dd></div></dl>` : `<dl><div><dt>Left D / L</dt><dd>${f(ref.c.DL_L, 1)} / ${f(ref.c.LL_L, 1)}</dd></div><div><dt>Right D / L</dt><dd>${f(ref.c.DL_R, 1)} / ${f(ref.c.LL_R, 1)}</dd></div></dl>`}
        <div class="foot">${ref.type === 'foreign' ? `Counted and sized with ${esc(who)}: ${ref.c.parts.map(p => `${esc(p.mezz)} ${p.beam} (${p.sheetSide})`).join(' + ')}.` : 'Designed with this mezzanine as one job — switch mezzanine at the top to see its calc.'}</div>`;
    } else if (ref.type === 'bcol') {
      card.innerHTML = `<div class="eyebrow">${hover ? 'Member' : 'Selected member'}</div><h4>${esc(ref.sp.label)}</h4><div class="kind">Building column</div>
        <div class="sec" style="font-size:20px;color:#b9d4e8">By the frame / endwall design</div>
        <div class="foot">Mezzanine beams frame into this column; its load goes to the building frame design, not the mezzanine column sheet.</div>`;
    }
  }

  // ---------- quote sheet (workbook tables) ----------
  function renderQuoteSheet() {
    const q = state.all && state.all.length > 1 ? RUN.quoteJob(state.job.mezz, state.all.map(a => a.inputs)) : RUN.quoteSheet(state.res, state.inputs);
    state.quote = q;
    const cur = state.inputs.mezz.id || 'A', many = state.all && state.all.length > 1;
    const block = (key, title, sub, foot) => {
      const h = q.heads[key], rows = q[key];
      const cls = k => (k === 'NOTES' ? 'qnotes' : k === 'SECTION' ? 'sec' : k === 'DLT' || k === 'LLT' || k === 'ENDWT' ? 'calc' : k === 'MEZZ' ? 'left' : '');
      return `<div class="qs-block"><div class="qs-head"><div><h4>${title}</h4>${sub ? `<small>${sub}</small>` : ''}</div><button class="btn-soft" data-copy="${key}"><svg><use href="#i-copy"/></svg>Copy rows</button></div>
        <div class="qs-wrap"><table><thead><tr>${h.map(([k, t]) => `<th class="${k === 'NOTES' || k === 'MEZZ' ? 'left' : ''}">${t}</th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map(row => `<tr class="${many && row.MEZZ === cur ? 'is-cur' : ''}">${h.map(([k]) => `<td class="${cls(k)}">${esc(row[k])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${h.length}" class="qnotes">No rows.</td></tr>`}</tbody></table></div>
        <div class="qs-foot">${foot}</div></div>`;
    };
    $('#quoteSheet').innerHTML =
      block('design', 'Mezz. Design Information', '', '**DEAD LOAD DOES NOT INCLUDE THE WEIGHT OF THE FLOOR JOISTS OR BEAMS**') +
      block('beams', 'Mezz. Beams', 'U.N.O., live load deflection limit = L/360; total load deflection limit = L/240', 'DLᴛ = DL + COL · END PL. WT. = 40 lb PER BEAM') +
      block('columns', 'Mezz. Columns', '', 'END PL. WT. = 46 lb PER COLUMN · trib area = floor area carried by the worst column');
    $$('#quoteSheet [data-copy]').forEach(b => { b.onclick = () => copyText(q.tsv[b.dataset.copy], 'Rows copied — paste into the quote sheet'); });
  }
  $('#copyQuote').onclick = () => {
    const q = state.quote || RUN.quoteSheet(state.res, state.inputs);
    copyText([q.tsv.design, '', q.tsv.beams, '', q.tsv.columns].join('\n'), 'Design, beam and column rows copied');
  };
  $('#printBtn').onclick = () => window.print();

  // ---------- plan ----------
  $$('#joistSeg button').forEach(b => { b.onclick = () => { state.settings.joists = b.dataset.j; delete state.settings.xLines; delete state.settings.yLines; recompute(); }; });
  $('#gridReset').onclick = () => { delete state.settings.xLines; delete state.settings.yLines; recompute(); };
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
    const t = totals();
    const lineLab = v => (lay.joists === 'y' ? g.yLabel(v) : g.xLabel(v)) || ft(v);
    const colNo = new Map(lay.mezzCols.slice().sort((a, b) => a.x - b.x || b.y - a.y).map((c, i) => [c.label, i + 1]));
    const spans = [...new Set(lay.beams.map(b => b.span))];
    $('#planStats').innerHTML = `
      <div class="pstat beams"><span>Mezzanine beams</span><strong>${t.nB}<small>beams</small></strong><em>${r.marks.map(m => `${m.mark} ${esc(m.desc || '—')} × ${m.qty}`).join(' · ')}</em></div>
      <div class="pstat cols"><span>Mezzanine columns ⊗</span><strong>${t.nC}<small>columns</small></strong><em>${lay.mezzCols.map(c => c.label).sort().join(' · ') || 'none'}${(r.foreignCols || []).length ? ' · + ' + r.foreignCols.map(c => `${c.label} with ${esc(c.ownerId)}`).join(', ') : ''}</em></div>
      <div class="pstat"><span>Beam spans</span><strong>${spans.map(ft).join(' / ')}</strong><em>${lay.supportLines.length - 1} bay${lay.supportLines.length > 2 ? 's' : ''} × ${lay.beamLines.length} beam lines (${lay.beamLines.map(lineLab).join(', ')})</em></div>
      <div class="pstat"><span>Joists</span><strong>${ft(lay.joistSpan)}</strong><em>span · @ ${ft(r.beamBase.Lb)} · ${lay.joists === 'y' ? 'across the width' : 'along the length'}</em></div>`;
    $$('#joistSeg button').forEach(b => b.classList.toggle('is-active', b.dataset.j === (state.settings.joists || 'auto')));
    $('#planTitle').textContent = `Framing plan · ${inp.mezz.id || 'mezzanine'}`;
    $('#layWhy').textContent = `joists span ${lay.joists === 'y' ? 'across the width' : 'along the length'} — ${lay.why}`;
    $('#beamLinesIn').value = lay.beamLines.map(v => +v.toFixed(3)).join(', ');
    $('#supLinesIn').value = lay.supportLines.map(v => +v.toFixed(3)).join(', ');
    const L = g.length || 1, W = g.width || 1, fp = lay.footprint;
    // the other mezzanines of the job (same building) are drawn faintly for context
    const others = (state.job ? state.job.mezz : []).filter(o => o !== r && !o.incomplete && o.grid.length === g.length && o.grid.width === g.width);
    const ux0 = Math.min(fp.x0, ...others.map(o => o.layout.footprint.x0)), ux1 = Math.max(fp.x1, ...others.map(o => o.layout.footprint.x1));
    let xa = 0, xb = L;
    if ((ux1 - ux0) / L < 0.4) { xa = Math.max(0, ux0 - 30); xb = Math.min(L, ux1 + 30); }
    const VW = 1100, M = 64, s = Math.min((VW - 2 * M) / (xb - xa), 560 / W), VH = W * s + 2 * M + 24;
    const X = x => M + (x - xa) * s, Y = y => M + 12 + (W - y) * s;
    const inX = x => x >= xa - 0.01 && x <= xb + 0.01;
    const o = [];
    o.push(`<defs><pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="var(--hatch)"/><line x1="0" y1="0" x2="0" y2="9" stroke="var(--green)" stroke-width=".7" opacity=".3"/></pattern>
      <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink)"/></marker></defs>`);
    g.xs.filter(inX).forEach(x => {
      o.push(`<line class="grid-line" x1="${X(x)}" y1="${Y(W) - 26}" x2="${X(x)}" y2="${Y(0) + 26}"/>`);
      [Y(W) - 38, Y(0) + 38].forEach(cy => o.push(`<g class="bubble"><circle cx="${X(x)}" cy="${cy}" r="11"/><text x="${X(x)}" y="${cy}">${g.xLabel(x)}</text></g>`));
    });
    // letters run over every column line (ridge included, as on the drawings); only column lines get a bubble
    const colY = new Set([0, W, ...g.lewY, ...g.rewY, ...g.interior.flat()].map(v => v.toFixed(2)));
    g.allY.filter(y => colY.has(y.toFixed(2))).forEach(y => {
      o.push(`<line class="grid-line" x1="${X(xa) - 26}" y1="${Y(y)}" x2="${X(xb) + 26}" y2="${Y(y)}"/>`);
      [X(xa) - 38, X(xb) + 38].forEach(cx => o.push(`<g class="bubble"><circle cx="${cx}" cy="${Y(y)}" r="11"/><text x="${cx}" y="${Y(y)}">${g.yLabel(y)}</text></g>`));
    });
    const xsw = g.xs.filter(inX);
    xsw.slice(1).forEach((x, i) => { const a = xsw[i]; o.push(`<text class="dim" x="${(X(a) + X(x)) / 2}" y="${Y(W) - 52}">${ft(x - a)}</text>`); });
    o.push(`<rect class="bldg" x="${X(xa)}" y="${Y(W)}" width="${(xb - xa) * s}" height="${W * s}"/>`);
    if (xa > 0) o.push(`<text class="dim" x="${X(xa) - 6}" y="${Y(W) - 8}" text-anchor="start">⟵ ${ft(xa)} more to LEW</text>`);
    if (xb < L) o.push(`<text class="dim" x="${X(xb) + 6}" y="${Y(W) - 8}" text-anchor="end">${ft(L - xb)} more to REW ⟶</text>`);
    o.push(`<text class="dim" x="${X(xa) + 4}" y="${Y(0) - 6}" text-anchor="start">FSW</text><text class="dim" x="${X(xa) + 4}" y="${Y(W) + 24}" text-anchor="start">BSW</text>`);
    others.forEach(oz => {
      const f2 = oz.layout.footprint;
      o.push(`<rect class="foot other" x="${X(f2.x0)}" y="${Y(f2.y1)}" width="${(f2.x1 - f2.x0) * s}" height="${(f2.y1 - f2.y0) * s}"/><text class="dim other-t" x="${X((f2.x0 + f2.x1) / 2)}" y="${Y((f2.y0 + f2.y1) / 2)}">${esc(oz.id)}</text>`);
      oz.layout.beams.filter(b => !b.absorbed).forEach(b => { const [p, q] = b.ends; o.push(`<line class="beam other" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}"><title>${esc(oz.id)} B${b.id + 1} · span ${ft(b.span)} · trib ${ft(b.trib)}</title></line>`); });
    });
    o.push(`<rect class="foot" x="${X(fp.x0)}" y="${Y(fp.y1)}" width="${(fp.x1 - fp.x0) * s}" height="${(fp.y1 - fp.y0) * s}"/>`);
    const markIdx = id => r.marks.findIndex(mk => mk.beams.includes(id));
    lay.beams.filter(b => !b.absorbed).forEach(b => {
      const mi = markIdx(b.id), i = lay.beamLines.indexOf(b.line);
      const a = i > 0 ? (lay.beamLines[i - 1] + b.line) / 2 : b.line, c = i < lay.beamLines.length - 1 ? (b.line + lay.beamLines[i + 1]) / 2 : b.line;
      if (lay.joists === 'y') o.push(`<rect class="trib" data-beam="${b.id}" x="${X(b.from)}" y="${Y(c)}" width="${(b.to - b.from) * s}" height="${(c - a) * s}" fill="${MARK_COLORS[mi % 4]}"/>`);
      else o.push(`<rect class="trib" data-beam="${b.id}" x="${X(a)}" y="${Y(b.to)}" width="${(c - a) * s}" height="${(b.to - b.from) * s}" fill="${MARK_COLORS[mi % 4]}"/>`);
    });
    const sp = r.beamBase.Lb;
    if (sp > 0) {
      if (lay.joists === 'y') for (let x = fp.x0 + sp; x < fp.x1 - 0.01; x += sp) o.push(`<line class="joist" x1="${X(x)}" y1="${Y(fp.y0)}" x2="${X(x)}" y2="${Y(fp.y1)}"/>`);
      else for (let y = fp.y0 + sp; y < fp.y1 - 0.01; y += sp) o.push(`<line class="joist" x1="${X(fp.x0)}" y1="${Y(y)}" x2="${X(fp.x1)}" y2="${Y(y)}"/>`);
    }
    lay.beams.forEach(b => {
      const mi = markIdx(b.id), mk = r.marks[mi];
      const [p, q] = b.ends;
      if (b.absorbed) { o.push(`<line class="beam carried" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}"><title>Edge on the ${esc(b.absorbed.mezz)} beam line — its ${ft(b.tribOwn)} trib is carried by that beam</title></line>`); return; }
      o.push(`<line class="beam" data-beam="${b.id}" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}" stroke="${MARK_COLORS[mi % 4]}"><title>B${b.id + 1} · ${mk ? mk.mark + ' ' + (mk.desc || '') : ''} · span ${ft(b.span)} · trib ${ft(b.trib)}${b.extra ? ' (incl. ' + b.extra.map(x => x.mezz).join(', ') + ')' : ''}</title></line>`);
    });
    // building columns
    const bcols = [];
    g.xs.filter(inX).forEach(x => { bcols.push([x, 0], [x, W]); const fi = g.xs.indexOf(x); (g.interior[fi] || []).forEach(y => bcols.push([x, y])); });
    if (inX(0)) g.lewY.forEach(y => bcols.push([0, y]));
    if (inX(L)) g.rewY.forEach(y => bcols.push([L, y]));
    (g.fswX || []).filter(inX).forEach(x => bcols.push([x, 0])); (g.bswX || []).filter(inX).forEach(x => bcols.push([x, W]));
    bcols.forEach(([x, y]) => o.push(`<rect class="bcol" x="${X(x) - 4}" y="${Y(y) - 4}" width="8" height="8"/>`));
    // beam number tags (B1..) at mid-span
    lay.beams.filter(b => !b.absorbed).forEach(b => {
      const [p, q] = b.ends, mi = markIdx(b.id);
      const mx = (X(p.x) + X(q.x)) / 2, my = (Y(p.y) + Y(q.y)) / 2, lab = 'B' + (b.id + 1), w = 12 + lab.length * 6.5;
      o.push(`<g class="tag b"><rect x="${mx - w / 2}" y="${my - 9}" width="${w}" height="18" rx="9" style="stroke:${MARK_COLORS[mi % 4]}"/><text x="${mx}" y="${my + .5}" style="fill:${MARK_COLORS[mi % 4]}">${lab}</text></g>`);
    });
    // mezzanine columns + numbers (C1..)
    lay.mezzCols.forEach(c => {
      const cx = X(c.x), cy = Y(c.y), R = 8, d = R * 0.7, lab = 'C' + colNo.get(c.label);
      o.push(`<g class="mcol"><circle cx="${cx}" cy="${cy}" r="${R}"/><path d="M${cx - d},${cy - d} L${cx + d},${cy + d} M${cx - d},${cy + d} L${cx + d},${cy - d}"/><title>${lab} · mezzanine column ${c.label}</title></g>`);
      o.push(`<g class="tag c"><rect x="${cx + 11}" y="${cy + 7}" width="26" height="16" rx="8"/><text x="${cx + 24}" y="${cy + 15.5}">${lab}</text></g><text class="lbl" x="${cx + 41}" y="${cy + 19}">${c.label}</text>`);
    });
    // columns counted with another mezzanine (shared) and the other mezzanines' own columns
    const xmark = (cx, cy, R, cls) => { const d = R * 0.7; return `<g class="mcol ${cls}"><circle cx="${cx}" cy="${cy}" r="${R}"/><path d="M${cx - d},${cy - d} L${cx + d},${cy + d} M${cx - d},${cy + d} L${cx + d},${cy - d}"/></g>`; };
    (r.foreignCols || []).forEach(c => { const cx = X(c.x), cy = Y(c.y); o.push(xmark(cx, cy, 8, 'shared') + `<text class="lbl" x="${cx + 12}" y="${cy + 19}">${c.label} · with ${esc(c.ownerId)}</text>`); });
    others.forEach(oz => oz.columns.forEach(c => { if (!(r.foreignCols || []).some(f2 => f2.label === c.label)) o.push(xmark(X(c.x), Y(c.y), 6, 'other')); }));
    if (r.planCheck && r.planCheck.ok) r.planCheck.cols.forEach(c => o.push(`<circle class="seen" cx="${X(c.x)}" cy="${Y(c.y)}" r="14"><title>Mezzanine column on the PCS floor plan</title></circle>`));
    if (lay.joists === 'y') {
      const x = (fp.x0 + Math.min(fp.x1, lay.supportLines[1] ?? fp.x1)) / 2 + sp / 2, y0 = lay.beamLines[0], y1 = lay.beamLines[1] ?? fp.y1;
      o.push(`<line class="arrow" x1="${X(x)}" y1="${Y(y0) - 12}" x2="${X(x)}" y2="${Y(y1) + 12}" marker-start="url(#ah)" marker-end="url(#ah)"/><text class="arrow-t" x="${X(x) + 7}" y="${(Y(y0) + Y(y1)) / 2}">JOISTS @ ${ft(sp)}</text>`);
    } else {
      const y = (fp.y0 + Math.min(fp.y1, lay.supportLines[1] ?? fp.y1)) / 2 + sp / 2, x0 = lay.beamLines[0], x1 = lay.beamLines[1] ?? fp.x1;
      o.push(`<line class="arrow" x1="${X(x0) + 12}" y1="${Y(y)}" x2="${X(x1) - 12}" y2="${Y(y)}" marker-start="url(#ah)" marker-end="url(#ah)"/><text class="arrow-t" x="${(X(x0) + X(x1)) / 2}" y="${Y(y) - 7}" text-anchor="middle">JOISTS @ ${ft(sp)}</text>`);
    }
    $('#planSvg').setAttribute('viewBox', `0 0 ${VW} ${VH}`);
    $('#planSvg').innerHTML = o.join('');
    $$('#planSvg .beam').forEach(el => {
      const tb = $(`#planSvg .trib[data-beam="${el.dataset.beam}"]`);
      el.addEventListener('mouseenter', () => tb && tb.classList.add('on'));
      el.addEventListener('mouseleave', () => tb && tb.classList.remove('on'));
    });
    $('#planLegend').innerHTML = r.marks.map((mk, i) => `<span><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="${MARK_COLORS[i % 4]}" stroke-width="5"/></svg>${mk.mark} ${esc(mk.desc || '')} · qty ${mk.qty}</span>`).join('') +
      `<span><svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--red)" stroke-width="2"/><path d="M4,4 L12,12 M4,12 L12,4" stroke="var(--red)" stroke-width="2"/></svg>Mezzanine column · qty ${lay.mezzCols.length}</span>` +
      (r.planCheck && r.planCheck.ok ? `<span><svg width="18" height="18"><circle cx="9" cy="9" r="7" fill="none" stroke="var(--steel)" stroke-width="1.6" stroke-dasharray="3 2"/></svg>Column read from the PCS drawing (${r.planCheck.cols.length})</span>` : '') +
      (others.length ? `<span><svg width="22" height="10"><rect width="22" height="10" class="foot other"/></svg>${others.map(oz => esc(oz.id)).join(', ')} (designed with this one)</span>` : '') +
      (lay.beams.some(b => b.absorbed) ? `<span><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" class="beam carried"/></svg>Edge carried by the neighbour's beam</span>` : '') +
      `<span><svg width="10" height="10"><rect width="8" height="8" x="1" y="1" fill="var(--ink)"/></svg>Building column</span><span><svg width="22" height="10"><rect width="22" height="10" fill="url(#hatch)" stroke="var(--green)"/></svg>Footprint · hover a beam for its trib</span>`;
    const markOf = id => r.marks.find(mk => mk.beams.includes(id));
    $('#beamTable').innerHTML = `<thead><tr><th>Beam</th><th>Line</th><th>From → to</th><th class="num">Span</th><th class="num">Trib</th><th>Mark</th><th>Section</th></tr></thead><tbody>` +
      lay.beams.map(b => { const mk = markOf(b.id), fl = lay.joists === 'y' ? g.xLabel : g.yLabel;
        const trib = b.extra ? `${ft(b.trib)}<small class="sub-n"> ${ft(b.tribOwn)} + ${b.extra.map(x => esc(x.mezz) + ' ' + ft(x.tribOwn)).join(' + ')}</small>` : ft(b.trib);
        return `<tr class="${b.absorbed ? 'muted' : ''}"><td class="mono"><b>B${b.id + 1}</b></td><td>${lineLab(b.line)}</td><td>${fl(b.from) || ft(b.from)} → ${fl(b.to) || ft(b.to)}</td><td class="num">${ft(b.span)}</td><td class="num">${trib}</td><td>${b.absorbed ? 'carried by ' + esc(b.absorbed.mezz) : mk ? mk.mark : ''}</td><td class="mono">${b.absorbed ? '—' : mk && mk.desc ? mk.desc : '—'}</td></tr>`; }).join('') + '</tbody>';
    $('#supTable').innerHTML = `<thead><tr><th>Support</th><th>Type</th><th class="num">Trib area</th><th class="num">Left D / L (k)</th><th class="num">Right D / L (k)</th></tr></thead><tbody>` +
      lay.supports.slice().sort((a, b) => a.building - b.building || (colNo.get(a.label) || 0) - (colNo.get(b.label) || 0) || a.x - b.x || a.y - b.y).map(sp2 => {
        const own = r.columns.find(c2 => c2.label === sp2.label), fc = (r.foreignCols || []).find(c2 => c2.label === sp2.label), c = own || fc;
        const fl = sp2.building ? (r.frameLoads || []).find(q => Math.abs(q.x - sp2.x) < 0.01 && Math.abs(q.y - sp2.y) < 0.01) : null;
        if (fl) return `<tr class="frame-row"><td class="mono">${sp2.label}</td><td>Building column · <b>load to the frame</b><br><small class="sub-n">${fl.parts.map(p => `${state.all && state.all.length > 1 ? esc(p.mezz) + ' ' : ''}${p.beam}${p.mark ? ' · ' + p.mark : ''}`).join(' + ')}</small></td><td class="num"></td><td class="num" colspan="2"><b>D ${f(fl.D, 2)} · L ${f(fl.L, 2)} k</b></td></tr>`;
        const type = sp2.building ? 'Building column' : fc ? `Mezzanine column · counted with ${esc(fc.ownerId)}` : `<b style="color:var(--red)">Mezzanine column ⊗</b>${own && own.shared ? ' · shared' : ''}`;
        const from = c && c.shared ? `<br><small class="sub-n">${c.parts.map(p => `${p.sheetSide}: ${esc(p.mezz)} ${p.beam}`).join(' · ')}</small>` : '';
        return `<tr><td class="mono">${own ? `<b>C${colNo.get(sp2.label)}</b> · ` : ''}${sp2.label}</td><td>${type}${from}</td><td class="num">${c ? f(c.tribArea, 0) + ' ft²' : ''}</td><td class="num">${c ? f(c.DL_L, 2) + ' / ' + f(c.LL_L, 2) : ''}</td><td class="num">${c ? f(c.DL_R, 2) + ' / ' + f(c.LL_R, 2) : ''}</td></tr>`;
      }).join('') + '</tbody>';
  }

  // ---------- beam calc (MB sheet mirror) ----------
  const kv = rows => `<div class="kv">${rows.map(([k, v, cls, row]) => `<span class="${row || ''}">${k}</span><span class="${cls || ''} ${row || ''}">${v}</span>`).join('')}</div>`;
  function renderBeam() {
    const r = state.res, inp = state.inputs;
    $('#markTabs').innerHTML = r.marks.map((mk, i) => `<button class="tab ${i === state.mark ? 'is-active' : ''}" data-i="${i}">${mk.mark} · ${esc(mk.desc || 'none')} · ${ft(mk.span)} × ${ft(mk.trib)}</button>`).join('');
    $$('#markTabs .tab').forEach(t => { t.onclick = () => { state.mark = +t.dataset.i; renderBeam(); }; });
    const mk = r.marks[state.mark];
    if (!mk) { $('#mbSheet').innerHTML = '<div class="empty">No beams.</div>'; $('#altTable').innerHTML = ''; return; }
    $('#beamCalcTitle').innerHTML = `${mk.mark} · <em class="nocase">${esc(mk.desc || 'no section')}</em>`;
    const c = mk.check, p = mk.params;
    if (!c) $('#mbSheet').innerHTML = '<div class="empty">No passing section in the depth range.</div>';
    else {
      const x = c.res, clear = r.clear;
      const clr = (k, lab) => [lab, `${clear[k].req != null ? f(clear[k].req, 2) : '—'} req · ${clear[k].prov != null ? f(clear[k].prov, 2) : '—'} prov ${clear[k].ok === false ? '· NO GOOD' : clear[k].ok ? '· OK' : ''}`, clear[k].ok === false ? 'ng' : ''];
      $('#mbSheet').innerHTML = `<div class="frame-strip"><span class="eyebrow">Floor loads to the frame · ${mk.mark}</span><b>Dead ${f(c.V.D, 3)} k</b><b>Live ${f(c.V.L, 3)} k</b><small>unfactored shear at left / right, per beam end — highlighted below</small></div><div class="sheet">
        <div><h4>INPUT sheet</h4>${kv([
          ['Dead, (psf)', f(p.dead, 1)], ['Collateral, (psf)', f(p.coll, 1)], ['Live, (psf)', f(p.live, 1)], ['Est. Joist Wt., (psf)', f(p.joistWt, 1)],
          ['Top of Mezzanine, (ft.)', f(inp.geom.A.value, 3)], ['Slab & Deck Thickness, (in.)', f(inp.geom.slab.value * 12, 3)], ['Joist Seat Depth, (in.)', f(inp.geom.seat.value * 12, 3)],
          ['Total Joist Depth, (in.)', r.joistDepthIn != null ? f(r.joistDepthIn, 2) : '—'], ['Beam Depth, (in.)', mk.sec.d],
          clr('A', 'A - Finish floor to top of mezz'), clr('B', 'B - Clearance under joist'), clr('C', 'C - Clearance under support beams'),
        ])}
        <h4 style="margin-top:16px">Loading and geometric input</h4>${kv([
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
          ['Wide-flange/Built-up Sect.:', 'BU'], ['Section Description:', `<b>${esc(c.desc)}</b>`], ['Total Depth, in. =', f(mk.sec.d, 3)], ['Web Thickness, in. =', f(mk.sec.tw, 3)],
          ['O. Flange Width, in. =', f(mk.sec.bof, 3)], ['O. Flange Thickness, in. =', f(mk.sec.tof, 3)], ['I. Flange Width, in. =', f(mk.sec.bif, 3)], ['I. Flange Thickness, in. =', f(mk.sec.tif, 3)],
          ['Material Strength Fy, ksi =', '55'], ['Ultimate Strength Fu, ksi =', '70'],
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
    const sr = mk.search;
    if (!sr || !sr.best) { $('#altTable').innerHTML = ''; return; }
    $('#altSub').textContent = `${sr.evaluated.toLocaleString()} stocked combinations checked for ${ft(mk.span)} span × ${ft(mk.trib)} trib · click a row to use it`;
    const optAt = sec => (mk.options.find(o => sameSec(o.pick.sec, sec)) || {}).label;
    $('#altTable').innerHTML = `<thead><tr><th class="num">Depth</th><th>Section</th><th>Web</th><th>Flanges</th><th>Econ.</th><th class="num">Wt plf</th><th class="num">Combined</th><th class="num">Shear</th><th class="num">LL L/</th><th class="num">TL L/</th><th class="num">Bearing</th></tr></thead><tbody>` +
      sr.byDepth.map(a => a.none ? `<tr class="none"><td class="num">${a.d}"</td><td colspan="10">nothing stocked passes at this depth</td></tr>` :
        `<tr class="pick ${sameSec(a.sec, sr.best.sec) ? 'is-best' : ''} ${mk.sec && sameSec(a.sec, mk.sec) ? 'is-chosen' : ''}" data-d="${a.d}"><td class="num">${a.d}"</td><td class="mono"><b>${a.desc}</b>${optAt(a.sec) ? ` <span class="src pcs">${optAt(a.sec)}</span>` : ''}</td><td class="mono">${a.web} (${a.sec.tw})</td><td class="mono">${a.flange}</td><td>${a.tier}</td><td class="num">${f(a.wt, 2)}</td><td class="num">${f(a.CSR, 3)}</td><td class="num">${f(a.SRv, 3)}</td><td class="num">${f(a.rLL, 0)}</td><td class="num">${f(a.rTL, 0)}</td><td class="num">${f(a.conc, 2)}</td></tr>`).join('') + '</tbody>';
    $$('#altTable tr.pick').forEach(tr => { tr.onclick = () => pickDepth(mk.mark, tr.dataset.d); });
  }

  // ---------- column calc (Column sheet mirror) ----------
  // C1, C2 … numbered the same everywhere (plan tags, 3D, column sheet): along the length, then from the BSW
  const colNos = r => new Map(r.layout.mezzCols.slice().sort((a, b) => a.x - b.x || b.y - a.y).map((c, i) => [c.label, i + 1]));
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
    if (!r.colGroups.length) { $('#colTabs').innerHTML = ''; $('#colSheet').innerHTML = '<div class="empty">No mezzanine columns in this layout.</div>'; $('#colTried').innerHTML = ''; return; }
    const cno = colNos(r);
    const nm = c => `C${cno.get(c.label) || '?'} · ${c.label}`;
    $('#colTabs').innerHTML = r.colGroups.map((g, i) => `<button class="tab ${i === state.colGroup ? 'is-active' : ''}" data-i="${i}">${esc(g.cols.map(nm).join(', '))}${cf && cf.checks[i] ? `<small class="tab-ratio ${cf.checks[i].ok ? 'ok' : 'ng'}">${f(cf.checks[i].max, 2)}</small>` : ''}</button>`).join('');
    $$('#colTabs .tab').forEach(t => { t.onclick = () => { state.colGroup = +t.dataset.i; renderColumn(); }; });
    const g = r.colGroups[state.colGroup];
    if (!cf) $('#colSheet').innerHTML = '<div class="empty">No column passes.</div>';
    else {
      const chk = cf.checks[state.colGroup], w = WF[cf.name];
      const names = ['DLt+LLt+DRt', 'DLt+DRt+LRt', 'DLt+LLt+DRt+LRT'];
      $('#colSheet').innerHTML = `<div class="sheet two">
        <div><h4>Span and loading conditions</h4>${kv([
          ['Column Mark:', 'MC1'], ['Column Length, L', f(r.colLen, 4) + ' ft.'], ['X-Axis Unbraced Length, Lbx', f(r.colLen * 12, 2) + ' in.'], ['Y-Axis Unbraced Length, Lby', f(r.colLen * 12, 2) + ' in.'],
          ['Kx / Ky / Kz', '1.000 / 1.000 / 1.000'], ['Section:', `<b>${cf.name}</b>`], ['Fy (ksi)', '50'],
          ['Total Depth, d', f(w.d, 3) + ' in.'], ['Flange Width, b', f(w.bf, 3) + ' in.'], ['Flange Thickness, tf', f(w.tf, 3) + ' in.'], ['Web Thickness, tw', f(w.tw, 3) + ' in.'],
        ])}</div>
        <div><h4>Applied loads (beam reactions)</h4>${kv([
          ['Left Beam Reaction — Dead', f(g.loads.DL_L, 2) + ' kip'], ['Left Beam Reaction — Live', f(g.loads.LL_L, 2) + ' kip'],
          ['Right Beam Reaction — Dead', f(g.loads.DL_R, 2) + ' kip'], ['Right Beam Reaction — Live', f(g.loads.LL_R, 2) + ' kip'],
          ['X-Axis Eccentricity, e (d/2)', f(chk.ex, 2) + ' in.'], ['Column self-weight (Wt·L/1000)', f(chk.wt, 3) + ' kip'], ['Columns in this case', esc(g.cols.map(nm).join(', '))],
        ])}${lrDiagram(g, cno)}</div>
        <div class="full"><h4>Load combinations</h4><div class="table-wrap"><table><thead><tr><th></th>${names.map(n => `<th class="num">${n}</th>`).join('')}</tr></thead><tbody>
          <tr><td>Mx (ft-kip)</td>${chk.combos.map(k => `<td class="num">${f(k.Mx, 2)}</td>`).join('')}</tr>
          <tr><td>Axial (kip)</td>${chk.combos.map(k => `<td class="num">${f(k.P, 2)}</td>`).join('')}</tr>
          <tr><td>Maximum CSR</td>${chk.combos.map(k => `<td class="num">${f(k.csr, 3)}</td>`).join('')}</tr>
          <tr><td>Design results</td>${chk.combos.map(k => `<td class="num"><span class="status-text ${k.ok ? 'ok' : 'ng'}">${k.okText}</span></td>`).join('')}</tr>
        </tbody></table></div>
        <p class="foot-note">${r.edition.colEd === '16' ? '16th-edition sheet: C10 (Lby) is hard-coded to 120 in. — type L×12 when you check it in Excel.' : 'Run in the Mezzanine Column (AISC ' + (r.edition.colEd || '15') + 'th) sheet.'}</p></div>
      </div>`;
    }
    const tried = g.design ? g.design.tried : [];
    $('#colTried').innerHTML = `<thead><tr><th>Section</th><th class="num">Wt plf</th><th class="num">bf</th><th class="num">Max CSR</th><th>Result</th><th>Quote as</th></tr></thead><tbody>` +
      tried.map(t => { const q = DESIGN.COMMON_COLUMNS.includes(t.name) || t.name === 'W8X18' ? t.name : t.name.replace(/^W(\d+)X/, 'BU$1x');
        return `<tr class="pick ${cf && cf.name === t.name ? 'is-chosen' : ''}" data-n="${t.name}"><td class="mono"><b>${t.name}</b></td><td class="num">${f(WF[t.name].W, 0)}</td><td class="num">${WF[t.name].bf}</td><td class="num">${f(t.max, 3)}</td><td><span class="status-text ${t.ok ? 'ok' : 'ng'}">${t.ok ? 'OK' : 'NG'}</span></td><td class="mono">${q}</td></tr>`; }).join('') +
      `<tr><td colspan="6"><div class="field-row wide" style="border:0"><label>Use a different W for every mezzanine column</label><select id="colPick"><option value="">Automatic (${g.design && g.design.name ? g.design.name : '—'})</option>${Object.keys(WF).filter(k => /^W(6|8|10|12|14)X/.test(k)).sort((a, b) => WF[a].W - WF[b].W).map(k => `<option ${state.settings.colOverride === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></td></tr></tbody>`;
    $$('#colTried tr.pick').forEach(tr => { tr.onclick = () => { state.settings.colOverride = tr.dataset.n === (g.design && g.design.name) ? undefined : tr.dataset.n; recompute(); }; });
    $('#colPick').onchange = e => { state.settings.colOverride = e.target.value || undefined; recompute(); };
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
    const ck = checks('material', 'Material (not by seller)') + checks('use', 'Floor use') + checks('provided', 'Materials provided by seller');
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
      sel('optionDefault', 'Option on the quote', [['lightest', 'Lightest'], ['fit', 'Best fit (within 8%, shallower)'], ['headroom', 'Headroom (d ≤ A − B − slab − seat)']], 'per job you can still pick any option'),
      num('target', 'Target SR (combined & shear)', '≤ this; the sheet says NG at 1.00', 0.01),
      num('dMin', 'Min. depth, (in.)'), num('dMax', 'Max. depth, (in.)', 'also capped by clearance (C) when given'),
      sel('symmetric', 'Flanges', [['true', 'Same top and bottom'], ['false', 'Allow unequal (IF ≤ OF width)']]),
      sel('requireConc', 'Joist bearing check (MB L7)', [['true', 'Must pass'], ['false', 'Report only']]),
      sel('marks', 'Beam marks', [['single', 'One governing mark (max span & trib)'], ['split', 'Split by trib / span (guide)']]),
      sel('partitionTo', 'Partition load', [['live', 'Add to live'], ['dead', 'Add to dead']]),
      '<div class="group-title">Columns</div>',
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
        if (k === 'marks' || k === 'optionDefault') { state.settings.override = {}; state.mark = 0; }
        if (state.all) state.all.forEach(a => { a.settings[k] = v; if (k === 'marks' || k === 'optionDefault') a.settings.override = {}; });
        if (state.inputs) recompute(); else renderSettings();
      };
    });
  }
  renderSettings();
})();
