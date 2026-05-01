import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { applyPlan, diffPlan, generatePlan, parsePlanDraft, runIterationLoop } from "../planner.js";
import { c, parseFlags, positionalArgs } from "./helpers.js";

function printDiff(diff: ReturnType<typeof diffPlan>): void {
	if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
		console.log(`  ${c.gray}(no changes — plan matches existing tracks)${c.reset}`);
		return;
	}
	for (const id of diff.added) {
		console.log(`  ${c.green}+ ${id}${c.reset}  (new track)`);
	}
	for (const id of diff.removed) {
		console.log(`  ${c.red}- ${id}${c.reset}  (removed from plan)`);
	}
	for (const ch of diff.changed) {
		const parts: string[] = [];
		if (ch.filesChanged) parts.push("files changed");
		if (ch.taskDelta.added > 0) parts.push(`+${ch.taskDelta.added} tasks`);
		if (ch.taskDelta.removed > 0) parts.push(`-${ch.taskDelta.removed} tasks`);
		console.log(`  ${c.bold}~ ${ch.id}${c.reset}  (${parts.join(", ")})`);
	}
}

async function confirmApply(): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question("Apply? [y/N] ", (answer) => {
			rl.close();
			resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
		});
	});
}

export async function cmdPlan(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	const sub = positional[0];
	const cwd = process.cwd();

	try {
		if (sub === "iterate") {
			const autoMode = flags.auto === true;
			const maxRounds = flags["max-rounds"] ? Number(flags["max-rounds"]) : 3;

			if (autoMode) {
				const { loadConfig } = await import("../config.js");
				const cfg = loadConfig(cwd);
				const agentCmd = cfg?.defaults?.agentCmd ?? undefined;
				const opts: { maxRounds: number; agentCmd?: string } = { maxRounds };
				if (agentCmd !== undefined) opts.agentCmd = agentCmd;
				const { rounds, converged } = await runIterationLoop(cwd, opts);
				console.log(
					converged
						? `\n${c.green}converged${c.reset} after ${rounds} round(s)`
						: `\n${c.yellow}max rounds reached${c.reset} (${rounds}/${maxRounds}) — failures remain`,
				);
				return converged ? 0 : 1;
			}

			const { generatePlanIterate } = await import("../planner.js");
			const result = await generatePlanIterate(cwd);
			if (!result) {
				console.log("No failed workers found in the last run — nothing to iterate on.");
				return 0;
			}
			console.log(`\nIteration plan generated. Run 'conductor plan diff' to review.`);
			return 0;
		}

		if (sub === "apply") {
			const dryRun = flags["dry-run"] === true;
			const yes = flags.yes === true;

			const draftPath = join(cwd, ".conductor", "plan-draft.md");
			if (!existsSync(draftPath)) {
				console.error(`No plan draft found. Run: conductor plan "<goal>" first`);
				return 1;
			}
			const draft = parsePlanDraft(readFileSync(draftPath, "utf8"));
			const diff = diffPlan(cwd, draft);

			console.log("\nPlan diff:");
			printDiff(diff);
			console.log();

			if (dryRun) {
				console.log("Dry run — no changes applied.");
				return 0;
			}

			if (!yes) {
				const confirmed = await confirmApply();
				if (!confirmed) {
					console.log("Aborted.");
					return 0;
				}
			}

			await applyPlan(cwd, false);
			return 0;
		}

		if (sub === "diff") {
			const draftPath = join(cwd, ".conductor", "plan-draft.md");
			if (!existsSync(draftPath)) {
				console.error(`No plan draft found. Run: conductor plan "<goal>" first`);
				return 1;
			}
			const draft = parsePlanDraft(readFileSync(draftPath, "utf8"));
			const diff = diffPlan(cwd, draft);
			console.log("\nPlan diff:");
			printDiff(diff);
			console.log();
			return 0;
		}

		if (sub === "show") {
			const draftPath = join(cwd, ".conductor", "plan-draft.md");
			if (!existsSync(draftPath)) {
				console.error(`No plan draft found. Run: conductor plan "<goal>" first`);
				return 1;
			}
			process.stdout.write(readFileSync(draftPath, "utf8"));
			return 0;
		}

		// Default: goal as first positional arg
		const goal = positional[0];
		if (!goal) {
			console.error('Usage: conductor plan "<goal>"');
			console.error("       conductor plan apply [--yes] [--dry-run]");
			console.error("       conductor plan diff");
			console.error("       conductor plan show");
			console.error("       conductor plan iterate [--auto] [--max-rounds=N]");
			return 1;
		}

		const { loadConfig } = await import("../config.js");
		const config = loadConfig(cwd);
		const agentCmd = config?.defaults?.agentCmd ?? "claude";

		await generatePlan(goal, cwd, agentCmd);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
