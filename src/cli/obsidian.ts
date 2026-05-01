import { loadConfig } from "../config.js";
import { c } from "./helpers.js";

export async function cmdObsidian(args: string[], cwd = process.cwd()): Promise<number> {
	const sub = args[0] ?? "status";
	if (sub === "status") {
		return obsidianStatus(cwd);
	}
	console.error(`Unknown obsidian subcommand: ${sub}`);
	console.error(`Usage: conductor obsidian status`);
	return 1;
}

async function obsidianStatus(cwd: string): Promise<number> {
	const { obsidianStatus: getStatus } = await import("../obsidian.js");
	const config = loadConfig(cwd);
	if (!config?.obsidian) {
		console.log(`${c.yellow}obsidian${c.reset}: not configured`);
		console.log(
			`Add an ${c.cyan}obsidian${c.reset} section to your .conductor/config.json to enable sync.`,
		);
		return 0;
	}
	const status = getStatus(config.obsidian);
	console.log(`${c.bold}Obsidian Sync Status${c.reset}`);
	console.log(`  Vault:      ${status.vaultPath}`);
	if (status.subfolder) console.log(`  Subfolder:  ${status.subfolder}`);
	console.log(`  Mode:       ${config.obsidian.mode}`);
	console.log(`  Accessible: ${status.accessible ? `${c.green}yes` : `${c.red}no`}${c.reset}`);
	console.log(`  Writable:   ${status.writable ? `${c.green}yes` : `${c.red}no`}${c.reset}`);
	if (!status.accessible) {
		console.error(
			`\n${c.red}Vault path does not exist.${c.reset} Create it or update the path in config.json.`,
		);
		return 1;
	}
	if (!status.writable) {
		console.error(`\n${c.red}Vault path is not writable.${c.reset} Check permissions.`);
		return 1;
	}
	return 0;
}
