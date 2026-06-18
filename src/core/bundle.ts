import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import {
	BUNDLE_FORMAT_VERSION,
	CLAUDE_DIR,
	DEFAULT_AGENT_ID,
	EXTRA_FILE_MAX_BYTES,
	EXTRA_TOTAL_MAX_BYTES,
	assertSupportedAgent,
} from "../shared/constants";
import type { BundleOptions, BundleResult } from "../shared/types";
import { encodePath, isSensitivePath, isUnder, safeRealpath } from "./paths";
import { scanSession } from "./scanner";

export async function bundleSession(options: BundleOptions): Promise<BundleResult> {
	const { sessionId, cwd } = options;
	const agentId = options.agentId ?? DEFAULT_AGENT_ID;
	assertSupportedAgent(agentId);
	const outputDir = options.outputDir ?? os.tmpdir();
	const claudeDir = options.claudeDir ?? CLAUDE_DIR;
	const sourceUserDir = options.sourceUserDir ?? os.homedir();
	const encodedCwd = encodePath(cwd);

	const projDir = path.join(claudeDir, "projects", encodedCwd);
	const jsonlPath = path.join(projDir, `${sessionId}.jsonl`);

	if (!fs.existsSync(jsonlPath)) {
		throw new Error(`Session JSONL not found at ${jsonlPath}`);
	}

	const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeteleport-"));

	try {
		// 1. Scan JSONL for assets + metadata
		const { assets, metadata } = await scanSession(jsonlPath);

		// 2. Write meta.json — self-describing: agentId lets pull pick the right
		// adapter without trusting the puller's local config.
		const meta = { sessionId, sourceCwd: cwd, sourceUserDir, agentId, formatVersion: BUNDLE_FORMAT_VERSION };
		fs.writeFileSync(path.join(stagingDir, "meta.json"), JSON.stringify(meta, null, 2));

		// 3. Copy session JSONL
		fs.copyFileSync(jsonlPath, path.join(stagingDir, "session.jsonl"));

		// 4. Copy session subdirectory (subagents etc.)
		const sessionSubdir = path.join(projDir, sessionId);
		let subagentCount = 0;
		if (fs.existsSync(sessionSubdir) && fs.statSync(sessionSubdir).isDirectory()) {
			fs.cpSync(sessionSubdir, path.join(stagingDir, "session-subdir"), { recursive: true });
			// Count subagent JSONL files
			subagentCount = countFiles(path.join(stagingDir, "session-subdir"), ".jsonl");
		}

		// 5. Copy file-history
		const fileHistoryDir = path.join(claudeDir, "file-history", sessionId);
		const hasFileHistory = fs.existsSync(fileHistoryDir);
		if (hasFileHistory) {
			fs.cpSync(fileHistoryDir, path.join(stagingDir, "file-history"), { recursive: true });
		}

		// 6. Copy session-env
		const sessionEnvDir = path.join(claudeDir, "session-env", sessionId);
		if (fs.existsSync(sessionEnvDir)) {
			fs.cpSync(sessionEnvDir, path.join(stagingDir, "session-env"), { recursive: true });
		}

		// 7. Copy paste-cache files
		const hasPasteCache = assets.pasteFiles.length > 0;
		if (hasPasteCache) {
			const pasteCacheDir = path.join(stagingDir, "paste-cache");
			fs.mkdirSync(pasteCacheDir, { recursive: true });
			for (const fname of assets.pasteFiles) {
				const src = path.join(claudeDir, "paste-cache", fname);
				if (fs.existsSync(src)) {
					fs.copyFileSync(src, path.join(pasteCacheDir, fname));
				}
			}
		}

		// 8. Copy shell-snapshot files
		const hasShellSnapshots = assets.shellSnapshots.length > 0;
		if (hasShellSnapshots) {
			const shellDir = path.join(stagingDir, "shell-snapshots");
			fs.mkdirSync(shellDir, { recursive: true });
			for (const fname of assets.shellSnapshots) {
				const src = path.join(claudeDir, "shell-snapshots", fname);
				if (fs.existsSync(src)) {
					fs.copyFileSync(src, path.join(shellDir, fname));
				}
			}
		}

		// 8b. Copy project memory (project-scoped, shared across sessions) — Part A.
		// An empty memory directory is treated as no memory (don't stage an empty dir).
		const memoryDir = path.join(projDir, "memory");
		const hasMemoryDir = fs.existsSync(memoryDir) && fs.statSync(memoryDir).isDirectory();
		const memoryFileCount = hasMemoryDir ? countFiles(memoryDir, "") : 0;
		const hasMemory = memoryFileCount > 0;
		if (hasMemory) {
			fs.cpSync(memoryDir, path.join(stagingDir, "memory"), { recursive: true });
		}

		// 8c. Collect extra working/temp files — Part B
		const alreadyBundledRealRoots: string[] = [];
		for (const d of [sessionSubdir, fileHistoryDir]) {
			if (fs.existsSync(d)) {
				try {
					alreadyBundledRealRoots.push(fs.realpathSync(d));
				} catch {}
			}
		}
		const extra = collectExtraFiles({
			includePaths: options.includePaths ?? [],
			filesModified: metadata.filesModified ?? [],
			cwd,
			homeDir: sourceUserDir,
			stagingDir,
			alreadyBundledRealRoots,
		});
		if (extra.included.length > 0) {
			const manifest = extra.included.map((e) => ({
				stored: e.stored,
				originalPath: e.path,
				sizeBytes: e.sizeBytes,
				rewriteContent: false,
			}));
			fs.writeFileSync(path.join(stagingDir, "extra-files-manifest.json"), JSON.stringify(manifest, null, 2));
		}

		// 9. Create tar.gz
		const bundleFilename = `claude-session-${sessionId}.tar.gz`;
		const bundlePath = path.join(outputDir, bundleFilename);

		await tar.create({ gzip: true, file: bundlePath, cwd: stagingDir }, fs.readdirSync(stagingDir));

		// 10. Calculate checksum
		const checksum = await sha256File(bundlePath);
		const sizeBytes = fs.statSync(bundlePath).size;
		const jsonlSizeBytes = fs.statSync(jsonlPath).size;

		// 11. Build project name from cwd
		const projectName = path.basename(cwd);

		return {
			bundlePath,
			sessionId,
			sourceCwd: cwd,
			sourceUserDir,
			sizeBytes,
			checksum: `sha256:${checksum}`,
			metadata: {
				...metadata,
				projectName,
				jsonlSizeBytes,
				subagentCount,
				hasFileHistory,
				hasPasteCache,
				hasShellSnapshots,
				hasMemory,
				memoryFileCount: hasMemory ? memoryFileCount : undefined,
				extraFileCount: extra.included.length,
				extraFilesIncluded: extra.included.length > 0 ? extra.included.map((e) => e.path) : undefined,
			},
			extraFiles: {
				included: extra.included.map((e) => ({ path: e.path, sizeBytes: e.sizeBytes })),
				skipped: extra.skipped,
			},
		};
	} finally {
		fs.rmSync(stagingDir, { recursive: true, force: true });
	}
}

