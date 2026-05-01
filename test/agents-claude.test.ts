import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plugin } from "../src/agents/claude.js";

const VALID_LOG = `
some output here
{"type":"result","subtype":"success","is_error":false,"result":"done","usage":{"input_tokens":1500,"output_tokens":750},"model":"claude-sonnet-4-6-20250514"}
`.trim();

const MULTI_LINE_LOG = `
random line
{"type":"text","text":"hello"}
another random line
{"type":"result","subtype":"success","is_error":false,"result":"done","usage":{"input_tokens":200,"output_tokens":100},"model":"claude-haiku-4-5"}
more stuff after
`.trim();

describe("claude plugin", () => {
	it("should parse tokens from valid Claude output-format json log", () => {
		const result = plugin.parseUsage(VALID_LOG, "");
		assert.ok(result !== null, "should return non-null");
		assert.strictEqual(result.inputTokens, 1500);
		assert.strictEqual(result.outputTokens, 750);
		assert.strictEqual(result.model, "claude-sonnet-4-6-20250514");
	});

	it("should find the result line among other non-result lines", () => {
		const result = plugin.parseUsage(MULTI_LINE_LOG, "");
		assert.ok(result !== null);
		assert.strictEqual(result.inputTokens, 200);
		assert.strictEqual(result.outputTokens, 100);
	});

	it("should return null for truncated/malformed JSON log", () => {
		const truncated = `{"type":"result","usage":{"input_tokens":100,"output`;
		const result = plugin.parseUsage(truncated, "");
		assert.strictEqual(result, null);
	});

	it("should return null for empty log", () => {
		const result = plugin.parseUsage("", "");
		assert.strictEqual(result, null);
	});

	it("should return correct defaultArgs with {task} placeholder", () => {
		const args = plugin.defaultArgs();
		assert.ok(Array.isArray(args));
		assert.ok(args.includes("{task}"), "args should include {task} placeholder");
		assert.ok(args.includes("--output-format"), "should include output format flag");
		assert.ok(args.includes("json"), "format should be json");
	});

	it("should have pricing set for input and output", () => {
		assert.ok(plugin.pricing !== undefined, "claude plugin should have pricing defined");
		assert.ok(typeof plugin.pricing?.input === "number" && plugin.pricing.input > 0);
		assert.ok(typeof plugin.pricing?.output === "number" && plugin.pricing.output > 0);
	});

	it("should return model from the result line", () => {
		const log = `{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{"input_tokens":10,"output_tokens":5},"model":"claude-opus-4-7"}`;
		const result = plugin.parseUsage(log, "");
		assert.ok(result !== null);
		assert.strictEqual(result.model, "claude-opus-4-7");
	});

	it("should ignore stderr and parse from log content", () => {
		const result = plugin.parseUsage(VALID_LOG, "some stderr warning output here");
		assert.ok(result !== null);
		assert.strictEqual(result.inputTokens, 1500);
	});

	it("should return null when log contains only non-result JSON lines", () => {
		const log = `{"type":"text","text":"hello"}\n{"type":"text","text":"world"}`;
		const result = plugin.parseUsage(log, "");
		assert.strictEqual(result, null);
	});

	it("defaultArgs result has --print flag for non-interactive mode", () => {
		const args = plugin.defaultArgs();
		assert.ok(args.includes("--print"), "should include --print for non-interactive");
	});
});
