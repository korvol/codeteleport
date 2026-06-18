import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LocalSession } from "../../local";
import { samePath } from "../../paths";
import { openDb } from "../../sqlite";

/** Default Antigravity home (~/.gemini/antigravity-cli), overridable for tests. */
export function antigravityDirDefault(): string {
	return path.join(os.homedir(), ".gemini", "antigravity-cli");
}

interface HistoryInfo {
	workspace: string;
	lastTs: number;
	firstDisplay: string;
}

/** Map conversationId -> {workspace, latest ts, first display} from history.jsonl. */
function readHistory(gemDir: string): Map<string, HistoryInfo> {
	const map = new Map<string, HistoryInfo>();
	const file = path.join(gemDir, "history.jsonl");
	if (!fs.existsSync(file)) return map;
	for (const line of fs.readFileSync(file, "utf-8").split("\n").filter(Boolean)) {
		let row: { display?: string; timestamp?: number; workspace?: string; conversationId?: string };
		try {
			row = JSON.parse(line);
		} catch {
			continue;
		}
		if (!row.conversationId) continue;
		const prev = map.get(row.conversationId);
		const ts = typeof row.timestamp === "number" ? row.timestamp : 0;
		map.set(row.conversationId, {
			workspace: row.workspace || prev?.workspace || "",
			lastTs: Math.max(ts, prev?.lastTs ?? 0),
			firstDisplay: prev?.firstDisplay || row.display || "",
		});
	}
	return map;
}

/** Extract the workspace path from the trajectory metadata protobuf blob (fallback). */
function workspaceFromBlob(dbPath: string): string {
	try {
		const db = openDb(dbPath, { readOnly: true });
		try {
			if (db.columns("trajectory_metadata_blob").length === 0) return "";
			const row = db.get<{ data: Buffer }>("select data from trajectory_metadata_blob where id = 'main' limit 1");
			if (!row?.data) return "";
			// Capture the file:// path, then truncate at the first non-printable byte (blobs are binary).
			const m = Buffer.from(row.data)
				.toString("latin1")
				.match(/file:\/\/([^"'\s]+)/);
			if (!m) return "";
			let p = m[1];
			const bad = p.search(/[^\x20-\x7e]/);
			if (bad !== -1) p = p.slice(0, bad);
			// file:///C:/Users/x captures "/C:/Users/x" — drop the URI's leading slash(es)
			// before a Windows drive so the result is a real path ("C:/Users/x"), not "/C:/…".
			p = p.replace(/^\/+([A-Za-z]:)/, "$1");
			if (/^[A-Za-z]:/.test(p) || p.startsWith("\\\\")) return p; // Windows drive / UNC — leave as-is
			if (p.startsWith("//")) p = p.slice(2);
			return p.startsWith("/") ? p : `/${p}`;
		} finally {
			db.close();
		}
	} catch {
		return "";
	}
}

/** Count turns (USER_INPUT + PLANNER_RESPONSE) and grab the first prompt from a transcript. */
function transcriptSummary(gemDir: string, id: string): { messageCount: number; title: string } {
	const t = path.join(gemDir, "brain", id, ".system_generated", "logs", "transcript.jsonl");
	if (!fs.existsSync(t)) return { messageCount: 0, title: "" };
	let messageCount = 0;
	let title = "";
	for (const line of fs.readFileSync(t, "utf-8").split("\n").filter(Boolean)) {
		try {
			const o = JSON.parse(line);
			if (o.type === "USER_INPUT" || o.type === "PLANNER_RESPONSE") messageCount++;
			if (o.type === "USER_INPUT" && !title) title = String(o.content || "").slice(0, 200);
		} catch {}
	}
	return { messageCount, title };
}

/** List Antigravity conversations, newest activity first. */
export function scanAntigravityLocalSessions(gemDir: string = antigravityDirDefault()): LocalSession[] {
	const convDir = path.join(gemDir, "conversations");
	if (!fs.existsSync(convDir)) return [];
	const history = readHistory(gemDir);

	const sessions: Array<LocalSession & { _ts: number }> = [];
	for (const file of fs.readdirSync(convDir)) {
		if (!file.endsWith(".db")) continue;
		const sessionId = file.slice(0, -3);
		const dbPath = path.join(convDir, file);
		const h = history.get(sessionId);
		const cwd = h?.workspace || workspaceFromBlob(dbPath);
		const { messageCount } = transcriptSummary(gemDir, sessionId);
		const lastTs = h?.lastTs ?? fs.statSync(dbPath).mtimeMs;
		sessions.push({
			sessionId,
			projectPath: cwd,
			projectName: cwd ? path.basename(cwd) : "(unknown)",
			encodedProjectPath: "",
			jsonlPath: dbPath,
			sizeBytes: fs.statSync(dbPath).size,
			messageCount,
			firstMessageAt: null,
			lastMessageAt: lastTs ? new Date(lastTs).toISOString() : null,
			_ts: lastTs,
		});
	}
	return sessions.sort((a, b) => b._ts - a._ts).map(({ _ts, ...s }) => s);
}

/** List Antigravity conversations for a single project cwd, newest first. */
export function scanAntigravityProjectSessions(
	projectPath: string,
	gemDir: string = antigravityDirDefault(),
): LocalSession[] {
	return scanAntigravityLocalSessions(gemDir).filter((s) => samePath(s.projectPath, projectPath));
}

/** Locate a conversation DB by exact id or unambiguous prefix. */
export function findAntigravityDbPath(sessionId: string, gemDir: string = antigravityDirDefault()): string | null {
	for (const s of scanAntigravityLocalSessions(gemDir)) {
		if (s.sessionId === sessionId || s.sessionId.startsWith(sessionId)) return s.jsonlPath;
	}
	return null;
}
