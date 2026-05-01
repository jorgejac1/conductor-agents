import { useCallback, useEffect, useMemo, useState } from "react";
import { useDashboard } from "../context/DashboardContext.js";
import { fetchMemories } from "../hooks/api.js";
import type { MemoryEntry, MemoryType } from "../types.js";

const TYPE_LABELS: Record<MemoryType, string> = {
	lesson: "Lesson",
	decision: "Decision",
	reference: "Reference",
	"failure-pattern": "Failure",
};

const TYPE_COLORS: Record<MemoryType, string> = {
	lesson: "var(--done)",
	decision: "var(--running)",
	reference: "var(--accent)",
	"failure-pattern": "#f59e0b",
};

function bodyPreview(body: string): string {
	const first = body.split("\n").find((l) => l.trim().length > 0) ?? "";
	return first.length > 120 ? `${first.slice(0, 120)}…` : first;
}

function dateBucket(iso: string): string {
	const now = new Date();
	const d = new Date(iso);
	const diffMs = now.getTime() - d.getTime();
	const diffDays = Math.floor(diffMs / 86_400_000);
	if (diffDays === 0) return "Today";
	if (diffDays === 1) return "Yesterday";
	if (diffDays <= 7) return "This week";
	return "Older";
}

const BUCKET_ORDER = ["Today", "Yesterday", "This week", "Older"];

function RefreshIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
			<path
				d="M1.5 7a5.5 5.5 0 1 0 1.1-3.3"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
			<path
				d="M1.5 2.5v3h3"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function ChevronIcon({ open }: { open: boolean }) {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 12 12"
			fill="none"
			aria-hidden="true"
			className={`memory-chevron-icon${open ? " memory-chevron-open" : ""}`}
		>
			<path
				d="M2.5 4.5L6 8l3.5-3.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function MemoryCard({
	memory,
	expanded,
	onToggle,
	searchQuery,
}: {
	memory: MemoryEntry;
	expanded: boolean;
	onToggle: () => void;
	searchQuery: string;
}) {
	const typeColor = TYPE_COLORS[memory.type] ?? "var(--accent)";
	const typeLabel = TYPE_LABELS[memory.type] ?? memory.type;
	const scopeLabel = memory.scope.startsWith("track:")
		? memory.scope.replace("track:", "")
		: "global";
	const isGlobal = memory.scope === "global";
	const preview = bodyPreview(memory.body);

	function highlight(text: string): React.ReactNode {
		if (!searchQuery.trim()) return text;
		const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase());
		if (idx === -1) return text;
		return (
			<>
				{text.slice(0, idx)}
				<mark className="memory-highlight">{text.slice(idx, idx + searchQuery.length)}</mark>
				{text.slice(idx + searchQuery.length)}
			</>
		);
	}

	return (
		<div className="memory-card" data-expanded={expanded} data-type={memory.type}>
			<button
				type="button"
				className="memory-card-header"
				onClick={onToggle}
				aria-expanded={expanded}
			>
				<div className="memory-card-main">
					<div className="memory-card-title-row">
						<span
							className="memory-type-badge"
							style={{ "--type-color": typeColor } as React.CSSProperties}
						>
							{typeLabel}
						</span>
						<span className="memory-name">{highlight(memory.name)}</span>
					</div>
					{preview && !expanded && <p className="memory-preview">{highlight(preview)}</p>}
				</div>
				<span className="memory-meta">
					<span className={`memory-scope-pill${isGlobal ? " memory-scope-global" : ""}`}>
						{isGlobal ? "global" : `track: ${scopeLabel}`}
					</span>
					<ChevronIcon open={expanded} />
				</span>
			</button>
			{expanded && (
				<div className="memory-body">
					<pre className="memory-body-text">{memory.body}</pre>
					{memory.tags.length > 0 && (
						<div className="memory-tags">
							{memory.tags.map((tag) => (
								<span key={tag} className="memory-tag">
									#{tag}
								</span>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function MemoryTab() {
	const { memoryVersion } = useDashboard();
	const [memories, setMemories] = useState<MemoryEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
	const [filterScope, setFilterScope] = useState("");
	const [filterType, setFilterType] = useState<MemoryType | "">("");
	const [search, setSearch] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: memoryVersion is a refresh signal only
	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const opts: { scope?: string; type?: string } = {};
			if (filterScope) opts.scope = filterScope;
			if (filterType) opts.type = filterType;
			const data = await fetchMemories(opts);
			setMemories(data);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load memories");
		} finally {
			setLoading(false);
		}
	}, [filterScope, filterType, memoryVersion]);

	useEffect(() => {
		void load();
	}, [load]);

	const slugFor = (m: MemoryEntry) => m.filePath.split("/").pop()?.replace(/\.md$/, "") ?? m.name;

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return memories;
		return memories.filter(
			(m) =>
				m.name.toLowerCase().includes(q) ||
				m.body.toLowerCase().includes(q) ||
				m.tags.some((t) => t.toLowerCase().includes(q)),
		);
	}, [memories, search]);

	const grouped = useMemo(() => {
		const sorted = [...filtered].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
		const map = new Map<string, MemoryEntry[]>();
		for (const m of sorted) {
			const bucket = dateBucket(m.createdAt);
			const existing = map.get(bucket) ?? [];
			existing.push(m);
			map.set(bucket, existing);
		}
		return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({
			label: b,
			items: map.get(b) ?? [],
		}));
	}, [filtered]);

	const totalVisible = filtered.length;

	return (
		<div className="memory-tab">
			<div className="memory-toolbar">
				<div className="memory-toolbar-left">
					<span className="memory-count">
						{totalVisible} {totalVisible === 1 ? "memory" : "memories"}
						{search && totalVisible !== memories.length && (
							<span className="memory-count-filtered"> of {memories.length}</span>
						)}
					</span>
				</div>
				<div className="memory-filters">
					<div className="memory-search-wrap">
						<svg
							className="memory-search-icon"
							width="12"
							height="12"
							viewBox="0 0 12 12"
							fill="none"
							aria-hidden="true"
						>
							<circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.5" />
							<path
								d="M8 8l2.5 2.5"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
						<input
							className="memory-filter-input memory-search-input"
							type="search"
							placeholder="Search name, body, tags…"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							aria-label="Search memories"
						/>
					</div>
					<select
						className="memory-filter-select"
						value={filterType}
						onChange={(e) => setFilterType(e.target.value as MemoryType | "")}
						aria-label="Filter by type"
					>
						<option value="">All types</option>
						<option value="lesson">Lesson</option>
						<option value="decision">Decision</option>
						<option value="reference">Reference</option>
						<option value="failure-pattern">Failure pattern</option>
					</select>
					<input
						className="memory-filter-input"
						type="text"
						placeholder="Scope…"
						value={filterScope}
						onChange={(e) => setFilterScope(e.target.value)}
						aria-label="Filter by scope"
					/>
					<button
						type="button"
						className="btn-icon"
						onClick={() => void load()}
						title="Refresh memories"
						aria-label="Refresh memories"
					>
						<RefreshIcon />
					</button>
				</div>
			</div>

			{loading && <div className="empty-state">Loading memories…</div>}
			{!loading && error && <div className="empty-state empty-state--error">{error}</div>}
			{!loading && !error && memories.length === 0 && (
				<div className="empty-state">
					<div className="empty-state-title">No memories yet</div>
					<div className="empty-state-desc">
						Memories are written by agents during runs or via <code>conductor memory add</code>.
					</div>
				</div>
			)}
			{!loading && !error && filtered.length === 0 && memories.length > 0 && (
				<div className="empty-state">
					<div className="empty-state-title">No matches</div>
					<div className="empty-state-desc">Try a different search term or filter.</div>
				</div>
			)}
			{!loading && !error && grouped.length > 0 && (
				<div className="memory-groups">
					{grouped.map(({ label, items }) => (
						<div key={label} className="memory-group">
							{items.length > 1 && <div className="memory-group-label">{label}</div>}
							<div className="memory-list">
								{items.map((m) => {
									const slug = slugFor(m);
									return (
										<MemoryCard
											key={slug}
											memory={m}
											expanded={expandedSlug === slug}
											onToggle={() => setExpandedSlug(expandedSlug === slug ? null : slug)}
											searchQuery={search}
										/>
									);
								})}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
