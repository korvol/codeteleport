import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UnbundleOptions, UnbundleResult } from "../../../shared/types";
import { detectHomeDirSafe, rewritePathValue, rewritePaths } from "../../paths";
import { type Db, openDb } from "../../sqlite";
import { codexDirDefault } from "./local";

export interface CodexUnbundleArgs {
	/** Directory the bundle was already extracted into (contains meta/session.jsonl/codex-state.json). */
	stagingDir: string;
	meta: Record<string, unknown>;
	options: UnbundleOptions;
}

type SqlValue = string | number | bigint | null;

function toSqlValue(v: unknown): SqlValue {
	if (v === null || v === undefined) return null;
	if (typeof v === "number" || typeof v === "bigint") return v;
	if (typeof v === "boolean") return v ? 1 : 0;
	if (typeof v === "string") return v;
	return JSON.stringify(v);
}

/** Upsert the threads row, writing only columns that exist in the (possibly evolved) schema. */
function upsertThread(db: Db, values: Record<string, unknown>): void {
	const cols = db.columns("threads");
	if (cols.length === 0) return;
	const insertCols = Object.keys(values).filter((c) => cols.includes(c));
	if (!insertCols.includes("id")) return;
	const updateCols = insertCols.filter((c) => c !== "id");
	const placeholders = insertCols.map(() => "?").join(", ");
	const sql =
		`insert into threads (${insertCols.join(", ")}) values (${placeholders}) ` +
		`on conflict(id) do update set ${updateCols.map((c) => `${c} = excluded.${c}`).join(", ")}`;
	db.run(sql, ...insertCols.map((c) => toSqlValue(values[c])));
}

function restoreDynamicTools(db: Db, sessionId: string, tools: Record<string, unknown>[]): void {
	if (db.columns("thread_dynamic_tools").length === 0) return;
	db.run("delete from thread_dynamic_tools where thread_id = ?", sessionId);
	for (const tool of tools) {
		const row = { ...tool, thread_id: sessionId };
		const cols = db.columns("thread_dynamic_tools").filter((c) => c in row);
		if (cols.length === 0) continue;
		const placeholders = cols.map(() => "?").join(", ");
		db.run(
			`insert into thread_dynamic_tools (${cols.join(", ")}) values (${placeholders})`,
			...cols.map((c) => toSqlValue((row as Record<string, unknown>)[c])),
		);
	}
}

/** Install a Codex session from an already-extracted bundle staging dir. */
export function unbundleCodexSession(args: CodexUnbundleArgs): UnbundleResult {
	const { stagingDir, meta, options } = args;
	const sessionId = String(meta.sessionId);
	const sourceCwd = String(meta.sourceCwd ?? "");
	const sourceUserDir = String(meta.sourceUserDir ?? detectHomeDirSafe(sourceCwd));

	// Resolve target paths (mirror of the Claude resolver, but anchored at ~/.codex).
	let targetUserDir: string;
	let targetCodexHome: string;
	let targetCwd: string;
	if (options.targetDir) {
		targetUserDir =
			options.targetUserDir ??
			(options.codexDir ? path.dirname(options.codexDir) : detectHomeDirSafe(options.targetDir));
		targetCodexHome = options.codexDir ?? path.join(targetUserDir, ".codex");
		targetCwd = options.targetDir;
	} else {
		targetUserDir = options.targetUserDir ?? os.homedir();
		targetCodexHome = options.codexDir ?? path.join(targetUserDir, ".codex");
		targetCwd = rewritePathValue(sourceCwd, sourceUserDir, targetUserDir);
	}

	const rewrittenSourceCwd = rewritePathValue(sourceCwd, sourceUserDir, targetUserDir);
	const rewriteContent = (content: string, jsonEscaped: boolean): string => {
		let r = content;
		if (sourceUserDir !== targetUserDir) r = rewritePaths(r, sourceUserDir, targetUserDir, { jsonEscaped });
		if (rewrittenSourceCwd !== targetCwd) r = rewritePaths(r, rewrittenSourceCwd, targetCwd, { jsonEscaped });
		return r;
	};
	// A SQLite string value: rewrite JSON-document values (e.g. sandbox_policy,
	// writable_roots) as escaped so they stay valid JSON; plain scalar paths (cwd,
	// rollout_path) as raw single-separator.
	const rewriteValue = (v: string): string => {
		const t = v.trimStart();
		return rewriteContent(v, t.startsWith("{") || t.startsWith("["));
	};

	// 1. Write the rollout transcript at its target location, paths rewritten.
	const rolloutRel =
		(meta.rolloutRelPath as string) ||
		path.join("sessions", "imported", String(meta.rolloutFileName || `${sessionId}.jsonl`));
	const rolloutPath = path.join(targetCodexHome, rolloutRel);
	fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
	const sourceJsonl = fs.readFileSync(path.join(stagingDir, "session.jsonl"), "utf-8");
	fs.writeFileSync(rolloutPath, rewriteContent(sourceJsonl, true));

	// 2. Update Codex's local thread inventory (state_5.sqlite) if present.
	let codexStateApplied = false;
	const dbPath = path.join(targetCodexHome, "state_5.sqlite");
	if (fs.existsSync(dbPath)) {
		const statePath = path.join(stagingDir, "codex-state.json");
		const state: { threadRow: Record<string, unknown> | null; dynamicTools: Record<string, unknown>[] } = fs.existsSync(
			statePath,
		)
			? JSON.parse(fs.readFileSync(statePath, "utf-8"))
			: { threadRow: null, dynamicTools: [] };

		// Start from the source row (string values path-rewritten), then force the
		// machine-specific fields to the target.
		const base: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(state.threadRow ?? {})) {
			base[k] = typeof v === "string" ? rewriteValue(v) : v;
		}
		const values: Record<string, unknown> = {
			source: "cli",
			model_provider: "openai",
			title: state.threadRow?.title ?? "Imported Codex chat",
			...base,
			id: sessionId,
			cwd: targetCwd,
			rollout_path: rolloutPath,
		};

		let db: Db | undefined;
		try {
			db = openDb(dbPath);
			upsertThread(db, values);
			restoreDynamicTools(db, sessionId, state.dynamicTools ?? []);
			codexStateApplied = true;
		} finally {
			db?.close();
		}
	}

	const prefix = options.resumeCommandPrefix || "codex resume";
	return {
		sessionId,
		installedTo: rolloutPath,
		resumeCommand: `${prefix} ${sessionId}`,
		codexStateApplied,
	};
}

export { codexDirDefault };
