/**
 * conductor MCP server tests — spawn the server as a child process and drive
 * it via stdio JSON-RPC, exactly as Claude Desktop / Cursor would.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { initConductor } from "../src/track.js";

interface RpcResult {
	result?: unknown;
	error?: { code: number; message: string };
}

function rpc(cwd: string, requests: object[]): Promise<RpcResult[]> {
	const expectedCount = requests.filter((r) => (r as Record<string, unknown>).id != null).length;

	return new Promise((resolve, reject) => {
		// Pass cwd as a positional arg so tsx is resolved from the package root
		// (not from the tmpdir, which has no node_modules).
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
	const dir = mkdtempSync(join(tmpdir(), `conductor-mcp-test-${Date.now()}-`));
	initConductor(dir);
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("conductor MCP server", () => {
	it("initialize handshake returns conductor server info", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [res] = await rpc(dir, [
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
			]);
			assert.ok(res.result, "expected result");
			const r = res.result as { serverInfo?: { name?: string } };
			assert.strictEqual(r.serverInfo?.name, "conductor");
		} finally {
			cleanup();
		}
	});

	it("tools/list returns 6 tools", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [initRes, listRes] = await rpc(dir, [
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
				{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
			]);
			// initRes = id:1, listRes = id:2 (notification has no id, no response)
			assert.ok(initRes.result, "expected init result");
			assert.ok(listRes.result, "expected list result");
			const r = listRes.result as { tools?: unknown[] };
			assert.strictEqual(r.tools?.length, 12); // 8 original + get_logs + cancel_run + list_history + get_plan_diff
		} finally {
			cleanup();
		}
	});

	it("list_tracks on empty project returns empty array", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, res] = await rpc(dir, [
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
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "list_tracks", arguments: {} },
				},
			]);
			assert.ok(res.result, "expected result");
			const r = res.result as { content?: { text?: string }[] };
			const data = JSON.parse(r.content?.[0]?.text ?? "null");
			assert.ok(Array.isArray(data));
			assert.strictEqual(data.length, 0);
		} finally {
			cleanup();
		}
	});

	it("add_track creates a track", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			const [, res] = await rpc(dir, [
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
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: {
						name: "add_track",
						arguments: { name: "Auth Module", description: "Auth layer" },
					},
				},
			]);
			assert.ok(res.result, "expected result");
			const r = res.result as { content?: { text?: string }[] };
			const data = JSON.parse(r.content?.[0]?.text ?? "null") as { id?: string };
			assert.strictEqual(data.id, "auth-module");
		} finally {
			cleanup();
		}
	});

	it("track_status returns null for unrun track", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			// First add a track
			await rpc(dir, [
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
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "add_track", arguments: { name: "Beta", description: "test" } },
				},
			]);
			// Then check status
			const [, res] = await rpc(dir, [
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
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "track_status", arguments: { track_id: "beta" } },
				},
			]);
			assert.ok(res.result, "expected result");
			const r = res.result as { content?: { text?: string }[] };
			const data = JSON.parse(r.content?.[0]?.text ?? '"notparsed"');
			assert.strictEqual(data, null);
		} finally {
			cleanup();
		}
	});

	it("get_cost returns array", async () => {
		const { dir, cleanup } = makeTmpProject();
		try {
			await rpc(dir, [
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
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "add_track", arguments: { name: "Cost Track", description: "test" } },
				},
			]);
			const [, res] = await rpc(dir, [
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
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "get_cost", arguments: { track_id: "cost-track" } },
				},
			]);
			assert.ok(res.result, "expected result");
			const r = res.result as { content?: { text?: string }[] };
			const data = JSON.parse(r.content?.[0]?.text ?? "null");
			assert.ok(Array.isArray(data));
		} finally {
			cleanup();
		}
	});
});
