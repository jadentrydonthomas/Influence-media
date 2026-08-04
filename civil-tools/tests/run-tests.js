// Verification tests for beam-engine.js
// Run: node civil-tools/tests/run-tests.js
// Benchmarks: closed-form beam theory (AISC Manual Table 3-23 cases) and
// AISC Steel Construction Manual Table 3-2 / Table 3-6 design values.

var Engine = require("../js/beam-engine.js");
var SHAPES = require("../js/aisc-shapes.js");

var E = 29000, IREF = 1000;
var nPass = 0, nFail = 0;

function approx(name, actual, expected, tolPct, tolAbs) {
  var tol = Math.max(tolAbs || 0, Math.abs(expected) * (tolPct || 0.5) / 100);
  var ok = Math.abs(actual - expected) <= tol;
  if (ok) { nPass++; console.log("  PASS  " + name + "  (" + actual.toFixed(4) + " ~ " + expected.toFixed(4) + ")"); }
  else { nFail++; console.log("  FAIL  " + name + "  got " + actual + ", expected " + expected + " +/- " + tol); }
}
function shape(name) {
  var s = SHAPES.find(function (x) { return x.name === name; });
  if (!s) throw new Error("shape not found: " + name);
  return s;
}
var comboDL = [{ name: "DL", f: { D: 1.0 }, strength: true, defl: true, deflLimit: 240 }];

// ---------------------------------------------------------------------------
console.log("\n[1] Simple span, point load (matches Nucor screenshot case)");
// L = 25.6667 ft, P = 1.0 kip at 6.3 ft -> R1 = Pb/L = 0.7545, Mmax = Pab/L = 4.753 @ 6.3'
(function () {
  var model = {
    lengthFt: 25.6667,
    supports: [{ x: 0, type: "pin" }, { x: 25.6667, type: "pin" }],
    loads: { point: [{ case: "D", x: 6.3, P: 1.0 }] }
  };
  var r = Engine.analyze(model, comboDL, E, IREF).results[0];
  approx("R1 (kips up)", r.reactions[0].R, 1.0 * (25.6667 - 6.3) / 25.6667, 0.1);
  approx("R2 (kips up)", r.reactions[1].R, 1.0 * 6.3 / 25.6667, 0.1);
  approx("Mmax (kip-ft)", r.Mmax.v, 1.0 * 6.3 * (25.6667 - 6.3) / 25.6667, 0.1);
  approx("Mmax location (ft)", r.Mmax.x, 6.3, 0.1, 0.01);
  approx("V left (kips)", r.Vleft, 0.7545, 0.2);
  approx("V right (kips)", r.Vright, -0.2455, 0.2);
})();

// ---------------------------------------------------------------------------
console.log("\n[2] Simple span, UDL: M = wL^2/8, V = wL/2, delta = 5wL^4/384EI");
(function () {
  var L = 20, w = 1.0;
  var model = {
    lengthFt: L,
    supports: [{ x: 0, type: "pin" }, { x: L, type: "pin" }],
    loads: { uniform: [{ case: "D", w: w }] }
  };
  var r = Engine.analyze(model, comboDL, E, IREF).results[0];
  approx("Mmax = wL^2/8", r.Mmax.v, w * L * L / 8, 0.1);
  approx("Vmax = wL/2", r.Vmax.v, w * L / 2, 0.1);
  var dExp = 5 * (w / 12) * Math.pow(L * 12, 4) / (384 * E * IREF);
  approx("delta max = 5wL^4/384EI (down)", -r.Dmin.v, dExp, 0.1);
  approx("deflection at midspan", r.Dmin.x, L / 2, 0.5);
})();

