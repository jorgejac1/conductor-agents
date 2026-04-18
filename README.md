# conductor

> **Multi-agent orchestrator with eval-gated quality gates.**
> Spawn parallel agent workers per tentacle, verify output before merging.

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18%2B-blue.svg)](#)
[![v0.1.1](https://img.shields.io/badge/version-v0.1.1-brightgreen.svg)](#roadmap)

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

You organize your project into **tentacles** — scoped areas of ownership, each
with a `CONTEXT.md` (what this area owns) and a `todo.md` (eval-gated tasks).

```
.conductor/
  config.json
  tentacles/
    auth/
      CONTEXT.md      ← what this tentacle owns + constraints
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

# 2. Add a tentacle
conductor add auth --desc="Authentication layer" --files="src/auth/**"

# 3. Edit the generated todo.md with your tasks
vim .conductor/tentacles/auth/todo.md

# 4. Run
conductor run auth

# 5. Check results
conductor status auth
```

---

## CLI reference

| Command | Description |
|---------|-------------|
| `conductor init` | Create `.conductor/` in the current directory |
| `conductor add <name> [opts]` | Add a new tentacle |
| `conductor rm <name>` | Remove a tentacle |
| `conductor list` | List all tentacles with progress bars |
| `conductor run <name> [opts]` | Run a tentacle's worker swarm |
| `conductor run --all` | Run all tentacles sequentially |
| `conductor retry <worker-id> <tentacle>` | Retry a failed worker |
| `conductor status [name]` | Show worker states |
| `conductor ui [--port=8080]` | Start web dashboard |
| `conductor help` | Show usage |

### `conductor add` options

```
--desc="description"                    Tentacle description
--files="src/auth/**,src/users/**"      Owned file globs (comma-separated)
```

### `conductor run` options

```
--concurrency=N        Worker concurrency (default: 3)
--agent=cmd            Agent command (default: claude)
--resume               Resume from existing state, skip done workers
```

---

## Task format

Tasks live in `.conductor/tentacles/<name>/todo.md` and follow the
[evalgate contract format](https://github.com/jorgejac1/evalgate#contract-format):

```markdown
- [ ] Task title
  - eval: `shell verifier command`
  - retries: 2
```

The verifier command runs inside the worker's git worktree after the agent
finishes. Exit 0 = merge. Anything else = fail (and retry if retries remain).

Composite verifiers are supported:

```markdown
- [ ] Build, lint, and test all pass
  - eval.all: `npm run build` | `npm run lint` | `npm test`

- [ ] README is clear
  - eval.llm: Does README.md explain the auth flow in plain English?
```

---

## Web dashboard

```bash
conductor ui
# → http://localhost:8080
```

The dashboard shows all tentacles in a sidebar with progress bars, and workers
in the main panel with status badges (pending / running / verifying / done / failed).
Failed workers have a Retry button. All updates stream live via SSE — no page refresh needed.

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

## Tentacle CONTEXT.md

Each tentacle gets a `CONTEXT.md` that describes what the tentacle owns. The
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

## Roadmap

| Version | Feature | Status |
|---------|---------|--------|
| v0.1.0 | Core tentacle model, CLI, eval-gated workers, SSE dashboard | Shipped |
| v0.1.1 | Fix: initial UI state loading, progress bar derived from workers | Shipped |
| v0.2 | npm publish, interactive init wizard, live log streaming in UI | Planned |
| v0.3 | Daemon mode — workers survive terminal close, state recovery on restart | Planned |
| v0.4 | Telegram bot gateway — run/retry/status from phone | Planned |
| v0.5 | `conductor plan "<goal>"` — LLM generates tentacles + tasks automatically | Planned |
| v0.6 | Per-worker cost tracking, run history, `conductor report` | Planned |
| v1.0 | Stable API, full docs, Docker image | Planned |

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
