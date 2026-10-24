# Building Design

Upload a Project Confirmation Summary (eQuote PCS) PDF and get the **whole building loaded** — every building of the job on one site, its roof snow, the drift a higher roof puts on a lower one, and the seismic, frame line by frame line and on the bracing, as NBG Frame and NBG Bracing take them — and the mezzanines sized: **beam sections**, **column sections**, spans, tribs and quantities for the quote. The snow and seismic follow NBG Design Calcs; the beams and columns are the input side of the NBG *Mezzanine Beam Design* and *Mezzanine Column* workbooks with the same math, so every number can be confirmed in the real workbook.

**Use it:** open `index.html` in Chrome or Edge. It is one self-contained file: it works offline, and the PDF is read locally and never uploaded.

## The pages

The rail is in two groups. **Project · building loads** holds the job as a whole; **Systems → Mezzanines** holds the mezzanine design (every page that was the whole tool before). Cranes come next.

- **Project & files** — drop the PCS. Then the job's NBG files in one place: `.frame` files (their loads go in on the Frames page), the `.bracing` file (EQB / EQF on the Bracing page), the `.nbgscope` eScope (the code, Ss / S1, roof loads). A summary of the project: every building (Box 2 / 4), the attachments, the snow and seismic data, and the hand-off downloads — the real NBG workbooks filled for this job with the design basis, in one zip.
- **Building** — the site in 3D: every building's frames, roofs and the snow on them (the drift wedge where a roof steps), the mezzanines — **⧉ Own window** opens it in a window of its own for a second screen, turning in 3D or as the plan, and a frame line clicked there opens on the Frames page here; a site plan with each frame line clickable and the drift zones with the wind that builds them; a table of every frame line and what it carries; the flags (a mezzanine edge with no wall to take its seismic, a roof snow that does not tie to Box 4, an obstruction Box 4 lists).
- **Calcs** — every calc of the job as a card, building by building, as NBG Design Calcs keeps them: Seismic Calculations, Unbalanced Snow, each Roof Step Snow Drift, and the Design Calcs file's own documents (wind; for a Canadian job the NBCC seismic and snow). Click a card and the calc opens on the right:
  - **Seismic** — NBG Design Calcs' seismic (below): the inputs first (steps 1–6, a building at a time on a multi-building job), then the results — one row a building — then the loads into NBG Frame and NBG Bracing (steps 7–9).
  - **Snow & drift** — NBG Design Calcs' snow, ASCE 7 chapter 7: the snow data (Box 3 / 4, type over any value), each roof's pf / Cs / ps / pm and unbalanced snow (checked against Box 4), each roof step's drift (leeward and windward, hc, w, pd; the fetch and a gap to a separate building typed where another roof continues in line; a step the PCS does not draw can be added), and the drift frame line by frame line as "Snow Drift" panel loads for NBG Frame.
  - **The job's Design Calcs file** (`.nbgcalcs`, dropped at the top of the page): its seismic inputs are taken as a source, every input and result of each building's seismic is set against the tool's (tied or differs, row by row), *Use the file's inputs* types them in, and **Files out** gives the file back — `…_mz.nbgcalcs` — with this tool's mezzanine loads in its seismic documents (below). A calc the tool does not work (wind, NBCC, a building the PCS does not have) opens as a read view of the file: its inputs, factors, per-line base shears, seismic masses, snow cases, drift — Design Calcs' own numbers.
- **Frames** — pick a frame line. The working part is at the top: the line's `.frame` (matched by building and line, or dropped right there) with a **Download** button at the top right that writes every load the tool puts on the line into it; for a host frame a lean-to bears on, a **Lean-to reactions** card — the lean-to's designed `.frame`, the column each of its lines lands on and the location, as NBG Frame's *Tools → Concentrated Loads → Add Frame Reactions* asks for them, editable — with the reactions drawn on the frame straight away (a case at a time). The elevation shows every load as a layer — roof dead + collateral, the roof snow, the drift and sliding snow at true depth and as load bands, the mezzanine's FDL / FLL (negative, over a down arrow onto the column), EQR / EQL (the value, with its two arrows under it), the lean-to's reactions with the lean-to ghosted behind an end frame. Each column's number is at its base (1, 2, 3 … as NBG Frame numbers them — the FDL2 / EQR2 rows name them), and each load's height is outside the frame on a dotted line. The line's lateral system can be picked above the drawing. Under it, the record: the panel and concentrated rows exactly as they go into the file, the lean-to's reactions case by case, and the NBG Frame steps.
  - **The lean-to loop**, followed by a strip at the top of the page: (1) the lean-to's lines get the drift — download its file; (2) redesign it in NBG Frame and drop it back; (3) its reactions go on the host line — download that. Each file is checked: whether it carries the tool's drift, NBG's own, or none, and whether it is the tool's download dropped back unchanged (not yet run in NBG Frame, so its reactions are from before the drift). The latest file dropped is used; the earlier one is named as replaced.
