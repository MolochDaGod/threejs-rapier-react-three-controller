/**
 * Minimal, dependency-free ZIP reader.
 *
 * Parses the End-of-Central-Directory record + central directory headers, then
 * inflates each entry. STORED (method 0) entries are copied verbatim; DEFLATE
 * (method 8) entries are inflated with the browser's built-in
 * `DecompressionStream("deflate-raw")` — so we ship no zip dependency.
 *
 * Scope: enough to crack open typical asset archives (a model + its textures).
 * ZIP64 and encrypted entries are not supported (rare for art exports).
 */

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;

// Safety caps: a malicious archive can inflate a few KB into gigabytes ("zip
// bomb"), exhausting the tab's memory. Cap both per-entry and whole-archive
// inflated output and fail fast rather than letting the browser OOM.
const MAX_TOTAL_BYTES = 512 * 1024 * 1024; // 512 MB across the whole archive
const MAX_ENTRY_BYTES = 256 * 1024 * 1024; // 256 MB for any single entry

/** Inflate a deflate-raw stream, aborting if output exceeds `cap` bytes. */
async function inflateRaw(bytes: Uint8Array, cap: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser can't inflate ZIP entries (no DecompressionStream).");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      void reader.cancel().catch(() => {});
      throw new Error("ZIP entry expands beyond the safety limit; refusing to inflate.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Read every file entry of a ZIP archive into a `path → bytes` map. */
export async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const len = buffer.byteLength;

  // The EOCD lives at the very end, after an optional comment (≤ 65535 bytes).
  let eocd = -1;
  const minPos = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid ZIP archive (no end-of-directory record).");

  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true); // central-directory offset
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let budget = MAX_TOTAL_BYTES; // remaining inflated bytes allowed across the archive

  for (let i = 0; i < count && off + 46 <= len; i++) {
    if (view.getUint32(off, true) !== CDH_SIG) break;
    const method = view.getUint16(off + 10, true);
    const compSize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = decoder.decode(bytes.subarray(off + 46, off + 46 + nameLen));

    // Directories and macOS resource-fork noise are skipped.
    const skip = name.endsWith("/") || name.startsWith("__MACOSX") || name.split("/").pop()?.startsWith("._");
    if (!skip && localOff + 30 <= len) {
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) {
        if (comp.byteLength > budget) throw new Error("ZIP exceeds the safety size limit.");
        out.set(name, comp.slice());
        budget -= comp.byteLength;
      } else if (method === 8) {
        const inflated = await inflateRaw(comp, Math.min(MAX_ENTRY_BYTES, budget));
        out.set(name, inflated);
        budget -= inflated.byteLength;
      }
      // other compression methods are silently skipped
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
