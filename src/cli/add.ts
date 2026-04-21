import type { CreateTrackOpts } from "../track.js";
import { createTrack } from "../track.js";
import { c, parseFlags, positionalArgs } from "./helpers.js";

export async function cmdAdd(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	const name = positional[0];

	if (!name) {
		console.error(
			'Usage: conductor add <name> [--desc="description"] [--files="glob"] [--max-usd=<n>] [--max-tokens=<n>]',
		);
		return 1;
	}

	const description = typeof flags.desc === "string" ? flags.desc : "";
	const filesFlag = typeof flags.files === "string" ? flags.files : "";
	const files = filesFlag ? filesFlag.split(",").map((f) => f.trim()) : [];
	const dependsFlag = typeof flags.depends === "string" ? flags.depends : "";
	const dependsOn = dependsFlag ? dependsFlag.split(",").map((d) => d.trim()) : undefined;

	const maxUsdRaw = flags["max-usd"];
	const maxTokensRaw = flags["max-tokens"];
	const maxUsd = typeof maxUsdRaw === "string" ? Number.parseFloat(maxUsdRaw) : undefined;
	const maxTokens =
		typeof maxTokensRaw === "string" ? Number.parseInt(maxTokensRaw, 10) : undefined;

	if (maxUsd !== undefined && Number.isNaN(maxUsd)) {
		console.error("--max-usd must be a number");
		return 1;
	}
	if (maxTokens !== undefined && Number.isNaN(maxTokens)) {
		console.error("--max-tokens must be an integer");
		return 1;
	}

	try {
		const opts: CreateTrackOpts = {
			...(dependsOn !== undefined ? { dependsOn } : {}),
			...(maxUsd !== undefined ? { maxUsd } : {}),
			...(maxTokens !== undefined ? { maxTokens } : {}),
		};
		const track = createTrack(name, description, files, process.cwd(), opts);
		console.log(`${c.green}✓${c.reset} Created track "${c.bold}${track.id}${c.reset}"`);
		if (dependsOn && dependsOn.length > 0) {
			console.log(`  depends on → ${c.yellow}${dependsOn.join(", ")}${c.reset}`);
		}
		if (track.maxUsd !== undefined) {
			console.log(`  max USD    → ${c.yellow}$${track.maxUsd}${c.reset}`);
		}
		if (track.maxTokens !== undefined) {
			console.log(`  max tokens → ${c.yellow}${track.maxTokens.toLocaleString()}${c.reset}`);
		}
		console.log(`  CONTEXT.md → ${c.cyan}.conductor/tracks/${track.id}/CONTEXT.md${c.reset}`);
		console.log(`  todo.md    → ${c.cyan}.conductor/tracks/${track.id}/todo.md${c.reset}`);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
