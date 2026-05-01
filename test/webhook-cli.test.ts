/**
 * Tests for the `conductor webhook start` standalone HTTP server.
 *
 * Because `cmdWebhook` blocks until SIGINT/SIGTERM, we cannot call it directly
 * in tests. Instead we construct an equivalent in-process HTTP server using the
 * same shared primitives (`readBody`, `verifyHmac`, `loadConfig`) that
 * `src/cli/webhook.ts` uses, then run the exact same request-handler logic.
 * This is the appropriate pattern when the CLI function owns the event-loop and
 * no `startServer`-style factory is exported.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadConfig, saveConfig } from "../src/config.js";
import { readBody, verifyHmac } from "../src/webhook-auth.js";

// ---------------------------------------------------------------------------
// Helper — make an HTTP POST and return status + body
// ---------------------------------------------------------------------------

interface HttpResult {
	status: number;
	body: string;
}

async function httpPost(
	port: number,
	path: string,
	body: string,
	headers: Record<string, string> = {},
): Promise<HttpResult> {
	const { request } = await import("node:http");
	return new Promise((resolve, reject) => {
		const req = request(
			{
				hostname: "127.0.0.1",
				port,
				path,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
					...headers,
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () =>
					resolve({
						status: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

// ---------------------------------------------------------------------------
// In-process server factory
//
// Mirrors the createServer() call in src/cli/webhook.ts exactly so that tests
// exercise the same branching logic (HMAC check → track lookup → 202/401/404).
// We accept `cwd` as a parameter so each test suite can point at its own
// temp conductor project.
// ---------------------------------------------------------------------------

interface WebhookTestServer {
	port: number;
	stop: () => void;
}

async function startWebhookServer(cwd: string): Promise<WebhookTestServer> {
	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		res.setHeader("Content-Type", "application/json");

		const url = req.url?.split("?")[0] ?? "/";

		// Health endpoint (mirrors webhook.ts)
		if (req.method === "GET" && url === "/webhook/health") {
			res.writeHead(200);
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		const match = url.match(/^\/webhook\/([^/]+)$/);
		if (req.method === "POST" && match?.[1]) {
			const trackId = decodeURIComponent(match[1]);

			readBody(req)
				.then((body) => {
					const config = loadConfig(cwd);
					const secret = config?.webhook?.secret;

					// HMAC check — only enforced when a secret is configured
					if (secret) {
						const sig = req.headers["x-hub-signature-256"] as string | undefined;
						if (!verifyHmac(body, sig, secret)) {
							res.writeHead(401);
							res.end(JSON.stringify({ error: "Invalid webhook signature" }));
							return;
						}
					}

					// Track existence check
					const track = config?.tracks.find((t) => t.id === trackId);
					if (!track) {
						res.writeHead(404);
						res.end(JSON.stringify({ error: "track not found", trackId }));
						return;
					}

					// Accept — deliberately NOT calling runTrack in tests
					res.writeHead(202);
					res.end(JSON.stringify({ queued: true, trackId }));
				})
				.catch((err: unknown) => {
					if (!res.headersSent) res.writeHead(500);
					res.end(JSON.stringify({ error: String(err) }));
				});
			return;
		}

		res.writeHead(404);
		res.end(JSON.stringify({ error: "not found" }));
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		// port 0 — OS picks a free port
		server.listen(0, "127.0.0.1", () => resolve());
	});

	const addr = server.address();
	if (!addr || typeof addr === "string") {
		throw new Error("unexpected server address type");
	}

	return {
		port: addr.port,
		stop: () => server.close(),
	};
}

// ---------------------------------------------------------------------------
// Helpers for building a minimal conductor project in a temp directory.
// We don't need git init because we are not invoking runTrack.
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
	defaults: { concurrency: 3, agentCmd: "claude" },
} as const;

function makeTrackEntry(id: string) {
	return {
		id,
		name: id,
		description: "test track",
		files: [] as string[],
	};
}

// ---------------------------------------------------------------------------
// Suite 1 — HMAC-secured server (webhook.secret configured)
// ---------------------------------------------------------------------------

describe("webhook CLI server — with HMAC secret", () => {
	let cwd: string;
	let srv: WebhookTestServer;
	const SECRET = "super-secret-key";
	const TRACK_ID = "auth";

	before(async () => {
		cwd = mkdtempSync(join(tmpdir(), "conductor-wh-secret-"));

		// Write a config that includes both a known track and a webhook secret
		saveConfig(
			{
				...DEFAULT_CONFIG,
				tracks: [makeTrackEntry(TRACK_ID)],
				webhook: { secret: SECRET },
			},
			cwd,
		);

		srv = await startWebhookServer(cwd);
	});

	after(() => {
		srv.stop();
		rmSync(cwd, { recursive: true, force: true });
	});

	it("should return 202 when HMAC signature is valid and track exists", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });
		const sig = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

		const result = await httpPost(srv.port, `/webhook/${TRACK_ID}`, body, {
			"x-hub-signature-256": sig,
		});

		assert.strictEqual(result.status, 202);
		const parsed = JSON.parse(result.body) as { queued: boolean; trackId: string };
		assert.strictEqual(parsed.queued, true);
		assert.strictEqual(parsed.trackId, TRACK_ID);
	});

	it("should return 401 when HMAC signature is incorrect", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });

		const result = await httpPost(srv.port, `/webhook/${TRACK_ID}`, body, {
			// Correct length (sha256= + 64 hex chars) but wrong value
			"x-hub-signature-256": `sha256=${"0".repeat(64)}`,
		});

		assert.strictEqual(result.status, 401);
		const parsed = JSON.parse(result.body) as { error: string };
		assert.ok(
			parsed.error.toLowerCase().includes("signature"),
			`Expected error to mention "signature", got: ${parsed.error}`,
		);
	});

	it("should return 401 when X-Hub-Signature-256 header is missing", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });

		// No signature header at all
		const result = await httpPost(srv.port, `/webhook/${TRACK_ID}`, body);

		assert.strictEqual(result.status, 401);
		const parsed = JSON.parse(result.body) as { error: string };
		assert.ok(parsed.error.toLowerCase().includes("signature"));
	});

	it("should return 401 when signature header value is an empty string", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });

		const result = await httpPost(srv.port, `/webhook/${TRACK_ID}`, body, {
			"x-hub-signature-256": "",
		});

		assert.strictEqual(result.status, 401);
	});

	it("should return 404 when HMAC is valid but track does not exist", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });
		const sig = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

		const result = await httpPost(srv.port, "/webhook/nonexistent-track", body, {
			"x-hub-signature-256": sig,
		});

		assert.strictEqual(result.status, 404);
		const parsed = JSON.parse(result.body) as { error: string; trackId: string };
		assert.ok(parsed.error.includes("not found"));
		assert.strictEqual(parsed.trackId, "nonexistent-track");
	});
});

// ---------------------------------------------------------------------------
// Suite 2 — No secret configured (open webhook)
// ---------------------------------------------------------------------------

describe("webhook CLI server — no HMAC secret", () => {
	let cwd: string;
	let srv: WebhookTestServer;
	const TRACK_ID = "api";

	before(async () => {
		cwd = mkdtempSync(join(tmpdir(), "conductor-wh-open-"));

		// Config with a track but no webhook secret
		saveConfig(
			{
				...DEFAULT_CONFIG,
				tracks: [makeTrackEntry(TRACK_ID)],
				// No webhook key at all → secret is undefined
			},
			cwd,
		);

		srv = await startWebhookServer(cwd);
	});

	after(() => {
		srv.stop();
		rmSync(cwd, { recursive: true, force: true });
	});

	it("should return 202 when no secret is configured and track exists (no signature required)", async () => {
		const body = JSON.stringify({ event: "push" });

		// No signature header — should NOT return 401
		const result = await httpPost(srv.port, `/webhook/${TRACK_ID}`, body);

		assert.strictEqual(result.status, 202);
		const parsed = JSON.parse(result.body) as { queued: boolean; trackId: string };
		assert.strictEqual(parsed.queued, true);
	});

	it("should return 202 even if a signature header is sent when no secret is configured", async () => {
		const body = JSON.stringify({ event: "push" });

		// Caller sends a signature, but server ignores it (no secret to validate against)
		const result = await httpPost(srv.port, `/webhook/${TRACK_ID}`, body, {
			"x-hub-signature-256": "sha256=irrelevant",
		});

		// Must NOT return 401 — the secret guard is simply skipped
		assert.strictEqual(result.status, 202);
	});

	it("should return 404 for unknown track even when no secret is configured", async () => {
		const body = JSON.stringify({ event: "push" });

		const result = await httpPost(srv.port, "/webhook/does-not-exist", body);

		// No HMAC guard means we get all the way to the track lookup → 404
		assert.strictEqual(result.status, 404);
		const parsed = JSON.parse(result.body) as { error: string };
		assert.ok(parsed.error.includes("not found"));
	});
});

// ---------------------------------------------------------------------------
// Suite 3 — Unknown track with secret configured (HMAC passes, track missing)
// ---------------------------------------------------------------------------

describe("webhook CLI server — unknown track with HMAC enabled", () => {
	let cwd: string;
	let srv: WebhookTestServer;
	const SECRET = "hmac-test-key";

	before(async () => {
		cwd = mkdtempSync(join(tmpdir(), "conductor-wh-notrack-"));

		// Config with secret but NO tracks
		saveConfig(
			{
				...DEFAULT_CONFIG,
				tracks: [],
				webhook: { secret: SECRET },
			},
			cwd,
		);

		srv = await startWebhookServer(cwd);
	});

	after(() => {
		srv.stop();
		rmSync(cwd, { recursive: true, force: true });
	});

	it("should return 404 when HMAC is valid but no tracks are registered", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });
		const sig = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

		const result = await httpPost(srv.port, "/webhook/ghost-track", body, {
			"x-hub-signature-256": sig,
		});

		// HMAC passes → proceeds to track lookup → 404
		assert.strictEqual(result.status, 404);
	});

	it("should return 401 before reaching the track lookup when HMAC is wrong", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });

		const result = await httpPost(srv.port, "/webhook/ghost-track", body, {
			"x-hub-signature-256": "sha256=badsig",
		});

		// Auth check happens before track existence check
		assert.strictEqual(result.status, 401);
	});
});

// ---------------------------------------------------------------------------
// Suite 4 — Health endpoint sanity check
// ---------------------------------------------------------------------------

describe("webhook CLI server — health endpoint", () => {
	let cwd: string;
	let srv: WebhookTestServer;

	before(async () => {
		cwd = mkdtempSync(join(tmpdir(), "conductor-wh-health-"));
		saveConfig({ ...DEFAULT_CONFIG, tracks: [] }, cwd);
		srv = await startWebhookServer(cwd);
	});

	after(() => {
		srv.stop();
		rmSync(cwd, { recursive: true, force: true });
	});

	it("should return 200 for GET /webhook/health", async () => {
		const { request } = await import("node:http");
		const result = await new Promise<HttpResult>((resolve, reject) => {
			const req = request(
				{
					hostname: "127.0.0.1",
					port: srv.port,
					path: "/webhook/health",
					method: "GET",
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (chunk: Buffer) => chunks.push(chunk));
					res.on("end", () =>
						resolve({
							status: res.statusCode ?? 0,
							body: Buffer.concat(chunks).toString("utf8"),
						}),
					);
				},
			);
			req.on("error", reject);
			req.end();
		});

		assert.strictEqual(result.status, 200);
		const parsed = JSON.parse(result.body) as { ok: boolean };
		assert.strictEqual(parsed.ok, true);
	});

	it("should return 404 for unknown routes", async () => {
		const result = await httpPost(srv.port, "/webhook", "{}");
		assert.strictEqual(result.status, 404);
	});
});
