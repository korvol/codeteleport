import readline from "node:readline";
import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { bundleSession } from "../../core/bundle";
import { scanProjectSessions } from "../../core/local";
import { detectCurrentSession } from "../../core/session";
import { readConfig } from "../config";
import { formatSessionRow, pickSession } from "../session-picker";

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

export const pushCommand = new Command("push")
	.description("Push the current session to CodeTeleport")
	.option("--session-id <id>", "Session ID (auto-detected if inside Claude Code)")
	.option("--label <text>", "Label for the session")
	.option("--tags <tags>", "Comma-separated tags", (val) => val.split(","))
	.option("--silent", "Suppress output (for auto-sync hooks)")
	.action(async (opts) => {
		const config = readConfig();
		const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });
		const log = opts.silent ? () => {} : console.log;

		let sessionId: string;
		let cwd: string;

		if (opts.sessionId) {
			// Explicit session ID — find it in local data
			const sessions = scanProjectSessions(process.cwd());
			const match = sessions.find((s) => s.sessionId === opts.sessionId || s.sessionId.startsWith(opts.sessionId));
			if (!match) {
				console.error(`Session ${opts.sessionId} not found in local Claude Code data`);
				process.exit(1);
			}
			sessionId = match.sessionId;
			cwd = match.projectPath;
		} else {
			// Try process tree detection first (running inside Claude Code)
			try {
				const session = detectCurrentSession();
				sessionId = session.sessionId;
				cwd = session.cwd;
			} catch {
				// Fall back to scanning current directory for sessions
				const sessions = scanProjectSessions(process.cwd());

				if (sessions.length === 0) {
					console.error("No Claude Code sessions found for this directory.");
					console.error("Run this from a project directory where you've used Claude Code.");
					process.exit(1);
				}

				const picked = await pickSession(sessions, prompt, log);
				if (!picked) {
					console.log("Cancelled.");
					process.exit(0);
				}

				sessionId = picked.sessionId;
				cwd = picked.projectPath;
			}
		}

		// Show session summary before pushing
		const sessions = scanProjectSessions(cwd);
		const current = sessions.find((s) => s.sessionId === sessionId);
		if (current) {
			log("");
			log("Pushing session:");
			log(formatSessionRow(1, current));
			log("");
		}

		log("Bundling...");

		// Bundle
		const bundle = await bundleSession({ sessionId, cwd });

		log(`  size: ${(bundle.sizeBytes / 1024).toFixed(0)} KB`);

		// Upload
		try {
			const { uploadUrl } = await client.initiateUpload({
				sessionId: bundle.sessionId,
				sourceMachine: config.deviceName,
				sourceCwd: bundle.sourceCwd,
				sourceUserDir: bundle.sourceUserDir,
				sizeBytes: bundle.sizeBytes,
				checksum: bundle.checksum,
				metadata: bundle.metadata,
				tags: opts.tags,
				label: opts.label,
			});

			log("Uploading...");
			await client.uploadBundle(uploadUrl, bundle.bundlePath);

			log("Confirming...");
			await client.confirmUpload(bundle.sessionId);

			log("");
			log("Session teleported to CodeTeleport");
			log(`  id      : ${bundle.sessionId}`);
			log(`  size    : ${(bundle.sizeBytes / 1024).toFixed(0)} KB`);
			log(`  machine : ${config.deviceName}`);
		} catch (err) {
			console.error(`Push failed: ${(err as Error).message}`);
			process.exit(1);
		} finally {
			// Clean up bundle file
			const fs = require("node:fs") as typeof import("node:fs");
			try {
				fs.unlinkSync(bundle.bundlePath);
			} catch {}
		}
	});
