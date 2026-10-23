/* The whole building, drawn: the site in 3D (every building's tapered frames, endwall posts, roofs with the snow and the
   drift on them, mezzanines, bracing), the site plan (frame lines, walls, braced bays, mezzanines, roof steps and their
   drift), one frame line in elevation with every load that goes on it, a sidewall in elevation with its bracing, strut
   lines and the mezzanine's EQB / EQF, and a section through a roof step with the drift worked on it.
   Pure functions: a scene for model3d.js or an SVG string; the page wires them up (src/app-building.js). */
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
  const k2 = v => (v == null || !isFinite(v) ? '—' : (Math.abs(v) < 0.005 ? 0 : v).toFixed(2));
  const r1 = v => (v == null || !isFinite(v) ? '—' : (+v).toFixed(1));
  const f1 = v => (+v).toFixed(1);
  const same = (a, b) => SITE.bkey(a) === SITE.bkey(b);
  const mezzName = id => (/^mezz/i.test(String(id)) ? String(id) : 'Mezz ' + id);

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
  // the endwall posts (wind columns) along an end frame, from Box 2's endwall column spacing
  function endPosts(g, end) {
    const sp = end === 'LEW' ? g.lewCols : end === 'REW' ? g.rewCols : null, W = g.width, ys = [];
    if (!sp || sp.length < 2) return ys;
    let y = 0;
    sp.slice(0, -1).forEach(s => { y += s; if (y > 0.3 && y < W - 0.3) ys.push(+y.toFixed(4)); });
    return ys;
  }
  // the knee depth drawn for a frame of this span (ft): a rigid frame's tapers with the span, a post-and-beam line's beam stays shallow
  const memberDepth = (W, rigid) => (rigid ? Math.min(3.4, Math.max(1.3, 0.6 + 0.024 * W)) : Math.min(1.6, Math.max(0.9, 0.5 + 0.01 * W)));
  // a rigid frame (tapered columns and rafters) or a post-and-beam line (straight posts and a beam)
  const isRigid = type => !/post|beam|\bEMS\b|\bPB\b/i.test(type || '');
  // each frame line of one building: number, x, tributary strip, type, columns, endwall posts
  function frameLines(b) {
    const xs = b.xs, n = xs.length;
    return xs.map((x, i) => {
      const fr = frameEntry(b.frames, i + 1), end = i === 0 ? 'LEW' : i === n - 1 ? 'REW' : null;
      const a = i === 0 ? x : (xs[i - 1] + x) / 2, c = i === n - 1 ? x : (x + xs[i + 1]) / 2;
      const cols = columnsOf(b.g, fr);
      return { no: i + 1, x, trib: c - a, strip: [a, c], entry: fr, type: fr ? fr.type : null, end, cols, rigid: isRigid(fr ? fr.type : ''), posts: end ? endPosts(b.g, end).filter(y => !cols.some(c2 => Math.abs(c2 - y) < 0.3)) : [] };
    });
  }

  /* ---------- 3D: the site ---------- */
  const COL = { col: '#8fa9c2', raf: '#9db5cb', post: '#6d8aa5', roof: '#5a7b9b', wall: '#5d7489', mezz: '#42e5ae', snow: '#f3f8ff', drift: '#e6f2ff', step: '#f6c779', brace: '#f6c779', purlin: '#a9cbe0' };
  const V = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k], unit: a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; } };
  /* an I-shaped member from p0 to p1 as three quads: the web in the plane of the member and the web direction up0 / up1
     (unit, the direction the depth is measured in at each end), depth d0 → d1, flanges bf wide along `across` */
  function iFaces(p0, p1, up0, up1, d0, d1, across, bf) {
    const q0 = V.add(p0, V.mul(up0, d0)), q1 = V.add(p1, V.mul(up1, d1)), h = V.mul(across, bf / 2);
    const flange = (a, c) => [V.sub(a, h), V.sub(c, h), V.add(c, h), V.add(a, h)];
    return [[p0, p1, q1, q0], flange(p0, p1), flange(q0, q1)];
  }
  /* site: snowJob(…).site; extra: { mezz: [{ building, id, x0, x1, y0, y1, A, cols: [{x, y}] }], mezzDetailed (the
     mezzanine members come from the mezzanine model — no posts drawn here), snow: true, purlin: spacing,
     bracing: { [name]: { FSW: [{ from, to, tiers: [[z0, z1]], kind: 'x' | 'portal' }], BSW, LEW, REW } } } */
  function scene(J, extra = {}) {
    const site = J.site, members = [], labels = [], floor = [];
    let zTop = 0;
    const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: 0, z1: 0 };
    const grow = (x, y, z) => { box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y); zTop = Math.max(zTop, z); };
    const roofOf = n => (J.roofs || []).find(r => r.name === n);
    const bx = (p, w, z0, z1) => ({ x0: p[0] - w, x1: p[0] + w, y0: p[1] - w, y1: p[1] + w, z0, z1 });
    site.buildings.forEach(b => {
      const g = b.g, W = g.width, L = g.length, S = (x, y, z) => { const p = b.toSite([x, y]); return [p[0], p[1], z]; };
      const brk = SITE.roofBreaks(g), Z = (x, y) => SITE.roofZ(g, x, y);
      const pre = site.buildings.length > 1 ? b.name + ' · ' : '';
      // the building's own directions on the site (a quarter-turn placement keeps them on the axes)
      const o = S(0, 0, 0), ex = V.unit(V.sub(S(1, 0, 0), o)), ey = V.unit(V.sub(S(0, 1, 0), o)), dn = [0, 0, -1];
      const big = Math.min(1.4, Math.max(0.8, 0.7 + W / 200));   // posts and flanges in proportion to the building
      frameLines(b).forEach(fl => {
        const rigid = fl.rigid, dK = memberDepth(W, rigid), dB = rigid ? dK * 0.42 : dK * 0.9, dR = rigid ? dK * 0.58 : dK, bf = 0.7 * big;
        const depthAt = y => (y < 0.05 || y > W - 0.05 ? dK : fl.cols.some(c => Math.abs(c - y) < 0.05) ? dK * 0.85 : dR);
        // columns: tapered at the sidewalls (outer flange on the steel line), straight inside a multi-span frame
        fl.cols.forEach(y => {
          const h = Z(fl.x, y), p = b.toSite([fl.x, y]);
          const ref = { type: 'frameCol', building: b.name, frame: fl.no, y };
          if (y < 0.05 || y > W - 0.05) {
            const inward = y < 0.05 ? ey : V.mul(ey, -1);
            members.push({ id: `${pre}${fl.no}/${y.toFixed(1)}`, kind: 'frame', color: COL.col, faces: iFaces(S(fl.x, y, 0), S(fl.x, y, h), inward, inward, dB, dK, ex, bf), ref });
          } else members.push({ id: `${pre}${fl.no}/${y.toFixed(1)}`, kind: 'frame', color: COL.col, boxes: [bx(p, 0.42 * big, 0, h - dK * 0.85)], ref });
          grow(p[0], p[1], h);
        });
        // endwall posts between the frame columns
        fl.posts.forEach(y => { const p = b.toSite([fl.x, y]); members.push({ id: `${pre}${fl.no} post ${y.toFixed(1)}`, kind: 'frame', color: COL.post, boxes: [bx(p, 0.26 * big, 0, Z(fl.x, y) - 0.5)], ref: { type: 'frameCol', building: b.name, frame: fl.no, y, post: true } }); });
        // the rafter: deep at the knees, shallower at the ridge, its top flange on the roof line
        const faces = [];
        for (let i = 0; i + 1 < brk.length; i++) {
          const y0 = brk[i], y1 = brk[i + 1];
          faces.push(...iFaces(S(fl.x, y0, Z(fl.x, y0)), S(fl.x, y1, Z(fl.x, y1)), dn, dn, depthAt(y0), depthAt(y1), ex, bf));
        }
        members.push({ id: `${pre}Frame ${fl.no}`, kind: 'frame', color: COL.raf, faces, ref: { type: 'frame', building: b.name, frame: fl.no } });
        const lp = b.toSite([fl.x, -6]);
        labels.push({ p: [lp[0], lp[1], 0], text: String(fl.no), kind: 'bubble' });
      });
      // roof planes: steel panels, a little above the rafter flanges; the eave and rake lines; the wall outline on the floor
      for (let i = 0; i + 1 < brk.length; i++) {
        const y0 = brk[i], y1 = brk[i + 1], zr = (x, y) => Z(x, y) + 0.2;
        members.push({ id: `${pre}roof ${i + 1}`, kind: 'roof', color: COL.roof, alpha: 0.8, faces: [[S(0, y0, zr(0, y0)), S(L, y0, zr(L, y0)), S(L, y1, zr(L, y1)), S(0, y1, zr(0, y1))]], ref: { type: 'roof', building: b.name } });
      }
      const edge = [[S(0, 0, Z(0, 0) + 0.2), S(L, 0, Z(L, 0) + 0.2)], [S(0, W, Z(0, W) + 0.2), S(L, W, Z(L, W) + 0.2)]];
      for (let i = 0; i + 1 < brk.length; i++) [0, L].forEach(x => edge.push([S(x, brk[i], Z(x, brk[i]) + 0.2), S(x, brk[i + 1], Z(x, brk[i + 1]) + 0.2)]));
      if (brk.length > 2) edge.push([S(0, brk[1], Z(0, brk[1]) + 0.2), S(L, brk[1], Z(L, brk[1]) + 0.2)]);
      members.push({ id: `${pre}edges`, kind: 'roof', color: '#c9dcea', width: 1.1, alpha: 0.7, lines: edge });
      b.corners.forEach((p, i, arr) => { const q = arr[(i + 1) % 4]; floor.push([[p[0], p[1], 0], [q[0], q[1], 0], 'rgba(140,200,235,.35)', false]); });
      const mid = b.toSite([L / 2, W / 2]);
      labels.push({ p: [mid[0], mid[1], Z(L / 2, W / 2) + 4], text: b.name, kind: 'text', color: '#cfe6f7' });
      // balanced snow on the roof: a white layer ps / γ deep, with its edges along the eaves and rakes
      const rf = roofOf(b.name);
      if (extra.snow !== false && rf && rf.ps > 0) {
        const hb = rf.ps / rf.gamma, zs = (x, y) => Z(x, y) + 0.25, zt = (x, y) => zs(x, y) + hb, fc = [];
        for (let i = 0; i + 1 < brk.length; i++) {
          const y0 = brk[i], y1 = brk[i + 1];
          fc.push([S(0, y0, zt(0, y0)), S(L, y0, zt(L, y0)), S(L, y1, zt(L, y1)), S(0, y1, zt(0, y1))]);
          [0, L].forEach(x => fc.push([S(x, y0, zs(x, y0)), S(x, y1, zs(x, y1)), S(x, y1, zt(x, y1)), S(x, y0, zt(x, y0))]));
        }
        [0, W].forEach(y => fc.push([S(0, y, zs(0, y)), S(L, y, zs(L, y)), S(L, y, zt(L, y)), S(0, y, zt(0, y))]));
        members.push({ id: `${pre}snow`, kind: 'snow', color: COL.snow, alpha: 0.62, faces: fc, ref: { type: 'snow', building: b.name } });
      }
      // purlins along the length on each roof plane (toggle)
      const sp = extra.purlin || 5, pl = [];
      for (let i = 0; i + 1 < brk.length; i++) for (let y = brk[i] + sp; y < brk[i + 1] - 0.3; y += sp) pl.push([S(0, y, Z(0, y) + 0.12), S(L, y, Z(L, y) + 0.12)]);
      if (pl.length) members.push({ id: `${pre}purlins`, kind: 'purlin', color: COL.purlin, alpha: 0.55, width: 0.9, lines: pl });
      // the bracing: wall X-bracing (tiered where the file says), portal frames, roof X-bracing in the end bays
      const brc = (extra.bracing || {})[b.name] || {};
      const xs = b.xs;
      ['FSW', 'BSW'].forEach(w => (brc[w] || []).forEach(bay => {
        const y = w === 'FSW' ? 0 : W, xa = xs[bay.from], xb = xs[bay.to];
        if (xa == null || xb == null) return;
        const top = Math.min(Z(xa, y), Z(xb, y)) - 0.3;
        if (bay.kind === 'portal') {
          const in1 = xa + Math.min(1.2, (xb - xa) * 0.12), in2 = xb - Math.min(1.2, (xb - xa) * 0.12), zh = top - 1.4;
          members.push({ id: `${pre}${w} portal frame ${bay.from + 1}-${bay.to + 1}`, kind: 'brace', color: COL.brace, width: 3.4, alpha: 0.95, lines: [[S(in1, y, 0), S(in1, y, zh)], [S(in2, y, 0), S(in2, y, zh)], [S(in1, y, zh), S(in2, y, zh)], [S(in1, y, zh - 1.1), S(in2, y, zh - 1.1)]], ref: { type: 'brace', building: b.name, wall: w, kind: 'portal' } });
          const lp = b.toSite([(xa + xb) / 2, y]);
          labels.push({ p: [lp[0], lp[1], zh + 1.2], text: 'portal frame', kind: 'tag', color: COL.brace });
        } else {
          const tiers = bay.tiers && bay.tiers.length ? bay.tiers : [[0, top]];
          const xl = tiers.flatMap(([z0, z1]) => [[S(xa, y, z0), S(xb, y, z1)], [S(xa, y, z1), S(xb, y, z0)]]);
          if (tiers.length > 1) tiers.forEach(([, z1]) => { if (z1 < top - 0.1) xl.push([S(xa, y, z1), S(xb, y, z1)]); });
          members.push({ id: `${pre}${w} bracing ${bay.from + 1}-${bay.to + 1}`, kind: 'brace', color: COL.brace, width: 2.2, alpha: 0.95, lines: xl, ref: { type: 'brace', building: b.name, wall: w, kind: 'x' } });
        }
      }));
      ['LEW', 'REW'].forEach(w => (brc[w] || []).forEach(bay => {
        const x = w === 'LEW' ? 0 : L;
        if (bay.kind === 'roofx') {
          // roof rods in the end bay, each roof plane, from eave to ridge
          const xa = w === 'LEW' ? xs[0] : xs[xs.length - 2], xb = w === 'LEW' ? xs[1] : xs[xs.length - 1];
          if (xa == null || xb == null) return;
          const xl = [];
          for (let i = 0; i + 1 < brk.length; i++) { const y0 = brk[i], y1 = brk[i + 1]; xl.push([S(xa, y0, Z(xa, y0) + 0.3), S(xb, y1, Z(xb, y1) + 0.3)], [S(xa, y1, Z(xa, y1) + 0.3), S(xb, y0, Z(xb, y0) + 0.3)]); }
          members.push({ id: `${pre}${w} roof bracing`, kind: 'brace', color: COL.brace, width: 1.8, alpha: 0.9, lines: xl, ref: { type: 'brace', building: b.name, wall: w, kind: 'roofx' } });
        } else if (bay.kind === 'x' && bay.ys) {
          const [ya, yb] = bay.ys, top = Math.min(Z(x, ya), Z(x, yb)) - 0.3, tiers = bay.tiers && bay.tiers.length ? bay.tiers : [[0, top]];
          members.push({ id: `${pre}${w} bracing`, kind: 'brace', color: COL.brace, width: 2.2, alpha: 0.95, lines: tiers.flatMap(([z0, z1]) => [[S(x, ya, z0), S(x, yb, z1)], [S(x, ya, z1), S(x, yb, z0)]]), ref: { type: 'brace', building: b.name, wall: w, kind: 'x' } });
        }
      }));
    });
    // mezzanine floors (the designed members are added by the page when the mezzanine model has them)
    (extra.mezz || []).forEach(m => {
      const b = site.buildings.find(q => same(q.name, m.building)) || site.buildings[0];
      if (!b) return;
      const p = b.toSite([m.x0, m.y0]), q = b.toSite([m.x1, m.y1]);
      members.push({ id: 'Mezzanine ' + m.id, kind: 'mezz', color: COL.mezz, alpha: extra.mezzDetailed ? 0.2 : 0.38, boxes: [{ x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), y0: Math.min(p[1], q[1]), y1: Math.max(p[1], q[1]), z0: m.A - 0.5, z1: m.A }], ref: { type: 'mezz', id: m.id, building: b.name } });
      if (!extra.mezzDetailed) (m.cols || []).forEach((c, i) => { const s = b.toSite([c.x, c.y]); members.push({ id: `Mezz ${m.id} column ${i + 1}`, kind: 'mezz', color: '#ff9f7a', boxes: [bx(s, 0.33, 0, m.A - 0.5)], ref: { type: 'mezzCol', id: m.id } }); });
      labels.push({ p: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, m.A + 0.5], text: mezzName(m.id).toUpperCase(), kind: 'tag', color: '#69fac5' });
    });
    // drift wedges on the lower roofs: on top of the balanced layer, falling to it at w (or the far eave)
    if (extra.snow !== false) (J.drifts || []).forEach(d => {
      if (d.drift.none || d.off) return;
      const b = d.step.lower, g = b.g, gam = d.drift.gamma, hb = d.drift.hb, side = d.kind === 'side';
      const Z = (x, y) => SITE.roofZ(g, x, y) + 0.25;
      const sp = d.step.span, s0 = side ? Math.min(sp[0][0], sp[1][0]) : Math.min(sp[0][1], sp[1][1]), s1 = side ? Math.max(sp[0][0], sp[1][0]) : Math.max(sp[0][1], sp[1][1]);
      const faces = [], cuts = 12;
      for (let k = 0; k < cuts; k++) {
        const t0 = s0 + (s1 - s0) * k / cuts, t1 = s0 + (s1 - s0) * (k + 1) / cuts;
        const dr = t => { const pt = side ? [t, d.lowerWall === 'FSW' ? 0 : g.width] : [d.lowerWall === 'LEW' ? 0 : g.length, t]; return SNOW.stepDrift({ ed: J.facts.ed, pg: J.facts.pg, W2: J.facts.W2, psLower: d.psLower, luUpper: d.luUpper, luLower: d.luLower, lowerWidth: d.lowerWidth, s: d.s, h: d.step.hAt ? d.step.hAt(pt) : d.hMax }); };
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
      if (faces.length) members.push({ id: `Drift · ${d.lower}`, kind: 'drift', color: COL.drift, alpha: 0.86, faces, ref: { type: 'drift', key: d.key } });
      const mid = (s0 + s1) / 2, reach = Math.min(d.drift.w, side ? g.width : g.length);
      const lp = side ? b.toSite([mid, d.lowerWall === 'FSW' ? reach / 2 : g.width - reach / 2]) : b.toSite([d.lowerWall === 'LEW' ? reach / 2 : g.length - reach / 2, mid]);
      labels.push({ p: [lp[0], lp[1], SITE.roofZ(g, side ? mid : 0, side ? 0 : mid) + hb + d.drift.hd + 1.5], text: `drift ${r1(d.drift.pd)} psf`, kind: 'tag', color: COL.step });
    });
    if (!isFinite(box.x0)) { box.x0 = 0; box.x1 = 10; box.y0 = 0; box.y1 = 10; }
    box.x0 -= 8; box.y0 -= 8; box.x1 += 4; box.y1 += 4; box.z1 = zTop + 6;
    const groups = site.buildings.map(b => { const xs = b.corners.map(p => p[0]), ys = b.corners.map(p => p[1]); return { id: b.name, box: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: 0, z1: zTop } }; });
    // snow in the air over the site, blown from the higher roof toward the lower one where a drift forms
    let wind = [0, 0];
    const d0 = (J.drifts || []).find(d => !d.drift.none && !d.off);
    if (d0 && d0.step.upper) { const c = b => { const xs = b.corners.map(p => p[0]), ys = b.corners.map(p => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; }; const a = c(d0.step.upper), b2 = c(d0.step.lower), l = Math.hypot(b2[0] - a[0], b2[1] - a[1]) || 1; wind = [(b2[0] - a[0]) / l * 4, (b2[1] - a[1]) / l * 4]; }
    const flakes = extra.snow === false ? null : { box: { x0: box.x0 + 6, x1: box.x1 - 2, y0: box.y0 + 6, y1: box.y1 - 2, z0: 0.5, z1: zTop + 16 }, n: Math.min(260, Math.round((box.x1 - box.x0) * (box.y1 - box.y0) / 90)), wind };
    return { center: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, box.z1 / 2], radius: Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2, box, members, labels, floor, groups, flakes };
  }

  /* ---------- the site plan ---------- */
  /* opts: { mezz: [{ building, id, x0, x1, y0, y1 }], selected: { building, frame }, width, compact,
     bracing: { [name]: { FSW: [{ from, to, kind }], … } } } — clickable frame lines carry data-bldg / data-frame */
  function planSvg(J, opts = {}) {
    const site = J.site, Wd = opts.width || 980, compact = !!opts.compact;
    const xs = site.buildings.flatMap(b => b.corners.map(p => p[0])), ys = site.buildings.flatMap(b => b.corners.map(p => p[1]));
    if (!xs.length) return '<svg viewBox="0 0 100 40"></svg>';
    const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
    const pad = compact ? 44 : 56, sc = Math.min((Wd - 2 * pad) / Math.max(1, X1 - X0), (compact ? 300 : 520) / Math.max(1, Y1 - Y0)), H = (Y1 - Y0) * sc + 2 * pad;
    // plan view: x to the right, y up (the FSW at the bottom)
    const P = ([x, y]) => [pad + (x - X0) * sc, H - pad - (y - Y0) * sc];
    const pt = p => P(p).map(v => v.toFixed(1)).join(',');
    const f = v => (+v).toFixed(1);
    let out = `<svg viewBox="0 0 ${Wd} ${H.toFixed(0)}" class="site-plan${compact ? ' is-compact' : ''}" role="img" aria-label="Site plan: buildings, frame lines, walls, bracing, mezzanines and snow drifts"><defs>
      <pattern id="spHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" class="sp-hatch"/></pattern>
      <marker id="spArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="sp-arrhead"/></marker></defs>`;
    // a wall another building actually stands against (an attachment note alone can leave a gap: in line, past the end)
    const inPoly = (p, cs) => { let ins = false; for (let i = 0, j = cs.length - 1; i < cs.length; j = i++) { const [xi, yi] = cs[i], [xj, yj] = cs[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
    const takenMemo = new Map();
    const taken = (b, w) => {
      const k = b.name + '|' + w;
      if (!takenMemo.has(k)) {
        const sg = SITE.wallSeg(b.g, w);
        takenMemo.set(k, [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95].some(t => { const p = b.toSite([sg.p0[0] + (sg.p1[0] - sg.p0[0]) * t + sg.n[0] * 0.6, sg.p0[1] + (sg.p1[1] - sg.p0[1]) * t + sg.n[1] * 0.6]); return site.buildings.some(o => o !== b && inPoly(p, o.corners)); }));
      }
      return takenMemo.get(k);
    };
    const narrowSet = new Set(), outLabels = [];
    const bboxes = site.buildings.map(b => { const cs = b.corners.map(q => P(q)); return { name: b.name, r: [Math.min(...cs.map(q => q[0])) - 2, Math.min(...cs.map(q => q[1])) - 2, Math.max(...cs.map(q => q[0])) + 2, Math.max(...cs.map(q => q[1])) + 2] }; });
    site.buildings.forEach(b => {
      const g = b.g, W = g.width, L = g.length;
      out += `<g class="sp-bldg" data-bldg="${esc(b.name)}"><polygon points="${b.corners.map(pt).join(' ')}" class="sp-outline"/>`;
      // ridge(s) dashed
      SITE.roofBreaks(g).slice(1, -1).forEach(yr => { const a = P(b.toSite([0, yr])), c = P(b.toSite([L, yr])); out += `<line class="sp-ridge" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(c[0])}" y2="${f(c[1])}"/>`; });
      // braced bays on the walls: an X across the bay, a bar for a portal frame, rods across the end bay for roof bracing
      const brc = (opts.bracing || {})[b.name] || {};
      ['FSW', 'BSW'].forEach(w => (brc[w] || []).forEach(bay => {
        const y = w === 'FSW' ? 0 : W, xa = b.xs[bay.from], xb = b.xs[bay.to];
        if (xa == null || xb == null) return;
        const inw = (w === 'FSW' ? 1 : -1) * 7 / sc, a0 = P(b.toSite([xa, y])), a1 = P(b.toSite([xb, y])), c0 = P(b.toSite([xa, y + inw])), c1 = P(b.toSite([xb, y + inw]));
        if (bay.kind === 'portal') out += `<g class="sp-portal"><line x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}"/><text x="${f((c0[0] + c1[0]) / 2)}" y="${f((c0[1] + c1[1]) / 2 + 3.5)}">PF</text></g>`;
        else out += `<g class="sp-brace"><line x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(c1[0])}" y2="${f(c1[1])}"/><line x1="${f(c0[0])}" y1="${f(c0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}"/></g>`;
      }));
      ['LEW', 'REW'].forEach(w => (brc[w] || []).forEach(bay => {
        if (bay.kind === 'roofx') {
          const xa = w === 'LEW' ? b.xs[0] : b.xs[b.xs.length - 2], xb = w === 'LEW' ? b.xs[1] : b.xs[b.xs.length - 1];
          if (xa == null || xb == null) return;
          const q = [P(b.toSite([xa, 0])), P(b.toSite([xb, W])), P(b.toSite([xa, W])), P(b.toSite([xb, 0]))];
          out += `<g class="sp-roofx"><line x1="${f(q[0][0])}" y1="${f(q[0][1])}" x2="${f(q[1][0])}" y2="${f(q[1][1])}"/><line x1="${f(q[2][0])}" y1="${f(q[2][1])}" x2="${f(q[3][0])}" y2="${f(q[3][1])}"/></g>`;
        } else if (bay.kind === 'x' && bay.ys) {
          const x = w === 'LEW' ? 0 : L, inw = (w === 'LEW' ? 1 : -1) * 7 / sc, a0 = P(b.toSite([x, bay.ys[0]])), a1 = P(b.toSite([x, bay.ys[1]])), c0 = P(b.toSite([x + inw, bay.ys[0]])), c1 = P(b.toSite([x + inw, bay.ys[1]]));
          out += `<g class="sp-brace"><line x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(c1[0])}" y2="${f(c1[1])}"/><line x1="${f(c0[0])}" y1="${f(c0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}"/></g>`;
        }
      }));
      // frame-line bubbles outside the FSW, or the BSW when something is attached along the FSW
      const bubY = taken(b, 'FSW') && !taken(b, 'BSW') ? W + 12 / sc : -12 / sc, bubW = bubY > 0 ? W : 0;
      frameLines(b).forEach(fl => {
        const a = P(b.toSite([fl.x, 0])), c = P(b.toSite([fl.x, W])), sel = opts.selected && same(opts.selected.building, b.name) && opts.selected.frame === fl.no;
        const w0 = P(b.toSite([fl.x, bubW])), out1 = P(b.toSite([fl.x, bubY])), dx = out1[0] - w0[0], dy = out1[1] - w0[1];
        out += `<g class="sp-fl${sel ? ' is-sel' : ''}" data-bldg="${esc(b.name)}" data-frame="${fl.no}" tabindex="0" role="button" aria-label="${esc(b.name)} frame line ${fl.no}"><line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(c[0])}" y2="${f(c[1])}"/><line class="sp-hit" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(c[0])}" y2="${f(c[1])}"/><circle cx="${f(w0[0] + dx)}" cy="${f(w0[1] + dy)}" r="${compact ? 7.5 : 8.5}"/><text x="${f(w0[0] + dx)}" y="${f(w0[1] + dy + 3.4)}">${fl.no}</text></g>`;
      });
      // the wall names along each wall: inside the outline for the sidewalls (the bubbles sit outside), outside for the
      // endwalls unless another building stands there
      SITE.WALLS.forEach(w => {
        if (taken(b, w)) return;   // a wall shared with another building: the joint says it
        const sgm = SITE.wallSeg(g, w), inside = w === 'FSW' || w === 'BSW';
        const midL = [(sgm.p0[0] + sgm.p1[0]) / 2, (sgm.p0[1] + sgm.p1[1]) / 2], off = (inside ? -1 : 1) * 10 / sc;
        const m = P(b.toSite([midL[0] + sgm.n[0] * off, midL[1] + sgm.n[1] * off])), p0 = P(b.toSite(sgm.p0)), p1 = P(b.toSite(sgm.p1));
        let ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI;
        if (ang > 90 || ang < -90) ang += 180;
        out += `<text class="sp-wall" x="${f(m[0])}" y="${f(m[1] + 3.5)}" transform="rotate(${ang.toFixed(1)} ${f(m[0])} ${f(m[1])})">${w}</text>`;
      });
      // the name and size: in the top-left corner inside the outline; turned along a building drawn tall and narrow
      const cs = b.corners.map(q => P(q)), x0 = Math.min(...cs.map(q => q[0])), y0 = Math.min(...cs.map(q => q[1])), bw = Math.max(...cs.map(q => q[0])) - x0, bh = Math.max(...cs.map(q => q[1])) - y0;
      const dr = (J.drifts || []).find(d => same(d.lower, b.name) && !d.drift.none && !d.off);
      const topStep = dr && dr.kind === 'side' && P(b.toSite(SITE.wallSeg(g, dr.lowerWall).p0))[1] < y0 + bh / 2 ? Math.min(dr.drift.w, dr.lowerWidth) * sc + 4 : 0;
      const dimT = `${ftin(W)} × ${ftin(L)} · ${g.profile || ''}`, need = Math.max(7.6 * b.name.length, 6.4 * dimT.length) + 24;
      // a drift band too narrow on the drawing to hold its label: the label goes with the building's name
      const dsp = dr ? dr.step.span : null, dLen = dsp ? Math.hypot(...[0, 1].map(k => P(b.toSite(dsp[1]))[k] - P(b.toSite(dsp[0]))[k])) : 0;
      const narrow = !!dr && !compact && (Math.min(dr.drift.w, dr.lowerWidth) * sc < 15 || dLen < 200);
      if (narrow) narrowSet.add(b.name);
      const dT = dr ? `drift ${r1(dr.drift.pd)} psf · w ${ftin(dr.drift.w)}${dr.sliding && dr.sliding.applies ? ` · sliding ${r1(dr.sliding.psf)} psf` : ''}` : '';
      if (bw >= need && bh >= 44 + topStep) {
        const nx = x0 + 14, ny = y0 + 22 + topStep;
        out += `<text class="sp-name sp-name-corner" x="${f(nx)}" y="${f(ny)}">${esc(b.name)}</text><text class="sp-dim sp-dim-corner" x="${f(nx)}" y="${f(ny + 14)}">${esc(dimT)}</text>${narrow ? `<text class="sp-dlab sp-dlab-out" x="${f(nx)}" y="${f(ny + 29)}">${esc(dT)}</text>` : ''}</g>`;
      } else if (bh >= need && bw >= 40) {
        const cx = x0 + bw / 2 - 2, cy = y0 + bh / 2;
        out += `<g transform="rotate(-90 ${f(cx)} ${f(cy)})"><text class="sp-name" x="${f(cx)}" y="${f(cy - 2)}">${esc(b.name)}</text><text class="sp-dim" x="${f(cx)}" y="${f(cy + 12)}">${esc(dimT)}</text>${narrow ? `<text class="sp-dlab" x="${f(cx)}" y="${f(cy + 27)}">${esc(dT)}</text>` : ''}</g></g>`;
      } else {
        // too small on the drawing: the name beside it, outside the outline, with a leader — right, above, left or
        // below, the first spot clear of the other buildings and the names already placed
        const lh = dr && !compact ? 34 : 20, hitAny = r => [...bboxes.filter(q => q.name !== b.name).map(q => q.r), ...outLabels].some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
        const cand = [
          { nx: x0 + bw + 12, ny: y0 + 14, lx: x0 + bw, ly: y0 + 10, ex: x0 + bw + 9, ey: y0 + 10 },
          { nx: x0, ny: y0 - lh - 6 + 12, lx: x0 + 8, ly: y0, ex: x0 + 8, ey: y0 - 6 },
          { nx: x0 - 12 - need, ny: y0 + 14, lx: x0, ly: y0 + 10, ex: x0 - 9, ey: y0 + 10 },
          { nx: x0, ny: y0 + bh + 30, lx: x0 + 8, ly: y0 + bh, ex: x0 + 8, ey: y0 + bh + 18 },
        ].filter(c => c.nx >= 2 && c.nx + need <= Wd - 2 && c.ny - 12 >= 2 && c.ny + lh - 12 <= H - 2);
        const c = cand.find(q => !hitAny([q.nx, q.ny - 12, q.nx + need, q.ny + lh - 12])) || cand[0] || { nx: x0, ny: y0 + bh + 30, lx: x0 + 8, ly: y0 + bh, ex: x0 + 8, ey: y0 + bh + 18 };
        outLabels.push([c.nx, c.ny - 12, c.nx + need, c.ny + lh - 12]);
        out += `<line class="sp-leader" x1="${f(c.lx)}" y1="${f(c.ly)}" x2="${f(c.ex)}" y2="${f(c.ey)}"/><text class="sp-name sp-name-corner" x="${f(c.nx)}" y="${f(c.ny)}">${esc(b.name)}</text><text class="sp-dim sp-dim-corner" x="${f(c.nx)}" y="${f(c.ny + 14)}">${esc(dimT)}</text>${dr && !compact ? `<text class="sp-dlab sp-dlab-out" x="${f(c.nx)}" y="${f(c.ny + 29)}">${esc(dT)}</text>` : ''}</g>`;
        narrowSet.add(b.name);
      }
    });
    (opts.mezz || []).forEach(m => {
      const b = site.buildings.find(q => same(q.name, m.building)) || site.buildings[0];
      if (!b) return;
      const p = P(b.toSite([m.x0, m.y0])), q = P(b.toSite([m.x1, m.y1]));
      const x = Math.min(p[0], q[0]), y = Math.min(p[1], q[1]), w = Math.abs(q[0] - p[0]), h = Math.abs(q[1] - p[1]);
      const lab = `${mezzName(m.id)}${m.A != null && !compact ? ` · ${ftin(m.A)}` : ''}`;
      out += `<g class="sp-mezz"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="url(#spHatch)"/><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" class="sp-mezz-edge"/><text x="${f(x + w / 2)}" y="${f(y + h / 2 + 4)}">${esc(lab)}</text></g>`;
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
        const g0 = q[0], g1 = q[3], id = 'spDr' + d.k + (compact ? 'c' : '');
        out += `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(g0[0])}" y1="${f(g0[1])}" x2="${f(g1[0])}" y2="${f(g1[1])}"><stop offset="0" stop-color="var(--amber)" stop-opacity=".62"/><stop offset="1" stop-color="var(--amber)" stop-opacity="${d.drift.truncated ? '.22' : '.03'}"/></linearGradient>`;
        out += `<g class="sp-drift" data-step="${esc(d.key)}"><polygon points="${q.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="url(#${id})"/>`;
        const mid = (s0 + s1) / 2, fromUp = d.drift.gov === 'leeward';
        const a0 = fromUp ? P(b.toSite(L2(mid, -Math.min(40, d.luUpper * 0.45)))) : P(b.toSite(L2(mid, Math.min(d.lowerWidth, 40) * 0.95)));
        const a1 = fromUp ? P(b.toSite(L2(mid, -4))) : P(b.toSite(L2(mid, reach * 0.55)));
        out += `<line class="sp-wind" x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}" marker-end="url(#spArr)"/>`;
        const bandPx = reach * sc, lenPx = Math.hypot(wallB[0] - wallA[0], wallB[1] - wallA[1]);
        void bandPx; void lenPx;
        if (!compact && !narrowSet.has(b.name)) {
          const lab = P(b.toSite(L2(mid, Math.min(reach, d.lowerWidth) * 0.42))), along = P(b.toSite(L2(s1, 0))), up = Math.abs(along[1] - wallA[1]) > Math.abs(along[0] - wallA[0]);
          out += `<text class="sp-dlab" x="${f(lab[0])}" y="${f(lab[1] + 4)}"${up ? ` transform="rotate(-90 ${f(lab[0])} ${f(lab[1] + 4)})"` : ''}>drift ${r1(d.drift.pd)} psf · w ${ftin(d.drift.w)}${d.drift.truncated ? ' (cut off)' : ''}</text>`;
        }
        out += '</g>';
      }
      if (!d.level) out += `<line class="sp-step${d.drift.none ? " is-none" : ""}" x1="${f(wallA[0])}" y1="${f(wallA[1])}" x2="${f(wallB[0])}" y2="${f(wallB[1])}"/>`;
    });
    if (!compact) out += `<text class="sp-key" x="${pad}" y="${(H - 14).toFixed(0)}">Plan · FSW at the bottom · ${esc(site.root || '')} LEW at the left · amber X: braced bay · PF: portal frame</text>`;
    out += '</svg>';
    return out;
  }

  /* ---------- one frame line in elevation, with its loads ----------
     F: { g, name, frame, x, trib, cols: [y], posts: [y], rigid, type, end, loads: { dead, coll (k/ft), snow: { ps, kft, pm, hb, gamma },
          drift: [segs], sliding: [segs], mezz: [{ y, elev, D, L, member, label }], eq: [{ y, at, F (null = waiting), member }],
          leanTo: [{ y, at, text }] }, step: { side, upperName, upperEave, h, rake } }
     Returns { svg, legend: [{ key, label }] } — every load in its own <g data-layer>. */
  function frameSvg(F) {
    const g = F.g, W = g.width, Zr = y => SITE.roofZ(g, F.x, y), brk = SITE.roofBreaks(g), ld = F.loads || {};
    const eaveMax = Math.max(Zr(0), Zr(W), ...brk.map(Zr)), stepH = F.step ? F.step.upperEave : 0;
    const extraL = F.step && F.step.side === 'FSW' ? Math.max(10, W * 0.28) : 0, extraR = F.step && F.step.side === 'BSW' ? Math.max(10, W * 0.28) : 0;
    const Hft = Math.max(eaveMax, stepH) + 2.5, padT = 150, padB = 64;
    const sc = Math.min(330 / Hft, 720 / (W + extraL + extraR));
    const used = (W + extraL + extraR) * sc, Wpx = Math.max(660, used + 300), padL = (Wpx - used) / 2, Hpx = Hft * sc + padT + padB;
    const X = y => padL + (y + extraL) * sc, Y = z => padT + (Hft - z) * sc;
    const f = v => (+v).toFixed(1), p = (y, z) => `${f(X(y))},${f(Y(z))}`;
    const legend = [], labels = [];
    const layer = (key, label, body) => { legend.push({ key, label }); return `<g class="fl-layer" data-layer="${key}">${body}</g>`; };
    // a label placed clear of the others already placed (moved up in steps)
    const place = (x, y, w, h = 15) => {
      let yy = y;
      for (let k = 0; k < 14 && labels.some(b => x - w / 2 < b[2] && x + w / 2 > b[0] && yy - h < b[3] && yy > b[1]); k++) yy -= h + 2;
      labels.push([x - w / 2, yy - h, x + w / 2, yy]);
      return yy;
    };
    const tw = t => 6.9 * String(t).length + 12;
    // a label's baseline from y, stepped by dy until it clears the labels already placed; then it is placed
    const spot = (x, y, w, dy) => {
      let yy = y;
      for (let k = 0; k < 8 && labels.some(b => x - w / 2 < b[2] && x + w / 2 > b[0] && yy - 12 < b[3] && yy + 4 > b[1]); k++) yy += dy;
      labels.push([x - w / 2, yy - 12, x + w / 2, yy + 4]);
      return yy;
    };
    const pill = (x, y, text, cls = '') => { const w = tw(text); return `<rect class="fe-pill" x="${f(x - w / 2)}" y="${f(y - 11.5)}" width="${f(w)}" height="15.5" rx="4"/><text class="fe-val ${cls}" x="${f(x)}" y="${f(y)}" text-anchor="middle">${esc(text)}</text>`; };
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx.toFixed(0)}" class="frame-elev" role="img" aria-label="${esc(F.name)} frame line ${F.frame} with its loads"><defs>
      <marker id="feArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker>
      <marker id="feArrS" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fe-snowhead"/></marker>
      <marker id="feArrD" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fe-drifthead"/></marker>
      <marker id="feArrM" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fe-mezzhead"/></marker>
      <marker id="feArrE" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fe-eqhead"/></marker>
      <marker id="feArrW" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fe-waithead"/></marker>
      <marker id="feArrL" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fe-leanhead"/></marker>
      <linearGradient id="feSnow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".96"/><stop offset="1" stop-color="#cfe6f7" stop-opacity=".8"/></linearGradient>
      <linearGradient id="feSteel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--steel)" stop-opacity=".95"/><stop offset="1" stop-color="var(--steel)" stop-opacity=".7"/></linearGradient>
      <clipPath id="feSky"><rect x="0" y="0" width="${Wpx}" height="${f(Y(0))}"/></clipPath></defs>`;
    // the higher building beside it, ghosted, with its eave
    if (F.step) {
      const yW = F.step.side === 'FSW' ? 0 : W, yo = F.step.side === 'FSW' ? -extraL : W + extraR, right = F.step.side !== 'FSW';
      // its name and heights beside it, on the open side, clear of the dashed outline and the drift
      const tx = right ? X(yo) + 10 : X(yo) - 10, ty = Y(stepH + (F.step.rise || 0) / 2) + 14, anc = right ? 'start' : 'end';
      s += `<g class="fe-upper"><polygon points="${p(yW, 0)} ${p(yW, stepH)} ${p(yo, stepH + (F.step.rise || 0))} ${p(yo, 0)}"/><text x="${f(tx)}" y="${f(ty)}" style="text-anchor:${anc}">${esc(F.step.upperName)}</text><text class="fe-dim" x="${f(tx)}" y="${f(ty + 16)}" style="text-anchor:${anc}">${F.step.rake ? 'at the wall' : 'eave'} ${ftin(stepH)}</text><text class="fe-dim" x="${f(tx)}" y="${f(ty + 32)}" style="text-anchor:${anc}">step ${ftin(F.step.h)}</text></g>`;
    }
    // the frame itself: tapered columns (outer flange on the steel line) and a rafter deep at the knees, drawn as
    // filled members; interior columns of a multi-span frame straight; endwall posts light
    // member depths in proportion to the span (a 33 ft lean-to is not a 120 ft clear span)
    const rigid = F.rigid !== false, dK = memberDepth(W, rigid);
    const dB = rigid ? dK * 0.42 : dK * 0.9, dR = rigid ? dK * 0.58 : dK;
    const depthAt = y => (y < 0.05 || y > W - 0.05 ? dK : F.cols.some(c => Math.abs(c - y) < 0.05) ? dK * 0.85 : dR);
    let frame = '';
    (F.posts || []).forEach(y => { frame += `<rect class="fe-post" x="${f(X(y) - 2.2)}" y="${f(Y(Zr(y) - 0.4))}" width="4.4" height="${f(Y(0) - Y(Zr(y) - 0.4))}"/>`; });
    F.cols.forEach(y => {
      const zt = Zr(y);
      if (y < 0.05 || y > W - 0.05) {
        const dir = y < 0.05 ? 1 : -1;
        frame += `<polygon class="fe-mem fe-colm" points="${p(y, 0)} ${p(y, zt)} ${f(X(y) + dir * dK * sc)},${f(Y(zt - dK))} ${f(X(y) + dir * dB * sc)},${f(Y(0))}"/>`;
        frame += `<line class="fe-flange" x1="${f(X(y) + dir * dB * sc)}" y1="${f(Y(0))}" x2="${f(X(y) + dir * dK * sc)}" y2="${f(Y(zt - dK))}"/>`;
      } else {
        const w = Math.max(0.35, dK * 0.22) * sc;
        frame += `<rect class="fe-mem" x="${f(X(y) - w)}" y="${f(Y(zt - dK * 0.85))}" width="${f(2 * w)}" height="${f(Y(0) - Y(zt - dK * 0.85))}"/>`;
      }
      frame += `<rect class="fe-base" x="${f(X(y) - Math.max(7, dB * sc * 0.9))}" y="${f(Y(0) - 1.5)}" width="${f(2 * Math.max(7, dB * sc * 0.9))}" height="3.5" rx="1"/>`;
    });
    // the rafter: top edge on the roof line, bottom edge the depth below it at each break
    const top = brk.map(y => p(y, Zr(y))), bot = brk.slice().reverse().map(y => p(y, Zr(y) - depthAt(y)));
    frame += `<polygon class="fe-mem fe-rafm" points="${top.join(' ')} ${bot.join(' ')}"/>`;
    frame += `<polyline class="fe-flange" points="${brk.map(y => p(y, Zr(y) - depthAt(y))).join(' ')}"/>`;
    // dimensions: the width and the frame type under the frame, the eave heights at the columns, the wall names
    frame += `<g class="fe-dims"><line x1="${f(X(0))}" y1="${f(Y(0) + 30)}" x2="${f(X(W))}" y2="${f(Y(0) + 30)}"/><line x1="${f(X(0))}" y1="${f(Y(0) + 24)}" x2="${f(X(0))}" y2="${f(Y(0) + 36)}"/><line x1="${f(X(W))}" y1="${f(Y(0) + 24)}" x2="${f(X(W))}" y2="${f(Y(0) + 36)}"/><text x="${f((X(0) + X(W)) / 2)}" y="${f(Y(0) + 48)}">${ftin(W)}${F.type ? ' · ' + esc(F.type) : ''}</text>`;
    // the eave heights outside each column top — inside, under the rafter, on a side a higher building stands against
    const eaveLab = (y, out) => {
      const stepHere = F.step && (F.step.side === 'FSW' ? y === 0 : y === W), inward = stepHere ? -out : out, t = ftin(Zr(y)), w = 7.2 * t.length;
      const x = X(y) + inward * (stepHere ? dK * sc + 6 : 8), yy = Y(Zr(y)) + (stepHere ? dK * sc + 14 : -6);
      labels.push(inward < 0 ? [x - w, yy - 12, x, yy + 3] : [x, yy - 12, x + w, yy + 3]);   // the load labels keep clear of it
      return `<text class="fe-eave" x="${f(x)}" y="${f(yy)}" style="text-anchor:${inward < 0 ? 'end' : 'start'}">${t}</text>`;
    };
    frame += eaveLab(0, -1) + eaveLab(W, 1);
    frame += `<text class="fe-wall" x="${f(X(0))}" y="${f(Y(0) + 16)}">FSW</text><text class="fe-wall" x="${f(X(W))}" y="${f(Y(0) + 16)}">BSW</text></g>`;
    s += `<g class="fe-frame">${frame}</g>`;
    // the snow on the roof at true scale: the balanced depth, the drift wedge, sliding snow
    const hb = ld.snow && ld.snow.hb > 0 ? ld.snow.hb : 0, roofTop = y => Zr(y) + 0.2;
    const dSegs = ld.drift || [], sSegs = ld.sliding || [], gam = ld.snow ? ld.snow.gamma || 20 : 20, trib = F.trib || 1;
    const segVal = (segs, y) => segs.reduce((a, sg) => (y >= sg.from - 1e-6 && y <= sg.to + 1e-6 ? a - (sg.start + (sg.end - sg.start) * (sg.to === sg.from ? 0 : (y - sg.from) / (sg.to - sg.from))) : a), 0);
    const depthAtY = y => hb + (segVal(dSegs, y) + segVal(sSegs, y)) * 1000 / trib / gam;
    const keys = [...new Set([...brk, ...dSegs.flatMap(sg => [sg.from, sg.to]), ...sSegs.flatMap(sg => [sg.from, sg.to])].map(v => +(+v).toFixed(4)))].sort((a, b) => a - b);
    if (hb > 0 || dSegs.length || sSegs.length) {
      const topP = [], botP = [], eps = 1e-3;
      keys.forEach((y, i) => { topP.push(p(y, roofTop(y) + depthAtY(i ? y - eps : y + eps))); if (i && i < keys.length - 1) topP.push(p(y, roofTop(y) + depthAtY(y + eps))); botP.push(p(y, roofTop(y))); });
      s += layer('snowpack', 'Snow on the roof (true depth)', `<polygon class="fe-pack" points="${topP.join(' ')} ${botP.reverse().join(' ')}"/>`);
    }
    // the loads as bands stacked above the snow: dead + collateral, balanced snow, drift / sliding — each a filled band
    // with a few arrows, its value once, above the stack where it peaks
    const uni = v => (v > 0 ? [{ from: 0, to: W, start: -v, end: -v }] : []);
    const bands = [
      { key: 'dead', label: 'Roof dead + collateral', segs: uni((ld.dead || 0) + (ld.coll || 0)), cls: 'fe-dead', mk: 'feArr', unit: 'k/ft', name: 'D + C' },
      { key: 'snow', label: ld.snow ? `Roof snow ${r1(ld.snow.applied ?? ld.snow.ps)} psf` : 'Snow', segs: ld.snow && ld.snow.kft > 0 ? uni(ld.snow.kft) : [], cls: 'fe-snow', mk: 'feArrS', unit: 'k/ft', name: 'Snow' },
      { key: 'drift', label: 'Snow drift', segs: dSegs, cls: 'fe-drift', mk: 'feArrD', unit: 'k/ft', name: 'Snow Drift' },
      { key: 'sliding', label: 'Sliding snow', segs: sSegs, cls: 'fe-slide', mk: 'feArrD', unit: 'k/ft', name: 'Sliding Snow' },
    ].filter(b => b.segs.length);
    const kmax = Math.max(1e-9, ...bands.map(b => Math.max(...[...keys, ...b.segs.flatMap(sg => [sg.from, sg.to])].map(y => segVal(b.segs, y)))));
    const hpx = v => (v > 1e-9 ? 9 + 40 * v / kmax : 0);
    const n = Math.max(10, Math.min(26, Math.round(W / 2.5)));
    const samples = [...new Set([...Array.from({ length: n + 1 }, (_, i) => W * i / n), ...keys].map(v => +(+v).toFixed(4)))].sort((a, b) => a - b);
    const off = samples.map(() => 0), every = Math.max(1, Math.ceil(samples.length / 13));
    bands.forEach(b => {
      let body = '', run = [];
      const flush = () => { if (run.length > 1) body += `<polygon class="fe-band" points="${run.map(q => `${q[0]},${q[1]}`).join(' ')} ${run.slice().reverse().map(q => `${q[0]},${q[2]}`).join(' ')}"/><polyline class="fe-bandtop" points="${run.map(q => `${q[0]},${q[1]}`).join(' ')}"/>`; run = []; };
      samples.forEach((y, i) => {
        const v = segVal(b.segs, y), base = Y(roofTop(y) + depthAtY(y)) - 3 - off[i], tp = base - hpx(v);
        if (v > 1e-9) {
          run.push([f(X(y)), f(tp), f(base)]);
          if (i % every === 0 || i === samples.length - 1 || (i && segVal(b.segs, samples[i - 1]) <= 1e-9)) body += `<line x1="${f(X(y))}" y1="${f(tp)}" x2="${f(X(y))}" y2="${f(base - 1)}" marker-end="url(#${b.mk})"/>`;
        } else flush();
        off[i] += hpx(v) + (v > 1e-9 ? 4 : 0);
      });
      flush();
      b.body = body;
    });
    // the values: once per band segment, above the whole stack where it peaks
    bands.slice().reverse().forEach(b => {
      // a load made of several rows (the drift and sliding envelope) is labelled once, where it peaks
      if (b.segs.length > 1) {
        const peak = b.segs.reduce((m, sg) => Math.max(m, -sg.start, -sg.end), 0), at = (b.segs.find(sg => -sg.start === peak) || {}).from ?? (b.segs.find(sg => -sg.end === peak) || {}).to;
        const tx = `${b.name} up to ${k3(peak)} ${b.unit} · ${b.segs.length} rows`, w = tw(tx);
        const inside = samples.map((y, i) => (b.segs.some(sg => y >= sg.from - 1e-6 && y <= sg.to + 1e-6) ? Y(roofTop(y) + depthAtY(y)) - 3 - off[i] : Infinity));
        const x = Math.min(Math.max(X(at), w / 2 + 6), Wpx - w / 2 - 6), y0 = Math.min(...inside.filter(isFinite), padT) - 8;
        b.body += pill(x, place(x, y0, w), tx);
        return;
      }
      b.segs.forEach(sg => {
        const va = -sg.start, vb = -sg.end, at = va >= vb ? sg.from : sg.to;
        const inside = samples.map((y, i) => (y >= sg.from - 1e-6 && y <= sg.to + 1e-6 ? Y(roofTop(y) + depthAtY(y)) - 3 - off[i] : Infinity));
        const tx = `${b.name} ${k3(Math.max(va, vb))}${Math.abs(va - vb) > 1e-6 ? ` → ${k3(Math.min(va, vb))}` : ''} ${b.unit}`, w = tw(tx);
        const x = Math.min(Math.max(X(at), w / 2 + 6), Wpx - w / 2 - 6), y0 = Math.min(...inside.filter(isFinite), padT) - 8;
        b.body += pill(x, place(x, y0, w), tx);
      });
    });
    bands.forEach(b => { s += layer(b.key, b.label, `<g class="${b.cls}">${b.body}</g>`); });
    // the mezzanine's dead and live on the columns it bears on, at its floor; its seismic on the outside of the column
    if ((ld.mezz || []).length) {
      let m = '';
      ld.mezz.forEach(q => {
        const x = X(q.y), z = Y(q.elev), dir = q.y < W / 2 ? 1 : -1;
        m += `<line class="fe-floor" x1="${f(x + dir * 4)}" y1="${f(z)}" x2="${f(x + dir * 52)}" y2="${f(z)}"/>`;
        m += `<line x1="${f(x + dir * 15)}" y1="${f(z - 40)}" x2="${f(x + dir * 15)}" y2="${f(z - 3)}" marker-end="url(#feArrM)"/>`;
        // one pill, inside the drawing, clear of the other labels
        const tx = `${q.member || q.label || ''} · FDL ${k2(q.D)} · FLL ${k2(q.L)} k @ ${ftin(q.elev)}`, w = tw(tx);
        // under the floor line, inside the frame where it is open; stepped down past another label
        const px = Math.min(Math.max(x + dir * (w / 2 + 8), w / 2 + 6), Wpx - w / 2 - 6);
        m += pill(px, spot(px, z + 24, w, 19), tx, 'fe-mzv');
      });
      s += layer('mezz', 'Mezzanine dead / live', `<g class="fe-mezz">${m}</g>`);
    }
    if ((ld.eq || []).length) {
      let e = '';
      ld.eq.forEach(q => {
        const x = X(q.y), z = Y(q.at), dir = q.y < W / 2 ? -1 : 1, wait = q.F == null;
        const x0 = x + dir * 62, x1 = x + dir * 5;
        e += `<line class="${wait ? 'fe-waitline' : ''}" x1="${f(x0)}" y1="${f(z)}" x2="${f(x1)}" y2="${f(z)}" marker-end="url(#${wait ? 'feArrW' : 'feArrE'})"/>`;
        // under the arrow, outside the column, held inside the drawing
        const tx = wait ? `${q.member || ''} · EQR / EQL waiting on the Seismic page` : `${q.member || ''} · EQR +${k2(q.F)} · EQL −${k2(q.F)} k`, w = tw(tx);
        const px = Math.min(Math.max(x + dir * (w / 2 + 6), w / 2 + 6), Wpx - w / 2 - 6);
        e += pill(px, spot(px, z - 12, w, -19), tx, wait ? 'fe-wait' : 'fe-eqv');
      });
      s += layer('eq', 'Seismic EQR / EQL', `<g class="fe-eq">${e}</g>`);
    }
    /* a lean-to's reactions (NBG Frame's Add Frame Reactions): each on its host column at its location — the vertical
       down onto the column, the horizontal along the frame, the case and values in a pill clear of the rest. A lean-to
       against this end frame stands behind it: drawn ghosted between the columns its frame lines land on. */
    if ((ld.leanTo || []).length) {
      let e = '';
      const g = ld.leanGhost;
      if (g && g.y1 > g.y0) e += `<g class="fe-leanghost"><rect x="${f(X(g.y0))}" y="${f(Y(g.at))}" width="${f((g.y1 - g.y0) * sc)}" height="${f(Y(0) - Y(g.at))}" rx="2"/><text x="${f((X(g.y0) + X(g.y1)) / 2)}" y="${f((Y(g.at) + Y(0)) / 2)}">${esc(g.name)}</text><text class="fe-sub" x="${f((X(g.y0) + X(g.y1)) / 2)}" y="${f((Y(g.at) + Y(0)) / 2 + 15)}">lean-to behind this frame</text></g>`;
      ld.leanTo.forEach(q => {
        const x = X(q.y), z = Y(q.at), sx = q.X > 0 ? 1 : -1, hasH = Math.abs(q.X) > 0.0005;
        e += `<circle cx="${f(x)}" cy="${f(z)}" r="3.2"/><line x1="${f(x)}" y1="${f(z - 50)}" x2="${f(x)}" y2="${f(z - 5)}" marker-end="url(#feArrL)"/>`;
        if (hasH) e += `<line x1="${f(x - sx * 46)}" y1="${f(z)}" x2="${f(x - sx * 6)}" y2="${f(z)}" marker-end="url(#feArrL)"/>`;
        const tx = `${q.member} · ${q.caseName}  Y −${k2(q.V)}${hasH ? `  X ${q.X >= 0 ? '+' : '−'}${k2(Math.abs(q.X))}` : ''} k`, w = tw(tx);
        const px = Math.min(Math.max(x, w / 2 + 6), Wpx - w / 2 - 6);
        e += pill(px, place(px, z - 58, w), tx, 'fe-leanv');
      });
      s += layer('leanto', 'Lean-to reactions', `<g class="fe-lean">${e}</g>`);
    }
    // falling snow: flakes from above, blown toward the step when the frame carries its drift
    if (F.flakes !== false && (hb > 0 || dSegs.length)) {
      const N = 42, blow = F.step && dSegs.length ? (F.step.side === 'FSW' ? -1 : 1) : 0;
      let fl = '';
      for (let i = 0; i < N; i++) {
        const y = -extraL + ((i * 37) % 101) / 101 * (W + extraL + extraR), d = 5 + (i * 13) % 7, dl = -((i * 0.71) % d), r = 1.1 + (i % 3) * 0.5;
        fl += `<circle class="fe-flake" cx="${f(X(y))}" cy="6" r="${r.toFixed(1)}" style="--dx:${(blow * (30 + (i % 5) * 10)).toFixed(0)}px;--dy:${(Y(0) - 10).toFixed(0)}px;animation-duration:${d}s;animation-delay:${dl.toFixed(2)}s"/>`;
      }
      s += layer('flakes', 'Falling snow', `<g class="fe-flakes" clip-path="url(#feSky)">${fl}</g>`);
    }
    s += '</svg>';
    return { svg: s, legend };
  }

  /* ---------- a sidewall in elevation: bays, X-bracing (tiers), portal frames, strut lines, the mezzanine's EQB / EQF ----------
     Wl: { name, wall, length, eave, lines: [{ no, x }], bays: [{ from, to, braced, kind: 'x' | 'portal', braces: [{ bottom, top }],
           struts: [{ elev, real }], tierAt (a tier suggested at the mezzanine level) }], loads: [{ line, elev, F, caseId, wait }],
           mezz: [{ x0, x1, A, id }], strutsPlanned: [{ from, to, elev }], src, note } */
  function wallSvg(Wl) {
    const L = Wl.length, Hft = Wl.eave + 5, Wpx = 1000, padL = 40, padR = 40, padT = 30, padB = 54;
    const sc = Math.min((Wpx - padL - padR) / L, 230 / Hft), Hpx = Hft * sc + padT + padB;
    const X = x => padL + x * sc, Y = z => padT + (Hft - z) * sc, f = v => (+v).toFixed(1);
    const lineX = no => { const l = Wl.lines.find(q => q.no === no); return l ? l.x : null; };
    const tw = t => 6.6 * String(t).length + 12;
    const pill = (x, y, text, cls = '') => { const w = tw(text); return `<rect class="we-pill" x="${f(x - w / 2)}" y="${f(y - 11)}" width="${f(w)}" height="15" rx="4"/><text class="we-lab ${cls}" x="${f(x)}" y="${f(y)}">${esc(text)}</text>`; };
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx.toFixed(0)}" class="wall-elev" role="img" aria-label="${esc(Wl.name)} ${Wl.wall} bracing"><defs><marker id="weArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker><marker id="weArrW" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="we-waithead"/></marker></defs>`;
    s += `<rect class="we-wall" x="${X(0)}" y="${f(Y(Wl.eave))}" width="${f(L * sc)}" height="${f(Wl.eave * sc)}"/>`;
    // the mezzanine floor seen through the wall
    (Wl.mezz || []).forEach(m => { s += `<rect class="we-mezz" x="${f(X(m.x0))}" y="${f(Y(m.A) - 2)}" width="${f((m.x1 - m.x0) * sc)}" height="4"/>`; s += pill(X((m.x0 + m.x1) / 2), Y(m.A) + 20, `${mezzName(m.id)} · ${ftin(m.A)}`, 'we-mezzlab'); });
    (Wl.bays || []).forEach(b => {
      const x0 = lineX(b.from + 1) ?? null, x1 = lineX(b.to + 1) ?? null;
      if (x0 == null || x1 == null) return;
      if (b.braced && b.kind === 'portal') {
        const inset = Math.min(1.2, (x1 - x0) * 0.12), zh = Wl.eave - 1.4;
        s += `<g class="we-portal"><line x1="${f(X(x0 + inset))}" y1="${f(Y(0))}" x2="${f(X(x0 + inset))}" y2="${f(Y(zh))}"/><line x1="${f(X(x1 - inset))}" y1="${f(Y(0))}" x2="${f(X(x1 - inset))}" y2="${f(Y(zh))}"/><line x1="${f(X(x0 + inset))}" y1="${f(Y(zh))}" x2="${f(X(x1 - inset))}" y2="${f(Y(zh))}"/><line x1="${f(X(x0 + inset))}" y1="${f(Y(zh - 1.1))}" x2="${f(X(x1 - inset))}" y2="${f(Y(zh - 1.1))}"/></g>`;
        s += pill(X((x0 + x1) / 2), Y(zh) - 10, 'portal frame', 'we-brlab');
      } else if (b.braced) {
        const tiers = b.braces && b.braces.length ? b.braces : [{ bottom: 0, top: Wl.eave }];
        tiers.forEach(t => { s += `<g class="we-x"><line x1="${f(X(x0))}" y1="${f(Y(t.bottom))}" x2="${f(X(x1))}" y2="${f(Y(t.top))}"/><line x1="${f(X(x0))}" y1="${f(Y(t.top))}" x2="${f(X(x1))}" y2="${f(Y(t.bottom))}"/></g>`; });
        // a tier suggested at the mezzanine level: the X split there, dashed, with a strut
        if (b.tierAt != null && !tiers.some(t => Math.abs(t.top - b.tierAt) < 0.3 || Math.abs(t.bottom - b.tierAt) < 0.3)) {
          const A = b.tierAt;
          s += `<g class="we-x is-new"><line x1="${f(X(x0))}" y1="${f(Y(0))}" x2="${f(X(x1))}" y2="${f(Y(A))}"/><line x1="${f(X(x0))}" y1="${f(Y(A))}" x2="${f(X(x1))}" y2="${f(Y(0))}"/><line x1="${f(X(x0))}" y1="${f(Y(A))}" x2="${f(X(x1))}" y2="${f(Y(Wl.eave))}"/><line x1="${f(X(x0))}" y1="${f(Y(Wl.eave))}" x2="${f(X(x1))}" y2="${f(Y(A))}"/><line class="we-strut is-new" x1="${f(X(x0))}" y1="${f(Y(A))}" x2="${f(X(x1))}" y2="${f(Y(A))}"/></g>`;
          s += pill(X((x0 + x1) / 2), Y(A) - 10, `tier the X at ${ftin(A)}`, 'we-new');
        }
      }
      // the strut lines added to the model (Real), and the program's own below the eave in a braced bay (a tier's strut)
      (b.struts || []).filter(t => t.real || (b.braced && b.kind !== 'portal' && t.elev < Wl.eave - 0.01)).forEach(t => { s += `<line class="we-strut" x1="${f(X(x0))}" y1="${f(Y(t.elev))}" x2="${f(X(x1))}" y2="${f(Y(t.elev))}"/>`; });
    });
    (Wl.strutsPlanned || []).forEach(t => { const x0 = lineX(t.from + 1), x1 = lineX(t.to + 1); if (x0 != null && x1 != null) { s += `<line class="we-strut is-new" x1="${f(X(Math.min(x0, x1)))}" y1="${f(Y(t.elev))}" x2="${f(X(Math.max(x0, x1)))}" y2="${f(Y(t.elev))}"/>`; s += pill(X((x0 + x1) / 2), Y(t.elev) + 34, `new strut line at ${ftin(t.elev)}`, 'we-new'); } });
    // columns and line numbers, the eave strut along the top
    s += `<line class="we-eave" x1="${f(X(0))}" y1="${f(Y(Wl.eave))}" x2="${f(X(L))}" y2="${f(Y(Wl.eave))}"/>`;
    Wl.lines.forEach(l => { s += `<line class="we-col" x1="${f(X(l.x))}" y1="${f(Y(0))}" x2="${f(X(l.x))}" y2="${f(Y(Wl.eave))}"/><rect class="we-base" x="${f(X(l.x) - 5)}" y="${f(Y(0) - 1.5)}" width="10" height="3" rx="1"/><circle class="we-bub" cx="${f(X(l.x))}" cy="${f(Y(0) + 20)}" r="9"/><text class="we-bubt" x="${f(X(l.x))}" y="${f(Y(0) + 23.5)}">${l.no}</text>`; });
    // the seismic loads: EQB + to the right, EQF − to the left, at the frame line and elevation
    (Wl.loads || []).forEach(q => {
      const x = lineX(q.line), z = Y(q.elev);
      if (x == null) return;
      const dir = (q.F == null ? (q.caseId === 'EQF' ? -1 : 1) : q.F >= 0) ? 1 : -1, x0 = X(x) - dir * 56, x1 = X(x) - dir * 4;
      const tx = Math.min(Math.max(X(x) - dir * 30, 60), Wpx - 60), lab = q.F == null ? `${q.caseId} · waiting on Seismic` : `${q.caseId} ${q.F >= 0 ? '+' : '−'}${Math.abs(q.F).toFixed(2)} k`;
      s += `<g class="we-load ${q.F == null ? 'is-wait' : q.F >= 0 ? 'is-b' : 'is-f'}"><line x1="${f(x0)}" y1="${f(z)}" x2="${f(x1)}" y2="${f(z)}" marker-end="url(#${q.F == null ? 'weArrW' : 'weArr'})"/>${pill(tx, z - 9 - (dir < 0 ? 16 : 0), lab, q.F == null ? 'we-wait' : '')}</g>`;
    });
    s += `<text class="we-title" x="${X(0)}" y="${padT - 12}">${esc(Wl.name)} · ${Wl.wall} · eave ${ftin(Wl.eave)}${Wl.src ? ` · bracing from ${esc(Wl.src)}` : ''}</text>`;
    if (Wl.note) s += `<text class="we-note" x="${f(Wpx - padR)}" y="${padT - 12}">${esc(Wl.note)}</text>`;
    s += '</svg>';
    return s;
  }

  /* ---------- a section through a roof step: the drift worked on it ----------
     d: one of snowJob(…).drifts; opts: { marks: [{ x, label }] (frame lines or purlins, ft from the step) }. Across: to
     scale. Up: the snow at a scale of its own (it is a few feet against a step of tens), the step's wall broken where it
     would run off the drawing; every height is written on it. */
  function stepSvg(d, opts = {}) {
    const dr = d.drift, f = v => (+v).toFixed(1);
    if (!dr || dr.none) return `<svg viewBox="0 0 760 70" class="step-sec"><text class="ss-note" x="380" y="40" text-anchor="middle">No drift on this step: ${esc(dr ? dr.why : '')}</text></svg>`;
    const h = dr.h, hb = dr.hb, hd = dr.hd, w = dr.w, gam = dr.gamma, lw = d.lowerWidth, reach = Math.min(w, lw), endH = dr.truncated ? dr.end / gam : 0;
    const sl = d.sliding && d.sliding.applies && d.sliding.psf > 0 ? d.sliding : null, hs = sl ? sl.psf / gam : 0, ext = sl ? Math.min(sl.extent, lw) : 0;
    const xMax = Math.min(lw, Math.max(reach, ext) * 1.35 + 4), snowTop = hb + Math.max(hd, hs), broken = h > snowTop * 2.2;
    const zTop = broken ? snowTop * 1.9 : h * 1.08, Wpx = 760, padL = 178, padR = 30, padT = 70, padB = sl ? 84 : 66;
    const sx = (Wpx - padL - padR) / xMax, sy = 170 / zTop, Hpx = zTop * sy + padT + padB;
    const X = x => padL + x * sx, Y = z => padT + (zTop - z) * sy, upW = 140;
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx.toFixed(0)}" class="step-sec" role="img" aria-label="Section through the roof step with its drift"><defs><marker id="ssArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ss-arrhead"/></marker><marker id="ssDim" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ss-dimhead"/></marker></defs>`;
    // the higher building: its wall on the step line, broken above the snow when the step is tall
    const wallTop = broken ? zTop * 0.97 : h;
    s += `<rect class="ss-upper" x="${f(X(0) - upW)}" y="${f(Y(wallTop))}" width="${upW}" height="${f(Y(-0.6) - Y(wallTop))}"/>`;
    const yb = Y(snowTop * 1.45);
    if (broken) { s += `<path class="ss-break" d="M${f(X(0) - upW - 6)},${f(yb + 5)} L${f(X(0) - upW / 2 - 8)},${f(yb + 5)} l6,-10 l6,10 L${f(X(0) + 6)},${f(yb + 5)}"/><rect class="ss-gap" x="${f(X(0) - upW - 8)}" y="${f(yb - 1)}" width="${upW + 16}" height="5"/>`; }
    const ty = broken ? yb + 26 : Y(wallTop) + 20;
    s += `<text class="ss-name" x="${f(X(0) - upW / 2)}" y="${f(ty)}">${esc(d.upper || 'higher roof')}</text><text class="ss-sub" x="${f(X(0) - upW / 2)}" y="${f(ty + 15)}">step ${ftin(h)}</text><text class="ss-sub" x="${f(X(0) - upW / 2)}" y="${f(ty + 29)}">lu ${ftin(d.luUpper)}</text>`;
    // the lower roof, the balanced snow on it, the drift (and sliding snow) on that, the envelope the frames take
    s += `<line class="ss-roof" x1="${f(X(0))}" y1="${f(Y(0))}" x2="${f(X(xMax))}" y2="${f(Y(0))}"/>`;
    if (lw <= xMax + 1e-6) s += `<line class="ss-wall" x1="${f(X(lw))}" y1="${f(Y(0))}" x2="${f(X(lw))}" y2="${f(Y(-0.6))}"/>`;
    s += `<rect class="ss-balanced" x="${f(X(0))}" y="${f(Y(hb))}" width="${f(xMax * sx)}" height="${f(hb * sy)}"/>`;
    if (sl) s += `<rect class="ss-slide" x="${f(X(0))}" y="${f(Y(hb + hs))}" width="${f(ext * sx)}" height="${f(hs * sy)}"/>`;
    s += `<polygon class="ss-drift" points="${f(X(0))},${f(Y(hb))} ${f(X(0))},${f(Y(hb + hd))} ${f(X(reach))},${f(Y(hb + endH))} ${f(X(reach))},${f(Y(hb))}"/>`;
    if (sl && (d.envelope || []).length) s += `<polyline class="ss-env" points="${d.envelope.flatMap(e => [`${f(X(e.a))},${f(Y(hb + e.va / gam))}`, `${f(X(e.b))},${f(Y(hb + e.vb / gam))}`]).join(' ')}"/>`;
    // the wind that builds it
    const wy = Y(snowTop) - 26;
    s += dr.gov === 'leeward' ? `<line class="ss-wind" x1="${f(X(0) - upW + 8)}" y1="${f(Math.min(wy, Y(wallTop) - 12))}" x2="${f(X(0) + 26)}" y2="${f(Math.min(wy, Y(wallTop) - 12))}" marker-end="url(#ssArr)"/>`
      : `<line class="ss-wind" x1="${f(X(xMax) - 8)}" y1="${f(wy)}" x2="${f(X(reach * 0.5))}" y2="${f(wy)}" marker-end="url(#ssArr)"/>`;
    // dimensions: hd at the wall, hb at the far side, w (and the sliding run) under the roof
    const dim = (x1, y1, x2, y2, text, tx, ty, anchor = 'middle') => `<line class="ss-dim" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" marker-start="url(#ssDim)" marker-end="url(#ssDim)"/><text class="ss-dimt" x="${f(tx)}" y="${f(ty)}" text-anchor="${anchor}">${esc(text)}</text>`;
    s += dim(X(0) - 12, Y(hb), X(0) - 12, Y(hb + hd), `hd ${ftin(hd)}${dr.capped ? ' = hc' : ''}`, X(0) - 18, Y(hb + hd / 2) + 4, 'end');
    s += dim(X(xMax) - 8, Y(0), X(xMax) - 8, Y(hb), '', 0, 0) + `<text class="ss-dimt ss-end" x="${f(X(xMax) - 4)}" y="${f(Y(hb) - 7)}">hb ${ftin(hb)} (balanced ${r1(d.psLower)} psf)</text>`;
    s += dim(X(0), Y(0) + 26, X(reach), Y(0) + 26, dr.truncated ? `w ${ftin(w)} — cut off at the far eave, ${r1(dr.end)} psf there` : `w ${ftin(w)}`, X(reach / 2), Y(0) + 41);
    if (sl) s += dim(X(0), Y(0) + 50, X(ext), Y(0) + 50, `sliding ${ftin(ext)}`, X(ext / 2), Y(0) + 65);
    // the figures, top right: the peak and what governs
    const tx = X(xMax), lines = [`pd = hd γ = ${r1(dr.pd)} psf`, `${dr.gov} governs · γ ${gam.toFixed(2)} pcf · hc ${ftin(dr.hc)}`, `balanced ${r1(d.psLower)} psf → ${r1(dr.pd + d.psLower)} psf at the wall`];
    if (sl) lines.push(`sliding ${r1(sl.psf)} psf over ${ftin(ext)} — the larger of the two is carried (7.9)`);
    s += lines.map((t, i) => `<text class="${i ? 'ss-fig' : 'ss-peak'} ss-end" x="${f(tx)}" y="${f(20 + i * 15 + (i ? 4 : 0))}">${esc(t)}</text>`).join('');
    // the frame lines / purlins the drift falls across: ticks with their numbers; the values are listed under the drawing
    (opts.marks || []).filter(m => m.x >= -1e-6 && m.x <= xMax + 1e-6).forEach(m => { const x = X(m.x); s += `<line class="ss-tick" x1="${f(x)}" y1="${f(Y(0) - 4)}" x2="${f(x)}" y2="${f(Y(0) + 5)}"/><text class="ss-mark" x="${f(x)}" y="${f(Y(0) + 15)}" text-anchor="middle">${esc(m.short || m.label)}</text>`; });
    s += `<text class="ss-key" x="8" y="${f(Hpx - 8)}">Section through the step · ${d.kind === 'side' ? 'across the lower frames' : 'along the lower building'} · across to scale, the snow ×${(sy / sx).toFixed(1)} upward${broken ? ', the step wall broken' : ''}</text>`;
    s += '</svg>';
    return s;
  }

  /* everything one frame line carries, for frameSvg and the load table: the balanced snow (ps × trib, PY), every
     step's drift and sliding snow on it, and what the page adds (roof dead / collateral k/ft, the mezzanine's frame rows,
     the seismic EQR / EQL, lean-to reactions). ext: { deadPsf, collPsf, mezz, eq, leanTo } */
  function frameData(J, name, no, ext = {}) {
    const b = J.site.buildings.find(q => same(q.name, name)) || J.site.buildings[0];
    if (!b) return null;
    const fls = frameLines(b), fl = fls.find(q => q.no === no) || fls[0], roof = (J.roofs || []).find(r => same(r.name, b.name));
    const drift = [], sliding = [];
    let step = null;
    (J.drifts || []).filter(d => same(d.lower, b.name) && !d.off).forEach(d => {
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
      g: b.g, name: b.name, frame: fl.no, x: fl.x, trib, cols: fl.cols, posts: fl.posts, rigid: fl.rigid, type: fl.type, end: fl.end, step,
      loads: {
        dead: ext.deadPsf > 0 ? ext.deadPsf * trib / 1000 : 0, coll: ext.collPsf > 0 ? ext.collPsf * trib / 1000 : 0,
        // the uniform snow as NBG Frame applies it (override, else max(ps, pm)); hb, under the drift, from the balanced ps
        snow: roof ? { ps: roof.ps, applied: roof.applied ?? roof.ps, src: roof.appliedSrc || 'balanced ps', kft: (roof.applied ?? roof.ps) * trib / 1000, hb: roof.ps / roof.gamma, gamma: roof.gamma, pm: roof.pm } : null,
        drift, sliding, mezz: ext.mezz || [], eq: ext.eq || [], leanTo: ext.leanTo || [],
      },
    };
  }

  const api = { ftin, frameEntry, columnsOf, endPosts, frameLines, frameData, scene, planSvg, frameSvg, wallSvg, stepSvg, iFaces };
  if (node) module.exports = api; else root.MZ_BUILDING = api;
})(typeof self !== 'undefined' ? self : this);
