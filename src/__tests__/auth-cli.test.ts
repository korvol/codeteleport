import { describe, expect, it, vi } from "vitest";
import { resolveApiUrl } from "../cli/api-url";

// Mock the dependencies that createApiTokenAndSave uses
vi.mock("../../client/api", () => ({
	CodeTeleportClient: vi.fn(),
}));
vi.mock("../config", () => ({
	writeConfig: vi.fn(),
}));

describe("Auth CLI --api-url", () => {
	it("resolveApiUrl returns default when flag not provided", () => {
		expect(resolveApiUrl(undefined)).toBe("https://api.codeteleport.com/v1");
	});

	it("resolveApiUrl returns custom URL for local dev", () => {
		expect(resolveApiUrl("http://localhost:8787")).toBe("http://localhost:8787/v1");
	});

	it("createApiTokenAndSave passes apiUrl to client and config", async () => {
		// This tests the contract: createApiTokenAndSave must accept apiUrl param
		// and pass it to CodeTeleportClient and writeConfig
		const { CodeTeleportClient } = await import("../../client/api");
		const { writeConfig } = await import("../config");

		const mockCreateToken = vi.fn().mockResolvedValue({ token: "ctk_live_test" });
		(CodeTeleportClient as any).mockImplementation(() => ({
			createApiToken: mockCreateToken,
		}));

		// Import the function — it should accept apiUrl as first param
		const { createApiTokenAndSave } = await import("../cli/commands/auth");

		await createApiTokenAndSave("http://localhost:8787/v1", "fake-jwt", "test@test.com");

		// Verify the client was created with the custom URL
		expect(CodeTeleportClient).toHaveBeenCalledWith({
			apiUrl: "http://localhost:8787/v1",
			token: "fake-jwt",
		});

		// Verify config was saved with the custom URL
		expect(writeConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				apiUrl: "http://localhost:8787/v1",
			}),
		);
	});
});
