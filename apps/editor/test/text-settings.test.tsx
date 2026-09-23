// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { TextSettingsControls } = await import("../src/components/TextSettingsControls.js");
const { featureChoices, languagesOf, scriptsOf } = await import("../src/text-settings.js");
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

/** A font with a ligature, a stylistic set and a tag nothing has a name for. */
function ruled() {
  return setFeatures(
    fontDocument([glyph("a", { unicodes: [0x61] }), glyph("a.ss01", {})]),
    [
      "feature liga {",
      "  sub a a by a.ss01;",
      "} liga;",
      "feature ss01 {",
      "  sub a by a.ss01;",
      "} ss01;",
      "feature zzzz {",
      "  sub a by a.ss01;",
      "} zzzz;",
      "",
    ].join("\n"),
  );
}

describe("the features a font defines", () => {
  it("lists them in the order the file does, with names where it has them", () => {
    expect(featureChoices(ruled())).toEqual([
      { tag: "liga", label: "Standard ligatures", byDefault: true },
      { tag: "ss01", label: "Stylistic set 1", byDefault: false },
      { tag: "zzzz", label: "zzzz", byDefault: false },
    ]);
  });

  it("says nothing for a font with no feature file", () => {
    expect(featureChoices(fontDocument([glyph("a", { unicodes: [0x61] })]))).toEqual([]);
  });
});

describe("the features panel", () => {
  function panel(value = READ_FROM_TEXT, { applyFeatures = true, canShape = true } = {}) {
    const onChange = vi.fn<(next: typeof READ_FROM_TEXT) => void>();
    const onApplyFeaturesChange = vi.fn<(next: boolean) => void>();
    render(
      <TextSettingsControls
        value={value}
        document={ruled()}
        applyFeatures={applyFeatures}
        canShape={canShape}
        onChange={onChange}
        onApplyFeaturesChange={onApplyFeaturesChange}
      />,
    );
    return { onChange, onApplyFeaturesChange };
  }

  const open = () => fireEvent.click(screen.getByRole("button", { name: "Features" }));

  it("starts each switch where a text renderer would leave it", () => {
    panel();
    open();
    // A ligature is set without being asked for; a stylistic set is not.
    expect(screen.getByLabelText<HTMLInputElement>("liga").checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("ss01").checked).toBe(false);
  });

  it("switches a stylistic set on", () => {
    const { onChange } = panel();
    open();
    fireEvent.click(screen.getByLabelText("ss01"));
    expect(onChange).toHaveBeenCalledWith({ ...READ_FROM_TEXT, features: { ss01: true } });
  });

  it("switches off one a renderer would apply", () => {
    const { onChange } = panel();
    open();
    fireEvent.click(screen.getByLabelText("liga"));
    expect(onChange).toHaveBeenCalledWith({ ...READ_FROM_TEXT, features: { liga: false } });
  });

  it("forgets a switch put back where it started", () => {
    // Kept as differences, so a feature at its default is not written down —
    // and a font whose defaults change later is followed rather than pinned.
    const { onChange } = panel({ ...READ_FROM_TEXT, features: { ss01: true } });
    open();
    fireEvent.click(screen.getByLabelText("ss01"));
    expect(onChange).toHaveBeenCalledWith({ ...READ_FROM_TEXT, features: {} });
  });

  it("puts every switch back at once", () => {
    const { onChange } = panel({ ...READ_FROM_TEXT, features: { ss01: true, liga: false } });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenCalledWith({ ...READ_FROM_TEXT, features: {} });
  });

  it("greys the switches out when the font's features are off altogether", () => {
    panel(READ_FROM_TEXT, { applyFeatures: false });
    open();
    expect(screen.getByLabelText<HTMLInputElement>("ss01").disabled).toBe(true);
  });

  it("turns the font's rules on and off from the first row", () => {
    const { onApplyFeaturesChange } = panel(READ_FROM_TEXT, { applyFeatures: false });
    open();
    fireEvent.click(screen.getByLabelText("Apply the font's features"));
    expect(onApplyFeaturesChange).toHaveBeenCalledWith(true);
  });

  it("is not offered at all for a font with nothing to shape", () => {
    panel(READ_FROM_TEXT, { canShape: false });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Features" }).disabled).toBe(true);
  });
});

describe("the controls in the bar", () => {
  function controls(value = READ_FROM_TEXT) {
    const onChange = vi.fn<(next: typeof READ_FROM_TEXT) => void>();
    const onApplyFeaturesChange = vi.fn<(next: boolean) => void>();
    render(
      <TextSettingsControls
        value={value}
        document={mixed()}
        applyFeatures
        canShape
        onChange={onChange}
        onApplyFeaturesChange={onApplyFeaturesChange}
      />,
    );
    return { onChange, onApplyFeaturesChange };
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
    const chosen = controls({ direction: "rtl", script: "arab", language: "ARA", features: {} });
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: "" } });
    expect(chosen.onChange).toHaveBeenLastCalledWith({
      direction: "rtl",
      script: null,
      language: "ARA",
      features: {},
    });
  });

  it("offers no language to choose for a font whose file names none", () => {
    const onChange = vi.fn<(next: typeof READ_FROM_TEXT) => void>();
    render(
      <TextSettingsControls
        value={READ_FROM_TEXT}
        document={fontDocument([glyph("a", { unicodes: [0x61] })])}
        applyFeatures
        canShape
        onChange={onChange}
        onApplyFeaturesChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Language").disabled).toBe(true);
  });
});
