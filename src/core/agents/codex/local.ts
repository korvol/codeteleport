import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LocalSession } from "../../local";
import { samePath } from "../../paths";
import { scanCodexSession } from "./scanner";

/** Default Codex home: CODEX_HOME if set (official Codex behavior), else ~/.codex. */
export function codexDirDefault(): string {
	const fromEnv = process.env.CODEX_HOME?.trim();
	return fromEnv ? fromEnv : path.join(os.homedir(), ".codex");
}

function walkRollouts(sessionsDir: string): string[] {
	if (!fs.existsSync(sessionsDir)) return [];
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(abs);
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(abs);
		}
	};
	walk(sessionsDir);
	return found;
}

function toLocalSession(jsonlPath: string): LocalSession | null {
	let scan: ReturnType<typeof scanCodexSession>;
	try {
		scan = scanCodexSession(jsonlPath);
	} catch {
		return null;
	}
	if (!scan.sessionId) return null;
	const cwd = scan.cwd || "";
	return {
		sessionId: scan.sessionId,
		projectPath: cwd,
		projectName: cwd ? path.basename(cwd) : "(unknown)",
		encodedProjectPath: "", // Codex doesn't dash-encode project dirs
		jsonlPath,
		sizeBytes: fs.statSync(jsonlPath).size,
		messageCount: scan.metadata.messageCount ?? 0,
		firstMessageAt: scan.metadata.sessionStartedAt ?? null,
		lastMessageAt: scan.metadata.sessionEndedAt ?? null,
	};
}

function sortByRecency(sessions: LocalSession[]): LocalSession[] {
	return sessions.sort((a, b) => {
		const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
		const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
		return bt - at;
	});
}

/** Scan all Codex rollouts under ~/.codex/sessions, newest first. */
export function scanCodexLocalSessions(codexDir: string = codexDirDefault()): LocalSession[] {
	const sessions: LocalSession[] = [];
	for (const file of walkRollouts(path.join(codexDir, "sessions"))) {
		const s = toLocalSession(file);
		if (s) sessions.push(s);
	}
	return sortByRecency(sessions);
}

/** Scan Codex rollouts for a single project cwd, newest first. */
export function scanCodexProjectSessions(projectPath: string, codexDir: string = codexDirDefault()): LocalSession[] {
	return scanCodexLocalSessions(codexDir).filter((s) => samePath(s.projectPath, projectPath));
}

/** Locate a session's rollout JSONL by exact id or unambiguous prefix. */
export function findCodexRolloutPath(sessionId: string, codexDir: string = codexDirDefault()): string | null {
	for (const s of scanCodexLocalSessions(codexDir)) {
		if (s.sessionId === sessionId || s.sessionId.startsWith(sessionId)) return s.jsonlPath;
	}
	return null;
}
