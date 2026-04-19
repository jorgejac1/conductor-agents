import { retryTrackWorker } from "../orchestrator.js";
import { c, parseFlags, positionalArgs } from "./helpers.js";

export async function cmdRetry(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	const workerId = positional[0];
	const trackId = positional[1];

	if (!workerId || !trackId) {
		console.error("Usage: conductor retry <worker-id> <track>");
		return 1;
	}

	const agentCmd = typeof flags.agent === "string" ? flags.agent : undefined;

	try {
		console.log(`Retrying worker ${c.bold}${workerId}${c.reset} in track "${trackId}"…`);
		const retryOpts: { agentCmd?: string } = {};
		if (agentCmd !== undefined) retryOpts.agentCmd = agentCmd;
		await retryTrackWorker(trackId, workerId, retryOpts);
		console.log(`${c.green}✓${c.reset} Retry complete`);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