// ---------------------------------------------------------------------------
console.log("\n[3] Cantilever, tip load: M = -PL, delta = PL^3/3EI");
(function () {
  var L = 10, P = 2.0;
  var model = {
    lengthFt: L,
    supports: [{ x: 0, type: "fix" }],
    loads: { point: [{ case: "D", x: L, P: P }] }
  };
  var r = Engine.analyze(model, comboDL, E, IREF).results[0];
  approx("M at support = -PL", r.Mmin.v, -P * L, 0.1);
  approx("Shear = P", r.Vmax.v, P, 0.1);
  approx("tip deflection = PL^3/3EI (down)", -r.Dmin.v, P * Math.pow(L * 12, 3) / (3 * E * IREF), 0.1);
  approx("fixed-end moment reaction (kip-ft, ccw+)", r.reactions[0].Mr, P * L, 0.5);
  approx("vertical reaction", r.reactions[0].R, P, 0.1);
})();

// ---------------------------------------------------------------------------
console.log("\n[4] Two-span continuous (2 x 20 ft), UDL 1 k/ft");
// R_end = 3wL/8 = 7.5, R_mid = 10wL/8 = 25, M_support = -wL^2/8 = -50, M+max = 9wL^2/128 = 28.125
(function () {
  var model = {
    lengthFt: 40,
    supports: [{ x: 0, type: "pin" }, { x: 20, type: "pin" }, { x: 40, type: "pin" }],
    loads: { uniform: [{ case: "D", w: 1.0 }] }
  };
  var r = Engine.analyze(model, comboDL, E, IREF).results[0];
  approx("R end", r.reactions[0].R, 7.5, 0.2);
  approx("R middle", r.reactions[1].R, 25.0, 0.2);
  approx("M at center support = -wL^2/8", r.Mmin.v, -50.0, 0.2);
  approx("M+ max = 9wL^2/128", r.Mmax.v, 28.125, 0.2);
})();

// ---------------------------------------------------------------------------
console.log("\n[5] Fixed-fixed beam, UDL: M_end = -wL^2/12, M_mid = wL^2/24, delta = wL^4/384EI");
(function () {
  var L = 24, w = 2.0;
  var model = {
    lengthFt: L,
    supports: [{ x: 0, type: "fix" }, { x: L, type: "fix" }],
    loads: { uniform: [{ case: "D", w: w }] }
  };
  var r = Engine.analyze(model, comboDL, E, IREF).results[0];
  approx("M end = -wL^2/12", r.Mmin.v, -w * L * L / 12, 0.2);
  approx("M mid = wL^2/24", r.Mmax.v, w * L * L / 24, 0.2);
  approx("delta = wL^4/384EI", -r.Dmin.v, (w / 12) * Math.pow(L * 12, 4) / (384 * E * IREF), 0.2);
})();

// ---------------------------------------------------------------------------
console.log("\n[6] Overhang + partial trapezoidal line load sanity (statics check)");
(function () {
  // supports at 0 and 20, overhang to 26; trapezoid 0.5->1.5 k/ft from 8 to 26
  var model = {
    lengthFt: 26,
    supports: [{ x: 0, type: "pin" }, { x: 20, type: "pin" }],
    loads: { line: [{ case: "D", x1: 8, x2: 26, w1: 0.5, w2: 1.5 }] }
  };
  var r = Engine.analyze(model, comboDL, E, IREF).results[0];
  var W = 0.5 * (0.5 + 1.5) * 18; // total load = 18 kips
  approx("sum of reactions = total load", r.reactions[0].R + r.reactions[1].R, W, 0.1);
  // centroid of trapezoid from x=8: xbar = 8 + (18/3)*((0.5+2*1.5)/(0.5+1.5)) = 8 + 6*1.75 = 18.5 ft
  var R2 = W * 18.5 / 20; // moments about x=0
  approx("R2 by statics", r.reactions[1].R, R2, 0.3);
})();

