import os from "node:os";
import path from "node:path";

export interface AgentConfig {
	id: string;
	name: string;
	sessionDir: string;
	sessionFilePattern: string;
	resumeCommand: string;
	detectProcess?: string;
	mcpAddCommand?: string;
}

const AGENTS: Record<string, AgentConfig> = {
	"claude-code": {
		id: "claude-code",
		name: "Claude Code",
		sessionDir: path.join(os.homedir(), ".claude", "projects"),
		sessionFilePattern: "*.jsonl",
		resumeCommand: "claude --resume",
		detectProcess: "claude",
		mcpAddCommand: "claude mcp add codeteleport -- codeteleport-mcp",
	},
};

export function getAgent(id?: string): AgentConfig {
	const agentId = id || "claude-code";
	const agent = AGENTS[agentId];
	if (!agent) {
		throw new Error(`Unknown agent: ${agentId}. Supported: ${Object.keys(AGENTS).join(", ")}`);
	}
	return agent;
}

export function getDefaultAgent(): AgentConfig {
	return AGENTS["claude-code"];
}

export function getSupportedAgents(): AgentConfig[] {
	return Object.values(AGENTS);
}
