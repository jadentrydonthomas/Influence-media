/* Seismic loads for a metal building with mezzanines — ASCE 7 equivalent lateral force procedure (12.8), done the way
   NBG Design Calcs (the Seismic module) does it, section by section as it is typed in:
     1. Building data: code (ASCE 7-05 / 7-10 / 7-16 / 7-22), gable or single slope, width, length, ridge, slopes, eaves.
     2. Seismic data: risk category, Ss, S1 (7-22: SMS and SM1 from the hazard tool), site class, roof and mezzanine
        diaphragms, "not detailed for seismic" in SDC A–C, "significant mezzanine exists" (the vertical distribution,
        12.8.3), irregularities, accidental torsion (12.8.4.2).
     3. Roof loading, walls (full height or partial height hardwall, parapet, self-supporting shear wall), partitions.
     4. Mezzanine loads (elevation, floor dead, collateral, joist weight, 25 % of the floor live for storage, partitions)
        and crane loads.
     5. Force resisting systems: each lateral frame line (its tributary roof, sidewalls, an endwall at an end frame, a
        partition, its share of each mezzanine and crane) and the longitudinal calculation for the bracing.
   What NBG Frame and NBG Bracing take comes out of each calculation: the roof seismic weight (psf) and seismic factor,
   and the concentrated seismic loads (sidewalls, mezzanines, cranes). Verified against NBG's validation examples
   (oracle/nbg_seismic.js) value by value. Units: ft, psf, lb for weights, kips for forces, ft-kips for moments. */