// ---------------------------------------------------------------------------
console.log("\n[7] AISC Table 3-2 benchmarks - W21X44, Fy = 50 ksi (LRFD)");
(function () {
  var o = { Fy: 50, E: 29000, LbFt: 0, Cb: 1.0, method: "LRFD" };
  var f = Engine.flexureCapacity(shape("W21X44"), o);
  approx("phi*Mp = 358 kip-ft", f.capacity, 358, 0.5);
  approx("Lp = 4.45 ft", f.Lp, 4.45, 1.0);
  approx("Lr = 13.0 ft", f.Lr, 13.0, 1.5);
  var v = Engine.shearCapacity(shape("W21X44"), o);
  approx("phi*Vn = 217 kips", v.capacity, 217, 0.5);
  // ASD
  var fa = Engine.flexureCapacity(shape("W21X44"), { Fy: 50, E: 29000, LbFt: 0, Cb: 1, method: "ASD" });
  approx("Mp/Omega = 238 kip-ft", fa.capacity, 238, 0.5);
  var va = Engine.shearCapacity(shape("W21X44"), { Fy: 50, E: 29000, method: "ASD" });
  approx("Vn/Omega = 145 kips", va.capacity, 145, 0.7);
})();

// ---------------------------------------------------------------------------
console.log("\n[8] Noncompact flange - W21X48: phi*Mn = 398 kip-ft (< phi*Mp = 401)");
(function () {
  var f = Engine.flexureCapacity(shape("W21X48"), { Fy: 50, E: 29000, LbFt: 0, Cb: 1, method: "LRFD" });
  approx("phi*Mn (FLB governs)", f.capacity, 398, 0.7);
  if (f.governing === "Flange local buckling") { nPass++; console.log("  PASS  governing limit state = FLB"); }
  else { nFail++; console.log("  FAIL  governing = " + f.governing); }
})();

// ---------------------------------------------------------------------------
console.log("\n[9] LTB - W21X44 with Lb = 20 ft > Lr (elastic LTB region)");
(function () {
  // AISC beam design chart region; phi*Mn should be well below phi*Mp and > 0
  var f = Engine.flexureCapacity(shape("W21X44"), { Fy: 50, E: 29000, LbFt: 20, Cb: 1, method: "LRFD" });
  if (f.capacity < 358 && f.capacity > 50) { nPass++; console.log("  PASS  phi*Mn = " + f.capacity.toFixed(1) + " kip-ft in elastic LTB range"); }
  else { nFail++; console.log("  FAIL  phi*Mn = " + f.capacity); }
  // At Lb = 6 ft (between Lp and Lr): Table 3-2 style BF interpolation.
  // BF = (phiMp - phiMr)/(Lr - Lp) = (358 - 0.9*238)/(13.0 - 4.45) = 16.8 kips
  var f6 = Engine.flexureCapacity(shape("W21X44"), { Fy: 50, E: 29000, LbFt: 6, Cb: 1, method: "LRFD" });
  approx("phi*Mn @ Lb=6 ft (BF interp)", f6.capacity, 358 - 16.8 * (6 - 4.45), 1.0);
})();

// ---------------------------------------------------------------------------
console.log("\n[10] Full design run - 30 ft simple span, D = 0.5 k/ft, L = 1.0 k/ft (LRFD)");
(function () {
  var model = {
    lengthFt: 30,
    supports: [{ x: 0, type: "pin" }, { x: 30, type: "pin" }],
    loads: { uniform: [{ case: "D", w: 0.5 }, { case: "L", w: 1.0 }] }
  };
  var combos = [
    { name: "1.4D", f: { D: 1.4 }, strength: true },
    { name: "1.2D+1.6L", f: { D: 1.2, L: 1.6 }, strength: true },
    { name: "D+L (total)", f: { D: 1, L: 1 }, defl: true, deflLimit: 240 },
    { name: "L only", f: { L: 1 }, defl: true, deflLimit: 360 }
  ];
  var opts = { Fy: 50, E: 29000, method: "LRFD", LbFt: 0, Cb: 1.0, selfWeight: false };
  var d = Engine.runDesign(model, combos, opts, SHAPES);
  // Mu = 2.2 * 30^2/8 = 247.5 kip-ft. Strength-lightest is W18X35 (phiMn=249) but
  // L-only deflection (1.23" > L/360 = 1.0") knocks it out; W21X44 passes all.
  var best = d.best;
  if (best) {
    console.log("  best shape: " + best.shape.name + "  M-ratio " + best.ratioM.toFixed(2) +
      "  V-ratio " + best.ratioV.toFixed(2) + "  D-ratio " + best.ratioD.toFixed(2));
    approx("Mu demand", best.Mdem, 247.5, 0.3);
    if (best.shape.name === "W21X44") { nPass++; console.log("  PASS  lightest passing = W21X44 (deflection governs over W18X35)"); }
    else { nFail++; console.log("  FAIL  expected W21X44, got " + best.shape.name); }
  } else { nFail++; console.log("  FAIL  no passing shape"); }
  // W18X35 must fail on deflection, pass on strength
  var w18 = d.checks.find(function (c) { return c.shape.name === "W18X35"; });
  if (w18 && !w18.pass && w18.ratioM <= 1.0 && w18.ratioD > 1.0) { nPass++; console.log("  PASS  W18X35 fails on deflection only"); }
  else { nFail++; console.log("  FAIL  W18X35 check state unexpected", w18 && { pass: w18.pass, rM: w18.ratioM, rD: w18.ratioD }); }
})();

