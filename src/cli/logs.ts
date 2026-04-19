import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { getTrackState } from "../orchestrator.js";
import { c, parseFlags, positionalArgs } from "./helpers.js";

export async function cmdLogs(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	const workerId = positional[0];
	const trackId = positional[1];

	if (!workerId || !trackId) {
		console.error("Usage: conductor logs <worker-id> <track> [--follow|-f]");
		return 1;
	}

	const follow = flags.follow === true || flags.f === true;

	try {
		const state = await getTrackState(trackId);
		if (!state) {
			console.error(`No run state for "${trackId}" — run \`conductor run ${trackId}\` first`);
			return 1;
		}

		const worker = state.workers.find((w) => w.id.startsWith(workerId));
		if (!worker) {
			console.error(`Worker "${workerId}" not found in track "${trackId}"`);
			return 1;
		}

		const { logPath } = worker;

		if (!existsSync(logPath)) {
			if (follow) {
				process.stderr.write(`${c.gray}Waiting for log file…${c.reset}\n`);
				await new Promise<void>((resolve) => {
					const check = setInterval(() => {
						if (existsSync(logPath)) {
							clearInterval(check);
							resolve();
						}
					}, 300);
				});
			} else {
				console.error(`Log file not found: ${logPath}`);
				return 1;
			}
		}

		process.stderr.write(`${c.gray}── ${worker.contractTitle} ─ ${logPath}${c.reset}\n`);

		const content = readFileSync(logPath, "utf8");
		process.stdout.write(content);

		if (!follow) return 0;

		// Tail mode: poll for new bytes every 500ms
		let offset = Buffer.byteLength(content, "utf8");

		const poll = () => {
			try {
				const st = statSync(logPath);
				if (st.size > offset) {
					const fd = openSync(logPath, "r");
					const buf = Buffer.alloc(st.size - offset);
					readSync(fd, buf, 0, buf.length, offset);
					closeSync(fd);
					process.stdout.write(buf.toString("utf8"));
					offset = st.size;
				}
			} catch {
				/* file gone or locked */
			}
		};

		const interval = setInterval(poll, 500);
		process.on("SIGINT", () => {
			clearInterval(interval);
			process.exit(0);
		});

		await new Promise(() => {}); // keep alive until Ctrl+C
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
