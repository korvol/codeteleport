import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleCodexSession } from "../core/agents/codex/bundle";
import { unbundleCodexSession } from "../core/agents/codex/unbundle";
import { openDb } from "../core/sqlite";

const SESSION_ID = "019ed8ca-db3b-7870-b1ae-9511f710f77c";

function writeSource(codexDir: string, cwd: string, userDir: string): void {
	const dir = path.join(codexDir, "sessions", "2026", "06", "18");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, `rollout-2026-06-18T09-03-53-${SESSION_ID}.jsonl`),
		[
			JSON.stringify({
				timestamp: "2026-06-18T09:03:53.000Z",
				type: "session_meta",
				payload: { id: SESSION_ID, cwd, cli_version: "0.140.0", timestamp: "2026-06-18T09:03:53.000Z" },
			}),
			JSON.stringify({
				type: "response_item",
				payload: { type: "message", role: "user", content: [{ type: "input_text", text: `edit ${cwd}/x.ts` }] },
			}),
		].join("\n"),
	);
	const db = openDb(path.join(codexDir, "state_5.sqlite"));
	db.exec("create table threads(id text primary key, cwd text, title text, model text, sandbox_policy text)");
	db.run(
		"insert into threads(id,cwd,title,model,sandbox_policy) values(?,?,?,?,?)",
		SESSION_ID,
		cwd,
		"My chat",
		"gpt-5.5",
		JSON.stringify({ writable_roots: [cwd] }),
	);
	db.exec("create table thread_dynamic_tools(thread_id text, position integer, name text)");
	db.run("insert into thread_dynamic_tools(thread_id,position,name) values(?,?,?)", SESSION_ID, 0, "my_tool");
	db.close();
}

async function bundleAndStage(
	srcCodex: string,
	cwd: string,
	srcUser: string,
	out: string,
): Promise<{ stagingDir: string; meta: Record<string, unknown> }> {
	fs.mkdirSync(out, { recursive: true });
	const res = await bundleCodexSession({
		sessionId: SESSION_ID,
		cwd,
		outputDir: out,
		codexDir: srcCodex,
		sourceUserDir: srcUser,
		agentId: "codex",
	});
	const stagingDir = path.join(out, "staging");
	fs.mkdirSync(stagingDir, { recursive: true });
	await tar.extract({ file: res.bundlePath, cwd: stagingDir });
	const meta = JSON.parse(fs.readFileSync(path.join(stagingDir, "meta.json"), "utf-8"));
	return { stagingDir, meta };
}

describe("unbundleCodexSession", () => {
	let tmp: string;
	const srcCwd = "/Users/alice/workspace/app";
	const srcUser = "/Users/alice";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-unbundle-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("restores the rollout with rewritten paths and upserts the threads row (dynamic columns)", async () => {
		const srcCodex = path.join(tmp, "src", ".codex");
		writeSource(srcCodex, srcCwd, srcUser);
		const { stagingDir, meta } = await bundleAndStage(srcCodex, srcCwd, srcUser, path.join(tmp, "b1"));

		// Target home is /Users/bob, and its threads table has a DIFFERENT column subset
		// (no `model`, plus an extra `preview`) — proves we only write existing columns.
		const tgtUser = path.join(tmp, "bob");
		const tgtCodex = path.join(tgtUser, ".codex");
		fs.mkdirSync(tgtCodex, { recursive: true });
		const tdb = openDb(path.join(tgtCodex, "state_5.sqlite"));
		tdb.exec("create table threads(id text primary key, cwd text, title text, sandbox_policy text, preview text)");
		tdb.exec("create table thread_dynamic_tools(thread_id text, position integer, name text)");
		tdb.close();

		const result = unbundleCodexSession({
			stagingDir,
			meta,
			options: { bundlePath: "", targetUserDir: tgtUser, codexDir: tgtCodex },
		});

		const tgtCwd = `${tgtUser}/workspace/app`;
		expect(result.resumeCommand).toContain(`codex resume ${SESSION_ID}`);

		// Transcript restored under the target codex home, paths rewritten.
		const rolloutPath = path.join(tgtCodex, meta.rolloutRelPath as string);
		expect(fs.existsSync(rolloutPath)).toBe(true);
		const content = fs.readFileSync(rolloutPath, "utf-8");
		expect(content).not.toContain("/Users/alice");
		expect(content).toContain(`${tgtCwd}/x.ts`);

		// threads row upserted with target cwd + target rollout path, only existing cols.
		const db = openDb(path.join(tgtCodex, "state_5.sqlite"), { readOnly: true });
		const row = db.get<Record<string, unknown>>("select * from threads where id=?", SESSION_ID);
		db.close();
		expect(row?.cwd).toBe(tgtCwd);
		expect(row?.title).toBe("My chat");
		expect(row?.rollout_path).toBeUndefined(); // target table has no rollout_path column → skipped, no crash
		expect(String(row?.sandbox_policy)).not.toContain("/Users/alice");

		// dynamic tools restored
		const db2 = openDb(path.join(tgtCodex, "state_5.sqlite"), { readOnly: true });
		const tools = db2.all("select * from thread_dynamic_tools where thread_id=?", SESSION_ID);
		db2.close();
		expect(tools).toHaveLength(1);
	});

	it("restores the transcript even when the target state_5.sqlite is absent", async () => {
		const srcCodex = path.join(tmp, "src2", ".codex");
		writeSource(srcCodex, srcCwd, srcUser);
		const { stagingDir, meta } = await bundleAndStage(srcCodex, srcCwd, srcUser, path.join(tmp, "b2"));

		const tgtUser = path.join(tmp, "carol");
		const tgtCodex = path.join(tgtUser, ".codex");

		const result = unbundleCodexSession({
			stagingDir,
			meta,
			options: { bundlePath: "", targetUserDir: tgtUser, codexDir: tgtCodex },
		});

		expect(result.codexStateApplied).toBe(false);
		expect(fs.existsSync(path.join(tgtCodex, meta.rolloutRelPath as string))).toBe(true);
	});
});
