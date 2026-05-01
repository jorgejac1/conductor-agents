import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { cmdMemory } from "../src/cli/memory.js";
import { loadMemory, writeMemory } from "../src/memory.js";
import { initConductor } from "../src/track.js";

function mkTemp(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "conductor-mem-cli-"));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function capture(): { output: string[]; errors: string[]; restore: () => void } {
	const output: string[] = [];
	const errors: string[] = [];
	const origLog = console.log;
	const origErr = console.error;
	console.log = (...a: unknown[]) => output.push(a.join(" "));
	console.error = (...a: unknown[]) => errors.push(a.join(" "));
	return {
		output,
		errors,
		restore: () => {
			console.log = origLog;
			console.error = origErr;
		},
	};
}

describe("conductor memory CLI", () => {
	// ── list ──────────────────────────────────────────────────────────────────

	it("memory list: prints 'No memories found' on empty vault, exit 0", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(["list"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			assert.ok(cap.output.join(" ").toLowerCase().includes("no memories"));
		} finally {
			cleanup();
		}
	});

	it("memory list: shows all memories with scope, type, and name columns", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "pg-deadlock",
				type: "failure-pattern",
				scope: "global",
				tags: [],
				body: "b",
			});
			writeMemory(dir, {
				name: "auth-decision",
				type: "decision",
				scope: "track:auth",
				tags: [],
				body: "b",
			});
			const cap = capture();
			const code = await cmdMemory(["list"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			const out = cap.output.join("\n");
			assert.ok(out.includes("pg-deadlock"));
			assert.ok(out.includes("auth-decision"));
			assert.ok(out.includes("[failure-pattern]"));
			assert.ok(out.includes("[decision]"));
		} finally {
			cleanup();
		}
	});

	it("memory list --scope=global: only shows global memories", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, { name: "g1", type: "lesson", scope: "global", tags: [], body: "b" });
			writeMemory(dir, {
				name: "t1",
				type: "lesson",
				scope: "track:payments",
				tags: [],
				body: "b",
			});
			const cap = capture();
			const code = await cmdMemory(["list", "--scope=global"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			const out = cap.output.join("\n");
			assert.ok(out.includes("g1"));
			assert.ok(!out.includes("t1"), "track-scoped memory should not appear");
		} finally {
			cleanup();
		}
	});

	it("memory list --scope=track:auth: only shows that track's memories", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, { name: "g1", type: "lesson", scope: "global", tags: [], body: "b" });
			writeMemory(dir, { name: "auth1", type: "lesson", scope: "track:auth", tags: [], body: "b" });
			writeMemory(dir, {
				name: "billing1",
				type: "lesson",
				scope: "track:billing",
				tags: [],
				body: "b",
			});
			const cap = capture();
			const code = await cmdMemory(["list", "--scope=track:auth"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			const out = cap.output.join("\n");
			assert.ok(out.includes("auth1"));
			assert.ok(!out.includes("g1"));
			assert.ok(!out.includes("billing1"));
		} finally {
			cleanup();
		}
	});

	it("memory list --type=lesson: only shows lesson-type memories", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, { name: "lez", type: "lesson", scope: "global", tags: [], body: "b" });
			writeMemory(dir, { name: "dec", type: "decision", scope: "global", tags: [], body: "b" });
			writeMemory(dir, { name: "ref", type: "reference", scope: "global", tags: [], body: "b" });
			writeMemory(dir, {
				name: "fp",
				type: "failure-pattern",
				scope: "global",
				tags: [],
				body: "b",
			});
			const cap = capture();
			const code = await cmdMemory(["list", "--type=lesson"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			const out = cap.output.join("\n");
			assert.ok(out.includes("lez"));
			assert.ok(!out.includes("dec"));
			assert.ok(!out.includes("ref"));
			assert.ok(!out.includes("fp"));
		} finally {
			cleanup();
		}
	});

	it("memory list --type=failure-pattern: shows only failure-pattern", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "fp1",
				type: "failure-pattern",
				scope: "global",
				tags: [],
				body: "x",
			});
			writeMemory(dir, { name: "lesson1", type: "lesson", scope: "global", tags: [], body: "x" });
			const cap = capture();
			await cmdMemory(["list", "--type=failure-pattern"], dir);
			cap.restore();
			const out = cap.output.join("\n");
			assert.ok(out.includes("fp1"));
			assert.ok(!out.includes("lesson1"));
		} finally {
			cleanup();
		}
	});

	it("memory list --type=reference: shows only reference memories", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, { name: "r1", type: "reference", scope: "global", tags: [], body: "x" });
			writeMemory(dir, { name: "l1", type: "lesson", scope: "global", tags: [], body: "x" });
			const cap = capture();
			await cmdMemory(["list", "--type=reference"], dir);
			cap.restore();
			const out = cap.output.join("\n");
			assert.ok(out.includes("r1"));
			assert.ok(!out.includes("l1"));
		} finally {
			cleanup();
		}
	});

	// ── show ──────────────────────────────────────────────────────────────────

	it("memory show: prints memory details, exit 0", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "show-me",
				type: "decision",
				scope: "track:api",
				tags: ["alpha"],
				body: "the body content",
			});
			const cap = capture();
			const code = await cmdMemory(["show", "show-me"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			const out = cap.output.join("\n");
			assert.ok(out.includes("show-me"));
			assert.ok(out.includes("decision"));
			assert.ok(out.includes("track:api"));
			assert.ok(out.includes("alpha"));
			assert.ok(out.includes("the body content"));
		} finally {
			cleanup();
		}
	});

	it("memory show: exit 1 when slug not found", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(["show", "no-such-slug"], dir);
			cap.restore();
			assert.strictEqual(code, 1);
			assert.ok(
				cap.errors.join(" ").includes("not found") || cap.errors.join(" ").includes("no-such-slug"),
			);
		} finally {
			cleanup();
		}
	});

	it("memory show: exit 1 with usage when no slug provided", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(["show"], dir);
			cap.restore();
			assert.strictEqual(code, 1);
			assert.ok(cap.errors.join(" ").toLowerCase().includes("usage"));
		} finally {
			cleanup();
		}
	});

	// ── add ───────────────────────────────────────────────────────────────────

	it("memory add: creates memory file, exit 0", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(
				["add", "--name=new-lesson", "--type=lesson", "--scope=global", "--body=learned this"],
				dir,
			);
			cap.restore();
			assert.strictEqual(code, 0);
			assert.ok(cap.output.join(" ").includes("new-lesson"));
			const memories = loadMemory(dir);
			assert.strictEqual(memories.length, 1);
			assert.strictEqual(memories[0]?.name, "new-lesson");
		} finally {
			cleanup();
		}
	});

	it("memory add: works with --type=failure-pattern", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(
				["add", "--name=fp-test", "--type=failure-pattern", "--scope=global", "--body=avoid this"],
				dir,
			);
			cap.restore();
			assert.strictEqual(code, 0);
			const memories = loadMemory(dir, { types: ["failure-pattern"] });
			assert.strictEqual(memories.length, 1);
			assert.strictEqual(memories[0]?.type, "failure-pattern");
		} finally {
			cleanup();
		}
	});

	it("memory add: works with --type=reference", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(
				["add", "--name=ref-test", "--type=reference", "--scope=global", "--body=see docs"],
				dir,
			);
			cap.restore();
			assert.strictEqual(code, 0);
			const memories = loadMemory(dir, { types: ["reference"] });
			assert.strictEqual(memories.length, 1);
		} finally {
			cleanup();
		}
	});

	it("memory add: works with track scope", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(
				[
					"add",
					"--name=track-scoped",
					"--type=decision",
					"--scope=track:auth",
					"--body=track decision",
				],
				dir,
			);
			cap.restore();
			assert.strictEqual(code, 0);
			const memories = loadMemory(dir, { scope: "track:auth" });
			assert.strictEqual(memories.length, 1);
			assert.strictEqual(memories[0]?.scope, "track:auth");
		} finally {
			cleanup();
		}
	});

	it("memory add: accepts optional --tags= comma-separated", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			await cmdMemory(
				[
					"add",
					"--name=tagged-add",
					"--type=lesson",
					"--scope=global",
					"--body=body",
					"--tags=pg,cache",
				],
				dir,
			);
			cap.restore();
			const memories = loadMemory(dir);
			assert.deepEqual(memories[0]?.tags, ["pg", "cache"]);
		} finally {
			cleanup();
		}
	});

	it("memory add: exit 1 with usage when missing required flags", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(["add", "--name=incomplete"], dir);
			cap.restore();
			assert.strictEqual(code, 1);
			assert.ok(cap.errors.join(" ").toLowerCase().includes("usage"));
		} finally {
			cleanup();
		}
	});

	it("memory add: exit 1 with descriptive error for invalid type", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(
				["add", "--name=bad", "--type=not-a-type", "--scope=global", "--body=x"],
				dir,
			);
			cap.restore();
			assert.strictEqual(code, 1);
			assert.ok(cap.errors.join(" ").length > 0);
		} finally {
			cleanup();
		}
	});

	// ── rm ────────────────────────────────────────────────────────────────────

	it("memory rm: removes memory and prints confirmation, exit 0", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, { name: "to-remove", type: "lesson", scope: "global", tags: [], body: "x" });
			const cap = capture();
			const code = await cmdMemory(["rm", "to-remove"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			assert.ok(cap.output.join(" ").includes("to-remove"));
			assert.strictEqual(loadMemory(dir).length, 0);
		} finally {
			cleanup();
		}
	});

	it("memory rm: exit 1 with error when slug not found", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(["rm", "ghost-slug"], dir);
			cap.restore();
			assert.strictEqual(code, 1);
			assert.ok(
				cap.errors.join(" ").includes("ghost-slug") || cap.errors.join(" ").includes("not found"),
			);
		} finally {
			cleanup();
		}
	});

	it("memory rm: exit 1 with usage when no slug provided", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(["rm"], dir);
			cap.restore();
			assert.strictEqual(code, 1);
			assert.ok(cap.errors.join(" ").toLowerCase().includes("usage"));
		} finally {
			cleanup();
		}
	});

	it("memory remove: alias for rm works", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "alias-test",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "x",
			});
			const cap = capture();
			const code = await cmdMemory(["remove", "alias-test"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			assert.strictEqual(loadMemory(dir).length, 0);
		} finally {
			cleanup();
		}
	});

	// ── search ────────────────────────────────────────────────────────────────

	it("memory search: finds matching memory, exit 0", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "deadlock-fix",
				type: "failure-pattern",
				scope: "global",
				tags: [],
				body: "Use SKIP LOCKED.",
			});
			writeMemory(dir, {
				name: "cache-warmup",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "warm caches on start",
			});
			const cap = capture();
			const code = await cmdMemory(["search", "deadlock"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			const out = cap.output.join("\n");
			assert.ok(out.includes("deadlock-fix"));
			assert.ok(!out.includes("cache-warmup"));
		} finally {
			cleanup();
		}
	});

	it("memory search: case-insensitive matching", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "pg-tip",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "PostgreSQL connection tip",
			});
			const cap = capture();
			await cmdMemory(["search", "POSTGRESQL"], dir);
			cap.restore();
			assert.ok(cap.output.join(" ").includes("pg-tip"));
		} finally {
			cleanup();
		}
	});

	it("memory search: prints 'No matches' when nothing found, exit 0", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "unrelated",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "nothing here",
			});
			const cap = capture();
			const code = await cmdMemory(["search", "xyzzy-no-match"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			assert.ok(cap.output.join(" ").toLowerCase().includes("no matches"));
		} finally {
			cleanup();
		}
	});

	it("memory search --scope=global: filters by scope", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, {
				name: "g-match",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "keyword",
			});
			writeMemory(dir, {
				name: "t-match",
				type: "lesson",
				scope: "track:auth",
				tags: [],
				body: "keyword",
			});
			const cap = capture();
			await cmdMemory(["search", "keyword", "--scope=global"], dir);
			cap.restore();
			const out = cap.output.join("\n");
			assert.ok(out.includes("g-match"));
			assert.ok(!out.includes("t-match"));
		} finally {
			cleanup();
		}
	});

	it("memory search: exit 1 with usage when no query provided", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(["search"], dir);
			cap.restore();
			assert.strictEqual(code, 1);
			assert.ok(cap.errors.join(" ").toLowerCase().includes("usage"));
		} finally {
			cleanup();
		}
	});

	// ── slugs ─────────────────────────────────────────────────────────────────

	it("memory slugs: prints slugs one per line, exit 0", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			writeMemory(dir, { name: "slug-a", type: "lesson", scope: "global", tags: [], body: "x" });
			writeMemory(dir, { name: "slug-b", type: "lesson", scope: "global", tags: [], body: "x" });
			const cap = capture();
			const code = await cmdMemory(["slugs"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			const out = cap.output.join("\n");
			assert.ok(out.includes("slug-a"));
			assert.ok(out.includes("slug-b"));
		} finally {
			cleanup();
		}
	});

	it("memory slugs: prints 'No memories' when empty", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(["slugs"], dir);
			cap.restore();
			assert.strictEqual(code, 0);
			assert.ok(cap.output.join(" ").toLowerCase().includes("no memories"));
		} finally {
			cleanup();
		}
	});

	// ── no subcommand ─────────────────────────────────────────────────────────

	it("memory (no subcommand): prints usage, exit 1", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory([], dir);
			cap.restore();
			assert.strictEqual(code, 1);
			assert.ok(cap.errors.join(" ").toLowerCase().includes("usage"));
		} finally {
			cleanup();
		}
	});

	it("memory unknown-sub: prints usage, exit 1", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const cap = capture();
			const code = await cmdMemory(["bogus-subcommand"], dir);
			cap.restore();
			assert.strictEqual(code, 1);
		} finally {
			cleanup();
		}
	});
});
