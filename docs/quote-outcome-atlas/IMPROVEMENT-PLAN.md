# Improvement plan — live

This file is the working memory for a continuous improvement run on the Quote
Outcome Atlas. A session that wakes into this repository should read this file
first, pick the highest item that is still open, do it properly, tick it, and
commit. Every session ends with this file honest about what is done and what is
not.

## What the product owner has actually asked for

Collected from every round of feedback, most recent last. These are the
standing sentiments, not a task list — the task list is below.

1. **No technical mistakes.** A figure that contradicts another figure on the
   same surface destroys trust in all of them. Every rule that has been broken
   once gets an assertion so it cannot break again silently.
2. **Say the finding, do not make the reader derive it.** Every view opens with
   one generated sentence naming the largest mover and its size.
3. **Nothing blocky, nothing mundane, nothing that looks like 2015.** The brief
   is explicitly "2026 AI era" — depth, vibrancy, motion, real labelling, a
   considered cursor, futuristic without being noisy.
4. **Simple beats clever.** "The money came from a different place" was named
   as the best slide in the deck: one idea, one picture, plain words. Week-by-
   week side-by-sides were named as jumble. Prefer the former shape.
5. **Fill the data in.** Where the main Customers screen shows a detail, the
   year-over-year customer view should show it too. Missing panels read as
   unfinished, not as restraint.
6. **The deck ends, it does not conclude.** The last slide is a Nucor outro —
   a closing mark, not a list of actions. The deck displays information.
7. **Every part gets reviewed, repeatedly.** Text too small, a label unbolded,
   a graph that could be better — all of it counts.

## The loop

