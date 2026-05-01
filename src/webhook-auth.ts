/**
 * Shared webhook HMAC verification utilities.
 *
 * Used by both the dashboard server (/api/webhook) and the standalone
 * webhook CLI server (`conductor webhook start`) so both endpoints enforce
 * the same contract: X-Hub-Signature-256 header, SHA-256 HMAC, timing-safe
 * comparison.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Read the full request body as a UTF-8 string.
 * Consumes the stream — call this before any other body reads.
 */
export function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString("utf8");
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

/**
 * Verify an X-Hub-Signature-256 header against the request body and secret.
 *
 * Accepts the `sha256=<hex>` format (GitHub-compatible).
 * Uses timingSafeEqual to prevent timing attacks.
 *
 * Returns false if signature is missing, malformed, or doesn't match.
 */
export function verifyHmac(body: string, signature: string | undefined, secret: string): boolean {
	if (!signature) return false;
	const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
	try {
		const sigBuf = Buffer.from(signature);
		const expBuf = Buffer.from(expected);
		// Buffers must be the same length for timingSafeEqual — if they differ,
		// the signature is structurally invalid (length mismatch reveals nothing useful).
		if (sigBuf.length !== expBuf.length) return false;
		return timingSafeEqual(sigBuf, expBuf);
	} catch {
		return false;
	}
}
