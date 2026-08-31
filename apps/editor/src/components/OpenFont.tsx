import { useRef, useState } from "react";

import { useEditorStore, useStoreValue } from "../useStore.js";
import styles from "./OpenFont.module.css";

/**
 * What the picker offers: the binary formats, and a zipped UFO.
 *
 * `.zip` has to be in the list for a UFO to be selectable at all, which does
 * mean the picker will show archives that are not fonts. The alternative is a
 * second button for one format, and a wrong file is answered immediately by the
 * reader rather than being a state anyone gets stuck in.
 */
const ACCEPT = ".ttf,.otf,.woff,.ufoz,.zip,font/ttf,font/otf,font/woff";

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly name: string }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "done";
      readonly family: string;
      readonly glyphs: number;
      readonly warnings: readonly string[];
    };

/**
 * The "Open font" control, and the drop target behind it.
 *
 * Both routes end in the same call, because a font arriving by drag is not a
 * different kind of font. The button exists so the feature is discoverable and
 * reachable from the keyboard; the drop target exists because dragging a file
 * onto a window is what people actually try first.
 */
export function OpenFont(): JSX.Element {
  const store = useEditorStore();
  const reading = useStoreValue((s) => s.ownership === "reading");
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  const open = async (file: File): Promise<void> => {
    setStatus({ kind: "reading", name: file.name });
    try {
      const result = await store.importFont(await file.arrayBuffer(), file.name);
      setStatus({
        kind: "done",
        family: result.family,
        glyphs: result.glyphs,
        warnings: result.warnings,
      });
    } catch (error) {
      setStatus({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div
      className={dragging ? `${styles.zone} ${styles.dragging}` : styles.zone}
      onDragOver={(event) => {
        // Without preventDefault the browser navigates to the file, which
        // throws away the session.
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file !== undefined) void open(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className={styles.input}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void open(file);
          // Cleared so choosing the same file twice fires a second change.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className={styles.button}
        disabled={status.kind === "reading" || reading}
        title={reading ? "Another tab is saving this project" : undefined}
        onClick={() => inputRef.current?.click()}
      >
        {status.kind === "reading" ? "Reading…" : "Open font…"}
      </button>
      <Message status={status} />
    </div>
  );
}

function Message({ status }: { status: Status }): JSX.Element | null {
  if (status.kind === "idle") return null;
  if (status.kind === "reading") return <span className={styles.note}>{status.name}</span>;

  if (status.kind === "failed") {
    return (
      <span className={styles.error} role="alert">
        {status.message}
      </span>
    );
  }

  // Warnings are counted rather than listed. A broken font can produce hundreds,
  // and a wall of them beside a toolbar would bury the one fact that matters —
  // that the font opened, and how much of it arrived.
  return (
    <span className={styles.note}>
      {status.family} · {status.glyphs} glyphs
      {status.warnings.length > 0 ? (
        <span className={styles.warn} title={status.warnings.slice(0, 20).join("\n")}>
          {" "}
          · {status.warnings.length} warning{status.warnings.length === 1 ? "" : "s"}
        </span>
      ) : null}
    </span>
  );
}
