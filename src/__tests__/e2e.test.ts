import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig, writeConfig } from "../cli/config";
import { bundleSession } from "../core/bundle";
import { encodePath } from "../core/paths";
import { unbundleSession } from "../core/unbundle";

/**
 * E2E integration test: simulates the full CodeTeleport flow.
 *
 * Machine A (source):
 *   1. Has a Claude Code session with realistic JSONL, subagents, file-history, etc.
 *   2. Bundles it via bundleSession()
 *   3. "Uploads" to a mock server (in-memory file store)
 *   4. "Confirms" the upload
 *
 * Machine B (target):
 *   5. "Downloads" the bundle from the mock server
 *   6. Unbundles it via unbundleSession()
 *   7. Verifies: paths rewritten, all assets present, resume command correct
 *
 * The mock server holds the bundle in memory — no real HTTP, no R2, no Turso.
 */

describe("E2E: Full teleport flow with mock server", () => {
	let tmpRoot: string;
	let machineA: { home: string; claude: string; config: string };
	let machineB: { home: string; claude: string; config: string };

	// In-memory "server" storage
	let serverStorage: Map<string, Buffer>;
	let serverSessions: Map<string, { sourceCwd: string; sourceUserDir: string; sourceMachine: string }>;

	const sessionId = "e2e-test-session-001";
	const sourceUserDir = "/Users/alice";
	const sourceCwd = "/Users/alice/projects/code-teleport";

	beforeEach(() => {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-test-"));

		// Machine A setup
		machineA = {
			home: path.join(tmpRoot, "machine-a"),
			claude: path.join(tmpRoot, "machine-a", ".claude"),
			config: path.join(tmpRoot, "machine-a", ".codeteleport"),
		};

		// Machine B setup
		machineB = {
			home: path.join(tmpRoot, "machine-b"),
			claude: path.join(tmpRoot, "machine-b", ".claude"),
			config: path.join(tmpRoot, "machine-b", ".codeteleport"),
		};

		// In-memory server
		serverStorage = new Map();
		serverSessions = new Map();

		// Create Machine A's Claude Code session
		const encodedCwd = encodePath(sourceCwd);
		const projDir = path.join(machineA.claude, "projects", encodedCwd);
		fs.mkdirSync(projDir, { recursive: true });

		// Realistic JSONL — a multi-turn coding session
		const jsonlEntries = [
			{
				type: "user",
				timestamp: "2026-03-25T10:00:00.000Z",
				cwd: sourceCwd,
				message: { content: "Build a REST API for syncing Claude Code sessions across devices" },
			},
			{
				type: "assistant",
				timestamp: "2026-03-25T10:05:00.000Z",
				model: "claude-opus-4-6",
				cwd: sourceCwd,
				message: { content: `I'll start by creating the project structure at ${sourceCwd}/packages/api` },
				toolCalls: [
					{ name: "Write", input: { file_path: `${sourceCwd}/packages/api/src/index.ts` } },
					{ name: "Write", input: { file_path: `${sourceCwd}/packages/api/src/routes/auth.ts` } },
				],
			},
			{
				type: "user",
				timestamp: "2026-03-25T10:15:00.000Z",
				cwd: sourceCwd,
				message: { content: "Add session upload with presigned R2 URLs" },
			},
			{
				type: "assistant",
				timestamp: "2026-03-25T10:30:00.000Z",
				model: "claude-opus-4-6",
				cwd: sourceCwd,
				message: {
					content: `Editing ${sourceCwd}/packages/api/src/routes/sessions.ts with upload endpoint. Also referencing paste-cache/aabb1122.txt for the schema.`,
				},
				toolCalls: [
					{ name: "Edit", input: { file_path: `${sourceCwd}/packages/api/src/routes/sessions.ts` } },
					{ name: "Read", input: { file_path: `${sourceCwd}/docs/PRODUCT.md` } },
				],
			},
			{
				type: "user",
				timestamp: "2026-03-25T11:00:00.000Z",
				cwd: sourceCwd,
				message: { content: "Run the tests" },
			},
			{
				type: "assistant",
				timestamp: "2026-03-25T11:05:00.000Z",
				model: "claude-opus-4-6",
				cwd: sourceCwd,
				message: { content: "All 54 tests passing. Shell snapshot at snapshot-zsh-99999-e2eab.sh" },
				toolCalls: [{ name: "Bash", input: { command: "pnpm -r test" } }],
			},
		];
		fs.writeFileSync(path.join(projDir, `${sessionId}.jsonl`), jsonlEntries.map((e) => JSON.stringify(e)).join("\n"));

		// Subagent
		const subDir = path.join(projDir, sessionId, "subagents");
		fs.mkdirSync(subDir, { recursive: true });
		fs.writeFileSync(
			path.join(subDir, "explore-001.jsonl"),
			JSON.stringify({ type: "assistant", cwd: sourceCwd, message: { content: "Exploring codebase structure" } }),
		);

		// File history
		const fhDir = path.join(machineA.claude, "file-history", sessionId);
		fs.mkdirSync(fhDir, { recursive: true });
		fs.writeFileSync(path.join(fhDir, "index.ts.json"), JSON.stringify({ versions: [1, 2] }));
		fs.writeFileSync(path.join(fhDir, "sessions.ts.json"), JSON.stringify({ versions: [1, 2, 3] }));

		// Session env
		const seDir = path.join(machineA.claude, "session-env", sessionId);
		fs.mkdirSync(seDir, { recursive: true });
		fs.writeFileSync(path.join(seDir, "env.json"), JSON.stringify({ NODE_ENV: "development", HOME: sourceUserDir }));

		// Paste cache
		const pcDir = path.join(machineA.claude, "paste-cache");
		fs.mkdirSync(pcDir, { recursive: true });
		fs.writeFileSync(path.join(pcDir, "aabb1122.txt"), "Pasted schema definition for session upload endpoint");

		// Shell snapshots
		const ssDir = path.join(machineA.claude, "shell-snapshots");
		fs.mkdirSync(ssDir, { recursive: true });
		fs.writeFileSync(
			path.join(ssDir, "snapshot-zsh-99999-e2eab.sh"),
			"#!/bin/zsh\nexport PATH=/usr/bin\ncd /Users/alice/projects/code-teleport",
		);

		// Write config for both machines
		writeConfig(
			{ token: "ctk_live_test", apiUrl: "https://mock.test/v1", deviceName: "alice-macbook" },
			machineA.config,
		);
		writeConfig({ token: "ctk_live_test", apiUrl: "https://mock.test/v1", deviceName: "bob-desktop" }, machineB.config);

		// Create Machine B's home
		fs.mkdirSync(machineB.home, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("full teleport: Machine A push → Machine B pull → session resumes with correct paths", async () => {
		// ══════════════════════════════════════════════
		// MACHINE A: Bundle + "Upload"
		// ══════════════════════════════════════════════

		const configA = readConfig(machineA.config);
		expect(configA.deviceName).toBe("alice-macbook");

		// Bundle the session
		const bundle = await bundleSession({
			sessionId,
			cwd: sourceCwd,
			outputDir: tmpRoot,
			claudeDir: machineA.claude,
			sourceUserDir,
		});

		expect(bundle.sessionId).toBe(sessionId);
		expect(bundle.sizeBytes).toBeGreaterThan(0);
		expect(bundle.checksum).toMatch(/^sha256:[a-f0-9]+$/);
		expect(fs.existsSync(bundle.bundlePath)).toBe(true);

		// Verify metadata was extracted correctly
		expect(bundle.metadata.messageCount).toBe(6);
		expect(bundle.metadata.userMessageCount).toBe(3);
		expect(bundle.metadata.assistantMessageCount).toBe(3);
		expect(bundle.metadata.toolCallCount).toBe(5); // 2 + 2 + 1
		expect(bundle.metadata.claudeModel).toBe("claude-opus-4-6");
		expect(bundle.metadata.projectName).toBe("code-teleport");
		expect(bundle.metadata.summary).toBe("Build a REST API for syncing Claude Code sessions across devices");
		expect(bundle.metadata.sessionStartedAt).toBe("2026-03-25T10:00:00.000Z");
		expect(bundle.metadata.sessionEndedAt).toBe("2026-03-25T11:05:00.000Z");
		expect(bundle.metadata.durationSeconds).toBe(3900); // 65 minutes
		expect(bundle.metadata.filesModified).toContain(`${sourceCwd}/packages/api/src/index.ts`);
		expect(bundle.metadata.filesModified).toContain(`${sourceCwd}/packages/api/src/routes/sessions.ts`);
		expect(bundle.metadata.filesModifiedCount).toBe(3); // index.ts, auth.ts, sessions.ts
		expect(bundle.metadata.hasFileHistory).toBe(true);
		expect(bundle.metadata.hasPasteCache).toBe(true);
		expect(bundle.metadata.hasShellSnapshots).toBe(true);
		expect(bundle.metadata.subagentCount).toBe(1);

		// "Upload" to mock server — just store the file in memory
		const bundleData = fs.readFileSync(bundle.bundlePath);
		serverStorage.set(sessionId, bundleData);
		serverSessions.set(sessionId, {
			sourceCwd: bundle.sourceCwd,
			sourceUserDir: bundle.sourceUserDir,
			sourceMachine: configA.deviceName,
		});

		// Clean up local bundle (like the CLI does)
		fs.unlinkSync(bundle.bundlePath);

		// ══════════════════════════════════════════════
		// MACHINE B: "Download" + Unbundle
		// ══════════════════════════════════════════════

		const configB = readConfig(machineB.config);
		expect(configB.deviceName).toBe("bob-desktop");

		// "Download" from mock server
		expect(serverStorage.has(sessionId)).toBe(true);
		const downloadedBundle = serverStorage.get(sessionId) as Buffer;
		const downloadPath = path.join(tmpRoot, `downloaded-${sessionId}.tar.gz`);
		fs.writeFileSync(downloadPath, downloadedBundle);

		// Unbundle to Machine B
		const result = await unbundleSession({
			bundlePath: downloadPath,
			targetUserDir: machineB.home,
			claudeDir: machineB.claude,
		});

		expect(result.sessionId).toBe(sessionId);
		expect(result.resumeCommand).toBe(`claude --resume ${sessionId}`);

		// ══════════════════════════════════════════════
		// VERIFY: Paths rewritten correctly
		// ══════════════════════════════════════════════

		const targetCwd = sourceCwd.replace(sourceUserDir, machineB.home);
		const targetEncodedCwd = encodePath(targetCwd);
		const targetProjDir = path.join(machineB.claude, "projects", targetEncodedCwd);

		// JSONL exists and paths are rewritten
		const jsonlPath = path.join(targetProjDir, `${sessionId}.jsonl`);
		expect(fs.existsSync(jsonlPath)).toBe(true);

		const jsonlContent = fs.readFileSync(jsonlPath, "utf-8");
		expect(jsonlContent).not.toContain("/Users/alice");
		expect(jsonlContent).toContain(machineB.home);

		// Verify individual JSONL entries
		const lines = jsonlContent.trim().split("\n");
		expect(lines).toHaveLength(6);

		const firstMsg = JSON.parse(lines[0]);
		expect(firstMsg.cwd).toBe(`${machineB.home}/projects/code-teleport`);

		const editMsg = JSON.parse(lines[1]);
		expect(editMsg.toolCalls[0].input.file_path).toBe(
			`${machineB.home}/projects/code-teleport/packages/api/src/index.ts`,
		);

		const lastMsg = JSON.parse(lines[5]);
		expect(lastMsg.cwd).toBe(`${machineB.home}/projects/code-teleport`);

		// ══════════════════════════════════════════════
		// VERIFY: Subagent paths rewritten
		// ══════════════════════════════════════════════

		const subagentPath = path.join(targetProjDir, sessionId, "subagents", "explore-001.jsonl");
		expect(fs.existsSync(subagentPath)).toBe(true);
		const subContent = fs.readFileSync(subagentPath, "utf-8");
		expect(subContent).not.toContain("/Users/alice");
		expect(subContent).toContain(machineB.home);

		// ══════════════════════════════════════════════
		// VERIFY: All assets transferred
		// ══════════════════════════════════════════════

		// File history
		const fhDir = path.join(machineB.claude, "file-history", sessionId);
		expect(fs.existsSync(path.join(fhDir, "index.ts.json"))).toBe(true);
		expect(fs.existsSync(path.join(fhDir, "sessions.ts.json"))).toBe(true);
		const fhContent = JSON.parse(fs.readFileSync(path.join(fhDir, "sessions.ts.json"), "utf-8"));
		expect(fhContent.versions).toEqual([1, 2, 3]);

		// Session env
		const seDir = path.join(machineB.claude, "session-env", sessionId);
		expect(fs.existsSync(path.join(seDir, "env.json"))).toBe(true);

		// Paste cache
		const pcPath = path.join(machineB.claude, "paste-cache", "aabb1122.txt");
		expect(fs.existsSync(pcPath)).toBe(true);
		expect(fs.readFileSync(pcPath, "utf-8")).toBe("Pasted schema definition for session upload endpoint");

		// Shell snapshots
		const ssPath = path.join(machineB.claude, "shell-snapshots", "snapshot-zsh-99999-e2eab.sh");
		expect(fs.existsSync(ssPath)).toBe(true);
		const ssContent = fs.readFileSync(ssPath, "utf-8");
		expect(ssContent).toContain("#!/bin/zsh");

		// ══════════════════════════════════════════════
		// VERIFY: Config on both machines is independent
		// ══════════════════════════════════════════════

		const finalConfigA = readConfig(machineA.config);
		const finalConfigB = readConfig(machineB.config);
		expect(finalConfigA.deviceName).toBe("alice-macbook");
		expect(finalConfigB.deviceName).toBe("bob-desktop");

		// Clean up downloaded bundle
		fs.unlinkSync(downloadPath);
	});

	it("full teleport with targetDir: different user AND different project path", async () => {
		// ══════════════════════════════════════════════
		// MACHINE A: Bundle
		// ══════════════════════════════════════════════

		const bundle = await bundleSession({
			sessionId,
			cwd: sourceCwd,
			outputDir: tmpRoot,
			claudeDir: machineA.claude,
			sourceUserDir,
		});

		// "Upload" to mock server
		const bundleData = fs.readFileSync(bundle.bundlePath);
		serverStorage.set(sessionId, bundleData);
		fs.unlinkSync(bundle.bundlePath);

		// ══════════════════════════════════════════════
		// MACHINE B: Pull with targetDir
		// Source: /Users/alice/projects/code-teleport
		// Target: /Users/bob/work/my-teleport (different user + different path)
		// ══════════════════════════════════════════════

		const targetDir = `${machineB.home}/work/my-teleport`;
		const downloadedBundle = serverStorage.get(sessionId) as Buffer;
		const downloadPath = path.join(tmpRoot, `downloaded2-${sessionId}.tar.gz`);
		fs.writeFileSync(downloadPath, downloadedBundle);

		const result = await unbundleSession({
			bundlePath: downloadPath,
			targetDir,
			claudeDir: machineB.claude,
		});

		expect(result.sessionId).toBe(sessionId);

		// Project dir should be encoded from targetDir
		const targetEncodedCwd = encodePath(targetDir);
		const targetProjDir = path.join(machineB.claude, "projects", targetEncodedCwd);
		const jsonlPath = path.join(targetProjDir, `${sessionId}.jsonl`);
		expect(fs.existsSync(jsonlPath)).toBe(true);

		// Two-pass verification:
		// 1. No /Users/alice paths remain
		// 2. All paths point to the targetDir
		const jsonlContent = fs.readFileSync(jsonlPath, "utf-8");
		expect(jsonlContent).not.toContain("/Users/alice");
		expect(jsonlContent).toContain(`${machineB.home}/work/my-teleport`);

		// Verify a tool call path was fully rewritten
		const lines = jsonlContent.trim().split("\n");
		const editMsg = JSON.parse(lines[1]);
		expect(editMsg.toolCalls[0].input.file_path).toBe(`${machineB.home}/work/my-teleport/packages/api/src/index.ts`);

		// CWD should point to targetDir, not the original
		const firstMsg = JSON.parse(lines[0]);
		expect(firstMsg.cwd).toBe(`${machineB.home}/work/my-teleport`);

		// Subagent should also be rewritten
		const subagentPath = path.join(targetProjDir, sessionId, "subagents", "explore-001.jsonl");
		expect(fs.existsSync(subagentPath)).toBe(true);
		const subContent = fs.readFileSync(subagentPath, "utf-8");
		expect(subContent).not.toContain("/Users/alice");
		expect(subContent).toContain(`${machineB.home}/work/my-teleport`);

		// Assets still installed correctly
		expect(fs.existsSync(path.join(machineB.claude, "file-history", sessionId))).toBe(true);
		expect(fs.existsSync(path.join(machineB.claude, "paste-cache", "aabb1122.txt"))).toBe(true);
		expect(fs.existsSync(path.join(machineB.claude, "shell-snapshots", "snapshot-zsh-99999-e2eab.sh"))).toBe(true);

		fs.unlinkSync(downloadPath);
	});
});
