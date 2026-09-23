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
  /**
   * Features switched by hand, against what the font does by itself.
   *
   * Only the differences. A shaper turns some features on unasked — ligatures,
   * contextual alternates — and leaves the rest for a document to ask for, so
   * an empty record means "however this font would be set by a text renderer",
   * which is what a proof should show until somebody says otherwise. A tag in
   * here is a deliberate departure from that: `ss01` on to see the alternates,
   * `liga` off to see what a ligature stands in for.
   */
  readonly features: Readonly<Record<string, boolean>>;
};

/** Everything read from the text, which is how every line was set before phase 23. */
export const READ_FROM_TEXT: TextSettings = {
  direction: "auto",
  script: null,
  language: null,
  features: {},
};

/** Whether two settings say the same thing, so a view can keep one engine. */
export const sameTextSettings = (a: TextSettings, b: TextSettings): boolean =>
  a.direction === b.direction &&
  a.script === b.script &&
  a.language === b.language &&
  sameFeatures(a.features, b.features);

function sameFeatures(
  a: Readonly<Record<string, boolean>>,
  b: Readonly<Record<string, boolean>>,
): boolean {
  const tags = Object.keys(a);
  if (tags.length !== Object.keys(b).length) return false;
  return tags.every((tag) => a[tag] === b[tag]);
}

/** The tags a line is set with: what a renderer turns on, plus and minus by hand. */
export function featureTagsFor(
  defaults: readonly string[],
  chosen: Readonly<Record<string, boolean>>,
): string[] {
  const tags = new Set(defaults);
  for (const [tag, on] of Object.entries(chosen)) {
    if (on) tags.add(tag);
    else tags.delete(tag);
  }
  return [...tags];
}
