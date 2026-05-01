import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Memory } from "../src/memory.js";
import { formatMemoriesForPrompt } from "../src/memory.js";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
	return {
		name: "test-memory",
		type: "lesson",
		scope: "global",
		tags: [],
		body: "This is a test memory body.",
		filePath: "/tmp/test-memory.md",
		createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
		...overrides,
	};
}

describe("formatMemoriesForPrompt", () => {
	it("should return empty string for 0 memories", () => {
		const result = formatMemoriesForPrompt([]);
		assert.strictEqual(result, "");
	});

	it("should format a single global memory with section header", () => {
		const memory = makeMemory({ name: "deadlock-pattern", body: "Use SKIP LOCKED." });
		const result = formatMemoriesForPrompt([memory]);
		assert.ok(result.startsWith("## Memories"), "should start with ## Memories");
		assert.ok(result.includes("[lesson]"), "should include type badge");
		assert.ok(result.includes("deadlock-pattern"), "should include name");
		assert.ok(result.includes("Use SKIP LOCKED."), "should include body");
	});

	it("should include both global and track-scoped memories", () => {
		const global = makeMemory({ name: "global-mem", scope: "global", body: "global body" });
		const track = makeMemory({
			name: "track-mem",
			scope: "track:auth",
			body: "track body",
			createdAt: new Date("2026-01-02T00:00:00Z").toISOString(),
		});
		const result = formatMemoriesForPrompt([global, track]);
		assert.ok(result.includes("global-mem"), "global memory should appear");
		assert.ok(result.includes("track-mem"), "track memory should appear");
	});

	it("should enforce byte budget and drop oldest memories first", () => {
		const memories: Memory[] = [];
		const now = new Date("2026-01-01T00:00:00Z");
		for (let i = 0; i < 20; i++) {
			memories.push(
				makeMemory({
					name: `memory-${String(i).padStart(3, "0")}`,
					body: "x".repeat(200),
					// Older memories have earlier timestamps
					createdAt: new Date(now.getTime() + i * 1000).toISOString(),
				}),
			);
		}
		const budget = 1000;
		const result = formatMemoriesForPrompt(memories, budget);
		assert.ok(
			Buffer.byteLength(result, "utf8") <= budget,
			`result should fit within ${budget} bytes`,
		);
		// Most recent memories should be kept; oldest (memory-000) should be dropped when budget is tight
		// With 20 memories × 200+ bytes each, most will be dropped
		assert.ok(result.includes("memory-019"), "most recent memory should be included");
	});

	it("should respect custom budget override", () => {
		const memories = [
			makeMemory({ name: "m1", body: "a".repeat(50) }),
			makeMemory({ name: "m2", body: "b".repeat(50) }),
		];
		const tinyBudget = 100;
		const result = formatMemoriesForPrompt(memories, tinyBudget);
		assert.ok(
			Buffer.byteLength(result, "utf8") <= tinyBudget,
			"result should fit within custom budget",
		);
	});

	it("should render failure-pattern type with correct prefix", () => {
		const memory = makeMemory({ type: "failure-pattern", name: "deadlock" });
		const result = formatMemoriesForPrompt([memory]);
		assert.ok(result.includes("[failure-pattern]"), "should include [failure-pattern] prefix");
	});

	it("should handle empty body gracefully", () => {
		const memory = makeMemory({ body: "" });
		const result = formatMemoriesForPrompt([memory]);
		assert.ok(result.includes("test-memory"), "should still include memory name");
	});

	it("should output memories in newest-first order", () => {
		const older = makeMemory({
			name: "older-mem",
			body: "old",
			createdAt: new Date("2025-01-01T00:00:00Z").toISOString(),
		});
		const newer = makeMemory({
			name: "newer-mem",
			body: "new",
			createdAt: new Date("2026-06-01T00:00:00Z").toISOString(),
		});
		// Pass older first, expect newer to appear first in output
		const result = formatMemoriesForPrompt([older, newer]);
		const newerIdx = result.indexOf("newer-mem");
		const olderIdx = result.indexOf("older-mem");
		assert.ok(newerIdx < olderIdx, "newer memory should appear before older one");
	});

	it("should include all memories when total is under budget", () => {
		const memories = [
			makeMemory({ name: "m1", body: "body1" }),
			makeMemory({ name: "m2", body: "body2" }),
			makeMemory({ name: "m3", body: "body3" }),
		];
		const result = formatMemoriesForPrompt(memories, 8192);
		assert.ok(result.includes("m1"));
		assert.ok(result.includes("m2"));
		assert.ok(result.includes("m3"));
	});

	it("should not use prompt separator (---) inside memory entries even if body has dashes in line", () => {
		const memory = makeMemory({ body: "see: https://example.com --- description" });
		const result = formatMemoriesForPrompt([memory]);
		// Inline --- should not break the output — content still present
		assert.ok(result.includes("https://example.com --- description"));
	});

	it("should render decision type with correct prefix", () => {
		const memory = makeMemory({ type: "decision", name: "use-postgres" });
		const result = formatMemoriesForPrompt([memory]);
		assert.ok(result.includes("[decision]"));
	});

	it("should render reference type with correct prefix", () => {
		const memory = makeMemory({ type: "reference", name: "redis-docs" });
		const result = formatMemoriesForPrompt([memory]);
		assert.ok(result.includes("[reference]"));
	});

	it("should include memory name and body regardless of tags", () => {
		// formatMemoriesForPrompt formats as: [type] name: body
		// Tags are stored in the memory file but not injected into the prompt (kept compact)
		const memory = makeMemory({
			name: "tagged",
			tags: ["postgres", "concurrency"],
			body: "key insight",
		});
		const result = formatMemoriesForPrompt([memory]);
		assert.ok(result.includes("tagged"), "name should appear");
		assert.ok(result.includes("key insight"), "body should appear");
	});
});
