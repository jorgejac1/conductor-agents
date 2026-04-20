import type { ConnectionStatus, TabId } from "../types.js";

const TABS: { id: TabId; label: string; key: string }[] = [
	{ id: "tracks", label: "Tracks", key: "1" },
	{ id: "workers", label: "Workers", key: "2" },
	{ id: "history", label: "History", key: "3" },
	{ id: "activity", label: "Activity", key: "4" },
	{ id: "settings", label: "Settings", key: "5" },
];

interface NavBarProps {
	activeTab: TabId;
	onTabChange: (tab: TabId) => void;
	connectionStatus: ConnectionStatus;
	runningCount: number;
}

export function NavBar({ activeTab, onTabChange, connectionStatus, runningCount }: NavBarProps) {
	return (
		<>
			<div className="wordmark">
				<span className="wordmark-bracket">[</span>
				<span className="wordmark-name">conductor</span>
				<span className="wordmark-bracket">]</span>
			</div>
			<nav className="navbar">
				<div className="navbar-tabs">
					{TABS.map((t) => (
						<button
							type="button"
							key={t.id}
							className={`nav-tab${activeTab === t.id ? " active" : ""}`}
							onClick={() => onTabChange(t.id)}
							title={`Switch to ${t.label} (${t.key})`}
						>
							{t.label}
						</button>
					))}
				</div>
				<div className="navbar-divider" />
				<div className="navbar-status">
					<div className={`conn-dot ${connectionStatus}`} title={connectionStatus} />
					{runningCount > 0 && (
						<span style={{ color: "var(--running)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
							{runningCount} running
						</span>
					)}
				</div>
			</nav>
		</>
	);
}
