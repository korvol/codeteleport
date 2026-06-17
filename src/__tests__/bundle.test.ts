import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleSession, collectExtraFiles } from "../core/bundle";

async function extractBundle(bundlePath: string, into: string): Promise<void> {
	const tar = await import("tar");
	fs.mkdirSync(into, { recursive: true });
	await tar.extract({ file: bundlePath, cwd: into });
}

describe("bundleSession", () => {
	let tmpDir: string;
	let fakeClaude: string;
	const sessionId = "test-session-001";
	const cwd = "/Users/testuser/myproject";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-test-"));
		fakeClaude = path.join(tmpDir, ".claude");

		// Create a fake ~/.claude structure
		const encodedCwd = cwd.replace(/\//g, "-");
		const projDir = path.join(fakeClaude, "projects", encodedCwd);
		fs.mkdirSync(projDir, { recursive: true });

		// Write a session JSONL
		const jsonl = [
			JSON.stringify({ type: "user", timestamp: "2026-03-25T07:00:00.000Z", message: { content: "hello" } }),
			JSON.stringify({
				type: "assistant",
				timestamp: "2026-03-25T07:05:00.000Z",
				model: "claude-opus-4-6",
				message: { content: "hi" },
				toolCalls: [{ name: "Edit", input: { file_path: "/Users/testuser/myproject/foo.ts" } }],
			}),
		].join("\n");
		fs.writeFileSync(path.join(projDir, `${sessionId}.jsonl`), jsonl);

		// Create session subdir with a subagent
		const subdir = path.join(projDir, sessionId, "subagents");
		fs.mkdirSync(subdir, { recursive: true });
		fs.writeFileSync(path.join(subdir, "agent-001.jsonl"), '{"type":"assistant","message":{"content":"sub"}}');

		// Create file-history
		const fh = path.join(fakeClaude, "file-history", sessionId);
		fs.mkdirSync(fh, { recursive: true });
		fs.writeFileSync(path.join(fh, "foo.ts.json"), "{}");

		// Create session-env
		const se = path.join(fakeClaude, "session-env", sessionId);
		fs.mkdirSync(se, { recursive: true });
		fs.writeFileSync(path.join(se, "env.json"), "{}");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates a .tar.gz bundle", async () => {
		const result = await bundleSession({
			sessionId,
			cwd,
			outputDir: tmpDir,
			claudeDir: fakeClaude,
		});

		expect(result.bundlePath).toMatch(/\.tar\.gz$/);
		expect(fs.existsSync(result.bundlePath)).toBe(true);
		expect(result.sizeBytes).toBeGreaterThan(0);
	});

	it("returns correct session metadata", async () => {
		const result = await bundleSession({
			sessionId,
			cwd,
			outputDir: tmpDir,
			claudeDir: fakeClaude,
		});

		expect(result.sessionId).toBe(sessionId);
		expect(result.sourceCwd).toBe(cwd);
		expect(result.sourceUserDir).toBe(os.homedir());
		expect(result.checksum).toMatch(/^sha256:[a-f0-9]+$/);
	});

	it("includes metadata from JSONL scan", async () => {
		const result = await bundleSession({
			sessionId,
			cwd,
			outputDir: tmpDir,
			claudeDir: fakeClaude,
		});

		expect(result.metadata.messageCount).toBe(2);
		expect(result.metadata.userMessageCount).toBe(1);
		expect(result.metadata.assistantMessageCount).toBe(1);
		expect(result.metadata.toolCallCount).toBe(1);
		expect(result.metadata.claudeModel).toBe("claude-opus-4-6");
		expect(result.metadata.hasFileHistory).toBe(true);
		expect(result.metadata.subagentCount).toBeGreaterThanOrEqual(1);
	});

	it("includes meta.json in the bundle", async () => {
		const result = await bundleSession({
			sessionId,
			cwd,
			outputDir: tmpDir,
			claudeDir: fakeClaude,
		});

		// Extract and verify meta.json exists
		const tar = await import("tar");
		const extractDir = path.join(tmpDir, "extracted");
		fs.mkdirSync(extractDir);
		await tar.extract({ file: result.bundlePath, cwd: extractDir });

		const metaPath = path.join(extractDir, "meta.json");
		expect(fs.existsSync(metaPath)).toBe(true);

		const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
		expect(meta.sessionId).toBe(sessionId);
		expect(meta.sourceCwd).toBe(cwd);
		expect(meta.sourceUserDir).toBe(os.homedir());
	});

	it("includes session.jsonl in the bundle", async () => {
		const result = await bundleSession({
			sessionId,
			cwd,
			outputDir: tmpDir,
			claudeDir: fakeClaude,
		});

		const tar = await import("tar");
		const extractDir = path.join(tmpDir, "extracted2");
		fs.mkdirSync(extractDir);
		await tar.extract({ file: result.bundlePath, cwd: extractDir });

		expect(fs.existsSync(path.join(extractDir, "session.jsonl"))).toBe(true);
	});

	it("throws if session JSONL not found", async () => {
		await expect(
			bundleSession({
				sessionId: "nonexistent",
				cwd,
				outputDir: tmpDir,
				claudeDir: fakeClaude,
			}),
		).rejects.toThrow("Session JSONL not found");
	});
});

