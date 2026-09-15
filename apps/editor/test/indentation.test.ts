import { describe, expect, it } from "vitest";

import { type Edit, closeBrace, indent, newline, outdent } from "../src/indentation.js";

/**
 * What Tab, Shift+Tab, Enter and `}` do to feature source.
 *
 * Each case is written with a `|` for the cursor, or two for a selection, so the
 * text before and after reads the way it would on screen.
 */

/** Text with `|` marking the selection, as text and offsets. */
function parse(marked: string): { text: string; start: number; end: number } {
  const start = marked.indexOf("|");
  const second = marked.indexOf("|", start + 1);
  const end = second === -1 ? start : second - 1;
  return { text: marked.replaceAll("|", ""), start, end };
}

/** An edit written back out with its selection marked. */
function mark(edit: { text: string; start: number; end: number }): string {
  const { text, start, end } = edit;
  return start === end
    ? `${text.slice(0, start)}|${text.slice(start)}`
    : `${text.slice(0, start)}|${text.slice(start, end)}|${text.slice(end)}`;
}

const run = (key: (text: string, start: number, end: number) => Edit | null, marked: string) => {
  const { text, start, end } = parse(marked);
  const edit = key(text, start, end);
  if (edit === null) throw new Error("the key was left to be typed as it would be");
  return mark(edit);
};

describe("Tab", () => {
  it("inserts four spaces at the start of a line", () => {
    expect(run(indent, "|sub a by b;")).toBe("    |sub a by b;");
  });

  it("goes to the next stop of four, not four further", () => {
    expect(run(indent, "ab|c")).toBe("ab  |c");
    expect(run(indent, "    x|")).toBe("    x   |");
  });

  it("replaces a selection within a line", () => {
    expect(run(indent, "a|bc|d")).toBe("a   |d");
  });

  it("indents every line a selection touches, and leaves empty lines empty", () => {
    expect(run(indent, "|sub a by b;\n\nsub c by d;|")).toBe(
      "|    sub a by b;\n\n    sub c by d;|",
    );
  });

  it("does not indent the line after a selection that ends at its start", () => {
    expect(run(indent, "|one\ntwo\n|three")).toBe("|    one\n    two\n|three");
  });
});

describe("Shift+Tab", () => {
  it("takes up to four spaces off every line a selection touches", () => {
    expect(run(outdent, "    |one\n      two|\nthree")).toBe("|one\n  two|\nthree");
  });

  it("takes off only what is there", () => {
    expect(run(outdent, "  a|b")).toBe("a|b");
    expect(run(outdent, "a|b")).toBe("a|b");
  });

  it("takes off a tab as one level", () => {
    expect(run(outdent, "\t|x")).toBe("|x");
  });
});

describe("Enter", () => {
  it("keeps the indentation of the line", () => {
    expect(run(newline, "    sub a by b;|")).toBe("    sub a by b;\n    |");
  });

  it("goes a level deeper after an opening brace", () => {
    expect(run(newline, "feature liga {|")).toBe("feature liga {\n    |");
  });

  it("puts the closing brace on its own line between braces", () => {
    expect(run(newline, "    lookup X {|} X;")).toBe("    lookup X {\n        |\n    } X;");
  });
});

describe("}", () => {
  it("goes back a level on a line of nothing but indentation", () => {
    expect(run(closeBrace, "feature liga {\n    sub f i by fi;\n    |")).toBe(
      "feature liga {\n    sub f i by fi;\n}|",
    );
  });

  it("goes back to the stop below, from between stops", () => {
    expect(run(closeBrace, "      |")).toBe("    }|");
  });

  it("is simply typed anywhere else", () => {
    const { text, start, end } = parse("sub a by b;|");
    expect(closeBrace(text, start, end)).toBeNull();
    const at = parse("|");
    expect(closeBrace(at.text, at.start, at.end)).toBeNull();
  });
});
