import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalRunner } from "evalgate";
import { DockerRunner } from "../src/runners/docker.js";
import { buildRunner } from "../src/runners/index.js";
import { SSHRunner } from "../src/runners/ssh.js";
import type { Track } from "../src/types.js";

function makeTrack(overrides: Partial<Track> = {}): Track {
	return {
		id: "test-track",
		name: "Test Track",
		description: "A test track",
		files: ["src/**"],
		...overrides,
	};
}

describe("buildRunner factory", () => {
	it("returns LocalRunner when runner is undefined", () => {
		const runner = buildRunner(makeTrack());
		assert.ok(runner instanceof LocalRunner, "should be LocalRunner");
	});

	it("returns LocalRunner when runner is 'local'", () => {
		const runner = buildRunner(makeTrack({ runner: "local" }));
		assert.ok(runner instanceof LocalRunner, "should be LocalRunner");
	});

	it("returns LocalRunner when runner is 'ssh' but no runnerConfig", () => {
		const runner = buildRunner(makeTrack({ runner: "ssh" }));
		// Falls through to default LocalRunner since no runnerConfig provided
		assert.ok(runner instanceof LocalRunner, "should fall back to LocalRunner");
	});

	it("returns LocalRunner when runner is 'docker' but no runnerConfig", () => {
		const runner = buildRunner(makeTrack({ runner: "docker" }));
		// Falls through to default LocalRunner since no runnerConfig provided
		assert.ok(runner instanceof LocalRunner, "should fall back to LocalRunner");
	});

	it("returns SSHRunner when runner is 'ssh' with valid runnerConfig", () => {
		const runner = buildRunner(
			makeTrack({
				runner: "ssh",
				runnerConfig: { host: "1.2.3.4", user: "ubuntu", keyPath: "/home/user/.ssh/id_rsa" },
			}),
		);
		assert.ok(runner instanceof SSHRunner, "should be SSHRunner");
	});

	it("returns DockerRunner when runner is 'docker' with valid runnerConfig", () => {
		const runner = buildRunner(
			makeTrack({
				runner: "docker",
				runnerConfig: { image: "node:20-alpine" },
			}),
		);
		assert.ok(runner instanceof DockerRunner, "should be DockerRunner");
	});

	it("SSHRunner has a run method", () => {
		const runner = new SSHRunner({ host: "host", user: "user", keyPath: "/key" });
		assert.strictEqual(typeof runner.run, "function");
	});

	it("DockerRunner has a run method", () => {
		const runner = new DockerRunner({ image: "node:20" });
		assert.strictEqual(typeof runner.run, "function");
	});
});
