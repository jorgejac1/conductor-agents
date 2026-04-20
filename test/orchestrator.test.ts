import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { trackContextPath, trackTodoPath } from "../src/config.js";
import { detectCycle, getTrackState, retryTrackWorker, runTrack } from "../src/orchestrator.js";
import { createTrack, initConductor } from "../src/track.js";

function tmpDir(initGit = false): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-orch-"));
	if (initGit) {
		execSync("git init && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
	}
	return dir;
}

describe("detectCycle", () => {
	it("returns null for independent tracks", () => {
		const tracks = [
			{ id: "a", name: "A", description: "", files: [] },
			{ id: "b", name: "B", description: "", files: [] },
		];
		assert.strictEqual(detectCycle(tracks), null);
	});

	it("returns null for linear dependency chain", () => {
		const tracks = [
			{ id: "a", name: "A", description: "", files: [] },
			{ id: "b", name: "B", description: "", files: [], dependsOn: ["a"] },
			{ id: "c", name: "C", description: "", files: [], dependsOn: ["b"] },
		];
		assert.strictEqual(detectCycle(tracks), null);
	});

	it("returns null for diamond dependency (shared ancestor)", () => {
		const tracks = [
			{ id: "a", name: "A", description: "", files: [] },
			{ id: "b", name: "B", description: "", files: [], dependsOn: ["a"] },
			{ id: "c", name: "C", description: "", files: [], dependsOn: ["a"] },
			{ id: "d", name: "D", description: "", files: [], dependsOn: ["b", "c"] },
		];
		assert.strictEqual(detectCycle(tracks), null);
	});

	it("detects a 3-track cycle", () => {
		const tracks = [
			{ id: "a", name: "A", description: "", files: [], dependsOn: ["c"] },
			{ id: "b", name: "B", description: "", files: [], dependsOn: ["a"] },
			{ id: "c", name: "C", description: "", files: [], dependsOn: ["b"] },
		];
		const cycle = detectCycle(tracks);
		assert.ok(cycle !== null, "should detect cycle");
		assert.ok(Array.isArray(cycle) && cycle.length >= 2);
	});

	it("detects a self-cycle", () => {
		const tracks = [{ id: "x", name: "X", description: "", files: [], dependsOn: ["x"] }];
		const cycle = detectCycle(tracks);
		assert.ok(cycle !== null, "should detect self-cycle");
	});

	it("detects a 2-track mutual cycle", () => {
		const tracks = [
			{ id: "a", name: "A", description: "", files: [], dependsOn: ["b"] },
			{ id: "b", name: "B", description: "", files: [], dependsOn: ["a"] },
		];
		const cycle = detectCycle(tracks);
		assert.ok(cycle !== null, "should detect mutual cycle");
	});
});

describe("orchestrator", () => {
	it("getTrackState returns null when no state exists", async () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTrack("Alpha", "Test", [], dir);
			const state = await getTrackState("alpha", dir);
			assert.strictEqual(state, null);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("runTrack throws when track does not exist", async () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			await assert.rejects(() => runTrack("nonexistent", { cwd: dir }), /not found/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("runTrack with true verifier completes all workers", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);
			createTrack("Beta", "Beta feature", [], dir);

			const todoPath = trackTodoPath("beta", dir);
			writeFileSync(
				todoPath,
				["- [ ] Task one", "  - eval: `true`", "- [ ] Task two", "  - eval: `true`"].join("\n"),
			);

			const result = await runTrack("beta", {
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

	it("runTrack with false verifier marks workers failed", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);
			createTrack("Gamma", "Gamma feature", [], dir);

			const todoPath = trackTodoPath("gamma", dir);
			writeFileSync(
				todoPath,
				["- [ ] Failing task", "  - eval: `false`", "  - retries: 0"].join("\n"),
			);

			const result = await runTrack("gamma", {
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

	it("runTrack injects CONTEXT.md content into the agent prompt", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);
			createTrack("Delta", "Delta feature", ["src/delta/**"], dir);

			// Write a known context string to CONTEXT.md
			const ctxPath = trackContextPath("delta", dir);
			writeFileSync(
				ctxPath,
				"# Delta\n\nThis is the delta context.\n\n## Constraints\n- No side effects\n",
			);

			const todoPath = trackTodoPath("delta", dir);
			writeFileSync(todoPath, "- [ ] Delta task\n  - eval: `true`\n");

			// Use node to print argv[1] (the full prompt) to stdout so it appears in the log
			const result = await runTrack("delta", {
				concurrency: 1,
				agentCmd: "node",
				cwd: dir,
			});

			assert.strictEqual(result.state.workers.length, 1);
			const worker = result.state.workers[0];
			assert.ok(worker, "worker should exist");

			// The worker log should contain both the context and the task title
			const log = readFileSync(worker.logPath, "utf8");
			assert.ok(
				log.includes("This is the delta context"),
				"CONTEXT.md content should appear in log",
			);
			assert.ok(log.includes("Delta task"), "task title should appear in log");
			assert.ok(log.includes("## Task"), "Task section separator should appear");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("runTrack works when CONTEXT.md does not exist", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);
			createTrack("Epsilon", "Epsilon feature", [], dir);

			// Remove the auto-created CONTEXT.md
			const ctxPath = trackContextPath("epsilon", dir);
			rmSync(ctxPath, { force: true });

			const todoPath = trackTodoPath("epsilon", dir);
			writeFileSync(todoPath, "- [ ] Epsilon task\n  - eval: `true`\n");

			// Should not throw even without CONTEXT.md
			const result = await runTrack("epsilon", {
				concurrency: 1,
				agentCmd: "echo",
				cwd: dir,
			});

			assert.strictEqual(result.state.workers.length, 1);
			const failed = result.state.workers.filter((w) => w.status === "failed").length;
			assert.strictEqual(failed, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("retryTrackWorker throws when worker id not found", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);
			createTrack("Zeta", "Zeta feature", [], dir);
			const todoPath = trackTodoPath("zeta", dir);
			writeFileSync(todoPath, "- [ ] Zeta task\n  - eval: `true`\n");
			await runTrack("zeta", { concurrency: 1, agentCmd: "echo", cwd: dir });
			await assert.rejects(
				() => retryTrackWorker("zeta", "nonexistent-worker-id", { cwd: dir }),
				/not found/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("retryTrackWorker retries a failed worker and resolves", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);
			createTrack("Eta", "Eta feature", [], dir);
			const todoPath = trackTodoPath("eta", dir);

			// First run — verifier fails
			writeFileSync(todoPath, "- [ ] Eta task\n  - eval: `false`\n  - retries: 0\n");
			const first = await runTrack("eta", { concurrency: 1, agentCmd: "echo", cwd: dir });
			const failedWorker = first.state.workers.find((w) => w.status === "failed");
			assert.ok(failedWorker, "should have a failed worker");

			// Update verifier to pass, then retry
			writeFileSync(todoPath, "- [ ] Eta task\n  - eval: `true`\n");
			await assert.doesNotReject(() =>
				retryTrackWorker("eta", failedWorker.id, { agentCmd: "echo", cwd: dir }),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
