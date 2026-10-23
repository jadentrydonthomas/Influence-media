/* The whole building, drawn: the site in 3D (every building's frames, roofs, mezzanines and the snow on the roofs),
   the site plan (frame lines, mezzanines, roof steps and their drift), one frame line in elevation with every load
   that goes on it, and a sidewall in elevation with its bracing, strut lines and the mezzanine's EQB / EQF.
   Pure functions: a scene for model3d.js or an SVG string; the page wires them up (src/app.js). */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const SITE = node ? require('./site.js') : root.MZ_SITE;
  const SNOW = node ? require('./snow.js') : root.MZ_SNOW;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // feet → 12'-4 1/2" (to the 1/16")
  function ftin(v) {
    if (v == null || !isFinite(v)) return '—';
    const neg = v < 0, t = Math.round(Math.abs(v) * 192) / 16;
    let F = Math.floor(t / 12), inch = t - F * 12;
    if (inch >= 12 - 1e-9) { F += 1; inch = 0; }
    const whole = Math.floor(inch + 1e-9), fr = Math.round((inch - whole) * 16);
    let frs = '';
    if (fr) { let a = fr, b = 16; while (a % 2 === 0) { a /= 2; b /= 2; } frs = ` ${a}/${b}`; }
    return `${neg ? '−' : ''}${F}'-${whole}${frs}"`;
  }
  const k3 = v => (v == null || !isFinite(v) ? '—' : (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3));
  const r1 = v => (v == null || !isFinite(v) ? '—' : (+v).toFixed(1));

  /* ---------- the frame lines of a building and what each one is ---------- */
  // Box 5's entry for frame line k (1-based)
  const frameEntry = (frames, k) => (frames || []).find(fr => k >= fr.from && k <= fr.to) || null;
  // the frame's own columns across it, ft from the FSW: the sidewall columns and, for a multi-span frame or a post-and-
  // beam end frame, the interior ones (Box 5 gives the spans / endwall column spacing from the FSW)
  function columnsOf(g, fr) {
    const W = g.width, ys = [0, W];
    if (fr && fr.interior && fr.interior.length > 1 && !fr.clearSpan) {
      let y = 0;
      fr.interior.slice(0, -1).forEach(s => { y += s; if (y > 0.05 && y < W - 0.05) ys.push(y); });
    }
    return [...new Set(ys.map(y => +y.toFixed(4)))].sort((a, b) => a - b);
  }
  // each frame line of one building: number, x, tributary strip, type, columns
  function frameLines(b) {
    const xs = b.xs, n = xs.length;
    return xs.map((x, i) => {
      const fr = frameEntry(b.frames, i + 1);
      const a = i === 0 ? x : (xs[i - 1] + x) / 2, c = i === n - 1 ? x : (x + xs[i + 1]) / 2;
      return { no: i + 1, x, trib: c - a, strip: [a, c], entry: fr, type: fr ? fr.type : null, end: i === 0 ? 'LEW' : i === n - 1 ? 'REW' : null, cols: columnsOf(b.g, fr) };
    });
  }

  /* ---------- 3D: the site ---------- */
  const COL = { col: '#7b93ab', raf: '#9bb3c9', roof: '#9fb9d0', wall: '#5d7489', mezz: '#42e5ae', snow: '#eef7ff', drift: '#f3fbff', step: '#f6c779', brace: '#f6c779' };
  /* site: snowJob(…).site; drifts: snowJob(…).drifts; extra: { mezz: [{ building, id, x0, x1, y0, y1, A }], snow: true,
     roofs: snowJob(…).roofs } */
  function scene(J, extra = {}) {
    const site = J.site, members = [], labels = [], floor = [];
    let zTop = 0;
    const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: 0, z1: 0 };
    const grow = (x, y, z) => { box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y); zTop = Math.max(zTop, z); };
    const roofOf = n => (J.roofs || []).find(r => r.name === n);
    site.buildings.forEach((b, bi) => {
      const g = b.g, S = (x, y, z) => { const p = b.toSite([x, y]); return [p[0], p[1], z]; };
      const brk = SITE.roofBreaks(g), Z = (x, y) => SITE.roofZ(g, x, y);
      const pre = site.buildings.length > 1 ? b.name + ' · ' : '';
      // columns (boxes) and rafters along the roof on every frame line
      frameLines(b).forEach(fl => {
        fl.cols.forEach(y => {
          const p = b.toSite([fl.x, y]), h = Z(fl.x, y), w = 0.45;
          members.push({ id: `${pre}${fl.no}/${y.toFixed(1)}`, kind: 'frame', color: COL.col, boxes: [{ x0: p[0] - w, x1: p[0] + w, y0: p[1] - w, y1: p[1] + w, z0: 0, z1: h }], ref: { type: 'frameCol', building: b.name, frame: fl.no, y } });
          grow(p[0], p[1], h);
        });
        const raf = [];
        for (let i = 0; i + 1 < brk.length; i++) raf.push([S(fl.x, brk[i], Z(fl.x, brk[i]) + 0.35), S(fl.x, brk[i + 1], Z(fl.x, brk[i + 1]) + 0.35)]);
        members.push({ id: `${pre}Frame ${fl.no}`, kind: 'frame', color: COL.raf, width: 2.6, alpha: 0.95, lines: raf, ref: { type: 'frame', building: b.name, frame: fl.no } });
        const lp = b.toSite([fl.x, -6]);
        labels.push({ p: [lp[0], lp[1], 0], text: String(fl.no), kind: 'bubble' });
      });
      // roof planes (two-sided faces), eave and rake lines, the wall outline on the floor
      const L = g.length;
      for (let i = 0; i + 1 < brk.length; i++) {
        const y0 = brk[i], y1 = brk[i + 1];
        members.push({ id: `${pre}roof ${i + 1}`, kind: 'roof', color: COL.roof, alpha: 0.16, faces: [[S(0, y0, Z(0, y0) + 0.6), S(L, y0, Z(L, y0) + 0.6), S(L, y1, Z(L, y1) + 0.6), S(0, y1, Z(0, y1) + 0.6)]], ref: { type: 'roof', building: b.name } });
      }
      const edge = [[S(0, 0, Z(0, 0) + 0.6), S(L, 0, Z(L, 0) + 0.6)], [S(0, g.width, Z(0, g.width) + 0.6), S(L, g.width, Z(L, g.width) + 0.6)]];
      for (let i = 0; i + 1 < brk.length; i++) [0, L].forEach(x => edge.push([S(x, brk[i], Z(x, brk[i]) + 0.6), S(x, brk[i + 1], Z(x, brk[i + 1]) + 0.6)]));
      if (brk.length > 2) edge.push([S(0, brk[1], Z(0, brk[1]) + 0.6), S(L, brk[1], Z(L, brk[1]) + 0.6)]);
      members.push({ id: `${pre}edges`, kind: 'wall', color: COL.wall, width: 1.2, alpha: 0.9, lines: edge });
      b.corners.forEach((p, i, arr) => { const q = arr[(i + 1) % 4]; floor.push([[p[0], p[1], 0], [q[0], q[1], 0], 'rgba(140,200,235,.35)', false]); });
      const mid = b.toSite([L / 2, g.width / 2]);
      labels.push({ p: [mid[0], mid[1], Z(L / 2, g.width / 2) + 4], text: b.name, kind: 'text', color: '#cfe6f7' });
      // balanced snow on the roof: its depth ps / γ, see-through
      const rf = roofOf(b.name);
      if (extra.snow !== false && rf && rf.ps > 0) {
        const hb = rf.ps / rf.gamma;
        for (let i = 0; i + 1 < brk.length; i++) {
          const y0 = brk[i], y1 = brk[i + 1], z = (x, y) => Z(x, y) + 0.7 + hb;
          members.push({ id: `${pre}snow ${i + 1}`, kind: 'snow', color: COL.snow, alpha: 0.32, faces: [[S(0, y0, z(0, y0)), S(L, y0, z(L, y0)), S(L, y1, z(L, y1)), S(0, y1, z(0, y1))]], ref: { type: 'snow', building: b.name } });
        }
      }
    });
    // purlins along the length on each roof plane at the purlin spacing (toggle), and the wall X-bracing in the braced
    // bays (from the bracing file or the eScope: extra.bracing[name] = { FSW: [{ from, to, tiers: [[z0, z1]] }], BSW: … })
    site.buildings.forEach(b => {
      const g = b.g, S = (x, y, z) => { const p = b.toSite([x, y]); return [p[0], p[1], z]; }, Z = (x, y) => SITE.roofZ(g, x, y), brk = SITE.roofBreaks(g), sp = extra.purlin || 5;
      const lines = [];
      for (let i = 0; i + 1 < brk.length; i++) for (let y = brk[i] + sp; y < brk[i + 1] - 0.3; y += sp) lines.push([S(0, y, Z(0, y) + 0.55), S(g.length, y, Z(g.length, y) + 0.55)]);
      if (lines.length) members.push({ id: `${b.name} purlins`, kind: 'purlin', color: '#a9cbe0', alpha: 0.5, width: 0.9, lines });
      const brc = (extra.bracing || {})[b.name];
      if (brc) ['FSW', 'BSW'].forEach(w => (brc[w] || []).forEach(bay => {
        const y = w === 'FSW' ? 0 : g.width, xa = b.xs[bay.from], xb = b.xs[bay.to];
        if (xa == null || xb == null) return;
        const tiers = bay.tiers && bay.tiers.length ? bay.tiers : [[0, Z(xa, y)]];
        const xl = tiers.flatMap(([z0, z1]) => [[S(xa, y, z0), S(xb, y, z1)], [S(xa, y, z1), S(xb, y, z0)]]);
        members.push({ id: `${b.name} ${w} bracing ${bay.from + 1}-${bay.to + 1}`, kind: 'brace', color: COL.brace, width: 2, alpha: 0.95, lines: xl, ref: { type: 'brace', building: b.name, wall: w } });
      }));
    });
    // mezzanine floors
    (extra.mezz || []).forEach(m => {
      const b = site.buildings.find(q => SITE.bkey(q.name) === SITE.bkey(m.building)) || site.buildings[0];
      if (!b) return;
      const p = b.toSite([m.x0, m.y0]), q = b.toSite([m.x1, m.y1]);
      members.push({ id: 'Mezzanine ' + m.id, kind: 'mezz', color: COL.mezz, alpha: 0.42, boxes: [{ x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), y0: Math.min(p[1], q[1]), y1: Math.max(p[1], q[1]), z0: m.A - 0.6, z1: m.A }], ref: { type: 'mezz', id: m.id, building: b.name } });
      labels.push({ p: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, m.A + 0.5], text: (/^mezz/i.test(m.id) ? m.id : 'Mezz ' + m.id).toUpperCase(), kind: 'tag', color: '#69fac5' });
    });
    // drift wedges on the lower roofs: balanced depth + the drift, falling to the balanced depth at w
    if (extra.snow !== false) (J.drifts || []).forEach(d => {
      if (d.drift.none || d.off) return;
      const b = d.step.lower, g = b.g, gam = d.drift.gamma, hb = d.drift.hb, side = d.kind === 'side';
      const Z = (x, y) => SITE.roofZ(g, x, y) + 0.7;
      const sp = d.step.span, s0 = side ? Math.min(sp[0][0], sp[1][0]) : Math.min(sp[0][1], sp[1][1]), s1 = side ? Math.max(sp[0][0], sp[1][0]) : Math.max(sp[0][1], sp[1][1]);
      const N = side ? 1 : 1, faces = [];
      // along the wall in pieces (an endwall rake changes the drift along it)
      const cuts = 12;
      for (let k = 0; k < cuts; k++) {
        const t0 = s0 + (s1 - s0) * k / cuts, t1 = s0 + (s1 - s0) * (k + 1) / cuts;
        const dr = t => { const pt = side ? [t, d.lowerWall === 'FSW' ? 0 : g.width] : [d.lowerWall === 'LEW' ? 0 : g.length, t]; return SNOW.stepDrift({ ed: J.facts.ed, pg: J.facts.pg, W2: J.facts.W2, psLower: d.psLower, luUpper: d.luUpper, luLower: d.luLower, lowerWidth: d.lowerWidth, s: d.s, h: d.step.hAt(pt) }); };
        const a = dr(t0), c = dr(t1);
        if (a.none && c.none) continue;
        const reachA = Math.min(a.w || 0, d.lowerWidth), reachC = Math.min(c.w || 0, d.lowerWidth);
        const P = (t, u, extraH) => {   // t along the wall, u from the wall into the lower roof
          let x, y;
          if (side) { x = t; y = d.lowerWall === 'FSW' ? u : g.width - u; } else { y = t; x = d.lowerWall === 'LEW' ? u : g.length - u; }
          const s = b.toSite([x, y]);
          return [s[0], s[1], Z(x, y) + hb + extraH];
        };
        const hA0 = a.none ? 0 : a.hd, hC0 = c.none ? 0 : c.hd, hA1 = a.none ? 0 : SNOW.driftAt(a, reachA) / gam, hC1 = c.none ? 0 : SNOW.driftAt(c, reachC) / gam;
        faces.push([P(t0, 0, hA0), P(t1, 0, hC0), P(t1, reachC, hC1), P(t0, reachA, hA1)]);
        faces.push([P(t0, 0, 0), P(t1, 0, 0), P(t1, 0, hC0), P(t0, 0, hA0)]);
        if (k === 0) faces.push([P(t0, 0, 0), P(t0, 0, hA0), P(t0, reachA, hA1), P(t0, reachA, 0)]);
        if (k === cuts - 1) faces.push([P(t1, 0, 0), P(t1, 0, hC0), P(t1, reachC, hC1), P(t1, reachC, 0)]);
      }
      void N;
      if (faces.length) members.push({ id: `Drift · ${d.lower}`, kind: 'drift', color: COL.drift, alpha: 0.78, faces, ref: { type: 'drift', key: d.key } });
      const mid = (s0 + s1) / 2, lp = side ? b.toSite([mid, d.lowerWall === 'FSW' ? Math.min(d.drift.w, g.width) / 2 : g.width - Math.min(d.drift.w, g.width) / 2]) : b.toSite([d.lowerWall === 'LEW' ? Math.min(d.drift.w, g.length) / 2 : g.length - Math.min(d.drift.w, g.length) / 2, mid]);
      labels.push({ p: [lp[0], lp[1], SITE.roofZ(g, side ? mid : 0, side ? 0 : mid) + hb + d.drift.hd + 1.5], text: `drift ${r1(d.drift.pd)} psf`, kind: 'tag', color: COL.step });
    });
    if (!isFinite(box.x0)) { box.x0 = 0; box.x1 = 10; box.y0 = 0; box.y1 = 10; }
    box.x0 -= 8; box.y0 -= 8; box.x1 += 4; box.y1 += 4; box.z1 = zTop + 6;
    const groups = site.buildings.map(b => { const xs = b.corners.map(p => p[0]), ys = b.corners.map(p => p[1]); return { id: b.name, box: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: 0, z1: zTop } }; });
    // snow in the air over the site, blown from the higher roof toward the lower one where a drift forms
    let wind = [0, 0];
    const d0 = (J.drifts || []).find(d => !d.drift.none && !d.off);
    if (d0) { const c = b => { const xs = b.corners.map(p => p[0]), ys = b.corners.map(p => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; }; const a = c(d0.step.upper), b2 = c(d0.step.lower), l = Math.hypot(b2[0] - a[0], b2[1] - a[1]) || 1; wind = [(b2[0] - a[0]) / l * 4, (b2[1] - a[1]) / l * 4]; }
    const flakes = extra.snow === false ? null : { box: { x0: box.x0 + 6, x1: box.x1 - 2, y0: box.y0 + 6, y1: box.y1 - 2, z0: 0.5, z1: zTop + 16 }, n: Math.min(260, Math.round((box.x1 - box.x0) * (box.y1 - box.y0) / 90)), wind };
    return { center: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, box.z1 / 2], radius: Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2, box, members, labels, floor, groups, flakes };
  }

  /* ---------- the site plan ---------- */
  /* opts: { mezz: [{ building, id, x0, x1, y0, y1 }], selected: { building, frame }, width } — clickable frame lines carry
     data-bldg / data-frame */
  function planSvg(J, opts = {}) {
    const site = J.site, Wd = opts.width || 980;
    const xs = site.buildings.flatMap(b => b.corners.map(p => p[0])), ys = site.buildings.flatMap(b => b.corners.map(p => p[1]));
    if (!xs.length) return '<svg viewBox="0 0 100 40"></svg>';
    const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
    const pad = 54, sc = Math.min((Wd - 2 * pad) / Math.max(1, X1 - X0), 520 / Math.max(1, Y1 - Y0)), H = (Y1 - Y0) * sc + 2 * pad;
    // plan view: x to the right, y up (the FSW at the bottom)
    const P = ([x, y]) => [pad + (x - X0) * sc, H - pad - (y - Y0) * sc];
    const pt = p => P(p).map(v => v.toFixed(1)).join(',');
    let out = `<svg viewBox="0 0 ${Wd} ${H.toFixed(0)}" class="site-plan" role="img" aria-label="Site plan: buildings, frame lines, mezzanines and snow drifts"><defs>
      <pattern id="spHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" class="sp-hatch"/></pattern>
      <linearGradient id="spDrift" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--amber)" stop-opacity=".55"/><stop offset="1" stop-color="var(--amber)" stop-opacity=".04"/></linearGradient>
      <marker id="spArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="sp-arrhead"/></marker></defs>`;
    site.buildings.forEach(b => {
      const g = b.g;
      out += `<g class="sp-bldg" data-bldg="${esc(b.name)}"><polygon points="${b.corners.map(pt).join(' ')}" class="sp-outline"/>`;
      // ridge(s) dashed, downslope ticks
      SITE.roofBreaks(g).slice(1, -1).forEach(yr => { out += `<line class="sp-ridge" x1="${P(b.toSite([0, yr]))[0].toFixed(1)}" y1="${P(b.toSite([0, yr]))[1].toFixed(1)}" x2="${P(b.toSite([g.length, yr]))[0].toFixed(1)}" y2="${P(b.toSite([g.length, yr]))[1].toFixed(1)}"/>`; });
      // frame-line bubbles outside the FSW, or the BSW when something is attached along the FSW
      const taken = w => site.attachments.some(a => (SITE.bkey(a.building) === SITE.bkey(b.name) && a.wall === w) || (SITE.bkey(a.to) === SITE.bkey(b.name) && a.toWall === w));
      const bubY = taken('FSW') && !taken('BSW') ? g.width + 12 / sc : -12 / sc, bubW = bubY > 0 ? g.width : 0;
      frameLines(b).forEach(fl => {
        const a = P(b.toSite([fl.x, 0])), c = P(b.toSite([fl.x, g.width])), sel = opts.selected && opts.selected.building === b.name && opts.selected.frame === fl.no;
        const w0 = P(b.toSite([fl.x, bubW])), out1 = P(b.toSite([fl.x, bubY])), dx = out1[0] - w0[0], dy = out1[1] - w0[1];
        const a0 = a; void a0;
        out += `<g class="sp-fl${sel ? ' is-sel' : ''}" data-bldg="${esc(b.name)}" data-frame="${fl.no}" tabindex="0" role="button" aria-label="${esc(b.name)} frame line ${fl.no}"><line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${c[0].toFixed(1)}" y2="${c[1].toFixed(1)}"/><line class="sp-hit" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${c[0].toFixed(1)}" y2="${c[1].toFixed(1)}"/><circle cx="${(w0[0] + dx).toFixed(1)}" cy="${(w0[1] + dy).toFixed(1)}" r="8.5"/><text x="${(w0[0] + dx).toFixed(1)}" y="${(w0[1] + dy + 3.4).toFixed(1)}">${fl.no}</text></g>`;
      });
      // the name across the building, turned along it when it is narrow on the drawing; on a stepped-down roof it
      // moves to the side away from the step (the drift label sits by the step)
      const sx = b.corners.map(q => P(q)[0]), sy = b.corners.map(q => P(q)[1]), bw = Math.max(...sx) - Math.min(...sx), bh = Math.max(...sy) - Math.min(...sy);
      const dr = (J.drifts || []).find(d => d.lower === b.name && !d.drift.none);
      let cy = g.width / 2, cxL = g.length / 2;
      if (dr && dr.kind === 'side') cy = dr.lowerWall === 'FSW' ? g.width * 0.72 : g.width * 0.28;
      if (dr && dr.kind === 'end') cxL = dr.lowerWall === 'LEW' ? g.length * 0.72 : g.length * 0.28;
      const turn = bw < 120 && bh > bw * 1.6;
      if (turn) {
        const mid = P(b.toSite([cxL, cy]));
        out += `<g transform="rotate(-90 ${mid[0].toFixed(1)} ${mid[1].toFixed(1)})"><text class="sp-name" x="${mid[0].toFixed(1)}" y="${(mid[1] - 2).toFixed(1)}">${esc(b.name)}</text><text class="sp-dim" x="${mid[0].toFixed(1)}" y="${(mid[1] + 13).toFixed(1)}">${ftin(g.width)} × ${ftin(g.length)} · ${esc(g.profile || '')}</text></g></g>`;
      } else {
        // top-left of the building as drawn, inside its outline, clear of a drift band along the top
        const cs = b.corners.map(q => P(q)), x0 = Math.min(...cs.map(q => q[0])), y0 = Math.min(...cs.map(q => q[1]));
        const topStep = dr && dr.kind === 'side' && P(b.toSite(SITE.wallSeg(g, dr.lowerWall).p0))[1] < y0 + bh / 2 ? Math.min(dr.drift.w, dr.lowerWidth) * sc + 6 : 0;
        const nx = x0 + 10, ny = y0 + 18 + topStep;
        out += `<text class="sp-name sp-name-corner" x="${nx.toFixed(1)}" y="${ny.toFixed(1)}">${esc(b.name)}</text><text class="sp-dim sp-dim-corner" x="${nx.toFixed(1)}" y="${(ny + 14).toFixed(1)}">${ftin(g.width)} × ${ftin(g.length)} · ${esc(g.profile || '')}</text></g>`;
      }
    });
    (opts.mezz || []).forEach(m => {
      const b = site.buildings.find(q => SITE.bkey(q.name) === SITE.bkey(m.building)) || site.buildings[0];
      if (!b) return;
      const p = P(b.toSite([m.x0, m.y0])), q = P(b.toSite([m.x1, m.y1]));
      const x = Math.min(p[0], q[0]), y = Math.min(p[1], q[1]), w = Math.abs(q[0] - p[0]), h = Math.abs(q[1] - p[1]);
      out += `<g class="sp-mezz"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="url(#spHatch)"/><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" class="sp-mezz-edge"/><text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2 + 4).toFixed(1)}">${esc(/^mezz/i.test(m.id) ? m.id : 'Mezz ' + m.id)}</text></g>`;
    });
    // drift zones: from the step wall into the lower roof, w wide (or to the far eave), with the wind that makes them
    (J.drifts || []).forEach(d => {
      const b = d.step.lower, g = b.g, side = d.kind === 'side';
      const sp = d.step.span, s0 = side ? Math.min(sp[0][0], sp[1][0]) : Math.min(sp[0][1], sp[1][1]), s1 = side ? Math.max(sp[0][0], sp[1][0]) : Math.max(sp[0][1], sp[1][1]);
      const L2 = (t, u) => (side ? [t, d.lowerWall === 'FSW' ? u : g.width - u] : [d.lowerWall === 'LEW' ? u : g.length - u, t]);
      const wallA = P(b.toSite(L2(s0, 0))), wallB = P(b.toSite(L2(s1, 0)));
      if (!d.drift.none && !d.off) {
        const reach = Math.min(d.drift.w, d.lowerWidth);
        const q = [L2(s0, 0), L2(s1, 0), L2(s1, reach), L2(s0, reach)].map(p => P(b.toSite(p)));
        // the gradient runs from the wall into the roof
        const g0 = q[0], g1 = q[3], id = 'spDr' + d.k;
        out += `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${g0[0].toFixed(1)}" y1="${g0[1].toFixed(1)}" x2="${g1[0].toFixed(1)}" y2="${g1[1].toFixed(1)}"><stop offset="0" stop-color="var(--amber)" stop-opacity=".62"/><stop offset="1" stop-color="var(--amber)" stop-opacity="${d.drift.truncated ? '.22' : '.03'}"/></linearGradient>`;
        out += `<g class="sp-drift" data-step="${esc(d.key)}"><polygon points="${q.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="url(#${id})"/>`;
        // wind arrow across the upper roof toward the step (leeward), or across the lower roof toward it (windward)
        const mid = (s0 + s1) / 2, fromUp = d.drift.gov === 'leeward';
        const a0 = fromUp ? P(b.toSite(L2(mid, -Math.min(40, d.luUpper * 0.45)))) : P(b.toSite(L2(mid, Math.min(d.lowerWidth, 40) * 0.95)));
        const a1 = fromUp ? P(b.toSite(L2(mid, -4))) : P(b.toSite(L2(mid, reach * 0.55)));
        out += `<line class="sp-wind" x1="${a0[0].toFixed(1)}" y1="${a0[1].toFixed(1)}" x2="${a1[0].toFixed(1)}" y2="${a1[1].toFixed(1)}" marker-end="url(#spArr)"/>`;
        // the label in the drift band, along the wall (turned when the wall runs up the drawing)
        const lab = P(b.toSite(L2(mid, Math.min(reach, d.lowerWidth) * 0.42))), along = P(b.toSite(L2(s1, 0))), up = Math.abs(along[1] - wallA[1]) > Math.abs(along[0] - wallA[0]);
        out += `<text class="sp-dlab" x="${lab[0].toFixed(1)}" y="${(lab[1] + 4).toFixed(1)}"${up ? ` transform="rotate(-90 ${lab[0].toFixed(1)} ${(lab[1] + 4).toFixed(1)})"` : ''}>drift ${r1(d.drift.pd)} psf · w ${ftin(d.drift.w)}${d.drift.truncated ? ' (cut off)' : ''}</text></g>`;
      }
      out += `<line class="sp-step${d.drift.none ? ' is-none' : ''}" x1="${wallA[0].toFixed(1)}" y1="${wallA[1].toFixed(1)}" x2="${wallB[0].toFixed(1)}" y2="${wallB[1].toFixed(1)}"/>`;
    });
    // north-ish key: the FSW is at the bottom
    out += `<text class="sp-key" x="${pad}" y="${(H - 14).toFixed(0)}">Plan · FSW at the bottom · ${esc(site.root || '')} LEW at the left</text></svg>`;
    return out;
  }

  /* ---------- one frame line in elevation, with its loads ----------
     F: { g (building geometry), name, frame (no), x, trib, cols: [y], type, loads: {
          dead: k/ft, coll: k/ft, snow: { ps, kft, pm, hb }, drift: [segs], sliding: [segs],
          unbalanced: { windward, leeward, surcharge, length } (psf) ,
          mezz: [{ y, elev, D, L, member, label }], eq: [{ y, at, F, member }], leanTo: [{ y, at, rows }] },
        step: { side: 'FSW' | 'BSW', upperName, upperEave, gov } (the higher building beside it), on: { [layer]: bool } }
     Returns { svg, legend: [{ key, label, on }] } — every load in its own <g data-layer>. */
  function frameSvg(F) {
    const g = F.g, W = g.width, Zr = y => SITE.roofZ(g, F.x, y), brk = SITE.roofBreaks(g);
    const eaveMax = Math.max(Zr(0), Zr(W), ...brk.map(Zr)), ld = F.loads || {};
    const stepH = F.step ? F.step.upperEave : 0;
    const extraL = F.step && F.step.side === 'FSW' ? Math.max(10, W * 0.28) : 0, extraR = F.step && F.step.side === 'BSW' ? Math.max(10, W * 0.28) : 0;
    const Hft = Math.max(eaveMax, stepH) + 3, padT = 150, padB = 66;
    const sc = Math.min(330 / Hft, 720 / (W + extraL + extraR));
    const used = (W + extraL + extraR) * sc, Wpx = Math.max(660, used + 300), padL = (Wpx - used) / 2, Hpx = Hft * sc + padT + padB;
    const X = y => padL + (y + extraL) * sc, Y = z => padT + (Hft - z) * sc;
    const p = (y, z) => `${X(y).toFixed(1)},${Y(z).toFixed(1)}`;
    const legend = [], labels = [];
    const layer = (key, label, body) => { legend.push({ key, label }); return `<g class="fl-layer" data-layer="${key}">${body}</g>`; };
    // a label placed clear of the others already placed (moved up in steps)
    const place = (x, y, w, h = 14) => {
      let yy = y;
      for (let k = 0; k < 12 && labels.some(b => x - w / 2 < b[2] && x + w / 2 > b[0] && yy - h < b[3] && yy > b[1]); k++) yy -= h + 2;
      labels.push([x - w / 2, yy - h, x + w / 2, yy]);
      return yy;
    };
    const tw = t => 7.1 * String(t).length + 8;
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx.toFixed(0)}" class="frame-elev" role="img" aria-label="${esc(F.name)} frame line ${F.frame} with its loads"><defs>
      <marker id="feArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker>
      <marker id="feArrS" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fe-snowhead"/></marker>
      <marker id="feArrD" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fe-drifthead"/></marker>
      <marker id="feArrM" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fe-mezzhead"/></marker>
      <marker id="feArrE" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fe-eqhead"/></marker>
      <linearGradient id="feSnow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset="1" stop-color="#cfe6f7" stop-opacity=".75"/></linearGradient>
      <clipPath id="feSky"><rect x="0" y="0" width="${Wpx}" height="${Y(0).toFixed(1)}"/></clipPath></defs>`;
    s += `<line class="fe-ground" x1="${(X(-extraL) - 24).toFixed(1)}" y1="${Y(0)}" x2="${(X(W + extraR) + 24).toFixed(1)}" y2="${Y(0)}"/>`;
    // the higher building beside it, ghosted, with its eave
    if (F.step) {
      const yW = F.step.side === 'FSW' ? 0 : W, yo = F.step.side === 'FSW' ? -extraL : W + extraR, cx = (X(yW) + X(yo)) / 2;
      labels.push([cx - 80, Y(stepH) + 6, cx + 80, Y(stepH) + 58]);   // the load labels keep clear of its name
      s += `<g class="fe-upper"><polygon points="${p(yW, 0)} ${p(yW, stepH)} ${p(yo, stepH + (F.step.rise || 0))} ${p(yo, 0)}"/><text x="${cx.toFixed(1)}" y="${(Y(stepH) + 22).toFixed(1)}">${esc(F.step.upperName)}</text><text class="fe-dim" x="${cx.toFixed(1)}" y="${(Y(stepH) + 38).toFixed(1)}">${F.step.rake ? 'roof at the wall' : 'eave'} ${ftin(stepH)}</text><text class="fe-dim" x="${cx.toFixed(1)}" y="${(Y(stepH) + 54).toFixed(1)}">step ${ftin(F.step.h)}</text></g>`;
    }
    // columns and the rafter, the eaves inside the frame, the width
    let frame = '';
    F.cols.forEach(y => { frame += `<line class="fe-col" x1="${X(y).toFixed(1)}" y1="${Y(0).toFixed(1)}" x2="${X(y).toFixed(1)}" y2="${Y(Zr(y)).toFixed(1)}"/><rect class="fe-base" x="${(X(y) - 7).toFixed(1)}" y="${(Y(0) - 2).toFixed(1)}" width="14" height="4"/>`; });
    frame += `<polyline class="fe-raf" points="${brk.map(y => p(y, Zr(y))).join(' ')}"/>`;
    frame += `<g class="fe-dims"><line x1="${X(0).toFixed(1)}" y1="${(Y(0) + 30).toFixed(1)}" x2="${X(W).toFixed(1)}" y2="${(Y(0) + 30).toFixed(1)}"/><line x1="${X(0).toFixed(1)}" y1="${(Y(0) + 24).toFixed(1)}" x2="${X(0).toFixed(1)}" y2="${(Y(0) + 36).toFixed(1)}"/><line x1="${X(W).toFixed(1)}" y1="${(Y(0) + 24).toFixed(1)}" x2="${X(W).toFixed(1)}" y2="${(Y(0) + 36).toFixed(1)}"/><text x="${((X(0) + X(W)) / 2).toFixed(1)}" y="${(Y(0) + 48).toFixed(1)}">${ftin(W)}${F.type ? ' · ' + esc(F.type) : ''}</text>`;
    frame += `<text class="fe-eave" x="${(X(0) + 10).toFixed(1)}" y="${(Y(Zr(0)) + 18).toFixed(1)}">${ftin(Zr(0))}</text><text class="fe-eave" x="${(X(W) - 10).toFixed(1)}" y="${(Y(Zr(W)) + 18).toFixed(1)}" style="text-anchor:end">${ftin(Zr(W))}</text>`;
    frame += `<text class="fe-wall" x="${X(0).toFixed(1)}" y="${(Y(0) + 16).toFixed(1)}">FSW</text><text class="fe-wall" x="${X(W).toFixed(1)}" y="${(Y(0) + 16).toFixed(1)}">BSW</text></g>`;
    s += `<g class="fe-frame">${frame}</g>`;
    // the snow on the roof at true scale: the balanced depth, the drift wedge, sliding snow
    const hb = ld.snow && ld.snow.hb > 0 ? ld.snow.hb : 0, roofTop = y => Zr(y) + 0.3;
    const dSegs = ld.drift || [], sSegs = ld.sliding || [], gam = ld.snow ? ld.snow.gamma || 20 : 20, trib = F.trib || 1;
    const segVal = (segs, y) => segs.reduce((a, sg) => (y >= sg.from - 1e-6 && y <= sg.to + 1e-6 ? a - (sg.start + (sg.end - sg.start) * (sg.to === sg.from ? 0 : (y - sg.from) / (sg.to - sg.from))) : a), 0);
    const depthAt = y => hb + (segVal(dSegs, y) + segVal(sSegs, y)) * 1000 / trib / gam;
    const keys = [...new Set([...brk, ...dSegs.flatMap(sg => [sg.from, sg.to]), ...sSegs.flatMap(sg => [sg.from, sg.to])].map(v => +(+v).toFixed(4)))].sort((a, b) => a - b);
    if (hb > 0 || dSegs.length || sSegs.length) {
      const top = [], bot = [], eps = 1e-3;
      keys.forEach((y, i) => { top.push(p(y, roofTop(y) + depthAt(i ? y - eps : y + eps))); if (i && i < keys.length - 1) top.push(p(y, roofTop(y) + depthAt(y + eps))); bot.push(p(y, roofTop(y))); });
      s += layer('snowpack', 'Snow on the roof (true depth)', `<polygon class="fe-pack" points="${top.join(' ')} ${bot.reverse().join(' ')}"/>`);
    }
    // the loads as arrow bands, stacked above the snow: dead + collateral, balanced snow, drift / sliding
    const uni = v => (v > 0 ? [{ from: 0, to: W, start: -v, end: -v }] : []);
    const bands = [
      { key: 'dead', label: 'Roof dead + collateral', segs: uni((ld.dead || 0) + (ld.coll || 0)), cls: 'fe-dead', mk: 'feArr', unit: 'k/ft', name: 'D + C' },
      { key: 'snow', label: ld.snow ? `Snow (balanced) ${r1(ld.snow.ps)} psf` : 'Snow', segs: ld.snow && ld.snow.kft > 0 ? uni(ld.snow.kft) : [], cls: 'fe-snow', mk: 'feArrS', unit: 'k/ft PY', name: 'Snow' },
      { key: 'drift', label: 'Snow drift', segs: dSegs, cls: 'fe-drift', mk: 'feArrD', unit: 'k/ft PY', name: 'Snow Drift' },
      { key: 'sliding', label: 'Sliding snow', segs: sSegs, cls: 'fe-slide', mk: 'feArrD', unit: 'k/ft PY', name: 'Sliding Snow' },
    ].filter(b => b.segs.length);
    const kmax = Math.max(1e-9, ...bands.map(b => Math.max(...[...keys, ...b.segs.flatMap(sg => [sg.from, sg.to])].map(y => segVal(b.segs, y)))));
    const hpx = v => (v > 1e-9 ? 9 + 42 * v / kmax : 0);
    const n = Math.max(12, Math.min(34, Math.round(W / 1.4)));
    const samples = [...new Set([...Array.from({ length: n + 1 }, (_, i) => W * i / n), ...keys].map(v => +(+v).toFixed(4)))].sort((a, b) => a - b);
    const off = samples.map(() => 0);
    bands.forEach(b => {
      let body = '', poly = [];
      samples.forEach((y, i) => {
        const v = segVal(b.segs, y), base = Y(roofTop(y) + depthAt(y)) - 3 - off[i];
        const top = base - hpx(v);
        poly.push(v > 1e-9 ? `${X(y).toFixed(1)},${top.toFixed(1)}` : null);
        if (v > 1e-9 && (i % 2 === 0 || b.segs !== bands[0].segs)) body += `<line x1="${X(y).toFixed(1)}" y1="${top.toFixed(1)}" x2="${X(y).toFixed(1)}" y2="${(base - 1).toFixed(1)}" marker-end="url(#${b.mk})"/>`;
        off[i] += hpx(v) + (v > 1e-9 ? 5 : 0);
      });
      // the band's top line, broken where it is 0
      let run = [];
      poly.concat([null]).forEach(q => { if (q) run.push(q); else { if (run.length > 1) body += `<polyline class="fe-bandtop" points="${run.join(' ')}"/>`; run = []; } });
      b.body = body;
    });
    // each band's value where it peaks (and where it ends), above the whole stack there, clear of the other labels
    bands.slice().reverse().forEach(b => {
      b.segs.forEach(sg => {
        const va = -sg.start, vb = -sg.end, at = va >= vb ? sg.from : sg.to, i = samples.findIndex(y => Math.abs(y - at) < 1e-3);
        const tx = `${b.name} ${k3(Math.max(va, vb))}${Math.abs(va - vb) > 1e-6 ? ` → ${k3(Math.min(va, vb))}` : ''} ${b.unit}`, w = tw(tx);
        const x = Math.min(Math.max(X(at), w / 2 + 6), Wpx - w / 2 - 6), y0 = (i >= 0 ? Y(roofTop(at) + depthAt(at)) - 3 - off[i] : padT) - 4;
        const yy = place(x, y0, w);
        b.body += `<text class="fe-val" x="${x.toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="middle">${esc(tx)}</text>`;
      });
    });
    bands.forEach(b => { s += layer(b.key, b.label, `<g class="${b.cls}">${b.body}</g>`); });
    // mezzanine dead / live on the columns at the floor, toward the inside of the frame
    if ((ld.mezz || []).length) {
      let m = '';
      ld.mezz.forEach(q => {
        const x = X(q.y), z = Y(q.elev), dir = q.y < W / 2 ? 1 : -1, a = dir > 0 ? 'start' : 'end';
        m += `<line class="fe-floor" x1="${(x + dir * 5).toFixed(1)}" y1="${z.toFixed(1)}" x2="${(x + dir * 54).toFixed(1)}" y2="${z.toFixed(1)}"/>`;
        m += `<line x1="${(x + dir * 14).toFixed(1)}" y1="${(z - 40).toFixed(1)}" x2="${(x + dir * 14).toFixed(1)}" y2="${(z - 3).toFixed(1)}" marker-end="url(#feArrM)"/>`;
        m += `<text class="fe-val" x="${(x + dir * 20).toFixed(1)}" y="${(z - 28).toFixed(1)}" text-anchor="${a}">${esc(q.member || q.label || '')} FDL ${k3(q.D)} · FLL ${k3(q.L)} k</text><text class="fe-sub" x="${(x + dir * 20).toFixed(1)}" y="${(z - 14).toFixed(1)}" text-anchor="${a}">at ${ftin(q.elev)}</text>`;
      });
      s += layer('mezz', 'Mezzanine dead / live', `<g class="fe-mezz">${m}</g>`);
    }
    if ((ld.eq || []).length) {
      let e = '';
      ld.eq.forEach(q => {
        const x = X(q.y), z = Y(q.at);
        e += `<line x1="${(x - 58).toFixed(1)}" y1="${(z + 14).toFixed(1)}" x2="${(x - 4).toFixed(1)}" y2="${(z + 14).toFixed(1)}" marker-end="url(#feArrE)"/><text class="fe-val" x="${(x - 31).toFixed(1)}" y="${(z + 9).toFixed(1)}" text-anchor="middle">EQR +${k3(q.F)}</text>`;
        e += `<line x1="${(x + 58).toFixed(1)}" y1="${(z + 34).toFixed(1)}" x2="${(x + 4).toFixed(1)}" y2="${(z + 34).toFixed(1)}" marker-end="url(#feArrE)"/><text class="fe-val" x="${(x + 31).toFixed(1)}" y="${(z + 29).toFixed(1)}" text-anchor="middle">EQL −${k3(q.F)}</text>`;
      });
      s += layer('eq', 'Seismic EQR / EQL', `<g class="fe-eq">${e}</g>`);
    }
    if ((ld.leanTo || []).length) {
      let e = '';
      ld.leanTo.forEach(q => {
        const x = X(q.y), z = Y(q.at), dir = q.y < W / 2 ? -1 : 1;
        e += `<line x1="${(x + dir * 8).toFixed(1)}" y1="${(z - 44).toFixed(1)}" x2="${(x + dir * 8).toFixed(1)}" y2="${(z - 3).toFixed(1)}" marker-end="url(#feArrD)"/><text class="fe-val" x="${(x + dir * 12).toFixed(1)}" y="${(z - 30).toFixed(1)}" text-anchor="${dir > 0 ? 'start' : 'end'}">Lean-to ${esc(q.text || '')}</text>`;
      });
      s += layer('leanto', 'Lean-to reactions', `<g class="fe-lean">${e}</g>`);
    }
    // falling snow: flakes from above, blown toward the step when the frame carries its drift
    if (F.flakes !== false && (hb > 0 || dSegs.length)) {
      const N = 54, blow = F.step && dSegs.length ? (F.step.side === 'FSW' ? -1 : 1) : 0;
      let fl = '';
      for (let i = 0; i < N; i++) {
        const y = -extraL + ((i * 37) % 101) / 101 * (W + extraL + extraR), d = 5 + (i * 13) % 7, dl = -((i * 0.71) % d), r = 1.2 + (i % 3) * 0.6;
        fl += `<circle class="fe-flake" cx="${X(y).toFixed(1)}" cy="6" r="${r.toFixed(1)}" style="--dx:${(blow * (30 + (i % 5) * 10)).toFixed(0)}px;--dy:${(Y(0) - 10).toFixed(0)}px;animation-duration:${d}s;animation-delay:${dl.toFixed(2)}s"/>`;
      }
      s += layer('flakes', 'Falling snow', `<g class="fe-flakes" clip-path="url(#feSky)">${fl}</g>`);
    }
    s += '</svg>';
    return { svg: s, legend };
  }

  /* ---------- a sidewall in elevation: bays, X-bracing (tiers), strut lines, the mezzanine's EQB / EQF ----------
     Wl: { name, wall: 'FSW' | 'BSW', length, eave, lines: [{ no, x }], bays: [{ from, to, braced, braces: [{ bottom, top }],
           struts: [{ elev, real }] }], loads: [{ line (1-based frame line), elev, F, caseId }], mezz: [{ x0, x1, A, id }],
           strutsPlanned: [{ from, to, elev }] } */
  function wallSvg(Wl) {
    const L = Wl.length, Hft = Wl.eave + 6, Wpx = 1000, padL = 40, padR = 40, padT = 28, padB = 52;
    const sc = Math.min((Wpx - padL - padR) / L, 230 / Hft), Hpx = Hft * sc + padT + padB;
    const X = x => padL + x * sc, Y = z => padT + (Hft - z) * sc;
    const lineX = no => { const l = Wl.lines.find(q => q.no === no); return l ? l.x : null; };
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx.toFixed(0)}" class="wall-elev" role="img" aria-label="${esc(Wl.name)} ${Wl.wall} bracing"><defs><marker id="weArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
    s += `<rect class="we-wall" x="${X(0)}" y="${Y(Wl.eave).toFixed(1)}" width="${(L * sc).toFixed(1)}" height="${(Wl.eave * sc).toFixed(1)}"/>`;
    // the mezzanine floor seen through the wall
    (Wl.mezz || []).forEach(m => { s += `<rect class="we-mezz" x="${X(m.x0).toFixed(1)}" y="${(Y(m.A) - 2).toFixed(1)}" width="${((m.x1 - m.x0) * sc).toFixed(1)}" height="4"/><text class="we-sub" x="${X((m.x0 + m.x1) / 2).toFixed(1)}" y="${(Y(m.A) + 16).toFixed(1)}">${esc(/^mezz/i.test(m.id) ? m.id : 'Mezz ' + m.id)} · ${ftin(m.A)}</text>`; });
    (Wl.bays || []).forEach(b => {
      const x0 = lineX(b.from + 1) ?? null, x1 = lineX(b.to + 1) ?? null;
      if (x0 == null || x1 == null) return;
      if (b.braced) (b.braces.length ? b.braces : [{ bottom: 0, top: Wl.eave }]).forEach(t => {
        s += `<g class="we-x"><line x1="${X(x0).toFixed(1)}" y1="${Y(t.bottom).toFixed(1)}" x2="${X(x1).toFixed(1)}" y2="${Y(t.top).toFixed(1)}"/><line x1="${X(x0).toFixed(1)}" y1="${Y(t.top).toFixed(1)}" x2="${X(x1).toFixed(1)}" y2="${Y(t.bottom).toFixed(1)}"/></g>`;
      });
      (b.struts || []).filter(t => t.real || t.elev < Wl.eave - 0.01).forEach(t => { s += `<line class="we-strut" x1="${X(x0).toFixed(1)}" y1="${Y(t.elev).toFixed(1)}" x2="${X(x1).toFixed(1)}" y2="${Y(t.elev).toFixed(1)}"/>`; });
    });
    (Wl.strutsPlanned || []).forEach(t => { const x0 = lineX(t.from + 1), x1 = lineX(t.to + 1); if (x0 != null && x1 != null) s += `<line class="we-strut is-new" x1="${X(Math.min(x0, x1)).toFixed(1)}" y1="${Y(t.elev).toFixed(1)}" x2="${X(Math.max(x0, x1)).toFixed(1)}" y2="${Y(t.elev).toFixed(1)}"/><text class="we-sub we-new" x="${X((x0 + x1) / 2).toFixed(1)}" y="${(Y(t.elev) + 28).toFixed(1)}">new strut line ${ftin(t.elev)}</text>`; });
    // columns and line numbers
    Wl.lines.forEach(l => { s += `<line class="we-col" x1="${X(l.x).toFixed(1)}" y1="${Y(0).toFixed(1)}" x2="${X(l.x).toFixed(1)}" y2="${Y(Wl.eave).toFixed(1)}"/><circle class="we-bub" cx="${X(l.x).toFixed(1)}" cy="${(Y(0) + 20).toFixed(1)}" r="9"/><text class="we-bubt" x="${X(l.x).toFixed(1)}" y="${(Y(0) + 23.5).toFixed(1)}">${l.no}</text>`; });
    s += `<line class="we-ground" x1="${X(0) - 10}" y1="${Y(0)}" x2="${X(L) + 10}" y2="${Y(0)}"/>`;
    // the seismic loads: EQB + to the right, EQF − to the left, at the frame line and elevation
    (Wl.loads || []).forEach(q => {
      const x = lineX(q.line), z = Y(q.elev);
      if (x == null) return;
      const dir = q.F >= 0 ? 1 : -1, x0 = X(x) - dir * 54, x1 = X(x) - dir * 4;
      // the label above the arrow's tail, kept inside the drawing
      const tx = Math.min(Math.max(x0 + (dir > 0 ? 0 : 0), 60), Wpx - 60), lab = `${q.caseId} ${q.F >= 0 ? '+' : '−'}${Math.abs(q.F).toFixed(2)} k`;
      s += `<g class="we-load ${q.F >= 0 ? 'is-b' : 'is-f'}"><line x1="${x0.toFixed(1)}" y1="${z.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${z.toFixed(1)}" marker-end="url(#weArr)"/><text x="${tx.toFixed(1)}" y="${(z - 7 - (q.F >= 0 ? 0 : 14)).toFixed(1)}" text-anchor="middle">${esc(lab)}</text></g>`;
    });
    s += `<text class="we-title" x="${X(0)}" y="${padT - 10}">${esc(Wl.name)} · ${Wl.wall} · eave ${ftin(Wl.eave)}</text></svg>`;
    return s;
  }

  /* everything one frame line carries, for frameSvg and the load table: the balanced snow (ps × trib, PY), every
     step's drift and sliding snow on it, and what the page adds (roof dead / collateral k/ft, the mezzanine's frame rows,
     the seismic EQR / EQL, lean-to reactions). ext: { deadPsf, collPsf, mezz, eq, leanTo } */
  function frameData(J, name, no, ext = {}) {
    const b = J.site.buildings.find(q => q.name === name) || J.site.buildings[0];
    if (!b) return null;
    const fls = frameLines(b), fl = fls.find(q => q.no === no) || fls[0], roof = (J.roofs || []).find(r => r.name === b.name);
    const drift = [], sliding = [];
    let step = null;
    (J.drifts || []).filter(d => d.lower === b.name && !d.off).forEach(d => {
      const line = d.frames.find(q => q.frame === fl.no);
      if (!line) return;
      line.segs.forEach(sg => (sg.kind === 'sliding' ? sliding : drift).push({ ...sg, step: d.key }));
      if (d.kind === 'side' && !step) {
        const wallY = d.lowerWall === 'FSW' ? 0 : b.g.width, low = SITE.roofZ(b.g, fl.x, wallY);
        step = { side: d.lowerWall, upperName: d.upper, h: line.h, upperEave: low + line.h, gov: line.drift && line.drift.gov, drift: line.drift, rake: d.upperWall === 'LEW' || d.upperWall === 'REW' };
      }
    });
    const trib = fl.trib;
    return {
      g: b.g, name: b.name, frame: fl.no, x: fl.x, trib, cols: fl.cols, type: fl.type, end: fl.end, step,
      loads: {
        dead: ext.deadPsf > 0 ? ext.deadPsf * trib / 1000 : 0, coll: ext.collPsf > 0 ? ext.collPsf * trib / 1000 : 0,
        snow: roof ? { ps: roof.ps, kft: roof.ps * trib / 1000, hb: roof.ps / roof.gamma, gamma: roof.gamma, pm: roof.pm } : null,
        drift, sliding, mezz: ext.mezz || [], eq: ext.eq || [], leanTo: ext.leanTo || [],
      },
    };
  }

  const api = { ftin, frameEntry, columnsOf, frameLines, frameData, scene, planSvg, frameSvg, wallSvg };
  if (node) module.exports = api; else root.MZ_BUILDING = api;
})(typeof self !== 'undefined' ? self : this);
