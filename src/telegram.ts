/**
 * Telegram bot gateway for conductor.
 *
 * Provides:
 *  - startBot(config, cwd)         — long-poll loop, proactive notifications, graceful shutdown
 *  - parseCommand(text)            — pure parser, exported for testing
 *  - formatTrackList(statuses)     — pure formatter, exported for testing
 *  - formatWorkerStatus(state)     — pure formatter, exported for testing
 */

import type { SwarmState } from "evalgate";
import { swarmEvents, telegram } from "evalgate";
import { getTrackState, retryTrackWorker, runAll, runTrack } from "./orchestrator.js";
import { listTracks } from "./track.js";
import type { TelegramBotConfig, TrackStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Pure helpers — exported for testing
// ---------------------------------------------------------------------------

export interface ParsedCommand {
	cmd: string;
	args: string[];
}

/**
 * Parse a Telegram message text into a command + args.
 * Strips /cmd@botname suffix that Telegram appends in group chats.
 * Returns { cmd: "unknown", args: [] } for non-command text.
 */
export function parseCommand(text: string): ParsedCommand {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) return { cmd: "unknown", args: [] };

	const parts = trimmed.slice(1).split(/\s+/);
	const rawCmd = parts[0] ?? "";
	// Strip @botname suffix
	const cmd = rawCmd.split("@")[0]?.toLowerCase() ?? "";
	const args = parts.slice(1);
	return { cmd, args };
}

const STATUS_ICON: Record<string, string> = {
	done: "✅",
	failed: "❌",
	running: "🔄",
	spawning: "🔄",
	verifying: "🔍",
	merging: "🔀",
	pending: "⏳",
	retrying: "🔁",
};

/** Format track list into a Telegram message. Truncates at 4000 chars. */
export function formatTrackList(statuses: TrackStatus[]): string {
	if (statuses.length === 0) return "No tracks configured. Run `conductor add <name>` first.";

	const lines: string[] = ["*Tracks*\n"];
	for (const s of statuses) {
		const done = s.todoDone;
		const total = s.todoTotal;
		const icon = total > 0 && done === total ? "✅" : done > 0 ? "⚠️" : "⬜";
		lines.push(`${icon} \`${s.track.id}\` — ${done}/${total} tasks`);
	}

	const full = lines.join("\n");
	if (full.length <= 4000) return full;

	// Truncate gracefully
	let out = "";
	let shown = 0;
	for (const line of lines) {
		if ((out + line).length > 3900) break;
		out += `${line}\n`;
		shown++;
	}
	return `${out}\n_...and ${lines.length - shown} more_`;
}

/** Format SwarmState worker list into a Telegram message. Truncates at 4000 chars. */
export function formatWorkerStatus(state: SwarmState): string {
	if (state.workers.length === 0) return "No workers in this run.";

	const lines: string[] = ["*Workers*\n"];
	for (const w of state.workers) {
		const icon = STATUS_ICON[w.status] ?? "❓";
		const title = w.contractTitle ?? w.id.slice(0, 8);
		lines.push(`${icon} \`${w.id.slice(0, 8)}\` ${title} — ${w.status}`);
	}

	const full = lines.join("\n");
	if (full.length <= 4000) return full;

	let out = "";
	let shown = 0;
	for (const line of lines) {
		if ((out + line).length > 3900) break;
		out += `${line}\n`;
		shown++;
	}
	return `${out}\n_...and ${lines.length - shown} more_`;
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

type Sender = (text: string, markdown?: boolean) => Promise<void>;

async function cmdHelp(sender: Sender): Promise<void> {
	await sender(
		`*conductor bot*\n\n` +
			`/list — all tracks with progress\n` +
			`/status <track> — workers for a track\n` +
			`/run <track> — start a track\\'s swarm\n` +
			`/run\\_all — run all tracks\n` +
			`/retry <workerId> <track> — retry a failed worker\n` +
			`/help — show this message`,
		true,
	);
}

async function cmdList(sender: Sender, cwd: string): Promise<void> {
	const statuses = await listTracks(cwd);
	await sender(formatTrackList(statuses), true);
}

async function cmdStatus(sender: Sender, trackId: string, cwd: string): Promise<void> {
	if (!trackId) {
		await sender("Usage: /status <track>");
		return;
	}
	const state = await getTrackState(trackId, cwd);
	if (!state) {
		await sender(`No run state for \`${trackId}\`. Start one with /run ${trackId}.`, true);
		return;
	}
	await sender(formatWorkerStatus(state), true);
}

async function cmdRun(
	sender: Sender,
	trackId: string,
	cwd: string,
	config: TelegramBotConfig,
): Promise<void> {
	if (!trackId) {
		await sender("Usage: /run <track>");
		return;
	}

	// Guard: check if already running
	const state = await getTrackState(trackId, cwd);
	const active = ["spawning", "running", "verifying", "merging", "retrying"];
	if (state?.workers.some((w) => active.includes(w.status))) {
		await sender(`Track \`${trackId}\` is already running. Use /status ${trackId} to check.`, true);
		return;
	}

	await sender(`Starting track \`${trackId}\`...`, true);

	runTrack(trackId, { cwd })
		.then((result) => {
			const done = result.done;
			const failed = result.failed;
			const msg =
				failed === 0
					? `✅ \`${trackId}\` complete — ${done}/${done} tasks done`
					: `⚠️ \`${trackId}\` finished — ${done} done, ${failed} failed`;
			return telegram.sendMarkdown(config.token, config.chatId, msg);
		})
		.catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			return telegram.sendMessage(
				config.token,
				config.chatId,
				`❌ Error running ${trackId}: ${msg}`,
			);
		});
}

