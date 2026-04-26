import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadConfig } from "./config.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanDraftTask {
	title: string;
	bullets: string[];
	eval: string;
}

export interface PlanDraftTrack {
	id: string;
	description: string;
	files: string[];
	concurrency: number;
	context: string;
	tasks: PlanDraftTask[];
}

export interface PlanDraft {
	goal: string;
	generatedAt: string;
	tracks: PlanDraftTrack[];
}

// ── Context Snapshot ──────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".conductor",
	"coverage",
	".next",
]);

function collectFiles(dir: string, root: string, results: string[]): void {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}

	for (const entry of entries.sort()) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		let st: ReturnType<typeof statSync>;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			results.push(`${relative(root, full)}/`);
			collectFiles(full, root, results);
		} else {
			results.push(relative(root, full));
		}
	}
}

export function buildContextSnapshot(cwd: string): string {
	const parts: string[] = [];

	// File tree
	const files: string[] = [];
	collectFiles(cwd, cwd, files);
	const MAX_FILES = 400;
	let treeSection: string;
	if (files.length > MAX_FILES) {
		const truncated = files.slice(0, MAX_FILES);
		treeSection = `${truncated.join("\n")}\n... (${files.length - MAX_FILES} more files)`;
	} else {
		treeSection = files.join("\n");
	}
	parts.push(`=== File Tree ===\n${treeSection}`);

	// package.json
	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
			const name = typeof raw.name === "string" ? raw.name : "(unnamed)";
			const version = typeof raw.version === "string" ? raw.version : "";
			const scripts = raw.scripts as Record<string, string> | undefined;
			const deps = raw.dependencies as Record<string, string> | undefined;

			let scriptStr = "(none)";
			if (scripts) {
				const keys = Object.keys(scripts);
				if (keys.length <= 10) {
					scriptStr = keys.map((k) => `${k}: ${scripts[k]}`).join(", ");
				} else {
					scriptStr = keys.join(", ");
				}
			}

			const depStr = deps ? Object.keys(deps).join(", ") : "(none)";

			let pkgSection = `name: ${name}`;
			if (version) pkgSection += `\nversion: ${version}`;
			pkgSection += `\nscripts: ${scriptStr}`;
			pkgSection += `\ndependencies: ${depStr}`;
			parts.push(`=== package.json ===\n${pkgSection}`);
		} catch {
			parts.push("=== package.json ===\n(parse error)");
		}
	} else {
		parts.push("=== package.json ===\nNo package.json found");
	}

	// README.md
	const readmePath = join(cwd, "README.md");
	if (existsSync(readmePath)) {
		try {
			const readmeLines = readFileSync(readmePath, "utf8").split("\n").slice(0, 60);
			parts.push(`=== README (first 60 lines) ===\n${readmeLines.join("\n")}`);
		} catch {
			// skip if unreadable
		}
	}

	// Existing tracks
	const tracksDir = join(cwd, ".conductor", "tracks");
	if (existsSync(tracksDir)) {
		try {
			const trackIds = readdirSync(tracksDir).filter((e) => {
				try {
					return statSync(join(tracksDir, e)).isDirectory();
				} catch {
					return false;
				}
			});
			if (trackIds.length > 0) {
				const trackLines = trackIds
					.map((id) => `${id} (already exists — do not re-create)`)
					.join("\n");
				parts.push(`=== Existing conductor tracks ===\n${trackLines}`);
			}
		} catch {
			// skip
		}
	}

	return parts.join("\n\n");
}

// ── Generate Plan ─────────────────────────────────────────────────────────────

