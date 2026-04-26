/**
 * Tests for `conductor report --html` added in v2.3.
 *
 * Calls cmdReport() directly (same approach as server.test.ts which calls
 * startServer(), orchestrator.test.ts which calls runTrack(), etc.).
 * We patch process.cwd() by setting opts.cwd via the report module's internal
 * use of process.cwd(). Because cmdReport() reads process.cwd() at call time,
 * we use process.chdir() carefully inside a try/finally to restore it.
 *
 * The --html flag path is tested in three variants:
 *   1. --html /abs/path/report.html  (bare flag + positional path)
 *   2. --html=/abs/path/report.html  (key=value form)
 *   3. non-existent track → exits with code 1
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { cmdReport } from "../src/cli/report.js";
import { initConductor } from "../src/track.js";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "conductor-report-"));
}

/**
 * Run cmdReport with process.cwd() temporarily set to `cwd`.
 * Restores cwd in all cases.
 */
async function runReport(args: string[], cwd: string): Promise<number> {
	const original = process.cwd();
	try {
		process.chdir(cwd);
		return await cmdReport(args);
	} finally {
		process.chdir(original);
	}
}

describe("conductor report --html", () => {
	it("--html <path> creates an HTML file with required content", async () => {
		const dir = tmpDir();
		const outPath = join(dir, "test-report.html");
		try {
			initConductor(dir);
			// Create one track so the report has something to show.
			const { createTrack } = await import("../src/track.js");
			createTrack("Feature One", "A feature", [], dir);

			const code = await runReport(["--html", outPath], dir);

			assert.strictEqual(code, 0, "Should exit with code 0");
			assert.ok(existsSync(outPath), `HTML file should be created at ${outPath}`);

			const html = readFileSync(outPath, "utf8");
			assert.ok(html.includes("<svg"), "Report should contain an SVG graph");
			assert.ok(html.includes("conductor report"), "Report should contain 'conductor report'");

			// No CDN references — must be self-contained
			assert.ok(
				!html.includes("cdn.") && !html.includes("jsdelivr") && !html.includes("unpkg"),
				"Report must not reference any CDN",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("--html=<path> (key=value form) also creates a valid HTML file", async () => {
		const dir = tmpDir();
		const outPath = join(dir, "test-report2.html");
		try {
			initConductor(dir);
			const { createTrack } = await import("../src/track.js");
			createTrack("Feature Two", "Another feature", [], dir);

			const code = await runReport([`--html=${outPath}`], dir);

			assert.strictEqual(code, 0, "Should exit with code 0");
			assert.ok(existsSync(outPath), `HTML file should be created at ${outPath}`);

			const html = readFileSync(outPath, "utf8");
			assert.ok(html.includes("<svg"), "Report should contain an SVG graph");
			assert.ok(html.includes("conductor report"), "Report should contain 'conductor report'");
			assert.ok(
				!html.includes("cdn.") && !html.includes("jsdelivr") && !html.includes("unpkg"),
				"Report must not reference any CDN",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns exit code 1 and prints error when track-id does not exist", async () => {
		const dir = tmpDir();
		const outPath = join(dir, "report.html");
		try {
			initConductor(dir);
			// No tracks created — asking for a nonexistent track-id should fail.

			// Capture stderr to verify message
			const _stderrChunks: string[] = [];
			const _origStderr = process.stderr.write.bind(process.stderr);
			const origConsoleError = console.error.bind(console);
			const errors: string[] = [];
			console.error = (...args: unknown[]) => {
				errors.push(args.map(String).join(" "));
			};

			let code: number;
			try {
				code = await runReport(["--html", outPath, "nonexistent-track"], dir);
			} finally {
				console.error = origConsoleError;
			}

			assert.strictEqual(code, 1, "Should exit with code 1 for missing track");
			// The error message should say something about no tracks
			const allErrors = errors.join("\n");
			assert.ok(
				allErrors.toLowerCase().includes("no tracks") ||
					allErrors.toLowerCase().includes("not found") ||
					allErrors.toLowerCase().includes("track"),
				`Expected error about missing track, got: ${allErrors}`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("report HTML contains no CDN references (self-contained)", async () => {
		const dir = tmpDir();
		const outPath = join(dir, "self-contained-report.html");
		try {
			initConductor(dir);
			const { createTrack } = await import("../src/track.js");
			createTrack("Standalone", "Test", [], dir);

			await runReport(["--html", outPath], dir);

			const html = readFileSync(outPath, "utf8");
			const cdnPatterns = ["cdn.", "jsdelivr.net", "unpkg.com", "cdnjs.", "skypack.dev"];
			for (const pat of cdnPatterns) {
				assert.ok(!html.includes(pat), `HTML must not reference CDN "${pat}"`);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
