import { describe, expect, it } from "vitest";
import { formatCloudSessionRow, pickCloudSession } from "../cli/cloud-session-picker";
import type { SessionListItem } from "../client/api";

function makeCloudSession(overrides: Partial<SessionListItem> = {}): SessionListItem {
	return {
		id: "c3a05473-9f12-4a2b-ae27-9478ab66d216",
		label: null,
		sourceMachine: "macbook-pro",
		sourceCwd: "/Users/alice/my-project",
		sourceUserDir: "/Users/alice",
		sizeBytes: 5_300_000,
		metadata: { messageCount: 3490, projectName: "my-project" },
		currentVersion: 1,
		versionCount: 1,
		createdAt: "2026-03-27T14:30:00.000Z",
		tags: [],
		...overrides,
	};
}

const noopLog = () => {};

describe("pickCloudSession", () => {
	it("returns null when no sessions", async () => {
		const result = await pickCloudSession([], async () => "", noopLog);
		expect(result).toBeNull();
	});

	it("always prompts even for single session", async () => {
		let prompted = false;
		const result = await pickCloudSession(
			[makeCloudSession()],
			async () => {
				prompted = true;
				return "1";
			},
			noopLog,
		);
		expect(result).not.toBeNull();
		expect(result?.sessionId).toBe("c3a05473-9f12-4a2b-ae27-9478ab66d216");
		expect(result?.sourceCwd).toBe("/Users/alice/my-project");
		expect(result?.sourceMachine).toBe("macbook-pro");
		expect(prompted).toBe(true);
	});

	it("returns null on q even for single session", async () => {
		const result = await pickCloudSession([makeCloudSession()], async () => "q", noopLog);
		expect(result).toBeNull();
	});

	it("returns the selected session when user picks a number", async () => {
		const sessions = [
			makeCloudSession({ id: "newest-id", sourceCwd: "/Users/alice/proj-a" }),
			makeCloudSession({ id: "oldest-id", sourceCwd: "/Users/alice/proj-b" }),
		];

		const result = await pickCloudSession(sessions, async () => "2", noopLog);
		expect(result?.sessionId).toBe("oldest-id");
		expect(result?.sourceCwd).toBe("/Users/alice/proj-b");
	});

	it("defaults to first session on empty input", async () => {
		const sessions = [makeCloudSession({ id: "first-id" }), makeCloudSession({ id: "second-id" })];

		const result = await pickCloudSession(sessions, async () => "", noopLog);
		expect(result?.sessionId).toBe("first-id");
	});

	it("returns null on q input", async () => {
		const sessions = [makeCloudSession(), makeCloudSession({ id: "other-id" })];
		const result = await pickCloudSession(sessions, async () => "q", noopLog);
		expect(result).toBeNull();
	});

	it("includes sourceMachine in the result", async () => {
		const session = makeCloudSession({ sourceMachine: "imac-studio" });
		const result = await pickCloudSession([session], async () => "", noopLog);
		expect(result?.sourceMachine).toBe("imac-studio");
	});
});

describe("formatCloudSessionRow", () => {
	it("includes index, truncated ID, project name, machine, and size", () => {
		const session = makeCloudSession({
			id: "c3a05473-9f12-4a2b-ae27-9478ab66d216",
			metadata: { messageCount: 3490, projectName: "my-project" },
			sourceMachine: "macbook-pro",
			sizeBytes: 5_300_000,
		});
		const row = formatCloudSessionRow(1, session);
		expect(row).toContain("1");
		expect(row).toContain("c3a05473");
		expect(row).toContain("my-project");
		expect(row).toContain("macbook-pro");
		expect(row).toContain("5.1 MB");
	});

	it("includes message count when available", () => {
		const session = makeCloudSession({ metadata: { messageCount: 847 } });
		const row = formatCloudSessionRow(1, session);
		expect(row).toContain("847");
	});

	it("shows sourceCwd when projectName is missing", () => {
		const session = makeCloudSession({
			metadata: null,
			sourceCwd: "/Users/alice/work/app",
		});
		const row = formatCloudSessionRow(1, session);
		expect(row).toContain("app");
	});

	it("shows label when present", () => {
		const session = makeCloudSession({ label: "feature-work" });
		const row = formatCloudSessionRow(1, session);
		expect(row).toContain("feature-work");
	});

	it("shows version info when versionCount > 1", () => {
		const session = makeCloudSession({ currentVersion: 3, versionCount: 3 });
		const row = formatCloudSessionRow(1, session);
		expect(row).toContain("v3");
	});

	it("does not show version for single version", () => {
		const session = makeCloudSession({ currentVersion: 1, versionCount: 1 });
		const row = formatCloudSessionRow(1, session);
		expect(row).not.toContain("v1");
	});

	it("shows the agent the session was created with", () => {
		const codex = makeCloudSession({ metadata: { messageCount: 5, projectName: "p", agentId: "codex" } });
		expect(formatCloudSessionRow(1, codex)).toContain("codex");
		const agy = makeCloudSession({ metadata: { messageCount: 5, projectName: "p", agentId: "antigravity" } });
		expect(formatCloudSessionRow(1, agy)).toContain("antigravity");
	});

	it("labels sessions without an agentId as claude-code (legacy)", () => {
		const legacy = makeCloudSession({ metadata: { messageCount: 5, projectName: "p" } });
		expect(formatCloudSessionRow(1, legacy)).toContain("claude-code");
	});
});
