# Quote Outcome Atlas

Offline, single-file management dashboard that turns Nucor Building Systems weekly
quote books and order-log exports into a quote-to-order outcome view.

Five screens, all reading one record set, plus a sixth that appears only when a
prior period has been loaded:

| # | Screen | The question it answers |
| --- | --- | --- |
| 01 | Outcome dashboard | Did the quoted work come back? |
| 02 | Team performance | Who owned it, how did their book behave, and what did it cost to produce? |
| 03 | Customers | Who asks, who actually books, and what did each account book? |
| 04 | Timelines | How long does it take to come back? |
| 05 | Year over year | Is this better or worse than the same weeks a year ago? *(only with a prior period loaded)* |
| 06 | Data mapping | Where did every number come from, and what did the source get wrong? |

A **What the numbers mean** drawer opens from any screen with the definition,
source column and live value of every term.

| Path | What it is |
| --- | --- |
| `app/quote-conversion-atlas-shareable.html` | The deliverable. One self-contained file — open by double-click, no server, no network. |
| `QUOTE_OUTCOME_ATLAS_HANDOFF_SPEC.md` | Product and engineering contract (v2.8). |
| `handoff-spec.html` | Designed reading version of the same spec. |
| `fixtures/` | Real Week 1–3 2026 quote books and `OrderLog_1-10.xlsx`, used by the tests. `fixtures/yoy/` additionally holds the matched Week 2 pair for 2025 and 2026 with an order log each, used by the year-over-year audits. Never committed — this repository is public. |
| `test/regression.mjs` | Drives the real dashboard in Chromium against the fixtures and asserts the baseline. |
| `test/edge-cases.mjs` | Runs seven awkward source combinations (single week, gaps, duplicates, out-of-order, 20 weeks). |
| `test/scale-check.mjs` | Renders the weekly chart at 1, 4, 12, 26 and 52 weeks and checks no axis labels collide. |
| `test/deck-shots.mjs` | Regenerates the deck, screenshots every slide, audits for overflow and text under the nav. |
| `test/print-check.mjs` | Confirms every slide prints and produces a PDF. |
| `test/error-paths.mjs` | Five ways to pick the wrong file; each must stop with a specific message. |
| `test/boss-scenario.mjs` | Copy to another folder, clean profile, offline, four consecutive runs. |
| `test/audit.py` | Recomputes every figure from the workbooks with openpyxl and compares. |
| `test/a11y.mjs` | Accessible names, keyboard reach, focus rings, reduced motion. |
| `test/filters.mjs` | Segmentation: filters narrow every view consistently and clear exactly. |
| `test/compare.mjs` | Period comparison picks year, month or week granularity correctly. |
| `test/baseline.mjs` | A loaded prior period compares without moving a single live figure. |
| `test/review.mjs` | The customer and timeline screens filter, theme, and fit a 1366px laptop. |
| `test/rail.mjs` | Every navigation item is reachable at five viewport sizes. |
| `test/sorts.mjs` | Each customer sort changes the question; a filtered deck stays coherent. |
| `test/glossary.mjs` | The definitions drawer opens before and after a run. |
| `test/spec-check.mjs` | The markdown and designed spec agree on every requirement ID and version. |
| `test/deck-stress.mjs` | Inflates every number in the deck and checks nothing collides at three viewport sizes. |
| `test/year-screen.mjs` | All seven Year over year views draw real marks, no chart label collides, and the screen survives the dark theme. |
| `test/deck-year.mjs` | The deck grows a year-over-year chapter when a prior period is loaded, closes on its own slide, and stays nine slides when there is no prior period. |
| `test/visual-audit.mjs` | Every screen and every Year over year view at five widths and both themes: figures that formatted to nothing, panels that drew nothing, anything painted outside its screen, and any two pieces of text whose ink lands on the same pixels. Needs the real books in `fixtures/yoy/`; skips without them. |
| `test/deck-audit.mjs` | Every slide of the real-data deck at three projector widths — the same formatting classes, plus empty bodies and any slide the fit had to shrink below 0.72. Skips without `fixtures/yoy/`. |
| `test/yoy-real.mjs` | Opens the real 2025/2026 pair and screenshots all seven Year over year views. Skips without `fixtures/yoy/`. |

