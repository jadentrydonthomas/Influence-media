# AI Ecosystem Atlas

`AI Ecosystem Atlas.html` is a single-file, self-contained market-research app covering the
AI · Quantum · Robotics ecosystems (plus the Cybersecurity sub-ecosystem): 450 mapped companies,
29 sectors, 41 ETFs, bottleneck pressure models, a research checklist system and live news feeds.

**The master copy lives in Google Drive** so Claude and Codex can work on it back and forth:
https://drive.google.com/file/d/1cOb8nnuif1bsO8Vww0m_XQ3iJNL_HvOK/view

Workflow: whichever assistant produces a new version, replace the Drive file with it
(Drive → right-click the file → *Manage versions* → *Upload new version* keeps the same link).
This repo keeps a versioned history of the same file so every change lands as a reviewable diff.

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
