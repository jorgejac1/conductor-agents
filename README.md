<p align="center">
  <img src="static/images/conductor-header.png" alt="conductor" width="100%" />
</p>

# conductor

> **Multi-agent orchestrator with eval-gated quality gates.**
> Spawn parallel agent workers per track, verify output before merging.

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18%2B-blue.svg)](#)
[![v2.1.0](https://img.shields.io/badge/version-v2.1.0-brightgreen.svg)](#roadmap)

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
git init  # must be a git repo
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
| `conductor plan apply [--dry-run]` | Apply the generated plan draft to create tracks |
| `conductor plan show` | Print the current plan draft |
| `conductor report [track]` | Show cost report — tokens + estimated USD per track |
| `conductor mcp` | Start MCP server (stdio) — control conductor from any Claude conversation |
| `conductor schedule add <track> "<cron>"` | Add a cron schedule to a track |
| `conductor schedule list` | Show all scheduled tracks with next fire time |
| `conductor schedule rm <track>` | Remove schedule from a track |
| `conductor schedule start` | Start the scheduling daemon (foreground) |
| `conductor webhook start [--port=9000]` | Start webhook server — `POST /webhook/<trackId>` triggers a run |
| `conductor telegram setup` | Configure Telegram bot token + chat ID |
| `conductor telegram [start]` | Start Telegram bot (foreground) |
| `conductor ui [--port=8080]` | Start web dashboard |
| `conductor doctor` | Health check config, tracks, and environment |
| `conductor help` | Show usage |

### `conductor add` options

```
--desc="description"                    Track description
--files="src/auth/**,src/users/**"      Owned file globs (comma-separated)
--depends="auth,payments"               Tracks this track depends on (comma-separated IDs)
```

### `conductor run` options

```
--concurrency=N        Worker concurrency (default: 3)
--agent=cmd            Agent command (default: claude)
--resume               Resume from existing state, skip done workers
```

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

# Preview what would be created without applying
conductor plan apply --dry-run

# Apply — creates tracks with CONTEXT.md and todo.md
conductor plan apply

# Run everything
conductor run --all
```

The generated `todo.md` files are ready for `conductor run` — each task has a
verifier that evalgate will run after the agent completes its work.

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

- **Kanban** — one column per track, one card per worker. Cards show a status dot, task title, and eval result badge (`PASS` / `FAIL`). The column footer shows cumulative token count and estimated USD spend for that track. Click any card to expand the full session log inline.
- **Graph** — an orbital topology view. Tracks are arranged in a ring; their workers orbit outward in a 130° arc. Tracks with `dependsOn` relationships are connected by dashed edges. Scroll to zoom (0.3×–3×), drag to pan, click a track node to open a slide-in detail panel with the full worker list, retry controls, and live-streaming logs. Hover dims non-active tracks. Press Escape or click the background to deselect. View mode is remembered between sessions via localStorage.

  **Keyboard shortcuts** (graph view):
  - `r` — run the selected track
  - `↑` / `↓` — cycle focused worker in the detail panel
  - `Esc` — deselect / close panel
  - `?` — toggle shortcut help overlay
  - `1`–`5` — switch tabs (global)

**Workers** — flat list of all workers across all tracks, with status, duration, eval badge, and Retry / Logs buttons.

**History** — run log across all tracks: date, track, contract title, trigger source, duration, and result (`PASS`/`FAIL`). A `PASS` entry means the eval verifier passed *and* the git merge committed the work back to main. Export to CSV is available.

**Activity** — per-track token spend chart. Shows cost accumulation over the session as a canvas bar chart.

**Settings** — two-column layout: a live tracks table on the left (name, description, agent command, cost per track) and version / defaults / integrations / live session stats on the right. Session stats show total workers, done/failed/running counts, total tokens, and total estimated USD — updated live from SSE.

All updates stream live via SSE — no page refresh needed.

---

## REST API

The web server (`conductor ui`) exposes a REST API used by the dashboard. You can call it directly:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tracks` | List all tracks with progress and cost |
| `GET` | `/api/tracks/:id/state` | Swarm state for a track |
| `GET` | `/api/tracks/:id/cost` | Budget summary for a track |
| `GET` | `/api/tracks/:id/history` | Run history (last 100 runs, newest first) |
| `GET` | `/api/tracks/:id/logs/:workerId` | Worker session log (complete, for terminal workers) |
| `GET` | `/api/tracks/:id/logs/:workerId/stream` | SSE log stream — live tail while worker runs, emits `event: done` on completion |
| `POST` | `/api/tracks/:id/run` | Trigger a run `{ concurrency?, agentCmd?, resume? }` |
| `POST` | `/api/tracks/:id/retry` | Retry a worker `{ workerId }` |
| `POST` | `/api/tracks/:id/budget` | Record token usage `{ contractId, tokens, workerId? }` |
| `GET` | `/api/events` | SSE stream — emits `tracks`, `swarm`, `cost`, `eval-result`, `worker-start`, and `worker-retry` events |
| `GET` | `/api/config` | Current conductor config |
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
runTrack, runAll, retryTrackWorker, getTrackState, getTrackCost, detectCycle
// Server
startServer
// MCP
startMcpServer
// Planner
generatePlan, applyPlan, parsePlanDraft, buildContextSnapshot
// Types
ConductorConfig, Track, TrackStatus, TrackCostSummary, TelegramBotConfig
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
| v2.2 | Budget guardrails — per-track `maxTokens` / `maxUsd` in `config.json`; breach pauses new workers and fires Telegram alert. Mobile-responsive layout. Activity tab drill-down tooltips | Planned |
| v2.3 | `conductor report --html` — self-contained HTML export (graph snapshot, worker timeline, cost table). `conductor plan` diff mode — shows diff against current tracks before applying | Planned |
| v3.0 | Workspace mode — multi-project dashboard aggregating multiple `.conductor/` dirs, remote workers via SSH/container | Planned |

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