describe("bundleSession — project memory (Part A)", () => {
	let tmpDir: string;
	let fakeClaude: string;
	let projDir: string;
	const sessionId = "mem-session-001";
	const cwd = "/Users/testuser/memproject";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-mem-"));
		fakeClaude = path.join(tmpDir, ".claude");
		projDir = path.join(fakeClaude, "projects", cwd.replace(/\//g, "-"));
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(
			path.join(projDir, `${sessionId}.jsonl`),
			JSON.stringify({ type: "user", message: { content: "hi" } }),
		);
	});

	afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

	it("bundles the project memory directory when present", async () => {
		const memDir = path.join(projDir, "memory");
		fs.mkdirSync(memDir, { recursive: true });
		fs.writeFileSync(path.join(memDir, "MEMORY.md"), "- [a](a.md)");
		fs.writeFileSync(path.join(memDir, "a.md"), "note a");

		const result = await bundleSession({ sessionId, cwd, outputDir: tmpDir, claudeDir: fakeClaude });

		expect(result.metadata.hasMemory).toBe(true);
		expect(result.metadata.memoryFileCount).toBe(2);

		const extractDir = path.join(tmpDir, "x-mem");
		await extractBundle(result.bundlePath, extractDir);
		expect(fs.existsSync(path.join(extractDir, "memory", "MEMORY.md"))).toBe(true);
		expect(fs.existsSync(path.join(extractDir, "memory", "a.md"))).toBe(true);
	});

	it("sets hasMemory false and stages no memory directory when absent", async () => {
		const result = await bundleSession({ sessionId, cwd, outputDir: tmpDir, claudeDir: fakeClaude });

		expect(result.metadata.hasMemory).toBe(false);
		const extractDir = path.join(tmpDir, "x-nomem");
		await extractBundle(result.bundlePath, extractDir);
		expect(fs.existsSync(path.join(extractDir, "memory"))).toBe(false);
	});

	it("treats an empty memory directory as no memory", async () => {
		fs.mkdirSync(path.join(projDir, "memory"), { recursive: true });

		const result = await bundleSession({ sessionId, cwd, outputDir: tmpDir, claudeDir: fakeClaude });

		expect(result.metadata.hasMemory).toBe(false);
		const extractDir = path.join(tmpDir, "x-emptymem");
		await extractBundle(result.bundlePath, extractDir);
		expect(fs.existsSync(path.join(extractDir, "memory"))).toBe(false);
	});
});

