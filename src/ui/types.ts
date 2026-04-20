// Client-side type definitions for the conductor dashboard.
// These mirror the server-side types from src/types.ts and evalgate.

export interface Track {
	id: string;
	name: string;
	description: string;
	files: string[];
	agentCmd?: string;
	concurrency?: number;
	schedule?: string;
	agentArgs?: string[];
}

export interface TrackCostSummary {
	totalTokens: number;
	estimatedUsd: number;
}

export type WorkerStatus =
	| "pending"
	| "spawning"
	| "running"
	| "verifying"
	| "merging"
	| "done"
	| "failed";

export interface WorkerState {
	id: string;
	contractId: string;
	contractTitle: string;
	status: WorkerStatus;
	startedAt?: string;
	finishedAt?: string;
	logPath?: string;
	verifierPassed?: boolean;
	retries?: number;
}

export interface SwarmState {
	todoPath: string;
	workers: WorkerState[];
}

export interface TrackStatus {
	track: Track;
	todoTotal: number;
	todoPending: number;
	todoDone: number;
	swarmState: SwarmState | null;
	cost?: TrackCostSummary;
}

export interface RunRecord {
	id: string;
	contractId: string;
	contractTitle: string;
	trackId: string; // injected client-side from the endpoint
	ts: string; // ISO timestamp
	passed: boolean;
	trigger?: string;
	durationMs?: number;
}

export interface ConductorConfig {
	tracks: Track[];
	defaults: {
		concurrency: number;
		agentCmd: string;
		agentArgs?: string[];
	};
	telegram?: { token: string; chatId: number };
}

export interface VersionInfo {
	conductor: string;
	evalgate: string;
}

// ─── SSE event shapes ─────────────────────────────────────────────────────────

export interface SSETracksEvent {
	type: "tracks";
	tracks: TrackStatus[];
}

export interface SSESwarmEvent {
	type: "swarm";
	state: SwarmState;
}

export interface SSECostEvent {
	type: "cost";
	trackId?: string;
	contractId?: string;
	tokens: number;
	estimatedUsd?: number;
	workerId?: string;
}

export interface SSEEvalResultEvent {
	type: "eval-result";
	workerId: string;
	passed: boolean;
	contractId?: string;
	output?: string;
}

export type SSEEvent = SSETracksEvent | SSESwarmEvent | SSECostEvent | SSEEvalResultEvent;

// ─── Dashboard state ──────────────────────────────────────────────────────────

export type ConnectionStatus = "connecting" | "live" | "reconnecting";

export type TabId = "tracks" | "workers" | "history" | "activity" | "settings";

export interface EvalResult {
	passed: boolean;
	output?: string;
}

export interface CostEvent {
	trackId: string;
	tokens: number;
	estimatedUsd: number;
	timestamp: number;
}
