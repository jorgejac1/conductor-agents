import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SwarmState, WorkerState } from "evalgate";
import { formatTrackList, formatWorkerStatus, parseCommand } from "../src/telegram.js";
import type { TrackStatus } from "../src/types.js";

// ---------------------------------------------------------------------------
// parseCommand
// ---------------------------------------------------------------------------

describe("parseCommand", () => {
	it("parses /help with no args", () => {
		const r = parseCommand("/help");
		assert.strictEqual(r.cmd, "help");
		assert.deepStrictEqual(r.args, []);
	});

	it("parses /status with track arg", () => {
		const r = parseCommand("/status auth");
		assert.strictEqual(r.cmd, "status");
		assert.deepStrictEqual(r.args, ["auth"]);
	});

	it("parses /retry with two args", () => {
		const r = parseCommand("/retry abc123 auth");
		assert.strictEqual(r.cmd, "retry");
		assert.deepStrictEqual(r.args, ["abc123", "auth"]);
	});

	it("strips @botname suffix", () => {
		const r = parseCommand("/help@my_conductor_bot");
		assert.strictEqual(r.cmd, "help");
		assert.deepStrictEqual(r.args, []);
	});

	it("strips @botname and keeps args", () => {
		const r = parseCommand("/run@my_bot auth-module");
		assert.strictEqual(r.cmd, "run");
		assert.deepStrictEqual(r.args, ["auth-module"]);
	});

	it("normalises cmd to lowercase", () => {
		const r = parseCommand("/LIST");
		assert.strictEqual(r.cmd, "list");
	});

	it("returns unknown for plain text", () => {
		const r = parseCommand("hello world");
		assert.strictEqual(r.cmd, "unknown");
	});

	it("returns unknown for empty string", () => {
		const r = parseCommand("   ");
		assert.strictEqual(r.cmd, "unknown");
	});

	it("handles extra whitespace between args", () => {
		const r = parseCommand("/retry  abc  auth");
		assert.strictEqual(r.cmd, "retry");
		assert.deepStrictEqual(r.args, ["abc", "auth"]);
	});
});

// ---------------------------------------------------------------------------
// formatTrackList
// ---------------------------------------------------------------------------

function makeTrackStatus(id: string, done: number, total: number): TrackStatus {
	return {
		track: { id, name: id, description: "", files: [] },
		todoTotal: total,
		todoPending: total - done,
		todoDone: done,
		swarmState: null,
	};
}

describe("formatTrackList", () => {
	it("shows message when no tracks", () => {
		const out = formatTrackList([]);
		assert.ok(out.includes("No tracks"));
	});

	it("renders tracks with done/total counts", () => {
		const out = formatTrackList([makeTrackStatus("auth", 2, 5)]);
		assert.ok(out.includes("auth"));
		assert.ok(out.includes("2/5"));
	});

	it("uses checkmark icon for fully complete track", () => {
		const out = formatTrackList([makeTrackStatus("auth", 3, 3)]);
		assert.ok(out.includes("✅"));
	});

	it("uses warning icon for in-progress track", () => {
		const out = formatTrackList([makeTrackStatus("auth", 1, 3)]);
		assert.ok(out.includes("⚠️"));
	});

	it("uses circle icon for not-started track", () => {
		const out = formatTrackList([makeTrackStatus("auth", 0, 3)]);
		assert.ok(out.includes("⬜"));
	});

	it("truncates at 4000 chars and adds 'more' note", () => {
		const many: TrackStatus[] = Array.from({ length: 200 }, (_, i) =>
			makeTrackStatus(`track-with-a-very-long-name-${i}`, 0, 10),
		);
		const out = formatTrackList(many);
		assert.ok(out.length <= 4100, `output too long: ${out.length}`);
		assert.ok(out.includes("more"));
	});
});

// ---------------------------------------------------------------------------
// formatWorkerStatus
// ---------------------------------------------------------------------------

function makeWorker(
	id: string,
	status: WorkerState["status"],
	title = "Do something",
): WorkerState {
	return {
		id,
		status,
		contractTitle: title,
		logPath: `/tmp/${id}.log`,
		startedAt: undefined,
		finishedAt: undefined,
	};
}

function makeSwarmState(workers: WorkerState[]): SwarmState {
	return { workers, todoPath: "/tmp/todo.md" };
}

describe("formatWorkerStatus", () => {
	it("shows message when no workers", () => {
		const out = formatWorkerStatus(makeSwarmState([]));
		assert.ok(out.includes("No workers"));
	});

	it("renders worker with done badge", () => {
		const out = formatWorkerStatus(makeSwarmState([makeWorker("abc123", "done", "Add JWT")]));
		assert.ok(out.includes("✅"));
		assert.ok(out.includes("Add JWT"));
		assert.ok(out.includes("done"));
	});

	it("renders worker with failed badge", () => {
		const out = formatWorkerStatus(makeSwarmState([makeWorker("abc123", "failed")]));
		assert.ok(out.includes("❌"));
	});

	it("renders worker with running badge", () => {
		const out = formatWorkerStatus(makeSwarmState([makeWorker("abc123", "running")]));
		assert.ok(out.includes("🔄"));
	});

	it("shows short worker ID prefix", () => {
		const out = formatWorkerStatus(
			makeSwarmState([makeWorker("abcdef1234567890", "done", "Test")]),
		);
		assert.ok(out.includes("abcdef12"));
	});

	it("truncates at 4000 chars and adds 'more' note", () => {
		const workers: WorkerState[] = Array.from({ length: 200 }, (_, i) =>
			makeWorker(
				`worker-${i}-with-a-very-long-id-${i}`,
				"done",
				`Task with a very long title ${i}`,
			),
		);
		const out = formatWorkerStatus(makeSwarmState(workers));
		assert.ok(out.length <= 4100, `output too long: ${out.length}`);
		assert.ok(out.includes("more"));
	});
});
