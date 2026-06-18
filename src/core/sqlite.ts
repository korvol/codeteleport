/**
 * Thin, purpose-built wrapper over Node's built-in `node:sqlite`.
 *
 * Why a wrapper: (1) suppress the one-time "SQLite is an experimental feature"
 * warning so it never leaks into CLI output; (2) normalise BLOB columns to
 * Buffers (node:sqlite returns them as plain Uint8Array); (3) expose dynamic
 * column introspection, which the Codex restore relies on because Codex's
 * `state_5.sqlite` schema can change between versions.
 */

// node:sqlite emits an ExperimentalWarning the moment the module is first loaded.
// Patch process.emitWarning to drop just that warning BEFORE loading the module,
// without touching any other process warning.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: unknown, ...rest: unknown[]): void => {
	const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
	const text = typeof warning === "string" ? warning : (warning as Error)?.message || "";
	if (type === "ExperimentalWarning" && /SQLite/i.test(text)) return;
	(originalEmitWarning as (...a: unknown[]) => void)(warning as never, ...rest);
}) as typeof process.emitWarning;

// Load via process.getBuiltinModule (Node 22.3+) rather than a static import: it's
// opaque to bundlers (Vite/esbuild can't statically resolve `node:sqlite` because
// it's missing from their builtin-modules list) and works under both CJS and the
// test runner.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

/** Convert node:sqlite's Uint8Array BLOBs to Buffers; leave everything else as-is. */
function normaliseRow<T extends Record<string, unknown>>(row: T): T {
	for (const key of Object.keys(row)) {
		const value = row[key];
		if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
			(row as Record<string, unknown>)[key] = Buffer.from(value);
		}
	}
	return row;
}

type Param = string | number | bigint | Buffer | Uint8Array | null;

export interface Db {
	/** Run a query returning all rows (BLOBs normalised to Buffer). */
	all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[];
	/** Run a query returning the first row, or undefined. */
	get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined;
	/** Execute a statement (insert/update/etc.). */
	run(sql: string, ...params: Param[]): void;
	/** Execute one or more statements with no parameters (DDL, transactions). */
	exec(sql: string): void;
	/** Column names of a table, or [] if the table does not exist. */
	columns(table: string): string[];
	close(): void;
}

export function openDb(filePath: string, opts?: { readOnly?: boolean }): Db {
	const db = new DatabaseSync(filePath, { readOnly: opts?.readOnly ?? false });

	return {
		all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
			const rows = db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
			return rows.map((r) => normaliseRow(r)) as T[];
		},
		get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
			const row = db.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined;
			return row ? (normaliseRow(row) as T) : undefined;
		},
		run(sql: string, ...params: Param[]): void {
			db.prepare(sql).run(...(params as never[]));
		},
		exec(sql: string): void {
			db.exec(sql);
		},
		columns(table: string): string[] {
			if (!SAFE_IDENTIFIER.test(table)) {
				throw new Error(`Unsafe SQLite table identifier: ${table}`);
			}
			const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
			return rows.map((r) => r.name);
		},
		close(): void {
			db.close();
		},
	};
}
