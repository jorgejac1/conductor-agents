import { createInterface } from "node:readline";
import type { MemoryType } from "../memory.js";
import { listMemorySlugs, loadMemory, removeMemory, searchMemory, writeMemory } from "../memory.js";
import { parseFlags, positionalArgs } from "./helpers.js";

async function readStdin(): Promise<string> {
	const rl = createInterface({ input: process.stdin });
	const lines: string[] = [];
	for await (const line of rl) lines.push(line);
	return lines.join("\n");
}

async function cmdMemoryList(args: string[], cwd: string): Promise<number> {
	const flags = parseFlags(args);
	const scope = typeof flags.scope === "string" ? flags.scope : undefined;
	const type = typeof flags.type === "string" ? (flags.type as MemoryType) : undefined;
	const memories = loadMemory(cwd, {
		...(scope !== undefined && { scope }),
		...(type !== undefined && { types: [type] }),
	});
	if (memories.length === 0) {
		console.log("No memories found.");
		return 0;
	}
	for (const m of memories) {
		console.log(`${m.scope.padEnd(20)}  [${m.type}]  ${m.name}`);
	}
	return 0;
}

function cmdMemoryShow(args: string[], cwd: string): number {
	const slug = positionalArgs(args)[0];
	if (!slug) {
		console.error("Usage: conductor memory show <slug>");
		return 1;
	}
	const memories = loadMemory(cwd);
	const mem = memories.find((m) => m.filePath.endsWith(`${slug}.md`));
	if (!mem) {
		console.error(`memory '${slug}' not found`);
		return 1;
	}
	console.log(`name:       ${mem.name}`);
	console.log(`type:       ${mem.type}`);
	console.log(`scope:      ${mem.scope}`);
	console.log(`tags:       ${mem.tags.join(", ") || "(none)"}`);
	console.log(`created_at: ${mem.createdAt}`);
	console.log("");
	console.log(mem.body);
	return 0;
}

async function cmdMemoryAdd(args: string[], cwd: string): Promise<number> {
	const flags = parseFlags(args);
	const name = typeof flags.name === "string" ? flags.name : undefined;
	const type = typeof flags.type === "string" ? (flags.type as MemoryType) : undefined;
	const scope = typeof flags.scope === "string" ? flags.scope : undefined;
	let body = typeof flags.body === "string" ? flags.body : undefined;

	if (!name || !type || !scope) {
		console.error("Usage: conductor memory add --name=X --type=lesson --scope=global --body='...'");
		console.error("       (or --body=- to read body from stdin)");
		return 1;
	}
	if (body === "-" || body === undefined) {
		body = await readStdin();
	}
	if (!body.trim()) {
		console.error("conductor memory add: body must not be empty");
		return 1;
	}
	const tagsRaw = typeof flags.tags === "string" ? flags.tags : "";
	const tags = tagsRaw
		? tagsRaw
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
		: [];

	try {
		const filePath = writeMemory(cwd, {
			name,
			type,
			scope: scope as "global" | `track:${string}`,
			body: body.trim(),
			tags,
		});
		console.log(`Memory written: ${filePath}`);
		return 0;
	} catch (err) {
		console.error(`conductor memory add: ${err instanceof Error ? err.message : String(err)}`);
		return 1;
	}
}

function cmdMemoryRm(args: string[], cwd: string): number {
	const slug = positionalArgs(args)[0];
	if (!slug) {
		console.error("Usage: conductor memory rm <slug>");
		return 1;
	}
	try {
		removeMemory(cwd, slug);
		console.log(`Removed memory: ${slug}`);
		return 0;
	} catch (err) {
		console.error(`conductor memory rm: ${err instanceof Error ? err.message : String(err)}`);
		return 1;
	}
}

async function cmdMemorySearch(args: string[], cwd: string): Promise<number> {
	const query = positionalArgs(args)[0];
	if (!query) {
		console.error("Usage: conductor memory search <query>");
		return 1;
	}
	const flags = parseFlags(args);
	const scope = typeof flags.scope === "string" ? flags.scope : undefined;
	const results = searchMemory(cwd, query, scope !== undefined ? { scope } : undefined);
	if (results.length === 0) {
		console.log("No matches found.");
		return 0;
	}
	for (const m of results) {
		console.log(`${m.scope.padEnd(20)}  [${m.type}]  ${m.name}`);
	}
	return 0;
}

function cmdMemorySlugs(cwd: string): number {
	const slugs = listMemorySlugs(cwd);
	if (slugs.length === 0) {
		console.log("No memories.");
		return 0;
	}
	for (const s of slugs) console.log(s);
	return 0;
}

export async function cmdMemory(args: string[], cwd = process.cwd()): Promise<number> {
	const sub = positionalArgs(args)[0];

	switch (sub) {
		case "list":
			return cmdMemoryList(args.slice(1), cwd);
		case "show":
			return cmdMemoryShow(args.slice(1), cwd);
		case "add":
			return cmdMemoryAdd(args.slice(1), cwd);
		case "rm":
		case "remove":
			return cmdMemoryRm(args.slice(1), cwd);
		case "search":
			return cmdMemorySearch(args.slice(1), cwd);
		case "slugs":
			return cmdMemorySlugs(cwd);
		default:
			console.error("Usage:");
			console.error("  conductor memory list [--scope=global|track:<id>] [--type=lesson]");
			console.error("  conductor memory show <slug>");
			console.error("  conductor memory add --name=X --type=lesson --scope=global --body='...'");
			console.error("  conductor memory rm <slug>");
			console.error("  conductor memory search <query> [--scope=...]");
			return 1;
	}
}
