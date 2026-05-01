import type { AgentPlugin } from "./types.js";

// Google's gemini CLI emits structured JSON to stdout with a `usageMetadata` field.
function parseUsage(
	logContent: string,
	_stderr: string,
): { inputTokens: number; outputTokens: number } | null {
	for (const line of logContent.split("\n").reverse()) {
		if (!line.trim().startsWith("{")) continue;
		try {
			const obj = JSON.parse(line) as Record<string, unknown>;
			const meta = obj.usageMetadata as Record<string, number> | undefined;
			if (meta && typeof meta.promptTokenCount === "number") {
				return {
					inputTokens: meta.promptTokenCount ?? 0,
					outputTokens: meta.candidatesTokenCount ?? 0,
				};
			}
		} catch {}
	}
	return null;
}

export const plugin: AgentPlugin = {
	id: "gemini",
	defaultCmd: "gemini",
	defaultArgs: () => ["{task}"],
	parseUsage,
};
