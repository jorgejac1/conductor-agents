import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { apiRetryWorker } from "../hooks/api.js";
import { useLogStream } from "../hooks/useLogStream.js";
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

function failureKindBadge(kind: string | undefined): { label: string; cls: string } | null {
	if (!kind) return null;
	switch (kind) {
		case "agent-timeout":
		case "verifier-timeout":
			return { label: "TIMEOUT", cls: "badge-timeout" };
		case "merge-conflict":
			return { label: "MERGE", cls: "badge-merge" };
		case "verifier-fail":
			return { label: "FAILED", cls: "badge-fail" };
		default:
			return { label: "ERROR", cls: "badge-error" };
	}
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
	const isRunning = ["spawning", "running", "verifying", "merging"].includes(worker.status);
	// Auto-open log panel for running workers so output streams in real time.
	const [logOpen, setLogOpen] = useState(isRunning);
	const logPanelRef = useRef<HTMLDivElement>(null);

	const { log, isStreaming } = useLogStream(trackId, worker.id, isRunning);

	// Auto-scroll to bottom when new content arrives while streaming.
	// biome-ignore lint/correctness/useExhaustiveDependencies: log triggers scroll on each new chunk
	useEffect(() => {
		if (isStreaming && logPanelRef.current) {
			logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
		}
	}, [log, isStreaming]);

	const toggleLog = useCallback(() => {
		setLogOpen((prev) => !prev);
	}, []);

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
	const fkBadge = worker.status === "failed" ? failureKindBadge(worker.failureKind) : null;

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
					{fkBadge ? (
						<span className={`panel-worker-badge ${fkBadge.cls}`}>{fkBadge.label}</span>
					) : (
						<span className="panel-worker-badge" style={{ color }}>
							{label}
						</span>
					)}
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
							toggleLog();
						}}
					>
						{logOpen ? "Hide" : "Logs"}
					</button>
				</div>
			</div>
			{logOpen && (
				<div className="worker-log-panel" ref={logPanelRef}>
					{log || (isStreaming ? "waiting for output…" : "(empty log)")}
				</div>
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
