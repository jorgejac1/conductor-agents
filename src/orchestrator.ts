import { existsSync, readFileSync } from "node:fs";
import type { SwarmOptions, SwarmResult, SwarmState } from "evalgate";
import {
	getBudgetSummary,
	loadState,
	parseTodo,
	queryBudgetRecords,
	retryWorker,
	runSwarm,
	swarmEvents,
} from "evalgate";
import { loadConfig, trackContextPath, trackTodoPath } from "./config.js";
import { getTrack } from "./track.js";
import type { Track } from "./types.js";

export interface RunTrackOpts {
	concurrency?: number;
	agentCmd?: string;
	resume?: boolean;
	cwd?: string;
}

/** Emitted on swarmEvents when a track's accumulated spend exceeds its budget. */
export interface BudgetExceededEvent {
	type: "budget-exceeded";
	trackId: string;
	totalTokens: number;
	totalUsd: number;
	maxTokens?: number;
	maxUsd?: number;
}

export async function runTrack(id: string, opts: RunTrackOpts = {}): Promise<SwarmResult> {
	const cwd = opts.cwd ?? process.cwd();
	const track = getTrack(id, cwd);
	const config = loadConfig(cwd);

	const todoPath = trackTodoPath(id, cwd);
	const ctxPath = trackContextPath(id, cwd);
	const taskContext = existsSync(ctxPath) ? readFileSync(ctxPath, "utf8") : undefined;

	const resolvedAgentArgs = track.agentArgs ?? config?.defaults.agentArgs;
	const swarmOpts: SwarmOptions = {
		todoPath,
		concurrency: opts.concurrency ?? track.concurrency ?? config?.defaults.concurrency ?? 3,
		agentCmd: opts.agentCmd ?? track.agentCmd ?? config?.defaults.agentCmd ?? "claude",
		...(resolvedAgentArgs !== undefined && { agentArgs: resolvedAgentArgs }),
		...(taskContext !== undefined && { taskContext }),
		resume: opts.resume ?? false,
	};

	// Budget guardrail: check accumulated cost from previous runs before starting.
	// Also listen during the run to emit budget-exceeded events when limits are crossed.
	const hasBudgetLimit = track.maxTokens !== undefined || track.maxUsd !== undefined;
	let budgetExceededEmitted = false;

	function checkAndEmitBudget(): void {
		if (!hasBudgetLimit || budgetExceededEmitted) return;
		const records = queryBudgetRecords(todoPath);
		const totalTokens = records.reduce((sum, r) => sum + r.tokens, 0);
		// Blended Sonnet 4 estimate: $9/MTok
		const totalUsd = (totalTokens * 9) / 1_000_000;
		const tokensExceeded = track.maxTokens !== undefined && totalTokens >= track.maxTokens;
		const usdExceeded = track.maxUsd !== undefined && totalUsd >= track.maxUsd;
		if (tokensExceeded || usdExceeded) {
			budgetExceededEmitted = true;
			const evt: BudgetExceededEvent = {
				type: "budget-exceeded",
				trackId: id,
				totalTokens,
				totalUsd,
				...(track.maxTokens !== undefined ? { maxTokens: track.maxTokens } : {}),
				...(track.maxUsd !== undefined ? { maxUsd: track.maxUsd } : {}),
			};
			swarmEvents.emit("budget-exceeded", evt);
		}
	}

	// Listen for cost events emitted during the swarm run.
	function onCost(): void {
		checkAndEmitBudget();
	}

	if (hasBudgetLimit) {
		// Pre-run check in case we're already over budget from prior runs.
		checkAndEmitBudget();
		swarmEvents.on("cost", onCost);
	}

	try {
		return await runSwarm(swarmOpts);
	} finally {
		if (hasBudgetLimit) {
			swarmEvents.off("cost", onCost);
		}
	}
}

export async function retryTrackWorker(
	id: string,
	workerId: string,
	opts: { agentCmd?: string; cwd?: string } = {},
): Promise<void> {
	const cwd = opts.cwd ?? process.cwd();
	const track = getTrack(id, cwd);
	const config = loadConfig(cwd);
	const todoPath = trackTodoPath(id, cwd);
	const agentCmd = opts.agentCmd ?? track.agentCmd ?? config?.defaults.agentCmd ?? "claude";

	const ctxPath = trackContextPath(id, cwd);
	const taskContext = existsSync(ctxPath) ? readFileSync(ctxPath, "utf8") : undefined;

	// Resolve prefix to full worker ID
	const state = await loadState(todoPath);
	const match = state?.workers.find((w) => w.id.startsWith(workerId));
	if (!match) throw new Error(`worker not found: ${workerId}`);

	const resolvedAgentArgs = track.agentArgs ?? config?.defaults.agentArgs;
	await retryWorker(match.id, todoPath, {
		todoPath,
		agentCmd,
		...(resolvedAgentArgs !== undefined && { agentArgs: resolvedAgentArgs }),
		...(taskContext !== undefined && { taskContext }),
	});
}

