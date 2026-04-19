import { listTracks } from "../track.js";
import { buildProgressBar, c } from "./helpers.js";

export async function cmdList(): Promise<number> {
	try {
		const statuses = await listTracks();
		if (!statuses.length) {
			console.log(`No tracks. Run ${c.cyan}conductor add <name>${c.reset} to create one.`);
			return 0;
		}

		for (const ts of statuses) {
			const workers = ts.swarmState?.workers ?? [];
			const done = workers.filter((w) => w.status === "done").length;
			const failed = workers.filter((w) => w.status === "failed").length;
			const running = workers.filter((w) =>
				["spawning", "running", "verifying", "merging"].includes(w.status),
			).length;

			const pct = ts.todoTotal > 0 ? Math.round((ts.todoDone / ts.todoTotal) * 100) : 0;

			let barColor = "";
			if (failed > 0) barColor = c.red;
			else if (running > 0) barColor = c.yellow;
			else if (pct === 100) barColor = c.green;

			const bar = buildProgressBar(pct, 20, barColor);

			const parts: string[] = [];
			if (done > 0) parts.push(`${c.green}done:${done}${c.reset}`);
			if (running > 0) parts.push(`${c.yellow}running:${running}${c.reset}`);
			if (failed > 0) parts.push(`${c.red}failed:${failed}${c.reset}`);
			const workerSummary = parts.length ? `  ${parts.join("  ")}` : "";

			const costStr = ts.cost
				? `  ${c.gray}${Math.round(ts.cost.totalTokens / 1000)}k tok (~$${ts.cost.estimatedUsd.toFixed(2)})${c.reset}`
				: "";

			console.log(
				`${c.bold}${ts.track.id.padEnd(20)}${c.reset} ${bar} ${ts.todoDone}/${ts.todoTotal}${workerSummary}${costStr}`,
			);
			if (ts.track.description) {
				console.log(`${"".padEnd(22)}${c.gray}${ts.track.description}${c.reset}`);
			}
		}
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
