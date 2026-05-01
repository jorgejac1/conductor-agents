import { useDashboard } from "../context/DashboardContext.js";
import type { TrackStatus } from "../types.js";

interface StatusBarProps {
	tracks: TrackStatus[];
	lastUpdate: Date | null;
}

export function StatusBar({ tracks, lastUpdate }: StatusBarProps) {
	const { selectedProjectId } = useDashboard();

	let total = 0;
	let done = 0;
	let running = 0;
	let failed = 0;
	let totalUsd = 0;

	for (const t of tracks) {
		const workers = t.swarmState?.workers ?? [];
		total += workers.length;
		for (const w of workers) {
			if (w.status === "done") done++;
			else if (
				w.status === "running" ||
				w.status === "spawning" ||
				w.status === "verifying" ||
				w.status === "merging"
			)
				running++;
			else if (w.status === "failed") failed++;
		}
		totalUsd += t.cost?.estimatedUsd ?? 0;
	}

	const timeStr = lastUpdate
		? lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
		: "—";

	return (
		<footer className="status-bar">
			{selectedProjectId && (
				<div className="stat-item stat-project">
					<span className="stat-project-name">{selectedProjectId}</span>
				</div>
			)}
			<div className="stat-item">
				<span>workers</span>
				<span className="stat-value">{total}</span>
			</div>
			<div className="stat-item">
				<span>done</span>
				<span className="stat-value pass">{done}</span>
			</div>
			{running > 0 && (
				<div className="stat-item">
					<span>running</span>
					<span className="stat-value running">{running}</span>
				</div>
			)}
			{failed > 0 && (
				<div className="stat-item">
					<span>failed</span>
					<span className="stat-value fail">{failed}</span>
				</div>
			)}
			{totalUsd > 0 && (
				<div className="stat-item">
					<span>cost</span>
					<span className="stat-value">${totalUsd.toFixed(4)}</span>
				</div>
			)}
			<div className="status-bar-spacer" />
			<span className="last-update">updated {timeStr}</span>
		</footer>
	);
}
