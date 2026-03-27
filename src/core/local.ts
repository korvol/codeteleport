import fs from "node:fs";
import path from "node:path";
import { CLAUDE_DIR } from "../shared/constants";
import { encodePath } from "./paths";

export interface LocalSession {
	sessionId: string;
	projectPath: string;
	projectName: string;
	encodedProjectPath: string;
	jsonlPath: string;
	sizeBytes: number;
	messageCount: number;
	firstMessageAt: string | null;
	lastMessageAt: string | null;
}

function parseLine(line: string): { timestamp: string | null; cwd: string | null } {
	try {
		const obj = JSON.parse(line);
		return { timestamp: obj.timestamp || null, cwd: obj.cwd || null };
	} catch {
		return { timestamp: null, cwd: null };
	}
}

function scanDirectory(projectsDir: string, encodedFilter?: string): LocalSession[] {
	if (!fs.existsSync(projectsDir)) return [];

	const sessions: LocalSession[] = [];

	const dirs = encodedFilter ? [encodedFilter] : fs.readdirSync(projectsDir);

	for (const encodedCwd of dirs) {
		const projDir = path.join(projectsDir, encodedCwd);
		if (!fs.existsSync(projDir) || !fs.statSync(projDir).isDirectory()) continue;

		for (const file of fs.readdirSync(projDir)) {
			if (!file.endsWith(".jsonl")) continue;

			const sessionId = file.replace(".jsonl", "");
			const jsonlPath = path.join(projDir, file);
			const stat = fs.statSync(jsonlPath);
			const content = fs.readFileSync(jsonlPath, "utf-8");
			const lines = content.split("\n").filter((l) => l.length > 0);

			let firstMessageAt: string | null = null;
			let lastMessageAt: string | null = null;
			let projectPath: string | null = null;

			// Scan from start for first timestamp and cwd
			for (const line of lines) {
				const parsed = parseLine(line);
				if (parsed.timestamp && !firstMessageAt) {
					firstMessageAt = parsed.timestamp;
				}
				if (parsed.cwd && !projectPath) {
					projectPath = parsed.cwd;
				}
				if (firstMessageAt && projectPath) break;
			}

			// Scan from end for last timestamp
			for (let i = lines.length - 1; i >= 0; i--) {
				const parsed = parseLine(lines[i]);
				if (parsed.timestamp) {
					lastMessageAt = parsed.timestamp;
					break;
				}
			}

			// Fall back to decoding directory name if cwd not found in JSONL
			if (!projectPath) {
				projectPath = encodedCwd.replace(/-/g, "/");
			}

			const projectName = path.basename(projectPath);

			sessions.push({
				sessionId,
				projectPath,
				projectName,
				encodedProjectPath: encodedCwd,
				jsonlPath,
				sizeBytes: stat.size,
				messageCount: lines.length,
				firstMessageAt,
				lastMessageAt,
			});
		}
	}

	return sessions.sort((a, b) => {
		const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
		const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
		return bTime - aTime;
	});
}

/**
 * Scan ~/.claude/projects/ for all local Claude Code sessions.
 * Returns sessions sorted by lastMessageAt descending (most recent first).
 */
export function scanLocalSessions(claudeDir: string = CLAUDE_DIR): LocalSession[] {
	const projectsDir = path.join(claudeDir, "projects");
	return scanDirectory(projectsDir);
}

/**
 * Scan sessions for a specific project directory only.
 * Returns sessions sorted by lastMessageAt descending.
 */
export function scanProjectSessions(projectPath: string, claudeDir: string = CLAUDE_DIR): LocalSession[] {
	const projectsDir = path.join(claudeDir, "projects");
	const encoded = encodePath(projectPath);
	return scanDirectory(projectsDir, encoded);
}
