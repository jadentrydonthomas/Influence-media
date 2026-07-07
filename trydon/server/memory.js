// TRYDON long-term memory — the second-brain substrate.
// Durable facts about the owner live in the memory table. Three flows:
//   1. seedMemory(): one-time profile distilled from everything he's shared
//      while this deck was being built.
//   2. memoryDistill(): nightly cron — reads the day's chat and pulls out
//      0–3 NEW durable facts with the fast model (cheap, quiet).
//   3. The assistant tool `remember` + /api/memory for explicit adds/forgets.
// Consumers: assistant systemPrompt (memoryBrief) and agents (relevantMemory).
import { addMemory, listMemory, getKey, getMeta, setMeta } from './db.js';
import { completeText, hasKey } from './anthropic.js';
import { todayIso } from './util.js';

// ---- the founding profile ----------------------------------------------
// Written once (meta flag). Everything here came from the owner directly.
const SEED = [
  ['identity', 'His name is Jaden Trydon Thomas — Trydon is his middle name, and this deck (TRYDON) is named after it. He calls it his second brain.'],
  ['identity', 'Lives in Indiana (Eastern time). Direct, ambitious, learns by building; prefers plain talk over hype.'],
  ['work', 'Works production at a Nucor steel mill, weekday shifts 7:00–15:00, and quotes steel jobs; aiming to grow toward a sales-engineer role.'],
  ['work', 'Cares about HRC and scrap pricing because they move his quote margins; keeps a Field Notebook (Frames, Connections, Quoting, Market) and queues questions for his mentor and leadership.'],
  ['fe', 'Taking the FE Civil exam July 17, 2026 — all 14 NCEES knowledge areas tracked on the FE station; studying around his shift schedule.'],
  ['stocks', 'Invests through Webull (connection planned into the deck); wants a research-desk partner that argues both sides of a thesis, not a cheerleader. Watches Nucor (NUE) plus small caps.'],
  ['stocks', 'Position sizes are wage-earner scale — risk talk should be in real dollars and invalidation levels, never hero-trade language.'],
  ['media', 'Runs the Influence Media content brand: YouTube, TikTok and Instagram, short-form first; edits in CapCut.'],
  ['media', 'Has worked with Dr. Spine on content. His lanes: steel-mill life, learning AI in public, investing on a shift-worker wage, and the FE exam grind.'],
  ['ai', 'Actively learning AI and agent-building; wants TRYDON to be where he does his AI work and eventually to run autonomous applications (including email) that act on its knowledge of him.'],
  ['gym', 'Training and nutrition tracked on the Gym station; streak protection matters to him. Took July 4th weekend 2026 off work.'],
  ['life', 'Wants his deck honest: agents that stay quiet on empty days beat agents that fill space. Quality over noise, always.'],
];

export function seedMemory() {
  if (getMeta('memory_seed_v1')) return false;
  setMeta('memory_seed_v1', '1');
  for (const [topic, fact] of SEED) addMemory(topic, fact, 'seed');
  console.log('[memory] founding profile seeded:', SEED.length, 'facts');
  return true;
}

// ---- injection helpers ----------------------------------------------------
// Whole-brain brief for the assistant: newest first, capped.
export function memoryBrief(maxChars = 1400) {
  const rows = listMemory(null, 60);
  const lines = [];
  let used = 0;
  for (const r of rows) {
    const line = `- [${r.topic}] ${r.fact}`;
    if (used + line.length > maxChars) break;
    lines.push(line); used += line.length + 1;
  }
  return lines.join('\n');
}

// Station-scoped slice for the desk agents.
const STATION_TOPICS = {
  nucor: ['work', 'identity'], fe: ['fe', 'identity'], stocks: ['stocks', 'identity'],
  media: ['media', 'identity'], ai: ['ai', 'identity'], gym: ['gym', 'identity'],
  calendar: ['identity', 'life', 'work', 'fe'],
};
export function relevantMemory(station, maxLines = 6) {
  const topics = STATION_TOPICS[station] || ['identity', 'life'];
  const rows = listMemory(null, 100).filter(r => topics.includes(r.topic)).slice(0, maxLines);
  return rows.map(r => `- ${r.fact}`).join('\n');
}

// ---- nightly distiller ----------------------------------------------------
// Reads today's chat turns and extracts durable NEW facts. Fast model,
// one call, hard-capped at 3 facts; most nights it should find none.
export async function memoryDistill() {
  if (!hasKey()) return { added: 0 };
  const messages = getKey('messages', []);
  const today = messages.slice(-60).filter(m => m.role === 'user').map(m => String(m.text || '').slice(0, 400));
  if (today.length < 2) return { added: 0 };
  const existing = memoryBrief(1600);
  const prompt = `You maintain the long-term memory of TRYDON, a personal command deck. Below is what you already know, then today's messages FROM the owner (his words only).

Already known:
${existing || '(nothing yet)'}

Today's messages:
${today.map(t => '- ' + t).join('\n')}

Extract at most 3 NEW durable facts about the owner worth remembering for months (preferences, goals, relationships, commitments, recurring patterns). Ignore one-off requests, moods, small talk, and anything already known. Reply with ONLY a JSON array like [{"topic":"work|fe|stocks|media|ai|gym|identity|life","fact":"..."}] — reply [] if nothing qualifies, which is the common case.`;
  const before = listMemory(null, 500).length;
  try {
    const raw = await completeText([{ role: 'user', content: prompt }], { maxTokens: 400, fast: true });
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) {
      for (const f of JSON.parse(m[0]).slice(0, 3)) {
        if (f && f.fact) addMemory(f.topic, f.fact, 'distilled:' + todayIso());
      }
    }
  } catch (e) { console.error('[memory] distill:', e.message); }
  return { added: listMemory(null, 500).length - before };
}
