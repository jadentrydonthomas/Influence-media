/* 3D framing model — a small canvas renderer (no libraries).
   Members are boxes (I-shapes = 3 boxes) and polylines in building feet (x along length from LEW,
   y across width from FSW, z up from finish floor). Painter's algorithm with back-face culling,
   Lambert shading, click to select, slow auto-rotate. The camera orbits a target point: drag to orbit it,
   right-drag / Shift-drag / two fingers to pan it, the wheel or a pinch zooms toward the pointer, a double-click
   (or focus(box)) flies to a mezzanine — so one of several far apart in a long building fills the view. */
(function (root) {
  'use strict';

  function boxFaces(b) {
    const { x0, x1, y0, y1, z0, z1 } = b;
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    // outward normals, counter-clockwise when seen from outside
    return [
      { v: [P[4], P[5], P[6], P[7]], n: [0, 0, 1] }, { v: [P[3], P[2], P[1], P[0]], n: [0, 0, -1] },
      { v: [P[0], P[1], P[5], P[4]], n: [0, -1, 0] }, { v: [P[2], P[3], P[7], P[6]], n: [0, 1, 0] },
      { v: [P[1], P[2], P[6], P[5]], n: [1, 0, 0] }, { v: [P[3], P[0], P[4], P[7]], n: [-1, 0, 0] },
    ];
  }

  function hexToRgb(h) {
    const m = h.replace('#', '');
    const n = parseInt(m.length === 3 ? m.split('').map(c => c + c).join('') : m, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const shade = (rgb, k, a = 1) => `rgba(${rgb.map(c => Math.round(Math.min(255, c * k))).join(',')},${a})`;

  /* scene: { center:[x,y,z], radius, members:[{ id, kind, color, boxes:[], lines:[[p,q],...], alpha, info }], labels:[{p:[x,y,z], text, kind}] } */
  function mount(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    // the window it draws in (a canvas in a window of its own — the building on a second screen — turns on that window's frames)
    const win = opts.win || (canvas.ownerDocument && canvas.ownerDocument.defaultView) || window, doc = win.document;
    const view = { yaw: -0.72, pitch: 0.52, zoom: 1, target: [0, 0, 0], auto: opts.auto !== false, hover: null, selected: null, toggles: { slab: true, joists: true, building: true, tags: true } };
    const home = { yaw: view.yaw, pitch: view.pitch, zoom: 1 };
    const ZMIN = 0.5, ZMAX = 40;
    let scene = null, polys = [], raf = 0, last = 0, dragging = null, visible = true, dpr = 1, W = 0, H = 0, fit = 1, anim = null, flakes = [];
    // falling snow over the scene (scene.flakes = { box, n, wind: [vx, vy] ft/s }): points that fall through the box and start over at the top
    function seedFlakes() {
      const f = scene && scene.flakes;
      flakes = [];
      if (!f || !f.box) return;
      const b = f.box;
      for (let i = 0; i < (f.n || 120); i++) flakes.push({ x: b.x0 + Math.random() * (b.x1 - b.x0), y: b.y0 + Math.random() * (b.y1 - b.y0), z: b.z0 + Math.random() * (b.z1 - b.z0), v: 2.2 + Math.random() * 2.6, r: 0.9 + Math.random() * 1.3, ph: Math.random() * 6.28 });
    }
    function stepFlakes(dt) {
      const f = scene && scene.flakes, b = f && f.box, k = dt / 1000;
      if (!b) return;
      const wx = (f.wind || [0, 0])[0], wy = (f.wind || [0, 0])[1];
      for (const q of flakes) {
        q.ph += k * 1.7;
        q.z -= q.v * k; q.x += (wx + Math.sin(q.ph) * 0.6) * k; q.y += (wy + Math.cos(q.ph * 0.8) * 0.6) * k;
        if (q.z < b.z0 || q.x < b.x0 - 2 || q.x > b.x1 + 2 || q.y < b.y0 - 2 || q.y > b.y1 + 2) { q.z = b.z1; q.x = b.x0 + Math.random() * (b.x1 - b.x0); q.y = b.y0 + Math.random() * (b.y1 - b.y0); }
      }
    }
    const pointers = new Map();
    const [PAD_T, PAD_B] = opts.pad || [34, 70];   // header text above, control bar below
    const [MIN_W, MIN_H] = opts.min || [300, 260];
    const light = (() => { const v = [-0.45, -0.6, 0.66]; const l = Math.hypot(...v); return v.map(c => c / l); })();

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, win.devicePixelRatio || 1);
      W = Math.max(MIN_W, r.width); H = Math.max(MIN_H, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      fitScale();
      draw();
    }

    // Scale that keeps the whole model in frame at every yaw for the home pitch (the scene's
    // bounding box is swept through a full turn), so orbiting never clips and tilting never pumps the zoom.
    function fitScale() {
      if (!scene || !W) return;
      if (!scene.box) { fit = Math.min(W, H) / (scene.radius * 2.4); return; }
      fit = fitOf(scene.box, scene.center, home.pitch, opts.fitScale || 0.93);
    }
    // the scale that keeps box b (about c) in frame at every yaw for a pitch: its corners swept through a full turn
    function fitOf(b, [cx, cy, cz], pitch, k0) {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      let mx = 1e-6, my = 1e-6;
      for (let k = 0; k < 48; k++) {
        const yaw = k * Math.PI / 24, c = Math.cos(yaw), s2 = Math.sin(yaw);
        for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0 || 0, b.z1 || 0]) {
          const dx = x - cx, dy = y - cy, dz = z - cz;
          mx = Math.max(mx, Math.abs(dx * c - dy * s2));
          my = Math.max(my, Math.abs(dz * cp + (dx * s2 + dy * c) * sp));
        }
      }
      return k0 * Math.min((W / 2 - 14) / mx, ((H - PAD_T - PAD_B) / 2) / my);
    }
    function project(p) {
      const [cx, cy, cz] = view.target;
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      const cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw);
      const x1 = dx * cyw - dy * syw, y1 = dx * syw + dy * cyw;
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
      const depth = y1 * cp - dz * sp;
      const sc = fit * view.zoom;
      const persp = 1 / (1 + depth / (scene.radius * 7));
      return [W / 2 + x1 * sc * persp, PAD_T + (H - PAD_T - PAD_B) / 2 - (dz * cp + y1 * sp) * sc * persp, depth];
    }
    // the screen's right and up directions in the world (for panning and zooming at the pointer), and its middle
    const axes = () => { const c = Math.cos(view.yaw), s2 = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch); return { R: [c, -s2, 0], U: [s2 * sp, c * sp, cp] }; };
    const mid = () => [W / 2, PAD_T + (H - PAD_T - PAD_B) / 2];
    // the world point under a canvas point, on the plane through the target facing the camera
    function under(x, y) {
      const { R, U } = axes(), sc = fit * view.zoom, [mx, my] = mid(), a = (x - mx) / sc, b = (my - y) / sc;
      return view.target.map((t, i) => t + R[i] * a + U[i] * b);
    }
    function pan(dx, dy) {
      const { R, U } = axes(), sc = fit * view.zoom;
      view.target = view.target.map((t, i) => t - R[i] * dx / sc + U[i] * dy / sc);
    }
    // zoom by k keeping the point under (x, y) where it is on the screen
    function zoomAt(k, x, y) {
      const z = Math.max(ZMIN, Math.min(ZMAX, view.zoom * k));
      if (x == null) { view.zoom = z; return; }
      const P = under(x, y), { R, U } = axes(), sc = fit * z, [mx, my] = mid(), a = (x - mx) / sc, b = (my - y) / sc;
      view.zoom = z;
      view.target = P.map((p, i) => p - R[i] * a - U[i] * b);
    }
    // fly the target and zoom to frame a box (a mezzanine) over ~0.4 s
    function focus(b, ms = 420) {
      if (!scene || !b) return;
      // framed the way the whole job is (it stays in view as it turns), with a little of the floor around it, in the
      // part of the canvas below whatever the page lays over its top (opts.overlay: that edge, in px)
      const top = Math.max(PAD_T, opts.overlay ? opts.overlay() || 0 : 0), room = (H - top - PAD_B) / (H - PAD_T - PAD_B);
      const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, ((b.z0 || 0) + (b.z1 || 0)) / 2];
      const z = Math.max(ZMIN, Math.min(ZMAX, fitOf(b, c, view.pitch, 0.82) * Math.min(1, Math.max(0.4, room)) / fit));
      // the middle of that part, not of the canvas: the box sits lower by half the overlay
      const { U } = axes(), dy = (top - PAD_T) / 2 / (fit * z);
      anim = { t0: performance.now(), ms, from: { target: view.target.slice(), zoom: view.zoom }, to: { target: c.map((v, i) => v + U[i] * dy), zoom: z } };
    }
    function stopAuto() { if (view.auto) { view.auto = false; if (opts.onAuto) opts.onAuto(false); } }

    function viewDir() { // direction from the scene toward the camera, in world coords
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch), cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw);
      // camera looks along +depth; depth = y1*cp - z*sp, y1 = x*syw + y*cyw
      return [-(syw * cp), -(cyw * cp), sp];
    }

    function build() {
      polys = [];
      if (!scene) return;
      const vd = viewDir();
      for (const m of scene.members) {
        if ((m.kind === 'slab' && !view.toggles.slab) || (m.kind === 'joist' && !view.toggles.joists) || (m.kind === 'bcol' && !view.toggles.building)) continue;
        if (view.toggles[m.kind] === false) continue;   // any other kind a page switches off (roof, snow, drift …)
        const rgb = hexToRgb(m.color);
        const hl = view.hover === m.id || view.selected === m.id;
        for (const b of m.boxes || []) {
          for (const f of boxFaces(b)) {
            const facing = f.n[0] * vd[0] + f.n[1] * vd[1] + f.n[2] * vd[2];
            if (facing <= 0.0001 && (m.alpha == null || m.alpha >= 1)) continue;   // back face
            const pts = f.v.map(project);
            const depth = pts.reduce((a, p) => a + p[2], 0) / 4;
            const lam = 0.5 + 0.55 * Math.max(0, f.n[0] * light[0] + f.n[1] * light[1] + f.n[2] * light[2]);
            polys.push({ type: 'poly', pts, depth, id: m.id, fill: shade(rgb, lam * (hl ? 1.25 : 1), m.alpha ?? 1), stroke: m.kind === 'slab' ? shade(rgb, 1.4, 0.35) : shade(rgb, 0.55, 0.9), hl, kind: m.kind });
          }
        }
        // free polygons (roof planes, snow, drift wedges): lit from either side, never culled
        for (const fc of m.faces || []) {
          const v = fc.pts || fc;
          if (v.length < 3) continue;
          const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
          let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
          const ln = Math.hypot(...n) || 1;
          n = n.map(c => c / ln);
          if (n[0] * vd[0] + n[1] * vd[1] + n[2] * vd[2] < 0) n = n.map(c => -c);
          const pts = v.map(project);
          const depth = pts.reduce((a, q) => a + q[2], 0) / pts.length;
          const lam = 0.62 + 0.45 * Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
          const rgbF = fc.color ? hexToRgb(fc.color) : rgb;
          polys.push({ type: 'poly', pts, depth, id: m.id, fill: shade(rgbF, lam * (hl ? 1.2 : 1), fc.alpha ?? m.alpha ?? 1), stroke: shade(rgbF, 1.15, Math.min(0.5, (m.alpha ?? 1) * 0.8)), hl, kind: m.kind });
        }
        for (const [a, c] of m.lines || []) {
          const pa = project(a), pc = project(c);
          polys.push({ type: 'line', pts: [pa, pc], depth: (pa[2] + pc[2]) / 2, id: m.id, stroke: shade(rgb, hl ? 1.3 : 1, m.alpha ?? 0.8), width: m.width || 1, hl, kind: m.kind });
        }
      }
      polys.sort((a, b) => b.depth - a.depth);
    }

    function draw() {
      if (!scene || !W) return;
      build();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // floor grid
      ctx.lineWidth = 1;
      for (const g of scene.floor || []) {
        const a = project(g[0]), b = project(g[1]);
        ctx.strokeStyle = g[2] || 'rgba(130,190,230,.12)';
        ctx.setLineDash(g[3] ? [6, 5] : []);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const p of polys) {
        ctx.beginPath();
        ctx.moveTo(p.pts[0][0], p.pts[0][1]);
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
        if (p.type === 'poly') {
          ctx.closePath();
          if (p.hl) { ctx.shadowColor = 'rgba(105,250,197,.65)'; ctx.shadowBlur = 16; }
          ctx.fillStyle = p.fill; ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = p.stroke; ctx.lineWidth = p.kind === 'slab' ? 1 : 0.6; ctx.stroke();
        } else {
          ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width * (p.hl ? 1.8 : 1); ctx.stroke();
        }
      }
      // snow in the air: the far flakes first, small and faint, the near ones last
      if (flakes.length && view.toggles.flakes !== false) {
        const pts = flakes.map(q => { const p = project([q.x, q.y, q.z]); return { x: p[0], y: p[1], d: p[2], r: q.r }; }).sort((a, b) => b.d - a.d);
        const dMin = Math.min(...pts.map(p => p.d)), dMax = Math.max(...pts.map(p => p.d)), span = Math.max(1e-6, dMax - dMin);
        for (const p of pts) { const near = 1 - (p.d - dMin) / span; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + near * 0.9), 0, Math.PI * 2); ctx.fillStyle = `rgba(240,248,255,${(0.35 + near * 0.55).toFixed(2)})`; ctx.fill(); }
      }
      // labels (grid bubbles, elevations)
      ctx.font = '600 11px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // grid bubbles and text first, the mark tags last: a tag that would cover a bubble or another tag steps up clear of it
      const all = scene.labels || [], bubbles = all.filter(l => l.kind === 'bubble').map(l => project(l.p)), placed = [], placedTags = [];
      const hits = (x0, y0, x1, y1) => bubbles.some(b => b[0] + 11 > x0 && b[0] - 11 < x1 && b[1] + 11 > y0 && b[1] - 11 < y1) || placed.some(r => r[0] < x1 && r[2] > x0 && r[1] < y1 && r[3] > y0);
      for (const l of all.filter(q => q.kind !== 'tag').concat(all.filter(q => q.kind === 'tag'))) {
        const p = project(l.p);
        if (l.kind === 'tag') {
          // a mark tag on a beam (MB1 INT): outlined pill in the mark's colour
          if (!view.toggles.tags) continue;
          ctx.font = '700 10px "Cascadia Code", Consolas, monospace';
          const tw = ctx.measureText(l.text).width + 12;
          p[0] = Math.min(Math.max(p[0], tw / 2 + 4), W - tw / 2 - 4);   // a tag near the edge stays whole on the canvas
          const y0 = p[1] - 9 + (l.dy || 0), dy = [0, -20, 20, -38, 38].find(d => !hits(p[0] - tw / 2, y0 + d, p[0] + tw / 2, y0 + d + 17)), y = y0 + (dy || 0);
          // no free spot (a small view): a mark already tagged nearby is not tagged again
          if (dy == null && placedTags.some(q => q.text === l.text)) continue;
          placedTags.push(l);
          placed.push([p[0] - tw / 2, y, p[0] + tw / 2, y + 17]);
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(p[0] - tw / 2, y, tw, 17, 8.5); else ctx.rect(p[0] - tw / 2, y, tw, 17);
          ctx.fillStyle = 'rgba(8,18,30,.86)'; ctx.fill(); ctx.strokeStyle = l.color; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.fillStyle = l.color; ctx.fillText(l.text, p[0], y + 9); ctx.lineWidth = 1;
          ctx.font = '600 11px "Segoe UI", Arial, sans-serif';
          continue;
        }
        if (l.kind === 'bubble') {
          ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(12,24,38,.85)'; ctx.fill(); ctx.strokeStyle = 'rgba(150,200,235,.55)'; ctx.stroke();
          ctx.fillStyle = '#d9ecfa'; ctx.fillText(l.text, p[0], p[1] + 0.5);
        } else {
          ctx.font = '11px "Cascadia Code", Consolas, monospace';
          // to the right of its point, else to the left, else a line up or down — the first spot clear of the bubbles and the
          // labels already drawn; with no clear spot it is left out rather than written over another
          const tw = ctx.measureText(l.text).width, xs = [p[0] + 8, p[0] - 8 - tw].filter(x => x >= 4 && x + tw <= W - 4);
          if (!xs.length) xs.push(Math.max(6, Math.min(W - 6 - tw, p[0] + 8)));
          let spot = null;
          for (const dy of [0, -14, 14, -28, 28]) { for (const x of xs) { const y = p[1] + (l.dy || 0) + dy; if (!hits(x - 2, y - 7, x + tw + 2, y + 7)) { spot = [x, y]; break; } } if (spot) break; }
          if (!spot) { ctx.textAlign = 'center'; ctx.font = '600 11px "Segoe UI", Arial, sans-serif'; continue; }
          ctx.fillStyle = l.color || 'rgba(190,220,240,.8)'; ctx.textAlign = 'left'; ctx.fillText(l.text, spot[0], spot[1]);
          placed.push([spot[0] - 2, spot[1] - 7, spot[0] + tw + 2, spot[1] + 7]);   // the tags and later labels keep clear of it
          ctx.textAlign = 'center'; ctx.font = '600 11px "Segoe UI", Arial, sans-serif';
        }
      }
    }

    function hit(x, y) {
      for (let i = polys.length - 1; i >= 0; i--) {
        const p = polys[i];
        if (p.kind === 'slab' || p.kind === 'floor' || p.kind === 'roof' || p.kind === 'snow') continue;
        if (p.type === 'poly') { if (inside(x, y, p.pts)) return p.id; }
        else if (segDist(x, y, p.pts[0], p.pts[1]) < 4) return p.id;
      }
      return null;
    }
    function inside(x, y, pts) {
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if (((pts[i][1] > y) !== (pts[j][1] > y)) && (x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0])) c = !c;
      }
      return c;
    }
    function segDist(x, y, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L));
      return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
    }

    function tick(t) {
      raf = win.requestAnimationFrame(tick);
      const dt = Math.min(64, t - (last || t)); last = t;
      if (anim) {
        const k = Math.min(1, (t - anim.t0) / anim.ms), e = 1 - Math.pow(1 - k, 3);
        view.target = anim.from.target.map((a, i) => a + (anim.to.target[i] - a) * e);
        view.zoom = anim.from.zoom * Math.pow(anim.to.zoom / anim.from.zoom, e);
        if (k >= 1) anim = null;
        draw();
      } else if (view.auto && !dragging && visible && !doc.hidden) { view.yaw += dt * (opts.speed || 0.00012); if (flakes.length && view.toggles.flakes !== false) stepFlakes(dt); draw(); }
      else if (flakes.length && view.toggles.flakes !== false && visible && !doc.hidden && !dragging) { stepFlakes(dt); draw(); }
    }

    const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    // one pointer: orbit (left), pan (right / middle button, or Shift); two pointers: pinch to zoom, move to pan
    const pinch = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    canvas.addEventListener('pointerdown', e => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      anim = null;
      if (pointers.size === 2) { dragging = { two: pinch(), moved: true }; stopAuto(); return; }
      const panning = e.button === 1 || e.button === 2 || e.shiftKey;
      dragging = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, moved: false, pan: panning, lx: e.clientX, ly: e.clientY };
      if (panning) { e.preventDefault(); canvas.style.cursor = 'move'; }
    });
    canvas.addEventListener('pointermove', e => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (dragging && dragging.two && pointers.size === 2) {
        const p = pinch(), r = canvas.getBoundingClientRect();
        pan(p.x - dragging.two.x, p.y - dragging.two.y);
        if (dragging.two.d > 0) zoomAt(p.d / dragging.two.d, p.x - r.left, p.y - r.top);
        dragging.two = p; draw();
      } else if (dragging && !dragging.two) {
        const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { dragging.moved = true; stopAuto(); }
        if (dragging.pan) { pan(e.clientX - dragging.lx, e.clientY - dragging.ly); dragging.lx = e.clientX; dragging.ly = e.clientY; }
        else {
          view.yaw = dragging.yaw + dx * 0.008;
          view.pitch = Math.max(0.08, Math.min(1.45, dragging.pitch + dy * 0.006));
        }
        draw();
      } else if (!dragging) {
        const [x, y] = pos(e), id = hit(x, y);
        if (id !== view.hover) { view.hover = id; canvas.style.cursor = id ? 'pointer' : 'grab'; draw(); if (opts.onHover) opts.onHover(id); }
      }
    });
    const release = e => {
      pointers.delete(e.pointerId);
      if (dragging && !dragging.two && !dragging.moved && !dragging.pan && e.type === 'pointerup') { const [x, y] = pos(e); view.selected = hit(x, y); draw(); if (opts.onSelect) opts.onSelect(view.selected); }
      if (dragging && dragging.two && pointers.size === 1) { const [q] = [...pointers.values()]; dragging = { x: q.x, y: q.y, yaw: view.yaw, pitch: view.pitch, moved: true, pan: true, lx: q.x, ly: q.y }; return; }
      if (!pointers.size) { dragging = null; canvas.style.cursor = view.hover ? 'pointer' : 'grab'; }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('contextmenu', e => e.preventDefault());   // the right button pans
    canvas.addEventListener('pointerleave', () => { if (view.hover) { view.hover = null; draw(); if (opts.onHover) opts.onHover(null); } });
    canvas.addEventListener('wheel', e => {
      e.preventDefault(); anim = null; stopAuto();
      const [x, y] = pos(e), k = Math.pow(1.0018, -Math.max(-240, Math.min(240, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY)));
      zoomAt(k, x, y); draw();
    }, { passive: false });
    // double-click: fly to the mezzanine under the pointer (its box from scene.groups), else zoom in there
    canvas.addEventListener('dblclick', e => {
      if (!scene) return;
      const [x, y] = pos(e), id = hit(x, y), m = id && scene.members.find(q => q.id === id), b = m && m.boxes && m.boxes[0];
      const at = b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : (() => { const P = under(x, y); return [P[0], P[1]]; })();
      const g = (scene.groups || []).find(q => at[0] >= q.box.x0 - 1 && at[0] <= q.box.x1 + 1 && at[1] >= q.box.y0 - 1 && at[1] <= q.box.y1 + 1);
      stopAuto();
      if (g) { focus(g.box); if (opts.onFocus) opts.onFocus(g.id); } else { zoomAt(2, x, y); draw(); }
    });
    if (win.IntersectionObserver) new win.IntersectionObserver(es => { visible = es.some(x => x.isIntersecting); }).observe(canvas);
    if (win.ResizeObserver) new win.ResizeObserver(resize).observe(canvas); else win.addEventListener('resize', resize);
    raf = win.requestAnimationFrame(tick);

    return {
      // a new scene keeps the view when it is the same job redrawn (an edit); a different extent starts whole again
      set(s) {
        const same = scene && s && scene.box && s.box && ['x0', 'x1', 'y0', 'y1'].every(k => Math.abs(scene.box[k] - s.box[k]) < 0.5);
        scene = s;
        if (!same) { view.target = s.center.slice(); view.zoom = 1; anim = null; }
        seedFlakes();
        resize();
      },
      select(id) { view.selected = id; draw(); },
      toggle(k, v) { view.toggles[k] = v; draw(); },
      toggles: view.toggles,
      zoom(k) { anim = null; zoomAt(k); draw(); },
      // frame a box (a mezzanine), or the whole scene with no box
      focus(b) { stopAuto(); if (b) focus(b); else if (scene) anim = { t0: performance.now(), ms: 420, from: { target: view.target.slice(), zoom: view.zoom }, to: { target: scene.center.slice(), zoom: 1 } }; },
      reset() { anim = null; Object.assign(view, home); if (scene) view.target = scene.center.slice(); draw(); },
      pause(on) { view.auto = !on; return view.auto; },
      // the camera, for a test: what it looks at and how close
      state() { return { target: view.target.slice(), zoom: view.zoom, yaw: view.yaw, pitch: view.pitch, moving: !!anim }; },
      get auto() { return view.auto; },
      redraw: draw,
      // where a member's top face sits on the canvas (CSS px) — lets a test or a caller point at it
      screenOf(id) {
        const m = scene && scene.members.find(x => x.id === id), b = m && m.boxes && m.boxes[0];
        if (!b) return null;
        const p = project([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1]);
        return [p[0], p[1]];
      },
      destroy() { win.cancelAnimationFrame(raf); },
    };
  }

  const api = { mount, boxFaces };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_3D = api;
})(typeof self !== 'undefined' ? self : this);
