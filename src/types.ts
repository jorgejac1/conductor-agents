import type { SwarmState } from "evalgate";

export interface TelegramBotConfig {
	token: string;
	chatId: number;
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
}

export interface ConductorConfig {
	tracks: Track[];
	defaults: {
		concurrency: number; // 3
		agentCmd: string; // "claude"
		agentArgs?: string[]; // global default agentArgs; overridden per-track
	};
	telegram?: TelegramBotConfig;
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
}
