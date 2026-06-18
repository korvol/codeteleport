import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { BUNDLE_FORMAT_VERSION, CLAUDE_DIR, DEFAULT_AGENT_ID, assertSupportedAgent } from "../shared/constants";
import type { BundleOptions, BundleResult } from "../shared/types";
import { bundleAntigravitySession } from "./agents/antigravity/bundle";
import { bundleCodexSession } from "./agents/codex/bundle";
import { collectExtraFiles } from "./extra-files";
import { countFiles, sha256File } from "./fsutil";
import { encodePath } from "./paths";
import { scanSession } from "./scanner";

// Re-exported for back-compat with existing importers/tests.
export { collectExtraFiles } from "./extra-files";
export type { CollectExtraFilesParams, CollectExtraFilesResult } from "./extra-files";

export async function bundleSession(options: BundleOptions): Promise<BundleResult> {
	const { sessionId, cwd } = options;
	const agentId = options.agentId ?? DEFAULT_AGENT_ID;
	assertSupportedAgent(agentId);
	if (agentId === "codex") return bundleCodexSession(options);
	if (agentId === "antigravity") return bundleAntigravitySession(options);
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
				agentId,
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
