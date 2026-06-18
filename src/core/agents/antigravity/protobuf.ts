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
				// Leaf bytes that aren't a sub-message: treat as a string.
				const str = valBuf.toString("utf8");
				rewrittenVal = str.includes(fromStr) ? Buffer.from(str.split(fromStr).join(toStr), "utf8") : valBuf;
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
