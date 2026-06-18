import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectAntigravityCurrentSession } from "../core/agents/antigravity/detect";
import { scanAntigravityLocalSessions, scanAntigravityProjectSessions } from "../core/agents/antigravity/local";
import { openDb } from "../core/sqlite";

const ID_A = "3ef64ae0-f6d4-4994-a53d-abe056f6cb6f";
const ID_B = "50b5fd85-81bf-466e-b061-bd8cf1db3ff7";

function makeDb(gemDir: string, id: string): void {
	const dir = path.join(gemDir, "conversations");
	fs.mkdirSync(dir, { recursive: true });
	const db = openDb(path.join(dir, `${id}.db`));
	db.exec("create table trajectory_metadata_blob(id text, data blob)");
	db.close();
}
function transcript(gemDir: string, id: string, turns: number): void {
	const dir = path.join(gemDir, "brain", id, ".system_generated", "logs");
	fs.mkdirSync(dir, { recursive: true });
	const lines: string[] = [];
	for (let i = 0; i < turns; i++) {
		lines.push(JSON.stringify({ type: "USER_INPUT", content: i === 0 ? "First prompt" : "more" }));
		lines.push(JSON.stringify({ type: "PLANNER_RESPONSE", content: "ok" }));
	}
	fs.writeFileSync(path.join(dir, "transcript.jsonl"), lines.join("\n"));
}

describe("Antigravity local listing + detection", () => {
	let tmp: string;
	let gemDir: string;
	const projA = "/Users/alice/workspace/app-a";
	const projB = "/Users/alice/workspace/app-b";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-local-"));
		gemDir = path.join(tmp, "antigravity-cli");
		makeDb(gemDir, ID_A);
		makeDb(gemDir, ID_B);
		transcript(gemDir, ID_A, 2);
		transcript(gemDir, ID_B, 1);
		fs.writeFileSync(
			path.join(gemDir, "history.jsonl"),
			[
				JSON.stringify({ display: "hi a", timestamp: 1781000000000, workspace: projA, conversationId: ID_A }),
				JSON.stringify({ display: "hi b", timestamp: 1781000500000, workspace: projB, conversationId: ID_B }),
				JSON.stringify({ display: "more a", timestamp: 1781000900000, workspace: projA, conversationId: ID_A }),
			].join("\n"),
		);
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("lists conversations with cwd from history.jsonl, newest activity first", () => {
		const sessions = scanAntigravityLocalSessions(gemDir);
		expect(sessions.map((s) => s.sessionId)).toEqual([ID_A, ID_B]); // A's latest ts (…900) > B (…500)
		expect(sessions[0].projectPath).toBe(projA);
		expect(sessions[0].projectName).toBe("app-a");
		expect(sessions[0].messageCount).toBeGreaterThan(0);
	});

	it("filters by project cwd", () => {
		expect(scanAntigravityProjectSessions(projB, gemDir).map((s) => s.sessionId)).toEqual([ID_B]);
	});

	it("detects the current session for a cwd via history.jsonl", () => {
		const info = detectAntigravityCurrentSession(projA, gemDir);
		expect(info.sessionId).toBe(ID_A);
		expect(info.cwd).toBe(projA);
	});

	it("throws when no conversation exists for the cwd", () => {
		expect(() => detectAntigravityCurrentSession("/Users/alice/nope", gemDir)).toThrow(/antigravity/i);
	});
});
