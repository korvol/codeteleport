/**
 * Recursive binary path rewriting for protobuf-encoded SQLite BLOBs.
 *
 * Antigravity stores trajectory payloads as protobuf blobs. Rewriting a path
 * inside one changes its byte length, so the length-delimited field prefixes
 * (and every enclosing message's prefix) must be recomputed — a plain string
 * replace would corrupt the framing. We walk the wire format, recurse into
 * length-delimited fields that parse as sub-messages, and fall back to a string
 * replace for leaf bytes that don't (e.g. UTF-8 paths, which start with '/' and
 * fail to parse as a valid tag).
 */

import { rewritePaths } from "../../paths";

/**
 * Relocate any embedded path inside a single protobuf leaf string. Uses the
 * separator-tolerant content rewriter (raw mode) so it catches both native
 * (`C:\\…`) and `file://`-URI (`C:/…`) forms and translates separators to the
 * target OS. `file://` URIs are then forced back to forward slashes (URIs are
 * OS-independent) with any doubled authority slash collapsed.
 */
export function rewritePathLeaf(str: string, fromStr: string, toStr: string): string {
	const rewritten = rewritePaths(str, fromStr, toStr, { jsonEscaped: false });
	if (rewritten === str || !rewritten.includes("file://")) return rewritten;
	// Bound the URI at whitespace, quotes, and control/binary bytes so the slash
	// normalization can't reach into adjacent non-URI bytes of a binary leaf.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — stop the URI scan at binary/control bytes
	const URI = /file:\/\/[^\s"'\x00-\x1f]*/g;
	return rewritten.replace(URI, (m) => m.replace(/\\/g, "/")).replace(/file:\/{4,}/g, "file:///");
}

function readVarint(buffer: Buffer, offset: number): { value: number; bytes: number } {
	let value = 0;
	let shift = 0;
	let bytes = 0;
	while (offset + bytes < buffer.length) {
		const byte = buffer[offset + bytes];
		value |= (byte & 0x7f) << shift;
		bytes++;
		if ((byte & 0x80) === 0) break;
		shift += 7;
	}
	return { value, bytes };
}

function writeVarint(value: number): Buffer {
	const bytes: number[] = [];
	let temp = value;
	while (temp >= 0x80) {
		bytes.push((temp & 0x7f) | 0x80);
		temp >>>= 7;
	}
	bytes.push(temp & 0x7f);
	return Buffer.from(bytes);
}

/** Byte length of a non-length-delimited (primitive) field's value. */
function primitiveFieldSize(wireType: number, buffer: Buffer, offset: number): number {
	if (wireType === 0) {
		// varint
		let bytes = 0;
		while (offset + bytes < buffer.length) {
			const byte = buffer[offset + bytes];
			bytes++;
			if ((byte & 0x80) === 0) break;
		}
		return bytes;
	}
	if (wireType === 1) return 8; // 64-bit
	if (wireType === 5) return 4; // 32-bit
	throw new Error(`Unsupported wire type: ${wireType}`);
}

/**
 * Read the bytes of the first length-delimited field at `fieldPath` (1-based field
 * numbers, descending into sub-messages), or null if any hop is missing. Used to
 * pull message text out of an Antigravity step blob (e.g. user text at 19→2,
 * assistant text at 20→1) without a full protobuf schema.
 */
export function readProtobufField(buffer: Buffer, fieldPath: number[]): Buffer | null {
	let cur = buffer;
	for (const want of fieldPath) {
		let offset = 0;
		let found: Buffer | null = null;
		while (offset < cur.length) {
			const key = readVarint(cur, offset);
			offset += key.bytes;
			const wireType = key.value & 0x07;
			const fieldNum = key.value >> 3;
			if (wireType === 2) {
				const lenInfo = readVarint(cur, offset);
				offset += lenInfo.bytes;
				const val = cur.subarray(offset, offset + lenInfo.value);
				offset += lenInfo.value;
				if (fieldNum === want) {
					found = val;
					break;
				}
			} else if (wireType === 0) {
				offset += readVarint(cur, offset).bytes;
			} else if (wireType === 1) {
				offset += 8;
			} else if (wireType === 5) {
				offset += 4;
			} else {
				return null;
			}
		}
		if (!found) return null;
		cur = found;
	}
	return cur;
}

/** Convenience: read a UTF-8 string field at `fieldPath`, or null. */
export function readProtobufString(buffer: Buffer, fieldPath: number[]): string | null {
	const buf = readProtobufField(buffer, fieldPath);
	return buf === null ? null : buf.toString("utf8");
}

/** Rewrite every occurrence of `fromStr` to `toStr` inside a protobuf-encoded buffer. */
export function rewriteProtobuf(buffer: Buffer, fromStr: string, toStr: string): Buffer {
	if (!fromStr || fromStr === toStr) return buffer;

	let offset = 0;
	const chunks: Buffer[] = [];

	while (offset < buffer.length) {
		const key = readVarint(buffer, offset);
		offset += key.bytes;
		const wireType = key.value & 0x07;
		const fieldNum = key.value >> 3;

		// Anything that isn't a sane tag means this isn't protobuf — bail to the
		// caller's string-replace fallback.
		if (fieldNum === 0 || wireType > 5 || wireType === 3 || wireType === 4) {
			throw new Error("Invalid protobuf tag or wire type");
		}

		if (wireType === 2) {
			const lenInfo = readVarint(buffer, offset);
			offset += lenInfo.bytes;
			const length = lenInfo.value;
			if (offset + length > buffer.length) {
				throw new Error("Protobuf length-delimited field overruns buffer");
			}
			const valBuf = buffer.subarray(offset, offset + length);
			offset += length;

			let rewrittenVal: Buffer;
			try {
				rewrittenVal = rewriteProtobuf(valBuf, fromStr, toStr);
			} catch {
				// Leaf bytes that aren't a sub-message: treat as a string and relocate
				// any embedded path (separator-tolerant + cross-OS aware). latin1 is a
				// lossless 1:1 byte mapping, so non-path bytes round-trip unchanged.
				const str = valBuf.toString("latin1");
				const rewritten = rewritePathLeaf(str, fromStr, toStr);
				rewrittenVal = rewritten === str ? valBuf : Buffer.from(rewritten, "latin1");
			}

			chunks.push(writeVarint((fieldNum << 3) | 2));
			chunks.push(writeVarint(rewrittenVal.length));
			chunks.push(rewrittenVal);
		} else {
			const start = offset - key.bytes;
			const size = primitiveFieldSize(wireType, buffer, offset);
			chunks.push(buffer.subarray(start, offset + size));
			offset += size;
		}
	}

	return Buffer.concat(chunks);
}
