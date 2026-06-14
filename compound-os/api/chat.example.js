// Compound OS — AI proxy (example)
// ---------------------------------
// The dashboard's assistants POST an Anthropic Messages payload to AI_API.
// In production you do NOT want the API key in the browser. Drop this tiny
// proxy behind your own URL, keep the key in an env var, then point the app
// at it by setting (in index.html, before the main script):
//
//   window.COMPOUND_CONFIG = { apiUrl: "https://your-app.vercel.app/api/chat" };
//
// This file is a Vercel / Next-style serverless function. The same ~15 lines
// port directly to Cloudflare Pages Functions, Netlify Functions, or a small
// Express route — just read the JSON body and forward it with the key + the
// anthropic-version header (and the web-search beta header for the Research Desk).

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
        // Enables the Research Desk's web_search tool:
        "anthropic-beta": "web-search-2025-03-05",
      },
      // The browser already sends a valid Messages body (model, system,
      // messages, max_tokens, optional tools) — forward it untouched.
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: "Upstream error", detail: String(err) });
  }
}
