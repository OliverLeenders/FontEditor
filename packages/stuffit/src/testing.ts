/**
 * Building the files these readers read: fixtures, for tests.
 *
 * In `src` rather than in `test` because `@typewright/font-io` needs them too —
 * it reads fonts out of these containers, and a test of that wants an archive
 * to read. It is an entry point of its own so that importing the package does
 * not drag a file writer along with the readers.
 *
 * Every archive in the wild was written by software that no longer runs, so a
 * fixture is either somebody's copyrighted font checked into this repository or
 * a file built here from the format. This is the second. It writes the headers
 * by hand at the offsets the format specifies, which means a test that passes
 * says the reader and the written-down layout agree — and when a field moves,
 * the builder and the reader disagree loudly instead of quietly.
 *
 * Only stored forks: the compressors are tested on their own, and mixing them
 * in here would test them twice while making a failure harder to place.
 */

const MAGIC = "StuffIt (c)1997-1998 Aladdin Systems, Inc., http://www.aladdinsys.com/StuffIt/\r\n";

export type MadeFile = {
  readonly name: string;
  readonly type?: string;
  readonly creator?: string;
  readonly resource?: Uint8Array;
  readonly data?: Uint8Array;
  /** Marked as locked with a password, without actually encrypting anything. */
  readonly encrypted?: boolean;
};

export type MadeFolder = {
  readonly name: string;
  readonly children: readonly MadeFile[];
};

type Made = MadeFile | MadeFolder;

function isFolder(made: Made): made is MadeFolder {
  return "children" in made;
}

class Writer {
  bytes: number[] = [];

  get at(): number {
    return this.bytes.length;
  }

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  u16(value: number): void {
    this.bytes.push((value >> 8) & 0xff, value & 0xff);
  }

  u32(value: number): void {
    this.bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }

  text(value: string): void {
    for (const c of value) this.bytes.push(c.charCodeAt(0) & 0xff);
  }

  blob(value: Uint8Array): void {
    for (const b of value) this.bytes.push(b);
  }

  pad(to: number): void {
    while (this.bytes.length < to) this.bytes.push(0);
  }

  patch32(at: number, value: number): void {
    this.bytes[at] = (value >>> 24) & 0xff;
    this.bytes[at + 1] = (value >>> 16) & 0xff;
    this.bytes[at + 2] = (value >>> 8) & 0xff;
    this.bytes[at + 3] = value & 0xff;
  }
}

/** A StuffIt 5 archive holding these files, with every fork stored. */
export function madeArchive(contents: readonly Made[]): Uint8Array {
  const w = new Writer();
  w.text(MAGIC);
  w.pad(80);
  w.u8(0x1a);
  w.u8(0x00);
  w.u8(5); // version
  w.u8(0); // flags: no comment, no password, nothing extra
  const sizeAt = w.at;
  w.u32(0); // total size, patched at the end
  w.u32(0);
  w.u16(contents.length);
  w.u32(100); // where the first entry goes
  w.u16(0); // header crc, which nothing checks
  w.pad(100);

  for (const made of contents) writeEntry(w, made, 0);

  w.patch32(sizeAt, w.at);
  return Uint8Array.from(w.bytes);
}

function writeEntry(w: Writer, made: Made, folderOffset: number): void {
  const start = w.at;
  const folder = isFolder(made);
  const resource = folder ? undefined : made.resource;
  const data = folder ? undefined : made.data;
  const encrypted = !folder && made.encrypted === true;

  w.u32(0xa5a5a5a5);
  w.u8(1); // entry version
  w.u8(0);
  w.u16(48 + made.name.length); // header size: no comment follows the name
  w.u8(0);
  w.u8((folder ? 0x40 : 0x00) | (encrypted ? 0x20 : 0x00));
  w.u32(3000000000); // created
  w.u32(3000000001); // modified
  w.u32(0); // previous entry, which nothing reads
  w.u32(0); // next entry, likewise: the walk is sequential
  w.u32(folderOffset);
  w.u16(made.name.length);
  w.u16(0); // header crc
  w.u32(data?.length ?? 0);
  w.u32(data?.length ?? 0);
  w.u16(0); // fork crc
  w.u16(0);
  if (folder) w.u16(made.children.length);
  else {
    w.u8(0); // stored
    w.u8(0); // no password data
  }
  w.text(made.name);

  // The second header, which carries what the Finder knew about the file.
  w.u16(resource === undefined ? 0 : 1);
  w.u16(0);
  w.text((folder ? "fold" : (made.type ?? "????")).padEnd(4, " "));
  w.text((folder ? "MACS" : (made.creator ?? "????")).padEnd(4, " "));
  w.u16(0); // finder flags
  for (let i = 0; i < 22; i++) w.u8(0); // what a version 1 entry has here

  if (resource !== undefined) {
    w.u32(resource.length);
    w.u32(resource.length);
    w.u16(0);
    w.u16(0);
    w.u8(0); // stored
    w.u8(0);
  }

  if (resource !== undefined) w.blob(resource);
  if (data !== undefined) w.blob(data);

  if (folder) for (const child of made.children) writeEntry(w, child, start);
}

export type MadeResource = {
  readonly type: string;
  readonly id: number;
  readonly name?: string;
  readonly bytes: Uint8Array;
};

/** A Macintosh resource fork holding these resources. */
export function madeFork(resources: readonly MadeResource[]): Uint8Array {
  const byType = new Map<string, MadeResource[]>();
  for (const r of resources) {
    const list = byType.get(r.type);
    if (list === undefined) byType.set(r.type, [r]);
    else list.push(r);
  }

  const data = new Writer();
  const dataOffsets = new Map<MadeResource, number>();
  for (const r of resources) {
    dataOffsets.set(r, data.at);
    data.u32(r.bytes.length);
    data.blob(r.bytes);
  }

  const names = new Writer();
  const nameOffsets = new Map<MadeResource, number>();
  for (const r of resources) {
    if (r.name === undefined) continue;
    nameOffsets.set(r, names.at);
    names.u8(r.name.length);
    names.text(r.name);
  }

  const typeListLength = 2 + byType.size * 8;
  const map = new Writer();
  for (let i = 0; i < 16; i++) map.u8(0); // a copy of the fork's header, unread
  map.u32(0); // next map
  map.u16(0); // file reference
  map.u16(0); // attributes
  map.u16(28); // where the type list starts, from here
  map.u16(28 + typeListLength + resources.length * 12); // and the name list

  map.u16(byType.size - 1);
  let refAt = typeListLength;
  for (const [type, list] of byType) {
    map.text(type);
    map.u16(list.length - 1);
    map.u16(refAt);
    refAt += list.length * 12;
  }
  for (const list of byType.values()) {
    for (const r of list) {
      map.u16(r.id);
      map.u16(nameOffsets.get(r) ?? 0xffff);
      map.u8(0); // attributes
      const offset = dataOffsets.get(r)!;
      map.u8((offset >> 16) & 0xff);
      map.u8((offset >> 8) & 0xff);
      map.u8(offset & 0xff);
      map.u32(0); // handle
    }
  }
  map.blob(Uint8Array.from(names.bytes));

  const fork = new Writer();
  fork.u32(256);
  fork.u32(256 + data.at);
  fork.u32(data.at);
  fork.u32(map.at);
  fork.pad(256);
  fork.blob(Uint8Array.from(data.bytes));
  fork.blob(Uint8Array.from(map.bytes));
  return Uint8Array.from(fork.bytes);
}
