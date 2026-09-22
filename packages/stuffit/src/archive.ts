/**
 * StuffIt 5 archives: the `.sit` files Macintosh software came in from 1997 on,
 * and the reason a font from that decade is almost never a font file.
 *
 * A classic Mac file is two files — a data fork and a resource fork — and only
 * the data fork survives a copy to anything that is not a Mac. A bitmap font
 * lives *entirely* in its resource fork, so a suitcase sent anywhere had to be
 * wrapped in something that kept both. StuffIt was what people used, and the
 * archive is therefore part of reading the font rather than a step before it.
 *
 * The format is a linked list. A fixed archive header gives the offset of the
 * first entry; each entry header gives the offsets of its neighbours and of the
 * folder it sits in, and is followed immediately by its resource fork's bytes
 * and then its data fork's. Entries are walked in file order, which is how the
 * folder an entry belongs to is always one that has already been seen.
 *
 * Everything is big-endian, as everything on that machine was.
 */

import { arsenic } from "./arsenic.js";
import { method13 } from "./method13.js";

const MAGIC = "StuffIt (c)1997-";
const ENTRY_ID = 0xa5a5a5a5;
const FLAG_ENCRYPTED = 0x20;
const FLAG_FOLDER = 0x40;

/** Seconds between the Mac epoch (1904) and the Unix one. */
const MAC_EPOCH = 2082844800;

export type Fork = {
  /** What it unpacks to. */
  readonly length: number;
  /** What it takes up in the archive. */
  readonly packed: number;
  readonly crc: number;
  /** 0 stored, 13 LZ77 with Huffman, 15 Arsenic. */
  readonly method: number;
  readonly offset: number;
  /** Locked with a password the archive does not carry. */
  readonly encrypted: boolean;
};

export type Entry = {
  readonly kind: "file" | "folder";
  readonly name: string;
  readonly path: string;
  readonly comment: string;
  /** Milliseconds since the Unix epoch, converted from the Mac one. */
  readonly created: number;
  readonly modified: number;
  /** The four-character type and creator the Finder kept, e.g. `FFIL`/`DMOV`. */
  readonly fileType: string;
  readonly creator: string;
  readonly encrypted: boolean;
  readonly data: Fork | null;
  readonly resource: Fork | null;
};

export type Archive = {
  readonly entries: readonly Entry[];
};

export function looksLikeStuffIt(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  return latin1(bytes, 0, MAGIC.length) === MAGIC;
}

function latin1(bytes: Uint8Array, at: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[at + i] ?? 0);
  return out;
}

function macTime(seconds: number): number {
  return (seconds - MAC_EPOCH) * 1000;
}

/**
 * Read an archive's table of contents.
 *
 * Only the headers: forks are left where they lie and unpacked on demand by
 * {@link unpackFork}, because an archive is usually opened to find one thing in
 * it and decompressing everything to answer "what is in here" would be work
 * nobody asked for.
 */
