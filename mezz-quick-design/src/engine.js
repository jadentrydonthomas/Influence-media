/* Mezzanine design engine — faithful port of NBG "Mezzanine Beam Design (AISC 16th)" v2025.7.15
   and "Mezzanine Column 16th / S16-19" v2024.10.17 workbooks (ASD path only).
   Every function below mirrors a worksheet formula or VBA UDF; cell refs are noted. */
(function (root) {
  'use strict';
  const PI = Math.PI;
  const isNum = v => typeof v === 'number' && isFinite(v);
  // Excel MIN/MAX over references ignore text ("--", here null/strings); all-text -> 0.
  // An error cell (#VALUE!, here NaN) makes the whole MIN/MAX an error, as in Excel.
  const isErr = v => typeof v === 'number' && Number.isNaN(v);
  const xmin = (...a) => { if (a.some(isErr)) return NaN; const n = a.filter(isNum); return n.length ? Math.min(...n) : 0; };
  const xmax = (...a) => { if (a.some(isErr)) return NaN; const n = a.filter(isNum); return n.length ? Math.max(...n) : 0; };
  const sqrt = Math.sqrt;
  // Excel ROUND (half away from zero) rendered the way Excel concatenates a number into text
  const xround = (v, n) => { if (!isFinite(v)) return String(v); const f = 10 ** n; const r = Math.sign(v) * Math.round(Math.abs(v) * f + 1e-9) / f; return String(+r.toFixed(n)); };

  /* ---------------- VBA: Section_Properties ---------------- */
  function Centroid(h, tw, bof, tof, bif, tif) {
    const Aof = bof * tof, Aw = h * tw, Aif = bif * tif;
    const Xof = tif + h + tof / 2, Xw = tif + h / 2, Xif = tif / 2;
    return (Xof * Aof + Xw * Aw + Xif * Aif) / (Aof + Aw + Aif);
  }
  function MomentOfInertia_X(h, tw, bof, tof, bif, tif, Xc) {
    const Aof = bof * tof, Aw = h * tw, Aif = bif * tif;
    const Xof = tif + h + tof / 2, Xw = tif + h / 2;
    const d = h + tof + tif;
    const dy_of = Xc > Xof ? d - Xc - tof / 2 : Xc - Xof;
    const dy_w = Xw - Xc;           // sign irrelevant (squared)
    const dy_if = Xc - tif / 2;
    return bof * tof ** 3 / 12 + Aof * dy_of ** 2 + tw * h ** 3 / 12 + Aw * dy_w ** 2 + bif * tif ** 3 / 12 + Aif * dy_if ** 2;
  }
  function MomentOfInertia_Y(h, tw, bof, tof, bif, tif) {
    return h * tw ** 3 / 12 + tof * bof ** 3 / 12 + tif * bif ** 3 / 12;
  }
  function ftnJ(h, tw, bof, tof, bif, tif) {
    return h * tw ** 3 / 3 + 1 / 3 * (bof * tof ** 3) * (1 - 0.63 * tof / bof) + 1 / 3 * (bif * tif ** 3) * (1 - 0.63 * tif / bif);
  }
  function ftnZx(PNAx, d, h, tw, bof, tof, bif, tif) {
    if (PNAx > tif + h || PNAx < tif) return 'ERROR';
    const a1 = bof * tof, a2 = (tif + h - PNAx) * tw, a3 = (PNAx - tif) * tw, a4 = bif * tif;
    const x1 = d - PNAx - tof / 2, x2 = (h + tif - PNAx) / 2, x3 = (PNAx - tif) / 2, x4 = PNAx - tif / 2;
    return a1 * x1 + a2 * x2 + a3 * x3 + a4 * x4;
  }
  function PNA(d, tw, bof, tof, bif, tif, Ag) {
    const half = Ag / 2, Aif = bif * tif, Aw = (d - tof - tif) * tw;
    if (half <= Aif) return half / bif;
    if (half <= Aif + Aw) return (half - Aif) / tw + tif;
    return d - half / bof;
  }
  function ftnZy(d, tw, bof, tof, bif, tif) {
    const hweb = d - tof - tif;
    return 2 * (tof * bof / 2) * (bof / 4) + 2 * (tif * bif / 2) * (bif / 4) + 2 * (tw / 2 * hweb) * (tw / 4);
  }
  /* ---------------- VBA: Output ---------------- */
  function t_flange(of, inf) {
    if (of > 0 && inf > 0) return 'Neither';
    if (of > 0) return 'I';
    if (inf > 0) return 'O';
    if (inf < 0) return 'Both';
    return 'Neither';
  }
  /* ---------------- VBA: ChapterB ---------------- */
  const ftnSxt = (c, Sxo, Sxi) => c === 'I' ? Sxi : c === 'O' ? Sxo : c === 'Neither' ? 'NA' : Math.min(Sxo, Sxi);
  const ftnSxc = (c, Sxo, Sxi) => c === 'I' ? Sxo : c === 'O' ? Sxi : c === 'Neither' ? Math.min(Sxo, Sxi) : 'NA';
  function ftnFL(w, Sxt, Sxc, Fyf, c) {
    if (c === 'Neither') return w === 'S' ? 0.7 * Fyf : 0.5 * Fyf;
    if (c === 'Both') return 0.7 * Fyf;
    if (w === 'S') return 0.7 * Fyf;
    return Sxt / Sxc >= 0.7 ? 0.7 * Fyf : Math.max(0.5 * Fyf, Fyf * Sxt / Sxc);
  }
  const ftnLamdaFLG = (c, lo, li) => c === 'I' ? lo : c === 'O' ? li : c === 'Neither' ? Math.max(lo, li) : -1;
  const classify = (l, lp, lr) => l <= lp ? 'C' : l <= lr ? 'NC' : 'S';
  const overall = (w, f) => (w === 'C' && f === 'C') ? 'C' : (w === 'S' || f === 'S') ? 'S' : 'NC';
  /* ---------------- VBA: ChapterE ---------------- */
  function ftnCw(ho, bof, tof, bif, tif) { const I1 = tof * bof ** 3 / 12, I2 = tif * bif ** 3 / 12; return ho ** 2 * I1 / (I1 / I2 + 1); }
  function ftnYo(ho, bof, tof, bif, tif, Xc) { const I1 = tof * bof ** 3 / 12, I2 = tif * bif ** 3 / 12; return tif / 2 + ho * I1 / (I1 + I2) - Xc; }
  function ftnEffectiveWidth(lam, lamR, Fy, Fcr, b, isFlange) {
    const c1 = isFlange ? 0.22 : 0.18, c2 = (1 - sqrt(1 - 4 * c1)) / (2 * c1);
    const Fel = (c2 * lamR / lam) ** 2 * Fy;
    if (lam <= lamR * sqrt(Fy / Fcr)) return b;
    return b * (1 - c1 * sqrt(Fel / Fcr)) * sqrt(Fel / Fcr);
  }
  /* ---------------- VBA: 13th edition (AISC 360-05) ChapterE / ChapterF / ChapterG ---------------- */
  function ftnQs13(type, r, E, Fy, kc) {
    if (type === 'WF') {
      if (r <= 0.56 * sqrt(E / Fy)) return 1;
      if (r >= 1.03 * sqrt(E / Fy)) return 0.69 * E / (Fy * r ** 2);
      return 1.415 - 0.74 * r * sqrt(Fy / E);
    }
    if (r <= 0.64 * sqrt(E * kc / Fy)) return 1;
    if (r > 1.17 * sqrt(E * kc / Fy)) return 0.9 * E * kc / (Fy * r ** 2);
    return 1.415 - 0.65 * r * sqrt(Fy / (E * kc));
  }
  function ftnBe13(f, tw, E, h) {
    if (h / tw >= 1.49 * sqrt(E / f)) return Math.min(1.92 * tw * sqrt(E / f) * (1 - sqrt(E / f) * 0.34 / (h / tw)), h);
    return h;
  }
  function ftn_rt13(c, bof, bif, d, h, ho, aw) {
    const bfc = c === 'I' ? bof : c === 'O' ? bif : c === 'Neither' ? Math.min(bof, bif) : null;
    return bfc === null ? 'NA' : bfc / sqrt(12 * (ho / d + (aw * h ** 2) / (6 * ho * d)));
  }
  function ftnKv13(Lbx, a, tw, h) {
    if ((a > 0 && a <= Lbx) || h / tw >= 260) {
      if (a / h <= 3 && a / h <= (260 * tw / h) ** 2) return 5 + 5 / (a / h) ** 2;
      return 5;
    }
    return 5;
  }
  function ftnCv13(r, kv, E, Fyw) {
    if (r <= 1.1 * sqrt(kv * E / Fyw)) return 1;
    if (r > 1.37 * sqrt(kv * E / Fyw)) return 1.51 * E * kv / (Fyw * r ** 2);
    return 1.1 * sqrt(kv * E / Fyw) / r;
  }

  /* ---------------- VBA: ChapterF ---------------- */
  function ftn_Iyc(c, bof, tof, bif, tif) { const o = tof * bof ** 3 / 12, i = tif * bif ** 3 / 12; return c === 'I' ? o : c === 'O' ? i : c === 'Neither' ? Math.min(o, i) : 'NA'; }
  function ftn_Iyt(c, bof, tof, bif, tif) { const o = tof * bof ** 3 / 12, i = tif * bif ** 3 / 12; return c === 'I' ? o : c === 'O' ? i : c === 'Neither' ? 'NA' : Math.min(o, i); }
  function ftn_aw(c, r, tw, bof, tof, bif, tif) { const o = r * tw ** 2 / (tof * bof), i = r * tw ** 2 / (tif * bif); return c === 'I' ? o : c === 'O' ? i : c === 'Neither' ? Math.max(o, i) : 'NA'; }
  function ftnRpct(r, Myct, Mp, lpw, lrw, Iyc, Iy) {
    if (r <= lpw) return Mp / Myct;
    if (r > lrw || Iyc / Iy <= 0.23) return 1;
    return Math.min(Mp / Myct, Mp / Myct - (Mp / Myct - 1) * (r - lpw) / (lrw - lpw));
  }
  function ftnRpg(r, aw_, lrw, E, Fyw) { // VBA compares to undefined lamdaR (=0) -> always else branch
    const aw = Math.min(aw_, 10);
    return Math.min(1, 1 - (aw / (1200 + 300 * aw)) * (r - 5.7 * sqrt(E / Fyw)));
  }
  function ftn_rt(c, bof, bif, aw) {
    const bfc = c === 'I' ? bof : c === 'O' ? bif : c === 'Neither' ? Math.min(bof, bif) : null;
    return bfc === null ? 'NA' : bfc / sqrt(12 * (1 + aw / 6));
  }
  function ftnFeLTB(r, lrw, Iyc, Iy, Cb, E, Lb, rt, Jt, Sxc, ho) {
    const j = (r > lrw || Iyc / Iy <= 0.23) ? 0 : Jt;
    return (Cb * E * PI ** 2) / (Lb / rt) ** 2 * sqrt(1 + (0.078 * j * (Lb / rt) ** 2) / (Sxc * ho));
  }
  function ftnMnxLTB(FeLTB, Fy, FL, Rpc, Rpg, Myc, Sxc) {
    if (FeLTB / Fy >= PI ** 2 / 1.1 ** 2) return null;
    if (FeLTB / Fy <= FL / Fy) return Math.min(Rpg * FeLTB * Sxc, Rpc * Myc);
    const Mn = Rpg * Rpc * Myc * (1 - (1 - FL / (Rpc * Fy)) * (PI * sqrt(Fy / FeLTB) - 1.1) / (PI * sqrt(Fy / FL) - 1.1));
    return Math.min(Mn, Rpg * Rpc * Myc);
  }
  function ftnMnxFLB(c, ro, ri, lpf, lrf, kc, FL, Rpc, Rpg, Myc, Sxc, E) {
    const r = c === 'I' ? ro : c === 'O' ? ri : c === 'Neither' ? Math.max(ro, ri) : null;
    if (r === null || r <= lpf) return null;
    if (r >= lrf) return 0.9 * Rpg * E * kc * Sxc / r ** 2;
    return Rpg * (Rpc * Myc - (Rpc * Myc - FL * Sxc) * (r - lpf) / (lrf - lpf));
  }
  function ftnMny(l, lpf, lrf, Mp, Fy, Sy, E) {
    if (l <= lpf) return Mp;
    if (l >= lrf) return Sy * 0.69 * E / l ** 2;
    return Mp - (Mp - 0.7 * Fy * Sy) * (l - lpf) / (lrf - lpf);
  }
  /* ---------------- VBA: ChapterG ---------------- */
  function ftnKv(Lbx, a, tw, h) {
    if ((a > 0 && a <= Lbx) || h / tw >= 260) {
      if (a / h <= 3 && a / h <= (260 * tw / h) ** 2) return 5 + 5 / (a / h) ** 2; // a=0 -> Infinity (VBA #VALUE)
      return 5.34;
    }
    return 5.34;
  }
  const ftnCv1 = (r, kv, E, Fyw) => r <= 1.1 * sqrt(kv * E / Fyw) ? 1 : 1.1 * sqrt(kv * E / Fyw) / r;
  function ftnCv2(r, kv, E, Fyw) {
    if (r <= 1.1 * sqrt(kv * E / Fyw)) return 1;
    if (r > 1.37 * sqrt(kv * E / Fyw)) return 1.51 * E * kv / (Fyw * r ** 2);
    return 1.1 * sqrt(kv * E / Fyw) / r;
  }
  function ftnVn(TFA, a, tw, bof, tof, bif, tif, h, Fyw, Aw, r, kv, E, Cv1, Cv2, tfc) {
    if ((TFA && tfc === 'I') || tfc === 'O') { // VBA operator precedence: (TFA And I) Or O
      let Afc, Aft, bfc, bft;
      if (tfc === 'I') { Afc = bof * tof; Aft = bif * tif; bfc = bof; bft = bif; }
      else { Afc = bif * tif; Aft = bof * tof; bfc = bif; bft = bof; }
      if (r <= 1.1 * sqrt(kv * E / Fyw)) return 0.6 * Fyw * Aw;
      if (2 * Aw / (Afc + Aft) <= 2.5 && h / bfc <= 6 && h / bft <= 6)
        return 0.6 * Fyw * Aw * (Cv2 + (1 - Cv2) / (1.15 * sqrt(1 + (a / h) ** 2)));
      return 0.6 * Fyw * Aw * (Cv2 + (1 - Cv2) / (1.15 * (a / h + sqrt(1 + (a / h) ** 2))));
    }
    return 0.6 * Fyw * Aw * Cv1;
  }

  /* ============ Main Report -> Secondary Report -> Chapters B..H (one member column) ============ */
  // sec: {type:'BU', d, tw, bof, tof, bif, tif} or {type:'WF', name}
  // m:   {Fy, Fyf, Fyw, Fu, E, G}   g: {Lbx, Lby (ft), Cb, Kx, Ky, Kz, a (in|0), TFA, Sf}
  // f:   {Pa, Vx, Mx, Vy, My}  (kips, ft-kip)
  function analyze(sec, m, g, f, WFDB) {
    const E = m.E ?? 29000, Gm = m.G ?? 11200, Fyf = m.Fyf, Fyw = m.Fyw, Fu = m.Fu;
    const Cb = g.Cb ?? 1, Kx = g.Kx ?? 1, Ky = g.Ky ?? 1, Kz = g.Kz ?? 1, a = g.a || 0, TFA = !!g.TFA, Sf = g.Sf ?? 1;
    const ed13 = String(g.edition || '') === '13';   // 13th-edition sheet (AISC 360-05); 15th and 16th are identical
    const Lbx = g.Lbx, Lby = g.Lby;
    const Pa = f.Pa || 0, Vx = f.Vx || 0, Mx = f.Mx || 0, Vy = f.Vy || 0, May = f.My || 0;
    const WF = sec.type === 'WF';
    let d, tw, bof, tof, bif, tif, db;
    if (WF) {
      db = WFDB[sec.name.toUpperCase()]; if (!db) throw new Error('Unknown WF ' + sec.name);
      d = db.d; tw = db.tw; bof = bif = db.bf; tof = tif = db.tf;
    } else ({ d, tw, bof, tof, bif, tif } = sec);
    const r = { d, tw, bof, tof, bif, tif, type: sec.type };
    // Secondary Report
    const h = WF ? db.d - 2 * db.k : d - tof - tif;
    const Ag = WF ? db.A : h * tw + bof * tof + bif * tif;
    const Wt = WF ? db.W : Ag * 3.403;
    const PNAx = WF ? d / 2 : PNA(d, tw, bof, tof, bif, tif, Ag);
    const J = WF ? db.J : ftnJ(h, tw, bof, tof, bif, tif);
    const Xc = WF ? d / 2 : Centroid(h, tw, bof, tof, bif, tif);
    const Yout = d - Xc, Yin = -Xc;
    const Ix = WF ? db.Ix : MomentOfInertia_X(h, tw, bof, tof, bif, tif, Xc);
    const Sx = WF ? db.Sx : Ix / Xc, Sxo = WF ? db.Sx : Ix / (d - Xc), Sxi = WF ? db.Sx : Ix / Xc;
    const rx = WF ? db.rx : sqrt(Ix / Ag);
    const Zx = WF ? db.Zx : ftnZx(PNAx, d, h, tw, bof, tof, bif, tif);
    const Iy = WF ? db.Iy : MomentOfInertia_Y(h, tw, bof, tof, bif, tif);
    const Sy = WF ? db.Sy : Iy / (Math.max(bof, bif) / 2);
    const ry = WF ? db.ry : sqrt(Iy / Ag);
    const Zy = WF ? db.Zy : ftnZy(d, tw, bof, tof, bif, tif);
    const sa = Pa / Ag, sOF = sa + Mx * 12 * Yout / Ix, sIF = sa + Mx * 12 * Yin / Ix;
    const TfCode = t_flange(sOF, sIF);
    Object.assign(r, { h, Ag, Wt, PNAx, J, Xc, Ix, Sx, Sxo, Sxi, rx, Zx, Iy, Sy, ry, Zy, sOF, sIF, TfCode });
    const doubly = (bof === bif && tof === tif);
    // Chapter B
    const htw = h / tw;
    const B18 = doubly ? 3.76 * sqrt(E / Fyw) : null, B19 = doubly ? 5.7 * sqrt(E / Fyw) : null, B20 = 1.49 * sqrt(E / Fyw);
    const hc = WF ? h : (TfCode === 'O' ? 2 * (Xc - tif) : 2 * (d - Xc - tof));
    const hp = WF ? h : (TfCode === 'O' ? 2 * (PNAx - tif) : 2 * (d - PNAx - tof));
    const My = Fyw * Math.min(Sxo, Sxi), Mp = Fyw * Zx, hctw = hc / tw;
    const B28 = doubly ? null : 5.7 * sqrt(E / Fyw);
    const B27 = doubly ? null : Math.min((hc / hp) * sqrt(E / Fyw) / (0.54 * (Mp / My) - 0.09) ** 2, B28);
    const webFlex = doubly ? classify(TfCode === 'Both' ? -1 : htw, B18, B19) : classify(TfCode === 'Both' ? -1 : hctw, B27, B28);
    const webAx = classify(TfCode === 'Both' ? -1 : (doubly ? htw : hctw), 0, B20);
    const btOF = (bof / 2) / tof, btIF = (bif / 2) / tif;
    const B35 = WF ? 0.38 * sqrt(E / Fyf) : null, B36 = WF ? sqrt(E / Fyf) : null, B37 = WF ? 0.56 * sqrt(E / Fyf) : null;
    const Sxt = ftnSxt(TfCode, Sxo, Sxi), Sxc = ftnSxc(TfCode, Sxo, Sxi);
    const FL = ftnFL(webFlex, Sxt, Sxc, Fyf, TfCode);
    const kc = Math.min(Math.max(0.35, 4 / sqrt(htw)), 0.76);
    const B45 = WF ? null : 0.38 * sqrt(E / Fyf), B46 = WF ? null : 0.95 * sqrt(kc * E / FL), B47 = WF ? null : 0.64 * sqrt(kc * E / Fyf);
    const lamFLG = ftnLamdaFLG(TfCode, btOF, btIF);
    const flgFlex = WF ? classify(lamFLG, B35, B36) : classify(lamFLG, B45, B46);
    const flgAx = WF ? classify(lamFLG, 0, B37) : classify(lamFLG, 0, B47);
    Object.assign(r, { htw, hc, hp, My, Mp, webFlex, webAx, flgFlex, flgAx, flexClass: overall(webFlex, flgFlex), axClass: overall(webAx, flgAx), Sxt, Sxc, FL, kc, btOF, btIF });
    // Chapter D
    const Fy = Math.min(Fyf, Fyw);
    const PtASD = Math.min(Fy * Ag / 1.67, Fu * Ag / 2) * Sf;
    // Chapter E
    const KLrx = Kx * Lbx * 12 / rx, KLry = Ky * Lby * 12 / ry;
    const Fex = PI ** 2 * E / KLrx ** 2, Fey = PI ** 2 * E / KLry ** 2;
    const ho = d - 0.5 * tof - 0.5 * tif;
    const Cw = WF ? db.Cw : ftnCw(ho, bof, tof, bif, tif);
    const FeD = doubly ? (PI ** 2 * E * Cw / (Kz * Lby * 12) ** 2 + Gm * J) / (Ix + Iy) : null;
    let FeS = null;
    if (!doubly) {
      const yo = ftnYo(ho, bof, tof, bif, tif, Xc), ro2 = yo ** 2 + (Ix + Iy) / Ag, H = 1 - yo ** 2 / ro2;
      const Fez = (PI ** 2 * E * Cw / (Kz * Lby * 12) ** 2 + Gm * J) / (Ag * ro2);
      FeS = ((Fey + Fez) / (2 * H)) * (1 - sqrt(1 - 4 * Fey * Fez * H / (Fey + Fez) ** 2));
    }
    const NFe = xmin(Fex, Fey, FeD, FeS);
    let Fcr, Aeff, Pn, PcASD, Q = null;
    if (ed13) {
      // 13th Chapter E: Q-factor method (E7). Qs only for the compression flange(s); Qa from the web at NFcr.
      const Fcr0 = NFe < 0.44 * Fy ? 0.877 * NFe : 0.658 ** (Fy / NFe) * Fy;              // F34 / F35
      const QsOF = TfCode === 'O' || TfCode === 'Both' ? null : ftnQs13(sec.type, btOF, E, Fyf, kc);
      const QsIF = TfCode === 'I' || TfCode === 'Both' ? null : ftnQs13(sec.type, btIF, E, Fyf, kc);
      const be = ftnBe13(Fcr0, tw, E, h);
      Aeff = Ag + tw * (be - h);
      Q = xmin(QsOF, QsIF) * (Aeff / Ag);
      Fcr = NFe < 0.44 * Q * Fy ? 0.877 * NFe : 0.658 ** (Q * Fy / NFe) * Q * Fy;         // F46 / F47
      Pn = Fcr * Ag; PcASD = Sf * Pn / 1.67;                                                 // Omega_c = 1.67 on the 13th sheet
    } else {
      Fcr = Fy / NFe > 2.25 ? 0.877 * NFe : 0.658 ** (Fy / NFe) * Fy;
      const lrFlgAx = xmin(B47, B37);
      const beof = ftnEffectiveWidth(btOF, lrFlgAx, Fyf, Fcr, bof, true);
      const beif = ftnEffectiveWidth(btIF, lrFlgAx, Fyf, Fcr, bif, true);
      const he = ftnEffectiveWidth(htw, B20, Fyw, Fcr, h, false);
      Aeff = Ag - tif * (bif - beif) - tof * (bof - beof) - tw * (h - he);
      Pn = Fcr * Aeff; PcASD = Sf * Pn / 1.667;
    }
    Object.assign(r, { KLrx, KLry, Fex, Fey, Cw, ho, NFe, Fcr, Aeff, Pn, PcASD, PtASD, Q });
    // Chapter F
    const Myt = TfCode === 'Neither' ? null : Fyf * Sxt;
    const Myc = TfCode === 'Both' ? null : Fyf * Sxc;
    const Mpc = TfCode === 'Both' ? null : Math.min(Zx * Fyw, 1.6 * Myc);
    const Mymin = xmin(Myt, Myc);
    const lrw = 5.7 * sqrt(E / Fyw);
    const lpw = doubly ? 3.76 * sqrt(E / Fyw) : Math.min((hc / hp) * sqrt(E / Fyw) / (0.54 * (Mp / Mymin) - 0.09) ** 2, lrw);
    const Iyc = ftn_Iyc(TfCode, bof, tof, bif, tif);
    const aw = ftn_aw(TfCode, hctw, tw, bof, tof, bif, tif);
    const Rpc = TfCode === 'Both' ? null : ftnRpct(hctw, Myc, Mpc, lpw, lrw, Iyc, Iy);
    const Rpg = TfCode === 'Both' ? null : ftnRpg(hctw, aw, lrw, E, Fyw);
    const MnCFY = TfCode === 'Both' ? null : Rpc * Rpg * Myc;
    const rt = TfCode === 'Both' ? null : ed13 ? ftn_rt13(TfCode, bof, bif, d, h, ho, aw) : ftn_rt(TfCode, bof, bif, aw);
    const FeLTB = TfCode === 'Both' ? null : ftnFeLTB(hctw, lrw, Iyc, Iy, Cb, E, Lby * 12, rt, J, Sxc, ho);
    const MnLTB = TfCode === 'Both' ? null : ftnMnxLTB(FeLTB, Fyf, FL, Rpc, Rpg, Myc, Sxc);
    const lpf = 0.38 * sqrt(E / Fyf), lrf = WF ? sqrt(E / Fyf) : 0.95 * sqrt(kc * E / FL);
    const MnFLB = TfCode === 'Both' ? null : ftnMnxFLB(TfCode, btOF, btIF, lpf, lrf, kc, FL, Rpc, Rpg, Myc, Sxc, E);
    const Mpt = TfCode === 'Neither' ? null : Math.min(Zx * Fyw, 1.6 * Myt);
    const Iyt = ftn_Iyt(TfCode, bof, tof, bif, tif);
    const Rpt = TfCode === 'Neither' ? null : ftnRpct(hctw, Myt, Mpt, lpw, lrw, Iyt, Iy);
    const MnTFY = TfCode === 'Neither' ? null : (isNum(Sxc) && Sxt >= Sxc ? null : Rpt * Myt);
    const Mn = xmin(MnCFY, MnLTB, MnFLB, MnTFY);
    const McxASD = Sf * Mn / 1.67;
    const Mpy = Math.min(Fy * Zy, 1.6 * Fy * Sy);
    const Mny = ftnMny(lamFLG, lpf, sqrt(E / Fyf), Mpy, Fy, Sy, E);
    const McyASD = Sf * Mny / 1.67;
    const IyRatio = TfCode === 'Both' ? Iyt / Iy : Iyc / Iy;
    const F13_2 = IyRatio >= 0.1 && IyRatio <= 0.9;
    const ah = ed13 ? a / h : (a ? a / h : Lbx * 12 / h);
    const F13_34 = ed13 ? ((ah <= 1.5 && hctw <= 11.7 * sqrt(E / Fy)) || (ah > 1.5 && hctw <= 0.42 * E / Fy))  // informational on the 13th sheet
      : ((ah <= 1.5 && htw <= 12 * sqrt(E / Fy)) || (ah > 1.5 && htw <= 0.4 * E / Fy));
    Object.assign(r, { Myt, Myc, Mpc, lpw, lrw, Iyc, aw, Rpc, Rpg, MnCFY, rt, FeLTB, MnLTB, lpf, lrf, MnFLB, Mpt, Rpt, MnTFY, Mn, McxASD, Mny, McyASD, F13_2, F13_34 });
    // Chapter G
    const Aws = h * tw;
    const kv = ed13 ? ftnKv13(Lbx * 12, a, tw, h) : ftnKv(Lbx * 12, a, tw, h);
    const wfEasy = WF && htw <= 2.24 * sqrt(E / Fy);
    // 13th: one three-branch Cv, no F13 cut-off, no tension field (TFA = FALSE on the MB sheet)
    const Cv1 = wfEasy ? 1 : ed13 ? ftnCv13(htw, kv, E, Fyw) : (!F13_34 ? 0.001 : ftnCv1(htw, kv, E, Fyw));
    const Cv2 = ed13 ? Cv1 : (!F13_34 ? 0.001 : ftnCv2(htw, kv, E, Fyw));
    const Om_v = wfEasy ? 1.5 : 1.67;
    const Vn = ed13 ? 0.6 * Fyw * Aws * Cv1 : ftnVn(TFA, a, tw, bof, tof, bif, tif, h, Fyw, Aws, htw, kv, E, Cv1, Cv2, TfCode);
    const VcxASD = Sf * Vn / Om_v;
    const Af = tof * bof + tif * bif, btMax = Math.max(btOF, btIF);
    const wfEasyY = WF && btMax <= 2.24 * sqrt(E / Fy);
    const Cv2y = wfEasyY ? 1 : ftnCv2(btMax, 1.2, E, Fyf);
    const VcyASD = Sf * (0.6 * Fyf * Af * Cv2y) / (wfEasyY ? 1.5 : 1.67);
    Object.assign(r, { kv, Cv1, Cv2, Vn, VcxASD, VcyASD });
    // Chapter H (ASD)
    const Pr = Pa;
    const Pc = Math.sign(Pr) === -1 ? PtASD : PcASD;
    const B1x = Math.max(1 / (1 - 1.6 * Pr / (PI ** 2 * E * Ix / (Kx * Lbx * 12) ** 2)), 1);
    const B1y = Math.max(1 / (1 - 1.6 * Pr / (PI ** 2 * E * Iy / (Ky * Lby * 12) ** 2)), 1);
    const PrPc = Math.abs(Pr / Pc), MrxMcx = Math.abs(B1x * Mx * 12 / McxASD);
    const MryMcy = (May === 0 && McyASD === 0) ? 0 : Math.abs(B1y * May * 12 / McyASD);
    const CSR = PrPc >= 0.2 ? PrPc + (MrxMcx + MryMcy) * 8 / 9 : PrPc / 2 + MrxMcx + MryMcy;
    const SRvx = Vx / VcxASD, SRvy = Vy / VcyASD;
    Object.assign(r, { Pc, B1x, B1y, PrPc, MrxMcx, MryMcy, CSR, SRvx, SRvy, Pa, Mx, Vx, maxSR: Math.max(CSR, SRvx, SRvy) });
    if (!isFinite(r.maxSR)) r.maxSR = 99;
    return r;
  }

  /* ---------------- Concentrated Load (joist bearing) quick check — ASD, "Comp." ---------------- */
  function concCheck(s, Ru, N, deIn, lFt, Fy, E) {
    const d = s.h + 2 * s.tof, k = s.tof + 3 / 16, h = s.h, tw = s.tw, tf = s.tof, bf = s.bof;
    const WLY = (deIn > d ? (5 * k + N) : (2.5 * k + N)) * Fy * tw / 1.5;
    let WC;
    if (deIn >= d / 2) WC = 0.8 * tw ** 2 * (1 + 3 * (N / d) * (tw / tf) ** 1.5) * sqrt(E * Fy * tf / tw);
    else if (N / d <= 0.2) WC = 0.4 * tw ** 2 * (1 + 3 * (N / d) * (tw / tf) ** 1.5) * sqrt(E * Fy * tf / tw);
    else WC = 0.4 * tw ** 2 * (1 + (4 * N / d - 0.2) * (tw / tf) ** 1.5) * sqrt(E * Fy * tf / tw);
    WC /= 2;
    const l = lFt * 12, ratio = (h / tw) / (l / bf);
    const WSB = ratio <= 2.3 ? (480000 * tf * tw ** 3 / h ** 2) * (1 + 0.4 * ratio ** 3) / 1.76 : null;
    const sr = { WLY: Ru / WLY, WC: Ru / WC, WSB: WSB === null ? null : Ru / WSB };
    return { Ru, ...sr, max: xmax(sr.WLY, sr.WC, sr.WSB), ok: xmax(sr.WLY, sr.WC, sr.WSB) <= 1 };
  }

  /* ---------------- MB sheet: one mezzanine beam ---------------- */
  // p: {dead, coll, live, joistWt (psf), L, Lb, trib (ft), sec (BU dims), Fy (55), Fu (70)}
  function beamCheck(p, WFDB) {
    const Fy = p.Fy ?? 55, Fu = p.Fu ?? 70, E = 29000;
    const D11 = p.dead + p.coll, D12 = p.live, D14 = p.joistWt;
    const ed = p.edition || '15';
    const probe = analyze(p.sec, { Fy, Fyf: Fy, Fyw: Fy, Fu, E }, { Lbx: p.L, Lby: p.Lb, edition: ed }, {}, WFDB);
    const D19 = p.trib * D14 / 1000, D20 = probe.Wt / 1000, D21 = p.trib * D11 / 1000, D22 = p.trib * D12 / 1000;
    const D23 = D19 + D20 + D21 + D22;
    const wD = D19 + D20 + D21, L = p.L;
    const H6 = wD * L / 2, H8 = wD * L * L / 8, H10 = D22 * L / 2, H12 = D22 * L * L / 8, H14 = D23 * L / 2, H16 = D23 * L * L / 8;
    const I = probe.Ix, L4 = (L * 12) ** 4;
    const dDL = 5 * wD * L4 / (384 * E * I * 12), dLL = 5 * D22 * L4 / (384 * E * I * 12), dTL = 5 * D23 * L4 / (384 * E * I * 12);
    const Vx = H6 + H10, Mx = H8 + H12, Pa = p.axial || 0;
    const res = analyze(p.sec, { Fy, Fyf: Fy, Fyw: Fy, Fu, E }, { Lbx: L, Lby: p.Lb, edition: ed }, { Pa: ed === '13' ? 0 : Pa, Vx, Mx }, WFDB);
    const Ru = (D11 + D14 + D12) * p.Lb * p.trib / 1000;
    const conc = p.sec.type === 'BU' && ed !== '13' ? concCheck(res, Ru, 2.5, p.Lb * 12, p.Lb, Fy, E) : null; // 13th MB sheet has no L7 check
    const defl = { DL: dDL, LL: dLL, TL: dTL, rDL: L * 12 / dDL, rLL: L * 12 / dLL, rTL: L * 12 / dTL };
    const desc = p.sec.type === 'WF' ? p.sec.name : 'BU' + Math.round(p.sec.d) + 'x' + String(Math.round(res.Wt)).padStart(2, '0');
    return {
      desc, res, conc, defl,
      w: { joist: D19, beam: D20, FDL: D21, FLL: D22, total: D23 },
      V: { D: H6, L: H10, T: H14 }, M: { D: H8, L: H12, T: H16 },
      llOK: defl.rLL >= 360, tlOK: defl.rTL >= 240, // MB sheet flags (<360, <240 warn)
      strengthOK: res.maxSR <= 1, // Main Report: NG when MAX(G47:G49) > 1
      // MB!G19 / G20 strings: NG when SR >= 1, value shown via ROUND(SR,2)
      combinedText: isFinite(res.CSR) ? 'COMBINED ' + (res.CSR >= 1 ? 'NG' : 'OK') + ' (SR = ' + xround(res.CSR, 2) + ')' : '#VALUE! (section invalid: NG)',
      shearText: isFinite(res.SRvx) ? 'SHEAR ' + (res.SRvx >= 1 ? 'NG' : 'OK') + ' (SR = ' + xround(res.SRvx, 2) + ')' : '#VALUE! (section invalid: NG)',
    };
  }

  /* ---------------- Column sheet: independent mezzanine column ---------------- */
  // p: {sec, Fy, Fu, L (ft), Lby (in), DL_L, LL_L, DL_R, LL_R}
  function columnCheck(p, WFDB) {
    const Fy = p.Fy, Fu = p.Fu, E = 29000;
    const probe = analyze(p.sec, { Fy, Fyf: Fy, Fyw: Fy, Fu, E }, { Lbx: p.L, Lby: p.Lby / 12 }, {}, WFDB);
    const ex = probe.d / 2, wt = probe.Wt * p.L / 1000;
    const combos = [
      { name: 'DLₗ+LLₗ+DR', LL: p.LL_L, LR: 0 },
      { name: 'DLₗ+DR+LR', LL: 0, LR: p.LL_R },
      { name: 'Full both sides', LL: p.LL_L, LR: p.LL_R },
    ].map(c => {
      const Mx = ((c.LL - c.LR) + (p.DL_L - p.DL_R)) * ex / 12;
      const P = (c.LL + c.LR) + (p.DL_L + p.DL_R + wt);
      const r = analyze(p.sec, { Fy, Fyf: Fy, Fyw: Fy, Fu, E }, { Lbx: p.L, Lby: p.Lby / 12 }, { Pa: P, Mx }, WFDB);
      const csr = Math.max(r.CSR, r.SRvx, r.SRvy);
      const okText = csr < (p.ASR ?? 1) ? 'OK' : 'NG';           // Column!C39: IF(C40<ASR,"OK","NG")
      return { ...c, Mx, P, r, csr, okText, ok: okText === 'OK' && r.F13_2 && r.F13_34 };
    });
    return { ex, wt, Wt: probe.Wt, d: probe.d, combos, max: Math.max(...combos.map(c => c.csr)), ok: combos.every(c => c.ok) };
  }

  const api = { analyze, beamCheck, columnCheck, concCheck, xmin, xmax };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ = api;
})(typeof self !== 'undefined' ? self : this);
