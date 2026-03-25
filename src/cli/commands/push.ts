import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { bundleSession } from "../../core/bundle";
import { detectCurrentSession, listLocalSessions } from "../../core/session";
import { readConfig } from "../config";

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

		// Detect session
		let sessionId: string;
		let cwd: string;

		if (opts.sessionId) {
			sessionId = opts.sessionId;
			// Find the cwd for this session from local files
			const locals = listLocalSessions();
			const match = locals.find((s) => s.sessionId === opts.sessionId);
			if (!match) {
				console.error(`Session ${opts.sessionId} not found in local Claude Code data`);
				process.exit(1);
			}
			cwd = match.cwd;
		} else {
			try {
				const session = detectCurrentSession();
				sessionId = session.sessionId;
				cwd = session.cwd;
			} catch {
				console.error("Could not detect current session. Use --session-id or run from inside Claude Code.");
				process.exit(1);
			}
		}

		log(`Bundling session ${sessionId}...`);

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
