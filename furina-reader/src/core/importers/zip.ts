import { inflateSync } from 'fflate';

/**
 * Minimal random-access ZIP reader over a Blob.
 * Reads only the central directory up front; each entry is sliced and
 * inflated on demand, so a 500 MB CBZ never has to sit in memory at once.
 * Supports stored (0) and deflate (8) entries and ZIP64 sizes/offsets.
 */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  encrypted: boolean;
}

export const LIMITS = {
  maxEntries: 10_000,
  maxEntrySize: 120 * 1024 * 1024,
  maxRatio: 400, // decompression-bomb guard
};

export class ArchiveError extends Error {}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);
const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));

export class ZipReader {
  private constructor(
    private blob: Blob,
    readonly entries: ZipEntry[],
  ) {}

  static async open(blob: Blob): Promise<ZipReader> {
    if (blob.size < 22) throw new ArchiveError('File is too small to be a ZIP archive.');
    const sig = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (!(sig[0] === 0x50 && sig[1] === 0x4b)) throw new ArchiveError('Not a ZIP/CBZ archive (bad signature).');

    const tailLen = Math.min(blob.size, 65_557 + 20);
    const tailStart = blob.size - tailLen;
    const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (u32(tail, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ArchiveError('ZIP end-of-central-directory not found (truncated file?).');

    let count = u16(tail, eocd + 10);
    let cdSize = u32(tail, eocd + 12);
    let cdOffset = u32(tail, eocd + 16);

    // ZIP64 locator sits 20 bytes before EOCD
    if ((cdOffset === 0xffffffff || count === 0xffff) && eocd >= 20 && u32(tail, eocd - 20) === 0x07064b50) {
      const z64off = u64(tail, eocd - 20 + 8);
      const z = new DataView(await blob.slice(z64off, z64off + 56).arrayBuffer());
      if (u32(z, 0) === 0x06064b50) {
        count = u64(z, 32);
        cdSize = u64(z, 40);
        cdOffset = u64(z, 48);
      }
    }
    if (count > LIMITS.maxEntries) throw new ArchiveError(`Archive has too many entries (${count}).`);
    if (cdOffset + cdSize > blob.size) throw new ArchiveError('Corrupt ZIP central directory.');

    const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
      if (u32(cd, p) !== 0x02014b50) throw new ArchiveError('Corrupt ZIP central directory entry.');
      const flags = u16(cd, p + 8);
      const method = u16(cd, p + 10);
      let csize = u32(cd, p + 20);
      let size = u32(cd, p + 24);
      const nlen = u16(cd, p + 28);
      const xlen = u16(cd, p + 30);
      const clen = u16(cd, p + 32);
      let lho = u32(cd, p + 42);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      // ZIP64 extra field
      let xp = p + 46 + nlen;
      const xend = xp + xlen;
      while (xp + 4 <= xend) {
        const id = u16(cd, xp);
        const len = u16(cd, xp + 2);
        if (id === 0x0001) {
          let q = xp + 4;
          if (size === 0xffffffff) (size = u64(cd, q)), (q += 8);
          if (csize === 0xffffffff) (csize = u64(cd, q)), (q += 8);
          if (lho === 0xffffffff) lho = u64(cd, q);
        }
        xp += 4 + len;
      }
      if (!name.endsWith('/')) {
        entries.push({ name, method, compressedSize: csize, size, localHeaderOffset: lho, encrypted: !!(flags & 1) });
      }
      p += 46 + nlen + xlen + clen;
    }
    return new ZipReader(blob, entries);
  }

  find(name: string) {
    return this.entries.find((e) => e.name === name);
  }

  async read(entry: ZipEntry): Promise<Uint8Array> {
    if (entry.encrypted) throw new ArchiveError(`"${entry.name}" is encrypted; password-protected archives are not supported.`);
    if (entry.size > LIMITS.maxEntrySize) throw new ArchiveError(`"${entry.name}" is too large to open safely.`);
    if (entry.compressedSize > 0 && entry.size / entry.compressedSize > LIMITS.maxRatio && entry.size > 32 * 1024 * 1024) {
      throw new ArchiveError(`"${entry.name}" looks like a decompression bomb and was skipped.`);
    }
    const lh = new DataView(await this.blob.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer());
    if (u32(lh, 0) !== 0x04034b50) throw new ArchiveError('Corrupt ZIP local header.');
    const start = entry.localHeaderOffset + 30 + u16(lh, 26) + u16(lh, 28);
    const raw = new Uint8Array(await this.blob.slice(start, start + entry.compressedSize).arrayBuffer());
    if (entry.method === 0) return raw;
    if (entry.method === 8) return inflateSync(raw, { out: new Uint8Array(entry.size) });
    throw new ArchiveError(`Unsupported ZIP compression method ${entry.method} for "${entry.name}".`);
  }

  async readText(name: string): Promise<string | undefined> {
    const e = this.find(name);
    if (!e) return undefined;
    return new TextDecoder().decode(await this.read(e));
  }
}
