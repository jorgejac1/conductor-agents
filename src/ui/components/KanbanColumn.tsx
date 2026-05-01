import { useEffect, useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { apiPauseTrack, apiResumeTrack, apiRunTrack, fetchIsPaused } from "../hooks/api.js";
import type { EvalResult, TrackStatus, WorkerState } from "../types.js";
import { KanbanCard } from "./KanbanCard.js";

const RUNNING_STATUSES = new Set(["spawning", "running", "verifying", "merging"]);

type ColStatus = "running" | "done-pass" | "done-fail" | "idle" | "paused";

function colStatus(workers: WorkerState[], paused: boolean): ColStatus {
	if (workers.length === 0) return "idle";
	const hasRunning = workers.some((w) => RUNNING_STATUSES.has(w.status));
	if (hasRunning) return paused ? "paused" : "running";
	const allSettled = workers.every((w) => w.status === "done" || w.status === "failed");
	if (!allSettled) return "idle";
	const hasFail = workers.some(
		(w) => w.status === "failed" || w.passed === false || w.verifierPassed === false,
	);
	return hasFail ? "done-fail" : "done-pass";
}

interface KanbanColumnProps {
	trackStatus: TrackStatus;
	workers: WorkerState[];
	evalResults: Record<string, EvalResult>;
}

export { colStatus };

export function KanbanColumn({ trackStatus, workers, evalResults }: KanbanColumnProps) {
	const { showToast, showError, refreshTracks, state } = useDashboard();
	const { track, todoTotal, todoDone, cost } = trackStatus;
	const budgetExceeded =
		trackStatus.budgetExceeded === true || state.budgetExceededTracks.has(track.id);
	const pct = todoTotal > 0 ? Math.round((todoDone / todoTotal) * 100) : 0;
	const [submitting, setSubmitting] = useState(false);
	const [paused, setPaused] = useState(false);
	const [pauseSubmitting, setPauseSubmitting] = useState(false);

	const isRunning = workers.some((w) => RUNNING_STATUSES.has(w.status));
	const noTasks = todoTotal === 0;
	const doneWorkers = workers.filter((w) => w.status === "done" || w.status === "failed").length;
	const failedCount = workers.filter((w) => {
		if (w.status === "failed") return true;
		if (w.status === "done") return (evalResults[w.id]?.passed ?? w.verifierPassed) === false;
		return false;
	}).length;
	const isEmpty = workers.length === 0;

	useEffect(() => {
		fetchIsPaused(track.id)
			.then(setPaused)
			.catch(() => {});
	}, [track.id]);

	async function handleRun() {
		if (isRunning || submitting || noTasks) return;
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

	async function handlePause() {
		setPauseSubmitting(true);
		try {
			await apiPauseTrack(track.id);
			setPaused(true);
			showToast(`Paused ${track.name}`);
		} catch (e) {
			showError(e instanceof Error ? e.message : "Pause failed");
		} finally {
			setPauseSubmitting(false);
		}
	}

	async function handleResume() {
		setPauseSubmitting(true);
		try {
			await apiResumeTrack(track.id);
			setPaused(false);
			showToast(`Resumed ${track.name}`);
			await refreshTracks();
		} catch (e) {
			showError(e instanceof Error ? e.message : "Resume failed");
		} finally {
			setPauseSubmitting(false);
		}
	}

	const status = colStatus(workers, paused);

	return (
		<div className="kanban-col" data-col-status={status} data-empty={isEmpty ? "true" : undefined}>
			<div className="kanban-col-header">
				{/* Row 1: name + actions */}
				<div className="kanban-col-header-top">
					<div className="kanban-col-title-wrap">
						<span className="kanban-col-title">{track.name}</span>
						{status !== "idle" && (
							<span className="kanban-col-status-chip" data-col-status={status}>
								{status === "running"
									? "running"
									: status === "done-pass"
										? "done"
										: status === "done-fail"
											? "failed"
											: status === "paused"
												? "paused"
												: null}
							</span>
						)}
						{budgetExceeded && (
							<span className="badge badge-budget" title="Budget limit exceeded">
								BUDGET
							</span>
						)}
					</div>
					<div className="kanban-col-header-actions">
						{(isRunning || paused) && (
							<button
								type="button"
								className={`btn btn-sm kanban-pause-btn${paused ? " kanban-pause-btn-paused" : ""}`}
								onClick={paused ? handleResume : handlePause}
								disabled={pauseSubmitting}
								title={paused ? "Resume track" : "Pause track"}
							>
								{paused ? "▶" : "⏸"}
							</button>
						)}
						{!isRunning && !noTasks && (
							<button
								type="button"
								className="btn btn-sm kanban-run-btn"
								onClick={handleRun}
								disabled={submitting}
							>
								{submitting ? "Starting…" : workers.length > 0 ? "Run again" : "Run"}
							</button>
						)}
					</div>
				</div>

				{/* Row 2: description + progress (only when there's something to show) */}
				{(track.description || todoTotal > 0) && (
					<div className="kanban-col-header-bottom">
						{track.description && <span className="kanban-col-desc">{track.description}</span>}
						{todoTotal > 0 && (
							<div className="kanban-col-meta">
								<span
									className="kanban-col-worker-count"
									title={`${doneWorkers} of ${workers.length} workers finished`}
								>
									{doneWorkers}/{workers.length} workers
								</span>
								{failedCount > 0 && (
									<span className="kanban-col-fail-count">{failedCount} failed</span>
								)}
								<div className="progress-bar">
									<div className="progress-fill" style={{ width: `${pct}%` }} />
								</div>
								{cost && cost.totalTokens > 0 && (
									<span className="kanban-col-cost-inline">${cost.estimatedUsd.toFixed(3)}</span>
								)}
							</div>
						)}
					</div>
				)}
			</div>

			<div className="kanban-col-body">
				{isEmpty ? (
					<div className="empty-col">
						{noTasks ? (
							<>
								<div className="empty-col-icon">⊘</div>
								<div className="empty-col-text">No tasks configured</div>
								<div className="empty-col-hint">Add tasks to todo.md to enable</div>
							</>
						) : (
							<div className="empty-col-text">no workers yet</div>
						)}
					</div>
				) : (
					workers.map((w) => (
						<KanbanCard
							key={w.id}
							trackId={track.id}
							worker={w}
							evalResult={evalResults[w.id]}
							trackPaused={paused}
						/>
					))
				)}
			</div>
		</div>
	);
}
