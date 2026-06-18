import os from "node:os";
import { describe, expect, it } from "vitest";
import {
	detectHomeDir,
	detectHomeDirSafe,
	encodePath,
	isSensitivePath,
	isUnder,
	isWindowsStyle,
	pathBasename,
	rewritePathValue,
	rewritePaths,
	samePath,
} from "../core/paths";

describe("encodePath — Windows", () => {
	it("maps the drive colon and backslashes to dashes (verified ground truth)", () => {
		expect(encodePath("C:\\Users\\userx\\workspace\\codeteleport")).toBe("C--Users-userx-workspace-codeteleport");
	});

	it("leaves a POSIX mid-path colon untouched (only the drive colon is mapped)", () => {
		expect(encodePath("/Users/alice/foo:bar")).toBe("-Users-alice-foo:bar");
	});

	it("does not emit an illegal '?' from an extended-length prefix", () => {
		expect(encodePath("\\\\?\\C:\\Users\\bob\\proj")).not.toContain("?");
	});
});

describe("detectHomeDir — Windows", () => {
	it("detects a backslash Windows home", () => {
		expect(detectHomeDir("C:\\Users\\userx\\workspace\\app")).toBe("C:\\Users\\userx");
	});

	it("detects a forward-slash Windows home", () => {
		expect(detectHomeDir("D:/Users/x/app")).toBe("D:/Users/x");
	});

	it("handles a username with a space", () => {
		expect(detectHomeDir("C:\\Users\\Bob Smith\\app")).toBe("C:\\Users\\Bob Smith");
	});

	it("still detects POSIX homes", () => {
		expect(detectHomeDir("/Users/alice/x")).toBe("/Users/alice");
		expect(detectHomeDir("/home/alice/x")).toBe("/home/alice");
	});
});

describe("pathBasename", () => {
	it("splits on backslashes", () => {
		expect(pathBasename("C:\\Users\\bob\\workspace\\codeteleport")).toBe("codeteleport");
	});
	it("splits on forward slashes", () => {
		expect(pathBasename("/Users/alice/proj")).toBe("proj");
	});
	it("ignores trailing separators", () => {
		expect(pathBasename("C:\\Users\\bob\\proj\\")).toBe("proj");
	});
});

describe("isWindowsStyle", () => {
	it("recognizes drive-letter and backslash paths as Windows", () => {
		expect(isWindowsStyle("C:\\Users\\x")).toBe(true);
		expect(isWindowsStyle("C:/Users/x")).toBe(true);
		expect(isWindowsStyle("\\\\server\\share")).toBe(true);
	});
	it("treats POSIX paths as non-Windows", () => {
		expect(isWindowsStyle("/Users/x")).toBe(false);
	});
});

describe("rewritePaths — cross-OS content", () => {
	it("matches JSON-escaped Windows separators (win → posix)", () => {
		expect(
			rewritePaths('{"cwd":"C:\\\\Users\\\\userx\\\\proj"}', "C:\\Users\\userx", "/Users/alice", { jsonEscaped: true }),
		).toBe('{"cwd":"/Users/alice/proj"}');
	});

	it("preserves JSON escape sequences after a path (\\n is not eaten)", () => {
		expect(
			rewritePaths('{"c":"Edit C:\\\\Users\\\\userx\\\\proj\\\\a.ts\\nThen run"}', "C:\\Users\\userx", "/Users/alice", {
				jsonEscaped: true,
			}),
		).toBe('{"c":"Edit /Users/alice/proj/a.ts\\nThen run"}');
	});

	it("emits escaped backslashes so posix → Windows stays valid JSON", () => {
		expect(
			rewritePaths('{"cwd":"/Users/alice/proj/foo.ts"}', "/Users/alice", "C:\\Users\\bob", { jsonEscaped: true }),
		).toBe('{"cwd":"C:\\\\Users\\\\bob\\\\proj\\\\foo.ts"}');
	});

	it("only relocates at a path boundary (alice ≠ alice2)", () => {
		expect(rewritePaths('{"a":"/Users/alice/p","b":"/Users/alice2/x"}', "/Users/alice", "/home/bob")).toBe(
			'{"a":"/home/bob/p","b":"/Users/alice2/x"}',
		);
	});

	it("boundary holds for Windows roots (al ≠ albert)", () => {
		expect(
			rewritePaths('{"a":"C:\\\\Users\\\\al\\\\p","b":"C:\\\\Users\\\\albert\\\\p"}', "C:\\Users\\al", "/home/bob", {
				jsonEscaped: true,
			}),
		).toBe('{"a":"/home/bob/p","b":"C:\\\\Users\\\\albert\\\\p"}');
	});

	it("treats segments with regex metacharacters literally", () => {
		expect(rewritePaths('{"a":"/Users/a.b/x","b":"/Users/aXb/secret"}', "/Users/a.b", "/home/bob")).toBe(
			'{"a":"/home/bob/x","b":"/Users/aXb/secret"}',
		);
	});

	it("is case-sensitive for user dirs but case-insensitive for the drive letter", () => {
		expect(rewritePaths('{"a":"/home/bob/p","b":"/home/Bob/o"}', "/home/bob", "/home/carol")).toBe(
			'{"a":"/home/carol/p","b":"/home/Bob/o"}',
		);
		expect(rewritePaths('{"a":"c:\\\\Users\\\\x\\\\p"}', "C:\\Users\\x", "/home/bob", { jsonEscaped: true })).toBe(
			'{"a":"/home/bob/p"}',
		);
	});

	it("rewrites paths that contain spaces", () => {
		expect(rewritePaths('{"file":"/Users/alice/My Projects/app/src/x.ts"}', "/Users/alice", "/home/bob")).toBe(
			'{"file":"/home/bob/My Projects/app/src/x.ts"}',
		);
	});

	it("handles a trailing separator without leaving a foreign slash", () => {
		expect(
			rewritePaths('{"dir":"C:\\\\Users\\\\userx\\\\"}', "C:\\Users\\userx", "/Users/alice", { jsonEscaped: true }),
		).toBe('{"dir":"/Users/alice/"}');
	});

	it("does not over-match a sibling project on pass 2 (codeteleport ≠ codeteleport2)", () => {
		expect(
			rewritePaths(
				'{"a":"/Users/bob/workspace/codeteleport","b":"/Users/bob/workspace/codeteleport2"}',
				"/Users/bob/workspace/codeteleport",
				"/Users/alice/dev/ct",
			),
		).toBe('{"a":"/Users/alice/dev/ct","b":"/Users/bob/workspace/codeteleport2"}');
	});

	it("rewrites raw (non-JSON) text, e.g. memory Markdown", () => {
		expect(
			rewritePaths("see C:\\Users\\userx\\app\\notes.md here", "C:\\Users\\userx", "/Users/alice", {
				jsonEscaped: false,
			}),
		).toBe("see /Users/alice/app/notes.md here");
	});

	it("returns content verbatim for an empty or blank root", () => {
		expect(rewritePaths("abc", "", "anything")).toBe("abc");
		expect(rewritePaths("abc", "   ", "anything")).toBe("abc");
	});

	it("is stable when the same call is repeated (no global-regex lastIndex leak)", () => {
		const c = '{"cwd":"/Users/alice/p"}';
		expect(rewritePaths(c, "/Users/alice", "/home/bob")).toBe('{"cwd":"/home/bob/p"}');
		expect(rewritePaths(c, "/Users/alice", "/home/bob")).toBe('{"cwd":"/home/bob/p"}');
	});
});

