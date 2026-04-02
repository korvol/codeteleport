import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unbundleSession } from "../core/unbundle";

describe("unbundleSession", () => {
	let tmpDir: string;
	let bundlePath: string;
	let targetClaudeDir: string;

	const sessionId = "test-session-unbundle-001";
	const sourceCwd = "/Users/alice/myproject";
	const sourceUserDir = "/Users/alice";
	const targetUserDir = "/Users/bob";

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unbundle-test-"));
		targetClaudeDir = path.join(tmpDir, "target-home", ".claude");

		// Create a fake bundle
		const stagingDir = path.join(tmpDir, "staging");
		fs.mkdirSync(stagingDir, { recursive: true });

		// meta.json
		fs.writeFileSync(path.join(stagingDir, "meta.json"), JSON.stringify({ sessionId, sourceCwd, sourceUserDir }));

		// session.jsonl with paths to rewrite
		const jsonl = [
			JSON.stringify({ type: "user", cwd: "/Users/alice/myproject", message: { content: "hello" } }),
			JSON.stringify({
				type: "assistant",
				cwd: "/Users/alice/myproject",
				message: { content: "editing /Users/alice/myproject/foo.ts" },
			}),
		].join("\n");
		fs.writeFileSync(path.join(stagingDir, "session.jsonl"), jsonl);

		// session-subdir with a subagent JSONL
		const subdir = path.join(stagingDir, "session-subdir", "subagents");
		fs.mkdirSync(subdir, { recursive: true });
		fs.writeFileSync(
			path.join(subdir, "agent.jsonl"),
			JSON.stringify({ cwd: "/Users/alice/myproject", type: "assistant" }),
		);

		// file-history
		const fh = path.join(stagingDir, "file-history");
		fs.mkdirSync(fh, { recursive: true });
		fs.writeFileSync(path.join(fh, "foo.ts.json"), "{}");

		// paste-cache
		const pc = path.join(stagingDir, "paste-cache");
		fs.mkdirSync(pc, { recursive: true });
		fs.writeFileSync(path.join(pc, "abc123.txt"), "pasted content");

		// shell-snapshots
		const ss = path.join(stagingDir, "shell-snapshots");
		fs.mkdirSync(ss, { recursive: true });
		fs.writeFileSync(path.join(ss, "snapshot-zsh-123-abc.sh"), "#!/bin/zsh");

		// Create the tar.gz
		bundlePath = path.join(tmpDir, "bundle.tar.gz");
		await tar.create({ gzip: true, file: bundlePath, cwd: stagingDir }, fs.readdirSync(stagingDir));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("extracts and rewrites paths in session JSONL", async () => {
		const result = await unbundleSession({
			bundlePath,
			targetUserDir: path.join(tmpDir, "target-home"),
			claudeDir: targetClaudeDir,
		});

		expect(result.sessionId).toBe(sessionId);
		expect(result.resumeCommand).toBe(`claude --resume ${sessionId}`);

		// Read the installed JSONL and verify paths were rewritten
		const targetCwd = sourceCwd.replace(sourceUserDir, path.join(tmpDir, "target-home"));
		const encodedCwd = targetCwd.replace(/\//g, "-");
		const installedJsonl = path.join(targetClaudeDir, "projects", encodedCwd, `${sessionId}.jsonl`);
		expect(fs.existsSync(installedJsonl)).toBe(true);

		const content = fs.readFileSync(installedJsonl, "utf-8");
		expect(content).not.toContain("/Users/alice");
		expect(content).toContain(path.join(tmpDir, "target-home"));
	});

	it("rewrites paths in subagent JSONL files", async () => {
		await unbundleSession({
			bundlePath,
			targetUserDir: path.join(tmpDir, "target-home"),
			claudeDir: targetClaudeDir,
		});

		const targetCwd = sourceCwd.replace(sourceUserDir, path.join(tmpDir, "target-home"));
		const encodedCwd = targetCwd.replace(/\//g, "-");
		const subagentJsonl = path.join(targetClaudeDir, "projects", encodedCwd, sessionId, "subagents", "agent.jsonl");
		expect(fs.existsSync(subagentJsonl)).toBe(true);

		const content = fs.readFileSync(subagentJsonl, "utf-8");
		expect(content).not.toContain("/Users/alice");
	});

	it("installs file-history", async () => {
		await unbundleSession({
			bundlePath,
			targetUserDir: path.join(tmpDir, "target-home"),
			claudeDir: targetClaudeDir,
		});

		const fh = path.join(targetClaudeDir, "file-history", sessionId, "foo.ts.json");
		expect(fs.existsSync(fh)).toBe(true);
	});

	it("installs paste-cache files", async () => {
		await unbundleSession({
			bundlePath,
			targetUserDir: path.join(tmpDir, "target-home"),
			claudeDir: targetClaudeDir,
		});

		const pc = path.join(targetClaudeDir, "paste-cache", "abc123.txt");
		expect(fs.existsSync(pc)).toBe(true);
		expect(fs.readFileSync(pc, "utf-8")).toBe("pasted content");
	});

	it("installs shell-snapshot files", async () => {
		await unbundleSession({
			bundlePath,
			targetUserDir: path.join(tmpDir, "target-home"),
			claudeDir: targetClaudeDir,
		});

		const ss = path.join(targetClaudeDir, "shell-snapshots", "snapshot-zsh-123-abc.sh");
		expect(fs.existsSync(ss)).toBe(true);
	});

	it("uses targetDir for two-pass rewrite (different user + different project path)", async () => {
		// Source: /Users/alice/myproject on alice's machine
		// Target: /Users/bob/work/different-project on bob's machine
		// Two-pass: /Users/alice → /Users/bob, then /Users/bob/myproject → /Users/bob/work/different-project

		const targetDir = "/Users/bob/work/different-project";
		const bobClaude = path.join(tmpDir, "bob-home", ".claude");

		const result = await unbundleSession({
			bundlePath,
			targetDir,
			claudeDir: bobClaude,
		});

		expect(result.sessionId).toBe(sessionId);

		// The project dir should be encoded from targetDir, not from the source cwd
		const expectedEncoded = targetDir.replace(/\//g, "-");
		const jsonlPath = path.join(bobClaude, "projects", expectedEncoded, `${sessionId}.jsonl`);
		expect(fs.existsSync(jsonlPath)).toBe(true);

		// Paths should be fully rewritten to target
		const content = fs.readFileSync(jsonlPath, "utf-8");
		expect(content).not.toContain("/Users/alice");
		expect(content).toContain("/Users/bob/work/different-project");
	});

	it("targetDir auto-detects home dir and derives claudeDir", async () => {
		// Use targetDir with explicit claudeDir to test the home detection logic
		const targetDir = "/Users/bob/projects/anchored-here";
		const bobClaude = path.join(tmpDir, "bob-claude");

		const result = await unbundleSession({
			bundlePath,
			targetDir,
			claudeDir: bobClaude,
		});

		expect(result.sessionId).toBe(sessionId);
		expect(result.resumeCommand).toBe(`claude --resume ${sessionId}`);

		// Session should be anchored at targetDir path
		const expectedEncoded = targetDir.replace(/\//g, "-");
		const jsonlPath = path.join(bobClaude, "projects", expectedEncoded, `${sessionId}.jsonl`);
		expect(fs.existsSync(jsonlPath)).toBe(true);
	});

	it("uses resumeCommandPrefix when provided", async () => {
		const result = await unbundleSession({
			bundlePath,
			targetUserDir: path.join(tmpDir, "target-home"),
			claudeDir: targetClaudeDir,
			resumeCommandPrefix: "gemini --resume",
		});

		expect(result.resumeCommand).toBe(`gemini --resume ${sessionId}`);
	});

	it("defaults to claude --resume when resumeCommandPrefix not provided", async () => {
		const result = await unbundleSession({
			bundlePath,
			targetUserDir: path.join(tmpDir, "target-home"),
			claudeDir: targetClaudeDir,
		});

		expect(result.resumeCommand).toBe(`claude --resume ${sessionId}`);
	});

	it("throws for invalid bundle (missing meta.json)", async () => {
		// Create a bundle without meta.json
		const badStaging = path.join(tmpDir, "bad-staging");
		fs.mkdirSync(badStaging, { recursive: true });
		fs.writeFileSync(path.join(badStaging, "session.jsonl"), "{}");

		const badBundle = path.join(tmpDir, "bad-bundle.tar.gz");
		await tar.create({ gzip: true, file: badBundle, cwd: badStaging }, ["session.jsonl"]);

		await expect(
			unbundleSession({
				bundlePath: badBundle,
				targetUserDir: path.join(tmpDir, "target-home"),
				claudeDir: targetClaudeDir,
			}),
		).rejects.toThrow("meta.json not found");
	});
});
