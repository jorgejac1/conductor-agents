/**
 * conductor persistent scheduler — v3.1
 *
 * SQLite-backed schedule state so the daemon survives crashes and replays
 * missed fires on restart. node:sqlite is built-in on Node 22.5+ (already
 * required in package.json engines).
 *
 * Schema:
 *   schedule_state  — per-track last-fired / next-fire state
 *   schedule_runs   — immutable audit log of every fire attempt
 */

import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { parseCron } from "evalgate";

type CronExpr = ReturnType<typeof parseCron>;

export type ReplayPolicy = "collapse" | "all" | "skip";

export interface ScheduleState {
	track_id: string;
	cron_expr: string;
	last_fired_at: string | null;
	next_fire_at: string;
	last_success: number;
}

// ---------------------------------------------------------------------------
// DB management
// ---------------------------------------------------------------------------

export function schedulerDbPath(cwd: string): string {
	return join(cwd, ".conductor", "scheduler.db");
}

export function openSchedulerDb(cwd: string): DatabaseSync {
	const db = new DatabaseSync(schedulerDbPath(cwd));
	db.exec(`
		CREATE TABLE IF NOT EXISTS schedule_state (
			track_id      TEXT PRIMARY KEY,
			cron_expr     TEXT NOT NULL,
			last_fired_at TEXT,
			next_fire_at  TEXT NOT NULL,
			last_success  INTEGER NOT NULL DEFAULT 1
		);
		CREATE TABLE IF NOT EXISTS schedule_runs (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			track_id      TEXT NOT NULL,
			scheduled_for TEXT NOT NULL,
			fired_at      TEXT NOT NULL,
			result        TEXT NOT NULL,
			error_message TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_runs_track_fired
			ON schedule_runs(track_id, fired_at DESC);
	`);
	return db;
}

// ---------------------------------------------------------------------------
// State reads / writes
// ---------------------------------------------------------------------------

export function getTrackState(db: DatabaseSync, trackId: string): ScheduleState | null {
	const row = db.prepare("SELECT * FROM schedule_state WHERE track_id = ?").get(trackId);
	return (row as ScheduleState | undefined) ?? null;
}

export function updateTrackState(
	db: DatabaseSync,
	trackId: string,
	cronExpr: string,
	lastFiredAt: string | null,
	nextFireAt: string,
	lastSuccess: boolean,
): void {
	db.prepare(
		`INSERT INTO schedule_state (track_id, cron_expr, last_fired_at, next_fire_at, last_success)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(track_id) DO UPDATE SET
		   cron_expr = excluded.cron_expr,
		   last_fired_at = excluded.last_fired_at,
		   next_fire_at = excluded.next_fire_at,
		   last_success = excluded.last_success`,
	).run(trackId, cronExpr, lastFiredAt, nextFireAt, lastSuccess ? 1 : 0);
}

export function recordFire(
	db: DatabaseSync,
	trackId: string,
	scheduledFor: string,
	firedAt: string,
	result: string,
	errorMessage?: string,
): void {
	db.prepare(
		`INSERT INTO schedule_runs (track_id, scheduled_for, fired_at, result, error_message)
		 VALUES (?, ?, ?, ?, ?)`,
	).run(trackId, scheduledFor, firedAt, result, errorMessage ?? null);
}

// ---------------------------------------------------------------------------
// Missed-fire calculation
// ---------------------------------------------------------------------------

/**
 * Walk forward from lastFiredAt to now, collecting every cron slot that was
 * missed. Returns an empty array if lastFiredAt is null (first run ever).
 *
 * Uses evalgate's nextFireMs(expr, from) — the optional `from` parameter
 * lets us compute the next slot relative to an arbitrary starting point.
 */
export function computeMissedFires(
	lastFiredAt: string | null,
	now: Date,
	cronExpr: CronExpr,
	nextFireMsFn: (cronExpression: CronExpr, from: Date) => number,
): Date[] {
	if (!lastFiredAt) return [];

	const missed: Date[] = [];
	let cursor = new Date(lastFiredAt);

	// Walk forward collecting missed slots — capped at 1000 to bound runaway loops
	for (let i = 0; i < 1000; i++) {
		const ms = nextFireMsFn(cronExpr, cursor);
		if (!Number.isFinite(ms)) break;
		const next = new Date(cursor.getTime() + ms);
		if (next > now) break;
		missed.push(next);
		cursor = next;
	}

	return missed;
}

// ---------------------------------------------------------------------------
// Replay policy
// ---------------------------------------------------------------------------

/**
 * Given a list of missed fire times and a policy, decide which to actually run.
 *
 * - collapse: run once (the most recent), mark the rest as 'replayed-skipped'
 * - all:      run each serially in chronological order
 * - skip:     mark all as 'skipped', run none
 */
export async function replayMissed(
	db: DatabaseSync,
	trackId: string,
	missed: Date[],
	policy: ReplayPolicy,
	runner: (trackId: string, scheduledFor: string) => Promise<"success" | "failure">,
): Promise<void> {
	if (missed.length === 0) return;

	const sorted = [...missed].sort((a, b) => a.getTime() - b.getTime());
	const now = new Date().toISOString();

	if (policy === "skip") {
		for (const slot of sorted) {
			recordFire(db, trackId, slot.toISOString(), now, "skipped");
		}
		return;
	}

	if (policy === "collapse") {
		// Skip all but the last
		for (const slot of sorted.slice(0, -1)) {
			recordFire(db, trackId, slot.toISOString(), now, "replayed-skipped");
		}
		// Run only the most recent
		const last = sorted[sorted.length - 1];
		if (last) {
			const result = await runner(trackId, last.toISOString());
			recordFire(db, trackId, last.toISOString(), new Date().toISOString(), result);
		}
		return;
	}

	// all: run each serially
	for (const slot of sorted) {
		const result = await runner(trackId, slot.toISOString());
		recordFire(db, trackId, slot.toISOString(), new Date().toISOString(), result);
	}
}
