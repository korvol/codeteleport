import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LocalSession, scanLocalSessions, scanProjectSessions } from "../core/local";

describe("Local session scanner", () => {
	let tmpDir: string;
	let claudeDir: string;
	let projectsDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-local-test-"));
		claudeDir = path.join(tmpDir, ".claude");
		projectsDir = path.join(claudeDir, "projects");
		fs.mkdirSync(projectsDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function createSession(encodedPath: string, sessionId: string, lines: string[]) {
		const dir = path.join(projectsDir, encodedPath);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.join("\n"));
	}

	function makeLine(timestamp: string, type = "user", cwd?: string) {
		const obj: Record<string, unknown> = { timestamp, type, message: { content: "test" } };
		if (cwd) obj.cwd = cwd;
		return JSON.stringify(obj);
	}

	describe("scanLocalSessions", () => {
		it("returns empty array when projects dir does not exist", () => {
			const emptyDir = path.join(tmpDir, "empty");
			fs.mkdirSync(emptyDir);
			expect(scanLocalSessions(emptyDir)).toEqual([]);
		});

		it("returns empty array when no sessions exist", () => {
			expect(scanLocalSessions(claudeDir)).toEqual([]);
		});

		it("finds a single session with correct metadata", () => {
			const lines = [
				makeLine("2026-03-25T07:00:00.000Z", "user", "/Users/alice/my-project"),
				makeLine("2026-03-25T07:05:00.000Z", "assistant"),
				makeLine("2026-03-25T07:10:00.000Z"),
			];
			createSession("-Users-alice-my-project", "abc-123", lines);

			const sessions = scanLocalSessions(claudeDir);
			expect(sessions).toHaveLength(1);

			const s = sessions[0];
			expect(s.sessionId).toBe("abc-123");
			expect(s.projectPath).toBe("/Users/alice/my-project");
			expect(s.projectName).toBe("my-project");
			expect(s.encodedProjectPath).toBe("-Users-alice-my-project");
			expect(s.messageCount).toBe(3);
			expect(s.firstMessageAt).toBe("2026-03-25T07:00:00.000Z");
			expect(s.lastMessageAt).toBe("2026-03-25T07:10:00.000Z");
			expect(s.sizeBytes).toBeGreaterThan(0);
			expect(s.jsonlPath).toContain("abc-123.jsonl");
		});

		it("finds sessions across multiple projects", () => {
			createSession("-Users-alice-project-a", "sess-1", [makeLine("2026-03-25T08:00:00.000Z")]);
			createSession("-Users-alice-project-b", "sess-2", [makeLine("2026-03-26T10:00:00.000Z")]);

			const sessions = scanLocalSessions(claudeDir);
			expect(sessions).toHaveLength(2);
		});

		it("finds multiple sessions in the same project", () => {
			createSession("-Users-alice-my-project", "sess-1", [makeLine("2026-03-25T07:00:00.000Z")]);
			createSession("-Users-alice-my-project", "sess-2", [makeLine("2026-03-26T09:00:00.000Z")]);

			const sessions = scanLocalSessions(claudeDir);
			expect(sessions).toHaveLength(2);
		});

		it("sorts by lastMessageAt descending (most recent first)", () => {
			createSession("-Users-alice-old", "old-sess", [makeLine("2026-03-20T07:00:00.000Z")]);
			createSession("-Users-alice-new", "new-sess", [makeLine("2026-03-27T12:00:00.000Z")]);
			createSession("-Users-alice-mid", "mid-sess", [makeLine("2026-03-24T08:00:00.000Z")]);

			const sessions = scanLocalSessions(claudeDir);
			expect(sessions[0].sessionId).toBe("new-sess");
			expect(sessions[1].sessionId).toBe("mid-sess");
			expect(sessions[2].sessionId).toBe("old-sess");
		});

		it("handles empty jsonl file gracefully", () => {
			createSession("-Users-alice-empty", "empty-sess", []);

			const sessions = scanLocalSessions(claudeDir);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].messageCount).toBe(0);
			expect(sessions[0].firstMessageAt).toBeNull();
			expect(sessions[0].lastMessageAt).toBeNull();
		});

		it("handles jsonl with unparseable lines gracefully", () => {
			const dir = path.join(projectsDir, "-Users-alice-broken");
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "broken-sess.jsonl"), "not json\n{bad\n");

			const sessions = scanLocalSessions(claudeDir);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].messageCount).toBe(2);
			expect(sessions[0].firstMessageAt).toBeNull();
			expect(sessions[0].lastMessageAt).toBeNull();
		});

		it("ignores non-jsonl files", () => {
			const dir = path.join(projectsDir, "-Users-alice-proj");
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");
			fs.writeFileSync(path.join(dir, "real-sess.jsonl"), makeLine("2026-03-25T07:00:00.000Z"));

			const sessions = scanLocalSessions(claudeDir);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].sessionId).toBe("real-sess");
		});
	});

	describe("scanProjectSessions", () => {
		it("returns only sessions for the specified project", () => {
			createSession("-Users-alice-target", "target-1", [makeLine("2026-03-25T07:00:00.000Z")]);
			createSession("-Users-alice-target", "target-2", [makeLine("2026-03-26T09:00:00.000Z")]);
			createSession("-Users-alice-other", "other-1", [makeLine("2026-03-27T11:00:00.000Z")]);

			const sessions = scanProjectSessions("/Users/alice/target", claudeDir);
			expect(sessions).toHaveLength(2);
			expect(sessions.every((s) => s.projectPath === "/Users/alice/target")).toBe(true);
		});

		it("returns empty array when project has no sessions", () => {
			createSession("-Users-alice-other", "sess-1", [makeLine("2026-03-25T07:00:00.000Z")]);

			const sessions = scanProjectSessions("/Users/alice/nonexistent", claudeDir);
			expect(sessions).toEqual([]);
		});

		it("sorts by lastMessageAt descending", () => {
			createSession("-Users-alice-proj", "old", [makeLine("2026-03-20T07:00:00.000Z")]);
			createSession("-Users-alice-proj", "new", [makeLine("2026-03-27T12:00:00.000Z")]);

			const sessions = scanProjectSessions("/Users/alice/proj", claudeDir);
			expect(sessions[0].sessionId).toBe("new");
			expect(sessions[1].sessionId).toBe("old");
		});
	});
});
