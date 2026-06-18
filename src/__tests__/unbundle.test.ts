import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodePath } from "../core/paths";
import { installMemory, isRestoreTargetSafe, unbundleSession } from "../core/unbundle";

const identity = (s: string) => s;

async function buildBundle(tmpRoot: string, populate: (staging: string) => void): Promise<string> {
	const staging = fs.mkdtempSync(path.join(tmpRoot, "stg-"));
	populate(staging);
	const bundlePath = path.join(tmpRoot, `bundle-${path.basename(staging)}.tar.gz`);
	await tar.create({ gzip: true, file: bundlePath, cwd: staging }, fs.readdirSync(staging));
	return bundlePath;
}

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

		// Read the installed JSONL and verify paths were rewritten to the target machine.
		const targetHome = path.join(tmpDir, "target-home");
		const targetCwd = path.join(targetHome, "myproject");
		const installedJsonl = path.join(targetClaudeDir, "projects", encodePath(targetCwd), `${sessionId}.jsonl`);
		expect(fs.existsSync(installedJsonl)).toBe(true);

		const content = fs.readFileSync(installedJsonl, "utf-8");
		expect(content).not.toContain("/Users/alice");
		// Assert on the decoded path values (host-native), not raw bytes — Windows JSONL
		// is backslash-escaped, so a raw substring check wouldn't be portable.
		const lines = content.trim().split("\n");
		expect(JSON.parse(lines[0]).cwd).toBe(targetCwd);
		expect(JSON.parse(lines[1]).message.content).toContain(path.join(targetCwd, "foo.ts"));
	});

	it("rewrites paths in subagent JSONL files", async () => {
		await unbundleSession({
			bundlePath,
			targetUserDir: path.join(tmpDir, "target-home"),
			claudeDir: targetClaudeDir,
		});

		const targetCwd = path.join(tmpDir, "target-home", "myproject");
		const subagentJsonl = path.join(
			targetClaudeDir,
			"projects",
			encodePath(targetCwd),
			sessionId,
			"subagents",
			"agent.jsonl",
		);
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

describe("installMemory (Part A)", () => {
	let root: string;
	let src: string;
	let dst: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "installmem-"));
		src = path.join(root, "src");
		dst = path.join(root, "dst");
		fs.mkdirSync(src, { recursive: true });
		fs.mkdirSync(dst, { recursive: true });
	});

	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	it("merge: unions MEMORY.md by line and never clobbers other .md files", () => {
		fs.writeFileSync(path.join(src, "MEMORY.md"), "- a\n- b\n- c");
		fs.writeFileSync(path.join(src, "note.md"), "incoming note");
		fs.writeFileSync(path.join(dst, "MEMORY.md"), "- a\n- x");
		fs.writeFileSync(path.join(dst, "note.md"), "EXISTING note");

		const r = installMemory(src, dst, identity, "merge");

		expect(fs.readFileSync(path.join(dst, "MEMORY.md"), "utf-8")).toBe("- a\n- x\n- b\n- c");
		expect(fs.readFileSync(path.join(dst, "note.md"), "utf-8")).toBe("EXISTING note");
		expect(r.merged).toContain("MEMORY.md");
		expect(r.skipped).toContain("note.md");
	});

	it("merge: writes files absent on the target", () => {
		fs.writeFileSync(path.join(src, "new.md"), "brand new");

		const r = installMemory(src, dst, identity, "merge");

		expect(fs.readFileSync(path.join(dst, "new.md"), "utf-8")).toBe("brand new");
		expect(r.written).toContain("new.md");
	});

	it("overwrite: replaces existing files", () => {
		fs.writeFileSync(path.join(src, "note.md"), "NEW");
		fs.writeFileSync(path.join(dst, "note.md"), "OLD");

		const r = installMemory(src, dst, identity, "overwrite");

		expect(fs.readFileSync(path.join(dst, "note.md"), "utf-8")).toBe("NEW");
		expect(r.written).toContain("note.md");
	});

	it("skip: keeps existing files untouched", () => {
		fs.writeFileSync(path.join(src, "note.md"), "NEW");
		fs.writeFileSync(path.join(dst, "note.md"), "OLD");

		const r = installMemory(src, dst, identity, "skip");

		expect(fs.readFileSync(path.join(dst, "note.md"), "utf-8")).toBe("OLD");
		expect(r.skipped).toContain("note.md");
	});

	it("rewrites .md contents through the rewrite function", () => {
		fs.writeFileSync(path.join(src, "paths.md"), "see /Users/alice/x");

		installMemory(src, dst, (c) => c.replace("/Users/alice", "/Users/bob"), "merge");

		expect(fs.readFileSync(path.join(dst, "paths.md"), "utf-8")).toBe("see /Users/bob/x");
	});

	it("merge preserves a single trailing newline and injects no blank line", () => {
		fs.writeFileSync(path.join(src, "MEMORY.md"), "- a\n- b\n");
		fs.writeFileSync(path.join(dst, "MEMORY.md"), "- a\n");

		installMemory(src, dst, identity, "merge");

		expect(fs.readFileSync(path.join(dst, "MEMORY.md"), "utf-8")).toBe("- a\n- b\n");
	});
});

