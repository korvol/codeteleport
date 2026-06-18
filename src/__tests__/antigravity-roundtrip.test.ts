import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleAntigravitySession } from "../core/agents/antigravity/bundle";
import { scanAntigravityLocalSessions, scanAntigravityProjectSessions } from "../core/agents/antigravity/local";
import { unbundleAntigravitySession } from "../core/agents/antigravity/unbundle";
import { openDb } from "../core/sqlite";

const ID = "3ef64ae0-f6d4-4994-a53d-abe056f6cb6f";

// minimal protobuf string-field encoder (wire type 2, field 1)
function vEnc(n: number): Buffer {
	const b: number[] = [];
	let t = n;
	while (t >= 0x80) {
		b.push((t & 0x7f) | 0x80);
		t >>>= 7;
	}
	b.push(t);
	return Buffer.from(b);
}
function pbString(s: string): Buffer {
	const v = Buffer.from(s, "utf8");
	return Buffer.concat([vEnc((1 << 3) | 2), vEnc(v.length), v]);
}

function blobLatin1(dbPath: string, table: string, col: string): string {
	const db = openDb(dbPath, { readOnly: true });
	const row = db.get<Record<string, unknown>>(`select ${col} from ${table} limit 1`);
	db.close();
	return Buffer.from(row?.[col] as Buffer).toString("latin1");
}

describe("Antigravity bundle → unbundle round-trip", () => {
	let tmp: string;
	const srcUser = "/Users/alice";
	const srcCwd = "/Users/alice/workspace/app";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-rt-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("rewrites protobuf blobs across tables + brain text, cross-user", async () => {
		const gemDir = path.join(tmp, "src", "antigravity-cli");
		const conv = path.join(gemDir, "conversations");
		fs.mkdirSync(conv, { recursive: true });
		const db = openDb(path.join(conv, `${ID}.db`));
		db.exec("create table trajectory_metadata_blob(id text, data blob)");
		db.run("insert into trajectory_metadata_blob(id,data) values('main', ?)", pbString(`file://${srcCwd}/main.ts`));
		db.exec("create table steps(idx integer primary key, step_payload blob)");
		db.run("insert into steps(idx,step_payload) values(1, ?)", pbString(`${srcCwd}/lib/util.ts`));
		// a non-blob table + a non-protobuf blob (must survive untouched/!crash)
		db.exec("create table executor_metadata(idx integer, data blob)");
		db.run("insert into executor_metadata(idx,data) values(1, ?)", pbString(srcUser));
		db.close();

		// brain folder with a transcript that embeds a source path
		const logs = path.join(gemDir, "brain", ID, ".system_generated", "logs");
		fs.mkdirSync(logs, { recursive: true });
		fs.writeFileSync(
			path.join(logs, "transcript.jsonl"),
			JSON.stringify({ type: "USER_INPUT", content: `open ${srcCwd}/main.ts` }),
		);
		fs.writeFileSync(
			path.join(gemDir, "history.jsonl"),
			JSON.stringify({ display: "hi", timestamp: 1781000000000, workspace: srcCwd, conversationId: ID }),
		);

		// BUNDLE
		const out = path.join(tmp, "out");
		fs.mkdirSync(out, { recursive: true });
		const bundle = await bundleAntigravitySession({
			sessionId: ID,
			cwd: srcCwd,
			outputDir: out,
			geminiDir: gemDir,
			sourceUserDir: srcUser,
			agentId: "antigravity",
		});
		expect(bundle.metadata.agentId).toBe("antigravity");

		const staging = path.join(tmp, "staging");
		fs.mkdirSync(staging, { recursive: true });
		await tar.extract({ file: bundle.bundlePath, cwd: staging });
		const meta = JSON.parse(fs.readFileSync(path.join(staging, "meta.json"), "utf-8"));

		// UNBUNDLE (target = /Users/bob-equivalent under tmp)
		const tgtUser = path.join(tmp, "bob");
		const tgtGem = path.join(tgtUser, ".gemini", "antigravity-cli");
		const result = unbundleAntigravitySession({
			stagingDir: staging,
			meta,
			options: { bundlePath: "", targetUserDir: tgtUser, geminiDir: tgtGem },
		});

		expect(result.resumeCommand).toBe(`agy --conversation ${ID}`);
		const tgtDb = path.join(tgtGem, "conversations", `${ID}.db`);
		expect(result.installedTo).toBe(tgtDb);

		const tgtCwd = path.join(tgtUser, "workspace", "app");
		// trajectory blob holds a file:// URI — URIs stay forward-slash on every OS.
		const meta1 = blobLatin1(tgtDb, "trajectory_metadata_blob", "data");
		expect(meta1).not.toContain("/Users/alice");
		expect(meta1).toContain(`file://${tgtCwd.replace(/\\/g, "/")}/main.ts`);

		// steps blob holds a native filesystem path — separators are host-native.
		const step1 = blobLatin1(tgtDb, "steps", "step_payload");
		expect(step1).not.toContain("/Users/alice");
		expect(step1).toContain(path.join(tgtCwd, "lib", "util.ts"));

		const exec1 = blobLatin1(tgtDb, "executor_metadata", "data");
		expect(exec1).toContain(tgtUser); // /Users/alice -> tgtUser

		const brain = fs.readFileSync(
			path.join(tgtGem, "brain", ID, ".system_generated", "logs", "transcript.jsonl"),
			"utf-8",
		);
		expect(brain).not.toContain("/Users/alice");
		expect(JSON.parse(brain.trim()).content).toContain(path.join(tgtCwd, "main.ts"));
	});

	it("workspaceFromBlob extracts a Windows file:// path without a spurious leading slash", () => {
		const wtmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-ws-"));
		try {
			const id = "11111111-2222-3333-4444-555555555555";
			const conv = path.join(wtmp, "conversations");
			fs.mkdirSync(conv, { recursive: true });
			const db = openDb(path.join(conv, `${id}.db`));
			db.exec("create table trajectory_metadata_blob(id text, data blob)");
			db.run(
				"insert into trajectory_metadata_blob(id,data) values('main', ?)",
				pbString("file:///C:/Users/winuser/proj"),
			);
			db.close();
			// No history.jsonl, so the workspace is recovered from the protobuf blob.
			const sessions = scanAntigravityLocalSessions(wtmp);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].projectPath).toBe("C:/Users/winuser/proj"); // not "/C:/Users/..."
			expect(sessions[0].projectName).toBe("proj");
			// push --session-id filters by project cwd: the native (backslash) cwd must
			// match the forward-slash projectPath recovered from the file:// blob.
			expect(scanAntigravityProjectSessions("C:\\Users\\winuser\\proj", wtmp)).toHaveLength(1);
		} finally {
			fs.rmSync(wtmp, { recursive: true, force: true });
		}
	});
});
