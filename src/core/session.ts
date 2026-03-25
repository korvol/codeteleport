import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CLAUDE_DIR } from "../shared/constants";
import type { SessionInfo } from "../shared/types";

/**
 * Walk up the process tree from startPid, looking for a PID
 * that has a session file at ~/.claude/sessions/<pid>.json.
 * Max 5 levels up (claude → bash → this script).
 */
export function detectCurrentSession(startPid?: number, claudeDir: string = CLAUDE_DIR): SessionInfo {
	let pid = startPid ?? process.ppid;
	let depth = 0;

	while (pid > 1 && depth < 5) {
		const sessionFile = path.join(claudeDir, "sessions", `${pid}.json`);
		if (fs.existsSync(sessionFile)) {
			const data = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
			return {
				sessionId: data.sessionId,
				cwd: data.cwd,
				pid,
			};
		}

		try {
			const ppid = execSync(`ps -o ppid= -p ${pid}`, { encoding: "utf-8" }).trim();
			pid = Number.parseInt(ppid, 10);
		} catch {
			break;
		}
		depth++;
	}

	throw new Error(
		"Could not find a Claude Code session in the process tree. Are you running this from inside Claude Code?",
	);
}

/**
 * List recent sessions from ~/.claude/projects/ for manual selection.
 * Returns sessions sorted by modification time (newest first).
 */
export function listLocalSessions(
	claudeDir: string = CLAUDE_DIR,
): Array<{ sessionId: string; cwd: string; modifiedAt: Date }> {
	const projectsDir = path.join(claudeDir, "projects");
	if (!fs.existsSync(projectsDir)) return [];

	const sessions: Array<{ sessionId: string; cwd: string; modifiedAt: Date }> = [];

	for (const encodedCwd of fs.readdirSync(projectsDir)) {
		const projDir = path.join(projectsDir, encodedCwd);
		if (!fs.statSync(projDir).isDirectory()) continue;

		for (const file of fs.readdirSync(projDir)) {
			if (!file.endsWith(".jsonl")) continue;
			const sessionId = file.replace(".jsonl", "");
			const stat = fs.statSync(path.join(projDir, file));
			// Decode the cwd from the directory name (reverse of encodePath)
			const cwd = encodedCwd.replace(/-/g, "/");
			sessions.push({ sessionId, cwd, modifiedAt: stat.mtime });
		}
	}

	return sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}
