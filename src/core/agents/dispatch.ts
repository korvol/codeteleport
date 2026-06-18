import { DEFAULT_AGENT_ID, assertSupportedAgent } from "../../shared/constants";
import type { SessionInfo } from "../../shared/types";
import type { LocalSession } from "../local";
import { scanLocalSessions, scanProjectSessions } from "../local";
import { detectCurrentSession } from "../session";
import { detectAntigravityCurrentSession } from "./antigravity/detect";
import { scanAntigravityLocalSessions, scanAntigravityProjectSessions } from "./antigravity/local";
import { detectCodexCurrentSession } from "./codex/detect";
import { scanCodexLocalSessions, scanCodexProjectSessions } from "./codex/local";

/** Per-agent directory overrides (tests / non-default homes). */
export interface AgentDirs {
	claudeDir?: string;
	codexDir?: string;
	geminiDir?: string;
}

/** List all local sessions for the configured agent. */
export function scanLocalSessionsForAgent(agentId: string = DEFAULT_AGENT_ID, dirs: AgentDirs = {}): LocalSession[] {
	assertSupportedAgent(agentId);
	if (agentId === "codex") return scanCodexLocalSessions(dirs.codexDir);
	if (agentId === "antigravity") return scanAntigravityLocalSessions(dirs.geminiDir);
	return scanLocalSessions(dirs.claudeDir);
}

/** List local sessions for a single project cwd, for the configured agent. */
export function scanProjectSessionsForAgent(
	agentId: string,
	projectPath: string,
	dirs: AgentDirs = {},
): LocalSession[] {
	assertSupportedAgent(agentId);
	if (agentId === "codex") return scanCodexProjectSessions(projectPath, dirs.codexDir);
	if (agentId === "antigravity") return scanAntigravityProjectSessions(projectPath, dirs.geminiDir);
	return scanProjectSessions(projectPath, dirs.claudeDir);
}

/**
 * Detect the current session for the configured agent. Claude uses the process
 * tree (cwd ignored); Codex uses history.jsonl rooted at cwd. Throws if none —
 * callers fall back to the interactive picker.
 */
export function detectCurrentSessionForAgent(
	agentId: string,
	cwd: string = process.cwd(),
	dirs: AgentDirs = {},
): SessionInfo {
	assertSupportedAgent(agentId);
	if (agentId === "codex") return detectCodexCurrentSession(cwd, dirs.codexDir);
	if (agentId === "antigravity") return detectAntigravityCurrentSession(cwd, dirs.geminiDir);
	return detectCurrentSession(undefined, dirs.claudeDir);
}
