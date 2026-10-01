import {
  type FontDocument,
  type FontInfo,
  type Grid,
  type VerticalMetrics,
  DEFAULT_GRID,
  FEATURES_NOT_SCALED,
  STYLE_MAP_STYLES,
  USE_TYPO_METRICS_BIT,
  commonAdvance,
  derivedVerticalMetrics,
  fixedWidthOf,
  iconEm,
  iconGrid,
  isWholeStep,
  offWidthGlyphs,
} from "@typewright/font-model";
import {
  fitToWidth,
  infoProblem,
  scaleFontTo,
  setFixedWidth,
  setGrid,
  setInfo,
} from "@typewright/tools";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./FontInfoPanel.module.css";
import { BarMenu } from "./BarMenu.js";
import { InfoIcon } from "./icons.js";
import { Stepper } from "./Stepper.js";

/**
 * The font's own facts: what it is called, how big its em is, where its lines
 * are.
 *
 * These have been in the model since the beginning and readable from an
 * imported file, and until now nothing could write them — so a font drawn from
 * nothing exported as "Untitled Regular" at 1000 units per em, permanently, and
 * the x-height ruler on the canvas was wherever the default put it.
 *
 * Every field commits on blur or Enter rather than on each keystroke. Committing
 * per keystroke would put "7", "75" and "750" in the undo stack on the way to
 * typing 750, and would move the canvas rulers under a half-typed number.
 */
type Field = {
  readonly key: keyof FontInfo;
  readonly label: string;
  /**
   * An `override` is a number that may be left empty, meaning "work it out",
   * with what would be worked out shown greyed in the box. A `flag` is one bit
   * of `openTypeOS2Selection`.
   */
  readonly kind: "text" | "number" | "choice" | "override" | "flag" | "embedding";
  readonly hint: string;
  /** For a choice: the values it may take, in the order they are offered. */
  readonly options?: readonly string[];
  /** For a flag: which bit. */
  readonly bit?: number;
};

/** The four embedding levels, least restrictive first, and the `fsType` bit each is. */
const EMBEDDING_LEVELS: readonly { readonly label: string; readonly bit: number | null }[] = [
  { label: "Installable", bit: null },
  { label: "Editable", bit: 3 },
  { label: "Preview and print", bit: 2 },
  { label: "Restricted", bit: 1 },
];

/** A field that holds a list of bits, read as one. */
function bitsOf(info: FontInfo, key: keyof FontInfo): readonly number[] {
  const value = info[key];
  return Array.isArray(value) ? (value as readonly number[]) : [];
}

/** Which derived value each override stands in for. */
const DERIVED: Partial<Record<keyof FontInfo, keyof VerticalMetrics>> = {
  openTypeOS2TypoAscender: "typoAscender",
  openTypeOS2TypoDescender: "typoDescender",
  openTypeOS2TypoLineGap: "typoLineGap",
  openTypeHheaAscender: "hheaAscender",
  openTypeHheaDescender: "hheaDescender",
  openTypeHheaLineGap: "hheaLineGap",
  openTypeOS2WinAscent: "winAscent",
  openTypeOS2WinDescent: "winDescent",
};

/**
 * The fields, in sections, because there are two dozen of them now.
 *
 * The order is the order somebody fills them in. What the font is and how big
 * it is come first because everything else depends on them; who made it and
 * what may be done with it come last because they are written once and then
 * left alone. Grouping is not decoration here — a flat list of two dozen boxes
 * is a form nobody reads.
 */
