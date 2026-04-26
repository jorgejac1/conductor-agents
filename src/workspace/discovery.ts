import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConductorConfig } from "../types.js";
import type { ProjectEntry } from "./types.js";

/** Minimum fraction of subdirectories that must be git repos for a directory to
 *  qualify as a workspace root. Prevents false positives like /tmp or
 *  /var/folders which have many temp git repos scattered among thousands of dirs. */
const MIN_GIT_RATIO = 0.2;

/** Walk up from startDir until we find an ancestor where ≥20% of its immediate
 *  subdirectories contain .git/ and there are at least 2 such repos. */
export function findWorkspaceRoot(startDir: string): string {
	let dir = startDir;
	for (let i = 0; i < 10; i++) {
		const parent = dirname(dir);
		if (parent === dir) break; // filesystem root
		try {
			const dirents = readdirSync(parent, { withFileTypes: true }) as Dirent<string>[];
			const subDirs = dirents.filter((d) => d.isDirectory() && !d.name.startsWith("."));
			if (subDirs.length === 0) {
				dir = parent;
				continue;
			}
			const gitCount = subDirs.filter((d) => existsSync(join(parent, d.name, ".git"))).length;
			if (gitCount >= 2 && gitCount / subDirs.length >= MIN_GIT_RATIO) return parent;
		} catch {
			/* unreadable dir */
		}
		dir = parent;
	}
	return startDir;
}

/** Read a project's config.json if it exists */
function tryReadConfig(projectPath: string): ConductorConfig | undefined {
	const cfgPath = join(projectPath, ".conductor", "config.json");
	if (!existsSync(cfgPath)) return undefined;
	try {
		const raw = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
		if (!Array.isArray(raw.tracks))
			raw.tracks = ((raw as Record<string, unknown>).tentacles as unknown[]) ?? [];
		return raw as unknown as ConductorConfig;
	} catch {
		return undefined;
	}
}

/** Scan all immediate subdirectories of root for conductor projects */
export function scanProjects(root: string): ProjectEntry[] {
	let entries: Dirent<string>[];
	try {
		entries = readdirSync(root, { withFileTypes: true }) as Dirent<string>[];
	} catch {
		return [];
	}

	const EXCLUDED_DIRS = new Set(["node_modules", "dist", "build", ".git", ".cache"]);

	return entries
		.filter((d) => d.isDirectory() && !d.name.startsWith(".") && !EXCLUDED_DIRS.has(d.name))
		.map((d) => {
			const projectPath = join(root, d.name);
			const config = tryReadConfig(projectPath);
			const initialized = config !== undefined;

			const entry: ProjectEntry = {
				id: d.name,
				path: projectPath,
				name: config?.tracks?.[0]?.name ? d.name : d.name,
				initialized,
				...(config !== undefined && { config }),
				runnersActive: 0,
				trackCount: config?.tracks?.length ?? 0,
				totalSpendUsd: 0,
				lastActivity: null,
			};
			return entry;
		})
		.sort((a, b) => {
			// Initialized projects first, then alphabetical
			if (a.initialized !== b.initialized) return a.initialized ? -1 : 1;
			return a.id.localeCompare(b.id);
		});
}
