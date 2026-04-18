/**
 * conductor dashboard — single-file HTML/CSS/JS, no build step.
 *
 * Layout:
 *   Left sidebar: tentacle list with progress bars
 *   Main area: selected tentacle's workers with status badges + retry buttons
 *   Bottom bar: totals across all tentacles
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
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  header h1 { font-size: 15px; font-weight: 600; }
  header .subtitle { color: var(--muted); font-size: 12px; }

  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* Sidebar */
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

  .tentacle-item {
    padding: 8px 14px;
    cursor: pointer;
    border-left: 3px solid transparent;
    transition: background 0.1s;
  }

  .tentacle-item:hover { background: var(--surface); }
  .tentacle-item.active {
    border-left-color: var(--accent);
    background: var(--surface);
  }

  .tentacle-name { font-weight: 600; margin-bottom: 3px; }
  .tentacle-desc { color: var(--muted); font-size: 11px; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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

  /* Content */
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

  .tentacle-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }

  .tentacle-header h2 { font-size: 16px; }

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
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .workers-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .worker-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .worker-card.failed { border-left: 3px solid var(--red); }
  .worker-card.done { border-left: 3px solid var(--green); }
  .worker-card.running { border-left: 3px solid var(--yellow); }
  .worker-card.verifying { border-left: 3px solid var(--purple); }
  .worker-card.merging { border-left: 3px solid var(--accent); }

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

  .worker-info { flex: 1; min-width: 0; }
  .worker-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .worker-meta { color: var(--muted); font-size: 11px; margin-top: 2px; }

  .worker-actions { display: flex; gap: 6px; flex-shrink: 0; }

  /* Bottom bar */
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

  .spinner {
    display: inline-block;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<header>
  <h1>conductor</h1>
  <span class="subtitle">multi-agent orchestrator</span>
  <span style="flex:1"></span>
  <span id="conn-status"><span class="dot" id="conn-dot"></span><span id="conn-text">connecting</span></span>
</header>

<div class="main">
  <aside class="sidebar">
    <div class="sidebar-title">Tentacles</div>
    <div id="tentacle-list"></div>
  </aside>

  <main class="content">
    <div id="main-content">
      <div class="empty-state">
        <div class="big">🎼</div>
        <div>Select a tentacle to see workers</div>
        <div style="color:var(--muted); font-size:12px">or run <code>conductor add &lt;name&gt;</code> to create one</div>
      </div>
    </div>
  </main>
</div>

<div class="status-bar">
  <span>Workers: <b id="stat-total">0</b></span>
  <span style="color:var(--green)">Done: <b id="stat-done">0</b></span>
  <span style="color:var(--yellow)">Running: <b id="stat-running">0</b></span>
  <span style="color:var(--red)">Failed: <b id="stat-failed">0</b></span>
  <span style="flex:1"></span>
  <span id="last-update" style="color:var(--muted)"></span>
</div>

<script>
(function() {
  let tentacles = [];
  let selectedId = null;
  const swarmStates = {};
  const logPollers = {};

  // ── SSE ──────────────────────────────────────────────────────────────
  function connect() {
    const es = new EventSource('/api/events');
    const dot = document.getElementById('conn-dot');
    const txt = document.getElementById('conn-text');

    es.onopen = () => {
      dot.className = 'dot connected';
      txt.textContent = 'live';
    };
    es.onerror = () => {
      dot.className = 'dot';
      txt.textContent = 'reconnecting…';
    };
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'tentacles') {
          tentacles = msg.tentacles;
          for (const ts of tentacles) {
            if (ts.swarmState) swarmStates[ts.tentacle.id] = ts.swarmState;
          }
          renderSidebar();
          updateStats();
          if (selectedId) renderMain(selectedId);
        } else if (msg.type === 'swarm') {
          const state = msg.state;
          if (state && state.todoPath) {
            // Map by todoPath — extract tentacle id from path
            const parts = state.todoPath.split('/');
            const tentaclesIdx = parts.lastIndexOf('tentacles');
            if (tentaclesIdx !== -1 && parts[tentaclesIdx + 1]) {
              swarmStates[parts[tentaclesIdx + 1]] = state;
            }
          }
          if (selectedId) renderMain(selectedId);
          updateStats();
          document.getElementById('last-update').textContent =
            'updated ' + new Date().toLocaleTimeString();
        }
      } catch {}
    };
  }

  // ── Sidebar ──────────────────────────────────────────────────────────
  function renderSidebar() {
    const list = document.getElementById('tentacle-list');
    if (!tentacles.length) {
      list.innerHTML = '<div style="padding:10px 14px;color:var(--muted);font-size:12px">No tentacles yet</div>';
      return;
    }
    list.innerHTML = tentacles.map(ts => {
      const pct = ts.todoTotal > 0 ? Math.round(ts.todoDone / ts.todoTotal * 100) : 0;
      const active = ts.tentacle.id === selectedId ? ' active' : '';
      return \`<div class="tentacle-item\${active}" onclick="selectTentacle('\${ts.tentacle.id}')">
        <div class="tentacle-name">\${esc(ts.tentacle.name)}</div>
        <div class="tentacle-desc">\${esc(ts.tentacle.description)}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:\${pct}%"></div></div>
        <div class="progress-label">\${ts.todoDone}/\${ts.todoTotal} tasks done</div>
      </div>\`;
    }).join('');
  }

  // ── Main content ─────────────────────────────────────────────────────
  window.selectTentacle = function(id) {
    selectedId = id;
    renderSidebar();
    renderMain(id);
  };

  function renderMain(id) {
    const ts = tentacles.find(t => t.tentacle.id === id);
    if (!ts) return;

    const state = swarmStates[id] || null;
    const workers = state ? state.workers : [];

    const main = document.getElementById('main-content');
    const runBtn = \`<button class="btn primary" onclick="runTentacle('\${id}')">▶ Run</button>\`;

    if (!workers.length) {
      main.innerHTML = \`
        <div class="tentacle-header">
          <h2>\${esc(ts.tentacle.name)}</h2>
          \${runBtn}
        </div>
        <div class="empty-state" style="height:auto;margin-top:40px">
          <div>No workers yet</div>
          <div style="font-size:12px;color:var(--muted)">Add tasks to todo.md and click Run</div>
        </div>\`;
      return;
    }

    const cards = workers.map(w => {
      const retryBtn = w.status === 'failed'
        ? \`<button class="btn" onclick="retryWorker('\${id}', '\${w.id}')">↺ Retry</button>\`
        : '';
      const logsBtn = \`<button class="btn" onclick="toggleLogs('\${id}', '\${w.id}')">≡ Logs</button>\`;
      const spinner = ['spawning','running','verifying','merging'].includes(w.status)
        ? '<span class="spinner">⟳</span> ' : '';
      return \`<div class="worker-wrap">
        <div class="worker-card \${w.status}">
          <span class="badge \${w.status}">\${w.status}</span>
          <div class="worker-info">
            <div class="worker-title">\${spinner}\${esc(w.contractTitle || w.id)}</div>
            <div class="worker-meta">id: \${w.id.slice(0, 8)}…</div>
          </div>
          <div class="worker-actions">\${retryBtn}\${logsBtn}</div>
        </div>
        <div class="log-panel" id="log-\${w.id}" style="display:none">
          <pre class="log-content" id="logcontent-\${w.id}">Loading…</pre>
        </div>
      </div>\`;
    }).join('');

    main.innerHTML = \`
      <div class="tentacle-header">
        <h2>\${esc(ts.tentacle.name)}</h2>
        \${runBtn}
      </div>
      <div class="workers-grid">\${cards}</div>\`;
  }

  // ── Log panel ─────────────────────────────────────────────────────────────
  window.toggleLogs = function(tentacleId, workerId) {
    const panel = document.getElementById(\`log-\${workerId}\`);
    if (!panel) return;
    if (panel.style.display !== 'none') {
      panel.style.display = 'none';
      if (logPollers[workerId]) { clearTimeout(logPollers[workerId]); delete logPollers[workerId]; }
      return;
    }
    panel.style.display = 'block';
    fetchLog(tentacleId, workerId);
  };

  function fetchLog(tentacleId, workerId) {
    const el = document.getElementById(\`logcontent-\${workerId}\`);
    if (!el) return;
    fetch(\`/api/tentacles/\${tentacleId}/logs/\${workerId}\`)
      .then(r => r.text())
      .then(text => {
        el.textContent = text || '(no output yet)';
        el.scrollTop = el.scrollHeight;
      })
      .catch(() => { el.textContent = '(failed to load log)'; });

    // Poll while worker is active, stop when done/failed
    const state = swarmStates[tentacleId];
    const worker = state?.workers?.find(w => w.id === workerId);
    const isActive = worker && ['spawning','running','verifying','merging'].includes(worker.status);
    if (isActive) {
      logPollers[workerId] = setTimeout(() => {
        const panel = document.getElementById(\`log-\${workerId}\`);
        if (panel && panel.style.display !== 'none') fetchLog(tentacleId, workerId);
      }, 2000);
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────
  window.runTentacle = function(id) {
    fetch(\`/api/tentacles/\${id}/run\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(err => console.error('run failed', err));
  };

  window.retryWorker = function(tentacleId, workerId) {
    fetch(\`/api/tentacles/\${tentacleId}/retry\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId })
    }).catch(err => console.error('retry failed', err));
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
  }

  // ── Utils ─────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Init ──────────────────────────────────────────────────────────────
  fetch('/api/tentacles')
    .then(r => r.json())
    .then(data => {
      tentacles = data;
      for (const ts of tentacles) {
        if (ts.swarmState) swarmStates[ts.tentacle.id] = ts.swarmState;
      }
      renderSidebar();
      updateStats();
    })
    .catch(() => {});

  connect();
})();
</script>
</body>
</html>`;
}
