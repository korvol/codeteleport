import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../core/sqlite";

/**
 * Thin wrapper over node:sqlite (chosen backend). Codex restore upserts the
 * `threads` row and needs dynamic column introspection because Codex's schema
 * may evolve; Antigravity needs BLOB read/write. The wrapper must also read
 * BLOBs back as Buffers (node:sqlite hands them out as Uint8Array).
 */
describe("sqlite wrapper", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-test-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("opens a file db, writes, reads, and introspects columns", () => {
		const db = openDb(path.join(tmp, "t.sqlite"));
		db.exec("create table threads(id text primary key, cwd text, n integer)");
		db.run("insert into threads(id,cwd,n) values(?,?,?)", "a", "/x", 1);

		expect(db.columns("threads")).toEqual(["id", "cwd", "n"]);
		expect(db.get("select cwd from threads where id=?", "a")?.cwd).toBe("/x");
		expect(db.all("select * from threads")).toHaveLength(1);
		db.close();
	});

	it("returns [] from columns() for a missing table", () => {
		const db = openDb(path.join(tmp, "t.sqlite"));
		expect(db.columns("nope")).toEqual([]);
		db.close();
	});

	it("rejects an unsafe table identifier in columns()", () => {
		const db = openDb(path.join(tmp, "t.sqlite"));
		expect(() => db.columns("threads; drop table threads")).toThrow();
		db.close();
	});

	it("round-trips a BLOB and returns it as a Buffer", () => {
		const db = openDb(path.join(tmp, "blob.sqlite"));
		db.exec("create table b(id integer primary key, data blob)");
		const payload = Buffer.from([0x08, 0x96, 0x01, 0xff, 0x00]);
		db.run("insert into b(id,data) values(?,?)", 1, payload);

		const row = db.get<{ data: Buffer }>("select data from b where id=1");
		expect(Buffer.isBuffer(row?.data)).toBe(true);
		expect((row as { data: Buffer }).data.equals(payload)).toBe(true);
		db.close();
	});
});
