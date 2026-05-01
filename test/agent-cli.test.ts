import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { cmdAgent } from "../src/cli/agent.js";
import { initConductor } from "../src/track.js";

function mkTemp(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "conductor-agent-cli-"));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("conductor agent CLI", () => {
	it("should list all built-in plugins and exit 0", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const originalLog = console.log;
			const output: string[] = [];
			console.log = (...args: unknown[]) => output.push(args.join(" "));
			const code = await cmdAgent(["list"], dir);
			console.log = originalLog;
			assert.strictEqual(code, 0);
			const combined = output.join("\n");
			assert.ok(combined.includes("claude"), "should list claude plugin");
			assert.ok(combined.includes("opencode"), "should list opencode plugin");
			assert.ok(combined.includes("aider"), "should list aider plugin");
		} finally {
			cleanup();
		}
	});

	it("should show plugin info for a known plugin and exit 0", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const output: string[] = [];
			const originalLog = console.log;
			console.log = (...args: unknown[]) => output.push(args.join(" "));
			const code = await cmdAgent(["info", "claude"], dir);
			console.log = originalLog;
			assert.strictEqual(code, 0);
			const combined = output.join("\n");
			assert.ok(combined.includes("claude"), "output should include plugin id");
		} finally {
			cleanup();
		}
	});

	it("should exit 1 for unknown plugin info", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const originalError = console.error;
			console.error = () => {};
			const code = await cmdAgent(["info", "totally-unknown-agent-xyz"], dir);
			console.error = originalError;
			assert.strictEqual(code, 1);
		} finally {
			cleanup();
		}
	});

	it("should write agentCmd to config when using 'use' with --yes", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const code = await cmdAgent(["use", "opencode", "--yes"], dir);
			assert.strictEqual(code, 0);
			const cfg = JSON.parse(readFileSync(join(dir, ".conductor", "config.json"), "utf8")) as {
				defaults: { agentCmd: string };
			};
			assert.strictEqual(cfg.defaults.agentCmd, "opencode");
		} finally {
			cleanup();
		}
	});

	it("should reject unknown agent id in 'use' command", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const originalError = console.error;
			console.error = () => {};
			const code = await cmdAgent(["use", "imaginary-agent-xyz", "--yes"], dir);
			console.error = originalError;
			assert.strictEqual(code, 1);
		} finally {
			cleanup();
		}
	});

	it("should print usage and exit 1 when no subcommand is given", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const originalError = console.error;
			console.error = () => {};
			const code = await cmdAgent([], dir);
			console.error = originalError;
			assert.strictEqual(code, 1);
		} finally {
			cleanup();
		}
	});
});