const SECTIONS: readonly { readonly title: string; readonly fields: readonly Field[] }[] = [
  {
    title: "Names",
    fields: [
      { key: "familyName", label: "Family", kind: "text", hint: "The name the font is known by" },
      { key: "styleName", label: "Style", kind: "text", hint: "Regular, Italic, Bold, and so on" },
      {
        key: "openTypeNamePreferredFamilyName",
        label: "Typographic family",
        kind: "text",
        hint: "For a family of more than four styles. Leave empty if the family name says everything.",
      },
      {
        key: "openTypeNamePreferredSubfamilyName",
        label: "Typographic style",
        kind: "text",
        hint: "The style within the typographic family — Light, Semibold, and so on",
      },
      {
        key: "styleMapFamilyName",
        label: "Menu family",
        kind: "text",
        hint: "The four-slot family this file belongs to. Empty means the family name.",
      },
      {
        key: "styleMapStyleName",
        label: "Menu style",
        kind: "choice",
        options: STYLE_MAP_STYLES,
        hint: "Which of the four slots this is. What an operating system groups by.",
      },
    ],
  },
  {
    title: "Metrics",
    fields: [
      {
        key: "unitsPerEm",
        label: "Units per em",
        kind: "number",
        hint: "The units everything is measured in. Changing it asks whether the drawing grows with it.",
      },
      { key: "ascender", label: "Ascender", kind: "number", hint: "Top of a d, an h, an l" },
      { key: "descender", label: "Descender", kind: "number", hint: "Bottom of a g, a p, a y" },
      { key: "xHeight", label: "x-height", kind: "number", hint: "Top of an x" },
      { key: "capHeight", label: "Cap height", kind: "number", hint: "Top of an H" },
      {
        key: "italicAngle",
        label: "Italic angle",
        kind: "number",
        hint: "Degrees from upright. Negative leans to the right, as an italic does.",
      },
    ],
  },
  {
    // Three sets of the same two numbers, because three kinds of software read
    // three different ones — and the line height a font sets differs between a
    // browser, a word processor and a layout program exactly as far as these
    // disagree. Empty is "work it out", which is what every font exported before
    // these could be set, so leaving them alone changes nothing.
    title: "Line spacing",
    fields: [
      {
        key: "openTypeOS2Selection",
        label: "Use typo metrics",
        kind: "flag",
        bit: USE_TYPO_METRICS_BIT,
        hint: "Tell Windows to space lines by the typographic values below rather than the clipping box. What modern fonts do.",
      },
      {
        key: "openTypeOS2TypoAscender",
        label: "Typo ascender",
        kind: "override",
        hint: "OS/2 typographic ascender: the line height the specification says everybody should use",
      },
      {
        key: "openTypeOS2TypoDescender",
        label: "Typo descender",
        kind: "override",
        hint: "OS/2 typographic descender. Zero or negative.",
      },
      {
        key: "openTypeOS2TypoLineGap",
        label: "Typo line gap",
        kind: "override",
        hint: "Extra space between lines, added to the typographic ascender and descender",
      },
      {
        key: "openTypeHheaAscender",
        label: "hhea ascender",
        kind: "override",
        hint: "What macOS and most browsers space lines by",
      },
      {
        key: "openTypeHheaDescender",
        label: "hhea descender",
        kind: "override",
        hint: "The hhea descender. Zero or negative.",
      },
      {
        key: "openTypeHheaLineGap",
        label: "hhea line gap",
        kind: "override",
        hint: "Extra space between lines on macOS and in browsers",
      },
      {
        key: "openTypeOS2WinAscent",
        label: "Win ascent",
        kind: "override",
        hint: "How far above the baseline Windows draws before clipping. Anything taller is cut off.",
      },
      {
        key: "openTypeOS2WinDescent",
        label: "Win descent",
        kind: "override",
        hint: "How far below the baseline Windows draws, as a positive distance. Anything deeper is cut off.",
      },
    ],
  },
  {
    title: "Classification",
    fields: [
      {
        key: "openTypeOS2WeightClass",
        label: "Weight class",
        kind: "number",
        hint: "1 to 1000. Regular is 400, bold is 700.",
      },
      {
        key: "openTypeOS2WidthClass",
        label: "Width class",
        kind: "number",
        hint: "1 to 9. Normal is 5, condensed is 3, expanded is 7.",
      },
      {
        key: "versionMajor",
        label: "Version",
        kind: "number",
        hint: "The major version. Goes in the name table and the head table.",
      },
      {
        key: "versionMinor",
        label: "Revision",
        kind: "number",
        hint: "The minor version, 0 to 999",
      },
      {
        key: "openTypeOS2VendorID",
        label: "Vendor id",
        kind: "text",
        hint: "Four characters identifying whoever made the font",
      },
    ],
  },
  {
    title: "Who and what",
    fields: [
      { key: "openTypeNameDesigner", label: "Designer", kind: "text", hint: "Who drew it" },
      {
        key: "openTypeNameDesignerURL",
        label: "Designer URL",
        kind: "text",
        hint: "Where to find them",
      },
      {
        key: "openTypeNameManufacturer",
        label: "Manufacturer",
        kind: "text",
        hint: "Who published it, where that is somebody else",
      },
      {
        key: "openTypeNameManufacturerURL",
        label: "Manufacturer URL",
        kind: "text",
        hint: "Where to find them",
      },
      { key: "copyright", label: "Copyright", kind: "text", hint: "The copyright notice" },
      {
        key: "trademark",
        label: "Trademark",
        kind: "text",
        hint: "The trademark notice, if there is one",
      },
      {
        key: "openTypeNameLicense",
        label: "Licence",
        kind: "text",
        hint: "What may be done with the font",
      },
      {
        key: "openTypeNameLicenseURL",
        label: "Licence URL",
        kind: "text",
        hint: "Where the licence is",
      },
      {
        key: "openTypeNameDescription",
        label: "Description",
        kind: "text",
        hint: "A sentence about the font, shown by some software",
      },
    ],
  },
  {
    // A licence's decision rather than a default's, which is why it has a section
    // of its own: it was written as installable for every font whatever its licence
    // allowed, and that is a promise the font was making on nobody's authority.
    title: "Embedding",
    fields: [
      {
        key: "openTypeOS2Type",
        label: "Embedding",
        kind: "embedding",
        hint: "What a document may do with this font embedded in it. The licence decides this.",
      },
      {
        key: "openTypeOS2Type",
        label: "No subsetting",
        kind: "flag",
        bit: 8,
        hint: "The whole font must be embedded, never only the glyphs a document uses",
      },
      {
        key: "openTypeOS2Type",
        label: "Bitmaps only",
        kind: "flag",
        bit: 9,
        hint: "Only bitmaps may be embedded, not the outlines",
      },
    ],
  },
];

