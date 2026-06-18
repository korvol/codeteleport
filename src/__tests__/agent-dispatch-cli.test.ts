import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	detectCurrentSessionForAgent,
	scanLocalSessionsForAgent,
	scanProjectSessionsForAgent,
} from "../core/agents/dispatch";
import { encodePath } from "../core/paths";

/** The CLI/MCP layer scans + detects through these dispatchers, routed by config.agent. */
describe("agent-aware CLI dispatchers", () => {
	let tmp: string;
	let claudeDir: string;
	let codexDir: string;
	const claudeCwd = "/Users/alice/claude-proj";
	const codexCwd = "/Users/alice/codex-proj";
	const codexId = "11111111-1111-1111-1111-111111111111";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-cli-"));
		claudeDir = path.join(tmp, ".claude");
		codexDir = path.join(tmp, ".codex");

		// Claude session
		const cproj = path.join(claudeDir, "projects", encodePath(claudeCwd));
		fs.mkdirSync(cproj, { recursive: true });
		fs.writeFileSync(
			path.join(cproj, "claude-sess.jsonl"),
			JSON.stringify({
				type: "user",
				cwd: claudeCwd,
				timestamp: "2026-06-18T10:00:00.000Z",
				message: { content: "hi" },
			}),
		);

		// Codex rollout + history
		const xdir = path.join(codexDir, "sessions", "2026", "06", "18");
		fs.mkdirSync(xdir, { recursive: true });
		fs.writeFileSync(
			path.join(xdir, `rollout-${codexId}.jsonl`),
			JSON.stringify({
				type: "session_meta",
				payload: { id: codexId, cwd: codexCwd, timestamp: "2026-06-18T10:00:00.000Z" },
			}),
		);
		fs.writeFileSync(path.join(codexDir, "history.jsonl"), JSON.stringify({ session_id: codexId, ts: 1781000000 }));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("routes local listing to the right agent", () => {
		const claude = scanLocalSessionsForAgent("claude-code", { claudeDir });
		expect(claude.map((s) => s.sessionId)).toContain("claude-sess");

		const codex = scanLocalSessionsForAgent("codex", { codexDir });
		expect(codex.map((s) => s.sessionId)).toContain(codexId);
	});

	it("routes project listing to the right agent", () => {
		expect(scanProjectSessionsForAgent("claude-code", claudeCwd, { claudeDir }).map((s) => s.sessionId)).toContain(
			"claude-sess",
		);
		expect(scanProjectSessionsForAgent("codex", codexCwd, { codexDir }).map((s) => s.sessionId)).toContain(codexId);
	});

	it("routes detection to the codex history-based detector", () => {
		const info = detectCurrentSessionForAgent("codex", codexCwd, { codexDir });
		expect(info.sessionId).toBe(codexId);
		expect(info.cwd).toBe(codexCwd);
	});

	it("throws for an unsupported agent", () => {
		expect(() => scanLocalSessionsForAgent("bogus", {})).toThrow(/unknown agent|unsupported/i);
	});
});
