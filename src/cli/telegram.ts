import { createInterface } from "node:readline";
import { startBot } from "../telegram.js";
import { c } from "./helpers.js";

export async function cmdTelegram(args: string[]): Promise<number> {
	const sub = args[0];

	if (sub === "setup") {
		const { loadConfig, saveConfig } = await import("../config.js");
		const { telegram } = await import("evalgate");

		const rl = createInterface({ input: process.stdin, output: process.stdout });
		const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

		try {
			const token = (await ask("Bot token (from @BotFather): ")).trim();
			if (!token) {
				console.error("Token is required.");
				return 1;
			}

			// Validate token
			process.stdout.write("Validating token...");
			try {
				await telegram.getUpdates(token, 0);
				console.log(" ok");
			} catch {
				console.log("");
				console.error("Invalid token — could not reach Telegram API.");
				return 1;
			}

			const chatIdRaw = (await ask("Your chat ID (number): ")).trim();
			const chatId = Number(chatIdRaw);
			if (!Number.isInteger(chatId) || chatId === 0) {
				console.error("Chat ID must be a non-zero integer.");
				return 1;
			}

			const cwd = process.cwd();
			const config = loadConfig(cwd);
			if (!config) {
				console.error("No conductor config found. Run `conductor init` first.");
				return 1;
			}
			saveConfig({ ...config, telegram: { token, chatId } }, cwd);
			console.log(
				`${c.green}Telegram bot configured.${c.reset} Run ${c.cyan}conductor telegram${c.reset} to start.`,
			);
			return 0;
		} finally {
			rl.close();
		}
	}

	// Default: start the bot
	const { loadConfig } = await import("../config.js");
	const cwd = process.cwd();
	const config = loadConfig(cwd);
	if (!config) {
		console.error("No conductor config found. Run `conductor init` first.");
		return 1;
	}
	if (!config.telegram) {
		console.error(
			`No Telegram config found. Run ${c.cyan}conductor telegram setup${c.reset} first.`,
		);
		return 1;
	}

	console.log(`${c.bold}conductor telegram bot${c.reset} — polling for messages`);
	console.log(`${c.gray}Press Ctrl+C to stop${c.reset}`);

	await startBot(config.telegram, cwd);
	return 0;
}
