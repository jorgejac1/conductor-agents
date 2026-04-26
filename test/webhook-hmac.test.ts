import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { saveConfig } from "../src/config.js";
import { startServer } from "../src/server.js";

async function httpPost(
	port: number,
	path: string,
	body: string,
	headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
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
				res.on("data", (c: Buffer) => chunks.push(c));
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

describe("webhook HMAC validation", () => {
	let cwd: string;
	let serverNoSecret: Awaited<ReturnType<typeof startServer>>;
	let serverWithSecret: Awaited<ReturnType<typeof startServer>>;

	before(async () => {
		cwd = mkdtempSync(join(tmpdir(), "conductor-webhook-"));

		// Server without webhook secret (no conductor config)
		serverNoSecret = await startServer({ port: 0, cwd });

		// Server with webhook secret configured
		const cwdSecret = mkdtempSync(join(tmpdir(), "conductor-webhook-secret-"));
		saveConfig(
			{
				tracks: [],
				defaults: { concurrency: 3, agentCmd: "claude" },
				webhook: { secret: "test-secret-key" },
			},
			cwdSecret,
		);
		serverWithSecret = await startServer({ port: 0, cwd: cwdSecret });
	});

	after(() => {
		serverNoSecret.stop();
		serverWithSecret.stop();
		rmSync(cwd, { recursive: true, force: true });
	});

	it("POST to /api/webhook without secret configured passes through and returns 200", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });
		const result = await httpPost(serverNoSecret.port, "/api/webhook", body);
		assert.strictEqual(result.status, 200);
		const parsed = JSON.parse(result.body) as { triggered: string[] };
		assert.ok(Array.isArray(parsed.triggered));
	});

	it("POST with secret but missing X-Hub-Signature-256 header returns 401", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });
		const result = await httpPost(serverWithSecret.port, "/api/webhook", body);
		assert.strictEqual(result.status, 401);
		const parsed = JSON.parse(result.body) as { error: string };
		assert.ok(parsed.error.includes("signature"), `Expected signature error, got: ${parsed.error}`);
	});

	it("POST with wrong HMAC signature returns 401", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });
		const result = await httpPost(serverWithSecret.port, "/api/webhook", body, {
			"x-hub-signature-256": "sha256=wrongsignature",
		});
		assert.strictEqual(result.status, 401);
	});

	it("POST with correct HMAC signature passes through and returns 200", async () => {
		const body = JSON.stringify({ ref: "refs/heads/main" });
		const sig = `sha256=${createHmac("sha256", "test-secret-key").update(body).digest("hex")}`;
		const result = await httpPost(serverWithSecret.port, "/api/webhook", body, {
			"x-hub-signature-256": sig,
		});
		assert.strictEqual(result.status, 200);
		const parsed = JSON.parse(result.body) as { triggered: string[] };
		assert.ok(Array.isArray(parsed.triggered));
	});
});

// Need join for mkdtempSync
import { join } from "node:path";
