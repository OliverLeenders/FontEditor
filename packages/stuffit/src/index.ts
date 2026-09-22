/**
 * @typewright/stuffit
 *
 * Reading the containers old Macintosh fonts arrive in.
 *
 * Nothing here knows what a font is. A StuffIt archive holds files, a resource
 * fork holds numbered blobs, and whether one of those blobs is a bitmap strike
 * or an icon is somebody else's question — `@typewright/font-io` asks it. The
 * split is the same one the rest of the packages keep: a format that would be
 * exactly as useful to a program that had never heard of typography does not
 * belong in the package that knows about glyphs.
 *
 * What is here is old, in the way that matters: these formats are finished. No
 * new `.sit` archive will be written with a compressor this code has not seen,
 * because nothing writes them any more. That makes the goal completeness on a
 * fixed target rather than keeping up with one, and it makes an unsupported
 * method worth naming in the error instead of guessing past.
 *
 * Two compressors are implemented, which between them cover StuffIt 5: method
 * 13, LZ77 with Huffman codes, and method 15, the block-sorting arithmetic
 * coder Aladdin called Arsenic. Method 0 is the archive saying it did not
 * bother. Earlier StuffIt versions — the `SIT!` format with its own five
 * methods — are a different reader, and are not here.
 */

export type { Archive, Entry, Fork } from "./archive.js";
export { looksLikeStuffIt, readArchive, unpackFork } from "./archive.js";

export type { Resource, ResourceFork } from "./resource-fork.js";
export { readResourceFork, resourcesOfType } from "./resource-fork.js";

export type { ArsenicResult } from "./arsenic.js";
export { arsenic } from "./arsenic.js";
export { method13 } from "./method13.js";
