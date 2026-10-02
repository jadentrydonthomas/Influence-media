# Mezzanine Design

Upload a Project Confirmation Summary (eQuote PCS) PDF and get the mezzanine **beam sections**, **column sections**, spans, tribs and quantities for the quote. The tool does the input side of the NBG *Mezzanine Beam Design* and *Mezzanine Column* workbooks with the same math, so the numbers can be typed into Excel to confirm.

**Use it:** open `index.html` in Chrome or Edge. It is one self-contained file: it works offline, and the PDF is read locally and never uploaded.

## What it does

1. **Reads the PCS.**
   - Box 22: dead, live and collateral loads; slab; footprint and start location; rows A–F; joist spacing; seat depth.
   - The blue handwritten values (PDF FreeText annotations), used wherever a row says TBD.
   - The material, floor-use and "provided by seller" checkboxes.
   - Box 2: bays, endwall column spacing and soldier columns.
   - Box 3: building code, which picks the workbook edition.
   - Box 5: frame interior modules.
2. **Lays out the framing.**
   - Grid lines inside the footprint become beam lines and support lines.
   - Beams run the shorter span (DM 15.1.1.3). On a tie, the layout with fewer beams wins.
   - Each beam's trib is half the distance to the next beam line on each side.
   - Every support that is not a building column (sidewall, endwall, interior frame or soldier column) is a ⊗ mezzanine column.
   - **Floor plan check.** The floor-plan page has no text layer, but its geometry can be read:
     - The grid bubbles register the drawing to the bays.
     - Every ⊗ mezzanine-column symbol is snapped to a grid intersection.
     - The result is compared with the derived columns. The tool says whether they match, or which joist direction or beam lines would.
   - The framing plan is drawn with those ⊗ overlaid, so you can confirm it at a glance.
3. **Sizes the beams** the way the MB sheet is iterated by hand:
   - Tries every DM 5.1-stocked web and flange for the division (flanges ≥ 6" × 1/4"), whole-inch depths 10–30" by default.
   - Keeps sections with combined and shear SR ≤ 0.99, LL ≤ L/360, TL ≤ L/240, and a passing joist-bearing check (MB `L7`).
   - **Three options per mark**, side by side:
     - *Lightest*: minimum weight of every stocked combination that passes.
     - *Best fit*: the shallowest depth within 8% of the lightest weight.
     - *Headroom*: the lightest section with d ≤ A − B − slab − seat (the total joist depth), so the beam stays inside the joist zone. If nothing passes there, the lightest 8"-flange alternative.
   - Pick an option (or a row in the depth table) and the choice is kept as intent: change a load, the slab or a clearance and it re-designs that option instead of pinning an old section.
   - **Beam marks over the whole job: interior and exterior** (see below). A mark is designed once, at its longest span and largest trib. Its shorter beams keep the section and get their own MB-sheet run.
4. **Sizes the columns** on the Column sheet:
   - Loads are the left and right beam reactions (MB `H6` dead, `H10` live), with e = d/2, the three load combinations, and column self-weight.
   - Tries W10X22, W8X24 and W12X26, lightest first. One section goes on the quote for every mezzanine column of the job (every mezzanine): the lightest that passes every load case. If none of the three passes, it takes the next heavier W and quotes it as `BU{d}x{wt}`, per the training guide. *Settings → Column section* can size each mezzanine on its own instead.
   - Column length defaults to finish floor → top of mezzanine (A). You can switch to *clear below beam* in Settings.
5. **Quote sheet.** The three quote-sheet tables, in the workbook's column order, ready to paste into Excel (tab-separated):
   - *Mezz. Design Information*: MEZZ, FF El., SLAB, WT-NW/LW, DL, COL, LL, PART.
   - *Mezz. Beams*: SPAN, TRIB, DLᴛ (= DL + COL), LLᴛ, SECTION, END WT (40), QTY. One holistic set for the job: a row per mark and member length (the notes say which beams, on which lines, of which mezzanine).
   - *Mezz. Columns*: HEIGHT, TRIB. AREA (worst column), SECTION, END WT (46), QTY. A row per section and height over the job.
