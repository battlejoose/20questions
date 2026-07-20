export interface KittenVoiceEmbedding {
  readonly data: Float32Array;
  readonly rows: number;
  readonly columns: number;
}

interface ZipEntry {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly compressionMethod: number;
}

function requireRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`Kitten voice archive has an invalid ${label}.`);
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const minimumLength = 22;
  const maximumCommentLength = 65_535;
  const minimumOffset = Math.max(0, bytes.byteLength - minimumLength - maximumCommentLength);
  for (let offset = bytes.byteLength - minimumLength; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('Kitten voice archive is missing its central directory.');
}

function centralDirectoryEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes, view);
  const entryCount = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    requireRange(bytes, cursor, 46, 'central-directory entry');
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('Kitten voice archive has a corrupt central-directory entry.');
    }
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    requireRange(bytes, cursor + 46, fileNameLength, 'entry name');
    entries.push({
      name: new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + fileNameLength)),
      compressionMethod: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      uncompressedSize: view.getUint32(cursor + 24, true),
      localHeaderOffset: view.getUint32(cursor + 42, true),
    });
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress Kitten voice embeddings.');
  }
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // A copied view is guaranteed to own an ArrayBuffer (not SharedArrayBuffer),
  // matching the DOM Compression Streams BufferSource type.
  await writer.write(new Uint8Array(compressed));
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function extractEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireRange(bytes, entry.localHeaderOffset, 30, 'local entry');
  if (view.getUint32(entry.localHeaderOffset, true) !== 0x04034b50) {
    throw new Error(`Kitten voice entry "${entry.name}" has an invalid local header.`);
  }
  const fileNameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataOffset = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  requireRange(bytes, dataOffset, entry.compressedSize, `payload for "${entry.name}"`);
  const payload = bytes.slice(dataOffset, dataOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) return payload;
  if (entry.compressionMethod !== 8) {
    throw new Error(
      `Kitten voice entry "${entry.name}" uses unsupported ZIP compression ${entry.compressionMethod}.`,
    );
  }
  const inflated = await inflateRaw(payload);
  if (inflated.byteLength !== entry.uncompressedSize) {
    throw new Error(`Kitten voice entry "${entry.name}" decompressed to the wrong size.`);
  }
  return inflated;
}

/** Parse a little-endian NumPy float array without adding a ZIP/NPY dependency. */
export function parseKittenNpy(bytes: Uint8Array): KittenVoiceEmbedding {
  requireRange(bytes, 0, 10, 'NumPy header');
  if (
    bytes[0] !== 0x93 ||
    String.fromCharCode(...bytes.slice(1, 6)) !== 'NUMPY'
  ) {
    throw new Error('Kitten voice entry is not a NumPy array.');
  }
  const majorVersion = bytes[6];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerOffset = majorVersion === 1 ? 10 : 12;
  const headerLength = majorVersion === 1
    ? view.getUint16(8, true)
    : view.getUint32(8, true);
  requireRange(bytes, headerOffset, headerLength, 'NumPy metadata');
  const header = new TextDecoder().decode(bytes.slice(headerOffset, headerOffset + headerLength));
  const descriptor = header.match(/['"]descr['"]\s*:\s*['"]([^'"]+)['"]/u)?.[1];
  const shapeText = header.match(/['"]shape['"]\s*:\s*\(([^)]*)\)/u)?.[1];
  const shape = shapeText
    ?.split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter(Number.isFinite) ?? [];
  if (descriptor !== '<f4' && descriptor !== '=f4' && descriptor !== '|f4') {
    throw new Error(`Kitten voice entry has unsupported NumPy type "${descriptor ?? 'unknown'}".`);
  }
  if (shape.length !== 2 || shape.some((value) => value <= 0)) {
    throw new Error('Kitten voice entry must be a two-dimensional style table.');
  }
  const dataOffset = headerOffset + headerLength;
  const expectedBytes = shape[0] * shape[1] * Float32Array.BYTES_PER_ELEMENT;
  requireRange(bytes, dataOffset, expectedBytes, 'NumPy tensor data');
  const copy = bytes.slice(dataOffset, dataOffset + expectedBytes);
  return {
    data: new Float32Array(copy.buffer, copy.byteOffset, expectedBytes / 4),
    rows: shape[0],
    columns: shape[1],
  };
}

/** Read the official KittenML `voices.npz` archive. */
export async function parseKittenVoices(
  archive: ArrayBuffer,
): Promise<ReadonlyMap<string, KittenVoiceEmbedding>> {
  const bytes = new Uint8Array(archive);
  const voices = new Map<string, KittenVoiceEmbedding>();
  for (const entry of centralDirectoryEntries(bytes)) {
    if (!entry.name.endsWith('.npy')) continue;
    const filename = entry.name.split('/').at(-1) ?? entry.name;
    const voiceName = filename.slice(0, -4);
    voices.set(voiceName, parseKittenNpy(await extractEntry(bytes, entry)));
  }
  if (voices.size === 0) {
    throw new Error('Kitten voice archive did not contain any style embeddings.');
  }
  return voices;
}
