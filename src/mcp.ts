/**
 * MCP server for conductor.
 *
 * Exposes 6 tools over stdio JSON-RPC 2.0 so conductor can be controlled
 * from any MCP-compatible client (Claude Desktop, Cursor, etc.).
 *
 * Protocol: each stdin line = one JSON-RPC request; responses written to stdout.
 * Debug output goes to stderr.
 *
 * Zero runtime dependencies — uses Node built-ins only.
 */

import { createInterface } from "node:readline";
import type { McpJsonRpcRequest, McpJsonRpcResponse, McpToolDefinition } from "evalgate";
import { getTrackCost, getTrackState, retryTrackWorker, runTrack } from "./orchestrator.js";
import { createTrack, listTracks } from "./track.js";

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
				serverInfo: { name: "conductor", version: "0.8.0" },
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
