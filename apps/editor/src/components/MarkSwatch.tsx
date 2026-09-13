import { markColorCss } from "@typewright/render";

import { Glyph, type IconComponent } from "./icons.js";

/**
 * A mark colour drawn as a menu icon: a rounded square filled with it.
 *
 * Made once per colour and kept. A menu item's icon is a component, and a new
 * one on every render would be a new element type on every render — which
 * remounts the icon each time the menu draws.
 */
const made = new Map<string, IconComponent>();

export function markSwatch(value: string): IconComponent {
  const known = made.get(value);
  if (known !== undefined) return known;

  const fill = markColorCss(value) ?? "none";
  const Swatch: IconComponent = () => (
    <Glyph>
      <rect x="4" y="4" width="16" height="16" rx="4" fill={fill} strokeWidth={1.5} />
    </Glyph>
  );
  made.set(value, Swatch);
  return Swatch;
}
