import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SwarmOptions, SwarmResult, SwarmState } from "evalgate";
import {
	estimateUsd,
	getBudgetSummary,
	loadState,
	parseTodo,
	queryBudgetRecords,
	retryWorker,
	runSwarm,
} from "evalgate";

export type { BudgetExceededEvent } from "evalgate";

import { loadConfig, trackContextPath, trackTodoPath } from "./config.js";
import { buildRunner } from "./runners/index.js";
import { getTrack } from "./track.js";
import type { Track } from "./types.js";

export interface RunTrackOpts {
	concurrency?: number;
	agentCmd?: string;
	resume?: boolean;
	cwd?: string;
}

// Map of trackId → AbortController for in-flight runSwarm calls.
// Allows pauseTrack to abort new-worker spawning without killing in-flight workers.
const activeControllers = new Map<string, AbortController>();

/**
 * Split a raw agentCmd string (e.g. "claude --dangerously-skip-permissions")
 * into a binary name and an optional extra-flags array to prepend to agentArgs.
 * Node's spawn() requires the binary and args to be separate — it does not
 * interpret shell metacharacters, so "claude --flag" would fail with ENOENT.
 */
function resolveAgentCmd(raw: string): { cmd: string; extraFlags: string[] } {
	const parts = raw.trim().split(/\s+/);
	return { cmd: parts[0] ?? "claude", extraFlags: parts.slice(1) };
}

/**
 * Merge extra flags from agentCmd splitting with any explicitly configured
 * agentArgs. When flags are present the full default Claude args must be
 * included because evalgate replaces its defaults with agentArgs entirely.
 */
function buildAgentArgs(
	extraFlags: string[],
	resolvedAgentArgs: string[] | undefined,
): string[] | undefined {
	if (extraFlags.length === 0) return resolvedAgentArgs;
	const base = resolvedAgentArgs ?? ["--print", "--output-format", "json", "{task}"];
	return [...extraFlags, ...base];
}

function pauseMarkerPath(id: string, cwd: string): string {
	return join(cwd, ".conductor", "tracks", id, "PAUSED");
}

function writePauseMarker(
	id: string,
	cwd: string,
	reason: { totalTokens: number; estimatedUsd: number },
): void {
	try {
		writeFileSync(
			pauseMarkerPath(id, cwd),
			JSON.stringify({ ts: new Date().toISOString(), ...reason }),
		);
	} catch {
		/* best-effort */
	}
}

function clearPauseMarker(id: string, cwd: string): void {
	try {
		rmSync(pauseMarkerPath(id, cwd), { force: true });
	} catch {
		/* best-effort */
	}
}

export function isPaused(id: string, cwd = process.cwd()): boolean {
	return existsSync(pauseMarkerPath(id, cwd));
}

export function pauseTrack(id: string, cwd = process.cwd()): boolean {
	const controller = activeControllers.get(id);
	if (controller) {
		controller.abort();
	}
	// Always write the marker so idle tracks can be pre-paused before their next run.
	writePauseMarker(id, cwd, { totalTokens: 0, estimatedUsd: 0 });
	return true;
}

export async function resumeTrack(id: string, opts: RunTrackOpts = {}): Promise<SwarmResult> {
	const cwd = opts.cwd ?? process.cwd();
	clearPauseMarker(id, cwd);
	// If the swarm is still actively running (in-flight workers from a live pause),
	// just clear the pause marker and let those workers finish. Starting a competing
	// runSwarm would reset in-flight workers to "pending" and try to recreate their
	// worktrees while the originals are still mounted — causing SETUP failures.
	if (activeControllers.has(id)) {
		return { done: 0, failed: 0, skipped: 0, state: { id: "", ts: "", todoPath: "", workers: [] } };
	}
	return runTrack(id, { ...opts, resume: true, cwd });
}

