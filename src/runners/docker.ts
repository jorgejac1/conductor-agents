import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import type { WorkerRunner, WorkerRunOpts } from "evalgate";
import type { DockerRunnerConfig } from "../types.js";

export class DockerRunner implements WorkerRunner {
	constructor(private config: DockerRunnerConfig) {}

	async run(opts: WorkerRunOpts): Promise<number> {
		const { image, env = [], mounts = [] } = this.config;
		const agentCmd = opts.agentCmd ?? "claude";
		const task = opts.task.replace(/'/g, "'\\''");

		const args = [
			"run",
			"--rm",
			"-v",
			`${opts.cwd}:/workspace`,
			"-w",
			"/workspace",
			...env.flatMap((e) => ["-e", e]),
			...mounts.flatMap((m) => ["-v", m]),
			image,
			"sh",
			"-c",
			`${agentCmd} --headless --print '${task}' 2>&1`,
		];

		return new Promise((resolve, reject) => {
			const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
			const log = createWriteStream(opts.logPath, { flags: "a" });
			child.stdout?.pipe(log);
			child.stderr?.pipe(log);
			child.on("close", (code) => resolve(code ?? -1));
			child.on("error", reject);
		});
	}
}