async function cmdRunAll(sender: Sender, cwd: string, config: TelegramBotConfig): Promise<void> {
	await sender("Starting all tracks...");

	runAll({ cwd })
		.then((results) => {
			const lines = ["*Run complete*\n"];
			for (const [id, result] of results) {
				const icon = result.failed === 0 ? "✅" : "⚠️";
				lines.push(`${icon} \`${id}\` — ${result.done} done, ${result.failed} failed`);
			}
			return telegram.sendMarkdown(config.token, config.chatId, lines.join("\n"));
		})
		.catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			return telegram.sendMessage(config.token, config.chatId, `❌ Error running all: ${msg}`);
		});
}

async function cmdRetry(
	sender: Sender,
	workerId: string,
	trackId: string,
	cwd: string,
): Promise<void> {
	if (!workerId || !trackId) {
		await sender("Usage: /retry <workerId> <track>");
		return;
	}
	try {
		await retryTrackWorker(trackId, workerId, { cwd });
		await sender(`🔁 Retrying worker \`${workerId}\` in \`${trackId}\``, true);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await sender(`❌ Retry failed: ${msg}`);
	}
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatch(
	text: string,
	config: TelegramBotConfig,
	cwd: string,
): Promise<void> {
	const { cmd, args } = parseCommand(text);

	const sender: Sender = (msg, markdown = false) =>
		markdown
			? telegram.sendMarkdown(config.token, config.chatId, msg)
			: telegram.sendMessage(config.token, config.chatId, msg);

	switch (cmd) {
		case "help":
			await cmdHelp(sender);
			break;
		case "list":
			await cmdList(sender, cwd);
			break;
		case "status":
			await cmdStatus(sender, args[0] ?? "", cwd);
			break;
		case "run":
			if (args[0] === "all" || args[0] === "_all") {
				await cmdRunAll(sender, cwd, config);
			} else {
				await cmdRun(sender, args[0] ?? "", cwd, config);
			}
			break;
		case "run_all":
			await cmdRunAll(sender, cwd, config);
			break;
		case "retry":
			await cmdRetry(sender, args[0] ?? "", args[1] ?? "", cwd);
			break;
		case "unknown":
			// Non-command text — silently ignore
			break;
		default:
			await sender(`Unknown command: /${cmd}\nSend /help for available commands.`);
	}
}

// ---------------------------------------------------------------------------
// Proactive notifications
// ---------------------------------------------------------------------------

function setupNotifications(config: TelegramBotConfig): () => void {
	const notified = new Set<string>();

	const listener = (state: SwarmState) => {
		for (const w of state.workers) {
			if ((w.status === "done" || w.status === "failed") && !notified.has(w.id)) {
				notified.add(w.id);
				const icon = w.status === "done" ? "✅" : "❌";
				const title = w.contractTitle ?? w.id.slice(0, 8);
				telegram
					.sendMessage(config.token, config.chatId, `${icon} ${title} — ${w.status}`)
					.catch(() => {});
			}
		}
	};

	swarmEvents.on("state", listener);
	return () => swarmEvents.off("state", listener);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Start the Telegram bot. Runs indefinitely until SIGINT/SIGTERM.
 * Long-polls getUpdates with a 25s server-side timeout (no sleep needed).
 */
export async function startBot(config: TelegramBotConfig, cwd: string): Promise<void> {
	let running = true;
	let offset = 0;

	const removeNotifications = setupNotifications(config);

	const cleanup = () => {
		running = false;
		removeNotifications();
	};
	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

	await telegram.sendMessage(config.token, config.chatId, "🎼 conductor bot online — send /help");

	while (running) {
		try {
			const updates = await telegram.getUpdates(config.token, offset);
			for (const update of updates) {
				offset = update.update_id + 1;
				const msg = update.message;
				if (!msg?.text) continue;

				// Security: ignore messages from any chat other than the configured one
				if (msg.chat.id !== config.chatId) continue;

				// Dispatch without blocking the poll loop
				dispatch(msg.text, config, cwd).catch((err: unknown) => {
					const errMsg = err instanceof Error ? err.message : String(err);
					telegram.sendMessage(config.token, config.chatId, `⚠️ Error: ${errMsg}`).catch(() => {});
				});
			}
		} catch (err) {
			if (!running) break;
			// Log polling errors but keep running — transient network issues are common
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[telegram] poll error: ${msg}`);
			// Brief pause before retrying to avoid tight error loops
			await new Promise<void>((r) => setTimeout(r, 5000));
		}
	}
}
