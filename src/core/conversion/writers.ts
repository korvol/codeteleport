import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { rewriteProtobuf } from "../agents/antigravity/protobuf";
import { encodePath } from "../paths";
import { type Db, openDb } from "../sqlite";
import { ANTIGRAVITY_SCHEMA, STEP_STATUS_DONE, STEP_TYPE, TEMPLATE, TEMPLATE_BLOBS } from "./antigravity-fixtures";
import type { CanonicalTranscript } from "./types";

export interface WriteResult {
	sessionId: string;
	installedTo: string;
	resumeCommand: string;
}

// ── Claude Code writer ──────────────────────────────────────────────────────

/** Best-effort version/gitBranch from any existing local Claude session. */
function claudeDefaults(claudeDir: string): { version: string; gitBranch: string } {
	const projects = path.join(claudeDir, "projects");
	try {
		for (const d of fs.readdirSync(projects)) {
			const dir = path.join(projects, d);
			if (!fs.statSync(dir).isDirectory()) continue;
			for (const f of fs.readdirSync(dir)) {
				if (!f.endsWith(".jsonl")) continue;
				const first = fs.readFileSync(path.join(dir, f), "utf-8").split("\n").find(Boolean);
				if (!first) continue;
				const o = JSON.parse(first);
				return { version: o.version || "2.0.0", gitBranch: o.gitBranch || "main" };
			}
		}
	} catch {}
	return { version: "2.0.0", gitBranch: "main" };
}

/** Convert a canonical transcript into a resumable Claude Code session JSONL. */
export function writeClaudeSession(
	transcript: CanonicalTranscript,
	opts: { claudeDir: string; cwd: string; version?: string; gitBranch?: string },
): WriteResult {
	const sessionId = crypto.randomUUID();
	const { cwd, claudeDir } = opts;
	const defaults = claudeDefaults(claudeDir);
	const version = opts.version ?? defaults.version;
	const gitBranch = opts.gitBranch ?? defaults.gitBranch;

	const projDir = path.join(claudeDir, "projects", encodePath(cwd));
	fs.mkdirSync(projDir, { recursive: true });
	const installedTo = path.join(projDir, `${sessionId}.jsonl`);

	let parentUuid: string | null = null;
	const lines: string[] = [];
	for (const m of transcript.messages) {
		const uuid = crypto.randomUUID();
		const base = {
			parentUuid,
			isSidechain: false,
			userType: "external",
			cwd,
			sessionId,
			version,
			gitBranch,
			uuid,
			timestamp: new Date().toISOString(),
		};
		if (m.role === "user") {
			lines.push(JSON.stringify({ ...base, type: "user", message: { role: "user", content: m.text } }));
		} else {
			lines.push(
				JSON.stringify({
					...base,
					type: "assistant",
					message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "text", text: m.text }] },
				}),
			);
		}
		parentUuid = uuid;
	}
	fs.writeFileSync(installedTo, `${lines.join("\n")}\n`);
	return { sessionId, installedTo, resumeCommand: `claude --resume ${sessionId}` };
}

// ── Codex writer ─────────────────────────────────────────────────────────────

function firstCodexRollout(codexDir: string): Record<string, unknown>[] | null {
	const base = path.join(codexDir, "sessions");
	if (!fs.existsSync(base)) return null;
	const walk = (d: string): string[] =>
		fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
			const ab = path.join(d, e.name);
			return e.isDirectory() ? walk(ab) : e.name.endsWith(".jsonl") ? [ab] : [];
		});
	const files = walk(base);
	if (!files.length) return null;
	try {
		return fs
			.readFileSync(files[0], "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));
	} catch {
		return null;
	}
}

/** session_meta + turn_context payloads — cloned from a real local rollout when present, else synthesized. */
function codexTemplates(
	codexDir: string,
	cwd: string,
): { meta: Record<string, unknown>; turn: Record<string, unknown> } {
	const tpl = firstCodexRollout(codexDir);
	const metaTpl = tpl?.find((l) => l.type === "session_meta")?.payload as Record<string, unknown> | undefined;
	const turnTpl = tpl?.find((l) => l.type === "turn_context")?.payload as Record<string, unknown> | undefined;
	const meta = {
		...(metaTpl ?? {
			originator: "codex-tui",
			cli_version: "0.140.0",
			source: "cli",
			thread_source: "user",
			model_provider: "openai",
		}),
		cwd,
	};
	const turn = {
		...(turnTpl ?? {
			approval_policy: "on-request",
			sandbox_policy: {
				type: "workspace-write",
				network_access: false,
				exclude_tmpdir_env_var: false,
				exclude_slash_tmp: false,
			},
		}),
		cwd,
		workspace_roots: [cwd],
		turn_id: crypto.randomUUID(),
	};
	return { meta, turn };
}

