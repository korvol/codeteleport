import type { SessionListItem } from "../client/api";

export interface PickedCloudSession {
	sessionId: string;
	sourceCwd: string;
	sourceMachine: string | null;
}

/**
 * Given a list of cloud sessions, resolve which one to pull.
 * - 0 sessions: returns null
 * - 1 session: returns it directly (no prompt)
 * - multiple: displays list and prompts the user to pick one (default: 1, most recent)
 * - "q" to cancel
 */
export async function pickCloudSession(
	sessions: SessionListItem[],
	promptFn: (question: string) => Promise<string>,
	logFn: (...args: unknown[]) => void = console.log,
): Promise<PickedCloudSession | null> {
	if (sessions.length === 0) return null;

	logFn("\nCloud sessions:\n");
	for (let i = 0; i < sessions.length; i++) {
		logFn(formatCloudSessionRow(i + 1, sessions[i]));
	}
	logFn("");

	const choice = await promptFn("Select session [1]: ");

	if (choice.toLowerCase() === "q") return null;

	const index = choice === "" ? 0 : Number.parseInt(choice, 10) - 1;

	if (Number.isNaN(index) || index < 0 || index >= sessions.length) {
		const s = sessions[0];
		return { sessionId: s.id, sourceCwd: s.sourceCwd, sourceMachine: s.sourceMachine };
	}

	const s = sessions[index];
	return { sessionId: s.id, sourceCwd: s.sourceCwd, sourceMachine: s.sourceMachine };
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format a cloud session for display in the picker list.
 */
export function formatCloudSessionRow(index: number, session: SessionListItem): string {
	const id = session.id.slice(0, 8);
	const project = session.metadata?.projectName || session.sourceCwd.split("/").pop() || "unknown";
	const machine = session.sourceMachine || "unknown";
	// Which agent created this session (legacy bundles with no agentId are claude-code).
	const agent = session.metadata?.agentId || "claude-code";
	const msgs = session.metadata?.messageCount ? `${String(session.metadata.messageCount).padStart(6)} msgs` : "";
	const size = formatSize(session.sizeBytes).padStart(8);
	const label = session.label ? `  [${session.label}]` : "";
	const ver = session.versionCount > 1 ? `  v${session.currentVersion} (${session.versionCount})` : "";

	return `  ${index})  ${id}  ${agent}  ${project}  ${machine}  ${msgs}  ${size}${ver}${label}`;
}