export async function runTrack(id: string, opts: RunTrackOpts = {}): Promise<SwarmResult> {
	const cwd = opts.cwd ?? process.cwd();
	const track = getTrack(id, cwd);
	const config = loadConfig(cwd);

	const todoPath = trackTodoPath(id, cwd);
	const ctxPath = trackContextPath(id, cwd);
	const taskContext = existsSync(ctxPath) ? readFileSync(ctxPath, "utf8") : undefined;

	const rawCmd = opts.agentCmd ?? track.agentCmd ?? config?.defaults.agentCmd ?? "claude";
	const { cmd: agentCmd, extraFlags } = resolveAgentCmd(rawCmd);
	const resolvedAgentArgs = buildAgentArgs(
		extraFlags,
		track.agentArgs ?? config?.defaults.agentArgs,
	);

	const controller = new AbortController();
	activeControllers.set(id, controller);

	// Budget guardrail — wired via evalgate's onBudgetExceeded hook so the abort
	// propagates inside runSwarm rather than just emitting an event after the fact.
	const hasBudgetLimit = track.maxTokens !== undefined || track.maxUsd !== undefined;

	function checkBudgetBeforeRun(): void {
		if (!hasBudgetLimit) return;
		const records = queryBudgetRecords(todoPath);
		const totalInput = records.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
		const totalOutput = records.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
		const totalTokens = records.reduce((s, r) => s + r.tokens, 0);
		const totalUsd = estimateUsd(totalInput, totalOutput);
		const tokensExceeded = track.maxTokens !== undefined && totalTokens >= track.maxTokens;
		const usdExceeded = track.maxUsd !== undefined && totalUsd >= track.maxUsd;
		if (tokensExceeded || usdExceeded) {
			controller.abort();
			writePauseMarker(id, cwd, { totalTokens, estimatedUsd: totalUsd });
		}
	}

	// Pre-run check in case we're already over budget from a prior run.
	checkBudgetBeforeRun();

	const swarmOpts: SwarmOptions = {
		todoPath,
		concurrency: opts.concurrency ?? track.concurrency ?? config?.defaults.concurrency ?? 3,
		agentCmd,
		...(resolvedAgentArgs !== undefined && { agentArgs: resolvedAgentArgs }),
		...(taskContext !== undefined && { taskContext }),
		resume: opts.resume ?? false,
		signal: controller.signal,
		runner: buildRunner(track),
		// Check budget after each worker completes and abort the remaining queue if
		// the track limit is exceeded. onBudgetExceeded only fires for contract-level
		// budgets set on the Contract object; track-level budgets (maxTokens/maxUsd in
		// config.json) are conductor-owned, so we check them here instead.
		...(hasBudgetLimit && {
			onWorkerComplete(_worker) {
				const records = queryBudgetRecords(todoPath);
				const totalTokens = records.reduce((s, r) => s + r.tokens, 0);
				const totalInput = records.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
				const totalOutput = records.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
				const usd = estimateUsd(totalInput, totalOutput);
				const tokensExceeded = track.maxTokens !== undefined && totalTokens >= track.maxTokens;
				const usdExceeded = track.maxUsd !== undefined && usd >= track.maxUsd;
				if (tokensExceeded || usdExceeded) {
					controller.abort();
					writePauseMarker(id, cwd, { totalTokens, estimatedUsd: usd });
				}
			},
		}),
	};

	try {
		return await runSwarm(swarmOpts);
	} finally {
		activeControllers.delete(id);
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
	const rawCmd = opts.agentCmd ?? track.agentCmd ?? config?.defaults.agentCmd ?? "claude";
	const { cmd: agentCmd, extraFlags } = resolveAgentCmd(rawCmd);
	const resolvedAgentArgs = buildAgentArgs(
		extraFlags,
		track.agentArgs ?? config?.defaults.agentArgs,
	);

	const ctxPath = trackContextPath(id, cwd);
	const taskContext = existsSync(ctxPath) ? readFileSync(ctxPath, "utf8") : undefined;

	// Resolve prefix to full worker ID
	const state = await loadState(todoPath);
	const match = state?.workers.find((w) => w.id.startsWith(workerId));
	if (!match) throw new Error(`worker not found: ${workerId}`);

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

/**
 * Aggregate token spend for a track and return a { totalTokens, estimatedUsd } summary.
 * Uses per-record input/output split when available for accurate Sonnet 4 pricing.
 */
export function getTrackSpend(
	id: string,
	cwd = process.cwd(),
): { totalTokens: number; estimatedUsd: number } {
	const todoPath = trackTodoPath(id, cwd);
	if (!existsSync(todoPath)) return { totalTokens: 0, estimatedUsd: 0 };
	const records = queryBudgetRecords(todoPath);
	const totalTokens = records.reduce((s, r) => s + r.tokens, 0);
	const totalInput = records.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
	const totalOutput = records.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
	// If split tokens are available, use them; otherwise use blended estimate (half/half).
	const estimatedUsd =
		totalInput + totalOutput > 0
			? estimateUsd(totalInput, totalOutput)
			: estimateUsd(totalTokens / 2, totalTokens / 2);
	return { totalTokens, estimatedUsd };
}
