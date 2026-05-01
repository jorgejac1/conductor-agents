import type { AgentPlugin } from "./types.js";

// aider writes to stderr: "Tokens: 12,345 sent, 6,789 received"
function parseUsage(
	_logContent: string,
	stderr: string,
): { inputTokens: number; outputTokens: number } | null {
	for (const line of stderr.split("\n").reverse()) {
		// Match with optional thousands separators (commas)
		const m = /Tokens:\s*([\d,]+)\s+sent,\s*([\d,]+)\s+received/i.exec(line);
		if (m) {
			return {
				inputTokens: parseInt((m[1] ?? "0").replace(/,/g, ""), 10),
				outputTokens: parseInt((m[2] ?? "0").replace(/,/g, ""), 10),
			};
		}
	}
	return null;
}

export const plugin: AgentPlugin = {
	id: "aider",
	defaultCmd: "aider",
	defaultArgs: () => ["--message", "{task}", "--yes"],
	parseUsage,
};
