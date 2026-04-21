/**
 * MCP server for conductor.
 *
 * Exposes 12 tools over stdio JSON-RPC 2.0 so conductor can be controlled
 * from any MCP-compatible client (Claude Desktop, Cursor, etc.).
 *
 * Protocol: each stdin line = one JSON-RPC request; responses written to stdout.
 * Debug output goes to stderr.
 *
 * Zero runtime dependencies — uses Node built-ins only.
 */

import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import type { McpJsonRpcRequest, McpJsonRpcResponse, McpToolDefinition } from "evalgate";
import { queryRuns } from "evalgate";
import { loadConfig, saveConfig, trackTodoPath } from "./config.js";
import {
	getTrackCost,
	getTrackState,
	pauseTrack,
	retryTrackWorker,
	runTrack,
} from "./orchestrator.js";
import { diffPlan, parsePlanDraft } from "./planner.js";
import { createTrack, listTracks } from "./track.js";

const _require = createRequire(import.meta.url);
const VERSION: string = (_require("../package.json") as { version: string }).version;

// ---------------------------------------------------------------------------
// Params helper type
// ---------------------------------------------------------------------------

type Params = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: McpToolDefinition[] = [
	{
		name: "list_tracks",
		description:
			"List all conductor tracks with their current progress (pending/done/failed workers). Use this to get an overview of all ongoing work.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "track_status",
		description:
			"Show the current worker states for a specific track — which workers are running, done, or failed, along with their contract titles and durations.",
		inputSchema: {
			type: "object",
			properties: {
				track_id: {
					type: "string",
					description: 'The track id (slug), e.g. "auth" or "payments".',
				},
			},
			required: ["track_id"],
		},
	},
	{
		name: "run_track",
		description:
			"Run a track's worker swarm — spawns one agent per pending task in parallel. Each agent works in its own git worktree and merges back when its eval verifier passes. WARNING: this is a long-running operation that may take minutes.",
		inputSchema: {
			type: "object",
			properties: {
				track_id: { type: "string", description: "The track id to run." },
				concurrency: {
					type: "number",
					description: "Max parallel workers. Defaults to track or global default (3).",
				},
				agent_cmd: {
					type: "string",
					description: 'Agent command override. Defaults to "claude".',
				},
			},
			required: ["track_id"],
		},
	},
	{
		name: "retry_worker",
		description:
			"Retry a failed worker — re-spawns the agent with failure context injected so it can learn from the previous attempt.",
		inputSchema: {
			type: "object",
			properties: {
				track_id: { type: "string", description: "The track id that owns the worker." },
				worker_id: {
					type: "string",
					description: "The worker id (or unique prefix) to retry.",
				},
			},
			required: ["track_id", "worker_id"],
		},
	},
	{
		name: "add_track",
		description:
			"Create a new conductor track with a CONTEXT.md and empty todo.md. After creating the track, add tasks to its todo.md manually.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: 'Display name for the track, e.g. "Auth Module".' },
				description: { type: "string", description: "Short description of what this track owns." },
				files: {
					type: "string",
					description:
						'Comma-separated glob patterns for owned files, e.g. "src/auth/**,src/middleware/auth.ts".',
				},
			},
			required: ["name", "description"],
		},
	},
	{
		name: "get_cost",
		description:
			"Get the token usage and estimated USD cost breakdown for a track, grouped by contract.",
		inputSchema: {
			type: "object",
			properties: {
				track_id: { type: "string", description: "The track id to report on." },
			},
			required: ["track_id"],
		},
	},
	{
		name: "schedule_track",
		description:
			"Set a cron schedule on a track so it runs automatically. Uses 5-field cron syntax (minute hour day month weekday). Example: '0 9 * * 1-5' runs at 9am Mon–Fri.",
		inputSchema: {
			type: "object",
			properties: {
				track_id: { type: "string", description: "The track id to schedule." },
				cron_expr: {
					type: "string",
					description: '5-field cron expression, e.g. "0 9 * * 1-5".',
				},
			},
			required: ["track_id", "cron_expr"],
		},
	},
	{
		name: "unschedule_track",
		description: "Remove the cron schedule from a track.",
		inputSchema: {
			type: "object",
			properties: {
				track_id: { type: "string", description: "The track id to unschedule." },
			},
			required: ["track_id"],
		},
	},
	{
		name: "get_logs",
		description: "Retrieve the session log for a specific worker. Returns the last N lines.",
		inputSchema: {
			type: "object",
			properties: {
				track_id: { type: "string", description: "The track id that owns the worker." },
				worker_id: { type: "string", description: "The worker id (or unique prefix)." },
				tail: {
					type: "number",
					description: "Number of lines to return from the end. Defaults to 100.",
				},
			},
			required: ["track_id", "worker_id"],
		},
	},
	{
		name: "cancel_run",
		description:
			"Pause/cancel an in-flight track run — stops new workers from spawning. In-flight workers finish naturally.",
		inputSchema: {
			type: "object",
			properties: {
				track_id: { type: "string", description: "The track id to cancel." },
			},
			required: ["track_id"],
		},
	},
	{
		name: "list_history",
		description: "List the recent run history for a track — one entry per eval execution.",
		inputSchema: {
			type: "object",
			properties: {
				track_id: { type: "string", description: "The track id." },
				limit: { type: "number", description: "Max results. Defaults to 20." },
			},
			required: ["track_id"],
		},
	},
	{
		name: "get_plan_diff",
		description:
			"Show what a plan draft would add, remove, or change versus the current conductor config — without applying it.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description: "Project directory. Defaults to current working directory.",
				},
			},
		},
	},
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleListTracks(_params: Params, cwd: string): Promise<unknown> {
	return listTracks(cwd);
}

