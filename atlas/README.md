# AI Ecosystem Atlas

`AI Ecosystem Atlas.html` is a single-file, self-contained market-research app covering the
AI · Quantum · Robotics ecosystems (plus the Cybersecurity sub-ecosystem): 450 mapped companies,
29 sectors, 41 ETFs, bottleneck pressure models, a research checklist system and live news feeds.

**The master copy lives in Google Drive** so Claude and Codex can work on it back and forth:
https://drive.google.com/file/d/1cOb8nnuif1bsO8Vww0m_XQ3iJNL_HvOK/view

Workflow: whichever assistant produces a new version, replace the Drive file with it
(Drive → right-click the file → *Manage versions* → *Upload new version* keeps the same link).
This repo keeps a versioned history of the same file so every change lands as a reviewable diff.

**The Drive upload is a manual step.** Claude's Drive connector can read the file but cannot
write file contents, so a new version only reaches Drive when someone uploads it. Google Drive
also shows `.html` files as source code rather than running them — download the file and open
it in a browser to use the app.

## Prices refresh automatically

`.github/workflows/atlas-prices.yml` runs `atlas/tools/refresh-prices.mjs` on GitHub's servers.
It reads every listed company and ETF from the app, downloads five years of weekly adjusted
closes ending at the latest close, and writes them into the HTML, so the numbers are current
wherever the file is opened: the downloaded copy, the hosted link, or Drive.

- **When it runs:** weekdays after the US close (once the workflow is on `main`), whenever the
  refresh tooling changes, and on demand — GitHub → **Actions → Refresh Atlas prices → Run workflow**.
- **What it updates:** price history for ~440 symbols, the "prices through" date, and each
  listing's currency. Market cap and P/S then scale with the price since the research snapshot;
  revenue, growth, margins and model scores stay as researched.
- **What it reports:** `atlas/data/price-report.json` lists anything it couldn't refresh. A failed
  lookup keeps the previous series, and the run refuses to write if most lookups fail.
- **Adding companies:** nothing to do — the next run picks them up from the app.

## September 30, 2026 fixes (Claude)

**Layout** — below roughly 1400px wide (a non-maximized laptop window, or a side panel) the map
vanished and the inspector ran off the right edge. Cause: the app grid had one auto-sized column,
so the header could not shrink and forced the whole app wider than the window. Fixed, along with
a specificity bug that stopped the small-screen layout from ever applying and a malformed CSS
rule. Verified at 1440, 1280, 1024, 900 and 620px.

**Live prices** (Research Deck → Data Health → *Live prices*) — paste a free Finnhub or Twelve
Data API key and the Atlas pulls current quotes for your watchlist, value candidates, or the top
25 companies by research priority. A live quote replaces the embedded close on the price tile,
recomputes the 1-year return, and extends the chart to today. The key stays in your browser.
- Free tiers cover **US listings**; many foreign listings come back as "not covered".
- Quotes are cached for 15 minutes; Finnhub allows ~60 requests/min, Twelve Data ~8/min.

**TradingView charts** — the ~280 companies without embedded price history showed a legacy
TradingView iframe that loaded lazily inside a hidden overlay and often never appeared. It now
uses TradingView's official embed script, and if a chart fails to load (offline, blocked, or no
response in 12s) the box turns into direct TradingView links instead of staying blank.
- Some exchanges don't license their data to embedded widgets; TradingView then shows "only
  available on TradingView". Use the *Live TradingView* button for those.

**Where live features work** — live prices and TradingView charts need the **downloaded file**
opened in a browser on your own computer. The hosted claude.ai link blocks outside connections,
so there the TradingView boxes show direct links and live prices report that they're blocked.

## July 17, 2026 upgrade (Claude)

Built on top of the same-day Codex session (Cybersecurity ecosystem, Automation Buyers,
China Robotics, bottleneck reclassification), this pass added:

**New research content**
- **Batteries & Robot Energy branch** — the missing robotics bottleneck. 12 companies across
  cells/packs (Samsung SDI, Panasonic, EVE, CATL, BYD, LGES) and next-gen chemistry
  (QuantumScape, Enovix, Amprius, SES, Solid Power, Sila), a measured Stage-7 BPI
  (duty-cycle/battery pressure), a 7th robotics pipeline stage, graph edges, the LIT ETF,
  and the battery bottleneck row now carrying its measured pressure.
- **Verified events radar** — TSMC marked REPORTED with its record Q2 results; Alphabet (Jul 22),
  Meta (Jul 29), AMD (Aug 4) and NVIDIA (Aug 26) added from issuer-confirmed dates.
- Curated news: TSMC record quarter; robot-battery bottleneck signal.

**Usability**
- **Company Snapshot hero** — opening any stock now leads with a one-screen read: price,
  1-year return, sparkline, market cap, P/S, growth, margin, research priority and quick actions.
  Deep-dive nav reordered (Snapshot → Overview → Analyst View → News → …).
- **Inspector price strip** — the side panel shows last price, 1Y change, a sparkline and
  key-stat chips for every listed company, plus a top-of-panel "open workspace" button.
- **Charts** — gridlines, a "% in this window" annotation, Max range buttons, and end-of-line
  ticker labels on the comparison chart.
- **Search** — the global search now shows a live suggestion dropdown; picking a company opens
  its research workspace directly.
- News cards show relative age (e.g. "3h ago") next to the source.

**Automation & reliability**
- **Data Health board** (Research Deck → Data Health) — tracks the age of every dataset
  (snapshot, price history, stage inputs, events) with FRESH/AGING/STALE badges, and generates
  **one-paste refresh prompts** for Claude/Codex so refreshing the file never needs re-explaining.
- **Live freshness badge** in the top bar (snapshot age · price age), click to manage.
- **D3 is now inlined** — the app is fully offline-capable with no CDN dependency, with a
  friendly error screen as a fallback.
- Fixed a data typo (NKT `exexp` key).

## Refreshing the data

Open the app → Research Deck → **Data Health** → copy the relevant refresh prompt → paste it
into Claude or Codex together with the file → replace the file (and the Drive master) with the
result. Live news/pulse feeds refresh themselves in the browser and cache locally.
