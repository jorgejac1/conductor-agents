import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { trackContextPath, trackTodoPath } from "../src/config.js";
import { createTrack, deleteTrack, getTrack, initConductor, listTracks } from "../src/track.js";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "conductor-track-"));
}

describe("track", () => {
	it("createTrack creates directories and files", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			const t = createTrack("Auth Module", "Handles auth", ["src/auth/**"], dir);
			assert.strictEqual(t.id, "auth-module");
			assert.strictEqual(t.name, "Auth Module");
			assert.ok(existsSync(trackContextPath("auth-module", dir)));
			assert.ok(existsSync(trackTodoPath("auth-module", dir)));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("createTrack updates config with new track", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTrack("Payments", "Payment processing", ["src/payments/**"], dir);
			const t = getTrack("payments", dir);
			assert.strictEqual(t.name, "Payments");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("createTrack throws if track id already exists", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTrack("Auth", "First", [], dir);
			assert.throws(() => createTrack("Auth", "Second", [], dir), /already exists/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("deleteTrack removes directory and config entry", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTrack("Temp Feature", "Temporary", [], dir);
			const contextPath = trackContextPath("temp-feature", dir);
			assert.ok(existsSync(contextPath));

			deleteTrack("temp-feature", dir);
			assert.ok(!existsSync(contextPath));

			assert.throws(() => getTrack("temp-feature", dir), /not found/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("listTracks returns empty array when no tracks", async () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			const statuses = await listTracks(dir);
			assert.strictEqual(statuses.length, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("listTracks returns statuses with zero progress for new tracks", async () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTrack("Feature A", "A feature", [], dir);
			createTrack("Feature B", "B feature", [], dir);

			const statuses = await listTracks(dir);
			assert.strictEqual(statuses.length, 2);
			for (const s of statuses) {
				assert.strictEqual(s.todoTotal, 0);
				assert.strictEqual(s.todoDone, 0);
				assert.strictEqual(s.swarmState, null);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("getTrack throws when no config", () => {
		const dir = tmpDir();
		try {
			assert.throws(() => getTrack("anything", dir), /No conductor config/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("CONTEXT.md contains name, description, and files", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTrack("My Feature", "Does stuff", ["src/features/**", "src/utils/**"], dir);
			const content = readFileSync(trackContextPath("my-feature", dir), "utf8");
			assert.ok(content.includes("My Feature"));
			assert.ok(content.includes("Does stuff"));
			assert.ok(content.includes("src/features/**"));
			assert.ok(content.includes("src/utils/**"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
