import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canConvert, conversionTargetsFor, convertInStaging } from "../core/conversion/convert";
import { openDb } from "../core/sqlite";

describe("canConvert / conversionTargetsFor", () => {
	it("allows any source to Claude or Codex, never to Antigravity, never to itself", () => {
		expect(canConvert("claude-code", "codex")).toBe(true);
		expect(canConvert("codex", "claude-code")).toBe(true);
		expect(canConvert("antigravity", "claude-code")).toBe(true);
		expect(canConvert("antigravity", "codex")).toBe(true);
		expect(canConvert("claude-code", "antigravity")).toBe(false); // never write Antigravity
		expect(canConvert("codex", "antigravity")).toBe(false);
		expect(canConvert("codex", "codex")).toBe(false); // not a conversion
	});

	it("lists convertible targets for a source agent", () => {
		expect(conversionTargetsFor("codex").sort()).toEqual(["claude-code"]);
		expect(conversionTargetsFor("antigravity").sort()).toEqual(["claude-code", "codex"]);
		expect(conversionTargetsFor("claude-code").sort()).toEqual(["codex"]);
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
			claudeDir: path.join(tmp, ".claude"),
			codexDir,
		});
		expect(r.resumeCommand).toBe(`codex resume ${r.sessionId}`);
		const text = fs.readFileSync(r.installedTo, "utf-8");
		expect(text).toContain('"user_message"');
		expect(text).toContain("hello");
		expect(text).toContain("hi there");
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
			claudeDir,
			codexDir: path.join(tmp, ".codex2"),
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

	it("refuses to convert to an unsupported target", () => {
		expect(() =>
			convertInStaging({
				sourceAgentId: "codex",
				targetAgentId: "antigravity",
				stagingDir: tmp,
				targetCwd: "/x",
				claudeDir: tmp,
				codexDir: tmp,
			}),
		).toThrow(/cannot convert|antigravity/i);
	});
});
