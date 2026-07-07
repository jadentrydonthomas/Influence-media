# TRYDON — Personal Command Deck

**Get your link (one time, ~3 minutes):**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/jadentrydonthomas/Influence-media)

1. Click the button → sign in with GitHub → Render reads `render.yaml` automatically.
2. Paste your Anthropic API key when prompted → **Apply**.
3. In ~2 minutes you get a permanent `https://trydon-….onrender.com` URL — open it on the
   22" portrait monitor (the layout reflows natively), and on your phone hit
   "Add to Home Screen" to install it as an app.

The deck currently runs **open** (no access code, as requested). Anyone who finds the
URL can see your data and spend your Anthropic credits — when you're ready to lock it,
add one env var in the Render dashboard: `TRYDON_ACCESS_CODE=<anything>`. Log in once
per device and it remembers for 90 days.

---

The approved `Trydon-standalone.html` frontend, now with a full backend behind it:
accounts, database, cross-device sync, live market/steel/news data, scheduled
briefings, and an agentic Ask Trydon assistant. **The UI was not redesigned** —
the original file was unbundled as-is and only wired up (a copy of the handed-off
file is kept in `original/` as the design spec).

## Run it

```bash
cd trydon
cp .env.example .env        # fill in ANTHROPIC_API_KEY + TRYDON_ACCESS_CODE
node server.js              # Node >= 22.5, zero npm dependencies
# open http://localhost:8321   (set TRYDON_INSECURE_COOKIE=1 for plain-HTTP localhost)
```

Deploy anywhere Node 22 runs. For Render, the included `render.yaml` is a
one-click blueprint (persistent disk mounted for the SQLite DB). Railway/Fly/a
VPS work the same: `node server.js` + a persistent `TRYDON_DATA_DIR`.

## What's wired

| Area | Status |
|---|---|
| Auth + sync | Access-code login (signed session cookie), per-key state sync to SQLite, laptop + phone see the same data live (25s poll + on-focus pull). |
| Migration | First login against an empty server pushes the browser's existing `trydon.v2` localStorage up automatically. Coming from the old standalone file (different origin): export there is not possible, so use ⌘K → **IMPORT BACKUP** with a JSON of the blob (see below). |
| Ask Trydon | Server-side Anthropic tool loop over his real data: create/update/delete events (confirm-first for deletes), tasks, station to-dos, gym + food logs, Nucor jobs + statuses, theses/stances (confirm-first), watchlist adds, courses, media ideas/goals, mentor/leadership questions, schedule reads, live stock/steel reads, quote saves, `configure_source`. Every action returns a receipt chip. Falls back to the built-in quick parser when no API key. |
| Stocks | Live quotes + candles (all ranges) via Yahoo Finance (no key needed), per-ticker headlines merged from Yahoo + Google News (deduped, publisher-tagged, all linking out), holdings marked to market, live 52-week/volume stats, watchlist sparks. **Webull OpenAPI was not used** — it requires a regional developer application and is unavailable for personal US accounts; Yahoo market data is the fallback, holdings stay manual (add them in the Portfolio panel any time and they price live). Supply Webull App Key/Secret later and an adapter can be attempted. |
| Thesis Debater | ⚔ DEBATE ME button on every symbol (and "debate me on X" in chat): steelmans the opposite side of the recorded stance in 3–5 points tied to live price + headlines and his own thesis text, ends with "what would change your mind", offers to save concessions. |
| Nucor | HRC steel price live from CME futures (`HRC=F`) with 12-week trend; Quote Helper computes from the live number; >2% move triggers an assistant alert with the quote impact; **SAVE QUOTE** builds a personal pricing history (`/api/quotes`). Nucor News merges three independent feeds — Google News on Nucor, Google News on the steel market, Yahoo's NUE wire — deduped, publisher-tagged, every headline links to the full article. Scrap price stays user-side and is tagged `sample` until a source is configured. Jobs import: paste your spreadsheet rows (CSV) into Ask Trydon and it maps them into the log; full Google Sheets 2-way sync needs a Google OAuth app — ask when ready. |
| AI Signal | Hacker News + arXiv cs.AI + Anthropic/OpenAI/DeepMind blogs, aggregated server-side, ranked + rewritten daily by Claude for *his* profile (agents, building, investing). Learning digest (Mon + Thu) reads his aiLog + courses and recommends next course / tool / build idea. |
| Media | Platform labels link out to his channels (set them by telling the assistant, e.g. "my YouTube is @…"). YouTube subs/views/videos go live with a `YOUTUBE_API_KEY` (public Data API — no OAuth consent screens). TikTok/Instagram APIs require app approvals; cards stay link-outs with clearly `SAMPLE`-tagged stats until then. |
| Scheduled jobs | Morning briefing (calendar + tasks + steel + Nucor news + watchlist + one AI item + gym/nutrition) at `TRYDON_BRIEFING_TIME`; steel-move alerts hourly on workdays; Sunday-evening weekly review (to-do trend, streak, week P/L, thesis nudges); learning digest 2×/week; a 20:30 nudge if the gym streak is at risk or tasks are about to roll over; daily DB backup (30-day retention). Quiet hours respected — nothing pings 22:00–07:00 except the briefing landing silently. Preview any job on demand: `POST /api/cron/run?job=briefing|weekly|digest|nudge|steel`. |
| ⊕ sources | Chips open a setup chat; the assistant stores the choice via `configure_source` (SQLite `sources` table) and never re-asks; chips flip from dashed `⊕` to `● LIVE` when a feed is flowing or configured. Generic: new custom stations can register feeds with no new backend code. |
| Extras | ⌘K global search across everything + one-tap **EXPORT JSON** / **IMPORT BACKUP**; PWA (install to phone home screen, offline read-only via service worker); keyboard shortcuts (1–7 stations, `n` event, `t` task, `/` assistant); focus-timer survives reloads; every feed cached server-side in SQLite so API quotas aren't burned per page load. |
| Agent Deck | Seven autonomous desk agents (one per station) + hire-your-own with a plain-English mission. LLM agents run daily on a create-only tool belt (max 4 items/run) and are told a quiet day is a good outcome; built-ins keep the proven cron schedules. Notes land in chat; manage everything from ⚙ Agent Deck (sidebar / phone tab bar): status, last note, ON/OFF, run-now. `/api/agents`. |
| Long-term memory | The second-brain substrate: a `memory` table seeded with the owner's founding profile, grown nightly by a distiller that reads the day's chat with the fast model and keeps at most 3 durable facts (usually zero). Injected into every assistant answer and every agent run. Say "remember that …" / "forget #id" in chat, or view it all under 🧠 in the Agent Deck. `/api/memory` (GET list, POST add/forget/distill). |
| Content studio | "Script that idea" in chat → `draft_script` writes a hook/beats/CTA short-form script with CapCut edit notes in the Influence Media voice, saved per-idea and pasted in chat. |
| Outbound seam | Set `TRYDON_WEBHOOK_URL` to any webhook (Zapier/Make/ntfy/Discord) and briefings, weekly reviews and steel alerts POST there as JSON — the bridge to email/SMS and, later, real autonomous outbound actions (`server/outbound.js`). |
| Research Desk | Portfolio-manager persona over a live tape injected per turn: watchlist quotes, 1M trend + range position, holdings P/L, next earnings date within 21 days (binary-event warning), broker link state. Candlestick charts with volume + crosshair on every range. `server/broker.js` is the Webull-ready seam (`WEBULL_APP_KEY`/`WEBULL_APP_SECRET`). |

