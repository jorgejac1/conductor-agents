import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SwarmState } from "evalgate";
import { getTrackCost, getTrackSpend, getTrackState } from "../orchestrator.js";
import { listTracks } from "../track.js";
import type { Track } from "../types.js";
import { c, parseFlags, positionalArgs } from "./helpers.js";

// ---------------------------------------------------------------------------
// HTML report helpers
// ---------------------------------------------------------------------------

function renderTracksSvg(tracks: Track[], deps: Record<string, string[]>): string {
	const W = 700;
	const NODE_R = 24;
	const cx = W / 2;
	const cy = 200;
	const ring = Math.min(160, tracks.length > 1 ? 140 : 0);
	const positions: Record<string, { x: number; y: number }> = {};
	tracks.forEach((t, i) => {
		const angle = tracks.length > 1 ? (2 * Math.PI * i) / tracks.length - Math.PI / 2 : 0;
		positions[t.id] = { x: cx + ring * Math.cos(angle), y: cy + ring * Math.sin(angle) };
	});

	const lines: string[] = [];
	// Edges
	for (const [from, tos] of Object.entries(deps)) {
		for (const to of tos) {
			const a = positions[from];
			const b = positions[to];
			if (!a || !b) continue;
			lines.push(
				`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#1e2d45" stroke-width="1.5" stroke-dasharray="4,3"/>`,
			);
		}
	}
	// Nodes
	for (const t of tracks) {
		const p = positions[t.id];
		if (!p) continue;
		lines.push(
			`<circle cx="${p.x}" cy="${p.y}" r="${NODE_R}" fill="#0c1220" stroke="#818cf8" stroke-width="1.5"/>`,
		);
		lines.push(
			`<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-family="monospace" font-size="10" fill="#e2e8f0">${t.id.slice(0, 8)}</text>`,
		);
	}

	const H = 400;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#050810;border-radius:8px">${lines.join("")}</svg>`;
}

function renderGanttSvg(tracks: Track[], states: Record<string, SwarmState | null>): string {
	const W = 700;
	const ROW_H = 28;
	const LABEL_W = 120;
	const allWorkers = tracks.flatMap((t) => states[t.id]?.workers ?? []);
	const starts = allWorkers
		.filter((w) => w.startedAt)
		.map((w) => new Date(w.startedAt as string).getTime());
	const ends = allWorkers
		.filter((w) => w.finishedAt)
		.map((w) => new Date(w.finishedAt as string).getTime());
	if (starts.length === 0) return "";

	const minT = Math.min(...starts);
	const maxT = Math.max(...ends, Date.now());
	const span = maxT - minT || 1;
	const barW = W - LABEL_W - 16;

	const rows: string[] = [];
	let rowIdx = 0;
	for (const t of tracks) {
		const workers = states[t.id]?.workers ?? [];
		for (const w of workers) {
			if (!w.startedAt) continue;
			const y = 8 + rowIdx * ROW_H;
			const x0 = LABEL_W + ((new Date(w.startedAt).getTime() - minT) / span) * barW;
			const fin = w.finishedAt ? new Date(w.finishedAt).getTime() : Date.now();
			const bw = Math.max(4, ((fin - new Date(w.startedAt).getTime()) / span) * barW);
			const fill = w.status === "done" ? "#34d399" : w.status === "failed" ? "#fb7185" : "#38bdf8";
			rows.push(
				`<rect x="${x0.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${ROW_H - 6}" rx="3" fill="${fill}" opacity="0.85"/>`,
			);
			rows.push(
				`<text x="${LABEL_W - 4}" y="${y + ROW_H / 2 - 1}" text-anchor="end" font-family="monospace" font-size="9" fill="#94a3b8">${t.id.slice(0, 10)} / ${w.id.slice(0, 6)}</text>`,
			);
			rowIdx++;
		}
	}
	if (rows.length === 0) return "";
	const H = 16 + rowIdx * ROW_H;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#050810;border-radius:8px">${rows.join("")}</svg>`;
}

function renderCostTable(
	tracks: Track[],
	spends: Array<{ totalTokens: number; estimatedUsd: number }>,
): string {
	const rows = tracks
		.map(
			(t, i) =>
				`<tr><td>${t.id}</td><td>${(spends[i]?.totalTokens ?? 0).toLocaleString()}</td><td>$${(spends[i]?.estimatedUsd ?? 0).toFixed(4)}</td></tr>`,
		)
		.join("");
	const totalTok = spends.reduce((s, x) => s + x.totalTokens, 0);
	const totalUsd = spends.reduce((s, x) => s + x.estimatedUsd, 0);
	return `<table border="1" cellpadding="6" style="border-collapse:collapse;font-family:monospace;font-size:12px;color:#e2e8f0;border-color:#1e2d45"><thead><tr><th>Track</th><th>Tokens</th><th>Est. USD</th></tr></thead><tbody>${rows}<tr style="font-weight:bold"><td>Total</td><td>${totalTok.toLocaleString()}</td><td>$${totalUsd.toFixed(4)}</td></tr></tbody></table>`;
}

