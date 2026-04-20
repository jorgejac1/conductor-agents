import { createTrack } from "../track.js";
import { c, parseFlags, positionalArgs } from "./helpers.js";

export async function cmdAdd(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	const name = positional[0];

	if (!name) {
		console.error('Usage: conductor add <name> [--desc="description"] [--files="glob"]');
		return 1;
	}

	const description = typeof flags.desc === "string" ? flags.desc : "";
	const filesFlag = typeof flags.files === "string" ? flags.files : "";
	const files = filesFlag ? filesFlag.split(",").map((f) => f.trim()) : [];
	const dependsFlag = typeof flags.depends === "string" ? flags.depends : "";
	const dependsOn = dependsFlag ? dependsFlag.split(",").map((d) => d.trim()) : undefined;

	try {
		const track = createTrack(name, description, files, process.cwd(), dependsOn);
		console.log(`${c.green}✓${c.reset} Created track "${c.bold}${track.id}${c.reset}"`);
		if (dependsOn && dependsOn.length > 0) {
			console.log(`  depends on → ${c.yellow}${dependsOn.join(", ")}${c.reset}`);
		}
		console.log(`  CONTEXT.md → ${c.cyan}.conductor/tracks/${track.id}/CONTEXT.md${c.reset}`);
		console.log(`  todo.md    → ${c.cyan}.conductor/tracks/${track.id}/todo.md${c.reset}`);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
