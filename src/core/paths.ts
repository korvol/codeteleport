import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SENSITIVE_FILE_PATTERNS, SENSITIVE_HOME_DIRS } from "../shared/constants";

/**
 * Encode a filesystem path the way Claude Code names project directories: path
 * separators collapse to "-", and a Windows drive colon ("C:") also collapses.
 *   "/Users/alice/myproject"       → "-Users-alice-myproject"
 *   "C:\\Users\\alice\\myproject"  → "C--Users-alice-myproject"  (verified ground truth)
 * A POSIX mid-path ":" is left untouched — only the drive-letter colon is mapped,
 * since whether macOS/Linux Claude Code encodes a mid-path ":" is unconfirmed.
 */
export function encodePath(fsPath: string): string {
	// Drop a Windows extended-length / device prefix (\\?\, \\.\) so it can't
	// produce an illegal "?" in the directory name.
	const stripped = fsPath.replace(/^\\\\[?.]\\/, "");
	// Drive-letter colon → "-" (C:\… → C-\… → C--…), then every separator → "-".
	return stripped.replace(/^([A-Za-z]):/, "$1-").replace(/[/\\]/g, "-");
}

/** Resolve a path's real location, falling back to the input if it can't be resolved. */
export function safeRealpath(p: string): string {
	try {
		return fs.realpathSync(p);
	} catch {
		return p;
	}
}

/** True if `child` is `parent` or sits inside it (prefix match on a path boundary). */
export function isUnder(child: string, parent: string): boolean {
	// Windows filesystems are case-insensitive, so compare case-insensitively there —
	// otherwise the sensitive-path deny-list misses differently-cased secret dirs
	// (e.g. ~/.SSH, ~/.AWS, ~/.Config). On case-sensitive POSIX, stay exact.
	const ci = process.platform === "win32";
	const c = ci ? child.toLowerCase() : child;
	const p = ci ? parent.toLowerCase() : parent;
	if (c === p) return true;
	const withSep = p.endsWith(path.sep) ? p : p + path.sep;
	return c.startsWith(withSep);
}

/**
 * Hard deny-list: secrets/keys must never travel (on bundle) nor be written (on restore),
 * even from/to an allowed root. Matches sensitive filename patterns anywhere and the
 * home-anchored sensitive directories (~/.ssh, ~/.aws, ~/.config, ~/.gnupg).
 */
export function isSensitivePath(originalPath: string, realPath: string, homeDir: string): boolean {
	// Use both the OS basename and a separator-agnostic basename so a foreign-OS
	// path (e.g. a Windows path being checked on Linux) still surfaces its filename.
	const bases = [
		path.basename(originalPath),
		path.basename(realPath),
		pathBasename(originalPath),
		pathBasename(realPath),
	];
	for (const pattern of SENSITIVE_FILE_PATTERNS) {
		if (bases.some((b) => pattern.test(b))) return true;
	}
	for (const dir of SENSITIVE_HOME_DIRS) {
		const root = path.join(homeDir, dir);
		if (isUnder(originalPath, root) || isUnder(realPath, root)) return true;
	}
	return false;
}

/**
 * Whether a path string is Windows-style: a drive letter (`C:\` / `C:/`), a UNC
 * prefix (`\\server`), or any backslash. Detected from the string itself (not
 * `process.platform`) because a bundle's source paths may come from another OS.
 */
export function isWindowsStyle(p: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.includes("\\");
}

