import { deleteTrack } from "../track.js";
import { c, positionalArgs } from "./helpers.js";

export async function cmdRm(args: string[]): Promise<number> {
	const positional = positionalArgs(args);
	const id = positional[0];

	if (!id) {
		console.error("Usage: conductor rm <name>");
		return 1;
	}

	try {
		deleteTrack(id);
		console.log(`${c.green}✓${c.reset} Deleted track "${id}"`);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
