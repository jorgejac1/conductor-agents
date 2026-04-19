import { runTrack } from "../orchestrator.js";
import { c, positionalArgs } from "./helpers.js";

async function cmdScheduleAdd(args: string[]): Promise<number> {
	const { parseCron, nextFireMs } = await import("evalgate");
	const { loadConfig, saveConfig } = await import("../config.js");
	const positional = positionalArgs(args);
	const trackId = positional[0];
	const cronExpr = positional[1];

	if (!trackId || !cronExpr) {
		console.error('Usage: conductor schedule add <track> "<cron>"');
		console.error('  Example: conductor schedule add auth "0 9 * * 1-5"');
		return 1;
	}

	const cwd = process.cwd();
	const config = loadConfig(cwd);
	if (!config) {
		console.error("No conductor config found. Run `conductor init` first.");
		return 1;
	}

	const track = config.tracks.find((t) => t.id === trackId);
	if (!track) {
		console.error(`Track "${trackId}" not found. Run \`conductor list\` to see available tracks.`);
		return 1;
	}

	let expr: ReturnType<typeof parseCron>;
	try {
		expr = parseCron(cronExpr);
	} catch {
		console.error(`Invalid cron expression: "${cronExpr}"`);
		console.error("Expected 5-field cron: minute hour day month weekday");
		console.error('  Example: "0 9 * * 1-5" (9am Mon–Fri)');
		return 1;
	}

	track.schedule = cronExpr;
	saveConfig(config, cwd);

	const ms = nextFireMs(expr);
	const next = new Date(Date.now() + ms);
	console.log(
		`${c.green}✓${c.reset} Scheduled "${c.bold}${trackId}${c.reset}" → ${c.cyan}${cronExpr}${c.reset}`,
	);
	console.log(`  Next fire: ${next.toLocaleString()}`);
	return 0;
}

async function cmdScheduleList(): Promise<number> {
	const { parseCron, nextFireMs } = await import("evalgate");
	const { loadConfig } = await import("../config.js");
	const cwd = process.cwd();
	const config = loadConfig(cwd);
	if (!config) {
		console.error("No conductor config found. Run `conductor init` first.");
		return 1;
	}

	const scheduled = config.tracks.filter((t) => t.schedule);
	if (!scheduled.length) {
		console.log("No scheduled tracks.");
		return 0;
	}

	console.log(`${c.bold}${"Track".padEnd(20)} ${"Cron".padEnd(22)} Next Fire${c.reset}`);
	console.log(`${"─".repeat(20)} ${"─".repeat(22)} ${"─".repeat(25)}`);

	for (const track of scheduled) {
		const cronStr = track.schedule ?? "";
		try {
			const expr = parseCron(cronStr);
			const ms = nextFireMs(expr);
			const next = new Date(Date.now() + ms);
			console.log(
				`${track.id.padEnd(20)} ${c.cyan}${cronStr.padEnd(22)}${c.reset} ${next.toLocaleString()}`,
			);
		} catch {
			console.log(
				`${track.id.padEnd(20)} ${c.red}${cronStr.padEnd(22)}${c.reset} ${c.red}invalid cron${c.reset}`,
			);
		}
	}
	return 0;
}

async function cmdScheduleRm(args: string[]): Promise<number> {
	const { loadConfig, saveConfig } = await import("../config.js");
	const positional = positionalArgs(args);
	const trackId = positional[0];

	if (!trackId) {
		console.error("Usage: conductor schedule rm <track>");
		return 1;
	}

	const cwd = process.cwd();
	const config = loadConfig(cwd);
	if (!config) {
		console.error("No conductor config found. Run `conductor init` first.");
		return 1;
	}

	const track = config.tracks.find((t) => t.id === trackId);
	if (!track) {
		console.error(`Track "${trackId}" not found.`);
		return 1;
	}

	if (!track.schedule) {
		console.log(`Track "${trackId}" has no schedule.`);
		return 0;
	}

	delete track.schedule;
	saveConfig(config, cwd);
	console.log(`${c.green}✓${c.reset} Removed schedule from "${trackId}"`);
	return 0;
}

async function cmdScheduleStart(): Promise<number> {
	const { parseCron, nextFireMs } = await import("evalgate");
	const { loadConfig } = await import("../config.js");
	const cwd = process.cwd();

	const config = loadConfig(cwd);
	if (!config) {
		console.error("No conductor config found. Run `conductor init` first.");
		return 1;
	}

	const initially = config.tracks.filter((t) => t.schedule);
	if (!initially.length) {
		console.log(
			`No scheduled tracks. Use ${c.cyan}conductor schedule add <track> "<cron>"${c.reset} to add one.`,
		);
		return 0;
	}

	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	function scheduleTrack(trackId: string, cronExpr: string): void {
		let expr: ReturnType<typeof parseCron>;
		try {
			expr = parseCron(cronExpr);
		} catch {
			console.error(`[scheduler] Invalid cron for "${trackId}": ${cronExpr}`);
			return;
		}
		const ms = nextFireMs(expr);
		const next = new Date(Date.now() + ms);
		console.log(
			`  ${c.bold}${trackId.padEnd(20)}${c.reset} ${c.cyan}${cronExpr.padEnd(22)}${c.reset} next: ${next.toLocaleString()}`,
		);

		const timer = setTimeout(async () => {
			timers.delete(trackId);
			process.stdout.write(`\n[scheduler] Firing "${c.bold}${trackId}${c.reset}"…\n`);
			try {
				const result = await runTrack(trackId, { cwd });
				const done = result.state.workers.filter((w) => w.status === "done").length;
				const failed = result.state.workers.filter((w) => w.status === "failed").length;
				const doneStr = done > 0 ? `${c.green}${done} done${c.reset}` : `${done} done`;
				const failedStr = failed > 0 ? `${c.red}${failed} failed${c.reset}` : `${failed} failed`;
				console.log(`[scheduler] "${trackId}" complete: ${doneStr}, ${failedStr}`);
			} catch (err) {
				console.error(
					`[scheduler] Error running "${trackId}": ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			// Re-read config after run — picks up schedule changes
			const fresh = loadConfig(cwd);
			const freshTrack = fresh?.tracks.find((t) => t.id === trackId);
			if (freshTrack?.schedule) {
				scheduleTrack(trackId, freshTrack.schedule);
			}
		}, ms);

		timers.set(trackId, timer);
	}

	console.log(`${c.bold}conductor schedule daemon${c.reset} — ${initially.length} track(s)`);
	console.log(`${c.gray}Press Ctrl+C to stop${c.reset}\n`);
	for (const track of initially) {
		scheduleTrack(track.id, track.schedule ?? "");
	}

	return new Promise<number>((resolve) => {
		const cleanup = () => {
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
			process.stdout.write("\n");
			resolve(0);
		};
		process.once("SIGINT", cleanup);
		process.once("SIGTERM", cleanup);
	});
}

export async function cmdSchedule(args: string[]): Promise<number> {
	const sub = positionalArgs(args)[0];

	switch (sub) {
		case "add":
			return cmdScheduleAdd(args.slice(1));
		case "list":
			return cmdScheduleList();
		case "rm":
		case "remove":
			return cmdScheduleRm(args.slice(1));
		case "start":
			return cmdScheduleStart();
		default:
			console.error("Usage:");
			console.error('  conductor schedule add <track> "<cron>"');
			console.error("  conductor schedule list");
			console.error("  conductor schedule rm <track>");
			console.error("  conductor schedule start");
			return 1;
	}
}
