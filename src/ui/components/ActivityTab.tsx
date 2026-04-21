import { useMemo, useState } from "react";
import type { ActivityLogEntry } from "../context/DashboardContext.js";
import { useDashboard } from "../context/DashboardContext.js";
import { SpendChart } from "./SpendChart.js";

// A fixed set of colors for up to 10 tracks
const TRACK_COLORS = [
	"#818cf8",
	"#34d399",
	"#38bdf8",
	"#fbbf24",
	"#fb7185",
	"#a78bfa",
	"#6ee7b7",
	"#7dd3fc",
	"#fcd34d",
	"#fca5a5",
];

function formatTime(timestamp: number): string {
	const d = new Date(timestamp);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}

function eventTypeBadgeClass(type: string): string {
	switch (type) {
		case "cost":
			return "badge badge-done";
		case "eval-result":
			return "badge badge-pass";
		case "worker-start":
			return "badge badge-spawning";
		case "worker-retry":
			return "badge badge-merge";
		case "budget-exceeded":
			return "badge badge-budget";
		case "swarm":
			return "badge badge-running";
		default:
			return "badge badge-pending";
	}
}

interface EventRowProps {
	entry: ActivityLogEntry;
	expanded: boolean;
	onToggle: () => void;
}

function EventRow({ entry, expanded, onToggle }: EventRowProps) {
	return (
		<div className="activity-event-row">
			<button
				type="button"
				className="activity-event-row-header"
				onClick={onToggle}
				aria-expanded={expanded}
			>
				<span className="activity-event-time mono">{formatTime(entry.timestamp)}</span>
				<span className={eventTypeBadgeClass(entry.type)}>{entry.type}</span>
				<span className="activity-event-chevron" aria-hidden="true">
					{expanded ? "▼" : "▶"}
				</span>
			</button>
			{expanded && (
				<pre className="activity-event-payload">{JSON.stringify(entry.payload, null, 2)}</pre>
			)}
		</div>
	);
}

export function ActivityTab() {
	const { state } = useDashboard();
	const { tracks, costHistory, activityLog } = state;
	const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

	function toggleRow(index: number): void {
		setExpandedRows((prev) => {
			const next = new Set(prev);
			if (next.has(index)) {
				next.delete(index);
			} else {
				next.add(index);
			}
			return next;
		});
	}

	// Per-track aggregated cost from TrackStatus (authoritative server-side totals)
	const trackCosts = useMemo(
		() =>
			tracks
				.filter((t) => (t.cost?.estimatedUsd ?? 0) > 0)
				.map((t, i) => ({
					id: t.track.id,
					name: t.track.name,
					tokens: t.cost?.totalTokens ?? 0,
					usd: t.cost?.estimatedUsd ?? 0,
					color: TRACK_COLORS[i % TRACK_COLORS.length] ?? "#818cf8",
				}))
				.sort((a, b) => b.usd - a.usd),
		[tracks],
	);

	const totalUsd = trackCosts.reduce((s, t) => s + t.usd, 0);
	const totalTokens = trackCosts.reduce((s, t) => s + t.tokens, 0);
	const maxUsd = trackCosts[0]?.usd ?? 0;

	// Build chart bars from costHistory (SSE events), grouped by trackId
	const chartBars = useMemo(() => {
		if (costHistory.length === 0)
			return trackCosts.map((t) => ({ label: t.name, value: t.usd, color: t.color }));
		const grouped: Record<string, number> = {};
		for (const evt of costHistory) {
			grouped[evt.trackId] = (grouped[evt.trackId] ?? 0) + evt.estimatedUsd;
		}
		return Object.entries(grouped).map(([id, usd], i) => {
			const t = trackCosts.find((tc) => tc.id === id);
			return {
				label: t?.name ?? id,
				value: usd,
				color: t?.color ?? TRACK_COLORS[i % TRACK_COLORS.length] ?? "#818cf8",
			};
		});
	}, [costHistory, trackCosts]);

	const chartMax = Math.max(...chartBars.map((b) => b.value), 0.0001);

	// Show newest events first
	const reversedLog = useMemo(() => [...activityLog].reverse(), [activityLog]);

	return (
		<div className="activity-layout">
			<div className="activity-grid">
				{/* Total spend card */}
				<div className="card activity-card">
					<div className="activity-card-title">Total Spend</div>
					<div className="activity-stat-row">
						<span className="activity-stat-value">${totalUsd.toFixed(4)}</span>
						<span className="activity-stat-unit">USD</span>
					</div>
					<div className="activity-stat-sub">{totalTokens.toLocaleString()} tokens</div>
					<div className="spend-chart-wrap">
						<SpendChart bars={chartBars} maxValue={chartMax} />
					</div>
				</div>

				{/* Per-track breakdown */}
				<div className="card activity-card">
					<div className="activity-card-title">By Track</div>
					{trackCosts.length === 0 ? (
						<div className="activity-empty">No cost data yet. Run a track to see spend here.</div>
					) : (
						<div className="track-cost-list">
							{trackCosts.map((t) => (
								<div key={t.id} className="track-cost-row">
									<span className="track-cost-name">{t.name}</span>
									<div className="track-cost-bar-wrap">
										<div
											className="track-cost-bar-fill"
											style={{
												width: maxUsd > 0 ? `${(t.usd / maxUsd) * 100}%` : "0%",
												background: t.color,
											}}
										/>
									</div>
									<span className="track-cost-usd">${t.usd.toFixed(4)}</span>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Tokens card */}
				{totalTokens > 0 && (
					<div className="card activity-card">
						<div className="activity-card-title">Token Usage</div>
						<div className="track-cost-list">
							{trackCosts.map((t) => (
								<div key={t.id} className="track-cost-row">
									<span className="track-cost-name">{t.name}</span>
									<div className="track-cost-bar-wrap">
										<div
											className="track-cost-bar-fill"
											style={{
												width: totalTokens > 0 ? `${(t.tokens / totalTokens) * 100}%` : "0%",
												background: t.color,
											}}
										/>
									</div>
									<span className="track-cost-usd" style={{ width: 70 }}>
										{t.tokens.toLocaleString()}
									</span>
								</div>
							))}
						</div>
					</div>
				)}
			</div>

			{/* Event feed with expandable rows */}
			<div className="activity-event-feed card">
				<div className="activity-card-title" style={{ padding: "14px 16px 0" }}>
					Event Feed
				</div>
				{reversedLog.length === 0 ? (
					<div className="activity-empty" style={{ padding: "12px 16px 16px" }}>
						No events yet. Start a track run to see live events here.
					</div>
				) : (
					<div className="activity-event-list">
						{reversedLog.map((entry) => (
							<EventRow
								key={entry.index}
								entry={entry}
								expanded={expandedRows.has(entry.index)}
								onToggle={() => toggleRow(entry.index)}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