## Plug-in points (whenever you're ready — everything adjusts automatically)

- **Channels**: tell Ask Trydon "my YouTube is @…" (same for TikTok/Instagram) — the Media
  labels start linking out instantly. Add `YOUTUBE_API_KEY` (free, Google Cloud console →
  YouTube Data API v3) and the sample stats flip to live subs/views.
- **Webull**: holdings live in the Portfolio panel and price live off Yahoo today. If Webull
  OpenAPI credentials ever land, drop them in and an adapter can be wired.
- **Quoting spreadsheet**: paste rows into Ask Trydon and it fills the jobs log; Sheets 2-way
  sync is a later upgrade (needs a Google OAuth app).
- **Access code**: one env var (`TRYDON_ACCESS_CODE`) locks the deck the day you want it locked.
- **AI Signal / steel sources**: tap any ⊕ chip and tell the assistant what to add or switch.

## Migrating data from the old standalone file

On the machine where the old `Trydon-standalone.html` has your data: open it, press
F12 → Console, run `copy(localStorage.getItem('trydon.v2'))`, paste into a file
saved as `trydon-backup.json`, then in the new deck press ⌘K → IMPORT BACKUP.

## Architecture

```
trydon/
  server.js            zero-dep Node server: static + API + cron
  server/
    db.js              SQLite (node:sqlite): state keys, sources, cache,
                       backups, quote history, sidecar files
    auth.js            access code → HMAC session cookie
    assistant.js       Anthropic tool loop + Thesis Debater
    tools.js           25 tools over the user's state snapshot
    feeds.js           Yahoo quotes/candles, HRC=F steel, RSS news,
                       HN/arXiv/lab-blog AI signal, YouTube stats — all cached
    cron.js            briefing / steel alert / weekly review / digest / backup
    anthropic.js       server-side API client (key never reaches the client)
    util.js            timezone-aware date helpers
  public/
    index.html         the original app (unbundled), lightly patched: real
                       dates, sync hooks, live-feed plumbing, debate button,
                       quote save, source-chip states, sample-data tags
    trydon-bridge.js   hydration + push/pull sync, assistant routing, ⌘K
                       search, shortcuts, PWA registration, window.claude shim
    dc-runtime.js      the app's original runtime (React URLs vendored local)
    vendor/            React 18.3.1 + Babel standalone (self-hosted)
    <uuid files>       fonts/images from the original bundle (names unchanged)
  tools/unbundle.py    one-time script that unpacked the handed-off file
  original/            the untouched handed-off standalone (design spec)
```

Design decisions of note: single-user by design (one access code, one state);
per-key last-write-wins sync (server timestamps authoritative); the client
stays the source of truth for chat-driven edits (server returns changed keys,
client applies + persists), while cron jobs write server-side and reach
devices via the poll; every simulated value that isn't wired yet is labeled
`sample` in the UI per the build contract.
