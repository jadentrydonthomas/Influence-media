// TRYDON Agents — autonomous desk workers, one per dashboard, plus any the
// owner creates. Each agent runs on its own cadence, reads live context,
// thinks with the MAIN model (quality over speed — these write to the
// owner's second brain), acts through a CREATE-ONLY tool belt, and leaves a
// short, considered note. Guardrails: agents never delete, never change
// stances/theses text, never touch money fields; caps on tool rounds and
// items created per run.
import { getKey, putKeys, getMeta, setMeta } from './db.js';
import { askClaude } from './anthropic.js';
import { TOOL_DEFS, createExecutor } from './tools.js';
import { todayIso, nowParts, TZ } from './util.js';
import * as feeds from './feeds.js';
import { postAssistantMessage, thesisWatch, morningBriefing, weeklyReview, learningDigest, eveningNudge } from './cron.js';

// create-only belt — the safe subset an autonomous agent may use
const SAFE_TOOLS = new Set([
  'add_task', 'add_todo', 'create_event', 'add_note', 'add_question',
  'add_media_idea', 'add_media_goal', 'add_course', 'add_ai_log',
  'add_thesis_point', 'get_schedule', 'get_station_data',
  'get_stock_snapshot', 'get_steel', 'get_quote_history',
]);
const AGENT_TOOLS = TOOL_DEFS.filter(t => SAFE_TOOLS.has(t.name));
const MAX_ITEMS_PER_RUN = 4;

// ---- built-in desk agents ----------------------------------------------
export const AGENT_DEFS = [
  {
    id: 'chief', station: 'calendar', icon: '◷', name: 'Chief of Staff',
    mission: 'Run the whole timeline: morning briefing, weekly review, keep the calendar honest.',
    cadence: 'daily', builtin: 'briefing',
  },
  {
    id: 'steel', station: 'nucor', icon: '🏭', name: 'Steel Desk',
    mission: 'Watch HRC, scrap and steel-market news each workday. When something changes how he should quote or one insight is worth keeping, file ONE note in the Field Notebook under Market, or queue ONE mentor question. Most days: quiet.',
    cadence: 'daily', llm: true,
  },
  {
    id: 'research', station: 'stocks', icon: '🐂', name: 'Research Desk',
    mission: 'Work the thesis boards against live headlines every two hours: flag pivots, add genuinely new bull/bear points.',
    cadence: '2h', builtin: 'thesiswatch',
  },
  {
    id: 'coach', station: 'fe', icon: '⚙', name: 'Study Coach',
    mission: "Each day until the FE Civil exam: look at today's study block topic and open topics, then post ONE sharp practice question (with the answer hidden below a spoiler line) and one 2-line refresher on the day's topic. If he is behind pace, say so plainly once.",
    cadence: 'daily', llm: true,
  },
  {
    id: 'lab', station: 'ai', icon: '✶', name: 'AI Lab Lead',
    mission: 'Twice a week: read his learning log + the AI signal and refresh the Suggested-for-you queue.',
    cadence: 'mon-thu', builtin: 'digest',
  },
  {
    id: 'trainer', station: 'gym', icon: '🏋️', name: 'Trainer',
    mission: 'Evenings: protect the streak and warn on task rollover.',
    cadence: 'daily', builtin: 'nudge',
  },
  {
    id: 'producer', station: 'media', icon: '🎬', name: 'Producer',
    mission: "Mon/Wed/Fri: pitch exactly TWO fresh content ideas for the Influence Media brand — his lanes are steel-mill life, learning AI in public, investing on a shift-worker wage, and the FE exam grind (short-form: TikTok/Reels/Shorts, edited in CapCut). Each idea: a hook line + the beat structure in one sentence. Add them to the idea bank; skip anything close to an existing idea.",
    cadence: 'mwf', llm: true,
  },
];

// ---- config (owner's overrides + custom agents live in synced state) ----
export function agentConfig() {
  return getKey('agents', { overrides: {}, custom: [] });
}

