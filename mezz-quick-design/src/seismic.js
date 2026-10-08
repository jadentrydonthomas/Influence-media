/* Seismic loads for a metal building with mezzanines — ASCE 7 equivalent lateral force procedure (12.8), done the
   way NBG's "IBC Seismic" workbook (rev. 2021.01.20) does it:
     · one LATERAL calculation per frame: the frame's bay of roof, its sidewalls (an end frame also its endwall) and
       the mezzanine area tributary to it, distributed over height (12.8.3). The mezzanine row is the concentrated
       seismic load the frame gets at the mezzanine level (EQR / EQL in NBG Frame).
     · one LONGITUDINAL calculation for the bracing: the whole building.
   ASCE 7-05 / 7-10 / 7-16 by the building code (IBC 2006–2021). Site class E / F, ASCE 7-22 and anything the
   workbook would send to "See ASCE 7" come back flagged, not guessed.
   Units: ft, psf, lb for weights, kips for forces, ft-kips for moments. */
(function (root) {
  'use strict';

  // ---------- site coefficients (ASCE 7 Tables 11.4-1 / 11.4-2; 7-16 as amended by Supplement 1) ----------
  // columns: Ss 0.25 0.5 0.75 1.0 1.25 1.5  /  S1 0.1 0.2 0.3 0.4 0.5 0.6 ; null = site-specific ("*")
  const SS_COLS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5], S1_COLS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const FA = {
    old: { A: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], B: [1, 1, 1, 1, 1, 1], C: [1.2, 1.2, 1.1, 1, 1, 1], D: [1.6, 1.4, 1.2, 1.1, 1, 1], E: [2.5, 1.7, 1.2, 0.9, 0.9, 0.9], F: [null, null, null, null, null, null] },
    16: { A: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], B: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9], C: [1.3, 1.3, 1.2, 1.2, 1.2, 1.2], D: [1.6, 1.4, 1.2, 1.2, 1.2, 1.2], E: [2.4, 1.7, 1.3, null, null, null], F: [null, null, null, null, null, null] },
  };
  const FV = {
    old: { A: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], B: [1, 1, 1, 1, 1, 1], C: [1.7, 1.6, 1.5, 1.4, 1.3, 1.3], D: [2.4, 2, 1.8, 1.6, 1.5, 1.5], E: [3.5, 3.2, 2.8, 2.4, 2.4, 2.4], F: [null, null, null, null, null, null] },
    16: { A: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], B: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], C: [1.5, 1.5, 1.5, 1.5, 1.5, 1.4], D: [2.4, 2.2, 2.0, 1.9, 1.8, 1.7], E: [4.2, null, null, null, null, null], F: [null, null, null, null, null, null] },
  };
  // the workbook's bracket columns (0-based): lower / upper; equal at the ends, so no extrapolation
  const ssLo = s => (s <= 0.25 ? 0 : s < 0.5 ? 0 : s < 0.75 ? 1 : s < 1 ? 2 : s < 1.25 ? 3 : s < 1.5 ? 4 : 5);
  const ssHi = s => (s <= 0.25 ? 0 : s < 0.5 ? 1 : s < 0.75 ? 2 : s < 1 ? 3 : s < 1.25 ? 4 : 5);
  const s1Lo = s => (s <= 0.1 ? 0 : s < 0.2 ? 0 : s < 0.3 ? 1 : s < 0.4 ? 2 : s < 0.5 ? 3 : s < 0.6 ? 4 : 5);
  const s1Hi = s => (s <= 0.1 ? 0 : s < 0.2 ? 1 : s < 0.3 ? 2 : s < 0.4 ? 3 : s < 0.5 ? 4 : 5);
  function interp(row, cols, v, lo, hi) {
    const a = row[lo], b = row[hi];
    if (a == null || b == null) return null;
    return a === b ? a : a - (a - b) * ((v - cols[lo]) / (cols[hi] - cols[lo]));
  }

  // building code → ASCE 7 edition and the workbook's code number (1 IBC 2006 … 7 IBC 2021)
  function editionOf(codeText) {
    const t = String(codeText || '');
    const asce = t.match(/ASCE\s*7\s*-\s*(\d{2})/i), ibc = t.match(/IBC\s*(\d{4})/i);
    const yr = ibc ? +ibc[1] : null;
    let ed = asce ? `7-${asce[1]}` : yr >= 2024 ? '7-22' : yr >= 2018 ? '7-16' : yr >= 2012 ? '7-10' : yr ? '7-05' : null;
    if (!ed) return { ed: '7-16', choice: 7, assumed: true, note: 'No ASCE 7 edition or IBC year on the code line — ASCE 7-16 assumed.' };
    const choice = ed === '7-05' ? (yr === 2006 ? 1 : 2) : ed === '7-10' ? (yr === 2012 ? 3 : 5) : ed === '7-16' ? (yr === 2018 ? 6 : 7) : null;
    return { ed, choice, note: ed === '7-22' ? 'ASCE 7-22: SDS and SD1 come from the ASCE Hazard Tool (multi-period spectrum, no Fa / Fv); the NBG workbook (rev. 2021.01.20) stops at IBC 2021 — enter SDS / SD1 and confirm.' : null };
  }

  const IE = { I: 1, II: 1, III: 1.25, IV: 1.5 };
  const catSds = (sds, rc) => (rc === 'IV' ? (sds < 0.167 ? 'A' : sds < 0.33 ? 'C' : 'D') : sds < 0.167 ? 'A' : sds < 0.33 ? 'B' : sds < 0.5 ? 'C' : 'D');
  const catSd1 = (sd1, rc) => (rc === 'IV' ? (sd1 < 0.067 ? 'A' : sd1 < 0.133 ? 'C' : 'D') : sd1 < 0.067 ? 'A' : sd1 < 0.133 ? 'B' : sd1 < 0.2 ? 'C' : 'D');

  /* Design spectral values and the seismic design category.
     s: { ed, Ss, S1, siteClass, risk ('I'…'IV'), SDS?, SD1? (7-22, or to override) } */
  function design(s) {
    const ed = s.ed || '7-16', rc = s.risk || 'II', sc = String(s.siteClass || 'D').toUpperCase();
    const out = { ed, risk: rc, siteClass: sc, Ie: IE[rc] ?? 1, Ss: s.Ss, S1: s.S1, flags: [] };
    if (ed === '7-22' || (s.SDS != null && s.SD1 != null)) {
      if (s.SDS == null || s.SD1 == null) { out.flags.push('ASCE 7-22: enter SDS and SD1 from the ASCE Hazard Tool.'); return { ...out, ok: false }; }
      Object.assign(out, { Fa: null, Fv: null, SMS: 1.5 * s.SDS, SM1: 1.5 * s.SD1, SDS: s.SDS, SD1: s.SD1, given: true });
    } else {
      const tbl = ed === '7-16' ? 16 : 'old';
      const Fa = FA[tbl][sc] ? interp(FA[tbl][sc], SS_COLS, s.Ss, ssLo(s.Ss), ssHi(s.Ss)) : null;
      const Fv = FV[tbl][sc] ? interp(FV[tbl][sc], S1_COLS, s.S1, s1Lo(s.S1), s1Hi(s.S1)) : null;
      if (Fa == null || Fv == null) { out.flags.push(`Site Class ${sc} at Ss ${s.Ss} / S1 ${s.S1}: site-specific ground motion (ASCE 7 11.4.8) — "See ASCE 7" in the workbook.`); return { ...out, Fa, Fv, ok: false }; }
      Object.assign(out, { Fa, Fv, SMS: s.Ss * Fa, SM1: s.S1 * Fv });
      out.SDS = (2 / 3) * out.SMS; out.SD1 = (2 / 3) * out.SM1;
    }
    out.sdsCat = catSds(out.SDS, rc); out.sd1Cat = catSd1(out.SD1, rc);
    out.SDC = s.S1 >= 0.75 ? (rc === 'IV' ? 'F' : 'E') : out.sdsCat > out.sd1Cat ? out.sdsCat : out.sd1Cat;
    out.rho = /[DEF]/.test(out.SDC) ? 1.3 : 1;
    out.ok = true;
    return out;
  }

  // ---------- seismic force-resisting systems (ASCE 7 Table 12.2-1) and period parameters (Table 12.8-2) ----------
  const SFRS = {
    'Steel Systems Not Detailed for Seismic': [3, 3, 3],
    'Ordinary Steel Moment Frames': [3.5, 3, 3],
    'Intermediate Steel Moment Frames': [4.5, 3, 4],
    'Special Steel Moment Frames': [8, 3, 5.5],
    'Ordinary Steel Concentrically Braced Frames': [3.25, 2, 3.25],
    'Special Steel Concentrically Braced Frames': [6, 2, 5],
    'Steel Buckling Restrained Braced Frames': [8, 2.5, 5],
    'Steel Eccentrically Braced Frames': [8, 2, 4],
    'Cantilevered Column Systems Conforming to OMF': [1.25, 1.25, 1.25],
  };
  const PERIOD = { moment: [0.028, 0.8], other: [0.02, 0.75], ebf: [0.03, 0.75], brbf: [0.03, 0.75] };
  const TYPES = ['Rigid Frame', 'Portal Frame', 'Post & Beam', 'X-Bracing', 'Fixed Base', 'Rigid Frame (IMF)', 'Rigid Frame (SMF)', 'Post & Beam (SCBF)', 'X-Bracing (SCBF)', 'BRBF', 'EBF'];
  /* type: NBG framing type; "not detailed for seismic" is used in SDC A–C unless ignoreNDFS */
  function system(type, SDC, ignoreNDFS = false) {
    const low = /[ABC]/.test(SDC) && !ignoreNDFS;
    let name, per;
    switch (type) {
      case 'Post & Beam': case 'X-Bracing': name = low ? 'Steel Systems Not Detailed for Seismic' : 'Ordinary Steel Concentrically Braced Frames'; per = 'other'; break;
      case 'Rigid Frame': case 'Portal Frame': name = low ? 'Steel Systems Not Detailed for Seismic' : 'Ordinary Steel Moment Frames'; per = 'moment'; break;
      case 'Fixed Base': name = 'Cantilevered Column Systems Conforming to OMF'; per = 'other'; break;
      case 'Post & Beam (SCBF)': case 'X-Bracing (SCBF)': name = 'Special Steel Concentrically Braced Frames'; per = 'other'; break;
      case 'BRBF': name = 'Steel Buckling Restrained Braced Frames'; per = 'brbf'; break;
      case 'EBF': name = 'Steel Eccentrically Braced Frames'; per = 'ebf'; break;
      case 'Rigid Frame (IMF)': case 'Portal Frame (IMF)': name = 'Intermediate Steel Moment Frames'; per = 'moment'; break;
      case 'Rigid Frame (SMF)': case 'Portal Frame (SMF)': name = 'Special Steel Moment Frames'; per = 'moment'; break;
      default: return null;
    }
    const [R, Omega, Cd] = SFRS[name], [Ct, x] = PERIOD[per];
    return { type, name, R, Omega, Cd, Ct, x, ndfs: name === 'Steel Systems Not Detailed for Seismic' };
  }
  // Box 5 frame type → NBG framing type for the lateral sheet
  // ("Post and Beam Multi Span - EMS", "Post & Beam", "P&B"; rigid, clear span, multi span, lean-to frames are moment frames)
  const frameType = t => (/post\s*(?:&|and)?\s*beam|\bp\s*&\s*b\b/i.test(String(t || '')) ? 'Post & Beam' : 'Rigid Frame');

  const Ta = (Ct, x, hn) => Ct * Math.pow(hn, x);                                     // Eq. 12.8-7
  const kExp = (T, vertical) => (!vertical ? 0 : T <= 0.5 ? 1 : T >= 2.5 ? 2 : 1 + (T - 0.5) / 2);   // 12.8.3

  /* Seismic response coefficient Cs (12.8.1.1), as the workbook's calcCs: TL = 4 s.
     d: design(); R, Ie, T; irregular */
  function Cs(d, R, T, irregular = false, TL = 4) {
    const Ie = d.Ie, ed = d.ed, RI = R / Ie;
    let Sds = d.given ? d.SDS : (2 / 3) * d.Fa * d.Ss;
    const Sd1 = d.given ? d.SD1 : (2 / 3) * d.Fv * d.S1;
    let note = null;
    if (ed === '7-05' || ed === '7-10') {
      if (d.Ss > 1.5 && T <= 0.5 && (ed === '7-05' || !irregular)) { Sds = (2 / 3) * d.Fa * 1.5; note = 'Ss capped at 1.5 for T ≤ 0.5 s (12.8.1.3)'; }
    } else if (!irregular && T < 0.5 && d.rho === 1 && d.siteClass !== 'E' && d.siteClass !== 'F' && Ie <= 1) {
      const cap = Math.min(Sds, Math.max(1, 0.7 * Sds));
      if (cap < Sds) note = 'SDS capped at max(1.0, 0.7 SDS) for regular, T < 0.5 s (12.8.1.3)';
      Sds = cap;
    }
    const basic = Sds / RI;                                                            // 12.8-2
    const max = T <= TL ? Sd1 / (T * RI) : (Sd1 * TL) / (T * T * RI);                  // 12.8-3 / -4
    const min = ed === '7-05' ? (d.S1 >= 0.6 ? Math.max(0.01, (0.5 * d.S1) / RI) : 0.01)
      : d.S1 >= 0.6 ? Math.max(0.01, 0.044 * Sds * Ie, (0.5 * d.S1) / RI) : Math.max(0.01, 0.044 * Sds * Ie);   // 12.8-5 / -6
    let cs = d.SDC === 'A' ? 0.01 : Math.min(Math.max(min, basic), max);
    let governs = d.SDC === 'A' ? 'SDC A: 0.01 (11.7)' : cs === max ? 'Eq. 12.8-3 (maximum)' : cs === min && min > basic ? 'Eq. 12.8-5 / -6 (minimum)' : 'Eq. 12.8-2';
    // 7-16 11.4.8 exception: Site Class D, T > 1.5 Ts → Cs not less than 1.5 × the 12.8-3 value
    if (ed === '7-16' && d.siteClass === 'D' && T > 1.5 * (Sd1 / Sds)) {
      const v = Math.max(1.5 * max, cs);
      if (v > cs) governs = '11.4.8 exception: 1.5 × Eq. 12.8-3';
      cs = v;
    }
    return { Cs: cs, basic, max, min, SdsUsed: Sds, Sd1, governs, note };
  }

  // ---------- geometry (workbook convention: the BSW is the "left" / high eave; slope and ridge from the BSW) ----------
  /* g: { width, length, rooftype ('Gable' | 'Single Slope'), dtr (from BSW), slope (s:12 to BSW), leh (FSW eave), heh (BSW eave) } */
  function meanRoofHeight(g) {
    if (g.rooftype === 'Gable' && g.dtr > 0 && g.dtr < g.width) {
      const th = Math.atan(g.slope / 12), peak = g.heh + g.dtr * Math.tan(th);
      const la = (peak + g.heh) / 2, lA = g.dtr / Math.cos(th);
      const ra = (peak + g.leh) / 2, rA = (g.width - g.dtr) / Math.cos(Math.atan((peak - g.leh) / (g.width - g.dtr)));
      return (la * lA + ra * rA) / (lA + rA);
    }
    return (g.leh + g.heh) / 2;
  }
  const ridgeHeight = g => (g.dtr < g.width ? g.heh + (g.slope / 12) * g.dtr : g.heh);
  const oppSlope = g => (g.dtr < g.width ? ((g.heh + (g.slope / 12) * g.dtr) - g.leh) * 12 / (g.width - g.dtr) : g.slope);
  function widthOnSlope(g) {
    return g.dtr / Math.cos(Math.atan(g.slope / 12)) + (g.width - g.dtr) / Math.cos(Math.atan(oppSlope(g) / 12));
  }
  /* roof seismic weight of a strip L long (lb): (SW + RDL + CDL [+ 0.2 Pf when Pf > 30]) on the sloped area + point loads */
  function roofWeight(g, L, roof) {
    const wos = widthOnSlope(g), q = roof.SW + roof.RSW + roof.RDL + roof.CDL;
    const uni = roof.Pf > 30 ? q + 0.2 * roof.Pf * (g.width / wos) : q;
    return { W: L * wos * uni + (roof.P || 0) * 1000, wos, q: uni, snow: roof.Pf > 30 };
  }
  // endwall area (full height, no parapet)
  function endwallArea(g) {
    const rh = ridgeHeight(g);
    return g.dtr < g.width ? g.leh * g.width + (rh - g.leh) / 2 * (g.width - g.dtr) + (g.heh - g.leh) * g.dtr + (rh - g.heh) / 2 * g.dtr
      : g.leh * g.width + (rh - g.leh) / 2 * g.width;
  }
  // centre of mass of an endwall (bottom at bot), as the workbook's ftnWall_CenterOfMass
  function endwallCOM(g, bot = 0) {
    const W = g.width, D = g.dtr, s = g.slope;
    let a1, a2, a3, a4, d1, d2, d3, d4;
    if (D < W) {
      const os = oppSlope(g);
      a1 = (s * D * D) / 24; a2 = (g.heh - bot) * D; a3 = (os * (W - D) * (W - D)) / 24; a4 = (g.leh - bot) * (W - D);
      d1 = (s * D) / 36 + g.heh; d2 = (g.heh - bot) / 2 + bot; d3 = (os * (W - D)) / 36 + g.leh; d4 = (g.leh - bot) / 2 + bot;
    } else {
      a1 = (s * W * W) / 24; a2 = 0; a3 = 0; a4 = (g.leh - bot) * W;
      d1 = (s * W) / 36 + g.leh; d2 = 0; d3 = 0; d4 = (g.leh - bot) / 2 + bot;
    }
    return (a1 * d1 + a2 * d2 + a3 * d3 + a4 * d4) / (a1 + a2 + a3 + a4);
  }

  /* effective seismic weight of a mezzanine strip (lb): conc kips + area × (FDL + FLC + FLJ + 25 % FLL if storage + FLP),
     ASCE 7 12.7.2 (storage: 25 % of the floor live; partitions: the partition load) */
  function mezzWeight(m, area) {
    const psf = m.FDL + m.FLC + m.FLJ + (m.storage ? 0.25 * m.FLL : 0) + (m.FLP || 0) + (m.framing || 0);
    return { W: (m.conc || 0) * 1000 + area * psf, psf };
  }

  // vertical distribution (12.8.3): Fx = Cvx V; SDC A: 1 % of each weight (11.7)
  function distribute(rows, cs, k, SDC) {
    const live = rows.filter(r => r.W > 0);
    live.forEach(r => { r.D = r.W * Math.pow(r.h, k); });
    const Wt = live.reduce((a, r) => a + r.W, 0), Dt = live.reduce((a, r) => a + r.D, 0);
    live.forEach(r => { r.Cvx = r.D / Dt; r.Fx = SDC === 'A' ? (0.01 * r.W) / 1000 : (cs * Wt * r.Cvx) / 1000; r.M = r.Fx * r.h; });
    const V = live.reduce((a, r) => a + r.Fx, 0);
    return { rows: live, W: Wt, Dt, V, M: live.reduce((a, r) => a + r.M, 0) };
  }

  /* Building limits for the system (ASCE 7 Table 12.2-1, 12.2.5.6 / 12.2.5.7), as the workbook flags them.
     deadPsf: roof SW+RDL+CDL (+ point loads over the plan); story: a mezzanine counted as a story */
  function limits(type, SDC, ed, hn, deadPsf, story, walls = {}) {
    const code = `ASCE ${ed}`, high = walls.above35over20, any = walls.over20;
    const msg = sec => `Building height / weight exceeds the limits of ${code} ${sec} for the ${type} system.`;
    if (/^(Post & Beam|X-Bracing)$/.test(type)) {
      if (/[ABC]/.test(SDC)) return null;
      if (/[DE]/.test(SDC)) return (deadPsf <= 20 && hn <= 60 && !story) || hn <= 35 ? null : msg('Table 12.2-1');
      return deadPsf <= 20 && hn <= 60 && !story ? null : msg('Table 12.2-1');
    }
    if (/^(Rigid Frame|Portal Frame)$/.test(type)) {
      if (/[ABC]/.test(SDC)) return null;
      if (/[DE]/.test(SDC)) return deadPsf <= 20 && hn <= 65 && !high && !story ? null : msg('12.2.5.6.1');
      return deadPsf <= 20 && hn <= 65 && !any && !story ? null : msg('12.2.5.6.2');
    }
    return null;
  }

  /* ---------- LATERAL: one frame ----------
     j: { d: design(), g: geometry, roof: {SW, RSW, RDL, CDL, Pf, P}, walls: {fsw, bsw, lew, rew (psf)},
          vertical (12.8.3 on), irregular, ignoreNDFS, story }
     f: { label, type (NBG framing type), bay (tributary width), at: 'lew' | 'rew' | 'interior',
          mezz: [{ id, area, conc, elev, FDL, FLC, FLJ, FLL, storage, FLP, framing }] } */
  function lateral(j, f) {
    const { d, g } = j, sys = system(f.type, d.SDC, j.ignoreNDFS), hn = meanRoofHeight(g);
    // Risk Category III / IV or a rigid diaphragm: the least R of the building's lateral systems (12.2.3.3)
    const R = (d.risk === 'III' || d.risk === 'IV' || j.rigid) && j.Rmin ? j.Rmin : sys.R;
    const T = j.Ta ?? Ta(sys.Ct, sys.x, hn), k = kExp(T, j.vertical !== false), c = Cs(d, R, T, j.irregular);
    const rw = roofWeight(g, f.bay, j.roof);
    const rows = [{ key: 'roof', name: 'Roof', W: rw.W, h: hn }];
    if (f.at === 'lew' || f.at === 'rew') {
      const wt = f.at === 'lew' ? j.walls.lew : j.walls.rew;
      rows.push({ key: 'endwall', name: f.at === 'lew' ? 'Left endwall' : 'Right endwall', W: endwallArea(g) * wt, h: endwallCOM(g) });
    }
    rows.push({ key: 'fsw', name: 'Front sidewall', W: g.leh * j.walls.fsw * f.bay, h: g.leh / 2 });
    rows.push({ key: 'bsw', name: 'Back sidewall', W: g.heh * j.walls.bsw * f.bay, h: g.heh / 2 });
    (f.mezz || []).forEach(m => { const mw = mezzWeight(m, m.area); rows.push({ key: 'mezz', id: m.id, name: m.id, W: mw.W, psf: mw.psf, area: m.area, h: m.elev }); });
    const dist = distribute(rows, c.Cs, k, d.SDC);
    const sum = keys => dist.rows.filter(r => keys.includes(r.key)).reduce((a, r) => a + r.M, 0);
    // what NBG Frame takes: the roof seismic weight that reproduces the roof (+ endwall) moment with factor Cs, the
    // sidewalls as concentrated loads at eave − 16", the mezzanine as concentrated loads at its elevation; or
    // ("alt.") everything but the mezzanine lumped into the roof weight
    const base = g.width * f.bay * c.Cs;
    const roofOverride = (sum(['roof', 'endwall']) * 1000) / (hn * base);
    const altRoof = (sum(['roof', 'endwall', 'fsw', 'bsw']) * 1000) / (hn * base);
    const wallLoads = [['fsw', g.leh], ['bsw', g.heh]].map(([key, e]) => ({ key, F: sum([key]) / (e - 16 / 12), at: e - 16 / 12 }));
    const mezzLoads = dist.rows.filter(r => r.key === 'mezz').map(r => ({ id: r.id, F: r.Fx, at: r.h, W: r.W, area: r.area, psf: r.psf }));
    const frameV = wallLoads.reduce((a, w) => a + w.F, 0) + mezzLoads.reduce((a, m) => a + m.F, 0) + (roofOverride * base) / 1000;
    const deadPsf = j.roof.SW + j.roof.RSW + j.roof.RDL + j.roof.CDL + ((j.roof.P || 0) * 1000) / (g.length * g.width);
    return { label: f.label, sys, R, hn, Ta: T, k, cs: c, rows: dist.rows, W: dist.W, V: dist.V, M: dist.M, roof: rw, roofOverride, altRoof, wallLoads, mezzLoads, frameV,
      limit: limits(f.type, d.SDC, d.ed, hn, deadPsf, j.story, j.wallLimits) };
  }

  /* ---------- LONGITUDINAL: the bracing (whole building) ----------
     j as lateral; b: { types: [FSW type, BSW type] ('X-Bracing' | 'Portal Frame' …), mezz: [{ …, area = full area }],
     torsion: 1 (flexible / none) or 1.1 (rigid mezzanine diaphragm) } */
  function longitudinal(j, b) {
    const { d, g } = j, hn = meanRoofHeight(g);
    const sy = (b.types || ['X-Bracing', 'X-Bracing']).map(t => system(t, d.SDC, j.ignoreNDFS));
    // the least R governs (12.2.3.3); its period, or the least of the two when R ties
    const sys = sy[0].R <= sy[1].R ? sy[0] : sy[1];
    const T = j.TaLong ?? (sy[0].R === sy[1].R ? Math.min(Ta(sy[0].Ct, sy[0].x, hn), Ta(sy[1].Ct, sy[1].x, hn)) : Ta(sys.Ct, sys.x, hn));
    const k = kExp(T, j.vertical !== false), c = Cs(d, sys.R, T, j.irregular);
    const rows = [{ key: 'roof', name: 'Roof', W: roofWeight(g, g.length, j.roof).W, h: hn },
      { key: 'lew', name: 'Left endwall', W: endwallArea(g) * j.walls.lew, h: endwallCOM(g) },
      { key: 'rew', name: 'Right endwall', W: endwallArea(g) * j.walls.rew, h: endwallCOM(g) },
      { key: 'fsw', name: 'Front sidewall', W: g.leh * j.walls.fsw * g.length, h: g.leh / 2 },
      { key: 'bsw', name: 'Back sidewall', W: g.heh * j.walls.bsw * g.length, h: g.heh / 2 }];
    (b.mezz || []).forEach(m => { const mw = mezzWeight(m, m.area); rows.push({ key: 'mezz', id: m.id, name: m.id, W: mw.W, psf: mw.psf, area: m.area, h: m.elev }); });
    const dist = distribute(rows, c.Cs, k, d.SDC), tor = b.torsion || 1;
    const fx = key => dist.rows.filter(r => r.key === key).reduce((a, r) => a + r.M, 0);
    const wallLoads = [['fsw', g.leh], ['bsw', g.heh]].map(([key, e]) => ({ key, F: fx(key) / e, at: e }));
    const mezzLoads = dist.rows.filter(r => r.key === 'mezz').map(r => ({ id: r.id, F: r.Fx * tor, at: r.h, W: r.W, area: r.area, psf: r.psf }));
    const roofPsf = (fx('roof') + fx('lew') + fx('rew')) * 1000 / (hn * g.width * g.length * c.Cs);
    return { sys, systems: sy, hn, Ta: T, k, cs: c, rows: dist.rows, W: dist.W, V: dist.V, M: dist.M, wallLoads, mezzLoads, roofPsf, torsion: tor,
      bracingV: wallLoads.reduce((a, w) => a + w.F, 0) + mezzLoads.reduce((a, m) => a + m.F, 0) + (roofPsf * g.width * g.length * c.Cs / 1000) * (j.roofTorsion || 1) };
  }

  const api = { editionOf, design, system, frameType, Ta, kExp, Cs, meanRoofHeight, widthOnSlope, roofWeight, endwallArea, endwallCOM, mezzWeight, distribute, limits, lateral, longitudinal, TYPES, SFRS, IE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_SEISMIC = api;
})(typeof self !== 'undefined' ? self : this);