function sha256File(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("sha256");
		const stream = fs.createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
		stream.on("error", reject);
	});
}

function countFiles(dir: string, ext: string): number {
	let count = 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			count += countFiles(path.join(dir, entry.name), ext);
		} else if (entry.name.endsWith(ext)) {
			count++;
		}
	}
	return count;
}

export interface CollectExtraFilesParams {
	/** Caller-supplied absolute paths (MCP mode). */
	includePaths: string[];
	/** Edit/Write file paths from the scanner. */
	filesModified: string[];
	/** Session cwd — allowlisted root. */
	cwd: string;
	/** Source user home dir — used to anchor the sensitive deny-list. */
	homeDir: string;
	/** Where to copy included files (a `extra-files/` subdir is created here). */
	stagingDir: string;
	/** Real paths already bundled (session subdir, file-history) — used for dedupe. */
	alreadyBundledRealRoots?: string[];
	/** Allowlisted root dirs. Defaults to [cwd, os.tmpdir(), "/tmp", "/private/tmp"]. */
	allowedRoots?: string[];
	perFileMax?: number;
	totalMax?: number;
}

export interface CollectExtraFilesResult {
	included: Array<{ path: string; sizeBytes: number; stored: string }>;
	skipped: Array<{ path: string; reason: string }>;
}

