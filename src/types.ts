import type { SwarmState } from "evalgate";

export interface Tentacle {
	id: string; // slug: "auth-module"
	name: string; // display: "Auth Module"
	description: string; // what this tentacle owns
	files: string[]; // glob patterns for owned files
	agentCmd?: string; // override default agent
	concurrency?: number; // override default concurrency
}

export interface ConductorConfig {
	tentacles: Tentacle[];
	defaults: {
		concurrency: number; // 3
		agentCmd: string; // "claude"
	};
}

export interface TentacleStatus {
	tentacle: Tentacle;
	todoTotal: number;
	todoPending: number;
	todoDone: number;
	swarmState: SwarmState | null;
}
