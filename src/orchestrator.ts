import { existsSync, readFileSync } from "node:fs";
import type { SwarmOptions, SwarmResult, SwarmState } from "evalgate";
import { getBudgetSummary, loadState, parseTodo, retryWorker, runSwarm } from "evalgate";
import { loadConfig, trackContextPath, trackTodoPath } from "./config.js";
import { getTrack } from "./track.js";

export interface RunTrackOpts {
	concurrency?: number;
	agentCmd?: string;
	resume?: boolean;
	cwd?: string;
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

	return runSwarm(swarmOpts);
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

export async function runAll(
	opts: RunTrackOpts & { trackIds?: string[] } = {},
): Promise<Map<string, SwarmResult>> {
	const cwd = opts.cwd ?? process.cwd();
	const config = loadConfig(cwd);
	if (!config) throw new Error("No conductor config found. Run `conductor init` first.");

	const ids = opts.trackIds ?? config.tracks.map((t) => t.id);
	const results = new Map<string, SwarmResult>();

	for (const id of ids) {
		const result = await runTrack(id, opts);
		results.set(id, result);
	}

	return results;
}

export function getTrackCost(id: string, cwd = process.cwd()): ReturnType<typeof getBudgetSummary> {
	const todoPath = trackTodoPath(id, cwd);
	if (!existsSync(todoPath)) return [];
	const source = readFileSync(todoPath, "utf8");
	const contracts = parseTodo(source);
	return getBudgetSummary(todoPath, contracts);
}
