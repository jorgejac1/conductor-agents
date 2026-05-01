import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Router } from "../router.js";
import { listTracks } from "../track.js";
import { findWorkspaceRoot, scanProjects } from "./discovery.js";
import type { ProjectEntry } from "./types.js";
import { watchDir } from "./watcher.js";

function json(res: ServerResponse, data: unknown, status = 200): void {
	res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
	res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

export function registerWorkspaceRoutes(
	router: Router,
	cwd: string,
	sseClients: Set<ServerResponse>,
): () => void {
	const workspaceRoot = findWorkspaceRoot(cwd);
	// Lazily populated on first API request — avoids scanning at server startup.
	let projects: ProjectEntry[] | null = null;

	function getProjects(): ProjectEntry[] {
		if (projects === null) projects = scanProjects(workspaceRoot);
		return projects;
	}

	// Show workspace sidebar only when there's a real parent workspace with
	// at least 2 initialized conductor projects. Prevents /tmp and other
	// system dirs full of test repos from triggering workspace mode.
	const isRealWorkspace =
		workspaceRoot !== cwd && getProjects().filter((p) => p.initialized).length >= 2;

	function broadcastWorkspace(): void {
		const payload = JSON.stringify({
			type: "workspace",
			projects: getProjects(),
			root: workspaceRoot,
			discovered: isRealWorkspace,
		});
		const data = `data: ${payload}\n\n`;
		for (const res of sseClients) {
			try {
				res.write(data);
			} catch {
				sseClients.delete(res);
			}
		}
	}

	// Only watch the filesystem when we have a real multi-project workspace.
	// Skipping when workspaceRoot === cwd or when running in a system temp dir
	// prevents spurious EACCES errors on Linux CI runners where /tmp contains
	// inaccessible systemd-private subdirectories.
	const rootWatcher = isRealWorkspace
		? watchDir(workspaceRoot, () => {
				const refreshed = scanProjects(workspaceRoot);
				if (JSON.stringify(refreshed) !== JSON.stringify(projects)) {
					projects = refreshed;
					broadcastWorkspace();
				}
			})
		: { stop() {} };

	// Watch each initialized project's .conductor dir
	const projectWatchers = new Map<string, ReturnType<typeof watchDir>>();

	function ensureProjectWatchers(): void {
		if (!isRealWorkspace) return;
		for (const p of getProjects()) {
			if (p.initialized && !projectWatchers.has(p.id)) {
				const conductorDir = join(p.path, ".conductor");
				projectWatchers.set(
					p.id,
					watchDir(conductorDir, () => {
						projects = scanProjects(workspaceRoot);
						broadcastWorkspace();
					}),
				);
			}
		}
	}

	// GET /api/workspace
	router.get("/api/workspace", (_req, res) => {
		json(res, {
			root: workspaceRoot,
			projectCount: getProjects().length,
			discovered: isRealWorkspace,
		});
	});

	// GET /api/workspace/projects
	router.get("/api/workspace/projects", (_req, res) => {
		projects = scanProjects(workspaceRoot);
		json(res, projects);
	});

	// GET /api/workspace/projects/:id
	router.get("/api/workspace/projects/:id", (_req, res, params) => {
		const project = getProjects().find((p) => p.id === (params.id ?? ""));
		if (!project) {
			json(res, { error: "project not found" }, 404);
			return;
		}
		json(res, project);
	});

	// GET /api/workspace/projects/:id/tracks — tracks for a specific project
	router.get("/api/workspace/projects/:id/tracks", (_req, res, params) => {
		const project = getProjects().find((p) => p.id === (params.id ?? ""));
		if (!project) {
			json(res, { error: "project not found" }, 404);
			return;
		}
		if (!project.initialized) {
			json(res, [], 200);
			return;
		}
		listTracks(project.path)
			.then((tracks) => json(res, tracks))
			.catch((err: unknown) => json(res, { error: String(err) }, 500));
	});

	// POST /api/workspace/projects/:id/init — run conductor init in the project dir
	router.post("/api/workspace/projects/:id/init", async (req, res, params) => {
		const project = getProjects().find((p: ProjectEntry) => p.id === (params.id ?? ""));
		if (!project) {
			json(res, { error: "project not found" }, 404);
			return;
		}
		if (project.initialized) {
			json(res, { error: "already initialized" }, 400);
			return;
		}

		const body = await readBody(req);
		let parsed: { goal?: string } = {};
		try {
			parsed = JSON.parse(body);
		} catch {
			/* ignore */
		}

		const conductorBin = join(cwd, "node_modules", ".bin", "conductor");
		const bin = existsSync(conductorBin) ? conductorBin : "conductor";

		try {
			await runCmd(bin, ["init"], project.path);
			if (parsed.goal) {
				await runCmd(bin, ["plan", parsed.goal], project.path);
			}
			projects = scanProjects(workspaceRoot);
			ensureProjectWatchers();
			broadcastWorkspace();
			json(res, {
				ok: true,
				project: projects.find((p: ProjectEntry) => p.id === (params.id ?? "")),
			});
		} catch (err) {
			json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
		}
	});

	// POST /api/workspace/projects/:id/run/:trackId
	router.post("/api/workspace/projects/:id/run/:trackId", async (_req, res, params) => {
		const project = getProjects().find((p: ProjectEntry) => p.id === (params.id ?? ""));
		if (!project) {
			json(res, { error: "project not found" }, 404);
			return;
		}
		const bin = "conductor";
		try {
			// Fire-and-forget — workspace just triggers it
			runCmd(bin, ["run", params.trackId ?? ""], project.path).catch(() => {
				/* ignore */
			});
			broadcastWorkspace();
			json(res, { ok: true });
		} catch (err) {
			json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
		}
	});

	return function cleanup() {
		rootWatcher.stop();
		for (const w of projectWatchers.values()) w.stop();
		projectWatchers.clear();
	};
}

function runCmd(cmd: string, args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { cwd, stdio: "pipe" });
		child.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
		);
		child.on("error", reject);
	});
}
