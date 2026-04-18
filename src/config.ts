import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConductorConfig } from "./types.js";

export function configDir(cwd = process.cwd()): string {
	return join(cwd, ".conductor");
}

export function configPath(cwd = process.cwd()): string {
	return join(configDir(cwd), "config.json");
}

export function tentacleDir(id: string, cwd = process.cwd()): string {
	return join(configDir(cwd), "tentacles", id);
}

export function tentacleTodoPath(id: string, cwd = process.cwd()): string {
	return join(tentacleDir(id, cwd), "todo.md");
}

export function tentacleContextPath(id: string, cwd = process.cwd()): string {
	return join(tentacleDir(id, cwd), "CONTEXT.md");
}

export function loadConfig(cwd = process.cwd()): ConductorConfig | null {
	const p = configPath(cwd);
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, "utf8")) as ConductorConfig;
	} catch {
		return null;
	}
}

export function saveConfig(config: ConductorConfig, cwd = process.cwd()): void {
	const dir = configDir(cwd);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const p = configPath(cwd);
	const tmp = `${p}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	renameSync(tmp, p);
}

export function defaultConfig(): ConductorConfig {
	return {
		tentacles: [],
		defaults: {
			concurrency: 3,
			agentCmd: "claude",
		},
	};
}