export function listAgents() {
  const cfg = agentConfig();
  const merged = AGENT_DEFS.map(d => ({
    ...d,
    ...(cfg.overrides[d.id] || {}),
    builtin: d.builtin, llm: d.llm, mission: d.mission, // not overridable
    lastRun: getMeta('agent:last:' + d.id, null),
    lastNote: getMeta('agent:note:' + d.id, ''),
  }));
  for (const c of (cfg.custom || [])) {
    merged.push({
      icon: '◆', cadence: 'daily', ...c, custom: true, llm: true,
      lastRun: getMeta('agent:last:' + c.id, null),
      lastNote: getMeta('agent:note:' + c.id, ''),
    });
  }
  return merged.map(a => ({ ...a, enabled: a.enabled !== false }));
}

export function setAgent(id, patch) {
  const cfg = agentConfig();
  const custom = (cfg.custom || []).find(c => c.id === id);
  if (custom) Object.assign(custom, patch);
  else cfg.overrides[id] = { ...(cfg.overrides[id] || {}), ...patch };
  putKeys({ agents: cfg });
}

export function addCustomAgent({ name, station, mission, cadence = 'daily', icon = '◆' }) {
  const cfg = agentConfig();
  const id = 'cust' + Date.now().toString(36);
  cfg.custom = [...(cfg.custom || []), { id, name, station: station || 'calendar', mission, cadence, icon, enabled: true }];
  putKeys({ agents: cfg });
  return id;
}

// ---- the generic LLM agent runner ---------------------------------------
async function buildContext(agent) {
  const now = nowParts();
  const lines = [`Now: ${now.weekday} ${now.iso} ${now.hm} (${TZ()}).`];
  const st = agent.station;
  try {
    if (st === 'nucor') {
      const s = await feeds.steel().catch(() => null);
      if (s?.hrc) lines.push(`HRC steel: $${s.hrc}/ton (${s.hrcChg >= 0 ? '+' : ''}${s.hrcChg}%). 12wk: ${(s.series || []).join(',')}`);
      const n = await feeds.nucorNews().catch(() => null);
      if (n?.items?.length) lines.push('Steel/Nucor headlines:\n' + n.items.map(x => `- [${x.tag}] ${x.head}`).join('\n'));
      const nb = getKey('nucorNotebook', []);
      lines.push('Recent notebook topics: ' + ([...new Set(nb.slice(-10).map(x => x.topic))].join(', ') || 'none yet'));
    } else if (st === 'fe') {
      const exam = getKey('examDate', '');
      const topics = getKey('feTopics', []);
      const evs = getKey('events', []).filter(e => e.date === todayIso() && String(e.id).startsWith('fe-plan'));
      lines.push(`Exam: ${exam}. Open areas: ${topics.filter(t => !t.done).map(t => t.title).join('; ') || 'all done'}.`);
      lines.push(`Done areas: ${topics.filter(t => t.done).map(t => t.title).join('; ') || 'none'}.`);
      if (evs.length) lines.push(`Today's study block: ${evs[0].title}`);
    } else if (st === 'media') {
      const ideas = getKey('mediaIdeas', []);
      const goals = getKey('mediaGoals', []);
      lines.push('Existing ideas (do not repeat): ' + (ideas.map(i => i.text).join(' | ') || 'none'));
      lines.push('Goals: ' + (goals.map(g => g.title).join('; ') || 'none set'));
    } else if (st === 'stocks') {
      const wl = getKey('watchlist', []);
      lines.push('Watchlist: ' + wl.map(w => w.sym).join(', '));
    } else if (st === 'gym') {
      const g = getKey('gym', {});
      lines.push(`Streak ${g.streak || 0}, best ${g.best || 0}.`);
    }
  } catch { /* context is best-effort */ }
  return lines.join('\n');
}

