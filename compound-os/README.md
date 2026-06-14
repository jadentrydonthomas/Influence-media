# Compound OS

A personal command-center dashboard — one place to run the sprint: study, schedule,
five workstations (FE · AI · Media · Stocks · Nucor), and a per-area AI assistant in each.

This is the standalone, deployable build of the prototype. It runs as a dependency-free
static site (HTML + CSS + vanilla JS) and persists everything in your browser, so it works
the moment you open it — no build step, no server required.

## What works offline (no backend)
- **Home** — greeting, days-to-FE ring, streak, momentum strip, up-next, today timeline, station tiles
- **Calendar** — week grids, color-coded blocks, the live "now" line, click any block for a research-grounded brief
- **Tap an empty slot → add a block** — pick a preset or name your own; it persists
- **Five stations** — tasks, memory-stream logs, playbooks, domain panels (FE topic tracker, etc.)
- **Voice** — speech-to-text input and spoken replies (Web Speech API)
- **Persistence** — saved to `localStorage` (keys `os4-*`)

## Real hero imagery
The Market Desk, AI Lab, and Media Studio use real rendered art (`assets/img/hero-*.png`).
FE Command and Nucor Track keep their themed vector heroes until matching renders are dropped in —
just add `assets/img/hero-fe.png` / `hero-nucor.png` and set them in the `HERO_IMG` map in `index.html`.

## Run it locally
```bash
cd compound-os
python3 -m http.server 8000   # then open http://localhost:8000
```

## Turn the AI assistants on (optional)
The assistants need an Anthropic API key, which must live on a server, not in the browser.
1. Deploy `api/chat.example.js` as a serverless function (Vercel / Cloudflare / Netlify) with
   `ANTHROPIC_API_KEY` set in the environment.
2. In `index.html`, set the endpoint before the main script:
   ```html
   <script>window.COMPOUND_CONFIG = { apiUrl: "https://your-app.vercel.app/api/chat" };</script>
   ```
Without this, every other feature still works and the AI panels show a friendly "offline" note.

## Deploy live (free)
**Easiest:** drag the `compound-os` folder onto [Netlify Drop](https://app.netlify.com/drop).

**GitHub Pages:** create a new repo (e.g. `compound-os`), push these files, then
Settings → Pages → deploy from the `main` branch root. `.nojekyll` is already included so
the `assets/` folder serves correctly.

## Point your main domain at it
1. Buy the domain (Namecheap, Cloudflare, Google Domains, etc.).
2. **Netlify:** Site → Domain management → add your domain → follow the DNS records shown.
   **GitHub Pages:** add a `CNAME` file containing your domain, then in your DNS create a
   `CNAME` record (for `www`) → `<username>.github.io`, or four `A` records (for the apex)
   → `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`.
3. Enable HTTPS (one click on both hosts). Done.

## Stack
Vanilla HTML/CSS/JS. No framework, no build. Fonts via Google Fonts. Designed dark-first,
responsive, with reduced-motion support.
