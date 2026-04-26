import { existsSync } from "node:fs";
import { detectPatterns, suggest } from "evalgate";
import { loadConfig, trackTodoPath } from "../config.js";
import { c } from "./helpers.js";

export async function cmdDiagnose(_args: string[]): Promise<number> {
	const cwd = process.cwd();
	const config = loadConfig(cwd);
	if (!config) {
		console.error("No conductor config found. Run `conductor init` first.");
		return 1;
	}

	console.log("\n📊 Failure analysis\n");

	let anyIssues = false;

	for (const track of config.tracks) {
		const todoPath = trackTodoPath(track.id, cwd);
		if (!existsSync(todoPath)) continue;

		const patterns = detectPatterns(todoPath);
		if (patterns.length === 0) continue;

		anyIssues = true;
		console.log(`  ${c.bold}${track.id}${c.reset}`);
		for (const p of patterns) {
			const count = p.failures;
			const tip = getTip(p.contractTitle);
			console.log(
				`    → ${c.yellow}${p.contractTitle}${c.reset} (${count} failures, ${Math.round(p.failureRate * 100)}% fail rate): ${tip}`,
			);
			if (p.topErrors.length > 0) {
				console.log(`      ${c.gray}${p.topErrors[0]}${c.reset}`);
			}
		}

		// suggest similar successful patterns using the track description as query
		const suggestions = suggest(todoPath, track.description ?? track.id, 2);
		if (suggestions.length > 0) {
			for (const s of suggestions.slice(0, 2)) {
				console.log(
					`    💡 ${c.gray}Similar passing: "${s.contractTitle}" (${Math.round(s.passRate * 100)}% pass rate)${c.reset}`,
				);
			}
		}
		console.log();
	}

	if (!anyIssues) {
		console.log(`  ${c.green}No failure patterns detected.${c.reset}\n`);
	}

	return 0;
}

function getTip(contractTitle: string): string {
	const lower = contractTitle.toLowerCase();
	if (lower.includes("timeout")) return "increase agentTimeoutMs or simplify task scope";
	if (lower.includes("merge") || lower.includes("conflict"))
		return "run with --concurrency 1 or resolve conflicts manually";
	if (lower.includes("worktree")) return "check git repo state and disk space";
	if (lower.includes("crash") || lower.includes("api"))
		return "check ANTHROPIC_API_KEY and network connectivity";
	return "review worker logs for details";
}
