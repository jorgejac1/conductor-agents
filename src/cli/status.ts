import { getTrackState } from "../orchestrator.js";
import { getTrack, listTracks } from "../track.js";
import { c, formatDuration, positionalArgs } from "./helpers.js";

export async function cmdStatus(args: string[]): Promise<number> {
	const positional = positionalArgs(args);
	const id = positional[0];

	try {
		if (id) {
			getTrack(id); // throws if not found
			const state = await getTrackState(id);
			if (!state) {
				console.log(`No swarm state for "${id}" — run \`conductor run ${id}\` first`);
				return 0;
			}

			console.log(`\n${c.bold}Track: ${id}${c.reset}`);
			for (const worker of state.workers) {
				const statusColor =
					worker.status === "done"
						? c.green
						: worker.status === "failed"
							? c.red
							: ["spawning", "running", "verifying", "merging"].includes(worker.status)
								? c.yellow
								: c.gray;

				const statusStr = `${statusColor}${worker.status.padEnd(10)}${c.reset}`;
				const title = worker.contractTitle.padEnd(30);

				const duration = worker.startedAt
					? `  ${c.gray}${formatDuration(worker.startedAt, worker.finishedAt)}${c.reset}`
					: "";

				const evalResult =
					worker.status === "done"
						? `  ${c.green}✓ eval passed${c.reset}`
						: worker.status === "failed"
							? `  ${c.red}✗ eval failed${c.reset}`
							: "";

				const logHint =
					worker.status === "failed"
						? `\n${"".padEnd(14)}${c.gray}log: ${worker.logPath}${c.reset}`
						: "";

				console.log(`  ${statusStr} ${title}${duration}${evalResult}${logHint}`);
			}
		} else {
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

				const doneStr = done > 0 ? `${c.green}done:${done}${c.reset}` : `done:${done}`;
				const runningStr = running > 0 ? `  ${c.yellow}running:${running}${c.reset}` : "";
				const failedStr =
					failed > 0 ? `  ${c.red}failed:${failed}${c.reset}` : `  failed:${failed}`;

				console.log(
					`${c.bold}${ts.track.id.padEnd(20)}${c.reset} ${workers.length} workers  ${doneStr}${runningStr}${failedStr}`,
				);
			}
		}
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