export async function generatePlan(goal: string, cwd: string, agentCmd: string): Promise<void> {
	const conductorDir = join(cwd, ".conductor");
	if (!existsSync(conductorDir)) {
		throw new Error("conductor not initialized. Run conductor init first.");
	}

	const contextSnapshot = buildContextSnapshot(cwd);
	const isoTimestamp = new Date().toISOString();

	const prompt = `You are a conductor-agents planning assistant. Your ONLY job is to write a plan file.

## Goal
${goal}

## What is conductor-agents?
conductor-agents orchestrates parallel AI agents (workers) across "tracks" — isolated work domains.

Each track has:
- CONTEXT.md: architecture context, owned files, coding conventions, what NOT to touch
- todo.md: eval-gated tasks — each task has an eval command (shell command that exits 0 when work is correct)

Tracks run in parallel. Workers within a track run concurrently (up to the concurrency limit).
Tracks MUST NOT have overlapping file ownership.

Good evals:
  eval: \`npm test -- --grep "feature name"\`
  eval: \`npx tsc --noEmit\`
  eval: \`node -e "require('./dist/index.js')"\`
Bad evals:
  eval: \`ls src/feature.ts\` (only checks existence, not correctness)
  eval: \`curl https://api.example.com\` (network — not deterministic)

## Project Context

${contextSnapshot}

## Your task
1. Use your tools to explore the codebase as needed
2. Design 1–4 tracks that together accomplish the goal below
3. Write your plan ONLY to .conductor/plan-draft.md using EXACTLY this format:

---
# Conductor Plan: ${goal}
Generated: ${isoTimestamp}

## Track: {track-id}
Description: {one line — what this track is responsible for}
Files: {glob1}, {glob2}
Concurrency: {number 1-5}

### Context
{Full CONTEXT.md content for this track: architecture decisions, owned files, conventions, what NOT to touch. 100-300 words.}

### Tasks
- [ ] {task title}
  - {what to do — bullet 1}
  - {what to do — bullet 2}
  eval: \`{deterministic shell command}\`

- [ ] {task title 2}
  - {what to do}
  eval: \`{shell command}\`

---

## Track: {track-id-2}
...

---

## STRICT RULES
- Track IDs: lowercase slugs only (e.g. auth-api, frontend-ui, data-pipeline)
- File ownership must NOT overlap between tracks
- Every task MUST have an eval: line with a shell command in backticks
- Do NOT modify any source files
- Do NOT create commits
- Do NOT create any files other than .conductor/plan-draft.md
- Write the complete plan in a single write to .conductor/plan-draft.md
`;

	const promptFile = join(tmpdir(), `conductor-plan-${Date.now()}.md`);
	writeFileSync(promptFile, prompt, "utf8");

	console.log("Planning… (agent is exploring your codebase)");
	console.log("This may take a minute or two.");

	const proc = spawn(agentCmd, [], { cwd, stdio: ["pipe", "inherit", "inherit"] });

	await new Promise<void>((resolve, reject) => {
		proc.stdin.write(prompt, "utf8");
		proc.stdin.end();

		proc.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`Planning agent exited with code ${String(code)}`));
			} else {
				resolve();
			}
		});

		proc.on("error", (err) => {
			reject(err);
		});
	});

	const draftPath = join(cwd, ".conductor", "plan-draft.md");
	if (!existsSync(draftPath)) {
		throw new Error(
			"Agent did not write .conductor/plan-draft.md — try again or write the plan manually.",
		);
	}

	const draftContent = readFileSync(draftPath, "utf8");
	const draft = parsePlanDraft(draftContent);

	console.log(`\n✓ Plan written to .conductor/plan-draft.md\n`);
	console.log(`Tracks planned: ${draft.tracks.length}`);
	for (const track of draft.tracks) {
		console.log(`  - ${track.id}: ${track.tasks.length} tasks`);
	}
	console.log(`\nReview the plan, then run: conductor plan apply`);
}

// ── Parse Plan Draft ──────────────────────────────────────────────────────────

