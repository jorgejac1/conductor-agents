import { useEffect, useRef, useState } from "react";
import { fetchLog } from "./api.js";

/**
 * Streams a worker's log via SSE while the worker is running, then fetches
 * the final log content once it reaches a terminal state.
 *
 * @param trackId  - track id
 * @param workerId - worker id
 * @param isRunning - true while the worker is in a non-terminal state
 */
export function useLogStream(
	trackId: string,
	workerId: string,
	isRunning: boolean,
): { log: string; isStreaming: boolean } {
	const [log, setLog] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const esRef = useRef<EventSource | null>(null);

	useEffect(() => {
		// Clean up any previous stream.
		function close() {
			esRef.current?.close();
			esRef.current = null;
			setIsStreaming(false);
		}

		if (!isRunning) {
			// Worker is terminal — close any open stream and fetch complete log once.
			close();
			fetchLog(trackId, workerId)
				.then((content) => setLog(content))
				.catch(() => setLog("(failed to load log)"));
			return close;
		}

		// Worker is active — open an SSE stream.
		const streamUrl = `/api/tracks/${trackId}/logs/${workerId}/stream`;
		const es = new EventSource(streamUrl);
		esRef.current = es;
		setIsStreaming(true);

		es.onmessage = (event: MessageEvent) => {
			try {
				const chunk = JSON.parse(event.data as string) as string;
				setLog((prev) => prev + chunk);
			} catch {
				/* ignore malformed chunks */
			}
		};

		// Server sends "event: done" when the worker reaches terminal state.
		es.addEventListener("done", () => {
			close();
			// Fetch final log to ensure we have the complete content.
			fetchLog(trackId, workerId)
				.then((content) => setLog(content))
				.catch(() => {
					/* keep streamed content */
				});
		});

		es.onerror = () => {
			close();
		};

		return close;
	}, [trackId, workerId, isRunning]);

	return { log, isStreaming };
}
