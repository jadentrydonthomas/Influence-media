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
  const COL = { col: '#8fa9c2', raf: '#9db5cb', post: '#6d8aa5', roof: '#5a7b9b', wall: '#5d7489', mezz: '#42e5ae', snow: '#f3f8ff', drift: '#e6f2ff', step: '#f6c779', brace: '#f6c779', strut: '#69fac5', newBrace: '#ff8f8f', purlin: '#a9cbe0' };
  // a point inside a polygon (site coordinates)
  const inPolyG = (p, cs) => { let ins = false; for (let i = 0, j = cs.length - 1; i < cs.length; j = i++) { const [xi, yi] = cs[i], [xj, yj] = cs[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
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
          labels.push({ p: [lp[0], lp[1], zh + 1.2], text: 'portal frame', kind: 'tag', color: COL.brace, toggle: 'brace' });
        } else {
          // tiers: the file's, or the tool's at the mezzanine level (its top open: to the eave)
          const tiers = bay.tiers && bay.tiers.length ? bay.tiers.map(([z0, z1]) => [z0, z1 == null ? top : Math.min(z1, top)]) : [[0, top]];
          const xl = tiers.flatMap(([z0, z1]) => [[S(xa, y, z0), S(xb, y, z1)], [S(xa, y, z1), S(xb, y, z0)]]);
          if (tiers.length > 1) tiers.forEach(([, z1]) => { if (z1 < top - 0.1) xl.push([S(xa, y, z1), S(xb, y, z1)]); });
          members.push({ id: `${pre}${w} bracing ${bay.from + 1}-${bay.to + 1}`, kind: 'brace', color: COL.brace, width: 2.2, alpha: 0.95, lines: xl, ref: { type: 'brace', building: b.name, wall: w, kind: 'x' } });
        }
      }));
      // the wall strut lines at the mezzanine level (through each bay but an untiered braced one)
      (brc.struts || []).forEach(t => {
        const y = t.wall === 'FSW' ? 0 : W, a = Math.min(t.from, t.to), c = Math.max(t.from, t.to), sl = [];
        for (let i = a; i < c; i++) if (xs[i] != null && xs[i + 1] != null && !(t.skip || []).includes(i)) sl.push([S(xs[i], y, t.elev), S(xs[i + 1], y, t.elev)]);
        if (sl.length) members.push({ id: `${pre}${t.wall} strut line ${a + 1}-${c + 1}`, kind: 'brace', color: COL.strut, width: 2.6, alpha: 0.95, lines: sl, ref: { type: 'brace', building: b.name, wall: t.wall, kind: 'strut' } });
      });
      // a mezzanine edge off the walls, braced as picked on the Bracing page: X-bracing, a portal frame or knee braces
      // between two columns on the line, from the floor to the mezzanine
      (brc.lines || []).forEach(l => {
        const y = l.y, a = l.u0, c = l.u1, A = l.A, id = `${pre}line ${l.label || y.toFixed(1)} ${l.kind}`, ref = { type: 'brace', building: b.name, line: l.label, kind: l.kind };
        let ls;
        if (l.kind === 'portal') ls = [[S(a, y, 0), S(a, y, A - 0.4)], [S(c, y, 0), S(c, y, A - 0.4)], [S(a, y, A - 0.4), S(c, y, A - 0.4)], [S(a, y, A - 1.6), S(c, y, A - 1.6)]];
        else if (l.kind === 'knee') { const k = Math.min(3, (c - a) / 4); ls = [[S(a, y, A - 0.5 - k), S(a + k, y, A - 0.5)], [S(c, y, A - 0.5 - k), S(c - k, y, A - 0.5)]]; }
        else if (l.kind === 'x') ls = [[S(a, y, 0), S(c, y, A - 0.5)], [S(a, y, A - 0.5), S(c, y, 0)]];
        else ls = [];
        if (ls.length) members.push({ id, kind: 'brace', color: COL.newBrace, width: l.kind === 'portal' ? 3.4 : 2.2, alpha: 0.95, lines: ls, ref });
        const lp = b.toSite([(a + c) / 2, y]);
        labels.push({ p: [lp[0], lp[1], A + 1.2], text: `${l.label ? 'line ' + l.label + ' · ' : ''}${({ x: 'X-bracing', portal: 'portal frame', knee: 'knee braces' })[l.kind] || 'bracing to design'}`, kind: 'tag', color: COL.newBrace, toggle: 'brace' });
      });
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
      if (!extra.mezzDetailed) (m.cols || []).filter(c => !c.portal).forEach((c, i) => { const s = b.toSite([c.x, c.y]); members.push({ id: `Mezz ${m.id} column ${i + 1}`, kind: 'mezz', color: '#ff9f7a', boxes: [bx(s, 0.33, 0, m.A - 0.5)], ref: { type: 'mezzCol', id: m.id } }); });
      labels.push({ p: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, m.A + 0.5], text: mezzName(m.id).toUpperCase(), kind: 'tag', color: '#69fac5', toggle: 'mezz' });
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
      labels.push({ p: [lp[0], lp[1], SITE.roofZ(g, side ? mid : 0, side ? 0 : mid) + hb + d.drift.hd + 1.5], text: `drift ${r1(d.drift.pd)} psf`, kind: 'tag', color: COL.step, toggle: 'snow' });
    });
    if (!isFinite(box.x0)) { box.x0 = 0; box.x1 = 10; box.y0 = 0; box.y1 = 10; }
    box.x0 -= 8; box.y0 -= 8; box.x1 += 4; box.y1 += 4; box.z1 = zTop + 6;
    const groups = site.buildings.map(b => { const xs = b.corners.map(p => p[0]), ys = b.corners.map(p => p[1]); return { id: b.name, box: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: 0, z1: zTop } }; });
    // snow in the air over the site, blown from the higher roof toward the lower one where a drift forms
    let wind = [0, 0];
    const d0 = (J.drifts || []).find(d => !d.drift.none && !d.off);
    if (d0 && d0.step.upper) { const c = b => { const xs = b.corners.map(p => p[0]), ys = b.corners.map(p => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; }; const a = c(d0.step.upper), b2 = c(d0.step.lower), l = Math.hypot(b2[0] - a[0], b2[1] - a[1]) || 1; wind = [(b2[0] - a[0]) / l * 4, (b2[1] - a[1]) / l * 4]; }
    // a flake over a building is over its roof (and the snow on it) or it starts again at the top: never inside
    const roofAt = (x, y) => {
      for (const b of site.buildings) {
        if (!inPolyG([x, y], b.corners)) continue;
        const o = b.toSite([0, 0]), ex = b.toSite([1, 0]), ey = b.toSite([0, 1]), a = [ex[0] - o[0], ex[1] - o[1]], c = [ey[0] - o[0], ey[1] - o[1]], det = a[0] * c[1] - a[1] * c[0] || 1;
        const dx = x - o[0], dy = y - o[1], lx = (dx * c[1] - dy * c[0]) / det, ly = (a[0] * dy - a[1] * dx) / det, rf = roofOf(b.name);
        return SITE.roofZ(b.g, lx, ly) + 0.5 + (rf && rf.ps > 0 ? rf.ps / rf.gamma : 0);
      }
      return null;
    };
    const flakes = extra.snow === false ? null : { box: { x0: box.x0 + 6, x1: box.x1 - 2, y0: box.y0 + 6, y1: box.y1 - 2, z0: 0.5, z1: zTop + 16 }, n: Math.min(260, Math.round((box.x1 - box.x0) * (box.y1 - box.y0) / 90)), wind, roofAt };
    return { center: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, box.z1 / 2], radius: Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2, box, members, labels, floor, groups, flakes };
  }

  /* ---------- the site plan ---------- */
  /* opts: { mezz: [{ building, id, x0, x1, y0, y1 }], selected: { building, frame }, width, compact,
     bracing: { [name]: { FSW: [{ from, to, kind }], … } } } — clickable frame lines carry data-bldg / data-frame */
  /* the grid letters of every building, one per line across the site (site: snowJob(…).site; letters: { [building]:
     { allY, label } } read off the PCS drawing): the letters read off the PCS drawing win; a line another building
     already lettered keeps its letter (a lean-to's joint, a building in line); the rest go on from the last letter
     used, outward from that joint (from the BSW when there is none). Returns Map building → { ys, lab: Map y → letter } */
  function siteLetters(site, letters) {
    const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ', gridLines = [], letterMap = new Map();
    const gridYs = b => {
      const GL = (letters || {})[b.name], W = b.g.width, fls = frameLines(b);
      return GL && GL.allY ? GL.allY.filter(y => y > -0.05 && y < W + 0.05) : [...new Set([0, W, ...fls.flatMap(fl => fl.cols), ...fls.flatMap(fl => fl.posts), ...((b.g.profile || '') === 'Gable' && b.g.ridge > 0 && b.g.ridge < W ? [SITE.ridgeY(b.g)] : [])].map(y => +(+y).toFixed(3)))];
    };
    const lineOf = (b, y) => { const a = b.toSite([0, y]), c = b.toSite([b.g.length, y]), l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return { p: a, d: [(c[0] - a[0]) / l, (c[1] - a[1]) / l] }; };
    const sameLine = (u, v) => Math.abs(u.d[0] * v.d[1] - u.d[1] * v.d[0]) < 0.01 && Math.abs((u.p[0] - v.p[0]) * v.d[1] - (u.p[1] - v.p[1]) * v.d[0]) < 0.5;
    const lineSets = new Map(site.buildings.map(b => [b.name, gridYs(b).map(y => lineOf(b, y))]));
    const touches = (b, o) => lineSets.get(b.name).some(u => lineSets.get(o.name).some(v => sameLine(u, v)));
    const order = site.buildings.filter(b => (letters || {})[b.name]), rest = site.buildings.filter(b => !order.includes(b));
    while (rest.length) { const k = Math.max(0, rest.findIndex(b => order.some(o => touches(b, o)))); order.push(rest.splice(k, 1)[0]); }
    order.forEach(b => {
      const GL = (letters || {})[b.name], ys = gridYs(b).sort((p, q) => q - p), lab = new Map();
      if (GL && GL.label) ys.forEach(y => lab.set(y, GL.label(y)));
      else {
        const shared = ys.map(y => { const s = gridLines.find(s2 => s2.b !== b.name && sameLine(lineOf(b, y), s2)); return s ? s.letter : null; });
        const k0 = shared.findIndex(Boolean), seq = ys.map((y, i) => i).sort((i, j) => (k0 < 0 ? i - j : Math.abs(i - k0) - Math.abs(j - k0)));
        seq.forEach(i => {
          if (shared[i]) { lab.set(ys[i], shared[i]); return; }
          const last = Math.max(-1, ...gridLines.map(s => ABC.indexOf(s.letter)), ...[...lab.values()].map(v => ABC.indexOf(v)));
          lab.set(ys[i], ABC[last + 1] || null);
        });
      }
      ys.forEach(y => { if (lab.get(y)) gridLines.push({ b: b.name, letter: lab.get(y), ...lineOf(b, y) }); });
      letterMap.set(b.name, { ys, lab });
    });
    return letterMap;
  }
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
      <marker id="spArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="sp-arrhead"/></marker>
      <marker id="spArrEq" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="sp-eqhead"/></marker></defs>`;
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
    const narrowSet = new Set(), outLabels = [], later = [];
    let mzRects = [];   // the mezzanines' outlines on the drawing: a name moved beside a small building keeps off them
    let top = '';   // names set outside their building, drawn over everything so the next building does not cover them
    const bboxes = site.buildings.map(b => { const cs = b.corners.map(q => P(q)); return { name: b.name, r: [Math.min(...cs.map(q => q[0])) - 2, Math.min(...cs.map(q => q[1])) - 2, Math.max(...cs.map(q => q[0])) + 2, Math.max(...cs.map(q => q[1])) + 2] }; });
    const letterMap = siteLetters(site, opts.letters), bubbles = [];
    const occ = [];   // the screen boxes taken by bubbles, names and wall labels, for the labels placed last to keep clear of
    // X-bracing on the plan: a small bold X
    const xGlyph = (cx, cy, r) => `<path class="sp-xg" d="M${f(cx - r)},${f(cy - r)} L${f(cx + r)},${f(cy + r)} M${f(cx - r)},${f(cy + r)} L${f(cx + r)},${f(cy - r)}"/>`;
    site.buildings.forEach(b => {
      const g = b.g, W = g.width, L = g.length;
      out += `<g class="sp-bldg" data-bldg="${esc(b.name)}"><polygon points="${b.corners.map(pt).join(' ')}" class="sp-outline"/>`;
      // ridge(s) dashed
      SITE.roofBreaks(g).slice(1, -1).forEach(yr => { const a = P(b.toSite([0, yr])), c = P(b.toSite([L, yr])); out += `<line class="sp-ridge" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(c[0])}" y2="${f(c[1])}"/>`; });
      // braced bays on the walls: an X across the bay, a bar for a portal frame, rods across the end bay for roof bracing
      const brc = (opts.bracing || {})[b.name] || {}, wallTags = [];
      ['FSW', 'BSW'].forEach(w => (brc[w] || []).forEach(bay => {
        const y = w === 'FSW' ? 0 : W, xa = b.xs[bay.from], xb = b.xs[bay.to];
        if (xa == null || xb == null) return;
        const inw = (w === 'FSW' ? 1 : -1) * 7 / sc, a0 = P(b.toSite([xa, y])), a1 = P(b.toSite([xb, y])), c0 = P(b.toSite([xa, y + inw])), c1 = P(b.toSite([xb, y + inw]));
        if (bay.kind === 'portal') { const tx = (c0[0] + c1[0]) / 2, ty = (c0[1] + c1[1]) / 2; wallTags.push([tx - 9, ty - 5, tx + 9, ty + 5]); occ.push(wallTags[wallTags.length - 1]); }
        if (bay.kind === 'portal') out += `<g class="sp-portal"><line x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}"/><text x="${f((c0[0] + c1[0]) / 2)}" y="${f((c0[1] + c1[1]) / 2 + 3.5)}">PF</text></g>`;
        else out += `<g class="sp-brace"><line class="sp-band" x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(c1[0])}" y2="${f(c1[1])}"/><line class="sp-band" x1="${f(c0[0])}" y1="${f(c0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}"/>${xGlyph((c0[0] + c1[0] + a0[0] + a1[0]) / 4, (c0[1] + c1[1] + a0[1] + a1[1]) / 4, compact ? 4 : 5.5)}</g>`;
      }));
      // the wall strut lines at the mezzanine level: green along the wall, just inside it
      (brc.struts || []).forEach(t => {
        const y = t.wall === 'FSW' ? 0 : W, inw = (t.wall === 'FSW' ? 1 : -1) * 3 / sc, xa = b.xs[Math.min(t.from, t.to)], xb = b.xs[Math.max(t.from, t.to)];
        if (xa == null || xb == null) return;
        const a0 = P(b.toSite([xa, y + inw])), a1 = P(b.toSite([xb, y + inw]));
        out += `<line class="sp-strut" x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}"><title>strut line at ${ftin(t.elev)}</title></line>`;
      });
      // a mezzanine edge off the walls, braced as picked
      (brc.lines || []).forEach(l => {
        const p = P(b.toSite([l.u0, l.y])), q = P(b.toSite([l.u1, l.y])), m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        if (l.kind === 'portal') out += `<g class="sp-portal is-new"><line x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}"/><text x="${f(m[0])}" y="${f(m[1] - 6)}">PF</text></g>`;
        else out += `<g class="sp-brace is-new">${l.kind === 'x' ? `<line class="sp-band" x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}"/>${xGlyph(m[0], m[1], compact ? 4 : 5.5)}` : `<line class="sp-band" x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}"/><text x="${f(m[0])}" y="${f(m[1] - 5)}">${l.kind === 'knee' ? 'K' : '?'}</text>`}</g>`;
      });
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
      /* the grid, as the mezzanine plan draws it: a lettered line along the length at each sidewall, each interior column
         line and each endwall column line (letters from the PCS drawing where they were read, else A at the BSW), dash-dot
         inside; a bubble at each end that is free; every frame column a square on its line (a multi-span frame shows its
         interior columns), endwall posts smaller; the bay dimensions along the free sidewall */
      const fls = frameLines(b), { ys: byB, lab } = letterMap.get(b.name);
      // the lines that carry bracing (a braced sidewall, a mezzanine edge braced on its own line): their letters lit
      const brY = [...((brc.FSW || []).some(q => q.kind !== 'roofx') ? [0] : []), ...((brc.BSW || []).some(q => q.kind !== 'roofx') ? [W] : []), ...(brc.lines || []).map(l => l.y)];
      const selL = ((opts.lines || {})[b.name] || []).find(l => l.key === opts.lineSel), selY = selL ? (selL.kind === 'side' ? (selL.wall === 'FSW' ? 0 : W) : selL.kind === 'new' ? selL.y : null) : null;
      const gTxt = [], rB = compact ? 6.5 : 8;
      byB.forEach(y => { if (y > 0.05 && y < W - 0.05) { const a = P(b.toSite([0, y])), c = P(b.toSite([L, y])); out += `<line class="sp-grid" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(c[0])}" y2="${f(c[1])}"/>`; } });
      // a bubble at each free end of every column line (the ridge counts in the letters, as on the drawings, but has no
      // bubble); a line within a bubble of the last one steps its bubble out on a leader so both read (C and D 2 ft apart)
      const colYs = new Set([0, W, ...fls.flatMap(fl => fl.cols), ...fls.flatMap(fl => fl.posts)].map(v => (+v).toFixed(2)));
      // the bubbles go at each endwall nothing stands against; when both have a building against them, at the free
      // stretches of either (a lean-to on part of the endwall), never over another building
      const freeAt = pt => !site.buildings.some(o => o !== b && inPoly(b.toSite(pt), o.corners));
      const ends = ['LEW', 'REW'].some(w => !taken(b, w)) ? ['LEW', 'REW'].filter(w => !taken(b, w)) : ['LEW', 'REW'];
      [['LEW', -1], ['REW', 1]].filter(([w]) => ends.includes(w)).forEach(([w, sgn]) => {
        if (compact && w === 'REW' && ends.includes('LEW')) return;
        const xe = w === 'LEW' ? 0 : L;
        let lastE = null, stepped = false;
        byB.filter(y => lab.get(y) && colYs.has((+y).toFixed(2))).forEach(y => {
          const e = P(b.toSite([xe, y])), close = lastE && Math.hypot(e[0] - lastE[0], e[1] - lastE[1]) < 2 * rB + 3, step = close && !stepped ? 2 * rB + 3 : 0;
          const d = rB + 11 + step, q = P(b.toSite([xe + sgn * d / sc, y])), e2 = P(b.toSite([xe + sgn * (d - rB) / sc, y])), r = (rB + 2) / sc;
          if (![[xe + sgn * 0.6, y], [xe + sgn * d / sc, y - r], [xe + sgn * d / sc, y + r], [xe + sgn * (d / sc + r), y]].every(freeAt)) return;
          stepped = step > 0; lastE = e;
          if (bubbles.some(o => Math.hypot(o[0] - q[0], o[1] - q[1]) < rB)) return;   // the same line, bubbled by the building beside
          bubbles.push(q); occ.push([q[0] - rB, q[1] - rB, q[0] + rB, q[1] + rB]);
          const lit = brY.some(v => Math.abs(v - y) < 0.3), on = selY != null && Math.abs(selY - y) < 0.3;
          gTxt.push(`<line class="sp-gext" x1="${f(e[0])}" y1="${f(e[1])}" x2="${f(e2[0])}" y2="${f(e2[1])}"/><g class="sp-gb${lit ? ' is-braced' : ''}${on ? ' is-sel' : ''}"><circle cx="${f(q[0])}" cy="${f(q[1])}" r="${rB}"/><text x="${f(q[0])}" y="${f(q[1] + (compact ? 3 : 3.6))}">${esc(lab.get(y))}</text>${lit ? `<title>bracing on line ${esc(lab.get(y))}</title>` : ''}</g>`);
        });
      });
      fls.forEach(fl => {
        fl.cols.forEach(y => { const q = P(b.toSite([fl.x, y])); out += `<rect class="sp-col" x="${f(q[0] - 2.6)}" y="${f(q[1] - 2.6)}" width="5.2" height="5.2"/>`; });
        fl.posts.forEach(y => { const q = P(b.toSite([fl.x, y])); out += `<rect class="sp-post" x="${f(q[0] - 1.8)}" y="${f(q[1] - 1.8)}" width="3.6" height="3.6"/>`; });
      });
      // bay dimensions outside the BSW (or the FSW when the BSW is taken and the bubbles are not there)
      if (!compact) {
        const dW = !taken(b, 'BSW') ? W : null, bubAtB = taken(b, 'FSW');
        if (dW != null) fls.slice(1).forEach((fl, i) => {
          const x0 = fls[i].x, x1 = fl.x, t = ftin(x1 - x0), a = P(b.toSite([x0, dW])), c = P(b.toSite([x1, dW])), len = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (len < 6.2 * t.length + 8) return;
          const off = (bubAtB ? 31 : 13) / sc, m = P(b.toSite([(x0 + x1) / 2, dW + off]));
          let ang = Math.atan2(c[1] - a[1], c[0] - a[0]) * 180 / Math.PI; if (ang > 90 || ang < -90) ang += 180;
          gTxt.push(`<text class="sp-bay" x="${f(m[0])}" y="${f(m[1] + 3.5)}" transform="rotate(${ang.toFixed(1)} ${f(m[0])} ${f(m[1])})">${t}</text>`);
        });
      }
      out += gTxt.join('');
      // frame-line bubbles outside the FSW, or the BSW when something is attached along the FSW
      const bubY = taken(b, 'FSW') && !taken(b, 'BSW') ? W + 12 / sc : -12 / sc, bubW = bubY > 0 ? W : 0;
      frameLines(b).forEach(fl => {
        const a = P(b.toSite([fl.x, 0])), c = P(b.toSite([fl.x, W])), sel = opts.selected && same(opts.selected.building, b.name) && opts.selected.frame === fl.no;
        const w0 = P(b.toSite([fl.x, bubW])), out1 = P(b.toSite([fl.x, bubY])), dx = out1[0] - w0[0], dy = out1[1] - w0[1];
        occ.push([w0[0] + dx - 9, w0[1] + dy - 9, w0[0] + dx + 9, w0[1] + dy + 9]);
        out += `<g class="sp-fl${sel ? ' is-sel' : ''}${opts.lines ? ' is-static' : ''}" data-bldg="${esc(b.name)}" data-frame="${fl.no}"${opts.lines ? '' : ` tabindex="0" role="button" aria-label="${esc(b.name)} frame line ${fl.no}"`}><line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(c[0])}" y2="${f(c[1])}"/><line class="sp-hit" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(c[0])}" y2="${f(c[1])}"/><circle cx="${f(w0[0] + dx)}" cy="${f(w0[1] + dy)}" r="${compact ? 7.5 : 8.5}"/><text x="${f(w0[0] + dx)}" y="${f(w0[1] + dy + 3.4)}">${fl.no}</text></g>`;
      });
      // the name and size: in the top-left corner inside the outline; turned along a building drawn tall and narrow (the
      // corner is worked out first so the wall names keep clear of it)
      const cs = b.corners.map(q => P(q)), x0 = Math.min(...cs.map(q => q[0])), y0 = Math.min(...cs.map(q => q[1])), bw = Math.max(...cs.map(q => q[0])) - x0, bh = Math.max(...cs.map(q => q[1])) - y0;
      const dr = opts.noDrift ? null : (J.drifts || []).find(d => same(d.lower, b.name) && !d.drift.none && !d.off);
      const topStep = dr && dr.kind === 'side' && P(b.toSite(SITE.wallSeg(g, dr.lowerWall).p0))[1] < y0 + bh / 2 ? Math.min(dr.drift.w, dr.lowerWidth) * sc + 4 : 0;
      // an endwall's drift band down the left of the outline (its label runs up it): the name starts past it
      const leftStep = dr && dr.kind === 'end' && P(b.toSite(SITE.wallSeg(g, dr.lowerWall).p0))[0] < x0 + bw / 2 ? Math.min(dr.drift.w, dr.lowerWidth || dr.drift.w) * sc + 4 : 0;
      const dimT = `${ftin(W)} × ${ftin(L)} · ${g.profile || ''}`, need = Math.max(7.6 * b.name.length, 6.4 * dimT.length) + 24;
      // a drift band too narrow on the drawing to hold its label: the label goes with the building's name
      const dsp = dr ? dr.step.span : null, dLen = dsp ? Math.hypot(...[0, 1].map(k => P(b.toSite(dsp[1]))[k] - P(b.toSite(dsp[0]))[k])) : 0;
      const narrow = !!dr && !compact && (Math.min(dr.drift.w, dr.lowerWidth) * sc < 15 || dLen < 200);
      if (narrow) narrowSet.add(b.name);
      const dT = dr ? `drift ${r1(dr.drift.pd)} psf · w ${ftin(dr.drift.w)}${dr.sliding && dr.sliding.applies ? ` · sliding ${r1(dr.sliding.psf)} psf` : ''}` : '';
      /* the wall names inside the outline (the bubbles and the bay dimensions sit outside), clear of the name: a
         sidewall's in the bay nearest its middle that carries no bracing mark, an endwall's in the widest stretch between
         the grid lines */
      const nameBox = bw >= need + leftStep && bh >= 44 + topStep ? [x0 + 8 + leftStep, y0 + 6 + topStep, x0 + need + leftStep, y0 + 42 + topStep + (narrow ? 15 : 0)] : null;
      const wallBoxes = [];
      if (nameBox) occ.push(nameBox);
      // for the wall labels the name block is two lines: the name (short) over the size (long)
      const nameBoxes = nameBox ? [[nameBox[0], nameBox[1], Math.min(nameBox[2], nameBox[0] + 7.6 * b.name.length + 12), nameBox[1] + 18], [nameBox[0], nameBox[1] + 18, nameBox[2], nameBox[3]]] : [];
      SITE.WALLS.forEach(w => {
        if (taken(b, w)) return;   // a wall shared with another building: the joint says it
        const sgm = SITE.wallSeg(g, w), side = w === 'FSW' || w === 'BSW', off = -11 / sc;
        let cands;
        if (side) {
          const bays = fls.slice(1).map((fl, i) => ({ c: (fls[i].x + fl.x) / 2, d: fl.x - fls[i].x, marked: (brc[w] || []).some(bay => bay.from <= i && bay.to >= i + 1) }));
          // the middle of a bay, then its quarter points (one braced bay a wall long: beside its tag)
          cands = bays.sort((p, q) => p.marked - q.marked || Math.abs(p.c - L / 2) - Math.abs(q.c - L / 2)).flatMap(q => [q.c, q.c - q.d * 0.28, q.c + q.d * 0.28, q.c + q.d * 0.4, q.c - q.d * 0.4].map(x => [x, w === 'FSW' ? 0 : W]));
        } else {
          // the widest stretches (within 15 % of the widest) nearest the middle first; in a long one the label may slide
          // to either end of it to keep clear of the name
          const ys = [0, ...byB.filter(y => y > 0.05 && y < W - 0.05).sort((p, q) => p - q), W], gaps = ys.slice(1).map((y, i) => ({ a: ys[i], b: y, c: (ys[i] + y) / 2, d: y - ys[i] }));
          const big = Math.max(...gaps.map(q => q.d)) * 0.85, h = 21 / sc, x = w === 'LEW' ? 0 : L;
          cands = gaps.sort((p, q) => (q.d >= big) - (p.d >= big) || (p.d >= big ? Math.abs(p.c - W / 2) - Math.abs(q.c - W / 2) : q.d - p.d))
            .flatMap(q => (q.d > 2.4 * h ? [q.c, q.a + h, q.b - h] : [q.c]).map(y => [x, y]));
        }
        const p0 = P(b.toSite(sgm.p0)), p1 = P(b.toSite(sgm.p1)), along = Math.abs(p1[0] - p0[0]) >= Math.abs(p1[1] - p0[1]);
        const spots = (cands.length ? cands : [[(sgm.p0[0] + sgm.p1[0]) / 2, (sgm.p0[1] + sgm.p1[1]) / 2]]).map(at => P(b.toSite([at[0] + sgm.n[0] * off, at[1] + sgm.n[1] * off])));
        const wl = ((opts.lines || {})[b.name] || []).find(l => l.wall === w && l.wallTag), wt = wl ? wl.wallTag : w, hw = 3.7 * wt.length + 5;
        const box = q => (along ? [q[0] - hw, q[1] - 6, q[0] + hw, q[1] + 6] : [q[0] - 6, q[1] - hw, q[0] + 6, q[1] + hw]);
        const hit = (r, q) => r[0] < q[2] + 6 && r[2] > q[0] - 6 && r[1] < q[3] + 6 && r[3] > q[1] - 6;
        const m = spots.find(q => ![...nameBoxes, ...wallBoxes, ...wallTags].some(r => r && hit(box(q), r))) || spots.find(q => ![...nameBoxes, ...wallBoxes].some(r => r && hit(box(q), r))) || spots[0];
        wallBoxes.push(box(m)); occ.push(box(m));
        let ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI;
        if (ang > 90 || ang < -90) ang += 180;
        out += `<text class="sp-wall${wl ? ' has-load' : ''}" x="${f(m[0])}" y="${f(m[1] + 3.5)}" transform="rotate(${ang.toFixed(1)} ${f(m[0])} ${f(m[1])})">${esc(wt)}</text>`;
      });
      if (nameBox) {
        // a wall label the corner could not keep clear of (a short endwall has one spot): the name steps right past it
        const under = wallBoxes.filter(r => r[0] < nameBox[2] && r[2] > nameBox[0] && r[1] < nameBox[3] && r[3] > nameBox[1]);
        const dx = under.length ? Math.max(...under.map(r => r[2] - nameBox[0] + 4)) : 0, sx = dx > 0 && bw >= need + leftStep + dx ? dx : 0;
        // a portal frame's tag on the wall above the corner: the name steps down past it
        const tagOver = wallTags.filter(r => r[0] < nameBox[2] && r[2] > nameBox[0] + sx && r[3] > nameBox[1] - 6 && r[1] < nameBox[1] + 14);
        const sy = tagOver.length && bh >= 58 + topStep ? Math.max(...tagOver.map(r => r[3] - nameBox[1] + 8)) : 0;
        const nx = x0 + 14 + leftStep + sx, ny = y0 + 22 + topStep + sy;
        out += `<text class="sp-name sp-name-corner" x="${f(nx)}" y="${f(ny)}">${esc(b.name)}</text><text class="sp-dim sp-dim-corner" x="${f(nx)}" y="${f(ny + 14)}">${esc(dimT)}</text>${narrow ? `<text class="sp-dlab sp-dlab-out" x="${f(nx)}" y="${f(ny + 29)}">${esc(dT)}</text>` : ''}</g>`;
      } else if (bh >= need && bw >= 40) {
        const cx = x0 + bw / 2 - 2, cy = y0 + bh / 2;
        out += `<g transform="rotate(-90 ${f(cx)} ${f(cy)})"><text class="sp-name" x="${f(cx)}" y="${f(cy - 2)}">${esc(b.name)}</text><text class="sp-dim" x="${f(cx)}" y="${f(cy + 12)}">${esc(dimT)}</text>${narrow ? `<text class="sp-dlab" x="${f(cx)}" y="${f(cy + 27)}">${esc(dT)}</text>` : ''}</g></g>`;
      } else {
        // too small on the drawing: the name beside it with a leader, placed once every building's own labels are (so
        // it keeps clear of them) — right, above, left or below, outside its neighbours; else inside a neighbour's
        // open floor beside it; the first spot clear of the bubbles, names and wall labels
        out += '</g>';
        later.push(() => {
        const lh = dr && !compact ? 34 : 20, clashes = (r, list) => list.some(q => r[0] < q[2] + 3 && r[2] > q[0] - 3 && r[1] < q[3] + 3 && r[3] > q[1] - 3);
        const others = bboxes.filter(q => q.name !== b.name).map(q => q.r);
        const at = (nx, ny, lx, ly, ex, ey, inside) => ({ nx, ny, lx, ly, ex, ey, inside });
        const cand = [
          at(x0 + bw + 12, y0 + 14, x0 + bw, y0 + 10, x0 + bw + 9, y0 + 10),
          at(x0, y0 - lh - 6 + 12, x0 + 8, y0, x0 + 8, y0 - 6),
          at(x0 - 12 - need, y0 + 14, x0, y0 + 10, x0 - 9, y0 + 10),
          at(x0, y0 + bh + 30, x0 + 8, y0 + bh, x0 + 8, y0 + bh + 18),
          // inside the neighbour beside it, further along until the floor is open (a leader runs back to it)
          ...[0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap(i => [0.5, 0.72, 0.28].map(k => at(x0 + bw + 14 + i * 40, y0 + bh * k, x0 + bw, y0 + bh * k - 4, x0 + bw + 11 + i * 40, y0 + bh * k - 4, true))),
          ...[0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap(i => [0.5, 0.72, 0.28].map(k => at(x0 - 14 - need - i * 40, y0 + bh * k, x0, y0 + bh * k - 4, x0 - 11 - i * 40, y0 + bh * k - 4, true))),
        ].filter(c => c.nx >= 2 && c.nx + need <= Wd - 2 && c.ny - 12 >= 2 && c.ny + lh - 12 <= H - 2);
        const rOf = q => [q.nx, q.ny - 12, q.nx + need, q.ny + lh - 12];
        const c = cand.find(q => !clashes(rOf(q), [...occ, ...outLabels]) && (q.inside ? !clashes(rOf(q), mzRects) : !clashes(rOf(q), others))) || cand.find(q => !clashes(rOf(q), [...occ, ...outLabels])) || cand[0] || at(x0, y0 + bh + 30, x0 + 8, y0 + bh, x0 + 8, y0 + bh + 18);
        outLabels.push(rOf(c)); occ.push(rOf(c));
        top += `<line class="sp-leader" x1="${f(c.lx)}" y1="${f(c.ly)}" x2="${f(c.ex)}" y2="${f(c.ey)}"/><text class="sp-name sp-name-corner" x="${f(c.nx)}" y="${f(c.ny)}">${esc(b.name)}</text><text class="sp-dim sp-dim-corner" x="${f(c.nx)}" y="${f(c.ny + 14)}">${esc(dimT)}</text>${dr && !compact ? `<text class="sp-dlab sp-dlab-out" x="${f(c.nx)}" y="${f(c.ny + 29)}">${esc(dT)}</text>` : ''}`;
        narrowSet.add(b.name);
        });
      }
    });
    const mzBox = m => { const b = site.buildings.find(q => same(q.name, m.building)) || site.buildings[0]; if (!b) return null; const p = P(b.toSite([m.x0, m.y0])), q = P(b.toSite([m.x1, m.y1])); return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]; };
    mzRects = (opts.mezz || []).map(mzBox).filter(Boolean);
    later.forEach(fn => fn());
    const mzLabs = [];
    (opts.mezz || []).forEach(m => {
      const b = site.buildings.find(q => same(q.name, m.building)) || site.buildings[0];
      if (!b) return;
      const p = P(b.toSite([m.x0, m.y0])), q = P(b.toSite([m.x1, m.y1]));
      const x = Math.min(p[0], q[0]), y = Math.min(p[1], q[1]), w = Math.abs(q[0] - p[0]), h = Math.abs(q[1] - p[1]);
      const lab = `${mezzName(m.id)}${m.A != null && !compact ? ` · ${ftin(m.A)}` : ''}`;
      const mc = (m.cols || []).map(c => { const q = P(b.toSite([c.x, c.y])), r = compact ? 3 : 4.2; return `<g class="sp-mcol"><circle cx="${f(q[0])}" cy="${f(q[1])}" r="${r}"/><path d="M${f(q[0] - r * 0.7)},${f(q[1] - r * 0.7)} L${f(q[0] + r * 0.7)},${f(q[1] + r * 0.7)} M${f(q[0] - r * 0.7)},${f(q[1] + r * 0.7)} L${f(q[0] + r * 0.7)},${f(q[1] - r * 0.7)}"/></g>`; }).join('');
      /* the name in the middle, or nudged up or down off the columns it would sit on — clear of the building names, the
         wall labels, the bubbles and the other mezzanines' names; on a floor drawn too small for it, the name alone (the
         height in its hover), then turned along a tall floor; failing all, the name alone where it clashes least */
      const cq = (m.cols || []).map(c => P(b.toSite([c.x, c.y]))), cw = compact ? 5.8 : 6.6;
      const clash = r => [...occ, ...mzLabs].some(q => r[0] < q[2] + 2 && r[2] > q[0] - 2 && r[1] < q[3] + 2 && r[3] > q[1] - 2);
      const onCol = (cx, v, half) => cq.some(q => Math.abs(q[0] - cx) < half + 5 && q[1] > v - 15 && q[1] < v + 9);
      const variants = [lab, mezzName(m.id), String(m.id)].filter((t, i, a) => a.indexOf(t) === i);
      let pick = null;
      for (const t of variants) {
        const half = cw * t.length / 2 + 4;
        if (2 * half > w - 4) continue;
        const v = [0, -0.22, 0.22, -0.34, 0.34].map(k => y + h / 2 + 4 + k * h).find(v2 => v2 - 12 > y && v2 + 4 < y + h && !onCol(x + w / 2, v2, half) && !clash([x + w / 2 - half, v2 - 11, x + w / 2 + half, v2 + 4]));
        if (v != null) { pick = { t, cx: x + w / 2, cy: v, r: [x + w / 2 - half, v - 11, x + w / 2 + half, v + 4] }; break; }
      }
      if (!pick) for (const t of variants) {
        const half = cw * t.length / 2 + 4;
        if (2 * half <= h - 4 && w >= 14) { const cx = x + w / 2 + 4, cy = y + h / 2, r = [cx - 11, cy - half, cx + 4, cy + half]; if (!clash(r) || t === variants[variants.length - 1]) { pick = { t, cx, cy, rot: true, r }; break; } }
      }
      if (!pick) {
        // a floor too small to hold its name: beside it with a leader — right, left, above, below — clear of the rest
        const t = variants[variants.length - 1], tw = cw * t.length + 8;
        const sp = [[x + w + 8, y + h / 2 + 4, 'start'], [x - 8, y + h / 2 + 4, 'end'], [x + w / 2, y - 6, 'middle'], [x + w / 2, y + h + 14, 'middle'], [x + w + 8, y + 12, 'start'], [x + w + 8, y + h - 4, 'start']]
          .map(([tx, ty, an]) => { const x0r = an === 'start' ? tx : an === 'end' ? tx - tw : tx - tw / 2; return { tx, ty, an, r: [x0r, ty - 11, x0r + tw, ty + 4] }; });
        const q = sp.find(c => !clash(c.r)) || sp[0];
        pick = { t, cx: q.tx, cy: q.ty, anchor: q.an, r: q.r, lead: [x + w / 2, y + h / 2, q.an === 'start' ? q.r[0] - 2 : q.an === 'end' ? q.r[2] + 2 : q.tx, q.an === 'middle' ? (q.ty < y ? q.ty + 4 : q.ty - 11) : q.ty - 4] };
      }
      mzLabs.push(pick.r); occ.push(pick.r);
      // a floor opening: the floor taken out, outlined and crossed
      const hs = (m.holes || []).map(o => { const a = P(b.toSite([o.x0, o.y0])), c = P(b.toSite([o.x1, o.y1])), hx = Math.min(a[0], c[0]), hy = Math.min(a[1], c[1]), hw = Math.abs(c[0] - a[0]), hh = Math.abs(c[1] - a[1]);
        return `<g class="sp-hole"><rect x="${f(hx)}" y="${f(hy)}" width="${f(hw)}" height="${f(hh)}"/><path d="M${f(hx)},${f(hy)} L${f(hx + hw)},${f(hy + hh)} M${f(hx + hw)},${f(hy)} L${f(hx)},${f(hy + hh)}"/><title>Floor opening ${ftin(Math.abs(o.x1 - o.x0))} × ${ftin(Math.abs(o.y1 - o.y0))}</title></g>`; }).join('');
      out += `<g class="sp-mezz"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="url(#spHatch)"/><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" class="sp-mezz-edge"/>${hs}${mc}${pick.lead ? `<line class="sp-mz-lead" x1="${f(pick.lead[0])}" y1="${f(pick.lead[1])}" x2="${f(pick.lead[2])}" y2="${f(pick.lead[3])}"/>` : ''}<text x="${f(pick.cx)}" y="${f(pick.cy)}"${pick.anchor ? ` style="text-anchor:${pick.anchor}"` : ''}${pick.rot ? ` transform="rotate(-90 ${f(pick.cx)} ${f(pick.cy)})"` : ''}>${esc(pick.t)}<title>${esc(lab)}</title></text></g>`;
    });
    /* the bracing lines (the Bracing page): each sidewall and endwall, and each mezzanine edge off the walls — a bracing
       wall to create, dashed, with its braced bay; the line picked lit; EQB / EQF arrows at the ends of its run, pointing
       the way each pushes. opts.lines: { [building]: [{ key, kind: 'side' | 'end' | 'new', wall, y, segs, label, tag,
       pick: { u0, u1, kind }, loads: [{ u, caseId }] }] } */
    site.buildings.forEach(b => {
      const BL = (opts.lines || {})[b.name];
      if (!BL) return;
      const g = b.g;
      BL.forEach(l => {
        const sel = opts.lineSel === l.key, end = l.kind === 'end', y = l.kind === 'side' ? (l.wall === 'FSW' ? 0 : g.width) : l.y;
        const at = u => P(b.toSite(end ? [l.wall === 'LEW' ? 0 : g.length, u] : [u, y]));
        const segs = l.kind === 'new' ? l.segs : [[0, end ? g.width : g.length]];
        let o = `<g class="sp-bl is-${l.kind}${sel ? ' is-sel' : ''}" data-bline="${esc(l.key)}" tabindex="0" role="button" aria-label="${esc(b.name + ' · ' + l.label)}">`;
        segs.forEach(([u0, u1]) => { const p = at(u0), q = at(u1); o += `<line class="sp-bl-line" x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}"/><line class="sp-hit" x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}"/>`; });
        if (l.pick) {
          const p = at(l.pick.u0), q = at(l.pick.u1), len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, nx = -(q[1] - p[1]) / len * 5, ny = (q[0] - p[0]) / len * 5;
          o += l.pick.kind === 'portal' ? `<g class="sp-portal"><line x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}"/><text x="${f((p[0] + q[0]) / 2 + nx * 2.2)}" y="${f((p[1] + q[1]) / 2 + ny * 2.2 + 3.5)}">PF</text></g>`
            : `<g class="sp-brace"><line class="sp-band" x1="${f(p[0] + nx)}" y1="${f(p[1] + ny)}" x2="${f(q[0] - nx)}" y2="${f(q[1] - ny)}"/><line class="sp-band" x1="${f(p[0] - nx)}" y1="${f(p[1] - ny)}" x2="${f(q[0] + nx)}" y2="${f(q[1] + ny)}"/>${l.pick.kind === 'x' ? xGlyph((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 6) : `<text x="${f((p[0] + q[0]) / 2)}" y="${f((p[1] + q[1]) / 2 - 7)}">${l.pick.kind === 'knee' ? 'K' : '?'}</text>`}</g>`;
        }
        if (l.kind === 'new' && l.tag) {
          const long = segs.slice().sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0], m = at((long[0] + long[1]) / 2), tw = 6.2 * l.tag.length + 14;
          o += `<g class="sp-bl-tag"><rect x="${f(m[0] - tw / 2)}" y="${f(m[1] - 25)}" width="${f(tw)}" height="17" rx="8.5"/><text x="${f(m[0])}" y="${f(m[1] - 13)}">${esc(l.tag)}</text></g>`;
          occ.push([m[0] - tw / 2, m[1] - 25, m[0] + tw / 2, m[1] - 8]);
        }
        // EQB / EQF: an arrow along the line at the point it goes in, the way it pushes, with its value outside the building
        // (beside an interior line, toward the FSW)
        (l.loads || []).forEach(ld => {
          const dir = ld.caseId === 'EQF' ? -1 : 1, p = at(ld.u), q = at(ld.u + dir * 30 / sc);
          o += `<line class="sp-eq" x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}" marker-end="url(#spArrEq)"/>`;
          if (end || ld.F == null) return;
          // just past the arrowhead, the way it points, a little off the line — inside a wall, toward the FSW beside an
          // interior line, else the other side or further along: the first spot clear of the bubbles, names and labels
          const y0 = l.kind === 'side' ? (l.wall === 'FSW' ? 0 : g.width) : l.y, inSide = l.kind === 'side' ? (l.wall === 'FSW' ? 1 : -1) : -1;
          const t = `${ld.caseId} ${dir > 0 ? '+' : '−'}${Math.abs(ld.F).toFixed(2)}`, w = 6.1 * t.length + 10;
          const spot = (side, ahead) => {
            const h0 = P(b.toSite([ld.u + dir * ahead / sc, y0 + side / sc])), h1 = P(b.toSite([ld.u + dir * (ahead + 1) / sc, y0 + side / sc])), dl = Math.hypot(h1[0] - h0[0], h1[1] - h0[1]) || 1;
            const c = [h0[0] + (h1[0] - h0[0]) / dl * w / 2, h0[1] + (h1[1] - h0[1]) / dl * w / 2];
            return { c, r: [c[0] - w / 2, c[1] - 8, c[0] + w / 2, c[1] + 7] };
          };
          // (side and distance off the line in px, how far along from the point)
          const cand = [[11, 33], [-11, 15], [-11, 33], [11, 15], [30, 33], [30, 15], [-30, 15], [11, 75], [-11, 75], [30, 75], [11, 120]].map(([d, a]) => spot(Math.sign(d) * inSide * Math.abs(d), a));
          const clear = q => !occ.some(r => q.r[0] < r[2] + 2 && q.r[2] > r[0] - 2 && q.r[1] < r[3] + 2 && q.r[3] > r[1] - 2);
          const pk = cand.find(clear) || cand[0];
          occ.push(pk.r);
          o += `<g class="sp-eqlab"><rect x="${f(pk.r[0])}" y="${f(pk.c[1] - 8)}" width="${f(w)}" height="15" rx="7.5"/><text x="${f(pk.c[0])}" y="${f(pk.c[1] + 3.5)}">${t}</text></g>`;
        });
        out += o + '</g>';
      });
    });
    // drift zones: from the step wall into the lower roof, w wide (or to the far eave), with the wind that makes them
    (opts.noDrift ? [] : J.drifts || []).forEach(d => {
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
    out += `<g class="sp-top">${top}</g></svg>`;
    return out;
  }

  /* ---------- one frame line in elevation, with its loads ----------
     F: { g, name, frame, x, trib, cols: [y], posts: [y], rigid, type, end, loads: { dead, coll (k/ft), snow: { ps, kft, pm, hb, gamma },
          drift: [segs], sliding: [segs], mezz: [{ y, elev, D, L, member, label }], eq: [{ y, at, F (null = waiting), member }],
          leanTo: [{ y, at, text }] }, step: { side, upperName, upperEave, h, rake } }
     Returns { svg, legend: [{ key, label }] } — every load in its own <g data-layer>. */
  /* the frame's columns as NBG Frame numbers them, left to right from one end: the frame columns, and on an end frame
     its posts. Where a load names its column (COL02 …) that numbering is followed — from the FSW or from the BSW, with
     or without the posts — else they count from the FSW. Returns [{ y, n }] */
  function columnNumbers(F) {
    const ld = F.loads || {}, uniq = a => [...new Set(a.map(v => +(+v).toFixed(3)))].sort((p, q) => p - q);
    const sets = [uniq([...F.cols, ...(F.posts || [])]), uniq(F.cols)];
    const known = [...(ld.mezz || []), ...(ld.eq || []), ...(ld.leanTo || [])].map(q => ({ y: q.y, n: +((String(q.member || '').match(/^COL0*(\d+)$/i) || [])[1]) })).filter(q => q.n > 0);
    for (const ys of sets) for (const flip of [false, true]) {
      const num = i => (flip ? ys.length - i : i + 1);
      if (known.length && known.every(q => { const i = ys.findIndex(v => Math.abs(v - q.y) < 0.3); return i >= 0 && num(i) === q.n; })) return ys.map((y, i) => ({ y, n: num(i) }));
    }
    return sets[0].map((y, i) => ({ y, n: i + 1 }));
  }
  function frameSvg(F) {
    const g = F.g, W = g.width, Zr = y => SITE.roofZ(g, F.x, y), brk = SITE.roofBreaks(g), ld = F.loads || {};
    const eaveMax = Math.max(Zr(0), Zr(W), ...brk.map(Zr)), stepH = F.step ? F.step.upperEave : 0;
    const lean = ld.leanSide && !ld.leanGhost && (ld.leanTo || []).length ? ld.leanSide : null, leanW = lean ? Math.min(lean.width, W * 0.32) + 2 : 0;
    const extraL = Math.max(F.step && F.step.side === 'FSW' ? Math.max(10, W * 0.28) : 0, lean && lean.side === 'FSW' ? leanW : 0), extraR = Math.max(F.step && F.step.side === 'BSW' ? Math.max(10, W * 0.28) : 0, lean && lean.side === 'BSW' ? leanW : 0);
    const Hft = Math.max(eaveMax, stepH) + 2.5, padT = 150, padB = 86;
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
    // dimensions: the width and the frame type under the column numbers, the eave heights at the columns
    frame += `<g class="fe-dims"><line x1="${f(X(0))}" y1="${f(Y(0) + 46)}" x2="${f(X(W))}" y2="${f(Y(0) + 46)}"/><line x1="${f(X(0))}" y1="${f(Y(0) + 40)}" x2="${f(X(0))}" y2="${f(Y(0) + 52)}"/><line x1="${f(X(W))}" y1="${f(Y(0) + 40)}" x2="${f(X(W))}" y2="${f(Y(0) + 52)}"/><text x="${f((X(0) + X(W)) / 2)}" y="${f(Y(0) + 66)}">${ftin(W)}${F.type ? ' · ' + esc(F.type) : ''}</text>`;
    // the eave heights outside each column top — inside, under the rafter, on a side a higher building stands against
    const eaveLab = (y, out) => {
      const stepHere = F.step && (F.step.side === 'FSW' ? y === 0 : y === W), inward = stepHere ? -out : out, t = ftin(Zr(y)), w = 7.2 * t.length;
      const x = X(y) + inward * (stepHere ? dK * sc + 6 : 8), yy = Y(Zr(y)) + (stepHere ? dK * sc + 14 : -6);
      labels.push(inward < 0 ? [x - w, yy - 12, x, yy + 3] : [x, yy - 12, x + w, yy + 3]);   // the load labels keep clear of it
      return `<text class="fe-eave" x="${f(x)}" y="${f(yy)}" style="text-anchor:${inward < 0 ? 'end' : 'start'}">${t}</text>`;
    };
    frame += eaveLab(0, -1) + eaveLab(W, 1);
    // each column's number at its base, as NBG Frame numbers them (COL01, COL02 … — the FDL2 / EQR2 rows name them);
    // the walls beside the end ones
    const colNo = columnNumbers(F);
    colNo.forEach(c => { frame += `<g class="fe-colno"><circle cx="${f(X(c.y))}" cy="${f(Y(0) + 20)}" r="10"/><text x="${f(X(c.y))}" y="${f(Y(0) + 24)}">${c.n}</text></g>`; });
    frame += `<text class="fe-wall" x="${f(X(0) - 16)}" y="${f(Y(0) + 24)}" style="text-anchor:end">FSW</text><text class="fe-wall" x="${f(X(W) + 16)}" y="${f(Y(0) + 24)}" style="text-anchor:start">BSW</text></g>`;
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
    /* the mezzanine on its columns, at its floor: the dead and live (negative, downward) over a down arrow onto the
       column; under the floor, EQR / EQL with its two arrows. The floor's height outside the frame, on a dotted line. */
    const heights = new Map();   // elevation → { left, right } the leader reaches from
    // from the outermost loaded column on a side; one leader a height, on the FSW side when a load is there
    const reach = (y, z) => { const k = z.toFixed(3), o = heights.get(k) || { z, left: null, right: null, ys: new Set() }; o.ys.add(+y.toFixed(2)); if (y < W / 2) o.left = o.left == null ? y : Math.min(o.left, y); else o.right = o.right == null ? y : Math.max(o.right, y); heights.set(k, o); };
    const heightMarks = () => [...heights.values()].map(o => {
      let t = '';
      // loads at one height on more than one column: a grey dotted line across the whole frame at that level
      if (o.ys.size > 1) t += `<line class="fe-lvlx" x1="${f(X(0))}" y1="${f(Y(o.z))}" x2="${f(X(W))}" y2="${f(Y(o.z))}"/>`;
      if (o.left != null) o.right = null;
      const lab = ftin(o.z), w = 7.2 * lab.length;
      if (o.left != null) { const xa = X(0) - 30 - (lean && lean.side === 'FSW' ? leanW * sc : 0); t += `<line class="fe-lvl" x1="${f(X(o.left))}" y1="${f(Y(o.z))}" x2="${f(xa)}" y2="${f(Y(o.z))}"/><text class="fe-lvlt" x="${f(xa - 4)}" y="${f(Y(o.z) + 4)}" style="text-anchor:end">${lab}</text>`; labels.push([xa - 4 - w, Y(o.z) - 8, xa, Y(o.z) + 6]); }
      if (o.right != null) { const xa = X(W) + 30 + (lean && lean.side === 'BSW' ? leanW * sc : 0); t += `<line class="fe-lvl" x1="${f(X(o.right))}" y1="${f(Y(o.z))}" x2="${f(xa)}" y2="${f(Y(o.z))}"/><text class="fe-lvlt" x="${f(xa + 4)}" y="${f(Y(o.z) + 4)}" style="text-anchor:start">${lab}</text>`; labels.push([xa, Y(o.z) - 8, xa + 4 + w, Y(o.z) + 6]); }
      return t;
    }).join('');
    if ((ld.mezz || []).length) {
      let m = '';
      ld.mezz.forEach(q => {
        const x = X(q.y), z = Y(q.elev), dir = q.y < W / 2 ? 1 : -1;
        reach(q.y, q.elev);
        m += `<line class="fe-floor" x1="${f(x + dir * 4)}" y1="${f(z)}" x2="${f(x + dir * 46)}" y2="${f(z)}"/>`;
        // the arrow just inside the column, onto the floor where it bears
        const ax = x + dir * 15;
        m += `<line x1="${f(ax)}" y1="${f(z - 42)}" x2="${f(ax)}" y2="${f(z - 3)}" marker-end="url(#feArrM)"/>`;
        const tx = `FDL −${k2(q.D)} · FLL −${k2(q.L)} k`, w = tw(tx);
        const px = Math.min(Math.max(ax, w / 2 + 6), Wpx - w / 2 - 6);
        m += pill(px, place(px, z - 48, w), tx, 'fe-mzv');
      });
      s += layer('mezz', 'Mezzanine dead / live', `<g class="fe-mezz">${m}</g>`);
    }
    if ((ld.eq || []).length) {
      let e = '';
      ld.eq.forEach(q => {
        const x = X(q.y), z = Y(q.at), wait = q.F == null;
        reach(q.y, q.at);
        const tx = wait ? 'EQR / EQL waiting on the Seismic calc' : `EQR / EQL ${k2(q.F)} k`, w = Math.max(tw(tx), 52);
        const px = Math.min(Math.max(x, w / 2 + 6), Wpx - w / 2 - 6), py = spot(px, z + 22, w, 34);
        e += pill(px, py, tx, wait ? 'fe-wait' : 'fe-eqv');
        // the two directions under it: EQR to the right, EQL to the left
        const hw = 19, a = py + 11, c = py + 20, cls = wait ? 'fe-waitline' : '', mk = wait ? 'feArrW' : 'feArrE';
        e += `<line class="${cls}" x1="${f(px - hw)}" y1="${f(a)}" x2="${f(px + hw)}" y2="${f(a)}" marker-end="url(#${mk})"/><line class="${cls}" x1="${f(px + hw)}" y1="${f(c)}" x2="${f(px - hw)}" y2="${f(c)}" marker-end="url(#${mk})"/>`;
        labels.push([px - hw - 4, a - 4, px + hw + 4, c + 4]);
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
      // the lean-to itself beside the column it bears on (a sidewall lean-to): its rafter from the column down to its low
      // eave and its far column, ghosted, its width and low eave written — what its reactions come from
      const lo = ld.leanSide;
      if (lo && !g) {
        const out = lo.side === 'FSW' ? -1 : 1, y0 = lo.side === 'FSW' ? 0 : W, wd = Math.min(lo.width, W * 0.32), ye = y0 + out * wd, zl = Math.max(0.5, lo.lowEave ?? lo.at * 0.75);
        const cx = (X(y0) + X(ye)) / 2, cy = (Y(Math.min(lo.at, zl)) + Y(0)) / 2;
        e += `<g class="fe-leanghost"><polygon points="${p(y0, 0)} ${p(y0, lo.at)} ${p(ye, zl)} ${p(ye, 0)}"/><line x1="${f(X(y0))}" y1="${f(Y(lo.at))}" x2="${f(X(ye))}" y2="${f(Y(zl))}"/><text x="${f(cx)}" y="${f(cy - 6)}">${esc(lo.name)}</text><text class="fe-sub" x="${f(cx)}" y="${f(cy + 10)}">${esc(`${ftin(lo.width)} wide`)}</text>${lo.lowEave != null ? `<text class="fe-sub" x="${f(cx)}" y="${f(cy + 24)}">${esc(`low eave ${ftin(lo.lowEave)}`)}</text>` : ''}</g>`;
        labels.push([Math.min(X(y0), X(ye)), Y(lo.at) - 4, Math.max(X(y0), X(ye)), Y(0)]);
      }
      ld.leanTo.forEach(q => {
        reach(q.y, q.at);
        const x = X(q.y), z = Y(q.at), sx = q.X > 0 ? 1 : -1, hasH = Math.abs(q.X) > 0.0005;
        e += `<circle cx="${f(x)}" cy="${f(z)}" r="3.2"/><line x1="${f(x)}" y1="${f(z - 50)}" x2="${f(x)}" y2="${f(z - 5)}" marker-end="url(#feArrL)"/>`;
        if (hasH) e += `<line x1="${f(x - sx * 46)}" y1="${f(z)}" x2="${f(x - sx * 6)}" y2="${f(z)}" marker-end="url(#feArrL)"/>`;
        const tx = `${q.caseName}  Y −${k2(q.V)}${hasH ? `  X ${q.X >= 0 ? '+' : '−'}${k2(Math.abs(q.X))}` : ''} k`, w = tw(tx);
        const px = Math.min(Math.max(x, w / 2 + 6), Wpx - w / 2 - 6);
        e += pill(px, place(px, z - 58, w), tx, 'fe-leanv');
      });
      s += layer('leanto', 'Lean-to reactions', `<g class="fe-lean">${e}</g>`);
    }
    if (heights.size) s += `<g class="fe-lvls">${heightMarks()}</g>`;
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
    const L = Wl.length, Hft = Wl.eave + 4, Wpx = 1000, padL = 40, padR = 40, padT = 30, padB = 46;
    const sc = Math.min((Wpx - padL - padR) / L, 185 / Hft), Hpx = Hft * sc + padT + padB;
    const X = x => padL + x * sc, Y = z => padT + (Hft - z) * sc, f = v => (+v).toFixed(1);
    const lineX = no => { const l = Wl.lines.find(q => q.no === no); return l ? l.x : null; };
    const tw = t => 6.6 * String(t).length + 12;
    const pill = (x, y, text, cls = '') => { const w = tw(text); return `<rect class="we-pill" x="${f(x - w / 2)}" y="${f(y - 11)}" width="${f(w)}" height="15" rx="4"/><text class="we-lab ${cls}" x="${f(x)}" y="${f(y)}">${esc(text)}</text>`; };
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx.toFixed(0)}" class="wall-elev" role="img" aria-label="${esc(Wl.name)} ${Wl.wall} bracing"><defs><marker id="weArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker><marker id="weArrW" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="we-waithead"/></marker></defs>`;
    s += `<rect class="we-wall" x="${X(0)}" y="${f(Y(Wl.eave))}" width="${f(L * sc)}" height="${f(Wl.eave * sc)}"/>`;
    const lateLabels = [];
    // the mezzanine floor seen through the wall
    // (one label: the mezzanine, its level, and the strut line to be added there)
    (Wl.mezz || []).forEach(m => {
      const st = (Wl.strutsPlanned || []).some(t => Math.abs(t.elev - m.A) < 0.05);
      s += `<rect class="we-mezz" x="${f(X(m.x0))}" y="${f(Y(m.A) - 2)}" width="${f((m.x1 - m.x0) * sc)}" height="4"/>`;
      // its label on top of the columns and bracing (drawn last), kept on the wall when wider than the floor's stretch
      const t = `${mezzName(m.id)} · ${ftin(m.A)}${st ? ' · strut line added' : ''}`, hw = tw(t) / 2;
      lateLabels.push(pill(Math.min(Math.max(X((m.x0 + m.x1) / 2), X(0) + hw), X(L) - hw), Y(m.A) + 20, t, 'we-mezzlab'));
    });
    (Wl.bays || []).forEach(b => {
      const x0 = lineX(b.from + 1) ?? null, x1 = lineX(b.to + 1) ?? null;
      if (x0 == null || x1 == null) return;
      if (b.braced && b.kind === 'portal') {
        const inset = Math.min(1.2, (x1 - x0) * 0.12), zh = Wl.eave - 1.4;
        s += `<g class="we-portal"><line x1="${f(X(x0 + inset))}" y1="${f(Y(0))}" x2="${f(X(x0 + inset))}" y2="${f(Y(zh))}"/><line x1="${f(X(x1 - inset))}" y1="${f(Y(0))}" x2="${f(X(x1 - inset))}" y2="${f(Y(zh))}"/><line x1="${f(X(x0 + inset))}" y1="${f(Y(zh))}" x2="${f(X(x1 - inset))}" y2="${f(Y(zh))}"/><line x1="${f(X(x0 + inset))}" y1="${f(Y(zh - 1.1))}" x2="${f(X(x1 - inset))}" y2="${f(Y(zh - 1.1))}"/></g>`;
        s += pill(X((x0 + x1) / 2), Y(zh) - 10, 'portal frame', 'we-brlab');
      } else if (b.braced) {
        // the file's tiers as they are; else one X to the eave, or two split at the mezzanine level when the bay is tiered
        // there (b.tier: that level) — the strut across it is the strut line's, in this bay
        const own = b.braces && b.braces.length ? b.braces : null, A = !own || own.length < 2 ? b.tier : null;
        const tiers = own && own.length > 1 ? own : A != null ? [{ bottom: 0, top: A }, { bottom: A, top: Wl.eave }] : [{ bottom: 0, top: Wl.eave }];
        tiers.forEach(t => { s += `<g class="we-x${A != null ? ' is-tier' : ''}"><line x1="${f(X(x0))}" y1="${f(Y(t.bottom))}" x2="${f(X(x1))}" y2="${f(Y(t.top))}"/><line x1="${f(X(x0))}" y1="${f(Y(t.top))}" x2="${f(X(x1))}" y2="${f(Y(t.bottom))}"/></g>`; });
        if (A != null) s += `<line class="we-strut is-new" x1="${f(X(x0))}" y1="${f(Y(A))}" x2="${f(X(x1))}" y2="${f(Y(A))}"/>`;
      }
      // a braced X bay the mezzanine's load reaches can be tiered at its level: the bay is a button
      if (b.tierable) s += `<rect class="we-tierhit${b.tier != null ? ' is-on' : ''}" data-tierbay="${b.from}" x="${f(X(x0))}" y="${f(Y(Wl.eave))}" width="${f((x1 - x0) * sc)}" height="${f(Wl.eave * sc)}"><title>${b.tier != null ? 'Tiered at the mezzanine level — click to run the X to the eave' : 'Click to tier this bay at the mezzanine level'}</title></rect>`;
      // the strut lines added to the model (Real), and the program's own below the eave in a braced bay (a tier's strut)
      (b.struts || []).filter(t => t.real || (b.braced && b.kind !== 'portal' && t.elev < Wl.eave - 0.01)).forEach(t => { s += `<line class="we-strut" x1="${f(X(x0))}" y1="${f(Y(t.elev))}" x2="${f(X(x1))}" y2="${f(Y(t.elev))}"/>`; });
    });
    // the strut line to be added: dashed, from the mezzanine to the braced bay (a bay left untiered keeps its X whole)
    (Wl.strutsPlanned || []).forEach(t => {
      const x0 = lineX(t.from + 1), x1 = lineX(t.to + 1);
      if (x0 == null || x1 == null) return;
      (Wl.bays || []).filter(b => b.from >= Math.min(t.from, t.to) && b.to <= Math.max(t.from, t.to) && !(t.skip || []).includes(b.from)).forEach(b => {
        const a = lineX(b.from + 1), c = lineX(b.to + 1);
        if (a != null && c != null) s += `<line class="we-strut is-new" x1="${f(X(a))}" y1="${f(Y(t.elev))}" x2="${f(X(c))}" y2="${f(Y(t.elev))}"/>`;
      });
      if (!(Wl.mezz || []).some(m => Math.abs(m.A - t.elev) < 0.05)) s += pill(X((x0 + x1) / 2), Y(t.elev) + 20, `strut line added at ${ftin(t.elev)}`, 'we-new');
    });
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
    s += lateLabels.join('');
    s += `<text class="we-title" x="${X(0)}" y="${padT - 12}">${esc(Wl.name)} · ${Wl.wall} · eave ${ftin(Wl.eave)}${Wl.src ? ` · bracing from ${esc(Wl.src)}` : ''}</text>`;
    if (Wl.note) s += `<text class="we-note" x="${f(Wpx - padR)}" y="${padT - 12}">${esc(Wl.note)}</text>`;
    s += '</svg>';
    return s;
  }

  /* ---------- the mezzanine's longitudinal seismic split to its lines, looking along the building: each mezzanine sends
     half its force to each of its two long edges (on through a mezzanine it is joined to) ----------
     S: { name, width, top: y => the roof over y, floors: [{ y0, y1, A, id, F, to: [the y of each line its halves go to] }], total,
     lines: [{ y, F, label, wall, independent, at }] } */
  function splitSvg(S) {
    const W = Math.max(1, S.width), ys = Array.from({ length: 41 }, (_, i) => (W * i) / 40), zTop = Math.max(...ys.map(y => S.top(y))), Hft = zTop + 2;
    const Wpx = 1000, padL = 90, padR = 90, padT = 54, sc = Math.min((Wpx - padL - padR) / W, 190 / Hft);
    const ox = padL + (Wpx - padL - padR - W * sc) / 2, X = y => ox + y * sc, Y = z => padT + (Hft - z) * sc, f = v => (+v).toFixed(1), F2 = v => (+v).toFixed(2);
    const tw = t => 6.6 * String(t).length + 12;
    const pill = (x, y, text, cls = '') => { const w = tw(text); return `<rect class="we-pill ${cls}" x="${f(x - w / 2)}" y="${f(y - 11)}" width="${f(w)}" height="15" rx="4"/><text class="we-lab ${cls}" x="${f(x)}" y="${f(y)}">${esc(text)}</text>`; };
    // the lines' names and loads under the ground, a row lower where one would run into the last
    const labs = S.lines.slice().sort((a, b) => a.y - b.y).map(l => ({ l, name: `${l.label}${l.independent ? ' · new bracing line' : ''}`, val: l.F != null ? `${F2(l.F)} k · EQB +${F2(l.F)} / EQF −${F2(l.F)}` : 'waiting on the Seismic calc' }));
    let right = -1e9, rows = 0;
    labs.forEach(q => { const hw = Math.max(tw(q.name), tw(q.val)) / 2, x = Math.min(Math.max(X(q.l.y), padL / 2 + hw - 40), Wpx - hw); q.tx = x; q.row = x - hw < right + 10 ? (rows = Math.max(rows, 1), (labs[labs.indexOf(q) - 1] || {}).row === 1 ? 0 : 1) : 0; right = x + hw; });
    const padB = 62 + rows * 38, Hpx = Hft * sc + padT + padB;
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx.toFixed(0)}" class="wall-elev split-elev" role="img" aria-label="${esc(S.name)}: the mezzanine's longitudinal seismic to its bracing lines"><defs><marker id="spArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="sp-head"/></marker></defs>`;
    // the building across: ground, sidewall columns, the roof
    s += `<line class="we-ground" x1="${f(X(0) - 30)}" y1="${f(Y(0))}" x2="${f(X(W) + 30)}" y2="${f(Y(0))}"/>`;
    s += `<polyline class="we-eave" points="${[[0, 0], ...ys.map(y => [y, S.top(y)]), [W, 0]].map(([y, z]) => `${f(X(y))},${f(Y(z))}`).join(' ')}" fill="none"/>`;
    s += `<line class="we-col" x1="${f(X(0))}" y1="${f(Y(0))}" x2="${f(X(0))}" y2="${f(Y(S.top(0)))}"/><line class="we-col" x1="${f(X(W))}" y1="${f(Y(0))}" x2="${f(X(W))}" y2="${f(Y(S.top(W)))}"/>`;
    // a line off the walls: the bracing line to design there, dashed from the floor to the mezzanine
    S.lines.filter(l => l.independent).forEach(l => { s += `<line class="sp-fig" x1="${f(X(l.y))}" y1="${f(Y(0))}" x2="${f(X(l.y))}" y2="${f(Y(l.at))}"/>`; });
    S.floors.forEach(m => { const xa = X(m.y0), xb = X(m.y1), z = Y(m.A); s += `<rect class="we-mezz" x="${f(xa)}" y="${f(z - 2.5)}" width="${f(xb - xa)}" height="5"/>`; });
    S.lines.forEach(l => { s += `<circle class="sp-dot ${l.independent ? 'sp-new' : 'sp-wall'}" cx="${f(X(l.y))}" cy="${f(Y(l.at))}" r="4.5"/>`; });
    // each mezzanine on a row of its own over the floor: its force, and an arrow out to each line its halves go to (dashed
    // where it runs on through the mezzanine it is joined to)
    const late = [];
    S.floors.forEach((m, i) => {
      const z = Y(m.A) - 20 - 24 * i, text = `${mezzName(m.id)} · ${m.F != null ? F2(m.F) + ' k' : '—'}`, hw = tw(text) / 2;
      const mid = Math.min(Math.max((X(m.y0) + X(m.y1)) / 2, X(0) + hw + 4), X(W) - hw - 4), to = m.to && m.to.length ? m.to : [m.y0, m.y1];
      to.forEach(y => { const xt = X(y), d = xt < mid ? -1 : 1; if (Math.abs(xt - mid) > hw + 8) s += `<g class="sp-flow${y < m.y0 - 0.6 || y > m.y1 + 0.6 ? ' is-via' : ''}"><line x1="${f(mid + d * (hw + 2))}" y1="${f(z - 4)}" x2="${f(xt - d * 2)}" y2="${f(z - 4)}" marker-end="url(#spArr)"/><line class="sp-drop" x1="${f(xt)}" y1="${f(z - 4)}" x2="${f(xt)}" y2="${f(Y(m.A) - 5)}"/></g>`; });
      late.push(pill(mid, z, text, 'we-mezzlab'));
    });
    labs.forEach(q => {
      const cls = q.l.independent ? 'sp-new' : 'sp-wall', y0 = Y(0) + 22 + q.row * 38;
      if (q.row) s += `<line class="sp-lead" x1="${f(X(q.l.y))}" y1="${f(Y(0) + 4)}" x2="${f(X(q.l.y))}" y2="${f(y0 - 12)}"/>`;
      s += `<text class="sp-name ${cls}" x="${f(q.tx)}" y="${f(y0)}">${esc(q.name)}</text><text class="sp-eq" x="${f(q.tx)}" y="${f(y0 + 17)}">${esc(q.val)}</text>`;
    });
    s += late.join('');
    s += `<text class="we-title" x="${f(X(0) - 30)}" y="${padT - 30}">${esc(S.name)} · looking along the building</text>`;
    if (S.total != null) s += `<text class="we-note" x="${f(X(W) + 30)}" y="${padT - 30}">${F2(S.total)} k in all · each mezzanine half to each edge</text>`;
    return s + '</svg>';
  }

  /* ---------- a bracing line that is not a sidewall, in elevation: a mezzanine edge off the walls (a bracing wall to
     create in NBG Bracing) or an endwall ----------
     Ln: { title, note, length (ft along the line), top: u => the roof over the line, cols: [{ u, kind: 'frame' | 'post' |
     'mezz' }], bubbles: [{ u, text }], mezz: [{ u0, u1, A, label }], run: [[u0, u1]] (the bracing wall's stretch),
     bays: [{ u0, u1, i }] (the bays between columns in the run, each a button), pick: { i, kind: 'x' | 'portal', A },
     braces: [{ u0, u1, z0, z1, kind }] (bracing already listed: an endwall's from the PCS), loads: [{ u, elev, F, caseId }] } */
  function lineSvg(Ln) {
    const L = Math.max(1, Ln.length), us = Array.from({ length: 41 }, (_, i) => (L * i) / 40), zTop = Math.max(...us.map(u => Ln.top(u))), Hft = zTop + 4;
    const Wpx = 1000, padL = 40, padR = 40, padT = 30, padB = 46, sc = Math.min((Wpx - padL - padR) / L, 185 / Hft), Hpx = Hft * sc + padT + padB;
    const ox = padL + (Wpx - padL - padR - L * sc) / 2, X = u => ox + u * sc, Y = z => padT + (Hft - z) * sc, f = v => (+v).toFixed(1);
    const tw = t => 6.6 * String(t).length + 12;
    const pill = (x, y, text, cls = '') => { const w = tw(text); return `<rect class="we-pill" x="${f(x - w / 2)}" y="${f(y - 11)}" width="${f(w)}" height="15" rx="4"/><text class="we-lab ${cls}" x="${f(x)}" y="${f(y)}">${esc(text)}</text>`; };
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx.toFixed(0)}" class="wall-elev line-elev" role="img" aria-label="${esc(Ln.title)}"><defs><marker id="leArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker><marker id="leArrW" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="we-waithead"/></marker></defs>`;
    // the building's section along the line, faint; the roof over it
    s += `<polygon class="le-sect" points="${f(X(0))},${f(Y(0))} ${us.map(u => `${f(X(u))},${f(Y(Ln.top(u)))}`).join(' ')} ${f(X(L))},${f(Y(0))}"/>`;
    s += `<polyline class="le-roof" points="${us.map(u => `${f(X(u))},${f(Y(Ln.top(u)))}`).join(' ')}"/>`;
    // the bracing wall's zone: the run, floor to the mezzanine level (or the roof for an endwall)
    const zoneTop = Ln.pick && Ln.pick.A != null ? Ln.pick.A : null;
    (Ln.run || []).forEach(([u0, u1]) => { if (zoneTop != null) s += `<rect class="le-zone" x="${f(X(u0))}" y="${f(Y(zoneTop))}" width="${f((u1 - u0) * sc)}" height="${f(zoneTop * sc)}"/>`; });
    (Ln.mezz || []).forEach(m => { s += `<rect class="we-mezz" x="${f(X(m.u0))}" y="${f(Y(m.A) - 2)}" width="${f((m.u1 - m.u0) * sc)}" height="4"/>`; });
    // bracing already there (an endwall's), then the picked bay: X from the floor to the mezzanine, or a portal frame
    (Ln.braces || []).forEach(b => { s += b.kind === 'portal' ? `<g class="we-portal"><line x1="${f(X(b.u0))}" y1="${f(Y(b.z1))}" x2="${f(X(b.u1))}" y2="${f(Y(b.z1))}"/></g>` : `<g class="we-x"><line x1="${f(X(b.u0))}" y1="${f(Y(b.z0))}" x2="${f(X(b.u1))}" y2="${f(Y(b.z1))}"/><line x1="${f(X(b.u0))}" y1="${f(Y(b.z1))}" x2="${f(X(b.u1))}" y2="${f(Y(b.z0))}"/></g>`; });
    const pb = Ln.pick ? (Ln.bays || []).find(b => b.i === Ln.pick.i) : null;
    if (pb && zoneTop != null) {
      if (Ln.pick.kind === 'portal') {
        const inset = Math.min(0.8, (pb.u1 - pb.u0) * 0.08);
        s += `<g class="we-portal"><line x1="${f(X(pb.u0 + inset))}" y1="${f(Y(0))}" x2="${f(X(pb.u0 + inset))}" y2="${f(Y(zoneTop))}"/><line x1="${f(X(pb.u1 - inset))}" y1="${f(Y(0))}" x2="${f(X(pb.u1 - inset))}" y2="${f(Y(zoneTop))}"/><line x1="${f(X(pb.u0 + inset))}" y1="${f(Y(zoneTop))}" x2="${f(X(pb.u1 - inset))}" y2="${f(Y(zoneTop))}"/><line x1="${f(X(pb.u0 + inset))}" y1="${f(Y(zoneTop - 0.9))}" x2="${f(X(pb.u1 - inset))}" y2="${f(Y(zoneTop - 0.9))}"/></g>`;
      } else if (Ln.pick.kind === 'knee') {
        const k = Math.min(3, (pb.u1 - pb.u0) / 4);
        s += `<g class="we-x"><line x1="${f(X(pb.u0))}" y1="${f(Y(zoneTop - k))}" x2="${f(X(pb.u0 + k))}" y2="${f(Y(zoneTop))}"/><line x1="${f(X(pb.u1))}" y1="${f(Y(zoneTop - k))}" x2="${f(X(pb.u1 - k))}" y2="${f(Y(zoneTop))}"/></g>`;
      } else if (Ln.pick.kind === 'other') s += `<rect class="le-other" x="${f(X(pb.u0))}" y="${f(Y(zoneTop))}" width="${f((pb.u1 - pb.u0) * sc)}" height="${f(zoneTop * sc)}"/>`;
      else s += `<g class="we-x"><line x1="${f(X(pb.u0))}" y1="${f(Y(0))}" x2="${f(X(pb.u1))}" y2="${f(Y(zoneTop))}"/><line x1="${f(X(pb.u0))}" y1="${f(Y(zoneTop))}" x2="${f(X(pb.u1))}" y2="${f(Y(0))}"/></g>`;
    }
    // the strut along the run at the mezzanine level (the mezzanine's edge beam carries the load to the braced bay)
    if (zoneTop != null) (Ln.run || []).forEach(([u0, u1]) => { s += `<line class="we-strut is-new" x1="${f(X(u0))}" y1="${f(Y(zoneTop))}" x2="${f(X(u1))}" y2="${f(Y(zoneTop))}"/>`; });
    // columns: frame columns and endwall posts to the roof, mezzanine columns to the floor above them
    (Ln.cols || []).forEach(c => {
      const zt = c.kind === 'mezz' ? (c.top ?? zoneTop ?? 10) : Ln.top(c.u);
      s += `<line class="${c.kind === 'mezz' ? 'le-mcol' : 'we-col'}" x1="${f(X(c.u))}" y1="${f(Y(0))}" x2="${f(X(c.u))}" y2="${f(Y(zt))}"/><rect class="we-base" x="${f(X(c.u) - 5)}" y="${f(Y(0) - 1.5)}" width="10" height="3" rx="1"/>`;
    });
    // the mezzanine's name under its floor, in the longest stretch the braced bay leaves free (left off when none holds it)
    (Ln.mezz || []).forEach(m => {
      const free = pb ? [[m.u0, Math.min(m.u1, pb.u0)], [Math.max(m.u0, pb.u1), m.u1]] : [[m.u0, m.u1]], best = free.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
      if ((best[1] - best[0]) * sc > tw(m.label) + 8) s += pill(X((best[0] + best[1]) / 2), Y(m.A) + 20, m.label, 'we-mezzlab');
    });
    // the bays as buttons
    (Ln.bays || []).forEach(b => { s += `<rect class="le-bayhit${pb && b.i === pb.i ? ' is-on' : ''}" data-lbay="${b.i}" x="${f(X(b.u0))}" y="${f(Y(zoneTop ?? Ln.top((b.u0 + b.u1) / 2)))}" width="${f((b.u1 - b.u0) * sc)}" height="${f((zoneTop ?? Ln.top((b.u0 + b.u1) / 2)) * sc)}"><title>Brace this bay (${ftin(b.u0)} – ${ftin(b.u1)})</title></rect>`; });
    s += `<line class="le-ground" x1="${f(X(0) - 8)}" y1="${f(Y(0))}" x2="${f(X(L) + 8)}" y2="${f(Y(0))}"/>`;
    (Ln.bubbles || []).forEach(b => { s += `<circle class="we-bub" cx="${f(X(b.u))}" cy="${f(Y(0) + 20)}" r="9"/><text class="we-bubt" x="${f(X(b.u))}" y="${f(Y(0) + 23.5)}">${esc(b.text)}</text>`; });
    const taken = [];
    (Ln.loads || []).forEach(q => {
      const z = Y(q.elev), dir = (q.F == null ? (q.caseId === 'EQF' ? -1 : 1) : q.F >= 0) ? 1 : -1, x0 = X(q.u) - dir * 56, x1 = X(q.u) - dir * 4;
      const tx = Math.min(Math.max(X(q.u) - dir * 30, 60), Wpx - 60), lab = q.F == null ? `${q.caseId} · waiting on Seismic` : `${q.caseId} ${q.F >= 0 ? '+' : '−'}${Math.abs(q.F).toFixed(2)} k`, ty = z - 9 - (dir < 0 ? 16 : 0);
      taken.push([tx - tw(lab) / 2, ty - 11, tx + tw(lab) / 2, ty + 4]);
      s += `<g class="we-load ${q.F == null ? 'is-wait' : q.F >= 0 ? 'is-b' : 'is-f'}"><line x1="${f(x0)}" y1="${f(z)}" x2="${f(x1)}" y2="${f(z)}" marker-end="url(#${q.F == null ? 'leArrW' : 'leArr'})"/>${pill(tx, ty, lab, q.F == null ? 'we-wait' : '')}</g>`;
    });
    // the picked bay's name: under the ground between the bay's bubbles when it fits, else over the floor — clear of the
    // EQB / EQF labels
    if (pb && zoneTop != null) {
      const bt = `${({ portal: 'portal frame', knee: 'knee braces', other: Ln.pick.note || 'your solution', x: 'X-bracing' })[Ln.pick.kind] || 'X-bracing'} · ${ftin(pb.u1 - pb.u0)}`, w = tw(bt), cx = X((pb.u0 + pb.u1) / 2);
      const roomy = (pb.u1 - pb.u0) * sc > w + 26, cands = [...(roomy ? [Y(0) + 24] : []), Y(zoneTop) - 30, Y(zoneTop) - 52, Y(zoneTop) + 22, Y(0) + 40];
      const clear = y => !taken.some(r => cx - w / 2 < r[2] + 3 && cx + w / 2 > r[0] - 3 && y - 11 < r[3] + 3 && y + 4 > r[1] - 3);
      s += pill(cx, cands.find(clear) ?? cands[0], bt, 'we-brlab');
    }
    s += `<text class="we-title" x="${padL}" y="${padT - 12}">${esc(Ln.title)}</text>`;
    if (Ln.note) s += `<text class="we-note" x="${f(Wpx - padR)}" y="${padT - 12}">${esc(Ln.note)}</text>`;
    return s + '</svg>';
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
    // w: from the step wall to where the drift runs out, its ends carried down from the drift to the dimension line
    s += `<line class="ss-ext" x1="${f(X(reach))}" y1="${f(Y(hb + endH))}" x2="${f(X(reach))}" y2="${f(Y(0) + 32)}"/><line class="ss-ext" x1="${f(X(0))}" y1="${f(Y(0))}" x2="${f(X(0))}" y2="${f(Y(0) + 32)}"/>`;
    s += dim(X(0), Y(0) + 26, X(reach), Y(0) + 26, dr.truncated ? `drift length w ${ftin(w)} — cut off at the far eave, ${r1(dr.end)} psf there` : `drift length w = ${ftin(w)}`, X(reach / 2), Y(0) + 41);
    // Dmax, the drift load at the wall, at the top of the triangle
    { const t = `Dmax ${r1(dr.pd)} psf`, tw2 = 7.2 * t.length + 14, ax = X(0) + 8, ay = Y(hb + hd) - 10;
      s += `<g class="ss-apex"><rect x="${f(ax)}" y="${f(ay - 13)}" width="${f(tw2)}" height="18" rx="5"/><text x="${f(ax + tw2 / 2)}" y="${f(ay + 1)}" text-anchor="middle">${esc(t)}</text></g><circle class="ss-apexdot" cx="${f(X(0))}" cy="${f(Y(hb + hd))}" r="3.5"/>`; }
    if (sl) s += dim(X(0), Y(0) + 50, X(ext), Y(0) + 50, `sliding ${ftin(ext)}`, X(ext / 2), Y(0) + 65);
    // the figures, top right: the peak and what governs
    const tx = X(xMax), lines = [`Dmax = pd = hd γ = ${r1(dr.pd)} psf · w ${ftin(w)}`, `${dr.gov} governs · γ ${gam.toFixed(2)} pcf · hc ${ftin(dr.hc)}`, `balanced ${r1(d.psLower)} psf → ${r1(dr.pd + d.psLower)} psf at the wall`];
    if (sl) lines.push(`sliding ${r1(sl.psf)} psf over ${ftin(ext)} — the larger of the two is carried (7.9)`);
    s += lines.map((t, i) => `<text class="${i ? 'ss-fig' : 'ss-peak'} ss-end" x="${f(tx)}" y="${f(20 + i * 15 + (i ? 4 : 0))}">${esc(t)}</text>`).join('');
    // the frame lines / purlins the drift falls across: ticks with their numbers; the values are listed under the drawing
    (opts.marks || []).filter(m => m.x >= -1e-6 && m.x <= xMax + 1e-6).forEach(m => { const x = X(m.x); s += `<line class="ss-tick" x1="${f(x)}" y1="${f(Y(0) - 4)}" x2="${f(x)}" y2="${f(Y(0) + 5)}"/><text class="ss-mark" x="${f(x)}" y="${f(Y(0) + 15)}" text-anchor="middle">${esc(m.short || m.label)}</text>`; });
    s += `<text class="ss-key" x="8" y="${f(Hpx - 8)}">Section through the step · ${d.kind === 'side' ? 'across the lower frames' : 'along the lower building'} · across to scale, the snow ×${(sy / sx).toFixed(1)} upward${broken ? ', the step wall broken' : ''}</text>`;
    s += '</svg>';
    return s;
  }

  /* ---------- unbalanced snow on a gable (7.6.1), across the building with the wind from the FSW: windward 0.3 ps,
     leeward ps with the surcharge from the ridge — the number NBG Frame takes as the alternate snow ----------
     r: a roof of the snow job ({ name, ps, unbalanced: { windward, leeward, surcharge, length, simple }, building: { g } }) */
  function unbalancedSvg(r) {
    const u = r.unbalanced, g = r.building.g, W = g.width, brk = SITE.roofBreaks(g), yr = brk.length > 2 ? brk[1] : W / 2, Z = y => SITE.roofZ(g, 0, y);
    const zMax = Math.max(...brk.map(Z)), Wpx = 760, padL = 70, padR = 70, padT = 96, padB = 58, sx = (Wpx - padL - padR) / W;
    const peak = Math.max(u.leeward + (u.surcharge || 0), u.windward, 1), hLoad = 82, pz = v => (v / peak) * hLoad;   // psf → px above the roof
    const roofPx = Math.min(110, zMax * sx * 0.9), sz = roofPx / zMax, Hpx = padT + hLoad + roofPx + padB;
    const X = y => padL + y * sx, Y = z => padT + hLoad + (zMax - z) * sz, f = v => (+v).toFixed(1), F1 = v => (+v).toFixed(1);
    const band = (y0, y1, v, cls) => { if (!(v > 0)) return ''; const p0 = [X(y0), Y(Z(y0)) - 2], p1 = [X(y1), Y(Z(y1)) - 2]; return `<polygon class="${cls}" points="${f(p0[0])},${f(p0[1])} ${f(p1[0])},${f(p1[1])} ${f(p1[0])},${f(p1[1] - pz(v))} ${f(p0[0])},${f(p0[1] - pz(v))}"/>`; };
    const arrows = (y0, y1, v, base, cls) => { let a = ''; const n = Math.max(2, Math.round((y1 - y0) * sx / 46)); for (let i = 0; i <= n; i++) { const y = y0 + (y1 - y0) * i / n, yb = Y(Z(y)) - 2 - base; a += `<line class="${cls}" x1="${f(X(y))}" y1="${f(yb - pz(v))}" x2="${f(X(y))}" y2="${f(yb - 3)}" marker-end="url(#ubArr)"/>`; } return a; };
    const tw = (t, cls) => (cls === 'ub-surt' ? 7.9 : 7.1) * String(t).length + 16;
    const pill = (x, y, t, cls = '') => `<rect class="ub-pill ${cls}" x="${f(x - tw(t, cls) / 2)}" y="${f(y - 12)}" width="${f(tw(t, cls))}" height="17" rx="5"/><text class="ub-lab ${cls}" x="${f(x)}" y="${f(y + 1)}">${esc(t)}</text>`;
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx.toFixed(0)}" class="ub-sec" role="img" aria-label="${esc(r.name)}: unbalanced snow"><defs><marker id="ubArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="ub-head"/></marker><marker id="ubWind" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="ub-windhead"/></marker></defs>`;
    // the building: columns, the roof
    s += `<line class="ub-ground" x1="${f(X(0) - 20)}" y1="${f(Y(0))}" x2="${f(X(W) + 20)}" y2="${f(Y(0))}"/>`;
    s += `<polyline class="ub-frame" points="${f(X(0))},${f(Y(0))} ${brk.map(y => `${f(X(y))},${f(Y(Z(y)))}`).join(' ')} ${f(X(W))},${f(Y(0))}"/>`;
    // the wind, from the FSW
    s += `<line class="ub-wind" x1="${f(X(0) - 58)}" y1="${f(padT - 6)}" x2="${f(X(0) - 8)}" y2="${f(padT - 6)}" marker-end="url(#ubWind)"/><text class="ub-windt" x="${f(X(0) - 58)}" y="${f(padT - 14)}">wind</text>`;
    if (u.simple) {
      s += band(yr, W, u.leeward, 'ub-lee') + arrows(yr, W, u.leeward, 0, 'ub-arr');
      s += pill((X(yr) + X(W)) / 2, Y(Z((yr + W) / 2)) - pz(u.leeward) - 16, `leeward Is pg = ${F1(u.leeward)} psf`, 'ub-leet');
      s += pill((X(0) + X(yr)) / 2, Y(Z(yr / 2)) - 22, 'windward 0', '');
    } else {
      // windward 0.3 ps; leeward ps; the surcharge on the leeward from the ridge
      s += band(0, yr, u.windward, 'ub-wind-b') + arrows(0, yr, u.windward, 0, 'ub-arr');
      s += band(yr, W, u.leeward, 'ub-lee') + arrows(yr, W, u.leeward, 0, 'ub-arr');
      const ys = Math.min(W, yr + u.length * Math.cos(Math.atan((g.slopeBSW ?? 1) / 12)));
      const p0 = [X(yr), Y(Z(yr)) - 2 - pz(u.leeward)], p1 = [X(ys), Y(Z(ys)) - 2 - pz(u.leeward)];
      s += `<polygon class="ub-sur" points="${f(p0[0])},${f(p0[1])} ${f(p1[0])},${f(p1[1])} ${f(p1[0])},${f(p1[1] - pz(u.surcharge))} ${f(p0[0])},${f(p0[1] - pz(u.surcharge))}"/>`;
      s += pill((X(0) + X(yr)) / 2, Y(Z(yr / 2)) - 2 - pz(u.windward) - 14, `windward 0.3 ps = ${F1(u.windward)} psf`);
      s += pill((X(ys) + X(W)) / 2 + 10, Y(Z((ys + W) / 2)) - 2 - pz(u.leeward) - 14, `leeward ps = ${F1(u.leeward)} psf`, 'ub-leet');
      // the surcharge: its value large over it, its length dimensioned under the roof
      const sx0 = (p0[0] + p1[0]) / 2, sy0 = Math.min(p0[1], p1[1]) - pz(u.surcharge) - 14;
      s += pill(sx0, sy0, `Alt snow · surcharge ${F1(u.surcharge)} psf`, 'ub-surt');
      const dy = Y(0) + 22;
      s += `<line class="ub-dim" x1="${f(X(yr))}" y1="${f(dy)}" x2="${f(X(ys))}" y2="${f(dy)}"/><line class="ub-dim" x1="${f(X(yr))}" y1="${f(dy - 6)}" x2="${f(X(yr))}" y2="${f(dy + 6)}"/><line class="ub-dim" x1="${f(X(ys))}" y1="${f(dy - 6)}" x2="${f(X(ys))}" y2="${f(dy + 6)}"/>`;
      s += `<line class="ub-ext" x1="${f(X(yr))}" y1="${f(Y(Z(yr)))}" x2="${f(X(yr))}" y2="${f(dy)}"/><line class="ub-ext" x1="${f(X(ys))}" y1="${f(Y(Z(ys)))}" x2="${f(X(ys))}" y2="${f(dy)}"/>`;
      s += `<text class="ub-dimt" x="${f((X(yr) + X(ys)) / 2)}" y="${f(dy + 16)}">${ftin(u.length)} from the ridge · 8 hd √S / 3</text>`;
    }
    s += `<text class="ub-side" x="${f(X(0))}" y="${f(Y(0) + 18)}">FSW</text><text class="ub-side" x="${f(X(W))}" y="${f(Y(0) + 18)}">BSW</text>`;
    s += `<text class="ub-title" x="${f(padL - 50)}" y="24">${esc(r.name)} · unbalanced snow, wind from the FSW</text><text class="ub-note" x="${f(Wpx - 16)}" y="24">${u.simple ? 'W ≤ 20 ft: the simple case (7.6.1)' : `hd ${ftin(u.hd)} · S ${F1(u.S)} · γ ${F1(r.gamma)} pcf · and the mirror with the wind from the BSW`}</text>`;
    return s + '</svg>';
  }

  /* ---------- main wind force zones on the building, as NBG Design Calcs numbers them (ASCE 7 Fig. 28.3-1): one load
     case, its pressure on each zone (qh × the file's coefficient, which carries the internal pressure). Zones stay on their
     faces: 1 the FSW wall, 2 / 3 the FSW / BSW halves of the roof, 4 the BSW wall, 5 / 6 the endwalls; the end zones 1E–4E
     a strip 2a wide at the corner. A longitudinal case (wind on an endwall): 2 / 3 are the halves of the roof along the
     length, 5 the endwall with 2. Seen from the FSW–LEW corner; the faces behind are listed beside.
     o: { W, L, eF, eB, yr (ridge from the FSW, null on a single slope), zr, a2, qh, name, cs: { name, z: [1..6], e: [1..4] }, long } */
  function windSvg(o) {
    const { W, L } = o, c30 = Math.cos(Math.PI / 6), s30 = 0.5, zr = o.yr != null ? o.zr : null;
    const zTop = Math.max(o.eF, o.eB, zr || 0), Wpx = 760, Hpx = 400, k = Math.min((Wpx - 300) / ((L + W) * c30), (Hpx - 120) / ((L + W) * s30 + zTop));
    const ox = 150 + W * c30 * k, oy = Hpx - 40, f = v => (+v).toFixed(1);
    const P = (x, y, z) => [ox + (x - y) * c30 * k, oy - z * k - (x + y) * s30 * k], pts = a => a.map(q => P(...q)).map(q => `${f(q[0])},${f(q[1])}`).join(' ');
    const roofZ = y => (o.yr != null ? (y <= o.yr ? o.eF + (zr - o.eF) * (y / o.yr) : o.eB + (zr - o.eB) * ((W - y) / (W - o.yr))) : o.eF + (o.eB - o.eF) * (y / W));
    const p = n => (o.cs.z[n - 1] == null ? null : o.qh * o.cs.z[n - 1]), pe = n => (o.cs.e[n - 1] == null ? null : o.qh * o.cs.e[n - 1]);
    const peak = Math.max(1, ...[1, 2, 3, 4, 5, 6].map(n => Math.abs(p(n) || 0)), ...[1, 2, 3, 4].map(n => Math.abs(pe(n) || 0)));
    const fill = v => (v == null ? 'var(--surface-soft)' : v >= 0 ? `color-mix(in srgb, #ff8f6b ${Math.round(18 + 52 * Math.abs(v) / peak)}%, var(--surface))` : `color-mix(in srgb, #6bb8ff ${Math.round(18 + 52 * Math.abs(v) / peak)}%, var(--surface))`);
    const sgn = v => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);
    const face = (poly, v, cls = '') => `<polygon class="wz-face ${cls}" points="${pts(poly)}" style="fill:${fill(v)}"/>`;
    const lab = (q, z, v, big = true) => { const c = P(...q); return `<text class="wz-z${big ? '' : ' sm'}" x="${f(c[0])}" y="${f(c[1] - (big ? 2 : 0))}">${esc(z)}</text><text class="wz-p${big ? '' : ' sm'}" x="${f(c[0])}" y="${f(c[1] + (big ? 14 : 11))}">${sgn(v)}</text>`; };
    const a2 = Math.min(o.a2 || 0, L / 4), rs = (y0, y1, x0, x1) => [[x0, y0, roofZ(y0)], [x1, y0, roofZ(y0)], [x1, y1, roofZ(y1)], [x0, y1, roofZ(y1)]];
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx}" class="wz-svg" role="img" aria-label="${esc(o.name)}: wind zones, case ${esc(o.cs.name)}"><defs><marker id="wzArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="wz-head"/></marker></defs>`;
    const yr = o.yr != null ? o.yr : W / 2, hid = [];
    if (!o.long) {
      // FSW wall (1, 1E), the endwall seen (5), the roof halves (2, 2E | 3, 3E)
      s += face([[a2, 0, 0], [L, 0, 0], [L, 0, o.eF], [a2, 0, o.eF]], p(1)) + face([[0, 0, 0], [a2, 0, 0], [a2, 0, o.eF], [0, 0, o.eF]], pe(1), 'is-e');
      s += face([[0, 0, 0], [0, W, 0], [0, W, o.eB], ...(o.yr != null ? [[0, o.yr, zr]] : []), [0, 0, o.eF]], p(5));
      s += face(rs(0, yr, a2, L), p(2)) + face(rs(0, yr, 0, a2), pe(2), 'is-e') + face(rs(yr, W, a2, L), p(3)) + face(rs(yr, W, 0, a2), pe(3), 'is-e');
      s += lab([(a2 + L) / 2, 0, o.eF / 2], '1', p(1)) + (a2 > 0 ? lab([a2 / 2, 0, o.eF / 2], '1E', pe(1), false) : '') + lab([0, W / 2, Math.min(o.eF, o.eB) / 2], '5', p(5));
      s += lab([(a2 + L) / 2, yr / 2, roofZ(yr / 2)], '2', p(2)) + lab([(a2 + L) / 2, (yr + W) / 2, roofZ((yr + W) / 2)], '3', p(3));
      if (a2 > 0) s += lab([a2 / 2, yr / 2, roofZ(yr / 2)], '2E', pe(2), false) + lab([a2 / 2, (yr + W) / 2, roofZ((yr + W) / 2)], '3E', pe(3), false);
      hid.push(['4', 'BSW wall', p(4)], ['4E', 'BSW end zone', pe(4)], ['6', 'far endwall', p(6)]);
      // the wind, onto the FSW (or the BSW: from behind)
      const fromF = (o.cs.z[0] || 0) >= (o.cs.z[3] || 0), a = P(L * 0.55, fromF ? -W * 0.55 : W * 1.5, o.eF * 0.6), b = P(L * 0.55, fromF ? -W * 0.08 : W * 1.05, o.eF * 0.6);
      s += `<line class="wz-wind" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" marker-end="url(#wzArr)"/><text class="wz-windt" x="${f(a[0])}" y="${f(a[1] - 6)}">wind ${fromF ? 'onto the FSW' : 'onto the BSW (from behind)'}</text>`;
    } else {
      // wind on an endwall: the endwall seen is 5 when it is windward, the roof halves 2 / 3 along the length
      const five = (o.cs.z[4] || 0) >= (o.cs.z[5] || 0), zEnd = five ? 5 : 6, zFar = five ? 6 : 5, rNear = five ? 2 : 3, rFar = five ? 3 : 2;
      s += face([[0, 0, 0], [L, 0, 0], [L, 0, o.eF], [0, 0, o.eF]], p(1)) + face([[0, 0, 0], [0, W, 0], [0, W, o.eB], ...(o.yr != null ? [[0, o.yr, zr]] : []), [0, 0, o.eF]], p(zEnd));
      s += face([[0, 0, o.eF], [L / 2, 0, o.eF], ...(o.yr != null ? [[L / 2, o.yr, zr]] : []), [L / 2, W, o.eB], [0, W, o.eB], ...(o.yr != null ? [[0, o.yr, zr]] : [])], p(rNear)) + face([[L / 2, 0, o.eF], [L, 0, o.eF], ...(o.yr != null ? [[L, o.yr, zr]] : []), [L, W, o.eB], [L / 2, W, o.eB], ...(o.yr != null ? [[L / 2, o.yr, zr]] : [])], p(rFar));
      s += lab([L / 2, 0, o.eF / 2], '1', p(1)) + lab([0, W / 2, Math.min(o.eF, o.eB) / 2], String(zEnd), p(zEnd)) + lab([L / 4, W / 2, roofZ(W / 2)], String(rNear), p(rNear)) + lab([L * 0.75, W / 2, roofZ(W / 2)], String(rFar), p(rFar));
      hid.push(['4', 'BSW wall', p(4)], [String(zFar), 'far endwall (leeward)', p(zFar)]);
      const a = P(-L * 0.35, W / 2, o.eF * 0.55), b = P(-L * 0.04, W / 2, o.eF * 0.55);
      s += `<line class="wz-wind" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" marker-end="url(#wzArr)"/><text class="wz-windt" x="${f(a[0])}" y="${f(a[1] - 6)}">wind on the endwall</text>`;
    }
    // the edges of the building drawn over the faces
    s += `<polyline class="wz-edge" points="${pts([[0, 0, 0], [L, 0, 0], [L, 0, o.eF], [0, 0, o.eF], [0, 0, 0], [0, W, 0], [0, W, o.eB], ...(o.yr != null ? [[0, o.yr, zr]] : []), [0, 0, o.eF]])}"/><polyline class="wz-edge" points="${pts([[L, 0, o.eF], ...(o.yr != null ? [[L, o.yr, zr], [0, o.yr, zr]] : []), ...(o.yr != null ? [] : [[L, W, o.eB], [0, W, o.eB]])])}"/>${o.yr == null ? '' : `<polyline class="wz-edge" points="${pts([[L, o.yr, zr], [L, W, o.eB], [0, W, o.eB]])}"/>`}`;
    // the faces behind, and the key
    const kx = Wpx - 214;
    s += `<g class="wz-hid"><text class="wz-kh" x="${kx}" y="34">Behind</text>${hid.map(([z, t, v], i) => `<rect x="${kx}" y="${44 + i * 26}" width="14" height="14" rx="3" style="fill:${fill(v)}"/><text x="${kx + 22}" y="${55 + i * 26}"><tspan class="wz-zt">${esc(z)}</tspan> ${esc(t)} <tspan class="wz-pt">${sgn(v)} psf</tspan></text>`).join('')}</g>`;
    s += `<g class="wz-key"><rect x="${kx}" y="${Hpx - 74}" width="14" height="14" rx="3" style="fill:${fill(peak)}"/><text x="${kx + 22}" y="${Hpx - 63}">+ pressure, onto the surface</text><rect x="${kx}" y="${Hpx - 50}" width="14" height="14" rx="3" style="fill:${fill(-peak)}"/><text x="${kx + 22}" y="${Hpx - 39}">− suction, away from it</text></g>`;
    s += `<text class="wz-title" x="16" y="24">${esc(o.name)} · case ${esc(o.cs.name)} · psf = qh ${o.qh.toFixed(2)} × the file's coefficient</text>`;
    if (a2 > 0) s += `<text class="wz-note" x="16" y="${Hpx - 12}">end zones (E) ${ftin(o.a2)} wide at the corner (2a) — each corner in turn</text>`;
    return s + '</svg>';
  }

  /* ---------- components and cladding on the roof, the square as Design Calcs lists its zones: the corners (3…), the
     edge bands (2…) and the field (1), each with its pressure and suction for one member (schematic: the bands are a wide).
     o: { W, L, a, name, member, zones: [{ label, wp, ws }] } */
  function ccSvg(o) {
    const Wpx = 520, Hpx = 330, pad = 36, k = Math.min((Wpx - 2 * pad - 150) / o.L, (Hpx - 2 * pad) / o.W), w = o.L * k, h = o.W * k, x0 = pad, y0 = (Hpx - h) / 2 + 6;
    const band = Math.max(18, Math.min(h / 4, w / 6, (o.a || 0) * k || 22)), f = v => (+v).toFixed(1);
    const grp = re => o.zones.filter(z => re.test(String(z.label)));
    const worst = zs => (zs.length ? { ws: Math.min(...zs.map(z => z.ws)), wp: Math.max(...zs.map(z => z.wp)), labels: zs.map(z => z.label).join(' / ') } : null);
    const g1 = worst(grp(/^1/)), g2 = worst(grp(/^2/)), g3 = worst(grp(/^3/));
    const t = (x, y, z) => (z ? `<text class="cc-z" x="${f(x)}" y="${f(y - 4)}">${esc(z.labels)}</text><text class="cc-p" x="${f(x)}" y="${f(y + 11)}">${z.ws.toFixed(1)}</text>` : '');
    let s = `<svg viewBox="0 0 ${Wpx} ${Hpx}" class="wz-svg cc-svg" role="img" aria-label="${esc(o.name)}: roof zones for components and cladding">`;
    s += `<rect class="cc-field" x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}"/>`;
    if (g2) s += `<path class="cc-edge" d="M${f(x0)},${f(y0)} h${f(w)} v${f(h)} h${f(-w)} z M${f(x0 + band)},${f(y0 + band)} v${f(h - 2 * band)} h${f(w - 2 * band)} v${f(-(h - 2 * band))} z" fill-rule="evenodd"/>`;
    if (g3) [[x0, y0], [x0 + w - band, y0], [x0, y0 + h - band], [x0 + w - band, y0 + h - band]].forEach(([x, y]) => { s += `<rect class="cc-corner" x="${f(x)}" y="${f(y)}" width="${f(band)}" height="${f(band)}"/>`; });
    s += t(x0 + w / 2, y0 + h / 2, g1) + (g2 ? t(x0 + w / 2, y0 + band / 2 + 2, g2) : '') + (g3 ? t(x0 + band / 2, y0 + band / 2 + 2, { ...g3, labels: g3.labels.split(' / ')[0] }) : '');
    s += `<text class="cc-side" x="${f(x0 + w / 2)}" y="${f(y0 + h + 18)}">FSW</text><text class="cc-side" x="${f(x0 + w / 2)}" y="${f(y0 - 8)}">BSW</text>`;
    const kx = x0 + w + 22;
    s += `<text class="wz-kh" x="${kx}" y="${f(y0 + 4)}">${esc(o.member)}</text>` + [[g3, 'corners', 'cc-corner'], [g2, 'edges', 'cc-edge'], [g1, 'field', 'cc-field']].filter(([z]) => z).map(([z, n, cls], i) => `<rect class="${cls}" x="${kx}" y="${f(y0 + 16 + i * 46)}" width="14" height="14" rx="3"/><text class="cc-kt" x="${kx + 22}" y="${f(y0 + 27 + i * 46)}">${esc(z.labels)} · ${n}</text><text class="cc-kv" x="${kx + 22}" y="${f(y0 + 43 + i * 46)}">${z.ws.toFixed(1)} / +${z.wp.toFixed(1)} psf</text>`).join('');
    s += `<text class="wz-note" x="${pad}" y="${Hpx - 8}">roof plan, schematic · edge zone a ${o.a ? ftin(o.a) : '—'} · suction / pressure</text>`;
    return s + '</svg>';
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

  const api = { ftin, frameEntry, columnsOf, endPosts, frameLines, frameData, scene, siteLetters, planSvg, frameSvg, wallSvg, splitSvg, lineSvg, stepSvg, unbalancedSvg, windSvg, ccSvg, iFaces };
  if (node) module.exports = api; else root.MZ_BUILDING = api;
})(typeof self !== 'undefined' ? self : this);
