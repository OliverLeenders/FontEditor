import { describe, expect, it } from "vitest";

import {
  isDict,
  parsePlist,
  parsePlistDict,
  plistDict,
  plistNumber,
  plistString,
  plistStrings,
  stringEntries,
} from "../src/plist.js";
import { childNamed, childrenNamed, isElement, parseXml, textOf } from "../src/xml.js";

/**
 * The two readers everything UFO rests on, tested on their own.
 *
 * They are exercised through `.glif` and `fontinfo.plist` elsewhere, which is
 * the real proof they work — but a round trip only ever shows the cases the
 * writer emits, and these have to survive files written by other programs.
 */

describe("reading XML", () => {
  it("returns the root, its attributes and its text", () => {
    const root = parseXml('<glyph name="a" format="2">hello</glyph>')!;
    expect(root.name).toBe("glyph");
    expect(root.attributes["name"]).toBe("a");
    expect(root.attributes["format"]).toBe("2");
    expect(textOf(root)).toBe("hello");
  });

  it("nests elements and finds them by name", () => {
    const root = parseXml("<outline><contour><point/><point/></contour><anchor/></outline>")!;
    const contour = childNamed(root, "contour")!;
    expect(childrenNamed(contour, "point")).toHaveLength(2);
    expect(childNamed(root, "nothing")).toBeNull();
    expect(root.children.filter(isElement)).toHaveLength(2);
  });

  it("takes a self-closing element as an element with nothing in it", () => {
    const root = parseXml('<a><b x="1"/></a>')!;
    const b = childNamed(root, "b")!;
    expect(b.attributes["x"]).toBe("1");
    expect(b.children).toEqual([]);
  });

  it("drops whitespace between tags but keeps text that says something", () => {
    // Otherwise every pair of tags has an empty text node between them for no
    // one to read.
    const root = parseXml("<a>\n  <b>  </b>\n  <c> word </c>\n</a>")!;
    expect(root.children.filter((n) => !isElement(n))).toEqual([]);
    expect(textOf(childNamed(root, "c")!)).toBe(" word ");
  });

  it("unescapes the five entities and numeric references", () => {
    const root = parseXml("<a>&lt;tag&gt; &amp; &quot;quoted&quot; &#65;&#x42;</a>")!;
    expect(textOf(root)).toBe('<tag> & "quoted" AB');
  });

  it("leaves an entity it does not know alone rather than dropping it", () => {
    expect(textOf(parseXml("<a>&nbsp;x</a>")!)).toBe("&nbsp;x");
  });

  it("skips the prologue, the doctype and comments", () => {
    const source = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      "<!-- written by something else -->",
      "<plist><dict/></plist>",
    ].join("\n");
    const root = parseXml(source)!;
    expect(root.name).toBe("plist");
    expect(childNamed(root, "dict")).not.toBeNull();
  });

  it("gives nothing for a document with no element in it", () => {
    expect(parseXml("")).toBeNull();
    expect(parseXml('<?xml version="1.0"?>')).toBeNull();
  });

  it("keeps what it read of a file that stops in the middle", () => {
    // A truncated file is a file to salvage, not a reason to throw.
    const root = parseXml("<a><b>text</b><c>");
    expect(root?.name).toBe("a");
    expect(textOf(childNamed(root!, "b")!)).toBe("text");
  });
});

describe("reading a plist", () => {
  const source = `<?xml version="1.0"?>
<plist version="1.0">
  <dict>
    <key>familyName</key><string>Test</string>
    <key>unitsPerEm</key><integer>1000</integer>
    <key>italicAngle</key><real>-12.5</real>
    <key>isFixedPitch</key><false/>
    <key>public.glyphOrder</key>
    <array><string>a</string><string>b</string><integer>3</integer></array>
    <key>groups</key>
    <dict><key>public.kern1.O</key><array><string>O</string></array></dict>
  </dict>
</plist>`;

  it("reads each kind of value", () => {
    const dict = parsePlistDict(source);
    expect(plistString(dict, "familyName")).toBe("Test");
    expect(plistNumber(dict, "unitsPerEm")).toBe(1000);
    expect(plistNumber(dict, "italicAngle")).toBe(-12.5);
    expect(dict["isFixedPitch"]).toBe(false);
  });

  it("reads an array, and skips what is not the type asked for", () => {
    const dict = parsePlistDict(source);
    expect(plistStrings(dict, "public.glyphOrder")).toEqual(["a", "b"]);
    expect(plistStrings(dict, "familyName")).toEqual([]);
    expect(plistNumber(dict, "familyName")).toBeNull();
    expect(plistString(dict, "unitsPerEm")).toBeNull();
  });

  it("reads a nested dict, and hands back an empty one for anything else", () => {
    const groups = plistDict(parsePlistDict(source), "groups");
    expect(plistStrings(groups, "public.kern1.O")).toEqual(["O"]);
    expect(plistDict(parsePlistDict(source), "familyName")).toEqual({});
  });

  it("lists the string entries in file order", () => {
    const dict = parsePlistDict(
      "<plist><dict><key>b</key><string>2</string><key>a</key><string>1</string><key>n</key><integer>3</integer></dict></plist>",
    );
    expect(stringEntries(dict)).toEqual([
      ["b", "2"],
      ["a", "1"],
    ]);
  });

  it("takes a plist whose writer left the wrapper off", () => {
    expect(parsePlistDict("<dict><key>a</key><string>1</string></dict>")).toEqual({ a: "1" });
  });

  it("ends a dict at a key with no value rather than pairing it with the next", () => {
    // The last line of a truncated file, and the one case where guessing would
    // silently produce a wrong font rather than a smaller one.
    expect(parsePlistDict("<dict><key>a</key><string>1</string><key>b</key></dict>")).toEqual({
      a: "1",
    });
  });

  it("gives an empty dict for something that is not one", () => {
    expect(parsePlistDict("<plist><array><string>a</string></array></plist>")).toEqual({});
    expect(parsePlistDict("not xml at all")).toEqual({});
  });

  it("knows a dict from an array", () => {
    expect(isDict(parsePlist("<plist><dict/></plist>"))).toBe(true);
    expect(isDict(parsePlist("<plist><array/></plist>"))).toBe(false);
    expect(isDict(null)).toBe(false);
  });
});