export async function runLlmAgent(agent) {
  // preload every key the safe tool belt can read OR write — a write-back of
  // a key that wasn't loaded would clobber it with just the new item
  const snapshot = { state: Object.fromEntries(
    ['events', 'tasks', 'stationTodos', 'nucorNotebook', 'nucorProjects', 'nucorTasks', 'nucorNotes',
     'salesQs', 'leaderQs', 'jobs', 'mediaIdeas', 'mediaGoals', 'mediaChannels', 'courses', 'aiLog',
     'aiNews', 'aiWorkflows', 'thesisPoints', 'theses', 'stances', 'holdings', 'watchlist', 'feTopics',
     'examDate', 'steel', 'quoteTons', 'quoteMargin', 'gym', 'nutrition', 'specialDays', 'monthGoals']
      .map(k => [k, getKey(k, null)]).filter(([, v]) => v !== null)
  ), custom: [], removed: [] };
  const exec = createExecutor(snapshot);
  const context = await buildContext(agent);

  const system = `You are ${agent.name.toUpperCase()}, an autonomous desk agent inside TRYDON — the personal command deck of one man: a Nucor steel-mill worker in Indiana (7:00–15:00 weekday shifts) who quotes steel jobs, studies for the FE Civil exam, invests, builds the Influence Media content brand, and trains.

Your standing mission: ${agent.mission}

How you work — this matters:
- Think first, act small. One considered contribution beats five shallow ones. If nothing genuinely useful exists today, do nothing and say "Quiet day — nothing worth adding." That is a good outcome.
- You may only CREATE (notes, tasks, ideas, questions, thesis points, events). Never assume you can delete or modify.
- Create at most ${MAX_ITEMS_PER_RUN} items per run. Usually 1–2.
- Write like a sharp colleague, not a bot: plain words, specific, no filler, no hype, no bullet-spam.
- End with a one-or-two-sentence note summarizing what you did and why — that note is what he reads.`;

  const convo = [{ role: 'user', content: `Context for this run:\n${context}\n\nDo your pass now.` }];
  let note = '';
  for (let round = 0; round < 4; round++) {
    const res = await askClaude({ system, messages: convo, tools: AGENT_TOOLS, maxTokens: 900 });
    const uses = (res.content || []).filter(b => b.type === 'tool_use');
    const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!uses.length || exec.receipts.length >= MAX_ITEMS_PER_RUN) { note = text || note; break; }
    convo.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const tu of uses) {
      let out;
      try { out = await exec.run(tu.name, tu.input || {}); }
      catch (e) { out = 'ERROR: ' + String(e.message || e).slice(0, 150); }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(out) });
    }
    convo.push({ role: 'user', content: results });
  }

  const changed = {};
  for (const k of exec.changed) changed[k] = snapshot.state[k];
  if (Object.keys(changed).length) putKeys(changed);

  const summary = (note || '').trim().slice(0, 400);
  if (exec.receipts.length || (summary && !/quiet day/i.test(summary))) {
    postAssistantMessage(`${agent.icon} ${agent.name.toUpperCase()} — ${summary || 'done.'}`, exec.receipts.slice(0, 6));
  }
  return { note: summary, receipts: exec.receipts };
}

// ---- dispatch ------------------------------------------------------------
const BUILTINS = {
  briefing: morningBriefing,
  thesiswatch: thesisWatch,
  digest: learningDigest,
  nudge: eveningNudge,
  weekly: weeklyReview,
};

export async function runAgent(id) {
  const agent = listAgents().find(a => a.id === id);
  if (!agent) throw new Error('unknown agent: ' + id);
  setMeta('agent:last:' + id, String(Date.now()));
  let result;
  if (agent.builtin && BUILTINS[agent.builtin]) {
    await BUILTINS[agent.builtin]();
    result = { note: 'ran ' + agent.builtin };
  } else {
    result = await runLlmAgent(agent);
  }
  setMeta('agent:note:' + id, (result.note || '').slice(0, 200));
  return result;
}

function dueToday(agent, weekday) {
  switch (agent.cadence) {
    case 'mon-thu': return ['Monday', 'Thursday'].includes(weekday);
    case 'mwf': return ['Monday', 'Wednesday', 'Friday'].includes(weekday);
    case 'weekdays': return !['Saturday', 'Sunday'].includes(weekday);
    default: return true; // daily / 2h
  }
}

// Called from the cron tick. Built-ins keep their own scheduling in cron.js;
// this drives the LLM agents (+ custom ones) once per due day, after 09:00.
export async function agentTick() {
  const { hm, weekday } = nowParts();
  if (hm < '09:00' || hm > '21:00') return;
  for (const agent of listAgents()) {
    if (!agent.enabled || agent.builtin || !agent.llm) continue;
    if (!dueToday(agent, weekday)) continue;
    const key = 'agentran:' + agent.id;
    if (getMeta(key) === todayIso()) continue;
    setMeta(key, todayIso());
    try { await runAgent(agent.id); }
    catch (e) { console.error('[agent ' + agent.id + ']', e.message); }
  }
}
