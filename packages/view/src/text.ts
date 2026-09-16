/**
 * How a line is set, beyond the text itself.
 *
 * A shaper needs three things a string does not carry: which way the text runs,
 * which script's rules to choose, and which language's. All three can be read
 * from the text — which is what happens until somebody says otherwise — but a
 * font is often drawn for one of them in particular, and a proof that cannot be
 * told which is a proof of the shaper's guess.
 *
 * Here rather than beside the shaper, because the views are what choose it and
 * the shaper is loaded only once text is set.
 */

/** Which way the text runs, or `auto` to read it from the text itself. */
export type TextDirection = "auto" | "ltr" | "rtl";

export type TextSettings = {
  readonly direction: TextDirection;
  /** An OpenType script tag — `arab`, `latn` — or `null` to read it from the text. */
  readonly script: string | null;
  /** An OpenType language tag — `ARA`, `TRK` — or `null` to read it from the text. */
  readonly language: string | null;
};

/** Everything read from the text, which is how every line was set before phase 23. */
export const READ_FROM_TEXT: TextSettings = { direction: "auto", script: null, language: null };

/** Whether two settings say the same thing, so a view can keep one engine. */
export const sameTextSettings = (a: TextSettings, b: TextSettings): boolean =>
  a.direction === b.direction && a.script === b.script && a.language === b.language;
