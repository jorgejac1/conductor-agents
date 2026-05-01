import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { WorkerCard } from "./WorkerCard.js";

type StatusFilter = "all" | "running" | "done" | "failed" | "pending";
const STATUS_OPTIONS: StatusFilter[] = ["all", "running", "done", "failed", "pending"];

const PREF_KEY = "conductor:workers-status-filter";

export function WorkersTab() {
	const { state } = useDashboard();
	const { tracks, swarmStates, evalResults } = state;
	const [selectedTrackId, setSelectedTrackId] = useState<string | null>(
		tracks[0]?.track.id ?? null,
	);
	const [query, setQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
		try {
			return (localStorage.getItem(PREF_KEY) as StatusFilter | null) ?? "all";
		} catch {
			return "all";
		}
	});
	const searchRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		try {
			localStorage.setItem(PREF_KEY, statusFilter);
		} catch {
			/* ignore */
		}
	}, [statusFilter]);

	const activeId = selectedTrackId ?? tracks[0]?.track.id ?? null;
	const activeTrack = tracks.find((t) => t.track.id === activeId);
	const allWorkers = activeId
		? (swarmStates[activeId]?.workers ?? activeTrack?.swarmState?.workers ?? [])
		: [];

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return allWorkers.filter((w) => {
			if (statusFilter !== "all" && w.status !== statusFilter) return false;
			if (q && !w.contractTitle.toLowerCase().includes(q) && !w.id.includes(q)) return false;
			return true;
		});
	}, [allWorkers, statusFilter, query]);

	if (tracks.length === 0) {
		return <div className="workers-empty">No tracks configured.</div>;
	}

	return (
		<div className="workers-layout">
			<div className="workers-sidebar">
				<div className="workers-sidebar-label">Tracks</div>
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
				<div className="workers-filters">
					<input
						ref={searchRef}
						className="workers-search"
						type="text"
						placeholder="Search workers…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
					<div className="filter-pills">
						{STATUS_OPTIONS.map((s) => (
							<button
								key={s}
								type="button"
								className={`filter-pill${statusFilter === s ? " active" : ""}`}
								onClick={() => setStatusFilter(s)}
							>
								{s}
							</button>
						))}
					</div>
				</div>

				{filtered.length === 0 ? (
					<div className="workers-empty">
						{allWorkers.length === 0
							? "No workers for this track."
							: "No workers match the current filter."}
					</div>
				) : (
					filtered.map((w) => (
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