6. **3D framing model.** Beams as I-shapes at the T/beam elevation, W columns with cap and base plates, building-column stubs, open-web joists at the spacing and a translucent slab. Drag to orbit, scroll to zoom, click a member for its calc.

### Beam marks: interior and exterior

The beams of the whole job, every mezzanine together, are put in two marks. This is the default; *Settings → Beam marks* also offers one governing mark, or the split-by-trib guide.

- **Exterior:** an edge beam with joists on one side only. The largest exterior trib is the exterior design trib, and every edge beam uses it (a 10'-0" edge is designed with the 12'-4" one).
- **Interior:** any beam carrying more than the largest exterior trib. That includes an edge beam that also takes a neighbouring mezzanine's joists. All of them are designed for the largest interior trib.
- **Each mark:** designed at its longest span and its largest trib. MB1 is the larger of the two (span × trib), and the labels stay MB1 / MB2 for the spreadsheet.
- **Shorter beams in a mark** keep the mark's section; the size doesn't change. Each member length gets its own MB-sheet run at that length and the mark's trib, its own quote row, and its own chip on the Beam calc page.
- **Picks are job-wide.** An option or depth picked for a mark goes on every mezzanine, because it is one member.
- **Column and frame loads** use each beam's own span and trib with its mark's section (MB `H6` / `H10`), so a lighter exterior beam also brings a lighter reaction.

### Several mezzanines in one job

Every mezzanine in Box 22 (including "22) MEZZANINES (CONTINUED)" pages) is read and designed **together**. Pick which one is on screen at the top; the quote sheet lists the rows of all of them.

- **Shared beam line.** When two mezzanines put a beam on the same line (e.g. the edge between them), it is one member. The mezzanine with more beam length on that line keeps it and also carries the other's edge trib; the other one doesn't count it. If the other edge covers only part of a span, the beam is designed for the uniform trib that gives the same maximum moment and end shear, rounded up to the inch. That keeps the beam sheet (uniform load only) conservative. If the neighbour's psf is heavier, its trib is scaled up by the load ratio.
- **Shared column.** A column at the same location in two mezzanines is one column. Its Column-sheet Left / Right reactions come from the beams of both, the Column page lists which beam each comes from, and it is counted once (with the mezzanine that loads it most).
- **Edges a few inches off a grid line** (95'-8" vs the 96'-0" column line) are framed on that line, with the overhang added to the edge trib.

### Read off the floor plan (last page)

The plan has no text layer, so its geometry is read:

- **Joist direction** from the "Mez. Jst." arrows inside each mezzanine. This sets where the beams go; the auto rule (beams on the shorter span) is only used when no arrow is found, and the other direction is offered on the Plan page.
- **Mezzanine columns:** both symbol styles, ⊗ and circled-I, are checked against the layout of every mezzanine.
- **Grid letters as drawn.** Bubbles on both endwalls, column lines and the ridge are lettered from the BSW, skipping I and O, so "2/C" in the notes is the drawing's 2/C.

Example W0S-26160 (two mezzanines, "BSW" and "LEW", sharing the 96' line). B = 9'-0", seat 5", joists @ 4'-0", no C requirement:

| Mark | Section | Designed at | Beams | Qty |
|---|---|---|---|---|
| MB1 interior | BU28x50 | 28'-0" × 20'-0" | BSW B1, B2 (line C, 12'-4" + LEW edge 7'-8"); LEW B3 (line D, 18'-0") | 3 |
| | same | run at 12'-4" | LEW B4 (line D, 40'-4" − 28'-0") | 1 |
| MB2 exterior | BU26x36 | 28'-0" × 12'-4" | BSW B3–B5 (line C), B6–B10 (line A); LEW B1 (line E) | 9 |
| | same | run at 12'-4" | LEW B2 (line E) | 1 |
| Columns | W8X24 | 11'-6" | BSW 2/C–5/C; LEW 2/D, 40'-4"/D, 40'-4"/E | 7 |

All 7 columns match the drawing. Example W2H-26018 (one mezzanine) comes out MB1 interior BU24x30 × 4 at 20'-0" × 20'-0", MB2 exterior BU15x21 × 4 at 20'-0" × 10'-0", W10X22 × 4.

### The Design page, top to bottom

1. **The design**: sections, beam and column counts, steel weight, and **Floor loads to the frame**. That is the MB sheet's *Floor dead load (unfactored)* and *Floor live load (unfactored)* shear at left / right, in kips, per beam mark. The same two rows are highlighted on the Beam calc sheet. The Plan page lists the summed D / L that lands on each building column (the load into the frame).
2. **3D framing model**, then the **framing summary** (beams → governing ratio → columns, floor-plan check).
3. **Beam options** (Lightest / Best fit / Headroom) to pick from.
4. **Checks & decisions**: check before quoting, confirmed against the PCS, design decisions, how it was read.
5. **Quote sheet** rows for every mezzanine.

The sidebar shows the mezzanine turning in **3D** or as a labelled **Plan** (grid bubbles, B# beams, C# columns, building columns). The plan lights what you are reviewing: the column case on Column calc, the mark's beams on Beam calc. Click a column or beam to open its calc, or ⤢ to see the plan large beside the page.

The Beam calc page lists the job's marks (MB1 · interior, MB2 · exterior) and, under them, a chip per member length: the designed run and each shorter one, with which beams it covers and its ratio. The MB sheet and the drawing follow the chip. The page opens with a drawing of the mark: the uniform load (D + L in klf), joists at the unbraced length, reactions, the deflected shape, member length, and moment and shear diagrams. Beside it is the BU section to scale with its plates. The Column calc page draws the case: the W column with cap and base plates, the left and right beams on it, both reactions (D / L kips) at e = d/2, the height, and the W section to scale. A table underneath lists each beam's span and trib, so you can see why one column carries more than another.

On the Column calc page every case is named like the plan (*C1 · 2/C*) with its max CSR. A left / right diagram shows which beam, from which mezzanine, gives each Column-sheet reaction.

### Jobs remembered

When a job is fully designed it is saved in the browser on that computer: the values you typed for open fields, the option you picked, the joist direction and the sections. Next time:

- **Your usual values come first.** An open field offers what you entered most on other jobs ("your usual · 3 jobs").
- **Re-opening the same quote** offers your entries from last time in one click.
- **Option hint.** The Beam options header says which option you usually quote.

The design math never changes with history; it stays the NBG sheets. Settings → *Jobs remembered* can export the list as JSON (to send in so the jobs become regression tests), import it on another computer, or forget it.

### Nothing assumed

When the PCS leaves a value TBD with no blue note, the design does not run on a guess. A **Needs your input** card at the top of the Design page asks for it, with one-click typical values, and shows the total joist depth A − B − slab − seat as it fills in. On a job with several mezzanines, one entry fills every mezzanine that is missing that value.

| Value | Typical values offered |
|---|---|
| (B) min. clearance under joist | 9'-0" (conservative headroom) |
| (C) min. clearance under support beams | same as B, or **No requirement** (entered, never assumed). It caps the beam depth at (A − C)·12 − slab − seat, so it shapes all three options |
| Joist spacing (= beam unbraced length) | 4'-0", 5'-0" (NBG max) |
| Joist seat depth | 2 1/2" (K-series), 5" (LH-series) |
| (A) top of mezzanine, slab, loads, footprint | — (type them) |

The dead load is the one value the tool fills itself when Box 22 says *Per Seller*: it is worked out from the slab, deck and concrete (below) and flagged when it is an estimate.

With several mezzanines, a card per mezzanine sits at the top of every page (size, sections, status) — click one to switch. Edits on the Inputs page go to **every mezzanine** by default (loads, elevations, clearances, joists; the footprint is always per mezzanine), or only the one on screen.

When the lightest section already fits under the headroom limit (e.g. C caps every depth), there is no separate Headroom option — the Lightest card says it is already within the limit.

Notes on the Design page are grouped: **Check before quoting** (flags), **Confirmed against the PCS** (e.g. the floor plan matched, joist arrows read), **Design decisions** (shared beams and columns, snapped edges, joist direction), and a collapsed **How it was read** list.

Total joist depth is **A − B − slab − seat**. It feeds the INPUT-sheet clearance check (B provided) and the Headroom option's depth limit.

### Dead load by deck and concrete

When Box 22 gives a number, that number is used. When it says *Per Seller*, the dead load comes from the deck guide and follows the slab, deck type and concrete:

| Slab / deck / concrete | Dead load | Source |
|---|---|---|
| 4" NW on 1.0C | 43 psf | deck guide |
| 3½" NW on 1.0C | 37 psf | deck guide |
| other thickness, deeper deck (1.3C–3VL rib voids) or LW (110 pcf) | scaled from 43 psf @ 4" NW | estimate, flagged — confirm against the deck guide |

The deck type comes from Box 22 *Deck Type* (1.0C when it says Per Seller) and NW/LW from the material checkbox. Both can be changed on the Inputs page, and the dead load follows until you type one in by hand.

## Verification

`src/engine.js` is a cell-for-cell port of the workbooks' Main Report, Secondary Report, Chapter B–H sheets, the VBA UDFs, the MB sheet and the Column sheet (ASD). It keeps the workbook quirks: Excel MIN/MAX skipping `--`, the `ftnVn` operator precedence, Ω = 1.667 for compression, weight = Ag × 3.403, and so on.

It was checked against the real workbooks, run headless in LibreOffice with `oracle/`:

| Workbook | Cases | Comparisons | Mismatches |
|---|---|---|---|
| Mezzanine Beam Design 15th | 400 random (incl. long Lb, axial, unequal flanges) | 7,600 | 0 |
| Mezzanine Beam Design 16th | 120 | 2,280 | 0 |
| Mezzanine Beam Design 13th | 250 | 3,750 | 0 |
| Mezzanine Column 15th / S16-14 | 300 (W and BU) | 3,600 | 0 |
| Mezzanine Column 16th / S16-19 | 120 | 1,440 | 0 |

Compared: SR, shear, deflections, reactions, the description string, the OK/NG text, and the concentrated-load checks. Tolerance is 0.2%.

On top of the random sweeps, every section the tool actually picks in the variant loop (below) is run back through the workbooks: 63 beams (13th / 15th / 16th) and 147 column load cases (15th / 16th), 2,877 comparisons, 0 mismatches — and the workbook itself reads COMBINED OK / SHEAR OK and OK on all three column combinations for every one.

**Both example jobs, tied to the workbooks** (15th sheets, 103 beam runs and 24 column runs, 2,245 comparisons, 0 mismatches). Checked on the workbook's own outputs:

- Every MB-sheet run of every mark passes, at both member lengths: COMBINED OK, SHEAR OK, Main Report OK, L/360, L/240 and joist bearing.
- The lightest section at every depth of each mark's search passes. The lightest of those is the quote section.
- Every column case's left / right dead and live equals the sum of the workbook end shears (MB `H6` / `H10`) of the beams framing in. The loads to the frame at each building column check the same way.
- The job's W passes all three combinations of every column case on the Column sheet, and every lighter W fails at least one.

### Variant loop

`test/variants.test.js` re-reads the example PCS as phrases, edits it the ways other jobs differ, and designs each variant on the 13th, 15th and 16th sheets with each of the three options (90 designs, plus the three code-year runs):

- numeric dead load on the PCS; IBC 2015 / 2018 / 2024 code lines (edition picked automatically; a state code with only an ASCE 7 year maps through it);
- mezzanine offset from the LEW with an edge off the grid; a narrower mezzanine set in from the FSW;
- interior frame columns; deck type written on the PCS; lightweight concrete checked;
- requested B / C / seat / joist spacing filled in instead of blue notes;
- a second mezzanine on a continuation page (storage, 250 psf).

Every beam must pass SR ≤ 0.99 with L/360 and L/240, *lightest* must be the lightest, every column group must pass, and no quote row may contain an empty or NaN value.

`test/multi.test.js` covers side-by-side mezzanines (a shared column gets both reactions and is counted once), stacked ones (a shared beam line carries both tribs; heavier neighbour loads scale up), the equivalent-trib math, and the two-mezzanine PCS when it is present.

## Develop

```bash
npm install            # pdfjs-dist 3.11.174 (inlined into the build)
npm run build          # -> index.html
npm test               # guide examples, layout cases, parser; full example job + variant loop if private/pcs/ has the PDF
npm run e2e            # drive index.html in Chromium: load, every control, 3D pick, copy, manual entry
MZ_DUMP=oracle/out node test/variants.test.js   # also write the picked sections as oracle cases
```

The oracle needs LibreOffice Calc and the workbooks in `private/workbooks/`:

```bash
node oracle/gen_cases.js beam 400 11 > oracle/out/beam.json
python3 oracle/beam_oracle.py oracle/out/beam.json oracle/out/beam_res.json Mezzanine_Beam_Design_15th.xls
node oracle/compare.js beam oracle/out/beam.json oracle/out/beam_res.json 15

# one job, end to end: every MB run, depth-table row, beam end shear and column case it rests on
node oracle/job_dump.js private/pcs/JOB.pdf oracle/out/job
python3 oracle/beam_oracle.py oracle/out/job_beam.json oracle/out/job_beam_res.json Mezzanine_Beam_Design_15th.xls
python3 oracle/col_oracle.py oracle/out/job_col.json oracle/out/job_col_res.json Mezzanine_Column_15th_S16-14.xls
node oracle/job_ties.js oracle/out/job
```

`private/` is gitignored. The NBG workbooks, design manuals and customer PCS files never go in this public repo.

## Notes and limits

- **Editions (IBC chapter 35):** IBC 2024 → AISC 360-22 (16th sheets); IBC 2018 / 2021 → AISC 360-16 (15th); IBC 2012 / 2015 → AISC 360-10, run on the 13th sheet since no 14th exists (flagged); IBC 2006 / 2009 → AISC 360-05 (13th). A state code with no IBC year maps through its IBC base (Massachusetts 9th / 10th Ed. → IBC 2015 / 2021, Florida 7th / 8th → IBC 2018 / 2021, California 2019 / 2022 / 2025 → IBC 2018 / 2021 / 2024). If the state code isn't in that table, its ASCE 7 year is used: 7-22 → IBC 2024, 7-16 → IBC 2018 / 2021, 7-10 → IBC 2012 / 2015.
- **Editions, short form:** IBC 2018/2021 → 15th and IBC 2024 → 16th. IBC ≤ 2015 → 13th beam sheet (Q-factor compression, kv = 5, 360-05 shear and rt, no joist-bearing check), with the 15th column sheet since there is no 13th column sheet. All three are verified. NBCC (CSA S16) jobs are flagged to run in the S16 workbooks.
- **16th-edition column sheet:** Lby (C10) is hard-coded to 120 in. The tool uses L × 12. Type L × 12 into C10 when you check a job in Excel.
- **Materials other than deck + concrete**, and the "Designed For Load Provisions Only" box, are flagged. The quote engineer runs those by hand.
- **Dead load when the PCS says "Per Seller":** see the table above. Only 4" and 3½" NW on 1.0C are exact deck-guide values; everything else is flagged as an estimate.
- **Beam lines under 12' apart** (an interior frame column line between endwall lines, or a mezzanine edge just off a grid line) are kept, because they are real supports, but noted — drop a line on the Plan page if the joists should span past it.
