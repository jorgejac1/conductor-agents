import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { tentacleContextPath, tentacleTodoPath } from "../src/config.js";
import {
	createTentacle,
	deleteTentacle,
	getTentacle,
	initConductor,
	listTentacles,
} from "../src/tentacle.js";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "conductor-tent-"));
}

describe("tentacle", () => {
	it("createTentacle creates directories and files", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			const t = createTentacle("Auth Module", "Handles auth", ["src/auth/**"], dir);
			assert.strictEqual(t.id, "auth-module");
			assert.strictEqual(t.name, "Auth Module");
			assert.ok(existsSync(tentacleContextPath("auth-module", dir)));
			assert.ok(existsSync(tentacleTodoPath("auth-module", dir)));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("createTentacle updates config with new tentacle", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTentacle("Payments", "Payment processing", ["src/payments/**"], dir);
			const t = getTentacle("payments", dir);
			assert.strictEqual(t.name, "Payments");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("createTentacle throws if tentacle id already exists", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTentacle("Auth", "First", [], dir);
			assert.throws(() => createTentacle("Auth", "Second", [], dir), /already exists/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("deleteTentacle removes directory and config entry", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTentacle("Temp Feature", "Temporary", [], dir);
			const contextPath = tentacleContextPath("temp-feature", dir);
			assert.ok(existsSync(contextPath));

			deleteTentacle("temp-feature", dir);
			assert.ok(!existsSync(contextPath));

			assert.throws(() => getTentacle("temp-feature", dir), /not found/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("listTentacles returns empty array when no tentacles", async () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			const statuses = await listTentacles(dir);
			assert.strictEqual(statuses.length, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("listTentacles returns statuses with zero progress for new tentacles", async () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTentacle("Feature A", "A feature", [], dir);
			createTentacle("Feature B", "B feature", [], dir);

			const statuses = await listTentacles(dir);
			assert.strictEqual(statuses.length, 2);
			for (const s of statuses) {
				assert.strictEqual(s.todoTotal, 0);
				assert.strictEqual(s.todoDone, 0);
				assert.strictEqual(s.swarmState, null);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("getTentacle throws when no config", () => {
		const dir = tmpDir();
		try {
			assert.throws(() => getTentacle("anything", dir), /No conductor config/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("CONTEXT.md contains name, description, and files", () => {
		const dir = tmpDir();
		try {
			initConductor(dir);
			createTentacle("My Feature", "Does stuff", ["src/features/**", "src/utils/**"], dir);
			const content = readFileSync(tentacleContextPath("my-feature", dir), "utf8");
			assert.ok(content.includes("My Feature"));
			assert.ok(content.includes("Does stuff"));
			assert.ok(content.includes("src/features/**"));
			assert.ok(content.includes("src/utils/**"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
