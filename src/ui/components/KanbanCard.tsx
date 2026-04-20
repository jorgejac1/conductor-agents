import type React from "react";
import { useCallback, useState } from "react";
import { fetchLog } from "../hooks/api.js";
import type { EvalResult, WorkerState } from "../types.js";

function statusDotClass(worker: WorkerState, evalResult?: EvalResult): string {
	if (worker.status === "done") {
		const passed = evalResult?.passed ?? worker.verifierPassed;
		if (passed === true) return "status-dot status-dot-pass";
		if (passed === false) return "status-dot status-dot-fail";
		return "status-dot status-dot-done";
	}
	if (worker.status === "failed") return "status-dot status-dot-fail";
	return `status-dot status-dot-${worker.status}`;
}

function badgeForWorker(worker: WorkerState, evalResult?: EvalResult): React.ReactNode {
	if (worker.status === "done") {
		const passed = evalResult?.passed ?? worker.verifierPassed;
		if (passed === true) return <span className="badge badge-pass">PASS</span>;
		if (passed === false) return <span className="badge badge-fail-eval">FAILED</span>;
		return <span className="badge badge-done">DONE</span>;
	}
	if (worker.status === "failed") {
		switch (worker.failureKind) {
			case "agent-timeout":
			case "verifier-timeout":
				return <span className="badge badge-timeout">TIMEOUT</span>;
			case "merge-conflict":
				return <span className="badge badge-merge">MERGE</span>;
			case "verifier-fail":
				return <span className="badge badge-fail">FAILED</span>;
			default:
				return <span className="badge badge-error">ERROR</span>;
		}
	}
	return <span className={`badge badge-${worker.status}`}>{worker.status.toUpperCase()}</span>;
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

interface KanbanCardProps {
	trackId: string;
	worker: WorkerState;
	evalResult?: EvalResult;
}

export function KanbanCard({ trackId, worker, evalResult }: KanbanCardProps) {
	const [expanded, setExpanded] = useState(false);
	const [log, setLog] = useState<string>("");
	const [loading, setLoading] = useState(false);

	const toggleLog = useCallback(async () => {
		if (expanded) {
			setExpanded(false);
			return;
		}
		setExpanded(true);
		if (!log) {
			setLoading(true);
			try {
				const text = await fetchLog(trackId, worker.id);
				setLog(text);
			} catch {
				setLog("(failed to load log)");
			} finally {
				setLoading(false);
			}
		}
	}, [expanded, log, trackId, worker.id]);

	const shortId = worker.id.slice(0, 8);

	return (
		<div className="card kanban-card">
			<div className="kanban-card-top">
				<div className="kanban-card-left">
					<div className={statusDotClass(worker, evalResult)} />
					<span className="kanban-card-title">{worker.contractTitle}</span>
				</div>
				{badgeForWorker(worker, evalResult)}
			</div>
			<div className="kanban-card-footer">
				<div>
					<span className="kanban-card-id mono">{shortId}</span>
					{duration(worker) && (
						<span className="kanban-card-id mono" style={{ marginLeft: 8 }}>
							{duration(worker)}
						</span>
					)}
				</div>
				<button type="button" className="kanban-log-toggle" onClick={toggleLog}>
					{expanded ? "hide log ↑" : "logs ↓"}
				</button>
			</div>
			{expanded && (
				<div className="kanban-log-panel">{loading ? "loading…" : log || "(empty log)"}</div>
			)}
		</div>
	);
}
