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
	dependsOn?: string[];
	/** Maximum token spend before pausing new workers for this track. */
	maxTokens?: number;
	/** Maximum estimated USD spend before pausing new workers for this track. */
	maxUsd?: number;
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
	/** Typed failure reason — set when status === "failed" (v2.1+). */
	failureKind?: string;
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
	budgetExceeded?: boolean;
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

export interface SSEWorkerStartEvent {
	type: "worker-start";
	workerId: string;
	contractId: string;
}

export interface SSEWorkerRetryEvent {
	type: "worker-retry";
	workerId: string;
	contractId: string;
}

export interface SSEBudgetExceededEvent {
	type: "budget-exceeded";
	trackId: string;
	totalTokens: number;
	totalUsd: number;
	maxTokens?: number;
	maxUsd?: number;
}

export type SSEEvent =
	| SSETracksEvent
	| SSESwarmEvent
	| SSECostEvent
	| SSEEvalResultEvent
	| SSEWorkerStartEvent
	| SSEWorkerRetryEvent
	| SSEBudgetExceededEvent;

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
