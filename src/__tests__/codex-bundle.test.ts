import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleCodexSession } from "../core/agents/codex/bundle";
import { openDb } from "../core/sqlite";

const SESSION_ID = "019ed8ca-db3b-7870-b1ae-9511f710f77c";

function writeRollout(codexDir: string, cwd: string): void {
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
			JSON.stringify({ type: "turn_context", payload: { cwd, model: "gpt-5.5" } }),
			JSON.stringify({
				type: "response_item",
				payload: { type: "message", role: "user", content: [{ type: "input_text", text: "do a thing" }] },
			}),
		].join("\n"),
	);
}

function writeState(codexDir: string, cwd: string): void {
	const db = openDb(path.join(codexDir, "state_5.sqlite"));
	db.exec("create table threads(id text primary key, cwd text, title text, model text)");
	db.run("insert into threads(id,cwd,title,model) values(?,?,?,?)", SESSION_ID, cwd, "My chat", "gpt-5.5");
	db.exec(
		"create table thread_dynamic_tools(thread_id text, position integer, name text, description text, input_schema text, defer_loading integer, namespace text)",
	);
	db.run("insert into thread_dynamic_tools(thread_id,position,name) values(?,?,?)", SESSION_ID, 0, "my_tool");
	db.close();
}

async function extract(bundlePath: string, into: string): Promise<void> {
	fs.mkdirSync(into, { recursive: true });
	await tar.extract({ file: bundlePath, cwd: into });
}

describe("bundleCodexSession", () => {
	let tmp: string;
	let codexDir: string;
	const cwd = "/Users/alice/workspace/app";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bundle-"));
		codexDir = path.join(tmp, ".codex");
		writeRollout(codexDir, cwd);
		writeState(codexDir, cwd);
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("bundles the rollout, codex meta, and codex-state.json", async () => {
		const result = await bundleCodexSession({
			sessionId: SESSION_ID,
			cwd,
			outputDir: tmp,
			codexDir,
			sourceUserDir: "/Users/alice",
			agentId: "codex",
		});

		expect(fs.existsSync(result.bundlePath)).toBe(true);
		expect(result.checksum).toMatch(/^sha256:[a-f0-9]+$/);
		expect(result.metadata.agentId).toBe("codex");
		expect(result.metadata.codexCliVersion).toBe("0.140.0");

		const out = path.join(tmp, "x");
		await extract(result.bundlePath, out);

		const meta = JSON.parse(fs.readFileSync(path.join(out, "meta.json"), "utf-8"));
		expect(meta.agentId).toBe("codex");
		expect(meta.formatVersion).toBe(2);
		expect(meta.sourceCwd).toBe(cwd);
		expect(meta.rolloutRelPath).toContain("sessions/2026/06/18/");

		expect(fs.existsSync(path.join(out, "session.jsonl"))).toBe(true);

		const state = JSON.parse(fs.readFileSync(path.join(out, "codex-state.json"), "utf-8"));
		expect(state.threadRow.id).toBe(SESSION_ID);
		expect(state.threadRow.title).toBe("My chat");
		expect(state.dynamicTools).toHaveLength(1);
		expect(state.dynamicTools[0].name).toBe("my_tool");
	});

	it("still bundles when state_5.sqlite is absent (state is restore-only)", async () => {
		fs.rmSync(path.join(codexDir, "state_5.sqlite"));
		const result = await bundleCodexSession({
			sessionId: SESSION_ID,
			cwd,
			outputDir: tmp,
			codexDir,
			sourceUserDir: "/Users/alice",
			agentId: "codex",
		});
		const out = path.join(tmp, "y");
		await extract(result.bundlePath, out);
		const state = JSON.parse(fs.readFileSync(path.join(out, "codex-state.json"), "utf-8"));
		expect(state.threadRow).toBeNull();
		expect(state.dynamicTools).toEqual([]);
	});

	it("throws if the session rollout is not found", async () => {
		await expect(
			bundleCodexSession({ sessionId: "no-such-id", cwd, outputDir: tmp, codexDir, agentId: "codex" }),
		).rejects.toThrow(/not found/i);
	});
});
