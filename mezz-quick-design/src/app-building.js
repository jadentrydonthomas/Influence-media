/* The whole-building pages of the tool: Project & files, Building (3D site, site plan, every frame line), Snow & drift,
   Frames (one frame line with every load drawn), Bracing (each sidewall with its X-bracing, struts and EQB / EQF) and
   Purlins. Mounted by src/app.js with its state and helpers (C); src/building.js draws, src/site.js and src/snow.js
   work the numbers. */
window.MZ_APP_BUILDING = function (C) {
  'use strict';
  const { state, $, $$, esc, ft, f, n0, go, toast, recompute, M3, B, SITE, SNOW, FF, sameName, inpOf, addFrameFiles, addSeisFiles, cpDownload, bracingPlan, zipIO, cpSave } = C;
  const F1 = v => f(v, 1), F2 = v => f(v, 2), F3 = v => f(v, 3);
  const JOB_VIEWS = new Set(['upload', 'building', 'snow', 'seismic', 'frames', 'bracing', 'purlins']);
  const MEZZ_VIEWS = new Set(['results', 'inputs', 'plan', 'beam', 'column', 'designer']);
  let bldModel = null, snowRestored = null;
  const DEFAULT_PURLIN = 5;

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
  // the mezzanines as boxes in their own building's plan (for the site drawings)
  const mezzBoxes = () => ((state.job && state.job.mezz) || []).filter(m => !m.incomplete && m.layout && m.layout.footprint.x1 > m.layout.footprint.x0).map(m => { const fp = m.layout.footprint, inp = inpOf(m); return { building: inp.mezz.building || (state.pcs && state.pcs.planBuilding) || '', id: m.id, x0: fp.x0, x1: fp.x1, y0: fp.y0, y1: fp.y1, A: inp.geom.A.value ?? 12 }; });
  const sb = name => (state.job && state.job.seismic ? state.job.seismic.buildings.find(b => sameName(b.name, name)) : null);
  const siteB = name => (state.snowJob ? state.snowJob.site.buildings.find(b => sameName(b.name, name)) : null);
  // the loads one frame line takes beside the snow: NBG Frame's roof dead + collateral, the mezzanine's FDL / FLL on its
  // columns, the seismic EQR / EQL, a designed lean-to's reactions
  function ext(name, no) {
    const b = sb(name), fe = ((state.job && state.job.frameEntries) || []).find(x => String(x.frame) === String(no) && (!x.building || sameName(x.building, name)));
    const atOf = e => (state.nbg.height === 'beam' ? e.elev : e.A != null ? e.A : e.elev);
    const mezz = fe ? fe.entries.filter(e => e.member).map(e => ({ y: e.y, elev: atOf(e), D: e.D, L: e.L, member: e.member, label: e.label })) : [];
    const fr = b ? (b.frames || []).find(x => String(x.label) === String(no)) : null;
    const eq = fr ? fr.eqs.map(q => { const e = fe && fe.entries.find(z => z.label === q.label); return { y: e ? e.y : 0, at: q.at, F: q.F, member: q.member }; }) : [];
    const lean = (state.leanTo && state.leanTo.applied || []).filter(q => sameName(q.building, name) && String(q.frame) === String(no)).map(q => ({ y: q.y, at: q.at, text: `${q.cases.length} cases · SL ${F2(q.SL)} k` }));
    return { deadPsf: b ? b.roof.RDL.value : null, collPsf: b ? b.roof.CDL.value : null, mezz, eq, leanTo: lean };
  }
  function bracingFor3d() {
    const out = {}, sj = state.job && state.job.seismic;
    (sj ? sj.buildings : []).forEach(b => {
      const bf = (state.bracing || {})[b.bkey], scopeB = state.scope && state.scope.buildings.find(x => sameName(x.name, b.name));
      const w = {};
      ['FSW', 'BSW'].forEach(k => {
        if (bf && bf.file.info.walls[k]) w[k] = bf.file.info.walls[k].bays.filter(x => x.braced).map(x => ({ from: x.from, to: x.to, tiers: [...new Set(x.braces.map(t => `${t.bottom}|${t.top}`))].map(q => q.split('|').map(Number)) }));
        else if (scopeB) w[k] = (scopeB.bracing[k] || []).flatMap(t => (t.bays || []).map(n => ({ from: n - 1, to: n, tiers: [] })));
      });
      if (Object.keys(w).length) out[b.name] = w;
    });
    return out;
  }
  const frameData = (name, no) => (state.snowJob && state.snowJob.site.buildings.length ? B.frameData(state.snowJob, name, no, ext(name, no)) : null);
  function selectFrame(name, no, open) {
    state.frameSel = { building: name, frame: +no };
    renderFrames(); renderBuilding();
    if (open) go('frames');
  }
  const kft = v => (v == null ? '—' : `${F3(Math.abs(v))} k/ft`);

  // ---------- Project & files ----------
  function renderProject() {
    const box = $('#projectSummary');
    if (!box) return;
    if (!state.pcs) { box.innerHTML = ''; return; }
    const pcs = state.pcs, J = state.snowJob, site = J ? J.site : null, files = state.nbg.files || [], br = Object.entries(state.bracing || {}), scope = state.scope;
    const bl = Object.entries(pcs.site || {}).map(([n, b]) => { const g = b.building || {}, r = b.roof || {}; return `<div class="pj-bldg"><b>${esc(n)}</b><span>${esc(g.profile || '')} · ${ft(g.width)} × ${ft(g.length)}</span><span>eaves ${ft(g.eaveFSW)} / ${ft(g.eaveBSW)} · ${(g.bays || []).length} bays</span><span>snow ${r.snow && r.snow.value != null ? F1(r.snow.value) + ' psf' + (r.snow.override ? ' (override)' : '') : '—'} · Ct ${r.Ct ?? '—'}</span></div>`; }).join('');
    const att = (pcs.attachments || []).map(a => `<li>${esc(a.building)} ${a.wall} → ${esc(a.to)} ${a.toWall}${a.at ? ` at ${ft(a.at)}` : ''}</li>`).join('');
    const loaded = [...files.map(x => `<li><i class="pj-k">frame</i>${esc(x.name)}${x.ff ? ` <small>${esc(x.ff.info.building || '')} · lines ${esc(x.lines)}</small>` : x.err ? ` <small class="bad">${esc(x.err)}</small>` : ''}</li>`), ...br.map(([k, v]) => `<li><i class="pj-k">bracing</i>${esc(v.name)} <small>${v.file.info.lines.length} frame lines</small></li>`), ...(scope ? [`<li><i class="pj-k">eScope</i>${esc(scope.name)} <small>${esc(scope.code || '')}</small></li>`] : [])];
    const F = J && J.F;
    box.innerHTML = `<div class="pj">
      <div class="pj-head"><div><div class="eyebrow">This project</div><h3>${esc(pcs.job.quote || '')}${pcs.job.project ? ` · ${esc(pcs.job.project)}` : ''}</h3><small>${esc((pcs.code || {}).text || '')} · Risk ${esc((pcs.seismic || {}).risk || '—')} · ${site ? site.buildings.length : Object.keys(pcs.site || {}).length} building${site && site.buildings.length !== 1 ? 's' : ''} · ${pcs.mezzanines.length} mezzanine${pcs.mezzanines.length !== 1 ? 's' : ''}</small></div>
        <div class="pj-acts"><button class="btn-soft" data-go="building"><svg><use href="#i-bldg"/></svg>Open the building</button><button class="btn-ghost" data-go="results">Mezzanines</button></div></div>
      <div class="pj-grid">
        <div class="pj-card"><h4>Buildings <small>PCS Box 2 / 4</small></h4>${bl}${att ? `<ul class="pj-list">${att}</ul>` : ''}</div>
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
  function renderBuilding() {
    const J = state.snowJob, el = $('#bldMetrics');
    if (!el) return;
    if (!J || !J.site.buildings.length) {
      $('#bldNeed').innerHTML = state.pcs ? `<div class="seis-msg warn">${J && J.error ? esc(J.error) : 'The site needs the ground snow load (PCS Box 3) — type it on the Snow & drift page.'}</div>` : '';
      el.innerHTML = ''; $('#bldPlan').innerHTML = ''; $('#bldFrames').innerHTML = ''; $('#bldNotes').innerHTML = '';
      return;
    }
    const site = J.site, pcs = state.pcs, nF = site.buildings.reduce((a, b) => a + b.xs.length, 0), drifts = J.drifts.filter(d => !d.drift.none && !d.off);
    const mz = mezzBoxes();
    $('#bldTitle').innerHTML = site.buildings.length > 1 ? `${site.buildings.map(b => esc(b.name)).join(' <em>+</em> ')}` : `<em>${esc(site.buildings[0].name)}</em>`;
    $('#bldEyebrow').textContent = `${esc(pcs.job.quote || '')} · ${site.buildings.length} building${site.buildings.length > 1 ? 's' : ''} · ${nF} frame lines`;
    $('#bldNeed').innerHTML = '';
    const m = (lab, val, sub) => `<div class="metric"><span>${lab}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    el.innerHTML = m('Buildings', site.buildings.length, site.buildings.map(b => esc(b.name)).join(' · ')) + m('Frame lines', nF, site.buildings.map(b => `${esc(b.name)} ${b.xs.length}`).join(' · '))
      + m('Roof snow', J.roofs.map(r => F1(r.design)).join(' / ') + ' psf', `pg ${F1(J.F.pg.value)} psf · ASCE ${esc(J.F.ed)}`)
      + m('Roof steps', J.drifts.length, drifts.length ? drifts.map(d => `${esc(d.lower)}: drift ${F1(d.drift.pd)} psf over ${ft(d.drift.w)}`).join(' · ') : J.drifts.length ? 'no drift: the roofs meet at the eave' : 'none')
      + m('Mezzanines', mz.length, mz.map(q => `${esc(q.id)} at ${ft(q.A)}`).join(' · ') || '—');
    // 3D
    const canvas = $('#bldCanvas');
    if (canvas && M3) {
      if (!bldModel) {
        bldModel = M3.mount(canvas, { pad: [26, 24], min: [320, 320], onSelect: id => { const mm = state.bldScene && state.bldScene.members.find(q => q.id === id); if (mm && mm.ref && mm.ref.type === 'frame') selectFrame(mm.ref.building, mm.ref.frame, true); else if (mm && mm.ref && mm.ref.type === 'frameCol') selectFrame(mm.ref.building, mm.ref.frame, true); }, onFocus: () => {} });
        const t = $('#bldTools');
        t.innerHTML = `<div class="seg" id="bldToggles">${[['snow', 'Snow', true], ['drift', 'Drift', true], ['flakes', 'Snowfall', true], ['mezz', 'Mezzanines', true], ['joists', 'Joists', false], ['roof', 'Roofs', true], ['brace', 'Bracing', true], ['purlin', 'Purlins', false]].map(([k, l, on]) => `<button data-t="${k}" class="${on ? 'is-on' : ''}">${l}</button>`).join('')}</div><div class="seg"><button id="bldPause">Pause rotation</button><button id="bldReset">Reset view</button><button id="bldIn">+</button><button id="bldOut">−</button></div>`;
        $$('#bldToggles button').forEach(b => { b.onclick = () => { const on = !b.classList.contains('is-on'); b.classList.toggle('is-on', on); bldModel.toggle(b.dataset.t, on); }; });
        bldModel.toggle('purlin', false); bldModel.toggle('joists', false);
        $('#bldPause').onclick = () => { const on = bldModel.auto; bldModel.pause(on); $('#bldPause').textContent = on ? 'Resume rotation' : 'Pause rotation'; };
        $('#bldReset').onclick = () => bldModel.reset();
        $('#bldIn').onclick = () => bldModel.zoom(1.15); $('#bldOut').onclick = () => bldModel.zoom(1 / 1.15);
      }
      state.bldScene = B.scene(J, { mezz: mz, bracing: bracingFor3d(), purlin: (state.snow && state.snow.purlin) || DEFAULT_PURLIN });
      // the mezzanines as designed — their beams, columns and joists from the mezzanine model — placed in the site
      try {
        const host = siteB((state.pcs && state.pcs.planBuilding) || (mz[0] && mz[0].building)), ms = C.mezzScene && host && state.res && !state.res.incomplete ? C.mezzScene() : null;
        if (ms) {
          const T = p => host.toSite(p);
          const box = b => { const a = T([b.x0, b.y0]), c = T([b.x1, b.y1]); return { x0: Math.min(a[0], c[0]), x1: Math.max(a[0], c[0]), y0: Math.min(a[1], c[1]), y1: Math.max(a[1], c[1]), z0: b.z0, z1: b.z1 }; };
          const pt = q => { const a = T([q[0], q[1]]); return [a[0], a[1], q[2]]; };
          ms.members.filter(m => m.kind === 'beam' || m.kind === 'col' || m.kind === 'joist').forEach(m => state.bldScene.members.push({ ...m, id: 'mezz · ' + m.id, kind: m.kind === 'joist' ? 'joist' : 'mezz', boxes: (m.boxes || []).map(box), lines: (m.lines || []).map(([a, c]) => [pt(a), pt(c)]), ref: { type: 'mezzMember' } }));
          // the translucent slab stays as the floor; the drawn members sit under it
          state.bldScene.members.filter(m => m.ref && m.ref.type === 'mezz').forEach(m => { m.alpha = 0.22; });
        }
      } catch (e) { console.error(e); }
      bldModel.set(state.bldScene);
      $('#bldModelTitle').textContent = site.buildings.map(b => `${b.name} ${ft(b.g.width)} × ${ft(b.g.length)}`).join(' · ');
    }
    // the site plan, each frame line clickable
    $('#bldPlan').innerHTML = B.planSvg(J, { mezz: mz, selected: state.frameSel });
    $$('#bldPlan .sp-fl').forEach(g => { const open = () => selectFrame(g.dataset.bldg, +g.dataset.frame, true); g.onclick = open; g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }; });
    // every frame line: what it carries
    $('#bldFrames').innerHTML = site.buildings.map(b => {
      const rows = B.frameLines(b).map(fl => {
        const Fd = frameData(b.name, fl.no), ld = Fd ? Fd.loads : {}, drift = (ld.drift || []), peak = drift.length ? Math.max(...drift.map(s => Math.max(-s.start, -s.end))) : 0;
        const sel = state.frameSel && sameName(state.frameSel.building, b.name) && state.frameSel.frame === fl.no;
        const mezzT = (ld.mezz || []).length ? `${ld.mezz.length} column${ld.mezz.length > 1 ? 's' : ''} · FDL ${F2(ld.mezz.reduce((a, q) => a + q.D, 0))} · FLL ${F2(ld.mezz.reduce((a, q) => a + q.L, 0))} k` : '—';
        const eqT = (ld.eq || []).length ? `EQ ${F2(ld.eq.reduce((a, q) => a + q.F, 0))} k` : '';
        return `<tr class="${sel ? 'is-sel' : ''}" data-bldg="${esc(b.name)}" data-frame="${fl.no}" tabindex="0"><td class="mono"><b>${fl.no}</b></td><td>${esc(fl.type || '—')}<small class="sub-n">${fl.end ? fl.end + ' · ' : ''}${ft(fl.trib)} trib · ${fl.cols.length} columns</small></td><td class="num mono">${ld.snow ? kft(ld.snow.kft) : '—'}</td><td class="num mono">${peak ? `<b>${kft(peak)}</b><small class="sub-n">${Fd.step ? Fd.step.side + ' side' : 'end'}</small>` : '—'}</td><td>${mezzT}${eqT ? `<small class="sub-n">${eqT}</small>` : ''}</td><td class="num"><button class="btn-ghost sm" data-bldg="${esc(b.name)}" data-frame="${fl.no}">Loads →</button></td></tr>`;
      }).join('');
      return `${site.buildings.length > 1 ? `<h4 class="seis-bh">${esc(b.name)} <small class="sub-n">${esc(b.g.profile || '')} · ${ft(b.g.width)} × ${ft(b.g.length)}</small></h4>` : ''}<div class="table-wrap"><table class="fl-t bld-t"><thead><tr><th>Line</th><th>Frame</th><th class="num">Snow (PY)</th><th class="num">Drift peak</th><th>Mezzanine</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
    $$('#bldFrames [data-frame]').forEach(x => { const open = () => selectFrame(x.dataset.bldg, +x.dataset.frame, true); x.onclick = e => { e.stopPropagation(); open(); }; if (x.tagName === 'TR') x.onkeydown = e => { if (e.key === 'Enter') open(); }; });
    // flags
    const sj = state.job && state.job.seismic, notes = J.notes.slice();
    (sj && sj.ok ? sj.buildings : []).forEach(b => b.braceLines.filter(l => l.independent).forEach(l => notes.push({ level: 'warn', text: `${sj.buildings.length > 1 ? b.name + ': ' : ''}the mezzanine edge on ${l.edge} is not on a sidewall — its longitudinal seismic ${F2(l.design)} k has no wall to go to: a wall with a portal frame or X-bracing on that line in NBG Bracing, or independent X-bracing (DM 15.1.3). See the Bracing page.` })));
    site.buildings.forEach(b => { if (!mz.some(q => sameName(q.building, b.name))) notes.push({ level: 'info', text: `${b.name}: no mezzanine — its frames take the roof loads, the snow and any drift only.` }); });
    J.roofs.filter(r => r.pcsMatch === false).forEach(r => notes.push({ level: 'warn', text: `${r.name}: the roof snow works out to ${F1(r.design)} psf; PCS Box 4 lists ${F1(r.pcsSnow.value)} psf. Check Ce, Ct and the slope.` }));
    (sj ? sj.notes : []).filter(n => n.level === 'stop').forEach(n => notes.push(n));
    $('#bldNotes').innerHTML = notes.length ? notes.map(n => `<div class="seis-msg ${n.level}">${esc(n.text)}</div>`).join('') : '<div class="seis-msg ok">Nothing to flag.</div>';
    $('#bldNotesPanel').hidden = false;
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
    </div>` + (J ? `<div class="seis-grid snow-bldgs">${J.roofs.map(r => `<div class="snow-bldg"><b>${esc(r.name)}</b><label><span class="lab">Thermal factor, Ct <small class="src src-${esc(r.CtSrc)}">${esc(r.CtSrc)}</small></span>${num(`b.${r.name}.Ct`, r.Ct)}${r.thermal ? `<small class="sub-n">PCS Box 4: ${esc(r.thermal)}</small>` : ''}</label>${chk(`b.${r.name}.slippery`, r.slippery, `Unobstructed slippery roof <small class="sub-n">Box 4 "R &lt; 30 and/or obstruction": ${(state.pcs.site[r.name] || {}).roof && (state.pcs.site[r.name].roof.obstruction === false ? 'No → slippery' : state.pcs.site[r.name].roof.obstruction === true ? 'Yes → not slippery' : 'not read')}</small>`)}</div>`).join('')}</div>` : '');
    if (!J) { $('#snowRoofs').innerHTML = '<div class="seis-msg warn">Type the ground snow load to work the roofs.</div>'; $('#snowSteps').innerHTML = ''; $('#snowFrames').innerHTML = ''; }
    else {
      $('#snowRoofs').innerHTML = `<div class="table-wrap"><table class="fl-t"><thead><tr><th>Building</th><th>Roof</th><th class="num">Ct</th><th class="num">Is</th><th class="num">pf</th><th class="num">Cs</th><th class="num">ps</th><th class="num">pm</th><th>Unbalanced (gable)</th><th>PCS Box 4</th></tr></thead><tbody>${J.roofs.map(r => {
        const u = r.unbalanced, ut = !u ? '—' : !u.applies ? esc(u.why) : u.simple ? `windward 0 · leeward ${F1(u.leeward)} psf (W ≤ 20 ft)` : u.need ? 'needs W2' : `windward ${F1(u.windward)} · leeward ${F1(u.leeward)} + ${F1(u.surcharge)} psf over ${ft(u.length)} from the ridge`;
        const pm = r.pm != null ? `${F1(r.pm)}${r.pm > r.ps ? ' <b>governs</b>' : ''}` : '—';
        const pcsT = r.pcsSnow ? `${F1(r.pcsSnow.value)} psf${r.pcsSnow.override ? ' <small class="sub-n">user override — applied as a uniform load with dead and collateral</small>' : r.pcsMatch ? ' <small class="src src-ok">matches</small>' : ' <small class="src src-bad">differs</small>'}` : '—';
        return `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.building.g.profile || '')} ${F2(r.slope)}:12<small class="sub-n">${F1(r.slopeDeg)}°${r.slippery ? ' · slippery' : ''}</small></td><td class="num mono">${F2(r.Ct)}</td><td class="num mono">${F2(r.Is)}</td><td class="num mono">${F1(r.pf)}</td><td class="num mono">${F2(r.Cs)}</td><td class="num mono"><b>${F1(r.ps)}</b></td><td class="num mono">${pm}</td><td>${ut}</td><td>${pcsT}</td></tr>`; }).join('')}</tbody></table></div>
        <small class="sub-n">pf = 0.7 Ce Ct Is pg (Eq. 7.3-1) · ps = Cs pf · pm the low-slope minimum (slopes under 15°) · γ = 0.13 pg + 14 ≤ 30 pcf · the roof's balanced snow is the larger of ps and pm; the PCS's user override, where it has one, is what NBG Frame applies.</small>`;
      if (!J.drifts.length) $('#snowSteps').innerHTML = `<div class="seis-msg info">No roof steps: one building, or none attached to another. An existing building beside it, or a higher roof the PCS does not draw (Box 4 "additional obstruction"), can be added here as a step.</div>${stepAdder()}`;
      else $('#snowSteps').innerHTML = J.drifts.map(d => {
        const dr = d.drift, st = d.step, o = ((c.steps || {})[d.key]) || {};
        const line = (lab, v) => `<span>${lab} <b>${v}</b></span>`;
        return `<div class="snow-step ${d.off ? 'is-off' : ''}"><div class="snow-step-h"><div><b>${esc(d.lower)}</b> ${d.lowerWall} <span class="sub-n">below</span> <b>${esc(d.upper)}</b> ${d.upperWall} <small class="sub-n">· ${d.kind === 'side' ? 'drift across the lower frames (side wall)' : 'drift along the lower building (end wall)'} · shared ${ft(d.length)} · step ${ft(d.hMin)}${d.hMax - d.hMin > 0.05 ? ` to ${ft(d.hMax)} at the rake` : ''}</small></div>${chk(`s.${d.key}.off`, d.off, 'leave this step out')}</div>
          <div class="seis-grid"><label><span class="lab">Upper roof fetch, lu <small class="src src-${esc(d.luUpperSrc)}">${esc(d.luUpperSrc)}</small></span>${num(`s.${d.key}.luUpper`, d.luUpper)}<small class="sub-n">${d.upperWall === 'FSW' || d.upperWall === 'BSW' ? 'its width' : 'its length'} — extend it when another roof continues in line</small></label>
            <label><span class="lab">Lower roof fetch, lu <small class="src src-${esc(d.luLowerSrc)}">${esc(d.luLowerSrc)}</small></span>${num(`s.${d.key}.luLower`, d.luLower)}</label>
            <label><span class="lab">Gap to a separate building, s (ft)</span>${num(`s.${d.key}.s`, d.s || 0)}<small class="sub-n">0 when they touch (7.7.2)</small></label></div>
          ${dr.none ? `<div class="seis-msg info">No drift: ${esc(dr.why)}</div>` : `<div class="seis-sum">${line('γ', F2(dr.gamma) + ' pcf')}${line('hb', ft(dr.hb))}${line('hc', ft(dr.hc))}${line('leeward hd', ft(d.drift.leeward.hd) + (d.drift.leeward.why ? ' (' + esc(d.drift.leeward.why) + ')' : ''))}${line('windward ¾ hd', ft(d.drift.windward.hd))}${line('governs', dr.gov)}${line('hd', ft(dr.hd) + (dr.capped ? ' = hc' : ''))}${line('w', ft(dr.w) + (dr.truncated ? ` → cut off at ${ft(d.lowerWidth)}, ${F1(dr.end)} psf there` : ''))}${line('pd = hd γ', `<b>${F1(dr.pd)} psf</b>`)}</div>`}
          ${d.sliding.applies ? `<div class="seis-msg info">Sliding snow (7.9): the upper roof drains onto this one at ${F2(d.step.upper.g.slopeFSW || 0)}:12 — 0.4 pf W = ${n0(d.sliding.perFt)} lb/ft over ${ft(d.sliding.extent)}: ${F1(d.sliding.psf)} psf.</div>` : `<small class="sub-n">Sliding snow: ${esc(d.sliding.why)}.</small>`}</div>`;
      }).join('') + stepAdder();
      // onto the frames
      const rows = J.drifts.filter(d => !d.off && d.frames.length).flatMap(d => d.frames.map(fl => `<tr><td><b>${esc(d.lower)}</b> line ${fl.frame}<small class="sub-n">x ${ft(fl.x)} · trib ${ft(fl.tribAt || fl.trib[1] - fl.trib[0])}${fl.strip ? ` · ${ft(fl.strip[0])}–${ft(fl.strip[1])} from the step` : ''}</small></td><td class="num mono">${ft(fl.h)}</td><td class="num mono">${fl.drift ? F1(fl.drift.pd) : '—'}</td><td>${fl.segs.map(s => `<div class="snow-seg"><i>${esc(s.name)}</i> <span class="mono">RP${s.panel}</span> <span class="mono">${ft(s.from)} → ${ft(s.to)}</span> <b class="mono">${F3(s.start)} → ${F3(s.end)}</b> k/ft PY</div>`).join('')}</td><td class="num"><button class="btn-ghost sm" data-bldg="${esc(d.lower)}" data-frame="${fl.frame}">Draw →</button></td></tr>`));
      $('#snowFrames').innerHTML = rows.length ? `<div class="table-wrap"><table class="fl-t"><thead><tr><th>Frame line</th><th class="num">Step h</th><th class="num">pd (psf)</th><th>Panel loads for NBG Frame · positions from the FSW</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div><small class="sub-n">A side-wall step: the drift at the wall (pd × tributary width) falling to zero w from it, or to its value at the far eave. An end-wall step: the frame's share of the drift over its own strip, the same across the frame. Cut where the roof panels change (RP1 / RP2). Negative = down (PY, projected). Into NBG Frame: Tools → Concentrated (Panel) Loads, the panel tab, under the snow case SL — NBG Frame puts its own lean-to drift under SL, LRD and RRD, so add the same rows to LRD and RRD for the drift cases.</small>` : '<div class="seis-msg info">No drift reaches a frame line.</div>';
      $$('#snowFrames [data-frame]').forEach(x => { x.onclick = () => selectFrame(x.dataset.bldg, +x.dataset.frame, true); });
    }
    $('#snowHow').innerHTML = `<ol>
      <li><b>Balanced snow</b> on each roof: pf = 0.7 Ce Ct Is pg; ps = Cs pf with Cs from Fig. 7.4-1 (warm roof 1.0 to 30°, slippery from 5°; Ct 1.1 from 37.5°, Ct 1.2 from 45°); the low-slope minimum pm = Is pg (pg ≤ 20) or 20 Is; rain-on-snow 5 psf where pg ≤ 20 and the slope is under W/50 degrees. Checked against NBG Design Calcs' snow document (unbalanced: surcharge 13.30 psf over 20.64 ft for pg 51 on a 60 ft gable at 1:12) and PCS Box 4.</li>
      <li><b>Unbalanced snow</b> on a gable (7.6.1): windward 0.3 ps, leeward ps with a surcharge hd γ / √S over 8 hd √S / 3 from the ridge — NBG Frame's own SnowLeftSlope / SnowRightSlope cases carry it.</li>
      <li><b>Roof steps</b> from Box 2's attachments: each building placed on one site, the two roofs sampled along the shared wall, the higher one over the lower. The step height h = upper roof at the wall − lower roof there (a gable endwall's rake rises to the ridge, so h grows along it).</li>
      <li><b>Drift</b> (7.7): hb = ps / γ, hc = h − hb; nothing when hc / hb &lt; 0.2. Leeward hd = 0.43 lu^⅓ (pg + 10)^¼ − 1.5 with lu the upper roof's fetch (ASCE 7-22: 1.5 √(pg^0.74 lu^0.70 W2^1.7 / γ)); windward ¾ of the same with the lower roof's fetch; the larger governs. hd ≤ hc → w = 4 hd; else w = 4 hd² / hc ≤ 8 hc and hd = hc. pd = hd γ. A separate building (s &gt; 0): leeward only for s &lt; 20 ft and s &lt; 6h, held to (6h − s)/6, w ≤ 6h − s. A drift wider than the lower roof stops at its far edge at the value it has there.</li>
      <li><b>Sliding snow</b> (7.9): 0.4 pf W per foot of eave from a roof steeper than ¼:12 (slippery) or 2:12 that drains onto the lower roof, over 15 ft (scaled to a narrower roof), with the balanced snow.</li>
      <li><b>Onto the frames</b>: a side-wall step runs across the lower frames — each frame line takes pd × its tributary width at the wall, to 0 at w (or the far eave): a triangle, PY, "Snow Drift". An end-wall step runs along the length — each frame near the end takes the drift over its own strip, uniform across the frame. The fetch and the gap are the engineer's call where another roof continues in line: type them above.</li>
      <li><b>Onto the purlins</b>: the Purlins page lists the same drift as purlin line loads (the purlin program is not here).</li></ol>`;
    const forget = $('#snowForget');
    if (forget) forget.onclick = () => { const k = snowKey(); try { if (k) localStorage.removeItem(k); } catch (e) { /* nothing kept */ } state.snow = {}; snowRestored = false; recompute(); toast('Snow entries cleared — back to the PCS values'); };
    $$('#v-snow [data-snow]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.snow, raw = el.type === 'checkbox' ? el.checked : el.value.trim(), cfg = state.snow = state.snow || {};
        const v = el.type === 'checkbox' || el.tagName === 'SELECT' ? raw : raw === '' ? '' : +raw;
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
    const list = ex.map((x, i) => `<li>${esc(x.lower)} ${x.wall}: a roof ${ft(x.h)} higher along it, fetch ${ft(x.lu)}${x.s ? `, ${ft(x.s)} away` : ''} <button class="btn-ghost sm" data-xstep-rm="${i}">Remove</button></li>`).join('');
    return `<details class="snow-add"><summary>Add a step the PCS does not draw <small class="sub-n">an existing building, a higher roof in line</small></summary><div class="seis-grid"><label><span class="lab">Lower building · wall</span><select id="xsWall">${blds.flatMap(b => ['FSW', 'BSW', 'LEW', 'REW'].map(w => `<option value="${esc(b.name)}|${w}">${esc(b.name)} ${w}</option>`)).join('')}</select></label><label><span class="lab">Higher roof above its eave by (ft)</span><input class="seis-in" id="xsH" inputmode="decimal" placeholder="e.g. 8"></label><label><span class="lab">Its fetch toward the step (ft)</span><input class="seis-in" id="xsLu" inputmode="decimal" placeholder="its width or length"></label><label><span class="lab">Gap s (ft)</span><input class="seis-in" id="xsS" inputmode="decimal" value="0"></label></div><button class="btn-soft sm" id="xsAdd">Add the step</button>${list ? `<ul class="pj-list">${list}</ul>` : ''}</details>`;
  }
  function wireStepAdder() {
    const add = $('#xsAdd');
    if (add) add.onclick = () => { const [lower, wall] = $('#xsWall').value.split('|'), h = +$('#xsH').value, lu = +$('#xsLu').value, s = +$('#xsS').value || 0; if (!(h > 0) || !(lu > 0)) { toast('Type the step height and the fetch'); return; } state.snow = state.snow || {}; (state.snow.extraSteps = state.snow.extraSteps || []).push({ lower, wall, h, lu, s }); snowSave(); recompute(); };
    $$('[data-xstep-rm]').forEach(b => { b.onclick = () => { state.snow.extraSteps.splice(+b.dataset.xstepRm, 1); snowSave(); recompute(); }; });
  }

  // ---------- Frames ----------
  function renderFrames() {
    const pick = $('#framePick');
    if (!pick) return;
    const J = state.snowJob;
    if (!J || !J.site.buildings.length) { pick.innerHTML = state.pcs ? '<div class="seis-msg warn">The frames wait for the ground snow load (Snow & drift page).</div>' : '<div class="empty">Load a PCS first.</div>'; $('#frameView').innerHTML = ''; $('#frameRows').innerHTML = ''; $('#frameToggles').innerHTML = ''; return; }
    if (!state.frameSel || !siteB(state.frameSel.building)) {
      // start on the frame with the most on it: a drift, else a mezzanine
      const d = J.drifts.find(x => x.frames.length);
      const b0 = d ? d.step.lower : J.site.buildings[0];
      const fr0 = d ? d.frames[Math.floor(d.frames.length / 2)].frame : ((state.job && state.job.frameEntries) || []).find(x => sameName(x.building, b0.name) || !x.building);
      state.frameSel = { building: b0.name, frame: d ? fr0 : fr0 ? +fr0.frame : 1 };
    }
    const sel = state.frameSel;
    pick.innerHTML = J.site.buildings.map(b => `<div class="fp-bldg"><span class="fp-name">${esc(b.name)}</span><div class="fp-chips">${B.frameLines(b).map(fl => { const Fd = frameData(b.name, fl.no), ld = Fd ? Fd.loads : {}, has = (ld.drift || []).length ? 'd' : (ld.mezz || []).length ? 'm' : ''; return `<button class="fp-chip ${sameName(sel.building, b.name) && sel.frame === fl.no ? 'is-on' : ''} ${has ? 'has-' + has : ''}" data-bldg="${esc(b.name)}" data-frame="${fl.no}" title="${esc(fl.type || '')}">${fl.no}</button>`; }).join('')}</div></div>`).join('') + `<div class="fp-key"><i class="has-d"></i>drift <i class="has-m"></i>mezzanine</div>`;
    $$('#framePick .fp-chip').forEach(x => { x.onclick = () => selectFrame(x.dataset.bldg, +x.dataset.frame); });
    const Fd = frameData(sel.building, sel.frame);
    if (!Fd) { $('#frameView').innerHTML = ''; return; }
    const out = B.frameSvg(Fd), ld = Fd.loads;
    // the frame line's lateral system (its R for the seismic): PCS Box 5's framing, or the one picked here (kept with
    // the Seismic page's entries for this job)
    const bS = sb(Fd.name), lineS = bS ? (bS.lines || []).find(l => String(l.label) === String(Fd.frame)) : null;
    const picked = bS && (((state.seis.buildings || {})[bS.bkey] || {}).lines || {})[String(Fd.frame)];
    const curSys = picked || (lineS ? lineS.type : /post|beam/i.test(Fd.type || '') ? 'Post & Beam' : 'Rigid Frame');
    const sysSel = bS ? `<label class="fv-sys"><span>Lateral system</span><select data-fsys="${esc(bS.bkey)}|${esc(String(Fd.frame))}">${(C.LINE_SYSTEMS || []).map(t => `<option ${t === curSys ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><small class="sub-n">${picked ? 'picked here' : 'PCS Box 5'}${lineS && lineS.lat && lineS.lat.R != null ? ` · R ${+lineS.lat.R.toFixed(2)}` : ''}</small></label>` : '';
    $('#frameViewTitle').innerHTML = `${esc(Fd.name)} · frame line <b>${Fd.frame}</b> <small class="sub-n">${esc(Fd.type || '')} · trib ${ft(Fd.trib)} · ${Fd.end ? Fd.end + ' end frame' : 'interior'}</small>${sysSel}`;
    const fs = $('#frameViewTitle [data-fsys]');
    if (fs) fs.onchange = () => { const [bk, lab] = fs.dataset.fsys.split('|'); state.seis.buildings = state.seis.buildings || {}; const bo = state.seis.buildings[bk] = state.seis.buildings[bk] || {}; bo.lines = bo.lines || {}; bo.lines[lab] = fs.value; C.seisSave && C.seisSave(); recompute(); toast(`Frame line ${lab}: ${fs.value} — the seismic is reworked with its R`); };
    const on = state.frameLayers = state.frameLayers || {};
    $('#frameToggles').innerHTML = out.legend.map(l => `<button data-layer="${esc(l.key)}" class="${on[l.key] === false ? '' : 'is-on'}">${esc(l.label)}</button>`).join('');
    $('#frameView').innerHTML = out.svg;
    const apply = () => $$('#frameView .fl-layer').forEach(g => g.classList.toggle('is-off', on[g.dataset.layer] === false));
    apply();
    $$('#frameToggles button').forEach(b => { b.onclick = () => { on[b.dataset.layer] = on[b.dataset.layer] === false; b.classList.toggle('is-on', on[b.dataset.layer] !== false); apply(); }; });
    // the rows for NBG Frame
    const sj = state.job && state.job.seismic, b = sb(Fd.name), lat = b ? (b.lines || []).find(l => String(l.label) === String(Fd.frame)) : null;
    const pan = [], con = [];
    (ld.drift || []).forEach(s => ['SL', 'LRD', 'RRD'].forEach(cs => pan.push({ name: 'Snow Drift', cs, panel: 'RP' + s.panel, dir: 'PY', from: s.from, to: s.to, a: s.start, b: s.end })));
    (ld.sliding || []).forEach(s => ['SL', 'LRD', 'RRD'].forEach(cs => pan.push({ name: 'Sliding Snow', cs, panel: 'RP' + s.panel, dir: 'PY', from: s.from, to: s.to, a: s.start, b: s.end })));
    (ld.mezz || []).forEach(q => { con.push({ name: 'FDL', cs: 'FDL', member: q.member, at: q.elev, x: 0, y: -q.D }); con.push({ name: 'FLL', cs: 'FLL', member: q.member, at: q.elev, x: 0, y: -q.L }); });
    (ld.eq || []).forEach(q => { con.push({ name: 'EQR', cs: 'EQR', member: q.member, at: q.at, x: q.F, y: 0 }); con.push({ name: 'EQL', cs: 'EQL', member: q.member, at: q.at, x: -q.F, y: 0 }); });
    const roofT = lat ? `<div class="seis-sum"><span>Roof seismic weight <b>${F2(lat.lat.frame.roofPsf)} psf</b></span><span>Seismic factor Cs <b>${F3(lat.lat.Cs)}</b></span><span>Frame base shear <b>${F2(lat.lat.V)} k</b></span><span>${esc(lat.lat.sys.label)} · R <b>${+lat.lat.R.toFixed(2)}</b></span><a href="#" data-go="seismic">Seismic page</a></div>` : '';
    const snowT = ld.snow ? `<div class="seis-sum"><span>Balanced snow <b>${F1(ld.snow.ps)} psf</b> → <b>${kft(ld.snow.kft)}</b> PY on the roof</span>${ld.snow.pm != null && ld.snow.pm > ld.snow.ps ? `<span>minimum pm <b>${F1(ld.snow.pm)} psf</b> governs the balanced case</span>` : ''}<span>Roof dead + collateral <b>${kft(ld.dead + ld.coll)}</b></span><a href="#" data-go="snow">Snow page</a></div>` : '';
    $('#frameRows').innerHTML = `${snowT}${roofT}
      <div class="fr-rows"><div class="panel-sub"><h4>Panel loads · Tools → Concentrated (Panel) Loads <small class="sub-n">drift and sliding snow on this frame line, in NBG Frame's own words: PY projected, k/ft, down negative, positions along the frame from the FSW column (COL01)</small></h4>
        ${pan.length ? `<div class="table-wrap"><table class="fl-t"><thead><tr><th>Name</th><th>Case</th><th>Panel</th><th>Dir.</th><th class="num">Start (ft)</th><th class="num">End (ft)</th><th class="num">Start (k/ft)</th><th class="num">End (k/ft)</th></tr></thead><tbody>${pan.map(r => `<tr><td>${esc(r.name)}</td><td class="mono"><b>${r.cs}</b></td><td class="mono">${r.panel}</td><td class="mono">${r.dir}</td><td class="num mono">${F3(r.from)}</td><td class="num mono">${F3(r.to)}</td><td class="num mono"><b>${F3(r.a)}</b></td><td class="num mono"><b>${F3(r.b)}</b></td></tr>`).join('')}</tbody></table></div><small class="sub-n">The same rows under SL, LRD and RRD, as NBG Frame enters its own lean-to drift. The frame file's panel-load rows are not written by the tool yet: a frame saved with one Snow Drift row typed by hand teaches it the format (drop it on the Project page) — until then type them from this table.</small>` : '<small class="sub-n">No drift or sliding snow on this frame line.</small>'}</div>
      <div class="panel-sub"><h4>Concentrated loads <small class="sub-n">the mezzanine's dead and live on the frame columns it bears on, and its seismic — written into the frame file below</small></h4>
        ${con.length ? `<div class="table-wrap"><table class="fl-t"><thead><tr><th>Name</th><th>Case</th><th>Member</th><th class="num">Location (ft)</th><th class="num">X (k)</th><th class="num">Y (k)</th></tr></thead><tbody>${con.map(r => `<tr><td>${esc(r.name)}</td><td class="mono"><b>${r.cs}</b></td><td class="mono">${esc(r.member || '—')}</td><td class="num mono">${F3(r.at)}</td><td class="num mono">${r.x ? F3(r.x) : '—'}</td><td class="num mono">${r.y ? F3(r.y) : '—'}</td></tr>`).join('')}</tbody></table></div>` : `<small class="sub-n">No mezzanine bears on this frame line${sj && !sj.ok ? ' (or the Seismic page is not complete yet)' : ''}.</small>`}</div></div>
      ${leanToPanel(Fd)}`;
    wireLeanTo(Fd);
  }
  // a lean-to designed on its own: its frame file's reactions at the column against this wall, to put on the host frame
  function leanToPanel(Fd) {
    const lt = state.leanTo || {}, files = (state.nbg.files || []).filter(x => x.ff && x.ff.info.reactions && x.ff.info.reactions.length && siteB(x.ff.info.building) && !sameName(x.ff.info.building, Fd.name));
    if (!files.length && !Fd.step) return '';
    const cases = it => { const r = it.ff.info.reactions, cols = [...new Set(r.map(q => q.col))]; return { cols, byCol: cols.map(c => ({ col: c, rows: r.filter(q => q.col === c) })) }; };
    const guide = `<ol class="lt-steps"><li><b>Load the lean-to's own frames</b> — pick its frame lines above: the drift from the higher roof is on them (and any mezzanine); download its .frame files from the block below with the concentrated loads in, type the Snow Drift panel rows from the table, and design the lean-to in NBG Frame.</li><li><b>Drop the designed lean-to .frame back</b> on the Project page.</li><li><b>Its reactions come here</b>, case by case, for the column against this wall — they go on this frame's column as "Lean-To" rows (replacing NBG's own estimate), and this frame's file downloads with them.</li></ol>`;
    return `<div class="panel-sub lean-to"><h4>Lean-to onto this frame <small class="sub-n">the lower building's frames are designed first; their reactions then load this one</small></h4>${guide}
      ${files.length ? files.map(it => { const cs = cases(it), col = lt.col || cs.cols[cs.cols.length - 1], rows = (cs.byCol.find(c => c.col === col) || { rows: [] }).rows; return `<div class="lt-file"><b class="mono">${esc(it.name)}</b> <small class="sub-n">${esc(it.ff.info.building || '')} · ${cs.cols.length} columns</small>
        <div class="seis-grid"><label><span class="lab">Lean-to column against ${esc(Fd.name)}</span><select data-lt="col">${cs.cols.map(c => `<option value="${esc(c)}" ${c === col ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label><span class="lab">On this frame's column</span><select data-lt="member">${Fd.cols.map((y, i) => `<option value="${i}" ${(lt.memberY ?? (Fd.step && Fd.step.side === 'BSW' ? Fd.cols[Fd.cols.length - 1] : Fd.cols[0])) === y ? 'selected' : ''}>COL${String(i + 1).padStart(2, '0')} · ${y < 0.05 ? 'FSW' : y > Fd.g.width - 0.05 ? 'BSW' : ft(y)}</option>`).join('')}</select></label><label><span class="lab">At elevation (ft)</span><input class="seis-in" data-lt="at" inputmode="decimal" value="${lt.at ?? (Fd.step ? +(Fd.step.upperEave - Fd.step.h).toFixed(3) : '')}"><small class="sub-n">the lean-to's eave on this wall, where its rafter bears</small></label></div>
        <div class="table-wrap"><table class="fl-t"><thead><tr><th>Case</th><th class="num">Vertical (k)</th><th class="num">Horizontal (k)</th><th>On the host</th></tr></thead><tbody>${rows.map(r => `<tr><td class="mono"><b>${esc(r.caseName)}</b></td><td class="num mono">${F3(r.V)}</td><td class="num mono">${F3(r.H)}</td><td class="mono">Y ${F3(-r.V)} · X ${F3(-r.H)}</td></tr>`).join('')}</tbody></table></div>
        <small class="sub-n">A support reaction pushes up on the lean-to; the host takes the opposite: Y = −vertical, X = −horizontal, as "Lean-To" rows under the same load cases (NBG Frame's own lean-to rows carry these names). Check the signs against one NBG-generated lean-to row before trusting a file written this way.</small>
        <div class="seis-bfile-a"><button class="btn-soft" data-ltwrite="${esc(it.name)}"><svg><use href="#i-file"/></svg>Put them on this frame's file</button><small class="sub-n">${hostFile(Fd) ? `writes the Lean-To rows into ${esc(hostFile(Fd).name)} with its FDL / FLL / EQ rows, and downloads it` : 'drop this frame line\'s .frame file on the Project page first'}</small></div></div>`; }).join('')
      : `<small class="sub-n">No designed lean-to frame file loaded. ${Fd.step ? `${esc(Fd.step.upperName)} stands against this frame's ${Fd.step.side}; NBG Frame writes its reactions into the host file when the project carries the lean-to.` : ''}</small>`}</div>`;
  }
  // the host frame line's own .frame file among the dropped ones
  const hostFile = Fd => (state.nbg.files || []).find(x => x.ff && x.ff.info.lines.map(String).includes(String(Fd.frame)) && (!x.ff.info.building || sameName(x.ff.info.building, Fd.name)));
  function wireLeanTo(Fd) {
    $$('#frameRows [data-lt]').forEach(el => { el.onchange = () => { state.leanTo = state.leanTo || {}; const k = el.dataset.lt; if (k === 'member') state.leanTo.memberY = Fd.cols[+el.value]; else state.leanTo[k] = k === 'at' ? +el.value : el.value; renderFrames(); }; });
    $$('#frameRows [data-ltwrite]').forEach(btn => { btn.onclick = async () => {
      const it = (state.nbg.files || []).find(x => x.name === btn.dataset.ltwrite), host = hostFile(Fd);
      if (!it || !host) { toast('Drop this frame line\'s own .frame file on the Project page first'); return; }
      const lt = state.leanTo || {}, cols = [...new Set(it.ff.info.reactions.map(q => q.col))], col = lt.col || cols[cols.length - 1];
      const y = lt.memberY ?? (Fd.step && Fd.step.side === 'BSW' ? Fd.cols[Fd.cols.length - 1] : Fd.cols[0]), member = 'COL' + String(Fd.cols.indexOf(y) + 1).padStart(2, '0');
      const at = lt.at ?? (Fd.step ? +(Fd.step.upperEave - Fd.step.h).toFixed(3) : 0);
      const rows = it.ff.info.reactions.filter(q => q.col === col).map(q => ({ name: 'Lean-To', caseId: q.caseName, member, x: -q.H, y: -q.V, location: at, toFlange: FF.ECC_TOP_LEFT, leanTo: true }));
      try {
        const base = C.nbgRows ? C.nbgRows(host) : [];
        const add = FF.addLoads(host.ff.xml, base.concat(rows), { toFlange: C.webCode ? C.webCode() : undefined });
        const bytes = await FF.write(host.ff, add.xml, zipIO), name = host.name.replace(/\.frame$/i, '') + '_lt.frame';
        cpSave(bytes, name, 'application/octet-stream');
        toast(`${name} — ${rows.length} Lean-To rows on ${member} at ${ft(at)} (${base.length} mezzanine rows kept)`);
      } catch (e) { console.error(e); toast('Frame file: ' + e.message); }
    }; });
  }

  // ---------- Bracing ----------
  function renderBracing() {
    const box = $('#braceWalls');
    if (!box) return;
    const sj = state.job && state.job.seismic, J = state.snowJob;
    if (!sj || !sj.buildings.length) { box.innerHTML = '<div class="empty">Load a PCS first.</div>'; $('#braceFlags').innerHTML = ''; return; }
    const flags = [];
    const walls = sj.buildings.map(b => {
      const bf = (state.bracing || {})[b.bkey], g = b.bd, grid = (siteB(b.name) || {}).xs || [], L = g.length;
      const lines = bf ? bf.file.info.lines.map(l => ({ no: l.index + 1, x: l.x })) : grid.map((x, i) => ({ no: i + 1, x }));
      const plan = bf ? bracingPlan(b) : { loads: [], struts: [], notes: [] };
      const mz = mezzBoxes().filter(q => sameName(q.building, b.name));
      const scopeB = state.scope && state.scope.buildings.find(x => sameName(x.name, b.name));
      const wallSvg = w => {
        const wi = bf && bf.file.info.walls[w];
        let bays = wi ? wi.bays : lines.slice(0, -1).map((l, i) => ({ from: i, to: i + 1, braced: !!(scopeB && (scopeB.bracing[w] || []).some(t => (t.bays || []).includes(i + 1))), braces: [], struts: [] }));
        let loads = plan.loads.filter(l => l.wall === w).map(l => ({ line: l.line + 1, elev: l.elev, F: l.F, caseId: l.caseId }));
        if (!loads.length) b.braceLines.filter(l => l.wall === w).forEach(l => { const first = lines.findIndex(q => q.x >= l.x0 - 0.05), last = lines.map(q => q.x <= l.x1 + 0.05).lastIndexOf(true); if (first >= 0 && last >= 0) { loads.push({ line: first + 1, elev: l.at, F: l.F, caseId: 'EQB' }); loads.push({ line: last + 1, elev: l.at, F: -l.F, caseId: 'EQF' }); } });
        const braced = bays.some(x => x.braced), onWall = b.braceLines.some(l => l.wall === w);
        if (onWall && !braced) flags.push({ level: 'warn', text: `${sj.buildings.length > 1 ? b.name + ': ' : ''}the mezzanine's seismic goes to the ${w}, but ${bf ? 'the bracing file has no braced bay on it' : scopeB ? 'the eScope lists no braced bay on it' : 'no bracing file is loaded to show its braced bays'} — the EQB / EQF need a braced bay (or a portal frame) on that wall.` });
        return B.wallSvg({ name: b.name, wall: w, length: L, eave: w === 'FSW' ? g.eaveFSW : g.eaveBSW, lines, bays, loads, mezz: mz.map(q => ({ x0: q.x0, x1: q.x1, A: q.A, id: q.id })), strutsPlanned: state.seis.strutLine === false ? [] : plan.struts.filter(s => s.wall === w) });
      };
      b.braceLines.filter(l => l.independent).forEach(l => flags.push({ level: 'stop', text: `${sj.buildings.length > 1 ? b.name + ': ' : ''}${l.edge} holds ${F2(l.design)} k of the mezzanine's longitudinal seismic (${l.governs}) and is not on a sidewall. Give it a line in NBG Bracing — a wall with a portal frame at ${l.edge.replace(/^line /, 'line ')} (its loads replace that column and beam), or X-bracing from the mezzanine level to the floor (DM 15.1.3).` }));
      return `${sj.buildings.length > 1 ? `<h4 class="seis-bh">${esc(b.name)}</h4>` : ''}<div class="wall-grid"><div class="wall-card">${wallSvg('FSW')}</div><div class="wall-card">${wallSvg('BSW')}</div></div>
        ${b.braceLines.length ? `<div class="brace-lines">${b.braceLines.map(l => `<span class="chip ${l.independent ? 'bad' : 'ok'}"><b>${esc(l.edge)}</b> ${F2(l.design)} k${l.independent ? ' · no wall' : ''}</span>`).join('')}</div>` : ''}`;
    }).join('');
    // before the seismic is complete the geometry alone says where the force will have to go: each mezzanine's two
    // long edges (the floor spans across the building between them) — on a sidewall, or on an interior line
    if (!sj.ok) sj.buildings.forEach(b => {
      const W = b.bd.width, g = (siteB(b.name) || {}).g;
      mezzBoxes().filter(q => sameName(q.building, b.name)).forEach(q => {
        [['FSW side', q.y0], ['BSW side', q.y1]].forEach(([lab, y]) => {
          const onWall = y < 0.6 ? 'FSW' : y > W - 0.6 ? 'BSW' : null;
          if (onWall) flags.push({ level: 'info', text: `${sj.buildings.length > 1 ? b.name + ': ' : ''}Mezz ${q.id}'s ${lab} edge is the ${onWall}: its share of the longitudinal seismic goes to the ${onWall} bracing as EQB / EQF at ${ft(q.A)} (once the Seismic page is complete).` });
          else flags.push({ level: 'stop', text: `${sj.buildings.length > 1 ? b.name + ': ' : ''}Mezz ${q.id}'s ${lab} edge sits ${ft(y)} from the FSW — not on a wall. Its share of the longitudinal seismic needs a line there in NBG Bracing: a wall with a portal frame (its loads replace that column and beam) or X-bracing from the mezzanine level to the floor (DM 15.1.3).${g ? '' : ''}` });
        });
      });
    });
    box.innerHTML = walls;
    $('#braceWallsSub').textContent = Object.keys(state.bracing || {}).length ? 'bays, X-bracing and strut lines from the bracing file · EQB / EQF as written into it' : state.scope ? 'braced bays from the eScope · drop the bracing file to write the loads into it' : 'frame lines from the PCS · drop the bracing file (Project page) for its bays and to write the loads';
    $('#braceFlags').innerHTML = (sj.ok ? '' : '<div class="seis-msg warn">The Seismic page is not complete yet — the forces come once it is; the lines they go to are known from the layout:</div>') + (flags.length ? flags.map(n => `<div class="seis-msg ${n.level}">${esc(n.text)}</div>`).join('') : (sj.ok ? '<div class="seis-msg ok">Every mezzanine edge that takes longitudinal seismic sits on a braced sidewall.</div>' : ''));
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
    if (inp) inp.onchange = () => { state.snow = state.snow || {}; const v = +inp.value; if (v > 0) state.snow.purlin = v; else delete state.snow.purlin; snowSave(); renderPurlins(); };
  }

  function render() { renderProject(); renderBuilding(); renderSnow(); renderFrames(); renderBracing(); renderPurlins(); }
  return { render, renderProject, renderBuilding, renderSnow, renderFrames, renderBracing, renderPurlins, selectFrame, compute, setWs, wsOf, snowLoad, facts, mezzBoxes };
};
