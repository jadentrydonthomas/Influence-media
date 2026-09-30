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
   - The framing plan is drawn so you can hold it against the floor plan. The floor-plan page has no text layer, so it cannot be read.
3. **Sizes the beams** the way the MB sheet is iterated by hand:
   - Tries every DM 5.1-stocked web and flange for the division, for depths 10–24" by default.
   - Keeps sections with combined and shear SR ≤ 0.99, LL ≤ L/360, TL ≤ L/240, and a passing joist-bearing check (MB `L7`).
   - Reports the lightest one, and the lightest at each depth so you can trade headroom for weight.
4. **Sizes the columns** on the Column sheet:
   - Loads are the left and right beam reactions (MB `H6` dead, `H10` live), with e = d/2, the three load combinations, and column self-weight.
   - Tries W10X22, W8X24 and W12X26. If none passes, it takes the next heavier W and quotes it as `BU{d}x{wt}`, per the training guide.
   - Column length defaults to finish floor → top of mezzanine (A). You can switch to *clear below beam* in Settings.
5. **Quote sheet.** One click copies the mark, section, span, trib and quantity for each line.

Total joist depth is **A − B − slab − seat**. It feeds the INPUT-sheet clearance check (B provided).

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

## Develop

```bash
npm install            # pdfjs-dist 3.11.174 (inlined into the build)
npm run build          # -> index.html
npm test               # guide examples, layout cases, parser; full example job if private/pcs/ has the PDF
node test/e2e.js private/pcs/<PCS>.pdf    # drive index.html in Chromium, screenshots to oracle/out/shots
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
- **Dead load when the PCS says "Per Seller":** taken from the deck guide. 4" standard weight = 43 psf and 3½" = 37 psf; other thicknesses are interpolated and flagged.
