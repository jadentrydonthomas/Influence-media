// Server-side Anthropic client (raw fetch, key never leaves the server).
const API = 'https://api.anthropic.com/v1/messages';

export const hasKey = () => !!process.env.ANTHROPIC_API_KEY;
// Main brain: the conversational + tool-using assistant (quality first).
export const model = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
// Fast lane: high-frequency background classification (news sentiment,
// ranking, thesis suggestions) — a smaller/cheaper model runs these many
// times a day so the per-call cost stays low. Override with ANTHROPIC_FAST_MODEL.
export const fastModel = () => process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001';

export async function askClaude({ system, messages, tools, maxTokens = 1024, temperature, fast = false }) {
  if (!hasKey()) {
    const err = new Error('no ANTHROPIC_API_KEY configured');
    err.code = 'NO_KEY';
    throw err;
  }
  const body = { model: fast ? fastModel() : model(), max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools && tools.length) body.tools = tools;
  if (temperature !== undefined) body.temperature = temperature;

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Convenience: single text completion (used by the window.claude shim).
export async function completeText(messages, { system, maxTokens = 1024, fast = false } = {}) {
  const r = await askClaude({ system, messages, maxTokens, fast });
  return (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}
