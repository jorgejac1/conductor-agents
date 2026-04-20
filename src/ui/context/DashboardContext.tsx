import React, { createContext, useCallback, useContext, useReducer, useState } from "react";
import { fetchTracks } from "../hooks/api.js";
import { useSSE } from "../hooks/useSSE.js";
import type {
	ConnectionStatus,
	CostEvent,
	EvalResult,
	SSEEvent,
	SwarmState,
	TrackStatus,
} from "../types.js";

// ─── State ────────────────────────────────────────────────────────────────────

interface DashboardState {
	tracks: TrackStatus[];
	swarmStates: Record<string, SwarmState>;
	evalResults: Record<string, EvalResult>;
	costHistory: CostEvent[];
	lastUpdate: Date | null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

type Action =
	| { type: "TRACKS_UPDATE"; tracks: TrackStatus[] }
	| { type: "SWARM_UPDATE"; state: SwarmState }
	| { type: "EVAL_RESULT"; workerId: string; passed: boolean; output?: string }
	| { type: "COST_EVENT"; event: CostEvent };

function reducer(state: DashboardState, action: Action): DashboardState {
	switch (action.type) {
		case "TRACKS_UPDATE": {
			// Rebuild swarm states from the track list
			const swarmStates: Record<string, SwarmState> = { ...state.swarmStates };
			for (const t of action.tracks) {
				if (t.swarmState) swarmStates[t.track.id] = t.swarmState;
			}
			return { ...state, tracks: action.tracks, swarmStates, lastUpdate: new Date() };
		}
		case "SWARM_UPDATE": {
			// Identify which track this swarm belongs to via todoPath
			const trackId = action.state.todoPath.split("/").at(-3) ?? "";
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
		default:
			return state;
	}
}

const INITIAL_STATE: DashboardState = {
	tracks: [],
	swarmStates: {},
	evalResults: {},
	costHistory: [],
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
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DashboardProvider({ children }: { children: React.ReactNode }) {
	const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
	const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
	const [toast, setToast] = useState<ToastMessage | null>(null);
	const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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

	// Initial load
	React.useEffect(() => {
		void refreshTracks();
	}, [refreshTracks]);

	// SSE handler
	const handleMessage = useCallback((event: SSEEvent) => {
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
		}
	}, []);

	useSSE(handleMessage, setConnectionStatus);

	return (
		<DashboardContext.Provider
			value={{ state, connectionStatus, toast, showToast, showError, refreshTracks }}
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
