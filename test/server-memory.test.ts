import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { writeMemory } from "../src/memory.js";
import { type ServerHandle, startServer } from "../src/server.js";
import { initConductor } from "../src/track.js";

function tmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-srv-mem-"));
	execSync("git init && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
	return dir;
}

async function withServer(fn: (port: number, dir: string) => Promise<void>): Promise<void> {
	const dir = tmpDir();
	let handle: ServerHandle | undefined;
	try {
		initConductor(dir);
		handle = await startServer({ port: 0, cwd: dir });
		await fn(handle.port, dir);
	} finally {
		handle?.stop();
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("GET /api/memory", () => {
	it("returns empty array when no memories exist", async () => {
		await withServer(async (port) => {
			const res = await fetch(`http://localhost:${port}/api/memory`);
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { memories: unknown[] };
			assert.deepEqual(data.memories, []);
		});
	});

	it("returns all memories when no filters applied", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, { name: "mem-a", type: "lesson", scope: "global", tags: [], body: "aaa" });
			writeMemory(dir, {
				name: "mem-b",
				type: "decision",
				scope: "track:auth",
				tags: [],
				body: "bbb",
			});
			const res = await fetch(`http://localhost:${port}/api/memory`);
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.strictEqual(data.memories.length, 2);
		});
	});

	it("filters by ?scope=global", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "global-one",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "g",
			});
			writeMemory(dir, {
				name: "auth-one",
				type: "lesson",
				scope: "track:auth",
				tags: [],
				body: "a",
			});
			const res = await fetch(`http://localhost:${port}/api/memory?scope=global`);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.strictEqual(data.memories.length, 1);
			assert.strictEqual(data.memories[0]?.name, "global-one");
		});
	});

	it("filters by ?type=decision", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, { name: "l1", type: "lesson", scope: "global", tags: [], body: "x" });
			writeMemory(dir, { name: "d1", type: "decision", scope: "global", tags: [], body: "x" });
			const res = await fetch(`http://localhost:${port}/api/memory?type=decision`);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.strictEqual(data.memories.length, 1);
			assert.strictEqual(data.memories[0]?.name, "d1");
		});
	});

	it("filters by both ?scope= and ?type=", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, { name: "g-lesson", type: "lesson", scope: "global", tags: [], body: "x" });
			writeMemory(dir, {
				name: "g-decision",
				type: "decision",
				scope: "global",
				tags: [],
				body: "x",
			});
			writeMemory(dir, {
				name: "t-lesson",
				type: "lesson",
				scope: "track:api",
				tags: [],
				body: "x",
			});
			const res = await fetch(`http://localhost:${port}/api/memory?scope=global&type=lesson`);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.strictEqual(data.memories.length, 1);
			assert.strictEqual(data.memories[0]?.name, "g-lesson");
		});
	});

	it("returns 200 with empty array for unrecognised type filter", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, { name: "x", type: "lesson", scope: "global", tags: [], body: "x" });
			const res = await fetch(`http://localhost:${port}/api/memory?type=unknown-type`);
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { memories: unknown[] };
			assert.strictEqual(data.memories.length, 0);
		});
	});

	it("response includes filePath and createdAt fields", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "check-fields",
				type: "reference",
				scope: "global",
				tags: ["t1"],
				body: "ref",
			});
			const res = await fetch(`http://localhost:${port}/api/memory`);
			const data = (await res.json()) as { memories: Record<string, unknown>[] };
			const mem = data.memories[0];
			assert.ok(mem);
			assert.ok(typeof mem.filePath === "string", "filePath should be a string");
			assert.ok(typeof mem.createdAt === "string", "createdAt should be a string");
			assert.ok(typeof mem.name === "string");
			assert.ok(Array.isArray(mem.tags));
		});
	});

	it("has Cache-Control: no-store header", async () => {
		await withServer(async (port) => {
			const res = await fetch(`http://localhost:${port}/api/memory`);
			assert.strictEqual(res.headers.get("cache-control"), "no-store");
		});
	});
});

