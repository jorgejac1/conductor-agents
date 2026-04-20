import { useEffect, useRef } from "react";
import type { ConnectionStatus, SSEEvent } from "../types.js";

type OnMessage = (event: SSEEvent) => void;
type OnStatusChange = (status: ConnectionStatus) => void;

export function useSSE(onMessage: OnMessage, onStatusChange: OnStatusChange): void {
	// Use refs so the effect closure always has the latest callbacks
	const onMessageRef = useRef<OnMessage>(onMessage);
	const onStatusRef = useRef<OnStatusChange>(onStatusChange);
	onMessageRef.current = onMessage;
	onStatusRef.current = onStatusChange;

	useEffect(() => {
		let es: EventSource | null = null;
		let dead = false;

		function connect() {
			if (dead) return;
			onStatusRef.current("connecting");
			es = new EventSource("/api/events");

			es.onopen = () => {
				onStatusRef.current("live");
			};

			es.onmessage = (e: MessageEvent<string>) => {
				try {
					const data = JSON.parse(e.data) as SSEEvent;
					onMessageRef.current(data);
				} catch {
					// ignore malformed events
				}
			};

			es.onerror = () => {
				es?.close();
				es = null;
				if (!dead) {
					onStatusRef.current("reconnecting");
					// Native EventSource reconnects on its own, but we explicitly
					// re-open to set our status correctly after a close.
					setTimeout(connect, 2000);
				}
			};
		}

		connect();

		return () => {
			dead = true;
			es?.close();
		};
	}, []); // mount-only effect — callbacks are read via refs
}
