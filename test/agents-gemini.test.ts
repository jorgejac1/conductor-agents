import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plugin } from "../src/agents/gemini.js";

const VALID_LOG = JSON.stringify({
	candidates: [{ content: { parts: [{ text: "result" }] } }],
	usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 350 },
});

describe("gemini plugin", () => {
	it("should parse tokens from usageMetadata", () => {
		const result = plugin.parseUsage(VALID_LOG, "");
		assert.ok(result !== null);
		assert.strictEqual(result.inputTokens, 1000);
		assert.strictEqual(result.outputTokens, 350);
	});

	it("should return null for malformed JSON", () => {
		const result = plugin.parseUsage("{not json", "");
		assert.strictEqual(result, null);
	});

	it("should return null when usageMetadata is missing", () => {
		const noUsage = JSON.stringify({ candidates: [] });
		const result = plugin.parseUsage(noUsage, "");
		assert.strictEqual(result, null);
	});

	it("should return correct defaultArgs with {task} placeholder", () => {
		const args = plugin.defaultArgs();
		assert.ok(Array.isArray(args));
		assert.ok(args.includes("{task}"), "should include {task} placeholder");
	});
});
