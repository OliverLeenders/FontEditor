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
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
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
