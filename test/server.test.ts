import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { swarmEvents } from "evalgate";
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

	it("POST /api/tracks/:id/budget stores inputTokens and outputTokens when provided", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Budget Test", "budget test track", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/budget-test/budget`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contractId: "my-contract",
					tokens: 100000,
					inputTokens: 80000,
					outputTokens: 20000,
				}),
			});
			assert.strictEqual(res.status, 200);
			const record = (await res.json()) as {
				contractId: string;
				tokens: number;
				inputTokens: number;
				outputTokens: number;
			};
			assert.strictEqual(record.inputTokens, 80000);
			assert.strictEqual(record.outputTokens, 20000);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("POST /api/tracks/:id/budget works without inputTokens/outputTokens", async () => {
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
			const record = (await res.json()) as {
				contractId: string;
				tokens: number;
				inputTokens?: number;
				outputTokens?: number;
			};
			assert.strictEqual(record.contractId, "my-contract");
			assert.strictEqual(record.tokens, 5000);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/telegram-status returns configured: false when no telegram config", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/telegram-status`);
			assert.strictEqual(res.status, 200);
			const body = (await res.json()) as { configured: boolean };
			assert.strictEqual(body.configured, false);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/telegram-status returns configured: true when token is present", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			// Manually inject telegram config
			const configFile = join(dir, ".conductor", "config.json");
			const raw = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
			raw.telegram = { token: "123:FAKE", chatId: 999 };
			writeFileSync(configFile, JSON.stringify(raw));

			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/telegram-status`);
			assert.strictEqual(res.status, 200);
			const body = (await res.json()) as { configured: boolean };
			assert.strictEqual(body.configured, true);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("POST /api/tracks/:id/run triggers a swarm run and returns workers", async () => {
		const dir = tmpDir(true);
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Run Test", "run test track", [], dir);
			const todoPath = trackTodoPath("run-test", dir);
			writeFileSync(todoPath, "- [ ] Run task\n  - eval: `true`\n");

			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/run-test/run`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ agentCmd: "echo", concurrency: 1 }),
			});
			assert.strictEqual(res.status, 202);
			const body = (await res.json()) as { accepted: boolean };
			assert.strictEqual(body.accepted, true);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// ─── v2.1: streaming log endpoint ───────────────────────────────────────────

	it("GET /api/tracks/:id/logs/:workerId/stream returns 404 when no swarm state", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Stream Test", "stream test", [], dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(
				`http://localhost:${handle.port}/api/tracks/stream-test/logs/abc123/stream`,
			);
			assert.strictEqual(res.status, 404);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /api/tracks/:id/logs/:workerId/stream returns SSE stream for terminal worker", async () => {
		const dir = tmpDir(true);
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Stream Done", "stream done test", [], dir);
			writeFileSync(trackTodoPath("stream-done", dir), "- [ ] Stream task\n  - eval: `true`\n");
			// Run to completion so worker is in terminal state
			await runTrack("stream-done", { agentCmd: "echo", concurrency: 1, cwd: dir });

			handle = await startServer({ port: 0, cwd: dir });

			// Get worker id from state
			const stateRes = await fetch(`http://localhost:${handle.port}/api/tracks/stream-done/state`);
			const state = (await stateRes.json()) as { workers: { id: string; status: string }[] };
			assert.ok(state.workers.length > 0, "should have workers");
			const workerId = state.workers[0].id;

			// Request SSE stream — terminal workers should get immediate done event
			const streamRes = await fetch(
				`http://localhost:${handle.port}/api/tracks/stream-done/logs/${workerId}/stream`,
			);
			assert.strictEqual(streamRes.status, 200);
			assert.ok(
				streamRes.headers.get("content-type")?.startsWith("text/event-stream"),
				"should return SSE content-type",
			);

			// Read until we see the done event
			const reader = streamRes.body?.getReader();
			assert.ok(reader);
			const decoder = new TextDecoder();
			let sseData = "";
			for (let i = 0; i < 20; i++) {
				const { value, done } = await reader.read();
				if (done) break;
				sseData += decoder.decode(value);
				if (sseData.includes("event: done")) break;
			}
			reader.cancel();
			assert.ok(sseData.includes("event: done"), "terminal worker should emit done event");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("runTrack worker has failureKind set when verifier fails", async () => {
		const dir = tmpDir(true);
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("FailKind Test", "failurekind test", [], dir);
			writeFileSync(
				trackTodoPath("failkind-test", dir),
				"- [ ] Failing task\n  - eval: `false`\n  - retries: 0\n",
			);
			await runTrack("failkind-test", { agentCmd: "echo", concurrency: 1, cwd: dir });

			handle = await startServer({ port: 0, cwd: dir });
			const stateRes = await fetch(
				`http://localhost:${handle.port}/api/tracks/failkind-test/state`,
			);
			const state = (await stateRes.json()) as {
				workers: Array<{ status: string; failureKind?: string }>;
			};
			const failed = state.workers.find((w) => w.status === "failed");
			assert.ok(failed, "should have a failed worker");
			assert.strictEqual(
				failed.failureKind,
				"verifier-fail",
				"failureKind should be verifier-fail",
			);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("POST /api/tracks/:id/run returns 404 for unknown track", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });
			const res = await fetch(`http://localhost:${handle.port}/api/tracks/nonexistent/run`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ agentCmd: "echo" }),
			});
			assert.strictEqual(res.status, 404);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("POST /api/tracks/:id/retry retries a failed worker", async () => {
		const dir = tmpDir(true);
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Retry Test", "retry test track", [], dir);
			const todoPath = trackTodoPath("retry-test", dir);
			// First run with false verifier to create a failed worker
			writeFileSync(todoPath, "- [ ] Retry task\n  - eval: `false`\n  - retries: 0\n");

			await runTrack("retry-test", { agentCmd: "echo", concurrency: 1, cwd: dir });

			// Now update verifier to pass so the retry succeeds
			writeFileSync(todoPath, "- [ ] Retry task\n  - eval: `true`\n");

			handle = await startServer({ port: 0, cwd: dir });

			// Get the failed worker id from state
			const stateRes = await fetch(`http://localhost:${handle.port}/api/tracks/retry-test/state`);
			const stateBody = (await stateRes.json()) as {
				workers: Array<{ id: string; status: string }>;
			};
			const failedWorker = stateBody.workers.find((w) => w.status === "failed");
			assert.ok(failedWorker, "should have a failed worker to retry");

			const retryRes = await fetch(`http://localhost:${handle.port}/api/tracks/retry-test/retry`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workerId: failedWorker.id, agentCmd: "echo" }),
			});
			assert.strictEqual(retryRes.status, 200);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// SSE /api/events — dedicated describe block
