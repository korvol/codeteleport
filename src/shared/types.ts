export interface SessionInfo {
	sessionId: string;
	cwd: string;
	pid: number;
}

export interface BundleResult {
	bundlePath: string;
	sessionId: string;
	sourceCwd: string;
	sourceUserDir: string;
	sizeBytes: number;
	checksum: string; // "sha256:<hex>"
	metadata: SessionMetadata;
	/** Manifest of working/temp files bundled (Part B) — for the user's safety review. */
	extraFiles?: ExtraFilesManifest;
}

export interface ExtraFilesManifest {
	included: Array<{ path: string; sizeBytes: number }>;
	skipped: Array<{ path: string; reason: string }>;
}

export interface BundleOptions {
	sessionId: string;
	cwd: string;
	outputDir?: string;
	claudeDir?: string; // override ~/.claude for testing
	codexDir?: string; // override ~/.codex for testing
	geminiDir?: string; // override ~/.gemini/antigravity-cli for testing
	sourceUserDir?: string; // override os.homedir() for testing
	/** Which agent produced the session. Defaults to "claude-code". Recorded in the bundle. */
	agentId?: string;
	/** Absolute paths of working/temp files the session created or depends on (e.g. /tmp/*.json). */
	includePaths?: string[];
}

export interface UnbundleResult {
	sessionId: string;
	installedTo: string;
	resumeCommand: string;
	/** Per-file disposition of restored project memory (Part A). */
	memoryInstalled?: { written: string[]; merged: string[]; skipped: string[] };
	/** Per-file disposition of restored working/temp files (Part B). */
	extraFilesInstalled?: Array<{ path: string; action: "written" | "overwritten" | "skipped" }>;
	/** Codex only: whether the local thread inventory (state_5.sqlite) was updated. */
	codexStateApplied?: boolean;
}

export interface UnbundleOptions {
	bundlePath: string;
	targetDir?: string; // full path to anchor the session (e.g. /Users/bob/projects/code-teleport)
	targetUserDir?: string; // override — auto-detected from targetDir if not provided
	claudeDir?: string; // override ~/.claude for testing
	codexDir?: string; // override ~/.codex for testing
	geminiDir?: string; // override ~/.gemini/antigravity-cli for testing
	resumeCommandPrefix?: string; // override "claude --resume" — from agent config
	/** How to handle pre-existing memory files on the target. Default "merge". */
	memoryConflict?: "merge" | "overwrite" | "skip";
	/** How to handle pre-existing extra files on the target. Default "overwrite". */
	extraFilesConflict?: "overwrite" | "skip";
	/** Convert the session into this agent's format on install (claude-code|codex). Ignored if it equals the bundle's agent. */
	convertTo?: string;
}

export interface ScannedAssets {
	pasteFiles: string[];
	shellSnapshots: string[];
}

export interface SessionMetadata {
	messageCount?: number;
	userMessageCount?: number;
	assistantMessageCount?: number;
	toolCallCount?: number;
	sessionStartedAt?: string;
	sessionEndedAt?: string;
	durationSeconds?: number;
	projectName?: string;
	summary?: string;
	filesModified?: string[];
	filesModifiedCount?: number;
	jsonlSizeBytes?: number;
	subagentCount?: number;
	hasFileHistory?: boolean;
	hasPasteCache?: boolean;
	hasShellSnapshots?: boolean;
	claudeModel?: string;
	hasMemory?: boolean;
	memoryFileCount?: number;
	extraFileCount?: number;
	extraFilesIncluded?: string[];
	/** Which agent produced the session (for cloud listing). */
	agentId?: string;
	// ── Codex-specific ──
	codexModel?: string;
	codexCliVersion?: string;
	tokenTotal?: number;
}

export interface Config {
	token: string;
	apiUrl: string;
	deviceName: string;
	agent?: string;
	autoSync?: boolean;
}
