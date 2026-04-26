import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { apiRunTrack } from "../hooks/api.js";
import type { EvalResult, TrackStatus, WorkerState } from "../types.js";
import { GraphDetailPanel } from "./GraphDetailPanel.js";
import { TrackNode } from "./TrackNode.js";
import { WorkerNode } from "./WorkerNode.js";

interface Vec2 {
	x: number;
	y: number;
}

interface TrackLayout {
	trackStatus: TrackStatus;
	workers: WorkerState[];
	pos: Vec2;
	angle: number;
}

interface WorkerLayout {
	worker: WorkerState;
	trackId: string;
	pos: Vec2;
}

function computeLayout(
	tracks: TrackStatus[],
	swarmStates: Record<string, { workers: WorkerState[] } | null | undefined>,
	w: number,
	h: number,
): { trackLayouts: TrackLayout[]; workerLayouts: WorkerLayout[] } {
	const cx = w / 2;
	const cy = h / 2;
	const n = tracks.length;
	if (n === 0) return { trackLayouts: [], workerLayouts: [] };

	const trackRingR = Math.min(cx, cy) * (n === 1 ? 0 : 0.38);

	const trackLayouts: TrackLayout[] = tracks.map((ts, i) => {
		const angle = n === 1 ? -Math.PI / 2 : (i / n) * 2 * Math.PI - Math.PI / 2;
		const workers = swarmStates[ts.track.id]?.workers ?? ts.swarmState?.workers ?? [];
		return {
			trackStatus: ts,
			workers,
			angle,
			pos: {
				x: cx + trackRingR * Math.cos(angle),
				y: cy + trackRingR * Math.sin(angle),
			},
		};
	});

	const workerLayouts: WorkerLayout[] = trackLayouts.flatMap(
		({ trackStatus, workers, pos, angle }) => {
			const W = workers.length;
			if (W === 0) return [];
			const orbitR = Math.min(68 + W * 8, 110);
			const spread = Math.PI * 0.75;

			return workers.map((worker, j) => {
				const t = W === 1 ? 0.5 : j / (W - 1);
				const wAngle = angle + (t - 0.5) * spread;
				return {
					worker,
					trackId: trackStatus.track.id,
					pos: {
						x: pos.x + orbitR * Math.cos(wAngle),
						y: pos.y + orbitR * Math.sin(wAngle),
					},
				};
			});
		},
	);

	return { trackLayouts, workerLayouts };
}

// Track node half-size (must match CSS)
const TRACK_R = 28;
const WORKER_R = 7;

