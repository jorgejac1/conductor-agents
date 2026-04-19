// ── ANSI colors (disabled when stdout is not a TTY) ──────────────────────────
export const TTY = process.stdout.isTTY === true;
export const c = {
	reset: TTY ? "\x1b[0m" : "",
	bold: TTY ? "\x1b[1m" : "",
	green: TTY ? "\x1b[32m" : "",
	red: TTY ? "\x1b[31m" : "",
	yellow: TTY ? "\x1b[33m" : "",
	gray: TTY ? "\x1b[90m" : "",
	cyan: TTY ? "\x1b[36m" : "",
};

export function parseFlags(args: string[]): Record<string, string | boolean> {
	const flags: Record<string, string | boolean> = {};
	for (const arg of args) {
		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			if (eq !== -1) {
				flags[arg.slice(2, eq)] = arg.slice(eq + 1);
			} else {
				flags[arg.slice(2)] = true;
			}
		} else if (arg.startsWith("-") && arg.length === 2) {
			flags[arg.slice(1)] = true;
		}
	}
	return flags;
}

export function positionalArgs(args: string[]): string[] {
	return args.filter((a) => !a.startsWith("-"));
}

export function buildProgressBar(pct: number, width: number, color = ""): string {
	const filled = Math.round((pct / 100) * width);
	const reset = color ? c.reset : "";
	return `[${color}${"█".repeat(filled)}${reset}${c.gray}${"░".repeat(width - filled)}${c.reset}]`;
}

export function formatDuration(startedAt: string, finishedAt?: string): string {
	const start = new Date(startedAt).getTime();
	const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
	const ms = Math.max(0, end - start);
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const m = Math.floor(ms / 60_000);
	const s = Math.round((ms % 60_000) / 1000);
	return `${m}m ${s}s`;
}
