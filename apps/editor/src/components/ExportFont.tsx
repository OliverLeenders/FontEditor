import { exportFamily, exportFileName, exportUfo, toWoff, toWoff2 } from "@typewright/font-io";
import { type Location, defaultLocation } from "@typewright/font-model";
import { useState } from "react";

import { desktop } from "../desktop.js";
import { useEditorStore, useStoreValue } from "../useStore.js";
import { BarMenu } from "./BarMenu.js";
import type { Item } from "./MenuItems.js";
import styles from "./OpenFont.module.css";
import { DownloadIcon } from "./icons.js";

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "done"; readonly file: string; readonly warnings: readonly string[] }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Export the font as a file you can install.
 *
 * Deliberately labelled "Export", never "Save". What comes out is a *new* font
 * built from what the editor models — outlines, advances, the character map,
 * vertical metrics — and not the file you opened with your edits applied. A
 * font imported from elsewhere also carried OpenType features, hinting and
 * composite glyphs, and none of that survives a trip through this model. A
 * button that said "Save" would be promising something it cannot do.
 */
/**
 * The exporters that need a font parser, fetched the first time one is used.
 *
 * See `@typewright/font-io/binary`. A format that is only a wrapper round the
 * TrueType flavour — WOFF, WOFF2 — still needs the TrueType flavour first, so
 * it waits for this too.
 */
const binary = () => import("@typewright/font-io/binary");

