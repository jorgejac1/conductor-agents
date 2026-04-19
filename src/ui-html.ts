/**
 * conductor dashboard v0.7 — 4-tab layout (Tracks, Workers, History, Settings).
 * Single-file HTML/CSS/JS, no build step.
 *
 * Tab 1 — TRACKS: Kanban board, one column per track, cards per worker with eval badges.
 * Tab 2 — WORKERS: Enhanced sidebar+content view (existing layout, extended).
 * Tab 3 — HISTORY: Run history table with CSV export.
 * Tab 4 — SETTINGS: Config viewer + version info.
 *
 * Keyboard shortcuts: 1-4 switch tabs.
 */

export function htmlDashboard(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>conductor</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #7d8590;
    --accent: #58a6ff;
    --green: #3fb950;
    --yellow: #d29922;
    --red: #f85149;
    --orange: #db6d28;
    --purple: #bc8cff;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    position: relative;
    z-index: 10;
  }

  header h1 { font-size: 15px; font-weight: 600; }
  header .subtitle { color: var(--muted); font-size: 12px; }

  /* ── Tab bar ─────────────────────────────────────────────────────────── */
  .tab-bar {
    display: flex;
    gap: 2px;
    background: #1a1a2e;
    border-bottom: 1px solid #2d2d4a;
    padding: 0 16px;
    flex-shrink: 0;
  }

  .tab {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    letter-spacing: 0.08em;
    padding: 10px 16px;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }
  .tab:hover { color: #ccc; }
  .tab.active { color: #e0e0ff; border-bottom-color: #6c63ff; }

  .tab-key {
    display: inline-block;
    background: #2d2d4a;
    border-radius: 3px;
    font-size: 10px;
    padding: 1px 4px;
    margin-right: 5px;
    color: #777;
  }
  .tab.active .tab-key { color: #9999cc; }

  .tab-content { display: none; flex: 1; overflow: hidden; }
  .tab-content.active { display: flex; flex-direction: column; overflow: auto; }

  /* ── Kanban (Tab 1) ──────────────────────────────────────────────────── */
  .kanban-board {
    display: flex;
    gap: 16px;
    padding: 20px;
    overflow-x: auto;
    align-items: flex-start;
    min-height: 0;
    flex: 1;
  }

  .kanban-column {
    background: #16162a;
    border: 1px solid #2d2d4a;
    border-radius: 8px;
    min-width: 280px;
    max-width: 320px;
    display: flex;
    flex-direction: column;
  }

  .kanban-col-header {
    padding: 12px 14px 10px;
    border-bottom: 1px solid #2d2d4a;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .kanban-col-title { font-weight: 600; font-size: 13px; flex: 1; }
  .kanban-col-progress { font-size: 11px; color: #666; }

  .kanban-cards { padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; }

  .kanban-card {
    background: #1e1e38;
    border: 1px solid #2d2d4a;
    border-radius: 6px;
    padding: 10px 12px;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .kanban-card:hover { border-color: #4a4a7a; }
  .kanban-card.expanded { border-color: #6c63ff; }

  .kanban-card-title { font-size: 13px; margin-bottom: 5px; }
  .kanban-card-badges { display: flex; gap: 5px; margin-top: 7px; flex-wrap: wrap; }

  .eval-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.04em;
  }
  .eval-badge.pass { background: #1a3d2a; color: #4ade80; }
  .eval-badge.fail { background: #3d1a1a; color: #f87171; }
  .eval-badge.pending { background: #2d2d1a; color: #facc15; }

  .kanban-card-log { margin-top: 10px; display: none; }
  .kanban-card.expanded .kanban-card-log { display: block; }

  .kanban-col-footer {
    padding: 8px 14px;
    border-top: 1px solid #2d2d4a;
    font-size: 11px;
    color: #555;
  }

  /* ── Workers (Tab 2) ─────────────────────────────────────────────────── */
  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sidebar {
    width: 260px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    overflow-y: auto;
    padding: 8px 0;
  }

  .sidebar-title {
    padding: 6px 14px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  .track-item {
    padding: 8px 14px;
    cursor: pointer;
    border-left: 3px solid transparent;
    transition: background 0.1s;
  }
  .track-item:hover { background: var(--surface); }
  .track-item.active {
    border-left-color: var(--accent);
    background: var(--surface);
  }

  .track-name { font-weight: 600; margin-bottom: 3px; }
  .track-desc { color: var(--muted); font-size: 11px; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .progress-bar {
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 3px;
  }
  .progress-fill {
    height: 100%;
    background: var(--green);
    border-radius: 2px;
    transition: width 0.3s;
  }
  .progress-label { font-size: 11px; color: var(--muted); }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted);
    gap: 8px;
  }
  .empty-state .big { font-size: 32px; }

  .track-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }
  .track-header h2 { font-size: 16px; }

  .btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    transition: background 0.1s, border-color 0.1s;
  }
  .btn:hover { background: var(--border); }
  .btn.primary { border-color: var(--accent); color: var(--accent); }
  .btn.primary:hover { background: rgba(88,166,255,0.1); }
  .btn.btn-sm { padding: 2px 8px; font-size: 11px; }
  .btn.btn-secondary { color: var(--muted); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .workers-grid { display: flex; flex-direction: column; gap: 8px; }

  .worker-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
  }
  .worker-card.failed { border-left: 3px solid var(--red); }
  .worker-card.done { border-left: 3px solid var(--green); }
  .worker-card.running { border-left: 3px solid var(--yellow); }
  .worker-card.verifying { border-left: 3px solid var(--purple); }
  .worker-card.merging { border-left: 3px solid var(--accent); }

  .worker-eval-result { font-size: 11px; margin-top: 4px; }
  .worker-elapsed { font-size: 11px; color: #666; margin-top: 2px; }

  .worker-wrap { display: flex; flex-direction: column; }

  .log-panel {
    background: #0a0e13;
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 8px 8px;
    padding: 10px 12px;
    margin-top: -8px;
    margin-bottom: 8px;
  }

  .log-content {
    font-size: 11px;
    color: var(--muted);
    max-height: 280px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.5;
  }

  .badge {
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }
  .badge.pending { background: rgba(125,133,144,0.2); color: var(--muted); }
  .badge.spawning { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .badge.running { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .badge.verifying { background: rgba(188,140,255,0.2); color: var(--purple); }
  .badge.merging { background: rgba(88,166,255,0.2); color: var(--accent); }
  .badge.done { background: rgba(63,185,80,0.2); color: var(--green); }
  .badge.failed { background: rgba(248,81,73,0.2); color: var(--red); }
  .badge.badge-done { background: rgba(63,185,80,0.2); color: var(--green); }
  .badge.badge-failed { background: rgba(248,81,73,0.2); color: var(--red); }

  .worker-info { flex: 1; min-width: 0; }
  .worker-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .worker-meta { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .worker-actions { display: flex; gap: 6px; flex-shrink: 0; }

  /* ── History (Tab 3) ─────────────────────────────────────────────────── */
  .history-panel { padding: 20px; flex: 1; overflow: auto; }

  .history-controls {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 16px;
  }

  .history-select {
    background: #1e1e38;
    border: 1px solid #2d2d4a;
    color: #ccc;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
  }

  .history-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .history-table th {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid #2d2d4a;
    color: #666;
    font-weight: 600;
    letter-spacing: 0.05em;
    font-size: 11px;
  }
  .history-table td { padding: 8px 10px; border-bottom: 1px solid #1a1a2e; }
  .history-table tr:hover td { background: #1a1a30; }

  /* ── Settings (Tab 4) ────────────────────────────────────────────────── */
  .settings-panel { padding: 20px; flex: 1; overflow: auto; max-width: 700px; }

  .settings-section { margin-bottom: 28px; }
  .settings-section h3 {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: #888;
    margin-bottom: 12px;
    text-transform: uppercase;
  }

  .settings-pre {
    background: #0f0f1e;
    border: 1px solid #2d2d4a;
    border-radius: 6px;
    padding: 14px;
    font-family: monospace;
    font-size: 12px;
    color: #aaa;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .version-row { display: flex; gap: 12px; flex-wrap: wrap; }
  .version-pill {
    background: #1e1e38;
    border: 1px solid #2d2d4a;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
  }

  /* ── Shared ──────────────────────────────────────────────────────────── */
  .status-bar {
    border-top: 1px solid var(--border);
    padding: 6px 16px;
    display: flex;
    gap: 16px;
    color: var(--muted);
    font-size: 12px;
    flex-shrink: 0;
    align-items: center;
  }
  .status-bar span b { color: var(--text); }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
    margin-right: 4px;
  }
  .dot.connected { background: var(--green); }

  .tg-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    border: 1px solid var(--border);
    color: var(--muted);
    background: transparent;
  }
  .tg-pill.configured { color: var(--accent); border-color: var(--accent); }

  .spinner {
    display: inline-block;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error-bar {
    display: none;
    position: fixed;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(248,81,73,0.15);
    border: 1px solid var(--red);
    color: var(--red);
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 12px;
    max-width: 600px;
    text-align: center;
    z-index: 100;
  }
  #toast {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%) translateY(8px);
    background: rgba(35,134,54,0.15);
    border: 1px solid var(--green);
    color: var(--green);
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 12px;
    max-width: 500px;
    text-align: center;
    z-index: 100;
    opacity: 0;
    transition: opacity 0.2s, transform 0.2s;
    pointer-events: none;
  }
</style>
</head>
<body>
<header>
  <h1>conductor</h1>
  <span class="subtitle">multi-agent orchestrator</span>
  <span style="flex:1"></span>
  <span class="tg-pill" id="tg-pill">📱 telegram</span>
  <span id="conn-status"><span class="dot" id="conn-dot"></span><span id="conn-text">connecting</span></span>
</header>

<div class="tab-bar">
  <button class="tab active" data-tab="tracks" onclick="switchTab('tracks')">
    <span class="tab-key">1</span> TRACKS
  </button>
  <button class="tab" data-tab="workers" onclick="switchTab('workers')">
    <span class="tab-key">2</span> WORKERS
  </button>
  <button class="tab" data-tab="history" onclick="switchTab('history')">
    <span class="tab-key">3</span> HISTORY
  </button>
  <button class="tab" data-tab="settings" onclick="switchTab('settings')">
    <span class="tab-key">4</span> SETTINGS
  </button>
</div>

<!-- Tab 1: Tracks (Kanban) -->
<div class="tab-content active" id="tab-tracks">
  <div class="kanban-board" id="kanban-board"></div>
</div>

<!-- Tab 2: Workers (sidebar + detail) -->
<div class="tab-content" id="tab-workers">
  <div class="main" style="flex:1;overflow:hidden;">
    <aside class="sidebar">
      <div class="sidebar-title">TRACKS</div>
      <div id="workers-sidebar"></div>
    </aside>
    <main class="content" id="workers-content">
      <div class="empty-state">
        <div class="big">🎼</div>
        <div>Select a track to see workers</div>
      </div>
    </main>
  </div>
</div>

<!-- Tab 3: History -->
<div class="tab-content" id="tab-history">
  <div class="history-panel">
    <div class="history-controls">
      <select class="history-select" id="history-track-filter" onchange="loadHistory()">
        <option value="">All tracks</option>
      </select>
      <button class="btn" onclick="exportHistoryCsv()">Export CSV</button>
    </div>
    <table class="history-table" id="history-table">
      <thead><tr>
        <th>Date</th><th>Track</th><th>Contract</th><th>Trigger</th><th>Duration</th><th>Result</th>
      </tr></thead>
      <tbody id="history-body"></tbody>
    </table>
  </div>
</div>

<!-- Tab 4: Settings -->
<div class="tab-content" id="tab-settings">
  <div class="settings-panel" id="settings-panel">
    <p style="color:#666">Loading settings...</p>
  </div>
</div>

<div class="error-bar" id="error-bar"></div>
<div id="toast"></div>

<div class="status-bar">
  <span>Workers: <b id="stat-total">0</b></span>
  <span style="color:var(--green)">Done: <b id="stat-done">0</b></span>
  <span style="color:var(--yellow)">Running: <b id="stat-running">0</b></span>
  <span style="color:var(--red)">Failed: <b id="stat-failed">0</b></span>
  <span>Cost: <b id="stat-cost">$0.00</b></span>
  <span style="flex:1"></span>
  <span id="last-update" style="color:var(--muted)"></span>
</div>

<script>
(function() {
  let tracks = [];
  let selectedId = null;
  const swarmStates = {};
  const logPollers = {};

  // New v0.7 state
  var Q = "'"; // single-quote character — used when building onclick attr strings to avoid escape sequences
  let evalResults = {};   // { workerId: { passed, contractId, output } }
  let historyCache = [];  // RunRecord[] (all tracks merged, sorted by date)
  let settingsLoaded = false;
  const runningTracks = new Set(); // track IDs with an active swarm

  // ── Utils ─────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  // Keep legacy alias used by existing inline template literals
  function esc(s) { return escHtml(s); }

  function activeTab() {
    const el = document.querySelector('.tab.active');
    return el ? el.dataset.tab : 'tracks';
  }

  // ── Tab switching ─────────────────────────────────────────────────────
  window.switchTab = function(tab) {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
    const tabBtn = document.querySelector('[data-tab="' + tab + '"]');
    const tabContent = document.getElementById('tab-' + tab);
    if (tabBtn) tabBtn.classList.add('active');
    if (tabContent) tabContent.classList.add('active');
    if (tab === 'history') loadHistory();
    if (tab === 'settings' && !settingsLoaded) loadSettings();
    if (tab === 'workers') renderWorkers();
  };

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const map = { '1': 'tracks', '2': 'workers', '3': 'history', '4': 'settings' };
    if (map[e.key]) switchTab(map[e.key]);
  });

  // ── SSE ───────────────────────────────────────────────────────────────
  function connect() {
    const es = new EventSource('/api/events');
    const dot = document.getElementById('conn-dot');
    const txt = document.getElementById('conn-text');

    es.onopen = function() {
      dot.className = 'dot connected';
      txt.textContent = 'live';
    };
    es.onerror = function() {
      dot.className = 'dot';
      txt.textContent = 'reconnecting…';
    };
    es.onmessage = function(e) {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === 'tracks') {
          tracks = msg.tracks;
          const terminal = ['done', 'failed'];
          for (const ts of tracks) {
            if (ts.swarmState) {
              swarmStates[ts.track.id] = ts.swarmState;
              // Seed runningTracks from live swarm state so a page refresh
              // correctly reflects in-progress runs without clicking Run again.
              const ws = ts.swarmState.workers || [];
              if (ws.length > 0 && ws.some(function(w) { return !terminal.includes(w.status); })) {
                runningTracks.add(ts.track.id);
              } else {
                runningTracks.delete(ts.track.id);
              }
            }
          }
          renderKanban();
          renderWorkers();
          updateStats();
        } else if (msg.type === 'swarm') {
          const state = msg.state;
          if (state && state.todoPath) {
            const parts = state.todoPath.split('/');
            const tracksIdx = parts.lastIndexOf('tracks');
            if (tracksIdx !== -1 && parts[tracksIdx + 1]) {
              const trackId = parts[tracksIdx + 1];
              swarmStates[trackId] = state;
              // Clear running state when all workers reach a terminal status
              const terminal = ['done', 'failed'];
              if (state.workers && state.workers.length > 0 &&
                  state.workers.every(function(w) { return terminal.includes(w.status); })) {
                runningTracks.delete(trackId);
              }
            }
          }
          const cur = activeTab();
          if (cur === 'tracks') renderKanban();
          if (cur === 'workers') renderWorkerCards(selectedId);
          updateStats();
          document.getElementById('last-update').textContent =
            'updated ' + new Date().toLocaleTimeString();
        } else if (msg.type === 'eval-result') {
          evalResults[msg.workerId] = {
            passed: msg.passed,
            contractId: msg.contractId,
            output: msg.output
          };
          const cur = activeTab();
          if (cur === 'tracks') renderKanban();
          if (cur === 'workers') renderWorkerCards(selectedId);
        } else if (msg.type === 'cost') {
          // Accumulate into the matching track's cost so stat bar updates immediately,
          // before the next full tracks broadcast arrives.
          if (msg.estimatedUsd) {
            const ts = tracks.find(function(t) {
              return t.swarmState && t.swarmState.workers &&
                t.swarmState.workers.some(function(w) { return w.id === msg.workerId; });
            });
            if (ts) {
              if (!ts.cost) ts.cost = { totalTokens: 0, estimatedUsd: 0 };
              ts.cost.totalTokens += (msg.tokens && msg.tokens.input || 0) + (msg.tokens && msg.tokens.output || 0);
              ts.cost.estimatedUsd += msg.estimatedUsd;
            }
          }
          updateStats();
          document.getElementById('last-update').textContent =
            'updated ' + new Date().toLocaleTimeString();
        }
      } catch { /* ignore malformed SSE frames */ }
    };
  }

  // ── Tab 1: Kanban ─────────────────────────────────────────────────────
  function renderKanban() {
    const board = document.getElementById('kanban-board');
    if (!board) return;
    if (!tracks.length) {
      board.innerHTML = '<p style="color:#555;padding:20px">No tracks. Run <code>conductor add</code> to create one.</p>';
      return;
    }
    board.innerHTML = tracks.map(function(ts) {
      const state = swarmStates[ts.track.id];
      const workers = state ? state.workers : [];
      const done = ts.todoDone;
      const total = ts.todoTotal;

      const costLine = ts.cost
        ? '<div class="kanban-col-footer">' + Math.round(ts.cost.totalTokens / 1000) + 'k tok (~$' + ts.cost.estimatedUsd.toFixed(2) + ')</div>'
        : '';

      const cards = workers.map(function(w) {
        const evalRes = evalResults[w.id];
        const evalFailed = evalRes && !evalRes.passed && w.status === 'failed';
        const evalPassed = evalRes && evalRes.passed && w.status === 'done';
        const showStatusPill = !evalFailed && !evalPassed;
        const pill = evalPassed
          ? '<span class="eval-badge pass">PASS</span>'
          : evalFailed
            ? '<span class="eval-badge fail">FAIL</span>'
            : '<span class="badge ' + escHtml(w.status) + '">' + escHtml(w.status) + '</span>';
        return '<div class="kanban-card" id="kcard-' + escHtml(w.id) + '" onclick="toggleKanbanLog(' + Q + escHtml(ts.track.id) + Q + ',' + Q + escHtml(w.id) + Q + ')">' +
          '<div class="kanban-card-title">' + escHtml(w.contractTitle || w.contractId) + '</div>' +
          '<div class="kanban-card-badges">' + pill + '</div>' +
          '<div class="kanban-card-log" id="klog-' + escHtml(w.id) + '"></div>' +
          '</div>';
      });

      const isRunning = runningTracks.has(ts.track.id);
      const runBtn = '<button class="btn btn-sm" data-run-id="' + escHtml(ts.track.id) + '" onclick="event.stopPropagation();runTrack(' + Q + escHtml(ts.track.id) + Q + ')"' + (isRunning ? ' disabled' : '') + '>' + (isRunning ? '⏳ Running…' : '▶ Run') + '</button>';

      return '<div class="kanban-column">' +
        '<div class="kanban-col-header">' +
          '<span class="kanban-col-title">' + escHtml(ts.track.name) + '</span>' +
          '<span class="kanban-col-progress">' + done + '/' + total + '</span>' +
          runBtn +
        '</div>' +
        '<div class="kanban-cards">' + (cards.length ? cards.join('') : '<p style="color:#444;font-size:12px;padding:4px 0">No workers yet</p>') + '</div>' +
        costLine +
        '</div>';
    }).join('');
  }

  window.toggleKanbanLog = function(trackId, workerId) {
    const card = document.getElementById('kcard-' + workerId);
    const logDiv = document.getElementById('klog-' + workerId);
    if (!card || !logDiv) return;
    const expanded = card.classList.toggle('expanded');
    if (expanded && !logDiv.dataset.loaded) {
      logDiv.dataset.loaded = '1';
      logDiv.innerHTML = '<div class="log-content" style="max-height:200px;overflow:auto;font-size:11px">Loading...</div>';
      fetch('/api/tracks/' + trackId + '/logs/' + workerId)
        .then(function(r) { return r.text(); })
        .then(function(t) {
          const box = logDiv.querySelector('.log-content');
          if (box) box.textContent = t || '(no output)';
        })
        .catch(function() {
          const box = logDiv.querySelector('.log-content');
          if (box) box.textContent = '(error loading log)';
        });
    }
  };

  // ── Tab 2: Workers ────────────────────────────────────────────────────
  function renderWorkers() {
    const sidebar = document.getElementById('workers-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = tracks.map(function(ts) {
      const isActive = ts.track.id === selectedId;
      const pct = ts.todoTotal > 0 ? Math.round(ts.todoDone / ts.todoTotal * 100) : 0;
      return '<div class="track-item' + (isActive ? ' active' : '') + '" onclick="selectWorkerTrack(' + Q + escHtml(ts.track.id) + Q + ')">' +
        '<div class="track-name">' + escHtml(ts.track.name) + '</div>' +
        '<div class="track-desc">' + escHtml(ts.track.description) + '</div>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="progress-label">' + ts.todoDone + '/' + ts.todoTotal + ' tasks done</div>' +
        '</div>';
    }).join('');

    if (selectedId) renderWorkerCards(selectedId);
  }

  window.selectWorkerTrack = function(id) {
    selectedId = id;
    renderWorkers();
  };

  // Keep backward compat — selectTrack used by runTrack inline html
  window.selectTrack = function(id) {
    selectedId = id;
    renderWorkers();
  };

  function renderWorkerCards(trackId) {
    const content = document.getElementById('workers-content');
    if (!content) return;
    const ts = tracks.find(function(t) { return t.track.id === trackId; });
    if (!ts) {
      content.innerHTML = '<div class="empty-state"><div class="big">🎼</div><div>Select a track to see workers</div></div>';
      return;
    }
    const state = swarmStates[trackId];
    const workers = state ? state.workers : [];

    const isRunning = runningTracks.has(trackId);
    const runBtnAttrs = isRunning ? ' disabled' : '';
    const runBtnLabel = isRunning ? '⏳ Running…' : '▶ Run';

    if (!workers.length) {
      content.innerHTML =
        '<div class="track-header"><h2>' + escHtml(ts.track.name) + '</h2>' +
        '<button class="btn primary" data-run-id="' + escHtml(trackId) + '" onclick="runTrack(' + Q + escHtml(trackId) + Q + ')"' + runBtnAttrs + '>' + runBtnLabel + '</button></div>' +
        '<div class="empty-state" style="height:auto;margin-top:40px">' +
        '<div>No workers yet</div>' +
        '<div style="font-size:12px;color:var(--muted)">Add tasks to todo.md and click Run</div></div>';
      return;
    }

    const cards = workers.map(function(w) {
      const evalRes = evalResults[w.id];
      // Pill logic — always show exactly one pill:
      //   done              → PASS (green eval badge, no status pill)
      //   failed + eval failed → FAIL (red eval badge replaces status pill)
      //   failed + no eval  → FAILED (status pill only — agent/spawn failed)
      //   failed + eval passed → FAILED (status pill only — merge/other failure)
      //   running/pending/… → status pill only
      const evalFailed = evalRes && !evalRes.passed && w.status === 'failed';
      const evalPassed = evalRes && evalRes.passed && w.status === 'done';
      const showStatusPill = !evalFailed && !evalPassed;
      const evalBadge = evalPassed
        ? '<span class="eval-badge pass">PASS</span>'
        : evalFailed
          ? '<span class="eval-badge fail">FAIL</span>'
          : '';
      const statusPill = showStatusPill
        ? '<span class="badge ' + escHtml(w.status) + '">' + escHtml(w.status) + '</span>'
        : '';
      const isActive = w.startedAt && ['spawning','running','verifying','merging'].includes(w.status);
      const elapsed = isActive
        ? '<div class="worker-elapsed">' + Math.round((Date.now() - new Date(w.startedAt).getTime()) / 1000) + 's elapsed</div>'
        : '';
      const spinner = isActive ? '<span class="spinner">⟳</span> ' : '';
      const retryBtn = w.status === 'failed'
        ? '<button class="btn btn-sm" onclick="retryWorker(' + Q + escHtml(trackId) + Q + ',' + Q + escHtml(w.id) + Q + ')">↺ Retry</button>'
        : '';
      const logsBtn = '<button class="btn btn-sm btn-secondary" onclick="toggleLogs(' + Q + escHtml(trackId) + Q + ',' + Q + escHtml(w.id) + Q + ')">≡ Logs</button>';

      return '<div class="worker-wrap">' +
        '<div class="worker-card ' + escHtml(w.status) + '">' +
          '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">' +
            statusPill +
            evalBadge +
            '<div class="worker-info">' +
              '<div class="worker-title">' + spinner + escHtml(w.contractTitle || w.id) + '</div>' +
              '<div class="worker-meta">id: ' + escHtml(w.id.slice(0, 8)) + '…</div>' +
            '</div>' +
          '</div>' +
          elapsed +
          '<div style="margin-top:8px;display:flex;gap:6px">' + retryBtn + logsBtn + '</div>' +
        '</div>' +
        '<div id="log-' + escHtml(w.id) + '" style="display:none" class="log-panel">' +
          '<pre class="log-content" id="logcontent-' + escHtml(w.id) + '">Loading…</pre>' +
        '</div>' +
        '</div>';
    }).join('');

    content.innerHTML =
      '<div class="track-header">' +
        '<h2>' + escHtml(ts.track.name) + '</h2>' +
        '<button class="btn primary" data-run-id="' + escHtml(trackId) + '" onclick="runTrack(' + Q + escHtml(trackId) + Q + ')"' + runBtnAttrs + '>' + runBtnLabel + '</button>' +
      '</div>' +
      '<div class="workers-grid">' + cards + '</div>';
  }

  // ── Log panel ─────────────────────────────────────────────────────────
  window.toggleLogs = function(trackId, workerId) {
    const panel = document.getElementById('log-' + workerId);
    if (!panel) return;
    if (panel.style.display !== 'none') {
      panel.style.display = 'none';
      if (logPollers[workerId]) { clearTimeout(logPollers[workerId]); delete logPollers[workerId]; }
      return;
    }
    panel.style.display = 'block';
    fetchLog(trackId, workerId);
  };

  function fetchLog(trackId, workerId) {
    const el = document.getElementById('logcontent-' + workerId);
    if (!el) return;
    fetch('/api/tracks/' + trackId + '/logs/' + workerId)
      .then(function(r) { return r.text(); })
      .then(function(text) {
        el.textContent = text || '(no output yet)';
        el.scrollTop = el.scrollHeight;
      })
      .catch(function() { el.textContent = '(failed to load log)'; });

    const state = swarmStates[trackId];
    const worker = state && state.workers && state.workers.find(function(w) { return w.id === workerId; });
    const isActive = worker && ['spawning','running','verifying','merging'].includes(worker.status);
    if (isActive) {
      logPollers[workerId] = setTimeout(function() {
        const p = document.getElementById('log-' + workerId);
        if (p && p.style.display !== 'none') fetchLog(trackId, workerId);
      }, 2000);
    }
  }

  // ── Tab 3: History ────────────────────────────────────────────────────
  window.loadHistory = function() {
    const filterEl = document.getElementById('history-track-filter');
    const filter = filterEl ? filterEl.value : '';

    // Populate filter options once
    if (filterEl && filterEl.options.length <= 1) {
      tracks.forEach(function(t) {
        const opt = document.createElement('option');
        opt.value = t.track.id;
        opt.textContent = t.track.name;
        filterEl.appendChild(opt);
      });
    }

    const tracksToFetch = filter ? [filter] : tracks.map(function(t) { return t.track.id; });
    const body = document.getElementById('history-body');
    if (!body) return;

    if (!tracksToFetch.length) {
      body.innerHTML = '<tr><td colspan="6" style="color:#555;padding:10px">No tracks yet.</td></tr>';
      return;
    }

    body.innerHTML = '<tr><td colspan="6" style="color:#555;padding:10px">Loading...</td></tr>';

    Promise.all(tracksToFetch.map(function(id) {
      return fetch('/api/tracks/' + id + '/history')
        .then(function(r) { return r.json(); })
        .then(function(runs) { return { id: id, runs: runs }; })
        .catch(function() { return { id: id, runs: [] }; });
    })).then(function(results) {
      const allRows = [];
      results.forEach(function(result) {
        const trackName = (tracks.find(function(t) { return t.track.id === result.id; }) || {}).track
          ? tracks.find(function(t) { return t.track.id === result.id; }).track.name
          : result.id;
        result.runs.forEach(function(r) {
          allRows.push(Object.assign({ trackName: trackName }, r));
        });
      });
      allRows.sort(function(a, b) { return new Date(b.ts).getTime() - new Date(a.ts).getTime(); });
      historyCache = allRows;

      if (!allRows.length) {
        body.innerHTML = '<tr><td colspan="6" style="color:#555;padding:10px">No history yet.</td></tr>';
        return;
      }

      body.innerHTML = allRows.map(function(r) {
        const date = new Date(r.ts).toLocaleString();
        const dur = r.durationMs ? (r.durationMs / 1000).toFixed(1) + 's' : '—';
        const result = r.passed
          ? '<span class="eval-badge pass">PASS</span>'
          : '<span class="eval-badge fail">FAIL</span>';
        return '<tr>' +
          '<td>' + escHtml(date) + '</td>' +
          '<td>' + escHtml(r.trackName) + '</td>' +
          '<td>' + escHtml(r.contractTitle || r.contractId) + '</td>' +
          '<td>' + escHtml(r.trigger || '—') + '</td>' +
          '<td>' + escHtml(dur) + '</td>' +
          '<td>' + result + '</td>' +
          '</tr>';
      }).join('');
    });
  };

  window.exportHistoryCsv = function() {
    if (!historyCache || !historyCache.length) return;
    const header = 'Date,Track,Contract,Trigger,Duration (ms),Passed\\n';
    const rows = historyCache.map(function(r) {
      return [
        new Date(r.ts).toISOString(),
        r.trackName,
        r.contractTitle || r.contractId,
        r.trigger || '',
        r.durationMs || 0,
        r.passed
      ].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'conductor-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Tab 4: Settings ───────────────────────────────────────────────────
  window.loadSettings = function() {
    settingsLoaded = true;
    const panel = document.getElementById('settings-panel');
    if (!panel) return;

    Promise.all([
      fetch('/api/config').then(function(r) { return r.json(); }).catch(function() { return null; }),
      fetch('/api/version').then(function(r) { return r.json(); }).catch(function() { return {}; }),
      fetch('/api/telegram-status').then(function(r) { return r.json(); }).catch(function() { return { configured: false }; })
    ]).then(function(values) {
      const config = values[0];
      const version = values[1];
      const telegram = values[2];

      panel.innerHTML =
        '<div class="settings-section">' +
          '<h3>Version</h3>' +
          '<div class="version-row">' +
            '<span class="version-pill">conductor v' + escHtml(version.conductor || '?') + '</span>' +
            '<span class="version-pill">evalgate v' + escHtml(version.evalgate || '?') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h3>Telegram</h3>' +
          '<span class="badge ' + (telegram.configured ? 'badge-done' : 'badge-failed') + '">' + (telegram.configured ? 'configured' : 'not configured') + '</span>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h3>Tracks</h3>' +
          (config && Array.isArray(config.tracks) && config.tracks.length
            ? config.tracks.map(function(t) {
                return '<div style="margin-bottom:10px">' +
                  '<b style="font-size:13px">' + escHtml(t.name || t.id) + '</b>' +
                  (t.files && t.files.length
                    ? '<div style="color:#555;font-size:11px;margin-top:3px">' + t.files.map(escHtml).join(', ') + '</div>'
                    : '') +
                  '</div>';
              }).join('')
            : '<p style="color:#555">No tracks configured</p>') +
        '</div>' +
        '<div class="settings-section">' +
          '<h3>Config (raw)</h3>' +
          '<pre class="settings-pre">' + escHtml(JSON.stringify(config, null, 2)) + '</pre>' +
        '</div>';
    });
  };

  // ── Actions ───────────────────────────────────────────────────────────
  function showError(msg) {
    const bar = document.getElementById('error-bar');
    if (!bar) return;
    bar.textContent = msg;
    bar.style.display = 'block';
    setTimeout(function() { bar.style.display = 'none'; }, 6000);
  }

  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.opacity = '1';
    t.style.transform = 'translateY(0)';
    setTimeout(function() {
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
    }, 3500);
  }

  window.runTrack = function(id) {
    runningTracks.add(id);
    // Reflect running state immediately in all buttons for this track
    document.querySelectorAll('[data-run-id="' + id + '"]').forEach(function(b) {
      b.disabled = true; b.textContent = '⏳ Running…';
    });

    fetch('/api/tracks/' + id + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) {
        runningTracks.delete(id);
        showError(d.error || 'Run failed (' + r.status + ')');
      });
      return r.json();
    })
    .then(function(result) {
      if (!result) return;
      if (result.done === 0 && result.failed === 0 && result.skipped === 0) {
        runningTracks.delete(id);
        showToast('No pending tasks in "' + id + '"');
      }
      // Otherwise leave runningTracks — SSE will clear it when workers finish
    })
    .catch(function(err) {
      runningTracks.delete(id);
      showError(err instanceof Error ? err.message : String(err));
    });
  };

  window.retryWorker = function(trackId, workerId) {
    fetch('/api/tracks/' + trackId + '/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId: workerId })
    })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { showError(d.error || 'Retry failed (' + r.status + ')'); });
    })
    .catch(function(err) { showError(err instanceof Error ? err.message : String(err)); });
  };

  // ── Stats bar ─────────────────────────────────────────────────────────
  function updateStats() {
    let total = 0, done = 0, running = 0, failed = 0;
    for (const state of Object.values(swarmStates)) {
      for (const w of (state.workers || [])) {
        total++;
        if (w.status === 'done') done++;
        else if (['spawning','running','verifying','merging'].includes(w.status)) running++;
        else if (w.status === 'failed') failed++;
      }
    }
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-done').textContent = done;
    document.getElementById('stat-running').textContent = running;
    document.getElementById('stat-failed').textContent = failed;

    let totalCost = 0;
    tracks.forEach(function(ts) { if (ts.cost) totalCost += ts.cost.estimatedUsd; });
    const costEl = document.getElementById('stat-cost');
    if (costEl) costEl.textContent = '$' + totalCost.toFixed(2);
  }

  // ── Telegram status ───────────────────────────────────────────────────
  fetch('/api/telegram-status')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      const pill = document.getElementById('tg-pill');
      if (pill && data.configured) {
        pill.classList.add('configured');
        pill.title = 'Telegram bot configured — run: conductor telegram';
      } else if (pill) {
        pill.title = 'Telegram not configured — run: conductor telegram setup';
      }
    })
    .catch(function() {});

  // ── Init ──────────────────────────────────────────────────────────────
  fetch('/api/tracks')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      tracks = data;
      for (const ts of tracks) {
        if (ts.swarmState) swarmStates[ts.track.id] = ts.swarmState;
      }
      renderKanban();
      updateStats();
    })
    .catch(function() {});

  connect();
})();
</script>
</body>
</html>`;
}
