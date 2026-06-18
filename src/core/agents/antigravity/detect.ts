import type { SessionInfo } from "../../../shared/types";
import { antigravityDirDefault, scanAntigravityLocalSessions } from "./local";

/**
 * Detect the current Antigravity conversation for a directory: the most recently
 * active conversation whose workspace matches `cwd` (recency comes from
 * history.jsonl). Throws if none — callers fall back to the interactive picker.
 */
export function detectAntigravityCurrentSession(
	cwd: string = process.cwd(),
	gemDir: string = antigravityDirDefault(),
): SessionInfo {
	const match = scanAntigravityLocalSessions(gemDir).find((s) => s.projectPath === cwd);
	if (match) return { sessionId: match.sessionId, cwd, pid: 0 };
	throw new Error(
		`Could not find an Antigravity conversation for ${cwd}. Pass --session-id, or run from the project directory where you used Antigravity.`,
	);
}
