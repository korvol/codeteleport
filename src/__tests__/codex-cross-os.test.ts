import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unbundleCodexSession } from "../core/agents/codex/unbundle";
import { openDb } from "../core/sqlite";

const SID = "019ed8ca-db3b-7870-b1ae-9511f710f77c";

/**
 * Host-independent Codex cross-OS restore: a Windows-authored rollout + thread row
 * restored onto a POSIX target. Source/target styles are pinned (not host-derived),
 * so this asserts real separator translation on Windows AND on the POSIX CI runner.
 */
describe("Codex cross-OS restore (host-independent)", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-xos-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("Windows Codex session → POSIX target: rollout + thread row + sandbox_policy translated", () => {
		const sourceUserDir = "C:\\Users\\winuser";
		const sourceCwd = "C:\\Users\\winuser\\workspace\\app";

		const stagingDir = fs.mkdtempSync(path.join(tmp, "stg-"));
		const rolloutRelPath = path.join("sessions", "2026", "06", "18", `rollout-${SID}.jsonl`);
		const meta = {
			sessionId: SID,
			sourceCwd,
			sourceUserDir,
			agentId: "codex",
			rolloutRelPath,
			rolloutFileName: `rollout-${SID}.jsonl`,
		};
		fs.writeFileSync(path.join(stagingDir, "meta.json"), JSON.stringify(meta));
		fs.writeFileSync(
			path.join(stagingDir, "session.jsonl"),
			[
				{ type: "session_meta", payload: { id: SID, cwd: sourceCwd } },
				{
					type: "response_item",
					payload: {
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: `edit ${sourceCwd}\\src\\x.ts` }],
					},
				},
			]
				.map((l) => JSON.stringify(l))
				.join("\n"),
		);
		fs.writeFileSync(
			path.join(stagingDir, "codex-state.json"),
			JSON.stringify({
				threadRow: {
					id: SID,
					cwd: sourceCwd,
					title: "win chat",
					sandbox_policy: JSON.stringify({ writable_roots: [sourceCwd] }),
				},
				dynamicTools: [],
			}),
		);

		const tgtUser = "/Users/bob";
		const tgtCodex = path.join(tmp, "tgt", ".codex");
		fs.mkdirSync(tgtCodex, { recursive: true });
		const tdb = openDb(path.join(tgtCodex, "state_5.sqlite"));
		tdb.exec("create table threads(id text primary key, cwd text, title text, sandbox_policy text)");
		tdb.close();

		const result = unbundleCodexSession({
			stagingDir,
			meta,
			options: { bundlePath: "", targetUserDir: tgtUser, codexDir: tgtCodex },
		});

		// Rollout transcript: every Windows separator became POSIX, valid JSON throughout.
		const rollout = fs.readFileSync(result.installedTo, "utf-8");
		expect(rollout.includes("\\")).toBe(false);
		expect(rollout).not.toContain("winuser");
		const lines = rollout
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines[0].payload.cwd).toBe("/Users/bob/workspace/app");
		expect(lines[1].payload.content[0].text).toBe("edit /Users/bob/workspace/app/src/x.ts");

		// Thread inventory row: cwd forced to target, sandbox_policy still valid JSON.
		const db = openDb(path.join(tgtCodex, "state_5.sqlite"), { readOnly: true });
		const row = db.get<Record<string, unknown>>("select * from threads where id=?", SID);
		db.close();
		expect(row?.cwd).toBe("/Users/bob/workspace/app");
		expect(String(row?.sandbox_policy)).not.toContain("winuser");
		const sandbox = JSON.parse(String(row?.sandbox_policy));
		expect(sandbox.writable_roots[0]).toBe("/Users/bob/workspace/app");
	});
});
