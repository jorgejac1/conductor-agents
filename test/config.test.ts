import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { configPath, loadConfig, saveConfig } from "../src/config.js";

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
});
