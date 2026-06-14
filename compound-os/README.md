# Compound OS

Your personal command center — one place to run the sprint: study, schedule, five
workstations (FE · AI · Media · Stocks · Nucor), each with its own AI assistant, plus
live market data. Dependency-free static site (HTML + CSS + vanilla JS). Open it and it
works; everything saves to your browser.

## Highlights
- **Live market desk** — TradingView charts, ticker tape, watchlist and market news built
  into Stocks. Type any ticker in the chart's search box. (No API key, loads in your browser.)
- **Real photography per workspace** — free-licensed shots served from Wikimedia's CDN,
  colour-graded to each station. Swap any hero for your **own image or video** in one line.
- **Calendar** — week grids with the live "now" line; **tap any empty slot to add a block**
  (preset or custom), with a guard on your protected 7am–3pm Nucor block.
- **Per-station AI + global assistant**, **voice** in/out, tasks, memory-stream logs, playbooks.
- **Persistence** via `localStorage` — no server needed for any of the above.

## Use your own hero image or video
Open `index.html`, find the `HERO` map near the top of the script, and set a URL:
```js
const HERO = {
  media: { img: "https://.../your-photo.jpg" },           // a photo
  work:  { video: "https://.../mill.mp4", img: "poster.jpg" }, // a looping video
  ...
};
```
Anything works — a Pexels/Coverr URL, a Canva export, or a file you drop in `assets/img/`.
If an image ever fails to load, the station falls back to a graded cinematic backdrop.

## Run locally
```bash
cd compound-os
python3 -m http.server 8000   # open http://localhost:8000
```

## Make it permanently live (pick one)
**A — Instant, zero account:** drag the `compound-os` folder onto
[Netlify Drop](https://app.netlify.com/drop). You get a permanent URL immediately.

**B — Auto-deploys every time it changes (recommended):** connect the repo to
**Netlify** or **Vercel**, set the **base/root directory** to `compound-os`. Every push
goes live automatically at a permanent URL. `netlify.toml` is already included.

**C — GitHub Pages:** put these files in a repo, then Settings → Pages → deploy from
`main` → `/`. `.nojekyll` is included so `assets/` serves correctly.

### Point your domain at it
Buy a domain, then in your host (Netlify/Vercel) → Domain settings → add it and follow the
DNS records shown. One-click HTTPS. Done.

## Turn the AI assistants on (optional)
The assistants need an Anthropic key, which must live on a server. Deploy
`api/chat.example.js` as a serverless function with `ANTHROPIC_API_KEY` set, then in
`index.html` set `window.COMPOUND_CONFIG = { apiUrl: "https://…/api/chat" }`. Without it,
everything else still works and the AI panels show a friendly note. (TradingView and the
calendar do **not** need this.)

## Stack
Vanilla HTML/CSS/JS. No framework, no build. Dark-first, responsive, reduced-motion aware.
