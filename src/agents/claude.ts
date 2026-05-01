import type { AgentPlugin } from "./types.js";

// Env-overridable pricing (USD per million tokens).
// Override: CONDUCTOR_PRICING_CLAUDE_INPUT / CONDUCTOR_PRICING_CLAUDE_OUTPUT
function claudePricing(): { input: number; output: number } {
	const input = Number(process.env.CONDUCTOR_PRICING_CLAUDE_INPUT ?? "3.00");
	const output = Number(process.env.CONDUCTOR_PRICING_CLAUDE_OUTPUT ?? "15.00");
	return {
		input: Number.isFinite(input) ? input : 3.0,
		output: Number.isFinite(output) ? output : 15.0,
	};
}

function parseUsage(
	logContent: string,
	_stderr: string,
): { inputTokens: number; outputTokens: number; model?: string } | null {
	for (const line of logContent.split("\n").reverse()) {
		if (!line.trim().startsWith("{")) continue;
		try {
			const obj = JSON.parse(line) as Record<string, unknown>;
			if (obj.type === "result") {
				const usage = obj.usage as Record<string, number> | undefined;
				const inputTokens = usage?.input_tokens ?? 0;
				const outputTokens = usage?.output_tokens ?? 0;
				if (typeof obj.model === "string") {
					return { inputTokens, outputTokens, model: obj.model };
				}
				return { inputTokens, outputTokens };
			}
		} catch {}
	}
	return null;
}

export const plugin: AgentPlugin = {
	id: "claude",
	defaultCmd: "claude",
	defaultArgs: () => ["--print", "--output-format", "json", "{task}"],
	parseUsage,
	get pricing() {
		return claudePricing();
	},
};