/** Basename that understands both `/` and `\` separators, regardless of host OS. */
export function pathBasename(p: string): string {
	const parts = p.split(/[\\/]+/).filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : "";
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drop trailing separators from a root, but never reduce it to empty. */
function stripTrailingSeps(root: string): string {
	const trimmed = root.replace(/[\\/]+$/, "");
	return trimmed || root;
}

/** The native separator a target path should use, by its style. */
function nativeSep(targetRoot: string): "\\" | "/" {
	return isWindowsStyle(targetRoot) ? "\\" : "/";
}

/** Re-emit a known native remainder's separators in the target's style. */
function translateRemainder(remainder: string, sep: string): string {
	return remainder.replace(/[\\/]+/g, (run) =>
		Array.from(run)
			.map(() => sep)
			.join(""),
	);
}

/**
 * Rewrite a SINGLE known native path value (not free-form content): if it sits
 * under `sourceRoot`, relocate it onto `targetRoot` with target-native separators.
 * Exact (no scanning heuristics) so paths with spaces and trailing separators are
 * handled losslessly. Used to compute target cwd / anchor paths.
 */
export function rewritePathValue(p: string, sourceRoot: string, targetRoot: string): string {
	if (!p || !sourceRoot || sourceRoot === targetRoot) return p;
	const src = stripTrailingSeps(sourceRoot);
	const normP = p.replace(/\\/g, "/");
	const normSrc = src.replace(/\\/g, "/");
	let remainder: string | null = null;
	if (normP === normSrc) remainder = "";
	else if (normP.startsWith(`${normSrc}/`)) remainder = p.slice(src.length);
	if (remainder === null) return p;
	return stripTrailingSeps(targetRoot) + translateRemainder(remainder, nativeSep(targetRoot));
}

// ── Content path rewriting ──
//
// A separator AS IT APPEARS IN CONTENT depends on the escaping of that content:
//  - jsonEscaped (JSONL): one logical separator is the two characters "\\" (an
//    escaped backslash) OR a forward slash. A lone backslash is NEVER a separator
//    there — it always begins a JSON escape (\n, \t, \", \uXXXX) — so it must not
//    be matched, or escapes get corrupted.
//  - raw (Markdown / shell / SQLite values / protobuf leaves): a single "\" or "/".
// The two-backslash alternative is listed first. Both classes EXCLUDE "\" and "/"
// from the segment, which keeps `(?:SEP SEG)*` linear (no catastrophic backtracking).
const SEP_JSON = String.raw`(?:\\\\|/)`;
const SEP_RAW = String.raw`(?:[\\/])`;
const SEGMENT = String.raw`[^"\\/]+`;
// Next position after a root must not be a path-name char (so /Users/al ≠ /Users/alice).
const BOUNDARY = String.raw`(?![^"\s\\/])`;

function sepPattern(jsonEscaped: boolean): string {
	return jsonEscaped ? SEP_JSON : SEP_RAW;
}

/** Tokenizes a logical separator inside an already-matched tail, for translation. */
function sepToken(jsonEscaped: boolean): RegExp {
	return jsonEscaped ? /\\\\|\//g : /[\\/]/g;
}

/** Build a regex matching `sourceRoot` (separator-representation tolerant) + its trailing path. */
function buildRootRegex(sourceRoot: string, jsonEscaped: boolean): RegExp {
	const SEP = sepPattern(jsonEscaped);
	const tokens = sourceRoot.match(/[\\/]+|[^\\/]+/g) ?? [];
	let rootPat = "";
	tokens.forEach((tok, i) => {
		if (/^[\\/]+$/.test(tok)) {
			rootPat += Array.from(tok)
				.map(() => SEP)
				.join("");
		} else if (i === 0 && /^[A-Za-z]:$/.test(tok)) {
			// Drive letter is the only legitimately case-insensitive path component.
			rootPat += `[${tok[0].toUpperCase()}${tok[0].toLowerCase()}]:`;
		} else {
			rootPat += escapeRegExp(tok);
		}
	});
	const tail = `(?:${SEP}${SEGMENT})*${SEP}?`;
	return new RegExp(`(${rootPat})${BOUNDARY}(${tail})`, "g");
}

export interface RewriteOptions {
	/**
	 * True when content escapes backslashes like JSON (`\\` per separator) — the
	 * default, for JSONL transcripts. False for raw text (Markdown / shell /
	 * SQLite string values / protobuf leaf bytes).
	 */
	jsonEscaped?: boolean;
}

/** The literal separator emitted for the target, by style and escaping mode. */
function emittedSep(targetRoot: string, jsonEscaped: boolean): string {
	if (!isWindowsStyle(targetRoot)) return "/";
	return jsonEscaped ? "\\\\" : "\\";
}

/**
 * Relocate every path rooted at `sourceRoot` onto `targetRoot` inside free-form
 * content, making sessions portable across machines AND operating systems.
 *
 * Each path that begins with `sourceRoot` — matched whether its separators appear
 * as `/`, `\`, or JSON-escaped `\\` — has its root prefix replaced and its
 * remaining separators translated to the target's native separator, re-escaped per
 * `jsonEscaped` so JSONL output stays valid JSON. Only the anchored prefix is
 * relocated; text deeper in a path that coincidentally equals the home string is
 * left in place (you cannot splice a drive root into the middle of a path).
 */
export function rewritePaths(
	content: string,
	sourceRoot: string,
	targetRoot: string,
	options: RewriteOptions = {},
): string {
	if (!sourceRoot || !sourceRoot.trim() || sourceRoot === targetRoot) return content;
	const jsonEscaped = options.jsonEscaped ?? true;
	const src = stripTrailingSeps(sourceRoot);
	if (!src) return content;
	const outSep = emittedSep(targetRoot, jsonEscaped);
	const outRoot = translateRemainder(stripTrailingSeps(targetRoot), outSep);
	const re = buildRootRegex(src, jsonEscaped);
	const token = sepToken(jsonEscaped);
	return content.replace(re, (_match, _root, tail: string) => outRoot + tail.replace(token, () => outSep));
}

/**
 * Auto-detect the user home directory from a full path. Platform-agnostic: it
 * recognizes the shape of the path string, not the host OS, since a bundle's
 * source path may be from a different machine. Expects a NATIVE single-separator
 * path. Throws when no known home shape matches (callers should prefer explicit
 * overrides and only fall back to this).
 *   C:\\Users\\alice\\foo  → C:\\Users\\alice
 *   D:/Users/alice/foo     → D:/Users/alice
 *   /Users/alice/foo/bar   → /Users/alice
 *   /home/alice/foo/bar    → /home/alice
 *   /root/foo/bar          → /root
 */
export function detectHomeDir(fullPath: string): string {
	const winUsers = fullPath.match(/^([A-Za-z]:[\\/]Users[\\/][^\\/]+)/);
	if (winUsers) return winUsers[1];

	const macosMatch = fullPath.match(/^(\/Users\/[^/]+)/);
	if (macosMatch) return macosMatch[1];

	const linuxMatch = fullPath.match(/^(\/home\/[^/]+)/);
	if (linuxMatch) return linuxMatch[1];

	const rootMatch = fullPath.match(/^(\/root)/);
	if (rootMatch) return rootMatch[1];

	throw new Error(`could not auto-detect home dir from: ${fullPath}`);
}

/**
 * Like `detectHomeDir`, but falls back to the local home (`os.homedir()`) instead
 * of throwing when the path shape isn't a recognized home — e.g. a project on a
 * Windows drive outside `C:\Users\…` (a CI checkout at `D:\a\…`, a `D:\projects`
 * tree). Used when restoring to the local machine, where the local home is the
 * right default target.
 */
export function detectHomeDirSafe(fullPath: string): string {
	try {
		return detectHomeDir(fullPath);
	} catch {
		return os.homedir();
	}
}

/**
 * Whether two paths point at the same location. Separator-insensitive (`/` vs `\`)
 * and, on Windows, case-insensitive — so a path recovered as a forward-slash
 * `file://` workspace URI matches the same dir expressed with native backslashes.
 */
export function samePath(a: string, b: string): boolean {
	const norm = (p: string) => {
		const s = p.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
		return process.platform === "win32" ? s.toLowerCase() : s;
	};
	return norm(a) === norm(b);
}
