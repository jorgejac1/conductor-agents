import { useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { apiRunTrack } from "../hooks/api.js";
import type { EvalResult, TrackStatus, WorkerState } from "../types.js";
import { KanbanCard } from "./KanbanCard.js";

const RUNNING_STATUSES = new Set(["spawning", "running", "verifying", "merging"]);

interface KanbanColumnProps {
	trackStatus: TrackStatus;
	workers: WorkerState[];
	evalResults: Record<string, EvalResult>;
}

export function KanbanColumn({ trackStatus, workers, evalResults }: KanbanColumnProps) {
	const { showToast, showError, refreshTracks } = useDashboard();
	const { track, todoTotal, todoDone, cost } = trackStatus;
	const pct = todoTotal > 0 ? Math.round((todoDone / todoTotal) * 100) : 0;
	const [submitting, setSubmitting] = useState(false);

	const isRunning = workers.some((w) => RUNNING_STATUSES.has(w.status));
	const btnDisabled = isRunning || submitting;
	const btnLabel = isRunning
		? "Running…"
		: submitting
			? "Starting…"
			: workers.length > 0
				? "Run again"
				: "Run";

	async function handleRun() {
		if (btnDisabled) return;
		setSubmitting(true);
		try {
			await apiRunTrack(track.id);
			showToast(`Started ${track.name}`);
			await refreshTracks();
		} catch (e) {
			showError(e instanceof Error ? e.message : "Run failed");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="kanban-col">
			<div className="kanban-col-header">
				<span className="kanban-col-title">{track.name}</span>
				<div className="kanban-col-meta">
					<span>
						{todoDone}/{todoTotal}
					</span>
					<div className="progress-bar">
						<div className="progress-fill" style={{ width: `${pct}%` }} />
					</div>
				</div>
			</div>

			{workers.length === 0 ? (
				<div className="card empty-col">
					<div style={{ marginBottom: 10, color: "var(--muted)" }}>no workers</div>
					<button
						type="button"
						className="btn btn-sm run-btn-col"
						onClick={handleRun}
						disabled={btnDisabled}
					>
						{btnLabel}
					</button>
				</div>
			) : (
				workers.map((w) => (
					<KanbanCard key={w.id} trackId={track.id} worker={w} evalResult={evalResults[w.id]} />
				))
			)}

			{workers.length > 0 && (
				<button
					type="button"
					className="btn btn-sm run-btn-col"
					onClick={handleRun}
					disabled={btnDisabled}
				>
					{btnLabel}
				</button>
			)}

			{cost && cost.totalTokens > 0 && (
				<div className="kanban-col-cost">
					<span>{(cost.totalTokens / 1000).toFixed(1)}k tok</span>
					<span className="kanban-col-cost-sep">·</span>
					<span>${cost.estimatedUsd.toFixed(3)}</span>
				</div>
			)}
		</div>
	);
}
