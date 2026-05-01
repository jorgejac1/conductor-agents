import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plugin } from "../src/agents/codex.js";

const VALID_LOG = JSON.stringify({
	type: "result",
	usage: { input_tokens: 800, output_tokens: 320 },
});

const OPENAI_FORMAT_LOG = JSON.stringify({
	type: "result",
	usage: { prompt_tokens: 600, completion_tokens: 200 },
});

describe("codex plugin", () => {
	it("should parse tokens from usage.input_tokens / output_tokens", () => {
		const result = plugin.parseUsage(VALID_LOG, "");
		assert.ok(result !== null);
		assert.strictEqual(result.inputTokens, 800);
		assert.strictEqual(result.outputTokens, 320);
	});

	it("should parse tokens from prompt_tokens / completion_tokens fallback", () => {
		const result = plugin.parseUsage(OPENAI_FORMAT_LOG, "");
		assert.ok(result !== null);
		assert.strictEqual(result.inputTokens, 600);
		assert.strictEqual(result.outputTokens, 200);
	});

	it("should return null for malformed JSON", () => {
		const result = plugin.parseUsage("{invalid json", "");
		assert.strictEqual(result, null);
	});

	it("should return correct defaultArgs with {task} placeholder", () => {
		const args = plugin.defaultArgs();
		assert.ok(Array.isArray(args));
		assert.ok(args.includes("{task}"), "should include {task} placeholder");
	});
});
