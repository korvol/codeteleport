import readline from "node:readline";
import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { bundleSession } from "../../core/bundle";
import { scanLocalSessions } from "../../core/local";
import { formatCloudSessionRow } from "../cloud-session-picker";
import { readConfig } from "../config";
import { parseSessionSelection, resolveListMode } from "../list-mode";
import { formatSessionRow } from "../session-picker";

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

export const listCommand = new Command("list")
	.description("List sessions")
	.option("--local", "List local sessions on this machine")
	.option("--cloud", "List cloud sessions")
	.option("--push", "Interactive push mode (local only)")
	.option("--json", "Output as JSON")
	.option("--machine <name>", "Filter by source machine (cloud only)")
	.option("--tag <tag>", "Filter by tag (cloud only)")
	.option("--limit <n>", "Max results (cloud only)", "20")
	.action(async (opts) => {
		try {
			const mode = await resolveListMode(opts, prompt);

			if (mode === "local") {
				await listLocal(opts);
			} else {
				await listCloud(opts);
			}
		} catch (err) {
			console.error(`List failed: ${(err as Error).message}`);
			process.exit(1);
		}
	});

async function listLocal(opts: { push?: boolean; json?: boolean }) {
	const sessions = scanLocalSessions();

	if (sessions.length === 0) {
		console.log("No local AI coding sessions found.");
		return;
	}

	if (opts.json) {
		console.log(JSON.stringify(sessions, null, 2));
		return;
	}

	console.log(`\nLocal sessions (${sessions.length} found):\n`);
	for (let i = 0; i < sessions.length; i++) {
		console.log(formatSessionRow(i + 1, sessions[i]));
	}

	if (!opts.push) return;

	// Interactive push mode
	let config: ReturnType<typeof readConfig>;
	try {
		config = readConfig();
	} catch {
		console.error('\nNot logged in. Run "codeteleport auth login" first.');
		return;
	}

	console.log("");
	const input = await prompt('Enter session numbers to push (comma-separated), "all", or "q" to quit:\n> ');
	const selection = parseSessionSelection(input, sessions.length);

	if (selection === null) {
		console.log("Cancelled.");
		return;
	}

	const indices = selection === "all" ? sessions.map((_, i) => i) : selection;

	if (indices.length === 0) {
		console.log("No valid sessions selected.");
		return;
	}

	const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });
	let pushed = 0;

	for (const idx of indices) {
		const session = sessions[idx];
		const name = session.projectName;
		const id = session.sessionId.slice(0, 8);

		try {
			process.stdout.write(`Pushing ${name} (${id})...`);

			const bundle = await bundleSession({
				sessionId: session.sessionId,
				cwd: session.projectPath,
			});

			const { uploadUrl } = await client.initiateUpload({
				sessionId: bundle.sessionId,
				sourceMachine: config.deviceName,
				sourceCwd: bundle.sourceCwd,
				sourceUserDir: bundle.sourceUserDir,
				sizeBytes: bundle.sizeBytes,
				checksum: bundle.checksum,
				metadata: bundle.metadata,
			});

			await client.uploadBundle(uploadUrl, bundle.bundlePath);
			await client.confirmUpload(bundle.sessionId);

			const size =
				bundle.sizeBytes < 1024 * 1024
					? `${(bundle.sizeBytes / 1024).toFixed(0)} KB`
					: `${(bundle.sizeBytes / (1024 * 1024)).toFixed(1)} MB`;

			console.log(` \u2713 ${size}`);
			pushed++;

			// Clean up bundle
			const fs = require("node:fs") as typeof import("node:fs");
			try {
				fs.unlinkSync(bundle.bundlePath);
			} catch {}
		} catch (err) {
			console.log(` \u2717 ${(err as Error).message}`);
		}
	}

	console.log(`\n${pushed} session${pushed !== 1 ? "s" : ""} pushed to cloud.`);
}

async function listCloud(opts: { machine?: string; tag?: string; limit?: string; json?: boolean }) {
	const config = readConfig();
	const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

	const { sessions, total } = await client.listSessions({
		machine: opts.machine,
		tag: opts.tag,
		limit: Number.parseInt(opts.limit || "20", 10),
	});

	if (sessions.length === 0) {
		console.log("No cloud sessions found.");
		return;
	}

	if (opts.json) {
		console.log(JSON.stringify(sessions, null, 2));
		return;
	}

	console.log(`\nCloud sessions (${sessions.length} of ${total}):\n`);
	for (let i = 0; i < sessions.length; i++) {
		console.log(formatCloudSessionRow(i + 1, sessions[i]));
	}
}
