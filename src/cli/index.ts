#!/usr/bin/env node
import { Command } from "commander";
import { authCommand } from "./commands/auth";
import { configCommand } from "./commands/config";
import { deleteCommand } from "./commands/delete";
import { listCommand } from "./commands/list";
import { pullCommand } from "./commands/pull";
import { pushCommand } from "./commands/push";
import { setupCommand } from "./commands/setup";
import { statusCommand } from "./commands/status";
import { versionsCommand } from "./commands/versions";

const program = new Command();

program.name("codeteleport").description("Teleport AI coding sessions between machines").version("0.2.1");

program.addCommand(setupCommand);
program.addCommand(authCommand);
program.addCommand(pushCommand);
program.addCommand(pullCommand);
program.addCommand(listCommand);
program.addCommand(statusCommand);
program.addCommand(versionsCommand);
program.addCommand(configCommand);
program.addCommand(deleteCommand);

// Global error handler — catches unhandled errors from any command
// Shows clean message instead of stack trace
process.on("uncaughtException", (err) => {
	console.error(err.message);
	process.exit(1);
});

process.on("unhandledRejection", (err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});

program.parse();