export async function getTrackState(id: string, cwd = process.cwd()): Promise<SwarmState | null> {
	const todoPath = trackTodoPath(id, cwd);
	try {
		return await loadState(todoPath);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Track dependency helpers
// ---------------------------------------------------------------------------

/**
 * Detects a cycle in the track dependency graph using DFS.
 * Returns the cycle path as an array of track IDs, or null if no cycle exists.
 */
export function detectCycle(tracks: Track[]): string[] | null {
	const graph = new Map<string, string[]>();
	for (const t of tracks) {
		graph.set(t.id, t.dependsOn ?? []);
	}

	const visited = new Set<string>();
	const stack = new Set<string>();
	const path: string[] = [];

	function dfs(id: string): boolean {
		if (stack.has(id)) return true; // cycle detected
		if (visited.has(id)) return false;
		visited.add(id);
		stack.add(id);
		path.push(id);
		for (const dep of graph.get(id) ?? []) {
			if (dfs(dep)) return true;
		}
		path.pop();
		stack.delete(id);
		return false;
	}

	for (const t of tracks) {
		if (!visited.has(t.id)) {
			if (dfs(t.id)) return [...path];
		}
	}
	return null;
}

export async function runAll(
	opts: RunTrackOpts & { trackIds?: string[] } = {},
): Promise<Map<string, SwarmResult>> {
	const cwd = opts.cwd ?? process.cwd();
	const config = loadConfig(cwd);
	if (!config) throw new Error("No conductor config found. Run `conductor init` first.");

	const allTracks = config.tracks;
	const requestedIds = new Set(opts.trackIds ?? allTracks.map((t) => t.id));
	const tracks = allTracks.filter((t) => requestedIds.has(t.id));

	// Detect dependency cycles before starting any work.
	const cycle = detectCycle(allTracks);
	if (cycle) {
		throw new Error(`Dependency cycle detected: ${cycle.join(" → ")}`);
	}

	const results = new Map<string, SwarmResult>();
	// Tracks that were skipped because a dependency failed.
	const skipped = new Set<string>();

	// Build in-degree map (count of unsatisfied dependencies within the requested set).
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>(); // dep → tracks that depend on it
	for (const t of tracks) {
		const deps = (t.dependsOn ?? []).filter((d) => requestedIds.has(d));
		inDegree.set(t.id, deps.length);
		for (const d of deps) {
			const list = dependents.get(d) ?? [];
			list.push(t.id);
			dependents.set(d, list);
		}
	}

	// Topological-order execution: run all ready tracks in parallel each wave.
	const pending = new Set(tracks.map((t) => t.id));

	while (pending.size > 0) {
		// Ready = in pending set with in-degree 0, not skipped.
		const ready = [...pending].filter((id) => inDegree.get(id) === 0 && !skipped.has(id));

		if (ready.length === 0) {
			// All remaining tracks are either blocked or skipped.
			for (const id of pending) {
				if (!skipped.has(id)) {
					skipped.add(id);
				}
			}
			break;
		}

		// Run the ready wave in parallel.
		await Promise.allSettled(
			ready.map(async (id) => {
				pending.delete(id);
				try {
					const result = await runTrack(id, opts);
					results.set(id, result);

					// If this track had any failures, mark its dependents as skipped.
					if (result.failed > 0) {
						markSkipped(id, dependents, skipped, pending);
					}
				} catch (err) {
					// runTrack itself threw — treat as a failure.
					markSkipped(id, dependents, skipped, pending);
					throw err;
				}

				// Decrement in-degree for dependents.
				for (const dep of dependents.get(id) ?? []) {
					inDegree.set(dep, (inDegree.get(dep) ?? 1) - 1);
				}
			}),
		);
	}

	if (skipped.size > 0) {
		process.stderr.write(
			`conductor: ${skipped.size} track(s) skipped due to dependency failures: ${[...skipped].join(", ")}\n`,
		);
	}

	return results;
}

/** Recursively marks a track and all its transitive dependents as skipped. */
function markSkipped(
	id: string,
	dependents: Map<string, string[]>,
	skipped: Set<string>,
	pending: Set<string>,
): void {
	for (const dep of dependents.get(id) ?? []) {
		if (!skipped.has(dep)) {
			skipped.add(dep);
			pending.delete(dep);
			markSkipped(dep, dependents, skipped, pending);
		}
	}
}

export function getTrackCost(id: string, cwd = process.cwd()): ReturnType<typeof getBudgetSummary> {
	const todoPath = trackTodoPath(id, cwd);
	if (!existsSync(todoPath)) return [];
	const source = readFileSync(todoPath, "utf8");
	const contracts = parseTodo(source);
	return getBudgetSummary(todoPath, contracts);
}
