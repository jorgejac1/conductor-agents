import type { AgentPlugin } from "./types.js";

// opencode writes a token summary to stderr on exit:
// "tokens: prompt=N response=M" or "Tokens: prompt=N response=M"
function parseUsage(
	_logContent: string,
	stderr: string,
): { inputTokens: number; outputTokens: number } | null {
	for (const line of stderr.split("\n").reverse()) {
		const m = /tokens:\s*prompt=(\d+)\s+response=(\d+)/i.exec(line);
		if (m) {
			return {
				inputTokens: parseInt(m[1] ?? "0", 10),
				outputTokens: parseInt(m[2] ?? "0", 10),
			};
		}
	}
	return null;
}

export const plugin: AgentPlugin = {
	id: "opencode",
	defaultCmd: "opencode",
	defaultArgs: () => ["run", "{task}"],
	parseUsage,
	// Pricing depends on model routed by opencode — undefined here; users may
	// set CONDUCTOR_PRICING_* env vars or leave USD tracking disabled.
};
