// Server-side Anthropic client (raw fetch, key never leaves the server).
const API = 'https://api.anthropic.com/v1/messages';

export const hasKey = () => !!process.env.ANTHROPIC_API_KEY;
export const model = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

export async function askClaude({ system, messages, tools, maxTokens = 1024, temperature }) {
  if (!hasKey()) {
    const err = new Error('no ANTHROPIC_API_KEY configured');
    err.code = 'NO_KEY';
    throw err;
  }
  const body = { model: model(), max_tokens: maxTokens, messages };
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
export async function completeText(messages, { system, maxTokens = 1024 } = {}) {
  const r = await askClaude({ system, messages, maxTokens });
  return (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}
