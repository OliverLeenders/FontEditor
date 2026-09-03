/**
 * A very small XML reader, for the two dialects a UFO is made of.
 *
 * Hand-written rather than taken from a library, and rather than `DOMParser`,
 * for the reason the zip writer beside it is: this package has to run in a test
 * under Node as readily as in a browser, and `DOMParser` exists in only one of
 * them. What is needed here is a fraction of XML — elements, attributes, text,
 * and the prologue to skip — and that fraction is small and completely
 * specified.
 *
 * It is deliberately not a validating parser. A malformed file yields whatever
 * structure it can and the layer above reports what it could not find, which is
 * a far more useful answer than a syntax error somebody has to go and look up.
 */

export type XmlElement = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
};

export type XmlNode = XmlElement | { readonly text: string };

export function isElement(node: XmlNode): node is XmlElement {
  return "name" in node;
}

/** Child elements of the given name, in order. */
export function childrenNamed(parent: XmlElement, name: string): XmlElement[] {
  return parent.children.filter((c): c is XmlElement => isElement(c) && c.name === name);
}

/** The first child element of the given name, or `null`. */
export function childNamed(parent: XmlElement, name: string): XmlElement | null {
  return childrenNamed(parent, name)[0] ?? null;
}

/** All text directly inside an element, with its child elements ignored. */
export function textOf(parent: XmlElement): string {
  return parent.children.map((c) => (isElement(c) ? "" : c.text)).join("");
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function unescapeXml(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    return ENTITIES[body] ?? whole;
  });
}

/**
 * Parse a document, returning its root element or `null` if it has none.
 *
 * Only one root is returned even where a file has several; XML permits exactly
 * one, and neither dialect here has cause for more.
 */
export function parseXml(source: string): XmlElement | null {
  let at = 0;
  const stack: Array<{ name: string; attributes: Record<string, string>; children: XmlNode[] }> =
    [];
  let root: XmlElement | null = null;

  const push = (node: XmlNode): void => {
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children.push(node);
  };

  while (at < source.length) {
    const open = source.indexOf("<", at);
    if (open < 0) break;

    if (open > at) {
      const text = source.slice(at, open);
      // Whitespace between elements is layout, not content. Keeping it would put
      // an empty text node between every pair of tags for no one to read.
      if (text.trim() !== "") push({ text: unescapeXml(text) });
    }

    // The prologue, comments and the doctype are skipped whole. A doctype may
    // carry an internal subset in brackets, which is why it is not simply read
    // to the next '>'.
    if (source.startsWith("<?", open) || source.startsWith("<!", open)) {
      at = skipDeclaration(source, open);
      continue;
    }

    const close = source.indexOf(">", open);
    if (close < 0) break;
    const inside = source.slice(open + 1, close);

    if (inside.startsWith("/")) {
      const done = stack.pop();
      if (done !== undefined) {
        // Attached to its parent on the way out, not on the way in: until it
        // closes there is nowhere to say how many children it has.
        if (stack.length === 0) root = done;
        else push(done);
      }
      at = close + 1;
      continue;
    }

    const selfClosing = inside.endsWith("/");
    const body = selfClosing ? inside.slice(0, -1) : inside;
    const name = body.match(/^[^\s/]+/)?.[0] ?? "";
    const element = { name, attributes: readAttributes(body.slice(name.length)), children: [] };

    if (selfClosing) {
      if (stack.length === 0) root = element;
      else push(element);
    } else {
      stack.push(element);
    }
    at = close + 1;
  }

  // An unclosed root still yields what was read, which is more use than nothing.
  return root ?? stack[0] ?? null;
}

function skipDeclaration(source: string, open: number): number {
  if (source.startsWith("<!--", open)) {
    const end = source.indexOf("-->", open);
    return end < 0 ? source.length : end + 3;
  }
  if (source.startsWith("<!DOCTYPE", open)) {
    // Step past an internal subset if there is one, then to the closing '>'.
    const bracket = source.indexOf("[", open);
    const end = source.indexOf(">", open);
    if (bracket >= 0 && bracket < end) {
      const subset = source.indexOf("]", bracket);
      const after = source.indexOf(">", subset < 0 ? bracket : subset);
      return after < 0 ? source.length : after + 1;
    }
    return end < 0 ? source.length : end + 1;
  }
  const end = source.indexOf(">", open);
  return end < 0 ? source.length : end + 1;
}

const ATTRIBUTE = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1];
    if (name === undefined) continue;
    attributes[name] = unescapeXml(match[3] ?? match[4] ?? "");
  }
  return attributes;
}
