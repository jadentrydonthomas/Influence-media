# Influence Media

People don't just leave their house — they are influenced. **Influence Media** is a social
media marketing agency focused on creating engagement and driving customer acquisition through
smart social media strategies.

This repository contains the agency's marketing website.

## Tech

A lightweight, dependency-free static site — just HTML, CSS, and vanilla JavaScript.
No build step, no frameworks. It runs anywhere and deploys for free.

| File | Purpose |
|------|---------|
| `index.html` | Page structure and content |
| `styles.css` | Styling, layout, and responsive design |
| `script.js`  | Nav, scroll reveals, stat counters, and the contact form |

## Run it locally

Just open `index.html` in your browser. Or, for a local server:

```bash
# Python 3
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Sections

- **Hero** — headline, call-to-action, and animated stats
- **Services** — what the agency offers
- **Process** — the four-step engagement
- **Results** — proof points and a testimonial
- **About** — the agency's philosophy
- **Contact** — a lead-capture form

## Deploy

Drag the folder into [Netlify Drop](https://app.netlify.com/drop), or connect the repo to
[Vercel](https://vercel.com) or **GitHub Pages** — no configuration needed.

## Next steps

- Wire the contact form to a real backend or form service (Formspree, Netlify Forms, etc.).
  Right now submissions are validated and stored in the browser's `localStorage`.
- Swap in real client logos, case studies, and testimonials.
- Add your brand's actual stats and results.
