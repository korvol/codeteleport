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
}

export interface BundleOptions {
	sessionId: string;
	cwd: string;
	outputDir?: string;
	claudeDir?: string; // override ~/.claude for testing
	sourceUserDir?: string; // override os.homedir() for testing
}

export interface UnbundleResult {
	sessionId: string;
	installedTo: string;
	resumeCommand: string;
}

export interface UnbundleOptions {
	bundlePath: string;
	targetUserDir?: string;
	claudeDir?: string; // override ~/.claude for testing
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
}

export interface Config {
	token: string;
	apiUrl: string;
	deviceName: string;
	autoSync?: boolean;
}