async function writeHtmlReport(
	outPath: string,
	id: string | undefined,
	cwd: string,
): Promise<void> {
	const { loadConfig } = await import("../config.js");
	const config = loadConfig(cwd);
	const allTracks = config?.tracks ?? [];
	const targetTracks = id ? allTracks.filter((t) => t.id === id) : allTracks;
	if (targetTracks.length === 0) throw new Error("No tracks to report on.");

	const states: Record<string, SwarmState | null> = {};
	for (const t of targetTracks) {
		const { getTrackState: gts } = await import("../orchestrator.js");
		states[t.id] = await gts(t.id, cwd);
	}

	const deps: Record<string, string[]> = {};
	for (const t of targetTracks) deps[t.id] = t.dependsOn ?? [];

	const spends = targetTracks.map((t) => getTrackSpend(t.id, cwd));
	const graphSvg = renderTracksSvg(targetTracks, deps);
	const ganttSvg = renderGanttSvg(targetTracks, states);
	const costHtml = renderCostTable(targetTracks, spends);

	const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>conductor report</title>
<style>body{background:#050810;color:#e2e8f0;font-family:sans-serif;padding:24px}h1,h2{color:#818cf8}section{margin-bottom:32px}table{border-collapse:collapse}th,td{padding:6px 12px;border:1px solid #1e2d45;font-family:monospace;font-size:12px}</style>
</head><body>
<h1>conductor report</h1>
<p style="color:#64748b;font-size:12px">Generated: ${new Date().toISOString()}</p>
<section><h2>Track Graph</h2>${graphSvg}</section>
${ganttSvg ? `<section><h2>Worker Timeline</h2>${ganttSvg}</section>` : ""}
<section><h2>Cost Summary</h2>${costHtml}</section>
</body></html>`;

	writeFileSync(outPath, html, "utf8");
}

// ---------------------------------------------------------------------------
// CLI command
// ---------------------------------------------------------------------------

export async function cmdReport(args: string[]): Promise<number> {
	const flags = parseFlags(args);
	const positional = positionalArgs(args);
	// When --html is a bare boolean flag (not --html=path), the output path may
	// land in positional[0]. Detect it: track IDs never contain '/' or end in '.html'.
	let id: string | undefined;
	let htmlPathFromPositional: string | undefined;
	if (flags.html !== undefined && flags.html === true) {
		const p0 = positional[0];
		if (p0 && (p0.includes("/") || p0.endsWith(".html"))) {
			htmlPathFromPositional = p0;
			id = positional[1];
		} else {
			id = p0;
		}
	} else {
		id = positional[0];
	}

	const SEP = "─".repeat(58);
	const COL_W = 22;
	const cwd = process.cwd();

	try {
		// --html mode: generate a self-contained HTML file
		if (flags.html !== undefined) {
			const outPath =
				typeof flags.html === "string"
					? flags.html
					: htmlPathFromPositional !== undefined
						? resolve(cwd, htmlPathFromPositional)
						: typeof flags.out === "string"
							? flags.out
							: resolve(cwd, "report.html");
			if (existsSync(outPath)) {
				console.log(`Overwriting ${outPath}`);
			}
			await writeHtmlReport(outPath, id, cwd);
			console.log(`✓ Report written to ${outPath}`);
			return 0;
		}

		if (id) {
			// Single track — per-contract breakdown
			const summary = getTrackCost(id, cwd);
			const state = await getTrackState(id, cwd);
			const { estimateUsd: est } = await import("evalgate");

			console.log(`\n${c.bold}Track: ${id}${c.reset}`);
			console.log(SEP);
			console.log(
				`  ${"Contract".padEnd(COL_W)} ${"Status".padEnd(10)} ${"Tokens".padStart(10)}  Est. Cost`,
			);
			console.log(`  ${"─".repeat(COL_W)} ${"─".repeat(8)}  ${"─".repeat(9)}  ${"─".repeat(9)}`);

			let totalTokens = 0;
			let totalUsd = 0;

			for (const entry of summary) {
				const worker = state?.workers.find((w) => w.contractId === entry.contractId);
				const status = worker?.status ?? "pending";
				const statusColor = status === "done" ? c.green : status === "failed" ? c.red : c.gray;
				const tokens = entry.used;
				const usd = est(tokens / 2, tokens / 2);
				totalTokens += tokens;
				totalUsd += usd;

				console.log(
					`  ${entry.contractTitle.slice(0, COL_W).padEnd(COL_W)} ${statusColor}${status.padEnd(10)}${c.reset} ${tokens.toLocaleString().padStart(10)}  $${usd.toFixed(2).padStart(8)}`,
				);
			}

			if (summary.length === 0) {
				console.log(`  ${c.gray}No budget records yet. Run the track first.${c.reset}`);
			} else {
				console.log(`  ${"─".repeat(COL_W)} ${"─".repeat(8)}  ${"─".repeat(9)}  ${"─".repeat(9)}`);
				console.log(
					`  ${"Total".padEnd(COL_W)} ${"".padEnd(10)} ${totalTokens.toLocaleString().padStart(10)}  $${totalUsd.toFixed(2).padStart(8)}`,
				);
			}
			console.log();
		} else {
			// All tracks — summary table
			const statuses = await listTracks();
			if (!statuses.length) {
				console.log("No tracks.");
				return 0;
			}

			console.log(
				`\n${c.bold}${"Track".padEnd(COL_W)} ${"Tokens".padStart(10)}  Est. Cost${c.reset}`,
			);
			console.log(`${"─".repeat(COL_W)} ${"─".repeat(9)}  ${"─".repeat(9)}`);

			for (const ts of statuses) {
				const tokens = ts.cost?.totalTokens ?? 0;
				const usd = ts.cost?.estimatedUsd ?? 0;
				const tokStr = tokens > 0 ? tokens.toLocaleString() : `${c.gray}—${c.reset}`;
				const usdStr = tokens > 0 ? `$${usd.toFixed(2)}` : `${c.gray}—${c.reset}`;
				console.log(`${ts.track.id.padEnd(COL_W)} ${tokStr.padStart(10)}  ${usdStr.padStart(9)}`);
			}
			console.log();
		}
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
