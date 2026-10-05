import type {
  exportFont,
  exportInstances,
  exportTrueType,
  exportVariableFont,
  exportVariableTrueType,
  glyphSvgFiles,
} from "@typewright/font-io/binary";
import type { FontDocument } from "@typewright/font-model";

/**
 * The exports that take time, as things that can be asked for by name.
 *
 * Every one of these joins the overlaps of every glyph on the way out, which
 * for a font of four thousand is the best part of half a minute. Done on the
 * page's own thread, that is half a minute of a window that will not scroll or
 * answer, and looks like one that has stopped. So they are done in a worker —
 * see `exporting.ts` — and a worker is sent words, not functions: which export,
 * and what it is given.
 *
 * Everything in a job is plain data. The model is, on purpose, and that is what
 * lets a document cross to another thread as it is.
 */
export type ExportJob =
  | { readonly kind: "otf"; readonly document: FontDocument }
  | { readonly kind: "ttf"; readonly document: FontDocument }
  | { readonly kind: "svgs"; readonly document: FontDocument }
  | { readonly kind: "variable"; readonly args: Parameters<typeof exportVariableFont> }
  | { readonly kind: "variableTtf"; readonly args: Parameters<typeof exportVariableTrueType> }
  | { readonly kind: "instances"; readonly args: Parameters<typeof exportInstances> };

/** What each comes back with. */
export type ExportOutcome<Job extends ExportJob> = Job extends { kind: "otf" }
  ? ReturnType<typeof exportFont>
  : Job extends { kind: "ttf" }
    ? ReturnType<typeof exportTrueType>
    : Job extends { kind: "svgs" }
      ? ReturnType<typeof glyphSvgFiles>
      : Job extends { kind: "variable" }
        ? ReturnType<typeof exportVariableFont>
        : Job extends { kind: "variableTtf" }
          ? ReturnType<typeof exportVariableTrueType>
          : Job extends { kind: "instances" }
            ? ReturnType<typeof exportInstances>
            : never;

/** How far it has got: glyphs done, of how many. */
export type Told = (done: number, total: number) => void;

/**
 * Do one, wherever this is running.
 *
 * The exporters are fetched here rather than imported above: they need a font
 * parser, which is a quarter of a megabyte the page does not carry until
 * somebody exports — see `@typewright/font-io/binary`.
 */
export async function runExport<Job extends ExportJob>(
  job: Job,
  told?: Told,
): Promise<ExportOutcome<Job>> {
  const binary = await import("@typewright/font-io/binary");
  const done = (out: unknown): ExportOutcome<Job> => out as ExportOutcome<Job>;
  const options = told === undefined ? {} : { progress: told };

  switch (job.kind) {
    case "otf":
      return done(binary.exportFont(job.document, undefined, options));
    case "ttf":
      return done(binary.exportTrueType(job.document, options));
    case "svgs":
      return done(binary.glyphSvgFiles(job.document));
    case "variable":
      return done(binary.exportVariableFont(...job.args));
    case "variableTtf":
      return done(binary.exportVariableTrueType(...job.args));
    case "instances":
      return done(binary.exportInstances(...job.args));
  }
}

/** What the page sends the worker: a job, and a number to answer it by. */
export type ExportRequest = { readonly id: number; readonly job: ExportJob };

/** What the worker says back: how far it has got, what it made, or that it could not. */
export type ExportReply =
  | { readonly id: number; readonly progress: { readonly done: number; readonly total: number } }
  | { readonly id: number; readonly made: unknown }
  | { readonly id: number; readonly failed: string };
