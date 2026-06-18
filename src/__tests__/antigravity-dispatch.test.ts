import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundleSession } from "../core/bundle";
import { openDb } from "../core/sqlite";
import { unbundleSession } from "../core/unbundle";

const ID = "3ef64ae0-f6d4-4994-a53d-abe056f6cb6f";

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

/** bundleSession/unbundleSession must route agentId=antigravity to the adapter. */
describe("Antigravity dispatch via public API", () => {
	it("bundles + restores an antigravity conversation through the dispatchers", async () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-disp-"));
		try {
			const srcCwd = "/Users/alice/app";
			const gemDir = path.join(tmp, "src", "antigravity-cli");
			fs.mkdirSync(path.join(gemDir, "conversations"), { recursive: true });
			const db = openDb(path.join(gemDir, "conversations", `${ID}.db`));
			db.exec("create table trajectory_metadata_blob(id text, data blob)");
			db.run("insert into trajectory_metadata_blob(id,data) values('main', ?)", pbString(`file://${srcCwd}/x.ts`));
			db.close();
			fs.writeFileSync(
				path.join(gemDir, "history.jsonl"),
				JSON.stringify({ timestamp: 1781000000000, workspace: srcCwd, conversationId: ID }),
			);

			const out = path.join(tmp, "out");
			fs.mkdirSync(out, { recursive: true });
			const bundle = await bundleSession({
				sessionId: ID,
				cwd: srcCwd,
				outputDir: out,
				geminiDir: gemDir,
				sourceUserDir: "/Users/alice",
				agentId: "antigravity",
			});
			expect(bundle.metadata.agentId).toBe("antigravity");

			const tgtUser = path.join(tmp, "bob");
			const tgtGem = path.join(tgtUser, ".gemini", "antigravity-cli");
			const res = await unbundleSession({ bundlePath: bundle.bundlePath, targetUserDir: tgtUser, geminiDir: tgtGem });
			expect(res.resumeCommand).toBe(`agy --conversation ${ID}`);

			const vdb = openDb(res.installedTo, { readOnly: true });
			const row = vdb.get<{ data: Buffer }>("select data from trajectory_metadata_blob where id='main'");
			vdb.close();
			const blob = Buffer.from(row?.data as Buffer).toString("latin1");
			expect(blob).not.toContain("/Users/alice");
			// file:// URIs stay forward-slash on every OS.
			expect(blob).toContain(`file://${tgtUser.replace(/\\/g, "/")}/app/x.ts`);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
