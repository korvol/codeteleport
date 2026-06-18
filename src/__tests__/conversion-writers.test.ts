import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CanonicalTranscript } from "../core/conversion/types";
import { writeClaudeSession, writeCodexSession } from "../core/conversion/writers";
import { encodePath } from "../core/paths";
import { openDb } from "../core/sqlite";

const TRANSCRIPT: CanonicalTranscript = {
	sessionId: "src-id",
	cwd: "/Users/alice/proj",
	title: "do the thing",
	messages: [
		{ role: "user", text: "do the thing" },
		{ role: "assistant", text: "done" },
		{ role: "user", text: "thanks" },
	],
};

describe("writeClaudeSession", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conv-claude-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("writes a parentUuid-chained JSONL the target can resume", () => {
		const claudeDir = path.join(tmp, ".claude");
		const cwd = "/Users/bob/proj";
		const r = writeClaudeSession(TRANSCRIPT, { claudeDir, cwd });

		expect(r.resumeCommand).toBe(`claude --resume ${r.sessionId}`);
		const expected = path.join(claudeDir, "projects", encodePath(cwd), `${r.sessionId}.jsonl`);
		expect(r.installedTo).toBe(expected);

		const lines = fs
			.readFileSync(expected, "utf-8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines).toHaveLength(3);
		// roles + content shapes
		expect(lines[0].type).toBe("user");
		expect(lines[0].message.content).toBe("do the thing");
		expect(lines[1].type).toBe("assistant");
		expect(lines[1].message.content).toEqual([{ type: "text", text: "done" }]);
		// uuid parent-chain
		expect(lines[0].parentUuid).toBeNull();
		expect(lines[1].parentUuid).toBe(lines[0].uuid);
		expect(lines[2].parentUuid).toBe(lines[1].uuid);
		// session fields
		for (const l of lines) {
			expect(l.sessionId).toBe(r.sessionId);
			expect(l.cwd).toBe(cwd);
			expect(typeof l.uuid).toBe("string");
			expect(typeof l.timestamp).toBe("string");
		}
	});
});

describe("writeCodexSession", () => {
	let tmp: string;
	let codexDir: string;
	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conv-codex-"));
		codexDir = path.join(tmp, ".codex");
		fs.mkdirSync(codexDir, { recursive: true });
		// target must have a Codex state DB (as after running Codex once)
		const db = openDb(path.join(codexDir, "state_5.sqlite"));
		db.exec(
			"create table threads(id text primary key, cwd text, title text, rollout_path text, source text, model_provider text)",
		);
		db.close();
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("writes a rollout with response_item + event_msg per message and upserts the threads row", () => {
		const cwd = "/Users/bob/proj";
		const r = writeCodexSession(TRANSCRIPT, { codexDir, cwd });

		expect(r.resumeCommand).toBe(`codex resume ${r.sessionId}`);
		expect(fs.existsSync(r.installedTo)).toBe(true);
		expect(r.installedTo).toContain(path.join(codexDir, "sessions"));

		const lines = fs
			.readFileSync(r.installedTo, "utf-8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines[0].type).toBe("session_meta");
		expect(lines[0].payload.id).toBe(r.sessionId);
		expect(lines[0].payload.cwd).toBe(cwd);
		expect(lines.find((l) => l.type === "turn_context")).toBeTruthy();

		// each message contributes BOTH a response_item and an event_msg (TUI renders event_msg)
		const events = lines.filter((l) => l.type === "event_msg").map((l) => l.payload);
		expect(events.filter((p) => p.type === "user_message").map((p) => p.message)).toEqual(["do the thing", "thanks"]);
		expect(events.filter((p) => p.type === "agent_message").map((p) => p.message)).toEqual(["done"]);
		const items = lines.filter((l) => l.type === "response_item" && l.payload.type === "message");
		expect(items).toHaveLength(3);
		expect(items[0].payload.content[0]).toEqual({ type: "input_text", text: "do the thing" });
		expect(items[1].payload.content[0]).toEqual({ type: "output_text", text: "done" });

		// threads row upserted, anchored to the new rollout + target cwd
		const db = openDb(path.join(codexDir, "state_5.sqlite"), { readOnly: true });
		const row = db.get<Record<string, unknown>>("select * from threads where id=?", r.sessionId);
		db.close();
		expect(row?.cwd).toBe(cwd);
		expect(row?.rollout_path).toBe(r.installedTo);
	});
});
