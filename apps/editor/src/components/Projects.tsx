import { useEffect, useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./Projects.module.css";

/**
 * Which font to work on.
 *
 * Shown every time the program starts, and from the File menu at any time. Not a dialog: at startup there is nothing behind it yet, and a
 * modal over an empty editor is a lie about what is loaded.
 *
 * The first button is the last font, focused, so the whole screen can be
 * answered with Enter by somebody who only ever works on one.
 */
export function Projects(): React.JSX.Element {
  const store = useEditorStore();
  const all = useStoreValue((s) => s.projects.all);
  const current = useStoreValue((s) => s.projects.current);
  const skip = useStoreValue((s) => s.skipChooser);

  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  // The font whose Forget is being asked about, if one is.
  const [confirming, setConfirming] = useState<string | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueRef.current?.focus();
  }, []);

  const [first, ...rest] = all;
  const others = current === null ? rest : all.filter((it) => it.id !== current);

  return (
    <div className={styles.pane}>
      <div className={styles.sheet}>
        <h1 className={styles.title}>Typewright</h1>

        {first === undefined ? (
          <p className={styles.empty}>
            No fonts yet. Start one here, or open a UFO folder from the File menu.
          </p>
        ) : (
          <button
            ref={continueRef}
            type="button"
            className={styles.resume}
            onClick={() => {
              store.openProject(current ?? first.id);
            }}
          >
            <span className={styles.resumeWhat}>
              {current === null ? "Continue with" : "Back to"}{" "}
              {all.find((it) => it.id === current)?.name ?? first.name}
            </span>
            <span className={styles.resumeWhere}>{whereOf(all, current ?? first.id)}</span>
          </button>
        )}

        {others.length === 0 ? null : (
          <ul className={styles.list}>
            {others.map((project) => (
              <li key={project.id} className={styles.row}>
                <button
                  type="button"
                  className={styles.open}
                  onClick={() => {
                    store.openProject(project.id);
                  }}
                >
                  <span className={styles.name}>{project.name}</span>
                  <span className={styles.where}>
                    {project.folder ?? "not saved to a folder"} · {since(project.openedAt)}
                  </span>
                </button>
                {confirming === project.id ? (
                  <div
                    className={styles.confirm}
                    role="group"
                    aria-label={`Forget ${project.name}?`}
                  >
                    <span className={styles.confirmText}>
                      {project.folder === null
                        ? "Never saved to a folder, so this is its only copy."
                        : `${project.folder} stays on disk. Changes not saved to it are deleted.`}
                    </span>
                    <button
                      type="button"
                      className={project.folder === null ? styles.danger : styles.small}
                      onClick={() => {
                        setConfirming(null);
                        void store.forgetProject(project.id);
                      }}
                    >
                      {project.folder === null ? "Delete" : "Remove"}
                    </button>
                    <button
                      type="button"
                      className={styles.small}
                      onClick={() => {
                        setConfirming(null);
                      }}
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.forget}
                    title="Take this off the list and delete Typewright's copy of it. The folder on disk is not touched."
                    onClick={() => {
                      setConfirming(project.id);
                    }}
                  >
                    Forget
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {naming ? (
          <form
            className={styles.naming}
            onSubmit={(event) => {
              event.preventDefault();
              const wanted = name.trim();
              if (wanted === "") return;
              void store.startProject(wanted);
            }}
          >
            <input
              autoFocus
              className={styles.field}
              value={name}
              placeholder="Family name"
              aria-label="Family name"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <button type="submit" className={styles.go} disabled={name.trim() === ""}>
              Start
            </button>
          </form>
        ) : (
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => {
                setNaming(true);
              }}
            >
              New font…
            </button>
            {current === null ? null : (
              <button
                type="button"
                onClick={() => {
                  store.showProjects(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        <label className={styles.skip}>
          <input
            type="checkbox"
            checked={skip}
            onChange={(event) => {
              store.setSkipChooser(event.target.checked);
            }}
          />
          Open the last font straight away next time
        </label>
      </div>
    </div>
  );
}

function whereOf(
  all: readonly { readonly id: string; readonly folder: string | null }[],
  id: string,
): string {
  const folder = all.find((it) => it.id === id)?.folder;
  return folder ?? "not saved to a folder";
}

/** When something last happened, in words rather than a timestamp. */
function since(at: number): string {
  if (at === 0) return "never opened";

  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 90) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${String(minutes)} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${String(hours)} hours ago`;

  return `${String(Math.round(hours / 24))} days ago`;
}
