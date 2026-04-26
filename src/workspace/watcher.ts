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
	} catch {
		/* directory may not exist yet */
	}
	return {
		stop() {
			try {
				watcher?.close();
			} catch {
				/* ignore */
			}
		},
	};
}