describe("bundleSession — extra files (Part B, includePaths)", () => {
	let tmpDir: string;
	let fakeClaude: string;
	let projDir: string;
	const sessionId = "extra-session-001";
	const cwd = "/Users/testuser/extraproject";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-extra-"));
		fakeClaude = path.join(tmpDir, ".claude");
		projDir = path.join(fakeClaude, "projects", cwd.replace(/\//g, "-"));
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(
			path.join(projDir, `${sessionId}.jsonl`),
			JSON.stringify({ type: "user", message: { content: "hi" } }),
		);
	});

	afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

	it("bundles a caller-supplied temp file and records the manifest", async () => {
		// tmpDir is under os.tmpdir(), so a file inside it is allowlisted.
		const extraFile = path.join(tmpDir, "payload.json");
		fs.writeFileSync(extraFile, '{"x":1}');

		const result = await bundleSession({
			sessionId,
			cwd,
			outputDir: tmpDir,
			claudeDir: fakeClaude,
			includePaths: [extraFile],
		});

		expect(result.metadata.extraFileCount).toBe(1);
		expect(result.metadata.extraFilesIncluded).toContain(extraFile);
		expect(result.extraFiles?.included.map((e) => e.path)).toContain(extraFile);

		const extractDir = path.join(tmpDir, "x-extra");
		await extractBundle(result.bundlePath, extractDir);
		const manifest = JSON.parse(fs.readFileSync(path.join(extractDir, "extra-files-manifest.json"), "utf-8"));
		expect(manifest).toHaveLength(1);
		expect(manifest[0].originalPath).toBe(extraFile);
		expect(manifest[0].rewriteContent).toBe(false);
		expect(fs.existsSync(path.join(extractDir, "extra-files", manifest[0].stored))).toBe(true);
		expect(fs.readFileSync(path.join(extractDir, "extra-files", manifest[0].stored), "utf-8")).toBe('{"x":1}');
	});
});

