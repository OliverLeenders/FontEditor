import { orderedGlyphs } from "@fonteditor/font-model";
import {
  type KernSide,
  addKernGroup,
  deleteKernGroup,
  kernGroupPairs,
  kernGroupProblem,
  putGlyphInKernGroup,
  renameKernGroupTo,
  takeGlyphFromKernGroup,
} from "@fonteditor/tools";
import { useEffect, useMemo, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./KernGroups.module.css";

/**
 * The kerning groups, and what is in them.
 *
 * Almost all kerning is written between groups rather than between letters —
 * every round shape behaves the same way against every stem, and spelling that
 * out letter by letter is thousands of pairs by hand. Until now groups could be
 * read, imported and exported but never made here, so a font kerned in this
 * editor needed another tool before it could be maintained.
 *
 * Controlled by the view around it, because there are two ways in: the button in
 * the bar, and the pair readout at the foot, which opens it on the two letters
 * you are looking at.
 */
export function KernGroups({
  open,
  onOpenChange,
  first,
  second,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The letter before the gap, and the one after, when there is a pair. */
  readonly first: string | null;
  readonly second: string | null;
}): React.JSX.Element {
  const reading = useStoreValue((s) => s.ownership === "reading");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpenChange]);

  return (
    <div className={styles.holder}>
      <button
        type="button"
        className={styles.open}
        aria-expanded={open}
        disabled={reading}
        title={
          reading ? "Another tab is saving this project" : "The classes kerning is written between"
        }
        onClick={() => onOpenChange(!open)}
      >
        Groups
      </button>

      {open ? (
        <div ref={ref} className={styles.panel} role="group" aria-label="Kerning groups">
          {/* Named for the gap rather than for the file formats' "first" and
              "second": what is being chosen is whether the group describes a
              letter's trailing flank or its leading one. */}
          <Side side="first" title="Before the gap" glyph={first} />
          <Side side="second" title="After the gap" glyph={second} />
        </div>
      ) : null}
    </div>
  );
}

/** One column: the groups on this side, and the members of the chosen one. */
function Side({
  side,
  title,
  glyph,
}: {
  readonly side: KernSide;
  readonly title: string;
  /** The letter in front of you on this side, offered as a member. */
  readonly glyph: string | null;
}): React.JSX.Element {
  const store = useEditorStore();
  const kerning = useStoreValue((s) => s.session.editor.document.kerning);
  const groups = side === "first" ? kerning.firstGroups : kerning.secondGroups;
  const names = useMemo(() => Object.keys(groups), [groups]);

  const holding = useMemo(
    () => (glyph === null ? null : (names.find((name) => groups[name]?.includes(glyph)) ?? null)),
    [names, groups, glyph],
  );

  const [picked, setPicked] = useState<string | null>(null);
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);

  // The group holding the letter in front of you, until you pick another. A
  // group renamed or deleted under the selection would otherwise leave the
  // column empty with no way back into it.
  const chosen = picked !== null && picked in groups ? picked : (holding ?? names[0] ?? null);
  const members = chosen === null ? [] : (groups[chosen] ?? []);

  return (
    <section className={styles.side}>
      <h3 className={styles.title}>{title}</h3>

      <ul className={styles.groups}>
        {names.map((name) => (
          <li key={name}>
            <button
              type="button"
              className={styles.group}
              aria-pressed={name === chosen}
              onClick={() => {
                setPicked(name);
                setNaming(null);
              }}
            >
              <span className={styles.groupName}>{name}</span>
              <span className={styles.count}>{groups[name]?.length ?? 0}</span>
            </button>
          </li>
        ))}
        {names.length === 0 ? <li className={styles.empty}>No groups on this side yet</li> : null}
      </ul>

      {naming === null ? (
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={() => setNaming("new")}>
            New group
          </button>
          {chosen === null ? null : (
            <>
              <button type="button" className={styles.action} onClick={() => setNaming("rename")}>
                Rename
              </button>
              <Delete side={side} name={chosen} />
            </>
          )}
        </div>
      ) : (
        <Naming
          side={side}
          // Renaming starts from the name it has; a new group starts empty.
          {...(naming === "rename" && chosen !== null ? { current: chosen } : {})}
          onDone={(name) => {
            if (name !== null) setPicked(name);
            setNaming(null);
          }}
        />
      )}

      {chosen === null ? null : (
        <div className={styles.members}>
          {members.map((name) => (
            <span key={name} className={styles.chip}>
              {name}
              <button
                type="button"
                className={styles.drop}
                aria-label={"Remove " + name + " from " + chosen}
                title={"Remove " + name + " from " + chosen}
                onClick={() =>
                  store.applyTool(takeGlyphFromKernGroup(store.editor, side, chosen, name))
                }
              >
                ×
              </button>
            </span>
          ))}
          {members.length === 0 ? <span className={styles.empty}>Nothing in it yet</span> : null}
          <AddMember side={side} group={chosen} offer={glyph} />
        </div>
      )}
    </section>
  );
}

