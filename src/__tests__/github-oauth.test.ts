import { afterEach, describe, expect, it } from "vitest";
import { resolveLoginMethod, startOAuthCallbackServer } from "../cli/github-oauth";

describe("resolveLoginMethod", () => {
	const noopPrompt = async () => "";

	it("returns github when --github flag is set", async () => {
		expect(await resolveLoginMethod({ github: true }, noopPrompt)).toBe("github");
	});

	it("returns email when --email flag is set", async () => {
		expect(await resolveLoginMethod({ email: true }, noopPrompt)).toBe("email");
	});

	it("returns email when --register flag is set", async () => {
		expect(await resolveLoginMethod({ register: true }, noopPrompt)).toBe("email");
	});

	it("prompts and returns github when user picks 1", async () => {
		expect(await resolveLoginMethod({}, async () => "1")).toBe("github");
	});

	it("prompts and returns email when user picks 2", async () => {
		expect(await resolveLoginMethod({}, async () => "2")).toBe("email");
	});

	it("defaults to github for empty input", async () => {
		expect(await resolveLoginMethod({}, async () => "")).toBe("github");
	});
});

describe("startOAuthCallbackServer", () => {
	let closeFn: (() => void) | undefined;

	afterEach(() => {
		if (closeFn) {
			closeFn();
			closeFn = undefined;
		}
	});

	it("resolves with token on successful callback", async () => {
		const { port, tokenPromise, close } = await startOAuthCallbackServer();
		closeFn = close;

		await fetch(`http://localhost:${port}/callback?token=test-jwt-token`);

		const token = await tokenPromise;
		expect(token).toBe("test-jwt-token");
	});

	it("rejects on error callback", async () => {
		const { port, tokenPromise, close } = await startOAuthCallbackServer();
		closeFn = close;

		await fetch(`http://localhost:${port}/callback?error=access_denied`);

		await expect(tokenPromise).rejects.toThrow("access_denied");
	});

	it("returns 404 for unknown paths", async () => {
		const { port, tokenPromise, close } = await startOAuthCallbackServer();
		closeFn = close;

		const res = await fetch(`http://localhost:${port}/unknown`);
		expect(res.status).toBe(404);

		// Clean up — send a valid callback so tokenPromise resolves
		await fetch(`http://localhost:${port}/callback?token=cleanup`);
		await tokenPromise;
	});

	it("listens on a random available port", async () => {
		const { port, tokenPromise, close } = await startOAuthCallbackServer();
		closeFn = close;

		expect(port).toBeGreaterThan(0);
		expect(port).toBeLessThan(65536);

		// Clean up
		await fetch(`http://localhost:${port}/callback?token=cleanup`);
		await tokenPromise;
	});
});
