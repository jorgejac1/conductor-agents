import type { ConductorConfig } from "../types.js";

export interface ProjectEntry {
	/** Slug derived from directory name */
	id: string;
	/** Absolute path to project directory */
	path: string;
	/** Display name (from config or dir name) */
	name: string;
	/** Whether conductor has been initialized */
	initialized: boolean;
	/** Parsed config.json, if initialized */
	config?: ConductorConfig;
	/** Number of active workers across all tracks */
	runnersActive: number;
	/** Number of tracks */
	trackCount: number;
	/** Total estimated USD spend */
	totalSpendUsd: number;
	/** ISO timestamp of last state change */
	lastActivity: string | null;
}

export interface WorkspaceState {
	root: string;
	projects: ProjectEntry[];
}
