import { useDashboard } from "../context/DashboardContext.js";
import { KanbanColumn } from "./KanbanColumn.js";

export function KanbanView() {
	const { state } = useDashboard();
	const { tracks, swarmStates, evalResults } = state;

	if (tracks.length === 0) {
		return (
			<div className="tracks-empty">
				No tracks configured. Run{" "}
				<span style={{ fontFamily: "var(--font-mono)" }}>conductor add &lt;name&gt;</span> to create
				one.
			</div>
		);
	}

	return (
		<div className="kanban">
			{tracks.map((ts) => {
				const swarm = swarmStates[ts.track.id] ?? ts.swarmState;
				const workers = swarm?.workers ?? [];
				return (
					<KanbanColumn
						key={ts.track.id}
						trackStatus={ts}
						workers={workers}
						evalResults={evalResults}
					/>
				);
			})}
		</div>
	);
}
