/* Snow loads as NBG Design Calcs works them (ASCE 7-16 chapter 7; 7-10 alike; 7-22 with its winter wind parameter):
   flat and sloped roof snow, the low-slope minimum, gable unbalanced snow, and the drift a higher roof puts on a lower
   one — leeward from the upper roof's fetch, windward from the lower roof's, the larger kept, capped at the clear height
   above the balanced snow and cut off at the far edge of the lower roof — beside a separate building too, and the snow
   that slides off an upper roof that drains onto a lower one. All in lb, ft, psf, pcf; slopes as rise on 12.

   Checked against NBG Design Calcs' own snow document (unbalanced snow, ASCE 7-16: surcharge 13.3043 psf over 20.6368 ft,
   windward 10.71 psf, leeward 35.70 psf for pg 51, W 30 ft, 1:12) and worked by hand in test/snow.test.js. */
(function (root) {
  'use strict';

  const IS = { I: 0.8, II: 1.0, III: 1.1, IV: 1.2 };
  // the code text of a PCS ("IBC 2021", "ASCE 7-16", "KBC 2018 ASCE 7-10") → the ASCE 7 edition
  function editionOf(text) {
    const t = String(text || '');
    const m = t.match(/ASCE\s*7\s*-\s*(\d{2})/i);
    if (m) return { ed: '7-' + m[1], assumed: false };
    const y = +((t.match(/IBC\s*(20\d\d)/i) || [])[1] || 0);
    if (y >= 2024) return { ed: '7-22', assumed: false };
    if (y >= 2018) return { ed: '7-16', assumed: false };
    if (y >= 2012) return { ed: '7-10', assumed: false };
    if (y) return { ed: '7-05', assumed: false };
    return { ed: '7-16', assumed: true };
  }
  const deg = s => Math.atan((+s || 0) / 12) * 180 / Math.PI;     // rise on 12 → degrees
  const gamma = pg => Math.min(30, 0.13 * pg + 14);              // snow density, pcf (Eq. 7.7-1)

  // flat-roof snow (Eq. 7.3-1): 7-22 drops Is (its pg is risk-targeted)
  function flat(o) {
    const Is = o.ed === '7-22' ? 1 : (o.Is ?? IS[o.risk] ?? 1);
    return { pf: 0.7 * o.Ce * o.Ct * Is * o.pg, Is };
  }
  /* roof slope factor Cs (Fig. 7.4-1): warm roofs (Ct ≤ 1.0), cold roofs Ct 1.1, Ct ≥ 1.2. Unobstructed slippery
     surfaces slide from a smaller angle. */
  function Cs(slopeDeg, Ct, slippery) {
    const th = slopeDeg;
    const [flatTo, zeroAt] = Ct <= 1.0 ? (slippery ? [5, 70] : [30, 70]) : Ct <= 1.1 ? (slippery ? [10, 70] : [37.5, 70]) : (slippery ? [15, 70] : [45, 70]);
    if (th <= flatTo) return 1;
    if (th >= zeroAt) return 0;
    return 1 - (th - flatTo) / (zeroAt - flatTo);
  }
  // the low-slope minimum pm (7.3.4): slopes under 15°; 7-22 without Is
  function minimum(o) {
    const Is = o.ed === '7-22' ? 1 : (o.Is ?? IS[o.risk] ?? 1);
    return o.pg <= 20 ? Is * o.pg : 20 * Is;
  }
  /* drift height hd for a fetch lu (Fig. 7.6-1 / Eq. 7.6-1). 7-05 / 7-10 / 7-16: 0.43 lu^(1/3) (pg + 10)^(1/4) − 1.5;
     7-22: 1.5 √(pg^0.74 lu^0.70 W2^1.7 / γ). A fetch under 20 ft is taken as 20 ft. */
  function driftHeight(ed, pg, lu, W2) {
    const L = Math.max(20, +lu || 0);
    if (ed === '7-22') {
      if (!(W2 > 0)) return { hd: null, lu: L, need: 'W2' };
      return { hd: Math.max(0, 1.5 * Math.sqrt(Math.pow(pg, 0.74) * Math.pow(L, 0.70) * Math.pow(W2, 1.7) / gamma(pg))), lu: L };
    }
    return { hd: Math.max(0, 0.43 * Math.cbrt(L) * Math.pow(pg + 10, 0.25) - 1.5), lu: L };
  }

  /* one roof: { ed, pg, Ce, Ct, Is | risk, slope (on 12), slippery, W (eave to ridge, ft, for unbalanced), gable } */
  function roof(o) {
    const { pf, Is } = flat(o), th = deg(o.slope), cs = Cs(th, o.Ct, !!o.slippery), ps = cs * pf;
    const out = { ed: o.ed, pg: o.pg, Ce: o.Ce, Ct: o.Ct, Is, pf, slopeDeg: th, Cs: cs, ps, gamma: gamma(o.pg), pm: null, rainOnSnow: 0, unbalanced: null };
    if (th < 15) out.pm = minimum(o);
    // rain-on-snow (7.10): pg ≤ 20 (not 0), slope in degrees under W/50 — on the balanced case only
    if (o.pg > 0 && o.pg <= 20 && o.W > 0 && th < o.W / 50) out.rainOnSnow = 5;
    if (o.gable && o.W > 0) out.unbalanced = unbalanced(o, out);
    return out;
  }
  /* gable unbalanced snow (7.6.1), slopes 1/2 on 12 to 7 on 12. W ≤ 20 ft with simply supported prismatic members from
     ridge to eave: windward 0, leeward Is·pg. Otherwise windward 0.3 ps, leeward ps with a rectangular surcharge
     hd γ / √S over 8 hd √S / 3 from the ridge (hd for lu = W, S = run / rise). */
  function unbalanced(o, r) {
    const th = r.slopeDeg;
    if (th < 2.38 - 1e-9 || th > 30.2 + 1e-9) return { applies: false, why: 'slope outside 1/2 on 12 to 7 on 12' };
    if (o.W <= 20 && o.prismatic) return { applies: true, windward: 0, leeward: (o.ed === '7-22' ? 1 : r.Is) * o.pg, surcharge: 0, length: 0, simple: true };
    const S = 12 / o.slope, h = driftHeight(o.ed, o.pg, o.W, o.W2);
    if (h.hd == null) return { applies: true, need: h.need };
    return { applies: true, windward: 0.3 * r.ps, leeward: r.ps, surcharge: h.hd * r.gamma / Math.sqrt(S), length: 8 * h.hd * Math.sqrt(S) / 3, hd: h.hd, S };
  }

  /* the drift on a lower roof below a higher one (7.7). o: { ed, pg, W2, psLower, h (step: upper roof edge above the
     lower roof surface, ft), luUpper (upper roof fetch toward the step), luLower (lower roof fetch toward the step),
     lowerWidth (lower roof from the step to its far edge), s (horizontal gap to a separate building, 0 when they touch) }.
     Returns hb, hc, both drifts and the one used: hd (capped at hc), w, pd = hd γ, and where it is cut off. */
  function stepDrift(o) {
    const g = gamma(o.pg), hb = o.psLower / g, h = +o.h || 0, s = +o.s || 0;
    const hc = h - hb;
    const out = { gamma: g, hb, h, hc, s, lowerWidth: o.lowerWidth, none: false, why: null, leeward: null, windward: null, gov: null, hd: 0, w: 0, pd: 0, capped: false, truncated: false, end: 0 };
    if (!(h > 0) || hc <= 0 || hc / hb < 0.2) { out.none = true; out.why = !(h > 0) ? 'no step: the lower roof meets the upper roof at its edge' : `hc / hb = ${(hc / hb).toFixed(2)} < 0.2 (7.7)`; return out; }
    const lee = driftHeight(o.ed, o.pg, o.luUpper, o.W2), win = driftHeight(o.ed, o.pg, o.luLower, o.W2);
    if (lee.hd == null) { out.none = true; out.need = 'W2'; out.why = 'ASCE 7-22 drifts need the winter wind parameter W2'; return out; }
    out.leeward = { lu: lee.lu, hd: lee.hd };
    out.windward = { lu: win.lu, hd: 0.75 * win.hd };
    // a separate higher building (7.7.2): leeward only when s < 20 ft and s < 6h, held to (6h − s) / 6 and w to 6h − s
    if (s > 0) {
      if (s >= 20 || s >= 6 * h) { out.leeward.hd = 0; out.leeward.why = `s = ${s} ft ≥ ${s >= 20 ? '20 ft' : '6h'}: no leeward drift (7.7.2)`; }
      else { out.leeward.hd = Math.min(lee.hd, (6 * h - s) / 6); out.leeward.wMax = 6 * h - s; }
    }
    const useLee = out.leeward.hd >= out.windward.hd;
    out.gov = useLee ? 'leeward' : 'windward';
    let hd = useLee ? out.leeward.hd : out.windward.hd, w;
    if (s > 0 && useLee) w = Math.min(6 * hd, 6 * h - s);
    else if (hd <= hc) w = 4 * hd;
    else { w = Math.min(4 * hd * hd / hc, 8 * hc); hd = hc; out.capped = true; }
    if (s > 0 && useLee && hd > hc) { hd = hc; out.capped = true; }
    out.hd = hd; out.w = w; out.pd = hd * g;
    // a drift wider than the lower roof stops at its far edge at the height it has there (not run down to zero)
    if (o.lowerWidth > 0 && w > o.lowerWidth) { out.truncated = true; out.end = out.pd * (1 - o.lowerWidth / w); }
    return out;
  }
  // the drift surcharge at distance x (ft) from the step, psf
  const driftAt = (d, x) => (d && !d.none && d.w > 0 && x >= 0 && x <= d.w && (!(d.lowerWidth > 0) || x <= d.lowerWidth + 1e-9) ? d.pd * (1 - x / d.w) : 0);
  // ∫ of the drift over [a, b] ft from the step: lb per ft along the step
  function driftArea(d, a, b) {
    if (!d || d.none || !(d.w > 0)) return 0;
    const hi = Math.min(b, d.w, d.lowerWidth > 0 ? d.lowerWidth : Infinity), lo = Math.max(0, a);
    if (hi <= lo) return 0;
    const F = x => d.pd * (x - x * x / (2 * d.w));
    return F(hi) - F(lo);
  }

  /* snow sliding off an upper roof onto a lower one (7.9): an upper roof that drains onto the lower one, slippery
     steeper than 1/4 on 12 or other steeper than 2 on 12. 0.4 pf W per foot of eave (W the upper roof's eave-to-ridge
     run), spread over 15 ft of the lower roof (or its width, scaled down); a separate building only when h / s > 1 and
     s < 15 ft, over 15 − s. o: { pfUpper, Wupper, slopeUpper, slippery, lowerWidth, h, s, drains } */
  function sliding(o) {
    const out = { applies: false, why: null, perFt: 0, extent: 0, psf: 0 };
    if (!o.drains) { out.why = 'the upper roof does not drain toward the lower roof'; return out; }
    const lim = o.slippery ? 0.25 : 2;
    if (!(o.slopeUpper > lim)) { out.why = `upper roof ${o.slopeUpper}:12 is not steeper than ${lim}:12 (${o.slippery ? 'slippery' : 'not slippery'})`; return out; }
    const s = +o.s || 0;
    if (s > 0 && !(o.h / s > 1 && s < 15)) { out.why = 'separate building: h / s ≤ 1 or s ≥ 15 ft (7.9)'; return out; }
    let per = 0.4 * o.pfUpper * o.Wupper, ext = s > 0 ? 15 - s : 15;
    if (s > 0) per *= (15 - s) / 15;
    if (o.lowerWidth > 0 && o.lowerWidth < ext) { per *= o.lowerWidth / ext; ext = o.lowerWidth; }
    Object.assign(out, { applies: true, perFt: per, extent: ext, psf: per / ext });
    return out;
  }

  const api = { IS, editionOf, deg, gamma, flat, Cs, minimum, driftHeight, roof, unbalanced, stepDrift, driftAt, driftArea, sliding };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_SNOW = api;
})(typeof self !== 'undefined' ? self : this);
