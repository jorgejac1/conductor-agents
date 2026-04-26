/**
 * Budget guardrail tests — two code paths:
 *
 * 1. Pre-run check (checkBudgetBeforeRun): fires synchronously before runSwarm.
 *    If the track is already over budget (e.g. from a prior run), the AbortController
 *    is fired before any worker spawns.
 *
 * 2. onWorkerComplete check: fires after each worker finishes (pass OR fail).
 *    If tokens cross the limit after worker N, workers N+1… stay pending.
 *
 * The echo/true-verifier tests in orchestrator.test.ts never write budget records,
 * so queryBudgetRecords always returns [] there. These tests use a tiny CJS helper
 * script as the agentCmd so real budget records land in budget.ndjson.
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig, trackDir, trackTodoPath } from "../src/config.js";
import { isPaused, runTrack } from "../src/orchestrator.js";
import { initConductor } from "../src/track.js";

function tmpDir(initGit = false): string {
	const dir = mkdtempSync(join(tmpdir(), "conductor-budget-"));
	if (initGit) {
		execSync("git init && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
	}
	return dir;
}

/** Returns the .evalgate/budget.ndjson path for a track, mirroring evalgate's logDir(). */
function budgetNdjsonPath(trackId: string, cwd: string): string {
	return join(trackDir(trackId, cwd), ".evalgate", "budget.ndjson");
}

/** Writes a single BudgetRecord line to budget.ndjson. */
function seedBudget(trackId: string, cwd: string, tokens: number): void {
	const p = budgetNdjsonPath(trackId, cwd);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(
		p,
		`${JSON.stringify({
			id: "seed-record",
			ts: new Date().toISOString(),
			contractId: "seed",
			tokens,
			inputTokens: Math.floor(tokens * 0.8),
			outputTokens: Math.floor(tokens * 0.2),
		})}\n`,
	);
}

/**
 * Writes a CJS helper script that appends a BudgetRecord to the given budget.ndjson
 * path when invoked as `node <scriptPath>`. Used as agentArgs so evalgate treats it
 * as the agent — it writes real budget records without needing a live Claude session.
 */
function writeFakeBudgetAgent(dir: string, budgetPath: string, tokens = 1000): string {
	const scriptPath = join(dir, "fake-budget-agent.cjs");
	writeFileSync(
		scriptPath,
		[
			"const { appendFileSync, mkdirSync } = require('fs');",
			"const { dirname } = require('path');",
			`const budgetPath = ${JSON.stringify(budgetPath)};`,
			"mkdirSync(dirname(budgetPath), { recursive: true });",
			"appendFileSync(budgetPath, JSON.stringify({",
			"  id: 'r' + Date.now() + Math.random().toString(36).slice(2),",
			"  ts: new Date().toISOString(),",
			"  contractId: 'task-' + process.pid,",
			`  tokens: ${tokens},`,
			`  inputTokens: ${Math.floor(tokens * 0.8)},`,
			`  outputTokens: ${Math.floor(tokens * 0.2)},`,
			"}) + '\\n');",
		].join("\n"),
	);
	return scriptPath;
}

// ---------------------------------------------------------------------------
// Pre-run check
// ---------------------------------------------------------------------------

