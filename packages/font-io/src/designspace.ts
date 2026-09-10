import type { Axis, Location } from "@typewright/font-model";
import { axis as makeAxis } from "@typewright/font-model";

import { type XmlElement, childNamed, childrenNamed, parseXml } from "./xml.js";

/**
 * The file that ties several UFOs together into one design.
 *
 * A UFO is one master and knows nothing of the others. A `.designspace` is the
 * document that says what the axes are, which files sit where on them, and what
 * instances to make in between — and it is the file every build pipeline in the
 * type world is handed. Without it a family is a folder of unrelated fonts.
 *
 * Written to version 4.1, which is what fontmake, fontTools and every editor
 * read. Version 5 adds discrete axes and variable-font definitions, and nothing
 * here has anything to say with them yet.
 *
 * One detail worth knowing before reading either half: a location in this file
 * names its axes by *name*, not by tag — `<dimension name="Weight" .../>`,
 * never `wght`. The tags are in the axis definitions and nowhere else.
 */

/** One master, as the designspace refers to it. */
export type Source = {
  /** The `.ufo` this source is, relative to the designspace file. */
  readonly filename: string;
  readonly name: string;
  readonly familyName: string;
  readonly styleName: string;
  readonly location: Location;
};

/**
 * One instance, as the designspace asks for it.
 *
 * A style the family is meant to have at a place between the sources. There is
 * nothing to draw in one — the shapes are worked out — so it is a name, a
 * family, a location, and the file it would be built as.
 */
export type DesignspaceInstance = {
  readonly familyName: string;
  readonly styleName: string;
  readonly location: Location;
  /** Where a build would put it, which is the convention every pipeline uses. */
  readonly filename: string;
};

export type Designspace = {
  readonly axes: readonly Axis[];
  readonly sources: readonly Source[];
  /**
   * The styles asked for between the sources.
   *
   * Empty is ordinary and is not the same as "none worth naming": a family with
   * no instances builds a variable font whose style menu offers its corners.
   */
  readonly instances: readonly DesignspaceInstance[];
};

/** What the file is called, given a family name. */
export const designspaceFileName = (family: string): string =>
  `${family.replace(/[^A-Za-z0-9]/g, "") || "Untitled"}.designspace`;

/**
 * Write a designspace.
 *
 * The first source is marked as the one the family's information and lib come
 * from. Somebody has to be, the format says so explicitly, and a build that has
 * to guess picks differently from the editor that wrote it.
 */
export function designspaceXml(designspace: Designspace): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<designspace format="4.1">',
    "\t<axes>",
  ];

  for (const a of designspace.axes) {
    lines.push(
      `\t\t<axis tag="${escapeXml(a.tag)}" name="${escapeXml(a.name)}"` +
        ` minimum="${number(a.min)}" maximum="${number(a.max)}" default="${number(a.default)}"/>`,
    );
  }

  lines.push("\t</axes>", "\t<sources>");

  for (const [i, source] of designspace.sources.entries()) {
    lines.push(
      `\t\t<source filename="${escapeXml(source.filename)}" name="${escapeXml(source.name)}"` +
        ` familyname="${escapeXml(source.familyName)}" stylename="${escapeXml(source.styleName)}">`,
    );
    // The family's information comes from one source, and the format wants to
    // be told which rather than left to choose.
    if (i === 0) lines.push('\t\t\t<info copy="1"/>', '\t\t\t<lib copy="1"/>');

    lines.push("\t\t\t<location>");
    for (const a of designspace.axes) {
      const value = source.location[a.tag] ?? a.default;
      lines.push(`\t\t\t\t<dimension name="${escapeXml(a.name)}" xvalue="${number(value)}"/>`);
    }
    lines.push("\t\t\t</location>", "\t\t</source>");
  }

  lines.push("\t</sources>");

  // The instances, where there are any. An empty `<instances/>` is legal and
  // says the same thing as no element at all, so the shorter of the two is
  // written: a file should not carry a section to announce that it is empty.
  if (designspace.instances.length > 0) {
    lines.push("\t<instances>");
    for (const it of designspace.instances) {
      lines.push(
        `\t\t<instance familyname="${escapeXml(it.familyName)}"` +
          ` stylename="${escapeXml(it.styleName)}"` +
          ` filename="${escapeXml(it.filename)}">`,
        "\t\t\t<location>",
      );
      for (const a of designspace.axes) {
        const value = it.location[a.tag] ?? a.default;
        lines.push(`\t\t\t\t<dimension name="${escapeXml(a.name)}" xvalue="${number(value)}"/>`);
      }
      lines.push("\t\t\t</location>", "\t\t</instance>");
    }
    lines.push("\t</instances>");
  }

  lines.push("</designspace>", "");
  return lines.join("\n");
}

