import readline from "node:readline";
import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { readConfig } from "../config";

function confirm(question: string): Promise<boolean> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim().toLowerCase() === "y");
		});
	});
}

export const deleteCommand = new Command("delete")
	.description("Delete a session from CodeTeleport")
	.argument("<session-id>", "Session ID to delete")
	.option("-y, --yes", "Skip confirmation")
	.action(async (sessionId: string, opts) => {
		const config = readConfig();
		const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

		if (!opts.yes) {
			const confirmed = await confirm(`Delete session ${sessionId}? (y/N) `);
			if (!confirmed) {
				console.log("Cancelled.");
				return;
			}
		}

		try {
			await client.deleteSession(sessionId);
			console.log(`Session ${sessionId} deleted.`);
		} catch (err) {
			console.error(`Delete failed: ${(err as Error).message}`);
			process.exit(1);
		}
	});
