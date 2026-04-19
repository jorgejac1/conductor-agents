import { startServer } from "../server.js";
import { c, parseFlags } from "./helpers.js";

export async function cmdUi(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const port = flags.port ? Number(flags.port) : 8080;

	const handle = await startServer({ port });
	console.log(`conductor UI running at ${c.cyan}http://localhost:${handle.port}${c.reset}`);
	console.log(`${c.gray}Press Ctrl+C to stop${c.reset}`);

	return new Promise((resolve) => {
		process.on("SIGINT", () => {
			handle.stop();
			resolve(0);
		});
		process.on("SIGTERM", () => {
			handle.stop();
			resolve(0);
		});
	});
}
