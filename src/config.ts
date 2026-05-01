import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConductorConfig } from "./types.js";

export function configDir(cwd = process.cwd()): string {
	return join(cwd, ".conductor");
}

export function configPath(cwd = process.cwd()): string {
	return join(configDir(cwd), "config.json");
}

export function trackDir(id: string, cwd = process.cwd()): string {
	return join(configDir(cwd), "tracks", id);
}

export function trackTodoPath(id: string, cwd = process.cwd()): string {
	return join(trackDir(id, cwd), "todo.md");
}

export function trackContextPath(id: string, cwd = process.cwd()): string {
	return join(trackDir(id, cwd), "CONTEXT.md");
}

export function loadConfig(cwd = process.cwd()): ConductorConfig | null {
	const p = configPath(cwd);
	if (!existsSync(p)) return null;
	try {
		const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
		// Migrate v0.2 configs that used "tentacles" instead of "tracks"
		if (!Array.isArray(raw.tracks) && Array.isArray(raw.tentacles)) {
			raw.tracks = raw.tentacles;
		}
		if (!Array.isArray(raw.tracks)) raw.tracks = [];
		return validateConfig(raw);
	} catch (err) {
		process.stderr.write(
			`conductor: invalid config at ${p}: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return null;
	}
}

export function validateConfig(raw: unknown): ConductorConfig {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error("config: must be a JSON object");
	}
	const obj = raw as Record<string, unknown>;

	// tracks
	if (!Array.isArray(obj.tracks)) {
		throw new Error("config.tracks: must be an array");
	}
	for (let i = 0; i < obj.tracks.length; i++) {
		const t = obj.tracks[i] as Record<string, unknown>;
		if (typeof t !== "object" || t === null)
			throw new Error(`config.tracks[${i}]: must be an object`);
		if (typeof t.id !== "string" || t.id === "")
			throw new Error(`config.tracks[${i}].id: must be a non-empty string`);
		if (typeof t.name !== "string" || t.name === "")
			throw new Error(`config.tracks[${i}].name: must be a non-empty string`);
		if (typeof t.description !== "string")
			throw new Error(`config.tracks[${i}].description: must be a string`);
		if (!Array.isArray(t.files) || !t.files.every((f) => typeof f === "string")) {
			throw new Error(`config.tracks[${i}].files: must be an array of strings`);
		}
		if (t.agentCmd !== undefined && typeof t.agentCmd !== "string")
			throw new Error(`config.tracks[${i}].agentCmd: must be a string`);
		if (t.concurrency !== undefined && typeof t.concurrency !== "number")
			throw new Error(`config.tracks[${i}].concurrency: must be a number`);
		if (t.schedule !== undefined && typeof t.schedule !== "string")
			throw new Error(`config.tracks[${i}].schedule: must be a string`);
		if (
			t.agentArgs !== undefined &&
			(!Array.isArray(t.agentArgs) || !t.agentArgs.every((a) => typeof a === "string"))
		)
			throw new Error(`config.tracks[${i}].agentArgs: must be an array of strings`);
		if (
			t.dependsOn !== undefined &&
			(!Array.isArray(t.dependsOn) || !t.dependsOn.every((d) => typeof d === "string"))
		)
			throw new Error(`config.tracks[${i}].dependsOn: must be an array of strings`);
	}

	// Validate all dependsOn references point to existing track IDs
	const rawTracks = obj.tracks as Array<Record<string, unknown>>;
	const trackIds = new Set(rawTracks.map((t) => t.id as string));
	rawTracks.forEach((t, i) => {
		if (Array.isArray(t.dependsOn)) {
			for (const dep of t.dependsOn as string[]) {
				if (!trackIds.has(dep)) {
					throw new Error(`config.tracks[${i}].dependsOn: references unknown track id "${dep}"`);
				}
			}
		}
	});

	// defaults
	if (typeof obj.defaults !== "object" || obj.defaults === null) {
		throw new Error("config.defaults: must be an object");
	}
	const defaults = obj.defaults as Record<string, unknown>;
	if (typeof defaults.concurrency !== "number" || defaults.concurrency <= 0) {
		throw new Error("config.defaults.concurrency: must be a positive number");
	}
	if (typeof defaults.agentCmd !== "string" || defaults.agentCmd === "") {
		throw new Error("config.defaults.agentCmd: must be a non-empty string");
	}
	if (
		defaults.agentArgs !== undefined &&
		(!Array.isArray(defaults.agentArgs) || !defaults.agentArgs.every((a) => typeof a === "string"))
	)
		throw new Error("config.defaults.agentArgs: must be an array of strings");

	// telegram (optional — both fields required if present)
	if (obj.telegram !== undefined) {
		if (typeof obj.telegram !== "object" || obj.telegram === null) {
			throw new Error("config.telegram: must be an object");
		}
		const tg = obj.telegram as Record<string, unknown>;
		if (typeof tg.token !== "string" || tg.token === "")
			throw new Error("config.telegram.token: must be a non-empty string");
		if (typeof tg.chatId !== "number") throw new Error("config.telegram.chatId: must be a number");
	}

	// webhook (optional)
	if (obj.webhook !== undefined) {
		if (typeof obj.webhook !== "object" || obj.webhook === null) {
			throw new Error("config.webhook: must be an object");
		}
		const wh = obj.webhook as Record<string, unknown>;
		if (wh.secret !== undefined && typeof wh.secret !== "string") {
			throw new Error("config.webhook.secret: must be a string");
		}
	}

	// obsidian (optional)
	if (obj.obsidian !== undefined) {
		if (typeof obj.obsidian !== "object" || obj.obsidian === null) {
			throw new Error("config.obsidian: must be an object");
		}
		const ob = obj.obsidian as Record<string, unknown>;
		if (typeof ob.vaultPath !== "string" || ob.vaultPath === "")
			throw new Error("config.obsidian.vaultPath: must be a non-empty string");
		if (ob.subfolder !== undefined && typeof ob.subfolder !== "string")
			throw new Error("config.obsidian.subfolder: must be a string");
		if (ob.mode !== "push" && ob.mode !== "pull" && ob.mode !== "two-way")
			throw new Error('config.obsidian.mode: must be "push", "pull", or "two-way"');
	}

	// defaults.memoryBudgetBytes (optional)
	const def = obj.defaults as Record<string, unknown>;
	if (def.memoryBudgetBytes !== undefined && typeof def.memoryBudgetBytes !== "number")
		throw new Error("config.defaults.memoryBudgetBytes: must be a number");

	return raw as unknown as ConductorConfig;
}

export function saveConfig(config: ConductorConfig, cwd = process.cwd()): void {
	const dir = configDir(cwd);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const p = configPath(cwd);
	const tmp = `${p}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	renameSync(tmp, p);
}