export function parsePlanDraft(content: string): PlanDraft {
	// Extract goal
	let goal = "";
	const goalMatch = /^# Conductor Plan:\s*(.+)$/m.exec(content);
	if (goalMatch?.[1]) {
		goal = goalMatch[1].trim();
	}

	// Extract generated timestamp
	let generatedAt = "";
	const generatedMatch = /^Generated:\s*(.+)$/m.exec(content);
	if (generatedMatch?.[1]) {
		generatedAt = generatedMatch[1].trim();
	}

	// Split into track sections
	const trackSections = content.split(/^## Track:/m).slice(1);
	const tracks: PlanDraftTrack[] = [];

	for (const section of trackSections) {
		const lines = section.split("\n");
		const id = (lines[0] ?? "").trim();
		if (!id) continue;

		// Description
		let description = "";
		const descMatch = /^Description:[ \t]*(.+)$/m.exec(section);
		if (descMatch?.[1]) {
			description = descMatch[1].trim();
		}

		// Files
		let files: string[] = [];
		const filesMatch = /^Files:[ \t]*(.*)$/m.exec(section);
		if (filesMatch?.[1]) {
			files = filesMatch[1]
				.split(",")
				.map((f) => f.trim())
				.filter(Boolean);
		}

		// Concurrency
		let concurrency = 3;
		const concMatch = /^Concurrency:[ \t]*(\d+)$/m.exec(section);
		if (concMatch?.[1]) {
			const parsed = Number.parseInt(concMatch[1], 10);
			if (!Number.isNaN(parsed) && parsed > 0) {
				concurrency = parsed;
			}
		}

		// Context section (between ### Context and ### Tasks)
		let context = "";
		const contextMatch = /### Context\n([\s\S]*?)(?=###|$)/.exec(section);
		if (contextMatch?.[1]) {
			context = contextMatch[1].trim();
		}

		// Tasks section
		const tasks: PlanDraftTask[] = [];
		const tasksSectionMatch = /### Tasks\n([\s\S]*)$/.exec(section);
		if (tasksSectionMatch?.[1]) {
			const tasksSection = tasksSectionMatch[1];
			// Split on "- [ ]" task markers
			const taskBlocks = tasksSection.split(/^- \[ \]/m).slice(1);
			for (const block of taskBlocks) {
				const blockLines = block.split("\n");
				const title = (blockLines[0] ?? "").trim();
				const bullets: string[] = [];
				let evalCmd = "";

				for (const line of blockLines.slice(1)) {
					const evalMatch = /^\s+(?:- )?eval:\s+`([^`]+)`/.exec(line);
					if (evalMatch?.[1]) {
						evalCmd = evalMatch[1].trim();
						continue; // don't also add eval line to bullets
					}
					const bulletMatch = /^ {2}- (.+)$/.exec(line);
					if (bulletMatch?.[1]) {
						bullets.push(bulletMatch[1].trim());
					}
				}

				tasks.push({ title, bullets, eval: evalCmd });
			}
		}

		tracks.push({ id, description, files, concurrency, context, tasks });
	}

	return { goal, generatedAt, tracks };
}

// ── Format Tasks as Todo ──────────────────────────────────────────────────────

export function formatTasksAsTodo(tasks: PlanDraftTask[]): string {
	return tasks
		.map((task) => {
			const lines: string[] = [`- [ ] ${task.title}`];
			// eval MUST come first — evalgate's parser breaks on the first non-key:value bullet
			lines.push(`  - eval: \`${task.eval}\``);
			for (const bullet of task.bullets) {
				lines.push(`  - ${bullet}`);
			}
			return lines.join("\n");
		})
		.join("\n\n");
}

// ── Diff Plan ────────────────────────────────────────────────────────────────

export interface PlanDiff {
	added: string[];
	removed: string[];
	changed: Array<{
		id: string;
		taskDelta: { added: number; removed: number };
		filesChanged: boolean;
	}>;
}

/** Compare a plan draft against the current conductor config and return a structured diff. */
export function diffPlan(cwd: string, draft: PlanDraft): PlanDiff {
	const config = loadConfig(cwd);
	const existing = new Map((config?.tracks ?? []).map((t) => [t.id, t]));
	const incoming = new Map(draft.tracks.map((t) => [t.id, t]));

	const added = draft.tracks.filter((t) => !existing.has(t.id)).map((t) => t.id);

	const removed = (config?.tracks ?? []).filter((t) => !incoming.has(t.id)).map((t) => t.id);

	const changed: PlanDiff["changed"] = [];
	for (const draftTrack of draft.tracks) {
		const curr = existing.get(draftTrack.id);
		if (!curr) continue; // added — not changed
		const existingTodo = existsSync(join(cwd, ".conductor", "tracks", draftTrack.id, "todo.md"))
			? readFileSync(join(cwd, ".conductor", "tracks", draftTrack.id, "todo.md"), "utf8")
			: "";
		const existingTasks =
			parsePlanDraft(
				`# Conductor Plan: existing\nGenerated: x\n## Track: ${draftTrack.id}\nDescription: x\nFiles: x\nConcurrency: 1\n### Context\nx\n### Tasks\n${existingTodo}`,
			).tracks[0]?.tasks ?? [];
		const filesChanged = (curr.files ?? []).join(",") !== draftTrack.files.join(",");
		const addedTasks = draftTrack.tasks.length - existingTasks.length;
		if (filesChanged || addedTasks !== 0) {
			changed.push({
				id: draftTrack.id,
				taskDelta: { added: Math.max(0, addedTasks), removed: Math.max(0, -addedTasks) },
				filesChanged,
			});
		}
	}

	return { added, removed, changed };
}

