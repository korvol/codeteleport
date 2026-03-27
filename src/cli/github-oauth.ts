import http from "node:http";

export type LoginMethod = "github" | "email";

export type LoginFlags = {
	github?: boolean;
	email?: boolean;
	register?: boolean;
};

/**
 * Resolves which login method to use based on CLI flags.
 * If no flag is set, prompts the user interactively.
 */
export async function resolveLoginMethod(
	flags: LoginFlags,
	promptFn: (question: string) => Promise<string>,
): Promise<LoginMethod> {
	if (flags.github) return "github";
	if (flags.email || flags.register) return "email";

	const choice = await promptFn("How do you want to log in?\n  1) GitHub\n  2) Email & Password\n> ");
	return choice === "2" ? "email" : "github";
}

/**
 * Starts a local HTTP server that listens for the GitHub OAuth callback.
 * Returns the port and a promise that resolves with the JWT token.
 */
export async function startOAuthCallbackServer(): Promise<{
	port: number;
	tokenPromise: Promise<string>;
	close: () => void;
}> {
	return new Promise((resolveSetup) => {
		let resolveToken: (token: string) => void;
		let rejectToken: (err: Error) => void;

		const tokenPromise = new Promise<string>((res, rej) => {
			resolveToken = res;
			rejectToken = rej;
		});
		// Prevent unhandled rejection — caller is expected to await this
		tokenPromise.catch(() => {});

		const server = http.createServer((req, res) => {
			const url = new URL(req.url || "/", "http://localhost");

			if (url.pathname === "/callback") {
				const token = url.searchParams.get("token");
				const error = url.searchParams.get("error");

				res.writeHead(200, { "Content-Type": "text/html" });

				if (error) {
					res.end(
						"<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>",
						() => {
							setTimeout(() => {
								server.close();
								rejectToken(new Error(error));
							}, 500);
						},
					);
					return;
				}

				if (token) {
					res.end(
						"<html><body><h2>Logged in to CodeTeleport!</h2><p>You can close this tab and return to the terminal.</p></body></html>",
						() => {
							setTimeout(() => {
								server.close();
								resolveToken(token);
							}, 500);
						},
					);
					return;
				}
			}

			res.writeHead(404);
			res.end();
		});

		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;

			resolveSetup({
				port,
				tokenPromise,
				close: () => server.close(),
			});
		});
	});
}
