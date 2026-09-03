/**
 * Turning a glyph name into a filename.
 *
 * Two problems, both of which bite in practice:
 *
 * **Case.** Windows and macOS filesystems are case-insensitive by default, so
 * `A` and `a` — two perfectly ordinary, distinct glyphs — would fight over one
 * file. The fix, borrowed from UFO because it is the convention the type world
 * already uses, is to append an underscore after every uppercase letter: `A`
 * becomes `A_`, `Adieresis` becomes `A_dieresis`. Lowercase names are untouched,
 * so the common case stays readable.
 *
 * **Illegal characters.** Glyph names may contain anything; filenames may not.
 * Anything outside a conservative safe set is escaped as `%XX`.
 *
 * There is also a third, sillier problem: Windows still reserves `CON`, `PRN`,
 * `NUL` and the `COM1`–`LPT9` device names, and a file called `nul.json` cannot
 * be created. Those get a leading underscore.
 */

const SAFE = /^[a-z0-9._-]$/;

const RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/** Filenames get long fast once escaped; most filesystems stop around 255. */
const MAX_LENGTH = 200;

export function glyphFileName(name: string, extension = ".json"): string {
  let out = "";

  for (const char of name) {
    if (char >= "A" && char <= "Z") {
      out += `${char}_`;
    } else if (SAFE.test(char)) {
      out += char;
    } else {
      out += escapeChar(char);
    }
  }

  if (out.length === 0) out = "_empty";
  if (RESERVED.has(out.toLowerCase())) out = `_${out}`;
  if (out.length > MAX_LENGTH) out = `${out.slice(0, MAX_LENGTH)}-${hash(name)}`;

  return out + extension;
}

function escapeChar(char: string): string {
  let out = "";
  for (const unit of new TextEncoder().encode(char)) {
    out += `%${unit.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/**
 * A short digest, used only to keep two over-long names apart after truncation.
 * Not security-sensitive; collision here costs a name clash, not a leak.
 */
function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * The standard names for printable ASCII.
 *
 * Worth carrying as a table rather than deriving, because these are the names
 * every other tool uses and a designer reads: a glyph called `ampersand` is
 * obvious where `uni0026` is a lookup. The full Adobe Glyph List runs to
 * thousands of entries and mostly covers scripts this editor cannot yet do
 * anything useful with; this is the part that earns its size.
 */
const ASCII_NAMES: Readonly<Record<number, string>> = {
  0x20: "space",
  0x21: "exclam",
  0x22: "quotedbl",
  0x23: "numbersign",
  0x24: "dollar",
  0x25: "percent",
  0x26: "ampersand",
  0x27: "quotesingle",
  0x28: "parenleft",
  0x29: "parenright",
  0x2a: "asterisk",
  0x2b: "plus",
  0x2c: "comma",
  0x2d: "hyphen",
  0x2e: "period",
  0x2f: "slash",
  0x30: "zero",
  0x31: "one",
  0x32: "two",
  0x33: "three",
  0x34: "four",
  0x35: "five",
  0x36: "six",
  0x37: "seven",
  0x38: "eight",
  0x39: "nine",
  0x3a: "colon",
  0x3b: "semicolon",
  0x3c: "less",
  0x3d: "equal",
  0x3e: "greater",
  0x3f: "question",
  0x40: "at",
  0x5b: "bracketleft",
  0x5c: "backslash",
  0x5d: "bracketright",
  0x5e: "asciicircum",
  0x5f: "underscore",
  0x60: "grave",
  0x7b: "braceleft",
  0x7c: "bar",
  0x7d: "braceright",
  0x7e: "asciitilde",
};

/**
 * What to call a glyph for a given code point.
 *
 * Letters and digits are themselves; the rest of ASCII uses its conventional
 * name; anything else falls back to the `uniXXXX` form the AGL specifies, which
 * is also what the importer invents for an unnamed glyph — so a glyph created
 * here and one read from a file end up called the same thing.
 */
export function glyphNameForCodePoint(codePoint: number): string {
  const known = ASCII_NAMES[codePoint];
  if (known !== undefined) return known;

  const isDigit = codePoint >= 0x30 && codePoint <= 0x39;
  const isUpper = codePoint >= 0x41 && codePoint <= 0x5a;
  const isLower = codePoint >= 0x61 && codePoint <= 0x7a;
  if (isDigit || isUpper || isLower) return String.fromCodePoint(codePoint);

  if (codePoint > 0xffff) {
    return `u${codePoint.toString(16).toUpperCase().padStart(6, "0")}`;
  }
  return `uni${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}
