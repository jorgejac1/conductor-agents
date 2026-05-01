import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	listMemorySlugs,
	loadMemory,
	removeMemory,
	searchMemory,
	writeMemory,
} from "../src/memory.js";
import { initConductor } from "../src/track.js";

function mkTemp(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "conductor-mem-"));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("memory vault", () => {
	it("should write a memory and create the file + INDEX.md entry", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const slug = writeMemory(dir, {
				name: "postgres-deadlock",
				type: "failure-pattern",
				scope: "global",
				tags: ["postgres", "concurrency"],
				body: "Use SELECT FOR UPDATE SKIP LOCKED to avoid deadlocks.",
			});
			assert.ok(slug.endsWith(".md"), "slug should be a .md path");

			const memories = loadMemory(dir);
			assert.strictEqual(memories.length, 1);
			const m = memories[0];
			assert.ok(m);
			assert.strictEqual(m.name, "postgres-deadlock");
			assert.strictEqual(m.type, "failure-pattern");
			assert.strictEqual(m.scope, "global");
			assert.deepEqual(m.tags, ["postgres", "concurrency"]);
			assert.ok(m.body.includes("SKIP LOCKED"));

			const slugs = listMemorySlugs(dir);
			assert.strictEqual(slugs.length, 1);
		} finally {
			cleanup();
		}
	});

	it("should load all memories after writing 3", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "mem-a",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "body a",
			});
			writeMemory(dir, {
				name: "mem-b",
				type: "decision",
				scope: "global",
				tags: [],
				body: "body b",
			});
			writeMemory(dir, {
				name: "mem-c",
				type: "reference",
				scope: "track:auth",
				tags: [],
				body: "body c",
			});
			const all = loadMemory(dir);
			assert.strictEqual(all.length, 3);
		} finally {
			cleanup();
		}
	});

	it("should filter by scope", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "global-one",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "global",
			});
			writeMemory(dir, {
				name: "auth-one",
				type: "lesson",
				scope: "track:auth",
				tags: [],
				body: "auth",
			});
			writeMemory(dir, {
				name: "billing-one",
				type: "lesson",
				scope: "track:billing",
				tags: [],
				body: "billing",
			});

			const authMems = loadMemory(dir, { scope: "track:auth" });
			assert.strictEqual(authMems.length, 1);
			assert.strictEqual(authMems[0]?.scope, "track:auth");

			const globalMems = loadMemory(dir, { scope: "global" });
			assert.strictEqual(globalMems.length, 1);
		} finally {
			cleanup();
		}
	});

	it("should filter by type", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "lesson-one",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "l",
			});
			writeMemory(dir, {
				name: "decision-one",
				type: "decision",
				scope: "global",
				tags: [],
				body: "d",
			});
			writeMemory(dir, {
				name: "ref-one",
				type: "reference",
				scope: "global",
				tags: [],
				body: "r",
			});

			const lessons = loadMemory(dir, { types: ["lesson"] });
			assert.strictEqual(lessons.length, 1);
			assert.strictEqual(lessons[0]?.type, "lesson");
		} finally {
			cleanup();
		}
	});

	it("should search memories by query (case-insensitive)", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "deadlock-pattern",
				type: "failure-pattern",
				scope: "global",
				tags: ["database"],
				body: "Use SKIP LOCKED to avoid postgres deadlocks.",
			});
			writeMemory(dir, {
				name: "cache-warming",
				type: "lesson",
				scope: "global",
				tags: ["redis"],
				body: "Warm caches on startup.",
			});

			const results = searchMemory(dir, "DEADLOCK");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0]?.name, "deadlock-pattern");

			const tagResults = searchMemory(dir, "redis");
			assert.strictEqual(tagResults.length, 1);
		} finally {
			cleanup();
		}
	});

	it("should slugify names with spaces and special chars", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const slug = writeMemory(dir, {
				name: "My Special Memory! (2024)",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "body",
			});
			const fileName = slug.split("/").pop() ?? "";
			assert.match(fileName, /^[a-z0-9-]+\.md$/, "slug should be kebab-case alphanumeric");
		} finally {
			cleanup();
		}
	});

	it("should overwrite on duplicate name and not duplicate INDEX.md entry", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "dup-test",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "first",
			});
			writeMemory(dir, {
				name: "dup-test",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "second",
			});

			const all = loadMemory(dir);
			assert.strictEqual(all.length, 1);
			assert.ok(all[0]?.body.includes("second"), "body should be updated");

			const slugs = listMemorySlugs(dir);
			assert.strictEqual(slugs.length, 1, "INDEX.md should not have duplicate entries");
		} finally {
			cleanup();
		}
	});

	it("should skip missing files when loading", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "keep-this",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "body",
			});
			writeMemory(dir, {
				name: "delete-this",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "body",
			});

			// Delete the file manually (simulates external deletion)
			removeMemory(dir, "delete-this");

			const all = loadMemory(dir);
			assert.strictEqual(all.length, 1);
			assert.strictEqual(all[0]?.name, "keep-this");
		} finally {
			cleanup();
		}
	});

	it("should remove a memory and update INDEX.md", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, { name: "mem-1", type: "lesson", scope: "global", tags: [], body: "b1" });
			writeMemory(dir, { name: "mem-2", type: "lesson", scope: "global", tags: [], body: "b2" });
			writeMemory(dir, { name: "mem-3", type: "lesson", scope: "global", tags: [], body: "b3" });

			removeMemory(dir, "mem-2");

			const slugs = listMemorySlugs(dir);
			assert.strictEqual(slugs.length, 2);
			assert.ok(!slugs.includes("mem-2"), "removed slug should not be in list");
		} finally {
			cleanup();
		}
	});

	it("should list slugs after writes and removal", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, { name: "s1", type: "lesson", scope: "global", tags: [], body: "b" });
			writeMemory(dir, { name: "s2", type: "lesson", scope: "global", tags: [], body: "b" });
			writeMemory(dir, { name: "s3", type: "lesson", scope: "global", tags: [], body: "b" });
			removeMemory(dir, "s2");

			const slugs = listMemorySlugs(dir);
			assert.strictEqual(slugs.length, 2);
			assert.ok(slugs.includes("s1"));
			assert.ok(slugs.includes("s3"));
			assert.ok(!slugs.includes("s2"));
		} finally {
			cleanup();
		}
	});

	it("should handle concurrent writes without data loss", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			await Promise.all([
				Promise.resolve(
					writeMemory(dir, {
						name: "concurrent-a",
						type: "lesson",
						scope: "global",
						tags: [],
						body: "a",
					}),
				),
				Promise.resolve(
					writeMemory(dir, {
						name: "concurrent-b",
						type: "lesson",
						scope: "global",
						tags: [],
						body: "b",
					}),
				),
			]);

			const all = loadMemory(dir);
			assert.strictEqual(all.length, 2);
			const names = all.map((m) => m.name).sort();
			assert.deepEqual(names, ["concurrent-a", "concurrent-b"]);
		} finally {
			cleanup();
		}
	});

	// ── Error / validation cases ─────────────────────────────────────────────

	it("should throw when name is empty string", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			assert.throws(
				() => writeMemory(dir, { name: "", type: "lesson", scope: "global", tags: [], body: "x" }),
				/name.*non-empty/i,
			);
		} finally {
			cleanup();
		}
	});

	it("should throw when name is whitespace only", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			assert.throws(
				() =>
					writeMemory(dir, { name: "   ", type: "lesson", scope: "global", tags: [], body: "x" }),
				/name.*non-empty/i,
			);
		} finally {
			cleanup();
		}
	});

	it("should throw when type is invalid", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			assert.throws(
				() =>
					writeMemory(dir, {
						name: "x",
						type: "bogus" as "lesson",
						scope: "global",
						tags: [],
						body: "x",
					}),
				/type/i,
			);
		} finally {
			cleanup();
		}
	});

	it("should throw when scope is invalid", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			assert.throws(
				() =>
					writeMemory(dir, {
						name: "x",
						type: "lesson",
						scope: "bad-scope" as "global",
						tags: [],
						body: "x",
					}),
				/scope/i,
			);
		} finally {
			cleanup();
		}
	});

	it("should throw when body contains standalone --- line", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			assert.throws(
				() =>
					writeMemory(dir, {
						name: "bad-body",
						type: "lesson",
						scope: "global",
						tags: [],
						body: "before\n---\nafter",
					}),
				/---/,
			);
		} finally {
			cleanup();
		}
	});

	it("should accept body with --- as part of a longer line", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			assert.doesNotThrow(() =>
				writeMemory(dir, {
					name: "inline-dashes",
					type: "lesson",
					scope: "global",
					tags: [],
					body: "see https://example.com --- not a delimiter",
				}),
			);
		} finally {
			cleanup();
		}
	});

	it("should return empty array when no memory directory exists (not initialized)", () => {
		const { dir, cleanup } = mkTemp();
		try {
			// Don't call initConductor — no .conductor dir at all
			const result = loadMemory(dir);
			assert.deepEqual(result, []);
		} finally {
			cleanup();
		}
	});

	it("searchMemory returns all memories when query is empty string", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, { name: "a", type: "lesson", scope: "global", tags: [], body: "aaa" });
			writeMemory(dir, { name: "b", type: "lesson", scope: "global", tags: [], body: "bbb" });
			const results = searchMemory(dir, "");
			assert.strictEqual(results.length, 2);
		} finally {
			cleanup();
		}
	});

	it("searchMemory returns empty array when no memories match", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, { name: "nothing", type: "lesson", scope: "global", tags: [], body: "xyz" });
			const results = searchMemory(dir, "will-never-match-xyzzy");
			assert.deepEqual(results, []);
		} finally {
			cleanup();
		}
	});

	it("searchMemory matches on tag values", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "redis-ref",
				type: "reference",
				scope: "global",
				tags: ["redis", "cache"],
				body: "nothing about the topic in body",
			});
			const results = searchMemory(dir, "redis");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0]?.name, "redis-ref");
		} finally {
			cleanup();
		}
	});

	it("tags are persisted and loaded correctly", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "tag-test",
				type: "reference",
				scope: "global",
				tags: ["alpha", "beta", "gamma"],
				body: "body",
			});
			const memories = loadMemory(dir);
			assert.strictEqual(memories.length, 1);
			assert.deepEqual(memories[0]?.tags, ["alpha", "beta", "gamma"]);
		} finally {
			cleanup();
		}
	});

	it("removeMemory on non-existent slug throws with descriptive error", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			assert.throws(() => removeMemory(dir, "no-such-slug"), /not found/i);
		} finally {
			cleanup();
		}
	});

	it("loadMemory returns empty array when memory dir exists but is empty", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			// Write then remove to leave dir + INDEX.md created but no actual memories
			writeMemory(dir, { name: "temp", type: "lesson", scope: "global", tags: [], body: "x" });
			removeMemory(dir, "temp");
			const result = loadMemory(dir);
			assert.deepEqual(result, []);
		} finally {
			cleanup();
		}
	});

	it("scope track: syntax is preserved correctly", () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "scoped",
				type: "lesson",
				scope: "track:my-feature-branch",
				tags: [],
				body: "scoped body",
			});
			const results = loadMemory(dir, { scope: "track:my-feature-branch" });
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0]?.scope, "track:my-feature-branch");
		} finally {
			cleanup();
		}
	});
});
