import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { getAgent } from "../shared/agents";
import { DEFAULT_AGENT_ID, assertSupportedAgent } from "../shared/constants";
import type { UnbundleOptions, UnbundleResult } from "../shared/types";
import { unbundleAntigravitySession } from "./agents/antigravity/unbundle";
import { unbundleCodexSession } from "./agents/codex/unbundle";
import { convertInStaging } from "./conversion/convert";
import {
	detectHomeDirSafe,
	encodePath,
	isSensitivePath,
	isUnder,
	rewritePathValue,
	rewritePaths,
	safeRealpath,
} from "./paths";

export async function unbundleSession(options: UnbundleOptions): Promise<UnbundleResult> {
	const { bundlePath } = options;

	const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeteleport-unpack-"));

	try {
		await tar.extract({ file: bundlePath, cwd: stagingDir });

		// Read meta.json
		const metaPath = path.join(stagingDir, "meta.json");
		if (!fs.existsSync(metaPath)) {
			throw new Error("meta.json not found in bundle — is this a valid CodeTeleport bundle?");
		}
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
		const { sessionId, sourceCwd, sourceUserDir } = meta;

		// Dispatch on the bundle's own agentId (not the puller's config). Bundles
		// made before this field existed are treated as claude-code.
		const agentId = meta.agentId ?? DEFAULT_AGENT_ID;
		assertSupportedAgent(agentId);

		// Cross-agent conversion (Model A): convert the pulled session into another
		// agent's format on install, instead of restoring it natively. Skipped when
		// convertTo equals the bundle's own agent.
		if (options.convertTo && options.convertTo !== agentId) {
			const targetUserDir = options.targetUserDir ?? os.homedir();
			const targetCwd = options.targetDir ?? rewritePathValue(sourceCwd, sourceUserDir, targetUserDir);
			return convertInStaging({
				sourceAgentId: agentId,
				targetAgentId: options.convertTo,
				stagingDir,
				targetCwd,
				targetUserDir,
				claudeDir: options.claudeDir ?? path.join(targetUserDir, ".claude"),
				codexDir: options.codexDir ?? path.join(targetUserDir, ".codex"),
				geminiDir: options.geminiDir ?? path.join(targetUserDir, ".gemini", "antigravity-cli"),
			});
		}

		// Resume command comes from the bundle's agent, not the puller's config.
		const resumePrefix = options.resumeCommandPrefix ?? getAgent(agentId).resumeCommand;
		if (agentId === "codex") {
			return unbundleCodexSession({ stagingDir, meta, options: { ...options, resumeCommandPrefix: resumePrefix } });
		}
		if (agentId === "antigravity") {
			return unbundleAntigravitySession({
				stagingDir,
				meta,
				options: { ...options, resumeCommandPrefix: resumePrefix },
			});
		}

		// Determine target paths
		const targetDir = options.targetDir;
		let targetUserDir: string;
		let targetClaudeDir: string;
		let targetCwd: string;

		if (targetDir) {
			// targetDir mode: anchor session at the exact path specified
			if (options.targetUserDir) {
				targetUserDir = options.targetUserDir;
			} else if (options.claudeDir) {
				// Derive from claudeDir: /path/to/.claude → /path/to
				targetUserDir = path.dirname(options.claudeDir);
			} else {
				targetUserDir = detectHomeDirSafe(targetDir);
			}
			targetClaudeDir = options.claudeDir ?? path.join(targetUserDir, ".claude");
			targetCwd = targetDir;
		} else {
			// Simple mode: just swap user dir. This assumes the project sits under the
			// home dir (the common case). A cross-OS project located OUTSIDE the home dir
			// (e.g. a different Windows drive like D:\…) has no sensible target location,
			// so rewritePathValue leaves it unchanged — pass --target-dir to anchor it.
			targetUserDir = options.targetUserDir ?? os.homedir();
			targetClaudeDir = options.claudeDir ?? path.join(targetUserDir, ".claude");
			targetCwd = rewritePathValue(sourceCwd, sourceUserDir, targetUserDir);
		}

		const targetCwdEncoded = encodePath(targetCwd);
		const targetProjDir = path.join(targetClaudeDir, "projects", targetCwdEncoded);

		fs.mkdirSync(targetProjDir, { recursive: true });

		// Two-pass path rewriting (matches scripts/unpack.sh):
		// Pass 1: Replace sourceUserDir → targetUserDir (handles cross-user paths)
		// Pass 2: Replace rewritten sourceCwd → targetCwd (handles project directory anchoring)
		// Use the same prefix-anchored rewrite so the cwd anchor matches what pass 1 produces.
		const rewrittenSourceCwd = rewritePathValue(sourceCwd, sourceUserDir, targetUserDir);

		// Content rewriter. JSONL transcripts are jsonEscaped; Markdown/raw text is not.
		// Two passes: home dir → target home, then rewritten cwd → target cwd (project anchoring).
		function makeContentRewrite(jsonEscaped: boolean): (content: string) => string {
			return (content: string): string => {
				let result = content;
				if (sourceUserDir !== targetUserDir) {
					result = rewritePaths(result, sourceUserDir, targetUserDir, { jsonEscaped });
				}
				if (rewrittenSourceCwd !== targetCwd) {
					result = rewritePaths(result, rewrittenSourceCwd, targetCwd, { jsonEscaped });
				}
				return result;
			};
		}
		const jsonlRewrite = makeContentRewrite(true);
		const rawRewrite = makeContentRewrite(false);

		// Path-value rewriter for restore target paths (single native paths, not content).
		function twoPassValue(p: string): string {
			let r = p;
			if (sourceUserDir !== targetUserDir) r = rewritePathValue(r, sourceUserDir, targetUserDir);
			if (rewrittenSourceCwd !== targetCwd) r = rewritePathValue(r, rewrittenSourceCwd, targetCwd);
			return r;
		}

		// 1. Install session JSONL with two-pass path rewriting
		const jsonlContent = fs.readFileSync(path.join(stagingDir, "session.jsonl"), "utf-8");
		fs.writeFileSync(path.join(targetProjDir, `${sessionId}.jsonl`), jsonlRewrite(jsonlContent));

		// 2. Install session subdirectory with path rewriting in JSONL files
		const sessionSubdir = path.join(stagingDir, "session-subdir");
		if (fs.existsSync(sessionSubdir)) {
			const targetSubdir = path.join(targetProjDir, sessionId);
			fs.cpSync(sessionSubdir, targetSubdir, { recursive: true });
			rewriteJsonlFilesInDir(targetSubdir, jsonlRewrite);
		}

		// 3. Install file-history
		const fileHistoryDir = path.join(stagingDir, "file-history");
		if (fs.existsSync(fileHistoryDir)) {
			const targetFH = path.join(targetClaudeDir, "file-history", sessionId);
			fs.mkdirSync(path.dirname(targetFH), { recursive: true });
			fs.cpSync(fileHistoryDir, targetFH, { recursive: true });
		}

		// 4. Install session-env
		const sessionEnvDir = path.join(stagingDir, "session-env");
		if (fs.existsSync(sessionEnvDir)) {
			const targetSE = path.join(targetClaudeDir, "session-env", sessionId);
			fs.mkdirSync(path.dirname(targetSE), { recursive: true });
			fs.cpSync(sessionEnvDir, targetSE, { recursive: true });
		}

		// 5. Install paste-cache files
		const pasteCacheDir = path.join(stagingDir, "paste-cache");
		if (fs.existsSync(pasteCacheDir)) {
			const targetPC = path.join(targetClaudeDir, "paste-cache");
			fs.mkdirSync(targetPC, { recursive: true });
			for (const fname of fs.readdirSync(pasteCacheDir)) {
				fs.copyFileSync(path.join(pasteCacheDir, fname), path.join(targetPC, fname));
			}
		}

		// 6. Install shell-snapshots
		const shellDir = path.join(stagingDir, "shell-snapshots");
		if (fs.existsSync(shellDir)) {
			const targetSS = path.join(targetClaudeDir, "shell-snapshots");
			fs.mkdirSync(targetSS, { recursive: true });
			for (const fname of fs.readdirSync(shellDir)) {
				fs.copyFileSync(path.join(shellDir, fname), path.join(targetSS, fname));
			}
		}

		// 7. Install project memory (Part A) with .md path rewriting
		let memoryInstalled: UnbundleResult["memoryInstalled"];
		const memorySrc = path.join(stagingDir, "memory");
		if (fs.existsSync(memorySrc)) {
			const memoryDst = path.join(targetProjDir, "memory");
			fs.mkdirSync(memoryDst, { recursive: true });
			memoryInstalled = installMemory(memorySrc, memoryDst, rawRewrite, options.memoryConflict ?? "merge");
		}

		// 8. Install extra working/temp files (Part B) at their rewritten target paths
		let extraFilesInstalled: UnbundleResult["extraFilesInstalled"];
		const manifestPath = path.join(stagingDir, "extra-files-manifest.json");
		if (fs.existsSync(manifestPath)) {
			extraFilesInstalled = [];
			const conflict = options.extraFilesConflict ?? "overwrite";
			// Also anchor encoded-cwd temp paths (e.g. /private/tmp/<encodedSourceCwd>/…) to the target.
			const encodedSourceCwd = encodePath(sourceCwd);
			const encodedTargetCwd = encodePath(targetCwd);
			// Allowed restore roots (literal + realpath): target cwd/.claude subtrees and temp roots.
			// On Windows, /tmp and /private/tmp resolve to real writable C:\tmp etc., so gate them out.
			const tempRoots = process.platform === "win32" ? [os.tmpdir()] : [os.tmpdir(), "/tmp", "/private/tmp"];
			const restoreRoots = Array.from(
				new Set([targetCwd, targetClaudeDir, ...tempRoots].flatMap((r) => [r, safeRealpath(r)])),
			);
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Array<{
				stored: string;
				originalPath: string;
				sizeBytes?: number;
				rewriteContent?: boolean;
			}>;
			for (const entry of manifest) {
				const storedPath = path.join(stagingDir, "extra-files", entry.stored);
				if (!fs.existsSync(storedPath)) continue;
				let targetPath = twoPassValue(entry.originalPath);
				if (encodedSourceCwd !== encodedTargetCwd) {
					targetPath = rewritePaths(targetPath, encodedSourceCwd, encodedTargetCwd, { jsonEscaped: false });
				}
				// Refuse to write outside the allowed roots or to a sensitive location (untrusted manifest).
				if (!isRestoreTargetSafe(targetPath, restoreRoots, targetUserDir)) {
					extraFilesInstalled.push({ path: targetPath, action: "skipped" });
					continue;
				}
				const exists = fs.existsSync(targetPath);
				if (exists && conflict === "skip") {
					extraFilesInstalled.push({ path: targetPath, action: "skipped" });
					continue;
				}
				fs.mkdirSync(path.dirname(targetPath), { recursive: true });
				if (entry.rewriteContent) {
					fs.writeFileSync(targetPath, rawRewrite(fs.readFileSync(storedPath, "utf-8")));
				} else {
					fs.copyFileSync(storedPath, targetPath);
				}
				extraFilesInstalled.push({ path: targetPath, action: exists ? "overwritten" : "written" });
			}
		}

		return {
			sessionId,
			installedTo: targetProjDir,
			resumeCommand: `${resumePrefix} ${sessionId}`,
			memoryInstalled,
			extraFilesInstalled,
		};
	} finally {
		fs.rmSync(stagingDir, { recursive: true, force: true });
	}
}

