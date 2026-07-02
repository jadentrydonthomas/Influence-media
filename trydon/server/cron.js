// Scheduled assistant jobs. Each posts a message into the synced state
// (state key "messages") that the deck shows on next load/poll.
// Times are local to TRYDON_TZ. Quiet hours (22:00–07:00) suppress everything
// except the morning briefing, which lands silently for wake-up.
import { getKey, putKeys, getMeta, setMeta, makeBackup } from './db.js';
import { completeText, hasKey } from './anthropic.js';
import * as feeds from './feeds.js';
import { todayIso, nowParts, to12, TZ } from './util.js';

const BRIEFING_TIME = () => process.env.TRYDON_BRIEFING_TIME || '06:30';

export function postAssistantMessage(text, chips = []) {
  const messages = getKey('messages', []);
  messages.push({ id: 'cron' + Date.now(), role: 'assistant', text, chips });
  putKeys({ messages: messages.slice(-200) });
}

function ranToday(job) {
  return getMeta('cron:' + job) === todayIso();
}
function markRan(job) {
  setMeta('cron:' + job, todayIso());
}

// ---------- morning briefing ----------
export async function morningBriefing() {
  const state = {};
  for (const k of ['events', 'tasks', 'watchlist', 'holdings', 'gym', 'nutrition', 'quoteTons', 'quoteMargin']) {
    state[k] = getKey(k);
  }
  const iso = todayIso();
  const events = (state.events || []).filter(e => e.date === iso).sort((a, b) => a.start.localeCompare(b.start));
  const tasks = (state.tasks || []).filter(t => !t.done);
  const syms = (state.watchlist || []).map(w => w.sym).slice(0, 8);

  const [steelR, nucorR, aiR, ...quotes] = await Promise.allSettled([
    feeds.steel(), feeds.nucorNews(), feeds.aiNewsRanked(),
    ...syms.map(s => feeds.quote(s)),
  ]);
  const steel = steelR.status === 'fulfilled' && steelR.value.hrc ? steelR.value : null;
  const nucor = nucorR.status === 'fulfilled' ? (nucorR.value.items || [])[0] : null;
  const ai = aiR.status === 'fulfilled' ? (aiR.value.items || [])[0] : null;
  const qs = quotes.filter(q => q.status === 'fulfilled' && q.value.price != null).map(q => q.value);

  const facts = [
    `Today ${nowParts().weekday} ${iso}.`,
    events.length ? 'Calendar: ' + events.map(e => `${to12(e.start)} ${e.title}`).join('; ') : 'Calendar: clear.',
    tasks.length ? `Open tasks: ${tasks.map(t => t.title).join('; ')}` : 'No open tasks.',
    steel ? `HRC steel $${steel.hrc}/ton (${steel.hrcChg >= 0 ? '+' : ''}${steel.hrcChg}%).` : '',
    nucor ? `Nucor news: ${nucor.head}` : '',
    qs.length ? 'Watchlist: ' + qs.map(q => `${q.sym} $${q.price} (${q.chgN >= 0 ? '+' : ''}${q.chgN}%)`).join(', ') : '',
    ai ? `AI signal: ${ai.head}` : '',
    state.gym ? `Gym streak ${state.gym.streak} days.` : '',
    state.nutrition ? `Nutrition goals: ${state.nutrition.calGoal} cal / ${state.nutrition.proGoal}g protein.` : '',
  ].filter(Boolean).join('\n');

  let text;
  if (hasKey()) {
    try {
      text = await completeText([{
        role: 'user',
        content: `Turn these facts into a tight morning briefing for the deck's owner (steel worker, investor, AI learner). Friendly, direct, max 120 words, plain text with short lines, no markdown symbols. Start with "Morning." Lead with the day's shape, then market/steel, then the one AI item, close with gym/momentum.\n\n${facts}`,
      }], { maxTokens: 400 });
    } catch { text = 'Morning. Here is today:\n' + facts; }
  } else {
    text = 'Morning. Here is today:\n' + facts;
  }
  postAssistantMessage(text);

  // refresh the AI Signal + steel panels for wake-up
  const upd = {};
  if (aiR.status === 'fulfilled' && aiR.value.items?.length) {
    upd.aiNews = aiR.value.items.map((x, i) => ({ id: 'nws' + Date.now() + i, src: x.tag, time: x.time, head: x.head, url: x.url }));
  }
  if (steel) {
    const saved = getKey('steel', {});
    upd.steel = { ...saved, hrc: steel.hrc, hrcChg: steel.hrcChg, series: steel.series?.length ? steel.series : saved.series };
  }
  if (Object.keys(upd).length) putKeys(upd);
}

// ---------- steel move alert (>2%) ----------
export async function steelAlertCheck() {
  let s;
  try { s = await feeds.steel(); } catch { return; }
  if (!s.hrc) return;
  const lastAlerted = Number(getMeta('steel_alert_price', 0));
  if (!lastAlerted) { setMeta('steel_alert_price', s.hrc); return; }
  const movePct = ((s.hrc - lastAlerted) / lastAlerted) * 100;
  if (Math.abs(movePct) < 2) return;
  const tons = getKey('quoteTons', 40), margin = getKey('quoteMargin', 18);
  const oldQ = Math.round(lastAlerted * tons * (1 + margin / 100));
  const newQ = Math.round(s.hrc * tons * (1 + margin / 100));
  postAssistantMessage(
    `⚠ Steel moved ${movePct > 0 ? 'up' : 'down'} ${Math.abs(movePct).toFixed(1)}%: HRC $${lastAlerted} → $${s.hrc}/ton.\n` +
    `At your quote inputs (${tons}t, ${margin}% margin) a quote shifts $${oldQ.toLocaleString()} → $${newQ.toLocaleString()}. Re-check anything you're about to send.`
  );
  setMeta('steel_alert_price', s.hrc);
  const saved = getKey('steel', {});
  putKeys({ steel: { ...saved, hrc: s.hrc, hrcChg: s.hrcChg, series: s.series?.length ? s.series : saved.series } });
}

