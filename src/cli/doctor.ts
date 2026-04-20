import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseCron, parseTodo } from "evalgate";
import { configPath, loadConfig, trackTodoPath, validateConfig } from "../config.js";
import { c } from "./helpers.js";

const PASS = `${c.green}✔${c.reset}`;
const FAIL = `${c.red}✘${c.reset}`;
const WARN = `${c.yellow}⚠${c.reset}`;

function check(label: string, ok: boolean, detail?: string): boolean {
	const icon = ok ? PASS : FAIL;
	const msg = detail ? `${label}: ${detail}` : label;
	console.log(`  ${icon}  ${msg}`);
	return ok;
}

function warn(label: string, detail?: string): void {
	const msg = detail ? `${label}: ${detail}` : label;
	console.log(`  ${WARN}  ${msg}`);
}

export async function cmdDoctor(args: string[]): Promise<number> {
	const cwd = args[0] ?? process.cwd();
	console.log(`${c.bold}conductor doctor${c.reset}  ${c.gray}${cwd}${c.reset}\n`);

	let failed = 0;

	// ── 1. Config exists and parses ─────────────────────────────────────────────
	console.log(`${c.bold}Config${c.reset}`);
	const cfgPath = configPath(cwd);
	const cfgExists = existsSync(cfgPath);
	if (!check("config.json exists", cfgExists, cfgExists ? undefined : cfgPath)) {
		failed++;
		console.log(`\n  Run ${c.cyan}conductor init${c.reset} to create .conductor/\n`);
		// Cannot proceed without config
		return 1;
	}

	let rawParsed: unknown = null;
	try {
		rawParsed = JSON.parse(readFileSync(cfgPath, "utf8"));
	} catch {
		check("config.json is valid JSON", false, "failed to parse");
		failed++;
		return 1;
	}
	try {
		validateConfig(rawParsed);
		check("config.json schema is valid", true);
	} catch (err) {
		check("config.json schema is valid", false, err instanceof Error ? err.message : String(err));
		failed++;
	}

	const config = loadConfig(cwd);
	if (!config) {
		// Already reported above
		return 1;
	}

	// ── 2. Track todo files ──────────────────────────────────────────────────────
	console.log(`\n${c.bold}Tracks${c.reset}  (${config.tracks.length} configured)`);
	for (const track of config.tracks) {
		const todoPath = trackTodoPath(track.id, cwd);
		const exists = existsSync(todoPath);
		if (!check(`${track.id}/todo.md exists`, exists)) {
			failed++;
			continue;
		}

		// ── 3. Eval coverage ─────────────────────────────────────────────────────
		const source = readFileSync(todoPath, "utf8");
		const contracts = parseTodo(source);
		const noEval = contracts.filter((c) => !c.verifier);
		if (noEval.length > 0) {
			warn(
				`${track.id}: ${noEval.length} task(s) have no eval verifier`,
				noEval.map((c) => `"${c.title}"`).join(", "),
			);
		} else if (contracts.length === 0) {
			warn(`${track.id}/todo.md: no tasks found`);
		} else {
			check(`${track.id}: ${contracts.length} task(s) with eval verifiers`, true);
		}

		// ── 7. Cron expressions ──────────────────────────────────────────────────
		if (track.schedule) {
			try {
				parseCron(track.schedule);
				check(`${track.id}: cron "${track.schedule}" is valid`, true);
			} catch (err) {
				check(
					`${track.id}: cron "${track.schedule}" is valid`,
					false,
					err instanceof Error ? err.message : String(err),
				);
				failed++;
			}
		}
	}

	// ── 4. Stale git worktrees ───────────────────────────────────────────────────
	console.log(`\n${c.bold}Git worktrees${c.reset}`);
	try {
		const wtOut = execSync("git worktree list --porcelain", {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const wtLines = wtOut.split("\n");
		const stale: string[] = [];
		let current = "";
		for (const line of wtLines) {
			if (line.startsWith("worktree ")) {
				current = line.slice("worktree ".length).trim();
			} else if (line === "" && current) {
				// Check if it's under .conductor and has no active swarm
				const conductorDir = join(cwd, ".conductor");
				if (current.startsWith(conductorDir)) {
					// Active swarm workers use .conductor/tracks/<id>/worktrees/<worker>
					// They're expected; only flag if the directory is under .conductor but not matching that pattern
					const worktreeDir = join(conductorDir, "tracks");
					if (!current.startsWith(worktreeDir)) {
						stale.push(current);
					}
				}
				current = "";
			}
		}
		if (stale.length > 0) {
			for (const wt of stale) {
				warn("potentially stale worktree", wt);
			}
		} else {
			check("no stale worktrees detected", true);
		}
	} catch {
		warn("could not check git worktrees (not in a git repo?)");
	}

	// ── 5. evalgate version ──────────────────────────────────────────────────────
	console.log(`\n${c.bold}Dependencies${c.reset}`);
	try {
		const _require = createRequire(import.meta.url);
		const egPkg = _require("evalgate/package.json") as { version: string };
		const selfPkg = _require("../../package.json") as { dependencies: Record<string, string> };
		const required = selfPkg.dependencies?.evalgate ?? "unknown";
		// Simple semver range check: parse the installed major and compare against
		// the required major from caret ranges (^1.0.0 → major 1).
		const installedMajor = Number.parseInt(egPkg.version.split(".")[0] ?? "0", 10);
		const requiredBase = required.replace(/^[\^~>=<v]+/, "");
		const requiredMajor = Number.parseInt(requiredBase.split(".")[0] ?? "0", 10);
		const compatible = installedMajor === requiredMajor;
		if (
			!check(
				`evalgate ${egPkg.version} installed (required: ${required})`,
				compatible,
				compatible ? undefined : `major version mismatch — run npm install`,
			)
		) {
			failed++;
		}
	} catch {
		check("evalgate version check", false, "could not read evalgate/package.json");
		failed++;
	}

	// ── 6. Agent on PATH ─────────────────────────────────────────────────────────
	const agentCmds = new Set<string>([config.defaults.agentCmd]);
	for (const track of config.tracks) {
		if (track.agentCmd) agentCmds.add(track.agentCmd);
	}
	for (const cmd of agentCmds) {
		try {
			execSync(`which ${cmd}`, { stdio: "ignore" });
			check(`agent "${cmd}" found on PATH`, true);
		} catch {
			check(`agent "${cmd}" found on PATH`, false, "not found — install or set agentCmd");
			failed++;
		}
	}

	// ── Summary ──────────────────────────────────────────────────────────────────
	console.log();
	if (failed === 0) {
		console.log(`${c.green}${c.bold}All checks passed.${c.reset}`);
	} else {
		console.log(`${c.red}${c.bold}${failed} check(s) failed.${c.reset}`);
	}
	return failed > 0 ? 1 : 0;
}
