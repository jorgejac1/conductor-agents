import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadState, queryBudgetRecords } from "evalgate";
import {
	configDir,
	loadConfig,
	saveConfig,
	trackContextPath,
	trackDir,
	trackTodoPath,
} from "./config.js";
import type { ConductorConfig, Track, TrackStatus } from "./types.js";

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function parseTodoProgress(todoMd: string): { total: number; pending: number; done: number } {
	const lines = todoMd.split("\n");
	let total = 0;
	let done = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("- [x]") || trimmed.startsWith("- [ ]")) {
			total++;
			if (trimmed.startsWith("- [x]")) done++;
		}
	}
	return { total, pending: total - done, done };
}

export function createTrack(
	name: string,
	description: string,
	files: string[],
	cwd = process.cwd(),
	dependsOn?: string[],
): Track {
	const id = slugify(name);
	const config = loadConfig(cwd) ?? {
		tracks: [],
		defaults: { concurrency: 3, agentCmd: "claude" },
	};

	if (config.tracks.some((t) => t.id === id)) {
		throw new Error(`Track "${id}" already exists`);
	}

	// Validate that all dependsOn IDs exist.
	if (dependsOn && dependsOn.length > 0) {
		const existingIds = new Set(config.tracks.map((t) => t.id));
		for (const dep of dependsOn) {
			if (!existingIds.has(dep)) {
				throw new Error(`dependsOn: track "${dep}" does not exist`);
			}
		}
	}

	const dir = trackDir(id, cwd);
	mkdirSync(dir, { recursive: true });

	const filesSection =
		files.length > 0 ? files.map((f) => `- \`${f}\``).join("\n") : "- (none specified)";

	const contextMd = `# ${name}

${description}

## Owned files
${filesSection}

## Constraints
<!-- Add constraints for agents working on this area -->
`;

	const todoMd = `# ${name} — Tasks

<!-- Add eval-gated tasks below -->
<!-- - [ ] Task title -->
<!--   - eval: \`your verifier command\` -->
`;

	writeFileSync(trackContextPath(id, cwd), contextMd, "utf8");
	writeFileSync(trackTodoPath(id, cwd), todoMd, "utf8");

	const track: Track = {
		id,
		name,
		description,
		files,
		...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
	};
	config.tracks.push(track);
	saveConfig(config, cwd);

	return track;
}

export function deleteTrack(id: string, cwd = process.cwd()): void {
	const config = loadConfig(cwd);
	if (!config) throw new Error("No conductor config found. Run `conductor init` first.");

	const idx = config.tracks.findIndex((t) => t.id === id);
	if (idx === -1) throw new Error(`Track "${id}" not found`);

	const dir = trackDir(id, cwd);
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

	config.tracks.splice(idx, 1);
	saveConfig(config, cwd);
}

export async function listTracks(cwd = process.cwd()): Promise<TrackStatus[]> {
	const config = loadConfig(cwd);
	if (!config) return [];

	const results: TrackStatus[] = [];
	for (const track of config.tracks) {
		const todoPath = trackTodoPath(track.id, cwd);
		let todoTotal = 0;
		let todoPending = 0;
		let todoDone = 0;

		let swarmState = null;
		try {
			swarmState = await loadState(todoPath);
		} catch {
			// no swarm state yet
		}

		if (swarmState) {
			// Derive progress from worker outcomes — workers run in isolated worktrees
			// and never modify the original todo.md, so markdown checkbox parsing is useless.
			// Count both done and failed as "completed" so the progress bar advances
			// as the run progresses rather than staying at 0 when tasks fail.
			todoTotal = swarmState.workers.length;
			todoDone = swarmState.workers.filter(
				(w) => w.status === "done" || w.status === "failed",
			).length;
			todoPending = todoTotal - todoDone;
		} else if (existsSync(todoPath)) {
			// No run yet — count unchecked tasks in todo.md as a pre-run estimate
			const src = readFileSync(todoPath, "utf8");
			const prog = parseTodoProgress(src);
			todoTotal = prog.total;
			todoPending = prog.pending;
			todoDone = prog.done;
		}

		const budgetRecords = queryBudgetRecords(todoPath);
		const totalTokens = budgetRecords.reduce((sum, r) => sum + r.tokens, 0);
		// Blended Sonnet 4 estimate: $9/MTok (midpoint of $3 input / $15 output)
		const estimatedUsd = (totalTokens * 9) / 1_000_000;

		results.push({
			track,
			todoTotal,
			todoPending,
			todoDone,
			swarmState,
			...(totalTokens > 0 ? { cost: { totalTokens, estimatedUsd } } : {}),
		});
	}
	return results;
}

export function getTrack(id: string, cwd = process.cwd()): Track {
	const config = loadConfig(cwd);
	if (!config) throw new Error("No conductor config found. Run `conductor init` first.");
	const t = config.tracks.find((t) => t.id === id);
	if (!t) throw new Error(`Track "${id}" not found`);
	return t;
}

export function initConductor(cwd = process.cwd()): void {
	const existing = loadConfig(cwd);
	if (existing) throw new Error("Conductor already initialized in this directory");

	const dir = configDir(cwd);
	mkdirSync(dir, { recursive: true });

	const initial: ConductorConfig = {
		tracks: [],
		defaults: { concurrency: 3, agentCmd: "claude" },
	};
	saveConfig(initial, cwd);
}
