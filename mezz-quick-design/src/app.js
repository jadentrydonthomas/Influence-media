/* Mezzanine Quick-Design — browser UI. */
(function () {
  'use strict';
  const PCS = window.MZ_PCS, RUN = window.MZ_RUN, EX = window.MZ_EXTRACT, DESIGN = window.MZ_DESIGN, WF = window.MZ_WF, MZ = window.MZ;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ft = x => PCS.fmtFtIn(x);
  const f = (x, d = 3) => (x == null || !isFinite(x) ? '—' : (+x).toFixed(d));
  const inch = x => (x == null || !isFinite(x) ? '—' : (Math.round(x * 1000) / 1000) + '"');
  const MARK_COLORS = ['var(--mark-1)', 'var(--mark-2)', 'var(--mark-3)', 'var(--mark-4)'];

  const state = { pages: null, pcs: null, mi: 0, inputs: null, settings: { ...RUN.SETTINGS }, res: null, view: 'upload', mark: 0, colGroup: 0, fileName: null };

  // ---------- theme ----------
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
    $$('#nav button').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
    window.scrollTo({ top: 0 });
  }
  $$('#nav button').forEach(b => { b.onclick = () => go(b.dataset.view); });
  document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function status(text, cls) { $('#statusText').textContent = text; $('#statusDot').className = 'dot ' + (cls || ''); }

  // ---------- intake ----------
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', e => { const file = e.dataTransfer.files[0]; if (file) loadFile(file); });
  $('#file').addEventListener('change', e => { const file = e.target.files[0]; if (file) loadFile(file); });
  const prog = p => { $('#prog').style.width = Math.round(p * 100) + '%'; };

  async function loadFile(file) {
    state.fileName = file.name;
    $('#dropTitle').textContent = file.name;
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
      // checkboxes on the Box 22 page(s)
      for (const p of PCS.box22Pages(pages)) {
        const targets = PCS.checkboxTargets(p);
        const det = await EX.detectChecks(p, targets, p._page);
        p.checks = det.states || {};
        p.checkRaw = det.raw;
      }
      prog(0.85);
      const pcs = PCS.parse(pages);
      if (!pcs.mezzanines.length) throw new Error('No "22) MEZZANINES" box with a Mezzanine ID was found in this PDF.');
      state.pages = pages; state.pcs = pcs; state.mi = 0;
      state.inputs = RUN.inputsFromPCS(pcs, 0);
      state.settings = { ...RUN.SETTINGS, ...keepSettings() };
      $('#dropSub').textContent = `${pdf.numPages} pages · ${pcs.mezzanines.length} mezzanine${pcs.mezzanines.length > 1 ? 's' : ''} found`;
      $('#intakeMsg').textContent = 'Parsed. Review the sections, then check the plan against the drawing.';
      prog(1);
      recompute();
      go('results');
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
    ['target', 'dMin', 'dMax', 'symmetric', 'requireConc', 'marks', 'colLength', 'includeW818', 'partitionTo', 'division', 'edition'].forEach(k => { keep[k] = s[k]; });
    return keep;
  }

  $('#manualBtn').onclick = () => {
    const v = (value, source, note) => ({ value, source, note });
    state.pcs = null;
    state.inputs = {
      job: { quote: '', project: 'Manual entry', division: 'NBS-IN', code: { family: 'AISC', edition: '15', spec: 'AISC 360-16', text: 'IBC 2021' } },
      mezz: { id: 'Manual', provided: {}, material: 'Standard Weight Concrete' },
      loads: { dead: v(43, 'deckGuide', '4" standard-weight concrete'), coll: v(5, 'manual'), live: v(125, 'manual'), partition: v(0, 'manual'), joistWt: v(8, 'default') },
      geom: { width: v(40, 'manual'), length: v(40, 'manual'), startLEW: v(0, 'manual'), startFSW: v(0, 'manual'), slab: v(4 / 12, 'manual'), A: v(12, 'manual'), B: v(null, 'missing'), C: v(null, 'missing'), joistSpacing: v(4, 'default'), seat: v(2.5 / 12, 'default') },
      building: { width: 60, length: 100, ridge: 30, bays: [20, 20, 20, 20, 20], lewCols: [20, 20, 20], rewCols: [20, 20, 20], frames: [], fswSoldier: [], bswSoldier: [] },
    };
    state.settings = { ...RUN.SETTINGS, ...keepSettings() };
    recompute();
    go('inputs');
    toast('Manual entry — fill in the inputs');
  };

  // ---------- compute ----------
  function recompute() {
    if (!state.inputs) return;
    try {
      state.res = RUN.run(state.inputs, state.settings);
    } catch (err) {
      console.error(err);
      status('Design error: ' + err.message, 'bad');
      return;
    }
    if (state.mark >= state.res.marks.length) state.mark = 0;
    if (state.colGroup >= state.res.colGroups.length) state.colGroup = 0;
    $$('#nav button').forEach(b => { b.disabled = false; });
    $('#copyQuote').disabled = false; $('#printBtn').disabled = false;
    const bad = state.res.warn.some(w => w.level === 'stop');
    const ok = state.res.marks.every(m => m.sec) && (!state.res.columns.length || state.res.colFinal);
    status(ok ? (bad ? 'Designed · check warnings' : 'Designed') : 'Needs attention', ok ? (bad ? 'warn' : 'ok') : 'bad');
    renderAll();
  }

  function renderAll() {
    renderRail(); renderResults(); renderPlan(); renderBeam(); renderColumn(); renderInputs(); renderSettings();
  }

  // ---------- rail ----------
  function renderRail() {
    const inp = state.inputs, r = state.res;
    $('#fQuote').textContent = inp.job.quote || '—';
    $('#fProject').textContent = inp.job.project || '—';
    const c = inp.job.code || {};
    $('#fCode').textContent = (c.text ? c.text.replace(/\s+ASCE.*$/, '') + ' → ' : '') + (r.edition.ed ? edLabel(r.edition.ed) : '—');
    $('#fDiv').textContent = r.division;
    $('#mastContext').textContent = (inp.job.quote ? inp.job.quote + ' · ' : '') + (inp.mezz.id ? 'Mezzanine "' + inp.mezz.id + '"' : '');
    const mz = state.pcs ? state.pcs.mezzanines : [];
    $('#fMezzWrap').hidden = mz.length < 2;
    if (mz.length > 1) {
      $('#fMezz').innerHTML = mz.map((m, i) => `<option value="${i}" ${i === state.mi ? 'selected' : ''}>${esc(m.id || 'Mezzanine ' + (i + 1))}</option>`).join('');
      $('#fMezz').onchange = e => { state.mi = +e.target.value; state.inputs = RUN.inputsFromPCS(state.pcs, state.mi); state.settings = { ...RUN.SETTINGS, ...keepSettings() }; recompute(); };
    }
  }
  const edLabel = ed => ({ 13: 'AISC 13th (360-05)', 15: 'AISC 15th (360-16)', 16: 'AISC 16th (360-22)' })[ed] || ed;

  // ---------- results ----------
  function ring(sr, target) {
    const R = 33, C = 2 * Math.PI * R, v = isFinite(sr) ? sr : 9;
    const col = v <= target ? 'var(--green)' : v <= 1 ? 'var(--amber)' : 'var(--red)';
    return `<svg class="ring" width="84" height="84" viewBox="0 0 84 84" aria-label="Max ratio ${f(v, 2)}">
      <circle cx="42" cy="42" r="${R}" fill="none" stroke="var(--line)" stroke-width="6"/>
      <circle cx="42" cy="42" r="${R}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${Math.min(v, 1) * C} ${C}" transform="rotate(-90 42 42)"/>
      <text x="42" y="39" text-anchor="middle" dominant-baseline="central">${f(v, 2)}</text>
      <text class="lab" x="42" y="55" text-anchor="middle">MAX SR</text></svg>`;
  }
  const chip = (lab, val, ok) => `<span class="chip ${ok === true ? 'ok' : ok === false ? 'bad' : ''}"><b>${lab}</b>${val}</span>`;

  function beamSectionParts(sec) {
    if (!sec) return '';
    const fl = DESIGN.flangeName(sec.bof, sec.tof), fi = DESIGN.flangeName(sec.bif, sec.tif);
    return `d ${sec.d}" · web ${sec.tw}" · ${fl === fi ? 'flanges ' + fl + ' (' + sec.bof + '×' + sec.tof + ')' : 'OF ' + fl + ' / IF ' + fi} · ${DESIGN.TIER[Math.max(DESIGN.tierOf(sec.bof, sec.tof), DESIGN.tierOf(sec.bif, sec.tif))]}`;
  }

  // shallower / deeper options within ~20% of the lightest, one click to switch
  function altChips(mk) {
    const sr = mk.search;
    if (!sr || !sr.best) return '';
    const lim = sr.best.wt * 1.2;
    const opts = sr.byDepth.filter(a => !a.none && a.wt <= lim);
    if (opts.length < 2) return '';
    return `<div class="alts"><span class="lab">Also passes (lightest at each depth)</span>${opts.map(a => `<button class="alt ${sameSec(a.sec, mk.sec) ? 'on' : ''}" data-mark="${mk.mark}" data-d="${a.d}">${a.desc} <small>${f(a.wt, 1)}</small></button>`).join('')}</div>`;
  }
  function pickAlt(mark, d) {
    const mk = state.res.marks.find(m => m.mark === mark), a = mk.search.byDepth.find(z => String(z.d) === String(d));
    state.settings.override = { ...(state.settings.override || {}) };
    if (sameSec(a.sec, mk.search.best.sec)) delete state.settings.override[mark]; else state.settings.override[mark] = a.sec;
    recompute(); toast(`${mark} → ${a.desc}`);
  }
  document.addEventListener('click', e => { const b = e.target.closest('.alt[data-mark]'); if (b) pickAlt(b.dataset.mark, b.dataset.d); });

  function renderResults() {
    const r = state.res, inp = state.inputs, s = state.settings;
    $('#resEyebrow').textContent = (inp.job.quote || 'Design result') + (inp.job.project ? ' · ' + inp.job.project : '');
    $('#resTitle').innerHTML = esc('Mezzanine ' + (inp.mezz.id ? '"' + inp.mezz.id + '"' : '')) + '<br><em class="nocase">' + esc(r.quote.beams.map(b => b.section || 'NO BEAM').join(' / ')) + (r.quote.columns[0] ? ' · ' + esc(r.quote.columns[0].section) : '') + '</em>';
    $('#resLede').textContent = `${ft(inp.geom.width.value)} wide × ${ft(inp.geom.length.value)} long at LEW ${ft(inp.geom.startLEW.value)} / FSW ${ft(inp.geom.startFSW.value)}. DL ${r.beamBase.dead} + coll ${r.beamBase.coll} + LL ${r.beamBase.live} psf, joists ${r.beamBase.joistWt} psf @ ${ft(r.beamBase.Lb)}. ${edLabel(r.edition.beamEd || r.edition.ed)} ASD, ${r.division} stock.`;
    $('#warnings').innerHTML = r.warn.map(w => `<div class="warn ${w.level}">${esc(w.text)}</div>`).join('');
    $('#beamSub').textContent = `${r.layout.beams.length} beams · ${r.marks.length} mark${r.marks.length > 1 ? 's' : ''} · ${s.marks === 'single' ? 'one governing mark' : 'split by trib / span'}`;
    $('#beamCards').innerHTML = r.marks.map((mk, i) => {
      const c = mk.check;
      if (!c) return `<div class="member"><div class="member-mark"><i style="background:${MARK_COLORS[i % 4]}"></i>${mk.mark}</div><div class="section-big" style="color:var(--red)">No section</div><p class="muted">Nothing stocked passes between ${s.dMin}" and ${s.dMax}". Widen the depth range in Settings.</p></div>`;
      const maxSR = Math.max(c.res.CSR, c.res.SRvx, 360 / c.defl.rLL, 240 / c.defl.rTL, c.conc ? c.conc.max : 0);
      const over = s.override && s.override[mk.mark];
      return `<div class="member">
        <div class="member-top"><div>
          <div class="member-mark"><i style="background:${MARK_COLORS[i % 4]}"></i>${mk.mark} · ${mk.qty} beam${mk.qty > 1 ? 's' : ''}${over ? ' · picked by hand' : ''}</div>
          <div class="section-big">${esc(mk.desc)}</div>
          <div class="section-parts">${beamSectionParts(mk.sec)}</div>
        </div>${ring(maxSR, s.target)}</div>
        <dl class="facts-row"><div><dt>Span</dt><dd>${ft(mk.span)}</dd></div><div><dt>Trib</dt><dd>${ft(mk.trib)}</dd></div><div><dt>Qty</dt><dd>${mk.qty}</dd></div><div><dt>Weight</dt><dd>${f(c.res.Wt, 1)}<small> plf</small></dd></div></dl>
        <div class="chips">
          ${chip('Combined', f(c.res.CSR, 3), c.res.CSR <= s.target)}${chip('Shear', f(c.res.SRvx, 3), c.res.SRvx <= s.target)}
          ${chip('LL', 'L/' + f(c.defl.rLL, 0), c.defl.rLL >= 360)}${chip('TL', 'L/' + f(c.defl.rTL, 0), c.defl.rTL >= 240)}
          ${c.conc ? chip('Joist bearing', f(c.conc.max, 2), c.conc.ok) : ''}${chip('R dead', f(c.V.D, 2) + 'k')}${chip('R live', f(c.V.L, 2) + 'k')}
        </div>${altChips(mk)}</div>`;
    }).join('');
    const cf = r.colFinal;
    $('#colSub').textContent = r.columns.length ? `${r.columns.length} mezzanine column${r.columns.length > 1 ? 's' : ''} · ${r.colGroups.length} load case${r.colGroups.length > 1 ? 's' : ''}` : 'no mezzanine columns in this layout';
    if (!r.columns.length) $('#colCards').innerHTML = '<div class="empty">Every beam end lands on a building column.</div>';
    else if (!cf) $('#colCards').innerHTML = '<div class="member"><div class="section-big" style="color:var(--red)">No column</div></div>';
    else {
      $('#colCards').innerHTML = `<div class="member">
        <div class="member-top"><div>
          <div class="member-mark"><i style="background:var(--red)"></i>MC1 · ${r.columns.length} column${r.columns.length > 1 ? 's' : ''}${s.colOverride ? ' · picked by hand' : ''}</div>
          <div class="section-big">${esc(cf.quoteAs)}</div>
          <div class="section-parts">${cf.quoteAs !== cf.name ? 'run as ' + cf.name + ' · ' : ''}Fy 50 · d ${WF[cf.name].d}" · bf ${WF[cf.name].bf}" · ${f(WF[cf.name].W, 0)} plf</div>
        </div>${ring(cf.max, 1)}</div>
        <dl class="facts-row"><div><dt>Length</dt><dd>${ft(r.colLen)}</dd></div><div><dt>Qty</dt><dd>${r.columns.length}</dd></div><div><dt>Max CSR</dt><dd>${f(cf.max, 3)}</dd></div><div><dt>Basis</dt><dd style="font-size:12px">${s.colLength === 'A' ? 'Floor → top of mezz' : 'Clear below beam'}</dd></div></dl>
        <div class="chips">${r.colGroups.map((g, i) => chip(g.cols.map(c => c.label).join(', '), `D ${f(g.loads.DL_L, 2)}/${f(g.loads.DL_R, 2)} · L ${f(g.loads.LL_L, 2)}/${f(g.loads.LL_R, 2)} → ${f(cf.checks[i].max, 3)}`, cf.checks[i].ok)).join('')}</div>
      </div>`;
    }
    $('#quoteText').textContent = RUN.quoteText(r, inp);
  }

  // ---------- copy / print ----------
  const copy = async () => {
    const txt = RUN.quoteText(state.res, state.inputs);
    try { await navigator.clipboard.writeText(txt); toast('Copied for the quote sheet'); } catch (e) {
      const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied for the quote sheet'); } catch (e2) { toast('Copy blocked — select the text'); }
      ta.remove();
    }
  };
  $('#copyQuote').onclick = copy; $('#copyQuote2').onclick = copy;
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
    $$('#joistSeg button').forEach(b => b.classList.toggle('is-active', b.dataset.j === (state.settings.joists || 'auto')));
    $('#planTitle').textContent = `Framing plan · ${inp.mezz.id || 'mezzanine'}`;
    $('#layWhy').textContent = `joists span ${lay.joists === 'y' ? 'across the width' : 'along the length'} — ${lay.why}`;
    $('#beamLinesIn').value = lay.beamLines.map(v => +v.toFixed(3)).join(', ');
    $('#supLinesIn').value = lay.supportLines.map(v => +v.toFixed(3)).join(', ');
    const L = g.length || 1, W = g.width || 1, fp = lay.footprint;
    // window: whole building unless the mezzanine is a small part of a long one
    let xa = 0, xb = L;
    if ((fp.x1 - fp.x0) / L < 0.4) { xa = Math.max(0, fp.x0 - 30); xb = Math.min(L, fp.x1 + 30); }
    const VW = 1100, M = 64, s = Math.min((VW - 2 * M) / (xb - xa), 560 / W), VH = W * s + 2 * M + 24;
    const X = x => M + (x - xa) * s, Y = y => M + 12 + (W - y) * s;
    const inX = x => x >= xa - 0.01 && x <= xb + 0.01;
    const o = [];
    o.push(`<defs><pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="var(--hatch)"/><line x1="0" y1="0" x2="0" y2="9" stroke="var(--green)" stroke-width=".7" opacity=".35"/></pattern>
      <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink)"/></marker></defs>`);
    // grid lines + bubbles
    g.xs.filter(inX).forEach(x => {
      o.push(`<line class="grid-line" x1="${X(x)}" y1="${Y(W) - 26}" x2="${X(x)}" y2="${Y(0) + 26}"/>`);
      [Y(W) - 38, Y(0) + 38].forEach(cy => o.push(`<g class="bubble"><circle cx="${X(x)}" cy="${cy}" r="11"/><text x="${X(x)}" y="${cy}">${g.xLabel(x)}</text></g>`));
    });
    // column lines: letters run over every column line (ridge included, as on the drawings) but only
    // lines that actually carry columns get a line and bubble
    const colY = new Set([0, W, ...g.lewY, ...g.rewY, ...g.interior.flat()].map(v => v.toFixed(2)));
    g.allY.filter(y => colY.has(y.toFixed(2))).forEach(y => {
      o.push(`<line class="grid-line" x1="${X(xa) - 26}" y1="${Y(y)}" x2="${X(xb) + 26}" y2="${Y(y)}"/>`);
      [X(xa) - 38, X(xb) + 38].forEach(cx => o.push(`<g class="bubble"><circle cx="${cx}" cy="${Y(y)}" r="11"/><text x="${cx}" y="${Y(y)}">${g.yLabel(y)}</text></g>`));
    });
    // bay dimensions along the top
    const xsw = g.xs.filter(inX);
    xsw.slice(1).forEach((x, i) => { const a = xsw[i]; o.push(`<text class="dim" x="${(X(a) + X(x)) / 2}" y="${Y(W) - 52}">${ft(x - a)}</text>`); });
    // building outline (clipped to window)
    o.push(`<rect class="bldg" x="${X(xa)}" y="${Y(W)}" width="${(xb - xa) * s}" height="${W * s}"/>`);
    if (xa > 0) o.push(`<text class="dim" x="${X(xa) - 6}" y="${Y(W) - 8}" text-anchor="start">⟵ ${ft(xa)} more to LEW</text>`);
    if (xb < L) o.push(`<text class="dim" x="${X(xb) + 6}" y="${Y(W) - 8}" text-anchor="end">${ft(L - xb)} more to REW ⟶</text>`);
    o.push(`<text class="dim" x="${X(xa) + 4}" y="${Y(0) - 6}" text-anchor="start">FSW</text><text class="dim" x="${X(xa) + 4}" y="${Y(W) + 24}" text-anchor="start">BSW</text>`);
    // footprint
    o.push(`<rect class="foot" x="${X(fp.x0)}" y="${Y(fp.y1)}" width="${(fp.x1 - fp.x0) * s}" height="${(fp.y1 - fp.y0) * s}"/>`);
    // trib band per beam (half way to the neighbouring beam line each side) — shown on hover
    const markIdx = id => r.marks.findIndex(mk => mk.beams.includes(id));
    lay.beams.forEach(b => {
      const mi = markIdx(b.id), i = lay.beamLines.indexOf(b.line);
      const a = i > 0 ? (lay.beamLines[i - 1] + b.line) / 2 : b.line, c = i < lay.beamLines.length - 1 ? (b.line + lay.beamLines[i + 1]) / 2 : b.line;
      if (lay.joists === 'y') o.push(`<rect class="trib" data-beam="${b.id}" x="${X(b.from)}" y="${Y(c)}" width="${(b.to - b.from) * s}" height="${(c - a) * s}" fill="${MARK_COLORS[mi % 4]}"/>`);
      else o.push(`<rect class="trib" data-beam="${b.id}" x="${X(a)}" y="${Y(b.to)}" width="${(c - a) * s}" height="${(b.to - b.from) * s}" fill="${MARK_COLORS[mi % 4]}"/>`);
    });
    // joists at spacing
    const sp = r.beamBase.Lb;
    if (sp > 0) {
      if (lay.joists === 'y') for (let x = fp.x0 + sp; x < fp.x1 - 0.01; x += sp) o.push(`<line class="joist" x1="${X(x)}" y1="${Y(fp.y0)}" x2="${X(x)}" y2="${Y(fp.y1)}"/>`);
      else for (let y = fp.y0 + sp; y < fp.y1 - 0.01; y += sp) o.push(`<line class="joist" x1="${X(fp.x0)}" y1="${Y(y)}" x2="${X(fp.x1)}" y2="${Y(y)}"/>`);
    }
    // beams
    lay.beams.forEach(b => {
      const mi = markIdx(b.id), mk = r.marks[mi];
      const [p, q] = b.ends;
      o.push(`<line class="beam" data-beam="${b.id}" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}" stroke="${MARK_COLORS[mi % 4]}"><title>${mk ? mk.mark + ' ' + (mk.desc || '') : ''} · span ${ft(b.span)} · trib ${ft(b.trib)}</title></line>`);
      const mx = (X(p.x) + X(q.x)) / 2, my = (Y(p.y) + Y(q.y)) / 2;
      o.push(`<text class="mk" x="${mx}" y="${my + (lay.joists === 'y' ? -8 : 4)}" dx="${lay.joists === 'y' ? 0 : 8}" text-anchor="${lay.joists === 'y' ? 'middle' : 'start'}" fill="${MARK_COLORS[mi % 4]}">${mk ? mk.mark : ''}</text>`);
    });
    // building columns
    const bcols = [];
    g.xs.filter(inX).forEach((x, i) => { bcols.push([x, 0], [x, W]); const fi = g.xs.indexOf(x); (g.interior[fi] || []).forEach(y => bcols.push([x, y])); });
    if (inX(0)) g.lewY.forEach(y => bcols.push([0, y]));
    if (inX(L)) g.rewY.forEach(y => bcols.push([L, y]));
    (g.fswX || []).filter(inX).forEach(x => bcols.push([x, 0])); (g.bswX || []).filter(inX).forEach(x => bcols.push([x, W]));
    bcols.forEach(([x, y]) => o.push(`<rect class="bcol" x="${X(x) - 4}" y="${Y(y) - 4}" width="8" height="8"/>`));
    // mezzanine columns
    lay.mezzCols.forEach(c => {
      const cx = X(c.x), cy = Y(c.y), R = 8, d = R * 0.7;
      o.push(`<g class="mcol"><circle cx="${cx}" cy="${cy}" r="${R}"/><path d="M${cx - d},${cy - d} L${cx + d},${cy + d} M${cx - d},${cy + d} L${cx + d},${cy - d}"/><title>Mezz column ${c.label}</title></g>`);
      o.push(`<text class="lbl" x="${cx + 11}" y="${cy + 15}">${c.label}</text>`);
    });
    // joist arrow in the first bay of the footprint
    if (lay.joists === 'y') {
      const x = (fp.x0 + Math.min(fp.x1, lay.supportLines[1] ?? fp.x1)) / 2 + sp / 2, y0 = lay.beamLines[0], y1 = lay.beamLines[1] ?? fp.y1;
      o.push(`<line class="arrow" x1="${X(x)}" y1="${Y(y0) - 10}" x2="${X(x)}" y2="${Y(y1) + 10}" marker-start="url(#ah)" marker-end="url(#ah)"/><text class="arrow-t" x="${X(x) + 7}" y="${(Y(y0) + Y(y1)) / 2}">JOISTS @ ${ft(sp)}</text>`);
    } else {
      const y = (fp.y0 + Math.min(fp.y1, lay.supportLines[1] ?? fp.y1)) / 2 + sp / 2, x0 = lay.beamLines[0], x1 = lay.beamLines[1] ?? fp.x1;
      o.push(`<line class="arrow" x1="${X(x0) + 10}" y1="${Y(y)}" x2="${X(x1) - 10}" y2="${Y(y)}" marker-start="url(#ah)" marker-end="url(#ah)"/><text class="arrow-t" x="${(X(x0) + X(x1)) / 2}" y="${Y(y) - 7}" text-anchor="middle">JOISTS @ ${ft(sp)}</text>`);
    }
    $('#planSvg').setAttribute('viewBox', `0 0 ${VW} ${VH}`);
    $('#planSvg').innerHTML = o.join('');
    $$('#planSvg .beam').forEach(el => {
      const t = $(`#planSvg .trib[data-beam="${el.dataset.beam}"]`);
      el.addEventListener('mouseenter', () => t && t.classList.add('on'));
      el.addEventListener('mouseleave', () => t && t.classList.remove('on'));
    });
    $('#planLegend').innerHTML = r.marks.map((mk, i) => `<span><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="${MARK_COLORS[i % 4]}" stroke-width="5"/></svg>${mk.mark} ${esc(mk.desc || '')} (${mk.qty})</span>`).join('') +
      `<span><svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--red)" stroke-width="2"/><path d="M4,4 L12,12 M4,12 L12,4" stroke="var(--red)" stroke-width="2"/></svg>Mezzanine column (${lay.mezzCols.length})</span>` +
      `<span><svg width="10" height="10"><rect width="8" height="8" x="1" y="1" fill="var(--ink)"/></svg>Building column</span><span><svg width="22" height="10"><rect width="22" height="10" fill="url(#hatch)" stroke="var(--green)"/></svg>Mezzanine footprint</span>`;
    // tables
    const markOf = id => r.marks.find(mk => mk.beams.includes(id));
    $('#beamTable').innerHTML = `<thead><tr><th>#</th><th>Line</th><th>From → to</th><th class="num">Span</th><th class="num">Trib</th><th>Mark</th><th>Section</th></tr></thead><tbody>` +
      lay.beams.map(b => { const mk = markOf(b.id); const lab = lay.joists === 'y' ? g.yLabel(b.line) : g.xLabel(b.line); const fl = lay.joists === 'y' ? g.xLabel : g.yLabel;
        return `<tr><td class="num">${b.id + 1}</td><td>${lab || '~' + ft(b.line)}</td><td>${fl(b.from) || ft(b.from)} → ${fl(b.to) || ft(b.to)}</td><td class="num">${ft(b.span)}</td><td class="num">${ft(b.trib)}</td><td>${mk ? mk.mark : ''}</td><td class="mono">${mk && mk.desc ? mk.desc : '—'}</td></tr>`; }).join('') + '</tbody>';
    $('#supTable').innerHTML = `<thead><tr><th>Support</th><th>Type</th><th class="num">Left D / L (k)</th><th class="num">Right D / L (k)</th></tr></thead><tbody>` +
      lay.supports.slice().sort((a, b) => a.building - b.building || a.x - b.x || a.y - b.y).map(sp2 => {
        const c = r.columns.find(c => c.label === sp2.label);
        return `<tr><td>${sp2.label}</td><td>${sp2.building ? 'Building column' : '<b style="color:var(--red)">Mezzanine column ⊗</b>'}</td><td class="num">${c ? f(c.DL_L, 2) + ' / ' + f(c.LL_L, 2) : ''}</td><td class="num">${c ? f(c.DL_R, 2) + ' / ' + f(c.LL_R, 2) : ''}</td></tr>`;
      }).join('') + '</tbody>';
  }

  // ---------- beam calc (MB sheet mirror) ----------
  function renderBeam() {
    const r = state.res, s = state.settings, inp = state.inputs;
    $('#markTabs').innerHTML = r.marks.map((mk, i) => `<button class="tab ${i === state.mark ? 'is-active' : ''}" data-i="${i}">${mk.mark} · ${esc(mk.desc || 'none')} · ${ft(mk.span)} × ${ft(mk.trib)}</button>`).join('');
    $$('#markTabs .tab').forEach(t => { t.onclick = () => { state.mark = +t.dataset.i; renderBeam(); }; });
    const mk = r.marks[state.mark];
    if (!mk) { $('#mbSheet').innerHTML = '<div class="empty">No beams.</div>'; return; }
    $('#beamCalcTitle').innerHTML = `${mk.mark} · <span class="nocase">${esc(mk.desc || 'no section')}</span>`;
    const c = mk.check, p = mk.params;
    const kv = rows => `<div class="kv">${rows.map(([k, v, cls]) => `<span>${k}</span><span class="${cls || ''}">${v}</span>`).join('')}</div>`;
    if (!c) { $('#mbSheet').innerHTML = '<div class="empty">No passing section in the depth range.</div>'; }
    else {
      const x = c.res, st = t => (/NG/.test(t) ? 'ng' : 'okc');
      const clear = r.clear;
      const clr = (k, lab) => [lab, `${clear[k].req != null ? f(clear[k].req, 2) : '—'} req · ${clear[k].prov != null ? f(clear[k].prov, 2) : '—'} prov ${clear[k].ok === false ? '· NO GOOD' : clear[k].ok ? '· OK' : ''}`, clear[k].ok === false ? 'ng' : ''];
      $('#mbSheet').innerHTML = `<div class="sheet">
        <div>
          <h4>INPUT sheet</h4>${kv([
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
          ])}
        </div>
        <div>
          <h4>Floor dead load (unfactored)</h4>${kv([['Shear at left / right, kips', f(c.V.D, 3)], ['Moment, ft.-kips', f(c.M.D, 3)], ['Max. deflection (in)', f(c.defl.DL, 3)], ['Deflection', 'L / ' + f(c.defl.rDL, 0)]])}
          <h4 style="margin-top:14px">Floor live load (unfactored)</h4>${kv([['Shear at left / right, kips', f(c.V.L, 3)], ['Moment, ft.-kips', f(c.M.L, 3)], ['Max. deflection (in)', f(c.defl.LL, 3)], ['Deflection', 'L / ' + f(c.defl.rLL, 0) + (c.llOK ? '' : '  < L/360'), c.llOK ? 'okc' : 'ng']])}
          <h4 style="margin-top:14px">Total load (unfactored)</h4>${kv([['Shear at left / right, kips', f(c.V.T, 3)], ['Moment, ft.-kips', f(c.M.T, 3)], ['Max. deflection (in)', f(c.defl.TL, 3)], ['Deflection', 'L / ' + f(c.defl.rTL, 0) + (c.tlOK ? '' : '  < L/240'), c.tlOK ? 'okc' : 'ng']])}
          <h4 style="margin-top:14px">Strength results</h4><span class="status-line ${/NG/.test(c.combinedText) ? 'ng' : 'ok'}">${esc(c.combinedText)}</span><span class="status-line ${/NG/.test(c.shearText) ? 'ng' : 'ok'}">${esc(c.shearText)}</span>
          ${kv([['Main Report (MAX SR &gt; 1 = NG)', x.maxSR > 1 ? 'NG' : 'OK', x.maxSR > 1 ? 'ng' : 'okc']])}
        </div>
        <div>
          <h4>Section geometry</h4>${kv([
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
          ]) : '<div class="faint">n/a</div>'}
        </div></div>`;
    }
    // alternatives by depth
    const sr = mk.search;
    if (!sr) { $('#altTable').innerHTML = ''; return; }
    $('#altSub').textContent = `${sr.evaluated.toLocaleString()} stocked combinations checked for ${ft(mk.span)} span × ${ft(mk.trib)} trib · click a row to use it`;
    const best = sr.best && sr.best.desc;
    $('#altTable').innerHTML = `<thead><tr><th class="num">Depth</th><th>Section</th><th>Web</th><th>Flanges</th><th>Econ.</th><th class="num">Wt plf</th><th class="num">Combined</th><th class="num">Shear</th><th class="num">LL L/</th><th class="num">TL L/</th><th class="num">Bearing</th></tr></thead><tbody>` +
      sr.byDepth.map(a => a.none ? `<tr class="none"><td class="num">${a.d}"</td><td colspan="10">nothing stocked passes at this depth</td></tr>` :
        `<tr class="pick ${a.desc === best && sameSec(a.sec, sr.best.sec) ? 'is-best' : ''} ${mk.sec && sameSec(a.sec, mk.sec) ? 'is-chosen' : ''}" data-d="${a.d}"><td class="num">${a.d}"</td><td class="mono"><b>${a.desc}</b>${sameSec(a.sec, sr.best.sec) ? ' <span class="src pcs">lightest</span>' : ''}</td><td class="mono">${a.web} (${a.sec.tw})</td><td class="mono">${a.flange}</td><td>${a.tier}</td><td class="num">${f(a.wt, 2)}</td><td class="num">${f(a.CSR, 3)}</td><td class="num">${f(a.SRv, 3)}</td><td class="num">${f(a.rLL, 0)}</td><td class="num">${f(a.rTL, 0)}</td><td class="num">${f(a.conc, 2)}</td></tr>`).join('') + '</tbody>';
    $$('#altTable tr.pick').forEach(tr => { tr.onclick = () => pickAlt(mk.mark, tr.dataset.d); });
  }
  const sameSec = (a, b) => a && b && a.d === b.d && a.tw === b.tw && a.bof === b.bof && a.tof === b.tof && a.bif === b.bif && a.tif === b.tif;

  // ---------- column calc (Column sheet mirror) ----------
  function renderColumn() {
    const r = state.res, cf = r.colFinal;
    if (!r.colGroups.length) { $('#colTabs').innerHTML = ''; $('#colSheet').innerHTML = '<div class="empty">No mezzanine columns in this layout.</div>'; $('#colTried').innerHTML = ''; return; }
    $('#colTabs').innerHTML = r.colGroups.map((g, i) => `<button class="tab ${i === state.colGroup ? 'is-active' : ''}" data-i="${i}">MC · ${esc(g.cols.map(c => c.label).join(', '))}</button>`).join('');
    $$('#colTabs .tab').forEach(t => { t.onclick = () => { state.colGroup = +t.dataset.i; renderColumn(); }; });
    const g = r.colGroups[state.colGroup];
    const kv = rows => `<div class="kv">${rows.map(([k, v, cls]) => `<span>${k}</span><span class="${cls || ''}">${v}</span>`).join('')}</div>`;
    if (!cf) { $('#colSheet').innerHTML = '<div class="empty">No column passes.</div>'; }
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
          ['X-Axis Eccentricity, e (d/2)', f(chk.ex, 2) + ' in.'], ['Column self-weight (Wt·L/1000)', f(chk.wt, 3) + ' kip'], ['Columns in this case', esc(g.cols.map(c => c.label).join(', '))],
        ])}</div>
        <div class="full"><h4>Load combinations</h4><table><thead><tr><th></th>${names.map(n => `<th class="num">${n}</th>`).join('')}</tr></thead><tbody>
          <tr><td>Mx (ft-kip)</td>${chk.combos.map(k => `<td class="num">${f(k.Mx, 2)}</td>`).join('')}</tr>
          <tr><td>Axial (kip)</td>${chk.combos.map(k => `<td class="num">${f(k.P, 2)}</td>`).join('')}</tr>
          <tr><td>Maximum CSR</td>${chk.combos.map(k => `<td class="num">${f(k.csr, 3)}</td>`).join('')}</tr>
          <tr><td>Design results</td>${chk.combos.map(k => `<td class="num"><span class="status-text ${k.ok ? 'ok' : 'ng'}">${k.okText}</span></td>`).join('')}</tr>
        </tbody></table>
        <p class="foot-note">${r.edition.colEd === '16' ? '16th-edition sheet: C10 (Lby) is hard-coded to 120 in. — type L×12 when you check it in Excel.' : 'Run in the Mezzanine Column (AISC ' + (r.edition.colEd || '15') + 'th) sheet.'}</p></div>
      </div>`;
    }
    const tried = g.design ? g.design.tried : [];
    $('#colTried').innerHTML = `<thead><tr><th>Section</th><th class="num">Wt plf</th><th class="num">bf</th><th class="num">Max CSR</th><th>Result</th><th>Quote as</th></tr></thead><tbody>` +
      tried.map(t => { const q = DESIGN.COMMON_COLUMNS.includes(t.name) || t.name === 'W8X18' ? t.name : t.name.replace(/^W(\d+)X/, 'BU$1x');
        return `<tr class="pick ${cf && cf.name === t.name ? 'is-chosen' : ''}" data-n="${t.name}"><td class="mono"><b>${t.name}</b></td><td class="num">${f(WF[t.name].W, 0)}</td><td class="num">${WF[t.name].bf}</td><td class="num">${f(t.max, 3)}</td><td><span class="status-text ${t.ok ? 'ok' : 'ng'}">${t.ok ? 'OK' : 'NG'}</span></td><td class="mono">${q}</td></tr>`; }).join('') +
      `<tr><td colspan="6"><div class="field wide" style="border:0"><label>Use a different W for every mezzanine column</label><select id="colPick"><option value="">Automatic (${g.design && g.design.name ? g.design.name : '—'})</option>${Object.keys(WF).filter(k => /^W(6|8|10|12|14)X/.test(k)).sort((a, b) => WF[a].W - WF[b].W).map(k => `<option ${state.settings.colOverride === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></td></tr></tbody>`;
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
  function field(path, label, kind, sub) {
    const [grp, key] = path.split('.');
    const node = state.inputs[grp][key];
    const isObj = node && typeof node === 'object' && !Array.isArray(node) && 'value' in node;
    const val = isObj ? node.value : node;
    let shown = '';
    if (kind === 'ftin') shown = val == null ? '' : ft(val);
    else if (kind === 'in') shown = val == null ? '' : +(val * 12).toFixed(4);
    else if (kind === 'list') shown = compress(val);
    else shown = val == null ? '' : val;
    const src = isObj ? node.source : (grp === 'building' ? 'pcs' : '');
    const badge = src ? `<span class="src ${src}" title="${esc(isObj && node.note ? node.note : '')}">${({ pcs: 'PCS', annotation: 'note', deckGuide: 'guide', default: 'std', estimate: 'est.', missing: 'missing', manual: 'edit' })[src] || src}</span>` : '';
    const note = isObj && node.note ? `<small>${esc(node.note)}</small>` : sub ? `<small>${esc(sub)}</small>` : '';
    return `<div class="field ${kind === 'list' ? 'wide' : ''}"><label>${label}${badge}${note}</label><input data-path="${path}" data-kind="${kind}" value="${esc(shown)}"></div>`;
  }
  function renderInputs() {
    const inp = state.inputs, r = state.res;
    const checks = (grp, title) => {
      const c = inp.mezz && state.pcs && state.pcs.mezzanines[state.mi] && state.pcs.mezzanines[state.mi].checks && state.pcs.mezzanines[state.mi].checks[grp];
      if (!c || !Object.keys(c).length) return '';
      return `<div class="field wide" style="grid-template-columns:1fr"><label>${title}</label><div class="checks">${Object.entries(c).map(([k, v]) => `<span class="check ${v ? 'on' : ''}">${v ? '☑' : '☐'} ${esc(k)}</span>`).join('')}</div></div>`;
    };
    $('#inputsGrid').innerHTML = [
      '<div class="group-title">Mezzanine loading (Box 22)</div>',
      field('loads.dead', 'Dead, (psf)', 'num'), field('loads.coll', 'Collateral, (psf)', 'num'), field('loads.live', 'Live, (psf)', 'num'),
      field('loads.partition', 'Partition, (psf)', 'num', `added to ${state.settings.partitionTo}`), field('loads.joistWt', 'Est. joist wt., (psf)', 'num'),
      '<div class="group-title">Elevations &amp; joists</div>',
      field('geom.A', '(A) Finish floor to top of mezzanine', 'ftin'), field('geom.B', '(B) Min. clearance under joist', 'ftin'), field('geom.C', '(C) Min. clearance under floor beams', 'ftin'),
      field('geom.slab', 'Slab & deck thickness, (in.)', 'in'), field('geom.seat', 'Joist seat depth, (in.)', 'in'), field('geom.joistSpacing', 'Joist spacing (= beam Lb)', 'ftin'),
      `<div class="field"><label>Total joist depth, (in.)<small>A − B − slab − seat</small></label><div class="calc">${r.joistDepthIn != null ? f(r.joistDepthIn, 2) + '"' : '—'}</div></div>`,
      '<div class="group-title">Mezzanine footprint</div>',
      field('geom.width', 'Width (along endwall)', 'ftin'), field('geom.length', 'Length (along sidewall)', 'ftin'), field('geom.startLEW', 'Start from LEW', 'ftin'), field('geom.startFSW', 'Start from FSW', 'ftin'),
      checks('material', 'Material (not by seller)'), checks('use', 'Floor use'), checks('provided', 'Materials provided by seller'),
      '<div class="group-title">Building (Box 2 / Box 5)</div>',
      field('building.width', 'Building width', 'ftin'), field('building.length', 'Building length', 'ftin'),
      field('building.bays', 'Sidewall bay spacing (from LEW)', 'list'), field('building.lewCols', 'LEW column spacing (from FSW)', 'list'), field('building.rewCols', 'REW column spacing (from FSW)', 'list'),
      `<div class="field wide"><label>Frames<small>interior modules from FSW</small></label><div class="calc" style="font-weight:400;font-size:12px">${(inp.building.frames || []).map(fr => `${fr.from}${fr.to !== fr.from ? '–' + fr.to : ''}: ${compress(fr.interior) || '—'}`).join(' · ') || 'clear span'}</div></div>`,
    ].join('');
    $$('#inputsGrid input').forEach(el => { el.onchange = () => onInput(el); });
  }
  function onInput(el) {
    const [grp, key] = el.dataset.path.split('.'), kind = el.dataset.kind, raw = el.value.trim();
    let val;
    if (kind === 'ftin') val = raw === '' ? null : (PCS.ftin(raw) ?? PCS.ftin(raw + "'"));
    else if (kind === 'in') val = raw === '' ? null : parseFloat(raw) / 12;
    else if (kind === 'list') val = parseSpacing(raw);
    else val = raw === '' ? null : parseFloat(raw);
    if (kind !== 'list' && raw !== '' && (val == null || !isFinite(val))) { toast('Could not read "' + raw + '"'); renderInputs(); return; }
    const node = state.inputs[grp][key];
    if (node && typeof node === 'object' && !Array.isArray(node) && 'value' in node) state.inputs[grp][key] = { value: val, source: 'manual' };
    else state.inputs[grp][key] = val;
    delete state.settings.xLines; delete state.settings.yLines;
    recompute();
  }

  // ---------- settings ----------
  function renderSettings() {
    const s = state.settings;
    const sel = (key, label, opts, sub) => `<div class="field"><label>${label}${sub ? `<small>${sub}</small>` : ''}</label><select data-set="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    const num = (key, label, sub, step) => `<div class="field"><label>${label}${sub ? `<small>${sub}</small>` : ''}</label><input type="number" step="${step || 1}" data-set="${key}" data-num="1" value="${s[key]}"></div>`;
    const code = state.inputs && state.inputs.job.code;
    $('#settingsGrid').innerHTML = [
      '<div class="group-title">Code &amp; stock</div>',
      sel('edition', 'Workbook edition', [['auto', 'Auto from PCS' + (code && code.edition ? ' (' + code.edition + 'th)' : '')], ['15', 'AISC 15th (360-16)'], ['16', 'AISC 16th (360-22)'], ['13', 'AISC 13th (360-05)']], 'IBC 2018/2021 → 15th · IBC 2024 → 16th'),
      sel('division', 'Division stock', [['auto', 'Auto from PCS'], ...DESIGN.DIVISIONS.map(d => [d, d])], 'DM 5.1 flange / web / WF stock'),
      '<div class="group-title">Beam search</div>',
      num('target', 'Target SR (combined & shear)', '≤ this; the sheet says NG at 1.00', 0.01),
      num('dMin', 'Min. depth, (in.)'), num('dMax', 'Max. depth, (in.)', 'also capped by clearance (C) when given'),
      sel('symmetric', 'Flanges', [['true', 'Same top and bottom'], ['false', 'Allow unequal (IF ≤ OF width)']]),
      sel('requireConc', 'Joist bearing check (MB L7)', [['true', 'Must pass'], ['false', 'Report only']]),
      sel('marks', 'Beam marks', [['single', 'One governing mark (max span & trib)'], ['split', 'Split by trib / span (guide)']]),
      sel('partitionTo', 'Partition load', [['live', 'Add to live'], ['dead', 'Add to dead']]),
      '<div class="group-title">Columns</div>',
      sel('colLength', 'Column length L', [['A', 'Finish floor to top of mezzanine (A)'], ['clear', 'Clear below mezzanine beam (guide)']]),
      sel('includeW818', 'Also try W8X18', [['false', 'No — W10X22, W8X24, W12X26'], ['true', 'Yes (stocked at most divisions)']]),
    ].join('');
    $$('#settingsGrid [data-set]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.set; let v = el.value;
        if (el.dataset.num) v = parseFloat(v); else if (v === 'true' || v === 'false') v = v === 'true';
        state.settings[k] = v;
        if (k === 'marks') { state.settings.override = {}; state.mark = 0; }
        if (state.inputs) recompute(); else renderSettings();
      };
    });
  }
  renderSettings();
})();
