/**
 * Tests for pauseTrack / isPaused / resumeTrack added in v2.3.
 *
 * pauseTrack writes a PAUSED marker file and isPaused reads it.
 * resumeTrack calls clearPauseMarker (private) before delegating to runTrack,
 * so after resumeTrack's synchronous path the marker is already gone even if
 * the swarm never starts (the track todo is empty).
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { trackDir } from "../src/config.js";
import { isPaused, pauseTrack, resumeTrack } from "../src/orchestrator.js";
import { initConductor } from "../src/track.js";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "conductor-pause-"));
}

// The private marker path mirrors what orchestrator.ts writes:
// .conductor/tracks/<id>/PAUSED
function pauseMarkerPath(id: string, cwd: string): string {
	return join(cwd, ".conductor", "tracks", id, "PAUSED");
}

describe("pauseTrack + isPaused", () => {
	it("isPaused returns false before pauseTrack is called", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			// Ensure track dir exists so the check is meaningful
			mkdirSync(join(dir, ".conductor", "tracks", "alpha"), { recursive: true });
			assert.strictEqual(isPaused("alpha", dir), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("pauseTrack writes a PAUSED marker file", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			mkdirSync(join(dir, ".conductor", "tracks", "beta"), { recursive: true });

			pauseTrack("beta", dir);

			assert.ok(
				existsSync(pauseMarkerPath("beta", dir)),
				"PAUSED file should exist after pauseTrack",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("isPaused returns true after pauseTrack", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			mkdirSync(join(dir, ".conductor", "tracks", "gamma"), { recursive: true });

			assert.strictEqual(isPaused("gamma", dir), false);
			pauseTrack("gamma", dir);
			assert.strictEqual(isPaused("gamma", dir), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("PAUSED file is written at the correct path under .conductor/tracks/<id>/PAUSED", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			mkdirSync(join(dir, ".conductor", "tracks", "delta"), { recursive: true });

			pauseTrack("delta", dir);

			const expected = join(dir, ".conductor", "tracks", "delta", "PAUSED");
			assert.ok(existsSync(expected), `Expected PAUSED at ${expected}`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("resumeTrack clears the pause marker", () => {
	it("isPaused returns false after resumeTrack clears the marker (empty track, no swarm run)", async () => {
		const dir = tmpDir();
		try {
			initConductor(dir);

			// Create the track directory structure manually so resumeTrack can find the track.
			// We use a real conductor config so that getTrack succeeds.
			const { createTrack } = await import("../src/track.js");
			createTrack("Echo", "Test track", [], dir);

			// Write an empty todo so runSwarm completes immediately without git requirements.
			const { trackTodoPath } = await import("../src/config.js");
			writeFileSync(trackTodoPath("echo", dir), "# No tasks\n");

			// Pause the track first.
			pauseTrack("echo", dir);
			assert.strictEqual(isPaused("echo", dir), true, "Should be paused before resume");

			// resumeTrack clears the marker synchronously before delegating to runSwarm.
			// With no pending tasks runSwarm returns immediately — we await the whole thing.
			try {
				await resumeTrack("echo", { cwd: dir });
			} catch {
				// runSwarm may throw if git is unavailable in the temp dir — that's fine.
				// The marker clearing happens before runSwarm is awaited.
			}

			assert.strictEqual(
				isPaused("echo", dir),
				false,
				"Pause marker should be cleared by resumeTrack",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
