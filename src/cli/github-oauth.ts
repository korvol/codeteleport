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
	throw new Error("Not implemented");
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
	throw new Error("Not implemented");
}
