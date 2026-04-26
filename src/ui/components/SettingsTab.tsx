import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { apiPatchTrack, fetchConfig, fetchTelegramStatus, fetchVersion } from "../hooks/api.js";
import type { ConductorConfig, Track, VersionInfo } from "../types.js";

export function SettingsTab() {
	const { showError, state } = useDashboard();
	const [config, setConfig] = useState<ConductorConfig | null>(null);
	const [version, setVersion] = useState<VersionInfo | null>(null);
	const [tgConfigured, setTgConfigured] = useState<boolean | null>(null);

	useEffect(() => {
		async function load() {
			try {
				const [cfg, ver, tg] = await Promise.all([
					fetchConfig(),
					fetchVersion(),
					fetchTelegramStatus(),
				]);
				setConfig(cfg);
				setVersion(ver);
				setTgConfigured(tg.configured);
			} catch (e) {
				showError(e instanceof Error ? e.message : "Failed to load settings");
			}
		}
		void load();
	}, [showError]);

	// Live session stats from state
	const session = useMemo(() => {
		const allWorkers = Object.values(state.swarmStates).flatMap((s) => s.workers);
		const totalCost = state.tracks.reduce((s, t) => s + (t.cost?.estimatedUsd ?? 0), 0);
		const totalTokens = state.tracks.reduce((s, t) => s + (t.cost?.totalTokens ?? 0), 0);
		return {
			total: allWorkers.length,
			done: allWorkers.filter((w) => w.status === "done").length,
			failed: allWorkers.filter((w) => w.status === "failed").length,
			running: allWorkers.filter((w) =>
				["spawning", "running", "verifying", "merging"].includes(w.status),
			).length,
			totalCost,
			totalTokens,
		};
	}, [state.swarmStates, state.tracks]);

	return (
		<div className="settings-grid">
			{/* ── Left: Tracks ── */}
			<div className="settings-col-main">
				<div className="settings-section-title">
					Tracks
					{config?.tracks && <span className="settings-count">{config.tracks.length}</span>}
				</div>
				<div className="card settings-card settings-tracks-table">
					<div className="settings-tracks-head">
						<span>Name</span>
						<span>Description</span>
						<span>Agent</span>
						<span>Cost</span>
					</div>
					{(config?.tracks?.length ?? 0) === 0 ? (
						<div className="settings-empty">No tracks configured</div>
					) : (
						config?.tracks?.map((t) => {
							const trackCost = state.tracks.find((ts) => ts.track.id === t.id)?.cost;
							return (
								<div key={t.id} className="settings-track-row">
									<span className="settings-track-name">{t.name}</span>
									<span className="settings-track-desc">
										{t.description ?? <span className="settings-empty-cell">—</span>}
									</span>
									<span className="settings-track-agent mono">
										{t.agentCmd ?? config.defaults.agentCmd ?? "—"}
									</span>
									<span className="settings-track-cost">
										{trackCost ? (
											`$${trackCost.estimatedUsd.toFixed(3)}`
										) : (
											<span className="settings-track-cost-nil">—</span>
										)}
									</span>
								</div>
							);
						})
					)}
				</div>
			</div>

			{/* ── Right: meta + live stats ── */}
			<div className="settings-col-side">
				{/* Version */}
				<div className="settings-section">
					<div className="settings-section-title">Version</div>
					<div className="card settings-card">
						<div className="settings-row">
							<span className="settings-key">conductor</span>
							<span className="version-pill">{version?.conductor ?? "—"}</span>
						</div>
						<div className="settings-row">
							<span className="settings-key">evalgate</span>
							<span className="version-pill">{version?.evalgate ?? "—"}</span>
						</div>
					</div>
				</div>

				{/* Defaults */}
				<div className="settings-section">
					<div className="settings-section-title">Defaults</div>
					<div className="card settings-card">
						<div className="settings-row">
							<span className="settings-key">concurrency</span>
							<span className="settings-val">{config?.defaults.concurrency ?? "—"}</span>
						</div>
						<div className="settings-row">
							<span className="settings-key">agentCmd</span>
							<span className="settings-val mono">{config?.defaults.agentCmd ?? "—"}</span>
						</div>
						{config?.defaults.agentArgs && (
							<div className="settings-row">
								<span className="settings-key">agentArgs</span>
								<span className="settings-val mono">{config.defaults.agentArgs.join(" ")}</span>
							</div>
						)}
					</div>
				</div>

				{/* Integrations */}
				<div className="settings-section">
					<div className="settings-section-title">Integrations</div>
					<div className="card settings-card">
						<div className="settings-row">
							<span className="settings-key">Telegram</span>
							{tgConfigured === null ? (
								<span className="settings-val">—</span>
							) : (
								<span className={`tg-pill ${tgConfigured ? "configured" : "unconfigured"}`}>
									{tgConfigured ? "configured" : "not configured"}
								</span>
							)}
						</div>
					</div>
				</div>

				{/* Live session stats */}
				{session.total > 0 && (
					<div className="settings-section">
						<div className="settings-section-title">Session</div>
						<div className="card settings-card">
							<div className="settings-row">
								<span className="settings-key">workers</span>
								<span className="settings-val">{session.total}</span>
							</div>
							<div className="settings-row">
								<span className="settings-key">passed</span>
								<span className="settings-val" style={{ color: "var(--pass)" }}>
									{session.done}
								</span>
							</div>
							<div className="settings-row">
								<span className="settings-key">failed</span>
								<span
									className="settings-val"
									style={{ color: session.failed > 0 ? "var(--fail)" : "var(--muted)" }}
								>
									{session.failed}
								</span>
							</div>
							{session.running > 0 && (
								<div className="settings-row">
									<span className="settings-key">running</span>
									<span className="settings-val" style={{ color: "var(--running)" }}>
										{session.running}
									</span>
								</div>
							)}
							{session.totalTokens > 0 && (
								<>
									<div className="settings-row">
										<span className="settings-key">tokens</span>
										<span className="settings-val mono">
											{(session.totalTokens / 1000).toFixed(1)}k
										</span>
									</div>
									<div className="settings-row">
										<span className="settings-key">est. cost</span>
										<span className="settings-val" style={{ color: "var(--accent)" }}>
											${session.totalCost.toFixed(4)}
										</span>
									</div>
								</>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Track Settings Editor — full width below the two columns */}
			<div className="settings-col-full">
				<TrackSettingsEditor />
			</div>
		</div>
	);
}

// ─── TrackSettingsEditor ──────────────────────────────────────────────────────

function TrackSettingsEditor() {
	const { showToast, showError } = useDashboard();
	const [config, setConfig] = useState<ConductorConfig | null>(null);
	const [saving, setSaving] = useState<string | null>(null);
	const [edits, setEdits] = useState<Record<string, Partial<Track>>>({});

	useEffect(() => {
		fetchConfig()
			.then(setConfig)
			.catch(() => {
				/* ignore */
			});
	}, []);

	if (!config?.tracks) return <div className="settings-loading">Loading config…</div>;

	function setField(id: string, key: keyof Track, value: unknown) {
		setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
	}

	async function save(trackId: string) {
		const patch = edits[trackId];
		if (!patch || Object.keys(patch).length === 0) return;
		setSaving(trackId);
		try {
			await apiPatchTrack(trackId, patch as Record<string, unknown>);
			showToast(`Saved ${trackId}`);
		} catch (e) {
			showError(e instanceof Error ? e.message : "Save failed");
		} finally {
			setSaving(null);
		}
	}

	return (
		<div className="track-settings-editor">
			<h3 className="settings-section-title">Track Settings</h3>
			{config.tracks.map((track) => {
				const edit = edits[track.id] ?? {};
				return (
					<div key={track.id} className="track-settings-row">
						<span className="track-settings-id">{track.id}</span>
						<label className="track-settings-field">
							<span>Max USD</span>
							<input
								type="number"
								min="0"
								step="0.01"
								placeholder="—"
								value={edit.maxUsd ?? track.maxUsd ?? ""}
								onChange={(e) =>
									setField(track.id, "maxUsd", e.target.value ? Number(e.target.value) : undefined)
								}
								className="track-settings-input"
							/>
						</label>
						<label className="track-settings-field">
							<span>Max Tokens</span>
							<input
								type="number"
								min="0"
								step="1000"
								placeholder="—"
								value={edit.maxTokens ?? track.maxTokens ?? ""}
								onChange={(e) =>
									setField(
										track.id,
										"maxTokens",
										e.target.value ? Number(e.target.value) : undefined,
									)
								}
								className="track-settings-input"
							/>
						</label>
						<label className="track-settings-field">
							<span>Concurrency</span>
							<input
								type="number"
								min="1"
								max="10"
								placeholder="—"
								value={edit.concurrency ?? track.concurrency ?? ""}
								onChange={(e) =>
									setField(
										track.id,
										"concurrency",
										e.target.value ? Number(e.target.value) : undefined,
									)
								}
								className="track-settings-input"
							/>
						</label>
						<button
							type="button"
							className="btn-save-track"
							disabled={saving === track.id}
							onClick={() => void save(track.id)}
						>
							{saving === track.id ? "Saving…" : "Save"}
						</button>
					</div>
				);
			})}
		</div>
	);
}
