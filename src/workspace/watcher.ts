import type { FSWatcher } from "node:fs";
import { watch } from "node:fs";

export interface WatchHandle {
	stop: () => void;
}

/** Watch a directory recursively. Calls onChange with the changed filename. */
export function watchDir(dirPath: string, onChange: (filename: string) => void): WatchHandle {
	let watcher: FSWatcher | null = null;
	try {
		watcher = watch(dirPath, { recursive: true }, (_event, filename) => {
			onChange(filename ?? "");
		});
		// Suppress EACCES and similar async errors (e.g. on Linux /tmp with system subdirs)
		watcher.on("error", () => {});
	} catch {
		/* directory may not exist yet or not accessible */
	}
	return {
		stop() {
			try {
				watcher?.close();
			} catch {
				/* ignore */
			}
			watcher = null;
		},
	};
}
