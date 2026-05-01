import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { type ServerHandle, startServer } from "../src/server.js";
import { createTrack, initConductor } from "../src/track.js";

function tmpDir(initGit = false): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-cfg-"));
	if (initGit) {
		execSync("git init && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
	}
	return dir;
}

describe("POST /api/config", () => {
	it("returns { ok: true } for valid patch and GET /api/config reflects updated concurrency", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });

			const res = await fetch(`http://localhost:${handle.port}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ defaults: { concurrency: 4, agentCmd: "node" } }),
			});
			assert.strictEqual(res.status, 200);
			const body = (await res.json()) as { ok: boolean };
			assert.strictEqual(body.ok, true);

			// GET /api/config must now reflect the new concurrency
			const getRes = await fetch(`http://localhost:${handle.port}/api/config`);
			assert.strictEqual(getRes.status, 200);
			const cfg = (await getRes.json()) as { defaults: { concurrency: number; agentCmd: string } };
			assert.strictEqual(cfg.defaults.concurrency, 4);
			assert.strictEqual(cfg.defaults.agentCmd, "node");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns HTTP 400 for invalid defaults (concurrency <= 0)", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });

			const res = await fetch(`http://localhost:${handle.port}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ defaults: { concurrency: -1, agentCmd: "node" } }),
			});
			assert.strictEqual(res.status, 400);
			const body = (await res.json()) as { error: string };
			assert.ok(typeof body.error === "string" && body.error.length > 0, "error message expected");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("updating defaults does NOT wipe existing tracks", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Auth", "auth layer", [], dir);
			createTrack("Api", "rest api", [], dir);
			handle = await startServer({ port: 0, cwd: dir });

			// Patch defaults
			const patchRes = await fetch(`http://localhost:${handle.port}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ defaults: { concurrency: 2, agentCmd: "echo" } }),
			});
			assert.strictEqual(patchRes.status, 200);

			// Tracks must still be present
			const cfgRes = await fetch(`http://localhost:${handle.port}/api/config`);
			const cfg = (await cfgRes.json()) as { tracks: { id: string }[] };
			assert.ok(Array.isArray(cfg.tracks), "tracks must still be an array");
			assert.strictEqual(cfg.tracks.length, 2, "both tracks must still be present");
			const ids = cfg.tracks.map((t) => t.id).sort();
			assert.deepEqual(ids, ["api", "auth"]);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("emits a config-changed SSE event after successful POST /api/config", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });

			// Connect SSE before the POST so we catch the event
			const ac = new AbortController();
			const sseRes = await fetch(`http://localhost:${handle.port}/api/events`, {
				signal: ac.signal,
			});
			assert.ok(sseRes.headers.get("content-type")?.startsWith("text/event-stream"));

			const reader = sseRes.body?.getReader();
			assert.ok(reader, "SSE body must be readable");
			const decoder = new TextDecoder();

			// Accumulate SSE chunks in the background
			const chunks: string[] = [];
			const readPromise = (async () => {
				try {
					while (true) {
						const { value, done } = await reader.read();
						if (done) break;
						chunks.push(decoder.decode(value));
					}
				} catch {
					// aborted — expected
				}
			})();

			// Wait for the initial tracks event to arrive so we know the connection is live
			await new Promise<void>((resolve) => {
				const poll = setInterval(() => {
					if (chunks.join("").includes('"type":"tracks"')) {
						clearInterval(poll);
						resolve();
					}
				}, 20);
				// Safety timeout — should not be needed
				setTimeout(() => {
					clearInterval(poll);
					resolve();
				}, 2000);
			});

			// Now POST the config change
			const patchRes = await fetch(`http://localhost:${handle.port}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ defaults: { concurrency: 5, agentCmd: "node" } }),
			});
			assert.strictEqual(patchRes.status, 200);

			// Wait for config-changed event (up to 2 s)
			await new Promise<void>((resolve) => {
				const poll = setInterval(() => {
					if (chunks.join("").includes('"type":"config-changed"')) {
						clearInterval(poll);
						resolve();
					}
				}, 20);
				setTimeout(() => {
					clearInterval(poll);
					resolve();
				}, 2000);
			});

			ac.abort();
			await readPromise;

			const allText = chunks.join("");
			assert.ok(
				allText.includes('"type":"config-changed"'),
				"config-changed event must be emitted",
			);

			// Confirm the event carries the updated config
			const dataLine = allText
				.split("\n")
				.find((l) => l.startsWith("data:") && l.includes('"type":"config-changed"'));
			assert.ok(dataLine, "must find the config-changed data line");
			const payload = JSON.parse(dataLine.slice("data:".length)) as {
				type: string;
				config: { defaults: { concurrency: number } };
			};
			assert.strictEqual(payload.config.defaults.concurrency, 5);
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("config-changed SSE event redacts telegram token", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);

			// Inject a telegram token into config.json before the server starts
			const configFile = join(dir, ".conductor", "config.json");
			const raw = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
			raw.telegram = { token: "123456789:ABCDEFGHIJsecret", chatId: 42 };
			writeFileSync(configFile, JSON.stringify(raw));

			handle = await startServer({ port: 0, cwd: dir });

			// Connect SSE before the POST
			const ac = new AbortController();
			const sseRes = await fetch(`http://localhost:${handle.port}/api/events`, {
				signal: ac.signal,
			});
			const reader = sseRes.body?.getReader();
			assert.ok(reader);
			const decoder = new TextDecoder();

			const chunks: string[] = [];
			const readPromise = (async () => {
				try {
					while (true) {
						const { value, done } = await reader.read();
						if (done) break;
						chunks.push(decoder.decode(value));
					}
				} catch {
					// aborted
				}
			})();

			// Wait for initial event
			await new Promise<void>((resolve) => {
				const poll = setInterval(() => {
					if (chunks.join("").includes('"type":"tracks"')) {
						clearInterval(poll);
						resolve();
					}
				}, 20);
				setTimeout(() => {
					clearInterval(poll);
					resolve();
				}, 2000);
			});

			// POST a defaults-only patch — server merges existing telegram config and broadcasts
			const patchRes = await fetch(`http://localhost:${handle.port}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ defaults: { concurrency: 2, agentCmd: "echo" } }),
			});
			assert.strictEqual(patchRes.status, 200);

			// Wait for config-changed event
			await new Promise<void>((resolve) => {
				const poll = setInterval(() => {
					if (chunks.join("").includes('"type":"config-changed"')) {
						clearInterval(poll);
						resolve();
					}
				}, 20);
				setTimeout(() => {
					clearInterval(poll);
					resolve();
				}, 2000);
			});

			ac.abort();
			await readPromise;

			const allText = chunks.join("");
			const dataLine = allText
				.split("\n")
				.find((l) => l.startsWith("data:") && l.includes('"type":"config-changed"'));
			assert.ok(dataLine, "must find the config-changed data line");

			const payload = JSON.parse(dataLine.slice("data:".length)) as {
				type: string;
				config: { telegram?: { token: string } };
			};

			// The raw token must NOT appear; the masked suffix ●●●● must be present
			assert.ok(payload.config.telegram, "telegram config must be present in the event");
			const token = payload.config.telegram.token;
			assert.ok(!token.includes("ABCDEFGHIJsecret"), "raw token must not appear in the SSE event");
			assert.ok(token.includes("••••"), "token must end with masked chars (••••)");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("setting webhook secret to empty string clears it from config", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);

			// Seed a webhook secret
			const configFile = join(dir, ".conductor", "config.json");
			const raw = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
			raw.webhook = { secret: "original-secret" };
			writeFileSync(configFile, JSON.stringify(raw));

			handle = await startServer({ port: 0, cwd: dir });

			// Clear the secret by sending empty string
			const res = await fetch(`http://localhost:${handle.port}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ webhook: { secret: "" } }),
			});
			assert.strictEqual(res.status, 200);

			// The webhook.secret must be gone from config.json
			const saved = loadConfig(dir);
			assert.ok(!saved?.webhook?.secret, "webhook.secret must be cleared after empty-string patch");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("sending webhook: null removes the webhook section entirely", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);

			const configFile = join(dir, ".conductor", "config.json");
			const raw = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
			raw.webhook = { secret: "to-be-removed" };
			writeFileSync(configFile, JSON.stringify(raw));

			handle = await startServer({ port: 0, cwd: dir });

			const res = await fetch(`http://localhost:${handle.port}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ webhook: null }),
			});
			assert.strictEqual(res.status, 200);

			const saved = loadConfig(dir);
			assert.ok(!saved?.webhook, "webhook section must be absent after null patch");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// GET /api/tracks/:id/state — 404 for unknown tracks
// ---------------------------------------------------------------------------

describe("GET /api/tracks/:id/state", () => {
	it("returns 404 for a track that does not exist in config", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			handle = await startServer({ port: 0, cwd: dir });

			const res = await fetch(`http://localhost:${handle.port}/api/tracks/nonexistent/state`);
			assert.strictEqual(res.status, 404);
			const body = (await res.json()) as { error: string; trackId: string };
			assert.ok(body.error.includes("not found"), "error must say track not found");
			assert.strictEqual(body.trackId, "nonexistent");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns 200+null for a known track that has not been run yet", async () => {
		const dir = tmpDir();
		let handle: ServerHandle | undefined;
		try {
			initConductor(dir);
			createTrack("Auth", "auth layer", [], dir);
			handle = await startServer({ port: 0, cwd: dir });

			const res = await fetch(`http://localhost:${handle.port}/api/tracks/auth/state`);
			assert.strictEqual(res.status, 200);
			const body = await res.json();
			assert.strictEqual(body, null, "state must be null before any swarm has run");
		} finally {
			handle?.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
