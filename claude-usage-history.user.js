// ==UserScript==
// @name         Claude Usage History
// @namespace    https://github.com/avanishmishra/claude-usage-history
// @version      1.0.1
// @description  Logs your Claude session and weekly usage % and shows a per-week history with averages.
// @match        https://claude.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @noframes
// @license      MIT
// @homepageURL  https://github.com/avanishmishra/claude-usage-history
// @supportURL   https://github.com/avanishmishra/claude-usage-history/issues
// ==/UserScript==

/*
 * What it does
 *   - Every POLL_MINUTES, while a claude.ai tab is open, reads the same usage
 *     figures the Settings > Usage page shows (read-only, your own session).
 *   - Stores one record per limit window (each 5-hour session, each week).
 *   - Shows a small pill with the current numbers; click it for history,
 *     averages and CSV export.
 *
 * Things to know
 *   - It uses an unofficial endpoint that Anthropic can change at any time.
 *     If that happens the pill shows "usage n/a" and nothing else breaks.
 *   - Data never leaves your browser.
 *   - It only records while a Claude tab is open in this browser. The numbers
 *     are account-wide, so usage from other devices is included in each reading.
 */

(function () {
  'use strict';

  // ----------------------------- settings ---------------------------------
  const POLL_MINUTES = 10;          // how often to read usage
  const HISTORY_ROWS = 8;           // completed windows shown per limit
  const MAX_WINDOWS = 600;          // stored windows per limit
  const STORE_KEY = 'claudeUsageHistory.v1';
  // If your numbers look 100x too small, the API has switched to fractions:
  // set this to 100.
  const SCALE = 1;

  const LABELS = {
    five_hour: 'Session (5 hours)',
    seven_day: 'Week (all models)',
    seven_day_opus: 'Week (Opus)',
    seven_day_sonnet: 'Week (Sonnet)',
  };
  const ORDER = ['seven_day', 'seven_day_opus', 'seven_day_sonnet', 'five_hour'];

  // ----------------------------- pure logic -------------------------------
  function labelFor(key) {
    if (LABELS[key]) return LABELS[key];
    return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }

  // Accepts any response where top-level entries look like
  //   { utilization: <number>, resets_at: <ISO time or null> }
  function extractMetrics(json) {
    const out = [];
    if (!json || typeof json !== 'object') return out;
    for (const key of Object.keys(json)) {
      const v = json[key];
      if (v && typeof v === 'object' && typeof v.utilization === 'number' && isFinite(v.utilization)) {
        out.push({ key: key, pct: v.utilization * SCALE, resetsAt: v.resets_at || null });
      }
    }
    return out;
  }

  // Reset times can jitter by a few seconds between reads; round to the hour
  // so every read in the same window lands in the same record.
  function windowId(resetsAt) {
    const t = Date.parse(resetsAt);
    if (isNaN(t)) return null;
    return new Date(Math.round(t / 3600000) * 3600000).toISOString();
  }

  function record(store, metrics, now) {
    if (!store.metrics) store.metrics = {};
    for (const m of metrics) {
      const id = m.resetsAt ? windowId(m.resetsAt) : null;
      if (!id) continue; // no active window (for example, no session started)
      const bucket = store.metrics[m.key] || (store.metrics[m.key] = {});
      const w = bucket[id] || (bucket[id] = { peak: 0, first: now });
      w.peak = Math.max(w.peak, m.pct);
      w.last = m.pct;
      w.seen = now;
      const ids = Object.keys(bucket).sort();
      while (ids.length > MAX_WINDOWS) delete bucket[ids.shift()];
    }
    store.updated = now;
    return store;
  }

  function summarize(store, key, now) {
    const bucket = (store.metrics && store.metrics[key]) || {};
    const ids = Object.keys(bucket).sort();
    const completed = [];
    let current = null;
    for (const id of ids) {
      const row = { resetsAt: id, peak: bucket[id].peak, seen: bucket[id].seen, first: bucket[id].first };
      if (Date.parse(id) > now) current = row; else completed.push(row);
    }
    const peaks = completed.map((r) => r.peak);
    const avg = peaks.length ? peaks.reduce((a, b) => a + b, 0) / peaks.length : null;
    const max = peaks.length ? Math.max.apply(null, peaks) : null;
    return { key: key, current: current, completed: completed, avg: avg, max: max };
  }

  function sortedKeys(store) {
    const keys = Object.keys(store.metrics || {});
    return keys.sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }

  function toCsv(store, now) {
    const lines = ['limit,label,window_resets_at,used_pct,first_seen,last_seen,window_complete'];
    for (const key of sortedKeys(store)) {
      const bucket = store.metrics[key];
      for (const id of Object.keys(bucket).sort()) {
        const w = bucket[id];
        lines.push([
          key,
          '"' + labelFor(key) + '"',
          id,
          w.peak.toFixed(1),
          new Date(w.first).toISOString(),
          new Date(w.seen).toISOString(),
          Date.parse(id) <= now ? 'yes' : 'no',
        ].join(','));
      }
    }
    return lines.join('\n') + '\n';
  }

  // Exported for testing outside the browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractMetrics, windowId, record, summarize, sortedKeys, toCsv, labelFor };
    return;
  }

  // ----------------------------- storage ----------------------------------
  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function load() {
    try {
      const raw = hasGM ? GM_getValue(STORE_KEY, null) : localStorage.getItem(STORE_KEY);
      const s = raw ? JSON.parse(raw) : null;
      if (s && typeof s === 'object') {
        if (!s.metrics) s.metrics = {};
        return s;
      }
    } catch (e) { /* fall through to a fresh store */ }
    return { metrics: {}, lastPoll: 0 };
  }

  function save(store) {
    try {
      const raw = JSON.stringify(store);
      if (hasGM) GM_setValue(STORE_KEY, raw); else localStorage.setItem(STORE_KEY, raw);
    } catch (e) { /* storage full or blocked: keep running without history */ }
  }

  // ----------------------------- fetching ---------------------------------
  async function getJson(path) {
    const r = await fetch(location.origin + path, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function getOrgId() {
    const m = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    const orgs = await getJson('/api/organizations');
    const first = Array.isArray(orgs) ? orgs[0] : null;
    const id = first && (first.uuid || first.id);
    if (!id) throw new Error('Could not find your organization id');
    return id;
  }

  let polling = false;
  async function poll(force) {
    if (polling) return;
    const now = Date.now();
    const store = load();
    // Another tab read recently: just redraw from shared storage.
    if (!force && now - (store.lastPoll || 0) < POLL_MINUTES * 60000 - 5000) {
      render(store);
      return;
    }
    polling = true;
    store.lastPoll = now;
    save(store);
    try {
      const org = await getOrgId();
      const json = await getJson('/api/organizations/' + encodeURIComponent(org) + '/usage');
      const metrics = extractMetrics(json);
      if (!metrics.length) throw new Error('No usage figures in the response (format may have changed)');
      const fresh = load();
      record(fresh, metrics, now);
      fresh.lastPoll = now;
      fresh.error = null;
      fresh.live = {};
      for (const m of metrics) fresh.live[m.key] = { pct: m.pct, resetsAt: m.resetsAt };
      save(fresh);
      render(fresh);
    } catch (e) {
      const s = load();
      s.error = String((e && e.message) || e);
      save(s);
      render(s);
    } finally {
      polling = false;
    }
  }

  // ----------------------------- interface --------------------------------
  // Styles are set through the style object so the page's content security
  // policy does not block them.
  function el(tag, css, text) {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  const FONT = 'font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;';
  const root = el('div', 'position:fixed;right:12px;bottom:12px;z-index:2147483000;' + FONT);
  const pill = el('button',
    'all:unset;cursor:pointer;background:#1f1e1d;color:#f5f4ef;border:1px solid #4a4845;' +
    'border-radius:999px;padding:4px 10px;box-shadow:0 2px 8px rgba(0,0,0,.25);' + FONT);
  const panel = el('div',
    'display:none;position:absolute;right:0;bottom:34px;width:340px;max-height:70vh;overflow:auto;' +
    'background:#1f1e1d;color:#f5f4ef;border:1px solid #4a4845;border-radius:12px;padding:12px;' +
    'box-shadow:0 8px 28px rgba(0,0,0,.35);');
  pill.title = 'Claude usage history';
  pill.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  root.appendChild(panel);
  root.appendChild(pill);

  function fmtPct(p) { return (p == null ? '–' : Math.round(p)) + '%'; }
  function fmtWhen(iso) {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
  }
  function colorFor(p) { return p >= 90 ? '#e5484d' : p >= 70 ? '#f5a524' : '#46a758'; }

  function bar(p) {
    const track = el('div', 'flex:1;height:6px;background:#3a3836;border-radius:3px;overflow:hidden;');
    track.appendChild(el('div',
      'height:100%;border-radius:3px;width:' + Math.max(0, Math.min(100, p)) + '%;background:' + colorFor(p) + ';'));
    return track;
  }

  function line(left, p, right) {
    const row = el('div', 'display:flex;align-items:center;gap:8px;margin:3px 0;');
    row.appendChild(el('span', 'width:92px;color:#b8b5ad;white-space:nowrap;', left));
    row.appendChild(bar(p));
    row.appendChild(el('span', 'width:38px;text-align:right;font-variant-numeric:tabular-nums;', right));
    return row;
  }

  function button(text, onClick) {
    const b = el('button',
      'all:unset;cursor:pointer;border:1px solid #4a4845;border-radius:6px;padding:3px 8px;color:#f5f4ef;' + FONT, text);
    b.addEventListener('click', onClick);
    return b;
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = el('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function render(store) {
    const now = Date.now();
    const keys = sortedKeys(store);
    const live = store.live || {};

    // Pill: weekly and session at a glance.
    const parts = [];
    const wk = live.seven_day && Date.parse(live.seven_day.resetsAt || 0) > now ? live.seven_day : null;
    const ses = live.five_hour && Date.parse(live.five_hour.resetsAt || 0) > now ? live.five_hour : null;
    if (wk) parts.push('Week ' + fmtPct(wk.pct));
    if (live.five_hour) parts.push('5h ' + fmtPct(ses ? ses.pct : 0));
    pill.textContent = parts.length ? parts.join(' · ') : (store.error ? 'usage n/a' : 'usage …');

    // Panel.
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    panel.appendChild(el('div', 'font-weight:600;font-size:13px;margin-bottom:6px;', 'Claude usage history'));

    if (store.error) {
      panel.appendChild(el('div', 'color:#f5a524;margin-bottom:8px;', 'Last read failed: ' + store.error));
    }
    if (!keys.length) {
      panel.appendChild(el('div', 'color:#b8b5ad;', 'No readings yet. History builds up as you use Claude.'));
    }

    for (const key of keys) {
      const s = summarize(store, key, now);
      const box = el('div', 'border-top:1px solid #3a3836;padding-top:8px;margin-top:8px;');
      box.appendChild(el('div', 'font-weight:600;', labelFor(key)));

      if (s.current) {
        box.appendChild(line('Now', s.current.peak, fmtPct(s.current.peak)));
        box.appendChild(el('div', 'color:#b8b5ad;margin-bottom:4px;', 'Resets ' + fmtWhen(s.current.resetsAt)));
      } else {
        box.appendChild(el('div', 'color:#b8b5ad;margin-bottom:4px;', 'No active window'));
      }

      if (s.completed.length) {
        box.appendChild(el('div', 'margin:4px 0;',
          'Average ' + fmtPct(s.avg) + ' · highest ' + fmtPct(s.max) +
          ' · over ' + s.completed.length + ' completed'));
        for (const r of s.completed.slice(-HISTORY_ROWS).reverse()) {
          box.appendChild(line('to ' + fmtWhen(r.resetsAt), r.peak, fmtPct(r.peak)));
        }
      } else {
        box.appendChild(el('div', 'color:#b8b5ad;', 'No completed windows yet'));
      }
      panel.appendChild(box);
    }

    const foot = el('div', 'display:flex;gap:6px;align-items:center;margin-top:10px;flex-wrap:wrap;');
    foot.appendChild(button('Refresh', () => poll(true)));
    foot.appendChild(button('Export CSV', () => download('claude-usage-history.csv', toCsv(load(), Date.now()))));
    foot.appendChild(button('Clear', () => {
      if (confirm('Delete all stored usage history?')) { save({ metrics: {}, lastPoll: 0 }); poll(true); }
    }));
    if (store.updated) {
      foot.appendChild(el('span', 'color:#b8b5ad;margin-left:auto;',
        'Read ' + new Date(store.updated).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })));
    }
    panel.appendChild(foot);
  }

  // ----------------------------- start ------------------------------------
  // The page rebuilds its own content after loading and can drop elements
  // added inside <body>, so the pill lives beside <body> and is put back if
  // it ever goes missing.
  function attach() {
    const host = document.documentElement || document.body;
    if (host && !root.isConnected) host.appendChild(root);
  }

  function mount() {
    console.info('[Claude Usage History] running');
    attach();
    setInterval(attach, 2000);
    render(load());
    poll(false);
    setInterval(() => poll(false), POLL_MINUTES * 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') poll(false);
    });
  }
  mount();
})();
