#!/usr/bin/env node
/**
 * conductor CLI
 *
 * conductor init
 * conductor add <name> [--desc="..."] [--files="glob"]
 * conductor rm <name>
 * conductor list
 * conductor run <name> [--concurrency=N] [--resume] [--agent=cmd]
 * conductor run --all
 * conductor retry <worker-id> <tentacle>
 * conductor status [name]
 * conductor ui [--port=8080]
 * conductor help
 */

import { resolve } from "node:path";
import {
	getTentacleState,
	type RunTentacleOpts,
	retryTentacleWorker,
	runAll,
	runTentacle,
} from "./orchestrator.js";
import { startServer } from "./server.js";
import {
	createTentacle,
	deleteTentacle,
	getTentacle,
	initConductor,
	listTentacles,
} from "./tentacle.js";

function parseFlags(args: string[]): Record<string, string | boolean> {
	const flags: Record<string, string | boolean> = {};
	for (const arg of args) {
		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			if (eq !== -1) {
				flags[arg.slice(2, eq)] = arg.slice(eq + 1);
			} else {
				flags[arg.slice(2)] = true;
			}
		}
	}
	return flags;
}

function positionalArgs(args: string[]): string[] {
	return args.filter((a) => !a.startsWith("--"));
}

async function cmdInit(): Promise<number> {
	try {
		initConductor();
		console.log("✓ Initialized .conductor/ in current directory");
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

async function cmdAdd(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	const name = positional[0];

	if (!name) {
		console.error('Usage: conductor add <name> [--desc="description"] [--files="glob"]');
		return 1;
	}

	const description = typeof flags["desc"] === "string" ? flags["desc"] : "";
	const filesFlag = typeof flags["files"] === "string" ? flags["files"] : "";
	const files = filesFlag ? filesFlag.split(",").map((f) => f.trim()) : [];

	try {
		const tentacle = createTentacle(name, description, files);
		console.log(`✓ Created tentacle "${tentacle.id}"`);
		console.log(`  CONTEXT.md → .conductor/tentacles/${tentacle.id}/CONTEXT.md`);
		console.log(`  todo.md    → .conductor/tentacles/${tentacle.id}/todo.md`);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

async function cmdRm(args: string[]): Promise<number> {
	const positional = positionalArgs(args);
	const id = positional[0];

	if (!id) {
		console.error("Usage: conductor rm <name>");
		return 1;
	}

	try {
		deleteTentacle(id);
		console.log(`✓ Deleted tentacle "${id}"`);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

async function cmdList(): Promise<number> {
	try {
		const statuses = await listTentacles();
		if (!statuses.length) {
			console.log("No tentacles. Run `conductor add <name>` to create one.");
			return 0;
		}
		for (const ts of statuses) {
			const pct = ts.todoTotal > 0 ? Math.round((ts.todoDone / ts.todoTotal) * 100) : 0;
			const bar = buildProgressBar(pct, 20);
			const workers = ts.swarmState ? ts.swarmState.workers.length : 0;
			console.log(
				`${ts.tentacle.id.padEnd(20)} ${bar} ${ts.todoDone}/${ts.todoTotal} tasks  ${workers} workers`,
			);
			if (ts.tentacle.description) {
				console.log(`${"".padEnd(22)}${ts.tentacle.description}`);
			}
		}
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

function buildProgressBar(pct: number, width: number): string {
	const filled = Math.round((pct / 100) * width);
	return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

async function cmdRun(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);

	const concurrency = flags["concurrency"] ? Number(flags["concurrency"]) : undefined;
	const agentCmd = typeof flags["agent"] === "string" ? flags["agent"] : undefined;
	const resume = flags["resume"] === true;

	if (flags["all"]) {
		try {
			console.log("Running all tentacles…");
			const runOpts: RunTentacleOpts = { resume };
			if (concurrency !== undefined) runOpts.concurrency = concurrency;
			if (agentCmd !== undefined) runOpts.agentCmd = agentCmd;
			const results = await runAll(runOpts);
			let exitCode = 0;
			for (const [id, result] of results) {
				const done = result.state.workers.filter((w) => w.status === "done").length;
				const failed = result.state.workers.filter((w) => w.status === "failed").length;
				console.log(`  ${id}: ${done} done, ${failed} failed`);
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
		console.log(`Running tentacle "${id}"…`);
		const runOpts: RunTentacleOpts = { resume };
		if (concurrency !== undefined) runOpts.concurrency = concurrency;
		if (agentCmd !== undefined) runOpts.agentCmd = agentCmd;
		const result = await runTentacle(id, { ...runOpts, cwd: process.cwd() });
		const done = result.state.workers.filter((w) => w.status === "done").length;
		const failed = result.state.workers.filter((w) => w.status === "failed").length;
		console.log(`Done: ${done} workers completed, ${failed} failed`);
		return failed > 0 ? 1 : 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

async function cmdRetry(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	const workerId = positional[0];
	const tentacleId = positional[1];

	if (!workerId || !tentacleId) {
		console.error("Usage: conductor retry <worker-id> <tentacle>");
		return 1;
	}

	const agentCmd = typeof flags["agent"] === "string" ? flags["agent"] : undefined;

	try {
		console.log(`Retrying worker ${workerId} in tentacle "${tentacleId}"…`);
		const retryOpts: { agentCmd?: string } = {};
		if (agentCmd !== undefined) retryOpts.agentCmd = agentCmd;
		await retryTentacleWorker(tentacleId, workerId, retryOpts);
		console.log("✓ Retry complete");
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

async function cmdStatus(args: string[]): Promise<number> {
	const positional = positionalArgs(args);
	const id = positional[0];

	try {
		if (id) {
			// Single tentacle
			getTentacle(id); // throws if not found
			const state = await getTentacleState(id);
			if (!state) {
				console.log(`No swarm state for "${id}" — run \`conductor run ${id}\` first`);
				return 0;
			}
			console.log(`\nTentacle: ${id}`);
			for (const worker of state.workers) {
				const statusPad = worker.status.padEnd(10);
				console.log(`  ${statusPad} ${worker.contractTitle ?? worker.id}`);
			}
		} else {
			// All tentacles
			const statuses = await listTentacles();
			if (!statuses.length) {
				console.log("No tentacles. Run `conductor add <name>` to create one.");
				return 0;
			}
			for (const ts of statuses) {
				const workers = ts.swarmState ? ts.swarmState.workers : [];
				const done = workers.filter((w) => w.status === "done").length;
				const failed = workers.filter((w) => w.status === "failed").length;
				const running = workers.filter((w) =>
					["spawning", "running", "verifying", "merging"].includes(w.status),
				).length;
				console.log(
					`${ts.tentacle.id.padEnd(20)} ${workers.length} workers  done:${done}  running:${running}  failed:${failed}`,
				);
			}
		}
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

async function cmdUi(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const port = flags["port"] ? Number(flags["port"]) : 8080;

	const handle = startServer({ port });
	console.log(`conductor UI running at http://localhost:${handle.port}`);
	console.log("Press Ctrl+C to stop");

	return new Promise((resolve) => {
		process.on("SIGINT", () => {
			handle.stop();
			resolve(0);
		});
		process.on("SIGTERM", () => {
			handle.stop();
			resolve(0);
		});
	});
}

function printHelp(): void {
	console.log(`conductor — multi-agent orchestrator with eval-gated quality gates

Usage:
  conductor init                              Create .conductor/ in current directory
  conductor add <name> [opts]                 Add a new tentacle
    --desc="description"                      Tentacle description
    --files="src/auth/**,src/users/**"        Owned file globs (comma-separated)
  conductor rm <name>                         Remove a tentacle
  conductor list                              List all tentacles with progress
  conductor run <name> [opts]                 Run a tentacle's swarm
    --concurrency=N                           Worker concurrency (default: 3)
    --agent=cmd                               Agent command (default: claude)
    --resume                                  Resume from existing state
  conductor run --all                         Run all tentacles
  conductor retry <worker-id> <tentacle>      Retry a failed worker
  conductor status [name]                     Show worker states
  conductor ui [--port=8080]                  Start web dashboard
  conductor help                              Show this help
`);
}

async function main(): Promise<void> {
	const [, , cmd, ...args] = process.argv;

	let exitCode = 0;

	switch (cmd) {
		case "init":
			exitCode = await cmdInit();
			break;
		case "add":
			exitCode = await cmdAdd(args);
			break;
		case "rm":
		case "remove":
			exitCode = await cmdRm(args);
			break;
		case "list":
		case "ls":
			exitCode = await cmdList();
			break;
		case "run":
			exitCode = await cmdRun(args);
			break;
		case "retry":
			exitCode = await cmdRetry(args);
			break;
		case "status":
			exitCode = await cmdStatus(args);
			break;
		case "ui":
		case "dashboard":
			exitCode = await cmdUi(args);
			break;
		case "help":
		case "--help":
		case "-h":
		case undefined:
			printHelp();
			break;
		default:
			console.error(`Unknown command: ${cmd}`);
			console.error("Run `conductor help` for usage.");
			exitCode = 1;
	}

	process.exit(exitCode);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
