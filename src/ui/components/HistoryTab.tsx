import { useEffect, useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import type { HistoryOptions } from "../hooks/api.js";
import { fetchHistory } from "../hooks/api.js";
import type { RunRecord } from "../types.js";

function fmtDate(ts: string): string {
	return new Date(ts).toLocaleString([], {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function fmtDuration(ms?: number): string {
	if (ms === undefined || ms === null) return "—";
	if (ms < 1000) return `${ms}ms`;
	const sec = Math.floor(ms / 1000);
	if (sec < 60) return `${sec}s`;
	return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function HistoryTab() {
	const { state, showError } = useDashboard();
	const { tracks } = state;
	const [selectedTrack, setSelectedTrack] = useState<string>("all");
	const [resultFilter, setResultFilter] = useState<"all" | "pass" | "fail">("all");
	const [fromDate, setFromDate] = useState("");
	const [toDate, setToDate] = useState("");
	const [records, setRecords] = useState<RunRecord[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function load() {
			setLoading(true);
			try {
				const ids = selectedTrack === "all" ? tracks.map((t) => t.track.id) : [selectedTrack];
				const opts: HistoryOptions = { limit: 200 };
				if (resultFilter !== "all") opts.result = resultFilter;
				if (fromDate) opts.from = new Date(fromDate).toISOString();
				if (toDate) opts.to = new Date(`${toDate}T23:59:59`).toISOString();

				const results = await Promise.all(ids.map((id) => fetchHistory(id, opts)));
				const flat = results
					.flat()
					.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
					.slice(0, 200);
				setRecords(flat);
			} catch (e) {
				showError(e instanceof Error ? e.message : "Failed to load history");
			} finally {
				setLoading(false);
			}
		}
		void load();
	}, [selectedTrack, resultFilter, fromDate, toDate, tracks, showError]);

	function exportCsv() {
		const header = "date,track,title,result,duration,trigger\n";
		const rows = records.map((r) =>
			[
				fmtDate(r.ts),
				r.trackId,
				`"${r.contractTitle.replace(/"/g, '""')}"`,
				r.passed ? "PASS" : "FAIL",
				fmtDuration(r.durationMs),
				r.trigger ?? "manual",
			].join(","),
		);
		const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "conductor-history.csv";
		a.click();
		URL.revokeObjectURL(url);
	}

	return (
		<div>
			<div className="history-controls">
				<select
					className="history-select"
					value={selectedTrack}
					onChange={(e) => setSelectedTrack(e.target.value)}
				>
					<option value="all">All tracks</option>
					{tracks.map((t) => (
						<option key={t.track.id} value={t.track.id}>
							{t.track.name}
						</option>
					))}
				</select>
				<div className="filter-pills">
					{(["all", "pass", "fail"] as const).map((f) => (
						<button
							key={f}
							type="button"
							className={`filter-pill${resultFilter === f ? " active" : ""}`}
							onClick={() => setResultFilter(f)}
						>
							{f.toUpperCase()}
						</button>
					))}
				</div>
				<input
					type="date"
					className="history-date"
					title="From date"
					value={fromDate}
					onChange={(e) => setFromDate(e.target.value)}
				/>
				<input
					type="date"
					className="history-date"
					title="To date"
					value={toDate}
					onChange={(e) => setToDate(e.target.value)}
				/>
				<button type="button" className="btn btn-sm" onClick={exportCsv}>
					Export CSV
				</button>
			</div>

			{loading ? (
				<div style={{ color: "var(--muted)", fontSize: 12, padding: 20 }}>Loading…</div>
			) : records.length === 0 ? (
				<div className="history-empty">No history yet.</div>
			) : (
				<div className="history-table-wrap">
					<table className="history-table">
						<thead>
							<tr>
								<th>Date</th>
								<th>Track</th>
								<th>Task</th>
								<th>Result</th>
								<th>Duration</th>
								<th>Trigger</th>
							</tr>
						</thead>
						<tbody>
							{records.map((r) => (
								<tr key={r.id}>
									<td className="col-mono">{fmtDate(r.ts)}</td>
									<td className="col-mono">{r.trackId}</td>
									<td className="col-title">{r.contractTitle}</td>
									<td>
										<span className={`badge ${r.passed ? "badge-pass" : "badge-fail-eval"}`}>
											{r.passed ? "PASS" : "FAIL"}
										</span>
									</td>
									<td className="col-mono">{fmtDuration(r.durationMs)}</td>
									<td className="col-mono text-muted">{r.trigger ?? "manual"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
