/* The whole job laid out: every building of the PCS (lean-tos and canopies with no mezzanine too) placed in one site
   plan through Box 2's attachment notes, each roof's height anywhere on it, the roof steps where a lower roof meets a
   higher building's wall, and the snow those steps put on the lower roof's frames — the frame-by-frame snow drift
   (and sliding snow) as panel loads ready for NBG Frame.

   Building coordinates as everywhere in this tool: x along the length from the LEW, y across the width from the FSW,
   heights up from the finished floor. Site coordinates: the first building's own, the others turned by quarter turns
   and moved to sit against the wall they attach to.

   How a drift reaches the frames of the lower roof (ASCE 7 drift, NBG's frame panel loads, PY = projected, down −):
   - side-wall drift (the lower building's sidewall against the higher wall): it runs across the lower frames. Each
     frame line takes pd × its tributary width at the wall, falling to 0 at w from the wall (or to the value at the far
     eave when w is wider than the roof) — a triangle from X to Z on that frame.
   - end-wall drift (the lower building's endwall against the higher wall): it runs along the length, so each frame
     near that end takes the drift over its own tributary strip, uniform across the frame: total snow − base snow, the
     drift part alone, from X to Z where the higher building stands. */
(function (root) {
  'use strict';
  const SNOW = typeof module !== 'undefined' && module.exports ? require('./snow.js') : root.MZ_SNOW;

  const bkey = t => String(t || '').toUpperCase().replace(/BUILDING/g, 'BLDG').replace(/[^A-Z0-9]/g, '');
  const WALLS = ['FSW', 'REW', 'BSW', 'LEW'];
  // a wall from its left steel line to its right one as seen from outside, and the way out of the building
  function wallSeg(g, wall) {
    const L = g.length, W = g.width;
    return ({
      FSW: { p0: [0, 0], p1: [L, 0], n: [0, -1], len: L },
      REW: { p0: [L, 0], p1: [L, W], n: [1, 0], len: W },
      BSW: { p0: [L, W], p1: [0, W], n: [0, 1], len: L },
      LEW: { p0: [0, W], p1: [0, 0], n: [-1, 0], len: W },
    })[wall];
  }
  // quarter-turn rigid transforms: { c, s, tx, ty } with c, s ∈ {−1, 0, 1}
  const ID = { c: 1, s: 0, tx: 0, ty: 0 };
  const apply = (T, [x, y]) => [T.c * x - T.s * y + T.tx, T.s * x + T.c * y + T.ty];
  const rot = (T, [x, y]) => [T.c * x - T.s * y, T.s * x + T.c * y];
  const inv = T => { const c = T.c, s = -T.s; return { c, s, tx: -(c * T.tx - s * T.ty), ty: -(s * T.tx + c * T.ty) }; };
  const unit = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const snap = v => Math.abs(v) < 1e-9 ? 0 : Math.round(v);

  /* the roof height of a building at a point of its own plan: a gable from each eave up to the ridge (Box 2's distance to
     ridge measured from the BSW), a single slope or a lean-to straight from the FSW eave to the BSW eave */
  function roofZ(g, x, y) {
    const W = g.width, eF = g.eaveFSW ?? g.eave, eB = g.eaveBSW ?? g.eave;
    if (g.profile === 'Gable' || (g.profile !== 'Single Slope' && g.profile !== 'Lean-To' && g.slopeFSW != null && g.slopeBSW != null)) {
      const yr = W - (g.ridge != null ? g.ridge : W / 2), sF = (g.slopeFSW ?? g.slopeBSW ?? 1) / 12, sB = (g.slopeBSW ?? g.slopeFSW ?? 1) / 12;
      return y <= yr ? eF + sF * Math.max(0, y) : eB + sB * Math.max(0, W - y);
    }
    return eF + (eB - eF) * Math.min(1, Math.max(0, y / W));
  }
  // where the roof planes of a building change slope across its width: [0, ridge, W] for a gable
  function roofBreaks(g) {
    if (g.profile === 'Gable' || (g.profile !== 'Single Slope' && g.profile !== 'Lean-To' && g.slopeFSW != null && g.slopeBSW != null)) return [0, g.width - (g.ridge != null ? g.ridge : g.width / 2), g.width];
    return [0, g.width];
  }
  // the frame lines of a building: x from the LEW, from Box 2's bays
  function frameXs(g) {
    const xs = [0];
    (g.bays || []).forEach(b => xs.push(xs[xs.length - 1] + b));
    if (xs.length < 2 && g.length > 0) xs.push(g.length);
    return xs;
  }

  /* place every building: the first one (a building nothing names as attached, else the first listed) where it is, each
     attached one turned and moved so its wall lies on the wall it attaches to, "at" from that wall's left steel line
     as seen from outside it. Its own wall runs the other way along it: its right steel line at "at", its left one
     its length further on. */
  function place(pcs) {
    const names = Object.keys(pcs.site || {}).filter(n => { const g = (pcs.site[n] || {}).building; return g && g.width > 0 && g.length > 0; });
    const atts = (pcs.attachments || []).filter(a => names.some(n => bkey(n) === bkey(a.building)) && names.some(n => bkey(n) === bkey(a.to)));
    const name = k => names.find(n => bkey(n) === bkey(k));
    const rootName = names.find(n => !atts.some(a => bkey(a.building) === bkey(n))) || names[0];
    const T = {};
    if (rootName) T[rootName] = ID;
    for (let pass = 0; pass < names.length + 1; pass++) {
      for (const a of atts) {
        const A = name(a.building), B = name(a.to);
        if (T[A] || !T[B]) continue;
        const gA = pcs.site[A].building, gB = pcs.site[B].building, sA = wallSeg(gA, a.wall), sB = wallSeg(gB, a.toWall);
        if (!sA || !sB) continue;
        const h0 = apply(T[B], sB.p0), dh = unit(rot(T[B], [sB.p1[0] - sB.p0[0], sB.p1[1] - sB.p0[1]]));
        // turn A so its wall direction runs against B's
        const dA = unit([sA.p1[0] - sA.p0[0], sA.p1[1] - sA.p0[1]]), want = [-dh[0], -dh[1]];
        const c = snap(dA[0] * want[0] + dA[1] * want[1]), s = snap(dA[0] * want[1] - dA[1] * want[0]);
        const at = a.at || 0, tgt0 = [h0[0] + dh[0] * (at + sA.len), h0[1] + dh[1] * (at + sA.len)];
        const r0 = rot({ c, s }, sA.p0);
        T[A] = { c, s, tx: tgt0[0] - r0[0], ty: tgt0[1] - r0[1] };
      }
    }
    const blds = names.filter(n => T[n]).map(n => {
      const g = pcs.site[n].building, t = T[n], ti = inv(t);
      const corners = [[0, 0], [g.length, 0], [g.length, g.width], [0, g.width]].map(p => apply(t, p));
      return { name: n, g, frames: pcs.site[n].frames || [], roof: pcs.site[n].roof || null, T: t, toSite: p => apply(t, p), toLocal: p => apply(ti, p), corners, xs: frameXs(g) };
    });
    const lost = names.filter(n => !T[n]);
    return { buildings: blds, root: rootName, lost, attachments: atts };
  }

  /* the roof steps: each attachment, the two roofs along the wall they share, which is higher, by how much. The shared
     length is where the two walls overlap; heights are sampled along it (an endwall's rake rises to its ridge). */
  function steps(site) {
    const by = n => site.buildings.find(b => bkey(b.name) === bkey(n));
    const out = [];
    for (const a of site.attachments) {
      const A = by(a.building), B = by(a.to);
      if (!A || !B) continue;
      const sA = wallSeg(A.g, a.wall), sB = wallSeg(B.g, a.toWall);
      // the overlap along B's wall, as distances from B's left steel line
      const p0 = B.toSite(sB.p0), d = unit([B.toSite(sB.p1)[0] - p0[0], B.toSite(sB.p1)[1] - p0[1]]);
      const along = p => (p[0] - p0[0]) * d[0] + (p[1] - p0[1]) * d[1];
      const ea = [along(A.toSite(sA.p0)), along(A.toSite(sA.p1))].sort((x, y) => x - y);
      const lo = Math.max(0, ea[0]), hi = Math.min(sB.len, ea[1]);
      if (!(hi - lo > 0.5)) continue;
      const at = t => [p0[0] + d[0] * t, p0[1] + d[1] * t];
      const zOf = (bld, p) => { const q = bld.toLocal(p); return roofZ(bld.g, q[0], q[1]); };
      const N = 24, samples = [];
      for (let k = 0; k <= N; k++) { const t = lo + (hi - lo) * k / N, p = at(t); samples.push({ t, p, zA: zOf(A, p), zB: zOf(B, p) }); }
      const mean = samples.reduce((s, q) => s + (q.zB - q.zA), 0) / samples.length;
      const upper = mean >= 0 ? B : A, lower = mean >= 0 ? A : B;
      const upperWall = mean >= 0 ? a.toWall : a.wall, lowerWall = mean >= 0 ? a.wall : a.toWall;
      const hs = samples.map(q => (mean >= 0 ? q.zB - q.zA : q.zA - q.zB));
      out.push({
        attach: a, upper, lower, upperWall, lowerWall, length: hi - lo, hMin: Math.min(...hs), hMax: Math.max(...hs),
        // the step height where a point of the lower building's plan meets the wall
        hAt(pLocalLower) {
          const p = lower.toSite(pLocalLower);
          const q = upper.toLocal(p), r = lower.toLocal(p);
          return roofZ(upper.g, q[0], q[1]) - roofZ(lower.g, r[0], r[1]);
        },
        // the shared stretch in the lower building's own plan coordinates
        span: [at(lo), at(hi)].map(p => lower.toLocal(p)),
      });
    }
    return out;
  }

  // the fetch toward a step: across a sidewall, the building's width; across an endwall, its length
  const fetchOf = (g, wall) => (wall === 'FSW' || wall === 'BSW' ? g.width : g.length);
  // does the roof next to this wall drain toward it (a sidewall at the low end of its roof plane)?
  function drainsTo(g, wall) {
    if (wall !== 'FSW' && wall !== 'BSW') return false;
    const z = y => roofZ(g, g.length / 2, y);
    return wall === 'FSW' ? z(Math.min(1, g.width / 4)) > z(0) + 1e-6 : z(g.width - Math.min(1, g.width / 4)) > z(g.width) + 1e-6;
  }
  // the eave-to-ridge run of the roof plane draining to that wall (sliding snow's W)
  function runTo(g, wall) {
    const br = roofBreaks(g);
    return wall === 'FSW' ? br[1] : g.width - br[br.length - 2];
  }

  /* the snow on every roof and every step's drift, frame line by frame line.
     facts: { ed, pg, Ce, risk, W2 }; cfg: per-step overrides { [stepKey]: { luUpper, luLower, s, off } } and per
     building { [name]: { Ct, slippery } } */
  function snowJob(pcs, facts, cfg = {}) {
    const site = place(pcs), sts = steps(site), notes = [];
    const bcfg = cfg.buildings || {}, scfg = cfg.steps || {};
    const roofs = site.buildings.map(b => {
      const g = b.g, o = bcfg[b.name] || {}, r = b.roof || {};
      // Box 4's last column, "Roof insulation R < 30 and/or roof obstruction exists": No reads as an unobstructed
      // slippery roof (Fig. 7.4-1), Yes as not slippery
      const Ct = o.Ct ?? r.Ct ?? 1, slippery = o.slippery ?? r.obstruction === false;
      const slope = Math.max(g.slopeFSW || 0, g.slopeBSW || 0);
      const gable = g.profile === 'Gable';
      const W = gable ? Math.max(g.width - (g.ridge ?? g.width / 2), g.ridge ?? g.width / 2) : g.width;
      const res = SNOW.roof({ ed: facts.ed, pg: facts.pg, Ce: facts.Ce ?? 1, Ct, risk: facts.risk, slope, slippery, W, gable, W2: facts.W2 });
      const pcsSnow = r.snow && r.snow.value != null ? r.snow : null;
      const shown = Math.max(res.ps, res.pm || 0);
      return { name: b.name, building: b, Ct, CtSrc: o.Ct != null ? 'typed' : r.Ct != null ? 'PCS' : 'default', thermal: r.thermal || null, slippery, slope, ...res, design: shown,
        pcsSnow, pcsMatch: pcsSnow && !pcsSnow.override ? Math.abs(pcsSnow.value - Math.round(shown * 10) / 10) < 0.051 : null };
    });
    const roofOf = n => roofs.find(r => bkey(r.name) === bkey(n));
    const drifts = sts.map((st, k) => {
      const key = `${st.lower.name}|${st.lowerWall}`, o = scfg[key] || {};
      const up = roofOf(st.upper.name), low = roofOf(st.lower.name);
      const luUpper = o.luUpper ?? fetchOf(st.upper.g, st.upperWall), luLower = o.luLower ?? fetchOf(st.lower.g, st.lowerWall);
      const side = st.lowerWall === 'FSW' || st.lowerWall === 'BSW';
      const lowerWidth = side ? st.lower.g.width : st.lower.g.length;
      const s = o.s || 0;
      const base = { ed: facts.ed, pg: facts.pg, W2: facts.W2, psLower: low.ps, luUpper, luLower, lowerWidth, s };
      // the drift at the highest and lowest point of the step (an endwall's rake changes it along the wall)
      const dMax = SNOW.stepDrift({ ...base, h: st.hMax }), dMin = SNOW.stepDrift({ ...base, h: st.hMin });
      const slide = SNOW.sliding({ pfUpper: up.pf, Wupper: runTo(st.upper.g, st.upperWall), slopeUpper: wallSlope(st.upper.g, st.upperWall), slippery: up.slippery,
        lowerWidth, h: st.hMin, s, drains: drainsTo(st.upper.g, st.upperWall) });
      const frames = o.off ? [] : frameLoads(st, base, low, slide, side);
      return { key, k, step: st, upper: st.upper.name, lower: st.lower.name, upperWall: st.upperWall, lowerWall: st.lowerWall, kind: side ? 'side' : 'end',
        luUpper, luLower, luUpperSrc: o.luUpper != null ? 'typed' : 'default', luLowerSrc: o.luLower != null ? 'typed' : 'default', s, lowerWidth,
        hMin: st.hMin, hMax: st.hMax, length: st.length, drift: dMax, driftLow: dMin, sliding: slide, frames, off: !!o.off, psLower: low.ps };
    });
    (pcs.extras || []).filter(x => !x.none).forEach(x => notes.push({ level: 'warn', text: `${x.building}: Box 4 lists an additional obstruction or building (“${x.text}”) — its drift is not drawn on the PCS; add it as a step by hand.` }));
    if (site.lost.length) notes.push({ level: 'warn', text: `Not placed on the site: ${site.lost.join(', ')} (no attachment note in Box 2 ties ${site.lost.length > 1 ? 'them' : 'it'} to the others).` });
    return { site, roofs, drifts, notes, facts };
  }
  function wallSlope(g, wall) { return wall === 'FSW' ? (g.slopeFSW ?? g.slopeBSW ?? 0) : wall === 'BSW' ? (g.slopeBSW ?? g.slopeFSW ?? 0) : 0; }

  /* the lower building's frame lines under a step, and the panel loads each takes. Positions are feet from the lower
     building's FSW steel line (across the frame); magnitudes k/ft along the frame, projected, down negative. */
  function frameLoads(st, base, low, slide, side) {
    const g = st.lower.g, xs = st.lower.xs, n = xs.length, out = [];
    const brk = roofBreaks(g);
    // the shared stretch in the lower building's plan: along x for a sidewall step, along y for an endwall step
    const sp = st.span, s0 = side ? Math.min(sp[0][0], sp[1][0]) : Math.min(sp[0][1], sp[1][1]), s1 = side ? Math.max(sp[0][0], sp[1][0]) : Math.max(sp[0][1], sp[1][1]);
    const wallY = st.lowerWall === 'FSW' ? 0 : st.lowerWall === 'BSW' ? g.width : null;
    const wallX = st.lowerWall === 'LEW' ? 0 : st.lowerWall === 'REW' ? g.length : null;
    // cut a load running across the frame (ft from the FSW, value at each end) at the roof panels' edges
    const cut = (ya, va, yb, vb) => {
      const lo = Math.min(ya, yb), hi = Math.max(ya, yb), vAt = y => (yb === ya ? va : va + (vb - va) * (y - ya) / (yb - ya));
      const pts = [lo, ...brk.filter(y => y > lo + 1e-6 && y < hi - 1e-6), hi];
      const segs = [];
      for (let i = 0; i + 1 < pts.length; i++) segs.push({ from: pts[i], to: pts[i + 1], start: vAt(pts[i]), end: vAt(pts[i + 1]), panel: panelOf(brk, (pts[i] + pts[i + 1]) / 2) });
      return segs;
    };
    for (let i = 0; i < n; i++) {
      const x = xs[i], a = i === 0 ? x : (xs[i - 1] + x) / 2, b = i === n - 1 ? x : (x + xs[i + 1]) / 2;
      const line = { frame: i + 1, x, trib: [a, b], segs: [], h: null, drift: null, sliding: null };
      if (side) {
        // the part of this frame's strip the higher wall stands along
        const ta = Math.max(a, s0), tb = Math.min(b, s1), trib = tb - ta;
        if (!(trib > 0.01)) continue;
        // the step height there: the highest along the strip (a rake rises along an endwall)
        const hs = [ta, Math.min(Math.max(x, ta), tb), tb].map(xx => st.hAt([xx, wallY]));
        const h = Math.max(...hs);
        const d = SNOW.stepDrift({ ...base, h });
        line.h = h; line.drift = d; line.tribAt = trib;
        if (!d.none && d.pd > 0) {
          const dir = wallY === 0 ? 1 : -1, reach = Math.min(d.w, g.width);
          const v0 = -d.pd * trib / 1000, v1 = -SNOW.driftAt(d, reach) * trib / 1000;
          cut(wallY, v0, wallY + dir * reach, v1).forEach(sg => line.segs.push({ ...sg, name: 'Snow Drift', kind: 'drift' }));
        }
        if (slide.applies) {
          const dir = wallY === 0 ? 1 : -1, v = -slide.psf * trib / 1000;
          line.sliding = { psf: slide.psf, extent: slide.extent };
          cut(wallY, v, wallY + dir * slide.extent, v).forEach(sg => line.segs.push({ ...sg, name: 'Sliding Snow', kind: 'sliding' }));
        }
      } else {
        // an endwall step: this frame's strip, as distances from the step
        const da = Math.abs(a - wallX), db = Math.abs(b - wallX), p = Math.min(da, db), q = Math.max(da, db);
        // sample across the frame where the higher building stands, at its edges and where either roof breaks
        // the higher building's own ridge where its endwall rake peaks, in this building's plan
        const ub = st.upper.g, uw = st.upperWall, ridgeU = uw === 'LEW' || uw === 'REW' ? roofBreaks(ub).slice(1, -1).map(yr => st.lower.toLocal(st.upper.toSite([uw === 'LEW' ? 0 : ub.length, yr]))[1]) : [];
        const ys = [...new Set([s0, s1, ...brk, ...ridgeU].filter(y => y >= s0 - 1e-6 && y <= s1 + 1e-6).map(v => +v.toFixed(4)))].sort((u, v) => u - v);
        const val = y => { const h = st.hAt([wallX, y]); const d = SNOW.stepDrift({ ...base, h }); return { h, d, w: -SNOW.driftArea(d, p, q) / 1000 }; };
        const pts = ys.map(y => ({ y, ...val(y) }));
        // the upper ridge inside the stretch: a rake changes h there
        const seg = [];
        for (let j = 0; j + 1 < pts.length; j++) seg.push([pts[j], pts[j + 1]]);
        let any = false;
        seg.forEach(([u, v]) => { if (u.w < 0 || v.w < 0) { any = true; cut(u.y, u.w, v.y, v.w).forEach(sg => line.segs.push({ ...sg, name: 'Snow Drift', kind: 'drift' })); } });
        line.h = Math.max(...pts.map(t => t.h)); line.drift = pts.reduce((m, t) => (!m || t.d.pd > m.pd ? t.d : m), null); line.strip = [p, q];
        if (slide.applies && p < slide.extent) {
          const v = -slide.psf * (Math.min(q, slide.extent) - p) / 1000;
          line.sliding = { psf: slide.psf, extent: slide.extent };
          cut(s0, v, s1, v).forEach(sg => line.segs.push({ ...sg, name: 'Sliding Snow', kind: 'sliding' }));
        }
        if (!any && !line.sliding) continue;
      }
      if (line.segs.length) out.push(line);
    }
    return out;
  }
  // roof panel number across a frame, from the FSW: RP1, RP2 … between the slope breaks
  function panelOf(brk, y) { for (let i = 0; i + 1 < brk.length; i++) if (y >= brk[i] - 1e-6 && y <= brk[i + 1] + 1e-6) return i + 1; return 1; }

  const api = { wallSeg, roofZ, roofBreaks, frameXs, place, steps, snowJob, frameLoads, fetchOf, drainsTo, runTo, bkey, WALLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_SITE = api;
})(typeof self !== 'undefined' ? self : this);
