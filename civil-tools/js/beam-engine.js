// ============================================================================
// beam-engine.js — Steel beam analysis + design engine
//
// Analysis: Euler-Bernoulli finite-element solver (Hermitian beam elements,
// banded direct solver). Supports any combination of pinned/fixed supports,
// overhangs and cantilevers, point loads, applied moments, and full/partial
// trapezoidal line loads, organized into load cases and factored combinations.
//
// Design: AISC 360-22 (Steel Construction Manual, 16th Ed.)
//   - Flexure: Ch. F — F2 (yielding + lateral-torsional buckling) and
//     F3 (noncompact/slender compression flange), LRFD phi_b = 0.90 /
//     ASD Omega_b = 1.67
//   - Shear:   Ch. G — G2.1, Vn = 0.6*Fy*Aw*Cv1
//   - Serviceability: deflection ratio checks (L/240, L/360, ... editable)
//
// Sign conventions (user-facing):
//   Loads P, w positive DOWNWARD (kips, kip/ft). Applied moments positive
//   counterclockwise (kip-ft). Positive internal moment = sagging.
//   Deflection reported negative downward (matches typical analysis output).
//   Reactions positive upward.
//
// Internal units: kips and inches. Inputs in feet / kip-ft are converted.
// ============================================================================

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BeamEngine = factory();
}(typeof self !== "undefined" ? self : this, function () {
"use strict";

var FT = 12; // in per ft

// ---------------------------------------------------------------------------
// Mesh
// ---------------------------------------------------------------------------

function buildMesh(model) {
  var L = model.lengthFt * FT;
  if (!(L > 0)) throw new Error("Beam length must be positive.");
  var keys = [0, L];
  function addKey(xft, what) {
    var x = xft * FT;
    if (x < -1e-9 || x > L + 1e-9) throw new Error(what + " at x = " + xft + " ft is outside the beam (0 to " + model.lengthFt + " ft).");
    keys.push(Math.min(Math.max(x, 0), L));
  }
  (model.supports || []).forEach(function (s) { addKey(s.x, "Support"); });
  var lds = model.loads || {};
  (lds.point || []).forEach(function (p) { addKey(p.x, "Point load"); });
  (lds.moment || []).forEach(function (m) { addKey(m.x, "Applied moment"); });
  (lds.line || []).forEach(function (l) { addKey(l.x1, "Line load start"); addKey(l.x2, "Line load end"); });

  keys.sort(function (a, b) { return a - b; });
  var uniq = [keys[0]];
  for (var i = 1; i < keys.length; i++) {
    if (keys[i] - uniq[uniq.length - 1] > 1e-7) uniq.push(keys[i]);
  }
  // subdivide so no element is longer than ~L/240
  var step = L / 240;
  var xs = [uniq[0]];
  for (i = 1; i < uniq.length; i++) {
    var gap = uniq[i] - uniq[i - 1];
    var ndiv = Math.max(1, Math.ceil(gap / step - 1e-9));
    for (var k = 1; k <= ndiv; k++) xs.push(uniq[i - 1] + gap * k / ndiv);
  }
  return { xs: xs, L: L };
}

function nodeIndex(mesh, xft) {
  var x = xft * FT, xs = mesh.xs;
  for (var i = 0; i < xs.length; i++) if (Math.abs(xs[i] - x) < 1e-6) return i;
  // nearest fallback (should not happen — mesh keys include all load points)
  var best = 0, bd = Infinity;
  for (i = 0; i < xs.length; i++) { var d = Math.abs(xs[i] - x); if (d < bd) { bd = d; best = i; } }
  return best;
}

// ---------------------------------------------------------------------------
// Banded matrix helpers (half-bandwidth 3, stored as n x 7)
// ---------------------------------------------------------------------------

var HB = 3, BW = 2 * HB + 1;

function bandGet(A, n, i, j) {
  var o = j - i + HB;
  return (o >= 0 && o < BW) ? A[i * BW + o] : 0;
}
function bandAdd(A, n, i, j, v) {
  var o = j - i + HB;
  if (o >= 0 && o < BW) A[i * BW + o] += v;
}
function bandFactor(A, n) { // in-place banded LU (no pivoting; SPD after constraints)
  for (var k = 0; k < n; k++) {
    var piv = A[k * BW + HB];
    if (!(Math.abs(piv) > 1e-12)) throw new Error("Beam is unstable (singular stiffness matrix). Check supports.");
    var iMax = Math.min(k + HB, n - 1);
    for (var i = k + 1; i <= iMax; i++) {
      var o = k - i + HB;
      var m = A[i * BW + o] / piv;
      A[i * BW + o] = m;
      if (m !== 0) {
        var jMax = Math.min(k + HB, n - 1);
        for (var j = k + 1; j <= jMax; j++) {
          A[i * BW + (j - i + HB)] -= m * A[k * BW + (j - k + HB)];
        }
      }
    }
  }
}
function bandSolve(A, n, b) { // A pre-factored; returns solution (overwrites copy of b)
  var x = new Float64Array(b);
  var k, i, iMax;
  for (k = 0; k < n; k++) {
    iMax = Math.min(k + HB, n - 1);
    for (i = k + 1; i <= iMax; i++) x[i] -= A[i * BW + (k - i + HB)] * x[k];
  }
  for (k = n - 1; k >= 0; k--) {
    iMax = Math.min(k + HB, n - 1);
    for (i = k + 1; i <= iMax; i++) x[k] -= A[k * BW + (i - k + HB)] * x[i];
    x[k] /= A[k * BW + HB];
  }
  return x;
}
function bandMulVec(A, n, v) {
  var r = new Float64Array(n);
  for (var i = 0; i < n; i++) {
    var jMin = Math.max(0, i - HB), jMax = Math.min(n - 1, i + HB), s = 0;
    for (var j = jMin; j <= jMax; j++) s += A[i * BW + (j - i + HB)] * v[j];
    r[i] = s;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

// DOF numbering: node i -> [2i] = v (up +, in), [2i+1] = theta (ccw +, rad)
function assembleK(mesh, EI) {
  var xs = mesh.xs, nn = xs.length, n = 2 * nn;
  var A = new Float64Array(n * BW);
  for (var e = 0; e < nn - 1; e++) {
    var Le = xs[e + 1] - xs[e];
    var c = EI / (Le * Le * Le);
    var ke = [
      [12 * c, 6 * c * Le, -12 * c, 6 * c * Le],
      [6 * c * Le, 4 * c * Le * Le, -6 * c * Le, 2 * c * Le * Le],
      [-12 * c, -6 * c * Le, 12 * c, -6 * c * Le],
      [6 * c * Le, 2 * c * Le * Le, -6 * c * Le, 4 * c * Le * Le]
    ];
    var map = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3];
    for (var a = 0; a < 4; a++) for (var b = 0; b < 4; b++) bandAdd(A, n, map[a], map[b], ke[a][b]);
  }
  return A;
}

// Per-load-case: nodal force vectors + element distributed intensities.
// Returns { F: {caseId: Float64Array}, q: {caseId: Float64Array(2*nElem)} }
function caseLoads(mesh, model) {
  var xs = mesh.xs, nn = xs.length, n = 2 * nn, ne = nn - 1;
  var F = {}, Q = {};
  function ensure(cs) {
    if (!F[cs]) { F[cs] = new Float64Array(n); Q[cs] = new Float64Array(2 * ne); }
  }
  var lds = model.loads || {};
  (lds.point || []).forEach(function (p) {
    if (!p.P) return;
    ensure(p.case);
    F[p.case][2 * nodeIndex(mesh, p.x)] -= p.P; // down + -> negative v-force
  });
  (lds.moment || []).forEach(function (m) {
    if (!m.M) return;
    ensure(m.case);
    F[m.case][2 * nodeIndex(mesh, m.x) + 1] += m.M * FT; // kip-ft -> kip-in, ccw +
  });
  var lines = [];
  (lds.uniform || []).forEach(function (u) {
    if (u.w) lines.push({ case: u.case, x1: 0, x2: model.lengthFt, w1: u.w, w2: u.w });
  });
  (lds.line || []).forEach(function (l) {
    if (l.w1 || l.w2) lines.push(l);
  });
  lines.forEach(function (l) {
    ensure(l.case);
    var a = l.x1 * FT, b = l.x2 * FT;
    if (b <= a + 1e-9) return;
    var w1 = l.w1 / FT, w2 = l.w2 / FT; // kip/ft -> kip/in (down +)
    for (var e = 0; e < ne; e++) {
      var xa = xs[e], xb = xs[e + 1];
      if (xa >= b - 1e-7 || xb <= a + 1e-7) continue;
      // mesh nodes exist at a and b, so the element is fully inside [a,b]
      var q1 = w1 + (w2 - w1) * (xa - a) / (b - a);
      var q2 = w1 + (w2 - w1) * (xb - a) / (b - a);
      Q[l.case][2 * e] += q1;
      Q[l.case][2 * e + 1] += q2;
      var Le = xb - xa;
      // consistent nodal loads for linearly varying downward load q1->q2
      var Fv = F[l.case];
      Fv[2 * e]     -= Le * (7 * q1 + 3 * q2) / 20;
      Fv[2 * e + 1] -= Le * Le * (3 * q1 + 2 * q2) / 60;
      Fv[2 * e + 2] -= Le * (3 * q1 + 7 * q2) / 20;
      Fv[2 * e + 3] += Le * Le * (2 * q1 + 3 * q2) / 60;
    }
  });
  return { F: F, Q: Q };
}

function supportDofs(mesh, model) {
  var dofs = [];
  (model.supports || []).forEach(function (s) {
    var ni = nodeIndex(mesh, s.x);
    dofs.push({ node: ni, dof: 2 * ni, type: s.type, xft: s.x });
    if (s.type === "fix") dofs.push({ node: ni, dof: 2 * ni + 1, type: s.type, xft: s.x, isMoment: true });
  });
  return dofs;
}

function validateStability(model) {
  var sup = model.supports || [];
  var nFix = sup.filter(function (s) { return s.type === "fix"; }).length;
  if (nFix === 0 && sup.length < 2) {
    throw new Error("Unstable beam: needs at least two pinned supports or one fixed support.");
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

// combos: [{ name, f: {caseId: factor}, strength: bool, defl: bool, deflLimit: 240 }]
// Returns { mesh, results: [comboResult] }
// comboResult: { name, stations: [{x(ft), V, M(kip-ft), D(in, down -)}],
//                reactions: [{x, R, Mr|null}], extremes..., deflNorm }
function analyze(model, combos, E, I) {
  validateStability(model);
  var mesh = buildMesh(model);
  var xs = mesh.xs, nn = xs.length, n = 2 * nn, ne = nn - 1;
  var EI = E * I;
  var K0 = assembleK(mesh, EI);
  var K = new Float64Array(K0);
  var cons = supportDofs(mesh, model);
  // apply constraints: zero row/col within band, unit diagonal
  cons.forEach(function (c) {
    var d = c.dof;
    for (var j = Math.max(0, d - HB); j <= Math.min(n - 1, d + HB); j++) {
      if (j === d) continue;
      var o1 = j - d + HB; K[d * BW + o1] = 0;
      var o2 = d - j + HB; K[j * BW + o2] = 0;
    }
    K[d * BW + HB] = 1;
  });
  bandFactor(K, n);

  var loads = caseLoads(mesh, model);
  var spans = spanMap(model); // for deflection L/x normalization

  var results = combos.map(function (combo) {
    var F = new Float64Array(n);
    var qEl = new Float64Array(2 * ne);
    Object.keys(combo.f || {}).forEach(function (cs) {
      var f = combo.f[cs];
      if (!f || !loads.F[cs]) return;
      var Fc = loads.F[cs], Qc = loads.Q[cs];
      for (var i = 0; i < n; i++) F[i] += f * Fc[i];
      for (i = 0; i < 2 * ne; i++) qEl[i] += f * Qc[i];
    });
    var Fc2 = new Float64Array(F);
    cons.forEach(function (c) { Fc2[c.dof] = 0; });
    var u = bandSolve(K, n, Fc2);

    // reactions: r = K0*u - F  (nonzero only at constrained DOFs)
    var r = bandMulVec(K0, n, u);
    var reactions = [];
    var reactByNode = {};
    cons.forEach(function (c) {
      var val = r[c.dof] - F[c.dof];
      var rec = reactByNode[c.node];
      if (!rec) { rec = reactByNode[c.node] = { x: c.xft, R: 0, Mr: null, type: c.type }; reactions.push(rec); }
      if (c.isMoment) rec.Mr = val / FT; // kip-in -> kip-ft, ccw +
      else rec.R = val;                  // kips, up +
    });
    reactions.sort(function (a, b) { return a.x - b.x; });

    // internal forces per element, station sampling
    var stations = [];
    for (var e = 0; e < ne; e++) {
      var Le = xs[e + 1] - xs[e];
      var v1 = u[2 * e], t1 = u[2 * e + 1], v2 = u[2 * e + 2], t2 = u[2 * e + 3];
      var q1 = qEl[2 * e], q2 = qEl[2 * e + 1];
      var c = EI / (Le * Le * Le);
      // element end forces fe = ke*ue - feq  (forces applied to element by nodes)
      var Fy1 = c * (12 * v1 + 6 * Le * t1 - 12 * v2 + 6 * Le * t2);
      var M1  = c * (6 * Le * v1 + 4 * Le * Le * t1 - 6 * Le * v2 + 2 * Le * Le * t2);
      // subtract equivalent nodal loads (same formulas as in caseLoads)
      Fy1 -= -(Le * (7 * q1 + 3 * q2) / 20);
      M1  -= -(Le * Le * (3 * q1 + 2 * q2) / 60);
      var V0 = Fy1;        // internal shear at element start
      var M0 = -M1;        // internal (sagging +) moment at element start

      var Vat = function (s) { return V0 - (q1 * s + (q2 - q1) * s * s / (2 * Le)); };
      var Mat = function (s) { return M0 + V0 * s - (q1 * s * s / 2 + (q2 - q1) * s * s * s / (6 * Le)); };
      var Dat = function (s) {
        var xi = s / Le, xi2 = xi * xi, xi3 = xi2 * xi;
        var N1 = 1 - 3 * xi2 + 2 * xi3, N2 = Le * (xi - 2 * xi2 + xi3);
        var N3 = 3 * xi2 - 2 * xi3, N4 = Le * (xi3 - xi2);
        return N1 * v1 + N2 * t1 + N3 * v2 + N4 * t2; // up +
      };

      var ss = [0, 0.25 * Le, 0.5 * Le, 0.75 * Le, Le];
      // exact local moment extremes: V(s)=0 -> quadratic in s
      // V(s) = V0 - q1 s - (q2-q1) s^2/(2Le) = 0
      var A2 = -(q2 - q1) / (2 * Le), B2 = -q1, C2 = V0;
      if (Math.abs(A2) > 1e-14) {
        var disc = B2 * B2 - 4 * A2 * C2;
        if (disc >= 0) {
          var sq = Math.sqrt(disc);
          [(-B2 + sq) / (2 * A2), (-B2 - sq) / (2 * A2)].forEach(function (s) {
            if (s > 1e-9 && s < Le - 1e-9) ss.push(s);
          });
        }
      } else if (Math.abs(B2) > 1e-14) {
        var s0 = C2 / -B2 * -1; // s = V0/q1
        s0 = V0 / q1;
        if (s0 > 1e-9 && s0 < Le - 1e-9) ss.push(s0);
      }
      ss.sort(function (a, b) { return a - b; });
      ss.forEach(function (s) {
        stations.push({ x: (xs[e] + s) / FT, V: Vat(s), M: Mat(s) / FT, D: Dat(s) });
      });
    }

    var ex = extremes(stations, spans);
    return {
      name: combo.name, combo: combo, stations: stations, reactions: reactions,
      Vmax: ex.Vmax, Vmin: ex.Vmin, Mmax: ex.Mmax, Mmin: ex.Mmin,
      Dmax: ex.Dmax, Dmin: ex.Dmin, deflNorm: ex.deflNorm,
      Vleft: stations.length ? stations[0].V : 0,
      Vright: stations.length ? stations[stations.length - 1].V : 0
    };
  });
  return { mesh: mesh, results: results, spans: spans };
}

// span map for deflection ratios: between adjacent supports use span length;
// beyond first/last support (overhang or cantilever) use 2 x overhang length.
function spanMap(model) {
  var sx = (model.supports || []).map(function (s) { return s.x; }).sort(function (a, b) { return a - b; });
  var L = model.lengthFt;
  var segs = [];
  if (sx.length === 0) return segs;
  if (sx[0] > 1e-9) segs.push({ x1: 0, x2: sx[0], Leff: 2 * sx[0] });
  for (var i = 0; i < sx.length - 1; i++) segs.push({ x1: sx[i], x2: sx[i + 1], Leff: sx[i + 1] - sx[i] });
  if (L - sx[sx.length - 1] > 1e-9) segs.push({ x1: sx[sx.length - 1], x2: L, Leff: 2 * (L - sx[sx.length - 1]) });
  if (segs.length === 0) segs.push({ x1: 0, x2: L, Leff: L }); // degenerate
  return segs;
}

function LeffAt(spans, xft) {
  for (var i = 0; i < spans.length; i++) {
    if (xft >= spans[i].x1 - 1e-9 && xft <= spans[i].x2 + 1e-9) return spans[i].Leff;
  }
  return spans.length ? spans[spans.length - 1].Leff : 0;
}

function extremes(stations, spans) {
  var Vmax = { v: -Infinity, x: 0 }, Vmin = { v: Infinity, x: 0 };
  var Mmax = { v: -Infinity, x: 0 }, Mmin = { v: Infinity, x: 0 };
  var Dmax = { v: -Infinity, x: 0 }, Dmin = { v: Infinity, x: 0 };
  var deflNorm = 0; // max |delta| / Leff  (both in inches)
  stations.forEach(function (s) {
    if (s.V > Vmax.v) Vmax = { v: s.V, x: s.x };
    if (s.V < Vmin.v) Vmin = { v: s.V, x: s.x };
    if (s.M > Mmax.v) Mmax = { v: s.M, x: s.x };
    if (s.M < Mmin.v) Mmin = { v: s.M, x: s.x };
    if (s.D > Dmax.v) Dmax = { v: s.D, x: s.x };
    if (s.D < Dmin.v) Dmin = { v: s.D, x: s.x };
    var Leff = LeffAt(spans, s.x) * FT;
    if (Leff > 0) {
      var nrm = Math.abs(s.D) / Leff;
      if (nrm > deflNorm) deflNorm = nrm;
    }
  });
  return { Vmax: Vmax, Vmin: Vmin, Mmax: Mmax, Mmin: Mmin, Dmax: Dmax, Dmin: Dmin, deflNorm: deflNorm };
}

// ---------------------------------------------------------------------------
// AISC 360-22 member strength
// ---------------------------------------------------------------------------

// opts: { Fy (ksi), E (ksi), LbFt, Cb, method: 'LRFD'|'ASD' }
// Returns capacities in kip-ft.
function flexureCapacity(shape, opts) {
  var Fy = opts.Fy, E = opts.E, Cb = opts.Cb || 1.0;
  var Lb = (opts.LbFt || 0) * FT;
  var Sx = shape.Sx, Zx = shape.Zx, ry = shape.ry, rts = shape.rts;
  var J = shape.J, ho = shape.ho;
  var Mp = Fy * Zx; // kip-in
  var sqEF = Math.sqrt(E / Fy);

  // --- F2.2 lateral-torsional buckling ---
  var Lp = 1.76 * ry * sqEF;                       // (F2-5)
  var X = (J * 1.0) / (Sx * ho);                   // Jc/(Sx*ho), c = 1
  var t = 6.76 * Math.pow(0.7 * Fy / E, 2);
  var Lr = 1.95 * rts * (E / (0.7 * Fy)) * Math.sqrt(X + Math.sqrt(X * X + t)); // (F2-6)
  var MnLTB, ltbCase;
  if (Lb <= Lp + 1e-9) { MnLTB = Mp; ltbCase = "Lb <= Lp (no LTB)"; }
  else if (Lb <= Lr) {
    MnLTB = Cb * (Mp - (Mp - 0.7 * Fy * Sx) * (Lb - Lp) / (Lr - Lp)); // (F2-2)
    if (MnLTB > Mp) MnLTB = Mp;
    ltbCase = "Lp < Lb <= Lr (inelastic LTB, Eq. F2-2)";
  } else {
    var slr = Lb / rts;
    var Fcr = Cb * Math.PI * Math.PI * E / (slr * slr) * Math.sqrt(1 + 0.078 * X * slr * slr); // (F2-4)
    MnLTB = Fcr * Sx;
    if (MnLTB > Mp) MnLTB = Mp;
    ltbCase = "Lb > Lr (elastic LTB, Eq. F2-3/F2-4)";
  }

  // --- F3.2 compression flange local buckling ---
  var lam = shape.bf2tf, lpf = 0.38 * sqEF, lrf = 1.0 * sqEF;
  var MnFLB = Infinity, flbCase = "compact flange (F2 applies)";
  if (lam > lpf) {
    if (lam <= lrf) {
      MnFLB = Mp - (Mp - 0.7 * Fy * Sx) * (lam - lpf) / (lrf - lpf); // (F3-1)
      flbCase = "noncompact flange (Eq. F3-1)";
    } else {
      var kc = 4 / Math.sqrt(shape.htw);
      kc = Math.max(0.35, Math.min(0.76, kc));
      MnFLB = 0.9 * E * kc * Sx / (lam * lam); // (F3-2)
      flbCase = "slender flange (Eq. F3-2)";
    }
  }

  var Mn = Math.min(Mp, MnLTB, MnFLB);
  var governing = Mn >= Mp - 1e-9 ? "Yielding (Mp)" : (MnLTB <= MnFLB ? "Lateral-torsional buckling" : "Flange local buckling");
  var cap = opts.method === "ASD" ? Mn / 1.67 : 0.90 * Mn;
  return {
    Mp: Mp / FT, Mn: Mn / FT, capacity: cap / FT,
    Lp: Lp / FT, Lr: Lr / FT, MnLTB: MnLTB / FT,
    MnFLB: MnFLB === Infinity ? null : MnFLB / FT,
    lambdaF: lam, lambdaPF: lpf, lambdaRF: lrf,
    ltbCase: ltbCase, flbCase: flbCase, governing: governing,
    phiOmega: opts.method === "ASD" ? "Mn/1.67" : "0.90*Mn"
  };
}

function shearCapacity(shape, opts) {
  var Fy = opts.Fy, E = opts.E;
  var Aw = shape.d * shape.tw;
  var htw = shape.htw;
  var lim = 2.24 * Math.sqrt(E / Fy);
  var Cv1, phi, omega, note;
  if (htw <= lim) {
    Cv1 = 1.0; phi = 1.00; omega = 1.50;
    note = "h/tw <= 2.24*sqrt(E/Fy): phi_v = 1.00, Omega_v = 1.50 (G2.1a)";
  } else {
    var kv = 5.34;
    var l1 = 1.10 * Math.sqrt(kv * E / Fy);
    Cv1 = htw <= l1 ? 1.0 : l1 / htw; // (G2-3)/(G2-4)
    phi = 0.90; omega = 1.67;
    note = "h/tw > 2.24*sqrt(E/Fy): phi_v = 0.90, Omega_v = 1.67, Cv1 = " + Cv1.toFixed(3);
  }
  var Vn = 0.6 * Fy * Aw * Cv1; // (G2-1), kips
  var cap = opts.method === "ASD" ? Vn / omega : phi * Vn;
  return { Vn: Vn, capacity: cap, Cv1: Cv1, Aw: Aw, phi: phi, omega: omega, note: note };
}

// ---------------------------------------------------------------------------
// Design run: analyze once at reference I, then check every candidate shape.
// Self-weight (if enabled) superposed from a unit-UDL analysis on case swCase.
// ---------------------------------------------------------------------------

var I_REF = 1000; // in^4 reference for analysis; deflections scale by I_REF/Ix

// opts: { Fy, E, method, LbFt, Cb, selfWeight: bool, swCase: 'D',
//         maxDepthIn: null|number, minDepthIn: null|number }
function runDesign(model, combos, opts, shapes) {
  var E = opts.E || 29000;
  var base = analyze(model, combos, E, I_REF);
  var unit = null;
  if (opts.selfWeight) {
    var swModel = {
      lengthFt: model.lengthFt,
      supports: model.supports,
      loads: { uniform: [{ case: opts.swCase || "D", w: 1.0 }] }
    };
    unit = analyze(swModel, combos, E, I_REF);
  }

  var strengthIdx = [], deflIdx = [];
  combos.forEach(function (c, i) {
    if (c.strength) strengthIdx.push(i);
    if (c.defl) deflIdx.push(i);
  });

  var checks = shapes.map(function (sh) {
    if (opts.maxDepthIn && sh.d > opts.maxDepthIn + 1e-9) return null;
    if (opts.minDepthIn && sh.d < opts.minDepthIn - 1e-9) return null;
    var sw = opts.selfWeight ? sh.wt / 1000 : 0; // kip/ft
    var flex = flexureCapacity(sh, opts);
    var shear = shearCapacity(sh, opts);

    var Mdem = 0, MdemX = 0, MdemCombo = "", Vdem = 0, VdemCombo = "";
    strengthIdx.forEach(function (ci) {
      var st = combineStations(base.results[ci], unit && unit.results[ci], sw);
      st.forEach(function (s) {
        var aM = Math.abs(s.M), aV = Math.abs(s.V);
        if (aM > Mdem) { Mdem = aM; MdemX = s.x; MdemCombo = combos[ci].name; }
        if (aV > Vdem) { Vdem = aV; VdemCombo = combos[ci].name; }
      });
    });

    var scale = I_REF / sh.Ix;
    var deflChecks = deflIdx.map(function (ci) {
      var res = base.results[ci];
      var deflNorm;
      if (unit && sw) {
        var st = combineStations(res, unit.results[ci], sw);
        var ex = extremes(st, base.spans);
        deflNorm = ex.deflNorm;
        var dmax = Math.abs(ex.Dmax.v) > Math.abs(ex.Dmin.v) ? ex.Dmax : ex.Dmin;
        var actual = dmax.v * scale;
        var ratioDen = deflNorm > 0 ? 1 / (deflNorm * scale) : Infinity;
        return mkDefl(combos[ci], actual, dmax.x, ratioDen);
      }
      deflNorm = res.deflNorm;
      var dm = Math.abs(res.Dmax.v) > Math.abs(res.Dmin.v) ? res.Dmax : res.Dmin;
      var ratioDen2 = deflNorm > 0 ? 1 / (deflNorm * scale) : Infinity;
      return mkDefl(combos[ci], dm.v * scale, dm.x, ratioDen2);
    });
    function mkDefl(combo, actualIn, xft, LoverN) {
      var lim = combo.deflLimit || 240;
      return {
        combo: combo.name, limit: lim, actualIn: actualIn, x: xft,
        LoverN: LoverN, ratio: LoverN === Infinity ? 0 : lim / LoverN,
        pass: LoverN >= lim - 1e-9
      };
    }

    var rM = flex.capacity > 0 ? Mdem / flex.capacity : Infinity;
    var rV = shear.capacity > 0 ? Vdem / shear.capacity : Infinity;
    var rD = 0;
    deflChecks.forEach(function (d) { if (d.ratio > rD) rD = d.ratio; });
    var pass = rM <= 1.0 + 1e-9 && rV <= 1.0 + 1e-9 && deflChecks.every(function (d) { return d.pass; });
    var governs = rM >= rV && rM >= rD ? "Flexure" : (rV >= rD ? "Shear" : "Deflection");
    return {
      shape: sh, flex: flex, shear: shear,
      Mdem: Mdem, MdemX: MdemX, MdemCombo: MdemCombo,
      Vdem: Vdem, VdemCombo: VdemCombo,
      deflChecks: deflChecks,
      ratioM: rM, ratioV: rV, ratioD: rD,
      maxRatio: Math.max(rM, rV, rD),
      pass: pass, governs: governs
    };
  }).filter(Boolean);

  var passing = checks.filter(function (c) { return c.pass; });
  passing.sort(function (a, b) { return a.shape.wt - b.shape.wt || a.shape.d - b.shape.d; });
  return {
    base: base, unit: unit, checks: checks, passing: passing,
    best: passing.length ? passing[0] : null
  };
}

// superpose base combo stations + sw * unit combo stations (aligned meshes)
function combineStations(baseRes, unitRes, sw) {
  if (!unitRes || !sw) return baseRes.stations;
  var bs = baseRes.stations, us = unitRes.stations;
  // meshes may differ (unit model lacks load-point keys) — interpolate unit result
  var out = new Array(bs.length);
  var j = 0;
  for (var i = 0; i < bs.length; i++) {
    var s = bs[i];
    while (j < us.length - 1 && us[j + 1].x <= s.x + 1e-12) j++;
    var u0 = us[Math.min(j, us.length - 1)];
    var u1 = us[Math.min(j + 1, us.length - 1)];
    var f = (u1.x > u0.x) ? (s.x - u0.x) / (u1.x - u0.x) : 0;
    if (f < 0) f = 0; if (f > 1) f = 1;
    out[i] = {
      x: s.x,
      V: s.V + sw * (u0.V + f * (u1.V - u0.V)),
      M: s.M + sw * (u0.M + f * (u1.M - u0.M)),
      D: s.D + sw * (u0.D + f * (u1.D - u0.D))
    };
  }
  return out;
}

// Full analysis for a specific shape (for diagrams/reports), self-weight included.
function analyzeForShape(model, combos, opts, shape) {
  var E = opts.E || 29000;
  var m = model;
  if (opts.selfWeight && shape) {
    m = JSON.parse(JSON.stringify(model));
    m.loads = m.loads || {};
    m.loads.uniform = (m.loads.uniform || []).concat([{ case: opts.swCase || "D", w: shape.wt / 1000 }]);
  }
  return analyze(m, combos, E, shape ? shape.Ix : I_REF);
}

// ---------------------------------------------------------------------------

return {
  FT: FT,
  buildMesh: buildMesh,
  analyze: analyze,
  analyzeForShape: analyzeForShape,
  flexureCapacity: flexureCapacity,
  shearCapacity: shearCapacity,
  runDesign: runDesign,
  spanMap: spanMap,
  I_REF: I_REF
};

}));
