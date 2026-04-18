import type { SwarmOptions, SwarmResult, SwarmState } from "evalgate";
import { loadState, retryWorker, runSwarm, swarmEvents } from "evalgate";
import { tentacleTodoPath } from "./config.js";
import { getTentacle } from "./tentacle.js";

export interface RunTentacleOpts {
	concurrency?: number;
	agentCmd?: string;
	resume?: boolean;
	cwd?: string;
}

export async function runTentacle(id: string, opts: RunTentacleOpts = {}): Promise<SwarmResult> {
	const cwd = opts.cwd ?? process.cwd();
	const tentacle = getTentacle(id, cwd);

	const todoPath = tentacleTodoPath(id, cwd);
	const swarmOpts: SwarmOptions = {
		todoPath,
		concurrency: opts.concurrency ?? tentacle.concurrency ?? 3,
		agentCmd: opts.agentCmd ?? tentacle.agentCmd ?? "claude",
		resume: opts.resume ?? false,
	};

	return runSwarm(swarmOpts);
}

export async function retryTentacleWorker(
	id: string,
	workerId: string,
	opts: { agentCmd?: string; cwd?: string } = {},
): Promise<void> {
	const cwd = opts.cwd ?? process.cwd();
	const tentacle = getTentacle(id, cwd);
	const todoPath = tentacleTodoPath(id, cwd);
	const agentCmd = opts.agentCmd ?? tentacle.agentCmd ?? "claude";

	// Resolve prefix to full worker ID
	const state = await loadState(todoPath);
	const match = state?.workers.find((w) => w.id.startsWith(workerId));
	if (!match) throw new Error(`worker not found: ${workerId}`);

	await retryWorker(match.id, todoPath, { todoPath, agentCmd });
}

export async function getTentacleState(
	id: string,
	cwd = process.cwd(),
): Promise<SwarmState | null> {
	const todoPath = tentacleTodoPath(id, cwd);
	try {
		return await loadState(todoPath);
	} catch {
		return null;
	}
}

export async function runAll(
	opts: RunTentacleOpts & { tentacleIds?: string[] } = {},
): Promise<Map<string, SwarmResult>> {
	const cwd = opts.cwd ?? process.cwd();
	const { loadConfig } = await import("./config.js");
	const config = loadConfig(cwd);
	if (!config) throw new Error("No conductor config found. Run `conductor init` first.");

	const ids = opts.tentacleIds ?? config.tentacles.map((t) => t.id);
	const results = new Map<string, SwarmResult>();

	for (const id of ids) {
		const result = await runTentacle(id, opts);
		results.set(id, result);
	}

	return results;
}

export { swarmEvents };
