import {
  FIRST_PROJECT,
  type ProjectRecord,
  dropProject,
  listProjects,
  newProject,
  openProjects,
  projectById,
  saveProject,
  touchProject,
} from "@typewright/disk";

import { deleteWorkingCopy, forgottenCopies, workingCopies } from "@typewright/storage";

import { takeWindowRequest } from "../windows.js";
import { confirmSaved, noteFolder } from "./folder.js";
import type { FontHost } from "./fonts.js";
import type { ProjectSummary } from "./state.js";

/**
 * Which font is open, and which others there are to open.
 *
 * The editor opens one font at a time — one working copy, one write lock, one
 * folder — so this is not a workspace of several open documents. It is the
 * question asked once, on the way in: which of them.
 *
 * Everything here is about *choosing*. What happens after the choice is the
 * same code that has always run, with a name passed to it.
 */

export function summaryOf(project: ProjectRecord): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    folder: project.folder?.name ?? null,
    openedAt: project.openedAt,
    savedAt: project.savedAt,
  };
}

/**
 * What to do on the way in.
 *
 * `open` is a font to open straight away; `choose` is a list to put in front of
 * the reader first. The list comes first every time the program starts, one
 * font or several — it is the program's front door, not a question reserved
 * for when there is a choice to make. Only a reader who has said they would
 * rather go straight in skips it.
 */
export type Arrival =
  | { readonly kind: "open"; readonly id: string }
  | { readonly kind: "choose"; readonly all: readonly ProjectSummary[] };

/**
 * Decide what the editor does with its first moment.
 *
 * Called before storage is opened, which is what makes choosing free: nothing
 * has been loaded, no lock has been taken, so picking any of them costs the
 * same as picking the first. That is only true here — see `switchTo`, which has
 * a font open already and cannot simply change its mind.
 */
export async function arrive(skipChooser: boolean): Promise<Arrival> {
  let all = await openProjects();

  // No record of anything: a browser that has never opened a font, or work done
  // before projects existed that was never saved to a folder. Either way there
  // is one working copy the editor has always looked in, and it may hold a
  // font — so it is listed rather than left where only an empty list would be
  // shown, and "New font" the only way forward past somebody's own work.
  if (all.length === 0) {
    const untitled: ProjectRecord = { ...newProject(UNTITLED), id: FIRST_PROJECT };
    await saveProject(untitled);
    all = [untitled];
  }

  if (skipChooser) return { kind: "open", id: all[0]!.id };
  return { kind: "choose", all: all.map(summaryOf) };
}

/** What the working copy is called before anything has said what it holds. */
const UNTITLED = "Untitled font";

/**
 * Note in the store which font is open, and what else there is.
 *
 * And point the editor at that font's folder. This is where the folder comes
 * from now: the single remembered handle said which folder the editor was last
 * in, which was the same question as which font, and is not any more.
 */
export async function noteProjects(host: FontHost, current: string | null): Promise<void> {
  const all = await listProjects();
  host.patch({
    projects: { all: all.map(summaryOf), current, showing: false, arriving: false },
  });
  if (current === null) return;

  await touchProject(current);

  const project = all.find((it) => it.id === current) ?? null;
  if (project === null) return;

  // Called by what the font calls itself, now that it is loaded. A record made
  // before anything was read has only a placeholder, and a family renamed in
  // Font Info should not go on being listed under its old name.
  const { familyName, styleName } = host.state().session.editor.document.info;
  const named = `${familyName} ${styleName}`.trim();
  if (named !== "" && named !== project.name) {
    await saveProject({ ...project, name: named, openedAt: Date.now() });
    host.patch({
      projects: {
        ...host.state().projects,
        all: host
          .state()
          .projects.all.map((it) => (it.id === current ? { ...it, name: named } : it)),
      },
    });
  }

  if (project.folder === null) return;

  // Linked, not read: reading would replace the font recovered from the working
  // copy with whatever is on disk, which is a decision rather than something to
  // do to somebody at startup.
  await noteFolder(host, {
    folder: project.folder,
    name: project.folder.name,
    at: project.savedAt ?? 0,
    wrote: project.wrote,
  });
  await confirmSaved(host, project.savedHash);
}