/**
 * Delete, saying what it costs.
 *
 * Every pair written against the group goes with it, because a rule naming a
 * group that is not there can never match, and kerning that silently does
 * nothing is worse than kerning that is absent. Saying the number first is
 * cheaper than finding out afterwards; undo is there either way.
 */
function Delete({
  side,
  name,
}: {
  readonly side: KernSide;
  readonly name: string;
}): React.JSX.Element {
  const store = useEditorStore();
  const pairs = useStoreValue((s) => kernGroupPairs(s.session.editor, side, name));
  const counted = String(pairs) + (pairs === 1 ? " pair" : " pairs");

  return (
    <button
      type="button"
      className={styles.action}
      data-danger="true"
      title={
        pairs === 0
          ? "Delete " + name
          : "Delete " + name + ", and the " + counted + " written against it"
      }
      onClick={() => store.applyTool(deleteKernGroup(store.editor, side, name))}
    >
      {pairs === 0 ? "Delete" : "Delete — also " + counted}
    </button>
  );
}

/** Naming a new group, or renaming one. Refuses before it applies. */
function Naming({
  side,
  current,
  onDone,
}: {
  readonly side: KernSide;
  readonly current?: string;
  readonly onDone: (name: string | null) => void;
}): React.JSX.Element {
  const store = useEditorStore();
  const kerning = useStoreValue((s) => s.session.editor.document.kerning);
  const [draft, setDraft] = useState(current ?? "");
  const problem = kernGroupProblem(kerning, side, draft, current);

  const commit = (): void => {
    if (problem !== null) return;
    store.applyTool(
      current === undefined
        ? addKernGroup(store.editor, side, draft)
        : renameKernGroupTo(store.editor, side, current, draft),
    );
    onDone(draft);
  };

  return (
    <div className={styles.naming}>
      <input
        className={styles.input}
        value={draft}
        autoFocus
        spellCheck={false}
        aria-label={current === undefined ? "Name for the new group" : "New name for " + current}
        aria-invalid={draft !== "" && problem !== null}
        data-wrong={draft !== "" && problem !== null ? "true" : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            // The panel stays up: what is being abandoned is the name, not the
            // work.
            event.stopPropagation();
            onDone(null);
          }
        }}
      />
      <button type="button" className={styles.action} disabled={problem !== null} onClick={commit}>
        {current === undefined ? "Add" : "Rename"}
      </button>
      <button type="button" className={styles.action} onClick={() => onDone(null)}>
        Cancel
      </button>
      {draft !== "" && problem !== null ? (
        <span className={styles.problem} role="alert">
          {problem}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Put a glyph in the chosen group.
 *
 * The letter in front of you is one press; anything else is typed. A glyph
 * already in another group on this side moves, and is told to be moving, since a
 * glyph in two groups on one side kerns by whichever is read first — a rule
 * nobody wrote and nobody can see.
 */
function AddMember({
  side,
  group,
  offer,
}: {
  readonly side: KernSide;
  readonly group: string;
  readonly offer: string | null;
}): React.JSX.Element {
  const store = useEditorStore();
  const document = useStoreValue((s) => s.session.editor.document);
  const groups = side === "first" ? document.kerning.firstGroups : document.kerning.secondGroups;
  const [draft, setDraft] = useState("");

  const known = (name: string): boolean => name in document.glyphs;
  const leaving = (name: string): string | null => {
    for (const [each, glyphs] of Object.entries(groups)) {
      if (each !== group && glyphs.includes(name)) return each;
    }
    return null;
  };

  const add = (name: string): void => {
    if (!known(name)) return;
    store.applyTool(putGlyphInKernGroup(store.editor, side, group, name));
    setDraft("");
  };

  const offered = offer !== null && known(offer) && !(groups[group] ?? []).includes(offer);
  const moves = offer === null ? null : leaving(offer);
  const moving = draft !== "" && known(draft) ? leaving(draft) : null;

  return (
    <div className={styles.add}>
      {offered ? (
        <button
          type="button"
          className={styles.action}
          title={
            moves === null
              ? "Put " + offer + " in " + group
              : "Move " + offer + " out of " + moves + " and into " + group
          }
          onClick={() => add(offer)}
        >
          Add {offer}
        </button>
      ) : null}
      <input
        className={styles.input}
        value={draft}
        placeholder="glyph name"
        spellCheck={false}
        aria-label={"Glyph to add to " + group}
        aria-invalid={draft !== "" && !known(draft)}
        data-wrong={draft !== "" && !known(draft) ? "true" : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(draft);
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft("");
          }
        }}
      />
      <button
        type="button"
        className={styles.action}
        disabled={!known(draft)}
        onClick={() => add(draft)}
      >
        Add
      </button>
      {draft !== "" && !known(draft) ? (
        <span className={styles.problem} role="alert">
          {orderedGlyphs(document).length === 0
            ? "This font has no glyphs"
            : "No glyph by that name"}
        </span>
      ) : null}
      {moving !== null ? <span className={styles.note}>Moves it out of {moving}</span> : null}
    </div>
  );
}
