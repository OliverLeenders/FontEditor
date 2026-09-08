/**
 * Every icon in the editor, from the two files that hold them.
 *
 * A barrel rather than a third set: what a caller wants is `<TrashIcon />`, not
 * to know whether it was drawn for the toolbar or for a panel.
 */
export { Glyph, type IconComponent } from "./icons/glyph.js";
export * from "./icons/tools.js";
export * from "./icons/interface.js";
