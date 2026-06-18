import fs from "node:fs";
import path from "node:path";
import type { SessionMetadata } from "../../../shared/types";

export interface CodexScanResult {
	sessionId: string;
	cwd: string;
	metadata: SessionMetadata;
	/** Shell snapshot basenames referenced (restored only when explicitly opted in). */
	shellSnapshots: string[];
}

const SESSION_ID_IN_FILENAME = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) =>
			item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
				? (item as { text: string }).text
				: "",
		)
		.filter(Boolean)
		.join("\n");
}

function isEnvironmentContext(text: string): boolean {
	return text.trim().startsWith("<environment_context>");
}

/** Parse the file list out of an apply_patch tool call's arguments. */
function filesFromApplyPatch(args: unknown): string[] {
	let patch = "";
	if (typeof args === "string") {
		try {
			const parsed = JSON.parse(args);
			patch = typeof parsed?.input === "string" ? parsed.input : args;
		} catch {
			patch = args;
		}
	} else if (args && typeof args === "object" && typeof (args as { input?: unknown }).input === "string") {
		patch = (args as { input: string }).input;
	}
	const files: string[] = [];
	const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
	while ((m = re.exec(patch)) !== null) {
		files.push(m[1].trim());
	}
	return files;
}

/**
 * Scan a Codex rollout JSONL for the metadata CodeTeleport records.
 *
 * Note: only `apply_patch` edits surface modified files. Codex frequently edits
 * via `exec_command` (shell), which is opaque — those won't be auto-detected, so
 * `--include` remains the explicit mechanism for working/temp files.
 */
export function scanCodexSession(jsonlPath: string): CodexScanResult {
	const content = fs.readFileSync(jsonlPath, "utf-8");
	const lines = content.split("\n").filter((l) => l.trim());

	let sessionId = "";
	let cwd = "";
	let cliVersion = "";
	let model = "";
	let firstTimestamp: string | undefined;
	let lastTimestamp: string | undefined;
	let summary: string | undefined;
	let userMessageCount = 0;
	let assistantMessageCount = 0;
	let toolCallCount = 0;
	let tokenTotal = 0;
	const filesModified = new Set<string>();

	for (const line of lines) {
		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(line);
		} catch {
			continue;
		}

		const ts = obj.timestamp as string | undefined;
		if (ts) {
			if (!firstTimestamp) firstTimestamp = ts;
			lastTimestamp = ts;
		}

		const type = obj.type as string | undefined;
		const payload = obj.payload as Record<string, unknown> | undefined;
		if (!payload) continue;

		if (type === "session_meta") {
			if (typeof payload.id === "string") sessionId = payload.id;
			if (typeof payload.cwd === "string" && !cwd) cwd = payload.cwd;
			if (typeof payload.cli_version === "string") cliVersion = payload.cli_version;
			if (typeof payload.timestamp === "string" && !firstTimestamp) firstTimestamp = payload.timestamp;
			continue;
		}
		if (type === "turn_context") {
			if (typeof payload.cwd === "string" && !cwd) cwd = payload.cwd;
			if (typeof payload.model === "string" && !model) model = payload.model;
			continue;
		}
		if (type === "response_item") {
			if (payload.type === "message") {
				const role = payload.role as string | undefined;
				if (role === "user") {
					userMessageCount++;
					const text = textFromContent(payload.content);
					if (!summary && text && !isEnvironmentContext(text)) summary = text.slice(0, 200);
				} else if (role === "assistant") {
					assistantMessageCount++;
				}
			} else if (payload.type === "function_call") {
				toolCallCount++;
				if (payload.name === "apply_patch") {
					for (const f of filesFromApplyPatch(payload.arguments)) filesModified.add(f);
				}
			}
			continue;
		}
		if (type === "event_msg") {
			if (payload.type === "token_count") {
				const total = (payload.info as { total_token_usage?: { total_tokens?: number } } | undefined)?.total_token_usage
					?.total_tokens;
				if (typeof total === "number") tokenTotal = Math.max(tokenTotal, total);
			} else if (payload.type === "user_message" && !summary) {
				const text = (payload.message as string) || (payload.text as string) || "";
				if (text && !isEnvironmentContext(text)) summary = text.slice(0, 200);
			}
		}
	}

	if (!sessionId) {
		const m = path.basename(jsonlPath).match(SESSION_ID_IN_FILENAME);
		if (m) sessionId = m[1];
	}

	let durationSeconds: number | undefined;
	if (firstTimestamp && lastTimestamp) {
		durationSeconds = Math.round((new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 1000);
	}

	const sortedFiles = Array.from(filesModified).sort();
	const metadata: SessionMetadata = {
		messageCount: userMessageCount + assistantMessageCount,
		userMessageCount,
		assistantMessageCount,
		toolCallCount,
		sessionStartedAt: firstTimestamp,
		sessionEndedAt: lastTimestamp,
		durationSeconds,
		summary,
		filesModified: sortedFiles.length > 0 ? sortedFiles : undefined,
		filesModifiedCount: sortedFiles.length > 0 ? sortedFiles.length : undefined,
		codexModel: model || undefined,
		codexCliVersion: cliVersion || undefined,
		tokenTotal: tokenTotal || undefined,
		agentId: "codex",
	};

	return { sessionId, cwd, metadata, shellSnapshots: [] };
}
