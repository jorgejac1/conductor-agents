/**
 * conductor web server — v3.0
 *
 * Routes:
 *   GET /                              → HTML dashboard
 *   GET /api/tracks                    → list all tracks with status
 *   GET /api/tracks/:id/state          → swarm state for a track
 *   GET /api/events                    → SSE stream (swarm state changes)
 *   POST /api/tracks/:id/run           → trigger swarm for a track
 *   POST /api/tracks/:id/retry         → retry a worker { workerId }
 *   POST /api/tracks/:id/pause         → pause a track
 *   POST /api/tracks/:id/resume        → resume a track
 *   GET /api/tracks/:id/paused         → paused status
 *   GET /api/tracks/:id/history        → run history
 *   POST /api/tracks/:id/budget        → record budget usage
 *   GET /api/tracks/:id/logs/:workerId → one-shot log fetch
 *   GET /api/tracks/:id/logs/:workerId/stream → SSE log stream
 *   POST /api/config                    → update defaults / telegram / webhook
 *   POST /api/config/tracks/:id        → patch track config
 *   GET /api/workspace                 → workspace root info
 *   GET /api/workspace/projects        → list all projects
 *   GET /api/workspace/projects/:id    → single project
 *   POST /api/workspace/projects/:id/init        → init a project
 *   POST /api/workspace/projects/:id/run/:trackId → run track in project
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { BudgetExceededEvent, SwarmState } from "evalgate";
import { queryRuns, reportTokenUsage, swarmEvents } from "evalgate";
import { loadConfig, saveConfig, trackTodoPath, validateConfig } from "./config.js";
import { loadMemory, removeMemory, searchMemory, writeMemory } from "./memory.js";
import {
	getTrackCost,
	getTrackState,
	isPaused,
	pauseTrack,
	resumeTrack,
	retryTrackWorker,
	runTrack,
} from "./orchestrator.js";
import { Router } from "./router.js";
import { listTracks } from "./track.js";
import type { TrackStatus } from "./types.js";
import { htmlDashboard } from "./ui-bundle.js";
import { readBody as readBodyUtil, verifyHmac } from "./webhook-auth.js";
import { registerWorkspaceRoutes } from "./workspace/api.js";

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

	// workerId → trackId, populated on every swarm state event so cost events can
	// be enriched with the trackId that evalgate's CostEvent omits.
	const workerTrackMap = new Map<string, string>();

	function broadcastSwarm(state: SwarmState): void {
		const trackId = state.todoPath.split("/").at(-2) ?? "";
		for (const worker of state.workers) {
			workerTrackMap.set(worker.id, trackId);
		}
		const data = `data: ${JSON.stringify({ type: "swarm", state })}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
		// Refresh sidebar counts (todoDone/todoTotal) after each worker transition.
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

	// Forward structured cost events (v0.12) to SSE clients, enriched with trackId
	// (CostEvent from evalgate only carries workerId — look up the track from our map).
	function broadcastCost(evt: unknown): void {
		const costEvt = evt as { workerId?: string };
		const trackId = (costEvt.workerId ? workerTrackMap.get(costEvt.workerId) : undefined) ?? "";
		// trackId goes AFTER the spread so it wins even if evt somehow carries its own trackId field.
		const data = `data: ${JSON.stringify({ type: "cost", ...(evt as object), trackId })}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
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

	// Forward worker-start events (v2.1)
	function broadcastWorkerStart(evt: unknown): void {
		const data = `data: ${JSON.stringify({ type: "worker-start", ...(evt as object) })}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
	}
	swarmEvents.on("worker-start", broadcastWorkerStart);

	// Forward worker-retry events (v2.1)
	function broadcastWorkerRetry(evt: unknown): void {
		const data = `data: ${JSON.stringify({ type: "worker-retry", ...(evt as object) })}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
	}
	swarmEvents.on("worker-retry", broadcastWorkerRetry);

	// Forward budget-exceeded events (v2.2/v2.3)
	function broadcastBudgetExceeded(evt: BudgetExceededEvent): void {
		const pathParts = (evt.todoPath ?? "").split(/[\\/]/);
		const tracksIdx = pathParts.lastIndexOf("tracks");
		const trackId = tracksIdx >= 0 ? (pathParts[tracksIdx + 1] ?? "") : "";
		const enriched = { ...evt, trackId };
		const data = `data: ${JSON.stringify(enriched)}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
		scheduleBroadcastTracks();
	}
	swarmEvents.on("budget-exceeded", broadcastBudgetExceeded);

	function broadcastEvent(payload: Record<string, unknown>): void {
		const data = `data: ${JSON.stringify(payload)}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
	}

	/** Type-safe param accessor — returns empty string if param is undefined (should never happen when route matched). */
	function param(params: { readonly [key: string]: string }, key: string): string {
		return params[key] ?? "";
	}

	function readBody(req: IncomingMessage): Promise<string> {
		// If body was already buffered (e.g. for HMAC check), return it directly.
		const buffered = (req as IncomingMessage & { _body?: string })._body;
		if (buffered !== undefined) return Promise.resolve(buffered);
		return readBodyUtil(req);
	}

	const router = new Router();

	// GET /
	router.get("/", (_req, res) => {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(htmlDashboard());
	});

	// GET /api/telegram-status
	router.get("/api/telegram-status", (_req, res) => {
		const config = loadConfig(cwd);
		const configured = Boolean(config?.telegram?.token);
		res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
		res.end(JSON.stringify({ configured }));
	});

	// GET /api/tracks
	router.get("/api/tracks", (_req, res) => {
		listTracks(cwd)
			.then((tracks) => {
				res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
				res.end(JSON.stringify(tracks));
			})
			.catch((err: unknown) => {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: String(err) }));
			});
	});

	// GET /api/tracks/:id/state
	router.get("/api/tracks/:id/state", (_req, res, params) => {
		const trackId = param(params, "id");
		const cfg = loadConfig(cwd);
		if (!cfg?.tracks.find((t) => t.id === trackId)) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "track not found", trackId }));
			return;
		}
		getTrackState(trackId, cwd)
			.then((state) => {
				res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
				res.end(JSON.stringify(state ?? null));
			})
			.catch((err: unknown) => {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: String(err) }));
			});
	});

	// GET /api/tracks/:id/cost
	router.get("/api/tracks/:id/cost", (_req, res, params) => {
		try {
			const summary = getTrackCost(param(params, "id"), cwd);
			res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
			res.end(JSON.stringify(summary));
		} catch (err: unknown) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		}
	});

	// GET /api/events
	router.get("/api/events", (req, res) => {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.write(": connected\n\n");
		sseClients.add(res);

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
	});

	// POST /api/tracks/:id/run
	router.post("/api/tracks/:id/run", async (req, res, params) => {
		readBody(req)
			.then((body) => {
				let parsed: { concurrency?: number; agentCmd?: string; resume?: boolean } = {};
				try {
					parsed = JSON.parse(body) as typeof parsed;
				} catch {
					/* use defaults */
				}
				const trackId = param(params, "id");
				// Validate track exists before accepting.
				const config = loadConfig(cwd);
				if (!config?.tracks.find((t) => t.id === trackId)) {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: `Track "${trackId}" not found` }));
					return;
				}
				// Fire-and-forget — swarm progress arrives via SSE.
				runTrack(trackId, { ...parsed, cwd })
					.then(() => {
						scheduleBroadcastTracks();
					})
					.catch(() => {
						scheduleBroadcastTracks();
					});
				res.writeHead(202, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ accepted: true }));
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: message }));
			});
	});

	// GET /api/tracks/:id/logs/:workerId
	router.get("/api/tracks/:id/logs/:workerId", (_req, res, params) => {
		getTrackState(param(params, "id"), cwd)
			.then((state) => {
				if (!state) {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: `No state for track "${param(params, "id")}"` }));
					return;
				}
				const worker = state.workers.find((w) => w.id.startsWith(param(params, "workerId")));
				if (!worker) {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: `Worker "${param(params, "workerId")}" not found` }));
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
	});

	// GET /api/tracks/:id/logs/:workerId/stream
	router.get("/api/tracks/:id/logs/:workerId/stream", (req, res, params) => {
		getTrackState(param(params, "id"), cwd)
			.then((state) => {
				if (!state) {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: `No state for track "${param(params, "id")}"` }));
					return;
				}
				const worker = state.workers.find((w) => w.id.startsWith(param(params, "workerId")));
				if (!worker) {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: `Worker "${param(params, "workerId")}" not found` }));
					return;
				}

				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});

				// Send existing content immediately.
				let offset = 0;
				if (existsSync(worker.logPath)) {
					const initial = readFileSync(worker.logPath, "utf8");
					if (initial) {
						res.write(`data: ${JSON.stringify(initial)}\n\n`);
						offset = Buffer.byteLength(initial, "utf8");
					}
				}

				// If worker is already in a terminal state, send done and close.
				const isTerminal = worker.status === "done" || worker.status === "failed";
				if (isTerminal) {
					res.write("event: done\ndata: {}\n\n");
					res.end();
					return;
				}

				// Poll for new log content every 500ms.
				const pollInterval = setInterval(() => {
					try {
						if (!existsSync(worker.logPath)) return;
						const full = readFileSync(worker.logPath);
						if (full.length > offset) {
							const chunk = full.subarray(offset).toString("utf8");
							offset = full.length;
							res.write(`data: ${JSON.stringify(chunk)}\n\n`);
						}
					} catch {
						/* log may not exist yet */
					}
				}, 500);

				const workerId_ = worker.id;

				function onWorkerEvent(w: { id: string; status: string }) {
					if (w.id !== workerId_) return;
					if (w.status === "done" || w.status === "failed") {
						clearInterval(pollInterval);
						swarmEvents.off("worker", onWorkerEvent);
						try {
							res.write("event: done\ndata: {}\n\n");
							res.end();
						} catch {
							/* client already gone */
						}
					}
				}
				swarmEvents.on("worker", onWorkerEvent);

				req.on("close", () => {
					clearInterval(pollInterval);
					swarmEvents.off("worker", onWorkerEvent);
				});
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: message }));
			});
	});

	// POST /api/tracks/:id/retry
	router.post("/api/tracks/:id/retry", async (req, res, params) => {
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
				return retryTrackWorker(param(params, "id"), parsed.workerId, retryOpts).then(() => {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ ok: true }));
				});
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: message }));
			});
	});

	// POST /api/tracks/:id/pause
	router.post("/api/tracks/:id/pause", (_req, res, params) => {
		const paused = pauseTrack(param(params, "id"), cwd);
		broadcastEvent({ type: "track-paused", trackId: param(params, "id") });
		scheduleBroadcastTracks();
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ paused }));
	});

	// POST /api/tracks/:id/resume
	router.post("/api/tracks/:id/resume", async (req, res, params) => {
		readBody(req)
			.then((body) => {
				let parsed: { concurrency?: number; agentCmd?: string } = {};
				try {
					parsed = JSON.parse(body) as typeof parsed;
				} catch {
					/* use defaults */
				}
				const trackId = param(params, "id");
				// Fire-and-forget — swarm progress arrives via SSE.
				resumeTrack(trackId, { ...parsed, cwd })
					.then(() => {
						scheduleBroadcastTracks();
					})
					.catch(() => {
						scheduleBroadcastTracks();
					});
				broadcastEvent({ type: "track-resumed", trackId });
				res.writeHead(202, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ accepted: true }));
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: message }));
			});
	});

	// GET /api/tracks/:id/paused
	router.get("/api/tracks/:id/paused", (_req, res, params) => {
		res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
		res.end(JSON.stringify({ paused: isPaused(param(params, "id"), cwd) }));
	});

	// GET /api/tracks/:id/history
	router.get("/api/tracks/:id/history", (req, res, params) => {
		const todoPath = trackTodoPath(param(params, "id"), cwd);
		const qs = new URL(req.url ?? "/", "http://x").searchParams;
		const limit = Number(qs.get("limit") ?? "100") || 100;
		const offset = Number(qs.get("offset") ?? "0") || 0;
		const from = qs.get("from") ?? undefined;
		const to = qs.get("to") ?? undefined;
		const resultFilter = qs.get("result");
		const queryOpts: Parameters<typeof queryRuns>[1] = { limit, offset };
		if (from !== undefined) queryOpts.from = from;
		if (to !== undefined) queryOpts.to = to;
		if (resultFilter === "pass") queryOpts.passed = true;
		if (resultFilter === "fail") queryOpts.passed = false;
		const runs = queryRuns(todoPath, queryOpts);
		res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
		res.end(JSON.stringify(runs));
	});

	// POST /api/tracks/:id/budget
	router.post("/api/tracks/:id/budget", async (req, res, params) => {
		const body = await readBody(req);
		let parsed: {
			contractId?: string;
			tokens?: number;
			inputTokens?: number;
			outputTokens?: number;
			workerId?: string;
		} = {};
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
		const todoPath = trackTodoPath(param(params, "id"), cwd);
		const budgetOpts: { inputTokens?: number; outputTokens?: number; workerId?: string } = {};
		if (parsed.workerId) budgetOpts.workerId = parsed.workerId;
		if (typeof parsed.inputTokens === "number") budgetOpts.inputTokens = parsed.inputTokens;
		if (typeof parsed.outputTokens === "number") budgetOpts.outputTokens = parsed.outputTokens;
		const record = reportTokenUsage(
			todoPath,
			parsed.contractId,
			parsed.tokens,
			undefined,
			budgetOpts,
		);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(record));
	});

	// Mask sensitive fields before sending config to clients
	function redactConfig(cfg: import("./types.js").ConductorConfig): unknown {
		const copy = JSON.parse(JSON.stringify(cfg)) as typeof cfg;
		if (copy.telegram?.token) {
			const t = copy.telegram.token;
			copy.telegram.token = `${t.slice(0, Math.max(0, t.length - 4))}••••`;
		}
		if (copy.webhook?.secret) {
			const s = copy.webhook.secret;
			copy.webhook.secret = `${s.slice(0, Math.max(0, s.length - 4))}••••`;
		}
		return copy;
	}

	// GET /api/config
	router.get("/api/config", (_req, res) => {
		const cfg = loadConfig(cwd);
		res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
		res.end(
			JSON.stringify(cfg ?? { tracks: [], defaults: { concurrency: 1, agentCmd: "claude" } }),
		);
	});

	// POST /api/config — update top-level defaults / telegram / webhook fields
	router.post("/api/config", async (req, res) => {
		const body = await readBody(req);
		let patch: Record<string, unknown> = {};
		try {
			patch = JSON.parse(body) as Record<string, unknown>;
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Invalid JSON body" }));
			return;
		}

		const existing = loadConfig(cwd);
		if (!existing) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "No config found" }));
			return;
		}

		const merged = { ...existing };
		if (patch.defaults !== undefined) {
			merged.defaults = { ...existing.defaults, ...(patch.defaults as object) };
		}
		// null → remove the section; object → merge; omitted → no change
		if (patch.telegram === null) {
			delete (merged as Record<string, unknown>).telegram;
		} else if (patch.telegram !== undefined) {
			merged.telegram = {
				...existing.telegram,
				...(patch.telegram as object),
			} as import("./types.js").TelegramBotConfig;
		}
		if (patch.webhook === null) {
			delete (merged as Record<string, unknown>).webhook;
		} else if (patch.webhook !== undefined) {
			const pw = patch.webhook as { secret?: string };
			const combined: { secret?: string } = { ...existing.webhook, ...pw };
			// Empty-string secret is treated as "clear the secret"
			if (combined.secret === "") delete combined.secret;
			if (Object.keys(combined).length > 0) {
				merged.webhook = combined;
			} else {
				delete (merged as Record<string, unknown>).webhook;
			}
		}
		// null → remove obsidian; object → merge; omitted → no change
		if (patch.obsidian === null) {
			delete (merged as Record<string, unknown>).obsidian;
		} else if (patch.obsidian !== undefined) {
			merged.obsidian = {
				...existing.obsidian,
				...(patch.obsidian as object),
			} as import("./types.js").ObsidianConfig;
		}

		let validated: import("./types.js").ConductorConfig;
		try {
			validated = validateConfig(merged);
		} catch (err) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
			return;
		}

		saveConfig(validated, cwd);
		broadcastEvent({ type: "config-changed", config: redactConfig(validated) });

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
	});

	// POST /api/config/tracks/:id — patch a track's settings
	router.post("/api/config/tracks/:id", async (req, res, params) => {
		const body = await readBody(req);
		let patch: Partial<import("./types.js").Track> = {};
		try {
			patch = JSON.parse(body);
		} catch {
			/* ignore */
		}
		const config = loadConfig(cwd);
		if (!config) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "no config" }));
			return;
		}
		const idx = config.tracks.findIndex((t) => t.id === param(params, "id"));
		if (idx === -1) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "track not found" }));
			return;
		}
		const existingTrack = config.tracks[idx];
		if (!existingTrack) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "track index out of bounds" }));
			return;
		}
		config.tracks[idx] = { ...existingTrack, ...patch, id: existingTrack.id };
		saveConfig(config, cwd);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
	});

	// POST /api/webhook — trigger all tracks (after HMAC check passes upstream)
	router.post("/api/webhook", async (_req, res) => {
		const cfg = loadConfig(cwd);
		const trackIds = cfg?.tracks.map((t) => t.id) ?? [];
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ triggered: trackIds }));
	});

	// GET /api/version
	router.get("/api/version", async (_req, res) => {
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
	});

	// GET /api/memory — list memories with optional ?scope= and ?type= query params
	router.get("/api/memory", (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		const scope = url.searchParams.get("scope") ?? undefined;
		const type = url.searchParams.get("type") ?? undefined;
		const memories = loadMemory(cwd, {
			...(scope !== undefined && { scope }),
			...(type !== undefined && { types: [type as import("./memory.js").MemoryType] }),
		});
		res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
		res.end(JSON.stringify({ memories }));
	});

	// GET /api/memory/search?q=... — must be registered BEFORE /:slug to avoid param shadowing
	router.get("/api/memory/search", (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		const q = url.searchParams.get("q") ?? "";
		const scope = url.searchParams.get("scope") ?? undefined;
		const results = searchMemory(cwd, q, scope !== undefined ? { scope } : undefined);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ memories: results }));
	});

	// GET /api/memory/:slug
	router.get("/api/memory/:slug", (_req, res, params) => {
		const slug = param(params, "slug");
		const memories = loadMemory(cwd);
		const mem = memories.find((m) => m.filePath.endsWith(`${slug}.md`));
		if (!mem) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "memory not found", slug }));
			return;
		}
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ memory: mem }));
	});

	// POST /api/memory — write a new memory
	router.post("/api/memory", async (req, res) => {
		const body = await readBodyUtil(req);
		let payload: Record<string, unknown> = {};
		try {
			payload = JSON.parse(body) as Record<string, unknown>;
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "invalid JSON" }));
			return;
		}
		try {
			const filePath = writeMemory(cwd, {
				name: String(payload.name ?? ""),
				type: payload.type as import("./memory.js").MemoryType,
				scope: payload.scope as "global" | `track:${string}`,
				body: String(payload.body ?? ""),
				tags: Array.isArray(payload.tags) ? (payload.tags as string[]) : [],
			});
			broadcastEvent({ type: "memory-changed" });
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true, filePath }));
		} catch (err) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
		}
	});

	// DELETE /api/memory/:slug
	router.on("DELETE", "/api/memory/:slug", (_req, res, params) => {
		const slug = param(params, "slug");
		try {
			removeMemory(cwd, slug);
			broadcastEvent({ type: "memory-changed" });
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
		} catch (err) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
		}
	});

	// Register workspace routes
	const cleanupWorkspace = registerWorkspaceRoutes(router, cwd, sseClients);

	async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = req.url ?? "/";

		// Also handle /index.html as root
		if (url === "/index.html") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(htmlDashboard());
			return;
		}

		// Webhook HMAC validation (only for /api/webhook POST)
		if (url.startsWith("/api/webhook") && req.method === "POST") {
			const cfg = loadConfig(cwd);
			if (cfg?.webhook?.secret) {
				const body = await readBodyUtil(req);
				const sig = req.headers["x-hub-signature-256"] as string | undefined;
				if (!verifyHmac(body, sig, cfg.webhook.secret)) {
					res.writeHead(401, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Invalid webhook signature" }));
					return;
				}
				// Re-inject body for downstream handler
				(req as IncomingMessage & { _body?: string })._body = body;
			}
		}

		const matched = await router.handle(req, res);
		if (!matched) {
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("not found");
		}
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
			swarmEvents.off("worker-start", broadcastWorkerStart);
			swarmEvents.off("worker-retry", broadcastWorkerRetry);
			swarmEvents.off("budget-exceeded", broadcastBudgetExceeded);
			cleanupWorkspace();
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
