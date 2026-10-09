# Requirements ledger

Every requirement the engineer has set for the tool, in the order it was given, with where it is met and how it is
checked. The review loop works through this list; a requirement is only marked met when the check named here passes.

## Foundation — the spreadsheets

| # | Requirement | Where | Check |
|---|---|---|---|
| F1 | Upload the eQuote PCS; read Box 22 (every mezzanine), Box 2 / 5 (building, frames), the floor plan | `pcs.js`, `plan.js` | `test/pcs`, `job3`, `job4`, `multi` |
| F2 | Use the NBG spreadsheets exactly — the tool does the input side; the MB sheet, INPUT sheet and Column sheet give the answers | `engine.js` (cell-for-cell port) | `oracle/*` against the real workbooks |
| F3 | The right sheet for the code: IBC 2021 → AISC 15th, IBC 2024 → 16th, older → 13th | `run.js resolveEdition` | `test/variants` |
| F4 | Dead load from the deck guide (4" NW on 1.0C = 43 psf), collateral, live, joist weight 8 psf | `design.js deadLoadFor` | `test/engine` |
| F5 | Total joist depth = A − B − slab − seat; nothing assumed — missing values are asked for | `run.js prepare`, need card | `e2e` |
| F6 | Member length = bay, unbraced length = joist spacing, trib = worst-case beam (input allowed) | `layout.js`, Beam calc inputs | `test/layout` |
| F7 | Iterate BU depths / webs / flanges to SR ≤ 0.99 with the deflection limits met — not over-conservative | `design.js designBeam` | `test/engine`, oracle |
| F8 | Columns: length = A, left / right D and L from the MB sheet, common W sizes first, one size for the job | `design.js designColumn` | `oracle/col_oracle` |
| F9 | Quantities from the floor plan (⊗ mezzanine columns; I frame columns; ✱ most-economical frame columns) | `plan.js` | `test/plan`, `job3`, `job4` |
| F10 | Filled copies of the real workbooks (beam, column, seismic) to download and walk an engineer through | `xls.js`, Workbooks panel | `test/xls`, `oracle/fill_check` |

## Design

| # | Requirement | Where | Check |
|---|---|---|---|
| D1 | Beam options: Lightest, Best fit, Most economical — a few different designs, two may merge, never all one card when others exist | `design.js beamOptions` | `test/options` |
| D2 | Best fit by the quote engineer's method (deepest allowed → web → F8.31 up → depth out → lighter plate; the lesser-depth alternate) | `design.js` | `test/options` |
| D3 | Most economical by NBG Economical Flange Sections (green; 8" then 10" then 12") | `design.js` | `test/options` |
| D4 | NBG Production Guidelines / DPM limits and DM 5.1 stock are hard limits | `design.js prodRule`, stock tables | `test/engine` |
| D5 | Interior / exterior marks by trib; shorter spans get their own MB run; one holistic job | `run.js jobMarks` | `test/multi`, `job3` |
| D6 | Beam calc inputs (design span / trib) change the MB sheet only — the plan and the loads to the frame stay | `run.js designMark` | `test/job3`, e2e |
| D7 | Design your own beam and column (MB / Column sheet inputs → results, DL and LL); use it for a mark | Design your own page | e2e |
| D8 | Edit the layout: place / remove beam and column lines, remove a column, make a mezzanine column a frame column | Plan page edit mode | `test/layout`, e2e |
| D9 | Explanations of every decision, folded (beam and column), not spread over the page | Beam / Column pages | e2e |

## Frame and seismic

| # | Requirement | Where | Check |
|---|---|---|---|
| S1 | Floor dead and floor live to the frame, easy to see; hover any column for its D / L | Design, Plan | e2e |
| S2 | NBG Frame files with FDL / FLL (WebCenterline) and EQR / EQL that open without errors; short names | `framefile.js` | `test/framefile`, e2e |
| S3 | Loads at the mezzanine level A (11'-6", not T/beam 10'-9") | `framefile.js` | `test/framefile` |
| S4 | Seismic by the IBC Seismic workbook: code, building, mezzanine loads, each frame's strip and loading area → mezzanine force per frame; bracing force | `seismic.js`, Seismic page | `oracle/seismic_check`, `fill_check` |
| S5 | EQR + (Bottom/Right) / EQL − (Top/Left) at the mezzanine elevation on the columns the mezzanine frames into | `framefile.js` | `test/seismic`, e2e |
| S6 | Edit the EQ loads — all at once or each one; what is typed is what the files get | Seismic step 5, frame cards | `test/seismic`, e2e |

## Presentation

| # | Requirement | Where | Check |
|---|---|---|---|
| P1 | Nucor / Astra look, clean, professional; no clutter or filler wording; strong contrast (not washed-out grey) | `app.css`, every page | review loop |
| P2 | Design page order: the design (3D) → framing summary → beam options → checks → quote sheet | `app.html` | e2e |
| P3 | Sidebar 3D, centred, click for a labelled floor plan | sidebar | e2e |
| P4 | Proper beam and column drawings with loads | Beam / Column pages | review |
| P5 | Column names clear (C-number and grid point) | everywhere | review |
| P6 | Calc package at the bottom of the calcs: the inputs, the sources (which spreadsheet, shop limits, metrics), exportable | Beam / Column pages | `test/xlsx`, e2e |
| P7 | Easy to navigate, simple to use | nav, page structure | review loop |
| P8 | Remembers jobs (learns usual values) | Settings | e2e |
| P9 | Everything stays on the computer (single HTML, no uploads) | — | review |
