import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { readConfig } from "../config";

export const listCommand = new Command("list")
	.description("List sessions stored in CodeTeleport")
	.option("--machine <name>", "Filter by source machine")
	.option("--tag <tag>", "Filter by tag")
	.option("--limit <n>", "Max results", "20")
	.action(async (opts) => {
		const config = readConfig();
		const client = new CodeTeleportClient({ apiUrl: config.apiUrl, token: config.token });

		const { sessions, total } = await client.listSessions({
			machine: opts.machine,
			tag: opts.tag,
			limit: Number.parseInt(opts.limit, 10),
		});

		if (sessions.length === 0) {
			console.log("No sessions found.");
			return;
		}

		console.log(`Sessions (${sessions.length} of ${total}):\n`);

		for (const s of sessions) {
			const date = new Date(s.createdAt).toLocaleString();
			const machine = s.sourceMachine || "unknown";
			const label = s.label ? ` "${s.label}"` : "";
			const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
			const size = `${(s.sizeBytes / 1024).toFixed(0)} KB`;
			const msgs = s.metadata?.messageCount ? `${s.metadata.messageCount} msgs` : "";
			const model = s.metadata?.claudeModel || "";

			console.log(`  ${s.id.slice(0, 8)}  ${machine}  ${s.sourceCwd}`);
			console.log(`           ${date}  ${size}  ${msgs}  ${model}${label}${tags}`);
			console.log("");
		}
	});
