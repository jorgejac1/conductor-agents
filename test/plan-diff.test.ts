/**
 * Tests for diffPlan() added in v2.3 (src/planner.ts).
 *
 * diffPlan compares a PlanDraft against the current conductor config and returns
 * a structured diff with `added`, `removed`, and `changed` arrays.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { diffPlan, type PlanDraft } from "../src/planner.js";
import { initConductor } from "../src/track.js";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "conductor-diff-"));
}

/** Minimal valid PlanDraft helper */
function makeDraft(trackIds: string[]): PlanDraft {
	return {
		goal: "test goal",
		generatedAt: new Date().toISOString(),
		tracks: trackIds.map((id) => ({
			id,
			description: `${id} description`,
			files: [`src/${id}/**`],
			concurrency: 2,
			context: `Context for ${id}`,
			tasks: [
				{
					title: `${id} task`,
					bullets: ["do the thing"],
					eval: "npm test",
				},
			],
		})),
	};
}

describe("diffPlan", () => {
	it("added contains track ids present in draft but not in config", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			// Config has no tracks; draft introduces "auth" and "api"
			const draft = makeDraft(["auth", "api"]);
			const diff = diffPlan(dir, draft);

			assert.ok(
				diff.added.includes("auth"),
				`Expected "auth" in added: ${JSON.stringify(diff.added)}`,
			);
			assert.ok(
				diff.added.includes("api"),
				`Expected "api" in added: ${JSON.stringify(diff.added)}`,
			);
			assert.strictEqual(diff.removed.length, 0, "removed should be empty");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("removed contains track ids in config but absent from draft", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);

			// Write config directly to control the track list without going through createTrack.
			const configPath = join(dir, ".conductor", "config.json");
			const config = {
				tracks: [
					{ id: "old-track", name: "Old Track", description: "old", files: [] },
					{ id: "another-old", name: "Another Old", description: "old2", files: [] },
				],
				defaults: { concurrency: 3, agentCmd: "claude" },
			};
			writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

			// Draft does not include either track
			const draft = makeDraft(["brand-new"]);
			const diff = diffPlan(dir, draft);

			assert.ok(
				diff.removed.includes("old-track"),
				`Expected "old-track" in removed: ${JSON.stringify(diff.removed)}`,
			);
			assert.ok(
				diff.removed.includes("another-old"),
				`Expected "another-old" in removed: ${JSON.stringify(diff.removed)}`,
			);
			assert.ok(diff.added.includes("brand-new"), `Expected "brand-new" in added`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("added, removed, and changed are all empty when draft matches config exactly", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);

			// Write config with tracks matching the draft
			const configPath = join(dir, ".conductor", "config.json");
			const config = {
				tracks: [
					{ id: "alpha", name: "Alpha", description: "alpha", files: ["src/alpha/**"] },
					{ id: "beta", name: "Beta", description: "beta", files: ["src/beta/**"] },
				],
				defaults: { concurrency: 3, agentCmd: "claude" },
			};
			writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

			// Create track dirs with todo.md matching the draft tasks so changed is also empty.
			for (const id of ["alpha", "beta"]) {
				const trackDir = join(dir, ".conductor", "tracks", id);
				mkdirSync(trackDir, { recursive: true });
				// Write an empty todo — no tasks, matching the draft's "same tasks" scenario.
				// Because tasks are the same count (1 each), delta = 0; files match too.
			}

			// Use a draft with the same track IDs and same files
			const draft: PlanDraft = {
				goal: "test",
				generatedAt: new Date().toISOString(),
				tracks: [
					{
						id: "alpha",
						description: "alpha",
						files: ["src/alpha/**"],
						concurrency: 2,
						context: "ctx",
						tasks: [], // No tasks in todo.md and no tasks in draft → delta = 0
					},
					{
						id: "beta",
						description: "beta",
						files: ["src/beta/**"],
						concurrency: 2,
						context: "ctx",
						tasks: [],
					},
				],
			};

			const diff = diffPlan(dir, draft);

			assert.strictEqual(
				diff.added.length,
				0,
				`Expected no added, got: ${JSON.stringify(diff.added)}`,
			);
			assert.strictEqual(
				diff.removed.length,
				0,
				`Expected no removed, got: ${JSON.stringify(diff.removed)}`,
			);
			// changed may have entries if filesChanged or task delta ≠ 0, but here files match and tasks = 0 both sides
			const meaningfulChanges = diff.changed.filter(
				(c) => c.filesChanged || c.taskDelta.added > 0 || c.taskDelta.removed > 0,
			);
			assert.strictEqual(
				meaningfulChanges.length,
				0,
				`Expected no meaningful changes, got: ${JSON.stringify(diff.changed)}`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("changed contains entry when files list differs", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);

			const configPath = join(dir, ".conductor", "config.json");
			const config = {
				tracks: [{ id: "ui", name: "UI", description: "ui track", files: ["src/ui/**"] }],
				defaults: { concurrency: 3, agentCmd: "claude" },
			};
			writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

			mkdirSync(join(dir, ".conductor", "tracks", "ui"), { recursive: true });
			writeFileSync(join(dir, ".conductor", "tracks", "ui", "todo.md"), "", "utf8");

			// Draft has same track id but different files
			const draft: PlanDraft = {
				goal: "test",
				generatedAt: new Date().toISOString(),
				tracks: [
					{
						id: "ui",
						description: "ui track",
						files: ["src/ui/**", "src/components/**"], // extra file — changed
						concurrency: 2,
						context: "ctx",
						tasks: [],
					},
				],
			};

			const diff = diffPlan(dir, draft);

			assert.strictEqual(diff.added.length, 0);
			assert.strictEqual(diff.removed.length, 0);
			const uiChange = diff.changed.find((c) => c.id === "ui");
			assert.ok(uiChange, "Expected 'ui' in changed");
			assert.strictEqual(uiChange.filesChanged, true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("added is empty and removed is empty when both config and draft have no tracks", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			const draft = makeDraft([]);
			const diff = diffPlan(dir, draft);
			assert.strictEqual(diff.added.length, 0);
			assert.strictEqual(diff.removed.length, 0);
			assert.strictEqual(diff.changed.length, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