An hourly Routine (`trig_017GXmQZZNrGNFxAAfDyGcq9`, "Quote Outcome Atlas —
continuous improvement") fires back into the originating session at :47 past
each hour and runs the protocol at the top of this file. It stops at
**2026-08-24 13:00 UTC — Monday 9am Eastern**. A session waking after that time
does no further work: it deletes the Routine and posts a summary of the run. If
the Routine cannot be deleted from the fired session, say so plainly and ask the
product owner to disable it from the Routines list rather than leaving it firing.

## Open

- [ ] **Review pass 5** — keep walking the surfaces. The recurring failure is
      a shape that carries a real finding and never names it; the second is a
      figure that disagrees with another figure elsewhere in the product.

## Done

- [x] **The dashboard prints too** (2026-08-24). It had one print rule, hiding
      the glossary. Ctrl-P gave four pages with a black rail down the side of
      every one, the dark hero as a slab, the dial as a filled black disc, KPI
      text clipped, and the export button and theme toggle on the paper — and
      with backgrounds off, which is most print dialogs' default, the light-on-
      dark panels printed white on white and vanished.


- [x] **The deck prints** (2026-08-23). It advertises "P to print / save PDF" in
      its own footer, and printing it produced a mess on every page: display:flex
      forced on each slide with no direction, so the header, content and footer
      laid out as three columns side by side and the slide was squeezed into a
      third of the sheet with four-pixel names. The old check only counted
      displayed slides and PDF bytes, which is why nobody knew.


- [x] **The same rule, on every screen that needs it** (2026-08-23). Three
      rounds of the highest-value finds came from asking "which screen did this
      fix never reach?" rather than from looking at a new screen. The Outcome
      dashboard's comparison panel was still reporting rates as percentages of
      percentages (−7.2% where the ledger said −1.9 points). Team performance
      still ranked a one-quote book at 100% above a twenty-six-quote book, still
      reported 0.0% and 0.0h for people with no quotes, and still listed NPM,
      JMR and DNQ as if they were names — under a sentence claiming three codes
      were "visibly flagged". All fixed and asserted.

- [x] **One measure per row in both analysis panels** (2026-08-23). District mix
      drew a bar on value beside a conversion figure; the value bands drew a bar
      on quote counts beside a conversion figure and captioned it as money.
      Each panel's bar now carries the measure its own figure is in.

- [x] **A square you can count** (2026-08-23). The record field's caption said
      "each small square is one real quote opportunity" over twelve stretched
      columns seven pixels tall — stripes nobody can count. Square cells on a
      fixed pitch, so the caption is true and seventeen wins out of sixty-nine
      can be read off the screen.

- [x] **The comparison brief answers the same follow-up** (2026-08-23). It
      listed each quote's date, project and value but not who priced it or
      whether it met the promised date — both of which the main Customers
      profile carries for the same quote.


- [x] **The whole clock stopped disagreeing with its own parts** (2026-08-23).
      The customer's segment was drawn as whatever was left of the 43-day
      whole-clock median and labelled 35 — its own median on a different set of
      quotes. Medians on different denominators do not add; the bar is scaled on
      the two parts, the whole is stated above them, and the slide says so.

- [x] **Every bar carries the measure its own figures are in** (2026-08-23).
      The Customers account bar was drawn on quote counts beside money figures;
      two value bars were floored at 5% and 12%. Both fixed and asserted.

- [x] **A bucket stopped winning a ranking of people** (2026-08-23). Seventeen
      of sixty-nine quotes have no engineer code and were ranked first. They sit
      at the end of every ordering now, marked, still counted. The same screen's
      list, chart and sheet were in three different orders; one ordering
      function serves them, and the two that are deliberately different say so.

- [x] **One prior-period hue and one minus across both surfaces** (2026-08-23).
      The deck drew last period in the neutral grey-blue that means "no change";
      two legends were drawn in colours their charts do not contain; signed
      percentages used a hyphen while everything else used a true minus.


- [x] **The export reaches a real save surface** (2026-08-23). The deck button
      built a blob and clicked an anchor. A browser opening the file from disk
      honours that, which is the delivery path, so it always looked fine; a
      viewer that mediates saves ignores it, so the primary export did nothing
      and then said "Report deck downloaded". It now asks the host when there
      is one, uses the anchor when there is not, and says which answered.
      `test/export-surface.mjs` walks all five outcomes.

- [x] **One prior-period hue across both surfaces** (2026-08-23). The deck had
      none of its own and borrowed the neutral grey-blue that everywhere else
      means "no change", while the dashboard had already moved to a real teal.
      Two legends were also drawn in colours their charts do not contain, and
      signed percentages used a hyphen while every other signed figure used a
      true minus. Locked by assertions on the screen and on the exported deck.

- [x] **Shapes that carried a finding and did not state it** (2026-08-23). One
      week loaded reported itself as its own peak, its own latest and zero
      points from its own average; a column of five dashes meant none of the
      new accounts has booked; the attribution cards and the ribbon under them
      were in two different orders with nothing said about it.


- [x] **Districts and value bands name their finding too** (2026-08-23). Twelve
      districts and four bands drawn side by side with nothing said about any of
      them. Two things had to be right to say it honestly: the share is computed
      across every district, not the twelve drawn, or "the whole fall" is a
      share of a subset presented as a share of everything; and a share past a
      hundred per cent takes the wording that explains why rather than printing
      "100.5%". The helper also lost its seven positional arguments — each
      caller now names the unit it is drawing, so a district chart no longer
      says "the other weeks went the other way".

- [x] **The momentum charts name the row that mattered** (2026-08-23). Both drew
      the shape and left the reader to find it. On the real books one Friday
      quoted $8.1M against $38.3M, and nothing said so. Each chart now names the
      single unit that moved furthest — and distinguishes three cases honestly:
      a share of the whole move, a move *larger* than the whole because the rest
      went the other way, and a mover that went against the period entirely. The
      first attempt clamped the share to 100% and so reported "100.0% of the
      whole fall" for a day that fell further than the period did.

- [x] **The roster reads in one order** (2026-08-23). The list re-ranked on
      every measure change while the chart and the reference sheet beneath it
      kept a fixed order, so the same twelve people appeared in three different
      sequences on one screen. One ordering function now serves all three, and
      all three redraw together. Each caption states the order it is in.

- [x] **The source cohort card carries its own facts** (2026-08-22). The first
      panel of the outcome atlas was stretched to the height of the two beside
      it, leaving a quarter of it empty under the headline number. It now
      carries the two input-side measures a reader cannot get at a glance
      anywhere else: what a typical quote is worth, and how much priced work is
      riding inside quotes as alternates.

- [x] **A bar and its own figure now answer the same question** (2026-08-22).
      The ranked-measure lists mixed money, counts and rates on one scale: the
      bar was drawn on the relative move while the figure beside it was stated
      in points, so value capture drew a longer bar than quoted value while
      reporting a smaller number. Documenting that in the caption was not a fix.
      Each list is now two blocks — counts and money ranked and scaled in
      percent, rates ranked and scaled in points — each internally consistent,
      each under its own heading. `test/year-screen.mjs` asserts that within
      each unit a bigger stated figure draws a longer bar.

- [x] **The two surfaces share one type scale** (2026-08-22). The deck's
      headings were set heavier and tighter than the dashboard's, which was the
      last place the surfaces visibly diverged. Panel headings move to the
      deck's weight, size and negative tracking, and each eyebrow now carries a
      short green rule beside it so a panel head reads as a titled section
      rather than three stacked lines. Clean at all five widths in both themes.

- [x] **Review pass 3 — the deck still gave orders** (2026-08-22). Renaming the
      class was not the fix. Both closing slides carried imperative headings
      ("Qualify the repeat askers", "Ring the ones who used to pay") and bodies
      that ended in instructions. Same figures, restated as findings: "7
      accounts asked twice and booked nothing", "13 accounts that paid us last
      period did not quote in these weeks". Also caught by looking: a company
      name ending in a full stop collected a second one at the end of a
      generated sentence, a slide titled "the year in four numbers" showed
      three, and a one-line heading beside a two-line one left the three card
      bodies on three different baselines. `test/regression.mjs` now fails if a
      closing card heading ever starts with an imperative again.

- [x] **Every bar in the product is a lit object** (2026-08-22). The extruded
      columns landed first; horizontal bars were still flat. The account list's
      asked-against-booked track, the who-pays bars and the who-never-books bars
      now carry the same lit face and top highlight the deck's ledger rows do. A
      later flat rule was overriding the lit one on the payer bars — found by
      looking rather than by any assertion.

- [x] **Review pass 2 — Timelines and Data mapping** (2026-08-22). Three things
      the first pass left. The open-book composition strip was an unlabelled
      slab of colour above a table of zeros; it now carries a heading, its total,
      and a label inside any segment wide enough to hold one. The calendar
      chart's legend swatch still said grey while its line had moved to the
      period hue. And the primary Run action was a flat green rectangle
      stretched to the height of the panel beside it — the loudest thing on the
      screen and the least considered. It now sizes to itself and carries the
      product's lit face, elevation and press. An empty duplicate of the console
      container was also rendering a gap above it.

- [x] **The mark is placed, not parked** (2026-08-22). The rail mark sits on a
      lifted plate with a green hairline running out from under it, and lifts
      again on hover because it is the home control. The deck cover's mark gets
      the same rule beneath it, so cover, header and outro are one treatment at
      three sizes.
- [x] **The calendar chart names its own finding** (2026-08-22). The space
      between quotes issued and orders booked *is* the open book, and it was
      drawn as a flat wash of pink that never said so. It now fades downward and
      carries a brace at the last date reading "52 open · no linked order" —
      the chart's whole point, which was the one thing it did not state.

- [x] **Every deck chart that can carry depth now does** (2026-08-22). The
      bridge waterfall and the who-pays / who-returns-least ledger were the two
      flat ones left. The bridge's connectors now run along the top faces so
      they meet the next column where it actually starts once extruded; the
      horizontal ledger bars take their depth on the top edge and the right end,
      which is the same light source read sideways.
- [x] **Deck motion** (2026-08-22). A slide's content rises and fades in with a
      stagger, the header and footer wipe in, and every extruded face grows from
      its own base in reading order. The children of `.deck-fit` are animated
      rather than `.deck-fit` itself, because the fit-to-slide pass owns that
      element's transform and an animation on it would fight the scale — and
      since neither transform nor opacity affects layout, the height the fit
      pass measures is unchanged. All of it collapses under
      `prefers-reduced-motion`.

- [x] **The deck's isometric columns are now the dashboard's** (2026-08-22).
      Every paired-column chart on Year over year and the weekly pulse on the
      Outcome dashboard draw the same three-face extrusion the slides do, on the
      same offset and the same light source, with the top face brighter and the
      turned-away side darker. The two surfaces read as one product rather than
      as a report and the tool that happened to produce it. A tall column's own
      value label used to be clamped inside the bar where dark ink on a dark
      face was unreadable; it now switches to white when it lands inside.

- [x] **Year-over-year customers filled in** (2026-08-22). Three gaps against
      the main Customers screen, all closed. The account list now has six sorts
      — biggest overall, biggest fall, biggest rise, most returned now, booked
      then gone now, asked never booked — so "who fell furthest", the whole
      point of a comparison, can actually be asked. The brief now carries the
      order log's job detail under each won quote (job number, entry date,
      tonnage) and a period footer with booked count, value, tons and hours.
      And a new panel, *Who actually paid us, then and now*: presence and
      payment are different questions and the churn lists only answered the
      first. It is ranked by the larger of the two periods, so Hamstra at
      $4.1M → $0 sits where its money says rather than at the bottom.

