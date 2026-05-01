import type { AgentPlugin } from "./types.js";

let warnedCmds: Set<string> | undefined;

function warnOnce(cmd: string): void {
	if (!warnedCmds) warnedCmds = new Set();
	if (warnedCmds.has(cmd)) return;
	warnedCmds.add(cmd);
	process.stderr.write(
		`conductor: WARNING: agent '${cmd}' has no plugin — token usage will not be tracked.\n` +
			`  Add a plugin at .conductor/plugins/${cmd}.js or use a built-in agent (claude, opencode, aider, codex, gemini).\n`,
	);
}

export const plugin: AgentPlugin = {
	id: "generic",
	defaultCmd: "",
	defaultArgs: () => ["{task}"],
	parseUsage: (_logContent, _stderr) => null,
};

/** Returns a generic plugin that emits a one-time warning for the given cmd. */
export function makeGenericPlugin(cmd: string): AgentPlugin {
	return {
		...plugin,
		id: `generic:${cmd}`,
		defaultCmd: cmd,
		parseUsage: (logContent, stderr) => {
			warnOnce(cmd);
			return plugin.parseUsage(logContent, stderr);
		},
	};
}
