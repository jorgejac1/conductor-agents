import { useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { WorkerCard } from "./WorkerCard.js";

export function WorkersTab() {
	const { state } = useDashboard();
	const { tracks, swarmStates, evalResults } = state;
	const [selectedTrackId, setSelectedTrackId] = useState<string | null>(
		tracks[0]?.track.id ?? null,
	);

	if (tracks.length === 0) {
		return <div className="workers-empty">No tracks configured.</div>;
	}

	const activeId = selectedTrackId ?? tracks[0]?.track.id ?? null;
	const activeTrack = tracks.find((t) => t.track.id === activeId);
	const workers = activeId
		? (swarmStates[activeId]?.workers ?? activeTrack?.swarmState?.workers ?? [])
		: [];

	return (
		<div className="workers-layout">
			<div className="workers-sidebar">
				{tracks.map((ts) => {
					const swarm = swarmStates[ts.track.id] ?? ts.swarmState;
					const count = swarm?.workers.length ?? 0;
					return (
						<button
							type="button"
							key={ts.track.id}
							className={`sidebar-track${activeId === ts.track.id ? " active" : ""}`}
							onClick={() => setSelectedTrackId(ts.track.id)}
						>
							<span className="sidebar-track-name">{ts.track.name}</span>
							<span className="sidebar-track-count">{count}</span>
						</button>
					);
				})}
			</div>

			<div className="workers-content">
				{workers.length === 0 ? (
					<div className="workers-empty">No workers for this track.</div>
				) : (
					workers.map((w) => (
						<WorkerCard
							key={w.id}
							trackId={activeId ?? ""}
							worker={w}
							evalResult={evalResults[w.id]}
						/>
					))
				)}
			</div>
		</div>
	);
}
