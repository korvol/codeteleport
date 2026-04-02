import { describe, expect, it } from "vitest";
import { getAgent, getDefaultAgent, getSupportedAgents } from "../shared/agents";

describe("Agent Registry", () => {
	describe("getAgent", () => {
		it("returns claude-code config for valid ID", () => {
			const agent = getAgent("claude-code");
			expect(agent.id).toBe("claude-code");
			expect(agent.name).toBe("Claude Code");
			expect(agent.sessionDir).toContain(".claude");
			expect(agent.sessionFilePattern).toBe("*.jsonl");
			expect(agent.resumeCommand).toBe("claude --resume");
			expect(agent.detectProcess).toBe("claude");
			expect(agent.mcpAddCommand).toContain("claude mcp add");
		});

		it("returns claude-code when ID is undefined (default)", () => {
			const agent = getAgent(undefined);
			expect(agent.id).toBe("claude-code");
		});

		it("returns claude-code when ID is empty string", () => {
			const agent = getAgent("");
			expect(agent.id).toBe("claude-code");
		});

		it("throws for unknown agent ID", () => {
			expect(() => getAgent("cursor")).toThrow("Unknown agent: cursor");
			expect(() => getAgent("cursor")).toThrow("Supported:");
		});
	});

	describe("getDefaultAgent", () => {
		it("returns claude-code", () => {
			const agent = getDefaultAgent();
			expect(agent.id).toBe("claude-code");
			expect(agent.name).toBe("Claude Code");
		});
	});

	describe("getSupportedAgents", () => {
		it("returns an array with at least one agent", () => {
			const agents = getSupportedAgents();
			expect(agents.length).toBeGreaterThan(0);
		});

		it("includes claude-code", () => {
			const agents = getSupportedAgents();
			expect(agents.some((a) => a.id === "claude-code")).toBe(true);
		});
	});

	describe("AgentConfig fields", () => {
		it("sessionDir is an absolute path pattern", () => {
			const agent = getAgent("claude-code");
			expect(agent.sessionDir).toMatch(/^\//);
		});

		it("resumeCommand is a valid command string", () => {
			const agent = getAgent("claude-code");
			expect(agent.resumeCommand).not.toBe("");
		});
	});
});
