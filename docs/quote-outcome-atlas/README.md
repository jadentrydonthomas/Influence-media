# Quote Outcome Atlas

Offline, single-file management dashboard that turns Nucor Building Systems weekly
quote books and order-log exports into a quote-to-order outcome view.

| Path | What it is |
| --- | --- |
| `app/quote-conversion-atlas-shareable.html` | The deliverable. One self-contained file — open by double-click, no server, no network. |
| `QUOTE_OUTCOME_ATLAS_HANDOFF_SPEC.md` | Product and engineering contract (v2.0). |
| `handoff-spec.html` | Designed reading version of the same spec. |
| `fixtures/` | Real Week 1–3 2026 quote books and `OrderLog_1-10.xlsx`, used by the tests. |
| `test/regression.mjs` | Drives the real dashboard in Chromium against the fixtures and asserts the baseline. |
| `test/edge-cases.mjs` | Runs seven awkward source combinations (single week, gaps, duplicates, out-of-order, 20 weeks). |
| `test/scale-check.mjs` | Renders the weekly chart at 1, 4, 12, 26 and 52 weeks and checks no axis labels collide. |
| `test/deck-shots.mjs` | Regenerates the deck, screenshots every slide, audits for overflow and text under the nav. |
| `test/print-check.mjs` | Confirms every slide prints and produces a PDF. |
| `test/error-paths.mjs` | Five ways to pick the wrong file; each must stop with a specific message. |
| `test/boss-scenario.mjs` | Copy to another folder, clean profile, offline, four consecutive runs. |
| `test/audit.py` | Recomputes every figure from the workbooks with openpyxl and compares. |
| `test/a11y.mjs` | Accessible names, keyboard reach, focus rings, reduced motion. |

## Running the regression suite

```bash
npm install
node test/regression.mjs
```

33 assertions cover the core outcome figures, the data-quality exceptions, coverage
labelling, and the exported deck. Spec `T-16` requires these to stay green after any
change to parsing, joins, ownership, exposure, or metrics.

Set `CHROME_PATH` if your Chromium lives somewhere other than the default.

```bash
node test/edge-cases.mjs    # 7 source combinations
node test/scale-check.mjs   # weekly chart from 1 to 52 weeks
node test/deck-shots.mjs    # deck screenshots + overflow audit
node test/print-check.mjs   # print / PDF path
node test/error-paths.mjs   # what happens when the wrong file is picked
node test/boss-scenario.mjs # copy to another folder, clean profile, offline, repeat runs
node test/dump-figures.mjs && python3 test/audit.py   # independent recomputation
node test/a11y.mjs          # keyboard, focus, labelling, reduced motion
node test/first-run.mjs     # what a first-time recipient lands on
```

`audit.py` reads the workbooks with openpyxl and recomputes every headline figure
from scratch, sharing no code with the dashboard, then compares against what the
dashboard actually displayed. 28/28 agree across all three exposure lenses.

## The exported deck

Nine slides, generated from the active exposure cohort:

1. Executive outcome — conversion, quoted value, confirmed value, Wilson interval
2. Quote outcome — confirmed vs unconverted, proportional split
3. Weekly pulse — volume columns above, conversion line below, scales to any span
4. **Value band analysis** — conversion by quoted value band
5. Release timing — on-time rate with its scored denominator
6. Commercial continuity — customers, booked tons, district mix
7. **Speed to order** — quote-to-order lag distribution and booked tons by entry week
8. **Estimating capacity** — scheduled vs actual engineering hours by engineer, with turnaround
9. **Review agenda** — highest-value work with no linked order, by quote, owner and value

Charts are inline SVG sized from the data. Entrance motion is layered on top of an
already-correct static state, so a chart still reads if animation never runs, and is
disabled under `prefers-reduced-motion` and when printing.

## Fixture baseline (Weeks 1–3 + OrderLog 1-10, 30+ day exposure)

| Check | Value |
| --- | --- |
| Quote rows → opportunities | 184 → 174 |
| Quote wins / booked jobs | 23 / 24 |
| Conversion | 13.2% |
| Quoted value | $150.1M |
| Order rows | 160 (72 blank `Quote #`, 1 non-standard, 87 parsable) |
| Order-log cutoff | 13 Mar 2026 |
| On-time (met the due date) | 86.2% across 174 of 174 |
| Alternates | 112 (0.64 per quote) |
| Average turnaround | 5.1 days · 37% inside three days |
| Engineering hours | 256 actual vs 229 scheduled · 11.6% over plan |

These reproduce the full Week 1–10 baseline behaviour in §12 of the spec: the same
72/1/87 split of order rows and the same single non-standard reference
(`P-0287-025-2`).

## Estimating operations

A fourth screen carries what the estimating group's own reporting tracks, drawn from
weekly columns that were parsed but never shown:

- **Alternates** (column G) — quoted work with no separate quote number. 112 sit behind
  174 quotes in the fixtures, so ~39% of what was priced never appears in a quote count.
- **Turnaround** (Date In → Done) split 1 / 2-3 / 4-5 / 6+ days, using the same
  "under 15 days" bound their reports apply, with the excluded count stated.
- **Scheduled vs actual engineering hours** (columns K and O) — whether a quote consumed
  the time set aside for it. This has no equivalent in the outcome view: conversion says
  whether work came back, this says what it cost to produce.

Engineering hours belong to the quote **engineer**; quotes and alternates belong to the
**estimator**. The source workbook and the estimating group both treat the roles that way.

## Notes for the next engineer

- Quote ownership always comes from the weekly workbook (`SCHR` / `ENGR.` / `CHK`).
  Order-log roles are linked-job context only and must never overwrite it.
- `Week 2 - 2026.xlsm` carries a wrong Monday year (2025). The parser recovers it from
  the filename sequence and reports the correction — do not "fix" this by trusting the
  cell.
- The `Inventory` sheet holds four separate blocks. Only `Estimator List` and
  `Engineer List` are Name/Initials. The top block is Name/**Territory** and must not be
  read as initials.
- The `On-Time` column is three-state. `N/A` means delivered **on** the due date, which
  counts as on time — it is not missing data. Verified against `Due`/`Done` on every
  fixture row. Any surface showing the rate must carry its denominator, and the parser
  cross-checks each written result against its own dates.
