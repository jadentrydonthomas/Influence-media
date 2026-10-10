# Mezzanine Design

Upload a Project Confirmation Summary (eQuote PCS) PDF and get the mezzanine **beam sections**, **column sections**, spans, tribs and quantities for the quote. The tool does the input side of the NBG *Mezzanine Beam Design* and *Mezzanine Column* workbooks with the same math, so the numbers can be typed into Excel to confirm.

**Use it:** open `index.html` in Chrome or Edge. It is one self-contained file: it works offline, and the PDF is read locally and never uploaded.

## What it does

1. **Reads the PCS.**
   - Box 22: dead, live and collateral loads; slab; footprint and start location; rows A–F; joist spacing; seat depth.
     - Box 22 is found wherever it is. A base scope can say "22) MEZZANINES – NONE REQUIRED" while an alternate's Box 22 pages are appended after the drawings ("ALTERNATE #1 MEZZANINE SPECS"). Every block that lists a mezzanine is read.
     - Deck "Other" is read from its written-out type, e.g. "22ga B deck 1.5"" → 1.5" ribs.
   - The blue handwritten values (PDF FreeText annotations), used wherever a row says TBD. A blue number over "Dead Load: Per Seller" (e.g. 62.5psf) is taken as the dead load, and the deck-guide value is shown beside it.
   - The checkboxes: material, floor use, "provided by seller", and bar joist and bridging (bolted / welded).
     - They are read on every Box 22 page, each mezzanine from its own rows, including an alternate's pages.
     - The floor use is checked against the code minimum live load (IBC 1607.1 / ASCE 7 Table 4.3-1; 15 psf partition on an office floor at 80 psf or less).
   - Deck attachment, deck finish and joist primer go to the checklist note for the joist and deck order.
   - Box 2: bays, endwall column spacing and soldier columns, per building. On a single slope or a lean-to the "Distance to Ridge" is N/A, so there is no ridge line.
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
   - Tries every DM 5.1-stocked web and flange for the division (flanges ≥ 6" × 1/4"), whole-inch depths 10–30" by default, capped by clearance C.
   - **Only what the plant builds:** the NBG Production Guidelines (rev. 2026.01.15, Primary & Secondary Steel, built-up) are a hard filter, by division — tw ≤ tf (DG 25; NBG-UT: tf > tw + 1/16" / 1/8"), tw / tf ≥ 0.30, bf ≤ d, d / bf ≤ 7, thickest / thinnest flange ≤ 2, the thinnest web's flange limit, part depth / width / thickness / length / weight, and the handling minimum flange over 40 ft. (W1S-26062 MB1 was BU15x93 — 12 × 1 flanges on a 1/4" web, tw / tf 0.25; it is now BU15x95 with a 5/16" web.) Settings can switch the filter off.
   - Keeps sections with combined and shear SR ≤ 0.99, LL ≤ L/360, TL ≤ L/240, and a passing joist-bearing check (MB `L7`).
   - **The options per mark** — every one of them passes the MB sheet and the production rules:
     - *Lightest*: the least weight.
     - *Best fit*: the quote engineer's method, step by step, as the steps appear in the explanation: start as deep as the clearance allows; the thinnest web that works in shear there; flanges from F8.31 up the economical sizes (8", then 10", then 12") until it passes; take depth out an inch at a time with the same plates while it still passes (the stress ratio comes up toward the limit); then a lighter plate at that depth if one works. When the method stops deeper and heavier than the lightest (it only tries 8"+ flanges on the way down), the card says so.
     - *Most economical*: NBG "Economical Flange Sections" — green plate only, 5"–8" wide first, 10" when no 8" plate works ("start considering 10" flanges when F8.50 / F8.38 start failing"), 12" last ("typically more expensive"); the lightest of those. Yellow only when no green plate works.
     - Options that land on the same section are **one card** with both names. When fewer than three different designs come out, the next different ones are added — *Shallower* (the shallowest green-plate section within 15 % of the lightest) or another flange width — so the real choices are on screen.
     - When the clearance leaves **one depth** (W1S-26062: C 9'-6" under A 11'-6" leaves 15" for the beam, and at 15" only 12 × 1 flanges carry the deflection), the card says why and lists what 16"–21" would weigh and the clearance C each needs.
   - **How it was designed** (Beam calc page, click to open): the load on the beam with its numbers, how deep it can be (clearance C worked out), the plates and how many combinations the MB sheet ran and the production rules removed (by rule), what has to pass, the options (one line per different section) with the best fit's steps and every try, and what went on the quote. The Column calc page has the same for the column: its loads (which beams, which side), its length, the three combinations, the sizes tried in order, and a note on tubes / pipe. The long tables (Excel steps, depth table, columns tried, beams and supports) fold closed.
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

### Buildings attached to each other

A mezzanine can sit in a building attached to another one, such as a lean-to. Box 2 *Building Attachment* says how: "the BSW of Lean To attaches to the BSW of Sanctuary at 0'-0" from the left steel line".
- **Placement.** The attached building is placed in the other building's coordinates. Back to back (BSW to BSW, FSW to FSW) it is turned 180°; BSW to FSW it runs the same way.
- **Plan reading.** It takes the plan's letters, symbols and joist markup through that placement.
- **Shared wall line.** If both buildings have a beam on the wall they share, it is one member. The host building keeps it, because its columns carry it, and adds the attached floor's edge trib. On W1G-26097, line B carries 9'-8 ¾" + 14'-1" = 23'-9 ¾", and its loads go to the Sanctuary's BSW frame columns.
- **Frame loads.** They are listed per building.
- **One drawing.** The Plan page, the sidebar and large plans and the 3D model draw both buildings together, in the coordinates of the building picked at the top — the attached building's walls, lettered lines and loaded columns included. Hovering any column gives its own building's loads. In *Edit layout*, clicking the other building's mezzanine switches to it first, so its lines are edited in its own building. The floor-load card and the Column calc tabs cover every mezzanine of the job.

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
- **Joist direction from the joist symbol** (the zigzag truss drawn across a bay) when a job has no "Mez. Jst." arrows.
- **Mezzanine columns:** both symbol styles, ⊗ and circled-I, are checked against the layout of every mezzanine.
- **Frame columns are not mezzanine columns.** A bare I is a building (frame) column, and so is a ✱, the column the contract notes as designed "Most Economical" (Box 5 *Int. Column Type*). Where the drawing and the building data disagree, the drawing wins and the Design page says so:
  - a ⊗ or circled-I where Box 2 / Box 5 has a frame column → designed as a mezzanine column;
  - a ✱ or an interior I where the layout had a mezzanine column → taken as a building column (its load goes to the frame).
  - An I on a sidewall or endwall line never changes a support (wall openings are drawn with I-like marks).
- **Grid letters as drawn.** Bubbles on both endwalls, column lines and the ridge are lettered from the BSW, skipping I and O, so "2/C" in the notes is the drawing's 2/C.
- **The plan page is found by what it is,** not where it is: the page with no text and thousands of vector paths, counting from the back.
- **Frame-line bubbles may carry extras.** An attached building's end line can be drawn 1'-4" off the endwall, overlapping. Every frame line just has to find its bubble. When that pushes the drawing's numbering (the Sanctuary of W1G-26097 is drawn as lines 2–10), the Design page says so and keeps the PCS frame lines 1–9 (Box 5, NBG Frame files).
- **Markup over the plan.** A quote engineer's annotations are read too, and they win over the drawn symbols:
  - an **"X"** text box is a mezzanine column;
  - a line labelled **JOISTS**, and every line of its colour and direction, gives the joist direction wherever it crosses a mezzanine;
  - lines of another colour (the red beam lines) are kept as beams.

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

1. **The design**: sections, beam and column counts, steel weight, and **Floor loads to the frame** — the dead and live, in kips, at each building column the mezzanine beams frame into: the MB sheet's unfactored end shears (*Floor dead / live load — shear at left / right*) of each beam, at its own trib, summed at the column. These are the numbers in the frame loads table, the CSV and the NBG Frame files; columns with the same load share a row (2/A–5/A). The Beam calc page shows the MB sheet's end shear for the mark itself (at the mark's design trib) and says when some of its beams carry less.
2. **3D framing model**, then the **framing summary** (beams → governing ratio → columns, floor-plan check).
3. **Beam options** to pick from: up to three different designs a mark — the lightest, the best fit (the quote engineer's step-by-step method) and the most economical by NBG Economical Flange Sections. Options that land on one section share a card ("Lightest · Best fit"); when they all land on one, another flange width, a shallower section or — where the clearance C leaves one depth — the deeper sections with the C each needs fill the other cards.
4. **Checks & decisions**: what to check before quoting; what was confirmed against the PCS, the design decisions and how it was read are folded under it. The **DM 15.1** list is folded too, with its counts on the bar.
5. **Quote sheet** rows for every mezzanine.
6. **Calc package** — the NBG workbooks (every beam sheet set, column case and frame line as a filled copy of the real workbook) and the design-basis Excel file (below).

**One drawing for the whole job.** The 3D model, the Plan & layout page and the sidebar plan show every mezzanine together, not one at a time:

- **Colours:** interior beams are green and exterior beams blue, in the 3D model and on both plans.
- **Plan & layout page:**
  - Each beam's floor (its trib band) is shaded in its mark's colour.
  - Interior beam tags are filled and exterior tags are outlined.
  - Each run of beams is labelled along its line ("MB1 · INTERIOR · BU28x50").
- **3D model:** each beam carries a tag ("MB1 INT"), which you can switch off.
- **Columns:** numbered once over the job (C1 … C7), with the grid label beside the number.
- **Editing:** the joist direction, the beam / support lines and *Edit layout* (below) edit the mezzanine picked at the top.
- **Tables:** the beam and support tables list the whole job, with each beam's end shear.

**Hover any column for its loads.**

- **Mezzanine column:** the Column-sheet input. Left and right dead / live in kips, and each beam framing in, with its mark, section, span and trib. Also the W, height, CSR and trib area.
- **Building column:** the load to the frame (total D / L) and the beams it comes from.
- **Beam:** its span, trib (with any neighbour's share), MB-sheet run and end shear.

The cards work on the plan page, the sidebar plan and the large plan. Clicking a column or beam opens its calc, and the 3D card shows the same loads.

The sidebar shows the job turning in **3D** or as a labelled **Plan** (grid bubbles, beams, C# columns, building columns). The plan lights what you are reviewing: the column case on Column calc, or the mark and member length on Beam calc. Click a column or beam to open its calc, or ⤢ to see the plan large beside the page.

The Beam calc page lists the job's marks (MB1 · interior, MB2 · exterior) and, under them, a chip per member length: the designed run and each shorter one, with which beams it covers and its ratio. The MB sheet and the drawing follow the chip. The page opens with a drawing of the mark: the uniform load (D + L in klf), joists at the unbraced length, reactions, the deflected shape, member length, and moment and shear diagrams. Beside it is the BU section to scale with its plates. The Column calc page draws the case: the W column with cap and base plates, the left and right beams on it, both reactions (D / L kips) at e = d/2, the height, and the W section to scale. A table underneath lists each beam's span and trib, so you can see why one column carries more than another.

On the Column calc page every case is named like the plan (*C1 · 2/C*) with its max CSR. A left / right diagram shows which beam, from which mezzanine, gives each Column-sheet reaction.

### Design manual (NBG DM 15.1 Mezzanine Systems)

The Design page lists every item of DM 15.1 the job touches, under *Checks & decisions*. Each one is marked:

- **met**: read from the design numbers;
- **to check**: a decision, or extra material for the quote;
- **fails**: the item is not met;
- **callout**: for detailing or the D2D sheet;
- **scope**: standard practice or exclusions.

Items marked *to check* or *fails* also appear in the notes. The items are:

- **Layout:**
  - beams on the shorter span (or the drawing's arrows, flagged when they differ);
  - joists no more than 5'-0" on center;
  - one joist direction where mezzanines meet at one level (joist camber);
  - no live load reduction;
  - A / B / C defined and met.
- **Beams:**
  - L/360 and L/240;
  - flange ≥ 5½" for the 2½" joist seat;
  - top flange ≥ ¼" with the J10 joist-bearing check;
  - web without stiffeners;
  - axial only when a beam is part of a bracing system;
  - no camber.
  - **Perimeter beams** (the exterior mark) get the one-sided-joist callout: joist top chords to the flange edge, plus a flange local-bending check (DM 9.7.11) with the joist reaction.
- **Connections and columns:**
  - the beam-clip standard, with each mark's end reaction for the Mezzanine Beam Clips tool;
  - the column's two loading conditions (the Column sheet's three combinations);
  - the 7" hot-rolled flange rule;
  - for a column quoted as BU, the 8" × ¼" built-up flange rule;
  - the OSHA 300 lb post weight, with and without end plates;
  - the OSHA stabilizer plate for columns braced one way.
- **Deck and pour stop:**
  - deck and fastening standard;
  - when the seller provides it, the PST120 pour stop sized to the slab, with the perimeter length (shared edges left out).
- **Bracing:**
  - each side of each mezzanine: sidewall, endwall, rigid frame, shared with another mezzanine, or free (independent X-bracing);
  - the 1% FDL + FLL brace force.
- **Scope:**
  - the DM 15.1.1.2 exclusions, as quote qualifications;
  - load-provisions-only hole patterns;
  - Ecospan, when the PCS mentions it.

### Beam inputs (Beam calc page)

Each mark has a **design span** and a **design trib**. They change only the beam design: the MB sheet, the section search, the options, the Excel steps and the quote row.
- **The plan stays as laid out.** Footprint, beam lines, which columns are mezzanine or frame columns, the Column sheet and the loads to the frame all keep the layout's spans and tribs. Only the mark's new section changes the beam self-weight in those loads.
- **Use it when a member is shorter than the grid**, e.g. the clear length between column faces: MB1 at 22'-4" instead of the 24'-0" column-line span.
- **The change in span applies to every member length of the mark.** With MB1 at 24'-0" → 22'-4", its 20'-0" and 16'-0" runs go to 18'-4" and 14'-4".
- **One member over the job:** a mark's inputs go on every mezzanine. *Back to the layout* clears them.

Don't shorten the mezzanine footprint for this. On W1S-26062, cutting Mezz 1 to 22'-4" moves its edge 1'-8" off the BSW column line. That puts six new mezzanine columns along 118'-4", and frame line A loses its loads. Now that case is flagged: a footprint edge between 1'-0" and 3'-0" short of a line of building columns gets a warning on the Design page.

### The NBG workbooks themselves

The spreadsheets are the foundation: everything the tool designs is an input put into NBG's own workbooks and their output read back. To walk an engineer through a job:

- **Add the workbooks once** (Design page → *Check it in the NBG workbooks* → *Add workbooks…*): Mezzanine Beam Design 13th / 15th / 16th, Mezzanine Column 15th / 16th, IBC Seismic. They are recognised by their sheets and kept in this browser (IndexedDB) — nothing is uploaded, and no workbook is part of this tool or this repository.
- **Download a filled copy** of any of them: a beam workbook per sheet set (INPUT + MB1–MB4), a Column workbook per column case, an IBC Seismic workbook per frame line (Input Data, Lateral Calcs. (1) for that frame, Longitudinal Calcs.). The buttons are on the Design page, under *In the workbook · cell by cell* on the Beam and Column pages, and on each frame row of the Seismic page.
- **What the copy is:** your own workbook with this job's values typed into its input cells (the cells listed below) — numbers, text from the drop-downs, the check boxes as TRUE / FALSE — and nothing else changed: every other part of the file, the VBA project included, is byte for byte the original. Excel recalculates the whole workbook when it opens the copy (and asks to save on closing), so every result is the workbook's own.
- **Checked:** `oracle/fill_dump.js` fills every workbook for the four sample jobs and `oracle/fill_check.py` opens each copy: xlrd reads all 2,133 typed cells back, and LibreOffice recalculates and reads 552 results — beam end shears, deflections, combined / shear, the column combinations, Cs, each frame's mezzanine load and base shear, the bracing loads — all equal to the tool's.

### Calc package (bottom of the Beam calc and Column calc pages)

A bar at the bottom of the calcs exports what an engineer needs to check the design:

- **Design basis (.xlsx)** — one Excel workbook:
  - *Summary*: the job, the sheets used (beam / column edition, specification, division), the stress-ratio and deflection limits, every beam mark and member length with its section, plates, flange economy, ratios and end shears, the columns, and what to check before quoting.
  - *Inputs*: every value read or typed, its source (PCS, typed, deck guide, standard value) and the workbook cell it goes into; the design settings.
  - *MB sheets* and *Columns*: each cell typed into the Mezzanine Beam Design / Mezzanine Column workbook and what the sheet shows.
  - *Beam options*: how each section was found — the options, the best-fit steps, the sections the production limits left out (in words), the lightest section at each depth, and the deeper ones with the C each needs.
  - *Shop rules*: the NBG Production Guidelines by division and the chosen sections checked against them, the Economical Flange Sections chart, the DM 5.1 stock.
  - *Frame loads* and *Seismic* (when the Seismic page is complete): the FDL / FLL and EQR / EQL on each frame's columns, and the IBC Seismic cells typed per frame line.
  - *Sources*: each workbook and guide, what it gives and how it is checked.
- **Everything (.zip)** — the design-basis workbook plus a filled copy of every NBG workbook for the job (beam, column, seismic), for the workbooks added to this browser.

An engineer can change an input in a filled workbook and see the answer there, or use *Design your own* (below) to try another section.

### Design your own (beam and column)

The *Design your own* page is the MB sheet and the Column sheet without the search: type the loads (dead, collateral, live, joist weight), member length, unbraced length and trib, and a section (BU plates or a W), and it answers like the sheet — end shears (floor dead and live to the column / frame), combined and shear ratios, deflections, joist bearing — with the production rules, the stock and the flange economy beside it.

- **Start from this job** loads any mark's or column case's inputs.
- **Sections that pass** lists the lightest sections that pass within 3" of the depth (flagged when deeper than the mark's clearance allows); *Load* puts one in.
- **Use this section** puts it on a mark of the job (flagged if it does not pass); the Design page's *Lightest* option puts the search's answer back. The column tab can set the job's mezzanine columns to the W tried.

### Edit the layout (Plan page)

*Edit layout* on the framing plan, then click:

- **a column** — *Make it a frame column* (its beam reactions go to the frame design as FDL / FLL; if the frame has no column there, the frame loads say to add it in NBG Frame), *Make it a mezzanine column* (designed on the Column sheet; the frame takes no mezzanine load there), *Take the column out* (the beam on that line spans through; never a beam's end) or *Remove the line of columns*.
- **a beam** — *Remove the beam line* (the joists span past it; edge beams stay).
- **the floor** — *Add a beam line* or *Add a column line* at the point clicked, or at a typed distance.

Every edit re-designs the whole job — beams, columns, the frame loads, the seismic, the quote — and is listed on the Design page. *Undo* steps back, *Reset layout* returns to the building grid and the PCS drawing.

### Excel, step by step

The Beam calc and Column calc pages list the exact cells to type into the NBG workbooks, in order, and what Excel should then show (the same cells the filled copies carry).

- **Beam workbook.** One per load group:
  - **INPUT, once:** the loads, top of mezzanine, slab, seat, total joist depth, and the B / C requested values.
  - **One MB sheet per run:** the marks go on MB1, MB2 …, then their shorter member lengths. Each run lists the beam mark, member length, unbraced length, trib, BU, then the six plates.
  - **What to read back:** the end shears (H6 / H10), deflection ratios, COMBINED / SHEAR OK, and the INPUT clearance checks.
- **Column workbook.** One run per column case: mark, length, section, **Fy 50**, the four reactions, then the three results.
  - The 16th-edition Column workbook opens at Fy 55 ksi, and its Lby (C10) is hard-coded to 120 in. The steps set Fy to 50 and type L × 12.
- **Copy cells** copies the list as text.

### Frame loads and NBG Frame files (Plan page)

**Frame loads.** Each frame line lists the mezzanine dead and live that reach the frame's own columns: the unfactored beam end shears (MB `H6` / `H10`) summed at each column, at the floor level (A) — the height the seismic workbook uses for the mezzanine — or at T/beam with the switch. With the Seismic page complete, each column also shows its EQR / EQL share. Columns are numbered the way NBG Frame numbers them: COL01 at the FSW, then each Box 5 interior column, the BSW column last. Mezzanine columns are never in this list. An endwall column beside a rigid end frame is shown, dimmed, as *not a member of this frame*, because its load goes to the endwall design. Copy a frame line, or download the whole table as CSV.

**NBG Frame files.** Drop the job's `.frame` files (one per frame line or group, e.g. `…_Bldg_1_3-5.frame`) on the Plan page. Each file comes back with the loads typed in, the same rows you would add under *Tools → Concentrated (Panel) Loads*:

| Description | Load Case | Member | X Force | Y Force (kip) | Moment | Location (ft) | Ecc. Loc. | Ecc. Offset | Loc. Sys. |
|---|---|---|---|---|---|---|---|---|---|
| FDL 2 | FDL | COL02 | 0 | −dead | 0 | floor level A | WebCenterline | 0 | Global |
| FLL 2 | FLL | COL02 | 0 | −live | 0 | floor level A | WebCenterline | 0 | Global |
| EQR 2 | EQR | COL02 | +seismic | 0 | 0 | floor level A | Top/Left (Bottom/Right once confirmed) | 0 | Global |
| EQL 2 | EQL | COL02 | −seismic | 0 | 0 | floor level A | Top/Left | 0 | Global |

- **File names are short on purpose:** frame number, building, frame lines, e.g. `1234567-B1-3-5_mz.frame`. NBG Frame's analysis only reads a file path up to 64 characters, folder included. A longer path still opens, but the run stops with *No input file …* (e.g. `C:\Users\<name>\Downloads\Frame-…-Bldg 1-2_mezz (3).frame`). Keep the file in a short folder, and delete older copies so the browser doesn't add " (1)" to the name.
- **Frame lines** come from the file name (`_3-5` → 3, 4, 5) and can be retyped on the card. A file that designs several lines gets, for each column, the largest dead and the largest live of those lines.
- **Columns are matched by position** across the frame (GlobalX, within 2'-0"), so the file's own member IDs are used. A load at a column the file does not have, such as an endwall column of a rigid end frame, is listed under *Not in this file* with its values. It is never moved onto another member.
- **Which side is the FSW.** Taken from the file itself when it can tell:
  1. interior columns that are not symmetric, compared with Box 5 (given from the FSW);
  2. otherwise, the file's *Lean-To* loads against the wall the PCS says the lean-to attaches to.

  With neither, COL01 is taken as the FSW column, and the card says so.
- **Checks on every card:** job number, building and width against the PCS. A file for another building takes none of this building's loads.
- **Floor Dead / Floor Live** are set to 1 psf when they are 0 (as done by hand), so that NBG Frame creates the FDL and FLL cases. Values already set are left alone.
- **Re-export** replaces the earlier FDL / FLL / EQR / EQL rows (including hand-typed "FDL1" or "EQR 1" rows) and doesn't add a second set. NBG's own *Lean-To* seismic rows are never touched. Other rows of those cases already in the file are kept and flagged.
- **Seismic rows** (from the Seismic page) are written the way NBG Frame writes its own lean-to seismic rows: X force ± at the mezzanine level, Ecc. Loc. Top/Left — an X force with no offset takes no moment from the flange it is drawn at. EQR rows switch to Bottom/Right once that code is confirmed (pick it from the same check file, or drop a frame where EQR rows were set to Bottom/Right by hand).
- **The roof seismic** stays NBG Frame's own. The card shows, for information, the workbook's alternate roof seismic weight for those lines (Lateral G64) — it is not in the procedure and not written.
- **Nothing else in the file changes.**
  - The connections and detailing entries are copied byte for byte.
  - The model text only gains the new rows and the two 1-psf values: CRLF line endings and indentation as NBG writes them.
  - Results stored in the file are recomputed when the frame is processed.
- **In NBG Frame:**
  1. Open the file.
  2. Process → Get Applied Loads → final pass.
  3. Tools → Concentrated (Panel) Loads: check the rows, then *Save and Gen Loads*.
  4. With seismic: the EQR / EQL rows are in — check them against the Seismic page.
  5. Run.
- *Location* is the height of the load above the finished floor (Loc. Sys. Global): the floor level A by default (11'-6" on W1S-26062), or T/beam (A − slab − joist seat, 10'-9" there) with the switch. For the dead and live it makes no practical difference — with WebCenterline there is no eccentric moment, only where the column axial starts — but the seismic acts at the floor, where the mass is.
- *Ecc. Loc.* is the row's `toFlange` code.
  - NBG Frame shows `1` as Top/Left (its own Lean-To rows).
  - `0` is not one of its choices: the cell comes up blank and the dialog says *Invalid data was entered or pasted*.
  - The WebCenterline code is not written in any file the tool can read, so **no frame file is made until it is confirmed** (one time per computer):
    1. *Make the check file*. This is a copy of a dropped frame with one zero-load row per candidate code: ECC 2, 3, 4, −1, −2.
    2. Open it in NBG Frame → Tools → Concentrated (Panel) Loads. Codes NBG does not have come up blank; click OK and close without saving.
    3. Click the ECC row that reads *WebCenterline*.
  - Alternatively, drop a frame saved from NBG Frame with FDL / FLL rows set to WebCenterline by hand; the code is read from it.
  - The code is kept in the browser; *Reset* starts over.

### Seismic to the frames and the bracing (Seismic page)

The page follows the procedure in the IBC Seismic workbook's order (rev. 2021.01.20 — ASCE 7 equivalent lateral force, 12.8), every field with the workbook cell it goes in, and every frame line opens as a filled copy of the workbook.

1. **Code and site** (Input Data, Seismic Design Calcs. D11): the code from the PCS code line (ASCE 7-05 / 7-10 / 7-16; 7-22 asks for SDS and SD1 from the ASCE Hazard Tool), Ss, S1, site class ("Soils Report" / "Assumed"), occupancy from Box 3.
2. **Building** (Input Data B7–B22, B33–B37, walls): profile, width, length, ridge, slope, eaves from Box 2; frame self weight 2 psf (the workbook's default) and roof self weight 1 psf — the split that reproduces your W1S-26062 longitudinal table; roof dead from a dropped frame file (NBG Frame's *RoofDead*, since the PCS says "Per Seller") or typed — never guessed; collateral and snow from Box 4; walls 3 psf; vertical distribution; "steel systems not detailed for seismic" in SDC A–C (R 3); whether the mezzanine is a story (over ⅓ of the floor); the mezzanine diaphragm.
3. **Mezzanine loads** (Input Data B89–B95 / F89–F95, the storage check box): elevation (A), floor dead (the design's, or typed — e.g. 55), collateral, joists, floor live (the workbook takes 25 % for storage), partition. The workbook takes two mezzanines per building.
4. **Each frame** (Lateral Calcs. (1)): the frame's system (B9), its bay width — the strip it carries, half the bay each side, an end frame half the end bay (B18, which is how the workbook's formulas use it: roof weight = bay × width × psf) — where it is (Q1), and each mezzanine's floor area in that strip (B31 / B34). The workbook's mezzanine rows (G77 / G78) are that frame's mezzanine seismic forces. Click a row for the full distribution and the cell-by-cell entries; *Workbook* downloads the filled copy.
5. **Into NBG Frame**: one table, one row per frame line × column × level — the frame columns the mezzanine's beams frame into, the mezzanine force shared by the dead load each takes (or equally), **Calculated** and **Applied**. Applied is what the frame files get, EQR = +Applied, EQL = −Applied, at the mezzanine level:
   - type a value in Applied to use your own (↺ goes back); *All loads ×* multiplies every calculated load; typing 0 leaves the rows off that column;
   - a value typed in a frame-file card's EQR X Force sets that column for every line the file designs (3, 4 and 5 for a 3-5 file);
   - *Back to the calculated loads* clears every edit; edits are kept on this computer with the job (by quote number), and a typed value whose column or level no longer exists is flagged and not used.
   - A frame line with mezzanine area but no frame column the mezzanine frames into is flagged: that share needs independent bracing or another frame.
6. **Bracing** (Longitudinal Calcs.): the whole building; the mezzanine rows (G77 / G78) are the seismic forces your bracing takes at the mezzanine level, with the roof psf and Cs for the bracing software. Folded under it: the multistory distribution, and which bracing lines take the force (the floor spans between its edges as a flexible diaphragm, lever rule; a sidewall line is the building bracing, tiered at the mezzanine level; any other line is independent X-bracing for the larger of the seismic and the DM 15.1.3 1 % stability force).

**What the tool does beyond the procedure** is listed on the page, each with its switch: the framing weight added to the floor dead; the self-weight split; how a frame's load is split between its columns; R 3 (the workbook) against NBG Frame's OMF R 3.5; the workbook's alternate roof seismic weight (G64, shown for information, not written — the frame files keep NBG Frame's own roof seismic); the bracing-line split and 1 % check; EQR Top/Left until Bottom/Right is confirmed.

**Load level.** The workbook's values are Q<sub>E</sub> (12.8), before ρ and the ASD 0.7; NBG Frame's load combinations apply them.

**Checked** against the IBC Seismic workbook in LibreOffice (`oracle/seismic_oracle.py`, `oracle/seismic_check.js`): 15 cases covering ASCE 7-05 / 7-10 / 7-16, site classes B–D, risk categories I–IV, SDC A–D, the 12.8.1.3 caps, the 7-16 11.4.8 exception, snow over 30 psf, partitions, concentrated loads, k = 0 and k > 1, gable / unequal gable / single slope, end and interior frames, the building-limit warning and a rigid mezzanine diaphragm — **1,386 of 1,386 values tie**. And every frame line of the four sample jobs typed into the real workbook and recalculated gives the tool's numbers (`oracle/fill_check.py`). A user's own longitudinal table for W1S-26062 (V 44.92 k, mezzanines 13.95 + 5.98 k) is reproduced row for row.

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

Notes on the Design page are grouped: **Check before quoting** (flags), **Confirmed against the PCS** (e.g. the floor plan matched, joist arrows read), **Design decisions** (shared beams and columns, snapped edges, joist direction), and a collapsed **How it was read** list.

Total joist depth is **A − B − slab − seat**. It feeds the INPUT-sheet clearance check (B provided). A joist span over 24 × that depth (the SJI K-series limit) is flagged — e.g. after a beam line is removed on the Plan page.

**Box 2 length vs the bays.** When the bays add up to within 2'-0" of the Box 2 length (the Lean To on W1G-26097: 159'-11 1/2" against 158'-7 1/2"), the frames stay on the bay lines — no extra frame line is made up — the mezzanine edge is framed on the end line with the slab overhang on the edge beam, and the mismatch is flagged to confirm.

**Columns quoted as BU.** When none of the common columns passes, the next W is quoted as BU (Mezzanine Training Guide). Only Ws with at least an 8" × 1/4" flange are taken for that (DM 15.1.1.4.2 (2A), beams on the column flange), and nothing lighter than the common sizes is tried. A W on the quote that is not stocked at the division is flagged under *Check before quoting*.

**Print calc summary** prints the Design, Beam calc and Column calc pages on white paper, in dark ink, without the controls or the 3D model.

**The quote never hides what does not pass.** A mark with no passing section stays on the quote as *NO SECTION* rows (every beam counted), columns that could not be sized as *NOT SIZED*, and a section that fails (a pick by hand, or one deeper than the clearance C) carries *FAILS — combined …* or *C … provided < … asked* in its notes — the title on the Design page turns red. The Design page's *Check before quoting* lists every mezzanine's notes, each named with its mezzanine, not only the one picked at the top. Building columns that take mezzanine load but are in no NBG Frame file (endwall columns beside a rigid end frame) are listed for the endwall design, and marked *endwall* on the floor-load card.

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

**The Excel steps, typed into the workbooks.** `oracle/steps_oracle.py` types each step list into the real workbook, one cell at a time, and reads back what Excel shows. Both example jobs were run on the 13th, 15th and 16th sheets: **244 read-backs, 0 differences**. The read-backs cover the shears, deflections, OK strings, INPUT clearances, and Column results and CSRs.

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
npm test               # guide examples, layout cases (layout edits too), parser, plan symbols, frame-file writer,
                       # beam options, the workbook writer, the .xlsx writer and calc package; the example jobs,
                       # variant loop, real frame files and workbooks when private/pcs/, private/frame/ and
                       # private/workbooks/ have them
npm run e2e            # drive index.html in Chromium for every PDF in private/pcs/: load, every control, 3D pick,
                       # copy, manual entry, NBG Frame files, seismic edits, filled-workbook downloads, the calc
                       # package, Design your own, layout edits
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

# the app's "Excel, step by step" lists: type them into the workbooks, compare what Excel shows
node oracle/steps_dump.js private/pcs/JOB.pdf oracle/out/steps '{"edition":"16"}'
python3 oracle/steps_oracle.py oracle/out/steps.json oracle/out/steps_res.json
node oracle/steps_check.js oracle/out/steps

# the filled workbooks the page downloads (src/xls.js): fill all of them for the jobs, then xlrd + LibreOffice
node oracle/fill_dump.js oracle/out/filled private/pcs/*.pdf
cd oracle && python3 fill_check.py out/filled
```

`private/` is gitignored. The NBG workbooks, design manuals, customer PCS files and NBG Frame files (`private/frame/`) never go in this public repo. `MZ_FRAME_OUT=dir node test/framefile.test.js` also writes the finished frame files, to check them in NBG Frame or with any zip / XML tool.

## Notes and limits

- **Editions (IBC chapter 35):** IBC 2024 → AISC 360-22 (16th sheets); IBC 2018 / 2021 → AISC 360-16 (15th); IBC 2012 / 2015 → AISC 360-10, run on the 13th sheet since no 14th exists (flagged); IBC 2006 / 2009 → AISC 360-05 (13th). A state code with no IBC year maps through its IBC base (Massachusetts 9th / 10th Ed. → IBC 2015 / 2021, Florida 7th / 8th → IBC 2018 / 2021, California 2019 / 2022 / 2025 → IBC 2018 / 2021 / 2024). If the state code isn't in that table, its ASCE 7 year is used: 7-22 → IBC 2024, 7-16 → IBC 2018 / 2021, 7-10 → IBC 2012 / 2015.
- **Editions, short form:** IBC 2018/2021 → 15th and IBC 2024 → 16th. IBC ≤ 2015 → 13th beam sheet (Q-factor compression, kv = 5, 360-05 shear and rt, no joist-bearing check), with the 15th column sheet since there is no 13th column sheet. All three are verified. NBCC (CSA S16) jobs are flagged to run in the S16 workbooks.
- **16th-edition column sheet:** Lby (C10) is hard-coded to 120 in., and Fy (Miscellaneous!K8, the drop-down beside the section) opens at 55 ksi. The tool uses L × 12 and Fy 50 for a W column, and its Excel steps set both.
- **Materials other than deck + concrete**, and the "Designed For Load Provisions Only" box, are flagged. The quote engineer runs those by hand.
- **Dead load when the PCS says "Per Seller":** see the table above. Only 4" and 3½" NW on 1.0C are exact deck-guide values; everything else is flagged as an estimate.
- **Beam lines under 12' apart** (an interior frame column line between endwall lines, or a mezzanine edge just off a grid line) are kept, because they are real supports, but noted — drop a line on the Plan page if the joists should span past it.