// ---------------------------------------------------------------------------
console.log("\n[11] Self-weight superposition consistency");
(function () {
  var model = {
    lengthFt: 30,
    supports: [{ x: 0, type: "pin" }, { x: 30, type: "pin" }],
    loads: { uniform: [{ case: "D", w: 0.5 }] }
  };
  var combos = [{ name: "1.2D", f: { D: 1.2 }, strength: true, defl: true, deflLimit: 240 }];
  var opts = { Fy: 50, E: 29000, method: "LRFD", LbFt: 0, Cb: 1, selfWeight: true, swCase: "D" };
  var d = Engine.runDesign(model, combos, opts, SHAPES);
  var w21 = d.checks.find(function (c) { return c.shape.name === "W21X44"; });
  // direct: Mu = 1.2*(0.5+0.044)*30^2/8 = 73.44
  approx("Mu incl. self-weight (superposed)", w21.Mdem, 1.2 * (0.5 + 0.044) * 900 / 8, 0.3);
})();

// ---------------------------------------------------------------------------
console.log("\n[12] ASD 0.6D combo scaling (matches 0.60DL member results style)");
(function () {
  var model = {
    lengthFt: 25.6667,
    supports: [{ x: 0, type: "pin" }, { x: 25.6667, type: "pin" }],
    loads: { point: [{ case: "D", x: 6.3, P: 1.0 }] }
  };
  var combos = [
    { name: "DL", f: { D: 1.0 }, strength: true, defl: true, deflLimit: 240 },
    { name: "0.60DL", f: { D: 0.6 }, strength: true, defl: true, deflLimit: 240 }
  ];
  var rr = Engine.analyze(model, combos, E, IREF).results;
  approx("0.6 x R1", rr[1].reactions[0].R, 0.6 * rr[0].reactions[0].R, 0.1);
  approx("0.6 x Mmax", rr[1].Mmax.v, 0.6 * rr[0].Mmax.v, 0.1);
})();

