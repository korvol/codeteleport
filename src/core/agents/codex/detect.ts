import fs from "node:fs";
import path from "node:path";
import type { SessionInfo } from "../../../shared/types";
import { codexDirDefault, scanCodexLocalSessions } from "./local";

/**
 * Detect the "current" Codex session for a directory.
 *
 * Codex exposes no PID/session file like Claude, so we use ~/.codex/history.jsonl
 * (rows of {session_id, ts, text}) — the most recent entry whose session is rooted
 * in `cwd` — and fall back to the newest local rollout for that cwd.
 */
export function detectCodexCurrentSession(
	cwd: string = process.cwd(),
	codexDir: string = codexDirDefault(),
): SessionInfo {
	const sessions = scanCodexLocalSessions(codexDir); // newest first
	const byId = new Map(sessions.map((s) => [s.sessionId, s]));

	const historyPath = path.join(codexDir, "history.jsonl");
	if (fs.existsSync(historyPath)) {
		const lines = fs.readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
		for (let i = lines.length - 1; i >= 0; i--) {
			let entry: { session_id?: string };
			try {
				entry = JSON.parse(lines[i]);
			} catch {
				continue;
			}
			const session = entry.session_id ? byId.get(entry.session_id) : undefined;
			if (session && session.projectPath === cwd) {
				return { sessionId: session.sessionId, cwd, pid: 0 };
			}
		}
	}

	const fallback = sessions.find((s) => s.projectPath === cwd);
	if (fallback) return { sessionId: fallback.sessionId, cwd, pid: 0 };

	throw new Error(
		`Could not find a Codex session for ${cwd}. Pass --session-id, or run from the project directory where you used Codex.`,
	);
}
