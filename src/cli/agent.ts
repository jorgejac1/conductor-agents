import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { builtinPlugins, resolvePlugin } from "../agents/index.js";
import type { AgentPlugin } from "../agents/types.js";
import { loadConfig, saveConfig } from "../config.js";
import { parseFlags, positionalArgs } from "./helpers.js";

function listCustomPlugins(cwd: string): string[] {
	const dir = join(cwd, ".conductor", "plugins");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".js"))
		.map((f) => f.replace(/\.js$/, ""));
}

function printPlugin(p: AgentPlugin, label = ""): void {
	const pricingStr = p.pricing
		? `$${p.pricing.input}/$${p.pricing.output} per MTok`
		: "(pricing not set)";
	console.log(`  id:      ${p.id}${label}`);
	console.log(`  cmd:     ${p.defaultCmd || "(n/a)"}`);
	console.log(`  pricing: ${pricingStr}`);
	console.log(`  args:    ${p.defaultArgs().join(" ")}`);
}

async function cmdAgentList(cwd: string): Promise<number> {
	console.log("Built-in plugins:");
	for (const [name, p] of Object.entries(builtinPlugins)) {
		if (name === "generic") continue;
		const pricingStr = p.pricing
			? `$${p.pricing.input}/$${p.pricing.output}/MTok`
			: "(pricing not set)";
		console.log(`  ${p.id.padEnd(12)} ${p.defaultCmd.padEnd(12)} ${pricingStr}`);
	}
	const custom = listCustomPlugins(cwd);
	if (custom.length > 0) {
		console.log("\nCustom plugins (.conductor/plugins/):");
		for (const name of custom) {
			console.log(`  ${name.padEnd(12)} [custom]`);
		}
	}
	return 0;
}

async function cmdAgentInfo(args: string[], cwd: string): Promise<number> {
	const id = positionalArgs(args)[0];
	if (!id) {
		console.error("Usage: conductor agent info <id>");
		return 1;
	}
	const plugin = await resolvePlugin(cwd, id);
	if (plugin.id.startsWith("generic:")) {
		const customIds = listCustomPlugins(cwd);
		if (!customIds.includes(id)) {
			console.error(
				`No plugin found for '${id}'. Run 'conductor agent list' to see available plugins.`,
			);
			return 1;
		}
	}
	printPlugin(plugin);
	return 0;
}

async function cmdAgentUse(args: string[], cwd: string): Promise<number> {
	const id = positionalArgs(args)[0];
	const flags = parseFlags(args);
	if (!id) {
		console.error("Usage: conductor agent use <id> [--yes]");
		return 1;
	}

	// Validate the id exists as a built-in or custom plugin
	const plugin = await resolvePlugin(cwd, id);
	if (plugin.id.startsWith("generic:") && !listCustomPlugins(cwd).includes(id)) {
		console.error(
			`conductor agent use: '${id}' is not a known plugin.\n` +
				`Run 'conductor agent list' to see available plugins, or add a custom plugin at .conductor/plugins/${id}.js`,
		);
		return 1;
	}

	if (!flags.yes && !flags.y) {
		const rl = await import("node:readline");
		const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
		const answer = await new Promise<string>((resolve) => {
			iface.question(
				`This will change defaults.agentCmd to '${id}' for all tracks. Continue? [y/N] `,
				resolve,
			);
		});
		iface.close();
		if (answer.toLowerCase() !== "y") {
			console.log("Aborted.");
			return 1;
		}
	}

	const config = loadConfig(cwd);
	if (!config) {
		console.error("conductor agent use: no config found. Run 'conductor init' first.");
		return 1;
	}
	config.defaults.agentCmd = id;
	saveConfig(config, cwd);
	console.log(`defaults.agentCmd set to '${id}'`);
	return 0;
}

export async function cmdAgent(args: string[], cwd = process.cwd()): Promise<number> {
	const sub = positionalArgs(args)[0];

	switch (sub) {
		case "list":
			return cmdAgentList(cwd);
		case "info":
			return cmdAgentInfo(args.slice(1), cwd);
		case "use":
			return cmdAgentUse(args.slice(1), cwd);
		default:
			console.error("Usage:");
			console.error("  conductor agent list");
			console.error("  conductor agent info <id>");
			console.error("  conductor agent use <id> [--yes]");
			return 1;
	}
}
