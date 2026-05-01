import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { apiPatchTrack, apiUpdateConfig, fetchTelegramStatus, fetchVersion } from "../hooks/api.js";
import type { ConductorConfig, Track, VersionInfo } from "../types.js";

export function SettingsTab() {
	const { showError, state } = useDashboard();
	const config = state.config; // SSE-synced via DashboardContext
	const [version, setVersion] = useState<VersionInfo | null>(null);
	const [tgConfigured, setTgConfigured] = useState<boolean | null>(null);

	useEffect(() => {
		async function load() {
			try {
				const [ver, tg] = await Promise.all([fetchVersion(), fetchTelegramStatus()]);
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
										{t.agentCmd ?? config?.defaults.agentCmd ?? "—"}
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

			{/* ── Right: meta + editors ── */}
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

				{/* Defaults editor */}
				{config && <DefaultsEditor config={config} />}

				{/* Telegram editor */}
				{config && <TelegramEditor config={config} tgConfigured={tgConfigured} />}

				{/* Webhook editor */}
				{config && <WebhookEditor config={config} />}

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

// ─── DefaultsEditor ───────────────────────────────────────────────────────────

function DefaultsEditor({ config }: { config: ConductorConfig }) {
	const { showToast, showError } = useDashboard();
	const [saving, setSaving] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [concurrency, setConcurrency] = useState(String(config.defaults.concurrency));
	const [agentCmd, setAgentCmd] = useState(config.defaults.agentCmd);
	const [agentArgs, setAgentArgs] = useState((config.defaults.agentArgs ?? []).join(" "));
	const [fieldError, setFieldError] = useState<string | null>(null);

	// Sync when config changes via SSE
	useEffect(() => {
		setConcurrency(String(config.defaults.concurrency));
		setAgentCmd(config.defaults.agentCmd);
		setAgentArgs((config.defaults.agentArgs ?? []).join(" "));
	}, [config.defaults.concurrency, config.defaults.agentCmd, config.defaults.agentArgs]);

	async function doSave() {
		setConfirming(false);
		setFieldError(null);
		const concurrencyNum = parseInt(concurrency, 10);
		if (Number.isNaN(concurrencyNum) || concurrencyNum < 1) {
			setFieldError("Concurrency must be a positive integer");
			return;
		}
		if (!agentCmd.trim()) {
			setFieldError("agentCmd cannot be empty");
			return;
		}
		setSaving(true);
		try {
			const args = agentArgs.trim() ? agentArgs.trim().split(/\s+/) : undefined;
			await apiUpdateConfig({
				defaults: { concurrency: concurrencyNum, agentCmd: agentCmd.trim(), agentArgs: args },
			});
			showToast("Defaults saved");
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Save failed";
			setFieldError(msg);
			showError(msg);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="settings-section">
			<div className="settings-section-title">Defaults</div>
			<div className="card settings-card">
				<label className="track-settings-field" style={{ marginBottom: "8px" }}>
					<span className="settings-key">concurrency</span>
					<input
						type="number"
						min="1"
						max="20"
						value={concurrency}
						onChange={(e) => setConcurrency(e.target.value)}
						className="track-settings-input"
					/>
				</label>
				<label className="track-settings-field" style={{ marginBottom: "8px" }}>
					<span className="settings-key">agentCmd</span>
					<input
						type="text"
						value={agentCmd}
						onChange={(e) => setAgentCmd(e.target.value)}
						className="track-settings-input mono"
					/>
				</label>
				<label className="track-settings-field" style={{ marginBottom: "8px" }}>
					<span className="settings-key">agentArgs</span>
					<input
						type="text"
						placeholder="space separated"
						value={agentArgs}
						onChange={(e) => setAgentArgs(e.target.value)}
						className="track-settings-input mono"
					/>
				</label>
				{fieldError && (
					<div className="settings-error" style={{ marginBottom: "8px" }}>
						{fieldError}
					</div>
				)}
				{confirming ? (
					<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
						<span className="settings-key" style={{ color: "var(--warn, #f59e0b)" }}>
							Affects all tracks — continue?
						</span>
						<button type="button" className="btn-save-track" onClick={() => void doSave()}>
							Confirm
						</button>
						<button
							type="button"
							className="btn-save-track"
							style={{ background: "var(--surface-2, #2a2a3e)" }}
							onClick={() => setConfirming(false)}
						>
							Cancel
						</button>
					</div>
				) : (
					<button
						type="button"
						className="btn-save-track"
						disabled={saving}
						onClick={() => setConfirming(true)}
					>
						{saving ? "Saving…" : "Save"}
					</button>
				)}
			</div>
		</div>
	);
}

// ─── TelegramEditor ───────────────────────────────────────────────────────────

function TelegramEditor({
	config,
	tgConfigured,
}: {
	config: ConductorConfig;
	tgConfigured: boolean | null;
}) {
	const { showToast, showError } = useDashboard();
	const [saving, setSaving] = useState(false);
	const [showToken, setShowToken] = useState(false);
	const [token, setToken] = useState(config.telegram?.token ?? "");
	const [chatId, setChatId] = useState(
		config.telegram?.chatId ? String(config.telegram.chatId) : "",
	);
	const [fieldError, setFieldError] = useState<string | null>(null);

	useEffect(() => {
		setToken(config.telegram?.token ?? "");
		setChatId(config.telegram?.chatId ? String(config.telegram.chatId) : "");
	}, [config.telegram?.token, config.telegram?.chatId]);

	async function save() {
		setFieldError(null);
		if (!token.trim() && !chatId.trim()) {
			setFieldError("Provide a token and chat ID to configure Telegram");
			return;
		}
		const chatIdNum = parseInt(chatId, 10);
		if (!token.trim() || Number.isNaN(chatIdNum)) {
			setFieldError("Both token and numeric chat ID are required");
			return;
		}
		setSaving(true);
		try {
			await apiUpdateConfig({ telegram: { token: token.trim(), chatId: chatIdNum } });
			showToast("Telegram settings saved");
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Save failed";
			setFieldError(msg);
			showError(msg);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="settings-section">
			<div className="settings-section-title">
				Telegram
				{tgConfigured !== null && (
					<span className={`tg-pill ${tgConfigured ? "configured" : "unconfigured"}`}>
						{tgConfigured ? "configured" : "not configured"}
					</span>
				)}
			</div>
			<div className="card settings-card">
				<label className="track-settings-field" style={{ marginBottom: "8px" }}>
					<span className="settings-key">token</span>
					<div style={{ display: "flex", gap: "4px", flex: 1 }}>
						<input
							type={showToken ? "text" : "password"}
							placeholder="Bot token"
							value={token}
							onChange={(e) => setToken(e.target.value)}
							className="track-settings-input mono"
						/>
						<button
							type="button"
							className="btn-save-track"
							style={{ flexShrink: 0 }}
							onClick={() => setShowToken((v) => !v)}
						>
							{showToken ? "Hide" : "Show"}
						</button>
					</div>
				</label>
				<label className="track-settings-field" style={{ marginBottom: "8px" }}>
					<span className="settings-key">chatId</span>
					<input
						type="text"
						placeholder="Numeric chat ID"
						value={chatId}
						onChange={(e) => setChatId(e.target.value)}
						className="track-settings-input mono"
					/>
				</label>
				{fieldError && (
					<div className="settings-error" style={{ marginBottom: "8px" }}>
						{fieldError}
					</div>
				)}
				<button
					type="button"
					className="btn-save-track"
					disabled={saving}
					onClick={() => void save()}
				>
					{saving ? "Saving…" : "Save"}
				</button>
			</div>
		</div>
	);
}

// ─── WebhookEditor ────────────────────────────────────────────────────────────

function generateSecret(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function WebhookEditor({ config }: { config: ConductorConfig }) {
	const { showToast, showError } = useDashboard();
	const [saving, setSaving] = useState(false);
	const [showSecret, setShowSecret] = useState(false);
	const [secret, setSecret] = useState(config.webhook?.secret ?? "");
	const [fieldError, setFieldError] = useState<string | null>(null);

	useEffect(() => {
		setSecret(config.webhook?.secret ?? "");
	}, [config.webhook?.secret]);

	async function save() {
		setFieldError(null);
		setSaving(true);
		try {
			await apiUpdateConfig({ webhook: { secret: secret.trim() } });
			showToast("Webhook secret saved");
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Save failed";
			setFieldError(msg);
			showError(msg);
		} finally {
			setSaving(false);
		}
	}

	function copySecret() {
		void navigator.clipboard.writeText(secret).then(() => showToast("Copied to clipboard"));
	}

	return (
		<div className="settings-section">
			<div className="settings-section-title">Webhook</div>
			<div className="card settings-card">
				<label className="track-settings-field" style={{ marginBottom: "8px" }}>
					<span className="settings-key">secret</span>
					<div style={{ display: "flex", gap: "4px", flex: 1 }}>
						<input
							type={showSecret ? "text" : "password"}
							placeholder="HMAC secret"
							value={secret}
							onChange={(e) => setSecret(e.target.value)}
							className="track-settings-input mono"
						/>
						<button
							type="button"
							className="btn-save-track"
							style={{ flexShrink: 0 }}
							onClick={() => setShowSecret((v) => !v)}
						>
							{showSecret ? "Hide" : "Show"}
						</button>
					</div>
				</label>
				{fieldError && (
					<div className="settings-error" style={{ marginBottom: "8px" }}>
						{fieldError}
					</div>
				)}
				<div style={{ display: "flex", gap: "8px" }}>
					<button
						type="button"
						className="btn-save-track"
						style={{ background: "var(--surface-2, #2a2a3e)" }}
						onClick={() => {
							const s = generateSecret();
							setSecret(s);
							showToast("New secret generated — save to apply");
						}}
					>
						Regenerate
					</button>
					<button
						type="button"
						className="btn-save-track"
						style={{ background: "var(--surface-2, #2a2a3e)" }}
						disabled={!secret}
						onClick={copySecret}
					>
						Copy
					</button>
					<button
						type="button"
						className="btn-save-track"
						disabled={saving}
						onClick={() => void save()}
					>
						{saving ? "Saving…" : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}

// ─── TrackSettingsEditor ──────────────────────────────────────────────────────

function TrackSettingsEditor() {
	const { showToast, showError, state } = useDashboard();
	const config = state.config; // SSE-synced via DashboardContext
	const [saving, setSaving] = useState<string | null>(null);
	const [edits, setEdits] = useState<Record<string, Partial<Track>>>({});

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
