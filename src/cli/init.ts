import { createInterface } from "node:readline";
import { createTrack, initConductor } from "../track.js";
import { c, parseFlags } from "./helpers.js";

async function runInitWizard(): Promise<void> {
	if (!process.stdin.isTTY) return;

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const ask = (q: string): Promise<string> =>
		new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

	try {
		const addFirst = await ask("\nAdd your first track? (y/N): ");
		if (addFirst.toLowerCase() !== "y") return;

		const name = await ask("  Name: ");
		if (!name) return;

		const desc = await ask("  Description (optional): ");
		const filesRaw = await ask("  Owned files (comma-separated glob, optional): ");
		const files = filesRaw
			? filesRaw
					.split(",")
					.map((f) => f.trim())
					.filter(Boolean)
			: [];

		const track = createTrack(name, desc, files);
		console.log(`\n${c.green}✓${c.reset} Created track "${c.bold}${track.id}${c.reset}"`);
		console.log(`  Edit ${c.cyan}.conductor/tracks/${track.id}/todo.md${c.reset} to add tasks`);
	} finally {
		rl.close();
	}
}

export async function cmdInit(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	try {
		initConductor();
		console.log(
			`${c.green}✓${c.reset} Initialized ${c.cyan}.conductor/${c.reset} in current directory`,
		);
		if (!flags.yes && flags.y !== true) await runInitWizard();
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
