import fs from "node:fs";
import path from "node:path";
import { readAntigravityTranscript, readClaudeTranscript, readCodexTranscript } from "./readers";
import type { CanonicalTranscript } from "./types";
import { type WriteResult, writeClaudeSession, writeCodexSession } from "./writers";

/** Agents we can WRITE (convert into). Antigravity is read-only — we never synthesize its protobuf DB. */
const WRITABLE_TARGETS = ["claude-code", "codex"] as const;

/** Whether a source session can be converted into the target agent's format. */
export function canConvert(sourceAgentId: string, targetAgentId: string): boolean {
	if (sourceAgentId === targetAgentId) return false;
	return (WRITABLE_TARGETS as readonly string[]).includes(targetAgentId);
}

/** The agents a given source can be converted into. */
export function conversionTargetsFor(sourceAgentId: string): string[] {
	return WRITABLE_TARGETS.filter((t) => t !== sourceAgentId);
}

/** Read the source agent's session (from an extracted bundle staging dir) into the canonical IR. */
function readSource(sourceAgentId: string, stagingDir: string): CanonicalTranscript {
	if (sourceAgentId === "codex") {
		return readCodexTranscript(fs.readFileSync(path.join(stagingDir, "session.jsonl"), "utf-8"));
	}
	if (sourceAgentId === "antigravity") {
		const t = path.join(stagingDir, "brain", ".system_generated", "logs", "transcript.jsonl");
		return readAntigravityTranscript(fs.existsSync(t) ? fs.readFileSync(t, "utf-8") : "");
	}
	// claude-code (and default)
	return readClaudeTranscript(fs.readFileSync(path.join(stagingDir, "session.jsonl"), "utf-8"));
}

export interface ConvertArgs {
	sourceAgentId: string;
	targetAgentId: string;
	/** Directory the source bundle was extracted into. */
	stagingDir: string;
	/** Where the converted session should be anchored on this machine. */
	targetCwd: string;
	/** Target agent home dirs. */
	claudeDir: string;
	codexDir: string;
}

/**
 * Convert an extracted source bundle into a resumable session for the target
 * agent. Transcript-level + lossy by design. Throws if the pair is unsupported
 * (notably any target = antigravity).
 */
export function convertInStaging(args: ConvertArgs): WriteResult {
	const { sourceAgentId, targetAgentId, stagingDir, targetCwd, claudeDir, codexDir } = args;
	if (!canConvert(sourceAgentId, targetAgentId)) {
		throw new Error(
			`Cannot convert ${sourceAgentId} → ${targetAgentId}. Conversion targets are: ${conversionTargetsFor(sourceAgentId).join(", ") || "(none)"}.`,
		);
	}
	const transcript = readSource(sourceAgentId, stagingDir);
	if (targetAgentId === "codex") return writeCodexSession(transcript, { codexDir, cwd: targetCwd });
	return writeClaudeSession(transcript, { claudeDir, cwd: targetCwd });
}
