/* 3D framing model — a small canvas renderer (no libraries).
   Members are boxes (I-shapes = 3 boxes) and polylines in building feet (x along length from LEW,
   y across width from FSW, z up from finish floor). Painter's algorithm with back-face culling,
   Lambert shading, drag to orbit, wheel / buttons to zoom, click to select, slow auto-rotate. */
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
    const view = { yaw: -0.72, pitch: 0.52, zoom: 1, auto: opts.auto !== false, hover: null, selected: null, toggles: { slab: true, joists: true, building: true } };
    const home = { yaw: view.yaw, pitch: view.pitch, zoom: 1 };
    let scene = null, polys = [], raf = 0, last = 0, dragging = null, visible = true, dpr = 1, W = 0, H = 0, fit = 1;
    const [PAD_T, PAD_B] = opts.pad || [34, 70];   // header text above, control bar below
    const [MIN_W, MIN_H] = opts.min || [300, 260];
    const light = (() => { const v = [-0.45, -0.6, 0.66]; const l = Math.hypot(...v); return v.map(c => c / l); })();

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(MIN_W, r.width); H = Math.max(MIN_H, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      fitScale();
      draw();
    }

    // Scale that keeps the whole model in frame at every yaw for the home pitch (the scene's
    // bounding box is swept through a full turn), so orbiting never clips and tilting never pumps the zoom.
    function fitScale() {
      if (!scene || !W) return;
      const b = scene.box, [cx, cy, cz] = scene.center, cp = Math.cos(home.pitch), sp = Math.sin(home.pitch);
      if (!b) { fit = Math.min(W, H) / (scene.radius * 2.4); return; }
      let mx = 1e-6, my = 1e-6;
      for (let k = 0; k < 48; k++) {
        const yaw = k * Math.PI / 24, c = Math.cos(yaw), s2 = Math.sin(yaw);
        for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
          const dx = x - cx, dy = y - cy, dz = z - cz;
          mx = Math.max(mx, Math.abs(dx * c - dy * s2));
          my = Math.max(my, Math.abs(dz * cp + (dx * s2 + dy * c) * sp));
        }
      }
      fit = (opts.fitScale || 0.93) * Math.min((W / 2 - 14) / mx, ((H - PAD_T - PAD_B) / 2) / my);
    }
    function project(p) {
      const [cx, cy, cz] = scene.center;
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      const cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw);
      const x1 = dx * cyw - dy * syw, y1 = dx * syw + dy * cyw;
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
      const depth = y1 * cp - dz * sp;
      const sc = fit * view.zoom;
      const persp = 1 / (1 + depth / (scene.radius * 7));
      return [W / 2 + x1 * sc * persp, PAD_T + (H - PAD_T - PAD_B) / 2 - (dz * cp + y1 * sp) * sc * persp, depth];
    }
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
      // labels (grid bubbles, elevations)
      ctx.font = '600 11px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const l of scene.labels || []) {
        const p = project(l.p);
        if (l.kind === 'bubble') {
          ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(12,24,38,.85)'; ctx.fill(); ctx.strokeStyle = 'rgba(150,200,235,.55)'; ctx.stroke();
          ctx.fillStyle = '#d9ecfa'; ctx.fillText(l.text, p[0], p[1] + 0.5);
        } else {
          ctx.font = '11px "Cascadia Code", Consolas, monospace';
          ctx.fillStyle = l.color || 'rgba(190,220,240,.8)'; ctx.textAlign = 'left'; ctx.fillText(l.text, p[0] + 8, p[1] + (l.dy || 0));
          ctx.textAlign = 'center'; ctx.font = '600 11px "Segoe UI", Arial, sans-serif';
        }
      }
    }

    function hit(x, y) {
      for (let i = polys.length - 1; i >= 0; i--) {
        const p = polys[i];
        if (p.kind === 'slab' || p.kind === 'floor') continue;
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
      raf = requestAnimationFrame(tick);
      const dt = Math.min(64, t - (last || t)); last = t;
      if (view.auto && !dragging && visible && !document.hidden) { view.yaw += dt * (opts.speed || 0.00012); draw(); }
    }

    const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', e => { dragging = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, moved: false }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (dragging) {
        const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
        view.yaw = dragging.yaw + dx * 0.008;
        view.pitch = Math.max(0.08, Math.min(1.45, dragging.pitch + dy * 0.006));
        draw();
      } else {
        const [x, y] = pos(e), id = hit(x, y);
        if (id !== view.hover) { view.hover = id; canvas.style.cursor = id ? 'pointer' : 'grab'; draw(); if (opts.onHover) opts.onHover(id); }
      }
    });
    canvas.addEventListener('pointerup', e => {
      if (dragging && !dragging.moved) { const [x, y] = pos(e); view.selected = hit(x, y); draw(); if (opts.onSelect) opts.onSelect(view.selected); }
      dragging = null;
    });
    canvas.addEventListener('pointerleave', () => { if (view.hover) { view.hover = null; draw(); if (opts.onHover) opts.onHover(null); } });
    canvas.addEventListener('wheel', e => { e.preventDefault(); view.zoom = Math.max(0.5, Math.min(3.2, view.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); draw(); }, { passive: false });
    if (typeof IntersectionObserver !== 'undefined') new IntersectionObserver(es => { visible = es.some(x => x.isIntersecting); }).observe(canvas);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas); else window.addEventListener('resize', resize);
    raf = requestAnimationFrame(tick);

    return {
      set(s) { scene = s; resize(); },
      select(id) { view.selected = id; draw(); },
      toggle(k, v) { view.toggles[k] = v; draw(); },
      toggles: view.toggles,
      zoom(k) { view.zoom = Math.max(0.5, Math.min(3.2, view.zoom * k)); draw(); },
      reset() { Object.assign(view, home); draw(); },
      pause(on) { view.auto = !on; return view.auto; },
      get auto() { return view.auto; },
      redraw: draw,
      // where a member's top face sits on the canvas (CSS px) — lets a test or a caller point at it
      screenOf(id) {
        const m = scene && scene.members.find(x => x.id === id), b = m && m.boxes && m.boxes[0];
        if (!b) return null;
        const p = project([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1]);
        return [p[0], p[1]];
      },
      destroy() { cancelAnimationFrame(raf); },
    };
  }

  const api = { mount, boxFaces };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_3D = api;
})(typeof self !== 'undefined' ? self : this);
