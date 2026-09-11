// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { ExportFont } = await import("../src/components/ExportFont.js");
const { exportFileName } = await import("@typewright/font-io");
const { WEIGHT, master, project, setAxes } = await import("@typewright/font-model");

/**
 * The Export menu: which files it offers, and what it hands the browser.
 *
 * The writers are tested where they live, byte by byte and against fontTools.
 * What is asked here is what only the menu decides — which formats a font with
 * one drawing is offered and which a family is, which of those cannot run yet
 * and says why, and that pressing one hands over a file of the right kind under
 * the right name, or says what went wrong rather than nothing.
 */

type Store = ReturnType<typeof freshStore>;
type Download = { readonly file: string; readonly type: string; readonly size: number };

let downloads: Download[];

beforeAll(() => {
  installDomStubs();
});

beforeEach(() => {
  downloads = [];
  // jsdom makes no object URLs and follows no links. Stand in for both, and
  // keep what would have been downloaded.
  let handed: Blob | null = null;
  const url = URL as unknown as Record<string, unknown>;
  url["createObjectURL"] = (blob: Blob): string => {
    handed = blob;
    return "blob:test";
  };
  url["revokeObjectURL"] = (): void => undefined;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
    downloads.push({ file: this.download, type: handed?.type ?? "", size: handed?.size ?? 0 });
  };
});

afterEach(() => {
  cleanup();
});

function openMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: /^Export/ }));
}

const item = (name: RegExp) => screen.queryByRole<HTMLButtonElement>("menuitemcheckbox", { name });

function press(name: RegExp): void {
  const found = item(name);
  if (found === null) throw new Error(`no menu item ${String(name)}`);
  fireEvent.click(found);
}

/** A family: masters along weight, with or without the axis they sit on. */
function family(store: Store, withAxis: boolean): void {
  act(() => {
    const base = project(store.editor.document, { id: "m1" });
    const shaped = withAxis ? setAxes(base, [WEIGHT]) : base;
    store.patch({
      project: {
        ...shaped,
        masters: [
          master("m1", "Regular", withAxis ? { wght: 400 } : {}),
          master("m2", "Bold", withAxis ? { wght: 700 } : {}),
        ],
      },
    });
  });
}

describe("what a single font is offered", () => {
  it("is the five files a font is shipped or kept as", () => {
    render(<ExportFont />);
    openMenu();

    for (const name of [/^OTF/, /^TTF/, /^WOFF\b/, /^WOFF2/, /^UFO/]) {
      expect(item(name)).not.toBeNull();
    }
  });

  it("is no family format, there being no family", () => {
    render(<ExportFont />);
    openMenu();

    expect(item(/^Family/)).toBeNull();
    expect(item(/^Variable font/)).toBeNull();
    expect(item(/^Instances/)).toBeNull();
  });

  it("is nothing usable when the font has no glyphs", () => {
    const store = freshStore();
    act(() => {
      store.setEditor({
        ...store.editor,
        document: { ...store.editor.document, glyphOrder: [], glyphs: {} },
      });
    });
    render(<ExportFont />, store);
    openMenu();

    expect(item(/^OTF/)?.disabled).toBe(true);
    expect(item(/^UFO/)?.disabled).toBe(true);
  });
});

describe("pressing a format", () => {
  it("hands over an OTF named after the family", async () => {
    const { store } = render(<ExportFont />);
    openMenu();
    press(/^OTF/);

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(downloads[0]?.file).toBe(exportFileName(store.editor.document));
    expect(downloads[0]?.type).toBe("font/otf");
    expect(downloads[0]?.size).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toContain(downloads[0]?.file);
  });

  it("hands over the TrueType flavour under the same name", async () => {
    const { store } = render(<ExportFont />);
    openMenu();
    press(/^TTF/);

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(downloads[0]?.file).toBe(
      exportFileName(store.editor.document).replace(/\.otf$/, ".ttf"),
    );
    expect(downloads[0]?.type).toBe("font/ttf");
  });

  it("hands over the source as a zip", async () => {
    render(<ExportFont />);
    openMenu();
    press(/^UFO/);

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(downloads[0]?.type).toBe("application/zip");
    expect(downloads[0]?.size).toBeGreaterThan(0);
  });

  it("says what went wrong, and hands over nothing, when it cannot", async () => {
    const store = freshStore();
    (store as unknown as { allImages: () => Promise<never> }).allImages = () =>
      Promise.reject(new Error("the working copy could not be read"));
    render(<ExportFont />, store);
    openMenu();
    press(/^UFO/);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("the working copy could not be read");
    });
    expect(downloads).toHaveLength(0);
  });
});

describe("what a family is offered", () => {
  it("is the family formats as well, once there is more than one master", () => {
    const store = freshStore();
    family(store, true);
    render(<ExportFont />, store);
    openMenu();

    expect(item(/^Family/)).not.toBeNull();
    expect(item(/^Variable font/)?.disabled).toBe(false);
    expect(item(/^Variable TTF/)?.disabled).toBe(false);
  });

  it("says a variable font needs an axis, where there is none", () => {
    const store = freshStore();
    family(store, false);
    render(<ExportFont />, store);
    openMenu();

    expect(item(/^Variable font/)?.disabled).toBe(true);
    expect(item(/^Variable font needs an axis/)).not.toBeNull();
  });

  it("asks for styles to be named before writing them out", async () => {
    const store = freshStore();
    family(store, true);
    render(<ExportFont />, store);
    openMenu();

    expect(item(/^Instances name some first/)?.disabled).toBe(true);

    await act(async () => {
      await store.addInstance("i1", "Semibold", { wght: 600 });
    });
    expect(item(/^Instances 1 static fonts/)?.disabled).toBe(false);
  });
});