describe("sensitive-path deny-list — Windows case-insensitivity", () => {
	// Windows filesystems are case-insensitive, so the deny-list must match regardless
	// of casing. These assert the win32 behavior (skipped on case-sensitive POSIX CI).
	it.runIf(process.platform === "win32")("catches a differently-cased secret directory", () => {
		// known_hosts has no sensitive *filename* pattern — it's denied purely by the ~/.ssh dir match.
		expect(isSensitivePath("C:\\Users\\x\\.SSH\\known_hosts", "C:\\Users\\x\\.SSH\\known_hosts", "C:\\Users\\x")).toBe(
			true,
		);
		expect(isUnder("C:\\Users\\X\\.AWS\\config", "C:\\Users\\x\\.aws")).toBe(true);
	});

	it("still matches sensitive filename patterns on a Windows path everywhere", () => {
		expect(isSensitivePath("C:\\Users\\x\\proj\\server.pem", "C:\\Users\\x\\proj\\server.pem", "C:\\Users\\x")).toBe(
			true,
		);
	});
});

describe("rewritePathValue — exact single-path relocation", () => {
	it("translates separators to the target OS (posix → Windows), spaces intact", () => {
		expect(rewritePathValue("/Users/alice/My Projects/app", "/Users/alice", "C:\\Users\\bob")).toBe(
			"C:\\Users\\bob\\My Projects\\app",
		);
	});

	it("translates Windows → posix", () => {
		expect(rewritePathValue("C:\\Users\\userx\\workspace\\app", "C:\\Users\\userx", "/Users/alice")).toBe(
			"/Users/alice/workspace/app",
		);
	});

	it("leaves a path that is not under the source root unchanged", () => {
		expect(rewritePathValue("/etc/passwd", "/Users/alice", "/Users/bob")).toBe("/etc/passwd");
	});

	it("relocates the root itself when it equals the source", () => {
		expect(rewritePathValue("/Users/alice", "/Users/alice", "C:\\Users\\bob")).toBe("C:\\Users\\bob");
	});

	it("respects the path boundary (alice ≠ alice2)", () => {
		expect(rewritePathValue("/Users/alice2/x", "/Users/alice", "/Users/bob")).toBe("/Users/alice2/x");
	});
});

describe("detectHomeDirSafe", () => {
	it("falls back to os.homedir() for a Windows path outside C:\\Users", () => {
		// e.g. a CI checkout at D:\a\… or a project on another drive — must not throw.
		expect(detectHomeDirSafe("D:\\a\\codeteleport\\codeteleport")).toBe(os.homedir());
		expect(detectHomeDirSafe("D:\\projects\\app")).toBe(os.homedir());
	});

	it("still returns the detected home when the shape is recognized", () => {
		expect(detectHomeDirSafe("C:\\Users\\bob\\proj")).toBe("C:\\Users\\bob");
		expect(detectHomeDirSafe("/Users/alice/x")).toBe("/Users/alice");
	});
});

describe("samePath", () => {
	it("matches a forward-slash path against its backslash form (Antigravity file:// workspace)", () => {
		expect(samePath("C:/Users/x/proj", "C:\\Users\\x\\proj")).toBe(true);
	});
	it("ignores a trailing separator", () => {
		expect(samePath("/Users/a/proj/", "/Users/a/proj")).toBe(true);
	});
	it("distinguishes genuinely different paths", () => {
		expect(samePath("C:/Users/x", "C:/Users/y")).toBe(false);
	});
});
