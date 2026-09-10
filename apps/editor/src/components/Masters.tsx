import {
  type Incompatibility,
  type MasterId,
  WEIGHT,
  defaultLocation,
  describeLocation,
  orderedInstances,
  orderedMasters,
} from "@typewright/font-model";
import { useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import { BarMenu } from "./BarMenu.js";
import styles from "./Masters.module.css";
import { BlendIcon, CopyPlusIcon, LayersIcon, TrashIcon } from "./icons.js";

/**
 * The drawings of this typeface, and moving between them.
 *
 * A font begins with one master and stays that way until somebody says
 * otherwise, so this panel is mostly a list of one — and the second entry, when
 * it arrives, is what turns a font into a family.
 *
 * The check is the other half and the reason the panel is worth opening.
 * Interpolation is arithmetic on corresponding points and nothing in it notices
 * when two drawings disagree about what they are: an extra point in the bold
 * does not fail, it produces a letter with a spike in it at every weight
 * between. So the way to compare two masters is here, next to the way to make
 * one.
 */
export function Masters(): React.JSX.Element {
  const store = useEditorStore();
  const project = useStoreValue((s) => s.project);
  const reading = useStoreValue((s) => s.ownership === "reading");

  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ name: string; found: Incompatibility[] } | null>(null);

  const attempt = async (run: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      const message = await run();
      if (message !== null) setSaid(message);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const masters = orderedMasters(project);

  /**
   * Add one, at a weight nothing is drawn at yet.
   *
   * The first added master brings the weight axis with it, because that is what
   * a second drawing of a typeface almost always is — and an axis nobody has
   * asked for is easier to rename than an axis nobody has.
   */
  const add = (): Promise<void> =>
    attempt(async () => {
      const axes = project.axes.length === 0 ? [WEIGHT] : project.axes;
      if (project.axes.length === 0) await store.setAxes(axes);

      const first = axes[0];
      if (first === undefined) return null;

      const taken = new Set(masters.map((m) => m.location[first.tag] ?? first.default));
      const free = [first.max, first.min, first.default].find((value) => !taken.has(value));
      if (free === undefined) return "Every place on the axis is taken; move one first.";

      const name = free === first.max ? "Bold" : free === first.min ? "Light" : "Regular";
      const id = `master-${String(Date.now())}`;
      await store.addMaster(
        id,
        unique(
          name,
          masters.map((m) => m.name),
        ),
        { [first.tag]: free },
      );

      return `Added, drawn from ${current(project.current, masters)}`;
    });

  const goTo = (id: MasterId): Promise<void> =>
    attempt(async () => {
      const done = await store.switchMaster(id);
      if (done === null) return null;
      setChecked(null);
      return `${done.name} · ${String(done.glyphs)} glyphs${
        done.problems.length === 0 ? "" : ` · ${String(done.problems.length)} unreadable`
      }`;
    });

  const check = (id: MasterId): Promise<void> =>
    attempt(async () => {
      const done = await store.compareWith(id);
      if (done === null) return "Nothing to compare against.";

      setChecked({ name: done.master.name, found: [...done.found] });
      return null;
    });

  return (
    <BarMenu
      label={
        masters.length === 1 ? "Masters" : `Masters · ${currentName(project.current, masters)}`
      }
      icon={LayersIcon}
      title="The drawings of this typeface, and moving between them"
      panelClassName={styles.panel}
      panelLabel="Masters"
    >
      <div className={styles.head}>
        <span>Drawings of this typeface</span>
        <button
          type="button"
          className={styles.add}
          disabled={busy || reading}
          title={reading ? "Another tab is saving this project" : "Add one, drawn from this one"}
          onClick={() => void add()}
        >
          <CopyPlusIcon />
          Add…
        </button>
      </div>

      <ul className={styles.list}>
        {masters.map((m) => {
          const here = m.id === project.current;
          return (
            <li key={m.id} className={styles.row} data-here={here ? "true" : undefined}>
              <input
                className={styles.name}
                value={m.name}
                aria-label={`Name of the master ${m.name}`}
                spellCheck={false}
                disabled={reading}
                onChange={(event) => void store.renameMaster(m.id, event.target.value)}
              />
              <span className={styles.at}>
                {project.axes.length === 0 ? "" : describeLocation(project.axes, m.location)}
              </span>
              <button
                type="button"
                className={styles.go}
                disabled={busy || here}
                title={here ? "This is the one you are drawing" : `Draw ${m.name}`}
                onClick={() => void goTo(m.id)}
              >
                {here ? "drawing" : "Draw"}
              </button>
              <button
                type="button"
                className={styles.go}
                disabled={busy || here}
                title={`Compare this master with ${m.name}`}
                onClick={() => void check(m.id)}
              >
                Check
              </button>
              <button
                type="button"
                className={styles.drop}
                disabled={busy || reading || masters.length < 2}
                title={
                  masters.length < 2
                    ? "A font needs at least one master"
                    : `Remove ${m.name} from this font`
                }
                aria-label={`Remove the master ${m.name}`}
                onClick={() =>
                  void attempt(async () => {
                    await store.removeMaster(m.id);
                    return `Removed ${m.name}`;
                  })
                }
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ul>

      {project.masters.length > 1 && project.axes.length > 0 ? <Preview /> : null}

      {project.axes.length > 0 ? <Instances onFailed={setFailed} onSaid={setSaid} /> : null}

      {checked === null ? null : <Report name={checked.name} found={checked.found} store={store} />}

      {failed !== null ? (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      ) : null}
      {failed === null && said !== null ? <p className={styles.said}>{said}</p> : null}
    </BarMenu>
  );
}

/**
 * The styles the family is meant to have, between the masters.
 *
 * A different thing from a master, and the difference is what the section is
 * for. A master is a drawing somebody made; an instance is a name and a place,
 * and what it looks like is worked out. Until they exist a variable font can
 * only offer its own corners in a style menu — a two-axis family's four
 * extremes, which is not what anybody calls a set of styles — and there is no
 * static font to write out either, because nothing has said which places are
 * worth writing.
 *
 * They live here rather than in a panel of their own because they are the same
 * designspace, and because the control just above — showing a place between the
 * drawings — is exactly how somebody decides a place is worth naming.
 */
function Instances({
  onFailed,
  onSaid,
}: {
  onFailed: (message: string | null) => void;
  onSaid: (message: string | null) => void;
}): React.JSX.Element {
  const store = useEditorStore();
  const project = useStoreValue((s) => s.project);
  const family = useStoreValue((s) => s.session.editor.document.info.familyName);
  const reading = useStoreValue((s) => s.ownership === "reading");
  const at = useStoreValue((s) => s.preview);

  const instances = orderedInstances(project);

  const attempt = (run: () => Promise<string | null>): void => {
    onFailed(null);
    void (async () => {
      try {
        const message = await run();
        if (message !== null) onSaid(message);
      } catch (error) {
        onFailed(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  /**
   * Name the place being shown, or the default one when nothing is.
   *
   * Following the preview is the whole point of putting this here: you move the
   * sliders until the weight looks like a Semibold, and then you say so.
   */
  const add = (): void =>
    attempt(async () => {
      const where = at ?? defaultLocation(project.axes);
      const name = unique(
        "New style",
        instances.map((i) => i.name),
      );
      await store.addInstance(`instance-${String(Date.now())}`, name, where);
      return `Named ${name} at ${describeLocation(project.axes, where)}`;
    });

  return (
    <div className={styles.instances}>
      <div className={styles.head}>
        <span>Styles between them</span>
        <button
          type="button"
          className={styles.add}
          disabled={reading}
          title={
            reading
              ? "Another tab is saving this project"
              : at === null
                ? "Name a style at the default place on the axes"
                : "Name the place being shown"
          }
          onClick={add}
        >
          <CopyPlusIcon />
          {at === null ? "Name…" : "Name this…"}
        </button>
      </div>

      {instances.length === 0 ? (
        <p className={styles.none}>
          None yet. A variable font written now offers its masters as its styles, and there is
          nothing to write out as ordinary fonts.
        </p>
      ) : null}

      <ul className={styles.list}>
        {instances.map((it) => (
          <li key={it.id} className={styles.instance}>
            <div className={styles.instanceHead}>
              <input
                className={styles.name}
                value={it.name}
                aria-label={`Name of the instance ${it.name}`}
                spellCheck={false}
                disabled={reading}
                onChange={(event) => void store.renameInstance(it.id, event.target.value)}
              />
              <input
                className={styles.instanceFamily}
                value={it.familyName}
                placeholder={family}
                title="The family this style belongs to, where it is not this one"
                aria-label={`Family of the instance ${it.name}`}
                spellCheck={false}
                disabled={reading}
                onChange={(event) => void store.setInstanceFamily(it.id, event.target.value)}
              />
              <button
                type="button"
                className={styles.drop}
                disabled={reading}
                title={`Remove ${it.name}`}
                aria-label={`Remove the instance ${it.name}`}
                onClick={() =>
                  attempt(async () => {
                    await store.removeInstance(it.id);
                    return `Removed ${it.name}`;
                  })
                }
              >
                <TrashIcon />
              </button>
            </div>

            <div className={styles.instanceAt}>
              {project.axes.map((a) => (
                <label key={a.tag} className={styles.instanceAxis}>
                  {a.name}
                  <input
                    className={styles.instanceValue}
                    type="number"
                    min={a.min}
                    max={a.max}
                    value={it.location[a.tag] ?? a.default}
                    aria-label={`${a.name} of the instance ${it.name}`}
                    disabled={reading}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isFinite(value)) return;
                      void store.moveInstance(it.id, { ...it.location, [a.tag]: value });
                    }}
                  />
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A weight nobody drew, shown behind the one being drawn.
 *
 * A slider per axis, and the whole reason it is here rather than anywhere else:
 * a designspace is only worth having if you can see between the drawings, and
 * what shows up in between is what tells you whether the masters are right.
 *
 * Off until asked for. The masters have to be read in from disk to work an
 * instance out, and a designspace of six masters is six fonts of memory for a
 * thing nobody has asked to see.
 */
function Preview(): React.JSX.Element {
  const store = useEditorStore();
  const project = useStoreValue((s) => s.project);
  const at = useStoreValue((s) => s.preview);

  const here = project.masters.find((m) => m.id === project.current)?.location ?? {};
  const shown = at ?? here;

  return (
    <div className={styles.preview}>
      <label className={styles.previewOn}>
        <input
          type="checkbox"
          checked={at !== null}
          aria-label="Show an instance between the masters"
          onChange={() => void store.setPreview(at === null ? { ...here } : null)}
        />
        <span className={styles.previewMark}>
          <BlendIcon />
        </span>
        <span>Show an instance</span>
      </label>

      {at === null
        ? null
        : project.axes.map((a) => (
            <label key={a.tag} className={styles.axis}>
              <span className={styles.axisName}>{a.name}</span>
              <input
                type="range"
                min={a.min}
                max={a.max}
                step={1}
                value={shown[a.tag] ?? a.default}
                aria-label={`${a.name} of the instance`}
                onChange={(event) =>
                  void store.setPreview({ ...shown, [a.tag]: Number(event.target.value) })
                }
              />
              <span className={styles.axisValue}>{Math.round(shown[a.tag] ?? a.default)}</span>
            </label>
          ))}
    </div>
  );
}

/**
 * What cannot be worked out between here and there.
 *
 * Each line names a glyph and says what differs, and opens that glyph — which
 * is the only useful thing to do about it, since every one of these is fixed by
 * drawing rather than by pressing anything.
 */
function Report({
  name,
  found,
  store,
}: {
  name: string;
  found: readonly Incompatibility[];
  store: ReturnType<typeof useEditorStore>;
}): React.JSX.Element {
  if (found.length === 0) {
    return (
      <p className={styles.said}>Every glyph can be worked out between this master and {name}.</p>
    );
  }

  return (
    <div className={styles.report}>
      <p className={styles.reportHead}>
        {found.length} {found.length === 1 ? "glyph differs" : "glyphs differ"} from {name}
      </p>
      <ul className={styles.list}>
        {found.slice(0, 40).map((one, i) => (
          <li key={`${one.glyph}-${String(i)}`} className={styles.found}>
            <button
              type="button"
              className={styles.foundGlyph}
              title={`Open ${one.glyph}`}
              onClick={() => store.setCurrentGlyph(one.glyph)}
            >
              {one.glyph}
            </button>
            <span className={styles.says}>{one.says}</span>
          </li>
        ))}
      </ul>
      {found.length > 40 ? <p className={styles.said}>…and {found.length - 40} more.</p> : null}
    </div>
  );
}

const currentName = (id: MasterId, masters: readonly { id: string; name: string }[]): string =>
  masters.find((m) => m.id === id)?.name ?? "";

const current = currentName;

/** A name nothing else has, by adding a number where one is taken. */
function unique(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) return name;
  for (let n = 2; ; n++) {
    const tried = `${name} ${String(n)}`;
    if (!taken.includes(tried)) return tried;
  }
}
