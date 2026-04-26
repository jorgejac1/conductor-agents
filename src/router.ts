import type { IncomingMessage, ServerResponse } from "node:http";

/** Extracted URL path parameters. Values are always strings when a route matched. */
export type RouteParams = { readonly [key: string]: string };

type Handler = (
	req: IncomingMessage,
	res: ServerResponse,
	params: RouteParams,
) => Promise<void> | void;

interface Route {
	method: string;
	parts: string[]; // split on "/", params start with ":"
	handler: Handler;
}

export class Router {
	private routes: Route[] = [];

	on(method: string, path: string, handler: Handler): this {
		this.routes.push({
			method: method.toUpperCase(),
			parts: path.split("/").filter(Boolean),
			handler,
		});
		return this;
	}

	get(path: string, handler: Handler): this {
		return this.on("GET", path, handler);
	}
	post(path: string, handler: Handler): this {
		return this.on("POST", path, handler);
	}

	async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
		const method = (req.method ?? "GET").toUpperCase();
		const rawUrl = req.url ?? "/";
		const urlPath = rawUrl.split("?")[0] ?? "/";
		const parts = urlPath.split("/").filter(Boolean);

		for (const route of this.routes) {
			if (route.method !== method && route.method !== "*") continue;
			if (route.parts.length !== parts.length) continue;
			const params: Record<string, string> = {};
			let match = true;
			for (let i = 0; i < route.parts.length; i++) {
				const rp = route.parts[i] ?? "";
				const part = parts[i] ?? "";
				if (rp.startsWith(":")) {
					params[rp.slice(1)] = decodeURIComponent(part);
				} else if (rp !== part) {
					match = false;
					break;
				}
			}
			if (match) {
				await route.handler(req, res, params);
				return true;
			}
		}
		return false; // no route matched
	}
}
