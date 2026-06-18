import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { unbundleSession } from "../../core/unbundle";
import { DEFAULT_AGENT_ID } from "../../shared/constants";
import { pickCloudSession } from "../cloud-session-picker";
import { readConfig } from "../config";

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

export const pullCommand = new Command("pull")
	.description("Pull a session from CodeTeleport to this machine")
	.option("--session-id <id>", "Pull a specific session")
	.option("--version <n>", "Pull a specific version", Number)
	.option("--target-dir <path>", "Anchor session at this directory (defaults to current directory)")
	.option("--machine <name>", "Filter by source machine")
	.option("--agent <id>", "List sessions for a specific agent (claude-code|codex|antigravity)")
	.option("--all", "List sessions from all agents (overrides the default agent scope)")
	.action(async (opts) => {
		try {
			const config = readConfig();
			const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

			let sessionId: string;

			if (opts.sessionId) {
				// Explicit id pulls any session regardless of agent (restores natively).
				sessionId = opts.sessionId;
			} else {
				// Picker defaults to the configured agent; --all / --agent widen it.
				const agentFilter = opts.all ? undefined : (opts.agent ?? config.agent ?? DEFAULT_AGENT_ID);
				const { sessions } = await client.listSessions({
					machine: opts.machine,
					agent: agentFilter,
					limit: 20,
				});

				const picked = await pickCloudSession(sessions, prompt);
				if (!picked) {
					console.log(sessions.length === 0 ? "No sessions found in the cloud." : "Cancelled.");
					return;
				}

				sessionId = picked.sessionId;
			}

			const targetDir = opts.targetDir || process.cwd();

			console.log("Downloading...");
			const { downloadUrl, version, session } = await client.getDownloadUrl(sessionId, opts.version);

			const tmpFile = path.join(os.tmpdir(), `codeteleport-${sessionId}.tar.gz`);
			try {
				await client.downloadBundle(downloadUrl, tmpFile);

				console.log("Installing...");
				// Resume command is derived from the bundle's own agent inside unbundle.
				const result = await unbundleSession({
					bundlePath: tmpFile,
					targetDir,
				});

				console.log("");
				console.log("Session pulled");
				console.log(`  id      : ${result.sessionId}`);
				console.log(`  version : ${version}`);
				console.log(`  from    : ${session.sourceMachine || "unknown"}`);
				console.log(`  to      : ${result.installedTo}`);
				console.log("");
				console.log(`Resume with: ${result.resumeCommand}`);
			} finally {
				try {
					fs.unlinkSync(tmpFile);
				} catch {}
			}
		} catch (err) {
			console.error(`Pull failed: ${(err as Error).message}`);
			process.exit(1);
		}
	});
