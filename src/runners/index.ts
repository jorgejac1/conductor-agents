export { DockerRunner } from "./docker.js";
export { SSHRunner } from "./ssh.js";

import type { WorkerRunner } from "evalgate";
import { LocalRunner } from "evalgate";
import type { Track } from "../types.js";
import { DockerRunner } from "./docker.js";
import { SSHRunner } from "./ssh.js";

export function buildRunner(track: Track): WorkerRunner {
	if (track.runner === "ssh" && track.runnerConfig) {
		const cfg = track.runnerConfig as import("../types.js").SSHRunnerConfig;
		return new SSHRunner(cfg);
	}
	if (track.runner === "docker" && track.runnerConfig) {
		const cfg = track.runnerConfig as import("../types.js").DockerRunnerConfig;
		return new DockerRunner(cfg);
	}
	return new LocalRunner();
}
