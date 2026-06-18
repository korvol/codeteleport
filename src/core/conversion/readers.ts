import type { CanonicalMessage, CanonicalTranscript } from "./types";

/** Flatten message content that may be a plain string or an array of {text} blocks. */
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

function parseLines(jsonl: string): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	for (const line of jsonl.split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line));
		} catch {}
	}
	return out;
}

function finish(sessionId: string, cwd: string, messages: CanonicalMessage[]): CanonicalTranscript {
	const title = messages.find((m) => m.role === "user")?.text;
	return { sessionId, cwd, title: title ? title.slice(0, 200) : undefined, messages };
}

/** Claude Code session JSONL → canonical transcript. */
export function readClaudeTranscript(jsonl: string): CanonicalTranscript {
	let cwd = "";
	const messages: CanonicalMessage[] = [];
	for (const entry of parseLines(jsonl)) {
		if (!cwd && typeof entry.cwd === "string") cwd = entry.cwd;
		const type = entry.type;
		if (type !== "user" && type !== "assistant") continue;
		const message = entry.message as { content?: unknown } | undefined;
		const text = textFromContent(message?.content).trim();
		if (text) messages.push({ role: type, text });
	}
	return finish("", cwd, messages);
}

/** Codex rollout JSONL → canonical transcript (developer/system messages ignored). */
export function readCodexTranscript(jsonl: string): CanonicalTranscript {
	let cwd = "";
	let sessionId = "";
	const messages: CanonicalMessage[] = [];
	for (const entry of parseLines(jsonl)) {
		const payload = entry.payload as Record<string, unknown> | undefined;
		if (entry.type === "session_meta" && payload) {
			if (typeof payload.id === "string") sessionId = payload.id;
			if (!cwd && typeof payload.cwd === "string") cwd = payload.cwd;
			continue;
		}
		if (entry.type === "turn_context" && payload && !cwd && typeof payload.cwd === "string") {
			cwd = payload.cwd;
			continue;
		}
		if (entry.type === "response_item" && payload?.type === "message") {
			const role = payload.role;
			if (role !== "user" && role !== "assistant") continue;
			const text = textFromContent(payload.content).trim();
			if (text) messages.push({ role, text });
		}
	}
	return finish(sessionId, cwd, messages);
}

/** Antigravity brain transcript.jsonl → canonical transcript. */
export function readAntigravityTranscript(jsonl: string): CanonicalTranscript {
	const messages: CanonicalMessage[] = [];
	for (const entry of parseLines(jsonl)) {
		const raw = typeof entry.content === "string" ? entry.content : "";
		if (entry.type === "USER_INPUT") {
			const text = raw.replace(/<\/?USER_REQUEST>/g, "").trim();
			if (text) messages.push({ role: "user", text });
		} else if (entry.type === "PLANNER_RESPONSE") {
			const text = raw.trim();
			if (text) messages.push({ role: "assistant", text });
		}
	}
	return finish("", "", messages);
}
