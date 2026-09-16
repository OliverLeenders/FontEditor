import type {
  Axis,
  AxisMap,
  KeptXml,
  Location,
  Rule,
  RuleCondition,
  RulesProcessing,
} from "@typewright/font-model";
import { axis as makeAxis, toDesign, toUser } from "@typewright/font-model";

import {
  type XmlElement,
  childNamed,
  childrenNamed,
  isElement,
  parseXml,
  writeXml,
} from "./xml.js";

/**
 * The file that ties several UFOs together into one design.
 *
 * A UFO is one master and knows nothing of the others. A `.designspace` is the
 * document that says what the axes are, which files sit where on them, and what
 * instances to make in between — and it is the file every build pipeline in the
 * type world is handed. Without it a family is a folder of unrelated fonts.
 *
 * Written to version 4.1, which is what fontmake, fontTools and every editor
 * read, unless the file came in as something later: then its version is kept,
 * along with everything in it this editor does not read — labels, a `lib`, the
 * variable fonts a version 5 file describes, the PostScript names of an
 * instance. Those are carried as the XML they were written as and put back
 * where they were, which is the rule the UFO reader already follows.
 *
 * What is read: the axes with their maps and stops, the sources — including a
 * source that is one layer of another's UFO — the instances, and the rules.
 *
 * Two details worth knowing before reading either half. A location in this
 * file names its axes by *name*, not by tag — `<dimension name="Weight" …/>`,
 * never `wght`; the tags are in the axis definitions and nowhere else. And an
 * axis's minimum, default and maximum are on the *user* scale, where locations
 * and conditions are on the *design* scale; the model keeps everything on the
 * design scale, so the axis's three numbers go through its map on the way in
 * and back through it on the way out.
 */

/** One master, as the designspace refers to it. */
export type Source = {
  /** The `.ufo` this source is, relative to the designspace file. */
  readonly filename: string;
  readonly name: string;
  readonly familyName: string;
  readonly styleName: string;
  readonly location: Location;
  /** The layer of that UFO the source is, for a source that draws only some glyphs. */
  readonly layer?: string;
  readonly kept?: KeptXml;
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
  readonly kept?: KeptXml;
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
  readonly rules?: readonly Omit<Rule, "id">[];
  readonly rulesProcessing?: RulesProcessing;
  /**
   * The file's own attributes and the top-level elements nobody here reads.
   *
   * The attributes of `<axes>` are kept among them under an `axes:` prefix, as
   * the one place a version 5 file says something about the axes as a whole.
   */
  readonly kept?: KeptXml;
};

/** What the file is called, given a family name. */
export const designspaceFileName = (family: string): string =>
  `${family.replace(/[^A-Za-z0-9]/g, "") || "Untitled"}.designspace`;

/** The elements the reader understands, which are not carried as kept XML. */
const READ_AT_TOP = new Set(["axes", "sources", "instances", "rules"]);
const AXES_PREFIX = "axes:";

/**
 * Write a designspace.
 *
 * The first source is marked as the one the family's information and lib come
 * from, unless the file this came from said which itself. Somebody has to be,
 * the format says so explicitly, and a build that has to guess picks
 * differently from the editor that wrote it.
 */
