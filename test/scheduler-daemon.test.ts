/**
 * Tests for the scheduler daemon's missed-fire replay logic.
 *
 * These are pure logic tests — no actual daemon process is spawned and no
 * real agent is invoked. We exercise computeMissedFires + replayMissed in
 * the same way the daemon's startup path does, using a seeded DB state to
 * simulate a stale last_fired_at.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { nextFireMs, parseCron } from "evalgate";
import type { ReplayPolicy } from "../src/scheduler.js";
import {
	computeMissedFires,
	getTrackState,
	openSchedulerDb,
	replayMissed,
	updateTrackState,
} from "../src/scheduler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sched-daemon-"));
	mkdirSync(join(dir, ".conductor"), { recursive: true });
	return dir;
}

// A simple mock runner that records every call without spawning real agents.
function makeMockRunner(): {
	runner: (trackId: string, scheduledFor: string) => Promise<"success" | "failure">;
	calls: Array<{ trackId: string; scheduledFor: string }>;
} {
	const calls: Array<{ trackId: string; scheduledFor: string }> = [];
	const runner = async (trackId: string, scheduledFor: string): Promise<"success" | "failure"> => {
		calls.push({ trackId, scheduledFor });
		return "success";
	};
	return { runner, calls };
}

// ---------------------------------------------------------------------------
// Daemon startup scenario: stale last_fired_at
// ---------------------------------------------------------------------------

describe("daemon startup — computeMissedFires with stale last_fired_at", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = makeTmpDir();
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should return 2 missed fires when last_fired_at is 2 hours ago with hourly cron", () => {
		// Simulate: daemon was last alive 2 hours ago
		const hourlyExpr = parseCron("0 * * * *");
		const lastFiredAt = new Date("2025-06-15T10:00:00.000Z");
		// now = exactly 2 hours later; both 11:00 and 12:00 slots were missed
		const now = new Date("2025-06-15T12:00:00.000Z");

		const missed = computeMissedFires(lastFiredAt.toISOString(), now, hourlyExpr, nextFireMs);

		assert.equal(missed.length, 2, `expected 2 missed fires, got ${missed.length}`);
		assert.equal(
			missed[0]?.toISOString(),
			"2025-06-15T11:00:00.000Z",
			"first missed slot should be T+1h",
		);
		assert.equal(
			missed[1]?.toISOString(),
			"2025-06-15T12:00:00.000Z",
			"second missed slot should be T+2h",
		);
	});

	it("should return empty array when last_fired_at matches the last expected fire (nothing missed)", () => {
		// The daemon fired at 12:00:00. now = 12:45:00. No full hourly slot has elapsed.
		const hourlyExpr = parseCron("0 * * * *");
		const lastFiredAt = new Date("2025-06-15T12:00:00.000Z");
		const now = new Date("2025-06-15T12:45:00.000Z");

		const missed = computeMissedFires(lastFiredAt.toISOString(), now, hourlyExpr, nextFireMs);

		assert.equal(
			missed.length,
			0,
			"no missed fires when daemon last fired less than one interval ago",
		);
	});

	it("should use DB-persisted last_fired_at to compute missed fires", () => {
		// Verify the DB round-trip: persist state then read it back and feed into computeMissedFires
		const db = openSchedulerDb(tmpDir);
		try {
			const cronExpr = "0 * * * *";
			const lastFiredAt = "2025-06-15T08:00:00.000Z";
			const nextFireAt = "2025-06-15T09:00:00.000Z";

			updateTrackState(db, "auth", cronExpr, lastFiredAt, nextFireAt, true);

			const state = getTrackState(db, "auth");
			assert.ok(state !== null, "state must exist after updateTrackState");

			// Simulate: daemon restarts at 11:00 — two slots (09:00, 10:00, 11:00) were missed
			const now = new Date("2025-06-15T11:00:00.000Z");
			const hourlyExpr = parseCron(state.cron_expr);
			const missed = computeMissedFires(state.last_fired_at, now, hourlyExpr, nextFireMs);

			assert.equal(missed.length, 3, "three hourly slots should be missed between 08:00 and 11:00");
		} finally {
			db.close();
		}
	});
});

// ---------------------------------------------------------------------------
// Daemon startup scenario: replayMissed with collapse policy
// ---------------------------------------------------------------------------

describe("daemon startup — replayMissed collapse policy with 2 missed fires", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = makeTmpDir();
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should call runner exactly once (most recent slot) when 2 fires are missed", async () => {
		const db = openSchedulerDb(tmpDir);
		try {
			const { runner, calls } = makeMockRunner();

			const missed = [new Date("2025-06-15T11:00:00.000Z"), new Date("2025-06-15T12:00:00.000Z")];

			await replayMissed(db, "auth", missed, "collapse" satisfies ReplayPolicy, runner);

			assert.equal(calls.length, 1, "runner should be called exactly once under collapse policy");
			assert.equal(
				calls[0]?.scheduledFor,
				"2025-06-15T12:00:00.000Z",
				"runner should be called with the most recent missed slot",
			);
		} finally {
			db.close();
		}
	});

	it("should record the earlier slot as replayed-skipped and the later slot with runner result", async () => {
		const db = openSchedulerDb(tmpDir);
		try {
			const { runner } = makeMockRunner();

			const missed = [new Date("2025-06-15T11:00:00.000Z"), new Date("2025-06-15T12:00:00.000Z")];

			await replayMissed(db, "auth-records", missed, "collapse" satisfies ReplayPolicy, runner);

			const rows = db
				.prepare(
					"SELECT scheduled_for, result FROM schedule_runs WHERE track_id = ? ORDER BY scheduled_for ASC",
				)
				.all("auth-records") as Array<{ scheduled_for: string; result: string }>;

			assert.equal(rows.length, 2);
			assert.equal(rows[0]?.result, "replayed-skipped", "earlier slot should be replayed-skipped");
			assert.equal(
				rows[1]?.result,
				"success",
				"most recent slot should be recorded with runner result",
			);
		} finally {
			db.close();
		}
	});
});

// ---------------------------------------------------------------------------
// End-to-end daemon restart scenario
// ---------------------------------------------------------------------------

describe("daemon restart end-to-end scenario", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = makeTmpDir();
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should replay missed fires using DB state — full simulate of daemon startup path", async () => {
		const db = openSchedulerDb(tmpDir);
		try {
			const cronStr = "0 * * * *";
			// Persist a state that was last fired 3 hours ago
			const lastFiredAt = "2025-06-15T09:00:00.000Z";
			const nextFireAt = "2025-06-15T10:00:00.000Z";
			updateTrackState(db, "daemon-track", cronStr, lastFiredAt, nextFireAt, true);

			// Daemon restarts at 12:00 — simulate the startup path
			const now = new Date("2025-06-15T12:00:00.000Z");
			const state = getTrackState(db, "daemon-track");
			assert.ok(state !== null);

			const cronExpr = parseCron(state.cron_expr);
			const missed = computeMissedFires(state.last_fired_at, now, cronExpr, nextFireMs);

			// 10:00, 11:00, 12:00 → 3 missed slots
			assert.equal(missed.length, 3, "should detect 3 missed slots");

			const { runner, calls } = makeMockRunner();
			await replayMissed(db, "daemon-track", missed, "collapse" satisfies ReplayPolicy, runner);

			// Under collapse: only the most recent (12:00) runs
			assert.equal(calls.length, 1, "collapse policy should run only once");
			// biome-ignore lint/style/noNonNullAssertion: length asserted above
			assert.equal(calls[0]!.scheduledFor, "2025-06-15T12:00:00.000Z");

			// Verify audit log
			const runCount = (
				db
					.prepare("SELECT COUNT(*) as cnt FROM schedule_runs WHERE track_id = ?")
					.get("daemon-track") as { cnt: number }
			).cnt;
			assert.equal(runCount, 3, "all 3 missed slots should be recorded in schedule_runs");
		} finally {
			db.close();
		}
	});

	it("should produce zero calls and zero DB rows when nothing was missed", async () => {
		const db = openSchedulerDb(tmpDir);
		try {
			const cronStr = "0 * * * *";
			// last fired at 12:00, daemon restarts at 12:30 — nothing missed
			const lastFiredAt = "2025-06-15T12:00:00.000Z";
			updateTrackState(
				db,
				"nodaemon-track",
				cronStr,
				lastFiredAt,
				"2025-06-15T13:00:00.000Z",
				true,
			);

			const now = new Date("2025-06-15T12:30:00.000Z");
			const state = getTrackState(db, "nodaemon-track");
			assert.ok(state !== null);

			const cronExpr = parseCron(state.cron_expr);
			const missed = computeMissedFires(state.last_fired_at, now, cronExpr, nextFireMs);

			assert.equal(missed.length, 0);

			const { runner, calls } = makeMockRunner();
			await replayMissed(db, "nodaemon-track", missed, "all" satisfies ReplayPolicy, runner);

			assert.equal(calls.length, 0, "runner should not be called when nothing was missed");

			const runCount = (
				db
					.prepare("SELECT COUNT(*) as cnt FROM schedule_runs WHERE track_id = ?")
					.get("nodaemon-track") as { cnt: number }
			).cnt;
			assert.equal(runCount, 0, "no rows should be inserted when nothing was missed");
		} finally {
			db.close();
		}
	});
});
