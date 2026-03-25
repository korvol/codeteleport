import { describe, expect, it } from "vitest";
import { detectHomeDir, encodePath, rewritePaths } from "../core/paths";

describe("encodePath", () => {
	it("replaces slashes with dashes", () => {
		expect(encodePath("/Users/alice/myproject")).toBe("-Users-alice-myproject");
	});

	it("handles root path", () => {
		expect(encodePath("/")).toBe("-");
	});

	it("handles nested paths", () => {
		expect(encodePath("/Users/alice/code/teleport/project")).toBe("-Users-alice-code-teleport-project");
	});

	it("handles path without leading slash", () => {
		expect(encodePath("Users/alice")).toBe("Users-alice");
	});
});

describe("rewritePaths", () => {
	it("rewrites all occurrences of source path to target", () => {
		const content = '{"cwd":"/Users/alice/proj","file":"/Users/alice/proj/foo.ts"}';
		const result = rewritePaths(content, "/Users/alice", "/Users/bob");
		expect(result).toBe('{"cwd":"/Users/bob/proj","file":"/Users/bob/proj/foo.ts"}');
	});

	it("handles content with no matches", () => {
		const content = '{"cwd":"/home/user/proj"}';
		const result = rewritePaths(content, "/Users/alice", "/Users/bob");
		expect(result).toBe('{"cwd":"/home/user/proj"}');
	});

	it("handles empty content", () => {
		expect(rewritePaths("", "/Users/alice", "/Users/bob")).toBe("");
	});

	it("rewrites multiple lines", () => {
		const content = [
			'{"cwd":"/Users/alice/proj"}',
			'{"file":"/Users/alice/proj/a.ts"}',
			'{"file":"/Users/alice/proj/b.ts"}',
		].join("\n");
		const result = rewritePaths(content, "/Users/alice", "/Users/bob");
		expect(result).toContain("/Users/bob/proj");
		expect(result).not.toContain("/Users/alice");
	});

	it("handles same source and target (no-op)", () => {
		const content = '{"cwd":"/Users/alice/proj"}';
		const result = rewritePaths(content, "/Users/alice", "/Users/alice");
		expect(result).toBe(content);
	});
});

describe("detectHomeDir", () => {
	it("detects macOS home from /Users/alice/projects/foo", () => {
		expect(detectHomeDir("/Users/alice/projects/foo")).toBe("/Users/alice");
	});

	it("detects macOS home from /Users/housenumbers", () => {
		expect(detectHomeDir("/Users/housenumbers")).toBe("/Users/housenumbers");
	});

	it("detects macOS home from deep nested path", () => {
		expect(detectHomeDir("/Users/openclaw/code-teleport/packages/mcp")).toBe("/Users/openclaw");
	});

	it("detects Linux home from /home/user/proj", () => {
		expect(detectHomeDir("/home/user/proj")).toBe("/home/user");
	});

	it("detects /root", () => {
		expect(detectHomeDir("/root/projects/foo")).toBe("/root");
	});

	it("detects just /root", () => {
		expect(detectHomeDir("/root")).toBe("/root");
	});

	it("throws for unrecognized path", () => {
		expect(() => detectHomeDir("/var/data/project")).toThrow("could not auto-detect home dir");
	});

	it("throws for empty path", () => {
		expect(() => detectHomeDir("")).toThrow("could not auto-detect home dir");
	});
});
