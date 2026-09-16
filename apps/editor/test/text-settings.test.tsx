// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { TextSettingsControls } = await import("../src/components/TextSettingsControls.js");
const { languagesOf, scriptsOf } = await import("../src/text-settings.js");
const { fontDocument, glyph, setFeatures } = await import("@typewright/font-model");
const { READ_FROM_TEXT } = await import("@typewright/view");

/**
 * Which way a line runs, and whose rules it is set with.
 *
 * The pickers are about the font in hand: the scripts are the ones its
 * characters belong to, and the languages the ones its feature file names. So
 * what is asked here is that the lists say what the font says, and that
 * choosing writes the choice through to the store.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** A font covering some Latin and some Arabic, with two language systems. */
function mixed() {
  return setFeatures(
    fontDocument([
      glyph("a", { unicodes: [0x61] }),
      glyph("b", { unicodes: [0x62] }),
      glyph("alef", { unicodes: [0x627] }),
      glyph("beh", { unicodes: [0x628] }),
      glyph("meem", { unicodes: [0x645] }),
      glyph("i.TRK", {}),
    ]),
    "languagesystem DFLT dflt;\nlanguagesystem latn TRK;\nlanguagesystem arab ARA;\n",
  );
}

describe("the scripts a font covers", () => {
  it("lists the scripts its characters belong to, the best covered first", () => {
    expect(scriptsOf(mixed())).toEqual([
      { tag: "arab", label: "Arabic" },
      { tag: "latn", label: "Latin" },
    ]);
  });

  it("offers a script the feature file names even before it is drawn", () => {
    const declared = setFeatures(
      fontDocument([glyph("a", { unicodes: [0x61] })]),
      "languagesystem hebr dflt;\n",
    );
    expect(scriptsOf(declared).map((s) => s.tag)).toContain("hebr");
  });

  it("has nothing to offer for a font with no characters at all", () => {
    expect(scriptsOf(fontDocument([glyph(".notdef", {})]))).toEqual([]);
  });
});

describe("the languages a font's rules can differ for", () => {
  it("lists what the feature file names, by name where it has one", () => {
    expect(languagesOf(mixed())).toEqual([
      { tag: "ARA", label: "Arabic" },
      { tag: "TRK", label: "Turkish" },
    ]);
  });

  it("leaves out the default, which is not a choice", () => {
    expect(languagesOf(mixed()).map((l) => l.tag)).not.toContain("dflt");
  });

  it("says nothing where there is no feature file to read", () => {
    expect(languagesOf(fontDocument([glyph("a", { unicodes: [0x61] })]))).toEqual([]);
  });
});

describe("the controls in the bar", () => {
  function controls(value = READ_FROM_TEXT) {
    const onChange = vi.fn<(next: typeof READ_FROM_TEXT) => void>();
    render(<TextSettingsControls value={value} document={mixed()} onChange={onChange} />);
    return { onChange };
  }

  it("starts at auto, which is the shaper reading the text", () => {
    controls();
    expect(screen.getByLabelText<HTMLSelectElement>("Direction").value).toBe("auto");
    expect(screen.getByLabelText<HTMLSelectElement>("Script").value).toBe("");
    expect(screen.getByLabelText<HTMLSelectElement>("Language").value).toBe("");
  });

  it("sets the direction", () => {
    const { onChange } = controls();
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "rtl" } });
    expect(onChange).toHaveBeenCalledWith({ ...READ_FROM_TEXT, direction: "rtl" });
  });

  it("sets the script and the language, and can put either back to auto", () => {
    const { onChange } = controls();
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: "arab" } });
    expect(onChange).toHaveBeenCalledWith({ ...READ_FROM_TEXT, script: "arab" });

    cleanup();
    const chosen = controls({ direction: "rtl", script: "arab", language: "ARA" });
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: "" } });
    expect(chosen.onChange).toHaveBeenLastCalledWith({
      direction: "rtl",
      script: null,
      language: "ARA",
    });
  });

  it("offers no language to choose for a font whose file names none", () => {
    const onChange = vi.fn<(next: typeof READ_FROM_TEXT) => void>();
    render(
      <TextSettingsControls
        value={READ_FROM_TEXT}
        document={fontDocument([glyph("a", { unicodes: [0x61] })])}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Language").disabled).toBe(true);
  });
});
