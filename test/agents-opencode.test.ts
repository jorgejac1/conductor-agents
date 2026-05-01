import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plugin } from "../src/agents/opencode.js";

describe("opencode plugin", () => {
	it("should parse tokens from valid opencode stderr summary", () => {
		const stderr = `
Some output
tokens: prompt=1200 response=400
`.trim();
		const result = plugin.parseUsage("", stderr);
		assert.ok(result !== null);
		assert.strictEqual(result.inputTokens, 1200);
		assert.strictEqual(result.outputTokens, 400);
	});

	it("should return null when no summary line is found", () => {
		const result = plugin.parseUsage("", "no token info here");
		assert.strictEqual(result, null);
	});

	it("should be case-insensitive for the summary line", () => {
		const stderr = "TOKENS: PROMPT=500 RESPONSE=250";
		const result = plugin.parseUsage("", stderr);
		assert.ok(result !== null);
		assert.strictEqual(result.inputTokens, 500);
		assert.strictEqual(result.outputTokens, 250);
	});

	it("should return correct defaultArgs with {task} placeholder", () => {
		const args = plugin.defaultArgs();
		assert.ok(Array.isArray(args));
		assert.ok(args.includes("{task}"), "should include {task} placeholder");
	});
});