export function designspaceXml(designspace: Designspace): string {
  const kept = designspace.kept;
  const rootAttributes = Object.entries(kept?.attributes ?? {}).filter(
    ([key]) => !key.startsWith(AXES_PREFIX) && key !== "format",
  );
  const axesAttributes = Object.entries(kept?.attributes ?? {})
    .filter(([key]) => key.startsWith(AXES_PREFIX))
    .map(([key, value]) => [key.slice(AXES_PREFIX.length), value] as const);
  const format = kept?.attributes["format"] ?? "4.1";

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<designspace format="${escapeXml(format)}"${attributesOf(rootAttributes)}>`,
    `\t<axes${attributesOf(axesAttributes)}>`,
  ];

  for (const a of designspace.axes) lines.push(...axisLines(a));
  lines.push("\t</axes>");

  const byTag = new Map(designspace.axes.map((a) => [a.tag, a]));
  const rules = designspace.rules ?? [];
  if (rules.length > 0) {
    const processing = designspace.rulesProcessing === "last" ? ' processing="last"' : "";
    lines.push(`\t<rules${processing}>`);
    for (const r of rules) lines.push(...ruleLines(r, byTag));
    lines.push("\t</rules>");
  }

  lines.push("\t<sources>");
  // A file that was read says which source to copy from in its own words, or
  // chose not to; only a family that was never a file is given the mark.
  const saysWhichCopies =
    kept !== undefined ||
    designspace.sources.some((s) => s.kept?.children.some((c) => c.startsWith("<info")));
  for (const [i, source] of designspace.sources.entries()) {
    const layer = source.layer === undefined ? "" : ` layer="${escapeXml(source.layer)}"`;
    lines.push(
      `\t\t<source filename="${escapeXml(source.filename)}" name="${escapeXml(source.name)}"` +
        ` familyname="${escapeXml(source.familyName)}" stylename="${escapeXml(source.styleName)}"` +
        `${layer}${attributesOf(Object.entries(source.kept?.attributes ?? {}))}>`,
    );
    // The family's information comes from one source, and the format wants to
    // be told which rather than left to choose. A file that said so already is
    // left to say it in its own words.
    if (i === 0 && !saysWhichCopies && source.layer === undefined) {
      lines.push('\t\t\t<info copy="1"/>', '\t\t\t<lib copy="1"/>');
    }
    lines.push(...indented(source.kept?.children ?? [], "\t\t\t"));
    lines.push(...locationLines(designspace.axes, source.location, "\t\t\t"), "\t\t</source>");
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
          ` filename="${escapeXml(it.filename)}"` +
          `${attributesOf(Object.entries(it.kept?.attributes ?? {}))}>`,
        ...locationLines(designspace.axes, it.location, "\t\t\t"),
        ...indented(it.kept?.children ?? [], "\t\t\t"),
        "\t\t</instance>",
      );
    }
    lines.push("\t</instances>");
  }

  lines.push(...indented(kept?.children ?? [], "\t"));
  lines.push("</designspace>", "");
  return lines.join("\n");
}

function axisLines(a: Axis): string[] {
  const user = (value: number): string => number(toUser(a, value));
  const range =
    a.values === undefined
      ? ` minimum="${user(a.min)}" maximum="${user(a.max)}" default="${user(a.default)}"`
      : ` values="${a.values.map(user).join(" ")}" default="${user(a.default)}"`;
  const head =
    `\t\t<axis tag="${escapeXml(a.tag)}" name="${escapeXml(a.name)}"${range}` +
    attributesOf(Object.entries(a.kept?.attributes ?? {}));

  const children = [
    ...(a.map ?? []).map(
      ([input, output]) => `\t\t\t<map input="${number(input)}" output="${number(output)}"/>`,
    ),
    ...indented(a.kept?.children ?? [], "\t\t\t"),
  ];
  return children.length === 0 ? [`${head}/>`] : [`${head}>`, ...children, "\t\t</axis>"];
}

function ruleLines(r: Omit<Rule, "id">, byTag: ReadonlyMap<string, Axis>): string[] {
  const lines = [
    `\t\t<rule name="${escapeXml(r.name)}"${attributesOf(Object.entries(r.kept?.attributes ?? {}))}>`,
  ];
  for (const set of r.conditionSets) {
    lines.push("\t\t\t<conditionset>");
    for (const c of set) {
      const name = byTag.get(c.tag)?.name ?? c.tag;
      const min = c.min === null ? "" : ` minimum="${number(c.min)}"`;
      const max = c.max === null ? "" : ` maximum="${number(c.max)}"`;
      lines.push(`\t\t\t\t<condition name="${escapeXml(name)}"${min}${max}/>`);
    }
    lines.push("\t\t\t</conditionset>");
  }
  for (const [from, to] of r.swaps) {
    lines.push(`\t\t\t<sub name="${escapeXml(from)}" with="${escapeXml(to)}"/>`);
  }
  lines.push(...indented(r.kept?.children ?? [], "\t\t\t"), "\t\t</rule>");
  return lines;
}

function locationLines(axes: readonly Axis[], location: Location, indent: string): string[] {
  return [
    `${indent}<location>`,
    ...axes.map((a) => {
      const value = location[a.tag] ?? a.default;
      return `${indent}\t<dimension name="${escapeXml(a.name)}" xvalue="${number(value)}"/>`;
    }),
    `${indent}</location>`,
  ];
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

  const axesElement = childNamed(root, "axes");
  const axes = readAxes(axesElement);
  // By name, because that is how a location refers to them.
  const byName = new Map(axes.map((a) => [a.name, a]));

  const sources: Source[] = [];
  for (const element of childrenNamed(childNamed(root, "sources") ?? empty(), "source")) {
    const filename = element.attributes["filename"];
    if (filename === undefined || filename === "") continue;

    const familyName = element.attributes["familyname"] ?? "";
    const styleName = element.attributes["stylename"] ?? "";
    const layer = element.attributes["layer"];
    sources.push({
      filename,
      name: element.attributes["name"] ?? `${familyName} ${styleName}`.trim(),
      familyName,
      styleName,
      location: readLocation(childNamed(element, "location"), byName),
      ...(layer === undefined ? {} : { layer }),
      ...keptOf(element, ["filename", "name", "familyname", "stylename", "layer"], ["location"]),
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
      ...keptOf(element, ["familyname", "stylename", "filename"], ["location"]),
    });
  }

  const rulesElement = childNamed(root, "rules");
  const rules = rulesElement === null ? [] : readRules(rulesElement, byName);

  // The file's version and the rest of what it said, for writing back.
  const attributes: Record<string, string> = { ...root.attributes };
  for (const [key, value] of Object.entries(axesElement?.attributes ?? {})) {
    attributes[`${AXES_PREFIX}${key}`] = value;
  }
  const children = [
    ...root.children.filter((c) => isElement(c) && !READ_AT_TOP.has(c.name)),
    // What sits inside `<axes>` beside the axes — a version 5.1 file's second
    // set of maps — has nowhere of its own to go, and is kept at the top.
    ...(axesElement?.children ?? []).filter((c) => isElement(c) && c.name !== "axis"),
  ].map((c) => writeXml(c as XmlElement));

  return {
    axes,
    sources,
    instances,
    ...(rulesElement === null
      ? {}
      : {
          rules,
          rulesProcessing: rulesElement.attributes["processing"] === "last" ? "last" : "first",
        }),
    kept: { attributes, children },
  };
}

function readAxes(element: XmlElement | null): Axis[] {
  if (element === null) return [];

  const out: Axis[] = [];
  for (const a of childrenNamed(element, "axis")) {
    const tag = a.attributes["tag"];
    if (tag === undefined || tag === "") continue;

    const map: [number, number][] = [];
    for (const m of childrenNamed(a, "map")) {
      const input = number0(m.attributes["input"]);
      const output = number0(m.attributes["output"]);
      if (input !== null && output !== null) map.push([input, output]);
    }
    const mapped = map.length === 0 ? undefined : (map as AxisMap);
    // The range is on the user scale in the file and on the design scale in the
    // model, so it goes through the map before anything else sees it.
    const design = (user: number): number =>
      mapped === undefined ? user : toDesign({ ...makeAxis(tag, "", 0, 0, 0), map: mapped }, user);

    const stops = a.attributes["values"]
      ?.trim()
      .split(/\s+/)
      .map(number0)
      .filter((v): v is number => v !== null);
    const discrete = stops !== undefined && stops.length > 0;

    const value = number0(a.attributes["default"]) ?? (discrete ? (stops[0] ?? 0) : 0);
    const min = discrete ? Math.min(...stops) : (number0(a.attributes["minimum"]) ?? value);
    const max = discrete ? Math.max(...stops) : (number0(a.attributes["maximum"]) ?? value);

    const read = makeAxis(
      tag,
      a.attributes["name"] ?? tag,
      design(min),
      design(value),
      design(max),
    );
    out.push({
      ...read,
      ...(mapped === undefined ? {} : { map: mapped }),
      ...(discrete ? { values: stops.map(design) } : {}),
      ...keptOf(a, ["tag", "name", "minimum", "maximum", "default", "values"], ["map"]),
    });
  }
  return out;
}

function readRules(element: XmlElement, byName: ReadonlyMap<string, Axis>): Omit<Rule, "id">[] {
  const out: Omit<Rule, "id">[] = [];
  for (const r of childrenNamed(element, "rule")) {
    // Conditions straight under the rule are the older way of writing one set,
    // and fontTools still reads them as one.
    const loose = childrenNamed(r, "condition");
    const sets = [
      ...childrenNamed(r, "conditionset").map((set) => readConditions(set, byName)),
      ...(loose.length === 0 ? [] : [readConditions(r, byName)]),
    ];

    const swaps: [string, string][] = [];
    for (const sub of childrenNamed(r, "sub")) {
      const from = sub.attributes["name"];
      const to = sub.attributes["with"];
      if (from !== undefined && to !== undefined) swaps.push([from, to]);
    }

    out.push({
      name: r.attributes["name"] ?? "",
      conditionSets: sets,
      swaps,
      ...keptOf(r, ["name"], ["conditionset", "condition", "sub"]),
    });
  }
  return out;
}

function readConditions(element: XmlElement, byName: ReadonlyMap<string, Axis>): RuleCondition[] {
  const out: RuleCondition[] = [];
  for (const c of childrenNamed(element, "condition")) {
    const axis = byName.get(c.attributes["name"] ?? "");
    if (axis === undefined) continue;
    out.push({
      tag: axis.tag,
      min: number0(c.attributes["minimum"]),
      max: number0(c.attributes["maximum"]),
    });
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
    // read past rather than half-honoured. A version 5 file may give the place
    // on the user scale instead, which is put through the map.
    const value = number0(dimension.attributes["xvalue"]);
    const user = number0(dimension.attributes["uservalue"]);
    if (value !== null) at[axis.tag] = value;
    else if (user !== null) at[axis.tag] = toDesign(axis, user);
  }
  return at;
}

/**
 * The attributes and child elements of an element that the reader did not
 * take, or nothing where there are none — so a file without any reads back
 * exactly as the same value it was written from.
 */
function keptOf(
  element: XmlElement,
  readAttributes: readonly string[],
  readChildren: readonly string[],
): { kept?: KeptXml } {
  const attributes = Object.fromEntries(
    Object.entries(element.attributes).filter(([key]) => !readAttributes.includes(key)),
  );
  const children = element.children
    .filter((c): c is XmlElement => isElement(c) && !readChildren.includes(c.name))
    .map((c) => writeXml(c));

  if (Object.keys(attributes).length === 0 && children.length === 0) return {};
  return { kept: { attributes, children } };
}

/** Kept XML, each line of it moved in to where it now sits. */
function indented(children: readonly string[], indent: string): string[] {
  return children.flatMap((child) => child.split("\n").map((line) => `${indent}${line}`));
}

function attributesOf(entries: readonly (readonly [string, string])[]): string {
  return entries.map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join("");
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
