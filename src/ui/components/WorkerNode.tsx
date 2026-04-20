import type { EvalResult, WorkerState } from "../types.js";

const RUNNING_STATUSES = new Set(["spawning", "running", "verifying", "merging"]);

function workerColor(worker: WorkerState, evalResult?: EvalResult): string {
	if (RUNNING_STATUSES.has(worker.status)) return "var(--running)";
	if (worker.status === "done") {
		const passed = evalResult?.passed ?? worker.verifierPassed;
		if (passed === true) return "var(--pass)";
		if (passed === false) return "var(--fail)";
		return "var(--muted-bright)";
	}
	if (worker.status === "failed") return "var(--fail)";
	if (worker.status === "pending") return "var(--pending)";
	return "var(--muted)";
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

interface WorkerNodeProps {
	worker: WorkerState;
	evalResult?: EvalResult;
	x: number;
	y: number;
	dimmed: boolean;
	onHover: (id: string | null) => void;
	onClick: (id: string) => void;
}

export function WorkerNode({
	worker,
	evalResult,
	x,
	y,
	dimmed,
	onHover,
	onClick,
}: WorkerNodeProps) {
	const color = workerColor(worker, evalResult);
	const isRunning = RUNNING_STATUSES.has(worker.status);
	const dur = duration(worker);

	return (
		<button
			type="button"
			className={`graph-worker-node${isRunning ? " running" : ""}`}
			aria-label={worker.contractTitle}
			style={
				{
					left: x,
					top: y,
					opacity: dimmed ? 0.1 : 1,
					"--worker-color": color,
				} as React.CSSProperties
			}
			onMouseEnter={() => onHover(worker.id)}
			onMouseLeave={() => onHover(null)}
			onClick={() => onClick(worker.id)}
		>
			<div className="graph-worker-dot" />
			{/* Tooltip */}
			<div className="graph-worker-tooltip">
				<div className="graph-worker-tooltip-title">{worker.contractTitle}</div>
				<div className="graph-worker-tooltip-meta">
					<span>{worker.status.toUpperCase()}</span>
					{dur && <span>{dur}</span>}
				</div>
			</div>
		</button>
	);
}