describe("GET /api/memory/:slug", () => {
	it("returns the memory when slug matches", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "my-lesson",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "the body",
			});
			const res = await fetch(`http://localhost:${port}/api/memory/my-lesson`);
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { memory: { name: string; body: string } };
			assert.strictEqual(data.memory.name, "my-lesson");
			assert.strictEqual(data.memory.body, "the body");
		});
	});

	it("returns 404 for unknown slug", async () => {
		await withServer(async (port) => {
			const res = await fetch(`http://localhost:${port}/api/memory/does-not-exist`);
			assert.strictEqual(res.status, 404);
			const data = (await res.json()) as { error: string };
			assert.ok(data.error.includes("memory not found") || data.error.includes("does-not-exist"));
		});
	});

	it("returns correct type and scope fields", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "typed",
				type: "failure-pattern",
				scope: "track:billing",
				tags: ["pg"],
				body: "details",
			});
			const res = await fetch(`http://localhost:${port}/api/memory/typed`);
			const data = (await res.json()) as {
				memory: { type: string; scope: string; tags: string[] };
			};
			assert.strictEqual(data.memory.type, "failure-pattern");
			assert.strictEqual(data.memory.scope, "track:billing");
			assert.deepEqual(data.memory.tags, ["pg"]);
		});
	});
});

describe("POST /api/memory", () => {
	it("creates a memory and returns ok + filePath", async () => {
		await withServer(async (port) => {
			const res = await fetch(`http://localhost:${port}/api/memory`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "posted-lesson",
					type: "lesson",
					scope: "global",
					body: "written via API",
				}),
			});
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { ok: boolean; filePath: string };
			assert.strictEqual(data.ok, true);
			assert.ok(data.filePath.includes("posted-lesson"));
		});
	});

	it("memory is readable via GET after POST", async () => {
		await withServer(async (port) => {
			await fetch(`http://localhost:${port}/api/memory`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "roundtrip",
					type: "decision",
					scope: "global",
					body: "round trip body",
				}),
			});
			const res = await fetch(`http://localhost:${port}/api/memory/roundtrip`);
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { memory: { body: string } };
			assert.strictEqual(data.memory.body, "round trip body");
		});
	});

	it("accepts optional tags array", async () => {
		await withServer(async (port) => {
			await fetch(`http://localhost:${port}/api/memory`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "tagged",
					type: "lesson",
					scope: "global",
					body: "x",
					tags: ["foo", "bar"],
				}),
			});
			const res = await fetch(`http://localhost:${port}/api/memory/tagged`);
			const data = (await res.json()) as { memory: { tags: string[] } };
			assert.deepEqual(data.memory.tags, ["foo", "bar"]);
		});
	});

	it("returns 400 for invalid JSON body", async () => {
		await withServer(async (port) => {
			const res = await fetch(`http://localhost:${port}/api/memory`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not-json{{{",
			});
			assert.strictEqual(res.status, 400);
			const data = (await res.json()) as { error: string };
			assert.ok(data.error.length > 0);
		});
	});

	it("returns 400 when required fields are missing", async () => {
		await withServer(async (port) => {
			const res = await fetch(`http://localhost:${port}/api/memory`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ body: "missing name and type" }),
			});
			assert.strictEqual(res.status, 400);
		});
	});

	it("broadcasts memory-changed SSE event after write", async () => {
		await withServer(async (port) => {
			const eventsRes = await fetch(`http://localhost:${port}/api/events`);
			const reader = eventsRes.body?.getReader();
			const dec = new TextDecoder();

			const drain = async (): Promise<string[]> => {
				const events: string[] = [];
				const deadline = Date.now() + 3000;
				while (Date.now() < deadline) {
					const result = await Promise.race([
						reader?.read(),
						new Promise<{ done: boolean; value: undefined }>((r) =>
							setTimeout(() => r({ done: false, value: undefined }), 200),
						),
					]);
					if (!result || result.done) break;
					if (result.value) events.push(dec.decode(result.value));
				}
				reader?.cancel();
				return events;
			};

			// Write after small delay to let SSE connect
			await new Promise((r) => setTimeout(r, 100));
			await fetch(`http://localhost:${port}/api/memory`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "sse-test", type: "lesson", scope: "global", body: "sse" }),
			});

			const events = await drain();
			const combined = events.join("");
			assert.ok(combined.includes("memory-changed"), "SSE should include memory-changed event");
		});
	});
});