// ── Generate Plan Iterate ─────────────────────────────────────────────────────

/**
 * Reads the last run's failure logs for all tracks, builds a failure context,
 * and re-prompts the planner to generate a revised plan draft.
 *
 * Returns true if failures were found and a new draft was generated; false if
 * no failures exist to iterate on.
 */
export async function generatePlanIterate(cwd: string, agentCmd?: string): Promise<boolean> {
	const { loadConfig, trackTodoPath } = await import("./config.js");
	const { queryRuns, loadState } = await import("evalgate");

	const config = loadConfig(cwd);
	if (!config) throw new Error("No conductor config found.");

	const failureLines: string[] = [];

	for (const track of config.tracks) {
		const todoPath = trackTodoPath(track.id, cwd);
		const state = await loadState(todoPath);
		if (!state) continue;

		const failedWorkers = state.workers.filter((w) => w.status === "failed");
		for (const w of failedWorkers) {
			const record = queryRuns(todoPath, { contractId: w.contractId, passed: false, limit: 1 })[0];
			const reason = w.failureKind ?? "unknown";
			const detail = record ? ` — eval output: "${record.stdout.slice(0, 120)}"` : "";
			failureLines.push(`  ${track.id}/${w.id.slice(0, 8)}: ${reason}${detail}`);
		}
	}

	if (failureLines.length === 0) return false;

	const goal = `Review these worker failures and revise the task breakdown to fix them:\n${failureLines.join("\n")}`;
	const cmd = agentCmd ?? config.defaults.agentCmd ?? "claude";
	await generatePlan(goal, cwd, cmd);
	return true;
}

// ── Apply Plan ────────────────────────────────────────────────────────────────

export async function applyPlan(cwd: string, dryRun: boolean): Promise<void> {
	const draftPath = join(cwd, ".conductor", "plan-draft.md");
	if (!existsSync(draftPath)) {
		throw new Error('No plan draft found. Run: conductor plan "<goal>" first');
	}

	const content = readFileSync(draftPath, "utf8");
	const draft = parsePlanDraft(content);

	if (draft.tracks.length === 0 || draft.tracks.every((t) => t.tasks.length === 0)) {
		throw new Error("Plan draft appears invalid or empty.");
	}

	if (dryRun) {
		console.log("Dry run — would create:\n");
		for (const track of draft.tracks) {
			console.log(`  Track: ${track.id}`);
			console.log(`    .conductor/tracks/${track.id}/CONTEXT.md`);
			console.log(`    .conductor/tracks/${track.id}/todo.md  (${track.tasks.length} tasks)`);
			console.log("");
		}
		console.log("Run without --dry-run to apply.");
		return;
	}

	const { createTrack } = await import("./track.js");

	for (const track of draft.tracks) {
		// createTrack throws if track already exists — catch to allow overwriting
		try {
			createTrack(track.id, track.description, track.files, cwd);
		} catch (err) {
			// Track may already exist — proceed to overwrite files
			const msg = err instanceof Error ? err.message : String(err);
			if (!msg.includes("already exists")) {
				throw err;
			}
		}

		const trackDir = join(cwd, ".conductor", "tracks", track.id);
		mkdirSync(trackDir, { recursive: true });

		writeFileSync(join(trackDir, "CONTEXT.md"), track.context, "utf8");
		writeFileSync(join(trackDir, "todo.md"), formatTasksAsTodo(track.tasks), "utf8");
	}

	console.log(`✓ Created ${draft.tracks.length} tracks:`);
	for (const track of draft.tracks) {
		console.log(`  - ${track.id} (${track.tasks.length} tasks)`);
	}
	console.log("\nNext: conductor run --all");
}
