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
  /* NBG Production Guidelines (rev. 2026.01.15) — Primary & Secondary Steel, built-up members, per division (West = NBG-UT).
     d: part depth min / max (in); bf: flange width min / max; tfMax: flange thickness; thin: the thinnest web and the most
     flange it takes; L: part length max (ft); wt: part weight max (lb) under / over 35 ft; d8bf: flange width limit on an
     8" deep member; tfPlus: UT's tf > tw + 1/16" (d < 30") / 1/8" (d ≥ 30") in place of tw ≤ tf.
     Every division: tw ≤ tf (DG 25), tw / tf ≥ 0.30, bf ≤ d, d / bf ≤ 7, thickest / thinnest flange ≤ 2.0; handling:
     a part over 34 ft takes at least a 6 × 1/4 flange, over 40 ft at least 6 × 3/8 or 8 × 1/4. */
  const PROD = {
    'ABC-IL': { d: [8, 63], bf: [5, 16], tfMax: 1, thin: { tw: 0.1644, tf: 0.5 }, L: 55, wt: [10000, 10000], d8bf: 6 },
    'KBS-TN': { d: [9, 62], bf: [5, 12], tfMax: 1, thin: { tw: 0.125, tf: 0.3125 }, L: 52, wt: [10000, 10000], d8bf: 7 },
    'NBS-IN': { d: [8.5, 60], bf: [5, 12], tfMax: 1, thin: { tw: 0.125, tf: 0.3125 }, L: 53, wt: [8000, 12000], d8bf: 7 },
    'NBG-SC': { d: [8.375, 62], bf: [5, 16], tfMax: 1, thin: null, L: 60, wt: [7000, 14000], d8bf: 7 },
    'NBG-TX': { d: [8.5, 62], bf: [5, 12], tfMax: 1, thin: { tw: 0.125, tf: 0.3125 }, L: 60, wt: [6800, 13600], d8bf: 7 },
    West: { d: [7.875, 72], bf: [5, 16], tfMax: 1.5, thin: { tw: 0.125, tf: 0.3125 }, L: 55, wt: [8000, 12000], d8bf: 7, tfPlus: true },
  };
  const prodOf = div => PROD[div] || PROD['NBS-IN'];
  /* the production rule a built-up section breaks (the first one), or null. lenFt: the part length; wtPlf: its weight */
  function prodRule(sec, div, lenFt = 0, wtPlf = 0) {
    const P = prodOf(div), tf = Math.min(sec.tof, sec.tif), tfx = Math.max(sec.tof, sec.tif), bfn = Math.min(sec.bof, sec.bif), bfx = Math.max(sec.bof, sec.bif);
    if (sec.d < P.d[0] - 1e-9 || sec.d > P.d[1] + 1e-9) return { rule: 'depth', text: `part depth ${P.d[0]}"–${P.d[1]}"` };
    if (bfn < P.bf[0] - 1e-9 || bfx > P.bf[1] + 1e-9) return { rule: 'width', text: `flange width ${P.bf[0]}"–${P.bf[1]}"` };
    if (tfx > P.tfMax + 1e-9) return { rule: 'tfmax', text: `flange thickness ≤ ${P.tfMax}"` };
    if (P.tfPlus ? tf <= sec.tw + (sec.d < 30 ? 0.0625 : 0.125) - 1e-9 : sec.tw > tf + 1e-9) return { rule: 'tw<=tf', text: P.tfPlus ? `tf > tw + ${sec.d < 30 ? '1/16' : '1/8'}"` : 'web no thicker than the flange (tw ≤ tf, DG 25)' };
    if (sec.tw / tfx < 0.30 - 1e-9) return { rule: 'tw/tf', text: 'web / flange thickness ≥ 0.30' };
    if (P.thin && sec.tw <= P.thin.tw + 1e-9 && tfx > P.thin.tf + 1e-9) return { rule: 'thin', text: `flange ≤ ${P.thin.tf}" on a ${P.thin.tw}" web` };
    if (bfx > sec.d + 1e-9 || (sec.d <= 8 + 1e-9 && bfx > P.d8bf + 1e-9)) return { rule: 'bf<=d', text: 'flange width ≤ depth' };
    if (sec.d / bfn > 7 + 1e-9) return { rule: 'd/bf', text: 'depth / flange width ≤ 7' };
    if (tfx / tf > 2 + 1e-9) return { rule: 'tf ratio', text: 'thickest / thinnest flange ≤ 2.0' };
    if (lenFt > 40 + 1e-9 && !(bfn >= 8 - 1e-9 && tf >= 0.25 - 1e-9) && !(bfn >= 6 - 1e-9 && tf >= 0.375 - 1e-9)) return { rule: 'handling', text: 'over 40 ft: a 6 × 3/8 or 8 × 1/4 flange at least' };
    if (lenFt > P.L + 1e-9) return { rule: 'length', text: `part length ≤ ${P.L} ft` };
    if (wtPlf && lenFt && wtPlf * lenFt > (lenFt < 35 ? P.wt[0] : P.wt[1]) + 1e-6) return { rule: 'weight', text: `part weight ≤ ${(lenFt < 35 ? P.wt[0] : P.wt[1]).toLocaleString('en-US')} lb` };
    return null;
  }
  const inStock = (tbl, key, div) => { const s = tbl[key]; const i = DIVISIONS.indexOf(div); return !!s && s[i < 0 ? 2 : i] === 'Y'; };
  const flangeName = (b, t) => 'F' + b + ({ 0.1875: '.19', 0.25: '.25', 0.3125: '.31', 0.375: '.38', 0.5: '.50', 0.625: '.63', 0.75: '.75', 1: '×1' })[t];
  const tierOf = (b, t) => (ECON[b] && ECON[b][t] != null ? ECON[b][t] : 2);

  // Dead load from the deck guide (slab + deck weight; excludes joists and beams).
  // Confirmed anchors: 4" standard-weight concrete on 1.0C = 43 psf (NBS practice), 3.5" = 37 psf (training guide).
  // Other slabs / decks / lightweight concrete are estimated from concrete volume and flagged for the deck guide:
  //   NW 145 pcf -> 12.08 psf per inch; deck ribs displace roughly half the rib depth (1.0C reference = 0.5").
  const DECKS = {
    '1.0C': { rib: 1.0, label: '1.0C form deck' }, '1.3C': { rib: 1.3, label: '1.3C form deck' }, '1.5C': { rib: 1.5, label: '1.5C form deck' },
    '1.5VL': { rib: 1.5, label: '1.5VL composite' }, '2VL': { rib: 2.0, label: '2VL composite' }, '3VL': { rib: 3.0, label: '3VL composite' },
  };
  function deckKey(text) {
    const t = String(text || '').toUpperCase().replace(/\s+/g, '');
    // "1.5VL", "1.0C" …, or written out: "22ga B deck 1.5\"" (kind before the depth)
    const m = t.match(/(0?\.?\d(?:\.\d)?)(C|VLI|VL|B|W)/) || ((q => q && [q[0], q[2], q[1]])(t.match(/(VLI|VL|B|C|W)-?DECK(\d(?:\.\d+)?)/)));
    if (!m) return null;
    const depth = parseFloat(m[1]), kind = m[2];
    if (kind === 'C') return depth <= 1.1 ? '1.0C' : depth <= 1.4 ? '1.3C' : '1.5C';
    return depth <= 1.6 ? '1.5VL' : depth <= 2.2 ? '2VL' : '3VL';
  }
  function deadLoadFor(slabIn, concrete = 'NW', deck = '1.0C') {
    if (!(slabIn > 0)) return { psf: null, note: 'Slab thickness missing — enter the dead load.', estimate: true };
    const lw = /^L/i.test(concrete) || /light/i.test(concrete);
    const dk = DECKS[deck] ? deck : '1.0C';
    const voidAdj = (DECKS[dk].rib - 1.0) / 2;              // extra concrete displaced vs 1.0C
    const nw = 43 + (slabIn - 4 - voidAdj) * 145 / 12;
    const psf = lw ? 2 + (nw - 2) * 110 / 145 : nw;
    const exact = !lw && dk === '1.0C' && (Math.abs(slabIn - 4) < 1e-6 || Math.abs(slabIn - 3.5) < 1e-6);
    const desc = `${+slabIn.toFixed(3)}" ${lw ? 'LW' : 'NW'} concrete on ${DECKS[dk].label}`;
    return { psf: Math.round(psf), note: exact ? `Deck guide: ${desc}` : `${desc} — estimated from the deck guide (43 psf @ 4" NW on 1.0C); confirm.`, estimate: !exact, concrete: lw ? 'LW' : 'NW', deck: dk };
  }

  function candidates(div, opt) {
    const webs = Object.keys(WEB_STOCK).map(Number).filter(t => inStock(WEB_STOCK, t, div)).sort((a, b) => a - b);
    const flanges = Object.keys(FLANGE_STOCK).map(k => k.split('x').map(Number)).filter(([b, t]) => inStock(FLANGE_STOCK, b + 'x' + t, div) && b >= (opt.minFlangeWidth ?? 6) && t >= (opt.minFlangeThk ?? 0.25));
    return { webs, flanges };
  }

  /* p: { dead, coll, live, joistWt, L, Lb, trib, edition }
     opt: { division, target, dMin, dMax, dStep, symmetric, requireConc, maxDepth, allowR } */
  function designBeam(p, opt = {}) {
    const o = { division: 'NBS-IN', target: 0.99, dMin: 10, dMax: 30, dStep: 1, symmetric: true, requireConc: true, allowR: true, ...opt };
    const { webs, flanges } = candidates(o.division, o);
    const dMax = Math.min(o.dMax, o.maxDepth ?? Infinity);
    const evals = [], removed = {};
    let n = 0;
    for (let d = o.dMin; d <= dMax + 1e-9; d += o.dStep) {
      for (const tw of webs) {
        for (const [bof, tof] of flanges) {
          const inner = o.symmetric ? [[bof, tof]] : flanges.filter(([b, t]) => b <= bof);
          for (const [bif, tif] of inner) {
            const h = d - tof - tif;
            if (h <= 0 || h / tw >= 260) continue;
            const sec = { type: 'BU', d, tw, bof, tof, bif, tif };
            const pr = o.production !== false ? prodRule(sec, o.division, p.L, 0) : null;
            if (pr) { removed[pr.rule] = (removed[pr.rule] || 0) + 1; continue; }
            const r = MZ.beamCheck({ ...p, sec }, null);
            n++;
            const tier = Math.max(tierOf(bof, tof), tierOf(bif, tif));
            const pw = o.production !== false ? prodRule(sec, o.division, p.L, r.res.Wt) : null;
            if (pw) { removed[pw.rule] = (removed[pw.rule] || 0) + 1; continue; }
            const pass = r.res.CSR <= o.target && r.res.SRvx <= o.target && r.defl.rLL >= 360 && r.defl.rTL >= 240 && (!o.requireConc || !r.conc || r.conc.ok) && isFinite(r.res.CSR);
            evals.push({ sec, r, tier, pass, wt: r.res.Wt, d, maxSR: Math.max(r.res.CSR, r.res.SRvx) });
          }
        }
      }
    }
    // lightest: the least weight (a non-economical flange only when nothing else passes); ties: better flange tier, shallower
    const rank = (a, b) => (a.tier === 2) - (b.tier === 2) || a.wt - b.wt || a.tier - b.tier || a.d - b.d || b.maxSR - a.maxSR;
    let passing = evals.filter(e => e.pass && (o.allowR || e.tier < 2));
    const best = passing.slice().sort(rank)[0] || null;
    const byDepth = [];
    for (let d = o.dMin; d <= dMax + 1e-9; d += o.dStep) {
      const at = passing.filter(e => Math.abs(e.d - d) < 1e-9).sort(rank)[0];
      byDepth.push(at ? summarize(at) : { d, none: true });
    }
    return { best: best ? summarize(best) : null, byDepth, evaluated: n, options: o, all: evals.filter(e => e.pass), removed, dTop: dMax, params: p };
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

  /* The options, from one exhaustive search of stocked plates within the NBG production rules (every one passes the MB
     sheet: combined and shear ≤ target, L/360 live, L/240 total, joist bearing):
       Lightest         the least weight.
       Best fit         the quote engineer's way, step by step: as deep as the clearance allows; the thinnest web that
                        works in shear there; flanges from F8.31 up the economical sizes (8", then 10", then 12") until the
                        section passes; then take depth out an inch at a time with the same plates while it still passes
                        (the stress ratio comes up toward the limit); then a lighter plate at that depth if one works.
       Most economical  NBG "Economical Flange Sections": economical (green) flange plate only, 5"–8" wide first, 10"
                        when no 8" plate works, 12" last (typically more expensive); the lightest of those. Somewhat
                        economical (yellow) only when no green plate works.
     Options that land on the same section are one design (the UI shows them as one, with both names). When fewer than
     three different designs come out, the next different ones are added as alternates (shallower; another flange
     width), so the engineer sees the real choices. */
  const LADDER = [[8, 0.3125], [8, 0.375], [8, 0.5], [10, 0.375], [10, 0.5], [10, 0.625], [10, 0.75], [12, 0.5], [12, 0.625], [12, 0.75], [12, 1]];
  const widthClass = b => (b <= 8 ? 0 : b <= 10 ? 1 : 2);
  function beamOptions(search, ctx = {}) {
    if (!search || !search.best) return [];
    const p = search.params, o = search.options, target = o.target, div = o.division;
    const same = (a, b) => a && b && ['d', 'tw', 'bof', 'tof', 'bif', 'tif'].every(k => a[k] === b[k]);
    const light = search.best;
    const all = (search.all || []).filter(e => e.pass);
    const passes = r => r.res.CSR <= target && r.res.SRvx <= target && r.defl.rLL >= 360 && r.defl.rTL >= 240 && (!o.requireConc || !r.conc || r.conc.ok) && isFinite(r.res.CSR);
    const webs = candidates(div, o).webs;
    const run = sec => {
      const h = sec.d - sec.tof - sec.tif;
      if (h <= 0 || h / sec.tw >= 260) return { ok: false, why: `web h/tw ${(h / sec.tw).toFixed(0)} ≥ 260` };
      const pr = o.production !== false ? prodRule(sec, div, p.L, 0) : null;
      if (pr) return { ok: false, why: pr.text, rule: pr.rule };
      const r = MZ.beamCheck({ ...p, sec }, null);
      const pw = o.production !== false ? prodRule(sec, div, p.L, r.res.Wt) : null;
      if (pw) return { ok: false, why: pw.text, rule: pw.rule, r };
      const ok = passes(r);
      const gov = !ok ? (r.res.CSR > target ? `combined ${r.res.CSR.toFixed(3)} > ${target}` : r.res.SRvx > target ? `shear ${r.res.SRvx.toFixed(3)} > ${target}` : r.defl.rLL < 360 ? `live deflection L/${Math.round(r.defl.rLL)} < L/360` : r.defl.rTL < 240 ? `total deflection L/${Math.round(r.defl.rTL)} < L/240` : 'joist bearing') : null;
      return { ok, why: gov, r };
    };
    const asPick = (sec, r) => summarize({ sec, r, tier: Math.max(tierOf(sec.bof, sec.tof), tierOf(sec.bif, sec.tif)) });
    const sym = (d, tw, [b, t]) => ({ type: 'BU', d, tw, bof: b, tof: t, bif: b, tif: t });
    const flName = ([b, t]) => flangeName(b, t), webName = tw => 'W' + String(Math.round(tw * 1000)).padStart(3, '0');
    const opts = [];
    opts.push({ key: 'lightest', label: 'Lightest', why: `The least weight of every stocked web and flange that passes, ${o.dMin}"–${search.dTop}" deep${search.dTop < o.dMax ? ' (the clearance C caps the depth)' : ''}.`, pick: light });

    // ---- best fit, step by step ----
    const ladder = LADDER.filter(([b, t]) => inStock(FLANGE_STOCK, b + 'x' + t, div) && tierOf(b, t) === 0);
    const steps = [];
    let fit = null;
    {
      const d0 = search.dTop;
      steps.push({ step: 'depth', text: search.dTop < o.dMax ? `Start as deep as the clearance allows: ${d0}".` : `No clearance limit: start at the top of the depth range, ${d0}".` });
      // the web: the thinnest that works in shear at that depth (with the starting flange)
      const f0 = ladder[0];
      let tw = null; const webTries = [];
      for (const w of webs) {
        const t = run(sym(d0, w, f0));
        const shearOk = t.r && t.r.res.SRvx <= target;
        webTries.push({ web: webName(w), shear: t.r ? t.r.res.SRvx : null, ok: !!shearOk, why: t.r ? null : t.why });
        if (shearOk) { tw = w; break; }
      }
      steps.push({ step: 'web', text: tw != null ? `Web: the thinnest that works in shear at ${d0}" is ${webName(tw)}.` : `No stocked web works in shear at ${d0}".`, tries: webTries });
      if (tw != null && f0) {
        // flanges up the economical sizes; a plate that needs a thicker web (production: web ≥ 0.30 tf, tw ≤ tf) takes it
        let sec = null; const flTries = [];
        for (const fl of ladder) {
          let s0 = null, t = null;
          for (const w of webs.filter(x => x >= tw)) { const tr = run(sym(d0, w, fl)); if (tr.rule && /tw/.test(tr.rule)) continue; s0 = sym(d0, w, fl); t = tr; break; }
          flTries.push({ sec: s0 ? `BU${d0} ${flName(fl)} ${webName(s0.tw)}` : flName(fl), ok: !!(t && t.ok), why: t ? t.why : 'no web fits the production rules', CSR: t && t.r ? t.r.res.CSR : null });
          if (t && t.ok) { sec = s0; break; }
        }
        steps.push({ step: 'flange', text: sec ? `Flanges from F8.31 up the economical sizes: ${flName([sec.bof, sec.tof])} is the first that passes at ${d0}"${sec.tw > tw ? `, on ${webName(sec.tw)} (production: a web at least 0.30 × the flange thickness)` : ''}.` : `No economical flange passes at ${d0}" with this web.`, tries: flTries });
        if (sec) {
          // take depth out with the same plates while it passes
          const dTries = []; let d = sec.d;
          for (let dd = sec.d - o.dStep; dd >= o.dMin - 1e-9; dd -= o.dStep) {
            const tr = run({ ...sec, d: dd });
            dTries.push({ d: dd, ok: tr.ok, why: tr.why, CSR: tr.r ? tr.r.res.CSR : null, SRv: tr.r ? tr.r.res.SRvx : null, rLL: tr.r ? tr.r.defl.rLL : null });
            if (!tr.ok) break;
            d = dd;
          }
          const kept = { ...sec, d };
          const rk = run(kept);
          steps.push({ step: 'reduce', text: d < sec.d ? `Take depth out with the same plates: it still passes at ${d}" (combined ${rk.r.res.CSR.toFixed(3)}, shear ${rk.r.res.SRvx.toFixed(3)}, L/${Math.round(rk.r.defl.rLL)})${dTries.some(x => !x.ok) ? `; at ${d - o.dStep}" it does not (${dTries.find(x => !x.ok).why})` : ''}.` : `Taking depth out with the same plates fails at once (${(dTries[0] || {}).why || 'the bottom of the range'}) — ${d}" it is.`, tries: dTries });
          // a lighter plate at that depth (same or narrower flange, economical)
          const lighter = all.filter(e => e.d === d && e.tier === 0 && e.sec.bof <= kept.bof && e.wt < rk.r.res.Wt - 1e-9).sort((a, b) => a.wt - b.wt)[0];
          if (lighter) {
            steps.push({ step: 'cut', text: `At ${d}" a lighter plate still works: ${lighter.r.desc} (${flangeName(lighter.sec.bof, lighter.sec.tof)}, ${webName(lighter.sec.tw)}), ${lighter.wt.toFixed(1)} plf against ${rk.r.res.Wt.toFixed(1)}.` });
            fit = summarize(lighter);
          } else {
            steps.push({ step: 'cut', text: `No lighter economical plate passes at ${d}" — ${rk.r.desc} it is.` });
            fit = asPick(kept, rk.r);
          }
        }
      }
    }
    if (fit) {
      // the step-by-step method can stop where the exhaustive search has a lighter and shallower section: say so
      const dom = light.wt < fit.wt - 1e-9 && light.d <= fit.d && !same(light.sec, fit.sec);
      opts.push({ key: 'fit', label: 'Best fit', why: `Worked the quote engineer's way: deepest allowed, web for shear, F8.31 and up the economical flanges, then less depth until the next inch fails${fit.d < search.dTop ? ` (${search.dTop - fit.d}" less than the deepest)` : ''}; combined ${fit.CSR.toFixed(2)}, shear ${fit.SRv.toFixed(2)}, live L/${Math.round(fit.rLL)}.${dom ? ` The lightest (${light.desc}) is lighter and no deeper — the step-by-step method stops at ${fit.d}" because one inch less needs a heavier 8" plate; the full search also tries 6" plates at every depth.` : ''}`, pick: fit, steps, dominated: dom });
    }

    // ---- most economical: green plate, 5"–8" first, then 10", then 12" (yellow only when no green works) ----
    let econ = null, econWhy = '';
    for (const t of [0, 1]) {
      for (const wc of [0, 1, 2]) {
        const e = all.filter(x => x.tier === t && widthClass(Math.max(x.sec.bof, x.sec.bif)) === wc).sort((a, b) => a.wt - b.wt || a.d - b.d)[0];
        if (e) { econ = summarize(e); econWhy = `${t === 0 ? 'Economical (green) flange plate' : 'No green plate works — somewhat economical (yellow)'}, ${['5"–8" wide, as the guide starts', '10" — no 8" plate works', '12" — no 8" or 10" plate works (typically more expensive)'][wc]}: the lightest of those is ${econ.flange} on ${econ.web}.`; break; }
      }
      if (econ) break;
    }
    if (econ) opts.push({ key: 'econ', label: 'Most economical', why: econWhy, pick: econ, tier: econ.tier });

    // ---- alternates, when fewer than three different designs came out ----
    const distinct = () => opts.reduce((a, x) => (a.some(y => same(y.pick.sec, x.pick.sec)) ? a : a.concat(x)), []);
    if (distinct().length < 3) {
      const shown = () => opts.map(x => x.pick.sec);
      const minD = Math.min(...shown().map(q => q.d));
      const sh = all.filter(e => e.tier === 0 && e.d < minD && e.wt <= light.wt * 1.15).sort((a, b) => a.d - b.d || a.wt - b.wt)[0];
      if (sh) opts.push({ key: 'shallow', label: 'Shallower', why: `${minD - sh.d}" less depth than the others for ${(((sh.wt - light.wt) / light.wt) * 100).toFixed(1)} % more steel (the shallowest green-plate section within 15 % of the lightest) — more clearance under the beam.`, pick: summarize(sh) });
    }
    if (distinct().length < 3) {
      const widths = new Set(opts.map(x => x.pick.sec.bof));
      const ow = all.filter(e => e.tier === 0 && !widths.has(e.sec.bof)).sort((a, b) => a.wt - b.wt)[0];
      if (ow) opts.push({ key: 'width', label: `${ow.sec.bof}" flanges`, why: `The lightest with ${ow.sec.bof}" economical flanges (the others use ${[...widths].join('" / ')}") — ${flangeName(ow.sec.bof, ow.sec.tof)} on ${'W' + String(Math.round(ow.sec.tw * 1000)).padStart(3, '0')}.`, pick: summarize(ow) });
    }
    return opts.map(x => ({ ...x, dWt: x.pick.wt - light.wt, dPct: (x.pick.wt - light.wt) / light.wt, sameAs: opts.filter(y => y !== x && same(y.pick.sec, x.pick.sec)).map(y => y.key) }));
  }

  // Beam reactions for a given section (MB!H6 dead, MB!H10 live)
  function reactions(p, sec) {
    const r = MZ.beamCheck({ ...p, sec }, null);
    return { D: r.V.D, L: r.V.L, check: r };
  }

  const COMMON_COLUMNS = ['W10X22', 'W8X24', 'W12X26'];
  /* loads: { DL_L, LL_L, DL_R, LL_R }, or an array of them (a section must pass every set; the
     governing set's check is returned) ; opt: { L (ft), candidates, includeW818, edition, division } */
  function designColumn(loads, opt, WFDB) {
    const sets = Array.isArray(loads) ? loads : [loads];
    const list = (opt.candidates || COMMON_COLUMNS).slice();
    if (opt.includeW818 && !list.includes('W8X18')) list.unshift('W8X18');
    list.sort((a, b) => WFDB[a].W - WFDB[b].W);
    const tried = [];
    const run = name => {
      // a load set may carry its own column length (mezzanines of one job at different heights)
      const all = sets.map(({ L: Ls, ...ld }) => { const L = Ls || opt.L; return MZ.columnCheck({ sec: { type: 'WF', name }, Fy: 50, Fu: 65, L, Lby: L * 12, ...ld, edition: opt.edition }, WFDB); });
      const c = all.length === 1 ? all[0] : { ...all.slice().sort((a, b) => b.max - a.max)[0], ok: all.every(x => x.ok) };
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

  const api = { PROD, prodRule, designBeam, beamOptions, designColumn, DECKS, deckKey, reactions, deadLoadFor, candidates, DIVISIONS, FLANGE_STOCK, WEB_STOCK, WF_STOCK, ECON, TIER, tierOf, flangeName, COMMON_COLUMNS, inStock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_DESIGN = api;
})(typeof self !== 'undefined' ? self : this);
