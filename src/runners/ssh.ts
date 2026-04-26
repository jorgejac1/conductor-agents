import { type SpawnOptions, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import type { WorkerRunner, WorkerRunOpts } from "evalgate";
import type { SSHRunnerConfig } from "../types.js";

export class SSHRunner implements WorkerRunner {
	constructor(private config: SSHRunnerConfig) {}

	async run(opts: WorkerRunOpts): Promise<number> {
		const { host, user, keyPath, remoteCwd = "/tmp/conductor-workers" } = this.config;
		const remote = `${user}@${host}`;
		const sshBase = ["ssh", "-i", keyPath, "-o", "StrictHostKeyChecking=no", remote];

		// 1. Ensure remote dir exists
		await this.execSsh(sshBase, `mkdir -p ${remoteCwd}`);

		// 2. rsync worktree to remote
		await this.execCmd([
			"rsync",
			"-az",
			"--delete",
			"-e",
			`ssh -i ${keyPath} -o StrictHostKeyChecking=no`,
			`${opts.cwd}/`,
			`${remote}:${remoteCwd}/`,
		]);

		// 3. Run agent remotely — pipe stdout/stderr to logPath
		const agentCmd = opts.agentCmd ?? "claude";
		const task = opts.task.replace(/'/g, "'\\''");
		const remoteCmd = `cd ${remoteCwd} && ${agentCmd} --headless --print '${task}' 2>&1`;
		const exitCode = await this.execSshLogged(sshBase, remoteCmd, opts.logPath);

		// 4. rsync back
		await this.execCmd([
			"rsync",
			"-az",
			"-e",
			`ssh -i ${keyPath} -o StrictHostKeyChecking=no`,
			`${remote}:${remoteCwd}/`,
			`${opts.cwd}/`,
		]);

		return exitCode;
	}

	private execSsh(sshBase: string[], cmd: string): Promise<void> {
		const sshCmd = sshBase[0] ?? "ssh";
		const sshArgs = [...sshBase.slice(1), cmd];
		return new Promise((resolve, reject) => {
			const opts: SpawnOptions = { stdio: "pipe" };
			const child = spawn(sshCmd, sshArgs, opts);
			child.on("close", (code: number | null) =>
				code === 0 ? resolve() : reject(new Error(`ssh exited ${String(code)}`)),
			);
			child.on("error", reject);
		});
	}

	private execSshLogged(sshBase: string[], cmd: string, logPath: string): Promise<number> {
		const sshCmd = sshBase[0] ?? "ssh";
		const sshArgs = [...sshBase.slice(1), cmd];
		return new Promise((resolve, reject) => {
			const opts: SpawnOptions = { stdio: ["ignore", "pipe", "pipe"] };
			const child = spawn(sshCmd, sshArgs, opts);
			const log = createWriteStream(logPath, { flags: "a" });
			child.stdout?.pipe(log);
			child.stderr?.pipe(log);
			child.on("close", (code: number | null) => resolve(code ?? -1));
			child.on("error", reject);
		});
	}

	private execCmd(args: string[]): Promise<void> {
		const cmd = args[0] ?? "echo";
		const rest = args.slice(1);
		return new Promise((resolve, reject) => {
			const opts: SpawnOptions = { stdio: "pipe" };
			const child = spawn(cmd, rest, opts);
			child.on("close", (code: number | null) =>
				code === 0 ? resolve() : reject(new Error(`${cmd} exited ${String(code)}`)),
			);
			child.on("error", reject);
		});
	}
}
