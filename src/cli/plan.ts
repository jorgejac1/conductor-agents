import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyPlan, generatePlan } from "../planner.js";
import { parseFlags, positionalArgs } from "./helpers.js";

export async function cmdPlan(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	const sub = positional[0];

	try {
		if (sub === "apply") {
			const dryRun = flags["dry-run"] === true;
			await applyPlan(process.cwd(), dryRun);
			return 0;
		}

		if (sub === "show") {
			const draftPath = join(process.cwd(), ".conductor", "plan-draft.md");
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
			console.error("       conductor plan apply [--dry-run]");
			console.error("       conductor plan show");
			return 1;
		}

		const { loadConfig } = await import("../config.js");
		const config = loadConfig(process.cwd());
		const agentCmd = config?.defaults?.agentCmd ?? "claude";

		await generatePlan(goal, process.cwd(), agentCmd);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
