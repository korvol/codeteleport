import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { BUNDLE_FORMAT_VERSION } from "../../../shared/constants";
import type { BundleOptions, BundleResult } from "../../../shared/types";
import { collectExtraFiles } from "../../extra-files";
import { sha256File } from "../../fsutil";
import { openDb } from "../../sqlite";
import { codexDirDefault, findCodexRolloutPath } from "./local";
import { scanCodexSession } from "./scanner";

export interface CodexState {
	threadRow: Record<string, unknown> | null;
	dynamicTools: Record<string, unknown>[];
}

/**
 * Read the restore-relevant rows from Codex's state_5.sqlite. Best-effort: the
 * rollout JSONL is the source of truth, so a missing DB just yields empty state
 * (the row is reconstructed from the transcript on restore).
 */
function readCodexState(codexDir: string, sessionId: string): CodexState {
	const dbPath = path.join(codexDir, "state_5.sqlite");
	if (!fs.existsSync(dbPath)) return { threadRow: null, dynamicTools: [] };
	let db: ReturnType<typeof openDb> | undefined;
	try {
		db = openDb(dbPath, { readOnly: true });
		const threadRow =
			db.columns("threads").length > 0 ? (db.get("select * from threads where id = ?", sessionId) ?? null) : null;
		const dynamicTools =
			db.columns("thread_dynamic_tools").length > 0
				? db.all("select * from thread_dynamic_tools where thread_id = ? order by position", sessionId)
				: [];
		return { threadRow: threadRow as Record<string, unknown> | null, dynamicTools };
	} catch {
		return { threadRow: null, dynamicTools: [] };
	} finally {
		db?.close();
	}
}

/** Bundle a Codex session (rollout transcript + restore-only SQLite state). */
export async function bundleCodexSession(options: BundleOptions): Promise<BundleResult> {
	const { sessionId, cwd } = options;
	const codexDir = options.codexDir ?? codexDirDefault();
	const sourceUserDir = options.sourceUserDir ?? os.homedir();
	const outputDir = options.outputDir ?? os.tmpdir();

	const rolloutPath = findCodexRolloutPath(sessionId, codexDir);
	if (!rolloutPath) {
		throw new Error(`Codex session rollout not found for ${sessionId} under ${path.join(codexDir, "sessions")}`);
	}

	const scan = scanCodexSession(rolloutPath);
	const state = readCodexState(codexDir, scan.sessionId || sessionId);
	const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeteleport-codex-"));

	try {
		const rolloutRelPath = path.relative(codexDir, rolloutPath).split(path.sep).join("/");
		const meta = {
			sessionId: scan.sessionId || sessionId,
			sourceCwd: cwd,
			sourceUserDir,
			agentId: "codex",
			formatVersion: BUNDLE_FORMAT_VERSION,
			sourceCodexHome: codexDir,
			rolloutRelPath,
			rolloutFileName: path.basename(rolloutPath),
		};
		fs.writeFileSync(path.join(stagingDir, "meta.json"), JSON.stringify(meta, null, 2));

		fs.copyFileSync(rolloutPath, path.join(stagingDir, "session.jsonl"));
		fs.writeFileSync(path.join(stagingDir, "codex-state.json"), JSON.stringify(state, null, 2));

		// Part B: extra working/temp files (apply_patch-detected + caller includePaths).
		const extra = collectExtraFiles({
			includePaths: options.includePaths ?? [],
			filesModified: scan.metadata.filesModified ?? [],
			cwd,
			homeDir: sourceUserDir,
			stagingDir,
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

		const bundlePath = path.join(outputDir, `codex-session-${meta.sessionId}.tar.gz`);
		await tar.create({ gzip: true, file: bundlePath, cwd: stagingDir }, fs.readdirSync(stagingDir));

		const checksum = await sha256File(bundlePath);
		const sizeBytes = fs.statSync(bundlePath).size;
		const jsonlSizeBytes = fs.statSync(rolloutPath).size;

		return {
			bundlePath,
			sessionId: meta.sessionId,
			sourceCwd: cwd,
			sourceUserDir,
			sizeBytes,
			checksum: `sha256:${checksum}`,
			metadata: {
				...scan.metadata,
				projectName: path.basename(cwd),
				jsonlSizeBytes,
				agentId: "codex",
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
