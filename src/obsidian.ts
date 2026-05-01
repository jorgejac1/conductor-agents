import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ObsidianConfig } from "./types.js";

export interface RunSummary {
	trackId: string;
	todoTotal: number;
	todoDone: number;
	passed: boolean;
	estimatedUsd: number;
	totalTokens: number;
	durationMs?: number;
	memoriesAdded?: string[];
}

function vaultDir(cfg: ObsidianConfig): string {
	return cfg.subfolder ? join(cfg.vaultPath, cfg.subfolder) : cfg.vaultPath;
}

function ensureDir(dir: string): boolean {
	try {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		return true;
	} catch {
		return false;
	}
}

function isWritable(dir: string): boolean {
	try {
		const probe = join(dir, `.conductor-probe-${Date.now()}`);
		writeFileSync(probe, "");
		unlinkSync(probe);
		return true;
	} catch {
		return false;
	}
}

function pushSummary(cfg: ObsidianConfig, summary: RunSummary): void {
	const dir = vaultDir(cfg);
	if (!ensureDir(dir)) {
		process.stderr.write(`obsidian: cannot create vault directory ${dir} — sync skipped\n`);
		return;
	}
	if (!isWritable(dir)) {
		process.stderr.write(`obsidian: vault directory ${dir} is not writable — sync skipped\n`);
		return;
	}
	const iso = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	let filename = `${summary.trackId}-${iso}.md`;
	let target = join(dir, filename);
	let suffix = 0;
	while (existsSync(target)) {
		suffix++;
		filename = `${summary.trackId}-${iso}-${suffix}.md`;
		target = join(dir, filename);
	}
	const result = summary.passed ? "✅ pass" : "❌ fail";
	const lines = [
		`# ${summary.trackId} — ${iso}`,
		"",
		`**Result:** ${result}`,
		`**Progress:** ${summary.todoDone}/${summary.todoTotal} tasks done`,
		`**Cost:** $${summary.estimatedUsd.toFixed(4)} (${summary.totalTokens.toLocaleString()} tokens)`,
		summary.durationMs !== undefined
			? `**Duration:** ${(summary.durationMs / 1000).toFixed(1)}s`
			: "",
		summary.memoriesAdded?.length ? `**Memories added:** ${summary.memoriesAdded.join(", ")}` : "",
	].filter((l) => l !== "");
	writeFileSync(target, `${lines.join("\n")}\n`);
}

function pullContext(cfg: ObsidianConfig): string | undefined {
	const dir = vaultDir(cfg);
	const ctxPath = join(dir, "_context.md");
	if (!existsSync(ctxPath)) return undefined;
	try {
		return readFileSync(ctxPath, "utf8");
	} catch {
		return undefined;
	}
}

export function obsidianSync(
	cfg: ObsidianConfig,
	action: "push" | "pull" | "both",
	summary?: RunSummary,
): string | undefined {
	if (action === "push" || action === "both") {
		if (summary) pushSummary(cfg, summary);
	}
	if (action === "pull" || action === "both") {
		return pullContext(cfg);
	}
	return undefined;
}

export function obsidianStatus(cfg: ObsidianConfig): {
	accessible: boolean;
	writable: boolean;
	vaultPath: string;
	subfolder?: string;
} {
	const dir = vaultDir(cfg);
	const accessible = existsSync(dir);
	const writable = accessible && isWritable(dir);
	const result: { accessible: boolean; writable: boolean; vaultPath: string; subfolder?: string } =
		{
			accessible,
			writable,
			vaultPath: cfg.vaultPath,
		};
	if (cfg.subfolder !== undefined) result.subfolder = cfg.subfolder;
	return result;
}
