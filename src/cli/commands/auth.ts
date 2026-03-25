import os from "node:os";
import readline from "node:readline";
import { Command } from "commander";
import { CodeTeleportClient } from "../../client/api";
import { API_URL } from "../../shared/constants";
import { writeConfig } from "../config";

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

function promptPassword(question: string): Promise<string> {
	return prompt(question);
}

export const authCommand = new Command("auth").description("Manage authentication");

authCommand
	.command("login")
	.description("Log in to CodeTeleport")
	.option("--register", "Create a new account")
	.action(async (opts) => {
		const email = await prompt("Email: ");
		const password = await promptPassword("Password: ");

		const client = new CodeTeleportClient({ apiUrl: API_URL, token: "" });

		let jwt: string;
		try {
			if (opts.register) {
				const result = await client.register(email, password);
				jwt = result.token;
				console.log(`Account created for ${email}`);
			} else {
				const result = await client.login(email, password);
				jwt = result.token;
			}
		} catch (err) {
			console.error(`Authentication failed: ${(err as Error).message}`);
			process.exit(1);
		}

		// Create a long-lived API token for this device
		const deviceName = os.hostname().replace(/\.local$/, "");
		const authedClient = new CodeTeleportClient({ apiUrl: API_URL, token: jwt });

		try {
			const { token: apiToken } = await authedClient.createApiToken(deviceName);

			writeConfig({
				token: apiToken,
				apiUrl: API_URL,
				deviceName,
			});

			console.log(`\nLogged in as ${email}`);
			console.log(`Device: ${deviceName}`);
			console.log("Config saved to ~/.codeteleport/config.json");
		} catch (err) {
			console.error(`Failed to create API token: ${(err as Error).message}`);
			process.exit(1);
		}
	});

authCommand
	.command("logout")
	.description("Remove local credentials")
	.action(() => {
		const fs = require("node:fs") as typeof import("node:fs");
		const { CONFIG_FILE } = require("../../shared/constants") as typeof import("../../shared/constants");
		try {
			fs.unlinkSync(CONFIG_FILE);
			console.log("Logged out. Config removed.");
		} catch {
			console.log("Already logged out.");
		}
	});
