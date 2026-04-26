/**
 * CLI smoke tests — regression coverage for conductor subcommands.
 *
 * Uses spawnSync with tsx so the TypeScript source is exercised directly
 * (no separate build step needed). Each test gets its own isolated tmpDir
 * and cleans up in a finally block.
 */

import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// ── CLI runner setup ────────────────────────────────────────────────────────

const CLI = join(process.cwd(), "src", "cli.ts");
const TSX = join(process.cwd(), "node_modules", ".bin", "tsx");

interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
}

function conductor(args: string[], cwd: string): CliResult {
	const result = spawnSync(TSX, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, NO_COLOR: "1" },
	});
	return {
		code: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "conductor-cli-"));
}

/** Create a tmpDir with a bare git repo (required by conductor init). */
function tmpGitRepo(): string {
	const dir = tmpDir();
	execSync("git init -q", { cwd: dir });
	execSync('git config user.email "test@test.com"', { cwd: dir });
	execSync('git config user.name "Test"', { cwd: dir });
	execSync("git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
	return dir;
}

/** Init conductor in a fresh git repo and return the dir. */
function initedDir(): string {
	const dir = tmpGitRepo();
	conductor(["init", "--yes"], dir);
	// Override agentCmd to "node" — "claude" is not available in CI environments.
	// doctor checks `which <agentCmd>`, so this must be a universally installed binary.
	const cfgPath = join(dir, ".conductor", "config.json");
	const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { defaults: { agentCmd: string } };
	cfg.defaults.agentCmd = "node";
	writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
	return dir;
}

// ── Combined stdout+stderr for commands that may write to either ─────────────
function output(r: CliResult): string {
	return r.stdout + r.stderr;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("--version / --help", () => {
	// NOTE: --version is not currently wired in cli.ts (falls through to
	// the default "Unknown command" path). This test documents the current
	// behavior so any future implementation is detected as a behaviour change.
	it("should exit 1 for unknown --version flag (not yet implemented)", () => {
		const r = conductor(["--version"], process.cwd());
		assert.strictEqual(r.code, 1);
		assert.match(output(r), /Unknown command/i);
	});

	it("should print Usage and exit 0 for --help", () => {
		const r = conductor(["--help"], process.cwd());
		assert.strictEqual(r.code, 0);
		assert.match(output(r), /Usage/);
	});

	it("should print Usage and exit 0 for 'help' alias", () => {
		const r = conductor(["help"], process.cwd());
		assert.strictEqual(r.code, 0);
		assert.match(output(r), /Usage/);
	});

	it("should print Usage and exit 0 when called with no arguments", () => {
		const r = conductor([], process.cwd());
		assert.strictEqual(r.code, 0);
		assert.match(output(r), /Usage/);
	});
});

// ── conductor init ───────────────────────────────────────────────────────────

describe("conductor init", () => {
	it("should create .conductor/config.json and exit 0", () => {
		const dir = tmpGitRepo();
		try {
			const r = conductor(["init", "--yes"], dir);
			assert.strictEqual(r.code, 0);
			assert.ok(
				existsSync(join(dir, ".conductor", "config.json")),
				"config.json must exist after init",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should exit 1 with 'already initialized' when run twice in same dir", () => {
		const dir = tmpGitRepo();
		try {
			conductor(["init", "--yes"], dir);
			const r = conductor(["init", "--yes"], dir);
			assert.strictEqual(r.code, 1);
			assert.match(output(r), /already initialized/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── conductor add ────────────────────────────────────────────────────────────

describe("conductor add", () => {
	it("should create a track and print 'Created track' on success", () => {
		const dir = initedDir();
		try {
			const r = conductor(["add", "auth", "--desc=Auth layer"], dir);
			assert.strictEqual(r.code, 0);
			assert.match(output(r), /Created track/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should exit 1 and show Usage when no track name is provided", () => {
		const dir = initedDir();
		try {
			const r = conductor(["add"], dir);
			assert.strictEqual(r.code, 1);
			assert.match(output(r), /Usage/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should print 'max USD' line when --max-usd flag is provided", () => {
		const dir = initedDir();
		try {
			const r = conductor(["add", "payments", "--desc=Payments", "--max-usd=0.5"], dir);
			assert.strictEqual(r.code, 0);
			assert.match(output(r), /max USD/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should print 'max tokens' line when --max-tokens flag is provided", () => {
		const dir = initedDir();
		try {
			const r = conductor(["add", "api", "--desc=REST API", "--max-tokens=1000"], dir);
			assert.strictEqual(r.code, 0);
			assert.match(output(r), /max tokens/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should exit 1 with 'must be a number' when --max-usd is not numeric", () => {
		const dir = initedDir();
		try {
			const r = conductor(["add", "broken", "--max-usd=notanumber"], dir);
			assert.strictEqual(r.code, 1);
			assert.match(output(r), /must be a number/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should exit 1 with 'must be an integer' when --max-tokens is not numeric", () => {
		const dir = initedDir();
		try {
			const r = conductor(["add", "broken", "--max-tokens=notanumber"], dir);
			assert.strictEqual(r.code, 1);
			assert.match(output(r), /must be an integer/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── conductor list ───────────────────────────────────────────────────────────

describe("conductor list", () => {
	it("should print 'No tracks' on an empty project and exit 0", () => {
		const dir = initedDir();
		try {
			const r = conductor(["list"], dir);
			assert.strictEqual(r.code, 0);
			assert.match(output(r), /No tracks/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should list the track id after adding a track", () => {
		const dir = initedDir();
		try {
			conductor(["add", "auth", "--desc=Auth"], dir);
			const r = conductor(["list"], dir);
			assert.strictEqual(r.code, 0);
			assert.match(output(r), /auth/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── conductor rm ─────────────────────────────────────────────────────────────

describe("conductor rm", () => {
	it("should print 'Deleted' and exit 0 after removing an existing track", () => {
		const dir = initedDir();
		try {
			conductor(["add", "auth", "--desc=Auth"], dir);
			const r = conductor(["rm", "auth"], dir);
			assert.strictEqual(r.code, 0);
			assert.match(output(r), /Deleted/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should exit 1 with an error message when removing a nonexistent track", () => {
		const dir = initedDir();
		try {
			const r = conductor(["rm", "nonexistent"], dir);
			assert.strictEqual(r.code, 1);
			// Must not be a raw stack trace
			assert.ok(!output(r).includes("at Object."), "must not expose a raw stack trace");
			// Should contain some indication the track wasn't found
			assert.ok(output(r).length > 0, "expected a non-empty error message");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── conductor status ─────────────────────────────────────────────────────────

describe("conductor status", () => {
	it("should exit 0 for an existing track (shows idle / no-swarm state message)", () => {
		const dir = initedDir();
		try {
			conductor(["add", "auth", "--desc=Auth"], dir);
			const r = conductor(["status", "auth"], dir);
			// No swarm has run — exit 0 is expected (informational message)
			assert.strictEqual(r.code, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("should exit 1 with a clean error message for a nonexistent track", () => {
		const dir = initedDir();
		try {
			const r = conductor(["status", "nonexistent"], dir);
			assert.strictEqual(r.code, 1);
			assert.ok(!output(r).includes("at Object."), "must not expose a raw stack trace");
			assert.ok(output(r).length > 0, "expected a non-empty error message");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── conductor doctor ─────────────────────────────────────────────────────────

describe("conductor doctor", () => {
	it("should exit 0 in an initialized directory", () => {
		const dir = initedDir();
		try {
			const r = conductor(["doctor"], dir);
			assert.strictEqual(r.code, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── helpers — unit tests (no subprocess) ─────────────────────────────────────

// Dynamic import so tsx resolves the TS source directly.
const { parseFlags, positionalArgs, formatDuration } = await import("../src/cli/helpers.js");

describe("helpers — parseFlags", () => {
	it("should parse --key=value flag", () => {
		const flags = parseFlags(["--foo=bar", "--baz"]);
		assert.strictEqual(flags.foo, "bar");
		assert.strictEqual(flags.baz, true);
	});

	it("should use only the first '=' as the delimiter", () => {
		const flags = parseFlags(["--foo=bar=baz"]);
		assert.strictEqual(flags.foo, "bar=baz");
	});

	it("should set boolean true for bare --flag with no value", () => {
		const flags = parseFlags(["--verbose"]);
		assert.strictEqual(flags.verbose, true);
	});

	it("should ignore non-flag arguments", () => {
		const flags = parseFlags(["add", "auth"]);
		assert.deepStrictEqual(flags, {});
	});
});

describe("helpers — positionalArgs", () => {
	it("should strip flag arguments and return only positionals", () => {
		const positional = positionalArgs(["add", "--desc=x", "name"]);
		assert.deepStrictEqual(positional, ["add", "name"]);
	});

	it("should return empty array when all args are flags", () => {
		const positional = positionalArgs(["--yes", "--verbose"]);
		assert.deepStrictEqual(positional, []);
	});

	it("should return all args when none are flags", () => {
		const positional = positionalArgs(["add", "auth", "backend"]);
		assert.deepStrictEqual(positional, ["add", "auth", "backend"]);
	});
});

describe("helpers — formatDuration", () => {
	it("should return milliseconds for durations under 1 second", () => {
		const start = new Date(Date.now() - 500).toISOString();
		const end = new Date(Date.now()).toISOString();
		const result = formatDuration(start, end);
		assert.match(result, /\d+ms/);
	});

	it("should return seconds for durations between 1s and 60s", () => {
		const start = new Date(Date.now() - 5000).toISOString();
		const end = new Date(Date.now()).toISOString();
		const result = formatDuration(start, end);
		assert.match(result, /\d+\.\d+s/);
	});

	it("should return minutes and seconds for durations over 60 seconds", () => {
		const start = new Date(Date.now() - 90_000).toISOString();
		const end = new Date(Date.now()).toISOString();
		const result = formatDuration(start, end);
		assert.match(result, /\d+m \d+s/);
	});

	it("should use the current time when finishedAt is omitted", () => {
		const start = new Date(Date.now() - 5000).toISOString();
		const result = formatDuration(start);
		// Should be roughly 5s — just verify it's a valid duration string
		assert.ok(result.length > 0, "expected a non-empty duration string");
	});
});
