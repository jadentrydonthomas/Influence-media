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

  const isGable = g => g.profile === 'Gable' || (g.profile !== 'Single Slope' && g.profile !== 'Lean-To' && g.slopeFSW != null && g.slopeBSW != null);
  /* where the ridge of a gable is, from the FSW. Box 2's distance to ridge is read from whichever side makes the two roof
     planes meet there (from each eave at its own slope): an unequal gable on one practice job has its 121'-6" from the
     FSW (eaves 28'-9 3/4" / 33'-11 3/8", both planes 38'-11" at the ridge; from the BSW they would miss by 10 ft). With
     no distance given, where the planes meet (the middle when the eaves are level). */
  function ridgeY(g) {
    const W = g.width, eF = g.eaveFSW ?? g.eave, eB = g.eaveBSW ?? g.eave, sF = (g.slopeFSW ?? g.slopeBSW ?? 1) / 12, sB = (g.slopeBSW ?? g.slopeFSW ?? 1) / 12;
    const meet = eF != null && eB != null && sF + sB > 0 ? Math.min(W, Math.max(0, (eB - eF + sB * W) / (sF + sB))) : W / 2;
    if (g.ridge == null || !(g.ridge > 0 && g.ridge < W)) return meet;
    if (eF == null || eB == null) return W - g.ridge;
    const gap = d => Math.abs(eF + sF * d - (eB + sB * (W - d)));
    return gap(g.ridge) + 0.05 < gap(W - g.ridge) ? g.ridge : W - g.ridge;
  }
  // the roof height of a building at a point of its own plan: a gable from each eave up to the ridge, a single slope or a
  // lean-to straight from the FSW eave to the BSW eave
  function roofZ(g, x, y) {
    const W = g.width, eF = g.eaveFSW ?? g.eave, eB = g.eaveBSW ?? g.eave;
    if (isGable(g)) {
      const yr = ridgeY(g), sF = (g.slopeFSW ?? g.slopeBSW ?? 1) / 12, sB = (g.slopeBSW ?? g.slopeFSW ?? 1) / 12;
      return y <= yr ? eF + sF * Math.max(0, y) : eB + sB * Math.max(0, W - y);
    }
    return eF + (eB - eF) * Math.min(1, Math.max(0, y / W));
  }
  // where the roof planes of a building change slope across its width: [0, ridge, W] for a gable
  function roofBreaks(g) {
    if (isGable(g)) return [0, ridgeY(g), g.width];
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
  const OPP = { FSW: 'BSW', BSW: 'FSW', LEW: 'REW', REW: 'LEW' };
  /* the fetch from a wall across a building and on through every building attached in line beyond it whose roof meets
     this one level (no step between them): the snow on a continuous roof blows the whole way. A 3-building job: the
     lean-to's drift from the extension's endwall takes the extension's 19 ft and the main building's 174'-8" behind it,
     193'-8" — what the engineer typed in NBG Design Calcs. */
  function fetchThrough(site, sts, b, wall) {
    const parts = [{ name: b.name, len: fetchOf(b.g, wall) }], seen = new Set([bkey(b.name)]);
    let cur = b, w = wall;
    for (let k = 0; k < 12; k++) {
      const far = OPP[w], me = bkey(cur.name);
      const a = site.attachments.find(t => (bkey(t.building) === me && t.wall === far) || (bkey(t.to) === me && t.toWall === far));
      if (!a) break;
      const mine = bkey(a.building) === me, nextName = mine ? a.to : a.building, nextWall = mine ? a.toWall : a.wall;
      if (seen.has(bkey(nextName))) break;
      const nb = site.buildings.find(q => bkey(q.name) === bkey(nextName)), st = sts.find(q => q.attach === a);
      if (!nb || !st || Math.max(Math.abs(st.hMin), Math.abs(st.hMax)) > 0.1) break;   // a step between them stops the fetch
      parts.push({ name: nb.name, len: fetchOf(nb.g, nextWall) });
      seen.add(bkey(nextName)); cur = nb; w = nextWall;
    }
    return { lu: parts.reduce((t, q) => t + q.len, 0), parts };
  }
  /* the snow on the lower roof beside a step, u ft from it (psf): the drift or the sliding snow, the larger — ASCE 7-16
     7.9: sliding loads "need not be used in combination with drift" (NBG Design Calcs' Total Snow is the balanced plus
     the larger of the two). Pieces [{ a, b, va, vb, by }] in u, linear on each. */
  function envelope(d, slide, lowerWidth) {
    const hasD = !!(d && !d.none && d.w > 0), hasS = !!(slide && slide.applies && slide.psf > 0);
    const reachD = hasD ? Math.min(d.w, lowerWidth) : 0, ext = hasS ? Math.min(slide.extent, lowerWidth) : 0, end = Math.max(reachD, ext);
    if (!(end > 1e-6)) return [];
    const pts = new Set([0, end, reachD, ext]);
    if (hasD && hasS && d.pd > slide.psf) { const uc = d.w * (1 - slide.psf / d.pd); if (uc > 1e-6 && uc < Math.min(reachD, ext) - 1e-6) pts.add(uc); }
    const xs = [...pts].filter(u => u >= 0 && u <= end + 1e-9).sort((a, b) => a - b), out = [];
    const Dr = u => (hasD && u < reachD - 1e-9 ? SNOW.driftAt(d, u) : 0), Dl = u => (hasD && u <= reachD + 1e-9 ? SNOW.driftAt(d, Math.min(u, reachD)) : 0);
    const Sr = u => (hasS && u < ext - 1e-9 ? slide.psf : 0), Sl = u => (hasS && u <= ext + 1e-9 ? slide.psf : 0);
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i], b = xs[i + 1];
      if (b - a < 1e-6) continue;
      out.push({ a, b, va: Math.max(Dr(a), Sr(a)), vb: Math.max(Dl(b), Sl(b)), by: Dr(a) >= Sr(a) && Dl(b) >= Sl(b) ? 'drift' : 'sliding' });
    }
    return out;
  }
  // ∫ of the envelope over [p, q] ft from the step: lb per ft along the step
  const envArea = (env, p, q) => env.reduce((t, e) => { const lo = Math.max(p, e.a), hi = Math.min(q, e.b); if (hi <= lo) return t; const v = u => e.va + (e.vb - e.va) * (u - e.a) / (e.b - e.a); return t + (v(lo) + v(hi)) / 2 * (hi - lo); }, 0);
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
      const W = gable ? Math.max(g.width - ridgeY(g), ridgeY(g)) : g.width;
      const res = SNOW.roof({ ed: facts.ed, pg: facts.pg, Ce: facts.Ce ?? 1, Ct, risk: facts.risk, slope, slippery, W, gable, W2: facts.W2 });
      // the unbalanced snow each way, as NBG Design Calcs gives it (WindToRight / WindToLeft): the wind from the FSW puts
      // the surcharge on the BSW slope (hd on the FSW eave-to-ridge run, S of the BSW slope), and the mirror; on an equal
      // gable the two are the same. The governing one stands for the roof.
      if (gable && res.unbalanced && res.unbalanced.applies && !res.unbalanced.need) {
        const yr = ridgeY(g), one = (run, sLee) => SNOW.unbalanced({ ed: facts.ed, pg: facts.pg, W: run, W2: facts.W2, slope: sLee || slope }, res);
        const dirs = { FSW: one(yr, g.slopeBSW ?? g.slopeFSW), BSW: one(g.width - yr, g.slopeFSW ?? g.slopeBSW) };
        if (dirs.FSW.applies && dirs.BSW.applies && !dirs.FSW.need && !dirs.BSW.need) {
          const extra = u => (u.surcharge || 0) * (u.length || 0);   // the surcharge's own load, per foot of frame spacing
          const gov = extra(dirs.BSW) > extra(dirs.FSW) + 1e-9 ? 'BSW' : 'FSW';
          res.unbalanced = { ...dirs[gov], gov, dirs, same: ['windward', 'leeward', 'surcharge', 'length'].every(k => Math.abs((dirs.FSW[k] || 0) - (dirs.BSW[k] || 0)) < 1e-6) };
        }
      }
      const pcsSnow = r.snow && r.snow.value != null ? r.snow : null;
      const shown = Math.max(res.ps, res.pm || 0);
      // the uniform snow NBG Frame puts on the roof (SL): Box 4's user override where it has one, else the larger of ps and
      // pm. The drift still sits on the balanced ps (hb = ps / γ, 7.7) — pm is a load case of its own, never under a drift.
      const applied = pcsSnow && pcsSnow.override ? pcsSnow.value : shown;
      const appliedSrc = pcsSnow && pcsSnow.override ? 'PCS user override' : res.pm != null && res.pm > res.ps ? 'minimum pm' : 'balanced ps';
      return { name: b.name, building: b, Ct, CtSrc: o.Ct != null ? 'typed' : r.Ct != null ? 'PCS' : 'default', thermal: r.thermal || null, slippery, slope, ...res, design: shown, applied, appliedSrc,
        pcsSnow, pcsMatch: pcsSnow && !pcsSnow.override ? Math.abs(pcsSnow.value - Math.round(shown * 10) / 10) < 0.051 : null };
    });
    const roofOf = n => roofs.find(r => bkey(r.name) === bkey(n));
    const drifts = sts.map((st, k) => {
      const key = `${st.lower.name}|${st.lowerWall}`, o = scfg[key] || {};
      const up = roofOf(st.upper.name), low = roofOf(st.lower.name);
      const fU = fetchThrough(site, sts, st.upper, st.upperWall), fL = fetchThrough(site, sts, st.lower, st.lowerWall);
      const luUpper = o.luUpper ?? fU.lu, luLower = o.luLower ?? fL.lu;
      const side = st.lowerWall === 'FSW' || st.lowerWall === 'BSW';
      const lowerWidth = side ? st.lower.g.width : st.lower.g.length;
      const s = o.s || 0;
      const base = { ed: facts.ed, pg: facts.pg, W2: facts.W2, psLower: low.ps, luUpper, luLower, lowerWidth, s };
      // the drift at the highest and lowest point of the step (an endwall's rake changes it along the wall)
      const dMax = SNOW.stepDrift({ ...base, h: st.hMax }), dMin = SNOW.stepDrift({ ...base, h: st.hMin });
      // sliding snow (7.9): by the code's geometry (the upper roof drains toward the step), or as NBG Design Calcs works
      // it — from the slope and a slippery upper roof alone, whichever way the roof drains — or left out
      const mode = o.sliding || 'asce', ug = st.upper.g, Wdef = runTo(ug, st.upperWall);
      const slopeU = st.upperWall === 'FSW' || st.upperWall === 'BSW' ? wallSlope(ug, st.upperWall) : Math.max(ug.slopeFSW || 0, ug.slopeBSW || 0);
      const slide = mode === 'off' ? { applies: false, why: 'left out on this page', perFt: 0, extent: 0, psf: 0 }
        : SNOW.sliding({ pfUpper: up.pf, Wupper: o.W ?? Wdef, slopeUpper: slopeU, slippery: mode === 'calcs' ? true : up.slippery, lowerWidth, h: st.hMin, s, drains: mode === 'calcs' ? true : drainsTo(ug, st.upperWall) });
      Object.assign(slide, { mode, W: o.W ?? Wdef, Wsrc: o.W != null ? 'typed' : 'default', pfUpper: up.pf });
      const level = Math.max(Math.abs(st.hMin), Math.abs(st.hMax)) <= 0.1;
      const frames = o.off || level ? [] : frameLoads(st, base, low, slide, side);
      return { key, k, step: st, upper: st.upper.name, lower: st.lower.name, upperWall: st.upperWall, lowerWall: st.lowerWall, kind: side ? 'side' : 'end', level,
        luUpper, luLower, luUpperSrc: o.luUpper != null ? 'typed' : fU.parts.length > 1 ? 'in line' : 'default', luLowerSrc: o.luLower != null ? 'typed' : fL.parts.length > 1 ? 'in line' : 'default',
        luUpperParts: fU.parts, luLowerParts: fL.parts, s, lowerWidth,
        hMin: st.hMin, hMax: st.hMax, length: st.length, drift: dMax, driftLow: dMin, sliding: slide, envelope: envelope(dMax, slide, lowerWidth), frames, off: !!o.off, psLower: low.ps };
    });
    // steps typed on the page (a higher roof the PCS does not draw: an existing building, a roof in line): the same drift,
    // with the step height and the upper fetch as typed; no sliding snow (the upper roof is not drawn)
    (cfg.extraSteps || []).forEach((x, i) => {
      const b = site.buildings.find(q => bkey(q.name) === bkey(x.lower)), low = b && roofOf(b.name);
      if (!b || !low || !(x.h > 0) || !(x.lu > 0)) return;
      const g = b.g, side = x.wall === 'FSW' || x.wall === 'BSW', sgm = wallSeg(g, x.wall);
      if (!sgm) return;
      const key = `${b.name}|${x.wall}|typed${i}`, o = scfg[key] || {};
      const luUpper = o.luUpper ?? x.lu, luLower = o.luLower ?? fetchOf(g, x.wall), s = o.s ?? (x.s || 0), lowerWidth = side ? g.width : g.length, h = x.h;
      const base = { ed: facts.ed, pg: facts.pg, W2: facts.W2, psLower: low.ps, luUpper, luLower, lowerWidth, s };
      const st = { attach: null, upper: null, lower: b, upperWall: null, lowerWall: x.wall, length: sgm.len, hMin: h, hMax: h, hAt: () => h, span: [sgm.p0, sgm.p1], typed: true };
      const slide = { applies: false, why: 'the higher roof is typed, not drawn — add sliding snow by hand if it drains onto this roof' };
      const dMax = SNOW.stepDrift({ ...base, h });
      drifts.push({ key, k: drifts.length, step: st, upper: x.name || 'a higher roof (typed)', lower: b.name, upperWall: null, lowerWall: x.wall, kind: side ? 'side' : 'end', level: false,
        luUpper, luLower, luUpperSrc: 'typed', luLowerSrc: o.luLower != null ? 'typed' : 'default', luUpperParts: [{ name: x.name || 'typed', len: x.lu }], luLowerParts: [{ name: b.name, len: luLower }], s, lowerWidth, hMin: h, hMax: h, length: sgm.len, drift: dMax, driftLow: dMax, sliding: slide,
        envelope: envelope(dMax, slide, lowerWidth), frames: o.off ? [] : frameLoads(st, base, low, slide, side), off: !!o.off, psLower: low.ps, typed: true, extraIndex: i });
    });
    (pcs.extras || []).filter(x => !x.none).forEach(x => notes.push(x.yesNo && /^No$/i.test(x.drift || '')
      ? { level: 'info', text: `${x.building}: Box 4 lists an additional existing building or obstruction not defined in Box 25, and answers that it does not cause a snow drift — none is drawn. If it does, add it as a step in the Snow calc (Calcs page, step 3).` }
      : { level: 'warn', text: `${x.building}: Box 4 lists an additional obstruction or building${x.yesNo ? (/^Yes$/i.test(x.drift || '') ? ' that causes a snow drift' : ' (whether it causes a drift is not answered)') : ` (“${x.text}”)`} — its drift is not drawn on the PCS; add it as a step in the Snow calc (Calcs page, step 3).` }));
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
        if (slide.applies) line.sliding = { psf: slide.psf, extent: slide.extent };
        // one load: the larger of the drift and the sliding snow at each point, × the frame's tributary width there
        const dir = wallY === 0 ? 1 : -1;
        envelope(d, slide, g.width).forEach(e => cut(wallY + dir * e.a, -e.va * trib / 1000, wallY + dir * e.b, -e.vb * trib / 1000).forEach(sg => line.segs.push({ ...sg, name: 'Snow Drift', kind: 'drift', by: e.by })));
      } else {
        // an endwall step: this frame's strip, as distances from the step
        const da = Math.abs(a - wallX), db = Math.abs(b - wallX), p = Math.min(da, db), q = Math.max(da, db);
        // sample across the frame where the higher building stands, at its edges and where either roof breaks
        // the higher building's own ridge where its endwall rake peaks, in this building's plan
        const ub = st.upper && st.upper.g, uw = st.upperWall, ridgeU = ub && (uw === 'LEW' || uw === 'REW') ? roofBreaks(ub).slice(1, -1).map(yr => st.lower.toLocal(st.upper.toSite([uw === 'LEW' ? 0 : ub.length, yr]))[1]) : [];
        const ys = [...new Set([s0, s1, ...brk, ...ridgeU].filter(y => y >= s0 - 1e-6 && y <= s1 + 1e-6).map(v => +v.toFixed(4)))].sort((u, v) => u - v);
        const val = y => { const h = st.hAt([wallX, y]); const d = SNOW.stepDrift({ ...base, h }); return { h, d, w: -envArea(envelope(d, slide, base.lowerWidth), p, q) / 1000 }; };
        const pts = ys.map(y => ({ y, ...val(y) }));
        // the upper ridge inside the stretch: a rake changes h there
        const seg = [];
        for (let j = 0; j + 1 < pts.length; j++) seg.push([pts[j], pts[j + 1]]);
        let any = false;
        seg.forEach(([u, v]) => { if (u.w < 0 || v.w < 0) { any = true; cut(u.y, u.w, v.y, v.w).forEach(sg => line.segs.push({ ...sg, name: 'Snow Drift', kind: 'drift' })); } });
        line.h = Math.max(...pts.map(t => t.h)); line.drift = pts.reduce((m, t) => (!m || t.d.pd > m.pd ? t.d : m), null); line.strip = [p, q];
        if (slide.applies && p < slide.extent) line.sliding = { psf: slide.psf, extent: slide.extent };
        if (!any) continue;
      }
      if (line.segs.length) out.push(line);
    }
    return out;
  }
  // roof panel number across a frame, from the FSW: RP1, RP2 … between the slope breaks
  function panelOf(brk, y) { for (let i = 0; i + 1 < brk.length; i++) if (y >= brk[i] - 1e-6 && y <= brk[i + 1] + 1e-6) return i + 1; return 1; }

  const api = { wallSeg, roofZ, roofBreaks, ridgeY, frameXs, place, steps, snowJob, frameLoads, fetchOf, fetchThrough, envelope, envArea, drainsTo, runTo, bkey, WALLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_SITE = api;
})(typeof self !== 'undefined' ? self : this);