/**
 * Collect working/temp files to bundle (Part B). Filters the union of caller-supplied
 * includePaths and scanner-detected filesModified through an allowlist + sensitive
 * deny-list + size caps + dedupe, copying survivors into `<stagingDir>/extra-files/`.
 */
export function collectExtraFiles(params: CollectExtraFilesParams): CollectExtraFilesResult {
	const {
		includePaths,
		filesModified,
		cwd,
		homeDir,
		stagingDir,
		alreadyBundledRealRoots = [],
		perFileMax = EXTRA_FILE_MAX_BYTES,
		totalMax = EXTRA_TOTAL_MAX_BYTES,
	} = params;

	const allowedRoots = (params.allowedRoots ?? [cwd, os.tmpdir(), "/tmp", "/private/tmp"]).map(safeRealpath);
	const bundledRoots = alreadyBundledRealRoots.map(safeRealpath);

	const included: CollectExtraFilesResult["included"] = [];
	const skipped: CollectExtraFilesResult["skipped"] = [];

	// Union, includePaths first, deduped by resolved original path.
	// Relative paths anchor to the session cwd (not the bundler's process.cwd()).
	const seenOriginal = new Set<string>();
	const candidates: string[] = [];
	for (const p of [...includePaths, ...filesModified]) {
		const resolved = path.resolve(cwd, p);
		if (seenOriginal.has(resolved)) continue;
		seenOriginal.add(resolved);
		candidates.push(resolved);
	}

	const seenReal = new Set<string>();
	const extraDir = path.join(stagingDir, "extra-files");
	let runningTotal = 0;

	for (const original of candidates) {
		let stat: fs.Stats;
		try {
			stat = fs.statSync(original); // follows symlinks; throws on missing / broken link
		} catch {
			skipped.push({ path: original, reason: "not found" });
			continue;
		}
		if (!stat.isFile()) {
			skipped.push({ path: original, reason: "not a regular file" });
			continue;
		}

		const realPath = safeRealpath(original);

		if (isSensitivePath(original, realPath, homeDir)) {
			skipped.push({ path: original, reason: "sensitive path" });
			continue;
		}
		if (!allowedRoots.some((root) => isUnder(realPath, root))) {
			skipped.push({ path: original, reason: "outside allowed roots" });
			continue;
		}
		if (bundledRoots.some((root) => isUnder(realPath, root))) {
			skipped.push({ path: original, reason: "already in bundle" });
			continue;
		}
		if (seenReal.has(realPath)) continue; // duplicate of an already-included file
		if (stat.size > perFileMax) {
			skipped.push({ path: original, reason: "exceeds per-file size cap" });
			continue;
		}
		if (runningTotal + stat.size > totalMax) {
			skipped.push({ path: original, reason: "exceeds total size cap" });
			continue;
		}

		seenReal.add(realPath);
		fs.mkdirSync(extraDir, { recursive: true });
		const stored = crypto.createHash("sha1").update(original).digest("hex");
		fs.copyFileSync(realPath, path.join(extraDir, stored));
		runningTotal += stat.size;
		included.push({ path: original, sizeBytes: stat.size, stored });
	}

	return { included, skipped };
}