// ---------------------------------------------------------------------------
console.log("\n[13] Axial compression - AISC Ch. E");
(function () {
  // W14X43, KL = 10 ft both axes, Fy = 50: KL/ry = 63.5, Fe = 71.0 ksi,
  // Fcr = 0.658^(50/71)*50 = 37.2 ksi, Pn = 469 k, phi*Pn = 422 k (Table 4-1)
  var c = Engine.compressionCapacity(shape("W14X43"), { Fy: 50, E: 29000, KLxFt: 10, KLyFt: 10, method: "LRFD" });
  approx("W14X43 phi*Pn @ KL=10 ft", c.capacity, 422, 1.0);
  approx("KL/r max", c.slMax, 63.5, 1.0);
  var ca = Engine.compressionCapacity(shape("W14X43"), { Fy: 50, E: 29000, KLxFt: 10, KLyFt: 10, method: "ASD" });
  approx("W14X43 Pn/Omega @ KL=10 ft", ca.capacity, 469 / 1.67, 1.0);
  // W21X44 in pure compression has a slender web (h/tw = 53.7 > 35.9): E7 must reduce Ae
  var c2 = Engine.compressionCapacity(shape("W21X44"), { Fy: 50, E: 29000, KLxFt: 6, KLyFt: 6, method: "LRFD" });
  if (c2.slender && c2.Ae < c2.A) { nPass++; console.log("  PASS  W21X44 slender web reduced: Ae = " + c2.Ae.toFixed(2) + " < A = " + c2.A); }
  else { nFail++; console.log("  FAIL  E7 reduction not applied", c2.Ae, c2.A); }
  // slenderness flag
  var c3 = Engine.compressionCapacity(shape("W8X10"), { Fy: 50, E: 29000, KLxFt: 30, KLyFt: 30, method: "LRFD" });
  if (!c3.slenderOK && c3.slMax > 200) { nPass++; console.log("  PASS  KL/r > 200 flagged (" + c3.slMax.toFixed(0) + ")"); }
  else { nFail++; console.log("  FAIL  slenderness flag", c3.slMax); }
})();

// ---------------------------------------------------------------------------
console.log("\n[14] Combined axial + flexure - H1-1 interaction (mezzanine beam case)");
(function () {
  // 25.6667 ft simple span, DL+CL+LL area loads * 4 ft trib (mezzanine
  // workbook pattern) + 10 kip axial drag load, ASD
  var model = {
    lengthFt: 25.6667,
    supports: [{ x: 0, type: "pin" }, { x: 25.6667, type: "pin" }],
    loads: {
      uniform: [{ case: "D", w: 4 * 35 / 1000 }, { case: "L", w: 4 * 125 / 1000 }],
      axial: [{ case: "D", P: 4 }, { case: "L", P: 6 }]
    }
  };
  var combos = [
    { name: "D", f: { D: 1 }, strength: true },
    { name: "D+L", f: { D: 1, L: 1 }, strength: true, defl: true, deflLimit: 240 }
  ];
  var opts = { Fy: 50, E: 29000, method: "ASD", LbFt: 0, Cb: 1, selfWeight: false, KLxFt: 25.6667, KLyFt: 5 };
  var d = Engine.runDesign(model, combos, opts, SHAPES);
  var c = d.checks.find(function (x) { return x.shape.name === "W12X26"; });
  // independent check of the wiring: recompute H1 from returned capacities
  var P = 10, M = (4 * 160 / 1000) * 25.6667 * 25.6667 / 8;
  approx("M demand (D+L)", c.MdemAtH, M, 0.5);
  approx("P demand (D+L)", c.PdemAtH, P, 0.1);
  var pr = P / c.comp.capacity, mr = M / c.flex.capacity;
  var expected = pr >= 0.2 ? pr + 8 / 9 * mr : pr / 2 + mr;
  approx("H1 ratio wiring (" + c.Heq + ")", c.ratioH, expected, 0.3);
  if (c.governs.indexOf("Combined") === 0 || c.governs === "Deflection" || c.governs === "Shear") { nPass++; console.log("  PASS  governs = " + c.governs); }
  else { nFail++; console.log("  FAIL  governs = " + c.governs); }
  // without axial, ratioH must equal worst per-combo flexure ratio
  var model2 = JSON.parse(JSON.stringify(model));
  delete model2.loads.axial;
  var d2 = Engine.runDesign(model2, combos, opts, SHAPES);
  var c2 = d2.checks.find(function (x) { return x.shape.name === "W12X26"; });
  approx("no axial: ratioH == ratioM", c2.ratioH, c2.ratioM, 0.05);
})();

// ---------------------------------------------------------------------------
console.log("\n=========================================");
console.log(nPass + " passed, " + nFail + " failed");
if (nFail > 0) process.exit(1);
