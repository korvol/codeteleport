import fs from "node:fs";
import path from "node:path";
import { SENSITIVE_FILE_PATTERNS, SENSITIVE_HOME_DIRS } from "../shared/constants";

/**
 * Encode a filesystem path the way Claude Code does for project directories.
 * e.g. "/Users/alice/myproject" → "-Users-alice-myproject"
 */
export function encodePath(fsPath: string): string {
	return fsPath.replace(/\//g, "-");
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
	if (child === parent) return true;
	const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
	return child.startsWith(withSep);
}

/**
 * Hard deny-list: secrets/keys must never travel (on bundle) nor be written (on restore),
 * even from/to an allowed root. Matches sensitive filename patterns anywhere and the
 * home-anchored sensitive directories (~/.ssh, ~/.aws, ~/.config, ~/.gnupg).
 */
export function isSensitivePath(originalPath: string, realPath: string, homeDir: string): boolean {
	const bases = [path.basename(originalPath), path.basename(realPath)];
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
 * Rewrite all occurrences of sourceUserDir to targetUserDir in a string.
 * This is the core path-rewriting logic that makes sessions portable.
 */
export function rewritePaths(content: string, sourceUserDir: string, targetUserDir: string): string {
	return content.split(sourceUserDir).join(targetUserDir);
}

/**
 * Auto-detect the user home directory from a full path.
 * /Users/alice/foo/bar → /Users/alice
 * /home/alice/foo/bar  → /home/alice
 * /root/foo/bar        → /root
 */
export function detectHomeDir(fullPath: string): string {
	const macosMatch = fullPath.match(/^(\/Users\/[^/]+)/);
	if (macosMatch) return macosMatch[1];

	const linuxMatch = fullPath.match(/^(\/home\/[^/]+)/);
	if (linuxMatch) return linuxMatch[1];

	const rootMatch = fullPath.match(/^(\/root)/);
	if (rootMatch) return rootMatch[1];

	throw new Error(`could not auto-detect home dir from: ${fullPath}`);
}
