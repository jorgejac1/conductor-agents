import type { SwarmState } from "evalgate";

export interface TelegramBotConfig {
	token: string;
	chatId: number;
}

export interface SSHRunnerConfig {
	host: string;
	user: string;
	/** Path to SSH private key file */
	keyPath: string;
	/** Remote working directory. Default: /tmp/conductor-workers */
	remoteCwd?: string;
}

export interface DockerRunnerConfig {
	image: string;
	/** Additional env vars: ["KEY=value"] */
	env?: string[];
	/** Additional volume mounts: ["/host:/container"] */
	mounts?: string[];
}

export interface WorkspaceConfig {
	/** Absolute path pinned as workspace root. Auto-detected if absent. */
	root?: string;
}

export interface Track {
	id: string; // slug: "auth-module"
	name: string; // display: "Auth Module"
	description: string; // what this track owns
	files: string[]; // glob patterns for owned files
	agentCmd?: string; // override default agent
	concurrency?: number; // override default concurrency
	schedule?: string; // 5-field cron expression, e.g. "0 9 * * 1-5"
	agentArgs?: string[]; // e.g. ["--full-auto", "{task}"] for codex; {task} is replaced with context+title
	/** IDs of tracks that must complete (all workers done) before this track runs. */
	dependsOn?: string[];
	/** Maximum token spend before pausing new workers for this track. */
	maxTokens?: number;
	/** Maximum estimated USD spend before pausing new workers for this track. */
	maxUsd?: number;
	/** Runner type for agent workers. Defaults to "local". */
	runner?: "local" | "ssh" | "docker";
	/** Configuration for the selected runner. */
	runnerConfig?: SSHRunnerConfig | DockerRunnerConfig;
}

export interface ConductorConfig {
	tracks: Track[];
	defaults: {
		concurrency: number; // 3
		agentCmd: string; // "claude"
		agentArgs?: string[]; // global default agentArgs; overridden per-track
	};
	telegram?: TelegramBotConfig;
	webhook?: {
		/** HMAC-SHA256 secret for validating X-Hub-Signature-256 on inbound webhooks */
		secret?: string;
	};
}

export interface TrackCostSummary {
	totalTokens: number;
	estimatedUsd: number;
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
