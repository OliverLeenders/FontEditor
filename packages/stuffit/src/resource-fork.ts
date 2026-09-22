/**
 * The Macintosh resource fork: a file's second half, and where a classic Mac
 * font actually keeps its glyphs.
 *
 * A resource is a numbered, typed, optionally named blob. The type is four
 * characters — `FOND` for a font family, `NFNT` for a bitmap strike, `sfnt` for
 * an outline font, `ICN#` for an icon — and the fork is a little database of
 * them: a data area holding every blob with its length in front, and a map at
 * the other end listing the types, and for each type the resources of that
 * type, and for each resource where in the data area it starts.
 *
 * Offsets in the map are relative to the map, and offsets within the type list
 * are relative to the type list. That is not a quirk to work around; it is what
 * let the Resource Manager load the map alone and go looking only for what was
 * asked for.
 */

export type Resource = {
  /** The four-character type, e.g. `FOND`. */
  readonly type: string;
  readonly id: number;
  /** The name it was given, or `""` — most resources have none. */
  readonly name: string;
  readonly attributes: number;
  readonly bytes: Uint8Array;
};

export type ResourceFork = {
  readonly resources: readonly Resource[];
};

function latin1(bytes: Uint8Array, at: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[at + i] ?? 0);
  return out;
}

/** Read every resource in a fork, in the order the map lists them. */
export function readResourceFork(bytes: Uint8Array): ResourceFork {
  if (bytes.length < 16) throw new Error("a resource fork needs at least its header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const dataAt = view.getUint32(0);
  const mapAt = view.getUint32(4);
  if (mapAt + 28 > bytes.length) throw new Error("the resource map is past the end of the fork");

  const typeListAt = mapAt + view.getUint16(mapAt + 24);
  const nameListAt = mapAt + view.getUint16(mapAt + 26);
  // The counts are all "one less than", which is the format saying that a list
  // of nothing is not worth being able to express.
  const typeCount = view.getUint16(typeListAt) + 1;

  const resources: Resource[] = [];
  for (let i = 0; i < typeCount; i++) {
    const typeAt = typeListAt + 2 + i * 8;
    if (typeAt + 8 > bytes.length) throw new Error("the type list runs past the end of the fork");

    const type = latin1(bytes, typeAt, 4);
    const count = view.getUint16(typeAt + 4) + 1;
    const refListAt = typeListAt + view.getUint16(typeAt + 6);

    for (let k = 0; k < count; k++) {
      const refAt = refListAt + k * 12;
      if (refAt + 12 > bytes.length) throw new Error("a resource list runs past the end");

      const id = view.getInt16(refAt);
      const nameAt = view.getInt16(refAt + 2);
      const attributes = bytes[refAt + 4]!;
      const offset = (bytes[refAt + 5]! << 16) | (bytes[refAt + 6]! << 8) | bytes[refAt + 7]!;

      let name = "";
      if (nameAt >= 0) {
        const p = nameListAt + nameAt;
        name = latin1(bytes, p + 1, bytes[p] ?? 0);
      }

      const start = dataAt + offset;
      if (start + 4 > bytes.length) throw new Error(`resource ${type} ${String(id)} is not there`);
      const length = view.getUint32(start);
      if (start + 4 + length > bytes.length) {
        throw new Error(`resource ${type} ${String(id)} runs past the end of the fork`);
      }

      resources.push({
        type,
        id,
        name,
        attributes,
        bytes: bytes.subarray(start + 4, start + 4 + length),
      });
    }
  }

  return { resources };
}

/** Every resource of one type, in map order. */
export function resourcesOfType(fork: ResourceFork, type: string): readonly Resource[] {
  return fork.resources.filter((r) => r.type === type);
}
