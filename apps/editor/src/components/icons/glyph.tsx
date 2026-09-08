/**
 * The one wrapper every icon in this app is drawn inside.
 *
 * Lucide's own box: 24 units, a 2-unit stroke, round ends, no fill, and colour
 * from `currentColor` — so an icon takes the colour of whatever button, row or
 * warning it sits in, in both themes, without being asked. Size comes from CSS
 * for the same reason: the control decides how big its own icon is.
 */
export function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export type IconComponent = () => React.JSX.Element;