describe("isRestoreTargetSafe (Part B restore safety)", () => {
	// Built from a host-native base so path.resolve() doesn't inject a drive letter on Windows.
	const home = path.join(os.tmpdir(), "rb-home");
	const app = path.join(home, "app");
	const roots = [app, path.join(home, ".claude"), os.tmpdir()];
	const fsRoot = path.parse(home).root;

	it("allows targets under the project cwd or temp roots", () => {
		expect(isRestoreTargetSafe(path.join(app, "notes", "x.txt"), roots, home)).toBe(true);
		expect(isRestoreTargetSafe(path.join(os.tmpdir(), "data.json"), roots, home)).toBe(true);
	});

	it("rejects targets outside all allowed roots", () => {
		expect(isRestoreTargetSafe(path.join(fsRoot, "etc", "cron.d", "evil"), roots, home)).toBe(false);
		expect(isRestoreTargetSafe(path.join(fsRoot, "somewhere-else", "proj", "x"), roots, home)).toBe(false);
	});

	it("rejects path traversal that escapes an allowed root", () => {
		expect(isRestoreTargetSafe(path.join(app, "..", "..", "..", "etc", "x"), roots, home)).toBe(false);
	});

	it("rejects sensitive targets even under an allowed root", () => {
		expect(isRestoreTargetSafe(path.join(os.tmpdir(), ".env"), roots, home)).toBe(false);
		expect(isRestoreTargetSafe(path.join(app, "server.pem"), roots, home)).toBe(false);
	});
});

