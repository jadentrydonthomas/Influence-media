// Ask Trydon — agentic assistant. Tool-use loop over the user's state
// snapshot; mutations come back to the client as changed keys + receipts.
import { askClaude, completeText } from './anthropic.js';
import { TOOL_DEFS, createExecutor, sourcesSummary } from './tools.js';
import { nowParts, TZ } from './util.js';
import * as feeds from './feeds.js';

const MAX_TOOL_ROUNDS = 8;

// Station specialists: the main brain adopts the persona of the desk the
// user is standing in, so answers carry domain expertise instead of generic
// help. Same model, focused instructions — cheaper than running separate
// always-on agents, and it can still act across every station's tools.
const SPECIALISTS = {
  nucor: 'STEEL DESK — a commercial steel specialist. You know HRC pricing, scrap, mill lead times, tonnage takeoffs, quote margins, and how tariffs and demand move the market. Sharpen his quoting and his climb toward sales engineer.',
  stocks: 'RESEARCH DESK — a disciplined equity analyst focused on reducing his blind spots. Push him to write both sides, tie claims to catalysts and data, and flag when news pivots a thesis. Never give buy/sell advice as fact; frame as his own conviction to pressure-test.',
  fe: 'STUDY COACH — an FE Civil exam tutor. You know all 14 NCEES knowledge areas, the reference handbook, and time-boxed practice. Keep him on a plan that lands before exam day.',
  ai: 'AI LAB LEAD — an applied-AI mentor. Keep him current, push hands-on building and testing over passive reading, and connect new tools to what he is actually trying to make.',
  gym: 'TRAINER — a strength and nutrition coach. Protect the streak, progress the lifts, hit calorie/protein targets, program smart around shift work.',
  media: 'CONTENT PRODUCER — a creator-growth strategist across YouTube/TikTok/Instagram. Turn ideas into a shippable pipeline and consistent posting.',
  calendar: 'CHIEF OF STAFF — you run his whole timeline: shifts, study, gym, deadlines. Protect focus and keep the week realistic.',
};

function systemPrompt(snapshot, station) {
  const now = nowParts();
  const custom = (snapshot.custom || []).map(c => `${c.key} ("${c.label}")`).join(', ');
  const persona = SPECIALISTS[station];
  return `You are Trydon, the assistant inside a personal life command deck used by one person: a Nucor steel-mill worker (production shift 7:00–15:00) who quotes steel jobs, studies AI/agents, invests (Webull), creates content (YouTube/TikTok/Instagram), trains at the gym, and is prepping for the FE Civil exam.
${persona ? `\nRight now he is at the ${station.toUpperCase()} station, so answer as his ${persona}\nYou can still use tools that touch any station when he asks.\n` : ''}
Today is ${now.weekday} ${now.iso}, ${now.hm} (${TZ()}).

Stations: calendar, nucor, fe, ai, stocks, media, gym${custom ? ', plus custom: ' + custom : ''}.
Connected data sources: ${sourcesSummary()}.

Rules:
- Use tools to act on his data. Resolve relative dates from today (${now.iso}). 24h HH:MM times. Default event duration 1h.
- CREATE freely (events, tasks, logs, ideas, questions) when asked.
- CONFIRM before destructive or sensitive changes: deleting anything, changing a thesis or stance, touching money fields, or resetting the deck (reset_deck wipes everything — a backup is kept). Ask first, act only after an explicit yes in this conversation.
- Every tool action auto-generates a receipt chip in the UI — don't repeat receipts verbatim in your reply.
- If he asks to wire up a data panel, ask which provider he wants (offer sane options), then call configure_source. Never re-ask about a source listed as connected above.
- Reply terse and friendly: 1–3 short sentences unless he asks for depth. No markdown headers.`;
}

function mapHistory(messages = [], latest) {
  const out = [];
  for (const m of messages.slice(-20)) {
    const role = m.role === 'user' ? 'user' : 'assistant';
    const text = String(m.text || '').slice(0, 1500);
    if (!text) continue;
    if (out.length && out[out.length - 1].role === role) {
      out[out.length - 1].content += '\n' + text;
    } else {
      out.push({ role, content: text });
    }
  }
  if (latest) {
    if (out.length && out[out.length - 1].role === 'user') out[out.length - 1].content += '\n' + latest;
    else out.push({ role: 'user', content: latest });
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '(session start)' });
  return out;
}

export async function chat({ text, messages, snapshot, station }) {
  const exec = createExecutor(snapshot);
  const convo = mapHistory(messages, text);
  let reply = '';

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await askClaude({
      system: systemPrompt(snapshot, station),
      messages: convo,
      tools: TOOL_DEFS,
      maxTokens: 1200,
    });
    const toolUses = (res.content || []).filter(b => b.type === 'tool_use');
    const texts = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!toolUses.length || round === MAX_TOOL_ROUNDS) {
      reply = texts || 'Done.';
      break;
    }
    convo.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const tu of toolUses) {
      let result;
      try { result = await exec.run(tu.name, tu.input || {}); }
      catch (e) { result = 'ERROR: ' + String(e.message || e).slice(0, 200); }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result) });
    }
    convo.push({ role: 'user', content: results });
  }

  const changedKeys = {};
  for (const k of exec.changed) changedKeys[k] = snapshot.state[k];
  return { reply, receipts: exec.receipts, changedKeys, reset: exec.resetRequested || undefined };
}

// ---- Thesis Debater ----
export async function debate({ sym, snapshot }) {
  sym = (sym || '').toUpperCase();
  const st = snapshot.state;
  const thesis = (st.theses || {})[sym] || { bull: '', bear: '' };
  const stance = (st.stances || {})[sym] || 'WATCH';
  const holding = (st.holdings || []).find(h => h.sym === sym);
  let live = null, news = [];
  try { live = await feeds.quote(sym); } catch { /* debate on saved data */ }
  try { news = (await feeds.stockNews(sym)).items || []; } catch { /* no headlines */ }

  const bearish = /bear|sell/i.test(stance);
  const sideToArgue = bearish ? 'BULL' : 'BEAR';
  const prompt = `You are the Thesis Debater inside Trydon, a personal trading research deck. The user's current stance on ${sym} is ${stance}${holding ? ` and he holds ${holding.shares} shares @ $${holding.cost}` : ''}.

His BULL thesis: ${thesis.bull || '(empty)'}
His BEAR thesis: ${thesis.bear || '(empty)'}

Live data: ${live ? `price $${live.price} (${live.chgN >= 0 ? '+' : ''}${live.chgN}% today)` : 'quote unavailable'}.
Latest headlines:
${news.slice(0, 5).map(n => `- ${n.head}`).join('\n') || '- (none available)'}

Steelman the ${sideToArgue} case AGAINST his current stance in 3–5 sharp numbered points. Tie every point to a concrete data point or headline above, or to a specific weakness in his own thesis text (quote his words back where possible). Be direct, no hedging, no disclaimers. End with exactly one question starting "What would change your mind" and offer to save any concession he makes into his ${sideToArgue.toLowerCase()} thesis.`;

  const reply = await completeText([{ role: 'user', content: prompt }], { maxTokens: 900 });
  return { reply };
}