- **Bracing** — the bracing files at the top: drop them there (or on the Project page), see what each will get, download each with the EQB / EQF and strut line written in. Then each sidewall in elevation: its X-bracing, portal frames and strut lines (from the bracing file, else the eScope's braced bays, else PCS Box 12 — each checked against Box 12 bay by bay), the mezzanine floor, the EQB / EQF at its frame lines, and the new strut line; every mezzanine edge that is not on a wall flagged with what it needs. **The bracing plan** draws every line: a braced bay as a long slim X from one end of the bay to the other, a portal frame as its beam with a leg at each end and *PF* on it, and each line's **EQB inside** (over the floor, an arrow the way it pushes from its frame line, its value at the arrowhead) and **EQF outside** — on a wall whose outside is taken by the grid bubbles and dimensions, inside at the other end; each kept clear of the names, tags and the other callout. Under each wall: the mezzanine's force on it (half of each mezzanine whose edge it is, with the mezzanine total beside it), the *Mezz. Seismic* rows already in the file against what the tool writes, and the file's last design — each rod tier, portal frame and strut line with its force against what it allows and the combination that governs. The checks at the bottom set the file against the PCS and the seismic calc (size, eaves, frame lines, roof loads, Ss / S1, the roof seismic factor and R), flag a member over its allowable, and a strut at the mezzanine level that NBG Bracing does not check.
- **Purlins** — a reminder page: the drift as purlin line loads (the purlin program is not here).
- **Cranes** — next. Box 23 is already read (type, capacity, CMAA class, aisle, starting frame line, runway, weights, wheel load, clearances) and flagged on the Building page — the frames, bracing and seismic do not carry crane loads yet — with a check that the crane starts on a frame line the building has.

The sidebar's square follows the workspace: the whole building on the building pages (3D, or the site plan with each frame line clickable; ⤢ opens the building in its own window), the mezzanines in the Mezzanine workspace.

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
   - **Requested and Provided (rows A–F, joist spacing, seat).** B, C and D are minimum clearances the customer asks for: a TBD there is asked on the Design page, with the quote's Provided number offered as one click (*Provided on the quote*, or *each its Provided value* when the mezzanines differ) — never taken silently. A, E, the joist spacing and the seat are dimensions of the quoted design itself: a TBD there takes the Provided column, and the field says so (*PCS Requested "TBD"; the Provided column's 0'-2 1/2"*).
   - **Box 27 special user notes and Box 28 qualifications**, each joined over its wrapped lines and page breaks and matched to the mezzanine it names (by ID, or "mezzanine 2"); a note that names none goes to every mezzanine. A note describing framing the tool does not lay out — no floor (MEP support only), a hanging grid, cantilever or hot-rolled beams under grating — is a must-fix: what the page designs is then a check of the Box 22 loads on a floor layout, and the note (with the qualification it cites) is quoted in full. *Deck* or *Bar Joist and Bridging: Not by Seller* is flagged, with the joist weight the beams carry as an estimate to confirm.
   - **Any wrapper, either plant.** A signed contract — an order acknowledgement letter first, the QUOTE AND ORDER DOCUMENT after, as the SC plant sends them — is read from the order document's own pages: quote, project, date and the plant in its header (*Nucor Building Systems – IN* → NBS-IN, *Nucor Buildings Group – SC* → NBG-SC, Terrell → NBG-TX, …).
   - **Pages with no text layer are read by OCR.** A PDF printed through a driver that draws every glyph as a vector outline (DocuWare Printer on some SC contracts: the text "looks like an image" and cannot be selected), or a scan, has no text for pdf.js. Those pages are found by what they are drawn with (thousands of curved paths, or a page-size image — a floor plan's line work is left to the plan reader), rendered at 300 dpi and read by Tesseract inside the tool: no network, nothing uploaded, about 1–2 s a page on three workers (S1B-26002, 18 such pages: under 30 s). On the way:
     - **Checkboxes** are found in the picture (a square frame 6–14 pt, alone), their tick read, and blanked before the words are read, so a box never reads as a letter.
     - **Figures read again.** A dimension alone in a table cell is where OCR is least sure (25'-8" came back as "25-8"" at 1 %): each such word is read a second time as one line of figures only, and the reading that makes a well-formed figure is kept. Tesseract's usual slips on a PCS are put right — a lost foot mark (9-10" → 9'-10"), the space before a fraction (0-21/2" → 0'-2 1/2"), O / l / T for 0 / 1, "(©)" for (C), "Ill" for III, "$1:" for S1.
     - **Pen markups.** A value struck through with a new one written in red beside it (S1B mezzanine A: Width ~~26'-6"~~ 26'-8"; B: ~~25'-3"~~ 25'-1", a slanted stroke over black print) is read as the red value, and both the Inputs field and the notes say so.
     - **How sure.** Each Box 22 value keeps the confidence of its least sure word. The Design page lists any value read under 85 % with its number, to check against the PDF; the intake line says which pages were read by OCR and how sure on average. The reading checks (bays against the length, endwall columns against the width, frame modules against Box 2) catch a misread number there as they would a typo.
     - **Measured.** Read entirely by OCR (text layer ignored) and compared field by field with the text-layer read: an SC contract (43 pages, 4 mezzanines, notes and qualifications) 320 of 323 fields identical — the 3 are a dash's style, a foot mark in a Provided string, and three punctuation-heavy words in a note; W0S-26160 (IN) 194 of 197 — the quote number in a double-struck header, and a few note words. S1B, which has no text layer at all, is checked value by value against its pages (`test/ocr.test.js`).
   - Box 2: bays, endwall column spacing and soldier columns, per building. On a single slope or a lean-to the "Distance to Ridge" is N/A, so there is no ridge line.
   - Box 3: building code, which picks the workbook edition.
   - Box 5: frame interior modules.
   - **Building names that wrap in their cells** are read whole: "MAINTENANCE" / "BUILDING" in the spacing table, mid-word "MAINTENAN" / "CE BUILDING" in the information and roof-load rows (where a short gap can also glue the name to "Per Seller"), and Box 5's head running on into "Cold Formed Materials Allowed on Frame". The pieces join toward a building name the quote spells out in full (Box 5's heads, Box 22, the attachment notes), so each table's row is the building's own and a second building's rows stay its own. A box that runs past the page is read on under the next page's header ("5) FRAME INFORMATION (CONTINUED)").
2. **Lays out the framing.**
   - Grid lines inside the footprint become beam lines and support lines.
   - Beams run the shorter span (DM 15.1.1.3). On a tie, the layout with fewer beams wins.
   - Each beam's trib is half the distance to the next beam line on each side.
   - Every support that is not a building column (sidewall, endwall, interior frame or soldier column) is a ⊗ mezzanine column.
   - An edge within 1'-0" of a grid line is framed on that line. Where the PCS drawing puts no column on an edge but does on a line up to 3'-0" inside it, the edge is framed on that line and the slab overhangs it, as drawn (W2R-26047: 1'-3" past line 4, 1'-10 13/16" past line C). Slab past the last support along the beams is cantilevered to it: those columns' reactions take w·a·(1 + a/2L) on top of the end shear. An edge short of a line is never moved out to it.
   - **Floor plan check.** The floor-plan page has no text layer, but its geometry can be read:
     - The grid bubbles register the drawing to the bays.
     - Every ⊗ mezzanine-column symbol is snapped to a grid intersection.
     - The result is compared with the derived columns. The tool says whether they match, or which joist direction or beam lines would.
   - The framing plan is drawn with those ⊗ overlaid, so you can confirm it at a glance.
3. **Sizes the beams** the way the MB sheet is iterated by hand:
   - Tries every DM 5.1-stocked web and flange for the division (flanges ≥ 6" × 1/4"), whole-inch depths 10–30" by default, capped by clearance C (below).
   - **Only what the plant builds:** the NBG Production Guidelines (rev. 2026.01.15, Primary & Secondary Steel, built-up) are a hard filter, by division — tw ≤ tf (DG 25; NBG-UT: tf > tw + 1/16" / 1/8"), tw / tf ≥ 0.30, bf ≤ d, d / bf ≤ 7, thickest / thinnest flange ≤ 2, the thinnest web's flange limit, part depth / width / thickness / length / weight, and the handling minimum flange over 40 ft. (W1S-26062 MB1 with the setback: BU14x92 has 12 × 1 flanges on a 1/4" web, tw / tf 0.25, so it is BU14x94 with a 5/16" web.) Settings can switch the filter off.
   - Keeps sections with combined and shear SR ≤ 0.99, LL ≤ L/360, TL ≤ L/240, and a passing joist-bearing check (MB `L7`).
   - **Clearance C with the beam's sag.** The room for the beam is A − C − slab − joist seat (the MB sheet's INPUT clearance rows). A section fits when its depth **plus its total-load deflection** (the MB sheet's *TOTAL LOAD (unfactored) MAX. DEFLECTION* at the design span) is within that room, so the bottom of the beam at midspan, under the full load, stays at or above C. The sheet's own C row takes the depth alone; the tool keeps that row as the sheet shows it and adds *C at midspan* beside it (Beam calc → INPUT sheet), and the C verdict on the page and the quote is the midspan one, on each mezzanine's own member lengths. Each quote row is checked at its own member length (a shorter beam sags less). A section that is a little over is not let through: W1S-26062 MB2's BU14x41 is 14" + 1.07" = 15.07" in 15" of room, so it is listed as lighter but needing a lower C (9'-5 7/8"), not the answer. A fit within 1/8" is said under *Check before quoting* — W1S-26062 with the setback: *Clearance C is tight: MB1 BU14x94 (22'-8" member) is 14" deep and sags 0.98" under the total load, 14.98" of the 15" of room — 0.02" to spare* (0.004" with a 43 psf dead load) — so A, C, the slab and the seat are confirmed before quoting.
   - **The options per mark** — every one of them passes the MB sheet and the production rules:
     - *Lightest*: the least weight.
     - *Best fit*: the quote engineer's method, step by step, as the steps appear in the explanation: start as deep as the clearance allows; the thinnest web that works in shear there; flanges from F8.31 up the economical sizes (8", then 10", then 12") until it passes; take depth out an inch at a time with the same plates while it still passes (the stress ratio comes up toward the limit); then a lighter plate at that depth if one works. When the method stops deeper and heavier than the lightest (it only tries 8"+ flanges on the way down), the card says so.
     - *Most economical*: NBG "Economical Flange Sections" — green plate only, 5"–8" wide first, 10" when no 8" plate works ("start considering 10" flanges when F8.50 / F8.38 start failing"), 12" last ("typically more expensive"); the lightest of those. Yellow only when no green plate works.
     - Options that land on the same section are **one card** with both names. When fewer than three different designs come out, the next different ones are added — *Shallower* (the shallowest green-plate section within 15 % of the lightest) or another flange width — so the real choices are on screen.
     - When the clearance leaves **one depth** (W1S-26062 with the setback: C 9'-6" under A 11'-6" leaves 15" for the beam and its sag; at 14" only 12 × 1 flanges carry the deflection — BU14x94, 14" + 0.98"), the card says why and lists what 15"–21" would weigh, their depth + sag, and the clearance C each needs.
   - **How it was designed** (Beam calc page, click to open): the load on the beam with its numbers, how deep it can be (clearance C worked out), the plates and how many combinations the MB sheet ran and the production rules removed (by rule), what has to pass, the options (one line per different section) with the best fit's steps and every try, and what went on the quote. The Column calc page has the same for the column: its loads (which beams, which side), its length, the three combinations, the sizes tried in order, and a note on tubes / pipe. The long tables (Excel steps, depth table, columns tried, beams and supports) fold closed.
   - Pick an option (or a row in the depth table) and the choice is kept as intent: change a load, the slab or a clearance and it re-designs that option instead of pinning an old section.
   - **Beam marks over the whole job: interior and exterior** (see below). A mark is designed once, at its longest span and largest trib. Its shorter beams keep the section and get their own MB-sheet run.
4. **Sizes the columns** on the Column sheet:
   - Loads are the left and right beam reactions (MB `H6` dead, `H10` live), with e = d/2, the three load combinations, and column self-weight.
   - Tries W10X22, W8X24 and W12X26, lightest first. One section goes on the quote for every mezzanine column of the job (every mezzanine): the lightest that passes every load case. If none of the three passes, it takes the next heavier W and quotes it as `BU{d}x{wt}`, per the training guide. *Settings → Column section* can size each mezzanine on its own instead.
   - Column length defaults to finish floor → top of mezzanine (A), as instructed. This is not the training guide's (the clear height below the beams), and the Column calc explanation says so; *clear below beam* is in Settings.
5. **Quote sheet.** The MEZZ sheet of the quote workbook (NBS-IN Eng Quote Sheet), cell for cell. Copy a table, click its first cell, paste:

   | Table | Paste at | Cells |
   |---|---|---|
   | Mezz. Design Information | A7 (rows 7–12) | A MEZZ · B:C FF El. · D SLAB · E WT-NW/LW · F DLF · G COLF · H LLF · I PART. |
   | Mezz. Beams | A17 (rows 17–31) | A MEZZ · B:C SPAN · D TRIB. · E DLT · F LLF · G SECTION · H END WT · I QTY. |
   | Mezz. Columns | A37 (rows 37–39) | A MEZZ · B:C HEIGHT · D:E TRIB. AREA · F SECTION · G END WT · H QTY. |

   - **Nothing shifts, merged cells stay merged.** B:C (FF El., SPAN, HEIGHT), D:E (TRIB. AREA) and the J:K note are merged on the sheet. *Copy rows* puts two versions on the clipboard: plain text (the hidden half left empty) and a table Excel pastes as the sheet lays it out — each merged pair as one merged cell, in the sheet's Arial 8, centred, thin borders with a hairline bottom and its number formats (SPAN 0.000, HEIGHT 0.00). A plain-text paste would split those cells in two.
   - **The sheet's own formulas.** E, F, H of the beams and G of the columns paste as the formulas that are there (`=IF(B17="","",F$7+G$7+I$7)`, `=IF(B17="","",H7)`, `=IF(B17="","",40)`), each pointing at its mezzanine's design row. With partition carried as live load (Settings), DLT = DLF + COLF and LLF = LLF + PART., and the table says so: the sheet's own DLT adds PART. to the dead load.
   - **MEZZ** is the mezzanine's number: 1, 2, or "1&2" for a row of both. When the names carry no number, 1, 2, 3 go in the order of the design rows, and the table says which is which.
   - **No notes.** A row that fails gets a short FAILS note in J:K (I:K for columns), and only then is the copy that wide. *What each row is* under a table lists the marks, beams, lines and plates behind each row.
   - **Beams:** a row per mark and member length, ordered by mezzanine. SPAN is the member as laid out. A mark designed at a shorter span (a setback or a design span, Beam calc) keeps the layout length on the quote, as quoted by hand.
   - **Columns:** a row per section and height over the job.
   - **More rows than the sheet holds:** the table says how many rows to insert first.
   - W1S-26062 as the practice inputs leave it (4" slab, 5" joist seat: 15" of room) with the setback gives the rows quoted by hand for that job (17–22), with two differences. MB1 is BU14x94 for BU14x92: the Production Guidelines' tw / tf ≥ 0.30 rules out a 1/4" web under 1" flanges; with the guidelines off, it is BU14x92. MB2 is BU13x48 for BU14x41: 14" + 1.07" sag is 15.07", 1/16" over the room, so BU14x41 is listed as lighter but needing C 9'-5 7/8" (Beam calc → *How it was designed*, and the calc package's Beam options sheet).
6. **3D framing model.** Beams as I-shapes at the T/beam elevation, W columns with cap and base plates, building-column stubs, open-web joists at the spacing and a translucent slab. Drag to orbit; right-drag, Shift-drag or two fingers to pan; scroll or pinch to zoom toward the pointer (in up to 40×); click a member for its calc. With several mezzanines, the **View** chips (*Whole job · A · B · …*) or a double-click on one fly the camera to it and frame it, so a mezzanine at the far end of a long building fills the view; orbiting then turns around it. Panning, zooming or flying stops the slow turn; *Reset view* goes back to the whole job.

### Buildings attached to each other

A mezzanine can sit in a building attached to another one, such as a lean-to. Box 2 *Building Attachment* says how: "the BSW of Lean To attaches to the BSW of Sanctuary at 0'-0" from the left steel line".
- **Placement.** The attached building is placed in the other building's coordinates. Back to back (BSW to BSW, FSW to FSW) it is turned 180°; BSW to FSW it runs the same way.
- **Plan reading.** It takes the plan's letters, symbols and joist markup through that placement.
- **Shared wall line.** If both buildings have a beam on the wall they share, it is one member. The host building keeps it, because its columns carry it, and adds the attached floor's edge trib. On W1G-26097, line B carries 9'-8 ¾" + 14'-1" = 23'-9 ¾", and its loads go to the Sanctuary's BSW frame columns.
- **Frame loads.** They are listed per building.
- **One drawing.** The Plan page, the sidebar and large plans and the 3D model draw both buildings together, in the coordinates of the building picked at the top — the attached building's walls, lettered lines and loaded columns included. Hovering any column gives its own building's loads. In *Edit layout*, clicking the other building's mezzanine switches to it first, so its lines are edited in its own building. The floor-load card and the Column calc tabs cover every mezzanine of the job (with the Lean To picked, the Column calc shows the Sanctuary's columns). The attached building's own frame-line numbers run along its outer wall, dashed, on the plans and in 3D, so its columns ("2/A") read against its own bubble; the picked building's numbers stay on the other side. The C-numbers of the mezzanine columns are counted on the floor plan's building, so a column keeps its number whichever building is picked.

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

### Read off the floor plan

The plan has no text layer, so its geometry is read:

- **Joist direction** from the "Mez. Jst." / "JOIST" arrows inside each mezzanine (a straight shaft with a half arrowhead at each end, 10°–40° off the shaft; dimension ticks and hatching are at 45°). This sets where the beams go; the auto rule (beams on the shorter span) is only used when no arrow is found, and the other direction is offered on the Plan page.
- **Joist direction from the joist symbol** (the zigzag truss drawn across a bay) when a job has no "Mez. Jst." arrows.
- **Mezzanine columns:** every symbol style — ⊗, ⊘ (one diagonal, W2R-26047) and circled-I — is checked against the layout of every mezzanine. As read they must match: a column drawn but not laid out, or laid out but not drawn, is a stop that names it.
- **Frame columns are not mezzanine columns.** A bare I is a building (frame) column, and so is a ✱, the column the contract notes as designed "Most Economical" (Box 5 *Int. Column Type*). Where the drawing and the building data disagree, the drawing wins and the Design page says so:
  - a ⊗ or circled-I where Box 2 / Box 5 has a frame column → designed as a mezzanine column;
  - a ✱ or an interior I where the layout had a mezzanine column → taken as a building column (its load goes to the frame).
  - An I on a sidewall or endwall line never changes a support (wall openings are drawn with I-like marks). A wall column's I is drawn about 1'-9" inside its steel line and an end frame's ✱ about 1'-4" inside its endwall; both are read on the wall line.
- **Grid letters as drawn.** Bubbles on both endwalls, column lines and the ridge are lettered from the BSW, skipping I and O, so "2/C" in the notes is the drawing's 2/C.
- **The plan page is found by what it is,** not where it is: every drawing page (no text layer, hundreds of vector paths) is tried from the back, and the plan is the first whose grid bubbles register to the frame lines and that shows mezzanine columns or joist arrows. A components-and-cladding wind table or an elevation is vector-only too and is passed over (W2R-26047: the plan is page 16, ahead of the C&C table on page 17).
- **Rotated sheets.** A drawing set landscape with /Rotate 90 or 270 is read through the page's viewport transform, as printed — W2R-26047's floor plan is one; read without the rotation its frame-line bubbles run down the page and nothing registers. Markup annotations on such a page are placed the same way.
- **Frame-line bubbles may carry extras.** An attached building's end line can be drawn 1'-4" off the endwall, overlapping. Every frame line just has to find its bubble. When that pushes the drawing's numbering (the Sanctuary of W1G-26097 is drawn as lines 2–10), *Check before quoting* says so ("line 1 here is line 2 on the drawing") and keeps the PCS frame lines 1–9 (Box 5, NBG Frame files).
- **Markup over the plan.** A quote engineer's annotations are read too, and they win over the drawn symbols:
  - an **"X"** text box is a mezzanine column;
  - a line labelled **JOISTS**, and every line of its colour and direction, gives the joist direction wherever it crosses a mezzanine;
  - lines of another colour (the red beam lines) are kept as beams.

Example W0S-26160 (two mezzanines, "BSW" and "LEW", sharing the 96' line). B = 9'-0", seat 5", joists @ 4'-0", no C requirement:

| Mark | Section | Designed at | Beams | Qty |
|---|---|---|---|---|
| MB1 interior | BU28x50 | 28'-0" × 20'-0" | BSW B1, B2 (line C, 12'-4" + LEW edge 7'-8"); LEW B13 (line D, 18'-0") | 3 |
| | same | run at 12'-4" | LEW B14 (line D, 40'-4" − 28'-0") | 1 |
| MB2 exterior | BU26x36 | 28'-0" × 12'-4" | BSW B3–B5 (line C), B6–B10 (line A); LEW B11 (line E) | 9 |
| | same | run at 12'-4" | LEW B12 (line E) | 1 |
| Columns | W8X24 | 11'-6" | BSW 2/C–5/C; LEW 2/D, 40'-4"/D, 40'-4"/E | 7 |

All 7 columns match the drawing. Example W2H-26018 (one mezzanine) comes out MB1 interior BU24x30 × 4 at 20'-0" × 20'-0", MB2 exterior BU15x21 × 4 at 20'-0" × 10'-0", W10X22 × 4.

Example W2R-26047 (182' × 102', frames 1–7 multi-span with a "Most Economical" interior column at 52'-4"; the mezzanine 92'-3" × 51'-6 7/8" from 50'-5 3/16" off the FSW). Read as drawn: joists N-S from the JOIST arrow; beams on lines A, B and C over lines 1–4; ⊘ mezzanine columns at 2/B, 3/B, 4/B; frame columns A/1–A/4 (sidewall), B/1 (LEW endwall) and C/1–C/4 (✱ interior); the slab overhangs line 4 by 1'-3" and line C by 1'-10 13/16". Its (C) 8'-6" under (A) 10'-6" leaves 14" for the beams, and nothing stocked that shallow carries 30'–31' spans — the marks say NO SECTION and why. With C open: MB1 interior BU29x69 × 3, MB2 exterior BU30x45 × 6, BU8x31 × 3.

### Reading checks — a misread is never designed on silently

A misread moves every beam and column, so each check below is a **stop** on the Design page until the input is fixed on the Inputs page (or the drawing confirms it). Each was fed a deliberate misread of W2R-26047 to prove it fires (`test/plan.test.js`, `test/job5.test.js`):

- **Box 2:** bays not read, or adding to more than 2'-0" off the building length (part of a wrapped list lost); an endwall's column spacing not read, or not adding to the width.
- **Box 5:** no frame rows for the building; a frame line with no row, or a row past the last frame line; interior modules not adding to the width; a post-and-beam end frame whose columns disagree with Box 2's endwall spacing.
- **Box 22:** a footprint past the building's ends or sidewalls. A Box 22 building name matched to Box 2 only loosely is noted. Two mezzanines of one building that **overlap**, or stop just short of each other (under 6"), as read: laid out that way they would give two beam lines inches apart. The note names the edge and a red markup that moved it — S1B-26002: A's width marked up 26'-6" → 26'-8" runs it to 27'-4" from the FSW while B still starts at 27'-2", a 2" overlap (as printed, 26'-6", they meet on one line).
- **Read by OCR:** any Box 22 value read under 85 % sure is listed to check against the PDF, and said beside its field on Inputs.
- **The floor plan:** not matched to the grid (the reason is given); ✱ interior columns where Box 5 has none; mezzanine columns on the drawing and in the layout that differ. No joist arrow inside a mezzanine, or arrows both ways, is a warning (the rule's direction is used); no drawing at all is a warning to check the layout by eye.
- When everything agrees, the Design page says so: *Floor plan check: the drawing shows 3 ⊘ mezzanine columns in mezzanine 1, at 2/B, 3/B, 4/B — the same as the layout.*

### The Design page, top to bottom

1. **The design**: sections, beam and column counts, steel weight, and **Floor loads to the frame** — the dead and live, in kips, at each building column the mezzanine beams frame into: the MB sheet's unfactored end shears (*Floor dead / live load — shear at left / right*) of each beam, at its own trib, summed at the column. These are the numbers in the frame loads table, the CSV and the NBG Frame files; the card lists them as a small Dead / Live table, and columns with the same load share a row (2/A–5/A). The Beam calc page shows the MB sheet's end shear for the mark itself (at the mark's design trib) and says when some of its beams carry less.
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
- **Beams and columns:** numbered once over the job (B1 … B14, C1 … C7), so no two members on the drawing share a number; the grid label sits beside each column number. A column added on the Plan page is numbered after the drawing's (C29 on W1G-26097), and the plan legend says so — the others keep their numbers.
- **Editing:** the joist direction, the beam / support lines and *Edit layout* (below) edit the mezzanine picked at the top.
- **Tables:** the beam and support tables list the whole job, with each beam's end shear.

**Hover any column for its loads.**

- **Mezzanine column:** the Column-sheet input. Left and right dead / live in kips, and each beam framing in, with its mark, section, span and trib. Also the W, height, CSR and trib area.
- **Building column:** the load to the frame (total D / L) and the beams it comes from.
- **Beam:** its span, trib (with any neighbour's share), MB-sheet run and end shear.

The cards work on the plan page, the sidebar plan and the large plan. Clicking a column or beam opens its calc, and the 3D card shows the same loads.

The sidebar shows the job turning in **3D** or as a labelled **Plan** (grid bubbles, beams, C# columns, building columns). The plan lights what you are reviewing: the column case on Column calc, or the mark and member length on Beam calc. Click a column or beam to open its calc, or ⤢ to see the plan large beside the page. On a short window (a 1280 × 720 projector, a laptop) the sidebar tightens its spacing in steps and the 3D / plan square takes the height that is left, so the whole sidebar fits without scrolling and the square is never cut off.

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
  - each side of each mezzanine, on its framed line (not a slab overhang): sidewall, endwall, rigid frame, shared with another mezzanine (one floor — across an attached building too, where its edge beams are carried by the other building's), or free (independent X-bracing); a line shared for part of its length is one clause: "one floor with LEW for 40'-4"; the other 99'-8" free";
  - the 1% FDL + FLL brace force.
- **Scope:**
  - the DM 15.1.1.2 exclusions, as quote qualifications;
  - load-provisions-only hole patterns;
  - Ecospan, when the PCS mentions it.

### Beam inputs (Beam calc page)

Each mark has a **design span** and a **design trib**. They change only the beam design: the MB sheet, the section search, the options and the Excel steps (the quote keeps the layout length).
- **The plan stays as laid out.** Footprint, beam lines, which columns are mezzanine or frame columns, the Column sheet and the loads to the frame all keep the layout's spans and tribs. Only the mark's new section changes the beam self-weight in those loads.
- **Use it when a member is shorter than the grid**, e.g. the clear length between column faces: MB1 at 22'-4" instead of the 24'-0" column-line span.
- **The change in span applies to every member length of the mark.** With MB1 at 24'-0" → 22'-4", its 20'-0" and 16'-0" runs go to 18'-4" and 14'-4".
- **One member over the job:** a mark's inputs go on every mezzanine. *Back to the layout* clears them.
- **Frame column setback** (button, when it applies): the beams that run into a wall end at its columns, held in from the grid by the girts (1'-4" rigid frame, 1'-0" post-and-beam). Each member length is its layout length less its own setbacks, and the mark is designed at the longest. On W1S-26062 that is MB1 24'-0" → 22'-8", while Mezz 2's 20'-0" and 16'-0" MB1 beams keep their length because they end on mezzanine and interior columns. A design span typed in replaces it and goes back to the same cut on every member.

### When a beam does not work: one decision, asked like a missing value

When a beam mark has no passing section once the open values are in, the Design page does not show a failing design. It asks for one decision, the way it asks for a value the PCS leaves open: the same card at the top of the page, with the inputs on it.

- **What stops it, with the room for the beam spelled out.** *Clear height not met — MB1 needs 16.03", there is 15" of room*, and under it the room term by term: top of mezzanine A 11'-6" − clear under the beams C 9'-6" (= 24") − slab & deck 4" − joist seat 5" = 15". Then what the beam takes: 15" (BU15x104, the least room of any section that works) + 1.03" sag under the total load = 16.03". The room is the MB sheet's own clearance check (A − slab − seat − d ≥ C) and the sag is the MB sheet's TOTAL LOAD max deflection, so every number on the card is one you can find on the sheet. The joist seat is the value most often typed by hand, so the card says where it came from (typed, from the PCS, a blue note). The other causes are *Clear height below the minimum beam depth* and *No beam section in the depth range* (no clearance limit; nothing passes up to the deepest).
- **Nothing failing on screen while it waits.** The title reads *one decision to make*, and so do the status and the mezzanine tabs. The metric cards, the 3D model, the options, the quote sheet and the calc package come back once it is made; the sidebar keeps the layout turning in 3D meanwhile, the beams to decide in amber. The stop notes the missing section brings (*no stocked section*, *columns not sized*) are left to the card.
- **Three ways forward, with their inputs:**
  1. **Set the beams back at the wall columns.** A beam that runs into a wall ends at that wall's column, and the girts hold the column in from the grid (steel) line. So the beam is shorter by 1'-4" at a rigid frame and 1'-0" at a post-and-beam frame (or a soldier column).
     - The card names the columns and their frame. On W1S-26062 MB1 ends at the BSW columns 2/A–5/A (rigid frame, 1'-4"): 24'-0" → 22'-8", and BU14x94 fits: 14" + 0.98" sag = 14.98".
     - The amount is on the card, and in Settings.
     - *Use the setback* applies it to every mark whose beams end there (MB2 → BU13x48 too). Each member length is less its own setback.
     - A beam running along a wall, an interior column (on its grid line) and a mezzanine column take none.
     - The plan, the columns and the loads to the frame keep the grid spans, which is the conservative side for them.
  2. **Make room for a deeper beam.** The card names the beam that takes the least room with its sag and what it needs: *Use the 15" beam* (clear 9'-4 7/8" under the beams, 1 1/8" less than the PCS asks: C = A − (slab + seat + d + sag) / 12, on the 1/8" grid and never more than that leaves), or *Raise the floor to 11'-7 1/8"* (keeps 9'-6" clear: A = C + (slab + seat + d + sag) / 12). A request always asks for more room than there is. When the setback alone does it, this is the other way (at the span as it is).
     - Or type the clear height the estimator gives into the card.
     - When the setback is offered but not enough, the card shows both: *19" beam + setback* and the deeper beam without it, each with its clear height. The order follows the work: design, then the setback, then more clear height.
     - *Copy request* gives a short note for the estimator in plain words: the room there is and why (floor, clear height, slab, seat), what the beams need with their sag, and the two asks (the clear height lowered, or the floor raised, by how much).
     - With no clearance limit, this row is *Shorten the span or the trib*: the Plan page, or the long beam on its own mark when the rest pass.
  3. **Check the joist seat.** The room is measured down from the joist seat, so a shallower seat gives the beam that much more room. The card offers the standard seats below the one in use, K-series 2 1/2" and LH-series 5", each with the room it leaves and whether the beam then fits (or fits with the setback), and an input for any other seat. It is a check of the input, not a way around the clearance: pick a seat only if the joists on the job have it.
- **The design runs as soon as one is picked**, and the page shows the full design. Beam calc shows the same card for the mark, above its depth table.
- Examples:
  - W1S-26062, the practice job (A 11'-6", C 9'-6", slab 4", 5" LH seat: 15" of room): MB1 needs 16.03" (BU15x104, 15" + 1.03"), so the card asks. The setback → BU14x94 / BU13x48 (14" + 0.98", 13" + 1.06"); or the 15" beam with C 9'-4 7/8" (or the floor at 11'-7 1/8") → BU15x95 / BU15x46; or a 2 1/2" K seat (17 1/2" of room) → BU16x77 / BU15x42. With a 6" seat (14"), the setback is not enough on its own: BU14x102 + setback needs C 9'-5", or the 15" beam without it C 9'-3 7/8"; the card's 5" seat chip reads *enough with the setback*.
  - W2R-26047 as read in the browser (A 10'-6", C 8'-6", 5" LW slab at 42 psf, 5" seat from the blue note: 14" of room): the setback leaves both marks short (at 30'-0" MB1 still needs 19" + 1.37" = 20.37"), so *19" beam + setback* (clear 7'-11 5/8") → BU19x111 / BU19x61, or without the setback C 7'-10 1/2" → BU20x101 / BU20x55. The 2 1/2" seat gives 16 1/2", still short. (The command-line tests read this PCS without its rendered check boxes, so they take NW concrete at 55 psf: 19" + 1.47", C 7'-11 1/2".)

Don't shorten the mezzanine footprint for this. On W1S-26062, cutting Mezz 1 to 22'-4" moves its edge 1'-8" off the BSW column line. That puts six new mezzanine columns along 118'-4", and frame line A loses its loads. Now that case is flagged: a footprint edge between 1'-0" and 3'-0" short of a line of building columns gets a warning on the Design page.

### The NBG workbooks themselves

The spreadsheets are the foundation: everything the tool designs is an input put into NBG's own workbooks and their output read back. To walk an engineer through a job:

- **Add the workbooks once** (Design page → *Check it in the NBG workbooks* → *Add workbooks…*): Mezzanine Beam Design 13th / 15th / 16th, Mezzanine Column 15th / 16th, IBC Seismic. They are recognised by their sheets and kept in this browser (IndexedDB) — nothing is uploaded, and no workbook is part of this tool or this repository.
- **Download a filled copy** of any of them: a beam workbook per sheet set (INPUT + MB1–MB4), a Column workbook per column case, an IBC Seismic workbook per frame line (Input Data, Lateral Calcs. (1) for that frame, Longitudinal Calcs.). **At the top of the Beam calc and Column calc pages** a bar names the workbook filled for what the page shows (its tabs, how many cells are typed in, which copy of the workbook it uses) with *Download the filled workbook (.xls)*; **at the top of the Seismic calc** (Calcs page) one button per frame line. The same buttons are on the Design page and on each frame row of the Seismic calc.
- **A private copy with the workbooks built in.** `EMBED_WORKBOOKS=<.xls>:<.xls>… BUILD_OUT=<file> node build.js` writes a copy of the tool that carries the engineer's own workbooks (gzipped inside the page), so every download works at once with nothing to add; one added on the computer takes the built-in one's place. The build refuses to embed them without `BUILD_OUT`: they never go into the shared `index.html` or this repository.
- **What the copy is:** your own workbook with this job's values typed into its input cells (the cells listed below) — numbers, text from the drop-downs, the check boxes as TRUE / FALSE — and nothing else changed: every other part of the file, the VBA project included, is byte for byte the original. Excel recalculates the whole workbook when it opens the copy (and asks to save on closing), so every result is the workbook's own.
- **Checked:** `oracle/fill_dump.js` fills every workbook for the six sample jobs with a text layer and `oracle/fill_check.py` opens each copy: xlrd reads all 2,330 typed cells back, and LibreOffice recalculates and reads 679 results — beam end shears, deflections, combined / shear, the column combinations, Cs, each frame's mezzanine load and base shear, the bracing loads — all equal to the tool's (W1S-26062's MB1 waits on its decision as loaded, so its sheets come in with the setback, below). The seismic workbook holds two mezzanines: on a building with more (the SC contract's four), the first two are typed and what it shows is worked out from those two, so its base shears there are below the tool's, which carry every mezzanine (the workbook notes say so). With the 16th edition set: 2,366 / 652, 0 differ. The runs with other settings below were last made before the seismic engine was matched to NBG Design Calcs. The same with split marks (1,829 / 500), the built-up column alternative (1,024 / 204), a W10X33 column (1,717 / 436), the 16th edition with split marks (1,845 / 484) and the frame column setback on MB1 / MB2 by the girt rule (2,117 / 538: W1S-26062 MB1 BU14x94 and MB2 BU13x48 at 22'-8" with its seismic workbooks, W1G-26097 MB1 and MB2 at 19'-9 3/4", each shorter run at its own length): 0 differ in each. W2R-26047's clearance leaves no section, so it is also run with C opened (286 / 85, its overhang-loaded columns and frames 1–4 included), and with C opened and the setback (286 / 85, MB1 and MB2 at 30'-0"): 0 differ.

### Calc package (bottom of the Beam calc and Column calc pages)

A bar at the bottom of the calcs exports what an engineer needs to check the design:

- **Design basis (.xlsx)** — one Excel workbook:
  - *Summary*: the job, the sheets used (beam / column edition, specification, division), the stress-ratio and deflection limits, every beam mark and member length with its section, plates, flange economy, ratios and end shears, the columns, and what to check before quoting.
  - *Inputs*: every value read or typed, its source (PCS, typed, deck guide, standard value) and the workbook cell it goes into; the design settings.
  - *MB sheets* and *Columns*: each cell typed into the Mezzanine Beam Design / Mezzanine Column workbook and what the sheet shows.
  - *Beam options*: how each section was found — the options, the best-fit steps, the sections the production limits left out (in words), the lightest section at each depth, and the deeper ones with the C each needs.
  - *Shop rules*: the NBG Production Guidelines by division and the chosen sections checked against them, the Economical Flange Sections chart, the DM 5.1 stock.
  - *Frame loads* and *Seismic*: the FDL / FLL and EQR / EQL on each frame's columns, and the IBC Seismic cells typed per frame line. While the Seismic calc is not finished, the Seismic sheet says so and lists what it still needs, the Summary says there are no EQ loads, and Sources marks IBC Seismic as not used yet.
  - *Sources*: each workbook and guide, what it gives and how it is checked.
  - *Steel take-off* (Summary): beams, columns and plates by mark, with a total — counted only for members that are sized (W1G-26097: 41,629 + 13,888 + 3,528 = 59,045 lb). Marks with no section and columns not yet sized are listed, not weighed.
  - *Design decisions*: each choice made for the engineer (a pick by hand, a column quoted BU, a mark split) with its reason, said once for the whole job.
- **Everything (.zip)** — the design-basis workbook plus a filled copy of every NBG workbook for the job (beam, column, seismic), for the workbooks added to this browser.

An engineer can change an input in a filled workbook and see the answer there, or use *Design your own* (below) to try another section.

### Design your own (beam and column)

The *Design your own* page is the MB sheet and the Column sheet without the search: type the loads (dead, collateral, live, joist weight), member length, unbraced length and trib, and a section (BU plates or a W), and it answers like the sheet — end shears (floor dead and live to the column / frame), combined and shear ratios, deflections, joist bearing — with the production rules, the stock and the flange economy beside it.

- **Start from this job** loads any mark's or column case's inputs, and they follow the job while they are not edited here: pick another option for the mark (or edit the layout) and the designer shows the section and numbers the mark has now (it used to keep the earlier section under the new name until a source was picked again).
- **Sections that pass** lists the lightest sections that pass within 3" of the depth (flagged when deeper than the mark's clearance allows); *Load* puts one in.
- **Use this section** puts it on a mark of the job (flagged if it does not pass); the Design page's *Lightest* option puts the search's answer back. A section picked this way (or from the depth table) gets its own *Picked by hand · In the quote* card under Beam options, with its ratios and any flag (red when it fails or breaks clearance C).
- **A W beam on a mark:** the W's own dimensions come from the W table (d, bf, tf, tw), so the depth, the clearance C, the DM 15.1 checks, the drawings and the 3D model read it like any built-up section. A W is A992 steel, Fy 50 / Fu 65 (built-up plate stays Fy 55 / Fu 70, the sheet's default). The MB workbook download types it on the sheet's own WF input — Q4 = 3 (K19 "WF"), M21 the W name — with its d, tw, bf, tf in M22–M27, which the sheet's WF path also reads, and the material at Q11 = 2 (M30 = 50) with M31 = M32 = 50, M33 = 65; the filled copies recalculate to the tool's numbers on the sample jobs and in the 13th, 15th and 16th editions (fill oracle with W picks, 0 differ). A W that does not pass says which check fails (W0S-26160 MB1 W24X55: combined 1.19, total L/237 < L/240). A mark with no section can be given one here too (it is listed with its span and trib). The joist-bearing check (J10) here covers built-up sections; for a W the DM item says to check it by hand.
- **Column tab:** a W, or a built-up column (depth, flange plate, web) on the Column sheet's Built-Up input with the production limits and stock beside it; *Built-up columns that pass, lightest first* searches the stocked plates. *Use* sets the job's mezzanine columns to it.

### Edit the layout (Plan page)

*Edit layout* on the framing plan. As the pointer moves, the bar under the buttons reads where it is — "61'-0" from the LEW (line 3) · 76'-0" from the FSW · 26'-0" from the BSW (line B)" — with a cross-hair over the plan; points snap to a grid, beam or column line within 6", else to the inch. Then:

- **drag a mezzanine column** along its beam: the bar and a ghost beside it read where it is going, and it lands there (the beam splits there, its old place spans through). A column where the beams end takes its whole column line with it.
- **click a column** — *Make it a frame column* (its beam reactions go to the frame design as FDL / FLL; if the frame has no column there, the frame loads say to add it in NBG Frame), *Make it a mezzanine column* (designed on the Column sheet; the frame takes no mezzanine load there), *Take the column out* (the beam on that line spans through; never a beam's end), *Remove the line of columns*, *Move this column to* a typed x from the LEW and y from the FSW or the BSW (on a beam line), or *Move its column line to* a typed distance. The menu shows where the column is, from the LEW and both sidewalls; so do its hover tip and the selected-member card.
- **click a beam** — *Add a mezzanine column on this beam at* a typed distance (it opens at the point clicked), *Add a point load on this beam*, or *Remove the beam line* (the joists span past it). An edge beam stays, unless the next beam line is within 6'-0": *Cantilever the joists to this edge* takes the edge line out (no edge beam or columns), the joists run past the next beam to the slab edge and that beam takes the floor — said under Design decisions, the joist supplier designing the extended ends.
- **click the floor** — *Add a beam line* or *Add a column line* at the point clicked, or at a typed distance (from the FSW or the BSW across the width), *Add a floor opening*, or *Add a point load here*.
- **click a point load** — *Move or change it*, or *Take it out*.

Lengths are read the way they are typed in a hurry, in every box: `20'-3 1/2"`, `20-3-1/2`, `20 3 1/2`, `20 3.5`, `20ft 3in`, `20.25` (feet), and `20-3/2` for 20'-3 1/2" (a fraction over its own denominator is the inches and that part; a proper one, `20-3/4`, is 3/4"). The box shows back what it read.

### Point loads

A stair, a piece of equipment, a hanger — *Add a point load* on the Plan page (P in kips, or `5000 lb`; live or dead). On a beam it is that beam's; on the floor the joists take it to the beams either side by the lever rule (the shares are on its hover tip, and a joist under it is to be checked with the joist supplier). A beam that carries one is designed on the MB sheet at the uniform trib that gives at least its largest moment and end shear — for the dead and the live part each — as a mark of its own, numbered after the others so a section picked by hand stays on its mark; its ends take the loads by statics, so every kip reaches the columns and the frames once. An opening's trimmer works the same way: designed at its equivalent trib, its columns take the cut beam's end (its floor and its own weight) by statics.

**From the PCS notes.** A special note giving a mezzanine a load ("support of 2000# stair located at frame line 3", "(2) 250# point loads") is read: under *Check before quoting* with **Place it** — one click puts it in the design (on that frame line; on the edge the note names), to be moved on the Plan page where the drawing has it. A grid of loads ("an 8'x8' grid with a 5kip load between each beam span") is compared with Box 22's uniform loads: 5 k on 64 sq ft is 78.1 psf against live + collateral.

### D and F under the frame

With the job's `.frame` files on the Project page, the Design inputs read D and F off the rafters: on each frame line over the mezzanine the underside of the rafter across its width (the top of steel and the depth at each section point of the file's rafters, haunches included), its lowest point — **F** from the finished floor, **D** from the top of the mezzanine floor (F − A) — against the PCS's D and F when it gives them.

Every edit re-designs the whole job — beams, columns, the frame loads, the seismic, the quote — and is listed on the Design page. *Undo* steps back, *Reset layout* returns to the building grid and the PCS drawing. A line added within 6'-0" of another is flagged under *Check before quoting* (short beams or extra columns there). When an edit leaves a mark with no passing section, every summary says so: the governing-ratio dial reads NG with what is not sized, the mark rows read NO SECTION, the columns read "N not sized", and the steel total is "at least" with what is missing.

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

**Frame loads.** Each frame line lists the mezzanine dead and live that reach the frame's own columns: the unfactored beam end shears (MB `H6` / `H10`) summed at each column, at the floor level (A) — the height NBG Design Calcs uses for the mezzanine — or at T/beam with the switch. With the Seismic calc complete, each column also shows its EQR / EQL share. Columns are numbered the way NBG Frame numbers them: COL01 at the FSW, then each Box 5 interior column, the BSW column last. Mezzanine columns are never in this list. An endwall column beside a rigid end frame is shown, dimmed, as *not a member of this frame*, because its load goes to the endwall design. Copy a frame line, or download the whole table as CSV.

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
- **Seismic rows** (from the Seismic calc) are written the way NBG Frame writes its own lean-to seismic rows: X force ± at the mezzanine level, Ecc. Loc. Top/Left — an X force with no offset takes no moment from the flange it is drawn at. EQR rows switch to Bottom/Right once that code is confirmed (pick it from the same check file, or drop a frame where EQR rows were set to Bottom/Right by hand).
- **The roof seismic** stays NBG Frame's own in the file. The card shows NBG Design Calcs' roof seismic weight and factor for those lines (Seismic calc, step 7) to set it by hand.
- **Nothing else in the file changes.**
  - The connections and detailing entries are copied byte for byte.
  - The model text only gains the new rows and the two 1-psf values: CRLF line endings and indentation as NBG writes them.
  - Results stored in the file are recomputed when the frame is processed.
- **In NBG Frame:**
  1. Open the file.
  2. Process → Get Applied Loads → final pass.
  3. Tools → Concentrated (Panel) Loads: check the rows, then *Save and Gen Loads*.
  4. With seismic: the EQR / EQL rows are in — check them against the Seismic calc.
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

### Snow and drift (Calcs page, Building page, Frames page)

`src/snow.js` works snow as NBG Design Calcs does (ASCE 7-16 chapter 7; 7-10 alike; 7-22 with its winter wind parameter W2 and no Is): pf = 0.7 Ce Ct Is pg; ps = Cs pf with Cs from Fig. 7.4-1; the low-slope minimum pm; rain-on-snow; gable unbalanced snow (7.6.1); roof step drift (7.7: hb = ps / γ, hc = h − hb, leeward hd from the upper roof's fetch, windward ¾ hd from the lower roof's, hd ≤ hc → w = 4 hd else w = 4 hd² / hc ≤ 8 hc with hd = hc, pd = hd γ; a separate building per 7.7.2; a drift wider than the lower roof cut off at its far edge); sliding snow (7.9).

`src/site.js` places every building of the PCS on one site through Box 2's attachment notes (a sidewall or an endwall; back to back turned 180°), gives each roof's height anywhere on it, finds the roof steps along each shared wall (an endwall rake raises the step toward the ridge), and puts each step's drift on the lower building's frame lines:
- a **side-wall step** (the lower building's sidewall against the higher wall): the drift runs across the lower frames — each frame line takes pd × its tributary width at the wall, falling to 0 at w (or to the drift's value at the far eave): a triangle, PY, "Snow Drift";
- an **end-wall step** (the lower building's endwall against the higher wall): the drift runs along the length — each frame near that end takes the drift over its own tributary strip, uniform across the frame: the frame's total snow less the base snow;
- cut where the roof panels change (RP1 / RP2); negative = down; positions from the FSW, in the frame's own coordinates. The same rows go under SL, LRD and RRD, as NBG Frame enters its own lean-to drift.

The PCS reader lists every building of Box 2 (a lean-to or canopy with no mezzanine too), Ct and the roof-obstruction column of Box 4 (No → an unobstructed slippery roof), Ce and W2 from Box 3, Box 4's additional obstructions, and joins a dimension the table wrapped onto the next line.

**Checked:** NBG Design Calcs' own unbalanced-snow document to float precision; every drift case by hand (leeward / windward, capped at hc, cut off, a separate building, sliding); the sample jobs' roof snow against Box 4 wherever the PCS has no override; the lean-to and canopy steps of the sample jobs (`test/snow.test.js`).

**The fetch.** The upper roof's fetch runs on through every attached roof that meets it level (within 0'-1"): an extension in line with the main building gives the main's length plus its own, as the engineer types it in NBG Design Calcs. NBG Frame's own automatic lean-to drift ("BackSidewall Drift") takes the adjacent roof alone — on the real job that is 22.3 psf against 71.1 psf; the Frames page shows both and the tool's rows replace NBG's.

**Sliding snow (7.9).** By the code it applies only where the upper roof drains toward the step; *Include, as NBG Design Calcs works it* adds it the way Design Calcs does (0.4 pf W over 15 ft, W typed when the drainage length differs), and *Leave out* drops it. Where both act, each point takes the larger of the drift and the sliding load — 7.9 says they need not be combined, and NBG Design Calcs' Total Snow is the balanced snow plus the larger of the two.

**The uniform snow on a frame line** is what NBG Frame applies to the roof: Box 4's user override where the PCS has one, else the larger of ps and the low-slope minimum pm. The drift sits on the balanced ps (hb = ps / γ, 7.7); pm is a load case of its own and never sits under a drift. On the real job: ps 15.4 psf, pm and the override 20.0 psf → 0.580 k/ft on a 29'-0" bay.

**Into the frame file.** The Frames page writes the Snow Drift rows into the frame line's `.frame` file in the engineer's format — a `<PLoad>` per segment, load case SL (and LRD / RRD when the frame has them), panel RP1 / RP2, direction **PY** (snow on the horizontal projection, as the engineer enters it; NBG Frame's own automatic drift row is GY, and GY can be picked), k/ft negative down, positions from the FSW — scaled to the file's own bay width. An existing drift row ("Snow Drift", "Sliding", or NBG's "BackSidewall Drift") is replaced, never added to; clearing the rows gives the original file back byte for byte.

**A lean-to on an endwall.** The lean-to's own frame file, designed with its drift, gives its support reactions: the rows go on the host end frame's columns where the lean-to's frame lines land, named after the source file and its column ("Lean to - COL02 - Reaction" for `Lean_to.frame`), at the lean-to eave, Y = −V and X = −H at the top, Ecc. Loc. code 3, the host's load cases only — the 24 rows match the engineer's own file exactly. A lean-to file designed for a bay wider than the host's tributary is flagged (the real job's 27'-0" reactions on both host columns would put 54'-0" of lean-to on a 27'-0" building), with optional scaling.

**On the Calcs page** each snow card opens its own calc: *Unbalanced Snow* (each roof's balanced and unbalanced, drawn **both ways the wind blows** — from the FSW with the surcharge, the "alt snow", on the BSW slope, and from the BSW with it on the FSW slope — as NBG Design Calcs gives WindToRight and WindToLeft; on an unequal gable each way has its own: hd on the windward eave-to-ridge run, S of the leeward slope, and the larger one stands for the roof; the Frames page lists the alt snow to type into NBG Frame's SnowLeftSlope / SnowRightSlope cases) or one *Roof Step Snow Drift* (the step section with hb / hc / hd, the drift triangle with **Dmax = pd** at its apex and w dimensioned along the roof). Drift is not unbalanced snow: they are separate cards. The code is picked at the top of the snow data (ASCE 7-10 / 7-16 / 7-22) and every input can be typed over. The Design Calcs file's wind document opens drawn: the MWFRS zones of each load case on the building with their pressures (qh × the zone's coefficient, internal pressure included), and the components-and-cladding zones with theirs.

An unequal gable (Box 2 gives the ridge's distance from one sidewall and both eaves) has its ridge where the two roof planes meet, from either side.

### The 3D and its own window

The sidebar is the 3D, and it follows the page: the whole building on the Building page; on the Frames page the frame picked, flown to, the rest faint; on the Bracing page the bracing and the floors, the frames left faint as the outline. *Show all* puts the whole building back (*Refocus* returns) until the page or the frame changes. In the Mezzanine workspace the 3D carries the bracing that holds each floor: a portal frame on the floor's edge (its legs where the mezzanine columns were, its beam under the edge beam, named), X-bracing or knee braces on an edge, the sidewall's braced bays beside the floor (X-bracing, portal frames) and the strut line at the floor — under the Bracing layer. *Layers* turns the roof, snow, mezzanines, bracing, purlins, frames and labels on and off (snow and drift labels go with the roof; snow is on the roof, never inside the building). Drag turns it around the point under the pointer, the wheel zooms to the pointer. ⤢ opens it in a window of its own for a second screen — the whole building on the building pages (pick a frame there: it is isolated, and opens on the Frames page here without moving this page), the mezzanine in the Mezzanine workspace (its 3D or its plan). Bracing edits (a new line, a tier, a strut line, a portal frame) show in the 3D as they are made.

### Seismic to the frames and the bracing (Calcs page)

The page is NBG Design Calcs' Seismic module, typed in section by section in its order and worked the way it works it, and then put into the files: EQR / EQL on the frame columns (NBG Frame) and EQB / EQF with a wall strut line on the walls (NBG Bracing).

**The job's NBG files.** Drop the job's bracing file (`.bracing`), eScope (`.nbgscope`) or Design Calcs file (`.nbgcalcs`) at the top of the page. The code, Ss / S1 (SMS / SM1 for ASCE 7-22), site class, risk category, roof dead, collateral and snow are taken from it in place of the PCS's — the PCS can list one code (IBC 2024 / ASCE 7-22) while the job is designed to another (IBC 2021): the bracing file names the one eQuote ran. A value typed on the page still wins.

1. **Building data**: the code (the PCS's, the file's or yours — the PCS's Ss / S1 belong to its own edition, so a different code asks for its own), gable or single slope, width, length, BSW distance to ridge, slopes, eaves (PCS Box 2), and the mean roof height NBG uses for the roof mass.
2. **Seismic data**: nature of occupancy, site class (D when "assumed"), roof and mezzanine level diaphragms, Ss, S1 (7-22: SMS, SM1 from the hazard tool — read off the PCS), and the check boxes: "not detailed for seismic" in SDC A–C; *significant mezzanine exists* — unchecked unless you check it, as in NBG Design Calcs (each weight then takes Cs × W; checked, the vertical distribution with k from Ta); irregularities; accidental torsion in the long. / lateral direction.
3. **Roof loading**: lateral frame self-weight 2 psf, roof self-weight 0 (NBG's defaults); roof dead, collateral and snow from the files, the PCS (Box 4) or a dropped frame file — "Per Seller" is asked for, never guessed.
4. **Walls**: each wall full height or a partial height hardwall (masonry to its top, its own weight, the panel above), a parapet to a top elevation, a self-supporting shear wall (left out in its own plane); 3 psf metal panel by default — an endwall to the roof line, a sidewall to its eave.
5. **Mezzanine loads**: elevation (A), floor dead (the design's dead load with this design's beams and half its columns — type yours, e.g. 10, to use it as it is), floor collateral, estimated joist weight, storage loading (25 % of the floor live), partition loading.
6. **Force resisting systems**: FSW and BSW (X-bracing unless set; portal frames, IMF) and each frame line's system (PCS Box 5; IMF / SMF / SCBF can be picked).
7. **Lateral calculations — NBG Frame**: every frame line, its tributary width (half the bay each side, an end frame half the end bay — type over it in step 6 or 7, for the roof and both sidewalls; a roof concentrated load per line too, as Design Calcs takes them; both are written back into the `.nbgcalcs`) and the mezzanine floor in its strip. Per line: the system and R, Cs, the roof seismic weight (and alt. with the sidewalls), the seismic factor, the concentrated loads (sidewalls at eave − 16", each mezzanine at its elevation) and the base shear; a row opens the seismic factors and the multistory distribution.
8. **Into NBG Frame**: one table, one row per frame line × column × level — the frame columns the mezzanine's beams frame into, the mezzanine force shared by the dead load each takes (or equally), **Calculated** and **Applied**. Applied is what the frame files get, EQR = +Applied, EQL = −Applied, at the mezzanine level:
   - type a value in Applied to use your own (↺ goes back); *All loads ×* multiplies every calculated load; typing 0 leaves the rows off that column;
   - a value typed in a frame-file card's EQR X Force sets that column for every line the file designs (3, 4 and 5 for a 3-5 file);
   - *Back to the calculated loads* clears every edit; edits are kept on this computer with the job (by quote number), and a typed value whose column or level no longer exists is flagged and not used.
   - A frame line with mezzanine area but no frame column the mezzanine frames into is flagged: that share needs independent bracing or another frame.
9. **Longitudinal — NBG Bracing**: the whole building. What NBG Bracing takes: roof snow, roof dead, roof total and alt. roof total (psf), the seismic factor, the concentrated loads (sidewalls at the eave, each mezzanine × 1.1 with a rigid mezzanine diaphragm and accidental torsion) and the base shear. **Each mezzanine sends half its force to each of its two long edges**, in EQB and in EQF: an edge on a sidewall goes to that wall's bracing; an edge with any free stretch is a bracing line of its own (X-bracing, a portal frame or another system picked on the Bracing page), for the larger of the seismic and the DM 15.1.3 1 % stability force; an edge joined all along to another mezzanine at its level passes its half through that one to its far edge. Two mezzanines between the BSW and an interior line: the BSW gets half of each. The lines hold the mezzanine total once, and the Bracing page shows the total and each line's part. A portal frame picked on a line takes the place of the mezzanine columns at its ends (and of a mezzanine beam in that bay) — the mezzanine design follows.

**The results in kips.** Under the summary: each frame line's mezzanine load on each column it frames into (EQR / EQL) and each bracing line's EQB / EQF, with the mezzanine total they add up to.
   - **The bracing file**: with the building's `.bracing` dropped, the page lists the rows it gets — exactly what *Tools → Add Loads* takes: Load Name "Mezz. Seismic", Load Case **EQB** (+F) at the mezzanine's first frame line and **EQF** (−F) at its last, Panel the wall's plane with its grid line, Elevation the mezzanine's, X - Longitudinal — and the **wall strut line** (*Tools → Add Wall Strut Line*: to the wall, from the mezzanine's frame lines to the wall's braced bay, at the mezzanine's elevation), so the loads have joints there. *Download …_mz.bracing* writes them in: earlier "Mezz. Seismic" rows are replaced, other loads kept, a strut already at that height kept, and everything else in the file left byte for byte. The strut line is new — if NBG Bracing does not take it, untick it and add the strut line there by hand (the loads stay).
   - **Which wall is which in a bracing file.** NBG Bracing keeps the bays of grid line A — the back sidewall on Nucor drawings — under `<FrontSidewall>` (AtGrid 0, struts at DistanceFromA 0), and their eave strut, girts and brace tops are the back sidewall's height; `<BackSidewall>` holds the front sidewall's bays. Only each element's own WallTop names the other side. Every run seen with unequal eaves reads this way (five of five), and read this way the reviewed job's rods sit exactly where PCS Box 12 puts the X-bracing (Main FSW bays 2 and 4; the shop's FSW bay 1). So each element is keyed by its bays' eave strut against the PCS eave heights, or by line A when the eaves are equal, and the EQB / EQF go on the plane whose bays are that sidewall. The Bracing page states the mapping for each file. **Confirm once in NBG Bracing** — open the file and see which wall the rods in bays 2 and 4 are drawn on — before relying on the written loads.
   - **Against PCS Box 12.** The rods in the file are compared with Box 12 bay by bay: X-bracing in other bays, X-bracing where Box 12 asks for portal frames, a braced wall Box 12 lists as None, or no braced bay yet — each is flagged. The file's portal frames (`<PortalFrames>`, by wall and bay) are braced bays too: the strut line runs to them; a Box 12 portal bay the file leaves bare is drawn from the PCS.
   - **What the file's last design found.** Each rod (`AxialLoad` / `AxialAllowed` and the governing combination, named from the file's own load combinations: `1.029 SW + 1.029 D + 1.029 C + 0.91 EQF`), each strut line (a girt or purlin used as a strut has no allowable — "not checked": at the mezzanine level that axial goes to the mezzanine's edge beam, DM 15.1), each portal frame (its largest sway reaction against the capacity its ID names — PF…H5K: 5 k — and its drift), the cost and weight, and whether the run was designed.

### The job's Design Calcs file (Calcs page)

`src/calcsfile.js` reads an NBG Design Calcs file (`.nbgcalcs`: JSON, a folder a building, a document a calc) and writes it back:
- **Read**: each folder matched to a building of the job by name, else by width and length; each document's kind (unbalanced snow, wind, seismic, roof step drift) and the few numbers its card shows; the seismic inputs as Design Calcs takes them — code, site, roof, walls, the uniform mezzanine loads, each lateral calculation's system, bay, loading area and concentrated load, the longitudinal's.
- **Compare**: every input and result of the tool's seismic against the file's, grouped as Design Calcs lays them out (code, building, roof, walls, each mezzanine → its file ID, each frame line, the longitudinal). Post & Beam and X-Bracing tie as the same seismic system (braced frame), Portal and Rigid Frame likewise.
- **Write**: the mezzanine loads into each matched seismic document — the floor's uniform loads, each frame line's and the longitudinal's Mezzanine ID, Loading Area and Concentrated Loads — with the base shear results worked again by `src/seismic.js`; everything else, the byte-order mark and the line endings, as they were. A practice job's file, its inputs typed in from the file, comes back with all 1,022 numbers as they were.
- **Canadian codes** (NBCC) are read and shown, not worked: the file's own numbers open on its cards.

**As NBG Design Calcs works it**: Fa as interpolated, Fv to two decimals; SDS = 0.6667 SMS, SD1 = 0.6667 SM1; Site Class E's Fa at Ss ≥ 1.0 from Site Class C; "not detailed for seismic" (R 3) in SDC A–C; the least R of a direction (12.2.3.3) with Risk Category III / IV or a rigid diaphragm; Ω0 less 0.5 (not under 2) when the diaphragms are flexible; ASCE 7-16's 11.4.8 exception (1.5 × Eq. 12.8-3 past 1.5 Ts) for Site Class D only with S1 ≥ 0.2; the 12.8.1.3 cap with ρ = 1; the roof weight on its sloped length with the snow on plan (20 % of Pf over 30 psf; ASCE 7-22 15 % over 45 psf); an endwall's outline and centroid; the roof seismic weight for NBG Frame / NBG Bracing that gives the same base moment as the roof and endwalls (alt.: with the sidewalls).

**What the tool does beyond NBG Design Calcs** is listed on the page, each with its switch: the framing weight in the floor dead; the loading area of each frame line from the layout; how a frame's load is split between its columns; the bracing lines, EQB / EQF rows and strut line; EQR Top/Left until Bottom/Right is confirmed; and, when a mezzanine floor is over a third of the building, a note that it is a story under IBC 505.2.1 (the box stays unchecked unless you check it).

**Load level.** These are Q<sub>E</sub> (12.8), before ρ and the ASD 0.7 — NBG Frame's and NBG Bracing's load combinations apply them.

**Checked** against NBG's own validation examples for NBG Design Calcs (`oracle/nbg_seismic.js`; the prints are parsed by `oracle/nbg_parse.py` into private fixtures): 22 examples — ASCE 7-16 and 7-22, gable and unequal gable, site classes D and E, SDC B–D, Risk Category III, end, interior and partition frames, full / partial-height / parapet / shear walls, partitions, cranes, one and two mezzanines with and without a significant mezzanine, rigid and flexible diaphragms, Ta / k overrides — **4,985 of 4,985 printed values tie**; and an NBG Design Calcs file (`.nbgcalcs`) to full precision, 378 of 378 values to 1e-9. The bracing file writer is checked on a model made in the test and on a real bracing run (`test/bracing.test.js`).

### Jobs remembered

When a job is fully designed (every mark has a section, every column is sized) it is saved in the browser on that computer: the values you typed for open fields, the option you picked, the joist direction and the sections. Preferences in Settings carry to the next PCS; the sheet edition and the stock division go back to Auto, since they belong to each job's code and plant. A job whose hand-picked section fails, or breaks the clearance C, is not saved as designed. The Seismic calc's entries (typed values, EQ scale, typed EQ loads) are kept per quote: opening the same quote brings them back with a note and a *Clear them* button; *Forget all* clears them too. Next time:

- **Your usual values come first.** An open field offers what you entered most on other jobs ("your usual · 3 jobs").
- **Re-opening the same quote** offers your entries from last time in one click.
- **Exactly what you typed.** Remembered lengths are kept on the 1/16" grid, so a 5" joist seat comes back as 5", not 5.0004" (it was kept in feet to four decimals, 0.4167 ft, which took a hair off the room for the beam). The engine reads depths to the nearest 0.001" as well.
- **Option hint.** The Beam options header says which option you usually quote.

The design math never changes with history; it stays the NBG sheets. Settings → *Jobs remembered* can export the list as JSON (to send in so the jobs become regression tests), import it on another computer, or forget it.

### Nothing assumed

When the PCS leaves a value TBD with no blue note, the design does not run on a guess. A **Needs your input** card at the top of the Design page asks for it, with one-click typical values, and shows the total joist depth A − B − slab − seat as it fills in. On a job with several mezzanines, one entry fills every mezzanine that is missing that value.

| Value | Typical values offered |
|---|---|
| (B) min. clearance under joist | 9'-0" (conservative headroom) |
| (C) min. clearance under support beams | same as B, or **No requirement** (entered, never assumed). It leaves (A − C)·12 − slab − seat for the beam and its total-load sag (depth + the MB sheet's TOTAL LOAD max deflection), so it shapes all three options |
| Joist spacing (= beam unbraced length) | 4'-0", 5'-0" (NBG max) |
| Joist seat depth | 2 1/2" (K-series), 5" (LH-series) |
| (A) top of mezzanine, slab, loads, footprint | — (type them) |

The dead load is the one value the tool fills itself when Box 22 says *Per Seller*: it is worked out from the slab, deck and concrete (below) and flagged when it is an estimate.

With several mezzanines, a card per mezzanine sits at the top of every page (size, sections, status) — click one to switch. Edits on the Inputs page go to **every mezzanine** by default (loads, elevations, clearances, joists; the footprint is always per mezzanine), or only the one on screen.

Notes on the Design page are grouped: **Check before quoting** (flags), **Confirmed against the PCS** (e.g. the floor plan matched, joist arrows read), **Design decisions** (shared beams and columns, snapped edges, joist direction), and a collapsed **How it was read** list.

Total joist depth is **A − B − slab − seat**. It feeds the INPUT-sheet clearance check (B provided). A joist span over 24 × that depth (the SJI K-series limit) is flagged — e.g. after a beam line is removed on the Plan page.

**Box 2 length vs the bays.** When the bays add up to within 2'-0" of the Box 2 length (the Lean To on W1G-26097: 159'-11 1/2" against 158'-7 1/2"), the frames stay on the bay lines — no extra frame line is made up — the mezzanine edge is framed on the end line with the slab overhang on the edge beam, and the mismatch is flagged to confirm.

**Columns quoted as BU.** When none of the common columns passes, the next W is quoted as BU (Mezzanine Training Guide). Only Ws with at least an 8" × 1/4" flange are taken for that (DM 15.1.1.4.2 (2A), beams on the column flange), and nothing lighter than the common sizes is tried. A W on the quote that is not stocked at the division is flagged under *Check before quoting*.

**A lighter built-up column, offered.** When the column is quoted as BU anyway, the tool also runs the Column sheet's own *Built-Up* input (C16 "Built-Up", C17 d, C18 bf, C19 tf, C20 tw, Fy 55) over stocked plates for the division, inside the production limits, flanges at least 8" × 1/4", CSR ≤ the stress-ratio limit (0.99 — stricter than the sheet's OK, < 1.00, that the guide's W column goes by, so nothing is offered at 0.999), and offers the lightest one that passes every column case at the top of the Column calc page — on W1G-26097, BU9x22 (9" deep, 8" × 5/16" flanges, 0.1644" web, CSR 0.844) against BU8x31, about 4,170 lb less. It is not put on the quote by itself (that would go beyond the guide's method): *Use* puts it on, and then the Column workbook download types the Built-Up cells. A column picked by hand (this offer, Design your own or the W list) shows at the top of Column calc as *Picked by hand · in the quote*, with the guide's answer beside it and *Back to the guide's column*; the explanation and the calc package (Summary "Chosen as", the Columns sheet) say so too. The filled workbooks for that case recalculate to the tool's numbers (fill oracle, 0 differ).

**Print calc summary** prints the Design, Beam calc and Column calc pages on white paper, in dark ink, without the controls or the 3D model. The framing plan and the loads to the frame (by frame line) print after the Design page. A header gives the job, building code → specification → sheets, the division, the date and the tool build; headings stay with what follows them; folded sections are left out (the calc package carries them); the drawings print with white label boxes.

**One Column-sheet case for columns within 0.01 k.** Columns whose four reactions agree within 0.01 k are one case, typed with the largest of each (W1G-26097: 4 column workbooks, not 6); each column is also checked on its own reactions and the page gives both CSRs (C1 · 2/C … C27: 0.588 each way). The Column page lists them in C order, says the case takes the largest of each, and draws the column that carries the most; a column's hover card shows its own reactions and, beside them, the case's; the calc package notes it under the case.

**Design your own column, checked on the whole job.** The flange tile follows DM 15.1.1.4.2 the way the Design page checklist does: a built-up column, or a W quoted as BU, needs an 8" × 1/4" flange (2A); a W quoted as itself is hot-rolled, 7" (2B), and under 7" is noted as acceptable with the standard 4" bolt gage. *Use* puts the column on every mezzanine column (or, with Settings → Column section *Per mezzanine*, on the mezzanine on screen only), so the designer checks it on every case it would go to (each at its own length) and says their max CSR, naming any case that fails in C order; the built-up search looks for plates that pass every case; it opens on the governing case.

**Columns sized where the loads are known.** When a beam mark has no section yet, only the columns under it wait: the rest are sized, the job-wide column is the one that passes the sized cases (and the note says it may change), and the quote carries those columns as *NOT SIZED* rows beside the sized ones (W1G-26097, marks split by trib with 4/F taken out: *NOT SIZED ×2* for 2/F, 4/F and *BU8x31 ×25*). The built-up offer says it covers the sized cases only. When the longest beam of a mark fails and the others are shorter — and would pass on their own (the tool designs them to check) — the Beam calc page offers *Give the 39'-0" beam its own mark*: only those beams leave the mark, every other mark stays as it was (W1G-26097 with 4/F out: MB1 interior BU19x46 ×38, MB2 exterior BU19x29 ×16, MB3 interior 39'-0" NO SECTION ×1). The other marks keep their names (the long beam's mark takes the next number), so a section picked by hand on a mark stays on it; the choice belongs to the layout, so layout Undo and Reset take it back too. *Back into one mark* undoes it. While any mark has no section, the Seismic calc waits: the framing weight and each frame column's share of the EQ load come from the sized members. No-section beams are red everywhere (plan, run labels, keys, hover) and drawn see-through at a nominal depth in 3D; columns under them read *NOT SIZED* on the tabs, the 3D key and cards, the hover cards and the calc package's Columns sheet.

**Split by trib / span keeps four marks.** *Settings → Beam marks → Split by trib / span* groups by trib and span (spans within 5' share a mark, tribs within 6" too — designed at the larger) and keeps at most four marks, MB1–MB4 of one MB workbook: a lighter group — and each group it already carried, placed separately — rides on the covering mark with the smallest design point, span × trib (its design point unchanged — W0S-26160 MB4 stays BU26x36 at 28'-0" × 12'-4"), and only when none does is the next heavier mark raised to cover it. Each carried group is said once, at its own beams' longest span. That is said under *Design decisions* with what it costs (W1G-26097: MB4 also carries 8 beams of 20'-9 3/4" × 10'-7 1/8" trib — on their own BU19x23, about 723 lb lighter).

**Plates on the quote.** A BU name (depth x weight) can fit more than one plate set, so every beam row's notes start with its plates, in one notation used everywhere (quote, calc package, notes, Design page): the NBG names with the sizes a detailer reads and the grade — "plates: flanges F8.50 (8\" × 1/2\"), web W250 (1/4\"), Fy 55". A built-up column row says the same; a W quoted as BU gives the W's dimensions with its "run as" note. A failing column row says it once, first, to 3 decimals, with each mezzanine's CSR when they differ.

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

### A real job, against the engineer's own files

`test/realjob.test.js` runs a real building-only job (no mezzanine; a main building, an extension in line with it, a lean-to shop against the extension's endwall and, in the reviewed version, a separate scale house) against the engineer's NBG files — private, gitignored, skipped when absent:

- **PCS:** every building read, the second and third on Box 2's continued page, Box 4 continued the same way, Box 12 bracing per wall, a building name that is the start of another ("Main" / "Main Extension") kept apart, and a PDF holding two versions of the quote (the second from its own "Page 1 of N") read as the first only.
- **Snow:** the step drift equals NBG Design Calcs to the last digit (hd, w; pd, hb, hc to 1e-7 — Design Calcs keeps γ in single precision) with the fetch through the roofs in line; sliding snow 45.92 psf over 15 ft as Design Calcs works it; the frames take the larger of the two.
- **Seismic with no mezzanine:** every lateral and longitudinal result of every building to 1e-9.
- **Frame files:** the lean-to's 24 reaction rows exactly as the engineer typed them; the Snow Drift rows in the engineer's format, and cleared back to the original byte for byte.
- **Bracing files:** each sidewall told by its eave strut; the rods on the walls PCS Box 12 names.

### Reading speed

The floor-plan reader looks at each stroke's neighbours through a spatial index rather than the whole sheet, and a quote with no mezzanine skips the search. Same output on all 18 drawing pages of the sample PDFs, byte for byte; 105 s → 3.7 s for the reader. From drop to the Building page: the four-building real job 1.3 s (was 12.4 s), a two-mezzanine, two-building job 2.5 s (12.2 s), a 43-page contract with four full-size drawings 7.8 s (26.9 s) — what is left is pdf.js parsing those drawings.

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
npm install            # pdfjs-dist 3.11.174, tesseract.js 5.1.1 + its English model (all inlined into the build)
npm run build          # -> index.html; PDFJS_DIST / OCR_DIST point at other installs. Without tesseract.js the
                       #    build warns and leaves the OCR reader out (a PCS with no text layer is then not read)
OCR_TOOLS=node_modules npm test   # also read the S1B contract by OCR in Node (needs @napi-rs/canvas too)
npm test               # guide examples, layout cases (layout edits, drawn overhangs too), parser (wrapped building
                       # names, boxes over a page break), plan symbols (⊗ ⊘ ✱ I, a rotated sheet, the plan page
                       # picked by registration), the reading checks fed deliberate misreads, frame-file writer,
                       # beam options, the workbook writer, the .xlsx writer and calc package; the example jobs,
                       # variant loop, real frame files and workbooks when private/pcs/, private/frame/ and
                       # private/workbooks/ have them
npm run e2e            # drive index.html in Chromium for every PDF in private/pcs/: load, every control, 3D pick,
                       # copy, manual entry, NBG Frame files, seismic edits, filled-workbook downloads, the calc
                       # package, Design your own, layout edits (pointer readout, a dragged column, a typed move)
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

The seismic engine against NBG Design Calcs (PyMuPDF; NBG's validation prints and `.nbgcalcs` files in `private/nbg-calcs/`):

```bash
for f in private/nbg-calcs/validation/*.pdf; do python3 -I oracle/nbg_parse.py "$f" "private/nbg-calcs/validation/fixtures/$(basename "$f" .pdf).json"; done
node oracle/nbg_seismic.js [--verbose]   # every printed value of every example, and each .nbgcalcs to 1e-9 (npm test runs it too)
```

`private/` is gitignored. The NBG workbooks, design manuals, customer PCS files, NBG Frame files (`private/frame/`) and NBG Design Calcs / eScope / bracing files and validation prints (`private/nbg-calcs/`) never go in this public repo. `MZ_FRAME_OUT=dir node test/framefile.test.js` also writes the finished frame files, to check them in NBG Frame or with any zip / XML tool.

## Notes and limits

- **Editions (IBC chapter 35):** IBC 2024 → AISC 360-22 (16th sheets); IBC 2018 / 2021 → AISC 360-16 (15th); IBC 2012 / 2015 → AISC 360-10, run on the 13th sheet since no 14th exists (flagged); IBC 2006 / 2009 → AISC 360-05 (13th). A state code with no IBC year maps through its IBC base (Massachusetts 9th / 10th Ed. → IBC 2015 / 2021, Florida 7th / 8th → IBC 2018 / 2021, California 2019 / 2022 / 2025 → IBC 2018 / 2021 / 2024). If the state code isn't in that table, its ASCE 7 year is used: 7-22 → IBC 2024, 7-16 → IBC 2018 / 2021, 7-10 → IBC 2012 / 2015.
- **Editions, short form:** IBC 2018/2021 → 15th and IBC 2024 → 16th. IBC ≤ 2015 → 13th beam sheet (Q-factor compression, kv = 5, 360-05 shear and rt, no joist-bearing check), with the 15th column sheet since there is no 13th column sheet. All three are verified. NBCC (CSA S16) jobs are flagged to run in the S16 workbooks.
- **16th-edition column sheet:** Lby (C10) is hard-coded to 120 in., and Fy (Miscellaneous!K8, the drop-down beside the section) opens at 55 ksi. The tool uses L × 12 and Fy 50 for a W column, and its Excel steps set both.
- **Materials other than deck + concrete**, and the "Designed For Load Provisions Only" box, are flagged. The quote engineer runs those by hand.
- **Dead load when the PCS says "Per Seller":** see the table above. Only 4" and 3½" NW on 1.0C are exact deck-guide values; everything else is flagged as an estimate.
- **Beam lines under 12' apart** (an interior frame column line between endwall lines, or a mezzanine edge just off a grid line) are kept, because they are real supports, but noted — drop a line on the Plan page if the joists should span past it.
