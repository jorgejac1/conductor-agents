/**
 * Tests for runAll() — topological wave execution of conductor tracks.
 *
 * runAll reads the config, builds a dependency graph, and runs tracks in
 * waves based on dependsOn relationships. Tracks with no deps run first;
 * each subsequent wave only starts when all predecessors in the requested
 * set have completed. If a track finishes with failed > 0 workers, its
 * transitive dependents are skipped (not run, not in results).
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig, trackTodoPath } from "../src/config.js";
import { runAll } from "../src/orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(initGit = false): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-run-all-"));
	if (initGit) {
		execSync("git init && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
	}
	return dir;
}

/**
 * Creates the track directory and writes a todo.md for a track.
 * Does NOT create a config entry — call saveConfig separately.
 *
 * @param tasks - lines to join into todo.md, e.g.:
 *   ["- [ ] Task one", "  - eval: `true`"]
 */
function setupTrack(dir: string, id: string, tasks: string[]): void {
	mkdirSync(join(dir, ".conductor", "tracks", id), { recursive: true });
	writeFileSync(trackTodoPath(id, dir), tasks.join("\n"));
}

/** Convenience: todo.md lines for a single task that passes the verifier. */
function passTasks(n = 1): string[] {
	const lines: string[] = [];
	for (let i = 1; i <= n; i++) {
		lines.push(`- [ ] Task ${i}`, "  - eval: `true`");
	}
	return lines;
}

