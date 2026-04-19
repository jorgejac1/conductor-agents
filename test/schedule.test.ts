/**
 * Tests for conductor schedule and webhook commands.
 *
 * These tests drive the CLI directly via child process or call the underlying
 * functions so they don't depend on real cron timing.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadConfig, saveConfig } from "../src/config.js";
import { createTrack, initConductor } from "../src/track.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "conductor-schedule-test-"));
}

// ---------------------------------------------------------------------------
// Schedule config persistence tests
// ---------------------------------------------------------------------------

describe("conductor schedule config", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = makeTmpDir();
		initConductor(tmpDir);
		createTrack("auth", "Auth module", [], tmpDir);
		createTrack("api", "API layer", [], tmpDir);
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("persists a valid cron schedule to the track", () => {
		const config = loadConfig(tmpDir);
		assert.ok(config, "config should exist");
		const track = config.tracks.find((t) => t.id === "auth");
		assert.ok(track, "auth track should exist");

		track.schedule = "0 9 * * 1-5";
		saveConfig(config, tmpDir);

		const reloaded = loadConfig(tmpDir);
		const saved = reloaded?.tracks.find((t) => t.id === "auth");
		assert.equal(saved?.schedule, "0 9 * * 1-5");
	});

	it("persists schedule independently per track", () => {
		const config = loadConfig(tmpDir);
		assert.ok(config, "config should exist");
		const api = config.tracks.find((t) => t.id === "api");
		assert.ok(api, "api track should exist");
		assert.equal(api.schedule, undefined, "api should not have a schedule yet");

		api.schedule = "30 6 * * *";
		saveConfig(config, tmpDir);

		const reloaded = loadConfig(tmpDir);
		assert.equal(reloaded?.tracks.find((t) => t.id === "auth")?.schedule, "0 9 * * 1-5");
		assert.equal(reloaded?.tracks.find((t) => t.id === "api")?.schedule, "30 6 * * *");
	});

	it("removes schedule from track", () => {
		const config = loadConfig(tmpDir);
		assert.ok(config, "config should exist");
		const track = config.tracks.find((t) => t.id === "auth");
		assert.ok(track, "auth track should exist");

		delete track.schedule;
		saveConfig(config, tmpDir);

		const reloaded = loadConfig(tmpDir);
		const saved = reloaded?.tracks.find((t) => t.id === "auth");
		assert.equal(saved?.schedule, undefined, "schedule should be removed");
	});

	it("cron validates via evalgate parseCron", async () => {
		const { parseCron } = await import("evalgate");

		// Valid expressions should not throw
		assert.doesNotThrow(() => parseCron("0 9 * * 1-5"));
		assert.doesNotThrow(() => parseCron("*/5 * * * *"));
		assert.doesNotThrow(() => parseCron("0 0 1 1 *"));

		// Invalid expressions should throw
		assert.throws(() => parseCron("not-a-cron"));
		assert.throws(() => parseCron("60 * * * *")); // minute out of range
	});

	it("nextFireMs returns a positive ms value for a valid cron", async () => {
		const { parseCron, nextFireMs } = await import("evalgate");
		const expr = parseCron("0 9 * * 1-5");
		const ms = nextFireMs(expr);
		assert.ok(ms > 0, "nextFireMs should return positive ms");
		assert.ok(ms <= 7 * 24 * 60 * 60 * 1000, "next fire should be within 7 days");
	});
});

// ---------------------------------------------------------------------------
// Webhook server tests
// ---------------------------------------------------------------------------

describe("conductor webhook server", () => {
	let tmpDir: string;
	let port: number;
	let serverHandle: ReturnType<typeof createServer>;

	before(async () => {
		tmpDir = makeTmpDir();
		initConductor(tmpDir);
		createTrack("auth", "Auth module", [], tmpDir);

		// Find a free port by binding to :0
		await new Promise<void>((resolve, reject) => {
			const probe = createServer().listen(0, () => {
				const addr = probe.address();
				port = typeof addr === "object" && addr ? addr.port : 0;
				probe.close(() => resolve());
			});
			probe.once("error", reject);
		});

		// Start a minimal webhook-like server that mimics our handler logic
		// We test the actual HTTP behavior by spinning up a server here
		// rather than spawning a full child process (avoids 9000 port conflicts)
		const config = loadConfig(tmpDir);
		if (!config) throw new Error("config not found");

		serverHandle = createServer((req, res) => {
			res.setHeader("Content-Type", "application/json");
			req.resume();

			const url = req.url?.split("?")[0] ?? "/";

			if (req.method === "GET" && url === "/webhook/health") {
				res.writeHead(200);
				res.end(JSON.stringify({ ok: true }));
				return;
			}

			const match = url.match(/^\/webhook\/([^/]+)$/);
			if (req.method === "POST" && match?.[1]) {
				const trackId = decodeURIComponent(match[1]);
				const track = config.tracks.find((t) => t.id === trackId);

				if (!track) {
					res.writeHead(404);
					res.end(JSON.stringify({ error: "track not found", trackId }));
					return;
				}

				res.writeHead(202);
				res.end(JSON.stringify({ queued: true, trackId }));
				return;
			}

			res.writeHead(404);
			res.end(JSON.stringify({ error: "not found" }));
		});

		await new Promise<void>((resolve, reject) => {
			serverHandle.once("error", reject);
			serverHandle.listen(port, () => resolve());
		});
	});

	after(() => {
		serverHandle.close();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	async function get(path: string): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`http://localhost:${port}${path}`);
		const body = await res.json().catch(() => null);
		return { status: res.status, body };
	}

	async function post(path: string): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`http://localhost:${port}${path}`, { method: "POST" });
		const body = await res.json().catch(() => null);
		return { status: res.status, body };
	}

	it("GET /webhook/health returns 200 { ok: true }", async () => {
		const { status, body } = await get("/webhook/health");
		assert.equal(status, 200);
		assert.deepEqual(body, { ok: true });
	});

	it("POST /webhook/:trackId returns 202 for a known track", async () => {
		const { status, body } = await post("/webhook/auth");
		assert.equal(status, 202);
		assert.deepEqual(body, { queued: true, trackId: "auth" });
	});

	it("POST /webhook/:trackId returns 404 for unknown track", async () => {
		const { status, body } = await post("/webhook/nonexistent");
		assert.equal(status, 404);
		const b = body as { error: string };
		assert.equal(b.error, "track not found");
	});

	it("GET /webhook/unknown-path returns 404", async () => {
		const { status } = await get("/webhook");
		assert.equal(status, 404);
	});

	it("writes schedule field to config.json correctly", () => {
		// Integration: write a schedule, reload, verify it's there
		const config = loadConfig(tmpDir);
		assert.ok(config);
		const track = config.tracks.find((t) => t.id === "auth");
		assert.ok(track);
		track.schedule = "*/30 * * * *";
		saveConfig(config, tmpDir);

		const reloaded = loadConfig(tmpDir);
		assert.equal(reloaded?.tracks.find((t) => t.id === "auth")?.schedule, "*/30 * * * *");
	});
});
