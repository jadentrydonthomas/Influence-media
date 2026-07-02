# TRYDON — Personal Command Deck

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
| Stocks | Live quotes + candles (all ranges) + per-ticker headlines via Yahoo Finance (no key needed), holdings marked to market, live 52-week/volume stats, watchlist sparks. **Webull OpenAPI was not used** — it requires a regional developer application and is unavailable for personal US accounts; Yahoo market data is the fallback, holdings stay manual. Say the word and a Webull adapter can be attempted with your App Key/Secret. |
| Thesis Debater | ⚔ DEBATE ME button on every symbol (and "debate me on X" in chat): steelmans the opposite side of the recorded stance in 3–5 points tied to live price + headlines and his own thesis text, ends with "what would change your mind", offers to save concessions. |
| Nucor | HRC steel price live from CME futures (`HRC=F`) with 12-week trend; Quote Helper computes from the live number; >2% move triggers an assistant alert with the quote impact; **SAVE QUOTE** builds a personal pricing history (`/api/quotes`). Nucor news live via Google News RSS. Scrap price stays user-side and is tagged `sample` until a source is configured. Jobs spreadsheet import: tell the assistant your columns (the `jobs` source is registered through ⊕/chat); a Sheets 2-way sync needs a Google OAuth app — ask when ready. |
| AI Signal | Hacker News + arXiv cs.AI + Anthropic/OpenAI/DeepMind blogs, aggregated server-side, ranked + rewritten daily by Claude for *his* profile (agents, building, investing). Learning digest (Mon + Thu) reads his aiLog + courses and recommends next course / tool / build idea. |
| Media | Platform labels link out to his channels (set them by telling the assistant, e.g. "my YouTube is @…"). YouTube subs/views/videos go live with a `YOUTUBE_API_KEY` (public Data API — no OAuth consent screens). TikTok/Instagram APIs require app approvals; cards stay link-outs with clearly `SAMPLE`-tagged stats until then. |
| Scheduled jobs | Morning briefing (calendar + tasks + steel + Nucor news + watchlist + one AI item + gym/nutrition) at `TRYDON_BRIEFING_TIME`; steel-move alerts hourly on workdays; Sunday-evening weekly review (to-do trend, streak, week P/L, thesis nudges); learning digest 2×/week; daily DB backup (30-day retention). Quiet hours respected — nothing pings 22:00–07:00 except the briefing landing silently. |
| ⊕ sources | Chips open a setup chat; the assistant stores the choice via `configure_source` (SQLite `sources` table) and never re-asks; chips flip from dashed `⊕` to `● LIVE` when a feed is flowing or configured. Generic: new custom stations can register feeds with no new backend code. |
| Extras | ⌘K global search across everything + one-tap **EXPORT JSON** / **IMPORT BACKUP**; PWA (install to phone home screen, offline read-only via service worker); keyboard shortcuts (1–7 stations, `n` event, `t` task, `/` assistant); focus-timer survives reloads; every feed cached server-side in SQLite so API quotas aren't burned per page load. |

## Answers needed (one-time)

1. **Anthropic API key** → `ANTHROPIC_API_KEY` (console.anthropic.com). This unlocks the real assistant, debater, ranking, briefing prose.
2. **Access code** you want for login → `TRYDON_ACCESS_CODE`.
3. **Timezone + briefing time** → `TRYDON_TZ`, `TRYDON_BRIEFING_TIME` (defaults: America/Chicago, 06:30).
4. **Channel URLs** (YouTube/TikTok/Instagram) → just tell Ask Trydon once. For live YouTube numbers also set `YOUTUBE_API_KEY` (free, Google Cloud console → YouTube Data API v3).
5. **Webull**: approve the Yahoo fallback (recommended) or supply Webull OpenAPI credentials to attempt a direct hookup.
6. **Quoting spreadsheet** columns (job / customer / tons / value / status) → tell the assistant; Google Sheets 2-way sync additionally needs a Google OAuth app you'd create.
7. **AI Signal tastes**: defaults are HN + arXiv + the big-lab blogs — name favorites to add.
8. **Steel source**: default is CME HRC futures; if work has an internal index, paste it into the ⊕ SOURCE chat.

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