describe("DELETE /api/memory/:slug", () => {
	it("deletes an existing memory and returns ok", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "to-delete",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "bye",
			});
			const res = await fetch(`http://localhost:${port}/api/memory/to-delete`, {
				method: "DELETE",
			});
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { ok: boolean };
			assert.strictEqual(data.ok, true);
		});
	});

	it("deleted memory no longer appears in GET list", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, { name: "del-check", type: "lesson", scope: "global", tags: [], body: "x" });
			await fetch(`http://localhost:${port}/api/memory/del-check`, { method: "DELETE" });
			const res = await fetch(`http://localhost:${port}/api/memory`);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.ok(!data.memories.some((m) => m.name === "del-check"));
		});
	});

	it("returns 404 when deleting unknown slug", async () => {
		await withServer(async (port) => {
			const res = await fetch(`http://localhost:${port}/api/memory/no-such-slug`, {
				method: "DELETE",
			});
			assert.strictEqual(res.status, 404);
		});
	});

	it("broadcasts memory-changed after delete", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, { name: "del-sse", type: "lesson", scope: "global", tags: [], body: "x" });

			const eventsRes = await fetch(`http://localhost:${port}/api/events`);
			const reader = eventsRes.body?.getReader();
			const dec = new TextDecoder();

			await new Promise((r) => setTimeout(r, 100));
			await fetch(`http://localhost:${port}/api/memory/del-sse`, { method: "DELETE" });

			const events: string[] = [];
			const deadline = Date.now() + 3000;
			while (Date.now() < deadline) {
				const result = await Promise.race([
					reader?.read(),
					new Promise<{ done: boolean; value: undefined }>((r) =>
						setTimeout(() => r({ done: false, value: undefined }), 200),
					),
				]);
				if (!result || result.done) break;
				if (result.value) events.push(dec.decode(result.value));
			}
			reader?.cancel();

			assert.ok(events.join("").includes("memory-changed"));
		});
	});
});

describe("GET /api/memory/search", () => {
	it("returns matching memories for ?q= query", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "deadlock-fix",
				type: "failure-pattern",
				scope: "global",
				tags: [],
				body: "Use SKIP LOCKED to avoid deadlocks.",
			});
			writeMemory(dir, {
				name: "cache-warming",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "Warm caches on startup.",
			});
			const res = await fetch(`http://localhost:${port}/api/memory/search?q=deadlock`);
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.strictEqual(data.memories.length, 1);
			assert.strictEqual(data.memories[0]?.name, "deadlock-fix");
		});
	});

	it("search is case-insensitive", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "pg-tip",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "PostgreSQL connection pooling trick.",
			});
			const res = await fetch(`http://localhost:${port}/api/memory/search?q=POSTGRESQL`);
			const data = (await res.json()) as { memories: unknown[] };
			assert.strictEqual(data.memories.length, 1);
		});
	});

	it("returns empty array when no matches found", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "unrelated",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "nothing useful here",
			});
			const res = await fetch(`http://localhost:${port}/api/memory/search?q=xyzzy-no-match`);
			const data = (await res.json()) as { memories: unknown[] };
			assert.deepEqual(data.memories, []);
		});
	});

	it("matches on tags too", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "redis-mem",
				type: "reference",
				scope: "global",
				tags: ["redis", "cache"],
				body: "see redis docs",
			});
			const res = await fetch(`http://localhost:${port}/api/memory/search?q=redis`);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.ok(data.memories.some((m) => m.name === "redis-mem"));
		});
	});

	it("filters search results by ?scope=", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "global-match",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "keyword here",
			});
			writeMemory(dir, {
				name: "track-match",
				type: "lesson",
				scope: "track:auth",
				tags: [],
				body: "keyword here",
			});
			const res = await fetch(`http://localhost:${port}/api/memory/search?q=keyword&scope=global`);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.strictEqual(data.memories.length, 1);
			assert.strictEqual(data.memories[0]?.name, "global-match");
		});
	});

	it("returns all memories when ?q= is empty string", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, { name: "a1", type: "lesson", scope: "global", tags: [], body: "x" });
			writeMemory(dir, { name: "a2", type: "lesson", scope: "global", tags: [], body: "x" });
			const res = await fetch(`http://localhost:${port}/api/memory/search?q=`);
			const data = (await res.json()) as { memories: unknown[] };
			assert.strictEqual(data.memories.length, 2);
		});
	});
});

// ── Combinatorial type × scope coverage ──────────────────────────────────────

