import type {
	ConductorConfig,
	MemoryEntry,
	ProjectEntry,
	RunRecord,
	TrackStatus,
	VersionInfo,
} from "../types.js";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return res.json() as Promise<T>;
}

export async function fetchTracks(): Promise<TrackStatus[]> {
	return json<TrackStatus[]>("/api/tracks");
}

export interface HistoryOptions {
	limit?: number;
	offset?: number;
	from?: string;
	to?: string;
	result?: "pass" | "fail";
}

export async function fetchHistory(
	trackId: string,
	opts: HistoryOptions = {},
): Promise<RunRecord[]> {
	const params = new URLSearchParams();
	if (opts.limit !== undefined) params.set("limit", String(opts.limit));
	if (opts.offset !== undefined) params.set("offset", String(opts.offset));
	if (opts.from) params.set("from", opts.from);
	if (opts.to) params.set("to", opts.to);
	if (opts.result) params.set("result", opts.result);
	const qs = params.toString();
	const records = await json<RunRecord[]>(`/api/tracks/${trackId}/history${qs ? `?${qs}` : ""}`);
	return records.map((r) => ({ ...r, trackId }));
}

export async function fetchConfig(): Promise<ConductorConfig> {
	return json<ConductorConfig>("/api/config");
}

export async function apiUpdateConfig(
	patch: Partial<Pick<ConductorConfig, "defaults" | "telegram" | "webhook">>,
): Promise<{ ok: boolean }> {
	return json<{ ok: boolean }>("/api/config", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});
}

export async function fetchVersion(): Promise<VersionInfo> {
	return json<VersionInfo>("/api/version");
}

export async function fetchTelegramStatus(): Promise<{ configured: boolean }> {
	return json<{ configured: boolean }>("/api/telegram-status");
}

export async function fetchLog(trackId: string, workerId: string): Promise<string> {
	const res = await fetch(`/api/tracks/${trackId}/logs/${workerId}`);
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return res.text();
}

export async function apiRunTrack(
	trackId: string,
	opts: { concurrency?: number; agentCmd?: string; resume?: boolean } = {},
): Promise<{ accepted: boolean }> {
	return json(`/api/tracks/${trackId}/run`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(opts),
	});
}

export async function apiRetryWorker(trackId: string, workerId: string): Promise<{ ok: boolean }> {
	return json(`/api/tracks/${trackId}/retry`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ workerId }),
	});
}

export async function apiPauseTrack(trackId: string): Promise<{ paused: boolean }> {
	return json(`/api/tracks/${trackId}/pause`, { method: "POST" });
}

export async function apiResumeTrack(
	trackId: string,
	opts: { concurrency?: number; agentCmd?: string } = {},
): Promise<{ accepted: boolean }> {
	return json(`/api/tracks/${trackId}/resume`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(opts),
	});
}

export async function fetchIsPaused(trackId: string): Promise<boolean> {
	const r = await json<{ paused: boolean }>(`/api/tracks/${trackId}/paused`);
	return r.paused;
}

export async function fetchWorkspace(): Promise<{ root: string; projectCount: number }> {
	return json<{ root: string; projectCount: number }>("/api/workspace");
}

export async function fetchWorkspaceProjects(): Promise<ProjectEntry[]> {
	return json<ProjectEntry[]>("/api/workspace/projects");
}

export async function fetchProjectTracks(projectId: string): Promise<TrackStatus[]> {
	return json<TrackStatus[]>(`/api/workspace/projects/${projectId}/tracks`);
}

export async function apiInitProject(
	projectId: string,
	opts: { goal?: string } = {},
): Promise<{ ok: boolean }> {
	return json(`/api/workspace/projects/${projectId}/init`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(opts),
	});
}

export async function apiRunWorkspaceTrack(
	projectId: string,
	trackId: string,
): Promise<{ ok: boolean }> {
	return json(`/api/workspace/projects/${projectId}/run/${trackId}`, { method: "POST" });
}

export async function apiPatchTrack(
	trackId: string,
	patch: Record<string, unknown>,
): Promise<{ ok: boolean }> {
	return json(`/api/config/tracks/${trackId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});
}

export async function fetchMemories(
	opts: { scope?: string; type?: string } = {},
): Promise<MemoryEntry[]> {
	const params = new URLSearchParams();
	if (opts.scope) params.set("scope", opts.scope);
	if (opts.type) params.set("type", opts.type);
	const qs = params.toString();
	const result = await json<{ memories: MemoryEntry[] }>(`/api/memory${qs ? `?${qs}` : ""}`);
	return result.memories;
}

export async function fetchMemory(slug: string): Promise<MemoryEntry> {
	const result = await json<{ memory: MemoryEntry }>(`/api/memory/${encodeURIComponent(slug)}`);
	return result.memory;
}
