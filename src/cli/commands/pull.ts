import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { unbundleSession } from "../../core/unbundle";
import { readConfig } from "../config";

export const pullCommand = new Command("pull")
	.description("Pull a session from CodeTeleport to this machine")
	.option("--session-id <id>", "Pull a specific session")
	.option("--machine <name>", "Filter by source machine")
	.action(async (opts) => {
		const config = readConfig();
		const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

		let sessionId: string;

		if (opts.sessionId) {
			sessionId = opts.sessionId;
		} else {
			// List sessions for selection
			const { sessions } = await client.listSessions({
				machine: opts.machine,
				limit: 10,
			});

			if (sessions.length === 0) {
				console.log("No sessions found.");
				process.exit(0);
			}

			console.log("Available sessions:\n");
			for (let i = 0; i < sessions.length; i++) {
				const s = sessions[i];
				const date = new Date(s.createdAt).toLocaleString();
				const machine = s.sourceMachine || "unknown";
				const label = s.label ? ` (${s.label})` : "";
				const msgs = s.metadata?.messageCount ? ` ${s.metadata.messageCount} msgs` : "";
				console.log(`  ${i + 1}. ${s.id.slice(0, 8)}  ${machine}  ${s.sourceCwd}  ${date}${label}${msgs}`);
			}

			// Use first session by default (most recent)
			console.log(`\nPulling most recent: ${sessions[0].id.slice(0, 8)}`);
			sessionId = sessions[0].id;
		}

		// Download
		console.log("Downloading...");
		const { downloadUrl, session } = await client.getDownloadUrl(sessionId);

		const tmpFile = path.join(os.tmpdir(), `codeteleport-${sessionId}.tar.gz`);
		try {
			await client.downloadBundle(downloadUrl, tmpFile);

			// Unbundle
			console.log("Installing...");
			const result = await unbundleSession({ bundlePath: tmpFile });

			console.log("");
			console.log("Session installed");
			console.log(`  id   : ${result.sessionId}`);
			console.log(`  from : ${session.sourceMachine || "unknown"}`);
			console.log(`  to   : ${result.installedTo}`);
			console.log("");
			console.log(`Resume with: ${result.resumeCommand}`);
		} catch (err) {
			console.error(`Pull failed: ${(err as Error).message}`);
			process.exit(1);
		} finally {
			try {
				fs.unlinkSync(tmpFile);
			} catch {}
		}
	});
