import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { initConductor } from "../src/track.js";

interface RpcResult {
	id?: number;
	result?: unknown;
	error?: { code: number; message: string };
}

function rpc(cwd: string, requests: object[]): Promise<RpcResult[]> {
	const expectedCount = requests.filter((r) => (r as Record<string, unknown>).id != null).length;

	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			["--import", "tsx", join(process.cwd(), "src/cli.ts"), "mcp", cwd],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);

		const results: RpcResult[] = [];
		let buffer = "";

		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error(`MCP server timeout — got ${results.length}/${expectedCount} responses`));
		}, 15_000);

		child.stdout.on("data", (d: Buffer) => {
			buffer += d.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					results.push(JSON.parse(trimmed) as RpcResult);
				} catch {
					results.push({ error: { code: -1, message: `bad json: ${trimmed}` } });
				}
				if (results.length >= expectedCount) {
					clearTimeout(timeout);
					child.stdin.end();
				}
			}
		});

		for (const req of requests) {
			child.stdin.write(`${JSON.stringify(req)}\n`);
		}

		child.on("close", () => {
			clearTimeout(timeout);
			resolve(results);
		});

		child.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});
	});
}

function makeTmpProject(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), `conductor-mcp-mem-${Date.now()}-`));
	initConductor(dir);
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const INIT_REQUESTS = [
	{
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2024-11-05",
			clientInfo: { name: "test", version: "1.0" },
			capabilities: {},
		},
	},
	{ jsonrpc: "2.0", method: "notifications/initialized", params: {} },
];

