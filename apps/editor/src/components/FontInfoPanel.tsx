import { type FontInfo } from "@fonteditor/font-model";
import { infoProblem, setInfo } from "@fonteditor/tools";
import { useEffect, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./FontInfoPanel.module.css";
import shared from "./OpenFont.module.css";
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
const FIELDS: readonly {
  readonly key: keyof FontInfo;
  readonly label: string;
  readonly kind: "text" | "number";
  readonly hint: string;
}[] = [
  { key: "familyName", label: "Family", kind: "text", hint: "The name the font is known by" },
  { key: "styleName", label: "Style", kind: "text", hint: "Regular, Italic, Bold, and so on" },
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
      if (event.key === "Escape") setOpen(false);
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
        Font info
      </button>

      {open ? (
        <div ref={ref} className={styles.panel} role="group" aria-label="Font info">
          {FIELDS.map((field) => (
            <Field key={field.key} field={field} info={info} store={store} />
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
  field: (typeof FIELDS)[number];
  info: FontInfo;
  store: ReturnType<typeof useEditorStore>;
}): React.JSX.Element {
  const settled = String(info[field.key]);
  const [draft, setDraft] = useState(settled);
  const [editing, setEditing] = useState(false);

  // An undo, or a font opened while the panel is up, has to reach the box.
  useEffect(() => {
    if (!editing) setDraft(settled);
  }, [settled, editing]);

  const commit = (): void => {
    setEditing(false);
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