- [x] **Colour vibrancy and a second real hue** (2026-08-22). The prior period
      was flat grey, so every comparison read as "colour versus absence of
      colour". It is now a cool teal against the green: the two periods separate
      at a glance and neither looks like the failure state. Columns carry lit
      gradient faces from one document-wide gradient pair rather than flat fills,
      and a three-step elevation scale (`--lift-1/2/3` plus a lit top edge) gives
      every panel real depth from one light source.
- [x] **Custom pointer** (2026-08-22). A ring that eases toward the cursor and
      opens over anything actionable, with a press state. Purely additive — the
      system cursor is never hidden — and withdrawn entirely for coarse pointers
      and for `prefers-reduced-motion`.
- [x] **Deck: the week-against-week slide is gone** (2026-08-22). A row of
      paired columns, one pair a week, is a table drawn as a chart. The race
      carries the same weeks as one shape and the decomposition says why it
      moved; both of those a room can read.

- [x] **The deck ends on a Nucor outro** (2026-08-22). The last slide is now a
      dark closing mark: the logo on its white plate, the unit and the plant,
      four figures, and the provenance line. No instructions, no conclusion. The
      year chapter no longer closes on a list of orders either.

- [x] **Pays / costs contradiction** (2026-08-21). An account appeared as both a
      best payer and a top cost, because the cost side ranked on unreturned
      value and the best payers ask for the most. The cost side is now the
      accounts that asked repeatedly and got under a fifth of it back, with
      payers excluded outright. Asserted in `test/regression.mjs`.

## How to verify anything before committing

```
node test/regression.mjs        # 62 assertions on the live figures and deck
node test/export-surface.mjs    # the deck export on every save surface
node test/team-screen.mjs       # the roster, its chart and its sheet in one order
node test/year-screen.mjs       # the year-over-year screen, view by view
node test/deck-year.mjs         # the chapter builds and closes
node test/deck-stress.mjs       # every number inflated, three viewport widths
node test/visual-audit.mjs      # every screen, five widths, both themes
node test/deck-audit.mjs        # every slide, three projector widths
python3 test/audit.py           # independent openpyxl recomputation
```

`visual-audit`, `deck-audit` and `yoy-real` need the real books in
`fixtures/yoy/`; they skip cleanly without them.
