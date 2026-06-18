import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleSession } from "../core/bundle";
import { encodePath } from "../core/paths";
import { unbundleSession } from "../core/unbundle";
import { BUNDLE_FORMAT_VERSION, DEFAULT_AGENT_ID } from "../shared/constants";

/**
 * Phase 1 — the bundle must be self-describing: meta.json records which agent
 * produced it (agentId) and the bundle format version, so pull can dispatch to
 * the right adapter without relying on the puller's local config. Bundles made
 * before this field existed must still restore (legacy default = claude-code).
 */

function readMeta(bundlePath: string, into: string): Record<string, unknown> {
	fs.mkdirSync(into, { recursive: true });
	// tar is async elsewhere; here we only need a sync read of one small file.
	tar.extract({ file: bundlePath, cwd: into, sync: true });
	return JSON.parse(fs.readFileSync(path.join(into, "meta.json"), "utf-8"));
}

/** Re-pack a staging dir into a tar.gz (used to forge legacy / unknown-agent bundles). */
async function repack(stagingDir: string, outFile: string): Promise<void> {
	await tar.create({ gzip: true, file: outFile, cwd: stagingDir }, fs.readdirSync(stagingDir));
}

describe("self-describing bundle (agentId + formatVersion)", () => {
	let tmpDir: string;
	let fakeClaude: string;
	const sessionId = "dispatch-session-001";
	const cwd = "/Users/testuser/dispatchproject";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-test-"));
		fakeClaude = path.join(tmpDir, ".claude");
		const projDir = path.join(fakeClaude, "projects", encodePath(cwd));
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(
			path.join(projDir, `${sessionId}.jsonl`),
			JSON.stringify({ type: "user", cwd, message: { content: "hi" } }),
		);
	});

	afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

	it("records agentId=claude-code and the format version in meta.json by default", async () => {
		const result = await bundleSession({ sessionId, cwd, outputDir: tmpDir, claudeDir: fakeClaude });
		const meta = readMeta(result.bundlePath, path.join(tmpDir, "x-default"));
		expect(meta.agentId).toBe(DEFAULT_AGENT_ID);
		expect(meta.agentId).toBe("claude-code");
		expect(meta.formatVersion).toBe(BUNDLE_FORMAT_VERSION);
	});

	it("records an explicitly-supplied claude-code agentId", async () => {
		const result = await bundleSession({
			sessionId,
			cwd,
			outputDir: tmpDir,
			claudeDir: fakeClaude,
			agentId: "claude-code",
		});
		const meta = readMeta(result.bundlePath, path.join(tmpDir, "x-explicit"));
		expect(meta.agentId).toBe("claude-code");
	});

	it("refuses to bundle an unknown/unsupported agent", async () => {
		await expect(
			bundleSession({ sessionId, cwd, outputDir: tmpDir, claudeDir: fakeClaude, agentId: "bogus-agent" }),
		).rejects.toThrow(/unknown agent|unsupported agent/i);
	});

	it("restores a legacy bundle (meta.json without agentId) as claude-code", async () => {
		// Build a normal bundle, strip agentId/formatVersion from its meta.json, re-pack.
		const result = await bundleSession({ sessionId, cwd, outputDir: tmpDir, claudeDir: fakeClaude });
		const staging = path.join(tmpDir, "legacy-staging");
		fs.mkdirSync(staging, { recursive: true });
		await tar.extract({ file: result.bundlePath, cwd: staging });
		const metaPath = path.join(staging, "meta.json");
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
		// biome-ignore lint/performance/noDelete: forging a legacy bundle shape in a test
		delete meta.agentId;
		// biome-ignore lint/performance/noDelete: forging a legacy bundle shape in a test
		delete meta.formatVersion;
		fs.writeFileSync(metaPath, JSON.stringify(meta));
		const legacyBundle = path.join(tmpDir, "legacy.tar.gz");
		await repack(staging, legacyBundle);

		const targetHome = path.join(tmpDir, "target");
		const targetClaude = path.join(targetHome, ".claude");
		fs.mkdirSync(targetHome, { recursive: true });

		const out = await unbundleSession({
			bundlePath: legacyBundle,
			targetUserDir: targetHome,
			claudeDir: targetClaude,
		});

		expect(out.sessionId).toBe(sessionId);
		expect(out.resumeCommand).toContain("claude --resume");
		expect(fs.existsSync(out.installedTo)).toBe(true);
	});

	it("refuses to restore a bundle whose meta.json names an unknown agent", async () => {
		const result = await bundleSession({ sessionId, cwd, outputDir: tmpDir, claudeDir: fakeClaude });
		const staging = path.join(tmpDir, "bogus-staging");
		fs.mkdirSync(staging, { recursive: true });
		await tar.extract({ file: result.bundlePath, cwd: staging });
		const metaPath = path.join(staging, "meta.json");
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
		meta.agentId = "bogus-agent";
		fs.writeFileSync(metaPath, JSON.stringify(meta));
		const bogusBundle = path.join(tmpDir, "bogus.tar.gz");
		await repack(staging, bogusBundle);

		await expect(unbundleSession({ bundlePath: bogusBundle, targetUserDir: path.join(tmpDir, "t2") })).rejects.toThrow(
			/unknown agent|unsupported agent/i,
		);
	});
});
