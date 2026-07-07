// Assistant tools: function-calls over the user's own data.
// The executor mutates a state snapshot (the client's synced state); the
// route returns changed keys for the client to apply + persist. Receipts
// ("✓ Added: …") surface in chat as chips.
import { uid, todayIso, to12 } from './util.js';
import { saveSource, listSources, addQuote, listQuotes, wipeState, addMemory, forgetMemory } from './db.js';
import { completeText } from './anthropic.js';
import * as feeds from './feeds.js';

const STATIONS = ['calendar', 'nucor', 'fe', 'ai', 'stocks', 'media', 'gym'];

const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

export const TOOL_DEFS = [
  { name: 'create_event', description: 'Add a calendar event. Nucor work-calendar entries: also pass kind (Meeting|Job|Task|Question) to mirror into the Nucor week view.', input_schema: S({ title: str('event title'), date: str('YYYY-MM-DD'), start: str('HH:MM 24h'), end: str('HH:MM 24h, default +1h'), station: str('calendar|nucor|fe|ai|stocks|media|gym or a custom station key'), kind: str('for Nucor work calendar: Meeting|Job|Task|Question') }, ['title', 'date', 'start']) },
  { name: 'update_event', description: 'Update an existing event found by id or by title (+date).', input_schema: S({ id: str('event id'), match_title: str('title to find if id unknown'), match_date: str('date to disambiguate'), title: str('new title'), date: str('new date'), start: str('new start'), end: str('new end'), station: str('new station') }) },
  { name: 'delete_event', description: 'Delete an event. Only call AFTER the user has explicitly confirmed the deletion in this conversation.', input_schema: S({ id: str('event id'), match_title: str('title to find if id unknown'), match_date: str('date to disambiguate') }) },
  { name: 'add_task', description: "Add a to-do to today's task list.", input_schema: S({ title: str('task title'), time: str('HH:MM optional'), station: str('station key, default calendar') }, ['title']) },
  { name: 'complete_task', description: 'Mark a task done by title or id.', input_schema: S({ title: str('task title (fuzzy ok)'), id: str('task id') }) },
  { name: 'add_todo', description: "Add an item to a station's own to-do list (not the daily task list).", input_schema: S({ station: str('station key'), title: str('item') }, ['station', 'title']) },
  { name: 'add_special', description: 'Add a special day (birthday/holiday/special) to the calendar.', input_schema: S({ date: str('YYYY-MM-DD'), label: str('label'), subtype: str('birthday|holiday|special') }, ['date', 'label']) },
  { name: 'log_gym_session', description: 'Log a gym session (extends the streak, mirrors onto the calendar).', input_schema: S({ type: str('Push|Pull|Legs|Cardio|other'), minutes: num('duration in minutes'), date: str('YYYY-MM-DD, default today') }, ['type', 'minutes']) },
  { name: 'log_food', description: 'Log food into the nutrition tracker.', input_schema: S({ name: str('food'), cal: num('calories'), protein: num('grams protein') }, ['name', 'cal']) },
  { name: 'add_job', description: 'Add a job to the Nucor quoting log (status starts at Quoting).', input_schema: S({ name: str('job name'), customer: str('customer'), tons: num('tons'), value: num('dollar value') }, ['name']) },
  { name: 'update_job_status', description: 'Set a Nucor job status: Quoting|Sent|Won|Lost.', input_schema: S({ name: str('job name (fuzzy ok)'), id: str('job id'), status: str('Quoting|Sent|Won|Lost') }, ['status']) },
  { name: 'update_thesis', description: 'Update the bull or bear thesis for a symbol. Only call AFTER the user confirmed the exact text change.', input_schema: S({ sym: str('ticker'), side: str('bull|bear'), text: str('thesis text'), mode: str('replace|append, default append') }, ['sym', 'side', 'text']) },
  { name: 'set_stance', description: 'Set stance for a symbol (WATCH / BULLISH ▲ / BEARISH ▼ / BUY / SELL). Only call AFTER user confirmation.', input_schema: S({ sym: str('ticker'), stance: str('stance') }, ['sym', 'stance']) },
  { name: 'add_watchlist', description: 'Add a ticker to the stocks watchlist.', input_schema: S({ sym: str('ticker'), name: str('company name') }, ['sym']) },
  { name: 'add_thesis_point', description: 'Add a checkable key point to the bull or bear thesis board for a symbol (e.g. from a news item he wants to track).', input_schema: S({ sym: str('ticker'), side: str('bull|bear'), text: str('the point, one line') }, ['sym', 'side', 'text']) },
  { name: 'check_thesis_point', description: 'Mark a thesis point as pivoted/played-out (checked off). Find by text match.', input_schema: S({ sym: str('ticker'), text: str('point text (fuzzy ok)') }, ['sym', 'text']) },
  { name: 'add_course', description: 'Add a course to the AI learning list.', input_schema: S({ name: str('course name'), provider: str('provider'), url: str('link') }, ['name']) },
  { name: 'add_media_idea', description: 'Add an idea to the media idea bank.', input_schema: S({ text: str('the idea') }, ['text']) },
  { name: 'add_media_goal', description: 'Add a content goal to the media station.', input_schema: S({ title: str('goal') }, ['title']) },
  { name: 'add_question', description: 'Add a question to the Nucor mentor (sales) or leadership list.', input_schema: S({ audience: str('mentor|leadership'), q: str('the question') }, ['audience', 'q']) },
  { name: 'add_ai_log', description: 'Add an entry to the AI learning log.', input_schema: S({ title: str('what was learned/built'), note: str('one-line detail') }, ['title']) },
  { name: 'add_note', description: 'File a note in the Nucor Field Notebook under a topic (e.g. Frames, Connections, Quoting).', input_schema: S({ topic: str('topic to file under'), text: str('the note') }, ['topic', 'text']) },
  { name: 'get_schedule', description: 'Read events + tasks between two dates (inclusive). Use to answer "what does my week look like".', input_schema: S({ from: str('YYYY-MM-DD, default today'), to: str('YYYY-MM-DD, default from+7') }) },
  { name: 'get_station_data', description: 'Read a station\'s data: todos, goals, logs, jobs, questions, gym, nutrition, courses…', input_schema: S({ station: str('station key') }, ['station']) },
  { name: 'get_stock_snapshot', description: 'Live quote + latest headlines + saved thesis/stance/holding for a symbol.', input_schema: S({ sym: str('ticker') }, ['sym']) },
  { name: 'get_steel', description: 'Live HRC steel price + trend and the quote-helper suggestion at current inputs.', input_schema: S({}) },
  { name: 'save_quote', description: 'Save the current Quote Helper calculation into the pricing history (call when the user acts on a quote).', input_schema: S({ tons: num('tons'), margin: num('margin %'), note: str('job/customer note') }, ['tons', 'margin']) },
  { name: 'get_quote_history', description: 'Read saved quote history (steel price at quote time vs outcomes).', input_schema: S({}) },
  { name: 'configure_source', description: 'Persist a data-source choice the user just made for a panel (steel|nucor_news|jobs|charts|stock_news|ai_news|media). Never re-ask once configured.', input_schema: S({ panel: str('panel id'), provider: str('chosen provider'), config: { type: 'object', description: 'provider settings: urls, column mapping, channel handles…' } }, ['panel', 'provider']) },
  { name: 'remember', description: "Save a durable fact about the owner into TRYDON's long-term memory (preferences, goals, relationships, commitments, recurring patterns). Use when he says 'remember that…' or reveals something worth keeping for months. Not for one-off tasks.", input_schema: S({ topic: str('work|fe|stocks|media|ai|gym|identity|life'), fact: str('the fact, one plain sentence') }, ['fact']) },
  { name: 'forget_memory', description: 'Delete one long-term memory by id. Only call AFTER the user explicitly confirmed which memory to forget in this conversation.', input_schema: S({ id: num('memory id') }, ['id']) },
  { name: 'draft_script', description: 'Write a short-form video script for one of his Influence Media content ideas: hook, timed beats (voiceover + b-roll), CTA, and CapCut edit notes. Finds the idea in the bank by fuzzy match, or scripts the given text directly. IMPORTANT: paste the COMPLETE script verbatim in your reply — chat is the only place he can read it.', input_schema: S({ idea: str('idea text or a fragment to match in the idea bank'), platform: str('tiktok|reels|shorts — default tiktok'), length: str('target length, e.g. 30s or 60s — default 30s') }, ['idea']) },
  { name: 'reset_deck', description: 'Factory-reset the ENTIRE deck: wipes all data (a backup is kept 30 days) and reboots with clean starting state. DESTRUCTIVE — only call after the user explicitly confirmed the wipe in this conversation.', input_schema: S({}) },
];

