import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UnbundleOptions, UnbundleResult } from "../../../shared/types";
import { detectHomeDirSafe, rewritePathValue, rewritePaths } from "../../paths";
import { type Db, openDb } from "../../sqlite";
import { antigravityDirDefault } from "./local";
import { rewritePathLeaf, rewriteProtobuf } from "./protobuf";

export interface AntigravityUnbundleArgs {
	stagingDir: string;
	meta: Record<string, unknown>;
	options: UnbundleOptions;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;
const TEXT_EXTS = new Set([".jsonl", ".md", ".txt", ".json", ".sh", ".log"]);

/** Rewrite a protobuf blob; on a non-protobuf blob fall back to a binary-safe string replace. */
function rewriteBlob(buf: Buffer, from: string, to: string): Buffer {
	if (!from || from === to) return buf;
	try {
		return rewriteProtobuf(buf, from, to);
	} catch {
		const s = buf.toString("latin1");
		const out = rewritePathLeaf(s, from, to);
		return out === s ? buf : Buffer.from(out, "latin1");
	}
}

function tableNames(db: Db): string[] {
	return db
		.all<{ name: string }>("select name from sqlite_master where type = 'table'")
		.map((r) => r.name)
		.filter((n) => SAFE_IDENTIFIER.test(n));
}

function blobColumns(db: Db, table: string): string[] {
	return db
		.all<{ name: string; type: string }>(`pragma table_info(${table})`)
		.filter((c) => String(c.type).toUpperCase() === "BLOB")
		.map((c) => c.name)
		.filter((n) => SAFE_IDENTIFIER.test(n));
}

/** Rewrite every path-bearing BLOB column across the whole conversation DB. */
function rewriteAllBlobs(dbPath: string, apply: (buf: Buffer) => Buffer): void {
	const db = openDb(dbPath);
	try {
		for (const table of tableNames(db)) {
			const cols = blobColumns(db, table);
			if (cols.length === 0) continue;
			const rows = db.all<Record<string, unknown>>(`select rowid as _rowid, ${cols.join(", ")} from ${table}`);
			for (const row of rows) {
				for (const col of cols) {
					const value = row[col];
					if (!Buffer.isBuffer(value)) continue;
					const rewritten = apply(value);
					if (!rewritten.equals(value)) {
						db.run(`update ${table} set ${col} = ? where rowid = ?`, rewritten, row._rowid as number);
					}
				}
			}
		}
	} finally {
		db.close();
	}
}

const JSON_EXTS = new Set([".jsonl", ".json"]);

function copyTreeRewritingText(src: string, dst: string, rewrite: (s: string, jsonEscaped: boolean) => string): void {
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const s = path.join(src, entry.name);
		const d = path.join(dst, entry.name);
		const ext = path.extname(entry.name).toLowerCase();
		if (entry.isDirectory()) {
			fs.mkdirSync(d, { recursive: true });
			copyTreeRewritingText(s, d, rewrite);
		} else if (TEXT_EXTS.has(ext)) {
			fs.writeFileSync(d, rewrite(fs.readFileSync(s, "utf-8"), JSON_EXTS.has(ext)));
		} else {
			fs.copyFileSync(s, d);
		}
	}
}

/** Install an Antigravity conversation from an already-extracted bundle staging dir. */
export function unbundleAntigravitySession(args: AntigravityUnbundleArgs): UnbundleResult {
	const { stagingDir, meta, options } = args;
	const sessionId = String(meta.sessionId);
	const sourceCwd = String(meta.sourceCwd ?? "");
	const sourceUserDir = String(meta.sourceUserDir ?? detectHomeDirSafe(sourceCwd));

	let targetUserDir: string;
	let targetGeminiHome: string;
	let targetCwd: string;
	const defaultHome = (user: string) => path.join(user, ".gemini", "antigravity-cli");
	if (options.targetDir) {
		targetUserDir =
			options.targetUserDir ??
			(options.geminiDir ? detectHomeDirSafe(options.geminiDir) : detectHomeDirSafe(options.targetDir));
		targetGeminiHome = options.geminiDir ?? defaultHome(targetUserDir);
		targetCwd = options.targetDir;
	} else {
		targetUserDir = options.targetUserDir ?? os.homedir();
		targetGeminiHome = options.geminiDir ?? defaultHome(targetUserDir);
		targetCwd = rewritePathValue(sourceCwd, sourceUserDir, targetUserDir);
	}

	const rewrittenSourceCwd = rewritePathValue(sourceCwd, sourceUserDir, targetUserDir);
	const rewriteText = (content: string, jsonEscaped: boolean): string => {
		let r = content;
		if (sourceUserDir !== targetUserDir) r = rewritePaths(r, sourceUserDir, targetUserDir, { jsonEscaped });
		if (rewrittenSourceCwd !== targetCwd) r = rewritePaths(r, rewrittenSourceCwd, targetCwd, { jsonEscaped });
		return r;
	};
	const rewriteBytes = (buf: Buffer): Buffer => {
		let b = buf;
		if (sourceUserDir !== targetUserDir) b = rewriteBlob(b, sourceUserDir, targetUserDir);
		if (rewrittenSourceCwd !== targetCwd) b = rewriteBlob(b, rewrittenSourceCwd, targetCwd);
		return b;
	};

	// 1. Rewrite all protobuf blobs in the conversation DB (in staging), then install it.
	const stagedDb = path.join(stagingDir, "session.db");
	rewriteAllBlobs(stagedDb, rewriteBytes);
	const targetDbPath = path.join(targetGeminiHome, "conversations", `${sessionId}.db`);
	fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
	fs.copyFileSync(stagedDb, targetDbPath);

	// 2. Restore the brain folder, rewriting text files.
	const brainSrc = path.join(stagingDir, "brain");
	if (fs.existsSync(brainSrc)) {
		const brainDst = path.join(targetGeminiHome, "brain", sessionId);
		fs.mkdirSync(brainDst, { recursive: true });
		copyTreeRewritingText(brainSrc, brainDst, rewriteText);
	}

	const prefix = options.resumeCommandPrefix || "agy --conversation";
	return {
		sessionId,
		installedTo: targetDbPath,
		resumeCommand: `${prefix} ${sessionId}`,
	};
}
