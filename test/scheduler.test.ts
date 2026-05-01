/**
 * Tests for src/scheduler.ts
 *
 * Covers:
 *   - openSchedulerDb: creates scheduler.db, schema is idempotent
 *   - computeMissedFires: null lastFiredAt, hourly gap, sub-interval gap, 1000-cap
 *   - replayMissed: skip / collapse / all policies
 *   - recordFire + getTrackState round-trip
 *   - updateTrackState upsert
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { nextFireMs, parseCron } from "evalgate";
import type { ReplayPolicy } from "../src/scheduler.js";
import {
	computeMissedFires,
	getTrackState,
	openSchedulerDb,
	recordFire,
	replayMissed,
	schedulerDbPath,
	updateTrackState,
} from "../src/scheduler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sched-"));
	// Create .conductor/ dir so openSchedulerDb can write its file there
	mkdirSync(join(dir, ".conductor"), { recursive: true });
	return dir;
}

// ---------------------------------------------------------------------------
// openSchedulerDb
// ---------------------------------------------------------------------------

describe("openSchedulerDb", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = makeTmpDir();
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should create scheduler.db inside .conductor/", () => {
		const db = openSchedulerDb(tmpDir);
		db.close();
		const expectedPath = schedulerDbPath(tmpDir);
		assert.ok(existsSync(expectedPath), `scheduler.db should exist at ${expectedPath}`);
	});

	it("should be idempotent — calling twice does not throw", () => {
		assert.doesNotThrow(() => {
			const db1 = openSchedulerDb(tmpDir);
			db1.close();
			const db2 = openSchedulerDb(tmpDir);
			db2.close();
		});
	});

	it("should create schedule_state and schedule_runs tables", () => {
		const db = openSchedulerDb(tmpDir);
		try {
			// If tables don't exist these queries throw — absence of throw = pass
			const stateRows = db.prepare("SELECT * FROM schedule_state LIMIT 1").all();
			const runRows = db.prepare("SELECT * FROM schedule_runs LIMIT 1").all();
			assert.ok(Array.isArray(stateRows));
			assert.ok(Array.isArray(runRows));
		} finally {
			db.close();
		}
	});
});

// ---------------------------------------------------------------------------
// computeMissedFires
// ---------------------------------------------------------------------------

describe("computeMissedFires", () => {
	const hourlyExpr = parseCron("0 * * * *"); // fires at the top of every hour

	it("should return empty array when lastFiredAt is null", () => {
		const now = new Date("2025-06-15T12:00:00.000Z");
		const missed = computeMissedFires(null, now, hourlyExpr, nextFireMs);
		assert.deepEqual(missed, []);
	});

	it("should return exactly 26 dates for a 26-hour gap with an hourly cron", () => {
		// lastFiredAt = midnight; now = 26 hours later
		// The cron fires at 01:00, 02:00, …, 26:00 — that's 26 slots strictly after
		// lastFiredAt and at-or-before now.
		const lastFiredAt = new Date("2025-06-15T00:00:00.000Z");
		const now = new Date(lastFiredAt.getTime() + 26 * 60 * 60 * 1000);

		const missed = computeMissedFires(lastFiredAt.toISOString(), now, hourlyExpr, nextFireMs);

		assert.equal(missed.length, 26, `expected 26 missed fires, got ${missed.length}`);
	});

	it("should return dates in chronological order", () => {
		const lastFiredAt = new Date("2025-06-15T00:00:00.000Z");
		const now = new Date(lastFiredAt.getTime() + 5 * 60 * 60 * 1000);

		const missed = computeMissedFires(lastFiredAt.toISOString(), now, hourlyExpr, nextFireMs);

		for (let i = 1; i < missed.length; i++) {
			assert.ok(
				(missed[i]?.getTime() ?? 0) > (missed[i - 1]?.getTime() ?? -1),
				"missed fires must be in ascending order",
			);
		}
	});

	it("should return empty array when gap is smaller than one interval", () => {
		// lastFiredAt = 30 minutes ago; now = just now — less than one hour, no hourly slot missed
		const lastFiredAt = new Date("2025-06-15T12:30:00.000Z");
		const now = new Date("2025-06-15T12:59:00.000Z"); // 29 minutes later, no full hour passed

		const missed = computeMissedFires(lastFiredAt.toISOString(), now, hourlyExpr, nextFireMs);

		assert.equal(missed.length, 0);
	});

	it("should cap at 1000 iterations and not infinite-loop", () => {
		// Use a per-minute cron and a very large window to guarantee >1000 potential slots
		const perMinuteExpr = parseCron("* * * * *");
		const lastFiredAt = new Date("2020-01-01T00:00:00.000Z");
		const now = new Date("2025-01-01T00:00:00.000Z"); // 5 years → millions of minutes

		const missed = computeMissedFires(lastFiredAt.toISOString(), now, perMinuteExpr, nextFireMs);

		assert.ok(missed.length <= 1000, `should be capped at 1000, got ${missed.length}`);
		assert.equal(missed.length, 1000, "should return exactly 1000 entries when cap is hit");
	});

	it("should return the correct slot dates — first missed slot is one hour after lastFiredAt", () => {
		// lastFiredAt = 2025-06-15T10:00Z (on the hour), now = T+2h
		const lastFiredAt = new Date("2025-06-15T10:00:00.000Z");
		const now = new Date("2025-06-15T12:00:00.000Z");

		const missed = computeMissedFires(lastFiredAt.toISOString(), now, hourlyExpr, nextFireMs);

		assert.equal(missed.length, 2);
		assert.equal(missed[0]?.toISOString(), "2025-06-15T11:00:00.000Z");
		assert.equal(missed[1]?.toISOString(), "2025-06-15T12:00:00.000Z");
	});
});

// ---------------------------------------------------------------------------
// replayMissed — policy tests
// ---------------------------------------------------------------------------

describe("replayMissed — skip policy", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = makeTmpDir();
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should never call the runner and record all slots as 'skipped'", async () => {
		const db = openSchedulerDb(tmpDir);
		try {
			let runnerCallCount = 0;
			const runner = async (
				_trackId: string,
				_scheduledFor: string,
			): Promise<"success" | "failure"> => {
				runnerCallCount++;
				return "success";
			};

			const missed = [
				new Date("2025-06-15T10:00:00.000Z"),
				new Date("2025-06-15T11:00:00.000Z"),
				new Date("2025-06-15T12:00:00.000Z"),
			];

			await replayMissed(db, "auth", missed, "skip" satisfies ReplayPolicy, runner);

			assert.equal(runnerCallCount, 0, "runner should not be called for skip policy");

			const runs = db
				.prepare("SELECT result FROM schedule_runs WHERE track_id = ? ORDER BY scheduled_for ASC")
				.all("auth") as Array<{ result: string }>;

			assert.equal(runs.length, 3);
			assert.ok(
				runs.every((r) => r.result === "skipped"),
				"all entries should be 'skipped'",
			);
		} finally {
			db.close();
		}
	});
});

describe("replayMissed — collapse policy", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = makeTmpDir();
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should call runner exactly once (last slot) and mark the rest as 'replayed-skipped'", async () => {
		const db = openSchedulerDb(tmpDir);
		try {
			const calledWith: string[] = [];
			const runner = async (
				_trackId: string,
				scheduledFor: string,
			): Promise<"success" | "failure"> => {
				calledWith.push(scheduledFor);
				return "success";
			};

			const missed = [
				new Date("2025-06-15T10:00:00.000Z"),
				new Date("2025-06-15T11:00:00.000Z"),
				new Date("2025-06-15T12:00:00.000Z"),
			];

			await replayMissed(db, "auth-collapse", missed, "collapse" satisfies ReplayPolicy, runner);

			assert.equal(calledWith.length, 1, "runner should be called exactly once");
			// The runner must be called with the LAST (most recent) slot
			assert.equal(calledWith[0], "2025-06-15T12:00:00.000Z");

			const runs = db
				.prepare(
					"SELECT scheduled_for, result FROM schedule_runs WHERE track_id = ? ORDER BY scheduled_for ASC",
				)
				.all("auth-collapse") as Array<{ scheduled_for: string; result: string }>;

			assert.equal(runs.length, 3);
			assert.equal(runs[0]?.result, "replayed-skipped");
			assert.equal(runs[1]?.result, "replayed-skipped");
			assert.equal(runs[2]?.result, "success");
		} finally {
			db.close();
		}
	});
});

describe("replayMissed — all policy", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = makeTmpDir();
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should call runner once per missed slot in chronological order", async () => {
		const db = openSchedulerDb(tmpDir);
		try {
			const callOrder: string[] = [];
			const runner = async (
				_trackId: string,
				scheduledFor: string,
			): Promise<"success" | "failure"> => {
				callOrder.push(scheduledFor);
				return "success";
			};

			// Provide slots out of order to verify sorting
			const missed = [
				new Date("2025-06-15T12:00:00.000Z"),
				new Date("2025-06-15T10:00:00.000Z"),
				new Date("2025-06-15T11:00:00.000Z"),
			];

			await replayMissed(db, "auth-all", missed, "all" satisfies ReplayPolicy, runner);

			assert.equal(callOrder.length, 3, "runner should be called 3 times");
			assert.equal(callOrder[0], "2025-06-15T10:00:00.000Z", "first call should be earliest slot");
			assert.equal(callOrder[1], "2025-06-15T11:00:00.000Z");
			assert.equal(callOrder[2], "2025-06-15T12:00:00.000Z");

			const runs = db
				.prepare("SELECT result FROM schedule_runs WHERE track_id = ? ORDER BY scheduled_for ASC")
				.all("auth-all") as Array<{ result: string }>;

			assert.equal(runs.length, 3);
			assert.ok(
				runs.every((r) => r.result === "success"),
				"all entries should be 'success'",
			);
		} finally {
			db.close();
		}
	});

	it("should do nothing when missed array is empty", async () => {
		const db = openSchedulerDb(tmpDir);
		try {
			let called = false;
			const runner = async (): Promise<"success" | "failure"> => {
				called = true;
				return "success";
			};

			await replayMissed(db, "auth-empty", [], "all" satisfies ReplayPolicy, runner);
			assert.equal(called, false, "runner should not be called for empty missed list");
		} finally {
			db.close();
		}
	});
});

// ---------------------------------------------------------------------------
// recordFire + getTrackState round-trip
// ---------------------------------------------------------------------------

describe("recordFire + getTrackState", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = makeTmpDir();
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should reflect updateTrackState values via getTrackState", () => {
		const db = openSchedulerDb(tmpDir);
		try {
			const cronExpr = "0 * * * *";
			const lastFiredAt = "2025-06-15T10:00:00.000Z";
			const nextFireAt = "2025-06-15T11:00:00.000Z";

			updateTrackState(db, "auth", cronExpr, lastFiredAt, nextFireAt, true);

			const state = getTrackState(db, "auth");
			assert.ok(state !== null, "state should exist after update");
			assert.equal(state.track_id, "auth");
			assert.equal(state.cron_expr, cronExpr);
			assert.equal(state.last_fired_at, lastFiredAt);
			assert.equal(state.next_fire_at, nextFireAt);
			assert.equal(state.last_success, 1);
		} finally {
			db.close();
		}
	});

	it("should record a fire and have it visible in schedule_runs", () => {
		const db = openSchedulerDb(tmpDir);
		try {
			const scheduledFor = "2025-06-15T10:00:00.000Z";
			const firedAt = "2025-06-15T10:00:05.000Z";

			recordFire(db, "api", scheduledFor, firedAt, "success");

			const rows = db
				.prepare("SELECT * FROM schedule_runs WHERE track_id = ? AND scheduled_for = ?")
				.all("api", scheduledFor) as Array<{ result: string; error_message: string | null }>;

			assert.equal(rows.length, 1);
			assert.equal(rows[0]?.result, "success");
			assert.equal(rows[0]?.error_message, null);
		} finally {
			db.close();
		}
	});

	it("should store an error_message when provided to recordFire", () => {
		const db = openSchedulerDb(tmpDir);
		try {
			recordFire(
				db,
				"api",
				"2025-06-15T11:00:00.000Z",
				"2025-06-15T11:00:02.000Z",
				"failure",
				"agent timed out",
			);

			const rows = db
				.prepare("SELECT error_message FROM schedule_runs WHERE track_id = ? AND scheduled_for = ?")
				.all("api", "2025-06-15T11:00:00.000Z") as Array<{ error_message: string | null }>;

			assert.equal(rows.length, 1);
			assert.equal(rows[0]?.error_message, "agent timed out");
		} finally {
			db.close();
		}
	});

	it("should return null from getTrackState for an unknown track", () => {
		const db = openSchedulerDb(tmpDir);
		try {
			const state = getTrackState(db, "nonexistent-track");
			assert.equal(state, null);
		} finally {
			db.close();
		}
	});
});

// ---------------------------------------------------------------------------
// updateTrackState upsert
// ---------------------------------------------------------------------------

describe("updateTrackState upsert", () => {
	let tmpDir: string;

	before(() => {
		tmpDir = makeTmpDir();
	});

	after(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should insert a new row on first call", () => {
		const db = openSchedulerDb(tmpDir);
		try {
			updateTrackState(db, "frontend", "*/5 * * * *", null, "2025-06-15T10:05:00.000Z", true);

			const state = getTrackState(db, "frontend");
			assert.ok(state !== null);
			assert.equal(state.track_id, "frontend");
			assert.equal(state.cron_expr, "*/5 * * * *");
			assert.equal(state.last_fired_at, null);
		} finally {
			db.close();
		}
	});

	it("should update the row when called a second time with different values", () => {
		const db = openSchedulerDb(tmpDir);
		try {
			// First write
			updateTrackState(db, "backend", "0 9 * * *", null, "2025-06-16T09:00:00.000Z", true);
			// Second write — different cron, different next_fire_at, last_success = false
			updateTrackState(
				db,
				"backend",
				"0 10 * * *",
				"2025-06-16T09:00:00.000Z",
				"2025-06-17T10:00:00.000Z",
				false,
			);

			const state = getTrackState(db, "backend");
			assert.ok(state !== null);
			assert.equal(state.cron_expr, "0 10 * * *", "cron_expr should be updated");
			assert.equal(
				state.last_fired_at,
				"2025-06-16T09:00:00.000Z",
				"last_fired_at should be updated",
			);
			assert.equal(
				state.next_fire_at,
				"2025-06-17T10:00:00.000Z",
				"next_fire_at should be updated",
			);
			assert.equal(state.last_success, 0, "last_success should be updated to 0");
		} finally {
			db.close();
		}
	});

	it("should not create duplicate rows — only one row per track_id", () => {
		const db = openSchedulerDb(tmpDir);
		try {
			updateTrackState(db, "dedup-track", "0 1 * * *", null, "2025-06-16T01:00:00.000Z", true);
			updateTrackState(db, "dedup-track", "0 2 * * *", null, "2025-06-16T02:00:00.000Z", true);
			updateTrackState(db, "dedup-track", "0 3 * * *", null, "2025-06-16T03:00:00.000Z", true);

			const rows = db
				.prepare("SELECT COUNT(*) as cnt FROM schedule_state WHERE track_id = ?")
				.get("dedup-track") as { cnt: number };

			assert.equal(rows.cnt, 1, "should only have one row despite multiple upserts");
		} finally {
			db.close();
		}
	});
});
