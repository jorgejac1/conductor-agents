import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { tentacleTodoPath } from "../src/config.js";
import { runTentacle } from "../src/orchestrator.js";
import { type ServerHandle, startServer } from "../src/server.js";
import { createTentacle, initConductor } from "../src/tentacle.js";

function tmpDir(initGit = false): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-srv-"));
	if (initGit) {
		execSync("git init && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
	}
	return dir;
}

describe("server", () => {
	it("GET / returns HTML dashboard", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/`);
			assert.strictEqual(res.status, 200);
			const body = await res.text();
			assert.ok(body.startsWith("<!DOCTYPE html>"));
			assert.ok(body.includes("conductor"));
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tentacles returns empty array for fresh init", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tentacles`);
			assert.strictEqual(res.status, 200);
			const data = await res.json();
			assert.deepEqual(data, []);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tentacles returns created tentacles", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTentacle("My Feature", "Does stuff", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tentacles`);
			const data = (await res.json()) as { tentacle: { id: string } }[];
			assert.strictEqual(data.length, 1);
			assert.strictEqual(data[0].tentacle.id, "my-feature");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tentacles/:id/state returns null for unrun tentacle", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTentacle("Alpha", "Test", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tentacles/alpha/state`);
			assert.strictEqual(res.status, 200);
			const data = await res.json();
			assert.strictEqual(data, null);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tentacles/:id/logs/:workerId returns 404 when no swarm state", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTentacle("Beta", "Test", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tentacles/beta/logs/abc123`);
			assert.strictEqual(res.status, 404);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tentacles/:id/logs/:workerId returns log content after a run", async () => {
		const dir = tmpDir(true);
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTentacle("Gamma", "Test", [], dir);
			writeFileSync(
				tentacleTodoPath("gamma", dir),
				["- [ ] Log test task", "  - eval: `true`"].join("\n"),
			);
			await runTentacle("gamma", { agentCmd: "echo", concurrency: 1, cwd: dir });

			handle = await startServer({ port: 0, cwd: dir });

			// Get state to find worker id
			const stateRes = await fetch(`http://localhost:${handle.port}/api/tentacles/gamma/state`);
			const state = (await stateRes.json()) as { workers: { id: string }[] };
			assert.ok(state.workers.length > 0);

			const workerId = state.workers[0].id;
			const logsRes = await fetch(
				`http://localhost:${handle.port}/api/tentacles/gamma/logs/${workerId}`,
			);
			assert.strictEqual(logsRes.status, 200);
			// Log may be empty for echo agent but endpoint must return 200
			const logText = await logsRes.text();
			assert.ok(typeof logText === "string");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/events streams initial tentacles SSE event", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTentacle("Delta", "Test", [], dir);
			handle = await startServer({ port: 0, cwd: dir });

			const res = await fetch(`http://localhost:${handle.port}/api/events`);
			assert.ok(res.headers.get("content-type")?.startsWith("text/event-stream"));

			// Read until we get the tentacles event
			const reader = res.body?.getReader();
			assert.ok(reader, "Response body must be readable");

			const decoder = new TextDecoder();
			let sseData = "";
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				sseData += decoder.decode(value);
				if (sseData.includes('"type":"tentacles"')) break;
			}
			reader.cancel();

			assert.ok(sseData.includes('"type":"tentacles"'));
			assert.ok(sseData.includes('"delta"'));
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /nonexistent returns 404", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/nope`);
			assert.strictEqual(res.status, 404);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
