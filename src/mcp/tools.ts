import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { readConfig } from "../cli/config";
import { CodeTeleportClient } from "../client/api";
import { bundleSession } from "../core/bundle";
import { scanLocalSessions } from "../core/local";
import { detectCurrentSession } from "../core/session";
import { unbundleSession } from "../core/unbundle";
import { getAgent } from "../shared/agents";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function safeToolHandler(
	handler: (args: Record<string, unknown>) => Promise<ToolResult>,
): (args: Record<string, unknown>) => Promise<ToolResult> {
	return async (args) => {
		try {
			return await handler(args);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text" as const, text: message }],
				isError: true,
			};
		}
	};
}

export function registerTools(server: McpServer) {
	server.registerTool(
		"teleport_push",
		{
			description: [
				"Push the current AI coding session to CodeTeleport cloud storage.",
				"Bundles the full conversation (JSONL, subagents, file history, paste cache, shell snapshots)",
				"and uploads it so you can resume on another machine.",
				"If the session was previously pushed, it will be overwritten with the latest version.",
				"",
				"Examples:",
				'  "teleport this session"',
				'  "push this session to the cloud"',
				'  "save this conversation so I can continue on my MacBook"',
			].join("\n"),
			inputSchema: z.object({
				label: z.string().optional().describe("Human-readable name for the session"),
				tags: z.array(z.string()).optional().describe("Tags for filtering"),
			}),
		},
		safeToolHandler(async (args) => {
			const config = readConfig();
			const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

			const session = detectCurrentSession();
			const bundle = await bundleSession({ sessionId: session.sessionId, cwd: session.cwd });

			const { uploadUrl, version } = await client.initiateUpload({
				sessionId: bundle.sessionId,
				sourceMachine: config.deviceName,
				sourceCwd: bundle.sourceCwd,
				sourceUserDir: bundle.sourceUserDir,
				sizeBytes: bundle.sizeBytes,
				checksum: bundle.checksum,
				metadata: bundle.metadata,
				tags: args.tags as string[] | undefined,
				label: args.label as string | undefined,
			});

			await client.uploadBundle(uploadUrl, bundle.bundlePath);
			await client.confirmUpload(bundle.sessionId);

			try {
				fs.unlinkSync(bundle.bundlePath);
			} catch {}

			return {
				content: [
					{
						type: "text" as const,
						text: [
							"Session teleported to CodeTeleport",
							`  id      : ${bundle.sessionId}`,
							`  version : ${version}`,
							`  size    : ${(bundle.sizeBytes / 1024).toFixed(0)} KB`,
							`  machine : ${config.deviceName}`,
							`  messages: ${bundle.metadata.messageCount || "unknown"}`,
						].join("\n"),
					},
				],
			};
		}),
	);

	server.registerTool(
		"teleport_pull",
		{
			description: [
				"Pull a session from CodeTeleport cloud to this machine.",
				"Downloads the bundle, rewrites all internal paths for this machine's username,",
				"and installs it so you can resume where you left off.",
				"",
				"If sessionId is provided, pulls that specific session.",
				"Otherwise lists available sessions for you to choose from.",
				"Use targetDir to anchor the session at a specific directory path.",
				"",
				"Examples:",
				'  "pull my session from my other machine"',
				'  "pull session abc123 to /Users/bob/projects/myapp"',
				'  "show me my available sessions"',
			].join("\n"),
			inputSchema: z.object({
				sessionId: z.string().optional().describe("Pull a specific session by ID"),
				version: z.number().optional().describe("Pull a specific version (default: latest)"),
				targetDir: z.string().optional().describe("Anchor session at this directory path"),
				machine: z.string().optional().describe("Filter by source machine name"),
				limit: z.number().optional().describe("Max sessions to list"),
			}),
		},
		safeToolHandler(async (args) => {
			const config = readConfig();
			const agent = getAgent(config.agent);
			const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

			if (args.sessionId) {
				const { downloadUrl } = await client.getDownloadUrl(
					args.sessionId as string,
					args.version as number | undefined,
				);
				const tmpFile = path.join(os.tmpdir(), `codeteleport-${args.sessionId}.tar.gz`);

				try {
					await client.downloadBundle(downloadUrl, tmpFile);
					const result = await unbundleSession({
						bundlePath: tmpFile,
						targetDir: args.targetDir as string | undefined,
						resumeCommandPrefix: agent.resumeCommand,
					});

					return {
						content: [
							{
								type: "text" as const,
								text: `Session installed\n  id: ${result.sessionId}\n  Resume with: ${result.resumeCommand}`,
							},
						],
					};
				} finally {
					try {
						fs.unlinkSync(tmpFile);
					} catch {}
				}
			}

			const { sessions } = await client.listSessions({
				machine: args.machine as string | undefined,
				limit: (args.limit as number) || 10,
			});

			if (sessions.length === 0) {
				return { content: [{ type: "text" as const, text: "No sessions found." }] };
			}

			const lines = ["Available sessions:", ""];
			for (let i = 0; i < sessions.length; i++) {
				const s = sessions[i];
				const date = new Date(s.createdAt).toLocaleString();
				const machine = s.sourceMachine || "unknown";
				const msgs = s.metadata?.messageCount ? ` ${s.metadata.messageCount} msgs` : "";
				lines.push(`  ${i + 1}. ${s.id.slice(0, 8)}  ${machine}  ${s.sourceCwd}  ${date}${msgs}`);
			}
			lines.push("", "Use teleport_pull with sessionId to pull a specific session.");

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		}),
	);

	server.registerTool(
		"teleport_list",
		{
			description: [
				"List all sessions stored in CodeTeleport cloud.",
				"Shows session ID, source machine, project path, date, size, message count, and tags.",
				"Filter by machine name or tag.",
				"",
				"Examples:",
				'  "list my teleported sessions"',
				'  "show sessions from my MacBook"',
				'  "what sessions do I have tagged as work?"',
			].join("\n"),
			inputSchema: z.object({
				machine: z.string().optional().describe("Filter by machine name"),
				tag: z.string().optional().describe("Filter by tag"),
				limit: z.number().optional().describe("Max results"),
			}),
		},
		safeToolHandler(async (args) => {
			const config = readConfig();
			const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

			const { sessions, total } = await client.listSessions({
				machine: args.machine as string | undefined,
				tag: args.tag as string | undefined,
				limit: (args.limit as number) || 20,
			});

			if (sessions.length === 0) {
				return { content: [{ type: "text" as const, text: "No sessions found." }] };
			}

			const lines = [`Sessions (${sessions.length} of ${total}):`, ""];
			for (const s of sessions) {
				const date = new Date(s.createdAt).toLocaleString();
				const machine = s.sourceMachine || "unknown";
				const label = s.label ? ` "${s.label}"` : "";
				const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
				const msgs = s.metadata?.messageCount ? `${s.metadata.messageCount} msgs` : "";
				const size = `${(s.sizeBytes / 1024).toFixed(0)} KB`;
				lines.push(`  ${s.id.slice(0, 8)}  ${machine}  ${s.sourceCwd}  ${date}  ${size}  ${msgs}${label}${tags}`);
			}

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		}),
	);

	server.registerTool(
		"teleport_status",
		{
			description: [
				"Show CodeTeleport account status and sync info.",
				"Displays device name, API URL, total sessions stored, and last push time.",
				"",
				"Examples:",
				'  "what\'s my CodeTeleport status?"',
				'  "how many sessions do I have stored?"',
			].join("\n"),
		},
		safeToolHandler(async () => {
			const config = readConfig();
			const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

			const me = await client.getMe();
			const usage = await client.getUsage();
			const { sessions } = await client.listSessions({ limit: 1 });

			const formatLimit = (used: number, limit: number | null) =>
				limit === null ? `${used} (unlimited)` : `${used} / ${limit}`;

			const lines = [
				"CodeTeleport Status",
				`  user     : ${me.email}`,
				`  device   : ${config.deviceName}`,
				`  api      : ${config.apiUrl}`,
				`  plan     : ${usage.plan}`,
				`  sessions : ${formatLimit(usage.sessions.used, usage.sessions.limit)}`,
				`  devices  : ${formatLimit(usage.devices.used, usage.devices.limit)}`,
			];

			if (sessions.length > 0) {
				const last = sessions[0];
				const date = new Date(last.createdAt).toLocaleString();
				lines.push(`  last push: ${date} (${last.sourceMachine || "unknown"})`);
			}

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		}),
	);

	server.registerTool(
		"teleport_local_list",
		{
			description: [
				"List all coding sessions on the local machine.",
				"Scans the agent's local data directory for session files and shows session ID,",
				"project name, message count, timestamps, and file size.",
				"No cloud access needed — reads directly from the local filesystem.",
				"",
				"Examples:",
				'  "show me my local sessions"',
				'  "what sessions do I have on this machine"',
				'  "list local coding conversations"',
			].join("\n"),
		},
		safeToolHandler(async () => {
			const sessions = scanLocalSessions();

			if (sessions.length === 0) {
				return { content: [{ type: "text" as const, text: "No local AI coding sessions found." }] };
			}

			const lines = [`Local sessions (${sessions.length} found):`, ""];
			for (const s of sessions) {
				const id = s.sessionId;
				const size =
					s.sizeBytes < 1024 * 1024
						? `${(s.sizeBytes / 1024).toFixed(0)} KB`
						: `${(s.sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
				const time = s.lastMessageAt ? new Date(s.lastMessageAt).toLocaleString() : "unknown";
				lines.push(`  ${id}  ${s.projectName}  ${s.messageCount} msgs  ${time}  ${size}`);
			}

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		}),
	);

	server.registerTool(
		"teleport_versions",
		{
			description: [
				"Show version history for a session stored in CodeTeleport.",
				"Returns all versions with size, checksum, and timestamp.",
				"",
				"Examples:",
				'  "show me the versions of this session"',
				'  "what versions do I have for c3a05473"',
			].join("\n"),
			inputSchema: z.object({
				sessionId: z.string().describe("Session ID to get versions for"),
			}),
		},
		safeToolHandler(async (args) => {
			const config = readConfig();
			const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

			const result = await client.getVersions(args.sessionId as string);

			if (result.versions.length === 0) {
				return { content: [{ type: "text" as const, text: "No versions found for this session." }] };
			}

			const lines = [
				`Session ${result.sessionId} — ${result.versions.length} version${result.versions.length !== 1 ? "s" : ""}`,
				`  Version limit: ${result.limit} (${result.limit <= 2 ? "free" : "pro"} plan)`,
				"",
			];

			for (const v of result.versions) {
				const size =
					v.sizeBytes < 1024 * 1024
						? `${(v.sizeBytes / 1024).toFixed(0)} KB`
						: `${(v.sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
				const latest = v.version === result.currentVersion ? " (latest)" : "";
				lines.push(`  v${v.version}  ${size}  ${new Date(v.createdAt).toLocaleString()}${latest}`);
			}

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		}),
	);

	server.registerTool(
		"teleport_delete",
		{
			description: [
				"Delete a session from CodeTeleport cloud.",
				"Permanently removes the session bundle from cloud storage. Cannot be undone.",
				"",
				"Examples:",
				'  "delete session c3a05473-9f12-4a2b-ae27-9478ab66d216"',
				'  "remove my old teleported session"',
			].join("\n"),
			inputSchema: z.object({
				sessionId: z.string().describe("Full session ID to delete"),
			}),
		},
		safeToolHandler(async (args) => {
			const config = readConfig();
			const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

			await client.deleteSession(args.sessionId as string);
			return { content: [{ type: "text" as const, text: `Session ${args.sessionId} deleted.` }] };
		}),
	);
}
