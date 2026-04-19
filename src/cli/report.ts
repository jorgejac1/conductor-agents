import { getTrackCost, getTrackState } from "../orchestrator.js";
import { listTracks } from "../track.js";
import { c, positionalArgs } from "./helpers.js";

export async function cmdReport(args: string[]): Promise<number> {
	const positional = positionalArgs(args);
	const id = positional[0];

	const SEP = "─".repeat(58);
	const COL_W = 22;

	try {
		if (id) {
			// Single track — per-contract breakdown
			const summary = getTrackCost(id);
			const state = await getTrackState(id);

			console.log(`\n${c.bold}Track: ${id}${c.reset}`);
			console.log(SEP);
			console.log(
				`  ${"Contract".padEnd(COL_W)} ${"Status".padEnd(10)} ${"Tokens".padStart(10)}  Est. Cost`,
			);
			console.log(`  ${"─".repeat(COL_W)} ${"─".repeat(8)}  ${"─".repeat(9)}  ${"─".repeat(9)}`);

			let totalTokens = 0;
			let totalUsd = 0;

			for (const entry of summary) {
				const worker = state?.workers.find((w) => w.contractId === entry.contractId);
				const status = worker?.status ?? "pending";
				const statusColor = status === "done" ? c.green : status === "failed" ? c.red : c.gray;
				const tokens = entry.used;
				// Sonnet 4 blended estimate: $9/MTok
				const usd = (tokens * 9) / 1_000_000;
				totalTokens += tokens;
				totalUsd += usd;

				console.log(
					`  ${entry.contractTitle.slice(0, COL_W).padEnd(COL_W)} ${statusColor}${status.padEnd(10)}${c.reset} ${tokens.toLocaleString().padStart(10)}  $${usd.toFixed(2).padStart(8)}`,
				);
			}

			if (summary.length === 0) {
				console.log(`  ${c.gray}No budget records yet. Run the track first.${c.reset}`);
			} else {
				console.log(`  ${"─".repeat(COL_W)} ${"─".repeat(8)}  ${"─".repeat(9)}  ${"─".repeat(9)}`);
				console.log(
					`  ${"Total".padEnd(COL_W)} ${"".padEnd(10)} ${totalTokens.toLocaleString().padStart(10)}  $${totalUsd.toFixed(2).padStart(8)}`,
				);
			}
			console.log();
		} else {
			// All tracks — summary table
			const statuses = await listTracks();
			if (!statuses.length) {
				console.log("No tracks.");
				return 0;
			}

			console.log(
				`\n${c.bold}${"Track".padEnd(COL_W)} ${"Tokens".padStart(10)}  Est. Cost${c.reset}`,
			);
			console.log(`${"─".repeat(COL_W)} ${"─".repeat(9)}  ${"─".repeat(9)}`);

			for (const ts of statuses) {
				const tokens = ts.cost?.totalTokens ?? 0;
				const usd = ts.cost?.estimatedUsd ?? 0;
				const tokStr = tokens > 0 ? tokens.toLocaleString() : `${c.gray}—${c.reset}`;
				const usdStr = tokens > 0 ? `$${usd.toFixed(2)}` : `${c.gray}—${c.reset}`;
				console.log(`${ts.track.id.padEnd(COL_W)} ${tokStr.padStart(10)}  ${usdStr.padStart(9)}`);
			}
			console.log();
		}
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
