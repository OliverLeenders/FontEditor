import { BlendIcon } from "./icons.js";
import styles from "./LocationBar.module.css";
import { useEditorStore, useStoreValue } from "../useStore.js";

/**
 * Where in the designspace the text is set, for the workspaces that set text.
 *
 * The canvas has had this since the designspace went in — a weight nobody drew,
 * shown behind the one being drawn — and it answered the wrong half of the
 * question. What a master is wrong about is rarely visible in one letter at one
 * weight; it shows up in a line of them, where a stem that thickens faster than
 * its neighbours or a sidebearing that drifts is plain at a glance.
 *
 * The same location as the canvas's, deliberately. Three places that could
 * disagree about which weight is on screen would be three answers to one
 * question, and moving the slider here moves what the canvas shows behind the
 * drawing too.
 *
 * Nothing at all for a font with one master or no axes: there is no between.
 */
export function LocationBar(): React.JSX.Element | null {
  const store = useEditorStore();
  const project = useStoreValue((s) => s.project);
  const at = useStoreValue((s) => s.preview);

  if (project.masters.length < 2 || project.axes.length === 0) return null;

  const here = project.masters.find((m) => m.id === project.current)?.location ?? {};
  const shown = at ?? here;

  return (
    <div className={styles.location} role="group" aria-label="The place in the designspace">
      <label className={styles.on}>
        <input
          type="checkbox"
          checked={at !== null}
          aria-label="Set the text at a place between the masters"
          onChange={() => void store.setPreview(at === null ? { ...here } : null)}
        />
        <span className={styles.mark}>
          <BlendIcon />
        </span>
        <span className={styles.label}>Between</span>
      </label>

      {at === null
        ? null
        : project.axes.map((a) => (
            <label key={a.tag} className={styles.axis}>
              <span className={styles.axisName}>{a.name}</span>
              <input
                className={styles.slider}
                type="range"
                min={a.min}
                max={a.max}
                step={1}
                value={shown[a.tag] ?? a.default}
                aria-label={`${a.name} of the text`}
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
