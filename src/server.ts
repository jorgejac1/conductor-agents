/**
 * conductor web server — v0.1
 *
 * Routes:
 *   GET /                         → HTML dashboard
 *   GET /api/tentacles            → list all tentacles with status
 *   GET /api/tentacles/:id/state  → swarm state for a tentacle
 *   GET /api/events               → SSE stream (swarm state changes)
 *   POST /api/tentacles/:id/run   → trigger swarm for a tentacle
 *   POST /api/tentacles/:id/retry → retry a worker { workerId }
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { SwarmState } from "evalgate";
import { swarmEvents } from "evalgate";
import { getTentacleState, retryTentacleWorker, runTentacle } from "./orchestrator.js";
import { listTentacles } from "./tentacle.js";
import type { TentacleStatus } from "./types.js";
import { htmlDashboard } from "./ui-html.js";

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
	}

	function broadcastTentacles(tentacles: TentacleStatus[]): void {
		const data = `data: ${JSON.stringify({ type: "tentacles", tentacles })}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
	}

	swarmEvents.on("state", broadcastSwarm);

	function readBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}

	function parseLogsUrl(url: string): { tentacleId: string; workerId: string } | null {
		// /api/tentacles/:id/logs/:workerId
		const prefix = "/api/tentacles/";
		if (!url.startsWith(prefix)) return null;
		const rest = url.slice(prefix.length);
		const logsIdx = rest.indexOf("/logs/");
		if (logsIdx === -1) return null;
		const tentacleId = rest.slice(0, logsIdx);
		const workerId = rest.slice(logsIdx + "/logs/".length);
		if (!tentacleId || !workerId) return null;
		return { tentacleId, workerId };
	}

	function tentacleIdFromUrl(url: string, suffix: string): string | null {
		// /api/tentacles/<id>/state or /api/tentacles/<id>/run etc.
		const prefix = "/api/tentacles/";
		if (!url.startsWith(prefix)) return null;
		const rest = url.slice(prefix.length);
		const idx = rest.indexOf(`/${suffix}`);
		if (idx === -1) return null;
		return rest.slice(0, idx) || null;
	}

	function handleRequest(req: IncomingMessage, res: ServerResponse): void {
		const url = req.url ?? "/";
		const method = req.method ?? "GET";

		if (url === "/" || url === "/index.html") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(htmlDashboard());
			return;
		}

		if (url === "/api/tentacles" && method === "GET") {
			listTentacles(cwd)
				.then((tentacles) => {
					res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
					res.end(JSON.stringify(tentacles));
				})
				.catch((err: unknown) => {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: String(err) }));
				});
			return;
		}

		const stateId = tentacleIdFromUrl(url, "state");
		if (stateId && method === "GET") {
			getTentacleState(stateId, cwd)
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

		if (url === "/api/events" && method === "GET") {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			res.write(": connected\n\n");
			sseClients.add(res);

			// Send current tentacle list immediately
			listTentacles(cwd)
				.then((tentacles) => {
					broadcastTentacles(tentacles);
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

		const runId = tentacleIdFromUrl(url, "run");
		if (runId && method === "POST") {
			readBody(req)
				.then((body) => {
					let parsed: { concurrency?: number; agentCmd?: string; resume?: boolean } = {};
					try {
						parsed = JSON.parse(body) as typeof parsed;
					} catch {
						/* use defaults */
					}
					return runTentacle(runId, { ...parsed, cwd });
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
			const { tentacleId, workerId } = logsRoute;
			getTentacleState(tentacleId, cwd)
				.then((state) => {
					if (!state) {
						res.writeHead(404, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: `No state for tentacle "${tentacleId}"` }));
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

		const retryId = tentacleIdFromUrl(url, "retry");
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
					return retryTentacleWorker(retryId, parsed.workerId, retryOpts).then(() => {
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

		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("not found");
	}

	const server = createServer(handleRequest);
	await new Promise<void>((resolve) => server.listen(port, resolve));
	const actualPort = (server.address() as AddressInfo).port;

	return {
		port: actualPort,
		stop() {
			swarmEvents.off("state", broadcastSwarm);
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
