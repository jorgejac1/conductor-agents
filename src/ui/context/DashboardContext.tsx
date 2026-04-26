import React, { createContext, useCallback, useContext, useReducer, useState } from "react";
import { fetchTracks, fetchWorkspace, fetchWorkspaceProjects } from "../hooks/api.js";
import { useSSE } from "../hooks/useSSE.js";
import type {
	ConnectionStatus,
	CostEvent,
	EvalResult,
	SSEEvent,
	SwarmState,
	TrackStatus,
	WorkspaceState,
} from "../types.js";

// ─── State ────────────────────────────────────────────────────────────────────

export interface ActivityLogEntry {
	/** Monotonically increasing index for stable keying */
	index: number;
	/** Timestamp this event was received */
	timestamp: number;
	/** The raw event type */
	type: string;
	/** The full event payload */
	payload: Record<string, unknown>;
}

interface DashboardState {
	tracks: TrackStatus[];
	swarmStates: Record<string, SwarmState>;
	evalResults: Record<string, EvalResult>;
	costHistory: CostEvent[];
	/** Accumulated SSE event log for the Activity tab drill-down. */
	activityLog: ActivityLogEntry[];
	/** Tracks that have exceeded their budget limits (by trackId). */
	budgetExceededTracks: Set<string>;
	/** When true, new SSE events are not appended to activityLog. */
	logPaused: boolean;
	workspace: WorkspaceState | null;
	lastUpdate: Date | null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

type Action =
	| { type: "TRACKS_UPDATE"; tracks: TrackStatus[] }
	| { type: "SWARM_UPDATE"; state: SwarmState }
	| { type: "EVAL_RESULT"; workerId: string; passed: boolean; output?: string }
	| { type: "COST_EVENT"; event: CostEvent }
	| { type: "WORKER_START"; workerId: string; contractId: string }
	| { type: "WORKER_RETRY"; workerId: string; contractId: string }
	| { type: "BUDGET_EXCEEDED"; trackId: string }
	| { type: "ACTIVITY_LOG"; entry: Omit<ActivityLogEntry, "index"> }
	| { type: "PAUSE_LOG" }
	| { type: "RESUME_LOG" }
	| { type: "CLEAR_LOG" }
	| { type: "WORKSPACE_UPDATE"; workspace: WorkspaceState };

function reducer(state: DashboardState, action: Action): DashboardState {
	switch (action.type) {
		case "TRACKS_UPDATE": {
			// Rebuild swarm states from the track list
			const swarmStates: Record<string, SwarmState> = { ...state.swarmStates };
			// Merge server-authoritative budgetExceeded flags from the track list
			const budgetExceededTracks = new Set(state.budgetExceededTracks);
			for (const t of action.tracks) {
				if (t.swarmState) swarmStates[t.track.id] = t.swarmState;
				if (t.budgetExceeded) budgetExceededTracks.add(t.track.id);
			}
			return {
				...state,
				tracks: action.tracks,
				swarmStates,
				budgetExceededTracks,
				lastUpdate: new Date(),
			};
		}
		case "SWARM_UPDATE": {
			// Identify which track this swarm belongs to via todoPath
			// Path: .../.conductor/tracks/<trackId>/todo.md → at(-2) is trackId
			const trackId = action.state.todoPath.split("/").at(-2) ?? "";
			return {
				...state,
				swarmStates: { ...state.swarmStates, [trackId]: action.state },
				lastUpdate: new Date(),
			};
		}
		case "EVAL_RESULT":
			return {
				...state,
				evalResults: {
					...state.evalResults,
					[action.workerId]: { passed: action.passed, output: action.output },
				},
				lastUpdate: new Date(),
			};
		case "COST_EVENT":
			return {
				...state,
				costHistory: [...state.costHistory, action.event],
				lastUpdate: new Date(),
			};
		case "BUDGET_EXCEEDED": {
			const next = new Set(state.budgetExceededTracks);
			next.add(action.trackId);
			return { ...state, budgetExceededTracks: next, lastUpdate: new Date() };
		}
		case "ACTIVITY_LOG": {
			if (state.logPaused) return state;
			const index = state.activityLog.length;
			return {
				...state,
				activityLog: [...state.activityLog, { ...action.entry, index }],
				lastUpdate: new Date(),
			};
		}
		case "PAUSE_LOG":
			return { ...state, logPaused: true };
		case "RESUME_LOG":
			return { ...state, logPaused: false };
		case "CLEAR_LOG":
			return { ...state, activityLog: [], logPaused: false };
		// worker-start / worker-retry: state is already updated via the swarm SSE event.
		// These action types exist so callers can dispatch them without a type error.
		case "WORKER_START":
		case "WORKER_RETRY":
			return { ...state, lastUpdate: new Date() };
		case "WORKSPACE_UPDATE":
			return { ...state, workspace: action.workspace, lastUpdate: new Date() };
		default:
			return state;
	}
}

const INITIAL_STATE: DashboardState = {
	tracks: [],
	swarmStates: {},
	evalResults: {},
	costHistory: [],
	activityLog: [],
	budgetExceededTracks: new Set(),
	logPaused: false,
	workspace: null,
	lastUpdate: null,
};

// ─── Context ──────────────────────────────────────────────────────────────────

interface ToastMessage {
	id: number;
	text: string;
	kind: "success" | "error";
}

interface DashboardContextValue {
	state: DashboardState;
	connectionStatus: ConnectionStatus;
	toast: ToastMessage | null;
	showToast: (text: string, kind?: "success" | "error") => void;
	showError: (text: string) => void;
	refreshTracks: () => Promise<void>;
	pauseLog: () => void;
	resumeLog: () => void;
	clearLog: () => void;
	selectedProjectId: string | null;
	setSelectedProjectId: (id: string | null) => void;
	refreshWorkspace: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DashboardProvider({ children }: { children: React.ReactNode }) {
	const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
	const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
	const [toast, setToast] = useState<ToastMessage | null>(null);
	const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

	const showToast = useCallback((text: string, kind: "success" | "error" = "success") => {
		if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
		setToast({ id: Date.now(), text, kind });
		toastTimerRef.current = setTimeout(() => setToast(null), 3500);
	}, []);

	const showError = useCallback((text: string) => showToast(text, "error"), [showToast]);

	const refreshTracks = useCallback(async () => {
		try {
			const tracks = await fetchTracks();
			dispatch({ type: "TRACKS_UPDATE", tracks });
		} catch (e) {
			showError(e instanceof Error ? e.message : "Failed to load tracks");
		}
	}, [showError]);

	const pauseLog = useCallback(() => dispatch({ type: "PAUSE_LOG" }), []);
	const resumeLog = useCallback(() => dispatch({ type: "RESUME_LOG" }), []);
	const clearLog = useCallback(() => dispatch({ type: "CLEAR_LOG" }), []);

	const refreshWorkspace = useCallback(async () => {
		try {
			const [info, projects] = await Promise.all([fetchWorkspace(), fetchWorkspaceProjects()]);
			dispatch({
				type: "WORKSPACE_UPDATE",
				workspace: { root: info.root, projects, discovered: info.discovered ?? false },
			});
		} catch {
			/* workspace api not available yet */
		}
	}, []);

	// Initial load
	React.useEffect(() => {
		void refreshTracks();
	}, [refreshTracks]);

	React.useEffect(() => {
		void refreshWorkspace();
	}, [refreshWorkspace]);

	// SSE handler
	const handleMessage = useCallback(
		(event: SSEEvent) => {
			// Log all non-tracks events to the activity log for the drill-down UI.
			if (event.type !== "tracks") {
				dispatch({
					type: "ACTIVITY_LOG",
					entry: {
						timestamp: Date.now(),
						type: event.type,
						payload: event as unknown as Record<string, unknown>,
					},
				});
			}

			switch (event.type) {
				case "tracks":
					dispatch({ type: "TRACKS_UPDATE", tracks: event.tracks });
					break;
				case "swarm":
					dispatch({ type: "SWARM_UPDATE", state: event.state });
					break;
				case "eval-result":
					dispatch({
						type: "EVAL_RESULT",
						workerId: event.workerId,
						passed: event.passed,
						output: event.output,
					});
					break;
				case "cost":
					dispatch({
						type: "COST_EVENT",
						event: {
							trackId: event.trackId ?? "unknown",
							tokens: event.tokens,
							estimatedUsd: event.estimatedUsd ?? 0,
							timestamp: Date.now(),
						},
					});
					break;
				case "worker-start":
					dispatch({
						type: "WORKER_START",
						workerId: event.workerId,
						contractId: event.contractId,
					});
					showToast(`Worker started: ${event.workerId.slice(0, 8)}`);
					break;
				case "worker-retry":
					dispatch({
						type: "WORKER_RETRY",
						workerId: event.workerId,
						contractId: event.contractId,
					});
					showToast(`Worker retrying: ${event.workerId.slice(0, 8)}`);
					break;
				case "budget-exceeded":
					dispatch({ type: "BUDGET_EXCEEDED", trackId: event.trackId });
					showToast(`Budget exceeded for track: ${event.trackId}`, "error");
					break;
				default: {
					// Handle forward-compat events not yet in the SSEEvent union (e.g. "workspace").
					const raw = event as unknown as Record<string, unknown>;
					if (raw.type === "workspace") {
						dispatch({
							type: "WORKSPACE_UPDATE",
							workspace: {
								root: raw.root as string,
								projects: raw.projects as WorkspaceState["projects"],
								discovered: (raw.discovered as boolean) ?? false,
							},
						});
					}
					break;
				}
			}
		},
		[showToast],
	);

	useSSE(handleMessage, setConnectionStatus);

	return (
		<DashboardContext.Provider
			value={{
				state,
				connectionStatus,
				toast,
				showToast,
				showError,
				refreshTracks,
				pauseLog,
				resumeLog,
				clearLog,
				selectedProjectId,
				setSelectedProjectId,
				refreshWorkspace,
			}}
		>
			{children}
		</DashboardContext.Provider>
	);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDashboard(): DashboardContextValue {
	const ctx = useContext(DashboardContext);
	if (!ctx) throw new Error("useDashboard must be used inside <DashboardProvider>");
	return ctx;
}
