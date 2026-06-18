import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// CONFIG_DIR is resolved at module load, so each case stubs the env var and
// re-imports after resetting the module registry.
describe("CODETELEPORT_CONFIG_DIR override", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("uses CODETELEPORT_CONFIG_DIR for CONFIG_DIR and CONFIG_FILE when set", async () => {
		vi.stubEnv("CODETELEPORT_CONFIG_DIR", "/tmp/ct-e2e-config");
		vi.resetModules();
		const { CONFIG_DIR, CONFIG_FILE } = await import("../shared/constants");
		expect(CONFIG_DIR).toBe("/tmp/ct-e2e-config");
		expect(CONFIG_FILE).toBe(path.join("/tmp/ct-e2e-config", "config.json"));
	});

	it("falls back to ~/.codeteleport when the env var is unset", async () => {
		vi.stubEnv("CODETELEPORT_CONFIG_DIR", "");
		vi.resetModules();
		const { CONFIG_DIR } = await import("../shared/constants");
		expect(CONFIG_DIR).toBe(path.join(os.homedir(), ".codeteleport"));
	});
});