export function FontInfoPanel(): React.JSX.Element {
  const store = useEditorStore();
  const info = useStoreValue((s) => s.session.editor.document.info);
  const document = useStoreValue((s) => s.session.editor.document);
  // What each empty override would come out as. Measuring the Windows box walks
  // every glyph, so it is worked out once per document rather than per field.
  const derived = useMemo(() => derivedVerticalMetrics(document), [document]);
  const reading = useStoreValue((s) => s.ownership === "reading");
  /** An em typed in and not yet applied, while the panel asks what it means. */
  const [asking, setAsking] = useState<number | null>(null);

  return (
    <BarMenu
      label="Font info"
      icon={InfoIcon}
      disabled={reading}
      title={reading ? "Another tab is saving this project" : "Name, em and vertical metrics"}
      panelClassName={styles.panel}
      panelLabel="Font info"
    >
      {SECTIONS.map((section) => (
        <Fragment key={section.title}>
          <section className={styles.section}>
            <h3 className={styles.heading}>{section.title}</h3>
            {section.fields.map((field) =>
              field.key === "unitsPerEm" ? (
                <Fragment key={field.label}>
                  <Field
                    field={field}
                    info={info}
                    store={store}
                    derived={null}
                    asking={asking}
                    onAsk={setAsking}
                  />
                  {asking === null ? null : (
                    <EmQuestion
                      from={info.unitsPerEm}
                      to={asking}
                      hasFeatures={document.features.trim() !== ""}
                      onScale={() => {
                        store.applyTool(scaleFontTo(store.editor, asking));
                        setAsking(null);
                      }}
                      onKeep={() => {
                        store.applyTool(setInfo(store.editor, { unitsPerEm: asking }));
                        setAsking(null);
                      }}
                      onCancel={() => setAsking(null)}
                    />
                  )}
                </Fragment>
              ) : (
                <Field
                  key={field.label}
                  field={field}
                  info={info}
                  store={store}
                  derived={derivedFor(field, derived)}
                />
              ),
            )}
            {section.title === "Metrics" ? (
              <FixedWidthFields document={document} store={store} />
            ) : null}
          </section>
          {/* Beside the em, which its step is counted in and which it may ask to change. */}
          {section.title === "Metrics" ? <GridSection document={document} store={store} /> : null}
        </Fragment>
      ))}
      <p className={styles.note}>
        {info.familyName} {info.styleName} &middot; {info.unitsPerEm} units per em
      </p>
    </BarMenu>
  );
}

