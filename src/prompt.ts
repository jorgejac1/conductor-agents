import { existsSync, readFileSync } from "node:fs";
import type { Contract } from "evalgate";
import { trackContextPath } from "./config.js";
import type { Track } from "./types.js";

export function buildWorkerPrompt(
	track: Track,
	contract: Contract,
	worktreePath: string,
	cwd = process.cwd(),
): string {
	const contextPath = trackContextPath(track.id, cwd);
	const contextContent = existsSync(contextPath) ? readFileSync(contextPath, "utf8") : "";

	const verifierInfo =
		contract.verifier?.kind === "shell"
			? `Verifier command: \`${contract.verifier.command}\``
			: "No verifier configured";

	return `You are a coding agent working on the "${track.name}" area of the codebase.

## Context

${contextContent}

## Your task

${contract.title}

${verifierInfo}

## Working directory

Your worktree is at: ${worktreePath}

Work only in this worktree. When you are done, commit your changes with a descriptive message.
The verifier will run automatically after you finish. If it fails, you will see the error output and should fix it.

Do not modify files outside your owned paths:
${track.files.map((f) => `- ${f}`).join("\n") || "- (all files)"}
`;
}
