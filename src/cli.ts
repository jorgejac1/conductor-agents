#!/usr/bin/env node
/**
 * conductor CLI
 *
 * conductor init [--yes]
 * conductor add <name> [--desc="..."] [--files="glob"]
 * conductor rm <name>
 * conductor list
 * conductor run <name> [--concurrency=N] [--resume] [--agent=cmd]
 * conductor run --all
 * conductor retry <worker-id> <tentacle>
 * conductor logs <worker-id> <tentacle> [--follow|-f]
 * conductor status [name]
 * conductor ui [--port=8080]
 * conductor help
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
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

// ── ANSI colors (disabled when stdout is not a TTY) ──────────────────────────
const TTY = process.stdout.isTTY === true;
const c = {
	reset: TTY ? "\x1b[0m" : "",
	bold: TTY ? "\x1b[1m" : "",
	green: TTY ? "\x1b[32m" : "",
	red: TTY ? "\x1b[31m" : "",
	yellow: TTY ? "\x1b[33m" : "",
	gray: TTY ? "\x1b[90m" : "",
	cyan: TTY ? "\x1b[36m" : "",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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
		} else if (arg.startsWith("-") && arg.length === 2) {
			flags[arg.slice(1)] = true;
		}
	}
	return flags;
}

function positionalArgs(args: string[]): string[] {
	return args.filter((a) => !a.startsWith("-"));
}

function buildProgressBar(pct: number, width: number, color = ""): string {
	const filled = Math.round((pct / 100) * width);
	const reset = color ? c.reset : "";
	return `[${color}${"█".repeat(filled)}${reset}${c.gray}${"░".repeat(width - filled)}${c.reset}]`;
}

function formatDuration(startedAt: string, finishedAt?: string): string {
	const start = new Date(startedAt).getTime();
	const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
	const ms = Math.max(0, end - start);
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const m = Math.floor(ms / 60_000);
	const s = Math.round((ms % 60_000) / 1000);
	return `${m}m ${s}s`;
}

// ── Init wizard ──────────────────────────────────────────────────────────────

async function runInitWizard(): Promise<void> {
	if (!process.stdin.isTTY) return;

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const ask = (q: string): Promise<string> =>
		new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

	try {
		const addFirst = await ask("\nAdd your first tentacle? (y/N): ");
		if (addFirst.toLowerCase() !== "y") return;

		const name = await ask("  Name: ");
		if (!name) return;

		const desc = await ask("  Description (optional): ");
		const filesRaw = await ask("  Owned files (comma-separated glob, optional): ");
		const files = filesRaw
			? filesRaw
					.split(",")
					.map((f) => f.trim())
					.filter(Boolean)
			: [];

		const tentacle = createTentacle(name, desc, files);
		console.log(`\n${c.green}✓${c.reset} Created tentacle "${c.bold}${tentacle.id}${c.reset}"`);
		console.log(
			`  Edit ${c.cyan}.conductor/tentacles/${tentacle.id}/todo.md${c.reset} to add tasks`,
		);
	} finally {
		rl.close();
	}
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdInit(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	try {
		initConductor();
		console.log(
			`${c.green}✓${c.reset} Initialized ${c.cyan}.conductor/${c.reset} in current directory`,
		);
		if (!flags.yes && flags.y !== true) await runInitWizard();
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

	const description = typeof flags.desc === "string" ? flags.desc : "";
	const filesFlag = typeof flags.files === "string" ? flags.files : "";
	const files = filesFlag ? filesFlag.split(",").map((f) => f.trim()) : [];

	try {
		const tentacle = createTentacle(name, description, files);
		console.log(`${c.green}✓${c.reset} Created tentacle "${c.bold}${tentacle.id}${c.reset}"`);
		console.log(`  CONTEXT.md → ${c.cyan}.conductor/tentacles/${tentacle.id}/CONTEXT.md${c.reset}`);
		console.log(`  todo.md    → ${c.cyan}.conductor/tentacles/${tentacle.id}/todo.md${c.reset}`);
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
		console.log(`${c.green}✓${c.reset} Deleted tentacle "${id}"`);
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
			console.log(`No tentacles. Run ${c.cyan}conductor add <name>${c.reset} to create one.`);
			return 0;
		}

		for (const ts of statuses) {
			const workers = ts.swarmState?.workers ?? [];
			const done = workers.filter((w) => w.status === "done").length;
			const failed = workers.filter((w) => w.status === "failed").length;
			const running = workers.filter((w) =>
				["spawning", "running", "verifying", "merging"].includes(w.status),
			).length;

			const pct = ts.todoTotal > 0 ? Math.round((ts.todoDone / ts.todoTotal) * 100) : 0;

			let barColor = "";
			if (failed > 0) barColor = c.red;
			else if (running > 0) barColor = c.yellow;
			else if (pct === 100) barColor = c.green;

			const bar = buildProgressBar(pct, 20, barColor);

			const parts: string[] = [];
			if (done > 0) parts.push(`${c.green}done:${done}${c.reset}`);
			if (running > 0) parts.push(`${c.yellow}running:${running}${c.reset}`);
			if (failed > 0) parts.push(`${c.red}failed:${failed}${c.reset}`);
			const workerSummary = parts.length ? `  ${parts.join("  ")}` : "";

			console.log(
				`${c.bold}${ts.tentacle.id.padEnd(20)}${c.reset} ${bar} ${ts.todoDone}/${ts.todoTotal}${workerSummary}`,
			);
			if (ts.tentacle.description) {
				console.log(`${"".padEnd(22)}${c.gray}${ts.tentacle.description}${c.reset}`);
			}
		}
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

async function cmdRun(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);

	const concurrency = flags.concurrency ? Number(flags.concurrency) : undefined;
	const agentCmd = typeof flags.agent === "string" ? flags.agent : undefined;
	const resume = flags.resume === true;

	if (flags.all) {
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
		console.log(`Running tentacle "${c.bold}${id}${c.reset}"…`);
		const runOpts: RunTentacleOpts = { resume };
		if (concurrency !== undefined) runOpts.concurrency = concurrency;
		if (agentCmd !== undefined) runOpts.agentCmd = agentCmd;
		const result = await runTentacle(id, { ...runOpts, cwd: process.cwd() });
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

async function cmdRetry(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	const workerId = positional[0];
	const tentacleId = positional[1];

	if (!workerId || !tentacleId) {
		console.error("Usage: conductor retry <worker-id> <tentacle>");
		return 1;
	}

	const agentCmd = typeof flags.agent === "string" ? flags.agent : undefined;

	try {
		console.log(`Retrying worker ${c.bold}${workerId}${c.reset} in tentacle "${tentacleId}"…`);
		const retryOpts: { agentCmd?: string } = {};
		if (agentCmd !== undefined) retryOpts.agentCmd = agentCmd;
		await retryTentacleWorker(tentacleId, workerId, retryOpts);
		console.log(`${c.green}✓${c.reset} Retry complete`);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

async function cmdLogs(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	const workerId = positional[0];
	const tentacleId = positional[1];

	if (!workerId || !tentacleId) {
		console.error("Usage: conductor logs <worker-id> <tentacle> [--follow|-f]");
		return 1;
	}

	const follow = flags.follow === true || flags.f === true;

	try {
		const state = await getTentacleState(tentacleId);
		if (!state) {
			console.error(`No run state for "${tentacleId}" — run \`conductor run ${tentacleId}\` first`);
			return 1;
		}

		const worker = state.workers.find((w) => w.id.startsWith(workerId));
		if (!worker) {
			console.error(`Worker "${workerId}" not found in tentacle "${tentacleId}"`);
			return 1;
		}

		const { logPath } = worker;

		if (!existsSync(logPath)) {
			if (follow) {
				process.stderr.write(`${c.gray}Waiting for log file…${c.reset}\n`);
				await new Promise<void>((resolve) => {
					const check = setInterval(() => {
						if (existsSync(logPath)) {
							clearInterval(check);
							resolve();
						}
					}, 300);
				});
			} else {
				console.error(`Log file not found: ${logPath}`);
				return 1;
			}
		}

		process.stderr.write(`${c.gray}── ${worker.contractTitle} ─ ${logPath}${c.reset}\n`);

		const content = readFileSync(logPath, "utf8");
		process.stdout.write(content);

		if (!follow) return 0;

		// Tail mode: poll for new bytes every 500ms
		let offset = Buffer.byteLength(content, "utf8");

		const poll = () => {
			try {
				const st = statSync(logPath);
				if (st.size > offset) {
					const fd = openSync(logPath, "r");
					const buf = Buffer.alloc(st.size - offset);
					readSync(fd, buf, 0, buf.length, offset);
					closeSync(fd);
					process.stdout.write(buf.toString("utf8"));
					offset = st.size;
				}
			} catch {
				/* file gone or locked */
			}
		};

		const interval = setInterval(poll, 500);
		process.on("SIGINT", () => {
			clearInterval(interval);
			process.exit(0);
		});

		await new Promise(() => {}); // keep alive until Ctrl+C
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
			getTentacle(id); // throws if not found
			const state = await getTentacleState(id);
			if (!state) {
				console.log(`No swarm state for "${id}" — run \`conductor run ${id}\` first`);
				return 0;
			}

			console.log(`\n${c.bold}Tentacle: ${id}${c.reset}`);
			for (const worker of state.workers) {
				const statusColor =
					worker.status === "done"
						? c.green
						: worker.status === "failed"
							? c.red
							: ["spawning", "running", "verifying", "merging"].includes(worker.status)
								? c.yellow
								: c.gray;

				const statusStr = `${statusColor}${worker.status.padEnd(10)}${c.reset}`;
				const title = worker.contractTitle.padEnd(30);

				const duration = worker.startedAt
					? `  ${c.gray}${formatDuration(worker.startedAt, worker.finishedAt)}${c.reset}`
					: "";

				const evalResult =
					worker.status === "done"
						? `  ${c.green}✓ eval passed${c.reset}`
						: worker.status === "failed"
							? `  ${c.red}✗ eval failed${c.reset}`
							: "";

				const logHint =
					worker.status === "failed"
						? `\n${"".padEnd(14)}${c.gray}log: ${worker.logPath}${c.reset}`
						: "";

				console.log(`  ${statusStr} ${title}${duration}${evalResult}${logHint}`);
			}
		} else {
			const statuses = await listTentacles();
			if (!statuses.length) {
				console.log(`No tentacles. Run ${c.cyan}conductor add <name>${c.reset} to create one.`);
				return 0;
			}
			for (const ts of statuses) {
				const workers = ts.swarmState?.workers ?? [];
				const done = workers.filter((w) => w.status === "done").length;
				const failed = workers.filter((w) => w.status === "failed").length;
				const running = workers.filter((w) =>
					["spawning", "running", "verifying", "merging"].includes(w.status),
				).length;

				const doneStr = done > 0 ? `${c.green}done:${done}${c.reset}` : `done:${done}`;
				const runningStr = running > 0 ? `  ${c.yellow}running:${running}${c.reset}` : "";
				const failedStr =
					failed > 0 ? `  ${c.red}failed:${failed}${c.reset}` : `  failed:${failed}`;

				console.log(
					`${c.bold}${ts.tentacle.id.padEnd(20)}${c.reset} ${workers.length} workers  ${doneStr}${runningStr}${failedStr}`,
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
	const port = flags.port ? Number(flags.port) : 8080;

	const handle = await startServer({ port });
	console.log(`conductor UI running at ${c.cyan}http://localhost:${handle.port}${c.reset}`);
	console.log(`${c.gray}Press Ctrl+C to stop${c.reset}`);

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
	console.log(`${c.bold}conductor${c.reset} — multi-agent orchestrator with eval-gated quality gates

Usage:
  conductor init [--yes]                      Create .conductor/ in current directory
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
  conductor logs <worker-id> <tentacle>       Print worker session log
    --follow, -f                              Tail the log live
  conductor status [name]                     Show worker states with detail
  conductor ui [--port=8080]                  Start web dashboard
  conductor help                              Show this help
`);
}

async function main(): Promise<void> {
	const [, , cmd, ...args] = process.argv;

	let exitCode = 0;

	switch (cmd) {
		case "init":
			exitCode = await cmdInit(args);
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
		case "logs":
		case "log":
			exitCode = await cmdLogs(args);
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
			console.error(`Run ${c.cyan}conductor help${c.reset} for usage.`);
			exitCode = 1;
	}

	process.exit(exitCode);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
