import { runTrack } from "../orchestrator.js";
import { readBody, verifyHmac } from "../webhook-auth.js";
import { c, parseFlags, positionalArgs } from "./helpers.js";

export async function cmdWebhook(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const sub = positionalArgs(args)[0];

	if (sub !== "start") {
		console.error("Usage: conductor webhook start [--port=9000]");
		return 1;
	}

	const { createServer } = await import("node:http");
	const { loadConfig } = await import("../config.js");
	const cwd = process.cwd();
	const port = flags.port ? Number(flags.port) : 9000;

	// Warn at startup if no HMAC secret is configured
	const startupConfig = loadConfig(cwd);
	if (!startupConfig?.webhook?.secret) {
		console.error(
			"WARNING: webhook running without HMAC — set `webhook.secret` in config.json to secure this endpoint",
		);
	}

	const server = createServer((req, res) => {
		res.setHeader("Content-Type", "application/json");

		const url = req.url?.split("?")[0] ?? "/";

		if (req.method === "GET" && url === "/webhook/health") {
			res.writeHead(200);
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		const match = url.match(/^\/webhook\/([^/]+)$/);
		if (req.method === "POST" && match?.[1]) {
			const trackId = decodeURIComponent(match[1]);

			// Read body first so we can verify HMAC before dispatching
			readBody(req)
				.then((body) => {
					const config = loadConfig(cwd);
					const secret = config?.webhook?.secret;

					if (secret) {
						const sig = req.headers["x-hub-signature-256"] as string | undefined;
						if (!verifyHmac(body, sig, secret)) {
							res.writeHead(401);
							res.end(JSON.stringify({ error: "Invalid webhook signature" }));
							return;
						}
					}

					const track = config?.tracks.find((t) => t.id === trackId);
					if (!track) {
						res.writeHead(404);
						res.end(JSON.stringify({ error: "track not found", trackId }));
						return;
					}

					res.writeHead(202);
					res.end(JSON.stringify({ queued: true, trackId }));

					// Fire and forget — runs async after response is sent
					runTrack(trackId, { cwd }).catch((err: unknown) => {
						console.error(
							`[webhook] Error running "${trackId}": ${err instanceof Error ? err.message : String(err)}`,
						);
					});
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
		server.listen(port, () => resolve());
	});

	console.log(`conductor webhook server at ${c.cyan}http://localhost:${port}${c.reset}`);
	console.log(`  POST /webhook/<trackId>  — trigger a track run`);
	console.log(`  GET  /webhook/health     — health check`);
	console.log(`${c.gray}Press Ctrl+C to stop${c.reset}`);

	return new Promise<number>((resolve) => {
		const cleanup = () => {
			server.close();
			resolve(0);
		};
		process.once("SIGINT", cleanup);
		process.once("SIGTERM", cleanup);
	});
}
