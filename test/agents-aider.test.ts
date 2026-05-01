import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plugin } from "../src/agents/aider.js";

describe("aider plugin", () => {
	it("should parse tokens from 'Tokens: N sent, M received' line", () => {
		const stderr = `
Aider v0.50.0
Tokens: 12345 sent, 6789 received.
`.trim();
		const result = plugin.parseUsage("", stderr);
		assert.ok(result !== null);
		assert.strictEqual(result.inputTokens, 12345);
		assert.strictEqual(result.outputTokens, 6789);
	});

	it("should handle thousands separators", () => {
		const stderr = "Tokens: 12,345 sent, 6,789 received.";
		const result = plugin.parseUsage("", stderr);
		assert.ok(result !== null);
		assert.strictEqual(result.inputTokens, 12345);
		assert.strictEqual(result.outputTokens, 6789);
	});

	it("should return null when no token line is found", () => {
		const result = plugin.parseUsage("", "no relevant output");
		assert.strictEqual(result, null);
	});

	it("should return correct defaultArgs with {task} placeholder", () => {
		const args = plugin.defaultArgs();
		assert.ok(Array.isArray(args));
		assert.ok(args.includes("{task}"), "should include {task} placeholder");
	});
});
