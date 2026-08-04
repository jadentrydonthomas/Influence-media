# Civil Engineering Tools

Browser-based quote-engineering calculators. No server, no dependencies —
`beam-designer.html` is fully self-contained (database and engine inlined):
double-click it, or host the folder as static files. Start at `index.html`
(the hub) or go straight to the tool.

Development: the tool is assembled from `src/ui.html` + `js/*.js` by
`node civil-tools/build.js` (run it after editing any of those sources to
regenerate `beam-designer.html`).

## Steel Beam Designer (`beam-designer.html`)

Beam analysis + automatic W-shape selection per the **AISC Steel Construction
Manual, 16th Edition (AISC 360-22)**. Light/dark themed, interactive
diagrams with a hover probe (V / M / δ at any x), beam schematic with load
and support glyphs, and a printable calculation report.

**Layout:** inputs across the top — Beam & Supports (left), Loads (double
width, one labeled panel per load type), then a Design Criteria bar —
with results below. `Run design` re-selects the lightest adequate section.

**Saving:** `Save` downloads the whole beam (geometry, loads, criteria,
combinations, project info) as a `.json` file; `Open` restores it; work is
also auto-saved in the browser and restored on refresh. `Reset` clears it.

**Input validation:** out-of-range or incomplete entries (a load past the
end of the beam, a line load with x2 ≤ x1, a support off the member) are
listed in a warning banner and excluded from the analysis rather than
silently freezing the results.

### Analysis
- Any support layout: simple span, multi-span continuous, cantilever,
  overhangs. Pinned or fixed supports at arbitrary locations.
- Loads by load case (DL, CL, LL, RLL, SL, WL, EL): area loads × tributary
  width (mezzanine-style psf input), full-length uniform loads, partial
  trapezoidal line loads, point loads, applied moments, and member axial
  load (drag/brace force, + compression / − tension).
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
- **Axial + combined (Ch. E / Ch. H):** compression capacity per E3 flexural
  buckling (both axes, user KLx/KLy), E4 torsional buckling, and E7
  slender-element reduction; tension per D2 gross yielding. Axial is paired
  with each strength combo's moment and checked through the H1-1a/H1-1b
  interaction (first-order, no amplification — same assumption as typical
  mezzanine beam workbooks). KL/r > 200 is flagged.
- **Deflection:** per-combo L/n checks. Span between supports is used for L;
  2× the overhang length for cantilevers/overhangs.
- Optional beam self-weight (superposed into DL), max/min depth limits,
  editable Fy and E, ASD or LRFD.
- **Section pool:** defaults to the NBG stock wide-flange inventory
  (NBG Design Manual §5.1.5.1.1 — W8X10, W8X18, W8X24, W10X12, W10X15,
  W10X22, W12X14, W12X26, with per-division availability), switchable to
  the full 289-shape database. When no stocked section works, the lightest
  non-stock alternative is suggested; manually checked non-stock shapes are
  tagged NON-STOCK.
- Selection scans the section pool in ascending weight order and reports the
  lightest adequate shape, the passing candidates with unity ratios, and the
  lightest adequate shape per depth series.

### Calculation report
A separate report view (and the only thing that prints) documenting the run:
project fields, geometry and load echo, the combination table, reactions and
member results for every combination, the selection narrative, the full
member check, a **References Used** table, and notes & assumptions. Every
check box carries a *Source:* line citing the governing specification
section, equation numbers, and the equivalent AISC Manual table — e.g.
§F2 Eq. F2-1…F2-6 with Manual Part 3 Tables 3-2 and 3-10 for flexure,
§G2.1 Eq. G2-1 for shear, §E3/§E4/§E7 and §H1.1 Eq. H1-1a/H1-1b with Part 4
Table 4-1 for axial and combined loading, Part 1 Table 1-1 for section
properties, Part 3 Table 3-23 for the beam formulas used to verify the
engine, and IBC Table 1604.3 for deflection limits. References are given by
section / equation / table number rather than page number, since those
identifiers stay valid across printings.

### Files
| File | Purpose |
| --- | --- |
| `beam-designer.html` | The tool — self-contained build output, open directly |
| `src/ui.html` | UI source (markup, styles, app code) |
| `js/beam-engine.js` | Analysis + AISC design engine (framework-free, also loadable in Node) |
| `js/aisc-shapes.js` | W-shape section property database (289 shapes) |
| `build.js` | Inlines engine + database into `beam-designer.html` |
| `tests/run-tests.js` | Verification suite — `node civil-tools/tests/run-tests.js` |
| `index.html` | Tools hub landing page |

### Verification
`tests/run-tests.js` checks the engine against closed-form beam theory
(AISC Manual Table 3-23 cases: simple span point/UDL, cantilever, fixed-fixed,
two-span continuous, overhang statics) and AISC Manual design values
(Table 3-2: W21X44 φMp = 358 k-ft, Lp = 4.45 ft, Lr = 13.0 ft, φVn = 217 k,
Mp/Ω = 238 k-ft; W21X48 noncompact-flange φMn = 398 k-ft; BF interpolation at
Lb = 6 ft; Table 4-1: W14X43 φPn = 422 k at KL = 10 ft), plus full design
runs with deflection governing, self-weight superposition, slender-web E7
reduction, and H1-1 combined-loading wiring. 50 assertions, all passing.

> **Disclaimer:** engineering design aid. All results must be reviewed and
> sealed by a licensed professional engineer. Not a substitute for the
> governing building code or project specifications.
