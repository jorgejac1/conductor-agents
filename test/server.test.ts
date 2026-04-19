import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { trackTodoPath } from "../src/config.js";
import { runTrack } from "../src/orchestrator.js";
import { type ServerHandle, startServer } from "../src/server.js";
import { createTrack, initConductor } from "../src/track.js";

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

	it("GET /api/tracks returns empty array for fresh init", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks`);
			assert.strictEqual(res.status, 200);
			const data = await res.json();
			assert.deepEqual(data, []);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tracks returns created tracks", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("My Feature", "Does stuff", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks`);
			const data = (await res.json()) as { track: { id: string } }[];
			assert.strictEqual(data.length, 1);
			assert.strictEqual(data[0].track.id, "my-feature");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tracks/:id/state returns null for unrun track", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Alpha", "Test", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/alpha/state`);
			assert.strictEqual(res.status, 200);
			const data = await res.json();
			assert.strictEqual(data, null);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tracks/:id/logs/:workerId returns 404 when no swarm state", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Beta", "Test", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/beta/logs/abc123`);
			assert.strictEqual(res.status, 404);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tracks/:id/logs/:workerId returns log content after a run", async () => {
		const dir = tmpDir(true);
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Gamma", "Test", [], dir);
			writeFileSync(
				trackTodoPath("gamma", dir),
				["- [ ] Log test task", "  - eval: `true`"].join("\n"),
			);
			await runTrack("gamma", { agentCmd: "echo", concurrency: 1, cwd: dir });

			handle = await startServer({ port: 0, cwd: dir });

			// Get state to find worker id
			const stateRes = await fetch(`http://localhost:${handle.port}/api/tracks/gamma/state`);
			const state = (await stateRes.json()) as { workers: { id: string }[] };
			assert.ok(state.workers.length > 0);

			const workerId = state.workers[0].id;
			const logsRes = await fetch(
				`http://localhost:${handle.port}/api/tracks/gamma/logs/${workerId}`,
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

	it("GET /api/events streams initial tracks SSE event", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Delta", "Test", [], dir);
			handle = await startServer({ port: 0, cwd: dir });

			const res = await fetch(`http://localhost:${handle.port}/api/events`);
			assert.ok(res.headers.get("content-type")?.startsWith("text/event-stream"));

			// Read until we get the tracks event
			const reader = res.body?.getReader();
			assert.ok(reader, "Response body must be readable");

			const decoder = new TextDecoder();
			let sseData = "";
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				sseData += decoder.decode(value);
				if (sseData.includes('"type":"tracks"')) break;
			}
			reader.cancel();

			assert.ok(sseData.includes('"type":"tracks"'));
			assert.ok(sseData.includes('"delta"'));
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tracks/:id/cost returns budget summary JSON", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Auth", "Auth layer", [], dir);
			const { reportTokenUsage } = await import("evalgate");
			const todoPath = trackTodoPath("auth", dir);
			reportTokenUsage(todoPath, "add-jwt", 5000, undefined, {
				inputTokens: 3000,
				outputTokens: 2000,
			});
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/auth/cost`);
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as unknown[];
			// getBudgetSummary returns an array; with no contracts parsed, it returns []
			// (no todo.md contracts defined), but the endpoint itself must not error
			assert.ok(Array.isArray(data));
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

	it("GET /api/config returns conductor config", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Config Track", "config test track", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/config`);
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { tracks?: { id: string }[] };
			assert.ok(Array.isArray(data.tracks), "config.tracks should be an array");
			assert.strictEqual(data.tracks[0].id, "config-track");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/version returns conductor and evalgate versions", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/version`);
			assert.strictEqual(res.status, 200);
			const data = (await res.json()) as { conductor?: string; evalgate?: string };
			assert.ok(
				typeof data.conductor === "string" && data.conductor.length > 0,
				"conductor version must be a non-empty string",
			);
			assert.ok(
				typeof data.evalgate === "string" && data.evalgate.length > 0,
				"evalgate version must be a non-empty string",
			);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tracks/:id/history returns run history array", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("History Track", "history test", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/history-track/history`);
			assert.strictEqual(res.status, 200);
			const data = await res.json();
			assert.ok(Array.isArray(data), "history endpoint must return an array");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("POST /api/tracks/:id/budget returns 400 when contractId is missing", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Budget Test", "budget test track", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/budget-test/budget`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tokens: 1000 }),
			});
			assert.strictEqual(res.status, 400);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("POST /api/tracks/:id/budget returns 400 when tokens is missing", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Budget Test", "budget test track", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/budget-test/budget`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ contractId: "contract-a" }),
			});
			assert.strictEqual(res.status, 400);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("POST /api/tracks/:id/budget records token usage and returns record", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Budget Test", "budget test track", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/budget-test/budget`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ contractId: "my-contract", tokens: 5000 }),
			});
			assert.strictEqual(res.status, 200);
			const record = await res.json();
			assert.ok(
				record !== null && typeof record === "object",
				"response should be a record object",
			);

			// Verify the usage was persisted by checking track list cost summary
			const tracksRes = await fetch(`http://localhost:${handle.port}/api/tracks`);
			assert.strictEqual(tracksRes.status, 200);
			const tracks = (await tracksRes.json()) as {
				track: { id: string };
				cost?: { totalTokens: number };
			}[];
			const budgetTrack = tracks.find((t) => t.track.id === "budget-test");
			assert.ok(budgetTrack?.cost, "cost should be present after reporting token usage");
			assert.ok((budgetTrack.cost?.totalTokens ?? 0) > 0, "total tokens should be greater than 0");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("POST /api/tracks/:id/budget accepts optional workerId", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Budget Test", "budget test track", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/budget-test/budget`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ contractId: "my-contract", tokens: 2000, workerId: "worker-abc" }),
			});
			assert.strictEqual(res.status, 200);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
