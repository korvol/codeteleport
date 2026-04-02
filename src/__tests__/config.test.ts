import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configExists, readConfig, writeConfig } from "../cli/config";

describe("Config", () => {
	let tmpDir: string;
	let configDir: string;
	let configFile: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
		configDir = path.join(tmpDir, ".codeteleport");
		configFile = path.join(configDir, "config.json");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("writeConfig + readConfig", () => {
		it("writes and reads config", () => {
			const config = {
				token: "ctk_live_abc123",
				apiUrl: "https://api.codeteleport.com/v1",
				deviceName: "test-macbook",
			};

			writeConfig(config, configDir);
			const read = readConfig(configDir);

			expect(read.token).toBe("ctk_live_abc123");
			expect(read.apiUrl).toBe("https://api.codeteleport.com/v1");
			expect(read.deviceName).toBe("test-macbook");
		});

		it("creates config directory if it doesn't exist", () => {
			expect(fs.existsSync(configDir)).toBe(false);

			writeConfig(
				{
					token: "ctk_live_abc123",
					apiUrl: "https://api.codeteleport.com/v1",
					deviceName: "test-macbook",
				},
				configDir,
			);

			expect(fs.existsSync(configDir)).toBe(true);
			expect(fs.existsSync(configFile)).toBe(true);
		});

		it("sets restrictive file permissions", () => {
			writeConfig(
				{
					token: "ctk_live_abc123",
					apiUrl: "https://api.codeteleport.com/v1",
					deviceName: "test-macbook",
				},
				configDir,
			);

			const stats = fs.statSync(configFile);
			const mode = (stats.mode & 0o777).toString(8);
			expect(mode).toBe("600");
		});

		it("overwrites existing config", () => {
			writeConfig(
				{
					token: "ctk_live_old",
					apiUrl: "https://api.codeteleport.com/v1",
					deviceName: "old-device",
				},
				configDir,
			);

			writeConfig(
				{
					token: "ctk_live_new",
					apiUrl: "https://api.codeteleport.com/v1",
					deviceName: "new-device",
				},
				configDir,
			);

			const read = readConfig(configDir);
			expect(read.token).toBe("ctk_live_new");
			expect(read.deviceName).toBe("new-device");
		});
	});

	describe("readConfig", () => {
		it("throws if config doesn't exist", () => {
			expect(() => readConfig(configDir)).toThrow("Not logged in");
		});
	});

	describe("configExists", () => {
		it("returns false when no config", () => {
			expect(configExists(configDir)).toBe(false);
		});

		it("returns true after writing config", () => {
			writeConfig(
				{
					token: "ctk_live_abc123",
					apiUrl: "https://api.codeteleport.com/v1",
					deviceName: "test-macbook",
				},
				configDir,
			);

			expect(configExists(configDir)).toBe(true);
		});
	});

	describe("agent field backwards compatibility", () => {
		it("config without agent field defaults to claude-code on read", () => {
			fs.mkdirSync(configDir, { recursive: true });
			fs.writeFileSync(
				configFile,
				JSON.stringify({ token: "ctk_live_abc", apiUrl: "https://api.test.com/v1", deviceName: "test" }),
			);

			const config = readConfig(configDir);
			expect(config.agent).toBe("claude-code");
		});

		it("config with agent field preserves it", () => {
			fs.mkdirSync(configDir, { recursive: true });
			fs.writeFileSync(
				configFile,
				JSON.stringify({
					token: "ctk_live_abc",
					apiUrl: "https://api.test.com/v1",
					deviceName: "test",
					agent: "claude-code",
				}),
			);

			const config = readConfig(configDir);
			expect(config.agent).toBe("claude-code");
		});
	});
});
