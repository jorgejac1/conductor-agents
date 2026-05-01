import { useEffect, useState } from "react";
import { ActivityTab } from "./components/ActivityTab.js";
import { MemoryTab } from "./components/MemoryTab.js";
import { NavBar } from "./components/NavBar.js";
import { SettingsTab } from "./components/SettingsTab.js";
import { StatusBar } from "./components/StatusBar.js";
import { Toast } from "./components/Toast.js";
import { TracksTab } from "./components/TracksTab.js";
import { WorkersTab } from "./components/WorkersTab.js";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar.js";
import { useDashboard } from "./context/DashboardContext.js";
import type { TabId } from "./types.js";

const TAB_KEYS: Record<string, TabId> = {
	"1": "tracks",
	"2": "workers",
	"3": "activity",
	"4": "memory",
	"5": "settings",
};

export function App() {
	const { state, connectionStatus, toast } = useDashboard();
	const [activeTab, setActiveTab] = useState<TabId>("tracks");
	const [showHelp, setShowHelp] = useState(false);

	// Keyboard shortcuts: 1-5 switch tabs, ? toggles help
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			// Don't intercept when typing in an input
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			if (e.key === "?") {
				setShowHelp((prev) => !prev);
				return;
			}
			if (e.key === "Escape") {
				setShowHelp(false);
				return;
			}
			const tab = TAB_KEYS[e.key];
			if (tab) setActiveTab(tab);
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	const runningCount = Object.values(state.swarmStates).reduce((sum, swarm) => {
		return (
			sum +
			swarm.workers.filter(
				(w) =>
					w.status === "running" ||
					w.status === "spawning" ||
					w.status === "verifying" ||
					w.status === "merging",
			).length
		);
	}, 0);

	return (
		<div className="app">
			<NavBar
				activeTab={activeTab}
				onTabChange={setActiveTab}
				connectionStatus={connectionStatus}
				runningCount={runningCount}
			/>

			<div className="app-body">
				<WorkspaceSidebar />
				<main className="tab-content">
					{activeTab === "tracks" && <TracksTab />}
					{activeTab === "workers" && <WorkersTab />}
					{activeTab === "activity" && <ActivityTab />}
					{activeTab === "memory" && <MemoryTab />}
					{activeTab === "settings" && <SettingsTab />}
				</main>
			</div>

			<StatusBar tracks={state.tracks} lastUpdate={state.lastUpdate} />

			{toast && <Toast key={toast.id} text={toast.text} kind={toast.kind} />}

			{showHelp && (
				<button
					type="button"
					className="shortcut-help-overlay"
					aria-label="Close keyboard shortcuts"
					onClick={() => setShowHelp(false)}
				>
					<div
						className="shortcut-help-box"
						role="dialog"
						aria-label="Keyboard shortcuts"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<div className="shortcut-help-title">Keyboard Shortcuts</div>
						<div className="shortcut-help-list">
							<div className="shortcut-help-row">
								<span className="shortcut-key">1–5</span>
								<span className="shortcut-desc">Switch tabs</span>
							</div>
							<div className="shortcut-help-row">
								<span className="shortcut-key">r</span>
								<span className="shortcut-desc">Run selected track (graph view)</span>
							</div>
							<div className="shortcut-help-row">
								<span className="shortcut-key">↑ ↓</span>
								<span className="shortcut-desc">Cycle workers in selected track</span>
							</div>
							<div className="shortcut-help-row">
								<span className="shortcut-key">Esc</span>
								<span className="shortcut-desc">Deselect / close panel</span>
							</div>
							<div className="shortcut-help-row">
								<span className="shortcut-key">?</span>
								<span className="shortcut-desc">Toggle this overlay</span>
							</div>
						</div>
						<div className="shortcut-help-close">Click outside or press Esc to close</div>
					</div>
				</button>
			)}
		</div>
	);
}
