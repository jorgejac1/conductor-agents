import type { EvalResult, TrackStatus, WorkerState } from "../types.js";

const RUNNING_STATUSES = new Set(["spawning", "running", "verifying", "merging"]);

function trackStatusColor(workers: WorkerState[], evalResults: Record<string, EvalResult>): string {
	if (workers.length === 0) return "var(--border)";
	const hasRunning = workers.some((w) => RUNNING_STATUSES.has(w.status));
	if (hasRunning) return "var(--running)";
	const terminal = workers.filter((w) => w.status === "done" || w.status === "failed");
	if (terminal.length === 0) return "var(--border)";
	const hasFail = terminal.some((w) => {
		const ev = evalResults[w.id];
		const passed = ev?.passed ?? w.verifierPassed;
		return passed === false || w.status === "failed";
	});
	return hasFail ? "var(--fail)" : "var(--pass)";
}

function isRunning(workers: WorkerState[]): boolean {
	return workers.some((w) => RUNNING_STATUSES.has(w.status));
}

interface TrackNodeProps {
	trackStatus: TrackStatus;
	workers: WorkerState[];
	evalResults: Record<string, EvalResult>;
	x: number;
	y: number;
	dimmed: boolean;
	selected: boolean;
	onHover: (id: string | null) => void;
	onClick: (id: string) => void;
}

export function TrackNode({
	trackStatus,
	workers,
	evalResults,
	x,
	y,
	dimmed,
	selected,
	onHover,
	onClick,
}: TrackNodeProps) {
	const { track, todoDone, todoTotal, cost } = trackStatus;
	const color = trackStatusColor(workers, evalResults);
	const running = isRunning(workers);
	const pct = todoTotal > 0 ? Math.round((todoDone / todoTotal) * 100) : 0;

	return (
		<button
			type="button"
			className={`graph-track-node${selected ? " selected" : ""}${running ? " running" : ""}`}
			aria-label={`${track.name} — ${pct}% complete`}
			aria-pressed={selected}
			style={
				{
					left: x,
					top: y,
					opacity: dimmed ? 0.15 : 1,
					"--node-color": color,
				} as React.CSSProperties
			}
			onMouseEnter={() => onHover(track.id)}
			onMouseLeave={() => onHover(null)}
			onClick={() => onClick(track.id)}
		>
			{/* Outer pulse ring */}
			<div className="graph-track-ring" />
			{/* Inner circle */}
			<div className="graph-track-circle">
				<span className="graph-track-label-inner">{pct}%</span>
			</div>
			{/* Label below */}
			<div className="graph-track-label">{track.name}</div>
			{/* Cost tag */}
			{cost && <div className="graph-track-cost">${cost.estimatedUsd.toFixed(3)}</div>}
		</button>
	);
}
