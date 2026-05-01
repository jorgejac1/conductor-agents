import type { AgentPlugin } from "./types.js";

// OpenAI's codex CLI emits a final JSON object to stdout with a `usage` field.
function parseUsage(
	logContent: string,
	_stderr: string,
): { inputTokens: number; outputTokens: number } | null {
	for (const line of logContent.split("\n").reverse()) {
		if (!line.trim().startsWith("{")) continue;
		try {
			const obj = JSON.parse(line) as Record<string, unknown>;
			const usage = obj.usage as Record<string, number> | undefined;
			if (
				usage &&
				(typeof usage.input_tokens === "number" || typeof usage.prompt_tokens === "number")
			) {
				const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
				const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
				return { inputTokens, outputTokens };
			}
		} catch {}
	}
	return null;
}

export const plugin: AgentPlugin = {
	id: "codex",
	defaultCmd: "codex",
	defaultArgs: () => ["--full-auto", "{task}"],
	parseUsage,
};
