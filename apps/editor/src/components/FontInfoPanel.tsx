import { type FontInfo, STYLE_MAP_STYLES } from "@fonteditor/font-model";
import { infoProblem, setInfo } from "@fonteditor/tools";
import { useEffect, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./FontInfoPanel.module.css";
import shared from "./OpenFont.module.css";
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
  readonly kind: "text" | "number" | "choice";
  readonly hint: string;
  /** For a choice: the values it may take, in the order they are offered. */
  readonly options?: readonly string[];
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
        hint: "The grid the design is drawn on. Changing it does not rescale the drawings.",
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
];

export function FontInfoPanel(): React.JSX.Element {
  const store = useEditorStore();
  const info = useStoreValue((s) => s.session.editor.document.info);
  const reading = useStoreValue((s) => s.ownership === "reading");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Not while a field has it. This listener is on the window and in the
      // capture phase, so it runs before the field's own handler and would
      // close the panel out from under an edit somebody was abandoning — which
      // is two things happening for one key.
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className={styles.holder}>
      <button
        type="button"
        className={shared.button}
        aria-expanded={open}
        disabled={reading}
        title={reading ? "Another tab is saving this project" : "Name, em and vertical metrics"}
        onClick={() => setOpen((was) => !was)}
      >
        <InfoIcon />
        Font info
      </button>

      {open ? (
        <div ref={ref} className={styles.panel} role="group" aria-label="Font info">
          {SECTIONS.map((section) => (
            <section key={section.title} className={styles.section}>
              <h3 className={styles.heading}>{section.title}</h3>
              {section.fields.map((field) => (
                <Field key={field.key} field={field} info={info} store={store} />
              ))}
            </section>
          ))}
          <p className={styles.note}>
            {info.familyName} {info.styleName} &middot; {info.unitsPerEm} units per em
          </p>
        </div>
      ) : null}
    </div>
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
}: {
  field: Field;
  info: FontInfo;
  store: ReturnType<typeof useEditorStore>;
}): React.JSX.Element {
  const settled = String(info[field.key]);
  const [draft, setDraft] = useState(settled);
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

  // An undo, or a font opened while the panel is up, has to reach the box.
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
    if (draft === settled) return;

    const number = Number(draft);
    // A box on its way to a number holds things that are not one: "-" before
    // the digits, "" before anything. Neither is a value to write.
    if (field.kind === "number" && (draft.trim() === "" || !Number.isFinite(number))) {
      setDraft(settled);
      return;
    }

    const value: string | number = field.kind === "number" ? number : draft;

    const patch = { [field.key]: value } as Partial<FontInfo>;
    const problem = infoProblem({ ...info, ...patch });
    if (problem !== null) {
      setDraft(settled);
      return;
    }
    store.applyTool(setInfo(store.editor, patch));
  };

  const problem = infoProblem({
    ...info,
    ...({ [field.key]: field.kind === "number" ? Number(draft) : draft } as Partial<FontInfo>),
  });

  const stepped = (input: React.JSX.Element): React.JSX.Element =>
    field.kind === "number" ? (
      <Stepper
        value={Number.isFinite(Number(draft)) ? Number(draft) : null}
        label={field.label}
        // The em is a grid people speak of in round hundreds; the rest are
        // units, and a unit is the smallest thing there is.
        step={1}
        bigStep={field.key === "unitsPerEm" ? 64 : 10}
        onStep={(next) => {
          setDraft(String(next));
          const patch = { [field.key]: next } as Partial<FontInfo>;
          if (infoProblem({ ...info, ...patch }) === null) {
            store.applyTool(setInfo(store.editor, patch));
          }
        }}
      >
        {input}
      </Stepper>
    ) : (
      input
    );

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
          type={field.kind === "number" ? "number" : "text"}
          value={draft}
          title={field.hint}
          aria-label={field.label}
          aria-invalid={editing && problem !== null}
          data-wrong={editing && problem !== null ? "true" : undefined}
          onFocus={() => setEditing(true)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
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
