import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryType = "lesson" | "decision" | "reference" | "failure-pattern";

export interface Memory {
	name: string;
	type: MemoryType;
	/** "global" or "track:<trackId>" */
	scope: "global" | `track:${string}`;
	tags: string[];
	body: string;
	/** Absolute path to the memory file */
	filePath: string;
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function memoryDir(cwd: string): string {
	return join(cwd, ".conductor", "memory");
}

function indexPath(cwd: string): string {
	return join(memoryDir(cwd), "INDEX.md");
}

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

// ---------------------------------------------------------------------------
// Frontmatter parser (no external deps — small structured format only)
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): {
	frontmatter: Record<string, string>;
	body: string;
} | null {
	if (!raw.startsWith("---\n")) return null;
	const end = raw.indexOf("\n---\n", 4);
	if (end === -1) return null;
	const fmBlock = raw.slice(4, end);
	const body = raw.slice(end + 5).trim();
	const frontmatter: Record<string, string> = {};
	for (const line of fmBlock.split("\n")) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim();
		frontmatter[key] = value;
	}
	return { frontmatter, body };
}

function parseTags(raw: string): string[] {
	// "[a, b, c]" or "a, b, c" or ""
	const cleaned = raw.replace(/^\[|\]$/g, "").trim();
	if (!cleaned) return [];
	return cleaned
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
}

function buildFrontmatter(m: Omit<Memory, "filePath">): string {
	const tags = m.tags.length > 0 ? `[${m.tags.join(", ")}]` : "[]";
	return `---\nname: ${m.name}\ntype: ${m.type}\nscope: ${m.scope}\ntags: ${tags}\ncreated_at: ${m.createdAt}\n---\n\n${m.body}\n`;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export function writeMemory(cwd: string, m: Omit<Memory, "filePath" | "createdAt">): string {
	if (!m.name?.trim()) throw new Error("memory.name: must be a non-empty string");
	const validTypes: MemoryType[] = ["lesson", "decision", "reference", "failure-pattern"];
	if (!validTypes.includes(m.type))
		throw new Error(`memory.type: must be one of ${validTypes.join(", ")}`);
	if (!m.scope || (!m.scope.startsWith("track:") && m.scope !== "global"))
		throw new Error('memory.scope: must be "global" or "track:<id>"');
	// Reject body containing a standalone "---" line (would break frontmatter parsing)
	if (/^---$/m.test(m.body))
		throw new Error("memory.body: must not contain a standalone '---' line");

	const slug = slugify(m.name);
	if (!slug) throw new Error(`memory.name: cannot be converted to a valid slug`);

	const dir = memoryDir(cwd);
	mkdirSync(dir, { recursive: true });

	const createdAt = new Date().toISOString();
	const filePath = join(dir, `${slug}.md`);
	const content = buildFrontmatter({ ...m, createdAt });

	const tmp = `${filePath}.tmp`;
	writeFileSync(tmp, content, "utf8");
	renameSync(tmp, filePath);

	// Append to INDEX.md — read existing, remove stale entry for this slug, re-add
	const idxPath = indexPath(cwd);
	const existing = existsSync(idxPath) ? readFileSync(idxPath, "utf8") : "";
	const filtered = existing
		.split("\n")
		.filter((l) => !l.includes(`(${slug}.md)`))
		.join("\n")
		.trim();
	const newEntry = `- [${m.name}](${slug}.md) — ${m.type} | ${m.scope}`;
	const newIndex = `${filtered}\n${newEntry}\n`.trimStart();
	const idxTmp = `${idxPath}.tmp`;
	writeFileSync(idxTmp, newIndex, "utf8");
	renameSync(idxTmp, idxPath);

	return filePath;
}

export function loadMemory(cwd: string, opts?: { scope?: string; types?: MemoryType[] }): Memory[] {
	const dir = memoryDir(cwd);
	if (!existsSync(dir)) return [];

	const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "INDEX.md");
	const memories: Memory[] = [];

	for (const file of files) {
		const filePath = join(dir, file);
		try {
			const raw = readFileSync(filePath, "utf8");
			const parsed = parseFrontmatter(raw);
			if (!parsed) continue;
			const { frontmatter, body } = parsed;
			if (!frontmatter.name || !frontmatter.type || !frontmatter.scope) continue;

			const mem: Memory = {
				name: frontmatter.name,
				type: frontmatter.type as MemoryType,
				scope: frontmatter.scope as Memory["scope"],
				tags: parseTags(frontmatter.tags ?? ""),
				body,
				filePath,
				createdAt: frontmatter.created_at ?? "",
			};

			if (opts?.scope !== undefined && mem.scope !== opts.scope) continue;
			if (opts?.types !== undefined && !opts.types.includes(mem.type)) continue;

			memories.push(mem);
		} catch {
			// Skip unreadable / malformed memory files
		}
	}

	// Sort oldest first (createdAt ascending)
	memories.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return memories;
}

export function searchMemory(cwd: string, query: string, opts?: { scope?: string }): Memory[] {
	const loadOpts = opts?.scope !== undefined ? { scope: opts.scope } : undefined;
	const all = loadMemory(cwd, loadOpts);
	const q = query.toLowerCase();
	return all.filter(
		(m) =>
			m.name.toLowerCase().includes(q) ||
			m.body.toLowerCase().includes(q) ||
			m.tags.some((t) => t.toLowerCase().includes(q)),
	);
}

export function listMemorySlugs(cwd: string): string[] {
	const dir = memoryDir(cwd);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".md") && f !== "INDEX.md")
		.map((f) => f.replace(/\.md$/, ""));
}

export function removeMemory(cwd: string, slug: string): void {
	const filePath = join(memoryDir(cwd), `${slug}.md`);
	if (!existsSync(filePath)) throw new Error(`memory '${slug}' not found`);
	rmSync(filePath);

	// Remove from INDEX.md
	const idxPath = indexPath(cwd);
	if (existsSync(idxPath)) {
		const lines = readFileSync(idxPath, "utf8")
			.split("\n")
			.filter((l) => !l.includes(`(${slug}.md)`));
		const idxTmp = `${idxPath}.tmp`;
		writeFileSync(idxTmp, `${lines.join("\n").trim()}\n`, "utf8");
		renameSync(idxTmp, idxPath);
	}
}

// ---------------------------------------------------------------------------
// Prompt injection helper
// ---------------------------------------------------------------------------

const DEFAULT_MEMORY_BUDGET_BYTES = 8192;

/**
 * Formats relevant memories for injection into a worker's prompt.
 * Returns an empty string if there are no memories to inject.
 * Respects the byte budget — oldest memories are dropped first when over limit.
 */
export function formatMemoriesForPrompt(
	memories: Memory[],
	budgetBytes = DEFAULT_MEMORY_BUDGET_BYTES,
): string {
	if (memories.length === 0) return "";

	// Sort newest-first so we keep recent memories when the budget is tight.
	const sorted = [...memories].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);

	const header = "## Memories\n\n";
	const headerBytes = Buffer.byteLength(header, "utf8");
	const lines: string[] = [];
	let totalBytes = headerBytes;

	for (const m of sorted) {
		const line = `- [${m.type}] ${m.name}: ${m.body.replace(/\n/g, " ").slice(0, 300)}`;
		const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
		if (totalBytes + lineBytes > budgetBytes) continue;
		lines.push(line);
		totalBytes += lineBytes;
	}

	if (lines.length === 0) return "";
	return `${header}${lines.join("\n")}`;
}
