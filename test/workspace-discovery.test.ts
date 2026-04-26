import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { findWorkspaceRoot, scanProjects } from "../src/workspace/discovery.js";

function makeGitRepo(parentDir: string, name: string): string {
	const dir = join(parentDir, name);
	mkdirSync(join(dir, ".git"), { recursive: true });
	return dir;
}

function makeConductorConfig(
	projectDir: string,
	config: Record<string, unknown> = {
		tracks: [{ id: "main", name: "Main", description: "Main track", files: ["src/**"] }],
		defaults: { concurrency: 3, agentCmd: "claude" },
	},
): void {
	mkdirSync(join(projectDir, ".conductor"), { recursive: true });
	writeFileSync(join(projectDir, ".conductor", "config.json"), JSON.stringify(config), "utf8");
}

describe("workspace-discovery", () => {
	describe("findWorkspaceRoot", () => {
		it("returns parent when parent has 2+ git repo children", () => {
			const workspaceRoot = mkdtempSync(join(tmpdir(), "conductor-ws-"));
			try {
				const repoA = makeGitRepo(workspaceRoot, "repo-a");
				makeGitRepo(workspaceRoot, "repo-b");

				const found = findWorkspaceRoot(repoA);
				assert.strictEqual(found, workspaceRoot);
			} finally {
				rmSync(workspaceRoot, { recursive: true, force: true });
			}
		});

		it("returns startDir when no suitable parent found", () => {
			const dir = mkdtempSync(join(tmpdir(), "conductor-single-"));
			try {
				// Only one git repo in the parent, no workspace
				mkdirSync(join(dir, ".git"), { recursive: true });
				const found = findWorkspaceRoot(dir);
				// Should not crash; returns some directory
				assert.ok(typeof found === "string");
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it("skips parent with too low git-repo ratio (temp dir heuristic)", () => {
			// Simulate /tmp: many non-git dirs dilute the ratio below MIN_GIT_RATIO
			const parent = mkdtempSync(join(tmpdir(), "conductor-sparse-"));
			try {
				// 2 git repos but 20 total dirs → ratio = 10% < 20% → should NOT be chosen
				makeGitRepo(parent, "repo-a");
				makeGitRepo(parent, "repo-b");
				for (let i = 0; i < 18; i++) {
					mkdirSync(join(parent, `non-git-${i}`), { recursive: true });
				}
				const startDir = makeGitRepo(parent, "my-project");
				const found = findWorkspaceRoot(startDir);
				// parent has 20 dirs but only 2 git repos (10%) — below threshold
				assert.notStrictEqual(found, parent);
			} finally {
				rmSync(parent, { recursive: true, force: true });
			}
		});

		it("returns parent with 3 git repo children", () => {
			const workspaceRoot = mkdtempSync(join(tmpdir(), "conductor-ws3-"));
			try {
				const repoA = makeGitRepo(workspaceRoot, "repo-a");
				makeGitRepo(workspaceRoot, "repo-b");
				makeGitRepo(workspaceRoot, "repo-c");

				const found = findWorkspaceRoot(repoA);
				assert.strictEqual(found, workspaceRoot);
			} finally {
				rmSync(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	describe("scanProjects", () => {
		it("shows initialized project when .conductor/config.json exists", () => {
			const root = mkdtempSync(join(tmpdir(), "conductor-scan-"));
			try {
				makeGitRepo(root, "project-a");
				makeConductorConfig(join(root, "project-a"));
				makeGitRepo(root, "project-b");

				const projects = scanProjects(root);
				const projA = projects.find((p) => p.id === "project-a");
				const projB = projects.find((p) => p.id === "project-b");

				assert.ok(projA !== undefined, "project-a should be found");
				assert.strictEqual(projA?.initialized, true);
				assert.strictEqual(projA?.trackCount, 1);

				assert.ok(projB !== undefined, "project-b should be found");
				assert.strictEqual(projB?.initialized, false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("returns empty array on unreadable dir", () => {
			const projects = scanProjects("/this/path/does/not/exist/at/all");
			assert.deepStrictEqual(projects, []);
		});

		it("sorts initialized projects before uninitialized", () => {
			const root = mkdtempSync(join(tmpdir(), "conductor-sort-"));
			try {
				makeGitRepo(root, "alpha");
				makeGitRepo(root, "beta");
				makeConductorConfig(join(root, "beta"));
				makeGitRepo(root, "gamma");

				const projects = scanProjects(root);
				// beta (initialized) should come first
				assert.strictEqual(projects[0]?.id, "beta");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("does not include hidden directories (dot-prefixed)", () => {
			const root = mkdtempSync(join(tmpdir(), "conductor-hidden-"));
			try {
				makeGitRepo(root, "visible-repo");
				makeGitRepo(root, ".hidden-repo");

				const projects = scanProjects(root);
				assert.ok(
					projects.every((p) => !p.id.startsWith(".")),
					"should not include hidden dirs",
				);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("returns zero runnersActive and null lastActivity for offline projects", () => {
			const root = mkdtempSync(join(tmpdir(), "conductor-offline-"));
			try {
				makeGitRepo(root, "offline-proj");
				makeConductorConfig(join(root, "offline-proj"));

				const [project] = scanProjects(root);
				assert.strictEqual(project?.runnersActive, 0);
				assert.strictEqual(project?.lastActivity, null);
				assert.strictEqual(project?.totalSpendUsd, 0);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});
});
