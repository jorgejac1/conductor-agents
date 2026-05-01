import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { configPath, loadConfig, saveConfig, validateConfig } from "../src/config.js";

describe("config", () => {
	it("returns null when config file does not exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "conductor-test-"));
		try {
			const result = loadConfig(dir);
			assert.strictEqual(result, null);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("round-trips config through save + load", () => {
		const dir = mkdtempSync(join(tmpdir(), "conductor-test-"));
		try {
			const config = {
				tracks: [{ id: "auth", name: "Auth", description: "Auth module", files: ["src/auth/**"] }],
				defaults: { concurrency: 3, agentCmd: "claude" },
			};
			saveConfig(config, dir);
			const loaded = loadConfig(dir);
			assert.deepStrictEqual(loaded, config);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("configPath points inside .conductor/", () => {
		const p = configPath("/some/project");
		assert.ok(p.includes(".conductor"));
		assert.ok(p.endsWith("config.json"));
	});

	it("validateConfig accepts agentArgs on a track", () => {
		const cfg = {
			tracks: [
				{
					id: "auth",
					name: "Auth",
					description: "Auth module",
					files: [],
					agentArgs: ["--full-auto", "{task}"],
				},
			],
			defaults: { concurrency: 3, agentCmd: "claude" },
		};
		assert.doesNotThrow(() => validateConfig(cfg));
	});

	it("validateConfig accepts agentArgs on defaults", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 3, agentCmd: "codex", agentArgs: ["--prompt", "{task}"] },
		};
		assert.doesNotThrow(() => validateConfig(cfg));
	});

	it("validateConfig rejects non-array agentArgs on a track", () => {
		const cfg = {
			tracks: [
				{ id: "auth", name: "Auth", description: "", files: [], agentArgs: "--not-an-array" },
			],
			defaults: { concurrency: 3, agentCmd: "claude" },
		};
		assert.throws(() => validateConfig(cfg), /agentArgs: must be an array of strings/);
	});

	it("validateConfig rejects non-array agentArgs on defaults", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 3, agentCmd: "claude", agentArgs: 42 },
		};
		assert.throws(() => validateConfig(cfg), /agentArgs: must be an array of strings/);
	});

	// ─── v2.1: dependsOn field ───────────────────────────────────────────────────

	it("validateConfig accepts valid dependsOn array on a track", () => {
		const cfg = {
			tracks: [
				{ id: "auth", name: "Auth", description: "", files: [] },
				{ id: "payments", name: "Payments", description: "", files: [], dependsOn: ["auth"] },
			],
			defaults: { concurrency: 2, agentCmd: "claude" },
		};
		assert.doesNotThrow(() => validateConfig(cfg));
	});

	it("validateConfig rejects non-array dependsOn", () => {
		const cfg = {
			tracks: [
				{ id: "auth", name: "Auth", description: "", files: [] },
				{ id: "payments", name: "Payments", description: "", files: [], dependsOn: "auth" },
			],
			defaults: { concurrency: 2, agentCmd: "claude" },
		};
		assert.throws(() => validateConfig(cfg), /dependsOn: must be an array of strings/);
	});

	it("validateConfig rejects dependsOn with non-string elements", () => {
		const cfg = {
			tracks: [
				{ id: "auth", name: "Auth", description: "", files: [] },
				{ id: "payments", name: "Payments", description: "", files: [], dependsOn: [123] },
			],
			defaults: { concurrency: 2, agentCmd: "claude" },
		};
		assert.throws(() => validateConfig(cfg), /dependsOn: must be an array of strings/);
	});

	it("validateConfig rejects dependsOn referencing unknown track id", () => {
		const cfg = {
			tracks: [
				{ id: "auth", name: "Auth", description: "", files: [] },
				{
					id: "payments",
					name: "Payments",
					description: "",
					files: [],
					dependsOn: ["nonexistent"],
				},
			],
			defaults: { concurrency: 2, agentCmd: "claude" },
		};
		assert.throws(() => validateConfig(cfg), /references unknown track id/);
	});

	it("round-trips config with dependsOn through save + load", () => {
		const dir = mkdtempSync(join(tmpdir(), "conductor-test-"));
		try {
			const config = {
				tracks: [
					{ id: "infra", name: "Infra", description: "", files: [] },
					{ id: "app", name: "App", description: "", files: [], dependsOn: ["infra"] },
					{
						id: "tests",
						name: "Tests",
						description: "",
						files: [],
						dependsOn: ["app", "infra"],
					},
				],
				defaults: { concurrency: 2, agentCmd: "claude" },
			};
			saveConfig(config, dir);
			const loaded = loadConfig(dir);
			const app = loaded?.tracks.find((t) => t.id === "app");
			const tests = loaded?.tracks.find((t) => t.id === "tests");
			assert.deepStrictEqual(app?.dependsOn, ["infra"]);
			assert.deepStrictEqual(tests?.dependsOn, ["app", "infra"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("overwrites existing config on second save", () => {
		const dir = mkdtempSync(join(tmpdir(), "conductor-test-"));
		try {
			const config1 = {
				tracks: [],
				defaults: { concurrency: 3, agentCmd: "claude" },
			};
			saveConfig(config1, dir);

			const config2 = {
				tracks: [{ id: "backend", name: "Backend", description: "Backend", files: [] }],
				defaults: { concurrency: 5, agentCmd: "codex" },
			};
			saveConfig(config2, dir);

			const loaded = loadConfig(dir);
			assert.strictEqual(loaded?.defaults.concurrency, 5);
			assert.strictEqual(loaded?.tracks.length, 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// ── v3.2: obsidian + memoryBudgetBytes ───────────────────────────────────

	it("validateConfig accepts valid obsidian config with mode push", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude" },
			obsidian: { vaultPath: "/tmp/vault", mode: "push" },
		};
		assert.doesNotThrow(() => validateConfig(cfg));
	});

	it("validateConfig accepts obsidian mode pull", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude" },
			obsidian: { vaultPath: "/tmp/vault", mode: "pull" },
		};
		assert.doesNotThrow(() => validateConfig(cfg));
	});

	it("validateConfig accepts obsidian mode two-way", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude" },
			obsidian: { vaultPath: "/tmp/vault", mode: "two-way" },
		};
		assert.doesNotThrow(() => validateConfig(cfg));
	});

	it("validateConfig accepts obsidian with optional subfolder", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude" },
			obsidian: { vaultPath: "/tmp/vault", subfolder: "conductor", mode: "push" },
		};
		assert.doesNotThrow(() => validateConfig(cfg));
	});

	it("validateConfig rejects obsidian with invalid mode", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude" },
			obsidian: { vaultPath: "/tmp/vault", mode: "invalid-mode" },
		};
		assert.throws(() => validateConfig(cfg), /mode.*push.*pull.*two-way/i);
	});

	it("validateConfig rejects obsidian without vaultPath", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude" },
			obsidian: { mode: "push" },
		};
		assert.throws(() => validateConfig(cfg), /vaultPath/i);
	});

	it("validateConfig rejects obsidian with non-string vaultPath", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude" },
			obsidian: { vaultPath: 123, mode: "push" },
		};
		assert.throws(() => validateConfig(cfg), /vaultPath/i);
	});

	it("validateConfig rejects obsidian with non-string subfolder", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude" },
			obsidian: { vaultPath: "/tmp/v", subfolder: 99, mode: "push" },
		};
		assert.throws(() => validateConfig(cfg), /subfolder/i);
	});

	it("validateConfig rejects obsidian that is not an object", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude" },
			obsidian: "not-an-object",
		};
		assert.throws(() => validateConfig(cfg), /obsidian/i);
	});

	it("validateConfig accepts defaults.memoryBudgetBytes as a number", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude", memoryBudgetBytes: 4096 },
		};
		assert.doesNotThrow(() => validateConfig(cfg));
	});

	it("validateConfig rejects defaults.memoryBudgetBytes when not a number", () => {
		const cfg = {
			tracks: [],
			defaults: { concurrency: 1, agentCmd: "claude", memoryBudgetBytes: "4096" },
		};
		assert.throws(() => validateConfig(cfg), /memoryBudgetBytes/i);
	});

	it("round-trips obsidian config through save + load", () => {
		const dir = mkdtempSync(join(tmpdir(), "conductor-test-"));
		try {
			const config = {
				tracks: [],
				defaults: { concurrency: 1, agentCmd: "claude" },
				obsidian: { vaultPath: "/Users/me/vault", subfolder: "work", mode: "two-way" as const },
			};
			saveConfig(config, dir);
			const loaded = loadConfig(dir);
			assert.deepStrictEqual(loaded?.obsidian, config.obsidian);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
