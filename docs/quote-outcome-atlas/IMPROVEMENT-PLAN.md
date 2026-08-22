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

- [ ] **Review pass 4** — the deck's display type still runs larger and heavier
      than the dashboard's panel headings. That is the last place the two
      surfaces visibly diverge.

## Done

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
node test/regression.mjs        # 57 assertions on the live figures and deck
node test/year-screen.mjs       # the year-over-year screen, view by view
node test/deck-year.mjs         # the chapter builds and closes
node test/deck-stress.mjs       # every number inflated, three viewport widths
node test/visual-audit.mjs      # every screen, five widths, both themes
node test/deck-audit.mjs        # every slide, three projector widths
python3 test/audit.py           # independent openpyxl recomputation
```

`visual-audit`, `deck-audit` and `yoy-real` need the real books in
`fixtures/yoy/`; they skip cleanly without them.
