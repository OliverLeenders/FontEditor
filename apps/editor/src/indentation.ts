/**
 * Indenting feature source, as text in and text out.
 *
 * Each function takes the source and the selection and answers with the source
 * and selection after the key: Tab, Shift+Tab, Enter and `}`. Plain functions
 * over strings, so what each key does is tested without a text box, and the
 * text box only has to put the answer back.
 *
 * An indent is four spaces. A tab typed into the source becomes spaces, so the
 * file lines up the same in every tool that reads it.
 */

export const INDENT = "    ";

export type Edit = { readonly text: string; readonly start: number; readonly end: number };

/** Where the line holding `at` starts. */
function lineStart(text: string, at: number): number {
  return text.lastIndexOf("\n", at - 1) + 1;
}

/**
 * Where the last line a selection touches ends.
 *
 * A selection ending just after a newline does not touch the line after it: a
 * whole line selected by dragging down to the start of the next is one line.
 */
function lastLineEnd(text: string, start: number, end: number): number {
  const reach = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const found = text.indexOf("\n", reach);
  return found === -1 ? text.length : found;
}

/** Tab: spaces to the next indent stop, or a level onto every selected line. */
export function indent(text: string, start: number, end: number): Edit {
  if (!text.slice(start, end).includes("\n")) {
    const column = start - lineStart(text, start);
    const spaces = " ".repeat(INDENT.length - (column % INDENT.length));
    const at = start + spaces.length;
    return { text: text.slice(0, start) + spaces + text.slice(end), start: at, end: at };
  }

  const from = lineStart(text, start);
  const to = lastLineEnd(text, start, end);
  const lines = text.slice(from, to).split("\n");
  // Empty lines stay empty, rather than gaining spaces nothing will ever follow.
  const shifted = lines.map((line) => (line === "" ? line : INDENT + line));

  let added = 0;
  let addedBeforeStart = 0;
  let offset = from;
  lines.forEach((line, index) => {
    if (line !== "") {
      if (offset < end || (offset === end && index === 0)) added += INDENT.length;
      if (index === 0 && start > from) addedBeforeStart = INDENT.length;
    }
    offset += line.length + 1;
  });

  return {
    text: text.slice(0, from) + shifted.join("\n") + text.slice(to),
    start: start + addedBeforeStart,
    end: end + added,
  };
}

/** Shift+Tab: up to one level off every line the selection touches. */
export function outdent(text: string, start: number, end: number): Edit {
  const from = lineStart(text, start);
  const to = lastLineEnd(text, start, end);
  const lines = text.slice(from, to).split("\n");

  let removedBeforeStart = 0;
  let removedBeforeEnd = 0;
  let offset = from;
  const shifted = lines.map((line) => {
    const cut = /^( {1,4}|\t)/.exec(line)?.[0].length ?? 0;
    removedBeforeStart += Math.min(cut, Math.max(0, start - offset));
    removedBeforeEnd += Math.min(cut, Math.max(0, end - offset));
    offset += line.length + 1;
    return line.slice(cut);
  });

  return {
    text: text.slice(0, from) + shifted.join("\n") + text.slice(to),
    start: start - removedBeforeStart,
    end: end - removedBeforeEnd,
  };
}

/**
 * Enter: a new line at the indentation of this one, a level deeper after `{`.
 *
 * Between a `{` and a `}` on the same line, the `}` goes down a line of its own
 * at the outer level and the cursor waits on an indented line between them.
 */
export function newline(text: string, start: number, end: number): Edit {
  const from = lineStart(text, start);
  const before = text.slice(from, start);
  const indentation = /^[ \t]*/.exec(before)?.[0] ?? "";
  const after = text.slice(end);
  const opens = before.trimEnd().endsWith("{");

  if (opens && /^[ \t]*\}/.test(after)) {
    const inner = `\n${indentation}${INDENT}`;
    const at = start + inner.length;
    return {
      text: text.slice(0, start) + inner + `\n${indentation}` + after.replace(/^[ \t]*/, ""),
      start: at,
      end: at,
    };
  }

  const insert = `\n${indentation}${opens ? INDENT : ""}`;
  const at = start + insert.length;
  return { text: text.slice(0, start) + insert + after, start: at, end: at };
}

/**
 * `}` typed on a line of nothing but indentation: back a level first.
 *
 * `null` anywhere else, where the brace is simply typed.
 */
export function closeBrace(text: string, start: number, end: number): Edit | null {
  if (start !== end) return null;
  const from = lineStart(text, start);
  const typed = text.slice(from, start);
  if (!/^ +$/.test(typed)) return null;

  const level = Math.floor((typed.length - 1) / INDENT.length) * INDENT.length;
  const at = from + level + 1;
  return {
    text: text.slice(0, from) + " ".repeat(level) + "}" + text.slice(end),
    start: at,
    end: at,
  };
}
