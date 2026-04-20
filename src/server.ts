/**
 * conductor web server — v0.1
 *
 * Routes:
 *   GET /                      → HTML dashboard
 *   GET /api/tracks            → list all tracks with status
 *   GET /api/tracks/:id/state  → swarm state for a track
 *   GET /api/events            → SSE stream (swarm state changes)
 *   POST /api/tracks/:id/run   → trigger swarm for a track
 *   POST /api/tracks/:id/retry → retry a worker { workerId }
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { SwarmState } from "evalgate";
import { queryRuns, reportTokenUsage, swarmEvents } from "evalgate";
import { loadConfig, trackTodoPath } from "./config.js";
import { getTrackCost, getTrackState, retryTrackWorker, runTrack } from "./orchestrator.js";
import { listTracks } from "./track.js";
import type { TrackStatus } from "./types.js";
import { htmlDashboard } from "./ui-bundle.js";

export interface ServerOptions {
	port?: number;
	cwd?: string;
}

export interface ServerHandle {
	stop: () => void;
	port: number;
}

export async function startServer(opts: ServerOptions = {}): Promise<ServerHandle> {
	const port = opts.port ?? 8080;
	const cwd = opts.cwd ?? process.cwd();

	const sseClients = new Set<ServerResponse>();

	function broadcastSwarm(state: SwarmState): void {
		const data = `data: ${JSON.stringify({ type: "swarm", state })}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
		// Refresh sidebar counts (todoDone/todoTotal) after each worker transition.
		// Debounced so rapid state changes don't flood clients.
		scheduleBroadcastTracks();
	}

	function broadcastTracks(tracks: TrackStatus[]): void {
		const data = `data: ${JSON.stringify({ type: "tracks", tracks })}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
	}

	let _tracksBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleBroadcastTracks(): void {
		if (_tracksBroadcastTimer) return;
		_tracksBroadcastTimer = setTimeout(() => {
			_tracksBroadcastTimer = null;
			listTracks(cwd)
				.then(broadcastTracks)
				.catch(() => {
					/* ignore */
				});
		}, 300);
	}

	swarmEvents.on("state", broadcastSwarm);

	// Forward structured cost events (v0.12) to SSE clients
	function broadcastCost(evt: unknown): void {
		const data = `data: ${JSON.stringify({ type: "cost", ...(evt as object) })}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
		// Re-broadcast tracks so the kanban cost footer and stat bar refresh.
		scheduleBroadcastTracks();
	}
	swarmEvents.on("cost", broadcastCost);

	// Forward eval-result events to SSE clients
	function broadcastEvalResult(evt: unknown): void {
		const data = `data: ${JSON.stringify({ type: "eval-result", ...(evt as object) })}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
	}
	swarmEvents.on("eval-result", broadcastEvalResult);

	function readBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}

	function parseLogsUrl(url: string): { trackId: string; workerId: string } | null {
		// /api/tracks/:id/logs/:workerId
		const prefix = "/api/tracks/";
		if (!url.startsWith(prefix)) return null;
		const rest = url.slice(prefix.length);
		const logsIdx = rest.indexOf("/logs/");
		if (logsIdx === -1) return null;
		const trackId = rest.slice(0, logsIdx);
		const workerId = rest.slice(logsIdx + "/logs/".length);
		if (!trackId || !workerId) return null;
		return { trackId, workerId };
	}

	function trackIdFromUrl(url: string, suffix: string): string | null {
		// /api/tracks/<id>/state or /api/tracks/<id>/run etc.
		const prefix = "/api/tracks/";
		if (!url.startsWith(prefix)) return null;
		const rest = url.slice(prefix.length);
		const idx = rest.indexOf(`/${suffix}`);
		if (idx === -1) return null;
		return rest.slice(0, idx) || null;
	}

	async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = req.url ?? "/";
		const method = req.method ?? "GET";

		if (url === "/" || url === "/index.html") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(htmlDashboard());
			return;
		}

		if (url === "/api/telegram-status" && method === "GET") {
			const config = loadConfig(cwd);
			const configured = Boolean(config?.telegram?.token);
			res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
			res.end(JSON.stringify({ configured }));
			return;
		}

		if (url === "/api/tracks" && method === "GET") {
			listTracks(cwd)
				.then((tracks) => {
					res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
					res.end(JSON.stringify(tracks));
				})
				.catch((err: unknown) => {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: String(err) }));
				});
			return;
		}

		const stateId = trackIdFromUrl(url, "state");
		if (stateId && method === "GET") {
			getTrackState(stateId, cwd)
				.then((state) => {
					res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
					res.end(JSON.stringify(state ?? null));
				})
				.catch((err: unknown) => {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: String(err) }));
				});
			return;
		}

		const costId = trackIdFromUrl(url, "cost");
		if (costId && method === "GET") {
			try {
				const summary = getTrackCost(costId, cwd);
				res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
				res.end(JSON.stringify(summary));
			} catch (err: unknown) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: String(err) }));
			}
			return;
		}

		if (url === "/api/events" && method === "GET") {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			res.write(": connected\n\n");
			sseClients.add(res);

			// Send current track list immediately
			listTracks(cwd)
				.then((tracks) => {
					broadcastTracks(tracks);
				})
				.catch(() => {
					/* ignore */
				});

			const keepalive = setInterval(() => {
				try {
					res.write(": ping\n\n");
				} catch {
					/* client gone */
				}
			}, 20_000);

			req.on("close", () => {
				clearInterval(keepalive);
				sseClients.delete(res);
			});
			return;
		}

		const runId = trackIdFromUrl(url, "run");
		if (runId && method === "POST") {
			readBody(req)
				.then((body) => {
					let parsed: { concurrency?: number; agentCmd?: string; resume?: boolean } = {};
					try {
						parsed = JSON.parse(body) as typeof parsed;
					} catch {
						/* use defaults */
					}
					return runTrack(runId, { ...parsed, cwd });
				})
				.then((result) => {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(result));
				})
				.catch((err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: message }));
				});
			return;
		}

		const logsRoute = parseLogsUrl(url);
		if (logsRoute && method === "GET") {
			const { trackId, workerId } = logsRoute;
			getTrackState(trackId, cwd)
				.then((state) => {
					if (!state) {
						res.writeHead(404, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: `No state for track "${trackId}"` }));
						return;
					}
					const worker = state.workers.find((w) => w.id.startsWith(workerId));
					if (!worker) {
						res.writeHead(404, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: `Worker "${workerId}" not found` }));
						return;
					}
					if (!existsSync(worker.logPath)) {
						res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
						res.end("(no output yet)");
						return;
					}
					const content = readFileSync(worker.logPath, "utf8");
					res.writeHead(200, {
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control": "no-store",
					});
					res.end(content);
				})
				.catch((err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: message }));
				});
			return;
		}

		const retryId = trackIdFromUrl(url, "retry");
		if (retryId && method === "POST") {
			readBody(req)
				.then((body) => {
					let parsed: { workerId?: string; agentCmd?: string } = {};
					try {
						parsed = JSON.parse(body) as typeof parsed;
					} catch {
						/* use defaults */
					}
					if (!parsed.workerId) {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "workerId is required" }));
						return Promise.resolve();
					}
					const retryOpts: { agentCmd?: string; cwd?: string } = { cwd };
					if (parsed.agentCmd !== undefined) retryOpts.agentCmd = parsed.agentCmd;
					return retryTrackWorker(retryId, parsed.workerId, retryOpts).then(() => {
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ ok: true }));
					});
				})
				.catch((err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: message }));
				});
			return;
		}

		const historyId = trackIdFromUrl(url, "history");
		if (historyId && method === "GET") {
			const todoPath = trackTodoPath(historyId, cwd);
			const runs = queryRuns(todoPath, { limit: 100 });
			res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
			res.end(JSON.stringify(runs));
			return;
		}

		const budgetId = trackIdFromUrl(url, "budget");
		if (budgetId && method === "POST") {
			const body = await readBody(req);
			let parsed: { contractId?: string; tokens?: number; workerId?: string } = {};
			try {
				parsed = JSON.parse(body);
			} catch {
				/* use defaults */
			}
			if (!parsed.contractId || typeof parsed.tokens !== "number") {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "contractId and tokens (number) are required" }));
				return;
			}
			const todoPath = trackTodoPath(budgetId, cwd);
			const budgetOpts: { workerId?: string } = {};
			if (parsed.workerId) budgetOpts.workerId = parsed.workerId;
			const record = reportTokenUsage(
				todoPath,
				parsed.contractId,
				parsed.tokens,
				undefined,
				budgetOpts,
			);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(record));
			return;
		}

		if (url === "/api/config" && method === "GET") {
			const cfg = loadConfig(cwd);
			res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
			res.end(JSON.stringify(cfg ?? {}));
			return;
		}

		if (url === "/api/version" && method === "GET") {
			const { createRequire } = await import("node:module");
			const req2 = createRequire(import.meta.url);
			const conductorVersion = (req2("../package.json") as { version: string }).version;
			let evalgateVersion = "unknown";
			try {
				evalgateVersion = (req2("evalgate/package.json") as { version: string }).version;
			} catch {
				/* evalgate package.json not accessible */
			}
			res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
			res.end(JSON.stringify({ conductor: conductorVersion, evalgate: evalgateVersion }));
			return;
		}

		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("not found");
	}

	const server = createServer((req, res) => {
		handleRequest(req, res).catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			if (!res.headersSent) {
				res.writeHead(500, { "Content-Type": "application/json" });
			}
			res.end(JSON.stringify({ error: message }));
		});
	});
	await new Promise<void>((resolve) => server.listen(port, resolve));
	const actualPort = (server.address() as AddressInfo).port;

	return {
		port: actualPort,
		stop() {
			swarmEvents.off("state", broadcastSwarm);
			swarmEvents.off("cost", broadcastCost);
			swarmEvents.off("eval-result", broadcastEvalResult);
			for (const res of sseClients) {
				try {
					res.end();
				} catch {
					/* ignore */
				}
			}
			sseClients.clear();
			server.close();
		},
	};
}