async function handleTrackStatus(params: Params, cwd: string): Promise<unknown> {
	const trackId = params.track_id as string | undefined;
	if (!trackId) throw new Error("track_id is required");
	return getTrackState(trackId, cwd);
}

async function handleRunTrack(params: Params, cwd: string): Promise<unknown> {
	const trackId = params.track_id as string | undefined;
	if (!trackId) throw new Error("track_id is required");
	const concurrency = params.concurrency as number | undefined;
	const agentCmd = params.agent_cmd as string | undefined;
	const opts: { cwd: string; concurrency?: number; agentCmd?: string } = { cwd };
	if (concurrency !== undefined) opts.concurrency = concurrency;
	if (agentCmd !== undefined) opts.agentCmd = agentCmd;
	const result = await runTrack(trackId, opts);
	return result;
}

async function handleRetryWorker(params: Params, cwd: string): Promise<unknown> {
	const trackId = params.track_id as string | undefined;
	const workerId = params.worker_id as string | undefined;
	if (!trackId) throw new Error("track_id is required");
	if (!workerId) throw new Error("worker_id is required");
	await retryTrackWorker(trackId, workerId, { cwd });
	return { retried: workerId };
}

async function handleAddTrack(params: Params, cwd: string): Promise<unknown> {
	const name = params.name as string | undefined;
	const description = params.description as string | undefined;
	if (!name) throw new Error("name is required");
	if (!description) throw new Error("description is required");
	const filesRaw = params.files as string | undefined;
	const files = filesRaw
		? filesRaw
				.split(",")
				.map((f) => f.trim())
				.filter(Boolean)
		: [];
	const track = createTrack(name, description, files, cwd);
	return track;
}

async function handleGetCost(params: Params, cwd: string): Promise<unknown> {
	const trackId = params.track_id as string | undefined;
	if (!trackId) throw new Error("track_id is required");
	return getTrackCost(trackId, cwd);
}

async function handleScheduleTrack(params: Params, cwd: string): Promise<unknown> {
	const trackId = params.track_id as string | undefined;
	const cronExpr = params.cron_expr as string | undefined;
	if (!trackId) throw new Error("track_id is required");
	if (!cronExpr) throw new Error("cron_expr is required");

	const { parseCron, nextFireMs } = await import("evalgate");
	let expr: ReturnType<typeof parseCron>;
	try {
		expr = parseCron(cronExpr);
	} catch {
		throw new Error(
			`Invalid cron expression: "${cronExpr}". Expected 5-field cron: minute hour day month weekday`,
		);
	}

	const config = loadConfig(cwd);
	if (!config) throw new Error("No conductor config found");
	const track = config.tracks.find((t) => t.id === trackId);
	if (!track) throw new Error(`Track "${trackId}" not found`);

	track.schedule = cronExpr;
	saveConfig(config, cwd);

	const ms = nextFireMs(expr);
	const next = new Date(Date.now() + ms);
	return { scheduled: true, trackId, cronExpr, nextFire: next.toISOString() };
}

async function handleGetLogs(params: Params, cwd: string): Promise<unknown> {
	const trackId = params.track_id as string | undefined;
	const workerId = params.worker_id as string | undefined;
	if (!trackId) throw new Error("track_id is required");
	if (!workerId) throw new Error("worker_id is required");
	const state = await getTrackState(trackId, cwd);
	if (!state) throw new Error(`No state for track "${trackId}"`);
	const worker = state.workers.find((w) => w.id.startsWith(workerId));
	if (!worker) throw new Error(`Worker "${workerId}" not found`);
	const { existsSync: fe, readFileSync: rf } = await import("node:fs");
	if (!fe(worker.logPath)) return { log: "(no output yet)" };
	const raw = rf(worker.logPath, "utf8");
	const tail = typeof params.tail === "number" ? params.tail : 100;
	const lines = raw.split("\n");
	return { log: lines.slice(-tail).join("\n"), totalLines: lines.length };
}

async function handleCancelRun(params: Params, cwd: string): Promise<unknown> {
	const trackId = params.track_id as string | undefined;
	if (!trackId) throw new Error("track_id is required");
	const paused = pauseTrack(trackId, cwd);
	return { cancelled: paused, trackId };
}