// ---------------------------------------------------------------------------

describe("SSE /api/events", () => {
	it("should return text/event-stream content-type", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });

			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), 2000);
			try {
				const res = await fetch(`http://localhost:${handle.port}/api/events`, {
					signal: ac.signal,
				});
				assert.ok(
					res.headers.get("content-type")?.startsWith("text/event-stream"),
					"content-type must be text/event-stream",
				);
				// Cancel the stream — we only needed the headers
				await res.body?.cancel();
			} finally {
				clearTimeout(timer);
			}
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should send a heartbeat or data within 2 seconds", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });

			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), 2000);
			try {
				const res = await fetch(`http://localhost:${handle.port}/api/events`, {
					signal: ac.signal,
				});
				assert.strictEqual(res.status, 200);

				const reader = res.body?.getReader();
				assert.ok(reader, "response body must be readable");

				const { value } = await reader.read();
				assert.ok(value && value.length > 0, "expected at least one byte from the SSE stream");

				const text = new TextDecoder().decode(value);
				// SSE heartbeats start with ":" and data lines start with "data:"
				assert.ok(
					text.startsWith(":") || text.includes("data:"),
					`expected SSE heartbeat or data, got: ${JSON.stringify(text)}`,
				);
				reader.cancel();
			} finally {
				clearTimeout(timer);
			}
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should send initial tracks event to a second connecting client", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("SSE Track", "sse test", [], dir);
			handle = await startServer({ port: 0, cwd: dir });

			// Helper: connect and collect SSE data until the tracks event is found
			async function collectUntilTracks(port: number): Promise<string> {
				const ac = new AbortController();
				const timer = setTimeout(() => ac.abort(), 3000);
				try {
					const res = await fetch(`http://localhost:${port}/api/events`, {
						signal: ac.signal,
					});
					const reader = res.body?.getReader();
					assert.ok(reader, "response body must be readable");
					const decoder = new TextDecoder();
					let sseData = "";
					for (let i = 0; i < 30; i++) {
						const { value, done } = await reader.read();
						if (done) break;
						sseData += decoder.decode(value);
						if (sseData.includes('"type":"tracks"')) break;
					}
					reader.cancel();
					return sseData;
				} finally {
					clearTimeout(timer);
				}
			}

			// Connect first client and drain the initial event
			const first = await collectUntilTracks(handle.port);
			assert.ok(first.includes('"type":"tracks"'), "first client must receive tracks event");

			// Connect a second independent client — should also receive tracks event
			const second = await collectUntilTracks(handle.port);
			assert.ok(second.includes('"type":"tracks"'), "second client must receive tracks event");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should keep the response body open (not immediately done)", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });

			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), 2000);
			try {
				const res = await fetch(`http://localhost:${handle.port}/api/events`, {
					signal: ac.signal,
				});
				assert.strictEqual(res.status, 200);
				assert.ok(res.body !== null, "response body must not be null");

				const reader = res.body.getReader();
				// Read the first chunk (heartbeat / initial event)
				const { done: firstDone } = await reader.read();
				// The stream must NOT be done after the first read — it should stay open
				assert.strictEqual(firstDone, false, "SSE stream must not close after the first chunk");
				reader.cancel();
			} finally {
				clearTimeout(timer);
			}
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// Regression test: cost SSE event must include trackId.
	// Before the fix, broadcastCost spread CostEvent as-is — CostEvent has no trackId,
	// so the client always received trackId: undefined and fell back to "unknown",
	// rendering the Activity bar chart label as "unkn".
	it("cost SSE event includes trackId derived from the prior swarm state event", async () => {
		const dir = tmpDir(true);
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Cost Track", "cost regression", [], dir);
			const todoPath = trackTodoPath("cost-track", dir);
			writeFileSync(todoPath, "- [ ] Cost task\n  - eval: `true`\n");

			handle = await startServer({ port: 0, cwd: dir });

			// Connect SSE client and collect events
			const collected: string[] = [];
			const ac = new AbortController();
			const sseRes = await fetch(`http://localhost:${handle.port}/api/events`, {
				signal: ac.signal,
			});
			const reader = sseRes.body?.getReader();
			const decoder = new TextDecoder();

			// Read events in the background
			const readPromise = (async () => {
				try {
					while (true) {
						const { value, done } = await reader.read();
						if (done) break;
						collected.push(decoder.decode(value));
					}
				} catch {
					// aborted — expected
				}
			})();

			// Emit a swarm state event so workerTrackMap gets populated for "cost-track"
			swarmEvents.emit("state", {
				id: "test-swarm",
				ts: new Date().toISOString(),
				todoPath,
				workers: [
					{
						id: "worker-abc",
						contractId: "c1",
						contractTitle: "Cost task",
						worktreePath: "/tmp/wt",
						branch: "evalgate/branch",
						status: "done",
						logPath: "/tmp/log",
					},
				],
			});

			// Emit a cost event for the same workerId
			swarmEvents.emit("cost", {
				type: "cost",
				workerId: "worker-abc",
				contractId: "c1",
				tokens: { input: 100, output: 50 },
				estimatedUsd: 0.001,
			});

			// Give the server a tick to broadcast both events
			await new Promise((r) => setTimeout(r, 100));
			ac.abort();
			await readPromise;

			const allText = collected.join("");
			const costLine = allText
				.split("\n")
				.find((l) => l.startsWith("data:") && l.includes('"type":"cost"'));

			assert.ok(costLine, "should have received a cost SSE event");

			const payload = JSON.parse(costLine.slice("data:".length)) as Record<string, unknown>;
			assert.strictEqual(
				payload.trackId,
				"cost-track",
				"cost SSE event must carry the correct trackId — regression for the 'unkn' bar chart label bug",
			);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
