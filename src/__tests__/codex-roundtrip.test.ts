import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleSession } from "../core/bundle";
import { openDb } from "../core/sqlite";
import { unbundleSession } from "../core/unbundle";

const SESSION_ID = "019ed8ca-db3b-7870-b1ae-9511f710f77c";

/**
 * End-to-end through the public dispatchers: bundleSession({agentId:"codex"})
 * routes to the Codex adapter, and unbundleSession dispatches off the bundle's
 * own agentId (no local config involved).
 */
describe("Codex round-trip via public dispatchers", () => {
	let tmp: string;
	const srcCwd = "/Users/alice/workspace/app";
	const srcUser = "/Users/alice";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rt-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("bundles and restores a Codex session cross-user with thread inventory", async () => {
		const srcCodex = path.join(tmp, "src", ".codex");
		const dir = path.join(srcCodex, "sessions", "2026", "06", "18");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, `rollout-2026-06-18T09-03-53-${SESSION_ID}.jsonl`),
			[
				JSON.stringify({ type: "session_meta", payload: { id: SESSION_ID, cwd: srcCwd, cli_version: "0.140.0" } }),
				JSON.stringify({
					type: "response_item",
					payload: { type: "message", role: "user", content: [{ type: "input_text", text: `open ${srcCwd}/main.ts` }] },
				}),
			].join("\n"),
		);
		const sdb = openDb(path.join(srcCodex, "state_5.sqlite"));
		sdb.exec("create table threads(id text primary key, cwd text, title text, rollout_path text)");
		sdb.run(
			"insert into threads(id,cwd,title,rollout_path) values(?,?,?,?)",
			SESSION_ID,
			srcCwd,
			"RT chat",
			"/old/path",
		);
		sdb.close();

		const bundle = await bundleSession({
			sessionId: SESSION_ID,
			cwd: srcCwd,
			outputDir: tmp,
			codexDir: srcCodex,
			sourceUserDir: srcUser,
			agentId: "codex",
		});
		expect(bundle.metadata.agentId).toBe("codex");

		// Target machine: /Users/bob, fresh ~/.codex with an initialised state db.
		const tgtUser = path.join(tmp, "bob");
		const tgtCodex = path.join(tgtUser, ".codex");
		fs.mkdirSync(tgtCodex, { recursive: true });
		const tdb = openDb(path.join(tgtCodex, "state_5.sqlite"));
		tdb.exec("create table threads(id text primary key, cwd text, title text, rollout_path text)");
		tdb.close();

		const result = await unbundleSession({
			bundlePath: bundle.bundlePath,
			targetUserDir: tgtUser,
			codexDir: tgtCodex,
		});

		expect(result.resumeCommand).toContain(`codex resume ${SESSION_ID}`);
		expect(result.codexStateApplied).toBe(true);

		const tgtCwd = path.join(tgtUser, "workspace", "app");
		const rollout = fs.readFileSync(result.installedTo, "utf-8");
		expect(rollout).not.toContain("/Users/alice");
		// Rollout JSONL is JSON-escaped; normalize separators to compare cross-OS.
		expect(rollout.replace(/\\\\/g, "/")).toContain(`${tgtCwd.replace(/\\/g, "/")}/main.ts`);

		const db = openDb(path.join(tgtCodex, "state_5.sqlite"), { readOnly: true });
		const row = db.get<Record<string, unknown>>("select * from threads where id=?", SESSION_ID);
		db.close();
		expect(row?.cwd).toBe(tgtCwd);
		expect(row?.rollout_path).toBe(result.installedTo);
		expect(row?.title).toBe("RT chat");
	});
});