function upsertCodexThread(db: Db, codexDir: string, values: Record<string, unknown>): void {
	const cols = db.columns("threads");
	if (cols.length === 0) return;
	// seed from an existing row so required columns get plausible values
	const tpl = (db.get<Record<string, unknown>>("select * from threads limit 1") ?? {}) as Record<string, unknown>;
	const row: Record<string, unknown> = { source: "cli", model_provider: "openai", ...tpl, ...values };
	const insertCols = Object.keys(row).filter((c) => cols.includes(c));
	if (!insertCols.includes("id")) return;
	const updates = insertCols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
	const sql = `insert into threads (${insertCols.join(", ")}) values (${insertCols.map(() => "?").join(", ")}) on conflict(id) do update set ${updates.join(", ")}`;
	const toVal = (v: unknown) =>
		v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : (v as string | number);
	db.run(sql, ...insertCols.map((c) => toVal(row[c])));
}

/** Convert a canonical transcript into a resumable Codex session (rollout + thread row). */
export function writeCodexSession(
	transcript: CanonicalTranscript,
	opts: { codexDir: string; cwd: string },
): WriteResult {
	const sessionId = crypto.randomUUID();
	const { codexDir, cwd } = opts;
	const nowIso = new Date().toISOString();
	const { meta, turn } = codexTemplates(codexDir, cwd);

	const dateParts = nowIso.slice(0, 10).split("-");
	const rolloutDir = path.join(codexDir, "sessions", dateParts[0], dateParts[1], dateParts[2]);
	fs.mkdirSync(rolloutDir, { recursive: true });
	const installedTo = path.join(rolloutDir, `rollout-${nowIso.replace(/[:.]/g, "-")}-${sessionId}.jsonl`);

	const lines: string[] = [
		JSON.stringify({ timestamp: nowIso, type: "session_meta", payload: { ...meta, id: sessionId, timestamp: nowIso } }),
		JSON.stringify({ timestamp: nowIso, type: "turn_context", payload: turn }),
	];
	for (const m of transcript.messages) {
		// response_item feeds model context on resume; event_msg drives the TUI history.
		lines.push(
			JSON.stringify({
				timestamp: nowIso,
				type: "response_item",
				payload: {
					type: "message",
					role: m.role,
					content: [{ type: m.role === "user" ? "input_text" : "output_text", text: m.text }],
					...(m.role === "assistant" ? { phase: "final_answer" } : {}),
				},
			}),
		);
		lines.push(
			JSON.stringify({
				timestamp: nowIso,
				type: "event_msg",
				payload:
					m.role === "user"
						? { type: "user_message", message: m.text }
						: { type: "agent_message", message: m.text, phase: "final_answer" },
			}),
		);
	}
	fs.writeFileSync(installedTo, `${lines.join("\n")}\n`);

	const dbPath = path.join(codexDir, "state_5.sqlite");
	if (fs.existsSync(dbPath)) {
		const db = openDb(dbPath);
		try {
			const title =
				transcript.title ||
				transcript.messages.find((m) => m.role === "user")?.text?.slice(0, 80) ||
				"Converted session";
			const nowMs = Date.now();
			const nowSec = Math.floor(nowMs / 1000);
			upsertCodexThread(db, codexDir, {
				id: sessionId,
				rollout_path: installedTo,
				cwd,
				title,
				preview: title,
				first_user_message: title,
				created_at: nowSec,
				updated_at: nowSec,
				created_at_ms: nowMs,
				updated_at_ms: nowMs,
				archived: 0,
				archived_at: null,
			});
		} finally {
			db.close();
		}
	}

	return { sessionId, installedTo, resumeCommand: `codex resume ${sessionId}` };
}

// ── Antigravity writer ────────────────────────────────────────────────────────

/** Apply id/path/text swaps to a template protobuf blob. */
function rewriteAgyBlob(blob: Buffer, swaps: Array<[string, string]>): Buffer {
	let buf = blob;
	for (const [from, to] of swaps) buf = rewriteProtobuf(buf, from, to);
	return buf;
}

