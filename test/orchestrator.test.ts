import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { tentacleTodoPath } from "../src/config.js";
import { getTentacleState, runTentacle } from "../src/orchestrator.js";
import { createTentacle, initConductor } from "../src/tentacle.js";

function tmpDir(initGit = false): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-orch-"));
	if (initGit) {
		execSync("git init && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
	}
	return dir;
}

describe("orchestrator", () => {
	it("getTentacleState returns null when no state exists", async () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTentacle("Alpha", "Test", [], dir);
			const state = await getTentacleState("alpha", dir);
			assert.strictEqual(state, null);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("runTentacle throws when tentacle does not exist", async () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			await assert.rejects(() => runTentacle("nonexistent", { cwd: dir }), /not found/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("runTentacle with true verifier completes all workers", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);
			createTentacle("Beta", "Beta feature", [], dir);

			const todoPath = tentacleTodoPath("beta", dir);
			writeFileSync(
				todoPath,
				["- [ ] Task one", "  - eval: `true`", "- [ ] Task two", "  - eval: `true`"].join("\n"),
			);

			const result = await runTentacle("beta", {
				concurrency: 1,
				agentCmd: "echo",
				cwd: dir,
			});

			// Both tasks should complete (sequential workers, true verifier)
			assert.strictEqual(result.state.workers.length, 2);
			const failed = result.state.workers.filter((w) => w.status === "failed").length;
			assert.strictEqual(failed, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("runTentacle with false verifier marks workers failed", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);
			createTentacle("Gamma", "Gamma feature", [], dir);

			const todoPath = tentacleTodoPath("gamma", dir);
			writeFileSync(
				todoPath,
				["- [ ] Failing task", "  - eval: `false`", "  - retries: 0"].join("\n"),
			);

			const result = await runTentacle("gamma", {
				concurrency: 1,
				agentCmd: "echo",
				cwd: dir,
			});

			const failed = result.state.workers.filter((w) => w.status === "failed").length;
			assert.strictEqual(failed, 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
