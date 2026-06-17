import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleSession } from "../core/bundle";
import { encodePath } from "../core/paths";
import { unbundleSession } from "../core/unbundle";

describe("Round-trip: bundle → unbundle", () => {
	let sourceHome: string;
	let targetHome: string;
	let sourceClaude: string;
	let targetClaude: string;
	let bundleDir: string;

	const sessionId = "roundtrip-session-001";
	const sourceCwd = "/Users/alice/projects/code-teleport";
	const sourceUserDir = "/Users/alice";
	const targetUserDir = "/Users/bob";

	beforeEach(() => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roundtrip-test-"));
		sourceHome = path.join(tmpRoot, "source");
		targetHome = path.join(tmpRoot, "target");
		bundleDir = path.join(tmpRoot, "bundles");
		sourceClaude = path.join(sourceHome, ".claude");
		targetClaude = path.join(targetHome, ".claude");

		fs.mkdirSync(bundleDir, { recursive: true });
		fs.mkdirSync(targetHome, { recursive: true });

		// Build a realistic source ~/.claude structure
		const encodedCwd = encodePath(sourceCwd);
		const projDir = path.join(sourceClaude, "projects", encodedCwd);
		fs.mkdirSync(projDir, { recursive: true });

		// Session JSONL with paths to rewrite
		const jsonlEntries = [
			{
				type: "user",
				timestamp: "2026-03-25T07:00:00.000Z",
				cwd: "/Users/alice/projects/code-teleport",
				message: { content: "Build the CodeTeleport bundle and unpack scripts" },
			},
			{
				type: "assistant",
				timestamp: "2026-03-25T07:15:00.000Z",
				model: "claude-opus-4-6",
				cwd: "/Users/alice/projects/code-teleport",
				message: { content: "I'll edit /Users/alice/projects/code-teleport/bundle.sh" },
				toolCalls: [
					{ name: "Edit", input: { file_path: "/Users/alice/projects/code-teleport/bundle.sh" } },
					{ name: "Write", input: { file_path: "/Users/alice/projects/code-teleport/unpack.sh" } },
				],
			},
			{
				type: "user",
				timestamp: "2026-03-25T07:30:00.000Z",
				cwd: "/Users/alice/projects/code-teleport",
				message: { content: "Now test it with paste-cache/aabbcc11.txt referenced" },
			},
			{
				type: "assistant",
				timestamp: "2026-03-25T08:00:00.000Z",
				model: "claude-opus-4-6",
				cwd: "/Users/alice/projects/code-teleport",
				message: { content: "Reading paste-cache/aabbcc11.txt and snapshot-zsh-99999-abcde.sh" },
			},
		];
		fs.writeFileSync(path.join(projDir, `${sessionId}.jsonl`), jsonlEntries.map((e) => JSON.stringify(e)).join("\n"));

		// Subagent directory
		const subagentDir = path.join(projDir, sessionId, "subagents");
		fs.mkdirSync(subagentDir, { recursive: true });
		fs.writeFileSync(
			path.join(subagentDir, "explore-001.jsonl"),
			JSON.stringify({
				type: "assistant",
				cwd: "/Users/alice/projects/code-teleport",
				message: { content: "exploring" },
			}),
		);

		// File history
		const fhDir = path.join(sourceClaude, "file-history", sessionId);
		fs.mkdirSync(fhDir, { recursive: true });
		fs.writeFileSync(path.join(fhDir, "bundle.sh.json"), JSON.stringify({ versions: [1, 2, 3] }));
		fs.writeFileSync(path.join(fhDir, "unpack.sh.json"), JSON.stringify({ versions: [1] }));

		// Session env
		const seDir = path.join(sourceClaude, "session-env", sessionId);
		fs.mkdirSync(seDir, { recursive: true });
		fs.writeFileSync(path.join(seDir, "env.json"), JSON.stringify({ PATH: "/usr/bin", HOME: "/Users/alice" }));

		// Paste cache
		const pcDir = path.join(sourceClaude, "paste-cache");
		fs.mkdirSync(pcDir, { recursive: true });
		fs.writeFileSync(path.join(pcDir, "aabbcc11.txt"), "This is pasted content from the clipboard");

		// Shell snapshots
		const ssDir = path.join(sourceClaude, "shell-snapshots");
		fs.mkdirSync(ssDir, { recursive: true });
		fs.writeFileSync(path.join(ssDir, "snapshot-zsh-99999-abcde.sh"), "#!/bin/zsh\nexport FOO=bar");
	});

	afterEach(() => {
		// Clean up everything
		const tmpRoot = path.dirname(sourceHome);
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("full round-trip preserves all data and rewrites paths", async () => {
		// ── BUNDLE ──
		const bundleResult = await bundleSession({
			sessionId,
			cwd: sourceCwd,
			outputDir: bundleDir,
			claudeDir: sourceClaude,
			sourceUserDir,
		});

		// Verify bundle was created
		expect(fs.existsSync(bundleResult.bundlePath)).toBe(true);
		expect(bundleResult.sizeBytes).toBeGreaterThan(0);
		expect(bundleResult.checksum).toMatch(/^sha256:[a-f0-9]+$/);
		expect(bundleResult.sessionId).toBe(sessionId);

		// Verify metadata was extracted
		expect(bundleResult.metadata.messageCount).toBe(4);
		expect(bundleResult.metadata.userMessageCount).toBe(2);
		expect(bundleResult.metadata.assistantMessageCount).toBe(2);
		expect(bundleResult.metadata.toolCallCount).toBe(2);
		expect(bundleResult.metadata.claudeModel).toBe("claude-opus-4-6");
		expect(bundleResult.metadata.projectName).toBe("code-teleport");
		expect(bundleResult.metadata.summary).toBe("Build the CodeTeleport bundle and unpack scripts");
		expect(bundleResult.metadata.sessionStartedAt).toBe("2026-03-25T07:00:00.000Z");
		expect(bundleResult.metadata.sessionEndedAt).toBe("2026-03-25T08:00:00.000Z");
		expect(bundleResult.metadata.durationSeconds).toBe(3600);
		expect(bundleResult.metadata.filesModified).toEqual([
			"/Users/alice/projects/code-teleport/bundle.sh",
			"/Users/alice/projects/code-teleport/unpack.sh",
		]);
		expect(bundleResult.metadata.filesModifiedCount).toBe(2);
		expect(bundleResult.metadata.hasFileHistory).toBe(true);
		expect(bundleResult.metadata.hasPasteCache).toBe(true);
		expect(bundleResult.metadata.hasShellSnapshots).toBe(true);
		expect(bundleResult.metadata.subagentCount).toBe(1);

		// ── UNBUNDLE ──
		const unbundleResult = await unbundleSession({
			bundlePath: bundleResult.bundlePath,
			targetUserDir: targetHome,
			claudeDir: targetClaude,
		});

		expect(unbundleResult.sessionId).toBe(sessionId);
		expect(unbundleResult.resumeCommand).toBe(`claude --resume ${sessionId}`);

		// ── VERIFY PATHS REWRITTEN ──
		const targetCwd = sourceCwd.replace(sourceUserDir, targetHome);
		const targetEncodedCwd = encodePath(targetCwd);
		const targetProjDir = path.join(targetClaude, "projects", targetEncodedCwd);

		// Session JSONL exists and has rewritten paths
		const jsonlPath = path.join(targetProjDir, `${sessionId}.jsonl`);
		expect(fs.existsSync(jsonlPath)).toBe(true);
		const jsonlContent = fs.readFileSync(jsonlPath, "utf-8");
		expect(jsonlContent).not.toContain("/Users/alice");
		expect(jsonlContent).toContain(targetHome);

		// Verify each JSONL line individually
		const lines = jsonlContent.trim().split("\n");
		expect(lines).toHaveLength(4);
		const firstEntry = JSON.parse(lines[0]);
		expect(firstEntry.cwd).toBe(`${targetHome}/projects/code-teleport`);
		const secondEntry = JSON.parse(lines[1]);
		expect(secondEntry.message.content).toContain(`${targetHome}/projects/code-teleport/bundle.sh`);
		expect(secondEntry.toolCalls[0].input.file_path).toBe(`${targetHome}/projects/code-teleport/bundle.sh`);

		// ── VERIFY SUBAGENT PATHS REWRITTEN ──
		const subagentJsonl = path.join(targetProjDir, sessionId, "subagents", "explore-001.jsonl");
		expect(fs.existsSync(subagentJsonl)).toBe(true);
		const subContent = fs.readFileSync(subagentJsonl, "utf-8");
		expect(subContent).not.toContain("/Users/alice");
		expect(subContent).toContain(targetHome);

		// ── VERIFY FILE HISTORY ──
		const fhDir = path.join(targetClaude, "file-history", sessionId);
		expect(fs.existsSync(path.join(fhDir, "bundle.sh.json"))).toBe(true);
		expect(fs.existsSync(path.join(fhDir, "unpack.sh.json"))).toBe(true);
		const fhContent = JSON.parse(fs.readFileSync(path.join(fhDir, "bundle.sh.json"), "utf-8"));
		expect(fhContent.versions).toEqual([1, 2, 3]);

		// ── VERIFY SESSION ENV ──
		const seDir = path.join(targetClaude, "session-env", sessionId);
		expect(fs.existsSync(path.join(seDir, "env.json"))).toBe(true);

		// ── VERIFY PASTE CACHE ──
		const pcFile = path.join(targetClaude, "paste-cache", "aabbcc11.txt");
		expect(fs.existsSync(pcFile)).toBe(true);
		expect(fs.readFileSync(pcFile, "utf-8")).toBe("This is pasted content from the clipboard");

		// ── VERIFY SHELL SNAPSHOTS ──
		const ssFile = path.join(targetClaude, "shell-snapshots", "snapshot-zsh-99999-abcde.sh");
		expect(fs.existsSync(ssFile)).toBe(true);
		expect(fs.readFileSync(ssFile, "utf-8")).toBe("#!/bin/zsh\nexport FOO=bar");
	});

	it("round-trip with different username produces valid structure", async () => {
		const bundleResult = await bundleSession({
			sessionId,
			cwd: sourceCwd,
			outputDir: bundleDir,
			claudeDir: sourceClaude,
			sourceUserDir,
		});

		// Unbundle pretending we're /Users/bob
		const unbundleResult = await unbundleSession({
			bundlePath: bundleResult.bundlePath,
			targetUserDir: targetHome,
			claudeDir: targetClaude,
		});

		// The project directory should use the target path encoding
		const expectedCwd = sourceCwd.replace(sourceUserDir, targetHome);
		const expectedEncoded = encodePath(expectedCwd);
		const expectedProjDir = path.join(targetClaude, "projects", expectedEncoded);
		expect(unbundleResult.installedTo).toBe(expectedProjDir);
		expect(fs.existsSync(expectedProjDir)).toBe(true);

		// The JSONL should exist under the new encoded path
		expect(fs.existsSync(path.join(expectedProjDir, `${sessionId}.jsonl`))).toBe(true);

		// Subagent should be under the new path too
		expect(fs.existsSync(path.join(expectedProjDir, sessionId, "subagents", "explore-001.jsonl"))).toBe(true);
	});

	it("bundle checksum is deterministic for same content", async () => {
		const result1 = await bundleSession({
			sessionId,
			cwd: sourceCwd,
			outputDir: bundleDir,
			claudeDir: sourceClaude,
		});

		// Bundle again to a different file
		const result2 = await bundleSession({
			sessionId,
			cwd: sourceCwd,
			outputDir: bundleDir,
			claudeDir: sourceClaude,
		});

		// Both should have the same checksum (same input → same output)
		expect(result1.checksum).toBe(result2.checksum);
	});

	it("round-trips memory + extra files cross-user and refuses sensitive paths", async () => {
		// Use REAL temp dirs so the allowlist (cwd / tmpdir) and file existence checks apply.
		const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rt-src-"));
		const tgtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rt-tgt-"));
		try {
			const srcHome = path.join(srcRoot, "home");
			const srcCwd = path.join(srcHome, "projects", "app");
			const srcClaude = path.join(srcHome, ".claude");
			const sid = "rt-mem-extra-001";
			const projDir = path.join(srcClaude, "projects", encodePath(srcCwd));
			fs.mkdirSync(projDir, { recursive: true });
			fs.mkdirSync(srcCwd, { recursive: true });

			// A working file the agent edited (picked up via scanner.filesModified)
			const cwdFile = path.join(srcCwd, "notes.txt");
			fs.writeFileSync(cwdFile, "working notes");
			fs.writeFileSync(
				path.join(projDir, `${sid}.jsonl`),
				[
					JSON.stringify({ type: "user", cwd: srcCwd, message: { content: "hi" } }),
					JSON.stringify({
						type: "assistant",
						cwd: srcCwd,
						message: { content: "x" },
						toolCalls: [{ name: "Write", input: { file_path: cwdFile } }],
					}),
				].join("\n"),
			);

			// Project memory
			const memDir = path.join(projDir, "memory");
			fs.mkdirSync(memDir, { recursive: true });
			fs.writeFileSync(path.join(memDir, "MEMORY.md"), `- ref ${srcCwd}/notes.txt`);

			// A caller-supplied temp file (allowlisted via tmpdir root)
			const tmpExtra = path.join(srcRoot, "payload.json");
			fs.writeFileSync(tmpExtra, '{"k":1}');

			// A sensitive file that must be refused
			const sshDir = path.join(srcHome, ".ssh");
			fs.mkdirSync(sshDir, { recursive: true });
			const sshKey = path.join(sshDir, "id_rsa");
			fs.writeFileSync(sshKey, "PRIVATE KEY");

			// ── BUNDLE ──
			const bundle = await bundleSession({
				sessionId: sid,
				cwd: srcCwd,
				outputDir: srcRoot,
				claudeDir: srcClaude,
				sourceUserDir: srcHome,
				includePaths: [tmpExtra, sshKey],
			});

			expect(bundle.metadata.hasMemory).toBe(true);
			const includedPaths = bundle.extraFiles?.included.map((e) => e.path) ?? [];
			expect(includedPaths).toContain(tmpExtra);
			expect(includedPaths).toContain(cwdFile);
			expect(includedPaths).not.toContain(sshKey);
			expect(bundle.extraFiles?.skipped.some((s) => s.path === sshKey && /sensitive/i.test(s.reason))).toBe(true);

			// Delete the temp file to prove restore re-creates it
			fs.rmSync(tmpExtra);

			// ── UNBUNDLE (as a different user) ──
			const tgtHome = path.join(tgtRoot, "home");
			const tgtClaude = path.join(tgtHome, ".claude");
			fs.mkdirSync(tgtHome, { recursive: true });

			await unbundleSession({ bundlePath: bundle.bundlePath, targetUserDir: tgtHome, claudeDir: tgtClaude });

			const tgtCwd = srcCwd.replace(srcHome, tgtHome);
			const tgtProj = path.join(tgtClaude, "projects", encodePath(tgtCwd));

			// Memory restored + rewritten
			const memOut = path.join(tgtProj, "memory", "MEMORY.md");
			expect(fs.existsSync(memOut)).toBe(true);
			expect(fs.readFileSync(memOut, "utf-8")).toContain(`${tgtCwd}/notes.txt`);
			expect(fs.readFileSync(memOut, "utf-8")).not.toContain(srcHome);

			// cwd-relative working file restored at the rewritten path
			const cwdFileOut = path.join(tgtCwd, "notes.txt");
			expect(fs.existsSync(cwdFileOut)).toBe(true);
			expect(fs.readFileSync(cwdFileOut, "utf-8")).toBe("working notes");

			// /tmp passthrough file restored at the identical path
			expect(fs.existsSync(tmpExtra)).toBe(true);
			expect(fs.readFileSync(tmpExtra, "utf-8")).toBe('{"k":1}');

			// Sensitive key never restored
			expect(fs.existsSync(path.join(tgtHome, ".ssh", "id_rsa"))).toBe(false);
		} finally {
			fs.rmSync(srcRoot, { recursive: true, force: true });
			fs.rmSync(tgtRoot, { recursive: true, force: true });
		}
	});
});
