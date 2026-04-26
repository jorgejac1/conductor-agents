import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	applyPlan,
	buildContextSnapshot,
	formatTasksAsTodo,
	parsePlanDraft,
} from "../src/planner.js";
import { initConductor } from "../src/track.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SINGLE_TRACK_DRAFT = `# Conductor Plan: Add authentication
Generated: 2026-04-18T10:00:00.000Z

## Track: auth
Description: Handles JWT-based authentication middleware
Files: src/auth/**, src/middleware/**
Concurrency: 2

### Context
This track owns authentication logic. It should implement JWT verification middleware
and user session management. Do NOT touch src/database/ — that belongs to the data track.
Keep all auth code within src/auth/ and src/middleware/auth.ts.

### Tasks
- [ ] Implement JWT middleware
  - Add express middleware that verifies Bearer tokens
  - Reject requests with invalid or expired tokens with 401
  eval: \`npm test -- --grep "JWT middleware"\`

`;

const MULTI_TRACK_DRAFT = `# Conductor Plan: Build REST API with auth
Generated: 2026-04-18T11:00:00.000Z

## Track: auth-api
Description: Authentication endpoints and JWT middleware
Files: src/auth/**
Concurrency: 3

### Context
Owns all authentication code. Implements JWT issuance and verification.
Do NOT touch src/routes/ or src/models/.

### Tasks
- [ ] Add login endpoint
  - POST /auth/login accepts email + password
  - Returns signed JWT on success
  eval: \`npm test -- --grep "login endpoint"\`

- [ ] Add JWT verification middleware
  - Verifies Bearer token on protected routes
  eval: \`npx tsc --noEmit\`

## Track: data-api
Description: CRUD endpoints for core resources
Files: src/routes/**, src/models/**
Concurrency: 4

### Context
Owns route handlers and data models. Uses Prisma for DB access.
Do NOT touch src/auth/.

### Tasks
- [ ] Add users CRUD
  - GET /users, POST /users, DELETE /users/:id
  - Validate input with zod schemas
  eval: \`npm test -- --grep "users CRUD"\`

- [ ] Add pagination support
  - Support ?page and ?limit query params
  - Default page=1, limit=20
  eval: \`node -e "require('./dist/routes/users.js')"\`

- [ ] Add input validation
  - Reject missing required fields with 400
  eval: \`npm test -- --grep "input validation"\`

`;

const NO_CONCURRENCY_DRAFT = `# Conductor Plan: Quick fix
Generated: 2026-04-18T12:00:00.000Z

## Track: hotfix
Description: Fix the critical bug
Files: src/utils/**

### Context
Quick fix track. Only touches utility functions.

### Tasks
- [ ] Fix divide by zero
  - Add guard for zero denominator in calculate()
  eval: \`npm test\`

`;

// ---------------------------------------------------------------------------
// parsePlanDraft
// ---------------------------------------------------------------------------

describe("parsePlanDraft", () => {
	it("parses a single-track plan correctly", () => {
		const draft = parsePlanDraft(SINGLE_TRACK_DRAFT);
		assert.strictEqual(draft.goal, "Add authentication");
		assert.strictEqual(draft.generatedAt, "2026-04-18T10:00:00.000Z");
		assert.strictEqual(draft.tracks.length, 1);

		const track = draft.tracks[0];
		assert.ok(track !== undefined);
		assert.strictEqual(track.id, "auth");
		assert.strictEqual(track.description, "Handles JWT-based authentication middleware");
		assert.deepStrictEqual(track.files, ["src/auth/**", "src/middleware/**"]);
		assert.strictEqual(track.concurrency, 2);
		assert.ok(track.context.includes("JWT verification middleware"));
		assert.strictEqual(track.tasks.length, 1);
		assert.strictEqual(track.tasks[0]?.title, "Implement JWT middleware");
	});

	it("parses a multi-track plan correctly", () => {
		const draft = parsePlanDraft(MULTI_TRACK_DRAFT);
		assert.strictEqual(draft.goal, "Build REST API with auth");
		assert.strictEqual(draft.tracks.length, 2);

		const [auth, data] = draft.tracks;
		assert.ok(auth !== undefined);
		assert.ok(data !== undefined);

		assert.strictEqual(auth.id, "auth-api");
		assert.strictEqual(auth.tasks.length, 2);

		assert.strictEqual(data.id, "data-api");
		assert.strictEqual(data.tasks.length, 3);
	});

	it("extracts eval command from backtick format correctly", () => {
		const draft = parsePlanDraft(SINGLE_TRACK_DRAFT);
		const task = draft.tracks[0]?.tasks[0];
		assert.ok(task !== undefined);
		assert.strictEqual(task.eval, 'npm test -- --grep "JWT middleware"');
	});

	it("defaults concurrency to 3 when not specified", () => {
		const draft = parsePlanDraft(NO_CONCURRENCY_DRAFT);
		const track = draft.tracks[0];
		assert.ok(track !== undefined);
		assert.strictEqual(track.concurrency, 3);
	});

	it("handles empty files list gracefully", () => {
		const emptyFiles = `# Conductor Plan: Test
Generated: 2026-04-18T00:00:00.000Z

## Track: empty-files
Description: A track with no files
Files:
Concurrency: 1

### Context
No files.

### Tasks
- [ ] Do something
  eval: \`npm test\`

`;
		const draft = parsePlanDraft(emptyFiles);
		const track = draft.tracks[0];
		assert.ok(track !== undefined);
		assert.deepStrictEqual(track.files, []);
	});

	it("returns empty tasks array for a track with no tasks", () => {
		const noTasks = `# Conductor Plan: Empty
Generated: 2026-04-18T00:00:00.000Z

## Track: empty-track
Description: No tasks here
Files: src/**
Concurrency: 2

### Context
Empty track.

### Tasks

`;
		const draft = parsePlanDraft(noTasks);
		const track = draft.tracks[0];
		assert.ok(track !== undefined);
		assert.deepStrictEqual(track.tasks, []);
	});

	it("extracts goal from # Conductor Plan: line", () => {
		const draft = parsePlanDraft(MULTI_TRACK_DRAFT);
		assert.strictEqual(draft.goal, "Build REST API with auth");
	});
});

// ---------------------------------------------------------------------------
// formatTasksAsTodo
// ---------------------------------------------------------------------------

describe("formatTasksAsTodo", () => {
	it("formats a single task with eval correctly", () => {
		const tasks = [
			{
				title: "Add login endpoint",
				bullets: ["POST /auth/login accepts email + password", "Returns JWT on success"],
				eval: 'npm test -- --grep "login"',
			},
		];
		const out = formatTasksAsTodo(tasks);
		assert.ok(out.includes("- [ ] Add login endpoint"));
		assert.ok(out.includes("Add login endpoint"));
		assert.ok(out.includes("eval: `"));
		assert.ok(out.includes('npm test -- --grep "login"'));
	});

	it("formats multiple tasks with blank lines between them", () => {
		const tasks = [
			{ title: "Task one", bullets: ["do thing"], eval: "npm test" },
			{ title: "Task two", bullets: ["do other thing"], eval: "npm run lint" },
		];
		const out = formatTasksAsTodo(tasks);
		// eval comes before bullets so evalgate's key:value parser sees it before breaking
		assert.ok(out.includes("Task one\n  - eval: `npm test`\n  - do thing\n\n- [ ] Task two"));
	});

	it("handles task with no bullets", () => {
		const tasks = [{ title: "Simple task", bullets: [], eval: "npm test" }];
		const out = formatTasksAsTodo(tasks);
		assert.ok(out.includes("- [ ] Simple task"));
		assert.ok(out.includes("- eval: `npm test`"));
		// Should have exactly 1 line starting with "  - " (the eval line), no extra bullets
		const bulletLines = out.split("\n").filter((l) => /^ {2}- /.exec(l));
		assert.strictEqual(bulletLines.length, 1);
	});
});

// ---------------------------------------------------------------------------
// buildContextSnapshot
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "conductor-planner-"));
}

describe("buildContextSnapshot", () => {
	it("returns a string containing File Tree section", () => {
		const dir = makeTmpDir();
		try {
			writeFileSync(join(dir, "index.ts"), "export {};", "utf8");
			const snapshot = buildContextSnapshot(dir);
			assert.ok(snapshot.includes("=== File Tree ==="));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns a string containing the package name when package.json exists", () => {
		const dir = makeTmpDir();
		try {
			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify({ name: "my-test-app", version: "1.0.0", scripts: {}, dependencies: {} }),
				"utf8",
			);
			const snapshot = buildContextSnapshot(dir);
			assert.ok(snapshot.includes("my-test-app"), `Expected "my-test-app" in:\n${snapshot}`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips node_modules and .git directories in file tree", () => {
		const dir = makeTmpDir();
		try {
			// Create node_modules and .git dirs with files
			mkdirSync(join(dir, "node_modules", "some-pkg"), { recursive: true });
			writeFileSync(join(dir, "node_modules", "some-pkg", "index.js"), "", "utf8");

			mkdirSync(join(dir, ".git"), { recursive: true });
			writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main", "utf8");

			// Create a real source file
			mkdirSync(join(dir, "src"), { recursive: true });
			writeFileSync(join(dir, "src", "app.ts"), "export {};", "utf8");

			const snapshot = buildContextSnapshot(dir);
			assert.ok(!snapshot.includes("node_modules"), "Should not include node_modules");
			assert.ok(!snapshot.includes(".git/"), "Should not include .git/ directory");
			assert.ok(snapshot.includes("src/app.ts"), "Should include src/app.ts");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// applyPlan
// ---------------------------------------------------------------------------

// A minimal valid plan-draft.md using the parsePlanDraft format confirmed by
// existing fixture tests above.
const VALID_APPLY_DRAFT = `# Conductor Plan: Apply plan test
Generated: 2026-04-25T00:00:00.000Z

## Track: auth-service
Description: Authentication service
Files: src/auth/**
Concurrency: 2

### Context
This track owns authentication logic. Implements JWT signing and login endpoint.
Do NOT touch other packages.

### Tasks
- [ ] Implement JWT signing
  - Add jwt.sign() wrapper
  eval: \`test -f src/auth/jwt.ts\`

- [ ] Add login endpoint
  - POST /auth/login
  eval: \`true\`

`;

const MULTI_APPLY_DRAFT = `# Conductor Plan: Multi track apply
Generated: 2026-04-25T00:00:00.000Z

## Track: frontend
Description: React frontend
Files: src/ui/**
Concurrency: 1

### Context
Owns all UI code.

### Tasks
- [ ] Build login form
  eval: \`true\`

## Track: backend
Description: Node.js API
Files: src/api/**
Concurrency: 2

### Context
Owns all API code.

### Tasks
- [ ] Add auth endpoint
  eval: \`true\`

`;

describe("applyPlan", () => {
	it("should throw when no plan-draft.md exists", async () => {
		const dir = makeTmpDir();
		try {
			initConductor(dir);
			await assert.rejects(
				() => applyPlan(dir, false),
				/No plan draft found/,
				"should throw with a helpful message when draft is missing",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should throw when plan-draft.md is empty and has no tasks", async () => {
		const dir = makeTmpDir();
		try {
			initConductor(dir);
			// Write a draft with a track but zero tasks — parsePlanDraft returns tasks: []
			// and applyPlan guards: every track has zero tasks → invalid
			const emptyTaskDraft = `# Conductor Plan: Empty tasks
Generated: 2026-04-25T00:00:00.000Z

## Track: empty-track
Description: No tasks here
Files: src/**
Concurrency: 1

### Context
Empty track.

### Tasks

`;
			writeFileSync(join(dir, ".conductor", "plan-draft.md"), emptyTaskDraft, "utf8");
			await assert.rejects(
				() => applyPlan(dir, false),
				/invalid or empty/,
				"should throw when all tracks have zero tasks",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should not create track directories when dryRun is true", async () => {
		const dir = makeTmpDir();
		try {
			initConductor(dir);
			writeFileSync(join(dir, ".conductor", "plan-draft.md"), VALID_APPLY_DRAFT, "utf8");

			await applyPlan(dir, true);

			// Directory must NOT have been created for the track
			const trackDir = join(dir, ".conductor", "tracks", "auth-service");
			assert.ok(!existsSync(trackDir), "dryRun: true must not create the track directory");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should create todo.md and CONTEXT.md when dryRun is false", async () => {
		const dir = makeTmpDir();
		try {
			initConductor(dir);
			writeFileSync(join(dir, ".conductor", "plan-draft.md"), VALID_APPLY_DRAFT, "utf8");

			await applyPlan(dir, false);

			const trackDir = join(dir, ".conductor", "tracks", "auth-service");
			assert.ok(existsSync(join(trackDir, "todo.md")), "todo.md must be created");
			assert.ok(existsSync(join(trackDir, "CONTEXT.md")), "CONTEXT.md must be created");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should overwrite todo.md and CONTEXT.md on an existing track without throwing", async () => {
		const dir = makeTmpDir();
		try {
			initConductor(dir);
			writeFileSync(join(dir, ".conductor", "plan-draft.md"), VALID_APPLY_DRAFT, "utf8");

			// First apply — creates the track
			await applyPlan(dir, false);

			// Write a sentinel so we can confirm overwrite
			const trackDir = join(dir, ".conductor", "tracks", "auth-service");
			writeFileSync(join(trackDir, "todo.md"), "# old content", "utf8");

			// Second apply — track already exists, should overwrite instead of throwing
			await applyPlan(dir, false);

			// The old sentinel content must be gone (overwritten with real tasks)
			const { readFileSync } = await import("node:fs");
			const todo = readFileSync(join(trackDir, "todo.md"), "utf8");
			assert.ok(
				!todo.includes("# old content"),
				"todo.md should be overwritten, not left with old content",
			);
			assert.ok(todo.includes("Implement JWT signing"), "todo.md should contain the plan tasks");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should create all tracks when the plan contains multiple tracks", async () => {
		const dir = makeTmpDir();
		try {
			initConductor(dir);
			writeFileSync(join(dir, ".conductor", "plan-draft.md"), MULTI_APPLY_DRAFT, "utf8");

			await applyPlan(dir, false);

			const frontendTodo = join(dir, ".conductor", "tracks", "frontend", "todo.md");
			const backendTodo = join(dir, ".conductor", "tracks", "backend", "todo.md");

			assert.ok(existsSync(frontendTodo), "frontend/todo.md must be created");
			assert.ok(existsSync(backendTodo), "backend/todo.md must be created");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
