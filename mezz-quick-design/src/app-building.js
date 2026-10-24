/* The whole-building pages of the tool: Project & files, Building (3D site, site plan, every frame line), Snow & drift,
   Frames (one frame line with every load drawn), Bracing (each sidewall with its X-bracing, portal frames, strut lines
   and EQB / EQF) and Purlins. Mounted by src/app.js with its state and helpers (C); src/building.js draws, src/site.js
   and src/snow.js work the numbers. */
window.MZ_APP_BUILDING = function (C) {
  'use strict';
  const { state, $, $$, esc, ft, f, n0, go, toast, recompute, M3, B, SITE, SNOW, FF, sameName, inpOf, addFrameFiles, addSeisFiles, addCalcsFile, bracingPlan, zipIO, cpSave } = C;
  const F1 = v => f(v, 1), F2 = v => f(v, 2), F3 = v => f(v, 3);
  const JOB_VIEWS = new Set(['upload', 'building', 'calcs', 'snow', 'seismic', 'frames', 'bracing', 'purlins']);
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
    if (C.railRefresh) C.railRefresh();
    popSync();
  }
  const wsOf = view => (MEZZ_VIEWS.has(view) ? 'mezz' : JOB_VIEWS.has(view) ? 'job' : null);
  $$('button[data-ws]').forEach(b => { b.onclick = () => { const ws = b.dataset.ws; setWs(ws); go(ws === 'mezz' ? 'results' : 'building'); }; });
  document.body.dataset.ws = state.ws;   // the page opens on the whole building: the mezzanine strip waits for its workspace
  const navMezz = $('#navMezz');
  if (navMezz) navMezz.onclick = () => { setWs('mezz'); go('results'); };

  // ---------- the snow job: facts from the PCS and the Seismic calc's code, the page's own entries over them ----------
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
    const F = facts(), canada = ((state.pcs.code || {}).family === 'CSA');
    // a Canadian job: the site and its frames are drawn, with no snow worked — NBCC snow (Ss, Sr, Cb …) is not ASCE 7
    if (!(F.pg.value > 0) && !canada) return;
    try {
      state.snowJob = SITE.snowJob(state.pcs, { ed: F.ed, pg: canada ? 0 : F.pg.value, Ce: F.Ce.value, risk: F.risk, W2: F.W2.value }, state.snow || {});
      state.snowJob.F = F;
      if (canada) state.snowJob.canada = { code: state.pcs.code.text, note: state.pcs.code.note, Ss: (state.pcs.seismic || {}).groundSnowKpa };
    } catch (e) { console.error(e); state.snowJob = { error: e.message, site: { buildings: [] }, roofs: [], drifts: [], notes: [], F }; }
  }
  // the mezzanines as boxes in their own building's plan, with their columns (for the site drawings)
  const mezzBoxes = () => ((state.job && state.job.mezz) || []).filter(m => !m.incomplete && m.layout && m.layout.footprint.x1 > m.layout.footprint.x0).map(m => { const fp = m.layout.footprint, inp = inpOf(m); return { building: inp.mezz.building || (state.pcs && state.pcs.planBuilding) || '', id: m.id, x0: fp.x0, x1: fp.x1, y0: fp.y0, y1: fp.y1, A: inp.geom.A.value ?? 12, cols: (m.layout.supports || m.layout.mezzCols || []).filter(c => !c.onBeam && (!c.building || c.userKind === 'portal')).map(c => ({ x: c.x, y: c.y, portal: c.userKind === 'portal' })), holes: (m.layout.openings || []).map(o => ({ x0: o.x0, x1: o.x1, y0: o.y0, y1: o.y1 })) }; });
  // the grid letters the mezzanine design reads off the PCS floor plan, for the plans here (that building's lines A, B …)
  const gridLetters = () => {
    const g = state.res && state.res.grid, J = state.snowJob;
    if (!g || !g.allY || !g.yLabel || !J) return {};
    const pb = state.pcs && state.pcs.planBuilding, b = J.site.buildings.find(q => pb && sameName(q.name, pb)) || (J.site.buildings.length === 1 ? J.site.buildings[0] : null);
    return b && Math.abs((b.g.width || 0) - (g.width || 0)) < 0.6 ? { [b.name]: { allY: g.allY, label: y => g.yLabel(y) } } : {};
  };
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
        bays = bf.file.info.walls[w].bays.filter(x => x.braced).map(x => ({ from: x.from, to: x.to, tiers: [...new Set(x.braces.map(t => `${t.bottom}|${t.top}`))].map(q => q.split('|').map(Number)), kind: x.portal ? 'portal' : 'x', src: 'file', id: x.portal ? x.portal.id : null }));
        // the bracing file against PCS Box 12, bay by bay (bay n: frame lines n to n + 1): its rods, and its portal frames
        // (<PortalFrames>); a PCS portal bay the file leaves bare is drawn from the PCS.
        const fileN = bays.filter(q => q.kind === 'x').map(q => q.from + 1), filePF = bays.filter(q => q.kind === 'portal').map(q => q.from + 1), list = a => a.join(', ');
        const pre = `${name} ${w}: PCS Box 12 asks for ${pw ? pw.type : ''}`;
        if (pw && pw.kind === 'portal' && pw.bays.length) {
          const clash = pw.bays.filter(n => fileN.includes(n));
          bays = bays.concat(pw.bays.filter(n => !fileN.includes(n) && !filePF.includes(n)).map(n => ({ from: n - 1, to: n, tiers: [], kind: 'portal', src: 'PCS' })));
          if (clash.length) check = { level: 'warn', text: `${pre} in bay${pw.bays.length > 1 ? 's' : ''} ${list(pw.bays)}; ${bf.name} has X-bracing rods in bay${clash.length > 1 ? 's' : ''} ${list(clash)} instead — check which the wall gets.` };
        } else if (pw && pw.kind === 'x' && pw.bays.length) {
          const miss = pw.bays.filter(n => !fileN.includes(n)), extra = fileN.filter(n => !pw.bays.includes(n));
          if (filePF.some(n => pw.bays.includes(n))) check = { level: 'warn', text: `${pre} in bay${pw.bays.length > 1 ? 's' : ''} ${list(pw.bays)}; ${bf.name} has a portal frame in bay${filePF.length > 1 ? 's' : ''} ${list(filePF)}.` };
          else if (!fileN.length) check = { level: 'warn', text: `${pre} in bay${pw.bays.length > 1 ? 's' : ''} ${list(pw.bays)}; ${bf.name} has no braced bay on this wall yet.` };
          else if (miss.length || extra.length) check = { level: 'warn', text: `${pre} in bay${pw.bays.length > 1 ? 's' : ''} ${list(pw.bays)}; ${bf.name} braces bay${fileN.length > 1 ? 's' : ''} ${list(fileN)}.` };
        } else if (pw && pw.kind === 'none' && (fileN.length || filePF.length)) check = { level: 'warn', text: `${name} ${w}: PCS Box 12 lists no bracing on this wall; ${bf.name} braces bay${fileN.length + filePF.length > 1 ? 's' : ''} ${list([...fileN, ...filePF].sort((a, c) => a - c))}.` };
      } else if (scopeB && scopeB.bracing && (scopeB.bracing[w] || []).some(t => (t.bays || []).length)) bays = scopeB.bracing[w].flatMap(t => (t.bays || []).map(n => ({ from: n - 1, to: n, tiers: [], kind: /portal/i.test(t.type || '') ? 'portal' : 'x', src: 'eScope' })));
      else if (pw && pw.kind !== 'none') bays = pw.kind === 'roofx' ? [{ from: 0, to: 1, tiers: [], kind: 'roofx', src: 'PCS' }] : pw.bays.map(n => ({ from: n - 1, to: n, tiers: [], kind, src: 'PCS' }));
      // an endwall's bays count from the FSW corner, as Box 2 lists its column spacing (one practice job: LEW bay 2 = F–D, 26'-9"; another:
      // LEW bay 2 = B–A): each braced bay gets its stretch along the wall, for the plan and the 3D
      if ((w === 'LEW' || w === 'REW') && bays) {
        const g0 = (pcsB(name) || {}).building || {}, sp = (w === 'LEW' ? g0.lewCols : g0.rewCols) || [], at = [0];
        sp.forEach(v => at.push(at[at.length - 1] + v));
        bays = bays.map(q => (q.ys || q.kind === 'roofx' || at[q.from] == null || at[q.to] == null ? q : { ...q, ys: [at[q.from], at[q.to]] }));
      }
      out.walls[w] = { bays: bays || [], type: pw ? pw.type : null, kind: pw ? pw.kind : null, open: pw && pw.kind !== 'none' && pw.kind !== 'roofx' && !(bays && bays.length) ? pw.baysText : null, pcs: pw, check, fromFile: !!(bf && bf.file.info.walls[w]) };
    });
    return out;
  }
  /* the bracing as the Bracing page leaves it, for the plans and every 3D view: each wall's braced bays (with the bays
     you added or changed, and the tier at the mezzanine level where the strut line crosses an X), the wall strut lines,
     and each mezzanine edge off the walls braced as picked */
  function bracingAll() {
    const J = state.snowJob;
    if (!J) return {};
    const letters = B.siteLetters(J.site, gridLetters());
    return Object.fromEntries(J.site.buildings.map(b => {
      const br = bracingOf(b.name), out = Object.fromEntries(WALLS.map(w => [w, br.walls[w].bays]));
      let M = null;
      try { M = braceModel(b, letters); } catch (e) { console.error(e); }
      if (M) {
        M.list.filter(l => l.kind === 'side').forEach(l => {
          out[l.wall] = l.bays.filter(x => x.braced).map(x => ({ from: x.from, to: x.to, kind: x.kind, src: x.src,
            tiers: x.braces && new Set(x.braces.map(t => `${t.bottom}|${t.top}`)).size > 1 ? [...new Set(x.braces.map(t => `${t.bottom}|${t.top}`))].map(q => q.split('|').map(Number)) : x.tier != null ? [[0, x.tier], [x.tier, null]] : [] }));
        });
        out.struts = M.list.filter(l => l.kind === 'side').flatMap(l => l.struts.map(t => ({ wall: l.wall, from: t.from, to: t.to, elev: t.elev, skip: t.skip || [] })));
        out.lines = M.list.filter(l => l.kind === 'new' && l.bay).map(l => ({ y: l.y, u0: l.bay.u0, u1: l.bay.u1, kind: l.pickKind, A: l.edge.at, label: l.letter || null }));
      }
      return [b.name, out];
    }));
  }

  // the loads one frame line takes beside the snow: NBG Frame's roof dead + collateral, the mezzanine's FDL / FLL on its
  // columns, the seismic EQR / EQL (or their place, while the Seismic calc waits), a designed lean-to's reactions
  function ext(name, no) {
    const b = sb(name), sj = state.job && state.job.seismic, fe = ((state.job && state.job.frameEntries) || []).find(x => String(x.frame) === String(no) && (!x.building || sameName(x.building, name)));
    const atOf = e => (state.nbg.height === 'beam' ? e.elev : e.A != null ? e.A : e.elev);
    const mezz = fe ? fe.entries.filter(e => e.member).map(e => ({ y: e.y, elev: atOf(e), D: e.D, L: e.L, member: e.member, label: e.label })) : [];
    const fr = b ? (b.frames || []).find(x => String(x.label) === String(no)) : null;
    let eq = fr ? fr.eqs.map(q => { const e = fe && fe.entries.find(z => z.label === q.label); return { y: e ? e.y : 0, at: q.at, F: q.F, member: q.member }; }) : [];
    if (!eq.length && sj && !sj.ok && mezz.length) eq = mezz.map(e => ({ y: e.y, at: e.elev, F: null, member: e.member }));
    const lean = [];   // a lean-to's reactions are put on in the Frames page (its import, its location and columns)
    return { deadPsf: b ? b.roof.RDL.value : null, collPsf: b ? b.roof.CDL.value : null, mezz, eq, leanTo: lean };
  }
  const frameData = (name, no) => (state.snowJob && state.snowJob.site.buildings.length ? B.frameData(state.snowJob, name, no, ext(name, no)) : null);
  function selectFrame(name, no, open) {
    state.frameSel = { building: name, frame: +no };
    popAll = false;
    renderFrames(); renderBldPlan(); popSelect();
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
          <div class="pj-links"><a href="#" data-go="calcs">Calcs</a><a href="#" data-go="frames">Frames</a><a href="#" data-go="bracing">Bracing</a></div></div>
        <div class="pj-card pj-files"><h4>The job's NBG files <small>frame · bracing · eScope</small></h4>
          <label class="nbg-drop pj-drop" id="pjDrop"><input type="file" id="pjFile" accept=".frame,.bracing,.nbgscope,.nbgcalcs" multiple><svg><use href="#i-file"/></svg><span><strong>Drop the .frame, .bracing, .nbgscope and .nbgcalcs files here</strong><small>each goes where it belongs: frame files get their loads on the Frames page, the bracing file its EQB / EQF on the Bracing page, the eScope fills in the code and loads, the Design Calcs file is checked and filled on the Calcs page</small></span></label>
          ${loaded.length ? `<ul class="pj-list">${loaded.join('')}</ul>` : '<small class="sub-n">none yet</small>'}</div>
        <div class="pj-card"><h4>Hand-off <small>what the engineer checks</small></h4><p>The real NBG workbooks, filled by the tool, and the design basis with every input and where it came from.</p>
          <div class="pj-acts"><button class="btn-soft" data-cpdl="all"><svg><use href="#i-file"/></svg>Filled workbooks + design basis (.zip)</button><button class="btn-ghost" data-cpdl="xlsx">Design basis (.xlsx)</button></div><small class="sub-n">The workbooks are added once on the Design page (Calc package → Add workbooks); each copy is the original file with the job typed into it, so Excel recalculates everything itself.</small></div>
      </div></div>`;
    const inp = $('#pjFile'), drop = $('#pjDrop');
    const route = list => { const fr = list.filter(x => /\.frame$/i.test(x.name)), se = list.filter(x => /\.(bracing|nbgscope)$/i.test(x.name)), dc = list.filter(x => /\.nbgcalcs$/i.test(x.name)); if (fr.length) addFrameFiles(fr); if (se.length) addSeisFiles(se); dc.forEach(x => addCalcsFile && addCalcsFile(x)); if (!fr.length && !se.length && !dc.length) toast('Drop .frame, .bracing, .nbgscope or .nbgcalcs files'); };
    inp.onchange = () => { route(Array.from(inp.files || [])); inp.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', e => route(Array.from(e.dataTransfer.files || [])));
  }

  // ---------- Building ----------
  /* ---------- the layers of the 3D views: one set of switches for every view of a kind — the Building page, the
     sidebar, the window of its own (the building), and the Mezzanine workspace's model (the mezzanine). One button can
     stand for several kinds in the model: Snow = the snow layer, the drift, the falling flakes and the drift labels;
     Roof = the roof and what rests on it; Mezzanines = the floors with their members and joists; Labels = every word in
     the view (the grid bubbles stay).
     Kept between sessions. ---------- */
  const LAYERS = {
    job: [['snow', 'Snow', ['snow', 'drift', 'flakes'], true], ['mezz', 'Mezzanines', ['mezz', 'joist', 'joists'], true], ['roof', 'Roof', ['roof', 'snow', 'drift', 'flakes'], true], ['brace', 'Bracing', ['brace'], true],
      ['purlin', 'Purlins', ['purlin'], false], ['frame', 'Frames', ['frame'], true], ['labels', 'Labels', ['labels'], true]],
    mezz: [['slab', 'Slab', ['slab'], true], ['joists', 'Joists', ['joists'], true], ['building', 'Building columns', ['building'], true], ['labels', 'Labels', ['tags', 'labels'], true]],
  };
  const TOGGLES = LAYERS.job;
  state.layers = (() => { try { return JSON.parse(localStorage.getItem('mzd.layers') || 'null') || {}; } catch (e) { return {}; } })();
  const layerOn = (kind, k) => { const v = ((state.layers || {})[kind] || {})[k], d = LAYERS[kind].find(q => q[0] === k); return v == null ? !!(d && d[3]) : !!v; };
  const layerViews = [];
  const layerKind = v => (typeof v.kind === 'function' ? v.kind() : v.kind);
  // a kind in the model shows when every switch that stands for it is on (the snow rests on the roof: Roof off takes it too)
  function layerApply(model, kind) {
    if (!model || !LAYERS[kind]) return;
    const vis = {};
    LAYERS[kind].forEach(([k, , kinds]) => kinds.forEach(t => { vis[t] = (vis[t] ?? true) && layerOn(kind, k); }));
    Object.entries(vis).forEach(([t, on]) => model.toggle(t, on));
  }
  // a 3D view joins the switches (kind: 'job' | 'mezz', or a function giving it as the view changes)
  function layerRegister(model, kind) { if (!layerViews.some(v => v.model === model)) layerViews.push({ model, kind }); layerApply(model, typeof kind === 'function' ? kind() : kind); }
  function layerDrop(model) { const i = layerViews.findIndex(v => v.model === model); if (i >= 0) layerViews.splice(i, 1); }
  const layerBar = kind => LAYERS[kind].map(([k, l]) => `<button data-layer="${kind}|${k}" data-t="${k}" class="${layerOn(kind, k) ? 'is-on' : ''}" aria-pressed="${layerOn(kind, k)}">${l}</button>`).join('');
  function layerSet(kind, k, on) {
    state.layers = state.layers || {}; (state.layers[kind] = state.layers[kind] || {})[k] = on;
    try { localStorage.setItem('mzd.layers', JSON.stringify(state.layers)); } catch (e) { /* this session only */ }
    layerViews.forEach(v => { if (layerKind(v) === kind) layerApply(v.model, kind); });
    [document, popOpen() ? popW.document : null].filter(Boolean).forEach(d => d.querySelectorAll(`[data-layer="${kind}|${k}"]`).forEach(b => { b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); }));
  }
  function layerWire(root) { root.querySelectorAll('[data-layer]').forEach(b => { b.onclick = e => { e.stopPropagation(); const [kind, k] = b.dataset.layer.split('|'); layerSet(kind, k, !layerOn(kind, k)); }; }); }
  const KEY = [['#8fa9c2', 'frames · endwall posts'], ['#5a7b9b', 'roof'], ['#f3f8ff', 'snow · drift'], ['#42e5ae', 'mezzanine floor'], ['#ff9f7a', 'mezzanine columns'], ['#f6c779', 'bracing · portal frames']];
  function renderBuilding() {
    const J = state.snowJob, el = $('#bldMetrics');
    if (!el) return;
    if (!J || !J.site.buildings.length) {
      $('#bldNeed').innerHTML = state.pcs ? `<div class="seis-msg warn">${J && J.error ? esc(J.error) : 'The site needs the ground snow load (PCS Box 3) — type it on the Snow calc.'}</div>` : '';
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
        $('#bldToggles').innerHTML = layerBar('job'); layerWire($('#bldToggles'));
        layerRegister(bldModel, 'job');
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
      popSync(); if (C.railRefresh) C.railRefresh();
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
    // Box 23: a crane is read, not designed for yet — said, so its loads are not left out unnoticed
    ((state.pcs && state.pcs.cranes) || []).forEach(c => { const cb = site.buildings.find(q => sameName(q.name, c.building)) || (site.buildings.length === 1 ? site.buildings[0] : null);
      if (cb && c.startLine && c.startLine > cb.xs.length) notes.push({ level: 'warn', text: `${cb.name}: Box 23 starts the crane at frame line ${c.startLine}, but Box 2 gives ${cb.xs.length} frame lines (${ft(cb.g.length)} long)${c.runway ? ` — its ${ft(c.runway)} runway${Math.abs(c.runway - cb.g.length) < 0.6 ? ' is the whole length' : ''}` : ''}. Check where the crane starts before its loads go on the frames.` }); });
    ((state.pcs && state.pcs.cranes) || []).forEach(c => notes.push({ level: 'warn', text: `${c.building ? c.building + ': ' : ''}Box 23 — ${c.qty || 1} × ${c.type || 'crane'}${c.tons ? ` ${c.tons} ton${c.tons === 1 ? '' : 's'}` : ''}${c.cmaa ? ` (CMAA ${c.cmaa})` : ''}, ${c.kind ? c.kind.toLowerCase() : 'crane'}, aisle ${c.aisle || '?'}${c.startLine ? `, from frame line ${c.startLine}` : ''}${c.direction ? ` toward the ${c.direction}` : ''}${c.runway ? `, runway ${ft(c.runway)}` : ''}${c.wheel ? `; max wheel load ${n0(c.wheel)} lb` : ''}${c.bridge || c.hoistTrolley ? `, bridge ${n0(c.bridge || 0)} lb + hoist and trolley ${n0(c.hoistTrolley || 0)} lb` : ''}. The frames, the bracing and the seismic here do not carry crane loads yet: put them in NBG Frame and NBG Bracing, and the crane in Design Calcs' seismic.${c.notBySeller ? ' Crane beams and their connections are by others.' : ''}` }));
    J.roofs.filter(r => r.pcsMatch === false).forEach(r => notes.push({ level: 'warn', text: `${r.name}: the roof snow works out to ${F1(r.design)} psf; PCS Box 4 lists ${F1(r.pcsSnow.value)} psf. Check Ce, Ct and the slope.` }));
    (sj ? sj.notes : []).filter(n => n.level === 'stop').forEach(n => notes.push(n));
    { const nc = ((state.pcs && state.pcs.cranes) || []).length, el = $('#navCranesCount'), btn = $('#navCranes');
      if (el) { el.textContent = nc ? `${nc} on PCS · later` : 'later'; el.classList.toggle('has-cranes', !!nc); }
      if (btn) btn.title = nc ? `Box 23 lists ${nc} crane${nc > 1 ? 's' : ''} — read and flagged on the Building page; crane loads come next` : 'Cranes come next'; }
    $('#bldNotes').innerHTML = notes.length ? notes.map(n => `<div class="seis-msg ${n.level}">${esc(n.text)}</div>`).join('') : '<div class="seis-msg ok">Nothing to flag.</div>';
    $('#bldNotesPanel').hidden = false;
  }
  /* ---------- the building — or, in the Mezzanine workspace, the mezzanine — in a window of its own, for a second
     screen: in 3D or on its plan, as picked, with the same layer switches. A frame line picked there opens here (the
     page stays where it is); the frame picked here is lit there and, in 3D, shown on its own and flown to. A column or
     beam picked on the mezzanine's plan opens its calc here. The window is this page's own (same origin): it is drawn
     from here, with the page's styles, and follows every change. ---------- */
  let popW = null, popModel = null, popView = '3d', popKindNow = 'job', popAll = false, popIso = '';
  const POP_CSS = `body.pop { display: flex; flex-direction: column; height: 100vh; margin: 0; overflow: hidden; }
    .pop-h { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 18px; padding: 14px 20px 10px; border-bottom: 1px solid var(--line); }
    .pop-h h1 { margin: 2px 0 0; font-size: 20px; line-height: 1.2; } .pop-h small { color: var(--ink-muted); font-size: 12px; }
    .pop-a { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .pop-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--surface-soft); box-shadow: inset 0 0 0 1px var(--line); }
    .pop-seg button { padding: 6px 14px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-muted); font: 700 12.5px var(--body); cursor: pointer; }
    .pop-seg button.is-on { background: var(--green); color: #06221a; }
    .pop-l { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 20px 0; }
    .pop-l > span { color: var(--ink-faint); font: 600 10.5px var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .pop-sel { color: var(--green-dark); font: 600 12px var(--mono); }
    .pop-m { position: relative; flex: 1; min-height: 0; margin: 10px 16px 0; }
    .pop-m .model-stage { position: absolute; inset: 0; min-height: 0; }
    .pop-plan { position: absolute; inset: 0; overflow: auto; padding: 8px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); }
    .pop-plan svg { width: 100%; height: auto; max-height: 100%; }
    .pop-f { padding: 8px 20px 12px; color: var(--ink-faint); font-size: 12px; }`;
  const popKind = () => (state.ws === 'mezz' ? 'mezz' : 'job');
  function popOut() {
    if (popW && !popW.closed) { popW.focus(); popSync(); return; }
    const w = window.open('', 'mzBuilding', 'popup,width=1200,height=840');
    if (!w) { toast('The browser kept the window from opening — allow pop-ups for this page'); return; }
    popW = w; popModel = null; popKindNow = popKind();
    const css = [...document.querySelectorAll('style')].map(q => q.textContent).join('\n'), d = w.document;
    d.open();
    d.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The building</title><style>${css}</style><style>${POP_CSS}</style></head><body class="pop">
      <header class="pop-h"><div><div class="eyebrow" id="popEye">Its own window</div><h1 id="popTitle">The building</h1><small id="popMeta"></small></div>
        <div class="pop-a"><div class="pop-seg" id="popSeg"><button data-v="3d">3D</button><button data-v="plan">Plan</button></div><button class="btn-ghost sm" id="popWhole" hidden>Whole building</button><button class="btn-ghost sm" id="popPause">Pause rotation</button><button class="btn-ghost sm" id="popReset">Reset view</button></div></header>
      <div class="pop-l"><span>Show</span><div class="model-toggles" id="popLayers"></div><b class="pop-sel" id="popSel"></b></div>
      <main class="pop-m"><div class="model-stage" id="popStage"><canvas id="popCanvas" aria-label="In 3D"></canvas></div><div class="pop-plan" id="popPlan" hidden></div></main>
      <footer class="pop-f" id="popFoot"></footer></body></html>`);
    d.close();
    d.querySelectorAll('#popSeg button').forEach(b => { b.onclick = () => { popView = b.dataset.v; popSync(); }; });
    d.getElementById('popPause').onclick = () => { if (!popModel) return; const on = popModel.auto; popModel.pause(on); d.getElementById('popPause').textContent = on ? 'Resume rotation' : 'Pause rotation'; };
    d.getElementById('popReset').onclick = () => { if (popModel) { popAll = true; popModel.isolate(null); popModel.reset(); popSync(); } };
    d.getElementById('popWhole').onclick = () => { popAll = true; if (popModel) popModel.isolate(null); popSync(); };
    w.addEventListener('pagehide', () => { if (popModel) { layerDrop(popModel); popModel.destroy(); } popModel = null; popW = null; });
    popSync();
  }
  const popOpen = () => !!(popW && !popW.closed);
  { const bp = $('#bldPop'); if (bp) bp.onclick = popOut; }
  // a frame line picked there opens here, on the Frames page; already there, the page stays where it is
  const popPick = (building, frame) => {
    popAll = false;
    if (state.view === 'frames') selectFrame(building, frame, false);
    else { selectFrame(building, frame, true); requestAnimationFrame(() => { const v = $('#frameViewTitle'); if (v) v.scrollIntoView({ block: 'start' }); }); }
    try { window.focus(); } catch (e) { /* the browser decides */ }
  };
  // the scene the window shows: the building's, or the mezzanine's
  const popScene = () => (popKindNow === 'mezz' ? (C.mezzSceneLive ? C.mezzSceneLive() : null) : state.bldScene);
  function popSync() {
    if (!popOpen()) return;
    const d = popW.document, J = state.snowJob, kind = popKind();
    if (kind !== popKindNow) { popKindNow = kind; if (popModel) popModel.isolate(null); popAll = false; }
    const mz = kind === 'mezz', scene = popScene(), has = !!scene;
    d.documentElement.dataset.theme = document.documentElement.dataset.theme || 'dark';
    const names = J ? J.site.buildings.map(b => b.name).join(' + ') : '';
    const mzIds = mz && state.job && state.job.mezz ? state.job.mezz.filter(m => !m.incomplete).map(m => m.id) : [];
    d.title = mz ? `${mzIds.join(' + ') || 'The mezzanine'} · its own window` : has ? `${names} · the building` : 'The building';
    d.getElementById('popEye').textContent = mz ? 'The mezzanine · its own window' : 'The building · its own window';
    d.getElementById('popTitle').textContent = mz ? (mzIds.join(' + ') || 'No mezzanine designed yet') : has ? names : 'Load a PCS in the main window';
    d.getElementById('popMeta').textContent = mz ? (state.job && state.job.mezz || []).filter(m => !m.incomplete && m.layout).map(m => `${m.id} ${ft(m.layout.footprint.x1 - m.layout.footprint.x0)} × ${ft(m.layout.footprint.y1 - m.layout.footprint.y0)}`).join(' · ')
      : has ? J.site.buildings.map(b => `${b.name} ${ft(b.g.width)} × ${ft(b.g.length)} · eaves ${ft(b.g.eaveFSW)} / ${ft(b.g.eaveBSW)}`).join(' · ') : '';
    d.getElementById('popFoot').textContent = mz ? 'Drag to turn about the point you grab · right-drag to pan · wheel to zoom · a column or beam clicked on the plan opens its calc in the main window.'
      : 'Drag to turn about the point you grab · right-drag to pan · wheel to zoom · click a frame line — in 3D or on the plan — to open it on the Frames page of the main window.';
    d.querySelectorAll('#popSeg button').forEach(b => { b.classList.toggle('is-on', b.dataset.v === popView); b.setAttribute('aria-pressed', b.dataset.v === popView); });
    const lay = d.getElementById('popLayers');
    lay.innerHTML = layerBar(kind); layerWire(lay);
    lay.parentElement.style.display = popView === '3d' ? '' : 'none';
    const stage = d.getElementById('popStage'), plan = d.getElementById('popPlan');
    stage.style.display = popView === '3d' ? '' : 'none'; plan.hidden = popView !== 'plan';
    d.getElementById('popPause').style.display = d.getElementById('popReset').style.display = popView === '3d' ? '' : 'none';
    if (!has) { plan.innerHTML = ''; if (popModel) popModel.set({ center: [0, 0, 0], radius: 10, box: { x0: 0, x1: 1, y0: 0, y1: 1, z0: 0, z1: 1 }, members: [], labels: [], floor: [] }); popSelect(); return; }
    if (popView === '3d') {
      if (!popModel) {
        popModel = M3.mount(d.getElementById('popCanvas'), { win: popW, pad: [24, 24], min: [420, 320], onSelect: id => {
          const mm = id && popScene() && popScene().members.find(q => q.id === id);
          if (!mm || !mm.ref) return;
          if (mm.ref.type === 'frame' || mm.ref.type === 'frameCol') popPick(mm.ref.building, mm.ref.frame);
          else if (C.openMember) C.openMember(mm.ref);
        } });
        layerRegister(popModel, () => popKindNow);
      }
      popModel.set(scene);
      layerRegister(popModel, () => popKindNow);
    }
    popSelect();
  }
  // the frame picked lit there: on the plan, and in 3D shown on its own (the rest faint) and flown to
  function popSelect() {
    if (!popOpen()) return;
    const d = popW.document, sel = state.frameSel, mz = popKindNow === 'mezz', selEl = d.getElementById('popSel'), whole = d.getElementById('popWhole');
    whole.hidden = true; selEl.textContent = '';
    if (popView === 'plan') {
      const pl = d.getElementById('popPlan');
      if (mz) { pl.innerHTML = C.mezzPlanSvg ? C.mezzPlanSvg(Math.max(680, pl.clientWidth - 20)) : ''; const svg = pl.querySelector('svg'); if (svg && C.mezzPlanWire) C.mezzPlanWire(svg); return; }
      if (!state.snowJob || !state.bldScene) return;
      pl.innerHTML = B.planSvg(state.snowJob, { mezz: mezzBoxes(), selected: sel, bracing: bracingAll(), letters: gridLetters() });
      pl.querySelectorAll('.sp-fl').forEach(g => { g.style.cursor = 'pointer'; g.onclick = () => popPick(g.dataset.bldg, +g.dataset.frame); });
      return;
    }
    if (!popModel || mz || !state.bldScene) return;
    const ms = sel ? state.bldScene.members.filter(q => q.ref && (q.ref.type === 'frame' || q.ref.type === 'frameCol') && sameName(q.ref.building, sel.building) && +q.ref.frame === +sel.frame) : [];
    const raf = ms.find(q => q.ref.type === 'frame');
    popModel.select(raf ? raf.id : null);
    if (!ms.length || popAll) { if (popModel.isolated) popModel.isolate(null); popIso = ''; return; }
    // flown to once when picked; an edit redrawing the window keeps the view
    const key = `${sel.building}|${sel.frame}`;
    if (key === popIso && popModel.isolated) { popModel.isolate(ms.map(q => q.id)); whole.hidden = false; selEl.textContent = `${state.snowJob.site.buildings.length > 1 ? sel.building + ' · ' : ''}frame line ${sel.frame}`; return; }
    popIso = key;
    // its box: every point of its members
    const pts = ms.flatMap(q => [...(q.faces || []).flatMap(fc => fc.pts || fc), ...(q.boxes || []).flatMap(b => [[b.x0, b.y0, b.z0], [b.x1, b.y1, b.z1]])]);
    const bx = { x0: Math.min(...pts.map(p => p[0])) - 2, x1: Math.max(...pts.map(p => p[0])) + 2, y0: Math.min(...pts.map(p => p[1])) - 2, y1: Math.max(...pts.map(p => p[1])) + 2, z0: 0, z1: Math.max(...pts.map(p => p[2])) + 1 };
    popModel.isolate(ms.map(q => q.id), bx);
    whole.hidden = false; selEl.textContent = `${state.snowJob.site.buildings.length > 1 ? sel.building + ' · ' : ''}frame line ${sel.frame}`;
  }

  // the site plan and the frame-line table (the selected line lit) — cheap, so a click redraws these alone
  function renderBldPlan() {
    const J = state.snowJob;
    if (!J || !J.site.buildings.length || !$('#bldPlan')) return;
    const site = J.site, mz = mezzBoxes();
    $('#bldPlan').innerHTML = B.planSvg(J, { mezz: mz, selected: state.frameSel, bracing: bracingAll(), letters: gridLetters() });
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
    $('#v-snow').classList.toggle('calc-none', !!(J && J.canada));
    $('#snowStatus').innerHTML = '';
    if (J && J.canada) {
      box.innerHTML = '';
      $('#snowStatus').innerHTML = `<div class="seis-msg stop"><b>${esc(J.canada.code || 'Canadian code')}</b> — ${esc(J.canada.note || 'NBCC')} ${J.canada.Ss != null ? `Ground snow Ss ${J.canada.Ss} kPa on the PCS. ` : ''}This tool works ASCE 7 snow only: work the snow and the drifts in NBG Design Calcs (NBCC) — drop its .nbgcalcs at the top of this page and each roof's snow and drift opens here as Design Calcs worked it. No snow from this tool goes on the frames.</div>`;
      ['#snowRoofs', '#snowSteps', '#snowFrames', '#snowHow'].forEach(q => { $(q).innerHTML = ''; });
      return;
    }
    const tag = o => `<small class="src src-${esc(String(o.source).replace(/\s+/g, '-'))}">${esc(o.source === 'missing' ? 'needed' : o.source)}</small>`;
    const num = (key, v, extra = '') => `<input class="seis-in ${v == null ? 'need' : ''}" data-snow="${esc(key)}" value="${v == null ? '' : +(+v).toFixed(4)}" inputmode="decimal" ${extra}>`;
    const chk = (key, on, label) => `<label class="seis-chk"><input type="checkbox" data-snow="${esc(key)}" ${on ? 'checked' : ''}> <span>${label}</span></label>`;
    const back = snowRestored ? `<div class="seis-msg info">Your Snow entries for this quote are back. <button class="btn-ghost sm" id="snowForget" type="button">Clear them</button></div>` : '';
    box.innerHTML = back + `<div class="seis-grid">
      <label><span class="lab">Ground snow, pg (psf) ${tag(F.pg)}</span>${num('pg', F.pg.value)}</label>
      <label><span class="lab">Exposure factor, Ce ${tag(F.Ce)}</span>${num('Ce', F.Ce.value)}${F.ceText ? `<small class="sub-n">PCS: ${esc(F.ceText)}</small>` : ''}</label>
      <label><span class="lab">Risk category <small class="src src-${F.riskSrc}">${F.riskSrc}</small></span><select data-snow="risk">${['I', 'II', 'III', 'IV'].map(r => `<option ${r === F.risk ? 'selected' : ''}>${r}</option>`).join('')}</select><small class="sub-n">Is ${F.ed === '7-22' ? '1.0 (ASCE 7-22: pg is risk-targeted)' : SNOW.IS[F.risk]}</small></label>
      <label><span class="lab">Code</span><b class="seis-echo-v">ASCE ${esc(F.ed)}</b><small class="sub-n">follows the Seismic calc's building code</small></label>
      ${F.ed === '7-22' ? `<label><span class="lab">Winter wind parameter, W2 ${tag(F.W2)}</span>${num('W2', F.W2.value)}<small class="sub-n">ASCE 7-22 drifts need it (PCS Box 3 or the hazard tool)</small></label>` : ''}
    </div>` + (J ? `<div class="table-wrap"><table class="fl-t snow-bt"><thead><tr><th>Building</th><th>Thermal factor, Ct</th><th>PCS Box 4 · thermal</th><th>Unobstructed slippery roof <small class="sub-n">Box 4 "R &lt; 30 and/or obstruction": No → slippery</small></th></tr></thead><tbody>${J.roofs.map(r => { const pr = (pcsB(r.name) || {}).roof || {}; return `<tr><td><b>${esc(r.name)}</b></td><td><div class="snow-ct">${num(`b.${r.name}.Ct`, r.Ct)} <small class="src src-${esc(r.CtSrc)}">${esc(r.CtSrc)}</small></div></td><td>${r.thermal ? esc(r.thermal) : '<span class="sub-n">—</span>'}</td><td>${chk(`b.${r.name}.slippery`, r.slippery, `${r.slippery ? 'slippery' : 'not slippery'} <small class="sub-n">Box 4: ${pr.obstruction === false ? 'No' : pr.obstruction === true ? 'Yes' : 'not read'}</small>`)}</td></tr>`; }).join('')}</tbody></table></div>` : '');
    if (!J) { $('#snowRoofs').innerHTML = '<div class="seis-msg warn">Type the ground snow load to work the roofs.</div>'; $('#snowSteps').innerHTML = ''; $('#snowFrames').innerHTML = ''; }
    else {
      $('#snowRoofs').innerHTML = `<div class="table-wrap"><table class="fl-t snow-roofs"><thead><tr><th>Building</th><th>Roof</th><th class="num">Ct</th><th class="num">pf</th><th class="num">Cs</th><th class="num">ps <small class="sub-n">balanced</small></th><th class="num">pm <small class="sub-n">minimum</small></th><th class="num">On the frames</th><th>Unbalanced (gable)</th><th>PCS Box 4</th></tr></thead><tbody>${J.roofs.map(r => {
        const u = r.unbalanced, ut = !u ? '—' : !u.applies ? esc(u.why) : u.simple ? `windward 0 · leeward ${F1(u.leeward)} psf (W ≤ 20 ft)` : u.need ? 'needs W2' : `windward ${F1(u.windward)} · leeward ${F1(u.leeward)} + ${F1(u.surcharge)} psf over ${ft(u.length)} from the ridge`;
        const pm = r.pm != null ? F1(r.pm) : '—';
        const pcsT = r.pcsSnow ? `<span class="mono">${F1(r.pcsSnow.value)} psf</span> ${r.pcsSnow.override ? '<small class="src src-typed">user override</small>' : r.pcsMatch ? '<small class="src src-ok">matches</small>' : '<small class="src src-bad">differs</small>'}` : '—';
        return `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.building.g.profile || '')} ${F2(r.slope)}:12<small class="sub-n">${F1(r.slopeDeg)}°${r.slippery ? ' · slippery' : ''}</small></td><td class="num mono">${F2(r.Ct)}</td><td class="num mono">${F1(r.pf)}</td><td class="num mono">${F2(r.Cs)}</td><td class="num mono">${F1(r.ps)}</td><td class="num mono">${pm}</td><td class="num mono"><b>${F1(r.applied ?? r.design)} psf</b><small class="sub-n">${esc(r.appliedSrc || '')}</small></td><td>${ut}</td><td>${pcsT}</td></tr>`; }).join('')}</tbody></table></div>
        <small class="sub-n">Is ${J.roofs.length ? F2(J.roofs[0].Is) : '1.00'} · pf = 0.7 Ce Ct Is pg (Eq. 7.3-1) · ps = Cs pf · pm the low-slope minimum (slopes under 15°) · γ = 0.13 pg + 14 ≤ 30 pcf. <b>On the frames</b> is the uniform snow NBG Frame applies — the PCS's user override where it has one, else the larger of ps and pm; a drift always sits on ps.</small>`;
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
          <div class="snow-sub">Your inputs <small class="sub-n">filled in from the site; type over any</small></div>
          <div class="seis-grid"><label><span class="lab">Higher roof's fetch, lu (ft) <small class="src src-${esc(d.luUpperSrc.replace(/\s+/g, '-'))}">${esc(d.luUpperSrc)}</small></span>${num(`s.${d.key}.luUpper`, d.luUpper)}<small class="sub-n">${d.luUpperParts && d.luUpperParts.length > 1 ? `${d.luUpperParts.map(q => `${esc(q.name)} ${ft(q.len)}`).join(' + ')} — the roofs meet level, the snow blows the whole way` : d.upperWall === 'FSW' || d.upperWall === 'BSW' ? 'its width' : d.upperWall ? 'its length' : 'as typed'}</small></label>
            <label><span class="lab">Lower roof's fetch (ft) <small class="src src-${esc(d.luLowerSrc.replace(/\s+/g, '-'))}">${esc(d.luLowerSrc)}</small></span>${num(`s.${d.key}.luLower`, d.luLower)}<small class="sub-n">${d.luLowerParts && d.luLowerParts.length > 1 ? `${d.luLowerParts.map(q => `${esc(q.name)} ${ft(q.len)}`).join(' + ')} · ` : ''}for the windward drift (¾ hd)</small></label>
            <label><span class="lab">Gap between the buildings, s (ft)</span>${num(`s.${d.key}.s`, d.s || 0)}<small class="sub-n">0 when they touch (7.7.2)</small></label>
            <label><span class="lab">Sliding snow off the higher roof (7.9)</span><select data-snow="s.${esc(d.key)}.sliding">${[['', 'Code: only if it drains onto this roof'], ['calcs', 'Include, as NBG Design Calcs does'], ['off', 'Leave out']].map(([v, t]) => `<option value="${v}" ${(d.sliding.mode === 'asce' ? '' : d.sliding.mode) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>${d.sliding.mode !== 'off' && d.step.upper ? `<small class="sub-n">pf upper ${F1(d.sliding.pfUpper)} psf · W upper ${ft(d.sliding.W)}</small>` : ''}</label>
            ${d.sliding.mode === 'calcs' ? `<label><span class="lab">W, upper roof eave to ridge (ft) <small class="src src-${esc(d.sliding.Wsrc)}">${esc(d.sliding.Wsrc)}</small></span>${num(`s.${d.key}.W`, d.sliding.W)}<small class="sub-n">0.4 pf W per foot of eave, over 15 ft</small></label>` : ''}</div>
          <div class="snow-sub">Result <small class="sub-n">the drift worked from those, drawn to scale across</small></div>
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
  /* One frame line: every load it takes, drawn, and its .frame file written. The working part is at the top — the
     line's own file and the download, a lean-to's frame reactions to import (as NBG Frame's Tools → Concentrated Loads →
     Add Frame Reactions: the file, the location, the column) — and the drawing shows each load the moment it is in. The
     tables under the drawing are the record of what goes into the file.
     A lean-to is a loop: its frames get the drift (write, download), it is redesigned in NBG Frame, the redesigned file
     comes back, and its reactions go on the host frame. The steps strip follows the job through it. */
  const DIR_KEY = 'mz.frame.driftDir';
  const driftDir = () => { try { return localStorage.getItem(DIR_KEY) === 'GY' ? 'GY' : 'PY'; } catch (e) { return 'PY'; } };
  const outName = file => file.name.replace(/\.frame$/i, '').replace(/_loads$/i, '') + '_loads.frame';
  function renderFrames() {
    const pick = $('#framePick');
    if (!pick) return;
    const J = state.snowJob;
    const clear = () => ['#framePlan', '#frameView', '#frameRows', '#frameToggles', '#frameActs', '#frameWork', '#frameSteps', '#frameSys'].forEach(q => { const e = $(q); if (e) e.innerHTML = ''; });
    if (!J || !J.site.buildings.length) { clear(); pick.innerHTML = state.pcs ? '<div class="seis-msg warn">The frames wait for the ground snow load (Snow calc).</div>' : '<div class="empty">Load a PCS first.</div>'; return; }
    if (!state.frameSel || !siteB(state.frameSel.building)) {
      // start on the frame with the most on it: a drift, else a mezzanine
      const d = J.drifts.find(x => x.frames.length);
      const b0 = d ? d.step.lower : J.site.buildings[0];
      const fr0 = d ? d.frames[Math.floor(d.frames.length / 2)].frame : ((state.job && state.job.frameEntries) || []).find(x => sameName(x.building, b0.name) || !x.building);
      state.frameSel = { building: b0.name, frame: d ? fr0 : fr0 ? +fr0.frame : 1 };
    }
    const sel = state.frameSel, mz = mezzBoxes();
    $('#framePlan').innerHTML = B.planSvg(J, { mezz: mz, selected: sel, bracing: bracingAll(), compact: true, letters: gridLetters() });
    wirePlan('#framePlan', false);
    // a chip per frame line: amber, it carries drift; green, a mezzanine; violet, a lean-to bears on it
    pick.innerHTML = J.site.buildings.map(b => `<div class="fp-bldg"><span class="fp-name">${esc(b.name)}</span><div class="fp-chips">${B.frameLines(b).map(fl => { const Fd = frameData(b.name, fl.no), ld = Fd ? Fd.loads : {}, has = (ld.drift || []).length ? 'd' : (ld.mezz || []).length ? 'm' : Fd && leanHere(Fd).length ? 'l' : ''; return `<button class="fp-chip ${sameName(sel.building, b.name) && sel.frame === fl.no ? 'is-on' : ''} ${has ? 'has-' + has : ''}" data-bldg="${esc(b.name)}" data-frame="${fl.no}" title="${esc(fl.type || '')}">${fl.no}</button>`; }).join('')}</div></div>`).join('') + `<div class="fp-key"><i class="has-d"></i>drift <i class="has-m"></i>mezzanine <i class="has-l"></i>a lean-to bears on it</div>`;
    $$('#framePick .fp-chip').forEach(x => { x.onclick = () => selectFrame(x.dataset.bldg, +x.dataset.frame); });
    renderLeanSteps();
    const Fd = frameData(sel.building, sel.frame);
    if (!Fd) { $('#frameView').innerHTML = ''; return; }
    const file = chosenFile(Fd), LI = leanImport(Fd), plan = framePlan(Fd, file, LI);
    if (plan.leanDraw.length) { Fd.loads.leanTo = plan.leanDraw; Fd.loads.leanGhost = plan.leanGhost; Fd.loads.leanSide = plan.leanSide; }
    const out = B.frameSvg(Fd), ld = Fd.loads;
    $('#frameViewTitle').innerHTML = `<span>${esc(Fd.name)} · frame line <b>${Fd.frame}</b></span><small class="sub-n">${esc(Fd.type || '')} · trib ${ft(Fd.trib)} · ${Fd.end ? Fd.end + ' end frame' : 'interior'}${Fd.posts.length ? ` · ${Fd.posts.length} endwall posts` : ''}</small>`;
    $('#frameActs').innerHTML = dlBlock(Fd, file, plan);
    $('#frameWork').innerHTML = workStrip(Fd, file, plan, LI);
    const on = state.frameLayers = state.frameLayers || {};
    $('#frameToggles').innerHTML = out.legend.map(l => `<button data-layer="${esc(l.key)}" class="${on[l.key] === false ? '' : 'is-on'}" aria-pressed="${on[l.key] !== false}">${esc(l.label)}</button>`).join('');
    $('#frameView').innerHTML = out.svg;
    const apply = () => $$('#frameView .fl-layer').forEach(g => g.classList.toggle('is-off', on[g.dataset.layer] === false));
    apply();
    $$('#frameToggles button').forEach(b => { b.onclick = () => { on[b.dataset.layer] = on[b.dataset.layer] === false; b.classList.toggle('is-on', on[b.dataset.layer] !== false); b.setAttribute('aria-pressed', on[b.dataset.layer] !== false); apply(); }; });
    $('#frameRows').innerHTML = recordRows(Fd, file, plan);
    wireFrame(Fd);
  }

  // ---------- the frame files: this frame line's own, and everything the tool writes into it ----------
  const frameFiles = () => (state.nbg.files || []).filter(x => x.ff);
  const fKey = Fd => `${Fd.name}|${Fd.frame}`;
  // a file's frame lines: from its name and title; "_12" on a building of fewer lines is lines 1 and 2
  function fileLines(x, nLines) {
    const out = new Set(x.ff.info.lines.map(Number));
    const t = (String(x.ff.info.title || '').match(/-\s*(\d+)\s*$/) || [])[1];
    if (t) out.add(+t);
    [...out].forEach(n => { if (nLines && n > nLines && String(n).split('').every(d => +d >= 1 && +d <= nLines)) { out.delete(n); String(n).split('').forEach(d => out.add(+d)); } });
    return [...out].sort((a, b) => a - b);
  }
  // the dropped file that is this frame line's: the latest one NBG made for this building and line; else a frame saved
  // on its own (no building in its title) as wide as this building; else none
  function fileFor(Fd) {
    const nL = (siteB(Fd.name) || { xs: [] }).xs.length;
    const fs = frameFiles().slice().sort((a, b) => (b.at || 0) - (a.at || 0)), inB = x => x.ff.info.building && sameName(x.ff.info.building, Fd.name), lines = x => fileLines(x, nL).map(String);
    return fs.find(x => inB(x) && lines(x).includes(String(Fd.frame)))
      || fs.find(x => !x.ff.info.building && Math.abs((x.ff.info.width || 0) - Fd.g.width) < 0.6 && (!x.ff.info.lines.length || lines(x).includes(String(Fd.frame))))
      || (J0().site.buildings.length === 1 ? fs.find(x => lines(x).includes(String(Fd.frame))) : null) || null;
  }
  const J0 = () => state.snowJob;
  function chosenFile(Fd) {
    const pick = (state.frameFile || {})[fKey(Fd)], fs = frameFiles();
    return (pick && fs.find(x => x.name === pick)) || fileFor(Fd);
  }
  // the host frame's columns: the line's file, else the PCS (COL01 at the FSW, Box 5's columns, the BSW column last)
  function hostMembers(Fd) {
    const f = chosenFile(Fd);
    if (f && f.ff && f.ff.info.columns.length) return f.ff.info.columns.slice().sort((a, b) => a.x - b.x).map(c => ({ id: c.id, x: c.x }));
    return Fd.cols.map((y, k) => ({ id: 'COL' + String(k + 1).padStart(2, '0'), x: y }));
  }
  /* the lower buildings whose frame lines land on this frame line: a lean-to against this building's wall. Against a
     sidewall, one of its lines on each host frame; against an endwall, all of its lines on the end frame. */
  function leanHere(Fd) {
    const J = J0(), host = siteB(Fd.name);
    if (!J || !host) return [];
    return J.drifts.filter(d => !d.level && d.step.upper && sameName(d.upper, Fd.name) && (d.lowerWall === 'FSW' || d.lowerWall === 'BSW')).map(d => {
      const low = d.step.lower, yw = d.lowerWall === 'FSW' ? 0 : low.g.width;
      const lines = B.frameLines(low).map(fl => ({ fl, p: host.toLocal(low.toSite([fl.x, yw])) })).filter(q => Math.abs(q.p[0] - Fd.x) <= 0.6);
      return lines.length ? { d, low, yw, lines } : null;
    }).filter(Boolean);
  }
  function leanTargets(Fd, it) {
    if (!it || !it.ff) return null;
    const fW = it.ff.info.width, here = leanHere(Fd).filter(q => (it.ff.info.building ? sameName(it.ff.info.building, q.d.lower) : Math.abs(q.low.g.width - fW) < 0.6));
    const h = here[0];
    if (!h) return null;
    const hm = hostMembers(Fd), targets = h.lines.map(({ fl, p }) => {
      const hy = p[1], c = hm.length ? hm.reduce((m, q) => (Math.abs(q.x - hy) < Math.abs(m.x - hy) ? q : m), hm[0]) : null;
      return { line: fl.no, trib: fl.trib, hy, at: SITE.roofZ(h.low.g, fl.x, h.yw), member: c ? c.id : null, off: c ? Math.abs(c.x - hy) : null };
    });
    const ltCols = it.ff.info.columns.slice().sort((a, b) => a.x - b.x), col = ((h.d.lowerWall === 'BSW' ? ltCols[ltCols.length - 1] : ltCols[0]) || {}).id;
    return { step: h.d, lower: h.low.name, lowG: h.low.g, wall: h.d.lowerWall, upperWall: h.d.upperWall, targets, col, bay: it.ff.info.bayWidth };
  }
  // the lean-to a file is of (its building in the file, else the lean-to it fits by width)
  const T0 = it => (it && it.ff ? it.ff.info.building || `w${(+it.ff.info.width || 0).toFixed(1)}` : '');
  // the designed lean-to files that fit this frame, latest dropped first
  const leanFiles = Fd => frameFiles().filter(x => x.ff.info.reactions && x.ff.info.reactions.length && !sameName(x.ff.info.building || '\u0000', Fd.name) && (leanTargets(Fd, x) || { targets: [] }).targets.length).sort((a, b) => (b.at || 0) - (a.at || 0));
  // the lean-to file whose reactions go on this frame line: the one imported here, else the latest that fits (removed
  // by hand: none)
  function leanImport(Fd) {
    const imp = ((state.leanTo = state.leanTo || {}).imp = state.leanTo.imp || {}), k = fKey(Fd);
    if (imp[k] === null) return null;
    const cands = leanFiles(Fd);
    let rec = imp[k], it = rec && frameFiles().find(x => x.name === rec.file);
    // the lean-to redesigned and dropped again under another name: its newest file takes over, the edits kept
    if (it && cands[0] && cands[0] !== it && (cands[0].at || 0) > (it.at || 0) && sameName(cands[0].ff.info.building || T0(cands[0]), it.ff.info.building || T0(it))) { imp[k] = { ...rec, file: cands[0].name }; rec = imp[k]; it = cands[0]; toast(`${it.name} — the newer lean-to file, its reactions now on ${Fd.name} line ${Fd.frame}`); }
    if (!it) { if (!cands.length) return null; it = cands[0]; rec = { file: it.name, auto: true }; }
    const T = leanTargets(Fd, it);
    return T && T.targets.length ? { rec, it, T, others: cands.filter(x => x !== it) } : null;
  }
  const editRec = Fd => { const imp = state.leanTo.imp, k = fKey(Fd), LI = leanImport(Fd); if (!imp[k] && LI) imp[k] = { file: LI.it.name }; return imp[k]; };
  // the drift a frame file carries against the drift the tool works for those frame lines: the tool's, NBG's own, none
  function driftStatus(it, FdLow) {
    const had = (it.ff.info.ploads || []).filter(q => /drift|sliding/i.test(q.name || ''));
    const crc = it.crc != null ? it.crc : (it.crc = it.bytes ? FF.crc32(it.bytes) : null);
    const asWritten = !!(state.written && crc != null && state.written.has(crc));
    if (!had.length) return { kind: 'none', had, asWritten };
    const mine = FdLow ? framePlan(FdLow, it, null).pan.filter(r => r.caseId === 'SL') : [];
    const sl = had.filter(q => q.loadCaseID === 'SL'), pk = a => Math.max(...a.map(q => Math.max(Math.abs(+q.startMag || +q.start || 0), Math.abs(+q.endMag || +q.end || 0))));
    const same = mine.length && sl.length === mine.length && Math.abs(pk(sl) - pk(mine.map(r => ({ start: r.start, end: r.end })))) <= 0.005 * Math.max(1, pk(sl));
    return { kind: same ? 'tool' : /backsidewall|frontsidewall|leftendwall|rightendwall/i.test(sl.map(q => q.name).join(' ')) ? 'nbg' : 'other', had, asWritten, peak: sl.length ? pk(sl) : 0 };
  }
  // everything this frame line's file gets: the Snow Drift panel rows (scaled to the file's own bay width), a lean-to's
  // reactions, the mezzanine FDL / FLL / EQ rows the NBG block makes for it
  function framePlan(Fd, file, LI) {
    const ld = Fd.loads, bay = file && file.ff.info.bayWidth > 0 ? file.ff.info.bayWidth : Fd.trib;
    const scale = Fd.trib > 0 && Math.abs(bay / Fd.trib - 1) > 0.005 ? bay / Fd.trib : 1;
    const cases = file && file.ff.info.cases.length ? file.ff.info.cases : [];
    const extraCases = ['LRD', 'RRD'].filter(c => cases.includes(c)), dir = driftDir();
    const pan = [];
    (ld.drift || []).forEach(sg => ['SL', ...extraCases].forEach(cs => pan.push({ name: 'Snow Drift', caseId: cs, panel: 'RP' + sg.panel, dir, from: sg.from, to: sg.to, start: sg.start * scale, end: sg.end * scale, by: sg.by })));
    const scaleNote = scale !== 1 ? `${file.name} is set to a ${ft(bay)} bay; this frame line's tributary width is ${ft(Fd.trib)} — the rows are × ${F3(scale)} to match the file (its own roof loads use the same bay).` : '';
    const crows = [], leanDraw = [];
    let ltInfo = null, leanGhost = null, leanSide = null;
    if (LI) {
      const { it, T, rec } = LI, hostCases = new Set(cases), rx = it.ff.info.reactions.filter(r => r.col === T.col);
      const use = rx.filter(r => !hostCases.size || hostCases.has(r.caseName));
      // named as NBG Frame's Add Frame Reactions names them: the source file, then its column
      const base = it.name.replace(/\.frame$/i, '').replace(/(?:\s*\(\d+\))+$/, '').replace(/[-_ ](?:loads|mz|mezz)$/i, '').replace(/_/g, ' ').trim();
      const at = rec.at != null && isFinite(rec.at) ? +rec.at : T.targets[0].at;
      const show = rec.show && use.some(r => r.caseName === rec.show) ? rec.show : ((use.find(r => r.caseName === 'SL') || use[0] || {}).caseName);
      const hm = hostMembers(Fd);
      T.targets.forEach(t => {
        const member = (rec.members || {})[t.line] || t.member;
        if (!member) return;
        const k = rec.scale ? t.trib / (T.bay || t.trib) : 1, mc = hm.find(m => m.id === member);
        use.forEach(r => crows.push({ name: `${base} - ${T.col} - Reaction`, caseId: r.caseName, member, x: -(r.Htop != null ? r.Htop : 0) * k, y: -r.V * k, location: +at.toFixed(4), toFlange: '3', leanTo: true }));
        const r = use.find(q => q.caseName === show);
        if (r) leanDraw.push({ y: mc ? mc.x : t.hy, at, V: r.V * k, X: -(r.Htop || 0) * k, member, caseName: show });
      });
      if (T.targets.length > 1) { const ys = T.targets.map(t => t.hy); leanGhost = { y0: Math.min(...ys), y1: Math.max(...ys), at, name: T.lower }; }
      // a lean-to against a sidewall: drawn beside the frame, its rafter down from where it bears to its low eave
      else if (T.upperWall === 'FSW' || T.upperWall === 'BSW') leanSide = { side: T.upperWall, width: T.lowG.width, at, lowEave: T.wall === 'FSW' ? T.lowG.eaveBSW : T.lowG.eaveFSW, name: T.lower };
      ltInfo = { file: it.name, T, rx, use, show, at, base, skipped: [...new Set(rx.map(r => r.caseName))].filter(c => hostCases.size && !hostCases.has(c)) };
    }
    let mezz = [];
    try { mezz = file && C.nbgRows && state.res && !state.res.incomplete ? C.nbgRows(file) : []; } catch (e) { mezz = []; }
    return { pan, scale, bay, scaleNote, extraCases, crows, ltInfo, leanDraw, leanGhost, leanSide, mezz, cases, dir };
  }
  // the download, top right: one file with everything the tool puts on this frame line
  function dlBlock(Fd, file, plan) {
    const what = [plan.pan.length && `${plan.pan.length} Snow Drift row${plan.pan.length > 1 ? 's' : ''}`, plan.crows.length && `${plan.crows.length} lean-to reaction rows`, plan.mezz.length && `${plan.mezz.length} mezzanine rows`].filter(Boolean);
    const ok = !!file && what.length > 0;
    return `<div class="fv-dl"><button class="btn-mint" data-ffdl ${ok ? '' : 'disabled'}><svg><use href="#i-file"/></svg>${file ? `Download ${esc(outName(file))}` : 'Download .frame'}</button><small>${!file ? 'drop this line\'s .frame below first' : what.length ? esc(what.join(' · ')) : 'nothing from the tool on this line'}</small></div>`;
  }
  // the working strip under the title: the line's file, a lean-to's reactions, the lateral system
  function workStrip(Fd, file, plan, LI) {
    const fs = frameFiles(), matched = file && fileFor(Fd) === file;
    const lowStatus = file && (Fd.loads.drift || []).length ? driftStatus(file, Fd) : null;
    const stT = !lowStatus ? '' : lowStatus.asWritten ? `<span class="fv-st warn">as the tool wrote it — run it in NBG Frame, then drop it back</span>`
      : lowStatus.kind === 'tool' ? `<span class="fv-st ok">carries the tool's drift</span>`
      : lowStatus.kind === 'nbg' ? `<span class="fv-st warn">carries NBG's own drift (${F3(lowStatus.peak)} k/ft) — the download replaces it</span>`
      : lowStatus.kind === 'other' ? `<span class="fv-st warn">carries a different drift (${F3(lowStatus.peak)} k/ft) — the download replaces it</span>` : `<span class="fv-st">no drift row yet</span>`;
    const fileCard = `<div class="fv-card"><span class="fv-k">This line's .frame</span>
      ${file ? `<div class="fv-file"><b class="mono" title="${esc(file.name)}">${esc(file.name)}</b><small>${esc(file.ff.info.building || 'no building in its title')} · ${fileLines(file, (siteB(Fd.name) || { xs: [] }).xs.length).length ? 'line ' + fileLines(file, (siteB(Fd.name) || { xs: [] }).xs.length).join(', ') + ' · ' : ''}bay ${ft(file.ff.info.bayWidth)} · ${matched ? 'matched' : 'picked'}</small>${stT}</div>
      <div class="fv-row"><label class="fv-drop"><input type="file" accept=".frame" data-fvdrop="line" multiple><svg><use href="#i-file"/></svg><span>Replace</span></label>` : `<label class="fv-drop wide"><input type="file" accept=".frame" data-fvdrop="line" multiple><svg><use href="#i-file"/></svg><span><b>Drop this line's .frame</b><small>the one NBG made for ${esc(Fd.name)} line ${Fd.frame}: everything the tool puts on this line goes into it</small></span></label>
      <div class="fv-row">`}${fs.length > 1 || (fs.length && !file) ? `<select data-ffile title="Pick another loaded file"><option value="">${file ? 'another file…' : 'or pick a loaded file…'}</option>${fs.filter(x => x !== file).map(x => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('')}</select>` : ''}</div>
      ${plan.pan.length ? `<label class="fv-mini">Snow Drift direction <select data-fdir><option ${plan.dir === 'PY' ? 'selected' : ''}>PY</option><option ${plan.dir === 'GY' ? 'selected' : ''}>GY</option></select><small>PY: on the horizontal projection</small></label>` : ''}</div>`;
    const here = leanHere(Fd);
    let leanCard = '';
    if (here.length) {
      const h = here[0], cands = leanFiles(Fd), hm = hostMembers(Fd);
      if (LI) {
        const { it, T, rec } = LI, st = driftStatus(it, frameData(T.lower, T.targets[0] ? T.targets[0].line : 1));
        const stLean = st.asWritten ? `<span class="fv-st warn">as the tool wrote it — not run in NBG Frame yet: its reactions are from before the drift</span>`
          : st.kind === 'tool' ? `<span class="fv-st ok">designed with the tool's drift</span>`
          : st.kind === 'nbg' ? `<span class="fv-st warn">designed with NBG's own drift, not the tool's — write the drift on ${esc(T.lower)}'s lines and redesign</span>`
          : st.kind === 'other' ? `<span class="fv-st warn">its drift differs from the tool's</span>` : `<span class="fv-st warn">no drift in it</span>`;
        const cases = LI ? [...new Set(plan.ltInfo ? plan.ltInfo.use.map(r => r.caseName) : [])] : [];
        const doubles = T.bay > 0 && T.targets.length > 1 && T.targets.some(t => Math.abs(t.trib - T.bay) > 0.05);
        leanCard = `<div class="fv-card fv-lean"><span class="fv-k">Lean-to reactions · ${esc(T.lower)} against its ${T.wall}</span>
          <div class="fv-file"><b class="mono" title="${esc(it.name)}">${esc(it.name)}</b><small>${esc(T.lower)}'s ${esc(T.col)} · ${plan.ltInfo ? plan.ltInfo.use.length : 0} load cases${plan.ltInfo && plan.ltInfo.skipped.length ? ` · ${plan.ltInfo.skipped.join(', ')} not in this frame` : ''}${rec.auto ? ' · the latest loaded' : ''}</small>${stLean}${LI.others.length ? `<small class="sub-n">replaces ${LI.others.map(x => esc(x.name)).join(', ')} (earlier)</small>` : ''}</div>
          <div class="fv-lt">${T.targets.map(t => { const m = (rec.members || {})[t.line] || t.member; return `<label><span>${esc(T.lower)} line ${t.line} → column</span><select data-ltmem="${t.line}">${hm.map(c => `<option ${c.id === m ? 'selected' : ''}>${esc(c.id)}</option>`).join('')}</select>${t.off > 1 ? `<small class="bad">lands ${ft(t.off)} from ${esc(t.member)}</small>` : ''}</label>`; }).join('')}
            <label><span>Location (ft)</span><input class="seis-in" data-ltat value="${F3(plan.ltInfo ? plan.ltInfo.at : T.targets[0].at)}" inputmode="decimal"><small>${esc(T.lower)}'s eave at the wall ${ft(T.targets[0].at)}</small></label></div>
          <div class="fv-cases"><span>Drawn:</span>${cases.map(c => `<button class="chip ${plan.ltInfo && plan.ltInfo.show === c ? 'is-on' : ''}" data-ltcase="${esc(c)}">${esc(c)}</button>`).join('')}</div>
          ${doubles ? `<label class="seis-chk sm"><input type="checkbox" data-ltscale ${rec.scale ? 'checked' : ''}> <span>${esc(it.name)} is set to a ${ft(T.bay)} bay; ${esc(T.lower)}'s lines here carry ${T.targets.map(t => ft(t.trib)).join(' and ')} — scale each column's reactions to its line</span></label>` : ''}
          <div class="fv-row"><label class="fv-drop"><input type="file" accept=".frame" data-fvdrop="lean"><svg><use href="#i-file"/></svg><span>Import the redesigned one</span></label><button class="btn-ghost sm" data-ltrm>Remove</button></div></div>`;
      } else {
        leanCard = `<div class="fv-card fv-lean"><span class="fv-k">Lean-to reactions · ${esc(h.low.name)} against its ${h.d.lowerWall}</span>
          <label class="fv-drop wide"><input type="file" accept=".frame" data-fvdrop="lean"><svg><use href="#i-file"/></svg><span><b>Import frame reactions</b><small>drop ${esc(h.low.name)}'s designed .frame — its ${h.d.lowerWall === 'BSW' ? 'BSW' : 'FSW'} column's reactions go on this frame's column${h.lines.length > 1 ? 's' : ''} at its eave</small></span></label>
          ${cands.length ? `<div class="fv-row">${cands.map(x => `<button class="chip" data-ltuse="${esc(x.name)}">Use ${esc(x.name)}</button>`).join('')}</div>` : ''}</div>`;
      }
    }
    const bS = sb(Fd.name), lineS = bS ? (bS.lines || []).find(l => String(l.label) === String(Fd.frame)) : null;
    const picked = bS && (((state.seis.buildings || {})[bS.bkey] || {}).lines || {})[String(Fd.frame)];
    const curSys = picked || (lineS ? lineS.type : /post|beam/i.test(Fd.type || '') ? 'Post & Beam' : 'Rigid Frame');
    const sys = $('#frameSys');
    if (sys) sys.innerHTML = bS ? `<span class="fv-k">Lateral system</span><select data-fsys="${esc(bS.bkey)}|${esc(String(Fd.frame))}">${(C.LINE_SYSTEMS || []).map(t => `<option ${t === curSys ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><small class="sub-n">${picked ? 'picked here' : 'PCS Box 5'}${lineS && lineS.lat && lineS.lat.R != null ? ` · R ${+lineS.lat.R.toFixed(2)}` : ''}</small>` : '';
    return fileCard + leanCard;
  }
  /* The lean-to loop, job-wide, at the top of the page: 1 the lean-to's lines get the drift (download), 2 it is
     redesigned in NBG Frame and dropped back, 3 the host line takes its reactions (download). Each step a link. */
  function renderLeanSteps() {
    const box = $('#frameSteps');
    if (!box) return;
    const J = J0(), steps = J ? J.drifts.filter(d => !d.level && !d.off && d.frames.length && (d.lowerWall === 'FSW' || d.lowerWall === 'BSW')) : [];
    if (!steps.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = steps.map(d => {
      const low = d.lower, lines = d.frames.map(f => f.frame), fs = frameFiles();
      const lowFiles = fs.filter(x => x.ff.info.building ? sameName(x.ff.info.building, low) : Math.abs((x.ff.info.width || 0) - d.step.lower.g.width) < 0.6).sort((a, b) => (b.at || 0) - (a.at || 0));
      const latest = lowFiles[0], st = latest ? driftStatus(latest, frameData(low, lines[0])) : null;
      const s1 = st && (st.kind === 'tool' || st.asWritten), s2 = st && st.kind === 'tool' && !st.asWritten && latest.ff.info.reactions && latest.ff.info.reactions.length;
      const host = siteB(d.upper), hostLine = host ? B.frameLines(host).find(fl => { const Fd = frameData(d.upper, fl.no); return Fd && leanHere(Fd).some(q => sameName(q.d.lower, low)); }) : null;
      const hostFd = hostLine ? frameData(d.upper, hostLine.no) : null, hLI = hostFd ? leanImport(hostFd) : null, s3 = !!(hLI && s2 && hLI.it === latest);
      const stp = (n, done, now, title, sub, go) => `<button class="ls-step ${done ? 'is-done' : now ? 'is-now' : ''}" ${go ? `data-lsgo="${esc(go)}"` : ''}><i>${done ? '✓' : n}</i><span><b>${title}</b><small>${sub}</small></span></button>`;
      return `<div class="ls"><span class="ls-k">Lean-to · ${esc(low)} against ${esc(d.upper)}</span>
        ${stp(1, s1 || s2, !s1 && !s2, `Drift onto ${esc(low)}`, `write it on line${lines.length > 1 ? 's' : ''} ${lines.join(', ')} and download`, `${low}|${lines[0]}`)}
        ${stp(2, s2, s1 && !s2, 'Redesign in NBG Frame', s2 ? `${esc(latest.name)} is back` : 'then drop the designed file back', `${low}|${lines[0]}`)}
        ${stp(3, s3, s2 && !s3, `Reactions onto ${esc(d.upper)}`, hostLine ? `line ${hostLine.no}: check the columns, download` : 'its frame line', hostLine ? `${d.upper}|${hostLine.no}` : '')}</div>`;
    }).join('');
    $$('#frameSteps [data-lsgo]').forEach(b => { b.onclick = () => { const [bn, no] = b.dataset.lsgo.split('|'); selectFrame(bn, +no); }; });
  }
  // the record under the drawing: what this line takes and what goes into its file
  function recordRows(Fd, file, plan) {
    const ld = Fd.loads, sj = state.job && state.job.seismic, b = sb(Fd.name), lat = b ? (b.lines || []).find(l => String(l.label) === String(Fd.frame)) : null;
    // the concentrated rows exactly as they go into the file: the file's own rows when there is one, else the same rows
    // from the drawing — named by the column (FDL2, FLL3, EQR2 …), as NBG Frame's Concentrated (Panel) Loads lists them
    const web = C.webCode ? String(C.webCode()) : '3', eccName = c => (String(c) === '1' ? 'Top/Left' : String(c) === web || String(c) === '3' ? 'WebCenterline' : 'code ' + c);
    const colNo = m => +(/(\d+)\s*$/.exec(m || '') || [0, 0])[1];
    let con = [];
    if (plan.mezz.length) con = plan.mezz.map(r => ({ name: r.name, cs: r.caseId, member: r.member, at: r.location, x: r.x || 0, y: r.y || 0, ecc: r.toFlange != null ? r.toFlange : web }));
    else {
      (ld.mezz || []).forEach(q => { con.push({ name: 'FDL' + colNo(q.member), cs: 'FDL', member: q.member, at: q.elev, x: 0, y: -q.D, ecc: web }); con.push({ name: 'FLL' + colNo(q.member), cs: 'FLL', member: q.member, at: q.elev, x: 0, y: -q.L, ecc: web }); });
      (ld.eq || []).filter(q => q.F != null).forEach(q => { con.push({ name: 'EQR' + colNo(q.member), cs: 'EQR', member: q.member, at: q.at, x: q.F, y: 0, ecc: '1' }); con.push({ name: 'EQL' + colNo(q.member), cs: 'EQL', member: q.member, at: q.at, x: -q.F, y: 0, ecc: '1' }); });
    }
    plan.crows.forEach(r => con.push({ name: r.name, cs: r.caseId, member: r.member, at: r.location, x: r.x, y: r.y, ecc: r.toFlange, lean: true }));
    const eqWait = (ld.eq || []).some(q => q.F == null);
    const sum = [ld.snow ? `<span>Roof snow <b>${F1(ld.snow.applied)} psf</b> (${esc(ld.snow.src)}) → <b>${kft(ld.snow.kft)}</b></span>${ld.snow.applied !== ld.snow.ps ? `<span>balanced ps <b>${F1(ld.snow.ps)} psf</b> under the drift</span>` : ''}` : '', `<span>Roof dead + collateral <b>${kft(ld.dead + ld.coll)}</b></span>`,
      lat ? `<span>Roof seismic <b>${F2(lat.lat.frame.roofPsf)} psf</b> · Cs <b>${F3(lat.lat.Cs)}</b> · base shear <b>${F2(lat.lat.V)} k</b> · ${esc(lat.lat.sys.label)} R <b>${+lat.lat.R.toFixed(2)}</b></span>` : ''].filter(Boolean).join('');
    const panT = plan.pan.length ? `<div class="table-wrap nbg-grid"><table class="fl-t"><thead><tr><th>Description</th><th>Load Case</th><th>Panel</th><th>Load Direction</th><th class="num">Start Load (kip/ft)</th><th class="num">End Load (kip/ft)</th><th class="num">Start Location (ft)</th><th class="num">End Location (ft)</th></tr></thead><tbody>${plan.pan.map(r => `<tr><td>${esc(r.name)}</td><td class="mono">${r.caseId}</td><td class="mono">${r.panel}</td><td class="mono">${r.dir}</td><td class="num mono"><b>${F3(r.start)}</b></td><td class="num mono"><b>${F3(r.end)}</b></td><td class="num mono">${F3(r.from)}</td><td class="num mono">${F3(r.to)}</td></tr>`).join('')}</tbody></table></div><small class="sub-n">${plan.scaleNote ? esc(plan.scaleNote) + ' ' : ''}The larger of the drift and any sliding snow at each point (7.9: not added together), × ${plan.scale !== 1 ? `the file's ${ft(plan.bay)} bay` : `the ${ft(Fd.trib)} tributary width`}. Under SL${plan.extraCases.length ? ` and ${plan.extraCases.join(', ')}` : ''}, direction ${plan.dir}${plan.dir === 'PY' ? ' (on the horizontal projection — NBG Frame\'s own automatic drift row is GY)' : ''}.</small>` : '<small class="sub-n">No drift or sliding snow on this frame line.</small>';
    const had = file ? (file.ff.info.ploads || []).filter(q => /drift|sliding/i.test(q.name || '')) : [];
    const bayF = file && file.ff.info.bayWidth > 0 ? file.ff.info.bayWidth : Fd.trib;
    const hadT = had.length ? `<div class="seis-msg ${plan.pan.length ? 'warn' : 'info'}">${esc(file.name)} carries ${had.map(q => { const a = Math.abs(+q.startMag), c = Math.abs(+q.endMag), pk = Math.max(a, c); return `<b>${esc(String(q.name).trim())}</b> (${q.loadCaseID}, ${esc(q.dir || '')}) ${F3(+q.startMag)} → ${F3(+q.endMag)} k/ft, ${F1(pk * 1000 / bayF)} psf on its ${ft(bayF)} bay`; }).join(' · ')}.${plan.pan.length ? ` The download replaces ${had.length > 1 ? 'them' : 'it'} with the tool's rows (peak ${F3(Math.max(...plan.pan.filter(r => r.caseId === 'SL').map(r => Math.max(-r.start, -r.end))))} k/ft)${state.snowJob && state.snowJob.drifts.some(d => d.luUpperParts && d.luUpperParts.length > 1 && sameName(d.lower, Fd.name)) ? ' — its fetch runs through the roofs in line, where NBG Frame\'s own drift takes the adjacent roof alone' : ''}.` : ''}</div>` : '';
    const lt = plan.ltInfo, ltT = lt ? `<div class="panel-sub"><h4>Lean-to reactions · ${esc(lt.file)} <small class="sub-n">${esc(lt.T.lower)}'s ${esc(lt.T.col)}, every case this frame has; Y = − vertical at its base, X = − horizontal at its top, at ${ft(lt.at)} — as NBG Frame's Add Frame Reactions puts them</small></h4>
      <div class="table-wrap"><table class="fl-t"><thead><tr><th>Case</th><th class="num">Vertical (k)</th><th class="num">Horizontal at the top (k)</th><th>On ${lt.T.targets.map(t => esc((((state.leanTo.imp || {})[fKey(Fd)] || {}).members || {})[t.line] || t.member || '?')).join(' and ')}</th></tr></thead><tbody>${lt.rx.map(r => `<tr class="${lt.use.includes(r) ? '' : 'is-off'}"><td class="mono"><b>${esc(r.caseName)}</b>${lt.use.includes(r) ? '' : ' <small class="sub-n">not a case of this frame</small>'}</td><td class="num mono">${F3(r.V)}</td><td class="num mono">${r.Htop != null ? F3(r.Htop) : '—'}</td><td class="mono">Y ${F3(-r.V)} · X ${F3(-(r.Htop || 0))}</td></tr>`).join('')}</tbody></table></div>
      ${lt.T.upperWall === 'LEW' || lt.T.upperWall === 'REW' ? `<small class="sub-n">${esc(lt.T.lower)} stands against this building's ${lt.T.upperWall}: its frames run across this end frame, so their horizontal reaction acts out of this frame's plane. NBG Frame's Add Frame Reactions still enters it as X, as the engineer did — check the endwall for it.</small>` : ''}</div>` : '';
    const steps = `<div class="panel-sub nbg-steps"><h4>In NBG Frame</h4><ol><li>Open the downloaded file.</li><li>Tools → Concentrated (Panel) Loads: the <b>panel</b> tab has the Snow Drift rows (${plan.dir}), the <b>concentrated</b> tab the lean-to reactions and the mezzanine rows — check them against the tables here.</li><li>Save and Gen Loads, then run the frame.</li>${(Fd.loads.drift || []).length ? '<li>A lean-to: drop the redesigned file back here; its reactions go on the host frame.</li>' : ''}</ol></div>`;
    return `<div class="fv-sum">${sum}<a href="#" data-go="snow">Snow calc</a>${lat ? '<a href="#" data-go="seismic">Seismic calc</a>' : ''}</div>${hadT}
      <div class="fr-rows"><div class="panel-sub"><h4>Panel loads <small class="sub-n">as NBG Frame lists them · Tools → Concentrated (Panel) Loads, the panel tab · down negative, locations along the frame from the FSW</small></h4>${panT}</div>
      <div class="panel-sub"><h4>Concentrated loads <small class="sub-n">as NBG Frame lists them · Tools → Concentrated (Panel) Loads · each row named by its column (FDL2 on COL02)</small></h4>
        ${con.length ? `<div class="table-wrap nbg-grid"><table class="fl-t"><thead><tr><th>Description</th><th>Load Case</th><th>Member</th><th class="num">X Force (kip)</th><th class="num">Y Force (kip)</th><th class="num">Moment (kip-ft)</th><th class="num">Location (ft)</th><th>Ecc. Loc.</th><th class="num">Ecc. Offset (in)</th><th>Loc. Sys.</th></tr></thead><tbody>${con.map(r => `<tr class="${r.lean ? 'is-lean' : ''}"><td>${esc(r.name)}</td><td class="mono">${r.cs}</td><td class="mono">${esc(r.member || '—')}</td><td class="num mono">${F3(r.x || 0)}</td><td class="num mono">${F3(r.y || 0)}</td><td class="num mono">0.000</td><td class="num mono">${F3(r.at)}</td><td>${esc(eccName(r.ecc))}</td><td class="num mono">0.000</td><td>Global</td></tr>`).join('')}</tbody></table></div>${eqWait ? `<div class="seis-msg warn">EQR / EQL on ${(ld.eq || []).map(q => esc(q.member || '')).join(', ')} come once the <a href="#" data-go="seismic">Seismic calc</a> is complete${sj && sj.need && sj.need.length ? `: ${esc(sj.need[0])}` : ''}.</div>` : ''}` : `<small class="sub-n">No concentrated loads from the tool on this frame line.</small>`}</div></div>
      ${ltT}${steps}`;
  }
  function wireFrame(Fd) {
    const k = fKey(Fd), rerender = () => { renderFrames(); if (C.renderNbg) C.renderNbg(); };
    // a file dropped here: added to the job's files, then made this line's file or this line's lean-to
    $$('#frameWork [data-fvdrop]').forEach(inp => {
      const lab = inp.closest('.fv-drop');
      if (lab) { ['dragenter', 'dragover'].forEach(ev => lab.addEventListener(ev, () => lab.classList.add('is-over'))); ['dragleave', 'drop'].forEach(ev => lab.addEventListener(ev, () => lab.classList.remove('is-over'))); }
      inp.onchange = async () => {
        const list = Array.from(inp.files || []).filter(x => /\.frame$/i.test(x.name));
        if (!list.length) { toast('Drop a .frame file'); return; }
        await addFrameFiles(list);
        const name = list[list.length - 1].name;
        if (inp.dataset.fvdrop === 'line') { state.frameFile = state.frameFile || {}; state.frameFile[k] = name; toast(`${name} — this line's file`); }
        else { const it = frameFiles().find(x => x.name === name); if (!it || !leanTargets(Fd, it)) { toast(`${name} does not fit a lean-to on this frame`); } else if (!(it.ff.info.reactions || []).length) { toast(`${name} has no reactions — run it in NBG Frame first`); } else { state.leanTo.imp[k] = { file: name }; toast(`${name} — its reactions are on ${Fd.name} line ${Fd.frame}`); } }
        rerender();
      };
    });
    const sel = $('#frameWork [data-ffile]');
    if (sel) sel.onchange = () => { if (!sel.value) return; state.frameFile = state.frameFile || {}; state.frameFile[k] = sel.value; rerender(); };
    const dir = $('#frameWork [data-fdir]');
    if (dir) dir.onchange = () => { try { localStorage.setItem(DIR_KEY, dir.value); } catch (e) { /* session */ } renderFrames(); };
    $$('#frameWork [data-ltmem]').forEach(el => { el.onchange = () => { const r = editRec(Fd); r.members = r.members || {}; r.members[el.dataset.ltmem] = el.value; renderFrames(); }; });
    const at = $('#frameWork [data-ltat]');
    if (at) at.onchange = () => { const r = editRec(Fd), v = parseFloat(at.value); if (isFinite(v) && v > 0) r.at = v; else delete r.at; renderFrames(); };
    $$('#frameWork [data-ltcase]').forEach(el => { el.onclick = () => { const r = editRec(Fd); r.show = el.dataset.ltcase; renderFrames(); }; });
    const sc = $('#frameWork [data-ltscale]');
    if (sc) sc.onchange = () => { const r = editRec(Fd); r.scale = sc.checked; renderFrames(); };
    const rm = $('#frameWork [data-ltrm]');
    if (rm) rm.onclick = () => { state.leanTo.imp[k] = null; renderFrames(); toast('Lean-to reactions taken off this line'); };
    $$('#frameWork [data-ltuse]').forEach(el => { el.onclick = () => { state.leanTo.imp[k] = { file: el.dataset.ltuse }; renderFrames(); }; });
    const fsys = $('#frameSys [data-fsys]');
    if (fsys) fsys.onchange = () => { const [bk, lab] = fsys.dataset.fsys.split('|'); state.seis.buildings = state.seis.buildings || {}; const bo = state.seis.buildings[bk] = state.seis.buildings[bk] || {}; bo.lines = bo.lines || {}; bo.lines[lab] = fsys.value; C.seisSave && C.seisSave(); recompute(); toast(`Frame line ${lab}: ${fsys.value} — the seismic is reworked with its R`); };
    const btn = $('#frameActs [data-ffdl]');
    if (btn) btn.onclick = async () => {
      const file = chosenFile(Fd);
      if (!file) { toast('Drop this line\'s .frame first'); return; }
      const plan = framePlan(Fd, file, leanImport(Fd));
      try {
        let xml = file.ff.xml;
        const crows = plan.mezz.concat(plan.crows);
        if (crows.length) xml = FF.addLoads(xml, crows, { toFlange: C.webCode ? C.webCode() : undefined, floors: plan.mezz.length > 0 }).xml;
        const pl = FF.addPanelLoads(xml, plan.pan.map(r => ({ name: r.name, caseId: r.caseId, panel: r.panel, from: r.from, to: r.to, start: r.start, end: r.end, dir: r.dir })));
        xml = pl.xml;
        const bytes = await FF.write(file.ff, xml, zipIO), name = outName(file);
        (state.written = state.written || new Set()).add(FF.crc32(bytes));
        cpSave(bytes, name, 'application/octet-stream');
        toast(`${name} — ${[plan.pan.length && `${pl.added} Snow Drift rows (${plan.dir})${pl.replaced ? `, in place of ${pl.replaced}` : ''}`, plan.crows.length && `${plan.crows.length} lean-to reaction rows`, plan.mezz.length && `${plan.mezz.length} mezzanine rows`].filter(Boolean).join(', ')}${plan.ltInfo && plan.ltInfo.skipped.length ? ` · ${plan.ltInfo.skipped.join(', ')} left out (not cases of this frame)` : ''}`);
        renderFrames();
      } catch (e) { console.error(e); toast('Frame file: ' + e.message); }
    };
  }

  // ---------- Bracing ----------
  /* Where the mezzanine's longitudinal seismic goes, wall by wall. The rule (NBG practice, the W0S job): EQB and EQF at
     the frame lines nearest the two ends of the mezzanine's run along that wall, at the mezzanine level; a wall the
     mezzanine does not stand on gets nothing; the X-bracing in a bay inside the run is tiered at the mezzanine level
     with a strut there; an edge not on a wall needs a wall of its own — a portal frame or X-bracing on that line. */
  const nearestLine = (lines, x) => { let k = 0; lines.forEach((l, i) => { if (Math.abs(l.x - x) < Math.abs(lines[k].x - x)) k = i; }); return k; };
  /* the top of the Bracing page: drop the bracing files, see what each will get, download — one row a building */
  function renderBraceTop() {
    const top = $('#braceTop');
    if (!top) return;
    const sj = state.job && state.job.seismic, J = state.snowJob;
    if (!state.pcs || !J || !J.site.buildings.length) { top.innerHTML = '<small class="sub-n">Load a PCS first.</small>'; return; }
    const rows = J.site.buildings.map(b => {
      const bS = sb(b.name), bf = bS && (state.bracing || {})[bS.bkey], plan = bf && bS && sj && sj.ok ? bracingPlan(bS) : null;
      const cnt = plan ? plan.loads.length : 0, st = plan && state.seis.strutLine !== false ? plan.struts.length : 0;
      const what = !bf ? '' : !sj || !sj.ok ? 'the loads come once the Seismic calc is complete' : cnt ? `${cnt} Mezz. Seismic load${cnt > 1 ? 's' : ''} (EQB / EQF)${st ? ` · ${st} strut line${st > 1 ? 's' : ''}` : ''}` : 'no mezzanine on it — nothing for the tool to add';
      const sides = bf ? ['FSW', 'BSW'].filter(w => bf.file.info.walls[w]).map(w => `${w} ${bf.file.info.walls[w].bays.filter(x => x.braced).map(x => x.from + 1).join(', ') || '—'}`).join(' · ') : '';
      return `<div class="bt-row ${bf ? 'has-file' : ''}"><div class="bt-b"><b>${esc(b.name)}</b><small>${ft(b.g.width)} × ${ft(b.g.length)}</small></div>
        <div class="bt-f">${bf ? `<b class="mono" title="${esc(bf.name)}">${esc(bf.name)}</b><small>braced bays ${esc(sides)} · ${esc(what)}</small>` : `<small class="sub-n">no bracing file — the walls below are drawn from ${bracingOf(b.name).src || 'nothing yet'}</small>`}</div>
        <div class="bt-a">${bf ? `<button class="btn-soft sm" data-brdl2="${esc(bS.bkey)}" ${cnt ? '' : 'disabled'}><svg><use href="#i-file"/></svg>Download ${esc(C.bracingOutName ? C.bracingOutName(bf) : bf.name)}</button><button class="btn-ghost sm" data-brrm2="${esc(bS.bkey)}">Remove</button>` : ''}</div></div>`;
    }).join('');
    top.innerHTML = `<label class="fv-drop wide bt-drop"><input type="file" accept=".bracing,.nbgscope" multiple id="braceDrop"><svg><use href="#i-file"/></svg><span><b>Drop the .bracing files</b><small>each is matched to its building by size; the eScope (.nbgscope) is taken too</small></span></label><div class="bt-list">${rows}</div>`;
    const inp = $('#braceDrop'), lab = inp && inp.closest('.fv-drop');
    if (lab) { ['dragenter', 'dragover'].forEach(ev => lab.addEventListener(ev, () => lab.classList.add('is-over'))); ['dragleave', 'drop'].forEach(ev => lab.addEventListener(ev, () => lab.classList.remove('is-over'))); }
    if (inp) inp.onchange = () => { const list = Array.from(inp.files || []).filter(x => /\.(bracing|nbgscope)$/i.test(x.name)); if (!list.length) { toast('Drop .bracing or .nbgscope files'); return; } addSeisFiles(list); };
    $$('#braceTop [data-brdl2]').forEach(btn => { btn.onclick = () => C.bracingDownload && C.bracingDownload(btn.dataset.brdl2); });
    $$('#braceTop [data-brrm2]').forEach(btn => { btn.onclick = () => { delete state.bracing[btn.dataset.brrm2]; recompute(); }; });
  }
  const tierKey = (bkey, w, from) => `${bkey}|${w}|${from}`;
  // what can brace a mezzanine edge off the walls, as picked on its line
  const NEW_KINDS = [['x', 'X-bracing', 'X-bracing to the floor'], ['portal', 'Portal frame', 'a portal frame — its legs and beam take the place of the mezzanine columns and beam in that bay'], ['knee', 'Knee braces', 'knee braces from the columns to the mezzanine beam'], ['other', 'Other', 'your own solution (note it below)']];
  const kindText = k => (NEW_KINDS.find(q => q[0] === k) || NEW_KINDS[0])[2];
  // a sidewall bay as you set it on the Bracing page: none → X-bracing → portal frame
  const BAY_CYCLE = ['none', 'x', 'portal'];

  /* every bracing line of one building, with what it takes and what braces it: the two sidewalls (their bays from the
     bracing file, the eScope or PCS Box 12; the mezzanine's EQB / EQF; the strut line; the bays that can be tiered at
     the mezzanine level), each mezzanine edge off the walls (a bracing wall to create in NBG Bracing: its run, the
     columns on it, the bay picked for its bracing) and the two endwalls */
  function braceModel(b, letters) {
    const sj = state.job && state.job.seismic, live = !!(sj && sj.ok), bS = sb(b.name), bf = bS && (state.bracing || {})[bS.bkey], cfg = state.seis || {};
    const g = b.g, L = g.length, W = g.width, br = bracingOf(b.name), fls = B.frameLines(b);
    const lines = bf ? bf.file.info.lines.map(l => ({ no: l.index + 1, x: l.x })) : b.xs.map((x, i) => ({ no: i + 1, x }));
    const mz = mezzBoxes().filter(q => sameName(q.building, b.name)), lt = (letters.get(b.name) || { lab: new Map() }).lab;
    const letter = y => { for (const [v, t] of lt) if (Math.abs(v - y) < 0.3) return t; return null; };
    const edges = live && bS ? bS.braceLines.map(l => ({ y: l.y, segs: l.segs, at: l.at, mezz: l.mezz, F: l.F, design: l.design, governs: l.governs, stab: l.stab, wall: l.wall, by: l.by }))
      : window.MZ_RUN.mezzEdges(mz, W).map(e => ({ ...e, F: null, design: null }));
    const plan = bf && bS && live ? bracingPlan(bS) : null, M = { b, bS, bf, br, lines, fls, mz, live, plan, list: [], letter };
    // ---- the sidewalls ----
    ['FSW', 'BSW'].forEach(w => {
      const e = edges.find(q => q.wall === w) || null, wi = bf && bf.file.info.walls[w], bw = br.walls[w];
      // the file's rods, and PCS Box 12's portal frames in bays the file leaves bare (portal frames are not rods)
      const bays = wi ? wi.bays.map(x => { const pf = !x.braced && bw.bays.find(q => q.kind === 'portal' && q.from === x.from); return pf ? { ...x, braced: true, kind: 'portal', src: 'PCS' } : { ...x, kind: x.portal ? 'portal' : 'x' }; })
        : lines.slice(0, -1).map((l, i) => { const bb = bw.bays.find(q => q.from === i); return { from: i, to: i + 1, braced: !!bb, kind: bb ? bb.kind : 'x', braces: bb && bb.tiers.length ? bb.tiers.map(([bottom, top]) => ({ bottom, top })) : [], struts: [] }; });
      // the bays you set on this wall (none / X-bracing / portal frame), over what the file, the eScope or the PCS has
      const ovKey = `${bS ? bS.bkey : b.name}|${w}`, ov = (cfg.wallBays || {})[ovKey] || {};
      bays.forEach(x => {
        const v = ov[x.from];
        x.base = x.braced ? x.kind : 'none';
        if (v == null || v === x.base) return;
        x.mine = true; x.braced = v !== 'none';
        if (x.braced) { x.kind = v; x.braces = []; x.src = 'yours'; }
      });
      let loads = [], struts = [];
      if (plan) {
        loads = plan.loads.filter(l => l.wall === w).map(l => ({ line: l.line + 1, elev: l.elev, F: l.F, caseId: l.caseId }));
        struts = plan.struts.filter(s => s.wall === w).map(s => ({ ...s }));
      } else if (e) {
        // EQB at the frame line nearest the run's start, EQF at its end; the strut line along the run, on to the braced
        // bay nearest it when none is inside
        let i0 = nearestLine(lines, Math.min(...e.segs.map(s => s[0]))), i1 = nearestLine(lines, Math.max(...e.segs.map(s => s[1])));
        if (i0 === i1) { if (i1 + 1 < lines.length) i1++; else if (i0 > 0) i0--; }
        loads = [{ line: i0 + 1, elev: e.at, F: e.F, caseId: 'EQB' }, { line: i1 + 1, elev: e.at, F: e.F == null ? null : -e.F, caseId: 'EQF' }];
        let from = i0, to = i1;
        if (!bays.some(x => x.braced && x.from >= i0 && x.to <= i1)) {
          const near = bays.filter(x => x.braced).sort((p, q) => Math.min(Math.abs(p.from - i0), Math.abs(p.to - i1)) - Math.min(Math.abs(q.from - i0), Math.abs(q.to - i1)))[0];
          if (near) { from = Math.min(from, near.from); to = Math.max(to, near.to); }
        }
        struts = [{ wall: w, from, to, elev: e.at }];
      }
      if (cfg.strutLine === false) struts = [];
      // a braced X bay the strut line runs through is tiered at its level unless that is switched off (the file's own
      // tiers stay as they are)
      bays.forEach(x => {
        const st = struts.find(s => x.from >= Math.min(s.from, s.to) && x.to <= Math.max(s.from, s.to));
        if (!st || !x.braced || x.kind === 'portal' || (x.braces && x.braces.length > 1)) return;
        x.tierable = true; x.tkey = tierKey(bS ? bS.bkey : b.name, w, x.from); x.tier = (cfg.tiers || {})[x.tkey] === false ? null : st.elev;
      });
      struts.forEach(s => { s.skip = bays.filter(x => x.tierable && x.tier == null && x.from >= Math.min(s.from, s.to) && x.to <= Math.max(s.from, s.to)).map(x => x.from); });
      const onWall = mz.filter(q => (w === 'FSW' ? q.y0 < 0.6 : q.y1 > W - 0.6));
      const lineX = no => (lines.find(l => l.no === no) || {}).x;
      M.list.push({ key: `${b.name}|${w}`, kind: 'side', wall: w, label: w, letter: letter(w === 'FSW' ? 0 : W), edge: e, F: e ? e.F : null, bays, loads, struts, onWall, bw, wi, ovKey,
        wallTag: e ? `${w} · ${e.F != null ? F2(e.F) + ' k' : 'mezzanine'}` : null, planLoads: loads.map(q => ({ u: lineX(q.line), caseId: q.caseId, F: q.F })).filter(q => q.u != null) });
    });
    // ---- each mezzanine edge off the walls: a bracing wall of its own ----
    edges.filter(e => !e.wall).forEach(e => {
      const key = `${b.name}|y${e.y.toFixed(2)}`, ltr = letter(e.y), cols = [];
      const addC = (u, kind) => { if (!cols.some(c => Math.abs(c.u - u) < 0.3)) cols.push({ u, kind }); };
      fls.forEach(fl => { if (fl.cols.some(c => Math.abs(c - e.y) < 0.5)) addC(fl.x, 'frame'); else if (fl.posts.some(c => Math.abs(c - e.y) < 0.5)) addC(fl.x, 'post'); });
      mz.forEach(m => (m.cols || []).forEach(c => { if (Math.abs(c.y - e.y) < 0.5) addC(c.x, 'mezz'); }));
      cols.sort((p, q) => p.u - q.u);
      const bays = [];
      cols.forEach((c, i) => { const n = cols[i + 1]; if (n && e.segs.some(([a, z]) => c.u >= a - 0.6 && n.u <= z + 0.6)) bays.push({ i: +c.u.toFixed(2), u0: c.u, u1: n.u }); });
      const r0 = Math.min(...e.segs.map(s => s[0])), r1 = Math.max(...e.segs.map(s => s[1])), mid = (r0 + r1) / 2, want = (cfg.newLines || {})[key] || {};
      const fit = q => (q.u1 - q.u0 >= 10 && q.u1 - q.u0 <= 32 ? 0 : 1);
      const dflt = bays.slice().sort((p, q) => fit(p) - fit(q) || Math.abs((p.u0 + p.u1) / 2 - mid) - Math.abs((q.u0 + q.u1) / 2 - mid))[0] || null;
      const bay = (want.bay != null && bays.find(q => Math.abs(q.i - want.bay) < 0.01)) || dflt, kind = NEW_KINDS.some(q => q[0] === want.kind) ? want.kind : 'x';
      const name = ltr ? `line ${ltr}` : `${ft(e.y)} from the FSW`;
      M.list.push({ key, kind: 'new', y: e.y, segs: e.segs, label: name, letter: ltr, edge: e, F: e.design, cols, bays, bay, pickKind: kind, note: want.note || '', chosen: !!(want.bay != null && bay && Math.abs(bay.i - want.bay) < 0.01), run: [r0, r1],
        tag: `${name} · ${e.design != null ? F2(e.design) + ' k' : 'mezzanine edge'} · new wall`, pick: bay ? { u0: bay.u0, u1: bay.u1, kind } : null, loads: [{ u: r0, caseId: 'EQB', F: e.design }, { u: r1, caseId: 'EQF', F: e.design == null ? null : -e.design }] });
    });
    // ---- the endwalls ----
    ['LEW', 'REW'].forEach(w => M.list.push({ key: `${b.name}|${w}`, kind: 'end', wall: w, label: w, bw: br.walls[w] }));
    return M;
  }
  // ---- the bracing file: what its last design found on a wall, and what the tool writes against what it holds ----
  const LOAD_NAME = 'Mezz. Seismic';
  const memberName = m => String(m || '—').replace(/^(\d+(?:\/\d+)?)_ROD$/i, '$1" rod').replace(/_/g, ' ');
  const comboText = (bf, n) => { const c = n == null ? null : (bf.file.info.combos || [])[n]; return c ? c.text : n == null ? '—' : `combination ${n + 1}`; };
  const ratioCell = (a, cap) => (cap > 0 ? `<td class="num mono ${a / cap > 1 + 1e-9 ? 'r-bad' : a / cap > 0.9 ? 'r-warn' : ''}"><b>${F2(a / cap)}</b></td>` : '<td class="num mono"><small class="sub-n">not checked</small></td>');
  const lineNo = (bf, i) => { const l = bf.file.info.lines.find(q => q.index === i); return l ? l.name : String(i + 1); };
  // a portal frame's largest sway reaction and drift over the combinations, and the capacity its ID names (…H5K: 5 k)
  function portalOf(p) {
    const n = Math.max(p.H1.length, p.H2.length), H = i => Math.max(Math.abs(p.H1[i] || 0), Math.abs(p.H2[i] || 0));
    let iH = 0, iD = 0;
    for (let i = 1; i < n; i++) { if (H(i) > H(iH)) iH = i; if ((p.delta[i] || 0) > (p.delta[iD] || 0)) iD = i; }
    const cap = +((String(p.id || '').match(/H([\d.]+)K$/i) || [])[1]) || null;
    return { H: n ? H(iH) : null, comboH: iH, drift: p.delta.length ? p.delta[iD] : null, comboD: iD, cap };
  }
  // the members of one wall as the file's last design left them: rods tier by tier, portal frames, struts by height
  function wallResults(bf, w, mezzAt) {
    const I = bf.file.info, wl = I.walls[w];
    if (!wl) return '';
    const rows = [];
    wl.bays.filter(x => x.braced).forEach(x => {
      const bay = `${lineNo(bf, x.from)}–${lineNo(bf, x.to)}`;
      if (x.portal) {
        const q = portalOf(x.portal), hgt = x.portal.height;
        rows.push(`<tr><td class="mono"><b>${bay}</b></td><td>Portal frame <span class="mono">${esc(x.portal.id || '')}</span><small class="sub-n">${ft(hgt)} high${x.portal.grid ? ` · line ${esc(x.portal.grid)}` : ''}</small></td><td class="mono">0'-0" – ${ft(hgt)}</td>
          <td class="num mono">H ${q.H != null ? F2(q.H) : '—'}${q.cap ? ` / ${F2(q.cap)}` : ''}<small class="sub-n">drift ${q.drift != null ? `${F2(q.drift)} in${hgt ? ` · h/${Math.round(hgt * 12 / q.drift)}` : ''}` : '—'}</small></td>${q.cap ? ratioCell(q.H, q.cap) : '<td class="num mono">—</td>'}<td><small>${esc(comboText(bf, q.comboH))}</small></td></tr>`);
        return;
      }
      const tiers = new Map();
      x.braces.forEach(r => { const k = `${r.bottom}|${r.top}`, t = tiers.get(k) || { bottom: r.bottom, top: r.top, rods: [] }; t.rods.push(r); tiers.set(k, t); });
      [...tiers.values()].sort((a, c) => a.bottom - c.bottom).forEach(t => {
        const g = t.rods.reduce((a, r) => (r.axial > a.axial ? r : a), t.rods[0]), cap = Math.min(...t.rods.map(r => r.allowed).filter(v => v > 0));
        rows.push(`<tr><td class="mono"><b>${bay}</b></td><td>${esc([...new Set(t.rods.map(r => memberName(r.member)))].join(' / '))} X<small class="sub-n">${esc([...new Set(t.rods.map(r => r.id).filter(Boolean))].join(', '))}</small></td><td class="mono">${ft(t.bottom)} – ${ft(t.top)}${tiers.size > 1 ? ' <small class="sub-n">tier</small>' : ''}</td>
          <td class="num mono">${F2(g.axial)}${isFinite(cap) ? ` / ${F2(cap)}` : ''}</td>${ratioCell(g.axial, isFinite(cap) ? cap : 0)}<td><small>${esc(comboText(bf, g.combo))}</small></td></tr>`);
      });
    });
    // struts: one row a height along the wall — the largest force and the bay it is in
    const byZ = new Map();
    wl.bays.forEach(x => x.struts.forEach(t => { const k = (+t.elev).toFixed(2), o = byZ.get(k) || { elev: t.elev, max: null, ids: new Set(), n: 0, real: 0 }; o.n++; if (t.real) o.real++; if (t.id) o.ids.add(t.id); if (!o.max || t.axial > o.max.axial) o.max = { ...t, bay: `${lineNo(bf, x.from)}–${lineNo(bf, x.to)}` }; byZ.set(k, o); }));
    const st = [...byZ.values()].sort((a, c) => c.elev - a.elev).map(o => {
      const m = o.max, atMz = mezzAt != null && Math.abs(o.elev - mezzAt) < 0.05, unchecked = !(m.allowed > 0) && m.axial > 0.005;
      return `<tr class="${atMz ? 'is-mz' : ''}"><td class="mono"><b>${ft(o.elev)}</b>${atMz ? ' <small class="src src-ok">mezzanine</small>' : ''}</td><td><span class="mono">${esc([...o.ids].join(', ') || '—')}</span><small class="sub-n">${o.n} bay${o.n > 1 ? 's' : ''}${o.real ? ` · ${o.real} added as wall strut${o.real > 1 ? 's' : ''}` : ''}</small></td><td class="mono">${esc(m.bay)}</td>
        <td class="num mono">${F2(m.axial)}${m.allowed > 0 ? ` / ${F2(m.allowed)}` : ''}</td>${unchecked ? '<td class="num mono"><small class="src src-bad">not checked</small></td>' : ratioCell(m.axial, m.allowed)}<td><small>${esc(comboText(bf, m.combo))}</small></td></tr>`;
    });
    const mz = I.loads.some(r => r.name === LOAD_NAME), status = I.status;
    return `<div class="bl-res"><div class="bl-res-h"><h5>${esc(bf.name)} · as last designed</h5><small class="sub-n">${status ? (status.designed ? 'designed' : status.solved ? 'solved, not designed' : 'not solved') : ''}${mz ? ' · with its Mezz. Seismic rows' : ' · without mezzanine loads — design it again in NBG Bracing once the download is opened'}</small></div>
      ${rows.length ? `<div class="table-wrap"><table class="fl-t bl-res-t"><thead><tr><th>Bay</th><th>Member</th><th>Height</th><th class="num">Force / allowed (k)</th><th class="num">Ratio</th><th>Governing combination</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<div class="seis-msg warn">No braced bay on this wall in the file.</div>'}
      ${st.length ? `<div class="table-wrap"><table class="fl-t bl-res-t"><thead><tr><th>Strut line</th><th>Member</th><th>Largest in bay</th><th class="num">Force / allowed (k)</th><th class="num">Ratio</th><th>Governing combination</th></tr></thead><tbody>${st.join('')}</tbody></table></div>` : ''}</div>`;
  }
  /* the bracing file against the job: its building, frame lines, roof loads and seismic against the PCS and the Seismic
     calc, each member over its allowable, and a strut at the mezzanine level NBG Bracing does not check (a girt or the
     mezzanine's edge beam: DM 15.1 — a mezzanine beam in a bracing system is designed for the axial with its bending) */
  function fileChecks(M) {
    const { b, bS, bf } = M, out = [];
    if (!bf) return out;
    const I = bf.file.info, g = b.g, pre = `${bf.name}: `, near = (a, c, t) => a != null && c != null && Math.abs(a - c) <= t;
    if (!near(I.width, g.width, 0.05) || !near(I.length, g.length, 0.05)) out.push({ level: 'warn', text: `${pre}${ft(I.width)} × ${ft(I.length)} — the PCS has ${ft(g.width)} × ${ft(g.length)}.` });
    if (!near(I.eaveFSW, g.eaveFSW, 0.05) || !near(I.eaveBSW, g.eaveBSW, 0.05)) out.push({ level: 'warn', text: `${pre}eaves FSW ${ft(I.eaveFSW)} / BSW ${ft(I.eaveBSW)} — the PCS has ${ft(g.eaveFSW)} / ${ft(g.eaveBSW)}.` });
    const xs = b.xs || [];
    if (xs.length && (I.lines.length !== xs.length || I.lines.some((l, i) => !near(l.x, xs[i], 0.1)))) out.push({ level: 'warn', text: `${pre}frame lines at ${I.lines.map(l => ft(l.x)).join(', ')} — the PCS has ${xs.map(ft).join(', ')}.` });
    const sjI = state.job && state.job.seismic && state.job.seismic.inputs, u = bS && bS.long && bS.long.bracing, z = I.seismic;
    if (bS && bS.roof) {
      const R = bS.roof;
      if (I.roofDead != null && R.RDL.value != null && !near(I.roofDead, R.RDL.value, 0.01)) out.push({ level: 'info', text: `${pre}roof dead ${F2(I.roofDead)} psf — the seismic takes ${F2(R.RDL.value)} psf (${R.RDL.source}).` });
      if (I.collateral != null && R.CDL.value != null && !near(I.collateral, R.CDL.value, 0.01)) out.push({ level: 'info', text: `${pre}collateral ${F2(I.collateral)} psf — the seismic takes ${F2(R.CDL.value)} psf (${R.CDL.source}).` });
    }
    if (z && sjI) {
      const pairs = [['Ss', z.Ss, sjI.Ss && sjI.Ss.value, 0.0005], ['S1', z.S1, sjI.S1 && sjI.S1.value, 0.0005]].filter(([, a, c, t]) => a != null && c != null && !near(a, c, t));
      if (pairs.length || (z.siteClass && sjI.siteClass && z.siteClass !== sjI.siteClass.value)) out.push({ level: 'warn', text: `${pre}${[...pairs.map(([k, a, c]) => `${k} ${F3(a)} (the calc ${F3(c)})`), z.siteClass && sjI.siteClass && z.siteClass !== sjI.siteClass.value ? `site class ${z.siteClass} (the calc ${sjI.siteClass.value})` : ''].filter(Boolean).join(' · ')}.` });
    }
    if (z && u) {
      if (z.factor != null && !near(z.factor, u.factor, 0.0005)) out.push({ level: 'info', text: `${pre}roof seismic factor ${F3(z.factor)} with R ${z.R} — the Seismic calc's longitudinal works ${F3(u.factor)} with R ${+bS.long.R.toFixed(2)} (${bS.long.sys.label}); NBG Bracing designs with its own.` });
      if (z.roofTotal != null && !near(z.roofTotal, u.totalPsf, 0.05)) out.push({ level: 'info', text: `${pre}roof total seismic ${F2(z.roofTotal)} psf — the Seismic calc's ${F2(u.totalPsf)} psf.` });
    }
    ['FSW', 'BSW'].forEach(w => {
      const wl = I.walls[w];
      if (!wl) return;
      wl.bays.forEach(x => {
        const bay = `${lineNo(bf, x.from)}–${lineNo(bf, x.to)}`;
        x.braces.filter(r => r.allowed > 0 && r.axial > r.allowed * (1 + 1e-9)).forEach(r => out.push({ level: 'stop', text: `${pre}${w} bay ${bay}: ${memberName(r.member)} ${ft(r.bottom)}–${ft(r.top)} at ${F2(r.axial)} k over its ${F2(r.allowed)} k (${comboText(bf, r.combo)}).` }));
        if (x.portal) { const q = portalOf(x.portal); if (q.cap && q.H > q.cap) out.push({ level: 'stop', text: `${pre}${w} bay ${bay}: portal frame ${x.portal.id} sways ${F2(q.H)} k over its ${F2(q.cap)} k.` }); }
      });
      // the strut at each mezzanine level: its force, and whether the program checks it
      M.mz.filter(m => (w === 'FSW' ? m.y0 < 0.6 : m.y1 > g.width - 0.6)).map(m => m.A).filter((v, i, a) => a.indexOf(v) === i).forEach(A => {
        const at = wl.bays.flatMap(x => x.struts.filter(t => Math.abs(t.elev - A) < 0.05).map(t => ({ ...t, bay: `${lineNo(bf, x.from)}–${lineNo(bf, x.to)}` })));
        const big = at.reduce((a, t) => (!a || t.axial > a.axial ? t : a), null);
        if (!at.length) out.push({ level: 'warn', text: `${pre}${w}: no strut at the mezzanine level (${ft(A)}) yet — the download adds the wall strut line, and NBG Bracing tiers the braced bay there.` });
        else if (big && big.axial > 0.005 && !(big.allowed > 0)) out.push({ level: 'warn', text: `${pre}${w}: the strut at the mezzanine level (${ft(A)}) is ${big.id || 'a girt'} carrying ${F2(big.axial)} k in bay ${big.bay} (${comboText(bf, big.combo)}) — NBG Bracing does not check it: the mezzanine's edge beam (or that girt) takes this axial with its bending (DM 15.1).` });
      });
    });
    if (I.cost && I.cost.totalWeight > 0) out.push({ level: 'info', text: `${pre}bracing ${n0(I.cost.totalWeight)} lb${I.cost.totalCost ? ` · $${n0(I.cost.totalCost)}` : ''} (rods ${n0(I.cost.rodWeight)} · struts ${n0(I.cost.strutWeight)}${I.cost.portalWeight ? ` · portal frames ${n0(I.cost.portalWeight)}` : ''} lb), as last designed.` });
    else if (I.cost && I.cost.portalWeight > 0) out.push({ level: 'info', text: `${pre}portal frames ${n0(I.cost.portalWeight)} lb${I.cost.portalCost ? ` · $${n0(I.cost.portalCost)}` : ''}, as last designed.` });
    return out;
  }

  // a portal frame's legs on a mezzanine line: the mezzanine columns they replace, with the beam reactions they take
  function portalLegsText(l) {
    const pl = (state.job && state.job.portalLoads) || [], at = u => pl.find(q => Math.abs(q.x - u) < 0.5 && Math.abs(q.y - l.y) < 0.5);
    return [l.bay.u0, l.bay.u1].map(u => { const q = at(u); const fr = l.cols.some(c => Math.abs(c.u - u) < 0.3 && (c.kind === 'frame' || c.kind === 'post'));
      return q ? `${esc(q.label)} at ${ft(u)}: replaces the mezzanine column — D ${F2(q.D)} k · L ${F2(q.L)} k <small class="sub-n">(${esc(q.parts.map(p => p.beam).join(' + ') || 'joists')}), for the portal frame in NBG Bracing</small>` : fr ? `${ft(u)}: a building column — it stays; the portal frame's leg stands beside it` : `${ft(u)} <small class="sub-n">waiting on the mezzanine design</small>`; }).join(' · ');
  }
  // where along a building a point of a line sits: on a frame line, else its distance from the LEW
  const atLine = (lines, u) => { const l = lines.find(q => Math.abs(q.x - u) < 0.6); return l ? `frame line ${l.no}` : `${ft(u)} from the LEW`; };

  // the selected line, drawn, with what can be changed on it and what goes into NBG Bracing
  function lineView(M, l) {
    const { b, bf, lines, fls } = M, g = b.g, L = g.length, W = g.width, many = state.snowJob.site.buildings.length > 1, pre = many ? b.name + ' · ' : '';
    if (l.kind === 'side') {
      const e = l.edge, bw = l.bw, wi = l.wi;
      const note = `${bw.type || (wi ? 'bracing file' : 'no bracing listed')}${bw.bays.length && bw.kind !== 'roofx' ? ` · bay${bw.bays.length > 1 ? 's' : ''} ${bw.bays.map(q => q.from + 1).join(', ')}` : bw.open ? ` · bays ${bw.open}` : ''}`;
      const svg = B.wallSvg({ name: b.name, wall: l.wall, length: L, eave: l.wall === 'FSW' ? g.eaveFSW : g.eaveBSW, lines, bays: l.bays, loads: l.loads, mezz: l.onWall.map(q => ({ x0: q.x0, x1: q.x1, A: q.A, id: q.id })), strutsPlanned: l.struts,
        src: bf ? (l.bays.some(x => x.src === 'PCS') ? 'the bracing file + PCS Box 12 (portal frames)' : 'the bracing file') : bw.bays.some(q => q.src === 'eScope') ? 'the eScope' : bw.bays.length ? 'PCS Box 12' : null, note });
      // every bay of the wall, to brace as you want: none → X-bracing → portal frame
      const bayCtl = `<div class="bl-ctl bl-bays"><span class="bl-ctl-l">Bracing by bay</span>${l.bays.map(x => `<button class="bl-bay is-${x.braced ? x.kind : 'none'}${x.mine ? ' is-mine' : ''}" data-wbay="${x.from}" aria-label="Bay ${x.from + 1}–${x.to + 1}: ${x.braced ? (x.kind === 'portal' ? 'portal frame' : 'X-bracing') : 'not braced'}"><b>${x.from + 1}–${x.to + 1}</b><small>${x.braced ? (x.kind === 'portal' ? 'portal' : 'X') : '—'}</small></button>`).join('')}${l.bays.some(x => x.mine) ? '<button class="btn-ghost sm" data-wbayreset="1">Back to the file / PCS</button>' : ''}<small class="sub-n">Click a bay to brace it: none → X-bracing → portal frame. Yours are outlined${bf ? ' — the download writes loads and strut lines, not rods or portal frames: add the bays you changed in NBG Bracing' : ''}.</small></div>`;
      const tb = l.bays.filter(x => x.tierable);
      const ctl = tb.length ? `<div class="bl-ctl"><span class="bl-ctl-l">Tier at the mezzanine level</span>${tb.map(x => `<button class="bl-tog${x.tier != null ? ' is-on' : ''}" data-tier="${esc(x.tkey)}" aria-pressed="${x.tier != null}"><i></i>Bay ${x.from + 1}–${x.to + 1}</button>`).join('')}<small class="sub-n">On: the X splits at ${ft(l.struts[0] ? l.struts[0].elev : 0)} where the strut line crosses it${bf ? ' (the strut goes into the file in that bay)' : ''}. Off: the X runs to the eave and the strut line stops at the bay.</small></div>` : '';
      const n = (q, i) => `${q.caseId} ${q.F == null ? '(waiting on Seismic)' : `${q.F >= 0 ? '+' : '−'}${F2(Math.abs(q.F))} k`} at frame line ${q.line}`;
      // the mezzanine's force on this wall: half of each floor that bears on it (from the panel above)
      const of = e && e.by && e.by.length ? e.by.map(q => `half of ${mezzName(q.id)}'s ${F2(q.total)} k${q.via ? ` (through ${mezzName(q.via)})` : ''}`).join(' + ') : '';
      const rows = e ? [
        ['Force', e.F != null ? `<b>${F2(e.F)} k</b> <small class="sub-n">${of ? esc(of) + ' — ' : ''}the mezzanine's longitudinal seismic on this wall, in EQB and in EQF</small>` : '<small class="sub-n">once the Seismic calc is complete</small>'],
        ['Add Loads', `${l.loads.map(n).join(' · ')} — at ${ft(e.at)}, X - Longitudinal${bf ? ` <small class="sub-n">(Wall ${bf.file.info.walls[l.wall] ? bf.file.info.walls[l.wall].plane + 1 : '?'} in ${esc(bf.name)})</small>` : ''}`],
        ['Add Wall Strut Line', l.struts.length ? l.struts.map(s => `frame line ${s.from + 1} to ${s.to + 1} at ${ft(s.elev)}${s.skip && s.skip.length ? ` <small class="sub-n">— not through bay${s.skip.length > 1 ? 's' : ''} ${s.skip.map(k => `${k + 1}–${k + 2}`).join(', ')} (untiered)</small>` : ''}`).join(' · ') : '<small class="sub-n">off (Seismic calc step 9)</small>'],
      ] : [['Mezzanine', 'none on this wall — it takes the building\'s own longitudinal seismic, as NBG Bracing designs it']];
      const res = bf ? wallResults(bf, l.wall, e ? e.at : null) : '';
      return `<div class="bl-head"><h4>${esc(pre)}${l.wall}${l.letter ? ` <span class="bl-gl">line ${esc(l.letter)}</span>` : ''}</h4><small class="sub-n">eave ${ft(l.wall === 'FSW' ? g.eaveFSW : g.eaveBSW)} · ${esc(note)}</small></div><div class="wall-card">${svg}</div>${bayCtl}${ctl}<dl class="bl-nbg">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${res}`;
    }
    if (l.kind === 'new') {
      const e = l.edge, A = e.at, top = u => SITE.roofZ(g, u, l.y), lbl = `${e.mezz.map(mezzName).join(' + ')} · ${ft(A)}`;
      const svg = B.lineSvg({ title: `${pre}${l.label} · ${ft(l.y)} from the FSW · a bracing wall to create`, note: e.design != null ? `${F2(e.design)} k · ${e.governs}` : 'force once the Seismic calc is complete', length: L, top,
        cols: l.cols, bubbles: lines.map(q => ({ u: q.x, text: q.no })), mezz: e.segs.map(([u0, u1]) => ({ u0, u1, A, label: lbl })), run: e.segs, bays: l.bays, pick: { i: l.bay ? l.bay.i : null, kind: l.pickKind, A, note: l.note },
        loads: [{ u: l.run[0], elev: A, F: e.design, caseId: 'EQB' }, { u: l.run[1], elev: A, F: e.design == null ? null : -e.design, caseId: 'EQF' }] });
      const kindOf = c => (c.kind === 'frame' ? 'frame column' : c.kind === 'post' ? 'endwall column' : 'mezzanine column');
      const ctl = l.bays.length ? `<div class="bl-ctl"><span class="bl-ctl-l">Braced bay</span>${l.bays.map(q => `<button class="bl-tog${l.bay && q.i === l.bay.i ? ' is-on' : ''}" data-nbay="${esc(l.key)}|${q.i}" aria-pressed="${!!(l.bay && q.i === l.bay.i)}"><i></i>${ft(q.u0)} – ${ft(q.u1)}</button>`).join('')}<span class="bl-sep"></span><span class="bl-ctl-l">As</span>${NEW_KINDS.map(([k, t]) => `<button class="bl-tog${l.pickKind === k ? ' is-on' : ''}" data-nkind="${esc(l.key)}|${k}" aria-pressed="${l.pickKind === k}"><i></i>${t}</button>`).join('')}${l.pickKind === 'other' ? `<input class="bl-note" data-nnote="${esc(l.key)}" placeholder="Your solution — e.g. tie to the portal frame on line D" value="${esc(l.note)}">` : ''}<small class="sub-n">${l.chosen ? 'Your pick' : 'Proposed: the bay of 10–32 ft nearest the middle of the run'} — click a bay here or on the drawing.${l.pickKind === 'portal' ? ' The portal frame\'s legs take the place of the mezzanine columns at its ends (and its beam of a mezzanine beam in that bay): the mezzanine design follows.' : ''}</small></div>`
        : `<div class="seis-msg warn">No two columns stand on ${esc(l.label)} inside the run — a braced bay needs a column at each end: add mezzanine columns on this line (Plan page), or carry the edge to the next line that has them.</div>`;
      const rows = [
        ['Where', `${esc(l.label)} — ${ft(l.y)} from the FSW, ${ft(W - l.y)} from the BSW; the edge of ${esc(e.mezz.map(mezzName).join(' + '))} at ${ft(A)}`],
        ['Run', `${e.segs.map(([a, z]) => `${atLine(lines, a)} to ${atLine(lines, z)}`).join(', ')} (${ft(l.run[1] - l.run[0])})`],
        ['Force', e.design != null ? `<b>${F2(e.design)} k</b> <small class="sub-n">${e.stab != null ? `the larger of the seismic ${F2(e.F)} k and DM 15.1.3's 1 % of FDL + FLL ${F2(e.stab)} k` : esc(e.governs)}</small>` : '<small class="sub-n">once the Seismic calc is complete</small>'],
        ['Columns on it', l.cols.length ? l.cols.map(c => `${ft(c.u)} <small class="sub-n">${kindOf(c)}</small>`).join(' · ') : 'none'],
        ['Bracing', l.bay ? `${l.pickKind === 'other' ? (l.note ? esc(l.note) : 'your own solution') : esc(kindText(l.pickKind))} — from the floor to ${ft(A)} between ${ft(l.bay.u0)} and ${ft(l.bay.u1)} (${atLine(lines, l.bay.u0)} – ${atLine(lines, l.bay.u1)})` : '—'],
        ...(l.pickKind === 'portal' && l.bay ? [['Portal legs', portalLegsText(l)]] : []),
        ['Loads', `EQB ${e.design != null ? '+' + F2(e.design) + ' k' : ''} at ${atLine(lines, l.run[0])} · EQF ${e.design != null ? '−' + F2(e.design) + ' k' : ''} at ${atLine(lines, l.run[1])} — at ${ft(A)}, along the line`],
        ['Strut', `the mezzanine's edge beam on ${esc(l.label)} at ${ft(A)}, ${atLine(lines, l.run[0])} to ${atLine(lines, l.run[1])}, carries the load to the braced bay`],
      ];
      return `<div class="bl-head"><h4>${esc(pre)}${esc(l.label)} <span class="bl-new">new bracing wall</span></h4><small class="sub-n">not on a sidewall: the mezzanine's force here needs a wall of its own — create it in NBG Bracing as below (DM 15.1.3)</small></div><div class="wall-card">${svg}</div>${ctl}<dl class="bl-nbg">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    }
    // an endwall
    const bw = l.bw, fl = fls[l.wall === 'LEW' ? 0 : fls.length - 1], xe = l.wall === 'LEW' ? 0 : L, top = u => SITE.roofZ(g, xe, u);
    const cols = [...new Set([0, W, ...(fl ? fl.cols : []), ...(fl ? fl.posts : [])].map(v => +(+v).toFixed(3)))].sort((p, q) => p - q).map(u => ({ u, kind: fl && fl.cols.some(c => Math.abs(c - u) < 0.3) ? 'frame' : 'post' }));
    const braces = bw.kind === 'x' ? bw.bays.map(q => { const u0 = q.ys ? q.ys[0] : (cols[q.from] || {}).u, u1 = q.ys ? q.ys[1] : (cols[q.to] || {}).u; return u0 == null || u1 == null ? null : { u0, u1, z0: 0, z1: Math.min(top(u0), top(u1)) - 0.4, kind: 'x' }; }).filter(Boolean) : [];
    const svg = B.lineSvg({ title: `${pre}${l.wall} · FSW at the left`, note: `${bw.type || 'not listed'}${bw.bays.length && bw.kind === 'x' ? ` · bay${bw.bays.length > 1 ? 's' : ''} ${bw.bays.map(q => q.from + 1).join(', ')}` : bw.open ? ` · bays ${bw.open}` : ''}`, length: W, top, cols, braces,
      bubbles: cols.map(c => ({ u: c.u, text: M.letter(c.u) || ft(c.u) })) });
    return `<div class="bl-head"><h4>${esc(pre)}${l.wall}</h4><small class="sub-n">PCS Box 12: ${esc(bw.type || 'not listed')}${bw.kind === 'roofx' ? ' (drawn in the end bays of the roof)' : ''} · the mezzanine's longitudinal seismic does not come here — the endwall frames take the transverse, as EQR / EQL (Frames page)</small></div><div class="wall-card">${svg}</div>`;
  }

  /* the mezzanine's longitudinal seismic of one building, and where it goes: each mezzanine's force from the Seismic
     calc (its area × its seismic psf), then each mezzanine half to each of its long edges — a mezzanine × line table whose
     rows add up to the mezzanine's force and whose columns are what each line is given, in EQB and in EQF */
  function braceTotalHtml(M, many) {
    const { b, bS } = M, ml = bS && bS.mezzLong;
    if (!M.mz.length) return '';
    const head = many ? `<h4 class="bt-bh">${esc(b.name)}</h4>` : '';
    if (!M.live || !ml) return `${head}<div class="seis-msg info">The mezzanine's longitudinal seismic comes once the <a href="#" data-go="seismic">Seismic calc</a> is complete — ${esc(M.mz.map(m => mezzName(m.id)).join(', '))} on ${esc(b.name)}.</div>`;
    const cols = M.list.filter(l => l.edge && (l.kind === 'new' || l.kind === 'side')).map(l => ({ l, e: l.edge, name: l.kind === 'side' ? l.wall : l.label.replace(/^line /, 'Line ') }))
      .sort((p, q) => p.e.y - q.e.y);
    const cell = (c, id) => { const q = (c.e.by || []).find(x => String(x.id) === String(id)); return q ? q.F : 0; };
    const rows = ml.mezz.map(m => `<tr><td><b>${esc(mezzName(m.id))}</b><small class="sub-n">${n0(m.area)} sq ft · ${F2(m.psf)} psf · at ${ft(m.at)}</small></td><td class="num mono">${n0(m.W)}</td><td class="num mono bt-tot"><b>${F2(m.F)}</b></td>${cols.map(c => { const v = cell(c, m.id), q = (c.e.by || []).find(x => String(x.id) === String(m.id)); return `<td class="num mono ${v > 0.0005 ? '' : 'is-nil'}">${v > 0.0005 ? F2(v) : '—'}${q && q.via ? `<small class="sub-n">through ${esc(mezzName(q.via))}</small>` : ''}</td>`; }).join('')}</tr>`).join('');
    const foot = `<tr><td>Total</td><td class="num mono">${n0(ml.mezz.reduce((a, m) => a + (m.W || 0), 0))}</td><td class="num mono bt-tot"><b>${F2(ml.total)} k</b></td>${cols.map(c => `<td class="num mono ${c.l.kind === 'new' ? 'is-new' : ''}"><b>${F2(c.e.F)} k</b></td>`).join('')}</tr>
      <tr class="bt-eq"><td colspan="3">Into NBG Bracing <small class="sub-n">each line, at the mezzanine level</small></td>${cols.map(c => `<td class="num mono">EQB +${F2(c.e.F)}<br>EQF −${F2(c.e.F)}</td>`).join('')}</tr>`;
    const g = b.g, svg = B.splitSvg({ name: b.name, width: g.width, top: y => SITE.roofZ(g, g.length / 2, y), total: ml.total,
      floors: M.mz.map(m => ({ y0: m.y0, y1: m.y1, A: m.A, id: m.id, F: (ml.mezz.find(q => String(q.id) === String(m.id)) || {}).F, to: cols.filter(c => (c.e.by || []).some(q => String(q.id) === String(m.id))).map(c => c.e.y) })),
      lines: cols.map(c => ({ y: c.e.y, F: c.e.F, at: c.e.at, label: c.name, wall: c.l.wall || null, independent: c.l.kind === 'new' })) });
    const off = cols.filter(c => c.l.kind === 'new');
    return `${head}<div class="table-wrap"><table class="fl-t bt-split"><thead><tr><th>Mezzanine</th><th class="num">Weight (lb)</th><th class="num">Longitudinal seismic (k)</th>${cols.map(c => `<th class="num ${c.l.kind === 'new' ? 'is-new' : ''}">To ${esc(c.name)} (k)${c.l.kind === 'new' ? '<small class="sub-n">new bracing line</small>' : ''}</th>`).join('')}</tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
      <div class="wall-card">${svg}</div>
      <small class="sub-n bt-n">Each mezzanine's force is its weight (area × its seismic psf) through the longitudinal distribution of the Seismic calc (step 9). Each mezzanine sends half to each of its two long edges — a mezzanine between the FSW and the BSW puts half on each wall; an edge joined all along to another mezzanine passes its half through that one to its far edge. Each line gets its part in EQB and again in EQF.${off.length ? ` ${esc(off.map(c => c.name).join(' and '))} ${off.length > 1 ? 'are' : 'is'} not on a sidewall: ${off.length > 1 ? 'each needs' : 'it needs'} a bracing line of its own (pick X-bracing or a portal frame below).` : ''}</small>`;
  }

  function renderBracing() {
    renderBraceTop();
    const box = $('#braceWalls');
    if (!box) return;
    const sj = state.job && state.job.seismic, J = state.snowJob, flagsBox = $('#braceFlags');
    if (!J || !J.site.buildings.length) { box.innerHTML = state.pcs ? '<div class="seis-msg warn">The bracing lines wait for the ground snow load (Snow calc) — the site is laid out with it.</div>' : '<div class="empty">Load a PCS first.</div>'; if (flagsBox) flagsBox.innerHTML = ''; if ($('#braceTotal')) $('#braceTotal').innerHTML = ''; return; }
    const live = !!(sj && sj.ok), many = J.site.buildings.length > 1, GLs = gridLetters(), letters = B.siteLetters(J.site, GLs);
    const models = J.site.buildings.map(b => braceModel(b, letters)), all = models.flatMap(M => M.list.map(l => ({ M, l })));
    // the line picked, else the one that most needs a look: a new bracing wall, then a sidewall taking a mezzanine
    const sel = all.find(q => q.l.key === state.braceSel) || all.find(q => q.l.kind === 'new') || all.find(q => q.l.kind === 'side' && q.l.edge) || all[0];
    const linesOpt = Object.fromEntries(models.map(M => [M.b.name, M.list.map(l => ({ key: l.key, kind: l.kind, wall: l.wall, y: l.y, segs: l.segs, label: l.label, tag: l.tag, wallTag: l.wallTag, pick: l.pick, loads: l.kind === 'side' ? l.planLoads : l.loads }))]));
    const plan = B.planSvg(J, { mezz: mezzBoxes(), bracing: bracingAll(), letters: GLs, lines: linesOpt, lineSel: sel ? sel.l.key : null, noDrift: true });
    const sub = l => {
      if (l.kind === 'new') return `new wall · ${l.F != null ? F2(l.F) + ' k' : 'edge'}`;
      if (l.kind === 'side') { const br = l.bays.filter(x => x.braced); return `${l.F != null ? F2(l.F) + ' k · ' : l.edge ? 'mezzanine · ' : ''}${br.length ? br.map(x => `${x.kind === 'portal' ? 'PF' : 'X'} ${x.from + 1}`).join(', ') : 'no braced bay'}`; }
      return l.bw.kind === 'x' ? `X ${l.bw.bays.map(q => q.from + 1).join(', ') || (l.bw.open || '')}` : l.bw.kind === 'roofx' ? 'roof X' : (l.bw.type || 'none');
    };
    const chips = models.map(M => `<div class="bl-grp">${many ? `<span class="bl-b">${esc(M.b.name)}</span>` : ''}${M.list.map(l => `<button class="bl-chip is-${l.kind}${sel && sel.l.key === l.key ? ' is-sel' : ''}${l.kind === 'new' || (l.kind === 'side' && l.edge) ? ' has-load' : ''}" data-blsel="${esc(l.key)}"><b>${esc(l.kind === 'new' ? l.label.replace(/^line /, 'Line ') : l.label)}${l.kind !== 'new' && l.letter ? ` <span class="bl-gl">${esc(l.letter)}</span>` : ''}</b><small>${esc(sub(l))}</small></button>`).join('')}</div>`).join('');
    box.innerHTML = `<div class="brace-plan" id="bracePlan">${plan}</div><div class="bl-chips">${chips}</div><div class="bl-view" id="braceLine">${sel ? lineView(sel.M, sel.l) : ''}</div>`;
    const tot = $('#braceTotal'), totH = models.map(M => braceTotalHtml(M, many)).join('');
    if (tot) tot.innerHTML = totH || '<div class="seis-msg info">No mezzanine on this job: the walls carry the building\'s own longitudinal seismic, as NBG Bracing designs it.</div>';
    // ---- the checks, at the bottom ----
    const flags = [];
    models.forEach(M => {
      const pre = many ? M.b.name + ': ' : '';
      M.list.forEach(l => {
        if (l.kind === 'side' && l.edge && !l.bays.some(x => x.braced)) flags.push({ level: 'warn', text: `${pre}the mezzanine's longitudinal seismic goes to the ${l.wall} as EQB / EQF, but ${M.bf ? 'the bracing file has no braced bay on that wall' : l.bw.open ? `PCS Box 12 puts ${l.bw.type} on it with the bay "${l.bw.open}" — not named yet` : l.bw.kind === 'none' ? 'PCS Box 12 lists no bracing on that wall' : 'no source names a braced bay on that wall'} — it needs a braced bay or a portal frame there.` });
        if (l.kind === 'side' && l.edge && l.bays.some(x => x.braced && x.kind === 'portal')) flags.push({ level: 'info', text: `${pre}${l.wall}: PCS Box 12 asks for portal frames — the EQB / EQF at the mezzanine level reach the portal frame${l.bays.filter(x => x.braced && x.kind === 'portal').length > 1 ? 's' : ''} through the wall strut line.` });
        if (l.kind === 'new') flags.push({ level: 'warn', text: `${pre}${l.label} (${ft(l.y)} from the FSW) takes ${l.F != null ? `${F2(l.F)} k of` : ''} the mezzanine's longitudinal seismic and is not on a sidewall: create its bracing wall in NBG Bracing — ${l.bay ? `${l.pickKind === 'other' ? (l.note || 'your own solution') : kindText(l.pickKind)} between ${ft(l.bay.u0)} and ${ft(l.bay.u1)}` : 'no two columns on it yet'} (select it above).` });
        if (l.kind === 'side' && l.bays.some(x => x.mine)) flags.push({ level: 'info', text: `${pre}${l.wall}: bays you set — ${l.bays.filter(x => x.mine).map(x => `${x.from + 1}–${x.to + 1} ${x.braced ? (x.kind === 'portal' ? 'portal frame' : 'X-bracing') : 'not braced'}`).join(', ')}${M.bf ? '. Make the same change in NBG Bracing: the download writes the loads and strut lines, not rods or portal frames' : ''}.` });
      });
      WALLS.forEach(w => { const bw = M.br.walls[w]; if (bw.check) flags.push(bw.check); });
      fileChecks(M).forEach(q => flags.push({ ...q, text: (many ? M.b.name + ' · ' : '') + q.text }));
    });
    if (flagsBox) flagsBox.innerHTML = (live ? '' : `<div class="seis-msg warn">The Seismic calc is not complete yet${sj && sj.need && sj.need.length ? ` (${esc(sj.need[0])})` : ''} — the forces come once it is; the lines and where the loads go are known from the layout.</div>`)
      + (live && !flags.some(n => n.level === 'warn' || n.level === 'stop') ? (mezzBoxes().length ? '<div class="seis-msg ok">Every mezzanine edge that takes longitudinal seismic sits on a braced sidewall.</div>' : '<div class="seis-msg info">No mezzanine on this job: the walls carry the building\'s own longitudinal seismic, as NBG Bracing designs it.</div>') : '')
      + flags.slice().sort((p, q) => ['stop', 'warn', 'info'].indexOf(p.level) - ['stop', 'warn', 'info'].indexOf(q.level)).map(n => `<div class="seis-msg ${n.level}">${esc(n.text)}</div>`).join('');
    $('#braceWallsSub').textContent = Object.keys(state.bracing || {}).length ? 'click a line on the plan or below · bays, tiers and strut lines from the bracing file' : state.scope ? 'click a line on the plan or below · braced bays from the eScope' : 'click a line on the plan or below · frame lines from PCS Box 2, bracing from PCS Box 12';
    // ---- wiring: pick a line, tier a bay, pick a new wall's bay and kind ----
    const pick = k => { state.braceSel = k; renderBracing(); };
    $$('#braceWalls [data-blsel]').forEach(el => { el.onclick = () => pick(el.dataset.blsel); });
    $$('#bracePlan [data-bline]').forEach(el => { el.onclick = () => pick(el.dataset.bline); el.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(el.dataset.bline); } }; });
    // a change here reaches every drawing of the building: this page, the Building page's 3D, the sidebar and the window
    const save = () => { C.seisSave && C.seisSave(); renderBracing(); if (C.renderSeismic) C.renderSeismic(); renderBuilding(); };
    const tierFlip = k => { const t = state.seis.tiers = state.seis.tiers || {}; if (t[k] === false) delete t[k]; else t[k] = false; if (!Object.keys(t).length) delete state.seis.tiers; save(); };
    $$('#braceLine [data-tier]').forEach(el => { el.onclick = () => tierFlip(el.dataset.tier); });
    $$('#braceLine [data-tierbay]').forEach(el => { el.onclick = () => { const l = sel && sel.l, x = l && l.bays && l.bays.find(q => String(q.from) === el.dataset.tierbay); if (x && x.tkey) tierFlip(x.tkey); }; });
    // a pick on a new line; a portal frame's legs go to the mezzanine design (recomputed when they move)
    const setNew = (k, patch) => {
      const n = state.seis.newLines = state.seis.newLines || {}, cur = { ...(n[k] || {}), ...patch }, hit = all.find(q => q.l.key === k), l = hit && hit.l;
      const bay = l ? (cur.bay != null ? l.bays.find(q => Math.abs(q.i - cur.bay) < 0.01) : l.bay) : null;
      const was = n[k] && n[k].kind === 'portal' ? JSON.stringify(n[k].legs || null) : null;
      if (l) { cur.legs = bay ? [{ x: bay.u0, y: l.y }, { x: bay.u1, y: l.y }] : null; cur.building = hit.M.b.name; cur.label = l.label; }
      n[k] = cur;
      if ((cur.kind === 'portal' ? JSON.stringify(cur.legs || null) : null) !== was) { C.seisSave && C.seisSave(); recompute(); } else save();
    };
    $$('#braceLine [data-wbay]').forEach(el => { el.onclick = () => {
      const l = sel && sel.l; if (!l || l.kind !== 'side') return;
      const x = l.bays.find(q => String(q.from) === el.dataset.wbay); if (!x) return;
      const cur = x.braced ? x.kind : 'none', next = BAY_CYCLE[(BAY_CYCLE.indexOf(cur) + 1) % BAY_CYCLE.length];
      const wb = state.seis.wallBays = state.seis.wallBays || {}, o = wb[l.ovKey] = { ...(wb[l.ovKey] || {}) };
      if (next === x.base) delete o[x.from]; else o[x.from] = next;
      if (!Object.keys(o).length) delete wb[l.ovKey];
      if (!Object.keys(wb).length) delete state.seis.wallBays;
      save();
    }; });
    $$('#braceLine [data-wbayreset]').forEach(el => { el.onclick = () => { const l = sel && sel.l; if (l && state.seis.wallBays) { delete state.seis.wallBays[l.ovKey]; if (!Object.keys(state.seis.wallBays).length) delete state.seis.wallBays; } save(); }; });
    $$('#braceLine [data-nnote]').forEach(el => { el.onchange = () => setNew(el.dataset.nnote, { note: el.value.trim() }); });
    $$('#braceLine [data-nbay]').forEach(el => { el.onclick = () => { const [k, i] = el.dataset.nbay.split(/\|(?=[^|]*$)/); setNew(k, { bay: +i }); }; });
    $$('#braceLine [data-lbay]').forEach(el => { el.onclick = () => { if (sel) setNew(sel.l.key, { bay: +el.dataset.lbay }); }; });
    $$('#braceLine [data-nkind]').forEach(el => { el.onclick = () => { const [k, kind] = el.dataset.nkind.split(/\|(?=[^|]*$)/); setNew(k, { kind }); }; });
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
  return { render, renderProject, renderBuilding, renderBldPlan, renderSnow, renderFrames, renderBracing, renderPurlins, selectFrame, compute, setWs, wsOf, snowLoad, facts, mezzBoxes, bracingOf, popOut, popSync, popOpen, TOGGLES, layerBar, layerWire, layerRegister };
};