/** Put the chooser on screen, or take it away. */
export function showChooser(host: FontHost, showing: boolean): void {
  host.patch({ projects: { ...host.state().projects, showing } });
}

/**
 * Open a different font.
 *
 * By reloading, which is not a dodge. A font is a working copy, a write lock, a
 * worker holding both, an autosave timer mid-flight and a document the whole
 * interface is built over; swapping every one of those in place is a great deal
 * of machinery to get subtly wrong, and the thing it would buy is half a second
 * once in a while. A reload releases the lock by ending the tab that held it,
 * and the editor's ordinary startup then does exactly what it does every other
 * time.
 *
 * The choice is left where startup will look for it.
 */
export function switchTo(id: string): void {
  try {
    localStorage.setItem(CHOSEN, id);
  } catch {
    // A private window, or storage switched off. The reload then opens the most
    // recent font, which is very nearly always the one just asked for anyway.
  }
  location.reload();
}

const CHOSEN = "typewright.project";

/**
 * The font a reload was asked to open, if it was asked for one.
 *
 * Read once and cleared, because it is an instruction for this startup rather
 * than a setting. A font that has since been forgotten is ignored rather than
 * opened into nothing.
 */
export async function chosenOnReload(): Promise<string | null> {
  const id = taken();
  if (id === null) return null;

  return (await projectById(id)) === null ? null : id;
}

/**
 * What the window was opened to show, when it was opened for something.
 *
 * A window opened on a font goes straight into it, and one opened on the list
 * shows the list whatever the reader has said about skipping it — the list is
 * what it was asked for. A font forgotten in another window between the asking
 * and the opening gives the list rather than an empty editor.
 */
export async function requestedArrival(): Promise<Arrival | null> {
  const request = takeWindowRequest();
  if (request === null) return null;
  if (request !== "fonts" && (await projectById(request.font)) !== null) {
    return { kind: "open", id: request.font };
  }
  return await arrive(false);
}

/** Read the instruction and clear it, or nothing if storage will not play. */
function taken(): string | null {
  try {
    const id = localStorage.getItem(CHOSEN);
    if (id !== null) localStorage.removeItem(CHOSEN);
    return id;
  } catch {
    return null;
  }
}

/** Start a font with no folder yet, and open it. */
export async function startProject(name: string): Promise<void> {
  const project = newProject(name);
  await saveProject(project);
  switchTo(project.id);
}

/**
 * Forget a font: take it off the list, and delete Typewright's copy of it.
 *
 * The folder on disk is never touched. The working copy goes with the record,
 * because a copy nothing will ever open again is not being kept, only left —
 * and the chooser asks first, in words that say which of the two a font is: one
 * whose folder has it, or one whose working copy is the only copy there is.
 *
 * Never the font that is open, whose copy is being written to as this runs. And
 * a copy another window has open is left for that window: the record is gone,
 * so the next start sweeps it up once nothing holds it.
 */
export async function forgetProject(host: FontHost, id: string): Promise<void> {
  if (id === host.state().projects.current) return;

  await dropProject(id);
  await deleteWorkingCopy(id);
  const all = await listProjects();
  host.patch({ projects: { ...host.state().projects, all: all.map(summaryOf) } });
}

/**
 * Delete the working copies no font refers to.
 *
 * Left by a font forgotten while another window had it open, or forgotten
 * before forgetting deleted anything. Run once, on the way in.
 *
 * Only when the list of fonts could be read and has something in it. By the
 * time this runs there is always at least one — the way in makes sure of it —
 * so an empty list means the list could not be read, and "no font refers to
 * this copy" would then be true of every copy there is.
 */
export async function sweepForgotten(): Promise<void> {
  const known = new Set((await listProjects()).map((it) => it.id));
  if (known.size === 0) return;

  for (const name of forgottenCopies(await workingCopies(), known)) {
    await deleteWorkingCopy(name);
  }
}
