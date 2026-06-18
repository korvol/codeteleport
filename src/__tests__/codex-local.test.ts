import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanCodexLocalSessions, scanCodexProjectSessions } from "../core/agents/codex/local";

/**
 * Codex stores rollouts at ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl.
 * Listing walks that tree, reads cwd/timestamps from the JSONL, and sorts by
 * last activity (newest first).
 */
function writeRollout(codexDir: string, datePath: string, id: string, cwd: string, ts: string): void {
	const dir = path.join(codexDir, "sessions", datePath);
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `rollout-${ts.replace(/[:.]/g, "-")}-${id}.jsonl`);
	fs.writeFileSync(
		file,
		[
			JSON.stringify({ timestamp: ts, type: "session_meta", payload: { id, cwd, timestamp: ts } }),
			JSON.stringify({
				timestamp: ts,
				type: "response_item",
				payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
			}),
		].join("\n"),
	);
}

describe("scanCodexLocalSessions", () => {
	let tmp: string;
	let codexDir: string;
	const projA = "/Users/alice/workspace/app-a";
	const projB = "/Users/alice/workspace/app-b";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-local-"));
		codexDir = path.join(tmp, ".codex");
		writeRollout(codexDir, "2026/06/16", "11111111-1111-1111-1111-111111111111", projA, "2026-06-16T10:00:00.000Z");
		writeRollout(codexDir, "2026/06/18", "22222222-2222-2222-2222-222222222222", projB, "2026-06-18T10:00:00.000Z");
		writeRollout(codexDir, "2026/06/17", "33333333-3333-3333-3333-333333333333", projA, "2026-06-17T10:00:00.000Z");
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("finds all rollouts across the date tree, newest first", () => {
		const sessions = scanCodexLocalSessions(codexDir);
		expect(sessions.map((s) => s.sessionId)).toEqual([
			"22222222-2222-2222-2222-222222222222",
			"33333333-3333-3333-3333-333333333333",
			"11111111-1111-1111-1111-111111111111",
		]);
		expect(sessions[0].projectPath).toBe(projB);
		expect(sessions[0].projectName).toBe("app-b");
		expect(sessions[0].messageCount).toBeGreaterThan(0);
	});

	it("returns [] when the codex sessions dir is absent", () => {
		expect(scanCodexLocalSessions(path.join(tmp, "nope"))).toEqual([]);
	});

	it("scanCodexProjectSessions filters to a single project cwd", () => {
		const sessions = scanCodexProjectSessions(projA, codexDir);
		expect(sessions.map((s) => s.sessionId).sort()).toEqual([
			"11111111-1111-1111-1111-111111111111",
			"33333333-3333-3333-3333-333333333333",
		]);
		expect(sessions.every((s) => s.projectPath === projA)).toBe(true);
	});
});
