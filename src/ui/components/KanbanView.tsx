import { useMemo, useRef } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { colStatus, KanbanColumn } from "./KanbanColumn.js";

const STATUS_ORDER: Record<string, number> = {
	running: 0,
	paused: 1,
	"done-fail": 2,
	"done-pass": 3,
	idle: 4,
};

export function KanbanView() {
	const { state } = useDashboard();
	const { tracks, swarmStates, evalResults } = state;

	// Stable track ID list — changes only when tracks are added/removed.
	const trackIds = useMemo(() => tracks.map((t) => t.track.id), [tracks]);

	// Compute sort order once per track-list change (not on every status update).
	// This prevents columns from jumping around during live runs.
	const orderRef = useRef<string[]>([]);
	const prevIdsRef = useRef<string>("");
	const idsKey = trackIds.join(",");

	if (prevIdsRef.current !== idsKey) {
		prevIdsRef.current = idsKey;
		const sorted = [...tracks].sort((a, b) => {
			// Tracks with no tasks always go last
			const aEmpty = a.todoTotal === 0;
			const bEmpty = b.todoTotal === 0;
			if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;

			const wa = (swarmStates[a.track.id] ?? a.swarmState)?.workers ?? [];
			const wb = (swarmStates[b.track.id] ?? b.swarmState)?.workers ?? [];
			const sa = STATUS_ORDER[colStatus(wa, false)] ?? 9;
			const sb = STATUS_ORDER[colStatus(wb, false)] ?? 9;
			return sa - sb;
		});
		orderRef.current = sorted.map((t) => t.track.id);
	}

	if (tracks.length === 0) {
		return (
			<div className="tracks-empty">
				No tracks configured. Run{" "}
				<span style={{ fontFamily: "var(--font-mono)" }}>conductor add &lt;name&gt;</span> to create
				one.
			</div>
		);
	}

	const trackMap = new Map(tracks.map((t) => [t.track.id, t]));
	const ordered = orderRef.current
		.map((id) => trackMap.get(id))
		.filter((t): t is NonNullable<typeof t> => t !== undefined);

	return (
		<div className="kanban">
			{ordered.map((ts) => {
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
