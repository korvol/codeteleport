import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { configExists, readConfig } from "../config";

export const statusCommand = new Command("status")
	.description("Show CodeTeleport account and sync status")
	.action(async () => {
		if (!configExists()) {
			console.log("Not logged in. Run `codeteleport auth login` first.");
			return;
		}

		const config = readConfig();
		const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

		try {
			const { sessions, total } = await client.listSessions({ limit: 1 });

			console.log("CodeTeleport Status");
			console.log(`  device   : ${config.deviceName}`);
			console.log(`  api      : ${config.apiUrl}`);
			console.log(`  sessions : ${total} stored`);

			if (sessions.length > 0) {
				const last = sessions[0];
				const date = new Date(last.createdAt).toLocaleString();
				console.log(`  last push: ${date} (${last.sourceMachine || "unknown"})`);
			}
		} catch (err) {
			console.error(`Failed to fetch status: ${(err as Error).message}`);
			process.exit(1);
		}
	});
