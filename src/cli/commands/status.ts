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
			const me = await client.getMe();
			const usage = await client.getUsage();
			const { sessions } = await client.listSessions({ limit: 1 });

			const formatLimit = (used: number, limit: number | null) =>
				limit === null ? `${used} (unlimited)` : `${used} / ${limit}`;

			console.log("CodeTeleport Status");
			console.log(`  user     : ${me.email}`);
			console.log(`  device   : ${config.deviceName}`);
			console.log(`  api      : ${config.apiUrl}`);
			console.log(`  plan     : ${usage.plan}`);
			console.log(`  sessions : ${formatLimit(usage.sessions.used, usage.sessions.limit)}`);
			console.log(`  devices  : ${formatLimit(usage.devices.used, usage.devices.limit)}`);

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
