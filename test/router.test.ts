import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { Router } from "../src/router.js";

function makeReq(method: string, url: string): IncomingMessage {
	return { method, url } as IncomingMessage;
}

function makeRes(): ServerResponse & { _statusCode?: number; _body?: string } {
	const res = {
		_statusCode: undefined as number | undefined,
		_body: undefined as string | undefined,
		headersSent: false,
		writeHead(code: number) {
			this._statusCode = code;
		},
		end(body?: string) {
			this._body = body;
		},
	} as unknown as ServerResponse & { _statusCode?: number; _body?: string };
	return res;
}

describe("Router", () => {
	it("matches GET /api/tracks and calls handler", async () => {
		const router = new Router();
		let called = false;
		router.get("/api/tracks", (_req, _res, _params) => {
			called = true;
		});

		const matched = await router.handle(makeReq("GET", "/api/tracks"), makeRes());
		assert.strictEqual(matched, true);
		assert.strictEqual(called, true);
	});

	it("extracts :id param from /api/tracks/:id/state", async () => {
		const router = new Router();
		let capturedId = "";
		router.get("/api/tracks/:id/state", (_req, _res, params) => {
			capturedId = params.id;
		});

		const matched = await router.handle(makeReq("GET", "/api/tracks/auth-module/state"), makeRes());
		assert.strictEqual(matched, true);
		assert.strictEqual(capturedId, "auth-module");
	});

	it("does not match GET on a POST route", async () => {
		const router = new Router();
		let called = false;
		router.post("/api/tracks/:id/run", (_req, _res, _params) => {
			called = true;
		});

		const matched = await router.handle(makeReq("GET", "/api/tracks/auth/run"), makeRes());
		assert.strictEqual(matched, false);
		assert.strictEqual(called, false);
	});

	it("returns false when no route matches", async () => {
		const router = new Router();
		router.get("/api/tracks", (_req, _res, _params) => {});

		const matched = await router.handle(makeReq("GET", "/api/nonexistent"), makeRes());
		assert.strictEqual(matched, false);
	});

	it("matches POST /api/tracks/:id/run", async () => {
		const router = new Router();
		let capturedId = "";
		router.post("/api/tracks/:id/run", (_req, _res, params) => {
			capturedId = params.id;
		});

		const matched = await router.handle(makeReq("POST", "/api/tracks/backend/run"), makeRes());
		assert.strictEqual(matched, true);
		assert.strictEqual(capturedId, "backend");
	});

	it("does not match route with wrong segment count", async () => {
		const router = new Router();
		let called = false;
		router.get("/api/tracks/:id", (_req, _res, _params) => {
			called = true;
		});

		// /api/tracks has 2 parts, route has 3 parts — should not match
		const matched = await router.handle(makeReq("GET", "/api/tracks"), makeRes());
		assert.strictEqual(matched, false);
		assert.strictEqual(called, false);
	});

	it("URL with query string still matches route", async () => {
		const router = new Router();
		let capturedId = "";
		router.get("/api/tracks/:id/history", (_req, _res, params) => {
			capturedId = params.id;
		});

		const matched = await router.handle(
			makeReq("GET", "/api/tracks/auth/history?limit=50"),
			makeRes(),
		);
		assert.strictEqual(matched, true);
		assert.strictEqual(capturedId, "auth");
	});

	it("URL-decodes param values", async () => {
		const router = new Router();
		let capturedId = "";
		router.get("/api/workspace/projects/:id", (_req, _res, params) => {
			capturedId = params.id;
		});

		const matched = await router.handle(
			makeReq("GET", "/api/workspace/projects/my%20project"),
			makeRes(),
		);
		assert.strictEqual(matched, true);
		assert.strictEqual(capturedId, "my project");
	});
});
