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

## Open

- [ ] **3D and depth across the deck** — extruded columns exist on some slides;
      every chart that can carry depth should, consistently lit from one angle.
- [ ] **3D and depth in the dashboard**, matching the deck so the two read as
      one product.
- [ ] **Motion** — considered entrance and transition motion on every surface,
      honouring `prefers-reduced-motion`.
- [ ] **Custom cursor** — a designed pointer that reacts to interactive targets.
- [ ] **Colour vibrancy** — the palette is currently very restrained. Raise it
      without losing the Nucor identity or dark-theme contrast.
- [ ] **Logo placement** — the mark should be placed, not parked.
- [ ] **Year-over-year customers: fill every panel** the main Customers screen
      carries.

## Done

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