describe("collectExtraFiles (Part B safety)", () => {
	let root: string;
	let cwd: string;
	let home: string;
	let staging: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "collect-"));
		cwd = path.join(root, "project");
		home = path.join(root, "home");
		staging = path.join(root, "staging");
		fs.mkdirSync(cwd, { recursive: true });
		fs.mkdirSync(home, { recursive: true });
		fs.mkdirSync(staging, { recursive: true });
	});

	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	it("includes a regular file under cwd and copies its content into staging", () => {
		const f = path.join(cwd, "scratch.txt");
		fs.writeFileSync(f, "hello");

		const r = collectExtraFiles({ includePaths: [f], filesModified: [], cwd, homeDir: home, stagingDir: staging });

		expect(r.included.map((e) => e.path)).toEqual([f]);
		const stored = r.included[0].stored;
		expect(fs.readFileSync(path.join(staging, "extra-files", stored), "utf-8")).toBe("hello");
	});

	it("rejects files outside the allowed roots", () => {
		const outside = path.join(root, "elsewhere.txt");
		fs.writeFileSync(outside, "nope");

		// Restrict allowed roots to cwd only so the (tmpdir-resident) file is outside.
		const r = collectExtraFiles({
			includePaths: [outside],
			filesModified: [],
			cwd,
			homeDir: home,
			stagingDir: staging,
			allowedRoots: [cwd],
		});

		expect(r.included).toHaveLength(0);
		expect(r.skipped.some((s) => s.path === outside && /outside/i.test(s.reason))).toBe(true);
	});

	it("hard-rejects sensitive filenames even under an allowed root", () => {
		const env = path.join(cwd, ".env");
		const key = path.join(cwd, "server.pem");
		const id = path.join(cwd, "id_rsa");
		fs.writeFileSync(env, "SECRET=1");
		fs.writeFileSync(key, "-----BEGIN-----");
		fs.writeFileSync(id, "PRIVATE");

		const r = collectExtraFiles({
			includePaths: [env, key, id],
			filesModified: [],
			cwd,
			homeDir: home,
			stagingDir: staging,
		});

		expect(r.included).toHaveLength(0);
		for (const p of [env, key, id]) {
			expect(r.skipped.some((s) => s.path === p && /sensitive/i.test(s.reason))).toBe(true);
		}
	});

	it("hard-rejects files under home-anchored sensitive directories", () => {
		const ssh = path.join(home, ".ssh");
		fs.mkdirSync(ssh, { recursive: true });
		const known = path.join(ssh, "known_hosts");
		fs.writeFileSync(known, "github.com ...");

		const r = collectExtraFiles({
			includePaths: [known],
			filesModified: [],
			cwd,
			homeDir: home,
			stagingDir: staging,
		});

		expect(r.included).toHaveLength(0);
		expect(r.skipped.some((s) => s.path === known && /sensitive/i.test(s.reason))).toBe(true);
	});

	it("skips files over the per-file size cap", () => {
		const big = path.join(cwd, "big.bin");
		fs.writeFileSync(big, Buffer.alloc(100));

		const r = collectExtraFiles({
			includePaths: [big],
			filesModified: [],
			cwd,
			homeDir: home,
			stagingDir: staging,
			perFileMax: 10,
		});

		expect(r.included).toHaveLength(0);
		expect(r.skipped.some((s) => /per-file/i.test(s.reason))).toBe(true);
	});

	it("stops adding once the total size cap is reached", () => {
		const a = path.join(cwd, "a.bin");
		const b = path.join(cwd, "b.bin");
		fs.writeFileSync(a, Buffer.alloc(60));
		fs.writeFileSync(b, Buffer.alloc(60));

		const r = collectExtraFiles({
			includePaths: [a, b],
			filesModified: [],
			cwd,
			homeDir: home,
			stagingDir: staging,
			totalMax: 100,
		});

		expect(r.included).toHaveLength(1);
		expect(r.skipped.some((s) => /total/i.test(s.reason))).toBe(true);
	});

	it("dereferences symlinks and copies the link target's content", () => {
		const real = path.join(cwd, "real.txt");
		const link = path.join(cwd, "link.txt");
		fs.writeFileSync(real, "realcontent");
		fs.symlinkSync(real, link);

		const r = collectExtraFiles({ includePaths: [link], filesModified: [], cwd, homeDir: home, stagingDir: staging });

		expect(r.included).toHaveLength(1);
		expect(r.included[0].path).toBe(link);
		expect(fs.readFileSync(path.join(staging, "extra-files", r.included[0].stored), "utf-8")).toBe("realcontent");
	});

	it("dedupes against already-bundled real roots", () => {
		const sub = path.join(cwd, "sub");
		fs.mkdirSync(sub, { recursive: true });
		const inside = path.join(sub, "x.jsonl");
		fs.writeFileSync(inside, "{}");

		const r = collectExtraFiles({
			includePaths: [inside],
			filesModified: [],
			cwd,
			homeDir: home,
			stagingDir: staging,
			alreadyBundledRealRoots: [fs.realpathSync(sub)],
		});

		expect(r.included).toHaveLength(0);
		expect(r.skipped.some((s) => /already/i.test(s.reason))).toBe(true);
	});

	it("dedupes the union of includePaths and filesModified", () => {
		const f = path.join(cwd, "dup.txt");
		fs.writeFileSync(f, "d");

		const r = collectExtraFiles({ includePaths: [f], filesModified: [f], cwd, homeDir: home, stagingDir: staging });

		expect(r.included).toHaveLength(1);
	});

	it("skips paths that do not exist", () => {
		const missing = path.join(cwd, "nope.txt");

		const r = collectExtraFiles({
			includePaths: [missing],
			filesModified: [],
			cwd,
			homeDir: home,
			stagingDir: staging,
		});

		expect(r.included).toHaveLength(0);
		expect(r.skipped.some((s) => /not found/i.test(s.reason))).toBe(true);
	});

	it("resolves relative includePaths against the session cwd", () => {
		const rel = "scratch-rel.txt";
		fs.writeFileSync(path.join(cwd, rel), "x");

		const r = collectExtraFiles({ includePaths: [rel], filesModified: [], cwd, homeDir: home, stagingDir: staging });

		expect(r.included.map((e) => e.path)).toContain(path.join(cwd, rel));
	});

	it("hard-rejects additional credential filenames (ed25519, .npmrc, .netrc, credentials, p12)", () => {
		const paths = ["id_ed25519", ".npmrc", ".netrc", "credentials", "cert.p12"].map((n) => path.join(cwd, n));
		for (const p of paths) fs.writeFileSync(p, "secret");

		const r = collectExtraFiles({ includePaths: paths, filesModified: [], cwd, homeDir: home, stagingDir: staging });

		expect(r.included).toHaveLength(0);
		for (const p of paths) {
			expect(r.skipped.some((s) => s.path === p && /sensitive/i.test(s.reason))).toBe(true);
		}
	});
});