/** Convenience: todo.md lines for a single task that FAILS the verifier (no retries). */
function failTasks(n = 1): string[] {
	const lines: string[] = [];
	for (let i = 1; i <= n; i++) {
		lines.push(`- [ ] Task ${i}`, "  - eval: `false`", "  - retries: 0");
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAll — independent tracks", () => {
	it("should run both tracks and include them in results when there are no dependencies", async () => {
		const dir = tmpDir(true);
		try {
			// Config with two independent tracks (no dependsOn on either).
			saveConfig(
				{
					tracks: [
						{ id: "alpha", name: "Alpha", description: "First track", files: [] },
						{ id: "beta", name: "Beta", description: "Second track", files: [] },
					],
					defaults: { concurrency: 1, agentCmd: "echo" },
				},
				dir,
			);
			setupTrack(dir, "alpha", passTasks());
			setupTrack(dir, "beta", passTasks());

			const results = await runAll({ agentCmd: "echo", cwd: dir });

			assert.strictEqual(results.size, 2, "both tracks should appear in results");
			assert.ok(results.has("alpha"), "alpha should be in results");
			assert.ok(results.has("beta"), "beta should be in results");

			// Neither track should have failed workers.
			const alphaFailed = results.get("alpha")?.failed;
			const betaFailed = results.get("beta")?.failed;
			assert.strictEqual(alphaFailed, 0, "alpha should have no failed workers");
			assert.strictEqual(betaFailed, 0, "beta should have no failed workers");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("runAll — linear dependency chain", () => {
	it("should complete all three tracks in order: a → b → c", async () => {
		const dir = tmpDir(true);
		try {
			saveConfig(
				{
					tracks: [
						{ id: "a", name: "A", description: "Root", files: [] },
						{ id: "b", name: "B", description: "Depends on a", files: [], dependsOn: ["a"] },
						{ id: "c", name: "C", description: "Depends on b", files: [], dependsOn: ["b"] },
					],
					defaults: { concurrency: 1, agentCmd: "echo" },
				},
				dir,
			);
			setupTrack(dir, "a", passTasks());
			setupTrack(dir, "b", passTasks());
			setupTrack(dir, "c", passTasks());

			const results = await runAll({ agentCmd: "echo", cwd: dir });

			// All three tracks must appear in results.
			assert.strictEqual(results.size, 3, "all three tracks should complete");
			assert.ok(results.has("a"), "a should be in results");
			assert.ok(results.has("b"), "b should be in results");
			assert.ok(results.has("c"), "c should be in results");

			// No track should have failed workers.
			for (const [id, res] of results) {
				assert.strictEqual(res.failed, 0, `${id} should have no failed workers`);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("runAll — skip on failure", () => {
	it("should skip b when a has a failed worker (direct dependency)", async () => {
		const dir = tmpDir(true);
		try {
			saveConfig(
				{
					tracks: [
						{ id: "a", name: "A", description: "Fails", files: [] },
						{ id: "b", name: "B", description: "Depends on a", files: [], dependsOn: ["a"] },
					],
					defaults: { concurrency: 1, agentCmd: "echo" },
				},
				dir,
			);
			// a uses a failing verifier → result.failed > 0 → b must be skipped.
			setupTrack(dir, "a", failTasks());
			setupTrack(dir, "b", passTasks());

			const results = await runAll({ agentCmd: "echo", cwd: dir });

			// a ran (and failed) — it should be in results.
			assert.ok(results.has("a"), "a should be in results even though it failed");
			assert.ok(results.get("a")?.failed > 0, "a should have at least one failed worker");

			// b was skipped — must NOT be in results.
			assert.strictEqual(results.has("b"), false, "b should be skipped when a fails");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should transitively skip c when a fails (a → b → c)", async () => {
		const dir = tmpDir(true);
		try {
			saveConfig(
				{
					tracks: [
						{ id: "a", name: "A", description: "Fails", files: [] },
						{ id: "b", name: "B", description: "Depends on a", files: [], dependsOn: ["a"] },
						{ id: "c", name: "C", description: "Depends on b", files: [], dependsOn: ["b"] },
					],
					defaults: { concurrency: 1, agentCmd: "echo" },
				},
				dir,
			);
			setupTrack(dir, "a", failTasks());
			setupTrack(dir, "b", passTasks());
			setupTrack(dir, "c", passTasks());

			const results = await runAll({ agentCmd: "echo", cwd: dir });

			// Only a should appear in results.
			assert.strictEqual(results.size, 1, "only the failing track should be in results");
			assert.ok(results.has("a"), "a should be in results");
			assert.strictEqual(results.has("b"), false, "b should be transitively skipped");
			assert.strictEqual(results.has("c"), false, "c should be transitively skipped");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("runAll — trackIds filter", () => {
	it("should only run the tracks listed in trackIds and skip the rest", async () => {
		const dir = tmpDir(true);
		try {
			saveConfig(
				{
					tracks: [
						{ id: "a", name: "A", description: "Track A", files: [] },
						{ id: "b", name: "B", description: "Track B", files: [] },
						{ id: "c", name: "C", description: "Track C", files: [] },
					],
					defaults: { concurrency: 1, agentCmd: "echo" },
				},
				dir,
			);
			setupTrack(dir, "a", passTasks());
			// b intentionally has no directory/todo — it must never be touched.
			setupTrack(dir, "c", passTasks());

			// Request only a and c; b should never run.
			const results = await runAll({ agentCmd: "echo", cwd: dir, trackIds: ["a", "c"] });

			assert.strictEqual(results.size, 2, "only the requested tracks should be in results");
			assert.ok(results.has("a"), "a should be in results");
			assert.ok(results.has("c"), "c should be in results");
			assert.strictEqual(results.has("b"), false, "b was not requested and must not run");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("runAll — cycle detection", () => {
	it("should throw before starting any work when there is a dependency cycle", async () => {
		const dir = tmpDir(true);
		try {
			// a → b → a is a cycle.
			saveConfig(
				{
					tracks: [
						{ id: "a", name: "A", description: "Cycle A", files: [], dependsOn: ["b"] },
						{ id: "b", name: "B", description: "Cycle B", files: [], dependsOn: ["a"] },
					],
					defaults: { concurrency: 1, agentCmd: "echo" },
				},
				dir,
			);
			// We do NOT create track dirs — runAll must throw before attempting any I/O.

			await assert.rejects(
				() => runAll({ agentCmd: "echo", cwd: dir }),
				/Dependency cycle detected/,
				"runAll should throw with 'Dependency cycle detected' for a cyclic graph",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("runAll — diamond dependency", () => {
	it("should complete all four tracks in a diamond: a → b, a → c, b+c → d", async () => {
		const dir = tmpDir(true);
		try {
			// Diamond topology:
			//   a (root)
			//  ↙ ↘
			// b   c
			//  ↘ ↙
			//   d (depends on both b and c)
			saveConfig(
				{
					tracks: [
						{ id: "a", name: "A", description: "Root", files: [] },
						{ id: "b", name: "B", description: "Left branch", files: [], dependsOn: ["a"] },
						{ id: "c", name: "C", description: "Right branch", files: [], dependsOn: ["a"] },
						{
							id: "d",
							name: "D",
							description: "Diamond tip",
							files: [],
							dependsOn: ["b", "c"],
						},
					],
					defaults: { concurrency: 2, agentCmd: "echo" },
				},
				dir,
			);
			setupTrack(dir, "a", passTasks());
			setupTrack(dir, "b", passTasks());
			setupTrack(dir, "c", passTasks());
			setupTrack(dir, "d", passTasks());

			const results = await runAll({ agentCmd: "echo", cwd: dir });

			// All four tracks should complete successfully.
			assert.strictEqual(results.size, 4, "all four diamond tracks should complete");
			for (const id of ["a", "b", "c", "d"]) {
				assert.ok(results.has(id), `${id} should be in results`);
				assert.strictEqual(results.get(id)?.failed, 0, `${id} should have no failed workers`);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
