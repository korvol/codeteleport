import http from "node:http";
import os from "node:os";
import readline from "node:readline";
import { Command } from "commander";
import open from "open";
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

async function loginWithEmail(register: boolean) {
	const email = await prompt("Email: ");
	const password = await promptPassword("Password: ");

	const client = new CodeTeleportClient({ apiUrl: API_URL, token: "" });

	let jwt: string;
	try {
		if (register) {
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

	await createApiTokenAndSave(jwt, email);
}

async function loginWithGitHub() {
	const apiBase = API_URL.replace(/\/v1$/, "");

	return new Promise<void>((resolve, reject) => {
		const server = http.createServer(async (req, res) => {
			const url = new URL(req.url || "/", "http://localhost");

			if (url.pathname === "/callback") {
				const token = url.searchParams.get("token");
				const error = url.searchParams.get("error");

				if (error) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end("<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>");
					server.close();
					reject(new Error(`GitHub login failed: ${error}`));
					return;
				}

				if (token) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(
						"<html><body><h2>Logged in to CodeTeleport!</h2><p>You can close this tab and return to the terminal.</p></body></html>",
					);
					server.close();

					try {
						await createApiTokenAndSave(token);
						resolve();
					} catch (err) {
						reject(err);
					}
					return;
				}
			}

			res.writeHead(404);
			res.end();
		});

		server.listen(0, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("Failed to start local server"));
				return;
			}

			const port = address.port;
			const authUrl = `${apiBase}/v1/auth/github?cli_port=${port}`;

			console.log("Opening browser for GitHub login...");
			console.log(`If the browser doesn't open, visit: ${authUrl}`);

			open(authUrl).catch(() => {
				// Browser open failed — user can manually visit the URL
			});
		});

		// Timeout after 2 minutes
		setTimeout(() => {
			server.close();
			reject(new Error("Login timed out. Please try again."));
		}, 120_000);
	});
}

async function createApiTokenAndSave(jwt: string, email?: string) {
	const deviceName = os.hostname().replace(/\.local$/, "");
	const authedClient = new CodeTeleportClient({ apiUrl: API_URL, token: jwt });

	try {
		const { token: apiToken } = await authedClient.createApiToken(deviceName);

		writeConfig({
			token: apiToken,
			apiUrl: API_URL,
			deviceName,
		});

		if (email) {
			console.log(`\nLogged in as ${email}`);
		} else {
			console.log("\nLogged in via GitHub");
		}
		console.log(`Device: ${deviceName}`);
		console.log("Config saved to ~/.codeteleport/config.json");
	} catch (err) {
		console.error(`Failed to create API token: ${(err as Error).message}`);
		process.exit(1);
	}
}

export const authCommand = new Command("auth").description("Manage authentication");

authCommand
	.command("login")
	.description("Log in to CodeTeleport")
	.option("--register", "Create a new account")
	.option("--github", "Log in with GitHub")
	.option("--email", "Log in with email and password")
	.action(async (opts) => {
		let method: "github" | "email";

		if (opts.github) {
			method = "github";
		} else if (opts.email || opts.register) {
			method = "email";
		} else {
			// Interactive prompt — GitHub first
			const choice = await prompt("How do you want to log in?\n  1) GitHub\n  2) Email & Password\n> ");
			method = choice === "2" ? "email" : "github";
		}

		if (method === "github") {
			try {
				await loginWithGitHub();
			} catch (err) {
				console.error((err as Error).message);
				process.exit(1);
			}
		} else {
			await loginWithEmail(!!opts.register);
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