export function readArchive(bytes: Uint8Array): Archive {
  if (!looksLikeStuffIt(bytes)) throw new Error("not a StuffIt archive");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const version = bytes[82];
  if (version !== 5) {
    throw new Error(`StuffIt archive version ${String(version)} is not supported, only 5`);
  }

  const count = view.getUint16(92);
  let at = view.getUint32(94);
  let left = count;

  const entries: Entry[] = [];
  // Folders are remembered by the offset their children name, so that a path
  // can be built as the walk goes rather than in a second pass.
  const folders = new Map<number, string>();

  while (left > 0) {
    if (at + 48 > bytes.length) throw new Error("the archive ends inside an entry header");
    if (view.getUint32(at) !== ENTRY_ID) throw new Error(`no entry header at ${String(at)}`);

    const entryVersion = bytes[at + 4]!;
    const headerEnd = at + view.getUint16(at + 6);
    const flags = bytes[at + 9]!;
    const created = view.getUint32(at + 10);
    const modified = view.getUint32(at + 14);
    const folderOffset = view.getUint32(at + 26);
    const nameLength = view.getUint16(at + 30);
    const dataLength = view.getUint32(at + 34);
    const dataPacked = view.getUint32(at + 38);
    const dataCrc = view.getUint16(at + 42);

    const folder = (flags & FLAG_FOLDER) !== 0;
    let p = at + 46;
    let dataMethod = 0;
    let children = 0;

    if (folder) {
      children = view.getUint16(p);
      p += 2;
      // A folder is followed by a second entry that says 0xffffffff where a
      // length belongs. What it is for is not known; it holds no data and no
      // name, and skipping it is what every reader of this format does. The
      // one after it begins where this one's fields stopped rather than at a
      // header size, which such an entry does not fill in.
      if (dataLength === 0xffffffff) {
        at = p;
        continue;
      }
    } else {
      dataMethod = bytes[p]!;
      p += 2 + bytes[p + 1]!; // the password check, if the entry is encrypted
    }

    const name = latin1(bytes, p, nameLength);
    p += nameLength;

    let comment = "";
    if (p < headerEnd) {
      const commentLength = view.getUint16(p);
      p += 4;
      comment = latin1(bytes, p, commentLength);
      p += commentLength;
    }

    const second = view.getUint16(p);
    p += 4;
    const fileType = latin1(bytes, p, 4);
    const creator = latin1(bytes, p + 4, 4);
    p += 10;
    // Version 1 entries carry four bytes more here than later ones do.
    p += entryVersion === 1 ? 22 : 18;

    let resource: Fork | null = null;
    if ((second & 0x01) !== 0) {
      resource = {
        length: view.getUint32(p),
        packed: view.getUint32(p + 4),
        crc: view.getUint16(p + 8),
        method: bytes[p + 12]!,
        offset: 0,
        encrypted: (flags & FLAG_ENCRYPTED) !== 0,
      };
      p += 14 + bytes[p + 13]!;
    }

    const forkStart = p;
    const path = folderOffset === 0 ? name : `${folders.get(folderOffset) ?? ""}/${name}`;

    entries.push({
      kind: folder ? "folder" : "file",
      name,
      path,
      comment,
      created: macTime(created),
      modified: macTime(modified),
      fileType,
      creator,
      encrypted: (flags & FLAG_ENCRYPTED) !== 0,
      data: folder
        ? null
        : {
            length: dataLength,
            packed: dataPacked,
            crc: dataCrc,
            method: dataMethod,
            offset: forkStart + (resource?.packed ?? 0),
            encrypted: (flags & FLAG_ENCRYPTED) !== 0,
          },
      resource: resource === null ? null : { ...resource, offset: forkStart },
    });

    left--;
    if (folder) {
      folders.set(at, path);
      left += children;
      at = forkStart;
    } else {
      at = forkStart + (resource?.packed ?? 0) + dataPacked;
    }
  }

  return { entries };
}

/**
 * Unpack one fork.
 *
 * Encrypted entries are refused rather than attempted: StuffIt's encryption is
 * a password the archive does not contain, and producing 1326 bytes of noise
 * that happen to be the right length helps nobody.
 */
export function unpackFork(bytes: Uint8Array, fork: Fork): Uint8Array {
  if (fork.encrypted && fork.length > 0) {
    throw new Error("this entry is encrypted, and the password is not in the archive");
  }
  const packed = bytes.subarray(fork.offset, fork.offset + fork.packed);

  const out = unpackBy(fork.method, packed, fork.length);
  if (out.length !== fork.length) {
    throw new Error(
      `a fork unpacked to ${String(out.length)} bytes where the archive says ${String(fork.length)}`,
    );
  }
  return out;
}

function unpackBy(method: number, packed: Uint8Array, length: number): Uint8Array {
  switch (method) {
    case 0:
      return packed.slice();
    case 13:
      return method13(packed, length);
    case 15:
      return arsenic(packed, length).bytes;
    default:
      throw new Error(`StuffIt compression method ${String(method)} is not supported`);
  }
}
