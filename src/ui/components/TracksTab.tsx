import { useCallback, useEffect, useState } from "react";
import { GraphView } from "./GraphView.js";
import { KanbanView } from "./KanbanView.js";

type ViewMode = "kanban" | "graph";

function getInitialView(): ViewMode {
	try {
		const stored = localStorage.getItem("conductor.tracksView");
		if (stored === "kanban" || stored === "graph") return stored;
	} catch {}
	return "kanban";
}

function KanbanIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
			<rect x="1" y="2" width="3" height="10" rx="1" fill="currentColor" />
			<rect x="5.5" y="2" width="3" height="10" rx="1" fill="currentColor" />
			<rect x="10" y="2" width="3" height="10" rx="1" fill="currentColor" />
		</svg>
	);
}

function GraphIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
			<circle cx="7" cy="7" r="2.5" fill="currentColor" />
			<circle cx="7" cy="2" r="1.5" fill="currentColor" opacity="0.7" />
			<circle cx="12" cy="9.5" r="1.5" fill="currentColor" opacity="0.7" />
			<circle cx="2" cy="9.5" r="1.5" fill="currentColor" opacity="0.7" />
			<line x1="7" y1="3.5" x2="7" y2="4.5" stroke="currentColor" strokeWidth="1" opacity="0.5" />
			<line
				x1="10.7"
				y1="8.7"
				x2="9.2"
				y2="7.9"
				stroke="currentColor"
				strokeWidth="1"
				opacity="0.5"
			/>
			<line
				x1="3.3"
				y1="8.7"
				x2="4.8"
				y2="7.9"
				stroke="currentColor"
				strokeWidth="1"
				opacity="0.5"
			/>
		</svg>
	);
}

export function TracksTab() {
	const [view, setView] = useState<ViewMode>(getInitialView);

	const switchView = useCallback((v: ViewMode) => {
		setView(v);
		try {
			localStorage.setItem("conductor.tracksView", v);
		} catch {}
	}, []);

	// Reset to kanban when viewport enters mobile width — graph is unusable there.
	useEffect(() => {
		const mq = window.matchMedia("(max-width: 768px)");
		function onMqChange(e: MediaQueryListEvent) {
			if (e.matches) switchView("kanban");
		}
		mq.addEventListener("change", onMqChange);
		if (mq.matches) switchView("kanban");
		return () => mq.removeEventListener("change", onMqChange);
	}, [switchView]);

	return (
		<div className="tracks-tab">
			<div className="tracks-toolbar">
				<div className="view-toggle">
					<button
						type="button"
						className={`view-toggle-btn${view === "kanban" ? " active" : ""}`}
						onClick={() => switchView("kanban")}
					>
						<KanbanIcon />
						<span>Kanban</span>
					</button>
					<button
						type="button"
						className={`view-toggle-btn${view === "graph" ? " active" : ""}`}
						onClick={() => switchView("graph")}
					>
						<GraphIcon />
						<span>Graph</span>
					</button>
				</div>
			</div>

			<div className={`tracks-view-wrap${view === "graph" ? " graph-mode" : ""}`}>
				{view === "kanban" ? <KanbanView /> : <GraphView />}
			</div>
		</div>
	);
}
