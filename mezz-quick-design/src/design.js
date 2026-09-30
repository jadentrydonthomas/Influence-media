/* Section search + job runner.
   Does what the quote engineer does by hand in the NBG sheets: try BU depths / webs / flanges until
   the MB sheet reads combined + shear SR <= 0.99 with L/360 live and L/240 total deflection, then take
   the beam reactions into the Mezzanine Column sheet and try the common W columns.
   Stock: NBG DM 5.1 (flange / web / WF by division). Economy: NBG "Economical Flange Sections". */
(function (root) {
  'use strict';
  const MZ = root.MZ || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const LAYOUT = root.MZ_LAYOUT || (typeof require !== 'undefined' ? require('./layout.js') : null);

  const DIVISIONS = ['ABC-IL', 'KBS-TN', 'NBS-IN', 'NBG-SC', 'NBG-TX', 'West'];
  // DM 5.1.1.2 flange stock (Y per division, in DIVISIONS order). Fy 55 unless noted.
  const FLANGE_STOCK = {
    '6x0.25': 'YYYYYY', '6x0.3125': 'YYYYYY', '6x0.375': 'YYYYYY', '6x0.5': 'YYYYYY', '6x0.625': 'YYYYYY', '6x0.75': 'YYYYYY',
    '8x0.25': 'YYYYYY', '8x0.3125': 'YYYYYY', '8x0.375': 'YYYYYY', '8x0.5': 'YYYYYY', '8x0.625': 'YYYYYY', '8x0.75': 'YYYYYY', '8x1': 'YYYYYY',
    '10x0.375': 'YYYYYY', '10x0.5': 'YYYYYY', '10x0.625': 'YYYYYY', '10x0.75': 'YYYYYY', '10x1': 'YY-YYY',
    '12x0.375': '-YYYYY', '12x0.5': 'YYYYYY', '12x0.625': 'YYYYYY', '12x0.75': 'YYYYYY', '12x1': 'YYYYYY',
  };
  // DM 5.1.4.2 web stock (West = UT or CA)
  const WEB_STOCK = {
    0.15: '---YYY', 0.1644: 'YYYYYY', 0.1875: 'YYYYYY', 0.22: 'YYYYYY', 0.25: 'YYYYYY',
    0.275: '-YYYY-', 0.3125: 'YYYYYY', 0.375: 'YYYYYY', 0.5: 'YYYYYY',
  };
  // DM 5.1.5.1.1 wide flange stock (Fy 50)
  const WF_STOCK = { W8X10: 'YYY-YY', W8X18: 'YYYYYY', W8X24: 'YYYYYY', W10X12: '-Y----', W10X15: '----Y-', W10X22: 'YYYYYY', W12X14: 'YY---Y', W12X26: 'YYYYYY' };
  // Economical flange matrix: 0 = economical (G), 1 = somewhat (Y), 2 = non-economical (R)
  const ECON = {
    5: { 0.1875: 0, 0.25: 0, 0.3125: 0, 0.375: 1, 0.5: 2 },
    6: { 0.1875: 2, 0.25: 0, 0.3125: 0, 0.375: 0, 0.5: 1, 0.625: 2, 0.75: 2 },
    8: { 0.1875: 2, 0.25: 1, 0.3125: 0, 0.375: 0, 0.5: 0, 0.625: 1, 0.75: 2, 1: 2 },
    10: { 0.375: 0, 0.5: 0, 0.625: 0, 0.75: 0, 1: 2 },
    12: { 0.375: 1, 0.5: 0, 0.625: 0, 0.75: 0, 1: 0 },
  };
  const TIER = ['G', 'Y', 'R'];
  const inStock = (tbl, key, div) => { const s = tbl[key]; const i = DIVISIONS.indexOf(div); return !!s && s[i < 0 ? 2 : i] === 'Y'; };
  const flangeName = (b, t) => 'F' + b + ({ 0.25: '.25', 0.3125: '.31', 0.375: '.38', 0.5: '.50', 0.625: '.63', 0.75: '.75', 1: '1.0' })[t];
  const tierOf = (b, t) => (ECON[b] && ECON[b][t] != null ? ECON[b][t] : 2);

  // Dead load from the deck guide. Anchors: 4" standard-weight = 43 psf (NBS practice), 3.5" = 37 psf
  // (training guide) -> 12.08 psf per inch of 145 pcf concrete. Anything else is an estimate to confirm.
  function deadLoadFor(slabIn, material = 'Standard Weight Concrete') {
    if (!(slabIn > 0)) return { psf: null, note: 'Slab thickness missing — enter the dead load.' };
    const nw = 43 + (slabIn - 4) * 145 / 12;
    if (/light/i.test(material)) {
      const lw = 2 + (nw - 2) * 110 / 145;
      return { psf: Math.round(lw), note: `Lightweight concrete ${slabIn}" — estimated (110 pcf); confirm with the deck guide.`, estimate: true };
    }
    const exact = Math.abs(slabIn - 4) < 1e-6 || Math.abs(slabIn - 3.5) < 1e-6;
    return { psf: Math.round(nw), note: exact ? `Deck guide: ${slabIn}" standard-weight concrete` : `${slabIn}" standard-weight concrete — interpolated from the deck guide (43 psf @ 4"); confirm.`, estimate: !exact };
  }

  function candidates(div, opt) {
    const webs = Object.keys(WEB_STOCK).map(Number).filter(t => inStock(WEB_STOCK, t, div)).sort((a, b) => a - b);
    const flanges = Object.keys(FLANGE_STOCK).map(k => k.split('x').map(Number)).filter(([b, t]) => inStock(FLANGE_STOCK, b + 'x' + t, div) && b >= (opt.minFlangeWidth ?? 6) && t >= (opt.minFlangeThk ?? 0.25));
    return { webs, flanges };
  }

  /* p: { dead, coll, live, joistWt, L, Lb, trib, edition }
     opt: { division, target, dMin, dMax, dStep, symmetric, requireConc, maxDepth, allowR } */
  function designBeam(p, opt = {}) {
    const o = { division: 'NBS-IN', target: 0.99, dMin: 10, dMax: 24, dStep: 1, symmetric: true, requireConc: true, allowR: true, ...opt };
    const { webs, flanges } = candidates(o.division, o);
    const dMax = Math.min(o.dMax, o.maxDepth ?? Infinity);
    const evals = [];
    let n = 0;
    for (let d = o.dMin; d <= dMax + 1e-9; d += o.dStep) {
      for (const tw of webs) {
        for (const [bof, tof] of flanges) {
          const inner = o.symmetric ? [[bof, tof]] : flanges.filter(([b, t]) => b <= bof);
          for (const [bif, tif] of inner) {
            const h = d - tof - tif;
            if (h <= 0 || h / tw >= 260) continue;
            const sec = { type: 'BU', d, tw, bof, tof, bif, tif };
            const r = MZ.beamCheck({ ...p, sec }, null);
            n++;
            const tier = Math.max(tierOf(bof, tof), tierOf(bif, tif));
            const pass = r.res.CSR <= o.target && r.res.SRvx <= o.target && r.defl.rLL >= 360 && r.defl.rTL >= 240 && (!o.requireConc || !r.conc || r.conc.ok) && isFinite(r.res.CSR);
            evals.push({ sec, r, tier, pass, wt: r.res.Wt, d, maxSR: Math.max(r.res.CSR, r.res.SRvx) });
          }
        }
      }
    }
    const rank = (a, b) => (a.tier === 2) - (b.tier === 2) || a.wt - b.wt || a.tier - b.tier || a.d - b.d || b.maxSR - a.maxSR;
    let passing = evals.filter(e => e.pass && (o.allowR || e.tier < 2));
    const best = passing.slice().sort(rank)[0] || null;
    const byDepth = [];
    for (let d = o.dMin; d <= dMax + 1e-9; d += o.dStep) {
      const at = passing.filter(e => Math.abs(e.d - d) < 1e-9).sort(rank)[0];
      byDepth.push(at ? summarize(at) : { d, none: true });
    }
    return { best: best ? summarize(best) : null, byDepth, evaluated: n, options: o };
  }

  function summarize(e) {
    const r = e.r;
    return {
      desc: r.desc, sec: e.sec, wt: r.res.Wt, d: e.sec.d, tier: TIER[e.tier],
      flange: flangeName(e.sec.bof, e.sec.tof) + (e.sec.bif !== e.sec.bof || e.sec.tif !== e.sec.tof ? ' / ' + flangeName(e.sec.bif, e.sec.tif) : ''),
      web: 'W' + String(Math.round(e.sec.tw * 1000)).padStart(3, '0'),
      CSR: r.res.CSR, SRv: r.res.SRvx, rDL: r.defl.rDL, rLL: r.defl.rLL, rTL: r.defl.rTL,
      conc: r.conc ? r.conc.max : null, concOK: r.conc ? r.conc.ok : true, check: r,
    };
  }

  // Beam reactions for a given section (MB!H6 dead, MB!H10 live)
  function reactions(p, sec) {
    const r = MZ.beamCheck({ ...p, sec }, null);
    return { D: r.V.D, L: r.V.L, check: r };
  }

  const COMMON_COLUMNS = ['W10X22', 'W8X24', 'W12X26'];
  /* loads: { DL_L, LL_L, DL_R, LL_R } ; opt: { L (ft), candidates, includeW818, edition, division } */
  function designColumn(loads, opt, WFDB) {
    const list = (opt.candidates || COMMON_COLUMNS).slice();
    if (opt.includeW818 && !list.includes('W8X18')) list.unshift('W8X18');
    list.sort((a, b) => WFDB[a].W - WFDB[b].W);
    const tried = [];
    const run = name => {
      const c = MZ.columnCheck({ sec: { type: 'WF', name }, Fy: 50, Fu: 65, L: opt.L, Lby: opt.L * 12, ...loads, edition: opt.edition }, WFDB);
      tried.push({ name, max: c.max, ok: c.ok, check: c });
      return c;
    };
    // run every common size so the alternatives are visible; pick the lightest that passes
    const common = list.map(name => ({ name, c: run(name) }));
    const firstOK = common.find(x => x.c.ok);
    if (firstOK) return { name: firstOK.name, quoteAs: firstOK.name, common: true, check: firstOK.c, tried };
    // Guide: if a larger W is needed (e.g. W14x43) list it as BU on the quote sheet
    const pool = Object.keys(WFDB).filter(k => /^W(8|10|12|14)X/.test(k) && !list.includes(k)).sort((a, b) => WFDB[a].W - WFDB[b].W || WFDB[a].d - WFDB[b].d);
    for (const name of pool) {
      const c = run(name);
      if (c.ok) { const [, dn, wt] = name.match(/^W(\d+)X([\d.]+)/); return { name, quoteAs: 'BU' + dn + 'x' + wt, common: false, check: c, tried }; }
    }
    return { name: null, quoteAs: null, common: false, check: null, tried };
  }

  const api = { designBeam, designColumn, reactions, deadLoadFor, candidates, DIVISIONS, FLANGE_STOCK, WEB_STOCK, WF_STOCK, ECON, TIER, tierOf, flangeName, COMMON_COLUMNS, inStock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_DESIGN = api;
})(typeof self !== 'undefined' ? self : this);
