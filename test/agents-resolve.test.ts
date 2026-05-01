import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolvePlugin } from "../src/agents/index.js";
import { initConductor } from "../src/track.js";

function mkTemp(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "conductor-resolve-"));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("resolvePlugin", () => {
	it("should return the claude built-in for 'claude'", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const plugin = await resolvePlugin(dir, "claude");
			assert.strictEqual(plugin.id, "claude");
		} finally {
			cleanup();
		}
	});

	it("should match by basename for full paths", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const plugin = await resolvePlugin(dir, "/usr/local/bin/aider");
			assert.strictEqual(plugin.id, "aider");
		} finally {
			cleanup();
		}
	});

	it("should match first token for commands with flags", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const plugin = await resolvePlugin(dir, "claude --dangerously-skip-permissions");
			assert.strictEqual(plugin.id, "claude");
		} finally {
			cleanup();
		}
	});

	it("should return generic plugin for unknown agent names", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const p = await resolvePlugin(dir, "totally-unknown-agent");
			assert.ok(p.id.startsWith("generic"), "should be a generic plugin variant");
		} finally {
			cleanup();
		}
	});

	it("should load a custom plugin from .conductor/plugins/<name>.js", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const pluginsDir = join(dir, ".conductor", "plugins");
			mkdirSync(pluginsDir, { recursive: true });
			writeFileSync(
				join(pluginsDir, "myagent.js"),
				`export default {
					id: "myagent",
					defaultCmd: "myagent",
					defaultArgs: () => ["{task}"],
					parseUsage: (log) => {
						if (log.includes("tokens=")) {
							const m = log.match(/tokens=(\\d+)/);
							if (m) return { inputTokens: parseInt(m[1]), outputTokens: 0 };
						}
						return null;
					},
				};`,
			);
			const plugin = await resolvePlugin(dir, "myagent");
			assert.strictEqual(plugin.id, "myagent");
			const usage = plugin.parseUsage("tokens=999", "");
			assert.ok(usage !== null);
			assert.strictEqual(usage.inputTokens, 999);
		} finally {
			cleanup();
		}
	});

	it("should prefer custom plugin over built-in when names collide", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const pluginsDir = join(dir, ".conductor", "plugins");
			mkdirSync(pluginsDir, { recursive: true });
			// Override the claude built-in with a custom version
			writeFileSync(
				join(pluginsDir, "claude.js"),
				`export default {
					id: "claude-custom",
					defaultCmd: "claude",
					defaultArgs: () => ["{task}"],
					parseUsage: () => ({ inputTokens: 42, outputTokens: 0 }),
				};`,
			);
			const plugin = await resolvePlugin(dir, "claude");
			assert.strictEqual(plugin.id, "claude-custom", "custom plugin should win over built-in");
		} finally {
			cleanup();
		}
	});

	it("should fall back to generic when custom plugin exports neither default nor plugin", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const pluginsDir = join(dir, ".conductor", "plugins");
			mkdirSync(pluginsDir, { recursive: true });
			writeFileSync(join(pluginsDir, "badagent.js"), `export const foo = "bar";`);
			const plugin = await resolvePlugin(dir, "badagent");
			assert.ok(plugin.id.startsWith("generic"), "should fall back to a generic plugin");
		} finally {
			cleanup();
		}
	});

	it("should fall back to generic when custom plugin file throws on import", async () => {
		const { dir, cleanup } = mkTemp();
		try {
			initConductor(dir);
			const pluginsDir = join(dir, ".conductor", "plugins");
			mkdirSync(pluginsDir, { recursive: true });
			writeFileSync(join(pluginsDir, "crashagent.js"), `throw new Error("intentional crash");`);
			const plugin = await resolvePlugin(dir, "crashagent");
			assert.ok(
				plugin.id.startsWith("generic"),
				"should fall back to a generic plugin on import error",
			);
		} finally {
			cleanup();
		}
	});
});
