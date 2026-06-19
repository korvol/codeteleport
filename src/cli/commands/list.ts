import readline from "node:readline";
import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { scanLocalSessionsForAgent } from "../../core/agents/dispatch";
import { bundleSession } from "../../core/bundle";
import { DEFAULT_AGENT_ID } from "../../shared/constants";
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
	.option("--agent <id>", "Filter cloud sessions by agent (claude-code|codex|antigravity)")
	.option("--all", "Show cloud sessions from all agents (overrides the default agent scope)")
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

function configuredAgent(): string {
	try {
		return readConfig().agent ?? DEFAULT_AGENT_ID;
	} catch {
		return DEFAULT_AGENT_ID;
	}
}

async function listLocal(opts: { push?: boolean; json?: boolean }) {
	const agentId = configuredAgent();
	const sessions = scanLocalSessionsForAgent(agentId);

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
		console.error('\nCodeTeleport is not configured yet. Run "codeteleport setup" to get started.');
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
				agentId: configuredAgent(),
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

async function listCloud(opts: {
	machine?: string;
	tag?: string;
	agent?: string;
	all?: boolean;
	limit?: string;
	json?: boolean;
}) {
	const config = readConfig();
	const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

	// Default scope: the configured agent. --all clears it; --agent <id> overrides.
	const agentFilter = opts.all ? undefined : (opts.agent ?? config.agent ?? DEFAULT_AGENT_ID);

	const { sessions, total } = await client.listSessions({
		machine: opts.machine,
		tag: opts.tag,
		agent: agentFilter,
		limit: Number.parseInt(opts.limit || "20", 10),
	});

	if (sessions.length === 0) {
		console.log(
			agentFilter
				? `No cloud sessions found for agent "${agentFilter}". Use --all to see other agents, or --agent <id> to pick one.`
				: "No cloud sessions found.",
		);
		return;
	}

	if (opts.json) {
		console.log(JSON.stringify(sessions, null, 2));
		return;
	}

	const scope = agentFilter ? ` for ${agentFilter}` : "";
	console.log(`\nCloud sessions${scope} (${sessions.length} of ${total}):\n`);
	for (let i = 0; i < sessions.length; i++) {
		console.log(formatCloudSessionRow(i + 1, sessions[i]));
	}
	if (agentFilter) {
		console.log("\n(showing only your configured agent — use --all for every agent, or --agent <id>)");
	}
	console.log("\nPull into another agent's format with: codeteleport pull <id> --as <claude-code|codex|antigravity>");
}
