// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { ExportFont } = await import("../src/components/ExportFont.js");

/**
 * The hinted TrueType export, which only the desktop application offers.
 *
 * The hinting itself is ttfautohint's, run by the desktop shell. What the menu
 * decides is whether to offer it at all — never in a browser — and that it sends
 * the compiled font to the shell as bytes and hands over what comes back.
 */

type Download = { readonly file: string; readonly type: string; readonly size: number };
let downloads: Download[];

const globals = globalThis as unknown as Record<string, unknown>;

beforeAll(() => {
  installDomStubs();
});

beforeEach(() => {
  downloads = [];
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
  delete globals["__TAURI_INTERNALS__"];
});

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /^Export/ }));
const hinted = () => screen.queryByRole("menuitemcheckbox", { name: /TTF, hinted/ });

describe("the hinted TrueType export", () => {
  it("is not offered in a browser", () => {
    render(<ExportFont />);
    openMenu();
    expect(hinted()).toBeNull();
  });

  it("sends the TrueType flavour to the desktop shell and downloads what it gives back", async () => {
    const invoke = vi.fn(async (command: string, payload?: unknown) => {
      await Promise.resolve();
      return command === "hint_truetype" && payload instanceof Uint8Array
        ? new Uint8Array(payload.length + 100).buffer
        : undefined;
    });
    globals["__TAURI_INTERNALS__"] = { invoke };

    render(<ExportFont />);
    openMenu();
    fireEvent.click(hinted()!);

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(invoke).toHaveBeenCalledWith("hint_truetype", expect.any(Uint8Array));
    expect(downloads[0]?.file).toMatch(/-hinted\.ttf$/);
    expect(downloads[0]?.type).toBe("font/ttf");
    // What the shell gave back, not the font that was sent.
    const sent = invoke.mock.calls[0]?.[1] as Uint8Array;
    expect(downloads[0]?.size).toBe(sent.length + 100);
  });

  it("downloads nothing when the shell cannot hint the font", async () => {
    const invoke = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("ttfautohint could not hint this font: bad table");
    });
    globals["__TAURI_INTERNALS__"] = { invoke };

    render(<ExportFont />);
    openMenu();
    fireEvent.click(hinted()!);

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/bad table/)).not.toBeNull());
    expect(downloads).toEqual([]);
  });
});
