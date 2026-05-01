import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeGenericPlugin } from "../src/agents/generic.js";

describe("generic plugin", () => {
	it("should always return null from parseUsage", () => {
		const p = makeGenericPlugin("weird-agent");
		assert.strictEqual(p.parseUsage("any log content", "any stderr"), null);
		assert.strictEqual(p.parseUsage("", ""), null);
		assert.strictEqual(p.parseUsage('{"type":"result"}', ""), null);
	});

	it("should emit a warning to stderr on first parse call per binary", (ctx) => {
		// Use a unique name so this test doesn't share state with other tests
		const uniqueName = `test-agent-${Date.now()}`;
		const p = makeGenericPlugin(uniqueName);
		const stderrWrites: string[] = [];
		const original = process.stderr.write.bind(process.stderr);
		ctx.mock.method(process.stderr, "write", (chunk: string) => {
			stderrWrites.push(chunk);
			return true;
		});
		p.parseUsage("log", "err");
		assert.ok(
			stderrWrites.some((w) => w.includes(uniqueName)),
			"warning should mention the agent name",
		);
		process.stderr.write = original;
	});
});