describe("unbundleSession — anchors repeated home dir in cwd (Part B)", () => {
	it("rewrites all occurrences of the home dir when anchoring cwd", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unbundle-rep-"));
		try {
			const targetHome = path.join(tmpDir, "bob");
			const targetClaude = path.join(targetHome, ".claude");
			const sUser = "/Users/alice";
			const sCwd = "/Users/alice/work/Users/alice/app"; // home string repeats
			const bundlePath = await buildBundle(tmpDir, (s) => {
				fs.writeFileSync(
					path.join(s, "meta.json"),
					JSON.stringify({ sessionId: "rep-1", sourceCwd: sCwd, sourceUserDir: sUser }),
				);
				fs.writeFileSync(path.join(s, "session.jsonl"), JSON.stringify({ type: "user", cwd: sCwd }));
			});

			const result = await unbundleSession({ bundlePath, targetUserDir: targetHome, claudeDir: targetClaude });

			// Only the anchored home PREFIX is relocated; a deeper segment that coincidentally
			// repeats the home string is left in place (a home/drive root can't be spliced
			// into the middle of a path). Separators are translated to the target's native style.
			const expectedCwd = path.join(targetHome, "work", "Users", "alice", "app");
			expect(result.installedTo).toBe(path.join(targetClaude, "projects", encodePath(expectedCwd)));
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("unbundleSession — project memory restore (Part A)", () => {
	let tmpDir: string;
	let targetHome: string;
	let targetClaude: string;
	const sessionId = "unbundle-mem-001";
	const sourceCwd = "/Users/alice/app";
	const sourceUserDir = "/Users/alice";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unbundle-mem-"));
		targetHome = path.join(tmpDir, "target-home");
		targetClaude = path.join(targetHome, ".claude");
		fs.mkdirSync(targetHome, { recursive: true });
	});

	afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

	it("restores memory under the target project dir with .md path rewrite", async () => {
		const bundlePath = await buildBundle(tmpDir, (s) => {
			fs.writeFileSync(path.join(s, "meta.json"), JSON.stringify({ sessionId, sourceCwd, sourceUserDir }));
			fs.writeFileSync(path.join(s, "session.jsonl"), JSON.stringify({ type: "user", cwd: sourceCwd }));
			const mem = path.join(s, "memory");
			fs.mkdirSync(mem, { recursive: true });
			fs.writeFileSync(path.join(mem, "MEMORY.md"), `- ref ${sourceCwd}/x.md`);
			fs.writeFileSync(path.join(mem, "x.md"), "note about /Users/alice/app");
		});

		const result = await unbundleSession({ bundlePath, targetUserDir: targetHome, claudeDir: targetClaude });

		const targetCwd = path.join(targetHome, "app");
		const memDir = path.join(targetClaude, "projects", encodePath(targetCwd), "memory");
		expect(fs.existsSync(path.join(memDir, "MEMORY.md"))).toBe(true);
		const mc = fs.readFileSync(path.join(memDir, "MEMORY.md"), "utf-8");
		expect(mc).toContain(path.join(targetCwd, "x.md"));
		expect(mc).not.toContain("/Users/alice");
		expect(result.memoryInstalled?.written).toContain("MEMORY.md");
	});
});

describe("unbundleSession — extra files restore (Part B)", () => {
	let tmpDir: string;
	let targetHome: string;
	let targetClaude: string;
	const sessionId = "unbundle-extra-001";
	const sourceCwd = "/Users/alice/app";
	const sourceUserDir = "/Users/alice";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unbundle-extra-"));
		targetHome = path.join(tmpDir, "target-home");
		targetClaude = path.join(targetHome, ".claude");
		fs.mkdirSync(targetHome, { recursive: true });
	});

	afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

	function bundleWithExtra(originalPath: string, content: string): Promise<string> {
		return buildBundle(tmpDir, (s) => {
			fs.writeFileSync(path.join(s, "meta.json"), JSON.stringify({ sessionId, sourceCwd, sourceUserDir }));
			fs.writeFileSync(path.join(s, "session.jsonl"), "{}");
			fs.mkdirSync(path.join(s, "extra-files"), { recursive: true });
			fs.writeFileSync(path.join(s, "extra-files", "stored1"), content);
			fs.writeFileSync(
				path.join(s, "extra-files-manifest.json"),
				JSON.stringify([{ stored: "stored1", originalPath, sizeBytes: content.length, rewriteContent: false }]),
			);
		});
	}

	it("restores an extra file to a /tmp passthrough path (written)", async () => {
		const restoreTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ct-restore-"));
		const originalPath = path.join(restoreTmp, "data.json");
		const bundlePath = await bundleWithExtra(originalPath, "DATA!");

		const r = await unbundleSession({ bundlePath, targetUserDir: targetHome, claudeDir: targetClaude });

		expect(fs.readFileSync(originalPath, "utf-8")).toBe("DATA!");
		expect(r.extraFilesInstalled?.some((e) => e.path === originalPath && e.action === "written")).toBe(true);
		fs.rmSync(restoreTmp, { recursive: true, force: true });
	});

	it("overwrites a pre-existing target by default", async () => {
		const restoreTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ct-restore-"));
		const originalPath = path.join(restoreTmp, "data.json");
		fs.writeFileSync(originalPath, "OLD");
		const bundlePath = await bundleWithExtra(originalPath, "NEW!");

		const r = await unbundleSession({ bundlePath, targetUserDir: targetHome, claudeDir: targetClaude });

		expect(fs.readFileSync(originalPath, "utf-8")).toBe("NEW!");
		expect(r.extraFilesInstalled?.some((e) => e.path === originalPath && e.action === "overwritten")).toBe(true);
		fs.rmSync(restoreTmp, { recursive: true, force: true });
	});

	it("honors extraFilesConflict='skip' for pre-existing targets", async () => {
		const restoreTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ct-restore-"));
		const originalPath = path.join(restoreTmp, "data.json");
		fs.writeFileSync(originalPath, "OLD");
		const bundlePath = await bundleWithExtra(originalPath, "NEW!");

		const r = await unbundleSession({
			bundlePath,
			targetUserDir: targetHome,
			claudeDir: targetClaude,
			extraFilesConflict: "skip",
		});

		expect(fs.readFileSync(originalPath, "utf-8")).toBe("OLD");
		expect(r.extraFilesInstalled?.some((e) => e.path === originalPath && e.action === "skipped")).toBe(true);
		fs.rmSync(restoreTmp, { recursive: true, force: true });
	});

	it("rewrites cwd-relative extra-file target paths to the target cwd", async () => {
		const originalPath = `${sourceCwd}/notes/scratch.txt`;
		const bundlePath = await bundleWithExtra(originalPath, "scratch");

		await unbundleSession({ bundlePath, targetUserDir: targetHome, claudeDir: targetClaude });

		const targetCwd = sourceCwd.replace(sourceUserDir, targetHome);
		const expected = path.join(targetCwd, "notes", "scratch.txt");
		expect(fs.existsSync(expected)).toBe(true);
		expect(fs.readFileSync(expected, "utf-8")).toBe("scratch");
	});

	it("anchors encoded-cwd temp paths to the target cwd", async () => {
		const restoreTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ct-enc-"));
		const originalPath = path.join(restoreTmp, encodePath(sourceCwd), "job.output");
		const bundlePath = await bundleWithExtra(originalPath, "OUT");

		await unbundleSession({ bundlePath, targetUserDir: targetHome, claudeDir: targetClaude });

		const targetCwd = sourceCwd.replace(sourceUserDir, targetHome);
		const expected = path.join(restoreTmp, encodePath(targetCwd), "job.output");
		expect(fs.existsSync(expected)).toBe(true);
		expect(fs.readFileSync(expected, "utf-8")).toBe("OUT");
		fs.rmSync(restoreTmp, { recursive: true, force: true });
	});

	it("refuses to restore an extra file to a sensitive target", async () => {
		const restoreTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ct-restore-"));
		const originalPath = path.join(restoreTmp, ".env");
		const bundlePath = await bundleWithExtra(originalPath, "SECRET=1");

		const r = await unbundleSession({ bundlePath, targetUserDir: targetHome, claudeDir: targetClaude });

		expect(fs.existsSync(originalPath)).toBe(false);
		expect(r.extraFilesInstalled?.find((e) => e.path === originalPath)?.action).toBe("skipped");
		fs.rmSync(restoreTmp, { recursive: true, force: true });
	});
});
