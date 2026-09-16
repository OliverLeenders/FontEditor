import {
  type Axis,
  type AxisMap,
  type Rule,
  type RuleCondition,
  isDiscrete,
  sameLocation,
  toDesign,
  toUser,
  userRange,
} from "@typewright/font-model";
import { useEffect, useId, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import { BarMenu } from "./BarMenu.js";
import styles from "./Designspace.module.css";
import { BlendIcon, TrashIcon } from "./icons.js";

/**
 * The family's axes as a file describes them, and the glyphs swapped along them.
 *
 * Two things a designspace says that the Masters panel does not. An axis's map:
 * the weight a menu offers against where the drawings are, which is how a family
 * drawn with stems of 20, 80 and 220 units is offered as 100, 400 and 900 — and
 * how its 700 is put much nearer the black than the straight line would. And the
 * rules: the dollar sign that loses its stroke past a weight, drawn as a glyph of
 * its own and put in place of the ordinary one where the conditions hold.
 *
 * Every number here commits on Enter or when the field is left, as in the font
 * info, so the font is not rebuilt around a half-typed value.
 */
export function Designspace(): React.JSX.Element {
  const store = useEditorStore();
  const project = useStoreValue((s) => s.project);
  const request = useStoreValue((s) => s.designspaceRequest);
  const reading = useStoreValue((s) => s.ownership === "reading");
  const names = useStoreValue((s) => s.session.editor.document.glyphOrder);
  const listId = useId();

  const { axes } = project;

  return (
    <BarMenu
      label="Designspace"
      icon={BlendIcon}
      title="The axes as a menu offers them, and the glyphs swapped along them"
      panelClassName={styles.panel}
      panelLabel="Designspace"
      openOn={request}
    >
      {axes.length === 0 ? (
        <p className={styles.note}>
          No axes yet. They arrive with a second master, which is added under Masters.
        </p>
      ) : (
        <>
          <section className={styles.section} aria-label="Axes">
            <h3 className={styles.heading}>Axes</h3>
            {axes.map((a) => (
              <AxisEditor
                key={a.tag}
                axis={a}
                disabled={reading}
                homeless={
                  !project.masters.some(
                    (m) =>
                      m.sparse === undefined &&
                      sameLocation([a], m.location, { [a.tag]: a.default }),
                  )
                }
                outside={project.masters
                  .filter((m) => {
                    const at = m.location[a.tag] ?? a.default;
                    return at < a.min || at > a.max;
                  })
                  .map((m) => `${m.name} at ${String(round(m.location[a.tag] ?? a.default))}`)}
                onChange={(next) => void store.updateAxis(a.tag, next)}
              />
            ))}
          </section>

          <section className={styles.section} aria-label="Rules">
            <div className={styles.headRow}>
              <h3 className={styles.heading}>Rules</h3>
              <label className={styles.processing}>
                Applied
                <select
                  value={project.rulesProcessing}
                  disabled={reading}
                  onChange={(event) =>
                    void store.setRulesProcessing(event.target.value === "last" ? "last" : "first")
                  }
                >
                  <option value="first">first, before the other features</option>
                  <option value="last">last, after the other features</option>
                </select>
              </label>
            </div>

            {project.rules.length === 0 ? (
              <p className={styles.note}>
                None. A rule puts one glyph in place of another in part of the designspace — a
                dollar sign whose stroke closes up past a weight.
              </p>
            ) : null}

            {project.rules.map((r) => (
              <RuleEditor
                key={r.id}
                rule={r}
                axes={axes}
                list={listId}
                disabled={reading}
                onChange={(next) => void store.replaceRule(next)}
                onRemove={() => void store.removeRule(r.id)}
              />
            ))}

            <button
              type="button"
              className={styles.add}
              disabled={reading}
              onClick={() => {
                const first = axes[0]!;
                void store.addRule({
                  id: `rule-${String(Date.now())}`,
                  name: `Rule ${String(project.rules.length + 1)}`,
                  conditionSets: [[{ tag: first.tag, min: first.default, max: null }]],
                  swaps: [],
                });
              }}
            >
              Add a rule
            </button>

            <datalist id={listId}>
              {names.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </section>
        </>
      )}
    </BarMenu>
  );
}

/** One axis: its name, its range on the menu's scale, and its map. */
function AxisEditor({
  axis: a,
  disabled,
  homeless,
  outside,
  onChange,
}: {
  readonly axis: Axis;
  readonly disabled: boolean;
  /** Whether no whole master sits at the axis's default any more. */
  readonly homeless: boolean;
  /** The masters drawn outside the axis's range, said as a name and a place. */
  readonly outside: readonly string[];
  readonly onChange: (next: Axis) => void;
}): React.JSX.Element {
  const user = userRange(a);
  const pairs = [...(a.map ?? [])].sort((one, two) => one[0] - two[0]);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * The axis with another map, keeping its range where the menu offers it: the
   * drawings stay where they are and the numbers somebody asks for keep meaning
   * what they did at the ends, so only the middle moves.
   */
  const withMap = (next: AxisMap): void => {
    const sorted = [...next].sort((one, two) => one[0] - two[0]);
    const rises = sorted.every(
      ([u, d], i) => i === 0 || (u > sorted[i - 1]![0] && d > sorted[i - 1]![1]),
    );
    if (!rises) {
      setProblem("A map has to rise: each pair further along than the last, on both scales.");
      return;
    }
    setProblem(null);
    const mapped: Axis = { ...a, ...(sorted.length === 0 ? {} : { map: sorted }) };
    if (sorted.length === 0) delete (mapped as { map?: AxisMap }).map;
    onChange({
      ...mapped,
      min: toDesign(mapped, user.min),
      default: toDesign(mapped, user.default),
      max: toDesign(mapped, user.max),
    });
  };

  /** A new range on the menu's scale, put through the map to where it is drawn. */
  const withRange = (min: number, value: number, max: number): void => {
    if (!(min <= value && value <= max)) {
      setProblem("The default has to be within the range.");
      return;
    }
    setProblem(null);
    onChange({ ...a, min: toDesign(a, min), default: toDesign(a, value), max: toDesign(a, max) });
  };

  return (
    <div className={styles.axis} role="group" aria-label={`Axis ${a.name}`}>
      <div className={styles.axisHead}>
        <Commit
          className={styles.axisName}
          label={`Name of the axis ${a.tag}`}
          value={a.name}
          disabled={disabled}
          onCommit={(name) => {
            if (name.trim() !== "") onChange({ ...a, name: name.trim() });
          }}
        />
        <code className={styles.tag}>{a.tag}</code>
      </div>

      {isDiscrete(a) ? (
        <p className={styles.note}>
          Stops at {(a.values ?? []).map((v) => String(round(toUser(a, v)))).join(", ")}, with
          nothing between: a variable font is the stop at {String(round(user.default))}.
        </p>
      ) : (
        <div className={styles.range} role="group" aria-label={`Range of ${a.name}`}>
          <NumberCommit
            label="Minimum"
            value={user.min}
            disabled={disabled}
            onCommit={(v) => withRange(v, user.default, user.max)}
          />
          <NumberCommit
            label="Default"
            value={user.default}
            disabled={disabled}
            onCommit={(v) => withRange(user.min, v, user.max)}
          />
          <NumberCommit
            label="Maximum"
            value={user.max}
            disabled={disabled}
            onCommit={(v) => withRange(user.min, user.default, v)}
          />
        </div>
      )}

      <table className={styles.map} aria-label={`Map of ${a.name}`}>
        <thead>
          <tr>
            <th scope="col">Asked for</th>
            <th scope="col">Drawn at</th>
            <th scope="col">
              <span className={styles.hidden}>Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {pairs.map(([u, d], i) => (
            <tr key={`${String(i)}-${String(u)}`}>
              <td>
                <NumberCommit
                  label={`Asked for, pair ${String(i + 1)}`}
                  value={u}
                  bare
                  disabled={disabled}
                  onCommit={(v) => withMap(pairs.map((p, j) => (j === i ? [v, p[1]] : p)))}
                />
              </td>
              <td>
                <NumberCommit
                  label={`Drawn at, pair ${String(i + 1)}`}
                  value={d}
                  bare
                  disabled={disabled}
                  onCommit={(v) => withMap(pairs.map((p, j) => (j === i ? [p[0], v] : p)))}
                />
              </td>
              <td>
                <button
                  type="button"
                  className={styles.drop}
                  aria-label={`Remove pair ${String(i + 1)} of ${a.name}`}
                  disabled={disabled}
                  onClick={() => withMap(pairs.filter((_, j) => j !== i))}
                >
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.row}>
        <button
          type="button"
          className={styles.add}
          disabled={disabled}
          onClick={() => {
            // The first pairs are the ends and the default as they already are,
            // so adding a map changes nothing until one of them is moved.
            if (pairs.length === 0) {
              withMap([
                [user.min, a.min],
                [user.default, a.default],
                [user.max, a.max],
              ]);
              return;
            }
            const at = round((user.default + user.max) / 2);
            withMap([...pairs.filter(([u]) => u !== at), [at, round(toDesign(a, at))]]);
          }}
        >
          {pairs.length === 0 ? "Map it" : "Add a pair"}
        </button>
        {pairs.length === 0 ? (
          <span className={styles.note}>Drawn where the menu says.</span>
        ) : null}
      </div>

      {problem !== null ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
      {outside.length > 0 ? (
        <p className={styles.problem} role="status">
          Drawn outside the range, which runs {String(round(a.min))} to {String(round(a.max))} where
          the drawings are: {outside.join(", ")}.
        </p>
      ) : null}
      {homeless ? (
        <p className={styles.problem} role="status">
          No whole master is drawn at the default, {String(round(a.default))}: a variable font is
          measured from one there.
        </p>
      ) : null}
    </div>
  );
}

/** One rule: its name, where it applies, and what it swaps. */
function RuleEditor({
  rule: r,
  axes,
  list,
  disabled,
  onChange,
  onRemove,
}: {
  readonly rule: Rule;
  readonly axes: readonly Axis[];
  readonly list: string;
  readonly disabled: boolean;
  readonly onChange: (next: Rule) => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const setSets = (conditionSets: readonly (readonly RuleCondition[])[]): void =>
    onChange({ ...r, conditionSets });
  const setSwaps = (swaps: readonly (readonly [string, string])[]): void =>
    onChange({ ...r, swaps });
  const nameOf = (tag: string): string => axes.find((a) => a.tag === tag)?.name ?? tag;

  return (
    <div className={styles.rule} role="group" aria-label={`Rule ${r.name}`}>
      <div className={styles.axisHead}>
        <Commit
          className={styles.axisName}
          label="Name of the rule"
          value={r.name}
          disabled={disabled}
          onCommit={(name) => onChange({ ...r, name })}
        />
        <button
          type="button"
          className={styles.drop}
          aria-label={`Remove the rule ${r.name}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>

      {r.conditionSets.map((set, si) => (
        <div
          key={si}
          className={styles.where}
          role="group"
          aria-label={`Where ${r.name} applies, ${String(si + 1)}`}
        >
          <span className={styles.label}>{si === 0 ? "Where" : "or where"}</span>
          {set.map((c, ci) => (
            <div key={ci} className={styles.condition}>
              <select
                aria-label="Axis"
                value={c.tag}
                disabled={disabled}
                onChange={(event) =>
                  setSets(
                    r.conditionSets.map((s, i) =>
                      i === si
                        ? s.map((x, j) => (j === ci ? { ...x, tag: event.target.value } : x))
                        : s,
                    ),
                  )
                }
              >
                {axes.map((a) => (
                  <option key={a.tag} value={a.tag}>
                    {a.name}
                  </option>
                ))}
              </select>
              <RangeEnd
                label={`At least, on ${nameOf(c.tag)}`}
                value={c.min}
                disabled={disabled}
                onCommit={(v) =>
                  setSets(
                    r.conditionSets.map((s, i) =>
                      i === si ? s.map((x, j) => (j === ci ? { ...x, min: v } : x)) : s,
                    ),
                  )
                }
              />
              <span className={styles.to}>to</span>
              <RangeEnd
                label={`At most, on ${nameOf(c.tag)}`}
                value={c.max}
                disabled={disabled}
                onCommit={(v) =>
                  setSets(
                    r.conditionSets.map((s, i) =>
                      i === si ? s.map((x, j) => (j === ci ? { ...x, max: v } : x)) : s,
                    ),
                  )
                }
              />
              <button
                type="button"
                className={styles.drop}
                aria-label={`Remove the range on ${nameOf(c.tag)}`}
                disabled={disabled}
                onClick={() => {
                  const kept = r.conditionSets
                    .map((s, i) => (i === si ? s.filter((_, j) => j !== ci) : s))
                    // A set left with no ranges would hold everywhere, which is
                    // not what taking its last range away means.
                    .filter((s, i) => i !== si || s.length > 0);
                  setSets(kept);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.small}
            disabled={disabled}
            onClick={() =>
              setSets(
                r.conditionSets.map((s, i) =>
                  i === si ? [...s, { tag: axes[0]!.tag, min: null, max: null }] : s,
                ),
              )
            }
          >
            and…
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.small}
        disabled={disabled}
        onClick={() => setSets([...r.conditionSets, [{ tag: axes[0]!.tag, min: null, max: null }]])}
      >
        or somewhere else…
      </button>
      {r.conditionSets.length === 0 ? (
        <p className={styles.problem} role="status">
          It applies nowhere until it is given somewhere to apply.
        </p>
      ) : null}

      <div className={styles.swaps} role="group" aria-label={`What ${r.name} swaps`}>
        <span className={styles.label}>Swaps</span>
        {r.swaps.map(([from, to], i) => (
          <div key={i} className={styles.swap}>
            <Commit
              label={`Swapped out, ${String(i + 1)}`}
              value={from}
              list={list}
              disabled={disabled}
              onCommit={(v) => setSwaps(r.swaps.map((p, j) => (j === i ? [v.trim(), p[1]] : p)))}
            />
            <span className={styles.to}>for</span>
            <Commit
              label={`Put in its place, ${String(i + 1)}`}
              value={to}
              list={list}
              disabled={disabled}
              onCommit={(v) => setSwaps(r.swaps.map((p, j) => (j === i ? [p[0], v.trim()] : p)))}
            />
            <button
              type="button"
              className={styles.drop}
              aria-label={`Remove the swap of ${from}`}
              disabled={disabled}
              onClick={() => setSwaps(r.swaps.filter((_, j) => j !== i))}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.small}
          disabled={disabled}
          onClick={() => setSwaps([...r.swaps, ["", ""]])}
        >
          Add a swap
        </button>
      </div>
    </div>
  );
}

/** A text field that says what it holds when it is left or Enter is pressed. */
function Commit({
  label,
  value,
  onCommit,
  disabled,
  className,
  list,
}: {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly disabled: boolean;
  readonly className?: string | undefined;
  readonly list?: string | undefined;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      className={className ?? styles.input}
      aria-label={label}
      value={draft}
      list={list}
      spellCheck={false}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(value);
      }}
    />
  );
}

/** A number field, committed the same way. */
function NumberCommit({
  label,
  value,
  onCommit,
  disabled,
  bare = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly onCommit: (value: number) => void;
  readonly disabled: boolean;
  /** Without its visible label, for a field in a table whose column names it. */
  readonly bare?: boolean;
}): React.JSX.Element {
  return (
    <NumberInput
      label={label}
      value={value}
      disabled={disabled}
      bare={bare}
      open={false}
      onCommit={(v) => {
        if (v !== null) onCommit(v);
      }}
    />
  );
}

/** One end of a rule's range: a number, or empty for a range open at that end. */
function RangeEnd({
  label,
  value,
  onCommit,
  disabled,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onCommit: (value: number | null) => void;
  readonly disabled: boolean;
}): React.JSX.Element {
  return (
    <NumberInput label={label} value={value} disabled={disabled} bare open onCommit={onCommit} />
  );
}

function NumberInput({
  label,
  value,
  onCommit,
  disabled,
  open,
  bare,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onCommit: (value: number | null) => void;
  readonly disabled: boolean;
  readonly open: boolean;
  readonly bare: boolean;
}): React.JSX.Element {
  const shown = value === null ? "" : String(round(value));
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = (): void => {
    if (draft === shown) return;
    if (draft.trim() === "" && open) {
      onCommit(null);
      return;
    }
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(shown);
      return;
    }
    onCommit(parsed);
  };

  const input = (
    <input
      className={styles.number}
      aria-label={label}
      inputMode="decimal"
      value={draft}
      placeholder={open ? "open" : undefined}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(shown);
      }}
    />
  );

  if (bare) return input;
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {input}
    </label>
  );
}

/** Short where it is not whole, as the designspace file writes it. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
