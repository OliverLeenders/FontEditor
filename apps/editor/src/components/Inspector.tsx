import { renameCurrentGlyph, renameRefusal } from "@typewright/tools";
import { useEffect, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./Inspector.module.css";
import type { InspectorTab } from "../preferences.js";
import {
  type IconComponent,
  AnchorIcon,
  ImageIcon,
  LayersIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PointIcon,
  ScalingIcon,
  TypeIcon,
  XIcon,
} from "./icons.js";
import { TransformPanel } from "./TransformPanel.js";
import { AnchorsSection } from "./inspector/AnchorsSection.js";
import { ComponentsSection } from "./inspector/ComponentsSection.js";
import { CurveSection } from "./inspector/CurveSection.js";
import { PenSection } from "./inspector/PenSection.js";
import { GlyphSection } from "./inspector/GlyphSection.js";
import { GuidesSection } from "./inspector/GuidesSection.js";
import { LayersSection } from "./inspector/LayersSection.js";
import { PixelsSection } from "./inspector/PixelsSection.js";
import { PointSection } from "./inspector/PointSection.js";
import { Section } from "./inspector/Section.js";
import { TracingSection } from "./inspector/TracingSection.js";

/**
 * The inspector: the glyph, and whatever of it is selected, as numbers.
 *
 * This file is the frame — where the panel sits, what its header does, and
 * which tabs it is made of. Each section owns its own selectors and its own
 * commands and lives beside this one in `inspector/`, because they have nothing
 * to say to each other.
 *
 * A column at one edge of the drawing, with a tab for each thing it is about:
 * what is selected, the glyph, its layers, its anchors and guides, the picture
 * it is traced from. One at a time, so what is shown is what is being worked
 * on and not eleven sections of everything. It used to float over the drawing,
 * and grew until it covered what was being drawn: a column covers nothing.
 * Selecting something shows the Selection tab, which is where anybody looks
 * for what they have just picked up.
 */
export function Inspector(): React.JSX.Element | null {
  const store = useEditorStore();
  const open = useStoreValue((s) => s.inspector.open);
  const dock = useStoreValue((s) => s.inspector.dock);
  const width = useStoreValue((s) => s.inspector.width);
  const tab = useStoreValue((s) => s.inspector.tab);
  const glyphName = useStoreValue((s) => s.session.editor.currentGlyph);
  const glyphNames = useStoreValue((s) => s.session.editor.document.glyphOrder);
  // What the selection is, which decides what the Selection tab leads with.
  const focus = useStoreValue((s): Focus => {
    const e = s.session.editor;
    if (e.selectedComponent !== null) return "component";
    if (e.selectedAnchor !== null) return "anchor";
    if (e.selectedGuide !== null) return "guide";
    return e.selection.some((item) => item.part === "point") ? "points" : "none";
  });
  // Every control in the transform section acts on the points selected, and is
  // dead without them — so with none, the section has nothing in it.
  const selectedPoints = useStoreValue(
    (s) => s.session.editor.selection.filter((item) => item.part === "point").length,
  );

  // Something picked up is what is being worked on: its tab comes forward. Only
  // when the selection becomes something, so a tab chosen by hand while it
  // stays the same is left alone.
  const was = useRef(focus);
  useEffect(() => {
    if (focus !== was.current && focus !== "none") store.showInspectorTab("selection");
    was.current = focus;
  }, [focus, store]);

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

  const transform = (
    <Section
      name="transform"
      title="Transform"
      icon={ScalingIcon}
      relevant={false}
      empty={selectedPoints === 0}
      // Shorter than the others say it: beside this title the longer
      // words ran to a second line.
      emptyNote="no selection"
      note={selectedPoints === 0 ? undefined : `${String(selectedPoints)} selected`}
    >
      <TransformPanel />
    </Section>
  );

  return (
    <aside
      className={styles.panel}
      data-dock={dock}
      style={{ width: `${width}px`, flex: `0 0 ${width}px` }}
      aria-label="Glyph inspector"
    >
      <header className={styles.grip}>
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
        <button
          type="button"
          className={styles.dock}
          title={dock === "right" ? "Move to the left edge" : "Move to the right edge"}
          aria-label={dock === "right" ? "Move the inspector left" : "Move the inspector right"}
          onClick={() => store.dockInspector(dock === "right" ? "left" : "right")}
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

      {/* Dragged rather than typed, because the width somebody wants is the
          one where their letter still fits beside it. */}
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
          const pane = paneEdges(event.currentTarget);
          store.resizeInspector(
            dock === "right" ? pane.right - event.clientX : event.clientX - pane.left,
          );
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          resizing.current = false;
        }}
      />

      <div className={styles.tabs} role="tablist" aria-label="What the inspector shows">
        {TABS.map(({ key, title, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`inspector-tab-${key}`}
            className={styles.tab}
            aria-selected={tab === key}
            aria-controls="inspector-tab-body"
            aria-label={title}
            title={title}
            onClick={() => store.showInspectorTab(key)}
          >
            <Icon />
          </button>
        ))}
      </div>

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

      <div
        className={styles.body}
        id="inspector-tab-body"
        role="tabpanel"
        aria-labelledby={`inspector-tab-${tab}`}
      >
        {tab === "selection" ? (
          <>
            {focus === "component" ? <ComponentsSection /> : null}
            {focus === "anchor" ? <AnchorsSection /> : null}
            {focus === "guide" ? <GuidesSection /> : null}
            <PointSection />
            <CurveSection />
            <PenSection />
            {transform}
          </>
        ) : null}
        {tab === "glyph" ? (
          <>
            <GlyphSection />
            <ComponentsSection />
            <PixelsSection />
          </>
        ) : null}
        {tab === "layers" ? <LayersSection /> : null}
        {tab === "marks" ? (
          <>
            <AnchorsSection />
            <GuidesSection />
          </>
        ) : null}
        {tab === "tracing" ? <TracingSection /> : null}
      </div>
    </aside>
  );
}

/**
 * The left and right edges of the pane the inspector is in.
 *
 * The window's, in a window of one. In a split window the drawing may be the
 * right-hand pane, and the inspector's width is measured from that pane's edge.
 */
function paneEdges(inside: Element): { left: number; right: number } {
  const pane = inside.closest("[data-pane]");
  return pane === null ? { left: 0, right: window.innerWidth } : pane.getBoundingClientRect();
}

type Focus = "points" | "component" | "anchor" | "guide" | "none";

/** The tabs, in order, each with the mark its section has wherever else it appears. */
const TABS: readonly { key: InspectorTab; title: string; icon: IconComponent }[] = [
  { key: "selection", title: "Selection", icon: PointIcon },
  { key: "glyph", title: "Glyph", icon: TypeIcon },
  { key: "layers", title: "Layers", icon: LayersIcon },
  { key: "marks", title: "Anchors and guides", icon: AnchorIcon },
  { key: "tracing", title: "Tracing", icon: ImageIcon },
];