(function (root) {
  'use strict';

  // ---------- site coefficients (ASCE 7 Tables 11.4-1 / 11.4-2) ----------
  // columns: Ss 0.25 0.5 0.75 1.0 1.25 1.5  /  S1 0.1 0.2 0.3 0.4 0.5 0.6 ; null = site-specific ("*")
  // 7-16: Site Class D as amended by Supplement 1; Site Class E as first published, its Fa at Ss ≥ 1.0 taken equal to
  // Site Class C's (11.4.8 exception 1) — as NBG Design Calcs takes them
  const SS_COLS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5], S1_COLS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const FA = {
    old: { A: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], B: [1, 1, 1, 1, 1, 1], C: [1.2, 1.2, 1.1, 1, 1, 1], D: [1.6, 1.4, 1.2, 1.1, 1, 1], E: [2.5, 1.7, 1.2, 0.9, 0.9, 0.9], F: [null, null, null, null, null, null] },
    16: { A: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], B: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9], C: [1.3, 1.3, 1.2, 1.2, 1.2, 1.2], D: [1.6, 1.4, 1.2, 1.2, 1.2, 1.2], E: [2.4, 1.7, 1.3, 1.2, 1.2, 1.2], F: [null, null, null, null, null, null] },
  };
  const FV = {
    old: { A: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], B: [1, 1, 1, 1, 1, 1], C: [1.7, 1.6, 1.5, 1.4, 1.3, 1.3], D: [2.4, 2, 1.8, 1.6, 1.5, 1.5], E: [3.5, 3.2, 2.8, 2.4, 2.4, 2.4], F: [null, null, null, null, null, null] },
    16: { A: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], B: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8], C: [1.5, 1.5, 1.5, 1.5, 1.5, 1.4], D: [2.4, 2.2, 2.0, 1.9, 1.8, 1.7], E: [4.2, 3.3, 2.8, 2.4, 2.2, 2.0], F: [null, null, null, null, null, null] },
  };
  // linear interpolation between the bracketing columns, flat beyond the ends
  function interp(row, cols, v) {
    if (v <= cols[0]) return row[0];
    if (v >= cols[cols.length - 1]) return row[row.length - 1];
    const i = cols.findIndex(c => c >= v), lo = v === cols[i] ? i : i - 1, hi = i;
    const a = row[lo], b = row[hi];
    if (a == null || b == null) return null;
    return lo === hi ? a : a + (b - a) * ((v - cols[lo]) / (cols[hi] - cols[lo]));
  }
  const TWO_THIRDS = 0.6667;   // NBG Design Calcs: SDS = 0.6667 SMS, SD1 = 0.6667 SM1

  // building code → ASCE 7 edition and the workbook's code number (1 IBC 2006 … 7 IBC 2021)
  function editionOf(codeText) {
    const t = String(codeText || '');
    const asce = t.match(/ASCE\s*7\s*-\s*(\d{2})/i), ibc = t.match(/IBC\s*(\d{4})/i);
    const yr = ibc ? +ibc[1] : null;
    let ed = asce ? `7-${asce[1]}` : yr >= 2024 ? '7-22' : yr >= 2018 ? '7-16' : yr >= 2012 ? '7-10' : yr ? '7-05' : null;
    if (!ed) return { ed: '7-16', choice: 7, assumed: true, note: 'No ASCE 7 edition or IBC year on the code line — ASCE 7-16 assumed.' };
    const choice = ed === '7-05' ? (yr === 2006 ? 1 : 2) : ed === '7-10' ? (yr === 2012 ? 3 : 5) : ed === '7-16' ? (yr === 2018 ? 6 : 7) : null;
    return { ed, choice, note: ed === '7-22' ? 'ASCE 7-22: SMS and SM1 come from the ASCE Hazard Tool (multi-period spectrum, no Fa / Fv) — from the PCS when it lists them; SDS = 0.6667 SMS, SD1 = 0.6667 SM1.' : null };
  }

  const IE = { I: 1, II: 1, III: 1.25, IV: 1.5 };
  const catSds = (sds, rc) => (rc === 'IV' ? (sds < 0.167 ? 'A' : sds < 0.33 ? 'C' : 'D') : sds < 0.167 ? 'A' : sds < 0.33 ? 'B' : sds < 0.5 ? 'C' : 'D');
  const catSd1 = (sd1, rc) => (rc === 'IV' ? (sd1 < 0.067 ? 'A' : sd1 < 0.133 ? 'C' : 'D') : sd1 < 0.067 ? 'A' : sd1 < 0.133 ? 'B' : sd1 < 0.2 ? 'C' : 'D');

  /* Design spectral values and the seismic design category.
     s: { ed, Ss, S1, siteClass, risk ('I'…'IV'), SMS?, SM1? (7-22, from the hazard tool), SDS?, SD1? (to override) } */
  function design(s) {
    const ed = s.ed || '7-16', rc = s.risk || 'II', sc = String(s.siteClass || 'D').toUpperCase();
    const out = { ed, risk: rc, siteClass: sc, Ie: IE[rc] ?? 1, Ss: s.Ss, S1: s.S1, flags: [] };
    if (s.SDS != null && s.SD1 != null) {
      Object.assign(out, { Fa: null, Fv: null, SMS: s.SDS / TWO_THIRDS, SM1: s.SD1 / TWO_THIRDS, SDS: s.SDS, SD1: s.SD1, given: 'SDS' });
    } else if (ed === '7-22') {
      if (s.SMS == null || s.SM1 == null) { out.flags.push('ASCE 7-22: enter SMS and SM1 from the ASCE Hazard Tool (the PCS lists them in Box 3).'); return { ...out, ok: false }; }
      Object.assign(out, { Fa: null, Fv: null, SMS: s.SMS, SM1: s.SM1, SDS: TWO_THIRDS * s.SMS, SD1: TWO_THIRDS * s.SM1, given: 'SMS' });
    } else {
      const tbl = ed === '7-16' ? 16 : 'old';
      // interpolated; NBG Design Calcs carries Fa as interpolated (1.592 at Ss 0.26 → SMS 0.414) and Fv to two decimals
      // (2.835 at S1 0.293 → 2.84, SM1 0.832) — its validation examples 1 and 2
      const r2 = v => (v == null ? null : Math.round(v * 100 + 1e-7) / 100);
      const Fa = FA[tbl][sc] ? interp(FA[tbl][sc], SS_COLS, s.Ss) : null;
      const Fv = FV[tbl][sc] ? r2(interp(FV[tbl][sc], S1_COLS, s.S1)) : null;
      if (Fa == null || Fv == null) { out.flags.push(`Site Class ${sc} at Ss ${s.Ss} / S1 ${s.S1}: site-specific ground motion (ASCE 7 11.4.8).`); return { ...out, Fa, Fv, ok: false }; }
      Object.assign(out, { Fa, Fv, SMS: s.Ss * Fa, SM1: s.S1 * Fv });
      out.SDS = TWO_THIRDS * out.SMS; out.SD1 = TWO_THIRDS * out.SM1;
    }
    out.sdsCat = catSds(out.SDS, rc); out.sd1Cat = catSd1(out.SD1, rc);
    out.SDC = s.S1 >= 0.75 ? (rc === 'IV' ? 'F' : 'E') : out.sdsCat > out.sd1Cat ? out.sdsCat : out.sd1Cat;
    out.rho = /[DEF]/.test(out.SDC) ? 1.3 : 1;
    out.ok = true;
    return out;
  }

  // ---------- seismic force-resisting systems (ASCE 7 Table 12.2-1) and period parameters (Table 12.8-2) ----------
  const SFRS = {
    'Steel Systems Not Detailed for Seismic': { R: 3, Omega: 3, Cd: 3, label: 'Not Detailed For Seismic' },
    'Ordinary Steel Moment Frames': { R: 3.5, Omega: 3, Cd: 3, label: 'Ord. Moment Frame' },
    'Intermediate Steel Moment Frames': { R: 4.5, Omega: 3, Cd: 4, label: 'Intermediate Moment Frame' },
    'Special Steel Moment Frames': { R: 8, Omega: 3, Cd: 5.5, label: 'Special Moment Frame' },
    'Ordinary Steel Concentrically Braced Frames': { R: 3.25, Omega: 2, Cd: 3.25, label: 'Ord. Concentrically Braced Frame' },
    'Special Steel Concentrically Braced Frames': { R: 6, Omega: 2, Cd: 5, label: 'Special Concentrically Braced Frame' },
    'Steel Buckling Restrained Braced Frames': { R: 8, Omega: 2.5, Cd: 5, label: 'Buckling Restrained Braced Frame' },
    'Steel Eccentrically Braced Frames': { R: 8, Omega: 2, Cd: 4, label: 'Eccentrically Braced Frame' },
    'Cantilevered Column Systems Conforming to OMF': { R: 1.25, Omega: 1.25, Cd: 1.25, label: 'Cantilever Column (OMF)' },
  };
  const PERIOD = { moment: [0.028, 0.8], other: [0.02, 0.75], ebf: [0.03, 0.75], brbf: [0.03, 0.75] };
  // NBG framing systems: a lateral frame line (Post & Beam, Rigid Frame, …) or a sidewall (X-Bracing, Portal Frame, …)
  const TYPES = ['Rigid Frame', 'Portal Frame', 'Post & Beam', 'X-Bracing', 'Fixed Base', 'Rigid Frame (IMF)', 'Portal Frame (IMF)', 'Rigid Frame (SMF)', 'Portal Frame (SMF)', 'Post & Beam (SCBF)', 'X-Bracing (SCBF)', 'BRBF', 'EBF'];
  const normType = t => String(t || '').replace(/\s*-\s*Bracing/i, '-Bracing').replace(/^X\s*-\s*Bracing/i, 'X-Bracing').trim();
  /* type: NBG framing type; "not detailed for seismic" in SDC A–C unless ndfs === false.
     opts.flexible: every diaphragm flexible — Ω0 less 0.5, not under 2.0 (Table 12.2-1 note g) */
  function system(type, SDC, opts = {}) {
    if (typeof opts === 'boolean') opts = { ndfs: !opts };
    const low = /[ABC]/.test(SDC) && opts.ndfs !== false;
    let name, per;
    switch (normType(type)) {
      case 'Post & Beam': case 'X-Bracing': name = low ? 'Steel Systems Not Detailed for Seismic' : 'Ordinary Steel Concentrically Braced Frames'; per = 'other'; break;
      case 'Rigid Frame': case 'Portal Frame': name = low ? 'Steel Systems Not Detailed for Seismic' : 'Ordinary Steel Moment Frames'; per = 'moment'; break;
      case 'Fixed Base': name = 'Cantilevered Column Systems Conforming to OMF'; per = 'other'; break;
      case 'Post & Beam (SCBF)': case 'X-Bracing (SCBF)': name = 'Special Steel Concentrically Braced Frames'; per = 'other'; break;
      case 'BRBF': name = 'Steel Buckling Restrained Braced Frames'; per = 'brbf'; break;
      case 'EBF': name = 'Steel Eccentrically Braced Frames'; per = 'ebf'; break;
      case 'Rigid Frame (IMF)': case 'Portal Frame (IMF)': name = low ? 'Steel Systems Not Detailed for Seismic' : 'Intermediate Steel Moment Frames'; per = 'moment'; break;
      case 'Rigid Frame (SMF)': case 'Portal Frame (SMF)': name = low ? 'Steel Systems Not Detailed for Seismic' : 'Special Steel Moment Frames'; per = 'moment'; break;
      default: return null;
    }
    const s = SFRS[name], [Ct, x] = PERIOD[per];
    const cant = name === 'Cantilevered Column Systems Conforming to OMF';
    const Omega = opts.flexible && !cant ? Math.max(2, s.Omega - 0.5) : s.Omega;
    return { type: normType(type), name, label: s.label, R: s.R, Omega, Om: Omega, Cd: s.Cd, Ct, x, ndfs: name === 'Steel Systems Not Detailed for Seismic' };
  }
  // Box 5 frame type → NBG framing type for the lateral sheet
  // ("Post and Beam Multi Span - EMS", "Post & Beam", "P&B"; rigid, clear span, multi span, lean-to frames are moment frames)
  const frameType = t => (/post\s*(?:&|and)?\s*beam|\bp\s*&\s*b\b/i.test(String(t || '')) ? 'Post & Beam' : 'Rigid Frame');

  const Ta = (Ct, x, hn) => Ct * Math.pow(hn, x);                                     // Eq. 12.8-7
  const kExp = (T, vertical) => (!vertical ? 0 : T <= 0.5 ? 1 : T >= 2.5 ? 2 : 1 + (T - 0.5) / 2);   // 12.8.3

  /* Seismic response coefficient Cs (12.8.1.1), TL = 4 s.
     d: design(); R, T; o: { irregular, rho } */
  function Cs(d, R, T, o = {}, TL = 4) {
    if (typeof o === 'boolean') o = { irregular: o };
    const Ie = d.Ie, ed = d.ed, RI = R / Ie, rho = o.rho ?? d.rho, irregular = !!o.irregular;
    let Sds = d.SDS;
    const Sd1 = d.SD1;
    let note = null;
    if (ed === '7-05' || ed === '7-10') {
      if (d.Ss > 1.5 && T <= 0.5 && (ed === '7-05' || !irregular) && d.Fa != null) { Sds = TWO_THIRDS * d.Fa * 1.5; note = 'Ss capped at 1.5 for T ≤ 0.5 s (12.8.1.3)'; }
    } else if (!irregular && T <= 0.5 && rho === 1 && d.siteClass !== 'E' && d.siteClass !== 'F' && Ie <= 1) {
      // 12.8.1.3: regular, T ≤ 0.5 s, ρ = 1.0, not Site Class E / F, Risk Category I / II — SDS need not exceed max(1.0, 0.7 SDS)
      const cap = Math.min(Sds, Math.max(1, 0.7 * Sds));
      if (cap < Sds) note = 'SDS capped at max(1.0, 0.7 SDS) (12.8.1.3)';
      Sds = cap;
    }
    const basic = Sds / RI;                                                            // 12.8-2
    let max = T <= TL ? Sd1 / (T * RI) : (Sd1 * TL) / (T * T * RI);                    // 12.8-3 / -4
    // 7-16 11.4.8 exception 2: Site Class D with S1 ≥ 0.2 — for T > 1.5 Ts, 1.5 × Eq. 12.8-3 (12.8-4)
    let exc = false;
    if (ed === '7-16' && d.siteClass === 'D' && d.S1 >= 0.2 && T > 1.5 * (Sd1 / d.SDS)) { max *= 1.5; exc = true; }
    const min = ed === '7-05' ? (d.S1 >= 0.6 ? Math.max(0.01, (0.5 * d.S1) / RI) : 0.01)
      : d.S1 >= 0.6 ? Math.max(0.01, 0.044 * d.SDS * Ie, (0.5 * d.S1) / RI) : Math.max(0.01, 0.044 * d.SDS * Ie);   // 12.8-5 / -6
    const cs = d.SDC === 'A' ? 0.01 : Math.min(Math.max(min, basic), Math.max(min, max));
    const governs = d.SDC === 'A' ? 'SDC A: 0.01 (11.7)' : cs === basic ? 'Eq. 12.8-2 (SDS / (R / Ie))' : cs === max ? (exc ? '11.4.8 exception: 1.5 × Eq. 12.8-3' : 'Eq. 12.8-3 (SD1 / (T R / Ie))') : 'Eq. 12.8-5 / -6 (minimum)';
    return { Cs: cs, basic, max, min, SdsUsed: Sds, Sd1, governs, note, exception1148: exc };
  }

  // ---------- geometry (the BSW is the "high" eave of the workbook; ridge and slope measured from the BSW) ----------
  /* b: { type: 'Gable' | 'Single Slope', width, length, dtr (BSW to ridge), slope (BSW side, s:12), eaveFSW, eaveBSW } */
  function geometry(b) {
    const W = b.width, L = b.length, eF = b.eaveFSW, eB = b.eaveBSW ?? b.eaveFSW;
    const gable = /gable/i.test(b.type || 'Gable') && b.dtr > 0 && b.dtr < W;
    let ridge, sB, sF, D;
    if (gable) {
      D = b.dtr; sB = b.slope; ridge = eB + (sB / 12) * D; sF = ((ridge - eF) * 12) / (W - D);
    } else {
      // single slope: the roof from the FSW eave to the BSW eave
      D = 0; sF = ((eB - eF) * 12) / W; sB = -sF; ridge = Math.max(eF, eB);
    }
    // the roof's mean height: each plane's mid height weighted by its sloped length (NBG's "MRH" for the roof mass)
    let mrh, wos;
    if (gable) {
      const lA = D / Math.cos(Math.atan(sB / 12)), rA = (W - D) / Math.cos(Math.atan(sF / 12));
      mrh = (((ridge + eB) / 2) * lA + ((ridge + eF) / 2) * rA) / (lA + rA);
      wos = lA + rA;
    } else {
      mrh = (eF + eB) / 2; wos = Math.hypot(W, eB - eF);
    }
    // the endwall outline: heights along the width from the FSW (x = 0) to the BSW (x = W)
    const pts = gable ? [[0, eF], [W - D, ridge], [W, eB]] : [[0, eF], [W, eB]];
    return { W, L, eF, eB, gable, ridge, slopeBSW: sB, slopeFSW: sF, dtr: D, mrh, wos, pts };
  }
  // area and centroid height of the endwall between z0 and the roof (polygon clipped below z0)
  function wallPart(g, z0 = 0) {
    let A = 0, Az = 0;
    for (let i = 0; i + 1 < g.pts.length; i++) {
      const [x1, h1] = g.pts[i], [x2, h2] = g.pts[i + 1], w = x2 - x1;
      if (w <= 0) continue;
      // the part of the strip between z0 and the roof line (h linear in x): a trapezoid, or a triangle where the
      // roof line crosses z0
      const a = h1 - z0, b = h2 - z0;
      let area, zc;
      if (a >= 0 && b >= 0) {
        if (a + b <= 0) continue;
        // centroid of a trapezoid with parallel sides a, b over width w: z̄ = (a² + ab + b²) / (3 (a + b))
        area = ((a + b) / 2) * w; zc = z0 + (a * a + a * b + b * b) / (3 * (a + b));
      } else if (a > 0 || b > 0) {
        const t = Math.max(a, b), wt = w * (t / (t - Math.min(a, b)));
        area = (t * wt) / 2; zc = z0 + t / 3;
      } else continue;
      A += area; Az += area * zc;
    }
    return { A, z: A > 0 ? Az / A : z0 };
  }
  const meanRoofHeight = b => geometry(b.width != null && b.eaveFSW != null ? b : fromOld(b)).mrh;
  // the earlier geometry object ({ width, length, rooftype, dtr, slope, leh, heh }) → building data
  const fromOld = g => ({ type: g.rooftype || 'Gable', width: g.width, length: g.length, dtr: g.dtr, slope: g.slope, eaveFSW: g.leh, eaveBSW: g.heh });

  // ---------- the parts of the seismic weight ----------
  /* a wall as NBG takes it: wall { kind: 'full' | 'partial', shear, parapet, top, weight, upperWeight, masonryTop, lowerWeight }.
     len: its length (a sidewall's tributary length, an endwall's or a partition's width); end: an endwall / partition
     (its outline follows the roof unless it has a parapet); excluded: the wall is a self-supporting shear wall in this
     direction (its hardwall — the whole wall when full height — carries itself). Returns rows [{ part, W, h }]. */
  function wallRows(g, wall, len, end, excluded, defTop) {
    if (!wall) return [];
    const partial = wall.kind === 'partial' || (wall.kind == null && wall.masonryTop != null);
    // full height, no top typed: a sidewall to its eave (an endwall follows the roof line)
    const top = wall.top != null && isFinite(wall.top) ? wall.top : defTop ?? g.mrh;
    const piece = (z0, w) => {
      if (end && !wall.parapet) { const p = wallPart(g, z0); return { W: (p.A * len / g.W) * w, h: p.z }; }
      return { W: len * (top - z0) * w, h: (top + z0) / 2 };
    };
    if (!partial) {
      const p = piece(0, wall.weight || 0);
      return [{ part: null, W: excluded ? 0 : p.W, h: p.h, excluded }];
    }
    const mt = wall.masonryTop || 0, up = piece(mt, wall.upperWeight || 0);
    return [{ part: 'Upper', W: up.W, h: up.h }, { part: 'Lower', W: excluded ? 0 : len * mt * (wall.lowerWeight || 0), h: mt / 2, excluded }];
  }
  // a mezzanine's seismic weight per sq ft (12.7.2): floor dead, collateral, joists, 25 % of the floor live where it is
  // storage, the partition load where partitions are loaded
  const mezzPsf = m => (m.FDL || 0) + (m.FLC || 0) + (m.FLJ || 0) + (m.storage ? 0.25 * (m.FLL || 0) : 0) + ((m.partition ?? m.FLP > 0) ? m.FLP || 0 : 0);
  // a crane's seismic weight on a line: runway beams + rails both sides of each aisle, the bridges and hoists, the
  // independent crane columns to half their height
  const craneWeight = (c, at) => ((c.beam || 0) + (c.rail || 0)) * at.runway * 2 * (at.aisles || 1) + ((c.bridge || 0) + (c.hoist || 0)) * (at.perAisle || 0) * (at.aisles || 1) + (at.indCols || 0) * (c.indCol || 0) * (c.elev || 0) / 2;

  // vertical distribution (12.8.3): Fx = Cvx V with Cvx = wx hx^k / Σ wi hi^k; SDC A: 1 % of each weight (11.7.2)
  function distribute(rows, cs, k, SDC) {
    rows.forEach(r => { r.num = r.W * Math.pow(r.h, k); });
    const Wt = rows.reduce((a, r) => a + r.W, 0), Dt = rows.reduce((a, r) => a + r.num, 0);
    rows.forEach(r => { r.Cvx = Dt > 0 ? r.num / Dt : 0; r.Fx = SDC === 'A' ? (0.01 * r.W) / 1000 : (cs * Wt * r.Cvx) / 1000; r.Mx = r.Fx * r.h; });
    return { rows, W: Wt, num: Dt, Fx: rows.reduce((a, r) => a + r.Fx, 0), Mx: rows.reduce((a, r) => a + r.Mx, 0) };
  }

  /* Building limits for the system (ASCE 7 Table 12.2-1, 12.2.5.6 / 12.2.5.7), as warnings.
     deadPsf: roof SW+RDL+CDL (+ point loads over the plan); story: a mezzanine counted as a story */
  function limits(type, SDC, ed, hn, deadPsf, story, walls = {}) {
    const code = `ASCE ${ed}`, high = walls.above35over20, any = walls.over20;
    const msg = sec => `Building height / weight exceeds the limits of ${code} ${sec} for the ${type} system.`;
    if (/^(Post & Beam|X-Bracing)$/.test(normType(type))) {
      if (/[ABC]/.test(SDC)) return null;
      if (/[DE]/.test(SDC)) return (deadPsf <= 20 && hn <= 60 && !story) || hn <= 35 ? null : msg('Table 12.2-1');
      return deadPsf <= 20 && hn <= 60 && !story ? null : msg('Table 12.2-1');
    }
    if (/^(Rigid Frame|Portal Frame)$/.test(normType(type))) {
      if (/[ABC]/.test(SDC)) return null;
      if (/[DE]/.test(SDC)) return deadPsf <= 20 && hn <= 65 && !high && !story ? null : msg('12.2.5.6.1');
      return deadPsf <= 20 && hn <= 65 && !any && !story ? null : msg('12.2.5.6.2');
    }
    return null;
  }

  /* ---------- the project (NBG Design Calcs' input, section by section) ----------
     P: { building, seismic: { ed, risk, Ss, S1, SMS, SM1, SDS, SD1, siteClass, roofDiaphragm ('Flexible' | 'Rigid'),
            mezzDiaphragm ('None' | 'Flexible' | 'Rigid'), ndfs (true), significant (false), irregular (false),
            torsionLong (true), torsionLat (false) },
          roof: { SW, RDL, CDL, RSW, Pf }, walls: { LEW, REW, FSW, BSW, Partition },
          mezz: [{ id, elev, FDL, FLC, FLJ, storage, FLL, partition, FLP }], cranes: [{ id, beam, indCol, rail, bridge, hoist, elev }],
          sfrs: { FSW, BSW, lines: [framing of every lateral frame line] } } */
  function project(P) {
    const g = geometry(P.building), s = P.seismic || {};
    const d = design({ ed: s.ed || P.building.ed, Ss: s.Ss, S1: s.S1, siteClass: s.siteClass, risk: s.risk, SMS: s.SMS, SM1: s.SM1, SDS: s.SDS, SD1: s.SD1 });
    const rigidRoof = /rigid/i.test(s.roofDiaphragm || ''), rigidMezz = /rigid/i.test(s.mezzDiaphragm || '');
    const flexible = !rigidRoof && !rigidMezz;
    return { P, g, d, s, flexible, rigidRoof, rigidMezz, ndfs: s.ndfs !== false, significant: !!s.significant,
      torsionLong: s.torsionLong !== false, torsionLat: !!s.torsionLat };
  }
  // the system a calculation uses: its own, or (12.2.3.3) the least R of the systems in that direction when the risk
  // category is III / IV or a diaphragm is not flexible
  function governing(J, own, all) {
    const opt = { ndfs: J.ndfs, flexible: J.flexible };
    const sys = system(own, J.d.SDC, opt);
    if (!sys) return null;
    const least = (J.d.risk === 'III' || J.d.risk === 'IV' || !J.flexible) && all && all.length
      ? all.map(t => system(t, J.d.SDC, opt)).filter(Boolean).reduce((a, b) => (b.R < a.R ? b : a), sys) : sys;
    return least.R < sys.R ? { ...least, type: sys.type, Ct: sys.Ct, x: sys.x, via: '12.2.3.3' } : sys;
  }

  function seismicFactors(J, sys, over, hn) {
    const T = over && over.Ta > 0 ? over.Ta : Ta(sys.Ct, sys.x, hn);
    const k = over && over.k != null && over.k !== '' && isFinite(over.k) ? +over.k : kExp(T, J.significant);
    const rho = over && over.rho > 0 ? +over.rho : J.d.rho;
    const c = Cs(J.d, sys.R, T, { irregular: !!J.s.irregular, rho });
    return { Ie: J.d.Ie, Fa: J.d.Fa, Fv: J.d.Fv, Sms: J.d.SMS, Sm1: J.d.SM1, Sds: J.d.SDS, Sd1: J.d.SD1, SDC: J.d.SDC, R: sys.R, Om: sys.Omega, Cd: sys.Cd,
      Ct: over && over.Ta > 0 ? 0 : sys.Ct, x: sys.x, Ta: T, rho, k, Cs: c.Cs, cs: c, sfrs: sys };
  }

  // the roof snow in the seismic weight (12.7.2 item 4): 20 % of Pf where Pf exceeds 30 psf; ASCE 7-22 (strength-level
  // snow): 15 % of Pf where it exceeds 45 psf
  const snowPsf = (J, Pf) => (J.d.ed === '7-22' ? (Pf > 45 ? 0.15 * Pf : 0) : Pf > 30 ? 0.2 * Pf : 0);
  const rowName = (base, part) => (part ? `${base} - ${part}` : base);
  function addWall(rows, key, name, g, wall, len, end, excluded) {
    wallRows(g, wall, len, end, excluded, key === 'FSW' ? g.eF : key === 'BSW' ? g.eB : g.mrh).forEach(r => rows.push({ key, name: rowName(name, r.part), W: r.W, h: r.h, part: r.part, excluded: r.excluded }));
  }

  /* ---------- LATERAL: one frame line (NBG Frame) ----------
     line: { desc, framing, bay, bayType ('Left Endwall' | 'Interior' | 'Right Endwall' | 'Interior w/ Partition'), roofConc (kips),
             fswTrib, bswTrib, partLen, mezz: [{ id, area, conc }], cranes: [{ id, aisles, runway, indCols, perAisle }], over: { Ta, k, rho } } */
  function frameLine(J, line) {
    const { g, P } = J, sys = governing(J, line.framing, (P.sfrs && P.sfrs.lines) || []);
    const f = seismicFactors(J, sys, line.over, g.mrh);
    const roof = P.roof, bay = line.bay;
    const q = roof.SW + roof.RDL + roof.CDL + (roof.RSW || 0);
    const rows = [{ key: 'roof', name: 'Roof Loads', W: bay * (q * g.wos + snowPsf(J, roof.Pf) * g.W) + (line.roofConc || 0) * 1000, h: g.mrh }];
    const bt = String(line.bayType || 'Interior');
    if (/left/i.test(bt)) addWall(rows, 'LEW', 'Left EW Loads', g, P.walls.LEW, g.W, true, !!(P.walls.LEW || {}).shear);
    if (/right/i.test(bt)) addWall(rows, 'REW', 'Right EW Loads', g, P.walls.REW, g.W, true, !!(P.walls.REW || {}).shear);
    if (/partition/i.test(bt)) addWall(rows, 'Partition', 'Partition Wall Loads', g, P.walls.Partition, line.partLen ?? g.W, true, !!(P.walls.Partition || {}).shear);
    addWall(rows, 'FSW', 'Front SW Loads', g, P.walls.FSW, line.fswTrib ?? bay, false, false);
    addWall(rows, 'BSW', 'Back SW Loads', g, P.walls.BSW, line.bswTrib ?? bay, false, false);
    (line.cranes || []).forEach(at => { const c = (P.cranes || []).find(x => x.id === at.id); if (c) rows.push({ key: 'crane', id: c.id, name: `Crane ${c.id} Loads`, W: craneWeight(c, at), h: c.elev }); });
    (line.mezz || []).forEach(a => { const m = (P.mezz || []).find(x => String(x.id) === String(a.id)); if (m) rows.push({ key: 'mezz', id: m.id, name: `Mezzanine ${m.id} Loads`, W: a.area * mezzPsf(m) + (a.conc || 0) * 1000, h: m.elev, area: a.area, psf: mezzPsf(m) }); });
    const dist = distribute(rows, f.Cs, f.k, J.d.SDC);
    const M = keys => rows.filter(r => keys.includes(r.key)).reduce((a, r) => a + r.Mx, 0);
    const base = g.W * bay * f.Cs, hn = g.mrh;
    const roofPsf = (M(['roof', 'LEW', 'REW', 'Partition']) * 1000) / (hn * base);
    const altRoofPsf = (M(['roof', 'LEW', 'REW', 'Partition', 'FSW', 'BSW']) * 1000) / (hn * base);
    const tor = J.torsionLat && J.rigidMezz ? 1.1 : 1;
    const conc = [];
    [['FSW', g.eF], ['BSW', g.eB]].forEach(([key, e]) => { if (rows.some(r => r.key === key)) conc.push({ key, name: key, F: M([key]) / (e - 16 / 12), at: e - 16 / 12 }); });
    rows.filter(r => r.key === 'crane').forEach(r => conc.push({ key: 'crane', id: r.id, name: r.name, F: r.Fx, at: r.h }));
    rows.filter(r => r.key === 'mezz').forEach(r => conc.push({ key: 'mezz', id: r.id, name: r.name, F: r.Fx * tor, at: r.h, W: r.W, area: r.area, psf: r.psf }));
    const factor = f.Cs * (J.torsionLat && J.rigidRoof ? 1.1 : 1);
    const equivRoof = (roofPsf * g.W * bay * factor) / 1000;
    const V = equivRoof + conc.reduce((a, c) => a + c.F, 0);
    const deadPsf = q + snowPsf(J, roof.Pf);
    return { kind: 'lateral', desc: line.desc, framing: line.framing, bay, bayType: bt, sys, factors: f, Ta: f.Ta, k: f.k, cs: f.cs, Cs: f.Cs, R: sys.R, hn,
      rows, totals: { W: dist.W, num: dist.num, Fx: dist.Fx, Mx: dist.Mx },
      frame: { roofPsf, altRoofPsf, panel: (roofPsf * bay * factor) / 1000, altPanel: (altRoofPsf * bay * factor) / 1000, factor, equivRoof, conc, V },
      mezzLoads: conc.filter(c => c.key === 'mezz'), wallLoads: conc.filter(c => c.key === 'FSW' || c.key === 'BSW'), V,
      limit: limits(line.framing, J.d.SDC, J.d.ed, hn, deadPsf, J.significant) };
  }

  /* ---------- LONGITUDINAL: the bracing (NBG Bracing) ----------
     lg: { roofConc, fswTrib, bswTrib, partTrib, partQty, mezz: [{ id, area, conc }], cranes: [...], over } */
  function bracing(J, lg = {}) {
    const { g, P } = J;
    const types = [P.sfrs && P.sfrs.FSW || 'X-Bracing', P.sfrs && P.sfrs.BSW || 'X-Bracing'];
    const opt = { ndfs: J.ndfs, flexible: J.flexible };
    const sy = types.map(t => system(t, J.d.SDC, opt));
    // the least R of the two sidewalls governs (12.2.3.3); with equal R, the shorter period
    let sys = sy[0].R <= sy[1].R ? sy[0] : sy[1];
    if (sy[0].R === sy[1].R) sys = Ta(sy[0].Ct, sy[0].x, g.mrh) <= Ta(sy[1].Ct, sy[1].x, g.mrh) ? sy[0] : sy[1];
    const f = seismicFactors(J, sys, lg.over, g.mrh);
    const roof = P.roof, L = g.L;
    const q = roof.SW + roof.RDL + roof.CDL + (roof.RSW || 0);
    const rows = [{ key: 'roof', name: 'Roof Loads', W: L * (q * g.wos + snowPsf(J, roof.Pf) * g.W) + (lg.roofConc || 0) * 1000, h: g.mrh }];
    addWall(rows, 'LEW', 'Left EW Loads', g, P.walls.LEW, g.W, true, false);
    addWall(rows, 'REW', 'Right EW Loads', g, P.walls.REW, g.W, true, false);
    if (lg.partQty > 0) {
      const pr = wallRows(g, P.walls.Partition, lg.partTrib ?? g.W, true, false);
      pr.forEach(r => rows.push({ key: 'Partition', name: rowName('Partition Wall Loads', r.part), W: r.W * lg.partQty, h: r.h, part: r.part }));
    }
    addWall(rows, 'FSW', 'Front SW Loads', g, P.walls.FSW, lg.fswTrib ?? L, false, !!(P.walls.FSW || {}).shear);
    addWall(rows, 'BSW', 'Back SW Loads', g, P.walls.BSW, lg.bswTrib ?? L, false, !!(P.walls.BSW || {}).shear);
    (lg.cranes || []).forEach(at => { const c = (P.cranes || []).find(x => x.id === at.id); if (c) rows.push({ key: 'crane', id: c.id, name: `Crane ${c.id} Loads`, W: craneWeight(c, at), h: c.elev }); });
    (lg.mezz || []).forEach(a => { const m = (P.mezz || []).find(x => String(x.id) === String(a.id)); if (m) rows.push({ key: 'mezz', id: m.id, name: `Mezzanine ${m.id} Loads`, W: a.area * mezzPsf(m) + (a.conc || 0) * 1000, h: m.elev, area: a.area, psf: mezzPsf(m) }); });
    const dist = distribute(rows, f.Cs, f.k, J.d.SDC);
    const M = keys => rows.filter(r => keys.includes(r.key)).reduce((a, r) => a + r.Mx, 0);
    const base = g.W * L * f.Cs, hn = g.mrh;
    const totalPsf = (M(['roof', 'LEW', 'REW', 'Partition']) * 1000) / (hn * base);
    const altTotalPsf = (M(['roof', 'LEW', 'REW', 'Partition', 'FSW', 'BSW']) * 1000) / (hn * base);
    const snowPart = snowPsf(J, roof.Pf);
    // accidental torsion (12.8.4.2) on the bracing: 5 % eccentricity at a rigid diaphragm, taken as 1.1 × its force
    const torRoof = J.torsionLong && J.rigidRoof ? 1.1 : 1, torMezz = J.torsionLong && J.rigidMezz ? 1.1 : 1;
    const factor = f.Cs * torRoof;
    const conc = [];
    [['FSW', g.eF], ['BSW', g.eB]].forEach(([key, e]) => { if (rows.some(r => r.key === key)) conc.push({ key, name: key, F: M([key]) / e, at: e }); });
    rows.filter(r => r.key === 'crane').forEach(r => conc.push({ key: 'crane', id: r.id, name: r.name, F: r.Fx, at: r.h }));
    rows.filter(r => r.key === 'mezz').forEach(r => conc.push({ key: 'mezz', id: r.id, name: r.name, F: r.Fx * torMezz, at: r.h, W: r.W, area: r.area, psf: r.psf, Fx: r.Fx }));
    const equivRoof = (totalPsf * g.W * L * factor) / 1000;
    const V = equivRoof + conc.reduce((a, c) => a + c.F, 0);
    return { kind: 'longitudinal', types, systems: sy, sys, factors: f, Ta: f.Ta, k: f.k, cs: f.cs, Cs: f.Cs, R: sys.R, hn,
      rows, totals: { W: dist.W, num: dist.num, Fx: dist.Fx, Mx: dist.Mx },
      bracing: { snow: roof.Pf || 0, snowInW: snowPart, deadPsf: totalPsf - snowPart, totalPsf, altTotalPsf, factor, equivRoof, conc, V, torsionRoof: torRoof, torsionMezz: torMezz },
      mezzLoads: conc.filter(c => c.key === 'mezz'), wallLoads: conc.filter(c => c.key === 'FSW' || c.key === 'BSW'), V,
      roofPsf: totalPsf, bracingV: V, torsion: torMezz };
  }

  const api = { editionOf, design, system, frameType, Ta, kExp, Cs, geometry, wallPart, wallRows, meanRoofHeight, mezzPsf, craneWeight, distribute, limits,
    project, governing, frameLine, bracing, TYPES, SFRS, IE, TWO_THIRDS, FA, FV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_SEISMIC = api;
})(typeof self !== 'undefined' ? self : this);