export interface MemoryInstallResult {
	written: string[];
	merged: string[];
	skipped: string[];
}

/**
 * Whether an extra file from a (potentially untrusted) bundle may be written to `targetPath`.
 * Requires the resolved path to sit inside one of `allowedRoots` and not be a sensitive location.
 */
export function isRestoreTargetSafe(targetPath: string, allowedRoots: string[], homeDir: string): boolean {
	const resolved = path.resolve(targetPath);
	if (isSensitivePath(resolved, resolved, homeDir)) return false;
	return allowedRoots.some((root) => isUnder(resolved, root) || isUnder(resolved, safeRealpath(root)));
}

/**
 * Union two texts line-by-line, preserving order and de-duplicating. A single trailing
 * newline is preserved (and not treated as a blank content line) so merging real
 * newline-terminated MEMORY.md files doesn't inject stray blank lines.
 */
function unionByLine(existing: string, incoming: string): string {
	const endsWithNewline = existing.endsWith("\n") || incoming.endsWith("\n");
	const toLines = (s: string): string[] => {
		const lines = s.split("\n");
		if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
		return lines;
	};
	const result = toLines(existing);
	const seen = new Set(result);
	for (const line of toLines(incoming)) {
		if (!seen.has(line)) {
			seen.add(line);
			result.push(line);
		}
	}
	return result.join("\n") + (endsWithNewline ? "\n" : "");
}

