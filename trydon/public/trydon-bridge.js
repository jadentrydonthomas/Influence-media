// TRYDON bridge — runs before the app runtime. Handles: server state
// hydration + cross-device sync, assistant routing, window.claude /
// window.omelette shims, PWA registration, global search (⌘K), shortcuts.
(function () {
  'use strict';
  const LS_KEY = 'trydon.v2';
  const SYNC_KEY = 'trydon.sync';
  const PUSH_DEBOUNCE = 900;
  const POLL_MS = 25_000;

  const readBlob = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch (e) { return null; } };
  const writeBlob = (b) => { try { localStorage.setItem(LS_KEY, JSON.stringify(b)); } catch (e) {} };
  const readSync = () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || { lastPull: 0, epoch: 0 }; } catch (e) { return { lastPull: 0, epoch: 0 }; } };
  const writeSync = (s) => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)); } catch (e) {} };

  const api = async (path, opts) => {
    const r = await fetch(path, { credentials: 'same-origin', ...opts });
    if (r.status === 401) { location.reload(); throw new Error('unauthorized'); }
    if (!r.ok) throw new Error('api ' + r.status);
    return r.json();
  };

  const state = { lastPushed: {}, llm: false, pushTimer: null, online: true };

  // Keys that describe where he IS, not what he HAS. Never synced: a poll
  // can bring live data without yanking the screen to another station.
  const LOCAL_ONLY = new Set(['view', 'calTab', 'selSym', 'range', 'thesisMode']);

  // keys ↔ blob translation: server stores each app key as a row; the app's
  // localStorage blob is {state:{...}, custom:[], removed:[]}
  function blobToKeys(blob) {
    const keys = {};
    for (const [k, v] of Object.entries(blob.state || {})) {
      if (!LOCAL_ONLY.has(k)) keys[k] = v;
    }
    keys.custom = blob.custom || [];
    keys.removed = blob.removed || [];
    return keys;
  }
  function applyKeysToBlob(blob, keys) {
    blob = blob || { state: {}, custom: [], removed: [] };
    for (const [k, v] of Object.entries(keys)) {
      if (k === 'custom') blob.custom = v;
      else if (k === 'removed') blob.removed = v;
      else blob.state[k] = v;
    }
    return blob;
  }

  // ---------- boot hydration (app waits on window.__trydonReady) ----------
  window.__trydonReady = (async () => {
    try {
      const res = await api('/api/state');
      state.llm = !!res.llm;
      const serverEpoch = Number(res.epoch || 0);
      const prev = readSync();
      // server was factory-reset since this browser last synced: drop the
      // local copy instead of re-uploading stale data
      if (serverEpoch > (prev.epoch || 0)) {
        localStorage.removeItem(LS_KEY);
      }
      const serverKeys = res.keys || {};
      const local = readBlob();
      if (Object.keys(serverKeys).length) {
        const plain = {};
        for (const [k, r] of Object.entries(serverKeys)) {
          if (!LOCAL_ONLY.has(k)) plain[k] = r.v; // navigation stays this device's
        }
        writeBlob(applyKeysToBlob(local, plain));
      } else if (local && serverEpoch === 0) {
        // genuine first run against a never-reset server: migrate up
        await api('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: blobToKeys(local) }) }).catch(() => {});
      }
      writeSync({ lastPull: res.serverTime || Date.now(), epoch: serverEpoch });
      for (const [k, v] of Object.entries(blobToKeys(readBlob() || { state: {} }))) state.lastPushed[k] = JSON.stringify(v);
    } catch (e) {
      state.online = false; // offline boot: run from localStorage
    }
  })();

  // ---------- push (called from the app's _persist) ----------
  function pushSoon() {
    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(async () => {
      const blob = readBlob();
      if (!blob) return;
      const keys = blobToKeys(blob);
      const changed = {};
      for (const [k, v] of Object.entries(keys)) {
        const j = JSON.stringify(v);
        if (state.lastPushed[k] !== j) { changed[k] = v; state.lastPushed[k] = j; }
      }
      if (!Object.keys(changed).length) return;
      try {
        const r = await api('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: changed }) });
        // merge, never overwrite: dropping the epoch here made every poll
        // after an edit look like a factory reset → constant page reloads
        const s = readSync();
        writeSync({ ...s, lastPull: Math.max(s.lastPull || 0, r.t) });
        state.online = true;
      } catch (e) {
        state.online = false; // keys stay dirty in lastPushed? restore so retry happens
        for (const k of Object.keys(changed)) delete state.lastPushed[k];
      }
    }, PUSH_DEBOUNCE);
  }

  // ---------- pull (other devices + cron messages) ----------
  async function pull() {
    const app = window.__trydon;
    try {
      const s = readSync();
      const res = await api('/api/state?since=' + s.lastPull);
      state.online = true;
      // deck was reset from elsewhere (chat command / another device):
      // drop local state and reboot clean
      const serverEpoch = Number(res.epoch || 0);
      if (serverEpoch > (s.epoch || 0)) {
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(SYNC_KEY);
        location.reload();
        return;
      }
      const entries = Object.entries(res.keys || {}).filter(([k]) => !LOCAL_ONLY.has(k));
      writeSync({ lastPull: res.serverTime || Date.now(), epoch: serverEpoch });
      if (!entries.length) return;
      const plain = {};
      for (const [k, r] of entries) { plain[k] = r.v; state.lastPushed[k] = JSON.stringify(r.v); }
      writeBlob(applyKeysToBlob(readBlob(), plain));
      if (!app) return;
      const upd = {};
      let newAssistantMsg = false;
      for (const [k, v] of Object.entries(plain)) {
        if (k === 'custom') {
          app._custom = v;
          (v || []).forEach(c => { app.stationMeta[c.key] = { label: c.label, color: c.color }; });
        } else if (k === 'removed') {
          app._removed = v;
        } else {
          if (k === 'messages') {
            const cur = app.state.messages || [];
            if (v.length > cur.length && v[v.length - 1] && v[v.length - 1].role === 'assistant') newAssistantMsg = true;
          }
          upd[k] = v;
        }
      }
      if (newAssistantMsg && !app.state.aiOpen) upd.aiUnseen = true;
      app.setState(upd, () => { try { app._drawChart(); } catch (e) {} });
    } catch (e) { state.online = false; }
  }
  setInterval(pull, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });

  // ---------- assistant ----------
  function snapshot() {
    const blob = readBlob() || { state: {}, custom: [], removed: [] };
    const st = { ...blob.state };
    delete st.messages; // history sent separately
    return { state: st, custom: blob.custom, removed: blob.removed };
  }

  async function assistant(text, messages) {
    const r = await fetch('/api/assistant', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, messages: (messages || []).slice(-20), snapshot: snapshot() }),
    });
    if (r.status === 503) { const e = new Error('no key'); e.noKey = true; throw e; }
    if (!r.ok) throw new Error('assistant ' + r.status);
    return r.json();
  }

  async function debate(sym) {
    const r = await fetch('/api/assistant', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'debate', sym, snapshot: snapshot() }),
    });
    if (r.status === 503) { const e = new Error('no key'); e.noKey = true; throw e; }
    if (!r.ok) throw new Error('debate ' + r.status);
    return r.json();
  }

  // window.claude shim (used by the app's aiNews refresh etc.)
  window.claude = window.claude || {
    complete: async ({ messages }) => {
      const r = await fetch('/api/claude', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      if (!r.ok) throw new Error('claude ' + r.status);
      return (await r.json()).text;
    },
  };

  // window.omelette shim → image-slot drops persist server-side
  window.omelette = window.omelette || {
    writeFile: (name, content) => fetch('/api/file/' + encodeURIComponent(name), {
      method: 'PUT', credentials: 'same-origin', body: content,
    }),
  };

  // ---------- PWA ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  // ---------- global search (⌘K / Ctrl+K) ----------
  let overlay = null;
  function buildIndex() {
    const blob = readBlob() || { state: {} };
    const st = blob.state || {};
    const rows = [];
    const push = (label, sub, station) => rows.push({ label, sub, station });
    (st.events || []).forEach(e => push(e.title, e.date + ' ' + (e.start || ''), e.station || 'calendar'));
    (st.tasks || []).forEach(t => push(t.title, 'task' + (t.done ? ' ✓' : ''), t.station || 'calendar'));
    (st.specialDays || []).forEach(sd => push(sd.label, sd.date + ' · ' + sd.type, 'calendar'));
    (st.jobs || []).forEach(j => push(j.name + ' — ' + j.customer, 'job · ' + j.status, 'nucor'));
    (st.salesQs || []).forEach(q => push(q.q, 'mentor question', 'nucor'));
    (st.leaderQs || []).forEach(q => push(q.q, 'leadership question', 'nucor'));
    (st.courses || []).forEach(c => push(c.name, 'course · ' + c.provider, 'ai'));
    (st.aiLog || []).forEach(l => push(l.title, 'AI log · ' + l.date, 'ai'));
    (st.mediaIdeas || []).forEach(i => push(i.text, 'idea', 'media'));
    (st.mediaGoals || []).forEach(g => push(g.title, 'media goal', 'media'));
    Object.entries(st.theses || {}).forEach(([sym, t]) => {
      if (t && (t.bull || t.bear)) push(sym + ' thesis', ((t.bull || '') + ' ' + (t.bear || '')).slice(0, 60), 'stocks');
    });
    Object.values(st.stationTodos || {}).forEach((list) => (list || []).forEach(t => push(t.title, 'to-do', 'calendar')));
    if (st.nucorNotes) push('Handover notes', String(st.nucorNotes).slice(0, 60), 'nucor');
    (st.gym && st.gym.prs || []).forEach(p => push(p.lift + ' ' + p.val, 'PR', 'gym'));
    return rows;
  }

  function openSearch() {
    if (overlay) { closeSearch(); return; }
    const rows = buildIndex();
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,6,10,.72);backdrop-filter:blur(6px);z-index:99990;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(620px,92vw);background:#0d1016;border:1px solid rgba(56,189,248,.25);border-radius:14px;box-shadow:0 30px 80px -20px rgba(0,0,0,.9);overflow:hidden;font-family:Sora,system-ui,sans-serif;';
    const input = document.createElement('input');
    input.placeholder = 'Search events, tasks, jobs, theses, notes…   (esc to close)';
    input.style.cssText = 'width:100%;padding:15px 18px;background:transparent;border:0;outline:0;color:#e8ecf2;font-size:15px;font-family:inherit;border-bottom:1px solid rgba(255,255,255,.07);';
    const list = document.createElement('div');
    list.style.cssText = 'max-height:46vh;overflow:auto;padding:6px;';
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:8px;padding:9px 12px;border-top:1px solid rgba(255,255,255,.06);';
    const mkBtn = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = "padding:5px 10px;border-radius:7px;border:1px dashed rgba(56,189,248,.4);background:rgba(56,189,248,.06);color:#7dd3fc;cursor:pointer;font-size:10px;font-family:'JetBrains Mono',monospace;letter-spacing:.5px;";
      b.onclick = fn;
      return b;
    };
    foot.appendChild(mkBtn('⭳ EXPORT JSON', () => { location.href = '/api/export'; }));
    foot.appendChild(mkBtn('⭱ IMPORT BACKUP', () => {
      const f = document.createElement('input');
      f.type = 'file'; f.accept = 'application/json';
      f.onchange = async () => {
        const txt = await f.files[0].text();
        await api('/api/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: txt });
        localStorage.removeItem(SYNC_KEY);
        location.reload();
      };
      f.click();
    }));
    foot.appendChild(mkBtn('⟲ FRESH START', async () => {
      if (!window.confirm('Wipe ALL deck data and start clean? A backup is kept on the server for 30 days.')) return;
      await api('/api/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'RESET' }) });
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(SYNC_KEY);
      location.reload();
    }));
    const sync = document.createElement('span');
    sync.textContent = state.online ? '● synced' : '○ offline';
    sync.style.cssText = 'margin-left:auto;color:' + (state.online ? '#34d399' : '#f5a524') + ";font-size:10px;font-family:'JetBrains Mono',monospace;align-self:center;";
    foot.appendChild(sync);

    const render = (q) => {
      list.innerHTML = '';
      const ql = q.toLowerCase();
      const hits = q ? rows.filter(r => (r.label + ' ' + r.sub).toLowerCase().includes(ql)) : rows.slice(0, 20);
      hits.slice(0, 30).forEach(r => {
        const it = document.createElement('div');
        it.style.cssText = 'display:flex;justify-content:space-between;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;color:#cbd5e1;font-size:13px;';
        it.onmouseenter = () => it.style.background = 'rgba(56,189,248,.08)';
        it.onmouseleave = () => it.style.background = 'transparent';
        it.onclick = () => { closeSearch(); const app = window.__trydon; if (app && r.station) app.go(r.station); };
        const l = document.createElement('span'); l.textContent = r.label;
        const s2 = document.createElement('span'); s2.textContent = r.sub;
        s2.style.cssText = "color:#56606e;font-size:10.5px;font-family:'JetBrains Mono',monospace;white-space:nowrap;";
        it.appendChild(l); it.appendChild(s2);
        list.appendChild(it);
      });
      if (!hits.length) {
        const e = document.createElement('div');
        e.textContent = 'Nothing found.';
        e.style.cssText = 'padding:14px;color:#56606e;font-size:12px;';
        list.appendChild(e);
      }
    };
    input.oninput = () => render(input.value);
    render('');
    box.appendChild(input); box.appendChild(list); box.appendChild(foot);
    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) closeSearch(); };
    document.body.appendChild(overlay);
    input.focus();
  }
  function closeSearch() { if (overlay) { overlay.remove(); overlay = null; } }

  // ---------- keyboard shortcuts ----------
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    if (e.key === 'Escape') { closeSearch(); return; }
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    const app = window.__trydon;
    if (!app) return;
    const stations = ['calendar', 'nucor', 'fe', 'ai', 'stocks', 'media', 'gym']
      .concat((app._custom || []).map(c => c.key))
      .filter(k => !(app._removed || []).includes(k));
    if (/^[1-9]$/.test(e.key) && stations[+e.key - 1]) { app.go(stations[+e.key - 1]); return; }
    if (e.key === 'n') { app.openAi(); app.setState({ input: 'Schedule ' }); focusChat(); return; }
    if (e.key === 't') { app.askAddTask(); return; }
    if (e.key === '/') { e.preventDefault(); app.openAi(); focusChat(); return; }
  });
  function focusChat() {
    setTimeout(() => { const ta = document.querySelector('aside textarea'); if (ta) ta.focus(); }, 160);
  }

  window.TrydonBridge = { pushSoon, pull, assistant, debate, openSearch, snapshot, isOnline: () => state.online, hasLLM: () => state.llm };
})();
