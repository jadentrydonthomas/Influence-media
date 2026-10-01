# Mezzanine Quick-Design

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
4. **Sizes the columns** on the Column sheet:
   - Loads are the left and right beam reactions (MB `H6` dead, `H10` live), with e = d/2, the three load combinations, and column self-weight.
   - Tries W10X22, W8X24 and W12X26, lightest first. One section goes on the quote for every mezzanine column: the lightest that passes every load group. If none of the three passes, it takes the next heavier W and quotes it as `BU{d}x{wt}`, per the training guide.
   - Column length defaults to finish floor → top of mezzanine (A). You can switch to *clear below beam* in Settings.
5. **Quote sheet.** The three quote-sheet tables, in the workbook's column order, ready to paste into Excel (tab-separated):
   - *Mezz. Design Information*: MEZZ, FF El., SLAB, WT-NW/LW, DL, COL, LL, PART.
   - *Mezz. Beams*: SPAN, TRIB, DLᴛ (= DL + COL), LLᴛ, SECTION, END WT (40), QTY.
   - *Mezz. Columns*: HEIGHT, TRIB. AREA (worst column), SECTION, END WT (46), QTY.
6. **3D framing model.** Beams as I-shapes at the T/beam elevation, W columns with cap and base plates, building-column stubs, open-web joists at the spacing and a translucent slab. Drag to orbit, scroll to zoom, click a member for its calc.

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

Example W0S-26160 (two mezzanines, "BSW" and "LEW", sharing the 96' line):

| | Beams | Columns |
|---|---|---|
| BSW | BU28x50 × 10, 28' span, trib 20'-0" (12'-4" + LEW edge 7'-8") | W8X24 × 4 (2/C–5/C) |
| LEW | BU27x47 × 4, 28' span, trib 18'-0" | W8X24 × 3 (2/D, 40'-4"/D, 40'-4"/E) |

All 7 columns match the drawing. Both beams and all six column load cases were run through the 15th-edition workbooks: 0 mismatches, all OK.

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
```

`private/` is gitignored. The NBG workbooks, design manuals and customer PCS files never go in this public repo.

## Notes and limits

- **Editions:** IBC 2018/2021 → 15th and IBC 2024 → 16th. IBC ≤ 2015 → 13th beam sheet (Q-factor compression, kv = 5, 360-05 shear and rt, no joist-bearing check), with the 15th column sheet since there is no 13th column sheet. All three are verified. NBCC (CSA S16) jobs are flagged to run in the S16 workbooks.
- **16th-edition column sheet:** Lby (C10) is hard-coded to 120 in. The tool uses L × 12. Type L × 12 into C10 when you check a job in Excel.
- **Materials other than deck + concrete**, and the "Designed For Load Provisions Only" box, are flagged. The quote engineer runs those by hand.
- **Dead load when the PCS says "Per Seller":** see the table above. Only 4" and 3½" NW on 1.0C are exact deck-guide values; everything else is flagged as an estimate.
- **Beam lines under 12' apart** (an interior frame column line between endwall lines, or a mezzanine edge just off a grid line) are kept, because they are real supports, but noted — drop a line on the Plan page if the joists should span past it.
