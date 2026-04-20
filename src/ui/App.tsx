import { useEffect, useState } from "react";
import { ActivityTab } from "./components/ActivityTab.js";
import { HistoryTab } from "./components/HistoryTab.js";
import { NavBar } from "./components/NavBar.js";
import { SettingsTab } from "./components/SettingsTab.js";
import { StatusBar } from "./components/StatusBar.js";
import { Toast } from "./components/Toast.js";
import { TracksTab } from "./components/TracksTab.js";
import { WorkersTab } from "./components/WorkersTab.js";
import { useDashboard } from "./context/DashboardContext.js";
import type { TabId } from "./types.js";

const TAB_KEYS: Record<string, TabId> = {
	"1": "tracks",
	"2": "workers",
	"3": "history",
	"4": "activity",
	"5": "settings",
};

export function App() {
	const { state, connectionStatus, toast } = useDashboard();
	const [activeTab, setActiveTab] = useState<TabId>("tracks");

	// Keyboard shortcuts: 1-5 switch tabs
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			// Don't intercept when typing in an input
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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

			<main className="tab-content">
				{activeTab === "tracks" && <TracksTab />}
				{activeTab === "workers" && <WorkersTab />}
				{activeTab === "history" && <HistoryTab />}
				{activeTab === "activity" && <ActivityTab />}
				{activeTab === "settings" && <SettingsTab />}
			</main>

			<StatusBar tracks={state.tracks} lastUpdate={state.lastUpdate} />

			{toast && <Toast key={toast.id} text={toast.text} kind={toast.kind} />}
		</div>
	);
}