// ---------- weekly review (Sunday evening) ----------
export async function weeklyReview() {
  const gym = getKey('gym', {});
  const hist = getKey('todoHistory', []);
  const holdings = getKey('holdings', []);
  const events = getKey('events', []);
  const theses = getKey('theses', {});

  let pl = [];
  for (const h of holdings.slice(0, 8)) {
    try {
      const c = await feeds.candles(h.sym, '1W');
      const first = c.series?.[0], last = c.series?.[c.series.length - 1];
      if (first && last) pl.push(`${h.sym} ${(((last - first) / first) * 100).toFixed(1)}% wk`);
    } catch { /* skip symbol */ }
  }
  const nextWeek = events.filter(e => e.date > todayIso() && e.date <= todayIso(7)).length;
  const staleTheses = Object.entries(theses).filter(([, t]) => !(t?.bull || t?.bear)).map(([s]) => s);
  const facts = [
    hist.length ? `To-do completion trend (last ${hist.length} days): ${hist.join('% ')}%.` : '',
    gym.streak != null ? `Gym streak ${gym.streak} (best ${gym.best}).` : '',
    pl.length ? `Portfolio week: ${pl.join(', ')}.` : '',
    `${nextWeek} events on next week's calendar.`,
    staleTheses.length ? `No written thesis yet for: ${staleTheses.join(', ')}.` : '',
  ].filter(Boolean).join('\n');

  let text;
  if (hasKey()) {
    try {
      text = await completeText([{
        role: 'user',
        content: `Write a Sunday-evening weekly review for the deck's owner from these facts. Encouraging but honest, max 110 words, plain text. End with one pointed question about next week.\n\n${facts}`,
      }], { maxTokens: 350 });
    } catch { text = 'Weekly review:\n' + facts; }
  } else {
    text = 'Weekly review:\n' + facts;
  }
  postAssistantMessage(text);
}

// ---------- learning digest (Mon + Thu) ----------
export async function learningDigest() {
  if (!hasKey()) return; // needs the LLM — silently skip
  const aiLog = getKey('aiLog', []).slice(0, 6);
  const courses = getKey('courses', []);
  let signal = [];
  try { signal = (await feeds.aiNewsRanked()).items || []; } catch { /* fine */ }
  const prompt = `You coach one person learning AI/agents while working a steel mill day job. Based on his recent learning log, course list, and this week's AI news, recommend exactly three things, each 1–2 lines: (1) the next course/topic to push on, (2) one new tool or technique to try this week, (3) one small concrete build idea that compounds his skills. Plain text, numbered, max 110 words total. If a recommended course has a URL from his list, mention it.

Learning log: ${JSON.stringify(aiLog)}
Courses (done flag = finished): ${JSON.stringify(courses.map(c => ({ name: c.name, provider: c.provider, done: c.done })))}
AI news this week: ${signal.map(s => s.head).join(' | ')}`;
  try {
    const text = await completeText([{ role: 'user', content: prompt }], { maxTokens: 400 });
    postAssistantMessage('📚 Learning digest\n' + text);
  } catch { /* next scheduled run will retry */ }
}

// ---------- streak / rollover nudges (once, evening, quiet-hours safe) ----------
export function eveningNudge() {
  const iso = todayIso();
  const gym = getKey('gym', null);
  const tasks = getKey('tasks', []);
  const lines = [];
  if (gym && gym.streak > 0 && !(gym.sessions || []).some(x => x.date === iso)) {
    lines.push(`🔥 Your ${gym.streak}-day gym streak is on the line — nothing logged today yet. Even 20 minutes keeps it alive.`);
  }
  const open = tasks.filter(t => !t.done);
  if (open.length) {
    lines.push(`📋 ${open.length} task${open.length > 1 ? 's' : ''} would roll over at midnight: ${open.slice(0, 3).map(t => t.title).join(', ')}${open.length > 3 ? '…' : ''}`);
  }
  if (lines.length) postAssistantMessage(lines.join('\n'));
}

// ---------- scheduler ----------
export function startCron() {
  const tick = async () => {
    const { hm, weekday } = nowParts();
    try {
      if (hm >= BRIEFING_TIME() && !ranToday('briefing')) {
        markRan('briefing');
        await morningBriefing();
      }
      if (hm >= '03:30' && !ranToday('backup')) {
        markRan('backup');
        makeBackup();
      }
      // steel check hourly during trading/work hours
      if (hm >= '07:00' && hm <= '17:00' && !['Saturday', 'Sunday'].includes(weekday)) {
        const key = 'steel:' + hm.slice(0, 2);
        if (getMeta('cron:' + key) !== todayIso()) {
          setMeta('cron:' + key, todayIso());
          await steelAlertCheck();
        }
      }
      if (weekday === 'Sunday' && hm >= '18:00' && !ranToday('weekly')) {
        markRan('weekly');
        await weeklyReview();
      }
      if (['Monday', 'Thursday'].includes(weekday) && hm >= '17:00' && !ranToday('digest')) {
        markRan('digest');
        await learningDigest();
      }
      if (hm >= '20:30' && hm < '22:00' && !ranToday('nudge')) {
        markRan('nudge');
        eveningNudge();
      }
    } catch (e) {
      console.error('[cron]', e.message);
    }
  };
  setInterval(tick, 30_000);
  tick();
  console.log(`[cron] scheduler running (tz=${TZ()}, briefing=${BRIEFING_TIME()})`);
}
