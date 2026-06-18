import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleSession } from "../core/bundle";
import { encodePath } from "../core/paths";
import { openDb } from "../core/sqlite";
import { unbundleSession } from "../core/unbundle";

/** End-to-end: pull (unbundle) with convertTo turns a Claude bundle into a Codex session. */
describe("unbundleSession --convertTo (Model A conversion on pull)", () => {
	let tmp: string;
	const sessionId = "conv-pull-001";
	const sourceCwd = "/Users/alice/proj";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conv-pull-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("converts a Claude bundle to a Codex session on install", async () => {
		// Build a Claude bundle.
		const srcClaude = path.join(tmp, "src", ".claude");
		const projDir = path.join(srcClaude, "projects", encodePath(sourceCwd));
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(
			path.join(projDir, `${sessionId}.jsonl`),
			[
				JSON.stringify({ type: "user", cwd: sourceCwd, message: { content: "convert me" } }),
				JSON.stringify({ type: "assistant", message: { content: "converted" } }),
			].join("\n"),
		);
		const bundle = await bundleSession({
			sessionId,
			cwd: sourceCwd,
			outputDir: tmp,
			claudeDir: srcClaude,
			sourceUserDir: "/Users/alice",
		});

		// Target machine with a Codex home (state DB present, as after running Codex once).
		const tgtUser = path.join(tmp, "bob");
		const tgtCodex = path.join(tgtUser, ".codex");
		fs.mkdirSync(tgtCodex, { recursive: true });
		const db = openDb(path.join(tgtCodex, "state_5.sqlite"));
		db.exec("create table threads(id text primary key, cwd text, rollout_path text)");
		db.close();

		const result = await unbundleSession({
			bundlePath: bundle.bundlePath,
			targetDir: path.join(tgtUser, "proj"),
			targetUserDir: tgtUser,
			codexDir: tgtCodex,
			convertTo: "codex",
		});

		expect(result.resumeCommand).toBe(`codex resume ${result.sessionId}`);
		expect(result.sessionId).not.toBe(sessionId); // a fresh Codex session id
		const text = fs.readFileSync(result.installedTo, "utf-8");
		expect(text).toContain('"user_message"');
		expect(text).toContain("convert me");
		expect(text).toContain("converted");
	});

	it("refuses to convert to antigravity", async () => {
		const srcClaude = path.join(tmp, "src2", ".claude");
		const projDir = path.join(srcClaude, "projects", encodePath(sourceCwd));
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(
			path.join(projDir, `${sessionId}.jsonl`),
			JSON.stringify({ type: "user", cwd: sourceCwd, message: { content: "x" } }),
		);
		const bundle = await bundleSession({
			sessionId,
			cwd: sourceCwd,
			outputDir: tmp,
			claudeDir: srcClaude,
			sourceUserDir: "/Users/alice",
		});

		await expect(
			unbundleSession({ bundlePath: bundle.bundlePath, targetUserDir: path.join(tmp, "t"), convertTo: "antigravity" }),
		).rejects.toThrow(/cannot convert|antigravity/i);
	});
});