/**
 * One field, holding its own draft.
 *
 * The draft exists so a half-typed value can sit in the box without being
 * pushed through the model: "-" on the way to "-200" is not a number, and an
 * empty box on the way to a new one is not a font with no name.
 */
function Field({
  field,
  info,
  store,
  derived,
  asking = null,
  onAsk,
}: {
  field: Field;
  info: FontInfo;
  store: ReturnType<typeof useEditorStore>;
  /** For an override: what an empty box comes out as. */
  derived: number | null;
  /** For the em: a value waiting on the question of what it means, shown in the box. */
  asking?: number | null;
  /** For the em: asked with a new value instead of applying it. */
  onAsk?: (value: number) => void;
}): React.JSX.Element {
  const current = info[field.key];
  const settled = current === null ? "" : String(current);
  const numeric = field.kind === "number" || field.kind === "override";
  const [draft, setDraft] = useState(settled);
  /** An override left empty, which is a value of its own: "work it out". */
  const cleared = field.kind === "override" && draft.trim() === "";
  const [editing, setEditing] = useState(false);
  /**
   * Set by Escape, read by the blur it causes.
   *
   * Escape puts the box back and then takes the focus off it, and taking the
   * focus off a box is what commits it — with the draft this render closed
   * over, which is the value being abandoned. A ref rather than state because
   * the blur happens before React renders again, so a state flag set here would
   * still read as false there.
   */
  const abandoning = useRef(false);

  // An undo, or a font opened while the panel is up, has to reach the box —
  // and an em being asked about stays in it until it is answered.
  useEffect(() => {
    if (!editing) setDraft(asking === null ? settled : String(asking));
  }, [settled, editing, asking]);

  const commit = (): void => {
    setEditing(false);
    if (abandoning.current) {
      abandoning.current = false;
      setDraft(settled);
      return;
    }
    if (draft === settled) return;

    const number = Number(draft);
    // A box on its way to a number holds things that are not one: "-" before
    // the digits, "" before anything. Neither is a value to write — except that
    // an override's empty box is exactly one, and it means "work it out".
    if (numeric && !cleared && (draft.trim() === "" || !Number.isFinite(number))) {
      setDraft(settled);
      return;
    }

    const value: string | number | null = cleared ? null : numeric ? number : draft;

    const patch = { [field.key]: value } as Partial<FontInfo>;
    const problem = infoProblem({ ...info, ...patch });
    if (problem !== null) {
      setDraft(settled);
      return;
    }
    if (onAsk !== undefined && typeof value === "number") {
      onAsk(value);
      return;
    }
    store.applyTool(setInfo(store.editor, patch));
  };

  // Not asked of a flag, which has no draft: its box text would go into the
  // font's list of bits as a string, and be refused as one.
  const problem =
    field.kind === "flag" || field.kind === "embedding"
      ? null
      : infoProblem({
          ...info,
          ...({
            [field.key]: cleared ? null : numeric ? Number(draft) : draft,
          } as Partial<FontInfo>),
        });

  /** What an arrow key moves this field by, big and small. */
  const stepBy = (big: boolean): number => (big ? (field.key === "unitsPerEm" ? 64 : 10) : 1);

  /** The number the arrows work from: the draft, or what an empty override would be. */
  const stepping = (): number | null =>
    cleared ? derived : Number.isFinite(Number(draft)) ? Number(draft) : null;

  const step = (next: number): void => {
    setDraft(String(next));
    const patch = { [field.key]: next } as Partial<FontInfo>;
    if (infoProblem({ ...info, ...patch }) !== null) return;
    if (onAsk !== undefined) onAsk(next);
    else store.applyTool(setInfo(store.editor, patch));
  };

  const stepped = (input: React.JSX.Element): React.JSX.Element =>
    numeric ? (
      <Stepper
        // An empty override steps from what it would come out as, so the first
        // press moves the number shown in the box rather than jumping from zero.
        value={stepping()}
        label={field.label}
        // The em is a grid people speak of in round hundreds; the rest are
        // units, and a unit is the smallest thing there is.
        step={1}
        bigStep={stepBy(true)}
        onStep={step}
      >
        {input}
      </Stepper>
    ) : (
      input
    );

  // The embedding level: one of four, stored as which of three bits is set, with
  // the flags beside it left as they are.
  if (field.kind === "embedding") {
    const bits = bitsOf(info, field.key);
    const level =
      EMBEDDING_LEVELS.find((l) => l.bit !== null && bits.includes(l.bit)) ?? EMBEDDING_LEVELS[0]!;
    return (
      <label className={styles.field}>
        <span className={styles.label}>{field.label}</span>
        <select
          className={styles.input}
          value={level.label}
          title={field.hint}
          aria-label={field.label}
          onChange={(event) => {
            const chosen = EMBEDDING_LEVELS.find((l) => l.label === event.target.value);
            if (chosen === undefined) return;
            const flags = bits.filter((b) => b > 3);
            const next = chosen.bit === null ? flags : [chosen.bit, ...flags].sort((a, b) => a - b);
            store.applyTool(setInfo(store.editor, { [field.key]: next }));
          }}
        >
          {EMBEDDING_LEVELS.map((l) => (
            <option key={l.label} value={l.label}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // A flag writes straight through, as a choice does below.
  if (field.kind === "flag") {
    const bit = field.bit ?? 0;
    return (
      <label className={styles.field}>
        <span className={styles.label}>{field.label}</span>
        <input
          type="checkbox"
          className={styles.check}
          checked={bitsOf(info, field.key).includes(bit)}
          title={field.hint}
          aria-label={field.label}
          onChange={(event) => {
            const others = bitsOf(info, field.key).filter((b) => b !== bit);
            const bits = event.target.checked ? [...others, bit].sort((a, b) => a - b) : others;
            store.applyTool(setInfo(store.editor, { [field.key]: bits }));
          }}
        />
      </label>
    );
  }

  // A choice writes straight through: there is no half-typed state to protect
  // and nothing to abandon, so a draft would only delay the answer.
  if (field.kind === "choice") {
    return (
      <label className={styles.field}>
        <span className={styles.label}>{field.label}</span>
        <select
          className={styles.input}
          value={String(info[field.key])}
          title={field.hint}
          aria-label={field.label}
          onChange={(event) => {
            const patch = { [field.key]: event.target.value } as Partial<FontInfo>;
            store.applyTool(setInfo(store.editor, patch));
          }}
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className={styles.field}>
      <span className={styles.label}>{field.label}</span>
      {stepped(
        <input
          className={styles.input}
          // A text box even for a number: the browser's own value sanitising
          // throws away a lone "-" on the way to a negative, and a box that
          // cannot hold what a half-typed number looks like is a box you cannot
          // type a negative into. The arrows a number input would have given are
          // handled below, and are the ones the stepper beside it presses.
          type="text"
          {...(numeric ? { inputMode: "decimal" as const } : {})}
          autoComplete="off"
          spellCheck={false}
          value={draft}
          placeholder={field.kind === "override" && derived !== null ? String(derived) : undefined}
          title={field.hint}
          aria-label={field.label}
          aria-invalid={editing && problem !== null}
          data-wrong={editing && problem !== null ? "true" : undefined}
          onFocus={() => setEditing(true)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (numeric && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              const from = stepping();
              if (from === null) return;
              event.preventDefault();
              step(from + stepBy(event.shiftKey) * (event.key === "ArrowUp" ? 1 : -1));
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
            // Abandoning the edit rather than the panel: the box goes back to what
            // it held, and the panel stays up.
            if (event.key === "Escape") {
              event.stopPropagation();
              abandoning.current = true;
              setDraft(settled);
              setEditing(false);
              event.currentTarget.blur();
            }
          }}
        />,
      )}
      {editing && problem !== null ? (
        <span className={styles.problem} role="alert">
          {problem}
        </span>
      ) : null}
    </label>
  );
}

/**
 * What a new em means, asked where it was typed.
 *
 * Both answers are things people mean. An em typed wrong and put right wants
 * the numbers kept; a font moved to an em its grid divides — an icon font from
 * 1000 to 960 — wants everything to grow or shrink with it, so nothing on the
 * page changes size. Guessing either would be wrong half the time, and the
 * wrong one is a font whose every glyph is a different size or in the wrong
 * place.
 */
function EmQuestion({
  from,
  to,
  hasFeatures,
  onScale,
  onKeep,
  onCancel,
}: {
  readonly from: number;
  readonly to: number;
  readonly hasFeatures: boolean;
  readonly onScale: () => void;
  readonly onKeep: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className={styles.ask} role="group" aria-label="Change the em">
      <p className={styles.question}>
        From {from} to {to} units per em. Scale the drawing with it?
      </p>
      <div className={styles.answers}>
        <button
          type="button"
          className={styles.button}
          title="Outlines, spacing, kerning, guides and metrics grow or shrink with the em, so nothing changes size"
          onClick={onScale}
        >
          Scale the font
        </button>
        <button
          type="button"
          className={styles.button}
          title="Only the em changes, so every glyph sets at a new size"
          onClick={onKeep}
        >
          Keep the numbers
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {hasFeatures ? <p className={styles.caveat}>{FEATURES_NOT_SCALED}</p> : null}
    </div>
  );
}

/**
 * Whether every glyph is one width, and which.
 *
 * Saying so changes nothing drawn — the glyphs that are another width are
 * counted, and fitted only when asked, since a font is often made fixed-width
 * before it has been looked over. See `fixed-width.ts` in the model.
 */
function FixedWidthFields({
  document,
  store,
}: {
  readonly document: FontDocument;
  readonly store: ReturnType<typeof useEditorStore>;
}): React.JSX.Element {
  const width = fixedWidthOf(document);
  const off = useMemo(
    () => (width === null ? 0 : offWidthGlyphs(document, width).length),
    [document, width],
  );
  return (
    <>
      <label className={styles.field}>
        <span className={styles.label}>Fixed width</span>
        <input
          type="checkbox"
          className={styles.check}
          checked={width !== null}
          title="Every glyph one width: a code font, a terminal font, an icon font"
          aria-label="Fixed width"
          onChange={(event) => store.applyTool(setFixedWidth(store.editor, event.target.checked))}
        />
      </label>
      <UnitsField
        label="Width"
        hint="The width of every glyph. Marks may have none, and wide characters twice it."
        value={document.fixedWidth ?? commonAdvance(document)}
        disabled={width === null}
        onCommit={(next) => store.applyTool(setFixedWidth(store.editor, true, next))}
      />
      {width !== null && off > 0 ? (
        <p className={styles.caveat}>
          {off === 1 ? "One glyph is" : `${String(off)} glyphs are`} another width.{" "}
          <button
            type="button"
            className={styles.button}
            title="Give each the width with its drawing centred in it. Marks and wide glyphs are left alone."
            onClick={() => store.applyTool(fitToWidth(store.editor))}
          >
            Fit to {width}
          </button>
        </p>
      ) : null}
    </>
  );
}

/** Grids by the size an icon is drawn at, and whole units, which every font has. */
const GRID_PRESETS: readonly {
  readonly id: string;
  readonly label: string;
  readonly pixels: number | null;
  readonly parts: number;
}[] = [
  { id: "units", label: "Whole units", pixels: null, parts: 1 },
  { id: "16", label: "16 px icon", pixels: 16, parts: 1 },
  { id: "20", label: "20 px icon", pixels: 20, parts: 1 },
  { id: "24", label: "24 px icon", pixels: 24, parts: 1 },
  { id: "24-half", label: "24 px icon, half pixels", pixels: 24, parts: 2 },
  { id: "32", label: "32 px icon", pixels: 32, parts: 1 },
  { id: "48", label: "48 px icon", pixels: 48, parts: 1 },
];

type GridPreset = (typeof GRID_PRESETS)[number];

function presetGrid(preset: GridPreset, unitsPerEm: number): Grid | null {
  return preset.pixels === null ? DEFAULT_GRID : iconGrid(unitsPerEm, preset.pixels, preset.parts);
}

/** The preset a grid is, on this em, or `null` for one somebody set by hand. */
function presetOf(grid: Grid, unitsPerEm: number): GridPreset | null {
  return (
    GRID_PRESETS.find((preset) => {
      const made = presetGrid(preset, unitsPerEm);
      return made !== null && Math.abs(made.step - grid.step) < 1e-9 && made.major === grid.major;
    }) ?? null
  );
}

/** A step as it is read: whole where it is whole, and to a hundredth where not. */
const stepText = (step: number): string => String(Math.round(step * 100) / 100);

/**
 * The grid the font is drawn on: what a drag snaps to, and what the canvas
 * draws when the grid is shown (G).
 *
 * A preset for the common case, an icon drawn at a size in pixels, and the step
 * and the major spacing for anything else. Where a preset's step does not come
 * out whole on this em, the panel says so and offers the em it would.
 */
function GridSection({
  document,
  store,
}: {
  readonly document: FontDocument;
  readonly store: ReturnType<typeof useEditorStore>;
}): React.JSX.Element {
  const { grid, info } = document;
  const preset = presetOf(grid, info.unitsPerEm);
  const suggested =
    preset === null || preset.pixels === null ? null : iconEm(info.unitsPerEm, preset.pixels);

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Grid</h3>
      <label className={styles.field}>
        <span className={styles.label}>Preset</span>
        <select
          className={styles.input}
          value={preset?.id ?? "custom"}
          title="What the font is drawn on. Drags snap to it, and G shows it."
          aria-label="Grid preset"
          onChange={(event) => {
            const chosen = GRID_PRESETS.find((p) => p.id === event.target.value);
            const next = chosen === undefined ? null : presetGrid(chosen, info.unitsPerEm);
            if (next !== null) store.applyTool(setGrid(store.editor, next.step, next.major));
          }}
        >
          {GRID_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {preset === null ? <option value="custom">Custom</option> : null}
        </select>
      </label>
      <UnitsField
        label="Step"
        hint="Units between two lines: what a point snaps to"
        value={grid.step}
        onCommit={(next) => store.applyTool(setGrid(store.editor, next, grid.major))}
      />
      <UnitsField
        label="Major every"
        hint="Every how many steps a line is drawn stronger. 0 for none."
        value={grid.major}
        onCommit={(next) => store.applyTool(setGrid(store.editor, grid.step, next))}
      />
      {isWholeStep(grid) ? null : (
        <p className={styles.caveat}>
          A step of {stepText(grid.step)} units puts points between units, which are rounded when
          the font is compiled.{" "}
          {suggested !== null && suggested !== info.unitsPerEm ? (
            <button
              type="button"
              className={styles.button}
              title="Scale the whole font to an em this grid divides into whole units"
              onClick={() => store.applyTool(scaleFontTo(store.editor, suggested))}
            >
              Scale the font to {suggested}
            </button>
          ) : null}
        </p>
      )}
    </section>
  );
}

/**
 * A number of units that is not one of the font's facts — the fixed width, the
 * grid — committed on Enter or on leaving the box, as the fields above are.
 */
function UnitsField({
  label,
  hint,
  value,
  disabled = false,
  onCommit,
}: {
  readonly label: string;
  readonly hint: string;
  readonly value: number | null;
  readonly disabled?: boolean;
  readonly onCommit: (next: number) => void;
}): React.JSX.Element {
  const settled = value === null ? "" : stepText(value);
  const [draft, setDraft] = useState(settled);
  const [editing, setEditing] = useState(false);
  /** Set by Escape, read by the blur it causes; see `Field`. */
  const abandoning = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(settled);
  }, [settled, editing]);

  const commit = (): void => {
    setEditing(false);
    if (abandoning.current) {
      abandoning.current = false;
      setDraft(settled);
      return;
    }
    const number = Number(draft);
    if (draft === settled || draft.trim() === "" || !Number.isFinite(number)) {
      setDraft(settled);
      return;
    }
    onCommit(number);
  };

  const current = Number.isFinite(Number(draft)) && draft.trim() !== "" ? Number(draft) : value;

  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <Stepper
        value={disabled ? null : current}
        label={label}
        step={1}
        bigStep={10}
        disabled={disabled}
        onStep={(next) => {
          setDraft(stepText(next));
          onCommit(next);
        }}
      >
        <input
          className={styles.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          disabled={disabled}
          title={hint}
          aria-label={label}
          onFocus={() => setEditing(true)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              abandoning.current = true;
              setDraft(settled);
              setEditing(false);
              event.currentTarget.blur();
            }
          }}
        />
      </Stepper>
    </label>
  );
}

/** What an override's empty box would come out as; `null` for any other field. */
function derivedFor(field: Field, metrics: VerticalMetrics): number | null {
  const which = DERIVED[field.key];
  if (field.kind !== "override" || which === undefined) return null;
  const value = metrics[which];
  return typeof value === "number" ? value : null;
}
