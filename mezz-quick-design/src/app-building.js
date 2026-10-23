/* The whole-building pages of the tool: Project & files, Building (3D site, site plan, every frame line), Snow & drift,
   Frames (one frame line with every load drawn), Bracing (each sidewall with its X-bracing, portal frames, strut lines
   and EQB / EQF) and Purlins. Mounted by src/app.js with its state and helpers (C); src/building.js draws, src/site.js
   and src/snow.js work the numbers. */
window.MZ_APP_BUILDING = function (C) {
  'use strict';
  const { state, $, $$, esc, ft, f, n0, go, toast, recompute, M3, B, SITE, SNOW, FF, sameName, inpOf, addFrameFiles, addSeisFiles, bracingPlan, zipIO, cpSave } = C;
  const F1 = v => f(v, 1), F2 = v => f(v, 2), F3 = v => f(v, 3);
  const JOB_VIEWS = new Set(['upload', 'building', 'snow', 'seismic', 'frames', 'bracing', 'purlins']);
  const MEZZ_VIEWS = new Set(['results', 'inputs', 'plan', 'beam', 'column', 'designer']);
  let bldModel = null, snowRestored = null;
  const DEFAULT_PURLIN = 5;
  const WALLS = ['FSW', 'BSW', 'LEW', 'REW'];
  const mezzName = id => (/^mezz/i.test(String(id)) ? String(id) : 'Mezz ' + id);

  // ---------- workspaces: the whole building, or the mezzanines ----------
  function setWs(ws) {
    if (state.ws === ws) return;
    state.ws = ws;
    document.body.dataset.ws = ws;
    $('#railTitle').textContent = ws === 'mezz' ? 'Mezzanine design' : 'Building design';
    $('#mastTitle').textContent = ws === 'mezz' ? 'Mezzanine design' : 'Building design';
    const tabs = $('#mezzTabs');
    if (tabs) tabs.classList.toggle('ws-off', ws !== 'mezz');
  }
  const wsOf = view => (MEZZ_VIEWS.has(view) ? 'mezz' : JOB_VIEWS.has(view) ? 'job' : null);
  $$('[data-ws]').forEach(b => { b.onclick = () => { const ws = b.dataset.ws; setWs(ws); go(ws === 'mezz' ? 'results' : 'building'); }; });
  const navMezz = $('#navMezz');
  if (navMezz) navMezz.onclick = () => { setWs('mezz'); go('results'); };

  // ---------- the snow job: facts from the PCS and the Seismic page's code, the page's own entries over them ----------
  const snowKey = () => (state.pcs && state.pcs.job && state.pcs.job.quote ? 'mzd.snow.' + state.pcs.job.quote : null);
  function snowSave() { const k = snowKey(); if (!k) return; try { localStorage.setItem(k, JSON.stringify(state.snow || {})); } catch (e) { /* session only */ } }
  function snowLoad() { const k = snowKey(); try { const c = k && JSON.parse(localStorage.getItem(k) || 'null'); snowRestored = !!(c && Object.keys(c).length); return c || {}; } catch (e) { return {}; } }
  function facts() {
    const pcs = state.pcs || {}, ps = pcs.seismic || {}, sj = state.job && state.job.seismic, c = state.snow || {};
    const ed = (sj && sj.inputs && sj.inputs.ed && sj.inputs.ed.value) || SNOW.editionOf(pcs.code && pcs.code.text).ed;
    const risk = c.risk || (sj && sj.inputs && sj.inputs.risk && sj.inputs.risk.value) || ps.risk || 'II';
    const src = (k, typed, pcsV, dflt) => (typed != null && typed !== '' ? { value: +typed, source: 'typed' } : pcsV != null ? { value: pcsV, source: 'PCS' } : { value: dflt, source: dflt == null ? 'missing' : 'default' });
    return { ed, risk, riskSrc: c.risk ? 'typed' : 'PCS', pg: src('pg', c.pg, ps.groundSnow, null), Ce: src('Ce', c.Ce, ps.Ce, 1), W2: src('W2', c.W2, ps.W2, null), ceText: ps.ceText || null };
  }
  function compute() {
    state.snowJob = null;
    if (!state.pcs || !state.pcs.site) return;
    const F = facts();
    if (!(F.pg.value > 0)) return;
    try {
      state.snowJob = SITE.snowJob(state.pcs, { ed: F.ed, pg: F.pg.value, Ce: F.Ce.value, risk: F.risk, W2: F.W2.value }, state.snow || {});
      state.snowJob.F = F;
    } catch (e) { console.error(e); state.snowJob = { error: e.message, site: { buildings: [] }, roofs: [], drifts: [], notes: [], F }; }
  }
  // the mezzanines as boxes in their own building's plan, with their columns (for the site drawings)
  const mezzBoxes = () => ((state.job && state.job.mezz) || []).filter(m => !m.incomplete && m.layout && m.layout.footprint.x1 > m.layout.footprint.x0).map(m => { const fp = m.layout.footprint, inp = inpOf(m); return { building: inp.mezz.building || (state.pcs && state.pcs.planBuilding) || '', id: m.id, x0: fp.x0, x1: fp.x1, y0: fp.y0, y1: fp.y1, A: inp.geom.A.value ?? 12, cols: (m.layout.mezzCols || []).map(c => ({ x: c.x, y: c.y })) }; });
  const sb = name => (state.job && state.job.seismic ? state.job.seismic.buildings.find(b => sameName(b.name, name)) : null);
  const siteB = name => (state.snowJob ? state.snowJob.site.buildings.find(b => sameName(b.name, name)) : null);
  const pcsB = name => { const e = Object.entries((state.pcs && state.pcs.site) || {}).find(([n]) => sameName(n, name)); return e ? e[1] : null; };

  /* ---------- the bracing of one building, wall by wall, from the best source there is: the bracing file (its bays and
     tiers), else the eScope, else PCS Box 12. bays: [{ from, to (0-based frame line indices), tiers: [[z0, z1]], kind:
     'x' | 'portal' | 'roofx', src }]; open: the PCS names the wall's bracing but not the bay (TBD, Per Seller) */
  function bracingOf(name) {
    const bS = sb(name), bf = bS && (state.bracing || {})[bS.bkey], scopeB = state.scope && state.scope.buildings.find(x => sameName(x.name, name));
    const pb = ((pcsB(name) || {}).bracing) || {};
    const out = { src: bf ? 'the bracing file' : scopeB ? 'the eScope' : Object.values(pb).some(w => w.kind !== 'none') ? 'PCS Box 12' : null, walls: {} };
    WALLS.forEach(w => {
      let bays = null;
      const pw = pb[w] || null, kind = pw ? pw.kind : 'x';
      let check = null;
      if (bf && bf.file.info.walls[w]) {
        bays = bf.file.info.walls[w].bays.filter(x => x.braced).map(x => ({ from: x.from, to: x.to, tiers: [...new Set(x.braces.map(t => `${t.bottom}|${t.top}`))].map(q => q.split('|').map(Number)), kind: 'x', src: 'file' }));
        // the bracing file against PCS Box 12, bay by bay (bay n: frame lines n to n + 1). Portal frames are not rods, so a
        // PCS portal bay the file leaves bare is drawn from the PCS.
        const fileN = bays.map(q => q.from + 1), list = a => a.join(', ');
        const pre = `${name} ${w}: PCS Box 12 asks for ${pw ? pw.type : ''}`;
        if (pw && pw.kind === 'portal' && pw.bays.length) {
          const clash = pw.bays.filter(n => fileN.includes(n));
          bays = bays.concat(pw.bays.filter(n => !fileN.includes(n)).map(n => ({ from: n - 1, to: n, tiers: [], kind: 'portal', src: 'PCS' })));
          if (clash.length) check = { level: 'warn', text: `${pre} in bay${pw.bays.length > 1 ? 's' : ''} ${list(pw.bays)}; ${bf.name} has X-bracing rods in bay${clash.length > 1 ? 's' : ''} ${list(clash)} instead — check which the wall gets.` };
        } else if (pw && pw.kind === 'x' && pw.bays.length) {
          const miss = pw.bays.filter(n => !fileN.includes(n)), extra = fileN.filter(n => !pw.bays.includes(n));
          if (!fileN.length) check = { level: 'warn', text: `${pre} in bay${pw.bays.length > 1 ? 's' : ''} ${list(pw.bays)}; ${bf.name} has no braced bay on this wall yet.` };
          else if (miss.length || extra.length) check = { level: 'warn', text: `${pre} in bay${pw.bays.length > 1 ? 's' : ''} ${list(pw.bays)}; ${bf.name} braces bay${fileN.length > 1 ? 's' : ''} ${list(fileN)}.` };
        } else if (pw && pw.kind === 'none' && fileN.length) check = { level: 'warn', text: `${name} ${w}: PCS Box 12 lists no bracing on this wall; ${bf.name} braces bay${fileN.length > 1 ? 's' : ''} ${list(fileN)}.` };
      } else if (scopeB && scopeB.bracing && (scopeB.bracing[w] || []).some(t => (t.bays || []).length)) bays = scopeB.bracing[w].flatMap(t => (t.bays || []).map(n => ({ from: n - 1, to: n, tiers: [], kind: /portal/i.test(t.type || '') ? 'portal' : 'x', src: 'eScope' })));
      else if (pw && pw.kind !== 'none') bays = pw.kind === 'roofx' ? [{ from: 0, to: 1, tiers: [], kind: 'roofx', src: 'PCS' }] : pw.bays.map(n => ({ from: n - 1, to: n, tiers: [], kind, src: 'PCS' }));
      out.walls[w] = { bays: bays || [], type: pw ? pw.type : null, kind: pw ? pw.kind : null, open: pw && pw.kind !== 'none' && pw.kind !== 'roofx' && !(bays && bays.length) ? pw.baysText : null, pcs: pw, check, fromFile: !!(bf && bf.file.info.walls[w]) };
    });
    return out;
  }
  const bracingAll = () => Object.fromEntries((state.snowJob ? state.snowJob.site.buildings : []).map(b => { const br = bracingOf(b.name); return [b.name, Object.fromEntries(WALLS.map(w => [w, br.walls[w].bays]))]; }));

  // the loads one frame line takes beside the snow: NBG Frame's roof dead + collateral, the mezzanine's FDL / FLL on its
  // columns, the seismic EQR / EQL (or their place, while the Seismic page waits), a designed lean-to's reactions
  function ext(name, no) {
    const b = sb(name), sj = state.job && state.job.seismic, fe = ((state.job && state.job.frameEntries) || []).find(x => String(x.frame) === String(no) && (!x.building || sameName(x.building, name)));
    const atOf = e => (state.nbg.height === 'beam' ? e.elev : e.A != null ? e.A : e.elev);
    const mezz = fe ? fe.entries.filter(e => e.member).map(e => ({ y: e.y, elev: atOf(e), D: e.D, L: e.L, member: e.member, label: e.label })) : [];
    const fr = b ? (b.frames || []).find(x => String(x.label) === String(no)) : null;
    let eq = fr ? fr.eqs.map(q => { const e = fe && fe.entries.find(z => z.label === q.label); return { y: e ? e.y : 0, at: q.at, F: q.F, member: q.member }; }) : [];
    if (!eq.length && sj && !sj.ok && mezz.length) eq = mezz.map(e => ({ y: e.y, at: e.elev, F: null, member: e.member }));
    const lean = (state.leanTo && state.leanTo.applied || []).filter(q => sameName(q.building, name) && String(q.frame) === String(no)).map(q => ({ y: q.y, at: q.at, text: `${q.cases.length} cases · SL ${F2(q.SL)} k` }));
    return { deadPsf: b ? b.roof.RDL.value : null, collPsf: b ? b.roof.CDL.value : null, mezz, eq, leanTo: lean };
  }
  const frameData = (name, no) => (state.snowJob && state.snowJob.site.buildings.length ? B.frameData(state.snowJob, name, no, ext(name, no)) : null);
  function selectFrame(name, no, open) {
    state.frameSel = { building: name, frame: +no };
    renderFrames(); renderBldPlan();
    if (open) go('frames');
  }
  const kft = v => (v == null ? '—' : `${F3(Math.abs(v))} k/ft`);
  const wirePlan = (root, open) => $$(root + ' .sp-fl').forEach(g => { const act = () => selectFrame(g.dataset.bldg, +g.dataset.frame, open); g.onclick = act; g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } }; });

  // ---------- Project & files ----------
  function renderProject() {
    const box = $('#projectSummary');
    if (!box) return;
    if (!state.pcs) { box.innerHTML = ''; return; }
    const pcs = state.pcs, J = state.snowJob, site = J ? J.site : null, files = state.nbg.files || [], br = Object.entries(state.bracing || {}), scope = state.scope;
    const brText = b => { const w = b.bracing || {}; const groups = {}; WALLS.forEach(k => { if (!w[k]) return; const key = `${w[k].type}|${w[k].baysText}`; (groups[key] = groups[key] || { walls: [], v: w[k] }).walls.push(k); }); const parts = Object.values(groups).map(g => `${g.walls.join(', ')} ${g.v.type}${g.v.kind !== 'none' && g.v.kind !== 'roofx' ? ` bay${g.v.bays.length > 1 ? 's' : ''} ${g.v.baysText}` : ''}`); return parts.length ? parts.join(' · ') : 'not listed'; };
    const bl = Object.entries(pcs.site || {}).map(([n, b]) => { const g = b.building || {}, r = b.roof || {}; return `<div class="pj-bldg"><b>${esc(n)}</b><span>${esc(g.profile || '')} · ${ft(g.width)} × ${ft(g.length)}</span><span>eaves ${ft(g.eaveFSW)} / ${ft(g.eaveBSW)} · ${(g.bays || []).length} bays</span><span>snow ${r.snow && r.snow.value != null ? F1(r.snow.value) + ' psf' + (r.snow.override ? ' (override)' : '') : '—'} · Ct ${r.Ct ?? '—'}</span><span>bracing (Box 12): ${esc(brText(b))}</span></div>`; }).join('');
    const att = (pcs.attachments || []).map(a => `<li>${esc(a.building)} ${a.wall} → ${esc(a.to)} ${a.toWall}${a.at ? ` at ${ft(a.at)}` : ''}</li>`).join('');
    const loaded = [...files.map(x => `<li><i class="pj-k">frame</i>${esc(x.name)}${x.ff ? ` <small>${esc(x.ff.info.building || '')} · lines ${esc(x.lines)}</small>` : x.err ? ` <small class="bad">${esc(x.err)}</small>` : ''}</li>`), ...br.map(([k, v]) => `<li><i class="pj-k">bracing</i>${esc(v.name)} <small>${v.file.info.lines.length} frame lines</small></li>`), ...(scope ? [`<li><i class="pj-k">eScope</i>${esc(scope.name)} <small>${esc(scope.code || '')}</small></li>`] : [])];
    const F = J && J.F;
    box.innerHTML = `<div class="pj">
      <div class="pj-head"><div><div class="eyebrow">This project</div><h3>${esc(pcs.job.quote || '')}${pcs.job.project ? ` · ${esc(pcs.job.project)}` : ''}</h3><small>${esc((pcs.code || {}).text || '')} · Risk ${esc((pcs.seismic || {}).risk || '—')} · ${site ? site.buildings.length : Object.keys(pcs.site || {}).length} building${site && site.buildings.length !== 1 ? 's' : ''} · ${pcs.mezzanines.length} mezzanine${pcs.mezzanines.length !== 1 ? 's' : ''}</small></div>
        <div class="pj-acts"><button class="btn-soft" data-go="building"><svg><use href="#i-bldg"/></svg>Open the building</button><button class="btn-ghost" data-go="results">Mezzanines</button></div></div>
      ${pcs.otherDoc ? `<div class="seis-msg info">This PDF holds two versions of the quote: <b>${esc(pcs.otherDoc.current || 'the first')}</b> (read) and, from page ${pcs.otherDoc.page}, <b>${esc(pcs.otherDoc.label || 'an earlier one')}</b> — not read; its values are superseded.</div>` : ''}
      <div class="pj-grid">
        <div class="pj-card"><h4>Buildings <small>PCS Box 2 / 4 / 12</small></h4>${bl}${att ? `<ul class="pj-list">${att}</ul>` : ''}</div>
        <div class="pj-card"><h4>Loads <small>PCS Box 3</small></h4><div class="pj-facts">${F ? `<span>Ground snow <b>${F.pg.value != null ? F1(F.pg.value) + ' psf' : '—'}</b></span><span>Ce <b>${F2(F.Ce.value)}</b>${F.ceText ? ` <small>${esc(F.ceText)}</small>` : ''}</span><span>ASCE <b>${esc(F.ed)}</b></span>` : ''}<span>Ss <b>${esc((pcs.seismic || {}).Ss ?? '—')}</b> · S1 <b>${esc((pcs.seismic || {}).S1 ?? '—')}</b></span><span>Site <b>${esc((pcs.seismic || {}).siteClass || '—')}</b></span></div>
          <div class="pj-links"><a href="#" data-go="snow">Snow &amp; drift</a><a href="#" data-go="seismic">Seismic</a><a href="#" data-go="frames">Frames</a><a href="#" data-go="bracing">Bracing</a></div></div>
        <div class="pj-card pj-files"><h4>The job's NBG files <small>frame · bracing · eScope</small></h4>
          <label class="nbg-drop pj-drop" id="pjDrop"><input type="file" id="pjFile" accept=".frame,.bracing,.nbgscope" multiple><svg><use href="#i-file"/></svg><span><strong>Drop the .frame, .bracing and .nbgscope files here</strong><small>each goes where it belongs: frame files get their loads on the Frames page, the bracing file its EQB / EQF on the Bracing page, the eScope fills in the code and loads</small></span></label>
          ${loaded.length ? `<ul class="pj-list">${loaded.join('')}</ul>` : '<small class="sub-n">none yet</small>'}</div>
        <div class="pj-card"><h4>Hand-off <small>what the engineer checks</small></h4><p>The real NBG workbooks, filled by the tool, and the design basis with every input and where it came from.</p>
          <div class="pj-acts"><button class="btn-soft" data-cpdl="all"><svg><use href="#i-file"/></svg>Filled workbooks + design basis (.zip)</button><button class="btn-ghost" data-cpdl="xlsx">Design basis (.xlsx)</button></div><small class="sub-n">The workbooks are added once on the Design page (Calc package → Add workbooks); each copy is the original file with the job typed into it, so Excel recalculates everything itself.</small></div>
      </div></div>`;
    const inp = $('#pjFile'), drop = $('#pjDrop');
    const route = list => { const fr = list.filter(x => /\.frame$/i.test(x.name)), se = list.filter(x => /\.(bracing|nbgscope)$/i.test(x.name)); if (fr.length) addFrameFiles(fr); if (se.length) addSeisFiles(se); if (!fr.length && !se.length) toast('Drop .frame, .bracing or .nbgscope files'); };
    inp.onchange = () => { route(Array.from(inp.files || [])); inp.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', e => route(Array.from(e.dataTransfer.files || [])));
  }

  // ---------- Building ----------
  // one button, several kinds in the model: Snow = the snow layer, the drift and the falling flakes; Mezzanines = the
  // floors with their members and joists
  const TOGGLES = [['snow', 'Snow', ['snow', 'drift', 'flakes'], true], ['mezz', 'Mezzanines', ['mezz', 'joist', 'joists'], true], ['roof', 'Roofs', ['roof'], true], ['brace', 'Bracing', ['brace'], true], ['purlin', 'Purlins', ['purlin'], false]];
  const KEY = [['#8fa9c2', 'frames · endwall posts'], ['#5a7b9b', 'roof'], ['#f3f8ff', 'snow · drift'], ['#42e5ae', 'mezzanine floor'], ['#ff9f7a', 'mezzanine columns'], ['#f6c779', 'bracing · portal frames']];
  function renderBuilding() {
    const J = state.snowJob, el = $('#bldMetrics');
    if (!el) return;
    if (!J || !J.site.buildings.length) {
      $('#bldNeed').innerHTML = state.pcs ? `<div class="seis-msg warn">${J && J.error ? esc(J.error) : 'The site needs the ground snow load (PCS Box 3) — type it on the Snow & drift page.'}</div>` : '';
      el.innerHTML = ''; $('#bldPlan').innerHTML = ''; $('#bldFrames').innerHTML = ''; $('#bldNotes').innerHTML = ''; $('#bldKey').innerHTML = '';
      return;
    }
    const site = J.site, pcs = state.pcs, nF = site.buildings.reduce((a, b) => a + b.xs.length, 0), drifts = J.drifts.filter(d => !d.drift.none && !d.off);
    const mz = mezzBoxes(), brAll = bracingAll();
    $('#bldTitle').innerHTML = site.buildings.length > 1 ? `${site.buildings.map(b => esc(b.name)).join(' <em>+</em> ')}` : `<em>${esc(site.buildings[0].name)}</em>`;
    $('#bldEyebrow').textContent = `${pcs.job.quote || ''} · ${site.buildings.length} building${site.buildings.length > 1 ? 's' : ''} · ${nF} frame lines`;
    $('#bldNeed').innerHTML = '';
    const m = (lab, val, sub) => `<div class="metric"><span>${lab}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const nBraced = Object.values(brAll).reduce((a, w) => a + Object.values(w).reduce((c, bays) => c + bays.filter(q => q.kind !== 'roofx').length, 0), 0);
    el.innerHTML = m('Buildings', site.buildings.length, site.buildings.map(b => esc(b.name)).join(' · ')) + m('Frame lines', nF, site.buildings.map(b => `${esc(b.name)} ${b.xs.length}`).join(' · '))
      + m('Roof snow', J.roofs.map(r => F1(r.applied ?? r.design)).join(' / ') + ' psf', `pg ${F1(J.F.pg.value)} psf · ASCE ${esc(J.F.ed)}`)
      + m('Roof steps', J.drifts.filter(d => !d.level).length, drifts.length ? drifts.map(d => `${esc(d.lower)}: drift ${F1(d.drift.pd)} psf over ${ft(d.drift.w)}${d.sliding.applies ? ` · sliding ${F1(d.sliding.psf)} psf` : ''}`).join(' · ') : J.drifts.some(d => !d.level) ? 'no drift: the roofs meet at the eave' : J.drifts.length ? 'the roofs meet level' : 'none')
      + m('Braced bays', nBraced, site.buildings.map(b => { const br = bracingOf(b.name); const t = ['FSW', 'BSW'].map(w => `${w} ${br.walls[w].bays.length ? br.walls[w].bays.map(q => (q.kind === 'portal' ? 'PF ' : '') + (q.from + 1) + '–' + (q.to + 1)).join(', ') : br.walls[w].open ? br.walls[w].open : '—'}`).join(' · '); return `${site.buildings.length > 1 ? esc(b.name) + ': ' : ''}${esc(t)}${br.src ? ` <i>(${esc(br.src)})</i>` : ''}`; }).join('<br>'))
      + m('Mezzanines', mz.length, mz.map(q => `${esc(mezzName(q.id))} at ${ft(q.A)}`).join(' · ') || '—');
    // 3D
    const canvas = $('#bldCanvas');
    if (canvas && M3) {
      if (!bldModel) {
        bldModel = M3.mount(canvas, { pad: [26, 24], min: [320, 320], onSelect: id => { const mm = state.bldScene && state.bldScene.members.find(q => q.id === id); if (mm && mm.ref && (mm.ref.type === 'frame' || mm.ref.type === 'frameCol')) selectFrame(mm.ref.building, mm.ref.frame, true); }, onFocus: () => {} });
        $('#bldToggles').innerHTML = TOGGLES.map(([k, l, , on]) => `<button data-t="${k}" class="${on ? 'is-on' : ''}" aria-pressed="${on}">${l}</button>`).join('');
        $$('#bldToggles button').forEach(b => { b.onclick = () => { const on = !b.classList.contains('is-on'); b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); TOGGLES.find(t => t[0] === b.dataset.t)[2].forEach(k => bldModel.toggle(k, on)); }; });
        TOGGLES.filter(t => !t[3]).forEach(t => t[2].forEach(k => bldModel.toggle(k, false)));
        $('#bldPause').onclick = () => { const on = bldModel.auto; bldModel.pause(on); $('#bldPause').textContent = on ? 'Resume rotation' : 'Pause rotation'; };
        $('#bldReset').onclick = () => bldModel.reset();
        $('#bldIn').onclick = () => bldModel.zoom(1.15); $('#bldOut').onclick = () => bldModel.zoom(1 / 1.15);
      }
      // the mezzanines as designed — their beams, columns and joists from the mezzanine model — placed in the site
      let ms = null, host = null;
      try { host = siteB((state.pcs && state.pcs.planBuilding) || (mz[0] && mz[0].building)); ms = C.mezzScene && host && state.res && !state.res.incomplete ? C.mezzScene() : null; } catch (e) { console.error(e); ms = null; }
      state.bldScene = B.scene(J, { mezz: mz, mezzDetailed: !!ms, bracing: brAll, purlin: (state.snow && state.snow.purlin) || DEFAULT_PURLIN });
      if (ms) {
        const T = p => host.toSite(p);
        const box = b => { const a = T([b.x0, b.y0]), c = T([b.x1, b.y1]); return { x0: Math.min(a[0], c[0]), x1: Math.max(a[0], c[0]), y0: Math.min(a[1], c[1]), y1: Math.max(a[1], c[1]), z0: b.z0, z1: b.z1 }; };
        const pt = q => { const a = T([q[0], q[1]]); return [a[0], a[1], q[2]]; };
        ms.members.filter(q => q.kind === 'beam' || q.kind === 'col' || q.kind === 'joist').forEach(q => state.bldScene.members.push({ ...q, id: 'mezz · ' + q.id, kind: q.kind === 'joist' ? 'joist' : 'mezz', boxes: (q.boxes || []).map(box), lines: (q.lines || []).map(([a, c]) => [pt(a), pt(c)]), ref: { type: 'mezzMember' } }));
      }
      bldModel.set(state.bldScene);
      $('#bldModelTitle').textContent = site.buildings.map(b => b.name).join(' + ');
      $('#bldModelMeta').textContent = site.buildings.map(b => `${b.name} ${ft(b.g.width)} × ${ft(b.g.length)} · eaves ${ft(b.g.eaveFSW)} / ${ft(b.g.eaveBSW)}`).join(' · ');
      $('#bldKey').innerHTML = KEY.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
    }
    renderBldPlan();
    // flags
    const sj = state.job && state.job.seismic, notes = J.notes.slice();
    (sj && sj.ok ? sj.buildings : []).forEach(b => b.braceLines.filter(l => l.independent).forEach(l => notes.push({ level: 'warn', text: `${sj.buildings.length > 1 ? b.name + ': ' : ''}the mezzanine edge on ${l.edge} is not on a sidewall — its longitudinal seismic ${F2(l.design)} k has no wall to go to: a wall with a portal frame or X-bracing on that line in NBG Bracing, or independent X-bracing (DM 15.1.3). See the Bracing page.` })));
    if (mz.length) site.buildings.forEach(b => { if (!mz.some(q => sameName(q.building, b.name))) notes.push({ level: 'info', text: `${b.name}: no mezzanine — its frames take the roof loads, the snow and any drift only.` }); });
    site.buildings.forEach(b => { const br = bracingOf(b.name); WALLS.forEach(w => { const W = br.walls[w]; if (W.check) notes.push(W.check); else if (W.open && !W.fromFile) notes.push({ level: 'info', text: `${b.name} ${w}: PCS Box 12 asks for ${W.type} with the bay ${W.open} — the bay is not drawn until the eScope or the bracing file names it.` }); }); });
    // an end frame's interior columns (Box 5) against the endwall column spacing (Box 2, measured from the FSW)
    site.buildings.forEach(b => B.frameLines(b).filter(fl => fl.end && fl.entry && fl.cols.length > 2).forEach(fl => {
      const inner = fl.cols.slice(1, -1), box2 = B.endPosts(b.g, fl.end), W = b.g.width, has = (arr, y) => arr.some(q => Math.abs(q - y) < 0.3);
      if (!box2.length || inner.every(y => has(box2, y))) return;
      const mirror = inner.every(y => has(box2, W - y));
      notes.push({ level: 'warn', text: `${b.name} ${fl.end} frame (line ${fl.no}): Box 5 puts its interior column${inner.length > 1 ? 's' : ''} at ${inner.map(y => ft(y)).join(', ')} from the FSW; Box 2's ${fl.end} column spacing puts ${box2.length > 1 ? 'them' : 'it'} at ${box2.map(y => ft(y)).join(', ')}${mirror ? ` — the mirror image (${ft(W)} − each): one of the two is listed from the BSW` : ''}. Check which before the frame is designed; the drawings use Box 5.` });
    }));
    J.roofs.filter(r => r.pcsMatch === false).forEach(r => notes.push({ level: 'warn', text: `${r.name}: the roof snow works out to ${F1(r.design)} psf; PCS Box 4 lists ${F1(r.pcsSnow.value)} psf. Check Ce, Ct and the slope.` }));
    (sj ? sj.notes : []).filter(n => n.level === 'stop').forEach(n => notes.push(n));
    $('#bldNotes').innerHTML = notes.length ? notes.map(n => `<div class="seis-msg ${n.level}">${esc(n.text)}</div>`).join('') : '<div class="seis-msg ok">Nothing to flag.</div>';
    $('#bldNotesPanel').hidden = false;
  }
  // the site plan and the frame-line table (the selected line lit) — cheap, so a click redraws these alone
  function renderBldPlan() {
    const J = state.snowJob;
    if (!J || !J.site.buildings.length || !$('#bldPlan')) return;
    const site = J.site, mz = mezzBoxes();
    $('#bldPlan').innerHTML = B.planSvg(J, { mezz: mz, selected: state.frameSel, bracing: bracingAll() });
    wirePlan('#bldPlan', true);
    $('#bldFrames').innerHTML = site.buildings.map(b => {
      const rows = B.frameLines(b).map(fl => {
        const Fd = frameData(b.name, fl.no), ld = Fd ? Fd.loads : {}, drift = (ld.drift || []), peak = drift.length ? Math.max(...drift.map(s => Math.max(-s.start, -s.end))) : 0;
        const sel = state.frameSel && sameName(state.frameSel.building, b.name) && state.frameSel.frame === fl.no;
        const mezzT = (ld.mezz || []).length ? `${ld.mezz.length} column${ld.mezz.length > 1 ? 's' : ''} · FDL ${F2(ld.mezz.reduce((a, q) => a + q.D, 0))} · FLL ${F2(ld.mezz.reduce((a, q) => a + q.L, 0))} k` : '—';
        const eqT = (ld.eq || []).length ? (ld.eq[0].F == null ? 'EQ waiting on Seismic' : `EQ ${F2(ld.eq.reduce((a, q) => a + q.F, 0))} k`) : '';
        const shared = !fl.type && fl.end ? sharedEnd(b, fl.end) : null;
        return `<tr class="${sel ? 'is-sel' : ''}" data-bldg="${esc(b.name)}" data-frame="${fl.no}" tabindex="0"><td class="mono"><b>${fl.no}</b></td><td>${esc(fl.type || (shared ? `open to ${shared.name} — its ${shared.wall} frame, line ${shared.line}` : '—'))}<small class="sub-n">${fl.end ? fl.end + ' · ' : ''}${ft(fl.trib)} trib · ${fl.cols.length} columns${fl.posts.length ? ` + ${fl.posts.length} endwall posts` : ''}</small></td><td class="num mono">${ld.snow ? kft(ld.snow.kft) : '—'}</td><td class="num mono">${peak ? `<b>${kft(peak)}</b><small class="sub-n">${Fd.step ? Fd.step.side + ' side' : 'end'}</small>` : '—'}</td><td>${mezzT}${eqT ? `<small class="sub-n">${eqT}</small>` : ''}</td><td class="num"><button class="btn-ghost sm" data-bldg="${esc(b.name)}" data-frame="${fl.no}">Loads →</button></td></tr>`;
      }).join('');
      return `${site.buildings.length > 1 ? `<h4 class="seis-bh">${esc(b.name)} <small class="sub-n">${esc(b.g.profile || '')} · ${ft(b.g.width)} × ${ft(b.g.length)}</small></h4>` : ''}<div class="table-wrap"><table class="fl-t bld-t"><thead><tr><th>Line</th><th>Frame</th><th class="num">Snow</th><th class="num">Drift peak</th><th>Mezzanine</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
    $$('#bldFrames [data-frame]').forEach(x => { const open = () => selectFrame(x.dataset.bldg, +x.dataset.frame, true); x.onclick = e => { e.stopPropagation(); open(); }; if (x.tagName === 'TR') x.onkeydown = e => { if (e.key === 'Enter') open(); }; });
  }

  // a building's end with no frame of its own in Box 5: the endwall it opens onto (the other building's end frame there)
  function sharedEnd(b, end) {
    const J = state.snowJob, a = J && J.site.attachments.find(t => (sameName(t.building, b.name) && t.wall === end) || (sameName(t.to, b.name) && t.toWall === end));
    if (!a) return null;
    const mine = sameName(a.building, b.name), name = mine ? a.to : a.building, wall = mine ? a.toWall : a.wall, o = siteB(name);
    if (!o || (wall !== 'LEW' && wall !== 'REW')) return null;
    return { name, wall, line: wall === 'LEW' ? 1 : o.xs.length };
  }

  // ---------- Snow & drift ----------
  function renderSnow() {
    const box = $('#snowInputs');
    if (!box) return;
    if (!state.pcs) { box.innerHTML = '<div class="empty">Load a PCS first.</div>'; ['#snowRoofs', '#snowSteps', '#snowFrames', '#snowHow'].forEach(q => { $(q).innerHTML = ''; }); return; }
    const J = state.snowJob, F = J ? J.F : facts(), c = state.snow || {};
    const tag = o => `<small class="src src-${esc(String(o.source).replace(/\s+/g, '-'))}">${esc(o.source === 'missing' ? 'needed' : o.source)}</small>`;
    const num = (key, v, extra = '') => `<input class="seis-in ${v == null ? 'need' : ''}" data-snow="${esc(key)}" value="${v == null ? '' : +(+v).toFixed(4)}" inputmode="decimal" ${extra}>`;
    const chk = (key, on, label) => `<label class="seis-chk"><input type="checkbox" data-snow="${esc(key)}" ${on ? 'checked' : ''}> <span>${label}</span></label>`;
    const back = snowRestored ? `<div class="seis-msg info">Your Snow entries for this quote are back. <button class="btn-ghost sm" id="snowForget" type="button">Clear them</button></div>` : '';
    box.innerHTML = back + `<div class="seis-grid">
      <label><span class="lab">Ground snow, pg (psf) ${tag(F.pg)}</span>${num('pg', F.pg.value)}</label>
      <label><span class="lab">Exposure factor, Ce ${tag(F.Ce)}</span>${num('Ce', F.Ce.value)}${F.ceText ? `<small class="sub-n">PCS: ${esc(F.ceText)}</small>` : ''}</label>
      <label><span class="lab">Risk category <small class="src src-${F.riskSrc}">${F.riskSrc}</small></span><select data-snow="risk">${['I', 'II', 'III', 'IV'].map(r => `<option ${r === F.risk ? 'selected' : ''}>${r}</option>`).join('')}</select><small class="sub-n">Is ${F.ed === '7-22' ? '1.0 (ASCE 7-22: pg is risk-targeted)' : SNOW.IS[F.risk]}</small></label>
      <label><span class="lab">Code</span><b class="seis-echo-v">ASCE ${esc(F.ed)}</b><small class="sub-n">follows the Seismic page's building code</small></label>
      ${F.ed === '7-22' ? `<label><span class="lab">Winter wind parameter, W2 ${tag(F.W2)}</span>${num('W2', F.W2.value)}<small class="sub-n">ASCE 7-22 drifts need it (PCS Box 3 or the hazard tool)</small></label>` : ''}
    </div>` + (J ? `<div class="seis-grid snow-bldgs">${J.roofs.map(r => { const pr = (pcsB(r.name) || {}).roof || {}; return `<div class="snow-bldg"><b>${esc(r.name)}</b><label><span class="lab">Thermal factor, Ct <small class="src src-${esc(r.CtSrc)}">${esc(r.CtSrc)}</small></span>${num(`b.${r.name}.Ct`, r.Ct)}${r.thermal ? `<small class="sub-n">PCS Box 4: ${esc(r.thermal)}</small>` : ''}</label>${chk(`b.${r.name}.slippery`, r.slippery, `Unobstructed slippery roof <small class="sub-n">Box 4 "R &lt; 30 and/or obstruction": ${pr.obstruction === false ? 'No → slippery' : pr.obstruction === true ? 'Yes → not slippery' : 'not read'}</small>`)}</div>`; }).join('')}</div>` : '');
    if (!J) { $('#snowRoofs').innerHTML = '<div class="seis-msg warn">Type the ground snow load to work the roofs.</div>'; $('#snowSteps').innerHTML = ''; $('#snowFrames').innerHTML = ''; }
    else {
      $('#snowRoofs').innerHTML = `<div class="table-wrap"><table class="fl-t"><thead><tr><th>Building</th><th>Roof</th><th class="num">Ct</th><th class="num">Is</th><th class="num">pf</th><th class="num">Cs</th><th class="num">ps</th><th class="num">pm</th><th>Unbalanced (gable)</th><th>PCS Box 4</th></tr></thead><tbody>${J.roofs.map(r => {
        const u = r.unbalanced, ut = !u ? '—' : !u.applies ? esc(u.why) : u.simple ? `windward 0 · leeward ${F1(u.leeward)} psf (W ≤ 20 ft)` : u.need ? 'needs W2' : `windward ${F1(u.windward)} · leeward ${F1(u.leeward)} + ${F1(u.surcharge)} psf over ${ft(u.length)} from the ridge`;
        const pm = r.pm != null ? `${F1(r.pm)}${r.pm > r.ps ? ' <b>governs</b>' : ''}` : '—';
        const pcsT = r.pcsSnow ? `${F1(r.pcsSnow.value)} psf${r.pcsSnow.override ? ' <small class="sub-n">user override — applied as a uniform load with dead and collateral</small>' : r.pcsMatch ? ' <small class="src src-ok">matches</small>' : ' <small class="src src-bad">differs</small>'}` : '—';
        return `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.building.g.profile || '')} ${F2(r.slope)}:12<small class="sub-n">${F1(r.slopeDeg)}°${r.slippery ? ' · slippery' : ''}</small></td><td class="num mono">${F2(r.Ct)}</td><td class="num mono">${F2(r.Is)}</td><td class="num mono">${F1(r.pf)}</td><td class="num mono">${F2(r.Cs)}</td><td class="num mono"><b>${F1(r.ps)}</b></td><td class="num mono">${pm}</td><td>${ut}</td><td>${pcsT}</td></tr>`; }).join('')}</tbody></table></div>
        <small class="sub-n">pf = 0.7 Ce Ct Is pg (Eq. 7.3-1) · ps = Cs pf · pm the low-slope minimum (slopes under 15°) · γ = 0.13 pg + 14 ≤ 30 pcf · the roof's balanced snow is the larger of ps and pm; the PCS's user override, where it has one, is what NBG Frame applies.</small>`;
      const sp = (state.snow && state.snow.purlin) || DEFAULT_PURLIN;
      const level = J.drifts.filter(d => d.level), steps = J.drifts.filter(d => !d.level);
      const levelT = level.length ? `<div class="snow-level">${level.map(d => `<span><b>${esc(d.lower)}</b> ${d.lowerWall} meets <b>${esc(d.upper)}</b> ${d.upperWall} level — one roof, no drift; a fetch toward a step runs on through both</span>`).join('')}</div>` : '';
      if (!steps.length) $('#snowSteps').innerHTML = `${levelT}<div class="seis-msg info">No roof steps: one building, or none attached to another${level.length ? ' higher' : ''}. An existing building beside it, or a higher roof the PCS does not draw (Box 4 "additional obstruction"), can be added here as a step.</div>${stepAdder()}`;
      else $('#snowSteps').innerHTML = levelT + steps.map(d => {
        const dr = d.drift, o = ((c.steps || {})[d.key]) || {};
        const line = (lab, v) => `<span>${lab} <b>${v}</b></span>`;
        // the drift along the frame lines (an endwall step) or the purlin lines (a sidewall step) — the separation across the spacings
        let marks = [];
        if (!dr.none) {
          if (d.kind === 'end') marks = d.frames.map(fl => ({ x: Math.abs(fl.x - (d.lowerWall === 'LEW' ? 0 : d.step.lower.g.length)), short: String(fl.frame), label: `frame line ${fl.frame} · ${F3(Math.max(...fl.segs.map(s => Math.max(-s.start, -s.end)), 0))} k/ft` }));
          else {
            // purlin lines at the spacing from the wall (the eave strut on it): the snow on each, × the spacing
            const env = d.envelope || [], at = x => { const e = env.find(q => x >= q.a - 1e-9 && x <= q.b + 1e-9); return e ? e.va + (e.vb - e.va) * (x - e.a) / (e.b - e.a || 1) : 0; }, far = env.length ? env[env.length - 1].b : 0;
            for (let x = sp, i = 1; x < far + 1e-9; x += sp, i++) marks.push({ x, short: 'P' + i, label: `P${i} at ${ft(x)} · ${n0(at(x) * sp)} plf` });
          }
        }
        const upperG = d.step.upper && d.step.upper.g;
        return `<div class="snow-step ${d.off ? 'is-off' : ''}"><div class="snow-step-h"><div><b>${esc(d.lower)}</b> ${d.lowerWall} <span class="sub-n">below</span> <b>${esc(d.upper)}</b> ${d.upperWall || ''}${d.typed ? ' <small class="src src-typed">typed</small>' : ''} <small class="sub-n">· ${d.kind === 'side' ? 'drift across the lower frames (side wall)' : 'drift along the lower building (end wall)'} · shared ${ft(d.length)} · step ${ft(d.hMin)}${d.hMax - d.hMin > 0.05 ? ` to ${ft(d.hMax)} at the rake` : ''}</small></div>${chk(`s.${d.key}.off`, d.off, 'leave this step out')}</div>
          <div class="seis-grid"><label><span class="lab">Upper roof fetch, lu <small class="src src-${esc(d.luUpperSrc.replace(/\s+/g, '-'))}">${esc(d.luUpperSrc)}</small></span>${num(`s.${d.key}.luUpper`, d.luUpper)}<small class="sub-n">${d.luUpperParts && d.luUpperParts.length > 1 ? `${d.luUpperParts.map(q => `${esc(q.name)} ${ft(q.len)}`).join(' + ')} — the roofs meet level, the snow blows the whole way` : d.upperWall === 'FSW' || d.upperWall === 'BSW' ? 'its width' : d.upperWall ? 'its length' : 'as typed'}</small></label>
            <label><span class="lab">Lower roof fetch, lu <small class="src src-${esc(d.luLowerSrc.replace(/\s+/g, '-'))}">${esc(d.luLowerSrc)}</small></span>${num(`s.${d.key}.luLower`, d.luLower)}${d.luLowerParts && d.luLowerParts.length > 1 ? `<small class="sub-n">${d.luLowerParts.map(q => `${esc(q.name)} ${ft(q.len)}`).join(' + ')}</small>` : ''}</label>
            <label><span class="lab">Gap to a separate building, s (ft)</span>${num(`s.${d.key}.s`, d.s || 0)}<small class="sub-n">0 when they touch (7.7.2)</small></label>
            <label><span class="lab">Sliding snow (7.9)</span><select data-snow="s.${esc(d.key)}.sliding">${[['', 'By the code: only if the upper roof drains toward this step'], ['calcs', 'Include, as NBG Design Calcs works it (slippery upper roof)'], ['off', 'Leave out']].map(([v, t]) => `<option value="${v}" ${(d.sliding.mode === 'asce' ? '' : d.sliding.mode) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>${d.sliding.mode !== 'off' && d.step.upper ? `<small class="sub-n">pf upper ${F1(d.sliding.pfUpper)} psf · W upper ${ft(d.sliding.W)}</small>` : ''}</label>
            ${d.sliding.mode === 'calcs' ? `<label><span class="lab">W, upper roof eave to ridge (ft) <small class="src src-${esc(d.sliding.Wsrc)}">${esc(d.sliding.Wsrc)}</small></span>${num(`s.${d.key}.W`, d.sliding.W)}<small class="sub-n">0.4 pf W per foot of eave, over 15 ft</small></label>` : ''}</div>
          ${dr.none ? `<div class="seis-msg info">No drift: ${esc(dr.why)}</div>` : `${B.stepSvg(d, { marks })}${marks.length ? `<div class="snow-marks">${marks.map(m => `<span>${esc(m.label)}</span>`).join('')}</div>` : ''}<div class="seis-sum">${line('γ', F2(dr.gamma) + ' pcf')}${line('hb = ps / γ', ft(dr.hb))}${line('hc = h − hb', ft(dr.hc))}${line('leeward hd', ft(dr.leeward.hd) + (dr.leeward.why ? ' (' + esc(dr.leeward.why) + ')' : ''))}${line('windward ¾ hd', ft(dr.windward.hd))}${line('governs', dr.gov)}${line('hd', ft(dr.hd) + (dr.capped ? ' = hc' : ''))}${line('w', ft(dr.w) + (dr.truncated ? ` → cut off at ${ft(d.lowerWidth)}, ${F1(dr.end)} psf there` : ''))}${line('pd = hd γ', `<b>${F1(dr.pd)} psf</b>`)}</div>`}
          ${d.sliding.applies ? `<div class="seis-msg info">Sliding snow (7.9)${d.sliding.mode === 'calcs' ? ', as NBG Design Calcs works it' : ''}: 0.4 pf W = 0.4 × ${F1(d.sliding.pfUpper)} × ${ft(d.sliding.W)} = ${n0(d.sliding.perFt)} lb/ft over ${ft(d.sliding.extent)} → <b>${F2(d.sliding.psf)} psf</b>, with the balanced snow. It is not added to the drift: 7.9 says sliding "need not be used in combination with drift" — the frames take the larger of the two at each point (NBG Design Calcs' Total Snow).${d.envelope && d.envelope.length > 1 ? ` Envelope from the wall: ${d.envelope.map(e => `${F1(e.va)}${Math.abs(e.va - e.vb) > 0.05 ? '→' + F1(e.vb) : ''} psf to ${ft(e.b)} (${e.by})`).join(' · ')}.` : ''}</div>` : `<small class="sub-n">Sliding snow: ${esc(d.sliding.why)}.</small>`}</div>`;
      }).join('') + stepAdder();
      // onto the frames
      const rows = J.drifts.filter(d => !d.off && d.frames.length).flatMap(d => d.frames.map(fl => `<tr><td><b>${esc(d.lower)}</b> line ${fl.frame}<small class="sub-n">x ${ft(fl.x)} · trib ${ft(fl.tribAt || fl.trib[1] - fl.trib[0])}${fl.strip ? ` · ${ft(fl.strip[0])}–${ft(fl.strip[1])} from the step` : ''}</small></td><td class="num mono">${ft(fl.h)}</td><td class="num mono">${fl.drift ? F1(fl.drift.pd) : '—'}</td><td>${fl.segs.map(s => `<div class="snow-seg"><i>${esc(s.name)}</i> <span class="mono">RP${s.panel}</span> <span class="mono">${ft(s.from)} → ${ft(s.to)}</span> <b class="mono">${F3(s.start)} → ${F3(s.end)}</b> k/ft</div>`).join('')}</td><td class="num"><button class="btn-ghost sm" data-bldg="${esc(d.lower)}" data-frame="${fl.frame}">Draw →</button></td></tr>`));
      $('#snowFrames').innerHTML = rows.length ? `<div class="table-wrap"><table class="fl-t"><thead><tr><th>Frame line</th><th class="num">Step h</th><th class="num">pd (psf)</th><th>Panel loads for NBG Frame · positions from the FSW</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div><small class="sub-n">A side-wall step: the drift at the wall (pd × tributary width) falling to zero w from it, or to its value at the far eave; with sliding snow, the larger of the two at each point. An end-wall step: the frame's share over its own strip, the same across the frame. Cut where the roof panels change (RP1 / RP2). Negative = down, GY, as NBG Frame's own roof loads. Into NBG Frame: Tools → Concentrated (Panel) Loads, the panel tab, "Snow Drift" under SL (and LRD / RRD when the frame has those cases) — the Frames page writes them into the frame file, scaled to the file's own bay width.</small>` : '<div class="seis-msg info">No drift reaches a frame line.</div>';
      $$('#snowFrames [data-frame]').forEach(x => { x.onclick = () => selectFrame(x.dataset.bldg, +x.dataset.frame, true); });
    }
    $('#snowHow').innerHTML = `<ol>
      <li><b>Balanced snow</b> on each roof: pf = 0.7 Ce Ct Is pg; ps = Cs pf with Cs from Fig. 7.4-1 (warm roof 1.0 to 30°, slippery from 5°; Ct 1.1 from 37.5°, Ct 1.2 from 45°); the low-slope minimum pm = Is pg (pg ≤ 20) or 20 Is; rain-on-snow 5 psf where pg ≤ 20 and the slope is under W/50 degrees. Checked against NBG Design Calcs' snow document (unbalanced: surcharge 13.30 psf over 20.64 ft for pg 51 on a 60 ft gable at 1:12) and PCS Box 4.</li>
      <li><b>Unbalanced snow</b> on a gable (7.6.1): windward 0.3 ps, leeward ps with a surcharge hd γ / √S over 8 hd √S / 3 from the ridge — NBG Frame's own SnowLeftSlope / SnowRightSlope cases carry it.</li>
      <li><b>Roof steps</b> from Box 2's attachments: each building placed on one site, the two roofs sampled along the shared wall, the higher one over the lower. The step height h = upper roof at the wall − lower roof there (a gable endwall's rake rises to the ridge, so h grows along it). A step the PCS does not draw is typed in step 3.</li>
      <li><b>Drift</b> (7.7): hb = ps / γ, hc = h − hb; nothing when hc / hb &lt; 0.2. Leeward hd = 0.43 lu^⅓ (pg + 10)^¼ − 1.5 with lu the upper roof's fetch (ASCE 7-22: 1.5 √(pg^0.74 lu^0.70 W2^1.7 / γ)); windward ¾ of the same with the lower roof's fetch; the larger governs. hd ≤ hc → w = 4 hd; else w = 4 hd² / hc ≤ 8 hc and hd = hc. pd = hd γ. A separate building (s &gt; 0): leeward only for s &lt; 20 ft and s &lt; 6h, held to (6h − s)/6, w ≤ 6h − s. A drift wider than the lower roof stops at its far edge at the value it has there.</li>
      <li><b>Sliding snow</b> (7.9): 0.4 pf W per foot of eave from a roof steeper than ¼:12 (slippery) or 2:12 that drains onto the lower roof, over 15 ft (scaled to a narrower roof), with the balanced snow.</li>
      <li><b>Onto the frames</b>: a side-wall step runs across the lower frames — each frame line takes pd × its tributary width at the wall, to 0 at w (or the far eave): a triangle, PY, "Snow Drift". An end-wall step runs along the length — each frame near the end takes the drift over its own strip, uniform across the frame. The section in step 3 marks each frame line (or purlin line) with what it takes. The fetch and the gap are the engineer's call where another roof continues in line: type them above.</li>
      <li><b>Onto the purlins</b>: the Purlins page lists the same drift as purlin line loads (the purlin program is not here).</li></ol>`;
    const forget = $('#snowForget');
    if (forget) forget.onclick = () => { const k = snowKey(); try { if (k) localStorage.removeItem(k); } catch (e) { /* nothing kept */ } state.snow = {}; snowRestored = false; recompute(); toast('Snow entries cleared — back to the PCS values'); };
    $$('#v-snow [data-snow]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.snow, raw = el.type === 'checkbox' ? el.checked : el.value.trim(), cfg = state.snow = state.snow || {};
        const v = el.type === 'checkbox' || el.tagName === 'SELECT' ? raw : raw === '' ? '' : +raw;   // a select's '' (the code's default) clears the entry
        const set = (obj, key, val) => { if (val === '' || val == null || val === false || (typeof val === 'number' && !isFinite(val))) delete obj[key]; else obj[key] = val; };
        if (k.startsWith('b.')) { const name = J.roofs.map(r => r.name).find(n => k.startsWith('b.' + n + '.')); cfg.buildings = cfg.buildings || {}; cfg.buildings[name] = cfg.buildings[name] || {}; set(cfg.buildings[name], k.slice(3 + name.length), v); if (!Object.keys(cfg.buildings[name]).length) delete cfg.buildings[name]; }
        else if (k.startsWith('s.')) { const key = J.drifts.map(d => d.key).find(q => k.startsWith('s.' + q + '.')); cfg.steps = cfg.steps || {}; cfg.steps[key] = cfg.steps[key] || {}; set(cfg.steps[key], k.slice(3 + key.length), v); if (!Object.keys(cfg.steps[key]).length) delete cfg.steps[key]; }
        else set(cfg, k, v);
        snowSave(); recompute();
      };
    });
    wireStepAdder();
  }
  // a step the PCS does not draw: an existing building or a higher roof beside one of these
  function stepAdder() {
    const J = state.snowJob, blds = J ? J.site.buildings : [], ex = (state.snow && state.snow.extraSteps) || [];
    const list = ex.map((x, i) => `<li>${esc(x.name || 'a higher roof')} over ${esc(x.lower)} ${x.wall}: ${ft(x.h)} above the roof along it, fetch ${ft(x.lu)}${x.s ? `, ${ft(x.s)} away` : ''} <button class="btn-ghost sm" data-xstep-rm="${i}">Remove</button></li>`).join('');
    return `<details class="snow-add"><summary>Add a step the PCS does not draw <small class="sub-n">an existing building, a higher roof in line</small></summary><div class="seis-grid"><label><span class="lab">Lower building · wall</span><select id="xsWall">${blds.flatMap(b => WALLS.map(w => `<option value="${esc(b.name)}|${w}">${esc(b.name)} ${w}</option>`)).join('')}</select></label><label><span class="lab">What stands there</span><input class="seis-in" id="xsName" placeholder="e.g. existing warehouse"></label><label><span class="lab">Its roof above this roof by (ft)</span><input class="seis-in" id="xsH" inputmode="decimal" placeholder="e.g. 8"></label><label><span class="lab">Its fetch toward the step (ft)</span><input class="seis-in" id="xsLu" inputmode="decimal" placeholder="its width or length"></label><label><span class="lab">Gap s (ft)</span><input class="seis-in" id="xsS" inputmode="decimal" value="0"></label></div><button class="btn-soft sm" id="xsAdd">Add the step</button>${list ? `<ul class="pj-list">${list}</ul>` : ''}</details>`;
  }
  function wireStepAdder() {
    const add = $('#xsAdd');
    if (add) add.onclick = () => { const [lower, wall] = $('#xsWall').value.split('|'), h = +$('#xsH').value, lu = +$('#xsLu').value, s = +$('#xsS').value || 0, name = $('#xsName').value.trim(); if (!(h > 0) || !(lu > 0)) { toast('Type the step height and the fetch'); return; } state.snow = state.snow || {}; (state.snow.extraSteps = state.snow.extraSteps || []).push({ lower, wall, h, lu, s, name }); snowSave(); recompute(); toast(`Step added: ${name || 'a higher roof'} ${ft(h)} above ${lower} ${wall}`); };
    $$('[data-xstep-rm]').forEach(b => { b.onclick = () => { state.snow.extraSteps.splice(+b.dataset.xstepRm, 1); snowSave(); recompute(); }; });
  }

  // ---------- Frames ----------
  function renderFrames() {
    const pick = $('#framePick');
    if (!pick) return;
    const J = state.snowJob;
    if (!J || !J.site.buildings.length) { pick.innerHTML = state.pcs ? '<div class="seis-msg warn">The frames wait for the ground snow load (Snow & drift page).</div>' : '<div class="empty">Load a PCS first.</div>'; $('#framePlan').innerHTML = ''; $('#frameView').innerHTML = ''; $('#frameRows').innerHTML = ''; $('#frameToggles').innerHTML = ''; return; }
    if (!state.frameSel || !siteB(state.frameSel.building)) {
      // start on the frame with the most on it: a drift, else a mezzanine
      const d = J.drifts.find(x => x.frames.length);
      const b0 = d ? d.step.lower : J.site.buildings[0];
      const fr0 = d ? d.frames[Math.floor(d.frames.length / 2)].frame : ((state.job && state.job.frameEntries) || []).find(x => sameName(x.building, b0.name) || !x.building);
      state.frameSel = { building: b0.name, frame: d ? fr0 : fr0 ? +fr0.frame : 1 };
    }
    const sel = state.frameSel, mz = mezzBoxes();
    $('#framePlan').innerHTML = B.planSvg(J, { mezz: mz, selected: sel, bracing: bracingAll(), compact: true });
    wirePlan('#framePlan', false);
    pick.innerHTML = J.site.buildings.map(b => `<div class="fp-bldg"><span class="fp-name">${esc(b.name)}</span><div class="fp-chips">${B.frameLines(b).map(fl => { const Fd = frameData(b.name, fl.no), ld = Fd ? Fd.loads : {}, has = (ld.drift || []).length ? 'd' : (ld.mezz || []).length ? 'm' : ''; return `<button class="fp-chip ${sameName(sel.building, b.name) && sel.frame === fl.no ? 'is-on' : ''} ${has ? 'has-' + has : ''}" data-bldg="${esc(b.name)}" data-frame="${fl.no}" title="${esc(fl.type || '')}">${fl.no}</button>`; }).join('')}</div></div>`).join('') + `<div class="fp-key"><i class="has-d"></i>drift <i class="has-m"></i>mezzanine</div>`;
    $$('#framePick .fp-chip').forEach(x => { x.onclick = () => selectFrame(x.dataset.bldg, +x.dataset.frame); });
    const Fd = frameData(sel.building, sel.frame);
    if (!Fd) { $('#frameView').innerHTML = ''; return; }
    const out = B.frameSvg(Fd), ld = Fd.loads;
    // the frame line's lateral system (its R for the seismic): PCS Box 5's framing, or the one picked here
    const bS = sb(Fd.name), lineS = bS ? (bS.lines || []).find(l => String(l.label) === String(Fd.frame)) : null;
    const picked = bS && (((state.seis.buildings || {})[bS.bkey] || {}).lines || {})[String(Fd.frame)];
    const curSys = picked || (lineS ? lineS.type : /post|beam/i.test(Fd.type || '') ? 'Post & Beam' : 'Rigid Frame');
    const sysSel = bS ? `<label class="fv-sys"><span>Lateral system</span><select data-fsys="${esc(bS.bkey)}|${esc(String(Fd.frame))}">${(C.LINE_SYSTEMS || []).map(t => `<option ${t === curSys ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><small class="sub-n">${picked ? 'picked here' : 'PCS Box 5'}${lineS && lineS.lat && lineS.lat.R != null ? ` · R ${+lineS.lat.R.toFixed(2)}` : ''}</small></label>` : '';
    $('#frameViewTitle').innerHTML = `${esc(Fd.name)} · frame line <b>${Fd.frame}</b> <small class="sub-n">${esc(Fd.type || '')} · trib ${ft(Fd.trib)} · ${Fd.end ? Fd.end + ' end frame' : 'interior'}${Fd.posts.length ? ` · ${Fd.posts.length} endwall posts` : ''}</small>${sysSel}`;
    const fs = $('#frameViewTitle [data-fsys]');
    if (fs) fs.onchange = () => { const [bk, lab] = fs.dataset.fsys.split('|'); state.seis.buildings = state.seis.buildings || {}; const bo = state.seis.buildings[bk] = state.seis.buildings[bk] || {}; bo.lines = bo.lines || {}; bo.lines[lab] = fs.value; C.seisSave && C.seisSave(); recompute(); toast(`Frame line ${lab}: ${fs.value} — the seismic is reworked with its R`); };
    const on = state.frameLayers = state.frameLayers || {};
    $('#frameToggles').innerHTML = out.legend.map(l => `<button data-layer="${esc(l.key)}" class="${on[l.key] === false ? '' : 'is-on'}" aria-pressed="${on[l.key] !== false}">${esc(l.label)}</button>`).join('');
    $('#frameView').innerHTML = out.svg;
    const apply = () => $$('#frameView .fl-layer').forEach(g => g.classList.toggle('is-off', on[g.dataset.layer] === false));
    apply();
    $$('#frameToggles button').forEach(b => { b.onclick = () => { on[b.dataset.layer] = on[b.dataset.layer] === false; b.classList.toggle('is-on', on[b.dataset.layer] !== false); b.setAttribute('aria-pressed', on[b.dataset.layer] !== false); apply(); }; });
    // the rows for NBG Frame
    const sj = state.job && state.job.seismic, b = sb(Fd.name), lat = b ? (b.lines || []).find(l => String(l.label) === String(Fd.frame)) : null;
    const con = [];
    (ld.mezz || []).forEach(q => { con.push({ name: 'FDL', cs: 'FDL', member: q.member, at: q.elev, x: 0, y: -q.D }); con.push({ name: 'FLL', cs: 'FLL', member: q.member, at: q.elev, x: 0, y: -q.L }); });
    (ld.eq || []).filter(q => q.F != null).forEach(q => { con.push({ name: 'EQR', cs: 'EQR', member: q.member, at: q.at, x: q.F, y: 0 }); con.push({ name: 'EQL', cs: 'EQL', member: q.member, at: q.at, x: -q.F, y: 0 }); });
    const eqWait = (ld.eq || []).some(q => q.F == null);
    const file = chosenFile(Fd), plan = framePlan(Fd, file);
    const roofT = lat ? `<div class="seis-sum"><span>Roof seismic weight <b>${F2(lat.lat.frame.roofPsf)} psf</b></span><span>Seismic factor Cs <b>${F3(lat.lat.Cs)}</b></span><span>Frame base shear <b>${F2(lat.lat.V)} k</b></span><span>${esc(lat.lat.sys.label)} · R <b>${+lat.lat.R.toFixed(2)}</b></span><a href="#" data-go="seismic">Seismic page</a></div>` : '';
    const snowT = ld.snow ? `<div class="seis-sum"><span>Roof snow <b>${F1(ld.snow.applied)} psf</b> (${esc(ld.snow.src)}) → <b>${kft(ld.snow.kft)}</b> on the roof</span>${ld.snow.applied !== ld.snow.ps ? `<span>balanced ps <b>${F1(ld.snow.ps)} psf</b>: the drift sits on it (hb = ps / γ)</span>` : ''}<span>Roof dead + collateral <b>${kft(ld.dead + ld.coll)}</b></span><a href="#" data-go="snow">Snow page</a></div>` : '';
    const panT = plan.pan.length ? `<div class="table-wrap"><table class="fl-t"><thead><tr><th>Name</th><th>Case</th><th>Panel</th><th>Dir.</th><th class="num">Start (ft)</th><th class="num">End (ft)</th><th class="num">Start (k/ft)</th><th class="num">End (k/ft)</th><th>From</th></tr></thead><tbody>${plan.pan.map(r => `<tr><td>${esc(r.name)}</td><td class="mono"><b>${r.caseId}</b></td><td class="mono">${r.panel}</td><td class="mono">${r.dir}</td><td class="num mono">${F3(r.from)}</td><td class="num mono">${F3(r.to)}</td><td class="num mono"><b>${F3(r.start)}</b></td><td class="num mono"><b>${F3(r.end)}</b></td><td><small class="sub-n">${esc(r.by || '')}</small></td></tr>`).join('')}</tbody></table></div><small class="sub-n">${plan.scaleNote ? esc(plan.scaleNote) + ' ' : ''}The larger of the drift and any sliding snow at each point (7.9: not added together), × ${plan.scale !== 1 ? `the file's ${ft(plan.bay)} bay` : `the ${ft(Fd.trib)} tributary width`}. Under SL${plan.extraCases.length ? ` and ${plan.extraCases.join(', ')}` : ''}; GY, as NBG Frame's own roof loads and the engineer's typed Snow Drift rows are.</small>` : '<small class="sub-n">No drift or sliding snow on this frame line.</small>';
    $('#frameRows').innerHTML = `${snowT}${roofT}
      <div class="fr-rows"><div class="panel-sub"><h4>Panel loads · Snow Drift <small class="sub-n">Tools → Concentrated (Panel) Loads, the panel tab: k/ft, down negative, positions along the frame from the FSW</small></h4>${panT}</div>
      <div class="panel-sub"><h4>Concentrated loads <small class="sub-n">the mezzanine's dead and live on the frame columns it bears on, its seismic EQR / EQL, a designed lean-to's reactions</small></h4>
        ${con.length ? `<div class="table-wrap"><table class="fl-t"><thead><tr><th>Name</th><th>Case</th><th>Member</th><th class="num">Location (ft)</th><th class="num">X (k)</th><th class="num">Y (k)</th></tr></thead><tbody>${con.map(r => `<tr><td>${esc(r.name)}</td><td class="mono"><b>${r.cs}</b></td><td class="mono">${esc(r.member || '—')}</td><td class="num mono">${F3(r.at)}</td><td class="num mono">${r.x ? F3(r.x) : '—'}</td><td class="num mono">${r.y ? F3(r.y) : '—'}</td></tr>`).join('')}</tbody></table></div>${eqWait ? `<div class="seis-msg warn">EQR / EQL on ${(ld.eq || []).map(q => esc(q.member || '')).join(', ')} come once the <a href="#" data-go="seismic">Seismic page</a> is complete${sj && sj.need && sj.need.length ? `: ${esc(sj.need[0])}` : ''}.</div>` : ''}` : `<small class="sub-n">No mezzanine bears on this frame line.</small>`}</div></div>
      ${leanToPanel(Fd, file)}
      ${fileWriter(Fd, file, plan)}`;
    wireFrameFile(Fd);
  }

  // ---------- the frame files: this frame line's own, and everything the tool writes into it ----------
  const frameFiles = () => (state.nbg.files || []).filter(x => x.ff);
  const fKey = Fd => `${Fd.name}|${Fd.frame}`;
  /* the dropped file that is this frame line's: one NBG made for this building and line; else a frame saved on its own
     (no building in its title) as wide as this building; else none */
  // a file's frame lines: from its name and title; "_12" on a building of fewer lines is lines 1 and 2
  function fileLines(x, nLines) {
    const out = new Set(x.ff.info.lines.map(Number));
    const t = (String(x.ff.info.title || '').match(/-\s*(\d+)\s*$/) || [])[1];
    if (t) out.add(+t);
    [...out].forEach(n => { if (nLines && n > nLines && String(n).split('').every(d => +d >= 1 && +d <= nLines)) { out.delete(n); String(n).split('').forEach(d => out.add(+d)); } });
    return [...out].sort((a, b) => a - b);
  }
  function fileFor(Fd) {
    const nL = (siteB(Fd.name) || { xs: [] }).xs.length;
    const fs = frameFiles(), inB = x => x.ff.info.building && sameName(x.ff.info.building, Fd.name), lines = x => fileLines(x, nL).map(String);
    return fs.find(x => inB(x) && lines(x).includes(String(Fd.frame)))
      || fs.find(x => !x.ff.info.building && Math.abs((x.ff.info.width || 0) - Fd.g.width) < 0.6 && (!x.ff.info.lines.length || lines(x).includes(String(Fd.frame))))
      || (J0().site.buildings.length === 1 ? fs.find(x => lines(x).includes(String(Fd.frame))) : null) || null;
  }
  const J0 = () => state.snowJob;
  function chosenFile(Fd) {
    const pick = (state.frameFile || {})[fKey(Fd)], fs = frameFiles();
    return (pick && fs.find(x => x.name === pick)) || fileFor(Fd);
  }
  /* a designed lean-to whose frames bear on this frame line: each of its frame lines meets the shared wall; those that
     land on this frame line put their column's reactions on the host column there, at the lean-to's eave. A lean-to
     against a sidewall: one of its lines on each host frame, on the host's sidewall column; against an endwall: all of
     its lines on the end frame, each on the endwall column it lands on. */
  function leanTargets(Fd, it) {
    const J = J0(), host = siteB(Fd.name);
    if (!J || !host || !it || !it.ff) return null;
    const fW = it.ff.info.width;
    const steps = J.drifts.filter(d => !d.level && d.step.upper && sameName(d.upper, Fd.name) && (d.lowerWall === 'FSW' || d.lowerWall === 'BSW'))
      .filter(d => (it.ff.info.building ? sameName(it.ff.info.building, d.lower) : Math.abs(d.step.lower.g.width - fW) < 0.6));
    const d = steps[0];
    if (!d) return null;
    const low = d.step.lower, yw = d.lowerWall === 'FSW' ? 0 : low.g.width, hostCols = (chosenFile(Fd) || {}).ff ? chosenFile(Fd).ff.info.columns.slice().sort((a, b) => a.x - b.x) : null;
    const lines = B.frameLines(low), out = [];
    lines.forEach(fl => {
      const p = host.toLocal(low.toSite([fl.x, yw]));
      if (Math.abs(p[0] - Fd.x) > 0.6) return;
      const hy = p[1];
      let member;
      if (hostCols && hostCols.length) { const c = hostCols.reduce((m, q) => (Math.abs(q.x - hy) < Math.abs(m.x - hy) ? q : m), hostCols[0]); member = Math.abs(c.x - hy) < 3.5 ? c.id : null; }
      else { const k = Fd.cols.findIndex(y => Math.abs(y - hy) < 0.6); member = k >= 0 ? 'COL' + String(k + 1).padStart(2, '0') : null; }
      out.push({ line: fl.no, trib: fl.trib, hy, at: SITE.roofZ(low.g, fl.x, yw), member });
    });
    const ltCols = it.ff.info.columns.slice().sort((a, b) => a.x - b.x), col = (d.lowerWall === 'BSW' ? ltCols[ltCols.length - 1] : ltCols[0] || {}).id;
    return { step: d, lower: low.name, wall: d.lowerWall, targets: out, col, bay: it.ff.info.bayWidth };
  }
  const leanFiles = Fd => frameFiles().filter(x => x.ff.info.reactions && x.ff.info.reactions.length && !sameName(x.ff.info.building || '\u0000', Fd.name) && leanTargets(Fd, x) && leanTargets(Fd, x).targets.length);
  // everything this frame line's file gets: the Snow Drift panel rows (scaled to the file's own bay width), the lean-to
  // rows when ticked, the mezzanine FDL / FLL / EQ rows the NBG block makes for it
  function framePlan(Fd, file) {
    const ld = Fd.loads, bay = file && file.ff.info.bayWidth > 0 ? file.ff.info.bayWidth : Fd.trib;
    const scale = Fd.trib > 0 && Math.abs(bay / Fd.trib - 1) > 0.005 ? bay / Fd.trib : 1;
    const cases = file && file.ff.info.cases.length ? file.ff.info.cases : [];
    const extraCases = ['LRD', 'RRD'].filter(c => cases.includes(c));
    const pan = [];
    (ld.drift || []).forEach(sg => ['SL', ...extraCases].forEach(cs => pan.push({ name: 'Snow Drift', caseId: cs, panel: 'RP' + sg.panel, dir: 'GY', from: sg.from, to: sg.to, start: sg.start * scale, end: sg.end * scale, by: sg.by })));
    const scaleNote = scale !== 1 ? `${file.name} is set to a ${ft(bay)} bay; this frame line's tributary width is ${ft(Fd.trib)} — the rows are × ${F3(scale)} to match the file (its own roof loads use the same bay).` : '';
    const lt = state.leanTo || {}, crows = [], ltOn = file && lt.on && lt.on[fKey(Fd)];
    let ltInfo = null;
    if (ltOn) {
      const it = frameFiles().find(x => x.name === ltOn), T = it && leanTargets(Fd, it);
      if (T) {
        const hostCases = new Set(cases), rx = it.ff.info.reactions.filter(r => r.col === T.col);
        T.targets.filter(t => t.member).forEach(t => {
          const k = lt.scale ? t.trib / (T.bay || t.trib) : 1;
          rx.filter(r => !hostCases.size || hostCases.has(r.caseName)).forEach(r => crows.push({ name: `Lean to - ${T.col} - Reaction`, caseId: r.caseName, member: t.member, x: -(r.Htop != null ? r.Htop : 0) * k, y: -r.V * k, location: +t.at.toFixed(4), toFlange: '3', leanTo: true }));
        });
        ltInfo = { file: it.name, T, skipped: [...new Set(rx.map(r => r.caseName))].filter(c => hostCases.size && !hostCases.has(c)) };
      }
    }
    let mezz = [];
    try { mezz = file && C.nbgRows && state.res && !state.res.incomplete ? C.nbgRows(file) : []; } catch (e) { mezz = []; }
    return { pan, scale, bay, scaleNote, extraCases, crows, ltInfo, mezz, cases };
  }
  function fileWriter(Fd, file, plan) {
    const fs = frameFiles();
    if (!fs.length) return `<div class="panel-sub ff-write"><h4>Into the frame file</h4><small class="sub-n">Drop this frame line's .frame file on the <a href="#" data-go="upload">Project page</a>: the Snow Drift rows${(Fd.loads.mezz || []).length ? ', the mezzanine rows' : ''}${leanFiles(Fd).length ? ' and the lean-to reactions' : ''} go into it and it downloads, ready for NBG Frame.</small></div>`;
    const what = [plan.pan.length && `${plan.pan.length} Snow Drift panel row${plan.pan.length > 1 ? 's' : ''}`, plan.crows.length && `${plan.crows.length} lean-to rows`, plan.mezz.length && `${plan.mezz.length} mezzanine rows (FDL / FLL / EQ)`].filter(Boolean);
    // the drift already in the file (NBG's own, or typed earlier): what it implies, beside what replaces it
    const had = file ? (file.ff.info.ploads || []).filter(q => /drift|sliding/i.test(q.name || '')) : [];
    const bayF = file && file.ff.info.bayWidth > 0 ? file.ff.info.bayWidth : Fd.trib;
    const hadT = had.length ? `<div class="seis-msg ${plan.pan.length ? 'warn' : 'info'}">${esc(file.name)} already carries ${had.map(q => { const a = Math.abs(+q.startMag), b = Math.abs(+q.endMag), pk = Math.max(a, b), run = Math.abs(+q.endLoc - +q.startLoc); return `<b>${esc(String(q.name).trim())}</b> (${q.loadCaseID}) ${F3(+q.startMag)} → ${F3(+q.endMag)} k/ft over ${ft(Math.min(+q.startLoc, +q.endLoc))} – ${ft(Math.max(+q.startLoc, +q.endLoc))}: ${F1(pk * 1000 / bayF)} psf on its ${ft(bayF)} bay, ${ft(run)} long`; }).join(' · ')}.${plan.pan.length ? ` The tool's rows replace ${had.length > 1 ? 'them' : 'it'} — left in, ${had.length > 1 ? 'they' : 'it'} would add to the new drift. Compare first: ${(() => { const pk = Math.max(...plan.pan.filter(r => r.caseId === 'SL').map(r => Math.max(-r.start, -r.end))); return `the tool's peak is ${F3(pk)} k/ft (${F1(pk * 1000 / bayF)} psf)`; })()}${state.snowJob && state.snowJob.drifts.some(d => d.luUpperParts && d.luUpperParts.length > 1 && sameName(d.lower, Fd.name)) ? ' — its fetch runs through the roofs in line (Snow & drift page), where NBG Frame\'s own drift takes the adjacent roof alone' : ''}.` : ''}</div>` : '';
    return `<div class="panel-sub ff-write"><h4>Into the frame file <small class="sub-n">one file with everything this frame line takes from the tool</small></h4>
      <div class="seis-grid"><label><span class="lab">Frame file</span><select data-ffile="${esc(fKey(Fd))}"><option value="">—</option>${fs.map(x => `<option value="${esc(x.name)}" ${file && file.name === x.name ? 'selected' : ''}>${esc(x.name)} · ${esc(x.ff.info.building || 'no building')} · ${x.ff.info.lines.length ? 'line ' + x.ff.info.lines.join(', ') + ' · ' : ''}${ft(x.ff.info.width)} wide · bay ${ft(x.ff.info.bayWidth)}</option>`).join('')}</select><small class="sub-n">${file ? (fileFor(Fd) === file ? 'matched to this frame line' : 'picked here') : 'none matches this frame line — pick one'}</small></label></div>
 ${hadT}
      ${file ? `<div class="seis-bfile-a"><button class="btn-soft" data-ffwrite="${esc(fKey(Fd))}" ${what.length ? '' : 'disabled'}><svg><use href="#i-file"/></svg>Write ${what.length ? what.join(', ') : 'nothing to write'}</button><small class="sub-n">${esc(file.name)} → ${esc(file.name.replace(/\.frame$/i, ''))}_loads.frame · earlier rows of the same names are replaced; nothing else in the model changes</small></div>` : ''}</div>`;
  }
  function leanToPanel(Fd, file) {
    const lts = leanFiles(Fd), lt = state.leanTo || {};
    const steps = state.snowJob ? state.snowJob.drifts.filter(d => !d.level && d.step.upper && sameName(d.upper, Fd.name)) : [];
    if (!lts.length && !steps.length) return '';
    const guide = `<ol class="lt-steps"><li><b>Design the lower building first</b> — pick its frame lines on the plan: the drift from this roof is on them; write its Snow Drift rows into its .frame file below and design it in NBG Frame.</li><li><b>Drop the designed lean-to .frame back</b> on the Project page.</li><li><b>Its reactions land here</b> — the column against this wall, case by case, on each column of this frame its lines bear on, at its eave: "Lean to – COL – Reaction" rows, Y = −vertical at its base, X = −horizontal at its top (as the engineer types them).</li></ol>`;
    const on = (lt.on || {})[fKey(Fd)];
    return `<div class="panel-sub lean-to"><h4>Lean-to onto this frame <small class="sub-n">${steps.map(d => `${esc(d.lower)} against its ${d.upperWall}`).join(' · ') || 'a lower building against this frame'}</small></h4>${guide}
      ${lts.length ? lts.map(it => { const T = leanTargets(Fd, it), rx = it.ff.info.reactions.filter(r => r.col === T.col), totLen = T.targets.reduce((a, t) => a + (T.bay || t.trib), 0), lowLen = T.step.step.lower.g.length;
        const doubles = T.bay > 0 && T.targets.length > 1 && T.targets.some(t => Math.abs(t.trib - T.bay) > 0.05);
        return `<div class="lt-file"><label class="seis-chk"><input type="checkbox" data-lton="${esc(it.name)}" ${on === it.name ? 'checked' : ''}> <span><b class="mono">${esc(it.name)}</b> — ${esc(T.lower)}'s ${esc(T.col)} (against the ${T.wall}) onto ${T.targets.map(t => `<b>${esc(t.member || '?')}</b> (its line ${t.line}, at ${ft(t.at)})`).join(' and ')}</span></label>
        ${doubles ? `<div class="seis-msg warn">Check: ${esc(it.name)} is set to a ${ft(T.bay)} bay, but ${esc(T.lower)}'s frame lines here carry ${T.targets.map(t => ft(t.trib)).join(' and ')}. The same reactions on ${T.targets.length} columns put ${ft(totLen)} of lean-to on this frame for a ${ft(lowLen)} building. <label class="seis-chk sm"><input type="checkbox" data-ltscale="1" ${lt.scale ? 'checked' : ''}> <span>scale each column's reactions to its line's tributary width (× ${T.targets.map(t => F3(t.trib / T.bay)).join(' / ')})</span></label></div>` : ''}
        <div class="table-wrap"><table class="fl-t"><thead><tr><th>Case</th><th class="num">Vertical at the base (k)</th><th class="num">Horizontal at the top (k)</th><th>On the host${lt.scale && doubles ? ' (scaled)' : ''}</th></tr></thead><tbody>${rx.map(r => `<tr><td class="mono"><b>${esc(r.caseName)}</b>${(file && file.ff.info.cases.length && !file.ff.info.cases.includes(r.caseName)) ? ' <small class="sub-n">not a case of this frame — left out</small>' : ''}</td><td class="num mono">${F3(r.V)}</td><td class="num mono">${r.Htop != null ? F3(r.Htop) : '—'}</td><td class="mono">Y ${F3(-r.V)} · X ${F3(-(r.Htop || 0))}</td></tr>`).join('')}</tbody></table></div></div>`; }).join('')
      : `<small class="sub-n">No designed lean-to frame file loaded yet.</small>`}</div>`;
  }
  function wireFrameFile(Fd) {
    const sel = $(`#frameRows [data-ffile]`);
    if (sel) sel.onchange = () => { state.frameFile = state.frameFile || {}; if (sel.value) state.frameFile[fKey(Fd)] = sel.value; else delete state.frameFile[fKey(Fd)]; renderFrames(); };
    $$('#frameRows [data-lton]').forEach(el => { el.onchange = () => { state.leanTo = state.leanTo || {}; state.leanTo.on = state.leanTo.on || {}; if (el.checked) state.leanTo.on[fKey(Fd)] = el.dataset.lton; else delete state.leanTo.on[fKey(Fd)]; renderFrames(); }; });
    $$('#frameRows [data-ltscale]').forEach(el => { el.onchange = () => { state.leanTo = state.leanTo || {}; state.leanTo.scale = el.checked; renderFrames(); }; });
    const btn = $('#frameRows [data-ffwrite]');
    if (btn) btn.onclick = async () => {
      const file = chosenFile(Fd);
      if (!file) { toast('Pick the frame file first'); return; }
      const plan = framePlan(Fd, file);
      try {
        let xml = file.ff.xml, conv = null;
        const crows = plan.mezz.concat(plan.crows);
        if (crows.length) { const add = FF.addLoads(xml, crows, { toFlange: C.webCode ? C.webCode() : undefined, floors: plan.mezz.length > 0 }); xml = add.xml; conv = add; }
        const pl = FF.addPanelLoads(xml, plan.pan.map(r => ({ name: r.name, caseId: r.caseId, panel: r.panel, from: r.from, to: r.to, start: r.start, end: r.end, dir: r.dir })));
        xml = pl.xml;
        const bytes = await FF.write(file.ff, xml, zipIO), name = file.name.replace(/\.frame$/i, '') + '_loads.frame';
        cpSave(bytes, name, 'application/octet-stream');
        toast(`${name} — ${[plan.pan.length && `${pl.added} Snow Drift rows${pl.replaced ? ` (in place of ${pl.replaced})` : ''}`, plan.crows.length && `${plan.crows.length} lean-to rows`, plan.mezz.length && `${plan.mezz.length} mezzanine rows`].filter(Boolean).join(', ')}${plan.ltInfo && plan.ltInfo.skipped.length ? ` · ${plan.ltInfo.skipped.join(', ')} left out (not cases of this frame)` : ''}`);
      } catch (e) { console.error(e); toast('Frame file: ' + e.message); }
    };
  }

  // ---------- Bracing ----------
  /* Where the mezzanine's longitudinal seismic goes, wall by wall. The rule (NBG practice, the W0S job): EQB and EQF at
     the frame lines nearest the two ends of the mezzanine's run along that wall, at the mezzanine level; a wall the
     mezzanine does not stand on gets nothing; the X-bracing in a bay inside the run is tiered at the mezzanine level
     with a strut there; an edge not on a wall needs a wall of its own — a portal frame or X-bracing on that line. */
  const nearestLine = (lines, x) => { let k = 0; lines.forEach((l, i) => { if (Math.abs(l.x - x) < Math.abs(lines[k].x - x)) k = i; }); return k; };
  function renderBracing() {
    const box = $('#braceWalls');
    if (!box) return;
    const sj = state.job && state.job.seismic, J = state.snowJob;
    if (!J || !J.site.buildings.length) { box.innerHTML = state.pcs ? '<div class="seis-msg warn">The walls wait for the ground snow load (Snow & drift page) — the site is laid out with it.</div>' : '<div class="empty">Load a PCS first.</div>'; $('#braceFlags').innerHTML = ''; return; }
    const flags = [], many = J.site.buildings.length > 1, mzAll = mezzBoxes(), live = !!(sj && sj.ok);
    const walls = J.site.buildings.map(b => {
      const bS = sb(b.name), bf = bS && (state.bracing || {})[bS.bkey], g = b.g, L = g.length, W = g.width, br = bracingOf(b.name);
      const lines = bf ? bf.file.info.lines.map(l => ({ no: l.index + 1, x: l.x })) : b.xs.map((x, i) => ({ no: i + 1, x }));
      const plan = bf && bS ? bracingPlan(bS) : { loads: [], struts: [], notes: [] };
      const mz = mzAll.filter(q => sameName(q.building, b.name));
      const pre = many ? b.name + ': ' : '';
      const wallSvg = w => {
        const wi = bf && bf.file.info.walls[w], bw = br.walls[w];
        // the file's rods, and PCS Box 12's portal frames in bays the file leaves bare (portal frames are not rods)
        const bays = wi ? wi.bays.map(x => { const pf = !x.braced && bw.bays.find(q => q.kind === 'portal' && q.from === x.from); return pf ? { ...x, braced: true, kind: 'portal', src: 'PCS' } : { ...x, kind: 'x' }; }) : lines.slice(0, -1).map((l, i) => { const bb = bw.bays.find(q => q.from === i); return { from: i, to: i + 1, braced: !!bb, kind: bb ? bb.kind : 'x', braces: bb && bb.tiers.length ? bb.tiers.map(([bottom, top]) => ({ bottom, top })) : [], struts: [] }; });
        // the mezzanines on this wall, and the loads: from the bracing file's plan, else by the rule above (the forces
        // once the Seismic page is complete; their places before)
        const onWall = mz.filter(q => (w === 'FSW' ? q.y0 < 0.6 : q.y1 > W - 0.6));
        let loads = plan.loads.filter(l => l.wall === w).map(l => ({ line: l.line + 1, elev: l.elev, F: l.F, caseId: l.caseId }));
        const bl = bS ? bS.braceLines.filter(l => l.wall === w) : [];
        const ends = [];
        if (!loads.length) {
          const src = live && bl.length ? bl.map(l => ({ x0: l.x0, x1: l.x1, at: l.at, F: l.F })) : onWall.map(q => ({ x0: q.x0, x1: q.x1, at: q.A, F: null }));
          src.forEach(l => { let i0 = nearestLine(lines, l.x0), i1 = nearestLine(lines, l.x1); if (i0 === i1) { if (i1 + 1 < lines.length) i1++; else if (i0 > 0) i0--; } ends.push([i0, i1, l.at]); loads.push({ line: i0 + 1, elev: l.at, F: l.F, caseId: 'EQB' }); loads.push({ line: i1 + 1, elev: l.at, F: l.F == null ? null : -l.F, caseId: 'EQF' }); });
        } else bl.forEach(l => ends.push([nearestLine(lines, l.x0), nearestLine(lines, l.x1), l.at]));
        // tiers at the mezzanine level in the braced X bays inside the run; a strut line from the loads to the braced bay
        const strutsPlanned = [];
        ends.forEach(([i0, i1, A]) => {
          bays.forEach(bay => { if (bay.braced && bay.kind !== 'portal' && bay.from >= Math.min(i0, i1) && bay.to <= Math.max(i0, i1)) bay.tierAt = A; });
          if (!bf) {
            const inside = bays.some(bay => bay.braced && bay.from >= Math.min(i0, i1) && bay.to <= Math.max(i0, i1));
            if (inside) strutsPlanned.push({ from: Math.min(i0, i1), to: Math.max(i0, i1), elev: A });
            else { const near = bays.filter(bay => bay.braced).sort((p, q) => Math.min(Math.abs(p.from - i0), Math.abs(p.to - i1)) - Math.min(Math.abs(q.from - i0), Math.abs(q.to - i1)))[0]; if (near) strutsPlanned.push({ from: Math.min(i0, i1, near.from), to: Math.max(i0, i1, near.to), elev: A }); }
          }
        });
        const braced = bays.some(x => x.braced);
        if (loads.length && !braced) flags.push({ level: 'warn', text: `${pre}the mezzanine's longitudinal seismic goes to the ${w} as EQB / EQF, but ${bf ? 'the bracing file has no braced bay on that wall' : bw.open ? `PCS Box 12 puts ${bw.type} on it with the bay "${bw.open}" — not named yet` : bw.kind === 'none' ? 'PCS Box 12 lists no bracing on that wall' : 'no source names a braced bay on that wall'} — it needs a braced bay or a portal frame there.` });
        if (loads.length && braced && !bf) { const t = bays.filter(x => x.tierAt != null); if (t.length) flags.push({ level: 'info', text: `${pre}${w}: the X-bracing in bay${t.length > 1 ? 's' : ''} ${t.map(x => `${x.from + 1}–${x.to + 1}`).join(', ')} sits inside the mezzanine's run — tier it at the mezzanine level (${ft(t[0].tierAt)}) with the wall strut line there, as NBG Bracing's Add Wall Strut Line does, so the EQB / EQF have joints to go to.` }); }
        if (loads.length && bays.some(x => x.braced && x.kind === 'portal')) flags.push({ level: 'info', text: `${pre}${w}: PCS Box 12 asks for portal frames — the EQB / EQF at the mezzanine level go to the portal frame bay${bays.filter(x => x.braced).length > 1 ? 's' : ''} through the wall strut line.` });
        const note = `${bw.type || (wi ? 'bracing file' : 'no bracing listed')}${bw.bays.length && bw.kind !== 'roofx' ? ` · bay${bw.bays.length > 1 ? 's' : ''} ${bw.bays.map(q => q.from + 1).join(', ')}` : bw.open ? ` · bays ${bw.open}` : ''}`;
        return B.wallSvg({ name: b.name, wall: w, length: L, eave: w === 'FSW' ? g.eaveFSW : g.eaveBSW, lines, bays, loads, mezz: onWall.map(q => ({ x0: q.x0, x1: q.x1, A: q.A, id: q.id })), strutsPlanned: state.seis.strutLine === false ? [] : (bf ? plan.struts.filter(s => s.wall === w) : strutsPlanned), src: bf ? (bays.some(x => x.src === 'PCS') ? 'the bracing file + PCS Box 12 (portal frames)' : 'the bracing file') : bw.bays.some(q => q.src === 'eScope') ? 'the eScope' : bw.bays.length ? 'PCS Box 12' : null, note });
      };
      // edges off the walls: a wall of their own, in the bays they run through
      (live && bS ? bS.braceLines : []).filter(l => l.independent).forEach(l => {
        const bays = []; lines.slice(0, -1).forEach((ln, i) => { if (l.segs.some(([a, c]) => lines[i + 1].x > a + 0.1 && ln.x < c - 0.1)) bays.push(i + 1); });
        const span = bays.length ? `bay${bays.length > 1 ? 's' : ''} ${bays.join(', ')} (frame line${bays.length > 1 ? 's' : ''} ${bays[0]} to ${bays[bays.length - 1] + 1})` : '';
        flags.push({ level: 'stop', text: `${pre}${l.edge} holds ${F2(l.design)} k of the mezzanine's longitudinal seismic (${l.governs}) and is not on a sidewall. Give it a line in NBG Bracing — a wall with a portal frame on that line in ${span || 'the bays it runs through'} (its loads replace that column and beam), or X-bracing from the mezzanine level to the floor (DM 15.1.3).` });
      });
      const ends = ['LEW', 'REW'].map(w => { const bw = br.walls[w]; return `${w}: ${bw.type || 'not listed'}${bw.kind === 'x' ? (bw.bays.length ? ` · bay ${bw.bays.map(q => q.from + 1).join(', ')}` : bw.open ? ` · bays ${bw.open}` : '') : bw.kind === 'roofx' ? ' (drawn in the end bays)' : ''}`; }).join(' · ');
      return `${many ? `<h4 class="seis-bh">${esc(b.name)} <small class="sub-n">${esc(g.profile || '')} · ${ft(W)} × ${ft(L)} · ${mz.length ? mz.map(q => mezzName(q.id)).join(', ') : 'no mezzanine'}</small></h4>` : ''}<div class="brace-pcs"><b>PCS Box 12</b> · ${br.src ? `bracing drawn from ${esc(br.src)} · ` : ''}${esc(ends)}</div><div class="wall-grid"><div class="wall-card">${wallSvg('FSW')}</div><div class="wall-card">${wallSvg('BSW')}</div></div>
        ${bS && bS.braceLines.length && live ? `<div class="brace-lines">${bS.braceLines.map(l => `<span class="chip ${l.independent ? 'bad' : 'ok'}"><b>${esc(l.edge)}</b> ${F2(l.design)} k${l.independent ? ' · no wall' : ''}</span>`).join('')}</div>` : ''}`;
    }).join('');
    // before the seismic is complete the geometry alone says where the force will have to go
    if (!live && sj) sj.buildings.forEach(b => {
      const W = b.bd.width, pre = many ? b.name + ': ' : '';
      mzAll.filter(q => sameName(q.building, b.name)).forEach(q => {
        [['FSW side', q.y0], ['BSW side', q.y1]].forEach(([lab, y]) => {
          const onWall = y < 0.6 ? 'FSW' : y > W - 0.6 ? 'BSW' : null;
          if (onWall) flags.push({ level: 'info', text: `${pre}${mezzName(q.id)}'s ${lab} edge is the ${onWall}: its share of the longitudinal seismic goes to the ${onWall} as EQB / EQF at ${ft(q.A)} (the values once the Seismic page is complete).` });
          else flags.push({ level: 'stop', text: `${pre}${mezzName(q.id)}'s ${lab} edge sits ${ft(y)} from the FSW — not on a wall. Its share of the longitudinal seismic needs a line there in NBG Bracing: a wall with a portal frame (its loads replace that column and beam) or X-bracing from the mezzanine level to the floor (DM 15.1.3).` });
        });
      });
    });
    box.innerHTML = walls;
    $('#braceWallsSub').textContent = Object.keys(state.bracing || {}).length ? 'bays, X-bracing, tiers and strut lines from the bracing file · EQB / EQF as written into it' : state.scope ? 'braced bays from the eScope · the bracing file (Project page) adds its tiers and takes the loads' : 'frame lines from PCS Box 2, bracing from PCS Box 12 · the bracing file (Project page) adds its tiers and takes the loads';
    $('#braceFlags').innerHTML = (live ? '' : `<div class="seis-msg warn">The Seismic page is not complete yet${sj && sj.need && sj.need.length ? ` (${esc(sj.need[0])})` : ''} — the forces come once it is; where they go is known from the layout:</div>`) + (flags.length ? flags.map(n => `<div class="seis-msg ${n.level}">${esc(n.text)}</div>`).join('') : (live ? '<div class="seis-msg ok">Every mezzanine edge that takes longitudinal seismic sits on a braced sidewall.</div>' : ''));
  }

  // ---------- Purlins ----------
  function renderPurlins() {
    const box = $('#purlinView');
    if (!box) return;
    const J = state.snowJob;
    if (!J || !J.site.buildings.length) { box.innerHTML = state.pcs ? '<div class="seis-msg warn">The purlin loads wait for the ground snow load.</div>' : '<div class="empty">Load a PCS first.</div>'; return; }
    const sp = (state.snow && state.snow.purlin) || DEFAULT_PURLIN;
    const steps = J.drifts.filter(d => !d.drift.none && !d.off);
    box.innerHTML = `<div class="seis-msg warn"><b>Reminder.</b> The purlins are designed in the purlin program — this page only carries the drift to it. The balanced snow and the roof loads go in there as usual.</div>
      <div class="seis-grid"><label><span class="lab">Purlin spacing (ft)</span><input class="seis-in" data-purlin="1" inputmode="decimal" value="${sp}"><small class="sub-n">PCS Box 2 "Typical Purlin Spacing" — Per Seller on most quotes; 5'-0" assumed</small></label></div>
      ${steps.length ? steps.map(d => {
        const dr = d.drift, reach = Math.min(dr.w, d.lowerWidth), rows = [];
        if (d.kind === 'side') { for (let x = sp / 2; x < reach; x += sp) rows.push({ x, q: SNOW.driftAt(dr, x) * sp }); }
        return `<div class="panel-sub"><h4>${esc(d.lower)} · drift from ${esc(d.upper)} at its ${d.lowerWall} <small class="sub-n">pd ${F1(dr.pd)} psf · w ${ft(dr.w)}${dr.truncated ? ' (cut off at the far eave)' : ''}</small></h4>
          ${d.kind === 'side' ? `<p>The drift runs across the purlins: each purlin line takes the drift at its distance from the wall × the purlin spacing, uniform along the purlin where the higher wall stands (${ft(d.length)} of it).</p><div class="table-wrap"><table class="fl-t"><thead><tr><th>Purlin line</th><th class="num">From the ${d.lowerWall} (ft)</th><th class="num">Drift (psf)</th><th class="num">Line load (plf)</th><th class="num">+ balanced (plf)</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="mono">P${i + 1}</td><td class="num mono">${F2(r.x)}</td><td class="num mono">${F1(r.q / sp)}</td><td class="num mono"><b>${n0(r.q)}</b></td><td class="num mono">${n0(r.q + d.psLower * sp)}</td></tr>`).join('')}</tbody></table></div>`
            : `<p>The drift runs along the purlins: on each purlin in the ${ft(d.length)} stretch against the higher wall, a triangle from <b>${n0(dr.pd * sp)} plf</b> at the ${d.lowerWall} down to ${dr.truncated ? `${n0(dr.end * sp)} plf at the far end` : `0 at ${ft(dr.w)} from it`} — the largest on the purlin bays nearest the wall${dr.w > sp * 2 ? ', with the step-back from the first purlin bay to work out for the cantilever' : ''}.</p>`}
          ${d.sliding.applies ? `<p>Sliding snow adds ${n0(d.sliding.psf * sp)} plf over the first ${ft(d.sliding.extent)} from the wall.</p>` : ''}</div>`;
      }).join('') : '<div class="seis-msg info">No drift on this job — the purlins take the balanced (and unbalanced) snow only.</div>'}`;
    const inp = $('#purlinView [data-purlin]');
    if (inp) inp.onchange = () => { state.snow = state.snow || {}; const v = +inp.value; if (v > 0) state.snow.purlin = v; else delete state.snow.purlin; snowSave(); renderPurlins(); renderSnow(); };
  }

  function render() { renderProject(); renderBuilding(); renderSnow(); renderFrames(); renderBracing(); renderPurlins(); }
  return { render, renderProject, renderBuilding, renderBldPlan, renderSnow, renderFrames, renderBracing, renderPurlins, selectFrame, compute, setWs, wsOf, snowLoad, facts, mezzBoxes, bracingOf };
};