## Running the regression suite

```bash
npm install
node test/regression.mjs
```

55 assertions cover the core outcome figures, the data-quality exceptions, coverage
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
node test/filters.mjs       # segmentation across every view
node test/compare.mjs       # period comparison at each granularity
node test/baseline.mjs      # a prior period compares without entering the live book
node test/review.mjs        # the new screens filter, theme and fit a laptop
node test/rail.mjs          # navigation reachable at five viewport sizes
node test/sorts.mjs         # customer sorts, and a deck exported while filtered
node test/glossary.mjs      # the definitions drawer
node test/spec-check.mjs    # the two spec documents agree
node test/deck-stress.mjs   # the deck holds its layout when the numbers get bigger
node test/year-screen.mjs   # the Year over year screen, in both themes
node test/deck-year.mjs     # the deck chapter appears with a prior period and not without
```

Every one of these writes into `test/` — screenshots, exported decks, a PDF, and
`figures.json`. Those outputs are rendered from the real fixtures and therefore carry
customer names, prices and staff names, so they are gitignored rather than committed.
Regenerate them locally; do not add them to the repository.

`audit.py` reads the workbooks with openpyxl and recomputes every headline figure
from scratch, sharing no code with the dashboard, then compares against what the
dashboard actually displayed. 28/28 agree across all three exposure lenses.

## The exported deck

Nine slides, generated from the active exposure cohort and the active filters:

1. Executive outcome — conversion, quoted value, confirmed value, Wilson interval
2. Quote outcome — confirmed vs unconverted, proportional split
3. Weekly pulse — volume columns above, conversion line below, scales to any span
4. Value band analysis — conversion by quoted value band
5. Release timing — on-time rate with its scored denominator
6. **Customer demand** — asked against booked per account, the accounts that asked
   twice or more and booked nothing, and where the booked work actually came from
7. **Lifecycle and decision window** — three measured stages, the decision curve,
   and the ageing of the open book
8. Estimating capacity — scheduled vs actual engineering hours by engineer, with turnaround
9. Review agenda — highest-value work with no linked order, by quote, owner and value

Every slide carries the Nucor mark, and every slide is **fitted to its own box**: the
content block is measured against the height it actually has and scaled to fit, so a
larger figure changes the size of the type rather than pushing text under the
navigation. `test/deck-stress.mjs` multiplies every number in the deck by roughly a
thousand, re-fits, and measures at three viewport sizes for content leaving the slide,
chart labels sitting on each other, and text under the nav.

The weekly volume lane is drawn as extruded columns with a lit top face and a shadowed
right face — the top face is what makes a short column readable beside a tall one.
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

## Customer identity

The same company is typed differently from one week to the next — *GREYSTONE*,
*GREYSTONE CONSTRUCTION*, *Greystone Constr. Inc.* Left alone that is three
accounts, and a customer who booked with us reads as one who never has. Every
name is resolved to one account **before any figure is calculated**, across the
live period and any prior period together.

Two passes, both conservative:

1. Strip punctuation and trailing legal forms — *Carl A. Nelson Co.* and *CARL A
   NELSON* are the same company by any reading — and merge names that are the
   same letters spaced differently, so *STEEL TECH* joins *STEELTECH*.
2. Fold a longer name onto a shorter one **only** when the shorter name appears
   in the data in its own right and every extra word is a generic trade word.
   *Greystone Construction* joins *Greystone*; *Smith Builders* and *Smith
   Construction* both stay put, because no bare *Smith* exists to fold them into.

What it will not do is guess. Names that look like one company and were left as
two — *RAECCO BUILDERS* against *RAECO BUILDERS*, *WEAVER COMMERCIAL
CONSTRUCTION* against *WEAVER COMMERCIAL CONTRUCTION* — are listed on **Data
mapping** with their quote counts, beside every merge that was made and its
reason. The fix for a typo belongs in the source workbook.

## Segmentation

Every view derives from `currentScope().records`, so filtering there narrows the
sidebar, outcome field, weekly pulse, all eight analysis lenses, the roster, the quote
records and the operations screen at once — no view can disagree with another.

Filters are set by clicking the thing you want to look at: a value band, a district, a
quoted week, an estimator row, an engineer on the capacity chart, or either outcome
card. They compose, they toggle off, and a sticky bar names each one, reports how much
of the book is left, and clears them.

## Period comparison

The **Period compare** lens reads the latest period against the one before it, at
whatever granularity the loaded set supports:

| Loaded span | Compares |
| --- | --- |
| More than one year | Latest year vs previous year |
| One year, several months | Latest month vs previous month |
| One month | Latest week vs previous week |

Direction is judged rather than signed: more quotes, value and conversion read as
improvement; longer turnaround and more engineering hours per quote read the other way.

> Weekly sources are keyed by **year and week**. Keying on week number alone made week 1
> of one year collide with week 1 of another, so loading two years to compare them
> silently dropped one and reported it as a repeated reporting week.

## Customers

Account demand, and the account record. The list on the left ranks every account —
most quotes, most quoted value, most booked, largest unreturned, most engineering
time — and the panel on the right opens that account in full:

- what it asked for against what came back, its engineering hours and average turnaround
- **every job it booked**, with the order-entry date, tonnage, and the quote value it came from
- **every quote it ever sent**, with the quote engineer, the release result, and whether
  the quote is booked or still open and for how long

The search reaches quote numbers and job numbers, so a job number written on a paper
copy finds the account that owns it. Selecting an account narrows the whole dashboard.

Below it sits the diagnostic the estimating group cannot get out of its own reporting
— accounts that asked at least twice and booked nothing, ordered by the quoted value
that returned as nothing, with the engineering hours those requests consumed.

## Timelines

The book read along a calendar rather than a list, from dates the workbooks already
carry:

- **Three lifecycle stages** — Date In → Done (producing the quote), Done → order
  entry (the customer answering), and Date In → booked work. Each is scored on the
  quotes that carry both of its own dates and states that denominator, and the
  panel says plainly that the three do not add up.
- **The decision curve** — of everything that eventually booked, the share that had
  booked by day 7, 14, 21, 30, 45, 60 and 90. Where it flattens is where waiting
  stops paying.
- **The open book, aged** — quotes with no linked order, banded by exposure, with
  quoted value beside the count. The exposure lens itself empties the young bands,
  and the panel says so rather than letting it read as "no fresh work".
- **A calendar** — cumulative quotes issued against cumulative orders booked on one
  axis, so the space between the lines is the open book itself.
- **Arrivals and production speed** — how much came in per period, and the Date In →
  Done distribution, which is the one measure here that does not care whether the
  quote converted.
- **Cohort maturity** — of the work quoted in each week, the share that had booked by
  day 7, 14, 30, 45 and 60. A week that has not lived long enough to answer a column
  shows a dot rather than a zero, so a recent week and an old one are only ever
  compared at the same age.
- **Week by week** — volume, turnaround mix, release timing and engineering load, one
  row per week.

> The answer stage is scored on quote wins alone, because a quote with no order has
> no answer to time. That makes it the time taken by the customers who said yes — an
> optimistic read by construction, stated on the panel. The ones with no answer are
> counted in the open book instead, rather than folded in as an open-ended wait.

## Prior period and year over year

A compact intake bar under the run console takes an earlier set of quote weeks and,
optionally, that period's own order log. They run through the same parser and stay
in their own model: they never enter the live scopes, so loading a baseline cannot
move a headline figure.

Where a prior order log is supplied, the prior quotes are joined to it. Where it is
not, they are joined to this period's order log, which will find almost nothing — the
banner says which of the two happened, because the difference is the difference
between a real conversion and a missing file.

Everything downstream reads the weeks the two periods **share**. Ten prior weeks
against three live ones would report a collapse in demand that is really a difference
in what was uploaded, so both sides are narrowed to the shared week numbers and the
screen states which weeks it matched on. Filters apply to both sides, except a
quoted-week filter, which has no counterpart in another year and narrows the live
side only. The exposure lens is measured inside each period against that period's own
last day, so both sides answer the same question about their own quotes.

### Two bases, both stated

Volume, value and every rate are compared on the weeks the two periods **share**.
Whether an account has stopped asking is measured on **every loaded week** on both
sides — an account that quoted in a week outside the matched window has not gone
quiet, it simply quoted elsewhere. Each panel names which of the two it is using.

### Screen 05 — Year over year

A dashboard inside the dashboard: seven labelled views, each opening with a **reading
band** that states in one generated sentence what the view is about to show. A figure
beside another figure is a comparison the reader has to construct; the band constructs
it for them.

| View | The question it answers |
| --- | --- |
| 01 Headline | What actually changed the money — the decomposition as three sentences with dollar effects, then every measure ranked by how far it moved. |
| 02 Momentum | Which weeks were up and which were down as one signed bar each, then side by side, plus the cumulative race. |
| 03 Speed | How quickly the work comes back, read at equal age, and the two halves of the clock. |
| 04 The mix | How much of the book rests on how few names, what kind of work came back, and how the shape moved in points of share. |
| 05 Customers | A full account brief — search the roster, select a name, and its whole record opens beside it — then the flow of the account base, who went quiet, who is slipping, and who is new. |
| 06 People | A card per person carrying every measure the team screen carries, for both periods. |
| 07 Ledger | Every measure, grouped by what it is about, across the width of the page. |

Selecting any named account opens that account's record on Customers.

### The three analyses that carry it

**The decomposition.** Returned value is `quotes × average quote × value capture`. A
Shapley split attributes the whole change in returned value to those three factors —
exactly, with no residual and no dependence on the order the factors are taken in. So
the answer is never "we returned more"; it is "we returned $X more, and $Y of it came
from winning a higher share rather than from pricing more work." Drawn as one
continuous ribbon that steps once per factor. Where the level dwarfs the movement the
ribbon zooms its axis and says so, with a break marker.

**Speed at equal age.** At each checkpoint — day 7, 14, 21, 30, 45, 60, 90 — only the
quotes that have been open at least that long are asked whether they booked, on both
sides. A book quoted three weeks ago is never scored as though it had a year to
answer, which makes a young period comparable to a finished one.

**Concentration.** Accounts sorted largest first and accumulated. The further the
curve bows above the even-split diagonal, the more of the quoted book rests on a
handful of names — a risk that a total will never show. Reported as the share held by
the top five and top ten, this period against last.

### The account brief

Selecting any named account — in the churn list, the slipping list, the new-name
list — opens its brief in place rather than throwing the reader onto another
screen. The brief carries eleven paired measures (quotes, quoted value, average
quote, quotes booked, booked value, conversion, value capture, booked jobs,
booked tons, weeks appeared in, engineering hours) and then every quote that
account sent in each period, largest first, with whether an order came back
against it.

### A thin span is not churn

With one or two weeks loaded on each side, whether an account appears is mostly
about which week it happened to quote in. Under four weeks a side the whole
customer view reframes itself — *quoted in both* / *only last period* / *only
this period* rather than kept and lost — and the headline drops the retention
figure for one that holds at any span.

### The deck

Nine slides, in the order the questions get asked: the outcome, the two visible
outcomes, the weekly pulse, the value bands, our half of the clock, the whole
clock, who pays us against who costs us to serve, the best booked work, and a
closing slide naming what to do next.

Ten more are appended behind a chapter divider when a prior period is loaded: the
headline, week against week, the race, where the mix moved, the decomposition,
speed at equal age, the value bridge, and the account story across two slides —
who came back and who to ring, then who is new and who is quietly going. With no
prior period the deck is the nine slides it has always been.

## Definitions

A drawer, reachable from every screen, naming each term, the column or file it is
measured from, and the live figure it currently holds. A definition that does not
show its own denominator is how a number gets misread.

## Load and capacity

What the estimating group's own reporting tracks, drawn from weekly columns that were
parsed but never shown. It sits on **Team performance**, because it is per-person:
capacity against plan for quote engineers, and the same load table for estimators and
schedulers. The time series it used to sit beside are on Timelines.

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
