import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanCodexSession } from "../core/agents/codex/scanner";

/**
 * Codex rollout JSONL (Codex CLI 0.140.0) line shapes:
 *   session_meta  -> { payload: { id, cwd, cli_version, model_provider, source, thread_source, timestamp } }
 *   turn_context  -> { payload: { cwd, model, approval_policy, sandbox_policy } }
 *   response_item -> { payload: { type: "message"|"function_call", role, content, name, arguments } }
 *   event_msg     -> { payload: { type: "token_count"|"user_message", info, message } }
 */
function fixtureLines(cwd: string): string[] {
	return [
		JSON.stringify({
			timestamp: "2026-06-18T03:35:48.863Z",
			type: "session_meta",
			payload: {
				id: "019ed8ca-db3b-7870-b1ae-9511f710f77c",
				timestamp: "2026-06-18T03:33:53.628Z",
				cwd,
				cli_version: "0.140.0",
				source: "cli",
				thread_source: "user",
				model_provider: "openai",
			},
		}),
		JSON.stringify({
			timestamp: "2026-06-18T03:35:48.868Z",
			type: "turn_context",
			payload: { cwd, model: "gpt-5.5", approval_policy: "on-request", sandbox_policy: { type: "workspace-write" } },
		}),
		// developer/system message — should NOT count as a user prompt
		JSON.stringify({
			type: "response_item",
			payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<permissions ...>" }] },
		}),
		JSON.stringify({
			timestamp: "2026-06-18T03:36:00.000Z",
			type: "response_item",
			payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Add Codex support" }] },
		}),
		JSON.stringify({
			type: "response_item",
			payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "On it." }] },
		}),
		// apply_patch edit -> a modified file we can detect
		JSON.stringify({
			type: "response_item",
			payload: {
				type: "function_call",
				name: "apply_patch",
				arguments: JSON.stringify({
					input: `*** Begin Patch\n*** Update File: ${cwd}/src/index.ts\n@@\n-old\n+new\n*** End Patch`,
				}),
			},
		}),
		// opaque shell edit -> NOT auto-detected (documented Codex limitation)
		JSON.stringify({
			type: "response_item",
			payload: {
				type: "function_call",
				name: "exec_command",
				arguments: JSON.stringify({ command: "sed -i s/a/b/ x" }),
			},
		}),
		JSON.stringify({
			timestamp: "2026-06-18T03:40:00.000Z",
			type: "event_msg",
			payload: { type: "token_count", info: { total_token_usage: { total_tokens: 4242 } } },
		}),
	];
}

describe("scanCodexSession", () => {
	let tmp: string;
	let jsonlPath: string;
	const cwd = "/Users/alice/workspace/app";

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-scan-"));
		jsonlPath = path.join(tmp, "rollout.jsonl");
		fs.writeFileSync(jsonlPath, fixtureLines(cwd).join("\n"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("extracts session id, cwd, and model from the rollout", () => {
		const r = scanCodexSession(jsonlPath);
		expect(r.sessionId).toBe("019ed8ca-db3b-7870-b1ae-9511f710f77c");
		expect(r.cwd).toBe(cwd);
		expect(r.metadata.codexModel).toBe("gpt-5.5");
		expect(r.metadata.codexCliVersion).toBe("0.140.0");
	});

	it("counts user/assistant messages and ignores developer/system messages for the summary", () => {
		const r = scanCodexSession(jsonlPath);
		expect(r.metadata.userMessageCount).toBe(1);
		expect(r.metadata.assistantMessageCount).toBe(1);
		expect(r.metadata.summary).toBe("Add Codex support");
	});

	it("detects apply_patch-modified files but not opaque exec_command edits", () => {
		const r = scanCodexSession(jsonlPath);
		expect(r.metadata.filesModified).toEqual([`${cwd}/src/index.ts`]);
	});

	it("captures token total and timestamps", () => {
		const r = scanCodexSession(jsonlPath);
		expect(r.metadata.tokenTotal).toBe(4242);
		expect(r.metadata.sessionStartedAt).toBe("2026-06-18T03:35:48.863Z");
		expect(r.metadata.sessionEndedAt).toBe("2026-06-18T03:40:00.000Z");
	});

	it("falls back to the session id in the filename when session_meta is absent", () => {
		const noMeta = path.join(tmp, "rollout-2026-06-18T09-03-53-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl");
		fs.writeFileSync(
			noMeta,
			JSON.stringify({
				type: "response_item",
				payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
			}),
		);
		const r = scanCodexSession(noMeta);
		expect(r.sessionId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
	});
});