describe("POST /api/memory — all types and scopes", () => {
	it("creates failure-pattern memory via POST and retrieves it", async () => {
		await withServer(async (port) => {
			await fetch(`http://localhost:${port}/api/memory`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "fp-via-api",
					type: "failure-pattern",
					scope: "global",
					body: "avoid this pattern",
				}),
			});
			const res = await fetch(`http://localhost:${port}/api/memory/fp-via-api`);
			const data = (await res.json()) as { memory: { type: string } };
			assert.strictEqual(data.memory.type, "failure-pattern");
		});
	});

	it("creates reference memory via POST", async () => {
		await withServer(async (port) => {
			const res = await fetch(`http://localhost:${port}/api/memory`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "ref-via-api",
					type: "reference",
					scope: "global",
					body: "see docs",
				}),
			});
			assert.strictEqual(res.status, 200);
		});
	});

	it("creates track-scoped memory via POST", async () => {
		await withServer(async (port) => {
			const res = await fetch(`http://localhost:${port}/api/memory`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "track-mem",
					type: "lesson",
					scope: "track:auth",
					body: "auth lesson",
				}),
			});
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { ok: boolean };
			assert.strictEqual(data.ok, true);
		});
	});

	it("track-scoped memory appears in list but not in global-only filter", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, { name: "g-mem", type: "lesson", scope: "global", tags: [], body: "x" });
			writeMemory(dir, {
				name: "t-mem",
				type: "lesson",
				scope: "track:billing",
				tags: [],
				body: "x",
			});
			const globalRes = await fetch(`http://localhost:${port}/api/memory?scope=global`);
			const globalData = (await globalRes.json()) as { memories: { name: string }[] };
			assert.ok(globalData.memories.some((m) => m.name === "g-mem"));
			assert.ok(!globalData.memories.some((m) => m.name === "t-mem"));

			const allRes = await fetch(`http://localhost:${port}/api/memory`);
			const allData = (await allRes.json()) as { memories: { name: string }[] };
			assert.strictEqual(allData.memories.length, 2);
		});
	});

	it("POST without tags field defaults to empty tags array", async () => {
		await withServer(async (port) => {
			await fetch(`http://localhost:${port}/api/memory`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "no-tags", type: "lesson", scope: "global", body: "x" }),
			});
			const res = await fetch(`http://localhost:${port}/api/memory/no-tags`);
			const data = (await res.json()) as { memory: { tags: string[] } };
			assert.deepEqual(data.memory.tags, []);
		});
	});

	it("GET ?type=failure-pattern returns only failure-pattern memories", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "fp1",
				type: "failure-pattern",
				scope: "global",
				tags: [],
				body: "x",
			});
			writeMemory(dir, { name: "ref1", type: "reference", scope: "global", tags: [], body: "x" });
			writeMemory(dir, { name: "les1", type: "lesson", scope: "global", tags: [], body: "x" });
			const res = await fetch(`http://localhost:${port}/api/memory?type=failure-pattern`);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.strictEqual(data.memories.length, 1);
			assert.strictEqual(data.memories[0]?.name, "fp1");
		});
	});

	it("GET ?type=reference returns only reference memories", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, { name: "r1", type: "reference", scope: "global", tags: [], body: "x" });
			writeMemory(dir, { name: "d1", type: "decision", scope: "global", tags: [], body: "x" });
			const res = await fetch(`http://localhost:${port}/api/memory?type=reference`);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.strictEqual(data.memories.length, 1);
			assert.strictEqual(data.memories[0]?.name, "r1");
		});
	});

	it("GET ?scope=track:payments returns only that track's memories", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "p1",
				type: "lesson",
				scope: "track:payments",
				tags: [],
				body: "x",
			});
			writeMemory(dir, { name: "a1", type: "lesson", scope: "track:auth", tags: [], body: "x" });
			const res = await fetch(`http://localhost:${port}/api/memory?scope=track:payments`);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.strictEqual(data.memories.length, 1);
			assert.strictEqual(data.memories[0]?.name, "p1");
		});
	});

	it("GET /api/memory/search with ?q + ?scope=track:auth", async () => {
		await withServer(async (port, dir) => {
			writeMemory(dir, {
				name: "auth-match",
				type: "lesson",
				scope: "track:auth",
				tags: [],
				body: "keyword",
			});
			writeMemory(dir, {
				name: "global-match",
				type: "lesson",
				scope: "global",
				tags: [],
				body: "keyword",
			});
			const res = await fetch(
				`http://localhost:${port}/api/memory/search?q=keyword&scope=track:auth`,
			);
			const data = (await res.json()) as { memories: { name: string }[] };
			assert.strictEqual(data.memories.length, 1);
			assert.strictEqual(data.memories[0]?.name, "auth-match");
		});
	});
});