/**
 * Convert a canonical transcript into a resumable Antigravity conversation.
 *
 * Antigravity's session is a SQLite DB whose payloads are protobuf, with no .proto
 * we can build from scratch. So we clone real template step blobs (a user step and
 * an assistant step) and swap their ids, per-turn uuid, message text, and baked-in
 * paths via length-prefix-aware protobuf rewriting. Tool steps and gen_metadata are
 * omitted — agy renders history from the steps table and tolerates their absence.
 */
export function writeAntigravitySession(
	transcript: CanonicalTranscript,
	opts: { geminiDir: string; cwd: string; userDir: string },
): WriteResult {
	const { geminiDir, cwd, userDir } = opts;
	const sessionId = crypto.randomUUID();
	const trajId = crypto.randomUUID();

	// Swaps applied to every cloned blob: identifiers + the template's baked-in paths.
	const baseSwaps: Array<[string, string]> = [
		[TEMPLATE.convId, sessionId],
		[TEMPLATE.trajId, trajId],
		[TEMPLATE.cwd, cwd],
		[TEMPLATE.userDir, userDir],
	];

	const convDir = path.join(geminiDir, "conversations");
	fs.mkdirSync(convDir, { recursive: true });
	const installedTo = path.join(convDir, `${sessionId}.db`);
	// Start from a clean file (openDb opens read-write and creates it).
	fs.rmSync(installedTo, { force: true });

	const db = openDb(installedTo);
	try {
		for (const stmt of ANTIGRAVITY_SCHEMA) db.exec(stmt);
		db.run(`pragma user_version = ${TEMPLATE.userVersion}`);

		db.run(
			"insert into trajectory_meta (trajectory_id, cascade_id, trajectory_type, source) values (?, ?, ?, ?)",
			trajId,
			sessionId,
			TEMPLATE.trajectoryType,
			TEMPLATE.source,
		);
		db.run(
			"insert into trajectory_metadata_blob (id, data) values ('main', ?)",
			rewriteAgyBlob(TEMPLATE_BLOBS.trajectoryMeta, baseSwaps),
		);
		db.run(
			"insert into executor_metadata (idx, data) values (0, ?)",
			rewriteAgyBlob(TEMPLATE_BLOBS.executorMeta, baseSwaps),
		);

		transcript.messages.forEach((m, idx) => {
			const isUser = m.role === "user";
			const template = isUser ? TEMPLATE_BLOBS.userStep : TEMPLATE_BLOBS.asstStep;
			const swaps: Array<[string, string]> = [
				...baseSwaps,
				// Give each message its own turn id so steps stay independent.
				[TEMPLATE.turnUuid, crypto.randomUUID()],
				[isUser ? TEMPLATE.userText : TEMPLATE.asstText, m.text],
			];
			db.run(
				"insert into steps (idx, step_type, status, step_payload, step_format) values (?, ?, ?, ?, 0)",
				idx,
				isUser ? STEP_TYPE.user : STEP_TYPE.assistant,
				STEP_STATUS_DONE,
				rewriteAgyBlob(template, swaps),
			);
		});
	} finally {
		db.close();
	}

	// Synthesize a matching brain transcript (step_index mirrors the DB idx). agy
	// renders from the DB, but Antigravity tooling also reads this for summaries.
	const logsDir = path.join(geminiDir, "brain", sessionId, ".system_generated", "logs");
	fs.mkdirSync(logsDir, { recursive: true });
	const nowIso = new Date().toISOString();
	const lines = transcript.messages.map((m, i) =>
		m.role === "user"
			? JSON.stringify({
					step_index: i,
					source: "USER_EXPLICIT",
					type: "USER_INPUT",
					status: "DONE",
					created_at: nowIso,
					content: `<USER_REQUEST>\n${m.text}\n</USER_REQUEST>`,
				})
			: JSON.stringify({
					step_index: i,
					source: "MODEL",
					type: "PLANNER_RESPONSE",
					status: "DONE",
					created_at: nowIso,
					content: m.text,
				}),
	);
	const transcriptFile = `${lines.join("\n")}\n`;
	fs.writeFileSync(path.join(logsDir, "transcript.jsonl"), transcriptFile);
	fs.writeFileSync(path.join(logsDir, "transcript_full.jsonl"), transcriptFile);

	return { sessionId, installedTo, resumeCommand: `agy --conversation ${sessionId}` };
}
