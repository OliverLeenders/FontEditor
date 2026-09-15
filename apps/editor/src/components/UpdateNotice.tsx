import { useEffect, useState } from "react";

import { desktop } from "../desktop.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./UpdateNotice.module.css";

/**
 * A newer version of the desktop application, offered when it starts.
 *
 * The window asks the latest published release whether there is one, and this
 * says so along the top of the window — where the editor says a font is open in
 * another tab — with an answer to give or not. Nothing is downloaded until
 * somebody presses Install; Later lasts until the next start. When the check
 * cannot be made, offline or before anything is published, there is nothing to
 * say and nothing is said. Only the window the application started with asks;
 * the desktop side answers nothing to the others, so the offer is made once.
 *
 * Installing restarts the application, so first it asks about what a restart
 * leaves behind. Every other window is on a font of its own, so those are
 * closed first, each asking about its own folder as it goes. Then this window's
 * folder, as closing the window does: a UFO folder that does not have the
 * latest changes. The working copy has them either way.
 */
type Stage = "offer" | "others" | "behind" | "installing";

export function UpdateNotice(): React.JSX.Element | null {
  const store = useEditorStore();
  const folder = useStoreValue((s) => s.folder.name);

  const [version, setVersion] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("offer");
  const [others, setOthers] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const host = desktop();
    if (host === null) return;
    const running = { yes: true };
    void host.invoke("check_for_update").then(
      (found) => {
        if (running.yes && typeof found === "string") setVersion(found);
      },
      () => {
        // Offline, or nothing published yet: not news.
      },
    );
    return () => {
      running.yes = false;
    };
  }, []);

  if (version === null) return null;

  const install = async (): Promise<void> => {
    setStage("installing");
    setFailed(null);
    try {
      // When this succeeds the application is replaced and started again, and
      // the page goes with it.
      await desktop()?.invoke("install_update");
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
      setStage("offer");
    }
  };

  const begin = async (): Promise<void> => {
    setFailed(null);
    const open = await desktop()
      ?.invoke("other_windows")
      .catch(() => 0);
    if (typeof open === "number" && open > 0) {
      setOthers(open);
      setStage("others");
      return;
    }
    // The working copy first, whatever happens next.
    await store.flushNow();
    if (store.unsavedOnDisk) setStage("behind");
    else await install();
  };

  const saveAndInstall = async (): Promise<void> => {
    setStage("installing");
    setFailed(null);
    try {
      await store.saveFolder();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
      setStage("behind");
      return;
    }
    await install();
  };

  const later = (): void => {
    setVersion(null);
  };

  const windows = others === 1 ? "the other window" : `the other ${String(others)} windows`;

  return (
    <div className={styles.notice} role="status">
      <span>
        {stage === "behind"
          ? `${folder} has changes that are not in it yet. They are kept in Typewright either way — this is about the folder other tools read.`
          : stage === "others"
            ? `Close ${windows} first. Installing restarts Typewright, and each window asks about its own folder as it closes.`
            : stage === "installing"
              ? `Installing Typewright ${version}. It will start again when it is done.`
              : `Typewright ${version} is available.`}
      </span>
      {failed === null ? null : (
        <span className={styles.failed} role="alert">
          {failed}
        </span>
      )}
      {stage === "offer" ? (
        <>
          <button type="button" className={styles.primary} onClick={() => void begin()}>
            Install and restart
          </button>
          <button type="button" onClick={later}>
            Later
          </button>
        </>
      ) : stage === "others" ? (
        <>
          <button type="button" className={styles.primary} onClick={() => void begin()}>
            Try again
          </button>
          <button type="button" onClick={later}>
            Later
          </button>
        </>
      ) : stage === "behind" ? (
        <>
          <button type="button" className={styles.primary} onClick={() => void saveAndInstall()}>
            Save to {folder} and install
          </button>
          <button type="button" onClick={() => void install()}>
            Install without saving
          </button>
          <button type="button" onClick={later}>
            Later
          </button>
        </>
      ) : null}
    </div>
  );
}
