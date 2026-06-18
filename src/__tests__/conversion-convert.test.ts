import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canConvert, conversionTargetsFor, convertInStaging } from "../core/conversion/convert";
import { openDb } from "../core/sqlite";

describe("canConvert / conversionTargetsFor", () => {
	it("allows conversion between any two distinct agents, never to itself", () => {
		expect(canConvert("claude-code", "codex")).toBe(true);
		expect(canConvert("codex", "claude-code")).toBe(true);
		expect(canConvert("antigravity", "claude-code")).toBe(true);
		expect(canConvert("antigravity", "codex")).toBe(true);
		expect(canConvert("claude-code", "antigravity")).toBe(true); // Antigravity is now a writable target
		expect(canConvert("codex", "antigravity")).toBe(true);
		expect(canConvert("codex", "codex")).toBe(false); // not a conversion
		expect(canConvert("antigravity", "antigravity")).toBe(false);
	});

	it("lists convertible targets for a source agent", () => {
		expect(conversionTargetsFor("codex").sort()).toEqual(["antigravity", "claude-code"]);
		expect(conversionTargetsFor("antigravity").sort()).toEqual(["claude-code", "codex"]);
		expect(conversionTargetsFor("claude-code").sort()).toEqual(["antigravity", "codex"]);
	});
});

describe("convertInStaging", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conv-dispatch-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("converts a Claude bundle (session.jsonl) into a Codex session", () => {
		const staging = path.join(tmp, "staging");
		fs.mkdirSync(staging, { recursive: true });
		fs.writeFileSync(
			path.join(staging, "session.jsonl"),
			[
				JSON.stringify({ type: "user", cwd: "/Users/a/p", message: { content: "hello" } }),
				JSON.stringify({ type: "assistant", message: { content: "hi there" } }),
			].join("\n"),
		);
		const codexDir = path.join(tmp, ".codex");
		fs.mkdirSync(codexDir, { recursive: true });
		const db = openDb(path.join(codexDir, "state_5.sqlite"));
		db.exec("create table threads(id text primary key, cwd text, rollout_path text)");
		db.close();

		const r = convertInStaging({
			sourceAgentId: "claude-code",
			targetAgentId: "codex",
			stagingDir: staging,
			targetCwd: "/Users/b/p",
			targetUserDir: "/Users/b",
			claudeDir: path.join(tmp, ".claude"),
			codexDir,
			geminiDir: path.join(tmp, ".gemini"),
		});
		expect(r.resumeCommand).toBe(`codex resume ${r.sessionId}`);
		const text = fs.readFileSync(r.installedTo, "utf-8");
		expect(text).toContain('"user_message"');
		expect(text).toContain("hello");
		expect(text).toContain("hi there");
	});

	it("converts a Claude bundle (session.jsonl) into an Antigravity session", () => {
		const staging = path.join(tmp, "staging-agy");
		fs.mkdirSync(staging, { recursive: true });
		fs.writeFileSync(
			path.join(staging, "session.jsonl"),
			[
				JSON.stringify({ type: "user", cwd: "/Users/a/p", message: { content: "port me to antigravity" } }),
				JSON.stringify({ type: "assistant", message: { content: "ported" } }),
			].join("\n"),
		);
		const geminiDir = path.join(tmp, ".gemini-agy", "antigravity-cli");

		const r = convertInStaging({
			sourceAgentId: "claude-code",
			targetAgentId: "antigravity",
			stagingDir: staging,
			targetCwd: "/Users/b/p",
			targetUserDir: "/Users/b",
			claudeDir: path.join(tmp, ".claude-agy"),
			codexDir: path.join(tmp, ".codex-agy"),
			geminiDir,
		});
		expect(r.resumeCommand).toBe(`agy --conversation ${r.sessionId}`);
		expect(r.installedTo).toBe(path.join(geminiDir, "conversations", `${r.sessionId}.db`));
		expect(fs.existsSync(r.installedTo)).toBe(true);
	});

	it("converts an Antigravity bundle (brain transcript) into a Claude session", () => {
		const staging = path.join(tmp, "staging2");
		const logs = path.join(staging, "brain", ".system_generated", "logs");
		fs.mkdirSync(logs, { recursive: true });
		fs.writeFileSync(
			path.join(logs, "transcript.jsonl"),
			[
				JSON.stringify({ type: "USER_INPUT", content: "<USER_REQUEST>port this</USER_REQUEST>" }),
				JSON.stringify({ type: "PLANNER_RESPONSE", content: "on it" }),
			].join("\n"),
		);
		const claudeDir = path.join(tmp, ".claude2");

		const r = convertInStaging({
			sourceAgentId: "antigravity",
			targetAgentId: "claude-code",
			stagingDir: staging,
			targetCwd: "/Users/b/p",
			targetUserDir: "/Users/b",
			claudeDir,
			codexDir: path.join(tmp, ".codex2"),
			geminiDir: path.join(tmp, ".gemini2"),
		});
		expect(r.resumeCommand).toBe(`claude --resume ${r.sessionId}`);
		const lines = fs
			.readFileSync(r.installedTo, "utf-8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines[0].message.content).toBe("port this");
		expect(lines[1].message.content).toEqual([{ type: "text", text: "on it" }]);
	});

	it("refuses to convert a session to its own agent", () => {
		expect(() =>
			convertInStaging({
				sourceAgentId: "codex",
				targetAgentId: "codex",
				stagingDir: tmp,
				targetCwd: "/x",
				targetUserDir: "/",
				claudeDir: tmp,
				codexDir: tmp,
				geminiDir: tmp,
			}),
		).toThrow(/cannot convert/i);
	});
});