/**
 * Read a designspace, or `null` where the text is not one.
 *
 * Forgiving in the same way the UFO reader is: a source with no filename is
 * skipped, a dimension naming an axis the file does not define is ignored, an
 * axis with no range takes its default at both ends. What stops the read is not
 * finding a designspace at all.
 */
export function parseDesignspace(source: string): Designspace | null {
  const root = parseXml(source);
  if (root === null || root.name !== "designspace") return null;

  const axes = readAxes(childNamed(root, "axes"));
  // By name, because that is how a location refers to them.
  const byName = new Map(axes.map((a) => [a.name, a]));

  const sources: Source[] = [];
  for (const element of childrenNamed(childNamed(root, "sources") ?? empty(), "source")) {
    const filename = element.attributes["filename"];
    if (filename === undefined || filename === "") continue;

    const familyName = element.attributes["familyname"] ?? "";
    const styleName = element.attributes["stylename"] ?? "";
    sources.push({
      filename,
      name: element.attributes["name"] ?? `${familyName} ${styleName}`.trim(),
      familyName,
      styleName,
      location: readLocation(childNamed(element, "location"), byName),
    });
  }

  const instances: DesignspaceInstance[] = [];
  for (const element of childrenNamed(childNamed(root, "instances") ?? empty(), "instance")) {
    const styleName = element.attributes["stylename"] ?? "";
    // A style with no name is a row nobody can pick from a menu, and naming it
    // for them would be inventing part of somebody's family.
    if (styleName === "") continue;

    instances.push({
      familyName: element.attributes["familyname"] ?? "",
      styleName,
      filename: element.attributes["filename"] ?? "",
      location: readLocation(childNamed(element, "location"), byName),
    });
  }

  return { axes, sources, instances };
}

function readAxes(element: XmlElement | null): Axis[] {
  if (element === null) return [];

  const out: Axis[] = [];
  for (const a of childrenNamed(element, "axis")) {
    const tag = a.attributes["tag"];
    if (tag === undefined || tag === "") continue;

    const value = number0(a.attributes["default"]) ?? 0;
    out.push(
      makeAxis(
        tag,
        a.attributes["name"] ?? tag,
        number0(a.attributes["minimum"]) ?? value,
        value,
        number0(a.attributes["maximum"]) ?? value,
      ),
    );
  }
  return out;
}

function readLocation(element: XmlElement | null, byName: ReadonlyMap<string, Axis>): Location {
  if (element === null) return {};

  const at: Record<string, number> = {};
  for (const dimension of childrenNamed(element, "dimension")) {
    const axis = byName.get(dimension.attributes["name"] ?? "");
    if (axis === undefined) continue;

    // `xvalue` is where the source is. `yvalue` belongs to the anisotropic
    // locations designspace allows for and nothing here can act on, so it is
    // read past rather than half-honoured.
    const value = number0(dimension.attributes["xvalue"]);
    if (value !== null) at[axis.tag] = value;
  }
  return at;
}

const empty = (): XmlElement => ({ name: "", attributes: {}, children: [] });

function number0(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Whole where it is whole, and short where it is not. */
const number = (n: number): string => String(Math.round(n * 1000) / 1000);

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
