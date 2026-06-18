import { describe, expect, it } from "vitest";
import { readAntigravityTranscript, readClaudeTranscript, readCodexTranscript } from "../core/conversion/readers";

/**
 * Conversion layer — readers turn a source agent's session into a canonical
 * transcript (ordered user/assistant messages + cwd/title). This is the lossy,
 * transcript-level IR shared by every cross-agent conversion. Readers exist for
 * all three agents (Antigravity is read-only via its brain transcript).
 */
describe("conversion readers → canonical transcript", () => {
	it("reads a Claude Code JSONL into canonical messages", () => {
		const jsonl = [
			JSON.stringify({ type: "user", cwd: "/Users/a/proj", message: { content: "first prompt" } }),
			JSON.stringify({ type: "assistant", message: { content: "an answer" } }),
			// non-message lines are ignored
			JSON.stringify({ type: "progress", message: { content: "…" } }),
			JSON.stringify({ type: "user", message: { content: "second" } }),
		].join("\n");

		const t = readClaudeTranscript(jsonl);
		expect(t.cwd).toBe("/Users/a/proj");
		expect(t.messages).toEqual([
			{ role: "user", text: "first prompt" },
			{ role: "assistant", text: "an answer" },
			{ role: "user", text: "second" },
		]);
		expect(t.title).toBe("first prompt");
	});

	it("reads Claude content given as an array of text blocks", () => {
		const jsonl = JSON.stringify({
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "hello" },
					{ type: "text", text: "world" },
				],
			},
		});
		const t = readClaudeTranscript(jsonl);
		expect(t.messages).toEqual([{ role: "assistant", text: "hello\nworld" }]);
	});

	it("reads a Codex rollout JSONL into canonical messages (ignoring developer/system)", () => {
		const jsonl = [
			JSON.stringify({ type: "session_meta", payload: { id: "x", cwd: "/Users/a/codex" } }),
			JSON.stringify({
				type: "response_item",
				payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<perms>" }] },
			}),
			JSON.stringify({
				type: "response_item",
				payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi codex" }] },
			}),
			JSON.stringify({
				type: "response_item",
				payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi back" }] },
			}),
		].join("\n");

		const t = readCodexTranscript(jsonl);
		expect(t.cwd).toBe("/Users/a/codex");
		expect(t.messages).toEqual([
			{ role: "user", text: "hi codex" },
			{ role: "assistant", text: "hi back" },
		]);
		expect(t.title).toBe("hi codex");
	});

	it("reads an Antigravity brain transcript into canonical messages", () => {
		const jsonl = [
			JSON.stringify({ type: "USER_INPUT", content: "<USER_REQUEST>build a thing</USER_REQUEST>" }),
			JSON.stringify({ type: "PLANNER_RESPONSE", content: "working on it" }),
			JSON.stringify({ type: "RUN_COMMAND", content: "ls" }), // non-conversational → ignored
			JSON.stringify({ type: "USER_INPUT", content: "thanks" }),
		].join("\n");

		const t = readAntigravityTranscript(jsonl);
		expect(t.messages).toEqual([
			{ role: "user", text: "build a thing" },
			{ role: "assistant", text: "working on it" },
			{ role: "user", text: "thanks" },
		]);
		expect(t.title).toBe("build a thing");
	});

	it("returns an empty transcript for empty input without throwing", () => {
		expect(readClaudeTranscript("").messages).toEqual([]);
		expect(readCodexTranscript("").messages).toEqual([]);
		expect(readAntigravityTranscript("").messages).toEqual([]);
	});
});
