import { type RunTrackOpts, runAll, runTrack } from "../orchestrator.js";
import { c, parseFlags, positionalArgs } from "./helpers.js";

export async function cmdRun(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);

	const concurrency = flags.concurrency ? Number(flags.concurrency) : undefined;
	const agentCmd = typeof flags.agent === "string" ? flags.agent : undefined;
	const resume = flags.resume === true;

	if (flags.all) {
		try {
			console.log("Running all tracks…");
			const runOpts: RunTrackOpts = { resume };
			if (concurrency !== undefined) runOpts.concurrency = concurrency;
			if (agentCmd !== undefined) runOpts.agentCmd = agentCmd;
			const results = await runAll(runOpts);
			let exitCode = 0;
			for (const [id, result] of results) {
				const done = result.state.workers.filter((w) => w.status === "done").length;
				const failed = result.state.workers.filter((w) => w.status === "failed").length;
				const doneStr =
					done > 0 ? `${c.green}${done} done${c.reset}` : `${c.gray}${done} done${c.reset}`;
				const failedStr = failed > 0 ? `${c.red}${failed} failed${c.reset}` : `${failed} failed`;
				console.log(`  ${c.bold}${id}${c.reset}: ${doneStr}, ${failedStr}`);
				if (failed > 0) exitCode = 1;
			}
			return exitCode;
		} catch (err) {
			console.error(err instanceof Error ? err.message : String(err));
			return 1;
		}
	}

	const id = positional[0];
	if (!id) {
		console.error("Usage: conductor run <name> [--concurrency=N] [--resume] [--agent=cmd]");
		console.error("       conductor run --all");
		return 1;
	}

	try {
		console.log(`Running track "${c.bold}${id}${c.reset}"…`);
		const runOpts: RunTrackOpts = { resume };
		if (concurrency !== undefined) runOpts.concurrency = concurrency;
		if (agentCmd !== undefined) runOpts.agentCmd = agentCmd;
		const result = await runTrack(id, { ...runOpts, cwd: process.cwd() });
		const done = result.state.workers.filter((w) => w.status === "done").length;
		const failed = result.state.workers.filter((w) => w.status === "failed").length;
		const doneStr = done > 0 ? `${c.green}${done}${c.reset}` : String(done);
		const failedStr = failed > 0 ? `${c.red}${failed}${c.reset}` : String(failed);
		console.log(`Done: ${doneStr} workers completed, ${failedStr} failed`);
		return failed > 0 ? 1 : 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
