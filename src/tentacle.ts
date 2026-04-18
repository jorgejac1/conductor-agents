import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadState } from "evalgate";
import {
	configDir,
	loadConfig,
	saveConfig,
	tentacleContextPath,
	tentacleDir,
	tentacleTodoPath,
} from "./config.js";
import type { ConductorConfig, Tentacle, TentacleStatus } from "./types.js";

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function parseTodoProgress(todoMd: string): { total: number; pending: number; done: number } {
	const lines = todoMd.split("\n");
	let total = 0;
	let done = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("- [x]") || trimmed.startsWith("- [ ]")) {
			total++;
			if (trimmed.startsWith("- [x]")) done++;
		}
	}
	return { total, pending: total - done, done };
}

export function createTentacle(
	name: string,
	description: string,
	files: string[],
	cwd = process.cwd(),
): Tentacle {
	const id = slugify(name);
	const config = loadConfig(cwd) ?? {
		tentacles: [],
		defaults: { concurrency: 3, agentCmd: "claude" },
	};

	if (config.tentacles.some((t) => t.id === id)) {
		throw new Error(`Tentacle "${id}" already exists`);
	}

	const dir = tentacleDir(id, cwd);
	mkdirSync(dir, { recursive: true });

	const filesSection =
		files.length > 0 ? files.map((f) => `- \`${f}\``).join("\n") : "- (none specified)";

	const contextMd = `# ${name}

${description}

## Owned files
${filesSection}

## Constraints
<!-- Add constraints for agents working on this area -->
`;

	const todoMd = `# ${name} — Tasks

<!-- Add eval-gated tasks below -->
<!-- - [ ] Task title -->
<!--   - eval: \`your verifier command\` -->
`;

	writeFileSync(tentacleContextPath(id, cwd), contextMd, "utf8");
	writeFileSync(tentacleTodoPath(id, cwd), todoMd, "utf8");

	const tentacle: Tentacle = { id, name, description, files };
	config.tentacles.push(tentacle);
	saveConfig(config, cwd);

	return tentacle;
}

export function deleteTentacle(id: string, cwd = process.cwd()): void {
	const config = loadConfig(cwd);
	if (!config) throw new Error("No conductor config found. Run `conductor init` first.");

	const idx = config.tentacles.findIndex((t) => t.id === id);
	if (idx === -1) throw new Error(`Tentacle "${id}" not found`);

	const dir = tentacleDir(id, cwd);
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

	config.tentacles.splice(idx, 1);
	saveConfig(config, cwd);
}

export async function listTentacles(cwd = process.cwd()): Promise<TentacleStatus[]> {
	const config = loadConfig(cwd);
	if (!config) return [];

	const results: TentacleStatus[] = [];
	for (const tentacle of config.tentacles) {
		const todoPath = tentacleTodoPath(tentacle.id, cwd);
		let todoTotal = 0;
		let todoPending = 0;
		let todoDone = 0;

		if (existsSync(todoPath)) {
			const src = readFileSync(todoPath, "utf8");
			const prog = parseTodoProgress(src);
			todoTotal = prog.total;
			todoPending = prog.pending;
			todoDone = prog.done;
		}

		const swarmStatePath = `${tentacleDir(tentacle.id, cwd)}/.evalgate/swarm-state.json`;
		let swarmState = null;
		try {
			swarmState = await loadState(todoPath);
		} catch {
			// no swarm state yet
		}
		void swarmStatePath; // path computed for clarity but loadState uses todoPath dir

		results.push({ tentacle, todoTotal, todoPending, todoDone, swarmState });
	}
	return results;
}

export function getTentacle(id: string, cwd = process.cwd()): Tentacle {
	const config = loadConfig(cwd);
	if (!config) throw new Error("No conductor config found. Run `conductor init` first.");
	const t = config.tentacles.find((t) => t.id === id);
	if (!t) throw new Error(`Tentacle "${id}" not found`);
	return t;
}

export function initConductor(cwd = process.cwd()): void {
	const existing = loadConfig(cwd);
	if (existing) throw new Error("Conductor already initialized in this directory");

	const dir = configDir(cwd);
	mkdirSync(dir, { recursive: true });

	const initial: ConductorConfig = {
		tentacles: [],
		defaults: { concurrency: 3, agentCmd: "claude" },
	};
	saveConfig(initial, cwd);
}
