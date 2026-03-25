#!/usr/bin/env node
import { Command } from "commander";
import { authCommand } from "./commands/auth";
import { deleteCommand } from "./commands/delete";
import { listCommand } from "./commands/list";
import { pullCommand } from "./commands/pull";
import { pushCommand } from "./commands/push";
import { statusCommand } from "./commands/status";

const program = new Command();

program.name("codeteleport").description("Teleport Claude Code sessions between machines").version("0.1.0");

program.addCommand(authCommand);
program.addCommand(pushCommand);
program.addCommand(pullCommand);
program.addCommand(listCommand);
program.addCommand(statusCommand);
program.addCommand(deleteCommand);

program.parse();
