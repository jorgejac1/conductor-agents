<p align="center">
  <img src="static/images/conductor-header.png" alt="conductor" width="100%" />
</p>

# conductor

> **Multi-agent orchestrator with eval-gated quality gates.**
> Spawn parallel agent workers per track, verify output before merging.

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18%2B-blue.svg)](#)
[![v3.2.0](https://img.shields.io/badge/version-v3.2.0-brightgreen.svg)](#roadmap)

---

Local multi-agent tools like Octogent are compelling — parallel workers, visible
progress, git isolation. But they share the same fatal flaw: **workers run until
they say they're done, with no way to know if the output is actually correct.**
Sessions die when you close the terminal. There's no retry, no quality gate,
no remote control.

`conductor` is what that category of tool looks like when built for real work.
It uses [`evalgate`](https://github.com/jorgejac1/evalgate) as its quality gate
layer — workers can't merge until their verifier passes.

---

## How it works

You organize your project into **tracks** — scoped areas of ownership, each
with a `CONTEXT.md` (what this area owns) and a `todo.md` (eval-gated tasks).

```
.conductor/
  config.json
  tracks/
    auth/
      CONTEXT.md      ← what this track owns + constraints
      todo.md         ← eval-gated tasks for this area
    payments/
      CONTEXT.md
      todo.md
```

Each task in `todo.md` follows the evalgate contract format:

```markdown
- [ ] Add JWT validation middleware
  - eval: `npm test -- --testPathPattern=auth`
  - retries: 2

- [ ] Write integration tests for /login
  - eval: `npm run test:integration`
```

When you run `conductor run auth`, it spawns one agent worker per pending task —
each in its own git worktree. A worker's changes only merge back to main when
the `eval:` verifier exits 0.

---

## Install

```bash
npm install -g conductor-agents
```

Or run directly:

```bash
npx conductor-agents help
```

## Quick start

```bash
# 1. Initialize in your repo
cd your-project
git init  # must be a git repo with at least one commit
git commit --allow-empty -m "init"  # if starting from scratch
conductor init

# Option A — generate a plan from a goal (v0.5+)
conductor plan "add JWT authentication with middleware and login endpoint"
# Review .conductor/plan-draft.md, then:
conductor plan apply

# Option B — add tracks manually
conductor add auth --desc="Authentication layer" --files="src/auth/**"
# Edit .conductor/tracks/auth/todo.md with your tasks

# 2. Run
conductor run auth         # single track
conductor run --all        # all tracks — DAG order, parallel where possible

# 3. Check results
conductor status auth
```

---

## CLI reference

| Command | Description |
|---------|-------------|
| `conductor init [--yes]` | Create `.conductor/` — `--yes` skips the first-run wizard |
| `conductor add <name> [opts]` | Add a new track |
| `conductor rm <name>` | Remove a track |
| `conductor list` | List all tracks with color-coded progress bars |
| `conductor run <name> [opts]` | Run a track's worker swarm |
| `conductor run --all` | Run all tracks — respects `dependsOn` ordering, runs independent tracks in parallel |
| `conductor retry <worker-id> <track>` | Retry a failed worker |
| `conductor logs <worker-id> <track>` | Print a worker's session log |
| `conductor status [name]` | Show worker states with duration and eval result |
| `conductor plan "<goal>"` | Generate tracks + tasks from a natural-language goal |
| `conductor plan diff` | Show diff of plan draft vs current tracks (added / removed / changed) |
| `conductor plan apply [--dry-run] [--yes]` | Apply the generated plan draft — prompts for confirmation, `--yes` skips prompt |
| `conductor plan show` | Print the current plan draft |
| `conductor plan iterate [--auto] [--max-rounds=N]` | Re-generate plan based on real eval failures; `--auto` loops up to `--max-rounds` (default 3) |
| `conductor report [track]` | Show cost report — tokens + estimated USD per track |
| `conductor report --html [path]` | Export self-contained HTML report (graph snapshot, worker timeline, cost table) |
| `conductor mcp` | Start MCP server (stdio) — control conductor from any Claude conversation |
| `conductor schedule add <track> "<cron>"` | Add a cron schedule to a track |
| `conductor schedule list` | Show all scheduled tracks with next fire time |
| `conductor schedule rm <track>` | Remove schedule from a track |
| `conductor schedule start [--replay=collapse\|all\|skip]` | Start the scheduling daemon (foreground) — SQLite-backed, survives restarts |
| `conductor webhook start [--port=9000]` | Start webhook server — `POST /webhook/<trackId>` triggers a run |
| `conductor telegram setup` | Configure Telegram bot token + chat ID |
| `conductor telegram [start]` | Start Telegram bot (foreground) |
| `conductor ui [--port=8080]` | Start web dashboard |
| `conductor doctor` | Health check config, tracks, and environment |
| `conductor --version` | Print the installed version |
| `conductor help` | Show usage |

### `conductor add` options

```
--desc="description"                    Track description
--files="src/auth/**,src/users/**"      Owned file globs (comma-separated)
--depends="auth,payments"               Tracks this track depends on (comma-separated IDs)
--max-usd=<n>                           Budget cap in USD; pauses new workers and fires Telegram alert when exceeded
--max-tokens=<n>                        Budget cap in total tokens; same breach behavior as --max-usd
```

### `conductor run` options

```
--concurrency=N        Worker concurrency (default: 3)
--agent=cmd            Agent command (default: claude) — inline flags are supported
--resume               Resume from existing state, skip done workers
```

The `--agent` flag (and the `agentCmd` field in `config.json`) supports inline flags. conductor splits the string automatically so Node's `spawn` receives the binary and args separately:

```bash
conductor run auth --agent="claude --dangerously-skip-permissions"
```

```json
{
  "defaults": {
    "agentCmd": "claude --dangerously-skip-permissions"
  }
}
```

### Using non-Claude agents

`agentCmd` accepts any binary on your PATH. conductor passes the task prompt on stdin and the agent writes its work to the git worktree.

```bash
# OpenCode
conductor run auth --agent="opencode"

# Aider
conductor run auth --agent="aider --yes"

# Any custom script
conductor run auth --agent="/path/to/my-agent.sh"
```

Per-agent settings can be baked into `config.json` so you don't repeat flags on every run:

```json
{
  "defaults": {
    "agentCmd": "opencode",
    "agentArgs": ["--model", "claude-sonnet-4-5"]
  }
}
```

> **Agent plugins:** conductor v3.2 ships built-in plugins for Claude, OpenCode, aider, codex, and gemini-cli. Each plugin's `parseUsage()` extracts token counts from that agent's output format so the dashboard shows accurate spend for all agents, not just Claude. See [Agent Plugins](#agent-plugins) below.

### `conductor logs` options

```
--follow, -f           Tail the log live (polls every 500ms until Ctrl+C)
```

Worker IDs can be abbreviated — any unique prefix works:

```bash
conductor logs eb2eadd4 auth
conductor logs eb2eadd4 auth --follow
```

---

## Task format

Tasks live in `.conductor/tracks/<name>/todo.md` and follow the
[evalgate contract format](https://github.com/jorgejac1/evalgate#contract-format):

```markdown
- [ ] Task title
  - eval: `shell verifier command`
  - retries: 2
```

The verifier command runs inside the worker's git worktree after the agent
finishes. Exit 0 = merge. Anything else = fail (and retry if retries remain).

> **Requirement:** the repository must have at least one commit before running workers. evalgate creates per-worker branches from `HEAD` — if there is no commit yet, the merge step will fail. Run `git commit --allow-empty -m "init"` if starting from a fresh `git init`.

Run outcomes are recorded in the track's history:
- **PASS** — verifier exited 0 *and* the git merge committed the work back to main.
- **FAIL** — verifier definitively exited non-zero. Workers that pass the verifier but fail at merge are not recorded — the work wasn't committed.

Composite verifiers are supported:

```markdown
- [ ] Build, lint, and test all pass
  - eval.all: `npm run build` | `npm run lint` | `npm test`

- [ ] README is clear
  - eval.llm: Does README.md explain the auth flow in plain English?
```

---

## Track dependencies

Tracks can declare `dependsOn` relationships. `conductor run --all` resolves them as a DAG — independent tracks run in parallel, dependent tracks wait for their prerequisites to pass before starting. If a prerequisite fails, all downstream tracks are skipped.

```bash
conductor add infra --desc="Infrastructure layer"
conductor add api --desc="API layer" --depends="infra"
conductor add frontend --desc="Frontend" --depends="api"
```

This creates the chain `infra → api → frontend`. Running `conductor run --all` will:
1. Run `infra` first
2. Run `api` only after `infra` passes
3. Run `frontend` only after `api` passes

`conductor doctor` catches cycles before you run:

```
✔  no circular track dependencies
```

```
✘  cycle detected: api → frontend → infra → api
```

---

## AI planning (`conductor plan`)

`conductor plan` uses an LLM agent to turn a natural-language goal into a
ready-to-run multi-track plan. The agent explores your codebase, designs
track ownership, and writes `eval:`-gated tasks for each track.

```bash
# Generate a plan (agent explores your codebase, writes .conductor/plan-draft.md)
conductor plan "add JWT auth with middleware, login endpoint, and rate limiting"

# Show what would change vs current tracks — no filesystem writes
conductor plan diff

# Preview what would be created without applying (alias: --dry-run)
conductor plan apply --dry-run

# Apply interactively — prints the diff and prompts for confirmation
conductor plan apply

# Apply without the interactive prompt (useful in CI)
conductor plan apply --yes

# Run everything
conductor run --all
```

`conductor plan diff` compares the generated `plan-draft.md` against the tracks currently in `config.json` and prints a colored diff:

```
+ auth       (new track, 3 tasks)
+ payments   (new track, 2 tasks)
~ frontend   (changed: +1 task, -0 tasks)
  infra      (unchanged)
```

The generated `todo.md` files are ready for `conductor run` — each task has a
verifier that evalgate will run after the agent completes its work.

### Plan iteration loop

`conductor plan iterate` inspects the current swarm state for failed workers, collects their full eval output, and re-prompts the planner to revise the task breakdown. One round by default; `--auto` loops automatically:

```bash
# Single-shot: inspect failures and generate a revised draft
conductor plan iterate

# Auto-loop: iterate up to N rounds until all evals pass
conductor plan iterate --auto --max-rounds=3
```

Each round:
1. Collects all failed workers (status `failed` or `verifierPassed === false`) across all tracks
2. Builds a structured prompt containing the full eval stdout + stderr for each failure (no truncation)
3. Calls the planner agent to rewrite `plan-draft.md`
4. Applies the draft and re-runs the affected tracks
5. Stops early if no failures remain (`converged: true`)

`--max-rounds` defaults to 3. Each round is a full planner LLM call plus a swarm run — factor in cost before setting a high cap.

---

## Scheduling

Run tracks on a cron schedule. The daemon persists state to `.conductor/scheduler.db` so missed fires are replayed after a restart.

```bash
# Add a schedule (standard cron syntax)
conductor schedule add auth "*/30 * * * *"   # every 30 minutes
conductor schedule add payments "0 6 * * *"  # every day at 06:00 UTC

# List scheduled tracks with last-fired time and next-fire time
conductor schedule list

# Remove a schedule
conductor schedule rm auth

# Start the daemon (foreground — use systemd/pm2/launchd for production)
conductor schedule start

# Control missed-fire behavior on startup (default: collapse)
conductor schedule start --replay=collapse   # run the most recent missed slot once
conductor schedule start --replay=all        # run every missed slot in order
conductor schedule start --replay=skip       # discard missed slots, fire only on schedule
```

**Missed-fire replay** — if the daemon was down and missed hourly fires over a 6-hour window, `--replay=collapse` runs once (the last slot) and records the others as `replayed-skipped`. `--replay=all` runs all 6 serially. Use `all` only when idempotency is guaranteed; it can hammer the system after a long outage.

**SQLite persistence** — each fire is recorded in `.conductor/scheduler.db` (`schedule_runs` table). Restart the daemon at any time without losing history.

---

## Webhooks

Trigger a track run via HTTP — useful for GitHub push events, CI pipelines, and external automation.

```bash
# Start the webhook server (default port 9000)
conductor webhook start

# With a custom port
conductor webhook start --port=8888
```

Endpoint: `POST /webhook/<trackId>` — responds 202 and queues the track run.

### HMAC-SHA256 signing (recommended)

Set a shared secret in `config.json` to require GitHub-compatible `X-Hub-Signature-256` on every inbound request:

```json
{
  "webhook": {
    "secret": "your-shared-secret"
  }
}
```

Or edit it live in the **Settings** tab of the dashboard without restarting the server.

When a secret is configured:
- Requests missing `X-Hub-Signature-256` → `401`
- Requests with an incorrect signature → `401`
- Valid signature + known track → `202`
- Valid signature + unknown track → `404`

When no secret is configured, all requests are accepted (warning printed to stderr on startup). The same HMAC contract applies to webhook calls routed through the dashboard server (`/api/webhook`).

**GitHub setup:**
1. In your GitHub repo → Settings → Webhooks → Add webhook
2. Payload URL: `http://your-server:9000/webhook/<trackId>`
3. Content type: `application/json`
4. Secret: the value from `webhook.secret` in your config
5. Select events (e.g. "Push")

---

## Web dashboard

```bash
conductor ui
# → http://localhost:8080
```

The dashboard is a React app with the **Mission Control** design system — a blue-black interface built for staying on top of long-running agent runs without losing context.

### Design

- **Palette** — deep blue-black background (`#050810`), indigo accent (`#818cf8`), emerald for pass (`#34d399`), rose for fail (`#fb7185`), sky-blue for running (`#38bdf8`)
- **Glassmorphic cards** — `backdrop-filter: blur` surfaces with inset highlights and blue-tinted borders
- **Animated status dots** — running workers pulse continuously; pass/fail states glow in their respective colors
- **Typography** — Inter for UI chrome, JetBrains Mono for data (IDs, costs, eval commands, logs)
- **`[conductor]`** wordmark fixed top-left; the indigo-filled floating pill nav sits independently in the center

### Tabs

**Tracks** has two view modes, toggled via the toolbar:

- **Kanban** — one column per track, one card per worker. Cards show a status dot, task title, and eval result badge (`PASS` / `FAIL`). The column footer shows cumulative token count and estimated USD spend for that track. Click any card to expand the full session log inline. A ⏸ Pause / ▶ Resume button appears in the column header whenever workers are running or the track is paused. If a track has no tasks in `todo.md`, the Run button is disabled and shows a hint: _"Add tasks to todo.md to enable"_.
- **Graph** — an orbital topology view. Tracks are arranged in a ring; their workers orbit outward in a 130° arc. Tracks with `dependsOn` relationships are connected by dashed edges. Scroll to zoom (0.3×–3×), drag to pan, click a track node to open a slide-in detail panel with the full worker list, retry controls, and live-streaming logs. Hover dims non-active tracks. Press Escape or click the background to deselect. View mode is remembered between sessions via localStorage.

  **Keyboard shortcuts** (graph view):
  - `r` — run the selected track
  - `↑` / `↓` — cycle focused worker in the detail panel
  - `Esc` — deselect / close panel
  - `?` — toggle shortcut help overlay
  - `1`–`5` — switch tabs (global)

**Workers** — flat list of all workers across all tracks, with status, duration, eval badge, and Retry / Logs buttons. A text search box filters by contract title or worker ID; five status pills (all / running / done / failed / pending) narrow the list further. Filter preference is persisted in localStorage.

**History** — run log across all tracks: date, track, contract title, trigger source, duration, and result (`PASS`/`FAIL`). A `PASS` entry means the eval verifier passed *and* the git merge committed the work back to main. Export to CSV is available.

**Activity** — per-track token spend chart. Shows cost accumulation over the session as a canvas bar chart.

**Settings** — editable config panel synced live via SSE. Three editor sections:
- **Defaults** — concurrency, `agentCmd`, and `agentArgs`. Changing `agentCmd` here affects all tracks (confirmation dialog prevents accidental mistyping).
- **Telegram** — bot token (masked) and chat ID. Save → immediately reflected in the running server.
- **Webhook secret** — show/hide, copy to clipboard, and one-click regenerate (64-hex random). Set to empty to clear. All config changes broadcast a `config-changed` SSE event so other open tabs update instantly without a page reload.

A live tracks table shows each track's name, description, agent command, and cost — click any row to edit that track's `maxUsd`, `maxTokens`, and `concurrency`.

All updates stream live via SSE — no page refresh needed.

---

## REST API

The web server (`conductor ui`) exposes a REST API used by the dashboard. You can call it directly:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tracks` | List all tracks with progress and cost |
| `GET` | `/api/tracks/:id/state` | Swarm state for a track |
| `GET` | `/api/tracks/:id/cost` | Budget summary for a track |
| `GET` | `/api/tracks/:id/history` | Run history — supports `?limit`, `?offset`, `?from` (ISO date), `?to` (ISO date), `?result=pass\|fail` |
| `GET` | `/api/tracks/:id/logs/:workerId` | Worker session log (complete, for terminal workers) |
| `GET` | `/api/tracks/:id/logs/:workerId/stream` | SSE log stream — live tail while worker runs, emits `event: done` on completion |
| `POST` | `/api/tracks/:id/run` | Trigger a run `{ concurrency?, agentCmd?, resume? }` |
| `POST` | `/api/tracks/:id/pause` | Pause a track — aborts new-worker spawning and writes a PAUSED marker |
| `POST` | `/api/tracks/:id/resume` | Resume a paused track — clears the PAUSED marker and re-runs from pending state |
| `POST` | `/api/tracks/:id/retry` | Retry a worker `{ workerId }` |
| `POST` | `/api/tracks/:id/budget` | Record token usage `{ contractId, tokens, workerId? }` |
| `GET` | `/api/events` | SSE stream — emits `tracks`, `swarm`, `cost`, `eval-result`, `worker-start`, `worker-retry`, `track-paused`, `track-resumed`, and `config-changed` events |
| `GET` | `/api/config` | Current conductor config |
| `POST` | `/api/config` | Patch top-level config — accepts `{ defaults?, telegram?, webhook? }`; send `null` for a section to remove it |
| `GET` | `/api/version` | `{ conductor, evalgate }` version strings |
| `GET` | `/api/telegram-status` | `{ configured: boolean }` |

### Budget endpoint

Agent workers can self-report token usage without touching the CLI:

```bash
curl -X POST http://localhost:8080/api/tracks/auth/budget \
  -H 'Content-Type: application/json' \
  -d '{ "contractId": "add-jwt", "tokens": 12400, "workerId": "abc123" }'
```

This triggers a `cost` SSE event, which immediately updates the cost footer in the dashboard.

---

## Budget guardrails

Each track supports optional per-track budget caps set in `config.json` (or via `conductor add` flags):

```json
{
  "tracks": [
    {
      "id": "auth",
      "maxUsd": 2.00,
      "maxTokens": 500000
    }
  ]
}
```

Or when creating a track:

```bash
conductor add auth --desc="Auth layer" --max-usd=2 --max-tokens=500000
```

When a track's cumulative spend exceeds either cap:

- **New workers stop spawning** — the orchestrator aborts via `AbortSignal`; workers already in-flight run to completion, then no new workers start until the budget is cleared or raised.
- **PAUSED marker written** — a `.conductor/tracks/<id>/PAUSED` file is written so the paused state survives process restarts and is visible via `GET /api/tracks/:id/paused`.
- **Telegram alert fires** — if a Telegram bot is configured (`conductor telegram setup`), a message is sent immediately with the track name and the breach amount.
- **`BUDGET` badge appears in the UI** — the track card in the Kanban view and the Settings tracks table both show a red `BUDGET` badge so the breach is immediately visible in the dashboard.

Cost is calculated using the input/output token split when available (input: $3/MTok, output: $15/MTok, via evalgate's `estimateUsd`). If only a total token count is reported (no split), a blended rate of $9/MTok is used.

To resume a budget-paused track after reviewing or adjusting the cap:

```bash
# Via CLI (clears PAUSED marker + re-runs pending workers)
curl -X POST http://localhost:8080/api/tracks/auth/resume

# Or via the dashboard — click the green ▶ Resume button in the track column header
```

---

## Relationship to evalgate

`conductor` uses [`evalgate`](https://github.com/jorgejac1/evalgate) as a library
for its worker execution engine. evalgate handles:

- Spawning agents in git worktrees
- Running verifiers after each worker completes
- Persisting swarm state to `.evalgate/swarm-state.json`
- Emitting events that conductor's SSE server re-broadcasts to the dashboard

You don't need to install or run evalgate separately. It's a bundled dependency.

If you want evalgate's standalone features (pre-commit hooks, MCP server, trigger
daemon, ANSI dashboard), install it separately — the two tools are independent
and coexist fine in the same repo.

---

## Track CONTEXT.md

Each track gets a `CONTEXT.md` that describes what the track owns. The
conductor prompt builder injects this into each worker agent's system prompt,
giving workers scoped context without polluting each other.

```markdown
# auth

Authentication and session management layer.

## Owned files
- `src/auth/**`
- `src/middleware/auth.ts`

## Constraints
- Never store plaintext credentials
- All tokens must be signed with the app secret
- Session expiry must be <= 24h
```

Edit this file freely. The next `conductor run` will pick it up.

---

## Health check (`conductor doctor`)

`conductor doctor` audits your project and reports any issues before you run:

```
conductor doctor
```

```
conductor doctor  /your/project

Config
  ✔  config.json exists
  ✔  config.json schema is valid

Tracks  (3 configured)
  ✔  auth/todo.md exists
  ✔  auth: 3 task(s) with eval verifiers
  ✔  payments/todo.md exists
  ⚠  payments: 1 task(s) have no eval verifier: "Update Stripe keys"
  ✔  notifications/todo.md exists
  ✔  notifications: 2 task(s) with eval verifiers
  ✔  no circular track dependencies

Git worktrees
  ✔  no stale worktrees detected

Dependencies
  ✔  evalgate 2.1.0 installed (required: ^2.1.0)
  ✔  agent "claude" found on PATH

All checks passed.
```

Checks performed:
1. `.conductor/config.json` exists and passes schema validation
2. Each track has a `todo.md` file
3. Each task has an `eval:` verifier (warns if missing)
4. No circular `dependsOn` references between tracks
5. No stale git worktrees from previous crashed runs
6. evalgate version satisfies the declared dependency range
7. Agent commands (`claude`, or custom `agentCmd`) are on `$PATH`
8. Any `schedule` cron expressions are valid

---

## Programmatic API

`conductor-agents` can be used as a library in addition to the CLI:

```bash
npm install conductor-agents
```

```ts
import { runTrack, listTracks, loadConfig, validateConfig } from "conductor-agents";

// Load and validate config
const config = loadConfig("/your/project");

// Run a track's swarm
const result = await runTrack("auth", { cwd: "/your/project", concurrency: 2 });

// Check all tracks
const tracks = await listTracks("/your/project");

// Start the HTTP server programmatically
import { startServer } from "conductor-agents";
const server = await startServer({ port: 8080, cwd: "/your/project" });
// ... later:
server.close();
```

Full API surface:

```ts
// Config
loadConfig, saveConfig, validateConfig, configDir, configPath, trackDir, trackTodoPath, trackContextPath
// Tracks
createTrack, deleteTrack, getTrack, listTracks, initConductor
// Orchestration
runTrack, runAll, retryTrackWorker, getTrackState, getTrackCost, getTrackSpend, detectCycle, pauseTrack, resumeTrack, isPaused
// Server
startServer
// MCP
startMcpServer
// Planner
generatePlan, applyPlan, parsePlanDraft, buildContextSnapshot, generatePlanIterate, runIterationLoop
// Scheduler
openSchedulerDb, computeMissedFires, replayMissed, recordFire, updateTrackState, getTrackState as getSchedulerTrackState
// Webhook auth
verifyHmac, readBody
// Types
ConductorConfig, Track, TrackStatus, TrackCostSummary, TelegramBotConfig
```

---

## Memory vault

conductor v3.2 adds a persistent memory system at `.conductor/memory/`. Agents write lessons, decisions, references, and failure patterns during runs — and those memories are automatically injected into future runs so agents don't rediscover the same things each time.

### CLI

```bash
conductor memory list [--scope=global] [--type=lesson]
conductor memory show <slug>
conductor memory add --name=deadlock-fix --type=lesson --scope=global --body="Use SKIP LOCKED to avoid postgres deadlocks."
conductor memory rm <slug>
```

### MCP tools (for agents)

Agents access memory via 4 MCP tools exposed by `conductor mcp`:

| Tool | Description |
|------|-------------|
| `write_memory` | Write a new memory (name, type, scope, body, optional tags) |
| `read_memory` | List all memories, filtered by scope and/or type |
| `search_memory` | Case-insensitive substring search across name + body + tags |
| `list_memories` | Return slug array for all stored memories |

### Memory types

| Type | Description |
|------|-------------|
| `lesson` | Something learned through trial and error |
| `decision` | Architecture or design decision with rationale |
| `reference` | Pointer to external resource, doc, or API |
| `failure-pattern` | Known failure mode to avoid or watch for |

### Scope

- `global` — available to all tracks in this project
- `track:<id>` — scoped to a specific track (e.g. `track:auth`)

Memories scoped to `global` + the current track are prepended to the agent's task context at run time. Total injected memory is capped at 8KB by default (oldest memories drop first if over budget). Override with `defaults.memoryBudgetBytes` in `config.json`.

### Obsidian sync (optional)

Add an `obsidian` section to `config.json` to enable sync with an Obsidian vault:

```json
{
  "obsidian": {
    "vaultPath": "/Users/you/Obsidian/MyVault",
    "subfolder": "conductor",
    "mode": "push"
  }
}
```

| Mode | Behavior |
|------|----------|
| `push` | After each track run, writes `<trackId>-<timestamp>.md` to the vault with outcome, cost, and token totals |
| `pull` | At run start, reads `_context.md` from the vault subfolder and injects its contents into the agent's context |
| `two-way` | Both push and pull |

Check vault accessibility:

```bash
conductor obsidian status
```

---

## Agent plugins

conductor v3.2 ships a formal plugin spec so any agent CLI gets accurate token tracking in the dashboard.

### Built-in plugins

| Plugin | Command | Token parsing |
|--------|---------|---------------|
| `claude` | `claude` | `--output-format json` → `usage.input_tokens` / `output_tokens` |
| `opencode` | `opencode` | stderr summary line `tokens: prompt=N response=M` |
| `aider` | `aider` | stderr `Tokens: N sent, M received` |
| `codex` | `codex` | structured JSON `usage` field |
| `gemini` | `gemini` | JSON `usageMetadata.promptTokenCount` / `candidatesTokenCount` |
| `generic` | (any) | Returns null — tokens reported as 0; one-time warning printed |

```bash
conductor agent list          # see all available plugins
conductor agent info claude   # full details for one plugin
conductor agent use opencode  # set defaults.agentCmd in config.json
```

### Custom plugins

Drop a JS file at `.conductor/plugins/<name>.js` to add or override a plugin:

```js
// .conductor/plugins/myagent.js
export default {
  id: "myagent",
  defaultCmd: "myagent",
  defaultArgs: (task) => ["--task", task],
  parseUsage(logContent, stderr) {
    const m = stderr.match(/used (\d+) input tokens and (\d+) output tokens/);
    if (!m) return null;
    return { inputTokens: Number(m[1]), outputTokens: Number(m[2]) };
  },
  pricing: { input: 1.00, output: 5.00 }, // USD per 1M tokens
};
```

The plugin is loaded automatically when `agentCmd` matches the filename. Custom plugins take precedence over built-ins. Plugins run with full Node privileges — only load files you wrote or trust.

**Pricing override via env:**

```bash
CONDUCTOR_PRICING_CLAUDE_INPUT=2.50 conductor run auth
```

---

## Docker

```bash
docker pull ghcr.io/jorgejac1/conductor-agents:latest
```

Or build locally:

```bash
docker build -t conductor-agents .
```

Mount your project directory and run any conductor command:

```bash
# Health check
docker run --rm -v $(pwd):/app conductor-agents doctor /app

# Run a track (requires git + agent command inside container or mounted)
docker run --rm -v $(pwd):/app conductor-agents run auth /app
```

The image is based on `node:22-slim` with `git` installed (required for worktrees).

---

## Roadmap

| Version | Feature | Status |
|---------|---------|--------|
| v0.1.0 | Core track model, CLI, eval-gated workers, SSE dashboard | Shipped |
| v0.1.1 | Fix: initial UI state loading, progress bar derived from workers | Shipped |
| v0.2 | Interactive init wizard, live log streaming in UI, color CLI output, `conductor logs` command | Shipped |
| v0.3 | Rename: tentacle → track (breaking change, filesystem path updated) | Shipped |
| v0.4 | Telegram bot gateway — run/retry/status from phone | Shipped |
| v0.5 | `conductor plan "<goal>"` — LLM generates tracks + tasks automatically | Shipped |
| v0.6 | Per-track cost tracking, `conductor report`, `/api/tracks/:id/cost`, SSE cost events | Shipped |
| v0.7 | UI v2 — 4-tab layout: Tracks deck (kanban with eval badges), Workers, History, Settings | Shipped |
| v0.8 | MCP server — `conductor mcp` over stdio; tools: list/run/retry/status/cost from any Claude conversation | Shipped |
| v0.9 | Scheduling + webhooks — `conductor schedule add/list/rm/start`, `conductor webhook start` | Shipped |
| v1.0 | Stable API, programmatic API export, Docker image, `conductor doctor`, CONTEXT.md injection, `agentArgs` config for non-Claude CLIs, `{task}` placeholder support | Shipped |
| v2.0 | React dashboard rebuild — Mission Control design system, graph/topology view with zoom+pan, kanban token footers, wordmark, Settings redesign with live session stats, Activity tab, evalgate ^2.0.0 | Shipped |
| v2.1 | Track dependencies (`--depends` flag, DAG `runAll`, cycle detection in `doctor`), live log streaming in detail panel (SSE), typed failure badges (`TIMEOUT` / `MERGE` / `FAILED` / `ERROR`), dependency edges in graph view, keyboard shortcuts (`r`, `↑↓`, `?`), `worker-start` / `worker-retry` SSE events | Shipped |
| v2.2 | Budget guardrails — per-track `maxTokens` / `maxUsd` in `config.json`; breach pauses new workers and fires Telegram alert. Mobile-responsive layout. Activity tab drill-down tooltips | Shipped |
| v2.3 | `conductor report --html` — self-contained HTML export (graph snapshot, worker timeline, cost table). `conductor plan diff` + `plan apply --yes` — diff mode shows added/removed/changed tracks before applying, `--yes` bypasses interactive prompt. Pause/Resume API (`POST /pause`, `POST /resume`) backed by `AbortSignal` in orchestrator — fixes budget-guardrail bug where new workers kept spawning after breach. History pagination (`?offset`, `?from`, `?to`, `?result`). MCP expanded to 12 tools (adds `get_logs`, `cancel_run`, `list_history`, `get_plan_diff`). Workers tab search + status filter pills. Kanban Pause/Resume button. | Shipped |
| v3.0 | Workspace mode — multi-project workspace sidebar aggregating multiple `.conductor/` dirs with project switcher. Remote workers via SSH runner and Docker runner. `agentCmd` inline flag support (`"claude --dangerously-skip-permissions"`). Run button disabled with hint when track has no tasks. Activity tab bar chart track-name fix. evalgate ^3.0.0 (breaking: `BudgetExceededEvent` added to `SwarmEvent` union). | Shipped |
| v3.1 | Persistent scheduler (SQLite-backed cron, missed-fire replay with `collapse`/`all`/`skip` policies). Settings editor UI — in-dashboard edits for `defaults`, Telegram, and webhook secret with live SSE sync. Plan iteration auto-loop (`conductor plan iterate --auto --max-rounds=N`). Webhook HMAC signing + auth — shared `verifyHmac` with `timingSafeEqual` across dashboard and standalone webhook server. evalgate ^3.1.0 (SQLite budget log, `compactLogs`, LLM provider retry, `Contract.weight` tiebreaker). | Shipped |
| v3.2 | Memory vault (`.conductor/memory/` — write/read/search/list via 4 new MCP tools + `conductor memory` CLI). Agent plugin spec — built-in plugins for claude/opencode/aider/codex/gemini with per-agent `parseUsage()` for accurate token tracking. Optional Obsidian sync (push run summaries, pull `_context.md`). evalgate ^3.2.0 (`parseUsage` hook on `runSwarm`). | Shipped |
| v3.3 | Memory UI editor (create/edit/delete from dashboard). Memory TTL + pinning. Agent plugin marketplace. Plan iteration with memory feedback loop. | Planned |

---

## Contributing

```bash
git clone https://github.com/jorgejac1/conductor-agents
cd conductor
npm install
npm run build
npm test
```

PRs welcome. Run `npm run lint:fix` before committing.

---

## License

MIT