describe("conductor MCP memory tools", () => {
	it("tools/list includes the 4 memory tools", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, listRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
			]);
			assert.ok(listRes?.result, "expected result");
			const r = listRes?.result as { tools?: { name: string }[] };
			const names = r.tools?.map((t) => t.name) ?? [];
			assert.ok(names.includes("read_memory"), "should include read_memory");
			assert.ok(names.includes("write_memory"), "should include write_memory");
			assert.ok(names.includes("search_memory"), "should include search_memory");
			assert.ok(names.includes("list_memories"), "should include list_memories");
		} finally {
			cleanup();
		}
	});

	it("write_memory creates a file and returns slug", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, writeRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: {
							name: "test-lesson",
							type: "lesson",
							scope: "global",
							body: "This is a test lesson body.",
						},
					},
				},
			]);
			assert.ok(writeRes?.result, "expected result");
			const r = writeRes?.result as { content?: { type: string; text: string }[] };
			const text = r.content?.[0]?.text ?? "";
			const parsed = JSON.parse(text) as { ok: boolean; slug: string };
			assert.strictEqual(parsed.ok, true);
			assert.ok(parsed.slug.length > 0, "slug should be non-empty");
		} finally {
			cleanup();
		}
	});

	it("read_memory returns written memories", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, , readRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: {
							name: "readable-memory",
							type: "decision",
							scope: "global",
							body: "This decision was made.",
						},
					},
				},
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: {
						name: "read_memory",
						arguments: { scope: "global" },
					},
				},
			]);
			assert.ok(readRes?.result, "expected result from read_memory");
			const r = readRes?.result as { content?: { type: string; text: string }[] };
			const text = r.content?.[0]?.text ?? "";
			const memories = JSON.parse(text) as unknown[];
			assert.ok(Array.isArray(memories), "should return an array");
			assert.ok(memories.length > 0, "should return at least one memory");
		} finally {
			cleanup();
		}
	});

	it("search_memory returns matching memories", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, , searchRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: {
							name: "searchable-pattern",
							type: "failure-pattern",
							scope: "global",
							body: "database deadlock on high concurrency",
						},
					},
				},
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: {
						name: "search_memory",
						arguments: { query: "deadlock" },
					},
				},
			]);
			assert.ok(searchRes?.result, "expected result from search_memory");
			const r = searchRes?.result as { content?: { type: string; text: string }[] };
			const text = r.content?.[0]?.text ?? "";
			const results = JSON.parse(text) as unknown[];
			assert.ok(Array.isArray(results) && results.length > 0, "should find matching memory");
		} finally {
			cleanup();
		}
	});

	it("list_memories returns slug array", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, , listRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: {
							name: "list-test",
							type: "lesson",
							scope: "global",
							body: "body",
						},
					},
				},
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: { name: "list_memories", arguments: {} },
				},
			]);
			assert.ok(listRes?.result, "expected result from list_memories");
			const r = listRes?.result as { content?: { type: string; text: string }[] };
			const text = r.content?.[0]?.text ?? "";
			const slugs = JSON.parse(text) as string[];
			assert.ok(Array.isArray(slugs));
			assert.ok(slugs.length > 0, "should return at least one slug");
		} finally {
			cleanup();
		}
	});

	it("write_memory with malformed payload returns an error response", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, writeRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: {
							// Missing required fields: name, type, scope, body
							tags: "some-tag",
						},
					},
				},
			]);
			// Should return an error, not crash the server
			assert.ok(
				writeRes?.error ?? (writeRes?.result as Record<string, unknown>)?.isError,
				"should return an error for malformed payload",
			);
		} finally {
			cleanup();
		}
	});

	it("read_memory filters by type", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, , , readRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: { name: "a-lesson", type: "lesson", scope: "global", body: "body a" },
					},
				},
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: { name: "a-decision", type: "decision", scope: "global", body: "body b" },
					},
				},
				{
					jsonrpc: "2.0",
					id: 4,
					method: "tools/call",
					params: { name: "read_memory", arguments: { type: "lesson" } },
				},
			]);
			assert.ok(readRes?.result, "expected result");
			const r = readRes?.result as { content?: { type: string; text: string }[] };
			const memories = JSON.parse(r.content?.[0]?.text ?? "[]") as { type: string }[];
			assert.ok(
				memories.every((m) => m.type === "lesson"),
				"should only return lesson type memories",
			);
		} finally {
			cleanup();
		}
	});

	it("search_memory returns empty array when no memories match", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, , searchRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: {
							name: "unrelated",
							type: "lesson",
							scope: "global",
							body: "nothing special",
						},
					},
				},
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: {
						name: "search_memory",
						arguments: { query: "xyzzy-will-never-match-12345" },
					},
				},
			]);
			assert.ok(searchRes?.result, "expected result");
			const r = searchRes?.result as { content?: { type: string; text: string }[] };
			const results = JSON.parse(r.content?.[0]?.text ?? "null") as unknown[];
			assert.ok(Array.isArray(results), "should return array");
			assert.strictEqual(results.length, 0, "should return empty array on no match");
		} finally {
			cleanup();
		}
	});

	it("write_memory with empty name returns an error", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, writeRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: { name: "", type: "lesson", scope: "global", body: "body" },
					},
				},
			]);
			assert.ok(
				writeRes?.error ?? (writeRes?.result as Record<string, unknown>)?.isError,
				"should return error for empty name",
			);
		} finally {
			cleanup();
		}
	});

	it("write_memory without tags field defaults to empty tags", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, , readRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: { name: "no-tags-mcp", type: "reference", scope: "global", body: "body" },
					},
				},
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: { name: "read_memory", arguments: { scope: "global" } },
				},
			]);
			assert.ok(readRes?.result);
			const r = readRes?.result as { content?: { type: string; text: string }[] };
			const memories = JSON.parse(r.content?.[0]?.text ?? "[]") as {
				name: string;
				tags: string[];
			}[];
			const mem = memories.find((m) => m.name === "no-tags-mcp");
			assert.ok(mem, "should find the written memory");
			assert.deepEqual(mem.tags, [], "tags should default to empty array");
		} finally {
			cleanup();
		}
	});

	it("write_memory with failure-pattern type succeeds", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, writeRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: {
							name: "fp-mcp",
							type: "failure-pattern",
							scope: "global",
							body: "avoid this",
						},
					},
				},
			]);
			assert.ok(writeRes?.result);
			const r = writeRes?.result as { content?: { type: string; text: string }[] };
			const parsed = JSON.parse(r.content?.[0]?.text ?? "{}") as { ok: boolean };
			assert.strictEqual(parsed.ok, true);
		} finally {
			cleanup();
		}
	});

	it("write_memory with track scope succeeds", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, writeRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: {
							name: "track-mcp",
							type: "lesson",
							scope: "track:payments",
							body: "scoped",
						},
					},
				},
			]);
			assert.ok(writeRes?.result);
			const r = writeRes?.result as { content?: { type: string; text: string }[] };
			const parsed = JSON.parse(r.content?.[0]?.text ?? "{}") as { ok: boolean };
			assert.strictEqual(parsed.ok, true);
		} finally {
			cleanup();
		}
	});

	it("read_memory with scope+type combined returns only matching memories", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, , , , readRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: { name: "g-lesson", type: "lesson", scope: "global", body: "x" },
					},
				},
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: { name: "g-decision", type: "decision", scope: "global", body: "x" },
					},
				},
				{
					jsonrpc: "2.0",
					id: 4,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: { name: "t-lesson", type: "lesson", scope: "track:auth", body: "x" },
					},
				},
				{
					jsonrpc: "2.0",
					id: 5,
					method: "tools/call",
					params: { name: "read_memory", arguments: { scope: "global", type: "lesson" } },
				},
			]);
			assert.ok(readRes?.result);
			const r = readRes?.result as { content?: { type: string; text: string }[] };
			const memories = JSON.parse(r.content?.[0]?.text ?? "[]") as { name: string }[];
			assert.strictEqual(memories.length, 1);
			assert.strictEqual(memories[0]?.name, "g-lesson");
		} finally {
			cleanup();
		}
	});

	it("search_memory with scope filter returns only scoped matches", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, , , searchRes] = await rpc(dir, [
				...INIT_REQUESTS,
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: {
							name: "global-kw",
							type: "lesson",
							scope: "global",
							body: "keyword match",
						},
					},
				},
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: {
						name: "write_memory",
						arguments: {
							name: "track-kw",
							type: "lesson",
							scope: "track:auth",
							body: "keyword match",
						},
					},
				},
				{
					jsonrpc: "2.0",
					id: 4,
					method: "tools/call",
					params: {
						name: "search_memory",
						arguments: { query: "keyword", scope: "global" },
					},
				},
			]);
			assert.ok(searchRes?.result);
			const r = searchRes?.result as { content?: { type: string; text: string }[] };
			const results = JSON.parse(r.content?.[0]?.text ?? "[]") as { name: string }[];
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0]?.name, "global-kw");
		} finally {
			cleanup();
		}
	});
});