/**
 * Install project memory (Part A) from `memorySrc` into `memoryDst`.
 * `.md` contents are run through `rewrite` (they can embed absolute paths).
 * Conflict policy:
 *   - overwrite: replace target files
 *   - skip: keep existing target files
 *   - merge (default): union MEMORY.md by line; for any other file, write if
 *     absent else skip (never clobber a hand-edited memory on the target).
 */
export function installMemory(
	memorySrc: string,
	memoryDst: string,
	rewrite: (content: string) => string,
	conflict: "merge" | "overwrite" | "skip",
): MemoryInstallResult {
	const written: string[] = [];
	const merged: string[] = [];
	const skipped: string[] = [];

	const contentFor = (abs: string, isMd: boolean): string | Buffer =>
		isMd ? rewrite(fs.readFileSync(abs, "utf-8")) : fs.readFileSync(abs);

	const walk = (dir: string, relBase: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, entry.name);
			const rel = relBase ? path.join(relBase, entry.name) : entry.name;
			if (entry.isDirectory()) {
				walk(abs, rel);
				continue;
			}

			const dstFile = path.join(memoryDst, rel);
			const isMd = entry.name.toLowerCase().endsWith(".md");
			const exists = fs.existsSync(dstFile);

			const write = () => {
				fs.mkdirSync(path.dirname(dstFile), { recursive: true });
				fs.writeFileSync(dstFile, contentFor(abs, isMd));
			};

			if (conflict === "overwrite") {
				write();
				written.push(rel);
			} else if (conflict === "skip") {
				if (exists) {
					skipped.push(rel);
				} else {
					write();
					written.push(rel);
				}
			} else if (entry.name === "MEMORY.md" && exists) {
				// merge: union MEMORY.md by line
				const incoming = isMd ? rewrite(fs.readFileSync(abs, "utf-8")) : fs.readFileSync(abs, "utf-8");
				fs.mkdirSync(path.dirname(dstFile), { recursive: true });
				fs.writeFileSync(dstFile, unionByLine(fs.readFileSync(dstFile, "utf-8"), incoming));
				merged.push(rel);
			} else if (exists) {
				// merge: never clobber an existing non-MEMORY memory file
				skipped.push(rel);
			} else {
				write();
				written.push(rel);
			}
		}
	};

	walk(memorySrc, "");
	return { written, merged, skipped };
}

function rewriteJsonlFilesInDir(dir: string, rewrite: (content: string) => string): void {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			rewriteJsonlFilesInDir(fullPath, rewrite);
		} else if (entry.name.endsWith(".jsonl")) {
			const content = fs.readFileSync(fullPath, "utf-8");
			fs.writeFileSync(fullPath, rewrite(content));
		}
	}
}
