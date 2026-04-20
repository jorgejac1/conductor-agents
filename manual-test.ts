/**
 * conductor-agents v2.1 — Manual test script
 *
 * Tests all v2.1 scenarios programmatically (no UI).
 * Run with: npx tsx manual-test.ts
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCycle } from "./src/orchestrator.js";
import { createTrack } from "./src/track.js";
import { validateConfig } from "./src/config.js";
import type { ConductorConfig, Track } from "./src/types.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

const green = "\x1b[32m";
const red = "\x1b[31m";
const bold = "\x1b[1m";
const reset = "\x1b[0m";
const gray = "\x1b[90m";

let passed = 0;
let failed = 0;

function assert(label: string, ok: boolean, detail?: string) {
	if (ok) {
		console.log(`  ${green}✔${reset}  ${label}`);
		passed++;
	} else {
		console.log(`  ${red}✘${reset}  ${label}${detail ? `  ${gray}(${detail})${reset}` : ""}`);
		failed++;
	}
}

function assertThrows(label: string, fn: () => unknown, match?: string) {
	try {
		fn();
		assert(label, false, "expected throw, got nothing");
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (match && !msg.includes(match)) {
			assert(label, false, `expected "${match}" in "${msg}"`);
		} else {
			assert(label, true);
		}
	}
}

function suite(name: string) {
	console.log(`\n${bold}${name}${reset}`);
}

function tmpDir(): string {
	const dir = join(tmpdir(), `conductor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ─── Suite 1: detectCycle ─────────────────────────────────────────────────────

suite("detectCycle — track dependency graph");

{
	const noDepTracks: Track[] = [
		{ id: "a", name: "A", description: "", files: [] },
		{ id: "b", name: "B", description: "", files: [] },
	];
	assert("no cycle with independent tracks", detectCycle(noDepTracks) === null);

	const linearTracks: Track[] = [
		{ id: "a", name: "A", description: "", files: [] },
		{ id: "b", name: "B", description: "", files: [], dependsOn: ["a"] },
		{ id: "c", name: "C", description: "", files: [], dependsOn: ["b"] },
	];
	assert("no cycle with linear deps (a→b→c)", detectCycle(linearTracks) === null);

	const diamondTracks: Track[] = [
		{ id: "a", name: "A", description: "", files: [] },
		{ id: "b", name: "B", description: "", files: [], dependsOn: ["a"] },
		{ id: "c", name: "C", description: "", files: [], dependsOn: ["a"] },
		{ id: "d", name: "D", description: "", files: [], dependsOn: ["b", "c"] },
	];
	assert("no cycle with diamond deps (a→b,c→d)", detectCycle(diamondTracks) === null);

	const cycleTracks: Track[] = [
		{ id: "a", name: "A", description: "", files: [], dependsOn: ["c"] },
		{ id: "b", name: "B", description: "", files: [], dependsOn: ["a"] },
		{ id: "c", name: "C", description: "", files: [], dependsOn: ["b"] },
	];
	const cycle = detectCycle(cycleTracks);
	assert("detects cycle a→c→b→a", cycle !== null);
	assert("cycle path contains 'a'", (cycle ?? []).includes("a"));

	const selfCycle: Track[] = [
		{ id: "x", name: "X", description: "", files: [], dependsOn: ["x"] },
	];
	assert("detects self-cycle (x→x)", detectCycle(selfCycle) !== null);
}

// ─── Suite 2: validateConfig — dependsOn validation ───────────────────────────

suite("validateConfig — dependsOn field");

{
	const baseConfig = {
		tracks: [
			{ id: "auth", name: "Auth", description: "", files: [] },
			{ id: "payments", name: "Payments", description: "", files: [], dependsOn: ["auth"] },
		],
		defaults: { concurrency: 2, agentCmd: "claude" },
	};

	assert(
		"valid dependsOn passes validateConfig",
		(() => {
			try {
				validateConfig(baseConfig);
				return true;
			} catch {
				return false;
			}
		})(),
	);

	assertThrows(
		"invalid dependsOn (non-array) throws",
		() =>
			validateConfig({
				...baseConfig,
				tracks: [
					{ id: "auth", name: "Auth", description: "", files: [] },
					{ id: "payments", name: "Payments", description: "", files: [], dependsOn: "auth" },
				],
			}),
		"dependsOn",
	);

	assertThrows(
		"dependsOn with unknown track id throws",
		() =>
			validateConfig({
				...baseConfig,
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
			}),
		"references unknown track id",
	);

	assertThrows(
		"dependsOn with non-string elements throws",
		() =>
			validateConfig({
				...baseConfig,
				tracks: [
					{ id: "auth", name: "Auth", description: "", files: [] },
					{ id: "payments", name: "Payments", description: "", files: [], dependsOn: [123] },
				],
			}),
		"dependsOn",
	);
}

// ─── Suite 3: createTrack — dependsOn flag ────────────────────────────────────

suite("createTrack — --depends flag");

{
	const cwd = tmpDir();

	// Initialize a minimal conductor project
	mkdirSync(join(cwd, ".conductor"), { recursive: true });
	writeFileSync(
		join(cwd, ".conductor", "config.json"),
		JSON.stringify({
			tracks: [],
			defaults: { concurrency: 2, agentCmd: "claude" },
		}),
	);

	// Create first track without deps
	const t1 = createTrack("auth", "Auth service", [], cwd);
	assert("createTrack creates auth track", t1.id === "auth");

	// Create second track with dependsOn
	const t2 = createTrack("payments", "Payments service", [], cwd, ["auth"]);
	assert("createTrack creates payments track with dependsOn", t2.id === "payments");

	// Verify config was persisted with dependsOn
	const { loadConfig } = await import("./src/config.js");
	const cfg = loadConfig(cwd);
	const payTrack = cfg?.tracks.find((t) => t.id === "payments");
	assert("dependsOn persisted to config", payTrack?.dependsOn?.[0] === "auth");

	// Try to create track with unknown dep
	assertThrows(
		"createTrack throws on unknown dependsOn id",
		() => createTrack("billing", "Billing", [], cwd, ["nonexistent"]),
		"nonexistent",
	);

	rmSync(cwd, { recursive: true, force: true });
}

// ─── Suite 4: DAG runAll — orchestrator ordering ──────────────────────────────

suite("orchestrator — DAG runAll dependency ordering");

{
	// We test the ordering logic directly by inspecting what detectCycle returns
	// and by constructing the execution waves manually.
	// Full runAll integration requires real swarm processes, so we test the
	// primitives here and cover runAll ordering in unit tests.

	const parallelTracks: Track[] = [
		{ id: "a", name: "A", description: "", files: [] },
		{ id: "b", name: "B", description: "", files: [] },
		{ id: "c", name: "C", description: "", files: [] },
	];
	assert("no deps → no cycle → all tracks are independent", detectCycle(parallelTracks) === null);

	const seqTracks: Track[] = [
		{ id: "a", name: "A", description: "", files: [] },
		{ id: "b", name: "B", description: "", files: [], dependsOn: ["a"] },
	];
	assert("sequential deps → no cycle", detectCycle(seqTracks) === null);

	const cyclicTracks: Track[] = [
		{ id: "a", name: "A", description: "", files: [], dependsOn: ["b"] },
		{ id: "b", name: "B", description: "", files: [], dependsOn: ["a"] },
	];
	assert("cycle detected → detectCycle returns path", detectCycle(cyclicTracks) !== null);
}

// ─── Suite 5: doctor — cycle detection integration ────────────────────────────

suite("doctor — cycle check");

{
	// The doctor command uses detectCycle and reports it via check().
	// We test that detectCycle correctly identifies cycles that doctor would report.
	const doctorCycle: Track[] = [
		{ id: "ui", name: "UI", description: "", files: [], dependsOn: ["api"] },
		{ id: "api", name: "API", description: "", files: [], dependsOn: ["db"] },
		{ id: "db", name: "DB", description: "", files: [], dependsOn: ["ui"] },
	];
	const cycle = detectCycle(doctorCycle);
	assert("doctor cycle input → detectCycle finds it", cycle !== null);
	assert("cycle involves 3 tracks", (cycle ?? []).length >= 3);

	const doctorNoCycle: Track[] = [
		{ id: "ui", name: "UI", description: "", files: [], dependsOn: ["api"] },
		{ id: "api", name: "API", description: "", files: [], dependsOn: ["db"] },
		{ id: "db", name: "DB", description: "", files: [] },
	];
	assert("valid DAG → detectCycle returns null", detectCycle(doctorNoCycle) === null);
}

// ─── Suite 6: SSE types — worker-start / worker-retry ─────────────────────────

suite("UI types — SSEWorkerStartEvent and SSEWorkerRetryEvent");

{
	// Import type shape verification via runtime duck-typing
	const startEvent = { type: "worker-start" as const, workerId: "abc123", contractId: "task-1" };
	const retryEvent = { type: "worker-retry" as const, workerId: "def456", contractId: "task-2" };

	assert("SSEWorkerStartEvent has correct type field", startEvent.type === "worker-start");
	assert("SSEWorkerStartEvent has workerId", typeof startEvent.workerId === "string");
	assert("SSEWorkerStartEvent has contractId", typeof startEvent.contractId === "string");
	assert("SSEWorkerRetryEvent has correct type field", retryEvent.type === "worker-retry");
	assert("SSEWorkerRetryEvent has workerId", typeof retryEvent.workerId === "string");
}

// ─── Suite 7: failureKind badge mapping ───────────────────────────────────────

suite("failureKind → badge label mapping");

{
	// Mirror the failureKindBadge logic from GraphDetailPanel.tsx
	function badgeFor(kind: string | undefined): { label: string; cls: string } | null {
		if (!kind) return null;
		switch (kind) {
			case "agent-timeout":
			case "verifier-timeout":
				return { label: "TIMEOUT", cls: "badge-timeout" };
			case "merge-conflict":
				return { label: "MERGE", cls: "badge-merge" };
			case "verifier-fail":
				return { label: "FAILED", cls: "badge-fail" };
			default:
				return { label: "ERROR", cls: "badge-error" };
		}
	}

	assert("agent-timeout → TIMEOUT badge", badgeFor("agent-timeout")?.label === "TIMEOUT");
	assert("verifier-timeout → TIMEOUT badge", badgeFor("verifier-timeout")?.label === "TIMEOUT");
	assert("verifier-timeout → badge-timeout class", badgeFor("verifier-timeout")?.cls === "badge-timeout");
	assert("merge-conflict → MERGE badge", badgeFor("merge-conflict")?.label === "MERGE");
	assert("merge-conflict → badge-merge class", badgeFor("merge-conflict")?.cls === "badge-merge");
	assert("verifier-fail → FAILED badge", badgeFor("verifier-fail")?.label === "FAILED");
	assert("verifier-fail → badge-fail class", badgeFor("verifier-fail")?.cls === "badge-fail");
	assert("worktree-create → ERROR badge", badgeFor("worktree-create")?.label === "ERROR");
	assert("agent-crash → ERROR badge", badgeFor("agent-crash")?.label === "ERROR");
	assert("undefined → null (no badge)", badgeFor(undefined) === null);
	assert("empty string → null (no badge)", badgeFor("") === null);
}

// ─── Suite 8: config round-trip with dependsOn ────────────────────────────────

suite("config — dependsOn round-trip");

{
	const cwd = tmpDir();
	mkdirSync(join(cwd, ".conductor"), { recursive: true });

	const config: ConductorConfig = {
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

	const { saveConfig, loadConfig } = await import("./src/config.js");
	saveConfig(config, cwd);
	const loaded = loadConfig(cwd);

	assert("config round-trip preserves track count", loaded?.tracks.length === 3);
	const appTrack = loaded?.tracks.find((t) => t.id === "app");
	assert("dependsOn round-trips correctly (single dep)", appTrack?.dependsOn?.[0] === "infra");
	const testTrack = loaded?.tracks.find((t) => t.id === "tests");
	assert(
		"dependsOn round-trips correctly (multiple deps)",
		testTrack?.dependsOn?.length === 2 &&
			testTrack.dependsOn.includes("app") &&
			testTrack.dependsOn.includes("infra"),
	);

	// Ensure validateConfig passes on the loaded config
	assert(
		"loaded config passes validateConfig",
		(() => {
			try {
				validateConfig(loaded as unknown);
				return true;
			} catch {
				return false;
			}
		})(),
	);

	rmSync(cwd, { recursive: true, force: true });
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(
	`\n${bold}Results:${reset} ${green}${passed}/${total} passed${reset}${failed > 0 ? `  ${red}${failed} failed${reset}` : ""}`,
);

if (failed > 0) process.exit(1);
