import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { unbundleSession } from "../../core/unbundle";
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
	.option("--target-dir <path>", "Anchor session at this directory (defaults to current directory)")
	.option("--machine <name>", "Filter by source machine")
	.action(async (opts) => {
		const config = readConfig();
		const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

		let sessionId: string;

		if (opts.sessionId) {
			sessionId = opts.sessionId;
		} else {
			const { sessions } = await client.listSessions({
				machine: opts.machine,
				limit: 20,
			});

			const picked = await pickCloudSession(sessions, prompt);
			if (!picked) {
				console.log(sessions.length === 0 ? "No sessions found in the cloud." : "Cancelled.");
				process.exit(0);
			}

			sessionId = picked.sessionId;
		}

		// Default target dir to current working directory
		const targetDir = opts.targetDir || process.cwd();

		// Download
		console.log("Downloading...");
		const { downloadUrl, session } = await client.getDownloadUrl(sessionId);

		const tmpFile = path.join(os.tmpdir(), `codeteleport-${sessionId}.tar.gz`);
		try {
			await client.downloadBundle(downloadUrl, tmpFile);

			// Unbundle
			console.log("Installing...");
			const result = await unbundleSession({
				bundlePath: tmpFile,
				targetDir,
			});

			console.log("");
			console.log("Session pulled");
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