async function handleListHistory(params: Params, cwd: string): Promise<unknown> {
	const trackId = params.track_id as string | undefined;
	if (!trackId) throw new Error("track_id is required");
	const limit = typeof params.limit === "number" ? params.limit : 20;
	const todoPath = trackTodoPath(trackId, cwd);
	return queryRuns(todoPath, { limit });
}

async function handleGetPlanDiff(params: Params, cwd: string): Promise<unknown> {
	const effectiveCwd = typeof params.cwd === "string" ? params.cwd : cwd;
	const { existsSync: fe, readFileSync: rf } = await import("node:fs");
	const { join } = await import("node:path");
	const draftPath = join(effectiveCwd, ".conductor", "plan-draft.md");
	if (!fe(draftPath)) throw new Error('No plan draft found. Run: conductor plan "<goal>" first');
	const draft = parsePlanDraft(rf(draftPath, "utf8"));
	return diffPlan(effectiveCwd, draft);
}

async function handleUnscheduleTrack(params: Params, cwd: string): Promise<unknown> {
	const trackId = params.track_id as string | undefined;
	if (!trackId) throw new Error("track_id is required");

	const config = loadConfig(cwd);
	if (!config) throw new Error("No conductor config found");
	const track = config.tracks.find((t) => t.id === trackId);
	if (!track) throw new Error(`Track "${trackId}" not found`);

	const hadSchedule = !!track.schedule;
	delete track.schedule;
	saveConfig(config, cwd);
	return { unscheduled: true, trackId, hadSchedule };
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

function send(response: McpJsonRpcResponse): void {
	process.stdout.write(`${JSON.stringify(response)}\n`);
}

function sendError(id: McpJsonRpcRequest["id"], code: number, message: string): void {
	send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function dispatch(req: McpJsonRpcRequest, cwd: string): Promise<void> {
	const { id, method, params } = req;
	const p = (params ?? {}) as Params;

	if (method === "initialize") {
		send({
			jsonrpc: "2.0",
			id,
			result: {
				protocolVersion: "2024-11-05",
				serverInfo: { name: "conductor", version: VERSION },
				capabilities: { tools: {} },
			},
		});
		return;
	}

	if (method === "notifications/initialized") {
		// No response needed for notifications
		return;
	}

	if (method === "tools/list") {
		send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
		return;
	}

	if (method === "tools/call") {
		const toolName = (p.name ?? p.tool) as string | undefined;
		const toolParams = (p.arguments ?? p.params ?? {}) as Params;

		let result: unknown;
		try {
			switch (toolName) {
				case "list_tracks":
					result = await handleListTracks(toolParams, cwd);
					break;
				case "track_status":
					result = await handleTrackStatus(toolParams, cwd);
					break;
				case "run_track":
					result = await handleRunTrack(toolParams, cwd);
					break;
				case "retry_worker":
					result = await handleRetryWorker(toolParams, cwd);
					break;
				case "add_track":
					result = await handleAddTrack(toolParams, cwd);
					break;
				case "get_cost":
					result = await handleGetCost(toolParams, cwd);
					break;
				case "schedule_track":
					result = await handleScheduleTrack(toolParams, cwd);
					break;
				case "unschedule_track":
					result = await handleUnscheduleTrack(toolParams, cwd);
					break;
				case "get_logs":
					result = await handleGetLogs(toolParams, cwd);
					break;
				case "cancel_run":
					result = await handleCancelRun(toolParams, cwd);
					break;
				case "list_history":
					result = await handleListHistory(toolParams, cwd);
					break;
				case "get_plan_diff":
					result = await handleGetPlanDiff(toolParams, cwd);
					break;
				default:
					sendError(id, -32601, `unknown tool: ${toolName}`);
					return;
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			sendError(id, -32603, msg);
			return;
		}

		send({
			jsonrpc: "2.0",
			id,
			result: {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			},
		});
		return;
	}

	sendError(id, -32601, `method not found: ${method}`);
}

// ---------------------------------------------------------------------------
// Server entrypoint
// ---------------------------------------------------------------------------

export function startMcpServer(cwd: string = process.cwd()): void {
	process.stderr.write(`[conductor] MCP server started (cwd: ${cwd})\n`);

	const rl = createInterface({ input: process.stdin, terminal: false });

	rl.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;

		let req: McpJsonRpcRequest;
		try {
			req = JSON.parse(trimmed) as McpJsonRpcRequest;
		} catch {
			send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
			return;
		}

		dispatch(req, cwd).catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[conductor] dispatch error: ${msg}\n`);
			send({ jsonrpc: "2.0", id: req.id ?? null, error: { code: -32603, message: msg } });
		});
	});

	rl.on("close", () => {
		process.stderr.write("[conductor] stdin closed, exiting\n");
		process.exit(0);
	});
}
