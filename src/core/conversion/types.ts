/**
 * Canonical transcript — the lossy, agent-neutral intermediate representation
 * used to convert a session from one agent to another. It captures the
 * conversation (ordered user/assistant messages) plus the bits a writer needs
 * to anchor a new native session. It deliberately does NOT model tool-call
 * fidelity, file history, subagents, or any agent-specific sidecar state.
 */
export interface CanonicalMessage {
	role: "user" | "assistant";
	text: string;
}

export interface CanonicalTranscript {
	/** Source session id, when the reader can determine it (else ""). */
	sessionId: string;
	/** Source working directory, when present (else ""). */
	cwd: string;
	/** First user prompt, used as a title/summary. */
	title?: string;
	messages: CanonicalMessage[];
}
