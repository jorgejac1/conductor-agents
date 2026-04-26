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
 * conductor retry <worker-id> <track>
 * conductor logs <worker-id> <track> [--follow|-f]
 * conductor status [name]
 * conductor ui [--port=8080]
 * conductor help
 */

import { cmdAdd } from "./cli/add.js";
import { cmdDiagnose } from "./cli/diagnose.js";
import { cmdDoctor } from "./cli/doctor.js";
import { c, positionalArgs } from "./cli/helpers.js";
import { cmdInit } from "./cli/init.js";
import { cmdList } from "./cli/list.js";
import { cmdLogs } from "./cli/logs.js";
import { cmdPlan } from "./cli/plan.js";
import { cmdReport } from "./cli/report.js";
import { cmdRetry } from "./cli/retry.js";
import { cmdRm } from "./cli/rm.js";
import { cmdRun } from "./cli/run.js";
import { cmdSchedule } from "./cli/schedule.js";
import { cmdStatus } from "./cli/status.js";
import { cmdTelegram } from "./cli/telegram.js";
import { cmdUi } from "./cli/ui.js";
import { cmdWebhook } from "./cli/webhook.js";

function printHelp(): void {
	console.log(`${c.bold}conductor${c.reset} — multi-agent orchestrator with eval-gated quality gates

Usage:
  conductor init [--yes]                      Create .conductor/ in current directory
  conductor add <name> [opts]                 Add a new track
    --desc="description"                      Track description
    --files="src/auth/**,src/users/**"        Owned file globs (comma-separated)
  conductor rm <name>                         Remove a track
  conductor list                              List all tracks with progress
  conductor run <name> [opts]                 Run a track's swarm
    --concurrency=N                           Worker concurrency (default: 3)
    --agent=cmd                               Agent command (default: claude)
    --resume                                  Resume from existing state
  conductor run --all                         Run all tracks
  conductor retry <worker-id> <track>         Retry a failed worker
  conductor logs <worker-id> <track>          Print worker session log
    --follow, -f                              Tail the log live
  conductor status [name]                     Show worker states with detail
  conductor ui [--port=8080]                  Start web dashboard
  conductor telegram setup                    Configure Telegram bot token + chat ID
  conductor telegram [start]                  Start Telegram bot (foreground)
  conductor plan "<goal>"                     Generate track + task plan from a goal
  conductor plan apply [--dry-run]            Apply plan-draft.md to create tracks
  conductor plan show                         Print current plan draft
  conductor report [track]                    Show cost report (tokens + estimated USD)
  conductor schedule add <track> "<cron>"     Add a cron schedule to a track
  conductor schedule list                     Show all scheduled tracks with next fire time
  conductor schedule rm <track>               Remove schedule from a track
  conductor schedule start                    Start the scheduling daemon (foreground)
  conductor webhook start [--port=9000]       Start webhook server (POST /webhook/<track>)
  conductor mcp                               Start MCP server (stdio)
  conductor doctor                            Health check config, tracks, and environment
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
		case "telegram":
		case "tg":
			exitCode = await cmdTelegram(args);
			break;
		case "plan":
			exitCode = await cmdPlan(args);
			break;
		case "report":
			exitCode = await cmdReport(args);
			break;
		case "schedule":
			exitCode = await cmdSchedule(args);
			break;
		case "webhook":
			exitCode = await cmdWebhook(args);
			break;
		case "doctor":
			exitCode = await cmdDoctor(args);
			break;
		case "diagnose":
			exitCode = await cmdDiagnose(args);
			break;
		case "mcp": {
			// startMcpServer runs indefinitely (readline keeps node alive).
			// Return early so main() does NOT call process.exit().
			const { startMcpServer } = await import("./mcp.js");
			const mcpCwd = positionalArgs(args)[0] ?? process.cwd();
			startMcpServer(mcpCwd);
			return;
		}
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