export function ExportFont(): React.JSX.Element {
  const store = useEditorStore();
  const glyphCount = useStoreValue((s) => s.session.editor.document.glyphOrder.length);
  const masters = useStoreValue((s) => s.project.masters.length);
  const axes = useStoreValue((s) => s.project.axes.length);
  const instanceCount = useStoreValue((s) => s.project.instances.length);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  /**
   * Hand a file to the browser.
   *
   * The object URL is revoked on the next turn of the event loop rather than
   * immediately: the click has to be dispatched before the URL stops meaning
   * anything.
   */
  const download = (data: BlobPart, file: string, type: string): void => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = file;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const attemptAsync = async (
    run: () => Promise<{ file: string; warnings: readonly string[] }>,
  ): Promise<void> => {
    try {
      setStatus({ kind: "done", ...(await run()) });
    } catch (error) {
      setStatus({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const otf = (): void =>
    void attemptAsync(async () => {
      const { exportFont } = await binary();
      const document = store.editor.document;
      const { bytes, warnings } = exportFont(document);
      const file = exportFileName(document);
      download(bytes, file, "font/otf");
      return { file, warnings };
    });

  /**
   * The whole family: a UFO per master and the designspace beside them.
   *
   * What fontmake is given, and what makes a design drawn here buildable by
   * something else. Asynchronous because the masters that are not open live on
   * disk and have to be read in.
   */
  const family = (): void =>
    void attemptAsync(async () => {
      const project = store.getState().project;
      const masters = await store.familyMasters();
      const { bytes, fileName, files } = exportFamily(project.axes, masters, project.instances, {
        rules: project.rules,
        rulesProcessing: project.rulesProcessing,
        kept: project.kept,
      });
      download(bytes.slice().buffer, fileName, "application/zip");
      return { file: `${fileName} · ${String(files)} files`, warnings: [] };
    });

  /**
   * Every named style, as an ordinary font of its own.
   *
   * The other answer to the same question the variable font answers. One file
   * that is every style is right nearly everywhere; a folder of static fonts is
   * what a printer wants, what an operating system older than 2017 can install,
   * and what most places that take an upload still ask for.
   *
   * Only the instances, never the masters. A master is a drawing and an
   * instance is a style somebody decided the family has — and in a two-axis
   * family the masters are its four corners, which is not a set of fonts
   * anybody would ship.
   */
  const instances = (): void =>
    void attemptAsync(async () => {
      const project = store.getState().project;
      const masters = (await store.allMasters()).map((m) => ({
        ...m,
        sparse: m.sparse !== undefined,
      }));
      const { exportInstances } = await binary();
      const out = exportInstances(project.axes, masters, project.instances, project.rules);
      download(out.bytes.slice().buffer, out.fileName, "application/zip");
      return { file: `${out.fileName} · ${String(out.files)} fonts`, warnings: out.warnings };
    });

  /**
   * One font that is every master and everything between them.
   *
   * The masters have to be in the order the designspace puts them and the
   * default first: everything in the file is a delta from the first master, and
   * a font whose default is its Black is a font that is Black until something
   * asks otherwise.
   */
  /**
   * The masters a variable font is built from, the default first and whole:
   * everything in the file is a delta from it.
   */
  const variableMasters = async () => {
    const project = store.getState().project;
    const all = await store.allMasters();
    const home = defaultLocation(project.axes);
    const whole = (m: (typeof all)[number]) =>
      m.sparse === undefined && atHome(m.location, home, project.axes);
    return [...all.filter(whole), ...all.filter((m) => !whole(m))].map((m) => ({
      ...m,
      sparse: m.sparse !== undefined,
    }));
  };

  const variable = (): void =>
    void attemptAsync(async () => {
      const project = store.getState().project;
      const ordered = await variableMasters();

      const { exportVariableFont } = await binary();
      const out = exportVariableFont(project.axes, ordered, project.instances, {
        rules: project.rules,
        rulesProcessing: project.rulesProcessing,
      });
      const file = exportFileName(store.editor.document).replace(/\.otf$/, "-VF.otf");
      download(out.bytes, file, "font/otf");
      return { file, warnings: out.warnings };
    });

  /**
   * The same, with quadratic outlines: `glyf` and `gvar` rather than CFF2.
   *
   * The flavour the web is actually served, because it is the one WOFF2 can
   * take apart and compress. What it costs is the conversion — a cubic cannot
   * be said exactly in quadratics — and one thing more than the static TTF
   * costs: every master has to convert to the same points before a delta can be
   * taken between them, so a light weight carries a point or two it would not
   * have needed on its own.
   */
  const variableTrueType = (): void =>
    void attemptAsync(async () => {
      const project = store.getState().project;
      const ordered = await variableMasters();

      const { exportVariableTrueType } = await binary();
      const out = exportVariableTrueType(project.axes, ordered, project.instances, {
        rules: project.rules,
        rulesProcessing: project.rulesProcessing,
      });
      const file = exportFileName(store.editor.document).replace(/\.otf$/, "-VF.ttf");
      download(out.bytes, file, "font/ttf");
      return { file, warnings: out.warnings };
    });

  /**
   * The same font, with quadratic outlines.
   *
   * A conversion rather than another way of writing the same numbers: a cubic
   * cannot be said exactly as quadratics, so this is the drawing to within a
   * fraction of a unit rather than the drawing itself. The OTF beside it is
   * exact, and is the one to hand to somebody who will edit it again.
   */
  const truetype = (): void =>
    void attemptAsync(async () => {
      const { exportTrueType } = await binary();
      const document = store.editor.document;
      const { bytes, warnings } = exportTrueType(document);
      const file = exportFileName(document).replace(/\.otf$/, ".ttf");
      download(bytes, file, "font/ttf");
      return { file, warnings };
    });

  /**
   * The TrueType flavour, hinted by ttfautohint: the desktop application only.
   *
   * Hinting is what keeps stems a whole pixel wide at small sizes on Windows,
   * and ttfautohint is a C program a browser cannot run. So the desktop
   * application runs the one bundled with it, and this item is not offered
   * anywhere else.
   */
  const hintedTruetype = (): void =>
    void attemptAsync(async () => {
      const host = desktop();
      if (host === null) throw new Error("Hinting needs the desktop application.");
      const { exportTrueType } = await binary();
      const document = store.editor.document;
      const { bytes, warnings } = exportTrueType(document);
      const hinted = await host.invoke("hint_truetype", new Uint8Array(bytes));
      if (!(hinted instanceof ArrayBuffer)) throw new Error("ttfautohint gave nothing back.");
      const file = exportFileName(document).replace(/\.otf$/, "-hinted.ttf");
      download(hinted, file, "font/ttf");
      return { file, warnings };
    });

  /**
   * The same font, wrapped for a web page.
   *
   * Neither of these is another drawing of the font: they are the TrueType
   * flavour behind a header, each table squeezed, and a browser unwraps them
   * back into exactly the file they were made from. TrueType rather than CFF
   * because that is what the transform in WOFF2 is *for* — a CFF font goes
   * through it unchanged and comes out barely smaller than a WOFF.
   *
   * Both, rather than the newer one alone, because a `@font-face` names them in
   * a list and the second entry is what an old browser takes.
   */
  const woff = (): void =>
    void attemptAsync(async () => {
      const { exportTrueType } = await binary();
      const document = store.editor.document;
      const made = exportTrueType(document);
      const bytes = await toWoff(new Uint8Array(made.bytes));
      const file = exportFileName(document).replace(/\.otf$/, ".woff");
      download(bytes.slice().buffer, file, "font/woff");
      return { file: `${file} · ${size(bytes.length)}`, warnings: made.warnings };
    });

  /**
   * The same again, Brotli'd and with the outlines taken apart first.
   *
   * The wasm that does it is a megabyte, so it arrives when this is pressed and
   * never at startup: an export is the last thing anybody does in a session,
   * and a moment here is cheaper than a megabyte on every load.
   */
  const woff2 = (): void =>
    void attemptAsync(async () => {
      const { exportTrueType } = await binary();
      const document = store.editor.document;
      const made = exportTrueType(document);
      const out = await toWoff2(new Uint8Array(made.bytes));
      const file = exportFileName(document).replace(/\.otf$/, ".woff2");
      download(out.bytes.slice().buffer, file, "font/woff2");
      return {
        file: `${file} · ${size(out.bytes.length)} · ${String(Math.round(out.saved * 100))}% smaller`,
        warnings: made.warnings,
      };
    });

  const ufo = (): void =>
    void attemptAsync(async () => {
      const document = store.editor.document;
      // The pictures too, which is why this one is the async of the pair: they
      // are read from the working store rather than held in the document.
      const { bytes, fileName } = exportUfo(document, await store.allImages(), store.layers());
      // Sliced to a plain ArrayBuffer: a Uint8Array view is not a BlobPart, and
      // a view over a larger buffer would carry more than the archive.
      download(bytes.slice().buffer, fileName, "application/zip");
      return { file: fileName, warnings: [] };
    });

  /*
   * Five files, one menu.
   *
   * They were five buttons in the bar, which spent a third of its width on the
   * thing a person does at the end of a session. The words stay — a format is
   * its name, and "OTF" is not a picture — and the one mark they share says
   * what all five do.
   */
  const items: Item[] = [
    {
      kind: "item",
      label: "OTF",
      note: "install and use",
      icon: DownloadIcon,
      disabled: glyphCount === 0,
      run: otf,
    },
    {
      kind: "item",
      label: "TTF",
      note: "quadratic outlines",
      icon: DownloadIcon,
      disabled: glyphCount === 0,
      run: truetype,
    },
    ...(desktop() === null
      ? []
      : [
          {
            kind: "item" as const,
            label: "TTF, hinted",
            note: "ttfautohint, for Windows",
            icon: DownloadIcon,
            disabled: glyphCount === 0,
            run: hintedTruetype,
          },
        ]),
    {
      kind: "item",
      label: "WOFF",
      note: "for a web page",
      icon: DownloadIcon,
      disabled: glyphCount === 0,
      run: woff,
    },
    {
      kind: "item",
      label: "WOFF2",
      note: "for a web page, smaller",
      icon: DownloadIcon,
      disabled: glyphCount === 0,
      run: woff2,
    },
    {
      kind: "item",
      label: "UFO",
      note: "source, zipped",
      icon: DownloadIcon,
      disabled: glyphCount === 0,
      run: ufo,
    },
  ];

  // Only where there is a family to write. A designspace with one source is a
  // legal file and a pointless one, and an item that made one would be an item
  // that does nothing anybody wanted.
  if (masters > 1) {
    items.push({ kind: "separator" });
    items.push({
      kind: "item",
      label: "Family",
      note: "a UFO per master",
      icon: DownloadIcon,
      disabled: glyphCount === 0,
      run: family,
    });
    items.push({
      kind: "item",
      label: "Variable font",
      note: axes === 0 ? "needs an axis" : "every master in one",
      icon: DownloadIcon,
      disabled: glyphCount === 0 || axes === 0,
      run: variable,
    });
    items.push({
      kind: "item",
      label: "Variable TTF",
      note: axes === 0 ? "needs an axis" : "quadratic, for the web",
      icon: DownloadIcon,
      disabled: glyphCount === 0 || axes === 0,
      run: variableTrueType,
    });
    items.push({
      kind: "item",
      label: "Instances",
      note: instanceCount === 0 ? "name some first" : `${String(instanceCount)} static fonts`,
      icon: DownloadIcon,
      disabled: glyphCount === 0 || instanceCount === 0,
      run: instances,
    });
  }

  return (
    <div className={styles.zone}>
      <BarMenu
        label="Export"
        icon={DownloadIcon}
        title="Write a copy of this font out as a file"
        panelLabel="Export"
        items={items}
      />
      {status.kind === "done" ? (
        <span className={styles.note} role="status">
          {status.file}
          {status.warnings.length > 0 ? (
            <span className={styles.warn} title={status.warnings.slice(0, 20).join("\n")}>
              {" "}
              · {status.warnings.length} warning{status.warnings.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
      ) : null}
      {status.kind === "failed" ? (
        <span className={styles.error} role="alert">
          {status.message}
        </span>
      ) : null}
    </div>
  );
}

/** Whether a master sits where every axis has its default: the font's home. */
function atHome(
  at: Location,
  home: Location,
  axes: readonly { readonly tag: string; readonly default: number }[],
): boolean {
  return axes.every((a) => (at[a.tag] ?? a.default) === (home[a.tag] ?? a.default));
}

/** A file size, said the way a person says it. */
function size(bytes: number): string {
  return bytes < 1024
    ? `${String(bytes)} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} kB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
