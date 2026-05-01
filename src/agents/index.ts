import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { plugin as aider } from "./aider.js";
import { plugin as claude } from "./claude.js";
import { plugin as codex } from "./codex.js";
import { plugin as gemini } from "./gemini.js";
import { plugin as generic, makeGenericPlugin } from "./generic.js";
import { plugin as opencode } from "./opencode.js";
import type { AgentPlugin } from "./types.js";

export type { AgentPlugin } from "./types.js";

export const builtinPlugins: Record<string, AgentPlugin> = {
	claude,
	opencode,
	aider,
	codex,
	gemini,
	generic,
};

/**
 * Resolves the best AgentPlugin for the given agentCmd string.
 *
 * Resolution order:
 * 1. `.conductor/plugins/<name>.js` (custom user plugin)
 * 2. Built-in plugin by binary basename
 * 3. Generic fallback (emits a one-time warning; returns null from parseUsage)
 */
export async function resolvePlugin(cwd: string, agentCmd: string): Promise<AgentPlugin> {
	// Extract the binary name (first word, no path, no flags)
	const name = basename(agentCmd.split(/\s+/)[0] ?? agentCmd);

	// 1. Custom plugin file
	const customPath = join(cwd, ".conductor", "plugins", `${name}.js`);
	if (existsSync(customPath)) {
		try {
			const mod = (await import(pathToFileURL(customPath).href)) as Record<string, unknown>;
			const customPlugin = (mod.default ?? mod.plugin) as AgentPlugin | undefined;
			if (
				customPlugin &&
				typeof customPlugin.id === "string" &&
				typeof customPlugin.parseUsage === "function"
			) {
				return customPlugin;
			}
			process.stderr.write(
				`conductor: WARNING: custom plugin at ${customPath} does not export a valid AgentPlugin — falling back to generic.\n`,
			);
		} catch (err) {
			process.stderr.write(
				`conductor: WARNING: failed to load custom plugin at ${customPath}: ${err instanceof Error ? err.message : String(err)} — falling back to generic.\n`,
			);
		}
	}

	// 2. Built-in by name
	const builtin = builtinPlugins[name];
	if (builtin) return builtin;

	// 3. Generic fallback
	return makeGenericPlugin(name);
}
