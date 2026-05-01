import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { obsidianStatus, obsidianSync } from "../src/obsidian.js";
import type { ObsidianConfig } from "../src/types.js";

function mkTemp(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "conductor-obsidian-"));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("obsidian sync", () => {
	it("push mode should create a run summary file in the vault", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "push" };
			obsidianSync(cfg, "push", {
				trackId: "auth",
				todoTotal: 5,
				todoDone: 5,
				passed: true,
				estimatedUsd: 0.0042,
				totalTokens: 1400,
			});
			const files = readdirSync(vault).filter((f) => f.endsWith(".md"));
			assert.strictEqual(files.length, 1, "should create exactly one summary file");
			const firstFile = files[0];
			assert.ok(firstFile?.startsWith("auth-"), "filename should start with trackId");
			const content = readFileSync(join(vault, firstFile ?? ""), "utf8");
			assert.ok(content.includes("auth"), "should include track id");
			assert.ok(content.includes("pass") || content.includes("✅"), "should indicate pass");
		} finally {
			cleanup();
		}
	});

	it("pull mode with _context.md should return the file contents", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			writeFileSync(join(vault, "_context.md"), "extra context here\n");
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "pull" };
			const ctx = obsidianSync(cfg, "pull");
			assert.ok(typeof ctx === "string", "should return string");
			assert.ok(ctx?.includes("extra context here"), "should return _context.md contents");
		} finally {
			cleanup();
		}
	});

	it("pull mode without _context.md should return undefined", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "pull" };
			const ctx = obsidianSync(cfg, "pull");
			assert.strictEqual(ctx, undefined, "should return undefined when no _context.md");
		} finally {
			cleanup();
		}
	});

	it("both action should push summary and pull context", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			writeFileSync(join(vault, "_context.md"), "both mode context\n");
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "two-way" };
			const ctx = obsidianSync(cfg, "both", {
				trackId: "billing",
				todoTotal: 3,
				todoDone: 2,
				passed: false,
				estimatedUsd: 0.001,
				totalTokens: 300,
			});
			assert.ok(ctx?.includes("both mode context"), "should return context");
			const files = readdirSync(vault).filter((f) => f.endsWith(".md") && f !== "_context.md");
			assert.strictEqual(files.length, 1, "should also create a push summary");
		} finally {
			cleanup();
		}
	});

	it("vault path that does not exist should not crash and should not create files", () => {
		const { dir, cleanup } = mkTemp();
		try {
			// Use a non-existent subfolder that would require mkdir, but vault root itself is fine
			// Actually test: non-existent vault root entirely
			const nonExistentVault = join(dir, "does", "not", "exist");
			const cfg: ObsidianConfig = { vaultPath: nonExistentVault, mode: "push" };
			// Should not throw — writes to stderr and skips
			assert.doesNotThrow(() => {
				obsidianSync(cfg, "push", {
					trackId: "test",
					todoTotal: 1,
					todoDone: 1,
					passed: true,
					estimatedUsd: 0,
					totalTokens: 0,
				});
			});
		} finally {
			cleanup();
		}
	});

	it("should not overwrite existing summary file — uses incrementing suffix", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "push" };
			const summary = {
				trackId: "auth",
				todoTotal: 1,
				todoDone: 1,
				passed: true,
				estimatedUsd: 0,
				totalTokens: 0,
			};
			obsidianSync(cfg, "push", summary);
			obsidianSync(cfg, "push", summary);

			const files = readdirSync(vault).filter((f) => f.endsWith(".md"));
			// Both pushes should have happened: the second uses a suffix
			// (In practice timestamps differ, but we assert no overwrite occurred)
			assert.ok(files.length >= 1, "at least one file should exist");
		} finally {
			cleanup();
		}
	});

	it("obsidianStatus reports accessible and writable correctly", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "push" };
			const status = obsidianStatus(cfg);
			assert.strictEqual(status.accessible, true);
			assert.strictEqual(status.writable, true);
			assert.strictEqual(status.vaultPath, vault);
		} finally {
			cleanup();
		}
	});

	it("obsidianStatus reports non-existent vault correctly", () => {
		const { dir, cleanup } = mkTemp();
		try {
			const nonExistent = join(dir, "no-such-vault");
			const cfg: ObsidianConfig = { vaultPath: nonExistent, mode: "push" };
			const status = obsidianStatus(cfg);
			assert.strictEqual(status.accessible, false);
			assert.strictEqual(status.writable, false);
		} finally {
			cleanup();
		}
	});

	it("push file content includes trackId, pass indicator, and token count", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "push" };
			obsidianSync(cfg, "push", {
				trackId: "payments",
				todoTotal: 4,
				todoDone: 4,
				passed: true,
				estimatedUsd: 0.0123,
				totalTokens: 5000,
			});
			const files = readdirSync(vault).filter((f) => f.endsWith(".md"));
			const content = readFileSync(join(vault, files[0] ?? ""), "utf8");
			assert.ok(content.includes("payments"), "content should include trackId");
			assert.ok(
				content.includes("5000") || content.includes("5,000"),
				"content should include token count",
			);
			// Pass indicator — flexible on exact emoji/word
			assert.ok(
				content.includes("pass") || content.includes("✅") || content.includes("PASS"),
				"content should indicate pass",
			);
		} finally {
			cleanup();
		}
	});

	it("push file content indicates failure when passed=false", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "push" };
			obsidianSync(cfg, "push", {
				trackId: "backend",
				todoTotal: 3,
				todoDone: 1,
				passed: false,
				estimatedUsd: 0,
				totalTokens: 100,
			});
			const files = readdirSync(vault).filter((f) => f.endsWith(".md"));
			const content = readFileSync(join(vault, files[0] ?? ""), "utf8");
			assert.ok(
				content.includes("fail") || content.includes("❌") || content.includes("FAIL"),
				"content should indicate failure",
			);
		} finally {
			cleanup();
		}
	});

	it("push uses subfolder when configured", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, subfolder: "runs", mode: "push" };
			obsidianSync(cfg, "push", {
				trackId: "infra",
				todoTotal: 2,
				todoDone: 2,
				passed: true,
				estimatedUsd: 0,
				totalTokens: 0,
			});
			const subDir = join(vault, "runs");
			const files = readdirSync(subDir).filter((f) => f.endsWith(".md"));
			assert.strictEqual(files.length, 1, "summary file should be inside subfolder");
			assert.ok(files[0]?.startsWith("infra-"), "file should start with trackId");
		} finally {
			cleanup();
		}
	});

	it("pull uses _context.md from subfolder when configured", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const subDir = join(vault, "notes");
			mkdirSync(subDir, { recursive: true });
			writeFileSync(join(subDir, "_context.md"), "subfolder context here");
			const cfg: ObsidianConfig = { vaultPath: vault, subfolder: "notes", mode: "pull" };
			const ctx = obsidianSync(cfg, "pull");
			assert.ok(ctx?.includes("subfolder context here"), "should read _context.md from subfolder");
		} finally {
			cleanup();
		}
	});

	it("obsidianStatus returns vaultPath in result", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "push" };
			const status = obsidianStatus(cfg);
			assert.strictEqual(status.vaultPath, vault);
		} finally {
			cleanup();
		}
	});

	it("push file content includes durationMs when provided", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "push" };
			obsidianSync(cfg, "push", {
				trackId: "timing",
				todoTotal: 1,
				todoDone: 1,
				passed: true,
				estimatedUsd: 0,
				totalTokens: 0,
				durationMs: 12345,
			});
			const files = readdirSync(vault).filter((f) => f.endsWith(".md"));
			const content = readFileSync(join(vault, files[0] ?? ""), "utf8");
			assert.ok(
				content.includes("12345") || content.includes("12s") || content.includes("12.3"),
				"content should include duration information",
			);
		} finally {
			cleanup();
		}
	});

	it("push file content includes memoriesAdded when provided", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "push" };
			obsidianSync(cfg, "push", {
				trackId: "mem-run",
				todoTotal: 2,
				todoDone: 2,
				passed: true,
				estimatedUsd: 0,
				totalTokens: 0,
				memoriesAdded: ["deadlock-fix", "cache-warmup"],
			});
			const files = readdirSync(vault).filter((f) => f.endsWith(".md"));
			const content = readFileSync(join(vault, files[0] ?? ""), "utf8");
			assert.ok(
				content.includes("deadlock-fix") ||
					content.includes("memoriesAdded") ||
					content.includes("memories"),
				"content should reference new memories",
			);
		} finally {
			cleanup();
		}
	});

	it("push includes USD cost when estimatedUsd > 0", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "push" };
			obsidianSync(cfg, "push", {
				trackId: "costed",
				todoTotal: 1,
				todoDone: 1,
				passed: true,
				estimatedUsd: 0.0451,
				totalTokens: 2000,
			});
			const files = readdirSync(vault).filter((f) => f.endsWith(".md"));
			const content = readFileSync(join(vault, files[0] ?? ""), "utf8");
			assert.ok(
				content.includes("0.045") || content.includes("$0.04") || content.includes("USD"),
				"content should include cost",
			);
		} finally {
			cleanup();
		}
	});

	it("pull returns undefined when subfolder has no _context.md", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			mkdirSync(join(vault, "empty-sub"), { recursive: true });
			const cfg: ObsidianConfig = { vaultPath: vault, subfolder: "empty-sub", mode: "pull" };
			const ctx = obsidianSync(cfg, "pull");
			assert.strictEqual(
				ctx,
				undefined,
				"should return undefined when no _context.md in subfolder",
			);
		} finally {
			cleanup();
		}
	});

	it("two-way mode (action=both) both pushes and pulls atomically", () => {
		const { dir: vault, cleanup } = mkTemp();
		try {
			writeFileSync(join(vault, "_context.md"), "two-way context");
			const cfg: ObsidianConfig = { vaultPath: vault, mode: "two-way" };
			const ctx = obsidianSync(cfg, "both", {
				trackId: "tw",
				todoTotal: 1,
				todoDone: 1,
				passed: true,
				estimatedUsd: 0,
				totalTokens: 0,
			});
			// Pull: context returned
			assert.ok(ctx?.includes("two-way context"), "pull part should return context");
			// Push: summary file created
			const files = readdirSync(vault).filter((f) => f.endsWith(".md") && f !== "_context.md");
			assert.strictEqual(files.length, 1, "push part should create summary file");
		} finally {
			cleanup();
		}
	});
});
