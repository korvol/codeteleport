import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectCodexCurrentSession } from "../core/agents/codex/detect";

/**
 * Codex has no Claude-style PID session file. We detect the "current" chat from
 * ~/.codex/history.jsonl ({session_id, ts, text}) — the most recent entry whose
 * session lives in the current cwd — falling back to the newest local session
 * for that cwd.
 */
function writeRollout(codexDir: string, id: string, cwd: string, ts: string): void {
	const dir = path.join(codexDir, "sessions", "2026", "06", "18");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, `rollout-${id}.jsonl`),
		JSON.stringify({ timestamp: ts, type: "session_meta", payload: { id, cwd, timestamp: ts } }),
	);
}

describe("detectCodexCurrentSession", () => {
	let tmp: string;
	let codexDir: string;
	const projA = "/Users/alice/workspace/app-a";
	const projB = "/Users/alice/workspace/app-b";
	const idA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
	const idB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-detect-"));
		codexDir = path.join(tmp, ".codex");
		writeRollout(codexDir, idA, projA, "2026-06-18T09:00:00.000Z");
		writeRollout(codexDir, idB, projB, "2026-06-18T10:00:00.000Z");
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("picks the most recent history entry whose session is in the cwd", () => {
		fs.writeFileSync(
			path.join(codexDir, "history.jsonl"),
			[
				JSON.stringify({ session_id: idA, ts: 1781000000, text: "first" }),
				JSON.stringify({ session_id: idB, ts: 1781000100, text: "other project" }),
				JSON.stringify({ session_id: idA, ts: 1781000200, text: "latest in A" }),
			].join("\n"),
		);
		const info = detectCodexCurrentSession(projA, codexDir);
		expect(info.sessionId).toBe(idA);
		expect(info.cwd).toBe(projA);
	});

	it("falls back to the newest local session for the cwd when history is absent", () => {
		const info = detectCodexCurrentSession(projB, codexDir);
		expect(info.sessionId).toBe(idB);
	});

	it("throws when no session exists for the cwd", () => {
		expect(() => detectCodexCurrentSession("/Users/alice/workspace/nope", codexDir)).toThrow(/codex session/i);
	});
});