const fuzzy = (list, field, needle = '') => {
  const n = needle.toLowerCase();
  return list.find(x => (x[field] || '').toLowerCase() === n)
    || list.find(x => (x[field] || '').toLowerCase().includes(n));
};

export function createExecutor(snapshot) {
  const st = snapshot.state;
  const receipts = [];
  const changed = new Set();
  const touch = (...keys) => keys.forEach(k => changed.add(k));
  const stationOk = s => STATIONS.includes(s) || (snapshot.custom || []).some(c => c.key === s) ? s : 'calendar';

  const run = async (name, a = {}) => {
    switch (name) {
      case 'create_event': {
        const id = uid('e');
        const ev = { id, date: a.date, start: a.start, end: a.end || addHour(a.start), title: a.title, station: stationOk(a.station || 'calendar') };
        st.events = [...(st.events || []), ev];
        touch('events');
        if (a.kind && ev.station === 'nucor') {
          st.nucorProjects = [...(st.nucorProjects || []), { id: 'np' + id, title: a.title, kind: a.kind, date: a.date, time: a.start }];
          touch('nucorProjects');
        }
        receipts.push(`✓ Added: ${a.title} — ${a.date} ${to12(a.start)}`);
        return `created event ${id}`;
      }
      case 'update_event': {
        const ev = a.id ? (st.events || []).find(e => e.id === a.id)
          : fuzzy((st.events || []).filter(e => !a.match_date || e.date === a.match_date), 'title', a.match_title);
        if (!ev) return 'ERROR: event not found';
        for (const k of ['title', 'date', 'start', 'end', 'station']) if (a[k]) ev[k] = k === 'station' ? stationOk(a[k]) : a[k];
        touch('events');
        receipts.push(`✓ Updated: ${ev.title} — ${ev.date} ${to12(ev.start)}`);
        return 'updated';
      }
      case 'delete_event': {
        const ev = a.id ? (st.events || []).find(e => e.id === a.id)
          : fuzzy((st.events || []).filter(e => !a.match_date || e.date === a.match_date), 'title', a.match_title);
        if (!ev) return 'ERROR: event not found';
        st.events = st.events.filter(e => e.id !== ev.id);
        touch('events');
        receipts.push(`✓ Deleted: ${ev.title} — ${ev.date}`);
        return 'deleted';
      }
      case 'add_task': {
        st.tasks = [...(st.tasks || []), { id: uid('t'), title: a.title, time: a.time || '', done: false, station: stationOk(a.station || 'calendar') }];
        touch('tasks');
        receipts.push(`✓ To-do: ${a.title}`);
        return 'added';
      }
      case 'complete_task': {
        const t = a.id ? (st.tasks || []).find(x => x.id === a.id) : fuzzy(st.tasks || [], 'title', a.title);
        if (!t) return 'ERROR: task not found';
        t.done = true;
        touch('tasks');
        receipts.push(`✓ Done: ${t.title}`);
        return 'completed';
      }
      case 'add_todo': {
        const s = stationOk(a.station);
        st.stationTodos = { ...(st.stationTodos || {}), [s]: [...((st.stationTodos || {})[s] || []), { id: uid('std'), title: a.title, done: false }] };
        touch('stationTodos');
        receipts.push(`✓ ${s} to-do: ${a.title}`);
        return 'added';
      }
      case 'add_special': {
        st.specialDays = [...(st.specialDays || []), { id: uid('s'), date: a.date, label: a.label, type: a.subtype || 'special' }];
        touch('specialDays');
        receipts.push(`✓ ${a.label} · ${a.date}`);
        return 'added';
      }
      case 'log_gym_session': {
        const date = a.date || todayIso();
        const g = st.gym || { streak: 0, best: 0, sessions: [], prs: [] };
        if ((g.sessions || []).some(x => x.date === date)) return 'already logged for ' + date;
        g.sessions = [{ id: uid('gs'), date, type: a.type, min: a.minutes }, ...(g.sessions || [])];
        g.streak = (g.streak || 0) + 1;
        g.best = Math.max(g.best || 0, g.streak);
        st.gym = { ...g };
        touch('gym');
        if (!(st.events || []).some(e => e.date === date && e.station === 'gym')) {
          st.events = [...(st.events || []), { id: uid('ge'), date, start: '17:30', end: '18:30', title: `Gym — ${a.type} day`, station: 'gym' }];
          touch('events');
        }
        receipts.push(`✓ Gym logged: ${a.type} ${a.minutes}min — streak ${g.streak}`);
        return 'logged';
      }
      case 'log_food': {
        const n = st.nutrition || { calGoal: 2600, proGoal: 180, foods: [] };
        n.foods = [...(n.foods || []), { id: uid('fd'), name: a.name, cal: Math.round(a.cal), pro: Math.round(a.protein || 0) }];
        st.nutrition = { ...n };
        touch('nutrition');
        receipts.push(`✓ Food: ${a.name} (${Math.round(a.cal)} cal / ${Math.round(a.protein || 0)}g)`);
        return 'logged';
      }
      case 'add_job': {
        st.jobs = [{ id: uid('jb'), name: a.name, customer: a.customer || '—', tons: a.tons || 0, value: a.value || 0, status: 'Quoting' }, ...(st.jobs || [])];
        touch('jobs');
        receipts.push(`✓ Job: ${a.name} (${a.tons || 0}t)`);
        return 'added';
      }
      case 'update_job_status': {
        const j = a.id ? (st.jobs || []).find(x => x.id === a.id) : fuzzy(st.jobs || [], 'name', a.name);
        if (!j) return 'ERROR: job not found';
        j.status = a.status;
        touch('jobs');
        receipts.push(`✓ ${j.name} → ${a.status}`);
        return 'updated';
      }
      case 'update_thesis': {
        const sym = (a.sym || '').toUpperCase();
        const cur = (st.theses || {})[sym] || { bull: '', bear: '' };
        const side = a.side === 'bear' ? 'bear' : 'bull';
        const text = a.mode === 'replace' ? a.text : (cur[side] ? cur[side] + '\n' + a.text : a.text);
        st.theses = { ...(st.theses || {}), [sym]: { ...cur, [side]: text } };
        touch('theses');
        receipts.push(`✓ ${sym} ${side} thesis updated`);
        return 'updated';
      }
      case 'set_stance': {
        const sym = (a.sym || '').toUpperCase();
        st.stances = { ...(st.stances || {}), [sym]: a.stance };
        touch('stances');
        receipts.push(`✓ ${sym} stance → ${a.stance}`);
        return 'set';
      }
      case 'add_watchlist': {
        const sym = (a.sym || '').toUpperCase();
        if ((st.watchlist || []).some(w => w.sym === sym)) return sym + ' already on watchlist';
        let price = 0, chgN = 0, nm = a.name || sym;
        try {
          const q = await feeds.quote(sym);
          if (q.price) { price = q.price; chgN = q.chgN; nm = a.name || q.name || sym; }
        } catch { /* offline: added with zero price, live poll fills it in */ }
        st.watchlist = [...(st.watchlist || []), { sym, name: nm, cap: 'SMALL', price: String(price.toFixed ? price.toFixed(2) : price), chgN, base: price || 10 }];
        st.theses = { ...(st.theses || {}), [sym]: { bull: '', bear: '' } };
        st.stances = { ...(st.stances || {}), [sym]: 'WATCH' };
        touch('watchlist', 'theses', 'stances');
        receipts.push(`✓ Watching ${sym}`);
        return 'added';
      }
      case 'add_thesis_point': {
        const sym = (a.sym || '').toUpperCase();
        const side = a.side === 'bear' ? 'bear' : 'bull';
        const pts = (st.thesisPoints || {})[sym] || [];
        st.thesisPoints = { ...(st.thesisPoints || {}), [sym]: [...pts, { id: uid('tp'), side, text: a.text, done: false }] };
        touch('thesisPoints');
        receipts.push(`✓ ${sym} ${side} point: ${a.text.slice(0, 40)}`);
        return 'added';
      }
      case 'check_thesis_point': {
        const sym = (a.sym || '').toUpperCase();
        const pts = (st.thesisPoints || {})[sym] || [];
        const p = fuzzy(pts, 'text', a.text);
        if (!p) return 'ERROR: point not found';
        p.done = true;
        st.thesisPoints = { ...(st.thesisPoints || {}), [sym]: [...pts] };
        touch('thesisPoints');
        receipts.push(`✓ ${sym} point checked: ${p.text.slice(0, 40)}`);
        return 'checked';
      }
      case 'add_course': {
        st.courses = [...(st.courses || []), { id: uid('c'), name: a.name, provider: a.provider || 'Suggested', url: a.url || '#', done: false }];
        touch('courses');
        receipts.push(`✓ Course: ${a.name}`);
        return 'added';
      }
      case 'add_media_idea': {
        st.mediaIdeas = [{ id: uid('mi'), text: a.text }, ...(st.mediaIdeas || [])];
        touch('mediaIdeas');
        receipts.push(`✓ Idea banked`);
        return 'added';
      }
      case 'add_media_goal': {
        st.mediaGoals = [...(st.mediaGoals || []), { id: uid('mg'), title: a.title, done: false }];
        touch('mediaGoals');
        receipts.push(`✓ Goal: ${a.title}`);
        return 'added';
      }
      case 'add_question': {
        const key = a.audience === 'leadership' ? 'leaderQs' : 'salesQs';
        st[key] = [...(st[key] || []), { id: uid('q'), q: a.q, asked: false }];
        touch(key);
        receipts.push(`✓ Question queued for ${a.audience === 'leadership' ? 'leadership' : 'your mentor'}`);
        return 'added';
      }
      case 'add_ai_log': {
        const d = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
        st.aiLog = [{ id: uid('l'), date: d, title: a.title, note: a.note || '' }, ...(st.aiLog || [])];
        touch('aiLog');
        receipts.push(`✓ Logged: ${a.title}`);
        return 'added';
      }
      case 'add_note': {
        st.nucorNotebook = [...(st.nucorNotebook || []), { id: uid('nb'), topic: a.topic, text: a.text, ts: Date.now() }];
        touch('nucorNotebook');
        receipts.push(`✓ Note filed under ${a.topic}`);
        return 'added';
      }
      case 'get_schedule': {
        const from = a.from || todayIso();
        const to = a.to || todayIso(7);
        const evs = (st.events || []).filter(e => e.date >= from && e.date <= to)
          .sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start))
          .map(e => `${e.date} ${e.start}-${e.end} ${e.title} [${e.station}] (id:${e.id})`);
        const tasks = (st.tasks || []).map(t => `${t.done ? '[x]' : '[ ]'} ${t.title}${t.time ? ' @' + t.time : ''} [${t.station}] (id:${t.id})`);
        const specials = (st.specialDays || []).filter(s2 => s2.date >= from && s2.date <= to).map(s2 => `${s2.date} ★ ${s2.label}`);
        return JSON.stringify({ events: evs, tasks, specials });
      }
      case 'get_station_data': {
        const s = a.station;
        const pick = {
          gym: { gym: st.gym, nutrition: st.nutrition },
          stocks: { watchlist: st.watchlist, holdings: st.holdings, stances: st.stances, theses: st.theses },
          nucor: { jobs: st.jobs, nucorTasks: st.nucorTasks, nucorProjects: st.nucorProjects, salesQs: st.salesQs, leaderQs: st.leaderQs, steel: st.steel, quoteTons: st.quoteTons, quoteMargin: st.quoteMargin, notes: st.nucorNotes },
          ai: { courses: st.courses, aiLog: st.aiLog, aiNews: st.aiNews, workflows: st.aiWorkflows },
          media: { goals: st.mediaGoals, ideas: st.mediaIdeas },
          fe: { topics: st.feTopics, examDate: st.examDate },
          calendar: { monthGoals: st.monthGoals, specialDays: st.specialDays },
        }[s] || {};
        pick.todos = (st.stationTodos || {})[s] || [];
        return JSON.stringify(pick).slice(0, 6000);
      }
      case 'get_stock_snapshot': {
        const sym = (a.sym || '').toUpperCase();
        const out = {
          watch: (st.watchlist || []).find(w => w.sym === sym) || null,
          thesis: (st.theses || {})[sym] || null,
          stance: (st.stances || {})[sym] || null,
          holding: (st.holdings || []).find(h => h.sym === sym) || null,
        };
        try { out.live = await feeds.quote(sym); } catch { out.live = null; }
        try { out.news = (await feeds.stockNews(sym)).items || null; } catch { out.news = null; }
        return JSON.stringify(out).slice(0, 6000);
      }
      case 'get_steel': {
        let live = null;
        try { live = await feeds.steel(); } catch { /* fall back to saved */ }
        const hrc = live?.hrc || st.steel?.hrc || 0;
        const tons = st.quoteTons || 0, margin = st.quoteMargin || 0;
        const suggested = Math.round(hrc * tons * (1 + margin / 100));
        return JSON.stringify({ live, saved: st.steel, quoteHelper: { tons, margin, suggested } });
      }
      case 'save_quote': {
        let hrc = st.steel?.hrc || 0;
        try { const s2 = await feeds.steel(); if (s2.hrc) hrc = s2.hrc; } catch { /* use saved */ }
        const quoteVal = Math.round(hrc * a.tons * (1 + a.margin / 100));
        addQuote({ hrc, tons: a.tons, margin: a.margin, quote: quoteVal, note: a.note || '' });
        receipts.push(`✓ Quote saved: ${a.tons}t @ ${a.margin}% → $${quoteVal.toLocaleString()} (HRC $${hrc})`);
        return 'saved';
      }
      case 'get_quote_history':
        return JSON.stringify(listQuotes(50));
      case 'configure_source': {
        saveSource({ id: a.panel, panel: a.panel, provider: a.provider, config: a.config || {} });
        st.sourcesConnected = [...new Set([...(st.sourcesConnected || []), a.panel])];
        touch('sourcesConnected');
        if (a.panel === 'media' && a.config) {
          const ch = st.mediaChannels || { youtube: '', tiktok: '', instagram: '' };
          for (const k of ['youtube', 'tiktok', 'instagram']) if (a.config[k]) ch[k] = a.config[k];
          st.mediaChannels = { ...ch };
          touch('mediaChannels');
        }
        receipts.push(`✓ Source connected: ${a.panel} → ${a.provider}`);
        return 'configured';
      }
      case 'remember': {
        const id = addMemory(a.topic || 'life', a.fact, 'chat');
        receipts.push(`🧠 Remembered: ${String(a.fact).slice(0, 48)}`);
        return 'saved to long-term memory (id ' + id + ')';
      }
      case 'forget_memory': {
        const ok = forgetMemory(a.id);
        if (ok) receipts.push('🧠 Forgot memory #' + a.id);
        return ok ? 'forgotten' : 'ERROR: no memory with that id';
      }
      case 'draft_script': {
        const hit = fuzzy(st.mediaIdeas || [], 'text', a.idea);
        const ideaText = hit ? hit.text : a.idea;
        const script = await completeText([{
          role: 'user',
          content: `Write a ${a.length || '30s'} ${(a.platform || 'TikTok')} script for the Influence Media brand — a Nucor steel-mill worker documenting steel-mill life, learning AI in public, investing on a shift-worker wage, and the FE-exam grind (he has also collaborated with Dr. Spine). Idea: "${ideaText}".

Format exactly:
HOOK (0-3s): the opening line + what's on screen.
BEATS: 3-5 timed beats, each one line of voiceover + [b-roll/on-screen note].
CTA: one line.
CAPCUT NOTES: 3 quick edit notes (cuts, captions, sound).
Voice: first-person, plain, confident, zero hype-words. No hashtags.`,
        }], { maxTokens: 700 });
        st.mediaScripts = { ...(st.mediaScripts || {}), [hit ? hit.id : uid('scr')]: { idea: ideaText, script, at: Date.now() } };
        touch('mediaScripts');
        receipts.push(`🎬 Script drafted: ${String(ideaText).slice(0, 42)}`);
        return script;
      }
      case 'reset_deck': {
        wipeState();
        exec.resetRequested = true;
        receipts.push('✓ Deck reset — everything wiped (backup kept 30 days). Reloading fresh…');
        return 'reset complete; the client will reload with clean state';
      }
      default:
        return `ERROR: unknown tool ${name}`;
    }
  };

  const exec = { run, receipts, changed, resetRequested: false };
  return exec;
}

function addHour(hm = '10:00') {
  const [H, M] = hm.split(':');
  return `${String(Math.min(23, +H + 1)).padStart(2, '0')}:${M}`;
}

export function sourcesSummary() {
  return listSources().map(s => `${s.panel}: ${s.provider}`).join('; ') || 'none configured yet';
}
