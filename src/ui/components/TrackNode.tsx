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

// Shows worker pass-rate, not todo completion: "2/3 passed" → "67%"
// Returns "—" for no workers, "…" for in-flight with no settled yet
function nodeLabel(workers: WorkerState[], evalResults: Record<string, EvalResult>): string {
	if (workers.length === 0) return "—";
	const settled = workers.filter((w) => w.status === "done" || w.status === "failed");
	if (settled.length === 0) return "…";
	const passed = settled.filter((w) => {
		const ev = evalResults[w.id];
		const p = ev?.passed ?? w.verifierPassed;
		return p === true;
	}).length;
	return `${Math.round((passed / settled.length) * 100)}%`;
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
	const { track, cost } = trackStatus;
	const color = trackStatusColor(workers, evalResults);
	const running = isRunning(workers);
	const label = nodeLabel(workers, evalResults);

	return (
		<button
			type="button"
			className={`graph-track-node${selected ? " selected" : ""}${running ? " running" : ""}`}
			aria-label={`${track.name} — ${label}`}
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
			<div className="graph-track-ring" />
			<div className="graph-track-circle">
				<span className="graph-track-label-inner">{label}</span>
			</div>
			<div className="graph-track-label">{track.name}</div>
			{cost && cost.estimatedUsd > 0 && (
				<div className="graph-track-cost">${cost.estimatedUsd.toFixed(3)}</div>
			)}
		</button>
	);
}