describe("budget guardrail — pre-run check", () => {
	it("aborts before any worker spawns when track is already over budget", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);
			// Write config with maxTokens:1 directly
			saveConfig(
				{
					tracks: [
						{
							id: "budget-track",
							name: "Budget Track",
							description: "Budget test",
							files: [],
							maxTokens: 1,
							concurrency: 1,
						},
					],
					defaults: { concurrency: 1, agentCmd: "echo" },
				},
				dir,
			);
			mkdirSync(trackDir("budget-track", dir), { recursive: true });

			const todoPath = trackTodoPath("budget-track", dir);
			writeFileSync(
				todoPath,
				["- [ ] Task one", "  - eval: `true`", "- [ ] Task two", "  - eval: `true`"].join("\n"),
			);

			// Seed budget.ndjson so the pre-run check sees tokens > maxTokens before any worker runs
			seedBudget("budget-track", dir, 500);

			const result = await runTrack("budget-track", {
				agentCmd: "echo",
				cwd: dir,
			});

			// Pre-run check fires → controller aborted before runSwarm processes any worker
			const notPending = result.state.workers.filter((w) => w.status !== "pending").length;
			assert.strictEqual(
				notPending,
				0,
				"no workers should have started when pre-run budget check fires",
			);
			assert.ok(isPaused("budget-track", dir), "PAUSED marker should be written by pre-run check");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// onWorkerComplete check — mirrors real-world behavior where the first worker
// fails (verifier-fail) but still consumes tokens before being blocked.
// ---------------------------------------------------------------------------

describe("budget guardrail — onWorkerComplete after a failed worker", () => {
	it("blocks subsequent workers after a failing worker writes budget records that exceed maxTokens", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);

			const budgetPath = budgetNdjsonPath("budget-track", dir);
			const agentScript = writeFakeBudgetAgent(dir, budgetPath, 1000);

			saveConfig(
				{
					tracks: [
						{
							id: "budget-track",
							name: "Budget Track",
							description: "Budget test",
							files: [],
							maxTokens: 1,
							concurrency: 1,
							agentArgs: [agentScript], // node <script> — writes budget record then exits
						},
					],
					defaults: { concurrency: 1, agentCmd: "echo" },
				},
				dir,
			);
			mkdirSync(trackDir("budget-track", dir), { recursive: true });

			const todoPath = trackTodoPath("budget-track", dir);
			// eval:false mirrors real-world: worker runs but verifier rejects it.
			// onWorkerComplete must fire on failure too, not just on success.
			writeFileSync(
				todoPath,
				[
					"- [ ] Task one",
					"  - eval: `false`",
					"  - retries: 0",
					"- [ ] Task two",
					"  - eval: `false`",
					"  - retries: 0",
				].join("\n"),
			);

			const result = await runTrack("budget-track", {
				agentCmd: "node",
				cwd: dir,
			});

			// Worker 1 ran and failed (verifier-fail)
			const failed = result.state.workers.filter((w) => w.status === "failed");
			assert.ok(failed.length >= 1, "worker 1 should have failed (verifier-fail)");

			// Worker 2 should stay pending — budget exceeded after worker 1's onWorkerComplete
			const pending = result.state.workers.filter((w) => w.status === "pending");
			assert.ok(
				pending.length >= 1,
				"worker 2 should remain pending — budget block must fire even when worker fails",
			);

			// PAUSED marker written by the budget check
			assert.ok(
				isPaused("budget-track", dir),
				"PAUSED marker should be written after budget exceeded",
			);

			// Confirm the agent actually wrote budget records (so the test is meaningful)
			assert.ok(existsSync(budgetPath), "budget.ndjson should exist after agent ran");
			const lines = readFileSync(budgetPath, "utf8").trim().split("\n").filter(Boolean);
			assert.ok(lines.length >= 1, "budget.ndjson should have at least one record from the agent");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not block when budget is not configured even if workers fail", async () => {
		const dir = tmpDir(true);
		try {
			initConductor(dir);
			saveConfig(
				{
					tracks: [
						{
							id: "no-budget",
							name: "No Budget",
							description: "No budget limit",
							files: [],
							concurrency: 1,
							// maxTokens and maxUsd intentionally omitted
						},
					],
					defaults: { concurrency: 1, agentCmd: "echo" },
				},
				dir,
			);
			mkdirSync(trackDir("no-budget", dir), { recursive: true });

			const todoPath = trackTodoPath("no-budget", dir);
			writeFileSync(todoPath, ["- [ ] Task one", "  - eval: `false`", "  - retries: 0"].join("\n"));

			// Seed a large budget — should be ignored because no limit is set
			seedBudget("no-budget", dir, 999_999);

			const result = await runTrack("no-budget", {
				agentCmd: "echo",
				cwd: dir,
			});

			// Worker should have run (and failed the verifier) regardless of budget records
			const ran = result.state.workers.filter((w) => w.status !== "pending");
			assert.ok(ran.length >= 1, "worker should run when no budget limit is configured");
			assert.strictEqual(
				isPaused("no-budget", dir),
				false,
				"should not be paused when no budget limit",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
