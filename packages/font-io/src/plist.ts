import { type XmlElement, isElement, parseXml, textOf } from "./xml.js";

/**
 * Reading the XML property lists a UFO stores its metadata in.
 *
 * Only the half a UFO uses: dictionaries, arrays, strings, numbers and the two
 * booleans. Dates and binary data are legal in a plist and appear in no part of
 * the format this reads, so they arrive as `null` rather than as an error — an
 * unknown value in one key is not a reason to refuse a font.
 */

export type PlistValue =
  | string
  | number
  | boolean
  | null
  | readonly PlistValue[]
  | { readonly [key: string]: PlistValue };

export type PlistDict = { readonly [key: string]: PlistValue };

/** Parse a plist document. `null` when it is not one. */
export function parsePlist(source: string): PlistValue {
  const root = parseXml(source);
  if (root === null) return null;

  // The root is normally <plist>, wrapping a single value. Some writers omit it.
  const value = root.name === "plist" ? firstElement(root) : root;
  return value === null ? null : readValue(value);
}

/** Parse a plist expected to be a dictionary, giving an empty one otherwise. */
export function parsePlistDict(source: string): PlistDict {
  const value = parsePlist(source);
  return isDict(value) ? value : {};
}

function firstElement(parent: XmlElement): XmlElement | null {
  for (const child of parent.children) if (isElement(child)) return child;
  return null;
}

function readValue(element: XmlElement): PlistValue {
  switch (element.name) {
    case "dict":
      return readDict(element);
    case "array":
      return element.children.filter(isElement).map(readValue);
    case "string":
      return textOf(element);
    case "integer":
    case "real": {
      const n = Number(textOf(element).trim());
      return Number.isFinite(n) ? n : null;
    }
    case "true":
      return true;
    case "false":
      return false;
    default:
      return null;
  }
}

/**
 * A dict, whose children alternate `<key>` and value.
 *
 * Read as a sequence rather than by pairing indices, because a key with no value
 * after it — the last line of a truncated file — should end the dict rather than
 * pair with whatever happens to follow.
 */
function readDict(element: XmlElement): PlistDict {
  const out: Record<string, PlistValue> = {};
  const children = element.children.filter(isElement);

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.name !== "key") continue;
    const value = children[i + 1];
    if (value === undefined) break;
    out[textOf(child)] = readValue(value);
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// reading values out again
// ---------------------------------------------------------------------------

export function isDict(value: unknown): value is PlistDict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A number under `key`, or `null` when it is absent or is not one. */
export function plistNumber(dict: PlistDict, key: string): number | null {
  const value = dict[key];
  return typeof value === "number" ? value : null;
}

export function plistString(dict: PlistDict, key: string): string | null {
  const value = dict[key];
  return typeof value === "string" ? value : null;
}

/** A list of strings under `key`, skipping any entry that is not one. */
export function plistStrings(dict: PlistDict, key: string): string[] {
  const value = dict[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** The nested dict under `key`, or an empty one. */
export function plistDict(dict: PlistDict, key: string): PlistDict {
  const value = dict[key];
  return isDict(value) ? value : {};
}

/** Every string entry of a dict, in file order, as pairs. */
export function stringEntries(dict: PlistDict): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value === "string") out.push([key, value] as const);
  }
  return out;
}