export function GraphView({ onShowHelp }: { onShowHelp?: () => void }) {
	const { state, showToast, showError } = useDashboard();
	const { tracks, swarmStates, evalResults } = state;

	const containerRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 800, h: 600 });

	// Zoom / pan state
	const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
	const panRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);

	// Interaction state
	const [hoveredTrackId, setHoveredTrackId] = useState<string | null>(null);
	const [, setHoveredWorkerId] = useState<string | null>(null);
	const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
	const [focusedWorkerId, setFocusedWorkerId] = useState<string | null>(null);

	// Measure container
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			setSize({ w: width, h: height });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// Zoom via wheel
	const onWheel = useCallback((e: React.WheelEvent) => {
		e.preventDefault();
		setTransform((prev) => {
			const delta = e.deltaY > 0 ? 0.9 : 1.1;
			const newScale = Math.min(Math.max(prev.scale * delta, 0.3), 3);
			return { ...prev, scale: newScale };
		});
	}, []);

	// Pan via drag
	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if ((e.target as HTMLElement).closest(".graph-track-node, .graph-worker-node")) return;
			panRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y };
		},
		[transform],
	);

	const onMouseMove = useCallback((e: React.MouseEvent) => {
		const pan = panRef.current;
		if (!pan) return;
		setTransform((prev) => ({
			...prev,
			x: pan.tx + (e.clientX - pan.startX),
			y: pan.ty + (e.clientY - pan.startY),
		}));
	}, []);

	const onMouseUp = useCallback(() => {
		panRef.current = null;
	}, []);

	// Layout
	const { trackLayouts, workerLayouts } = useMemo(
		() => computeLayout(tracks, swarmStates, size.w, size.h),
		[tracks, swarmStates, size],
	);

	// Dimming logic
	const activeTrackId = hoveredTrackId ?? selectedTrackId;

	function isTrackDimmed(id: string) {
		return activeTrackId !== null && activeTrackId !== id;
	}
	function isWorkerDimmed(trackId: string) {
		return activeTrackId !== null && activeTrackId !== trackId;
	}

	// Handlers
	function handleTrackHover(id: string | null) {
		setHoveredTrackId(id);
	}
	function handleTrackClick(id: string) {
		setSelectedTrackId((prev) => (prev === id ? null : id));
		setFocusedWorkerId(null);
	}
	function handleWorkerClick(workerId: string) {
		setFocusedWorkerId((prev) => (prev === workerId ? null : workerId));
	}
	function handleBgClick() {
		setSelectedTrackId(null);
		setFocusedWorkerId(null);
	}

	const selectedTrack = trackLayouts.find((t) => t.trackStatus.track.id === selectedTrackId);

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
		<div
			className="graph-container"
			ref={containerRef}
			role="application"
			aria-label="Track graph — scroll to zoom, drag to pan"
			onWheel={onWheel}
			onMouseDown={onMouseDown}
			onMouseMove={onMouseMove}
			onMouseUp={onMouseUp}
			onMouseLeave={onMouseUp}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					handleBgClick();
				} else if (
					e.key === "r" &&
					selectedTrackId &&
					selectedTrack &&
					selectedTrack.trackStatus.todoTotal > 0
				) {
					void (async () => {
						try {
							await apiRunTrack(selectedTrackId);
							showToast("Track run started");
						} catch (err) {
							showError(err instanceof Error ? err.message : "Run failed");
						}
					})();
				} else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && selectedTrack) {
					const workers = selectedTrack.workers;
					if (workers.length === 0) return;
					const idx = workers.findIndex((w) => w.id === focusedWorkerId);
					const next =
						e.key === "ArrowDown"
							? (idx + 1) % workers.length
							: (idx - 1 + workers.length) % workers.length;
					setFocusedWorkerId(workers[next]?.id ?? null);
					e.preventDefault();
				} else if (e.key === "?") {
					onShowHelp?.();
				}
			}}
			onClick={(e) => {
				if (
					(e.target as HTMLElement).closest(
						".graph-track-node, .graph-worker-node, .graph-detail-panel",
					)
				)
					return;
				handleBgClick();
			}}
		>
			{/* Hint */}
			<div className="graph-hint">scroll to zoom · drag to pan</div>

			{/* Transformed scene */}
			<div
				className="graph-scene"
				style={{
					transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
				}}
			>
				{/* SVG edges */}
				<svg className="graph-svg" style={{ width: size.w, height: size.h }} aria-hidden="true">
					{/* Worker-to-track edges */}
					{workerLayouts.map(({ worker, trackId, pos }) => {
						const tl = trackLayouts.find((t) => t.trackStatus.track.id === trackId);
						if (!tl) return null;
						const dimmed = isWorkerDimmed(trackId);
						return (
							<line
								key={worker.id}
								x1={tl.pos.x}
								y1={tl.pos.y}
								x2={pos.x}
								y2={pos.y}
								className="graph-edge"
								style={{ opacity: dimmed ? 0.05 : 0.6 }}
							/>
						);
					})}
					{/* Track dependency edges (dashed) */}
					{trackLayouts.flatMap(({ trackStatus, pos: targetPos }) => {
						const deps = trackStatus.track.dependsOn ?? [];
						return deps.map((depId) => {
							const sourceTl = trackLayouts.find((t) => t.trackStatus.track.id === depId);
							if (!sourceTl) return null;
							const dimmed =
								activeTrackId !== null &&
								activeTrackId !== trackStatus.track.id &&
								activeTrackId !== depId;
							return (
								<line
									key={`dep-${depId}-${trackStatus.track.id}`}
									x1={sourceTl.pos.x}
									y1={sourceTl.pos.y}
									x2={targetPos.x}
									y2={targetPos.y}
									stroke="var(--muted)"
									strokeWidth={1.5}
									strokeDasharray="6 4"
									opacity={dimmed ? 0.05 : 0.4}
								/>
							);
						});
					})}
				</svg>

				{/* Track nodes */}
				{trackLayouts.map(({ trackStatus, workers, pos }) => (
					<TrackNode
						key={trackStatus.track.id}
						trackStatus={trackStatus}
						workers={workers}
						evalResults={evalResults as Record<string, EvalResult>}
						x={pos.x - TRACK_R}
						y={pos.y - TRACK_R}
						dimmed={isTrackDimmed(trackStatus.track.id)}
						selected={selectedTrackId === trackStatus.track.id}
						onHover={handleTrackHover}
						onClick={handleTrackClick}
					/>
				))}

				{/* Worker nodes */}
				{workerLayouts.map(({ worker, trackId, pos }) => (
					<WorkerNode
						key={worker.id}
						worker={worker}
						evalResult={(evalResults as Record<string, EvalResult>)[worker.id]}
						x={pos.x - WORKER_R}
						y={pos.y - WORKER_R}
						dimmed={isWorkerDimmed(trackId)}
						onHover={(id) => setHoveredWorkerId(id)}
						onClick={handleWorkerClick}
					/>
				))}
			</div>

			{/* Detail panel (outside scene so it doesn't zoom) */}
			{selectedTrack && (
				<GraphDetailPanel
					trackStatus={selectedTrack.trackStatus}
					workers={selectedTrack.workers}
					evalResults={evalResults as Record<string, EvalResult>}
					focusedWorkerId={focusedWorkerId}
					onClose={() => setSelectedTrackId(null)}
					onWorkerClick={handleWorkerClick}
				/>
			)}
		</div>
	);
}
