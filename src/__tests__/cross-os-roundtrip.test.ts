import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unbundleSession } from "../core/unbundle";

/**
 * Cross-OS teleport is the whole point: a chat authored on one operating system
 * must restore cleanly on another. These tests are HOST-INDEPENDENT — they assert
 * the same translated output whether they run on Windows or POSIX, because the
 * source and target path styles are pinned explicitly (not derived from the host).
 */

async function buildBundle(tmpRoot: string, meta: object, jsonlLines: object[]): Promise<string> {
	const staging = fs.mkdtempSync(path.join(tmpRoot, "stg-"));
	fs.writeFileSync(path.join(staging, "meta.json"), JSON.stringify(meta));
	fs.writeFileSync(path.join(staging, "session.jsonl"), jsonlLines.map((l) => JSON.stringify(l)).join("\n"));
	const bundlePath = path.join(tmpRoot, `bundle-${path.basename(staging)}.tar.gz`);
	await tar.create({ gzip: true, file: bundlePath, cwd: staging }, fs.readdirSync(staging));
	return bundlePath;
}

describe("Cross-OS round-trip (host-independent)", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xos-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("Windows session → macOS/Linux target: paths fully translated to POSIX", async () => {
		const sessionId = "xos-win-to-posix";
		const sourceUserDir = "C:\\Users\\winuser";
		const sourceCwd = "C:\\Users\\winuser\\projects\\app";
		const bundlePath = await buildBundle(tmp, { sessionId, sourceCwd, sourceUserDir }, [
			{ type: "user", cwd: sourceCwd, message: { content: `edit ${sourceCwd}\\src\\index.ts then run` } },
			{
				type: "assistant",
				cwd: sourceCwd,
				toolCalls: [{ name: "Edit", input: { file_path: `${sourceCwd}\\src\\index.ts` } }],
			},
		]);

		const result = await unbundleSession({
			bundlePath,
			targetUserDir: "/Users/bob",
			claudeDir: path.join(tmp, "target", ".claude"),
		});

		const installed = fs.readFileSync(path.join(result.installedTo, `${sessionId}.jsonl`), "utf-8");
		// No Windows artifacts survive — every separator became POSIX.
		expect(installed.includes("\\")).toBe(false);
		expect(installed).not.toContain("winuser");
		const lines = installed
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines[0].cwd).toBe("/Users/bob/projects/app");
		expect(lines[0].message.content).toBe("edit /Users/bob/projects/app/src/index.ts then run");
		expect(lines[1].toolCalls[0].input.file_path).toBe("/Users/bob/projects/app/src/index.ts");
	});

	it("macOS/Linux session → Windows target: paths fully translated to Windows", async () => {
		const sessionId = "xos-posix-to-win";
		const sourceUserDir = "/Users/alice";
		const sourceCwd = "/Users/alice/projects/app";
		const bundlePath = await buildBundle(tmp, { sessionId, sourceCwd, sourceUserDir }, [
			{ type: "user", cwd: sourceCwd, message: { content: `edit ${sourceCwd}/src/index.ts then run` } },
			{
				type: "assistant",
				cwd: sourceCwd,
				toolCalls: [{ name: "Edit", input: { file_path: `${sourceCwd}/src/index.ts` } }],
			},
		]);

		const result = await unbundleSession({
			bundlePath,
			targetUserDir: "C:\\Users\\winuser",
			claudeDir: path.join(tmp, "target", ".claude"),
		});

		const installed = fs.readFileSync(path.join(result.installedTo, `${sessionId}.jsonl`), "utf-8");
		expect(installed).not.toContain("/Users/alice");
		expect(installed).not.toContain("/projects/app");
		// The file is still valid JSON (Windows backslashes are properly escaped) and
		// decodes to native Windows paths.
		const lines = installed
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines[0].cwd).toBe("C:\\Users\\winuser\\projects\\app");
		expect(lines[0].message.content).toBe("edit C:\\Users\\winuser\\projects\\app\\src\\index.ts then run");
		expect(lines[1].toolCalls[0].input.file_path).toBe("C:\\Users\\winuser\\projects\\app\\src\\index.ts");
	});

	it("off-home project (different drive) cross-OS via --target-dir is fully translated", async () => {
		const sessionId = "xos-offhome";
		// Home on C:, but the project lives on D: — outside the home dir.
		const sourceUserDir = "C:\\Users\\alice";
		const sourceCwd = "D:\\projects\\app";
		const bundlePath = await buildBundle(tmp, { sessionId, sourceCwd, sourceUserDir }, [
			{ type: "user", cwd: sourceCwd, message: { content: `edit ${sourceCwd}\\src\\x.ts` } },
		]);

		// targetDir anchors the off-home project explicitly (the documented escape hatch).
		const result = await unbundleSession({
			bundlePath,
			targetDir: "/Users/bob/work/app",
			claudeDir: path.join(tmp, "target", ".claude"),
		});

		const installed = fs.readFileSync(path.join(result.installedTo, `${sessionId}.jsonl`), "utf-8");
		expect(installed.includes("\\")).toBe(false);
		expect(installed).not.toContain("D:");
		const first = JSON.parse(installed.trim().split("\n")[0]);
		expect(first.cwd).toBe("/Users/bob/work/app");
		expect(first.message.content).toBe("edit /Users/bob/work/app/src/x.ts");
	});

	it("Windows → Windows (different user): backslashes preserved, user relocated", async () => {
		const sessionId = "xos-win-to-win";
		const sourceUserDir = "C:\\Users\\alice";
		const sourceCwd = "C:\\Users\\alice\\dev\\proj";
		const bundlePath = await buildBundle(tmp, { sessionId, sourceCwd, sourceUserDir }, [
			{ type: "user", cwd: sourceCwd, message: { content: `see ${sourceCwd}\\a.ts` } },
		]);

		const result = await unbundleSession({
			bundlePath,
			targetUserDir: "D:\\Users\\bob",
			claudeDir: path.join(tmp, "target", ".claude"),
		});

		const installed = fs.readFileSync(path.join(result.installedTo, `${sessionId}.jsonl`), "utf-8");
		expect(installed).not.toContain("alice");
		const first = JSON.parse(installed.trim().split("\n")[0]);
		expect(first.cwd).toBe("D:\\Users\\bob\\dev\\proj");
		expect(first.message.content).toBe("see D:\\Users\\bob\\dev\\proj\\a.ts");
	});
});
