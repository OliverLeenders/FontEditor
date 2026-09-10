import { renameCurrentGlyph, renameRefusal } from "@typewright/tools";
import { useEffect, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./Inspector.module.css";
import { GripVerticalIcon, PanelLeftIcon, PanelRightIcon, ScalingIcon, XIcon } from "./icons.js";
import { TransformPanel } from "./TransformPanel.js";
import { AnchorsSection } from "./inspector/AnchorsSection.js";
import { ComponentsSection } from "./inspector/ComponentsSection.js";
import { CurveSection } from "./inspector/CurveSection.js";
import { GlyphSection } from "./inspector/GlyphSection.js";
import { GuidesSection } from "./inspector/GuidesSection.js";
import { PointSection } from "./inspector/PointSection.js";
import { Section } from "./inspector/Section.js";
import { TracingSection } from "./inspector/TracingSection.js";

/**
 * The inspector: the glyph, and whatever of it is selected, as numbers.
 *
 * This file is the frame — where the panel sits, what its header does, and
 * which sections it is made of. Each section owns its own selectors and its own
 * commands and lives beside this one in `inspector/`, because they have nothing
 * to say to each other: the panel is a stack of unrelated things about one
 * glyph, and the only thing they share is the edge they line up against.
 *
 * It sits over the drawing or beside it, and that is a choice made here rather
 * than in the layout. Floating, it can land on top of what you are editing
 * until you move it; docked, it takes a column and the drawing gets the rest.
 * Dragging the header to a window edge docks it, dragging away undocks it, and
 * the button in the header reaches the same two states without the throw.
 */
export function Inspector(): React.JSX.Element | null {
  const store = useEditorStore();
  const open = useStoreValue((s) => s.inspector.open);
  const x = useStoreValue((s) => s.inspector.x);
  const y = useStoreValue((s) => s.inspector.y);
  const dock = useStoreValue((s) => s.inspector.dock);
  const width = useStoreValue((s) => s.inspector.width);
  const glyphName = useStoreValue((s) => s.session.editor.currentGlyph);
  const glyphNames = useStoreValue((s) => s.session.editor.document.glyphOrder);

  // The field is only a draft until it is committed, so it holds its own text.
  // Reset when the open glyph changes, or it would show the last glyph's name.
  const [draftName, setDraftName] = useState(glyphName);
  useEffect(() => setDraftName(glyphName), [glyphName]);

  const refusal = renameRefusal(store.editor, draftName);
  const renameable = draftName.trim() !== glyphName && refusal === null;
  // A name is only wrong once it has been changed into something wrong. A glyph
  // sitting under its own name is never in error, and `.notdef` would otherwise
  // be marked invalid the moment it was opened.
  const wrong = draftName !== glyphName && refusal !== null && refusal !== "missing";

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resizing = useRef(false);

  if (!open) return null;

  /**
   * Commit the name, or put the field back.
   *
   * On blur as well as on Enter, because a field that quietly discarded what was
   * typed the moment you clicked elsewhere would be worse than one that asked.
   * Escape is the way to change your mind.
   */
  const commitName = (): void => {
    if (!renameable) {
      setDraftName(glyphName);
      return;
    }
    store.applyTool(renameCurrentGlyph(store.editor, draftName));
  };

  return (
    <aside
      className={styles.panel}
      data-dock={dock === "float" ? undefined : dock}
      style={
        dock === "float"
          ? { left: `${x}px`, top: `${y}px` }
          : { width: `${width}px`, flex: `0 0 ${width}px` }
      }
      aria-label="Glyph inspector"
    >
      <header
        className={styles.grip}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          // A docked panel is not where the pointer went down relative to its
          // own left edge, so dragging one out starts from under the cursor
          // rather than from a position it does not have.
          drag.current =
            dock === "float"
              ? { dx: event.clientX - x, dy: event.clientY - y }
              : { dx: width / 2, dy: 8 };
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (from === null) return;

          // Dragging to an edge docks, dragging away from one undocks. The
          // panel goes where it is put, which is the gesture anybody would try
          // first — the button in the header is for the people who would not.
          const edge = edgeAt(event.clientX);
          if (edge !== null) {
            store.dockInspector(edge);
            return;
          }
          if (dock !== "float") store.dockInspector("float");
          store.moveInspector(
            Math.max(0, event.clientX - from.dx),
            Math.max(0, event.clientY - from.dy),
          );
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          drag.current = null;
        }}
      >
        {/* The panel is dragged by its header, and nothing said so. Lucide's
            grip, which is the mark every draggable thing in every application
            carries. */}
        <span className={styles.gripMark} aria-hidden="true">
          <GripVerticalIcon />
        </span>
        {/* The name is a reference — components place a glyph by it and kerning
            names it on both sides of a pair — so renaming is an edit rather
            than relabelling, and it belongs with the other fields that edit
            this glyph. It stays in the header because that is where the name
            already was, and where anyone would look for it. */}
        <input
          className={styles.name}
          value={draftName}
          aria-label="Glyph name"
          spellCheck={false}
          disabled={glyphName === ""}
          title={
            refusal === "reserved"
              ? "A font finds .notdef by name, so this one keeps it"
              : wrong && refusal === "taken"
                ? "Another glyph already has that name"
                : wrong && refusal === "empty"
                  ? "A glyph needs a name"
                  : "Rename this glyph, and everything that refers to it"
          }
          data-invalid={wrong ? "true" : undefined}
          readOnly={refusal === "reserved"}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraftName(glyphName);
              event.currentTarget.blur();
            }
            event.stopPropagation();
          }}
        />
        {/* The same two states the drag reaches, for a pointer that would
            rather press something than throw the panel at a wall. */}
        <button
          type="button"
          className={styles.dock}
          title={dock === "float" ? "Dock to the right" : "Float over the drawing"}
          aria-label={dock === "float" ? "Dock the inspector" : "Float the inspector"}
          aria-pressed={dock !== "float"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => store.dockInspector(dock === "float" ? "right" : "float")}
        >
          {dock === "left" ? <PanelLeftIcon /> : <PanelRightIcon />}
        </button>
        <button
          type="button"
          className={styles.dismiss}
          title="Hide the inspector  (I)"
          aria-label="Hide the inspector"
          onClick={() => store.toggleInspector()}
        >
          <XIcon />
        </button>
      </header>

      {dock === "float" ? null : (
        // Dragged rather than typed, because the width somebody wants is the
        // one where their letter still fits beside it.
        <div
          className={styles.resizer}
          role="separator"
          aria-orientation="vertical"
          aria-label="Inspector width"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            resizing.current = true;
          }}
          onPointerMove={(event) => {
            if (!resizing.current) return;
            store.resizeInspector(
              dock === "right" ? window.innerWidth - event.clientX : event.clientX,
            );
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            resizing.current = false;
          }}
        />
      )}

      {/* Every glyph in the font, offered to the fields that name one: a
          component's base, and where a glyph takes its spacing from. Here
          rather than in either section, because both want it and a folded
          section renders nothing — and because two elements claiming one id is
          a bug waiting for whichever of them the browser picks. */}
      <datalist id="typewright-glyph-names">
        {glyphNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div className={styles.body}>
        <GlyphSection />
        <ComponentsSection />
        <AnchorsSection />
        <TracingSection />
        <GuidesSection />
        <PointSection />
        <CurveSection />

        <Section name="transform" title="Transform" icon={ScalingIcon} relevant={false}>
          <TransformPanel />
        </Section>
      </div>
    </aside>
  );
}

/**
 * How near a window edge counts as being at it, in pixels.
 *
 * Wide enough to hit while moving a panel about, narrow enough that dragging
 * the panel to a corner of the drawing does not dock it by surprise.
 */
const EDGE = 48;

/** Which side of the window a drag is at, if it is at one. */
function edgeAt(clientX: number): "left" | "right" | null {
  if (clientX <= EDGE) return "left";
  if (clientX >= window.innerWidth - EDGE) return "right";
  return null;
}
