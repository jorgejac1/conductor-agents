import { useCallback, useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { apiRetryWorker, fetchLog } from "../hooks/api.js";
import type { EvalResult, TrackStatus, WorkerState } from "../types.js";

function statusColor(worker: WorkerState, evalResult?: EvalResult): string {
	if (worker.status === "done") {
		const passed = evalResult?.passed ?? worker.verifierPassed;
		if (passed === true) return "var(--pass)";
		if (passed === false) return "var(--fail)";
	}
	if (worker.status === "failed") return "var(--fail)";
	if (["spawning", "running", "verifying", "merging"].includes(worker.status))
		return "var(--running)";
	return "var(--muted)";
}

function statusLabel(worker: WorkerState, evalResult?: EvalResult): string {
	if (worker.status === "done") {
		const passed = evalResult?.passed ?? worker.verifierPassed;
		if (passed === true) return "PASS";
		if (passed === false) return "FAILED";
		return "DONE";
	}
	if (worker.status === "failed") return "ERROR";
	return worker.status.toUpperCase();
}

function duration(worker: WorkerState): string {
	if (!worker.startedAt) return "";
	const start = new Date(worker.startedAt).getTime();
	const end = worker.finishedAt ? new Date(worker.finishedAt).getTime() : Date.now();
	if (Number.isNaN(start) || Number.isNaN(end)) return "";
	const sec = Math.floor((end - start) / 1000);
	if (sec < 60) return `${sec}s`;
	return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function PanelWorkerRow({
	trackId,
	worker,
	evalResult,
	focused,
	onClick,
}: {
	trackId: string;
	worker: WorkerState;
	evalResult?: EvalResult;
	focused: boolean;
	onClick: () => void;
}) {
	const { showToast, showError, refreshTracks } = useDashboard();
	const [log, setLog] = useState("");
	const [loadingLog, setLoadingLog] = useState(false);
	const [logOpen, setLogOpen] = useState(false);

	const toggleLog = useCallback(async () => {
		if (logOpen) {
			setLogOpen(false);
			return;
		}
		setLogOpen(true);
		if (!log) {
			setLoadingLog(true);
			try {
				setLog(await fetchLog(trackId, worker.id));
			} catch {
				setLog("(failed to load log)");
			} finally {
				setLoadingLog(false);
			}
		}
	}, [logOpen, log, trackId, worker.id]);

	async function handleRetry() {
		try {
			await apiRetryWorker(trackId, worker.id);
			showToast("Worker retried");
			await refreshTracks();
		} catch (e) {
			showError(e instanceof Error ? e.message : "Retry failed");
		}
	}

	const color = statusColor(worker, evalResult);
	const label = statusLabel(worker, evalResult);
	const dur = duration(worker);

	return (
		<button
			type="button"
			className={`panel-worker-row${focused ? " focused" : ""}`}
			onClick={onClick}
		>
			<div className="panel-worker-row-top">
				<div className="panel-worker-left">
					<div className="panel-worker-dot" style={{ background: color }} />
					<div>
						<div className="panel-worker-title">{worker.contractTitle}</div>
						<div className="panel-worker-meta">
							<span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
								{worker.id.slice(0, 8)}
							</span>
							{dur && <span style={{ fontSize: 10, color: "var(--muted)" }}>{dur}</span>}
						</div>
					</div>
				</div>
				<div className="panel-worker-actions">
					<span className="panel-worker-badge" style={{ color }}>
						{label}
					</span>
					{worker.status === "failed" && (
						<button
							type="button"
							className="btn btn-sm"
							onClick={(e) => {
								e.stopPropagation();
								void handleRetry();
							}}
						>
							Retry
						</button>
					)}
					<button
						type="button"
						className="btn btn-sm"
						onClick={(e) => {
							e.stopPropagation();
							void toggleLog();
						}}
					>
						{logOpen ? "Hide" : "Logs"}
					</button>
				</div>
			</div>
			{logOpen && (
				<div className="worker-log-panel">{loadingLog ? "loading…" : log || "(empty log)"}</div>
			)}
		</button>
	);
}

interface GraphDetailPanelProps {
	trackStatus: TrackStatus;
	workers: WorkerState[];
	evalResults: Record<string, EvalResult>;
	focusedWorkerId: string | null;
	onClose: () => void;
	onWorkerClick: (id: string) => void;
}

export function GraphDetailPanel({
	trackStatus,
	workers,
	evalResults,
	focusedWorkerId,
	onClose,
	onWorkerClick,
}: GraphDetailPanelProps) {
	const { track, todoDone, todoTotal, cost } = trackStatus;
	const pct = todoTotal > 0 ? Math.round((todoDone / todoTotal) * 100) : 0;

	return (
		<div className="graph-detail-panel">
			<div className="graph-detail-header">
				<div>
					<div className="graph-detail-track-name">{track.name}</div>
					<div className="graph-detail-track-meta">
						{todoDone}/{todoTotal} done · {pct}%{cost && ` · $${cost.estimatedUsd.toFixed(3)}`}
					</div>
				</div>
				<button type="button" className="graph-detail-close" onClick={onClose}>
					✕
				</button>
			</div>

			<div className="graph-detail-body">
				{workers.length === 0 ? (
					<div className="graph-detail-empty">No workers yet</div>
				) : (
					workers.map((w) => (
						<PanelWorkerRow
							key={w.id}
							trackId={track.id}
							worker={w}
							evalResult={evalResults[w.id]}
							focused={focusedWorkerId === w.id}
							onClick={() => onWorkerClick(w.id)}
						/>
					))
				)}
			</div>
		</div>
	);
}
