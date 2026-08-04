# Civil Engineering Tools

Browser-based quote-engineering calculators. No build step, no server, no
dependencies — open the HTML files directly (double-click) or host them as
static files. Start at `index.html` (the hub) or go straight to
`beam-designer.html`.

## Steel Beam Designer (`beam-designer.html`)

Beam analysis + automatic W-shape selection per the **AISC Steel Construction
Manual, 16th Edition (AISC 360-22)**.

### Analysis
- Any support layout: simple span, multi-span continuous, cantilever,
  overhangs. Pinned or fixed supports at arbitrary locations.
- Loads by load case (DL, CL, LL, RLL, SL, WL, EL): full-length uniform loads,
  partial trapezoidal line loads, point loads, applied moments.
  Sign convention: loads positive downward; x from the left end.
- Load combinations: one-click IBC/ASCE 7 templates for ASD or LRFD
  (collateral factored with dead), fully editable factors, plus custom combos.
  Each combo can be flagged for strength and/or deflection checking with its
  own L/n limit.
- Engine: Euler–Bernoulli finite-element stiffness method (Hermitian beam
  elements, banded solver, ~240+ elements with nodes at every load and
  support). Exact in-element moment extremes are located by solving V(x)=0.
- Output per combo: shear / moment / deflection diagrams, reactions
  (including fixed-end moments), left/right shear, max moment @ x,
  max deflection @ x, and L/n deflection ratio — formatted like a typical
  metal-building beam analysis printout.

### Design (AISC 360-22)
- **Flexure (Ch. F):** F2 yielding (Mp) and lateral-torsional buckling with
  user Lb and Cb (Lp, Lr, F2-2 interpolation, F2-3/F2-4 elastic LTB), F3
  flange local buckling for noncompact/slender flanges. φb = 0.90, Ωb = 1.67.
- **Shear (Ch. G):** G2.1, Vn = 0.6·Fy·Aw·Cv1 with the φv = 1.00 / Ωv = 1.50
  case for stocky webs and Cv1 reduction otherwise.
- **Deflection:** per-combo L/n checks. Span between supports is used for L;
  2× the overhang length for cantilevers/overhangs.
- Optional beam self-weight (superposed into DL), max/min depth limits,
  editable Fy and E, ASD or LRFD.
- Selection scans all 289 W-shapes (AISC Shapes Database properties, sorted
  lightest first) and reports the lightest adequate shape, the top candidates
  with unity ratios, the lightest adequate shape per depth series, and a full
  printable check report (section properties, Mp/Lp/Lr, governing limit
  state, Cv1, deflection table) for any shape you pick.

### Files
| File | Purpose |
| --- | --- |
| `beam-designer.html` | The tool (UI) |
| `js/beam-engine.js` | Analysis + AISC design engine (framework-free, also loadable in Node) |
| `js/aisc-shapes.js` | W-shape section property database (289 shapes) |
| `tests/run-tests.js` | Verification suite — `node civil-tools/tests/run-tests.js` |
| `index.html` | Tools hub landing page |

### Verification
`tests/run-tests.js` checks the engine against closed-form beam theory
(AISC Manual Table 3-23 cases: simple span point/UDL, cantilever, fixed-fixed,
two-span continuous, overhang statics) and AISC Manual design values
(Table 3-2: W21X44 φMp = 358 k-ft, Lp = 4.45 ft, Lr = 13.0 ft, φVn = 217 k,
Mp/Ω = 238 k-ft; W21X48 noncompact-flange φMn = 398 k-ft; BF interpolation at
Lb = 6 ft), plus full design runs with deflection governing and self-weight
superposition. 40 assertions, all passing.

> **Disclaimer:** engineering design aid. All results must be reviewed and
> sealed by a licensed professional engineer. Not a substitute for the
> governing building code or project specifications.
