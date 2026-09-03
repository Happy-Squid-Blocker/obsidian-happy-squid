import { type App, TFile } from "obsidian";
import { insertTaskBelow } from "./note-context";
import { type TasksToggle, tickTaskLine } from "./task-line";

/** Tasks' own plugin id, and the only string in this file that names it. */
const TASKS_PLUGIN_ID = "obsidian-tasks-plugin";

/**
 * Tasks' own toggle, when Tasks is in the vault.
 *
 * Our edit could only ever write the box. For a `🔁` line, Tasks also writes the
 * next occurrence; without this, pressing Finish in Happy Squid quietly deleted
 * a recurring task by finishing it in the wrong app. task-line.ts deliberately
 * removes Tasks' completion date before the note is written, so this integration
 * does not replace main's checkbox-only completion UI.
 *
 * `apiV1.executeToggleTaskDoneCommand(line, path)` is synchronous, returns the
 * line or lines that should stand in its place, and deliberately touches no
 * file: only the caller knows how it wants to save. It exists because Kanban had
 * exactly this problem first.
 *
 * Feature-detected down to the method, and undefined when Tasks is absent or has
 * changed shape — which is this codebase's house rule for exactly this: never
 * branch on whether a neighbour is installed, ask whether the call is there.
 */
function tasksToggle(app: App, notePath: string): TasksToggle | undefined {
  const api = (
    app as unknown as {
      plugins?: { plugins?: Record<string, { apiV1?: { executeToggleTaskDoneCommand?: unknown } }> };
    }
  ).plugins?.plugins?.[TASKS_PLUGIN_ID]?.apiV1;
  const toggle = api?.executeToggleTaskDoneCommand;
  if (typeof toggle !== "function") return undefined;
  // The path is Tasks' own second argument and it is the note we are about to
  // write, never a placeholder: it is how Tasks knows where the task lives.
  return (line: string) => (toggle as (l: string, p: string) => string).call(api, line, notePath);
}

/**
 * Ticking the checkbox when the task was finished in Happy Squid.
 *
 * The other half of "stop task": pressing Finish in Happy Squid's own UI ends
 * the task, and the note it came from should say so. Todoist gets that over the
 * wire because Todoist owns its data; a vault is files on disk, so the only
 * thing that can write the tick is the plugin, and it does so the next time it
 * looks. That is what makes this survive Obsidian being shut when the task
 * finished — the outcome sits on the intent row until somebody reads it, where a
 * webhook nobody was listening for would simply have been lost.
 *
 * Matched by the task's own WORDS and the marker, never by line number: notes
 * get edited and reordered between the task starting and finishing.
 *
 * Idempotent by construction. A ticked line no longer parses as unchecked, so a
 * second pass over the same completed row finds nothing to do — which matters,
 * because the row goes on saying `completed` for as long as it is read.
 *
 * `vault.process` rather than a read followed by a write, as `writeRewrite`
 * below and the template unwrap already do: it is a read-modify-write under
 * the vault's own lock, so an edit landing in between cannot be lost, and it
 * is the way Obsidian's own guidelines ask a plugin to edit a note it is not
 * showing. Nothing is written when there is no line to tick.
 */
export async function tickCompleted(app: App, notePath: string, title: string): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(notePath);
  if (!(file instanceof TFile)) return false;
  const toggle = tasksToggle(app, notePath);
  let ticked = false;
  await app.vault.process(file, (text) => {
    const next = tickThrough(text, title, toggle);
    ticked = next !== null;
    return next ?? text;
  });
  return ticked;
}

/**
 * Writing the squid's own wording of a task under the line it came from.
 *
 * The FOURTH thing the plugin writes into a note, and the one that writes words
 * the user did not (Anton, 2026-09-02). A task the productivity check refused
 * and the user argued for can come back with the model's own description
 * (`{tool:productive: …}`), and the task then runs under THOSE words while the
 * note still holds the user's — so the marker keyed by the note's words never
 * reads "stop task", and the completion never finds a line to tick. Rewriting
 * the user's line would be invasive, so the new wording goes on a NEW line
 * beneath the imprecise one, drawn "stop task" from the moment it lands.
 *
 * `vault.process` rather than read-then-write, as the template unwrap does, so
 * an edit landing in between cannot be lost — and nothing is written at all
 * when the line is already there, which is what makes a second vault reading
 * the same account (a synced vault on a phone) safe to run beside this one.
 */
export async function writeRewrite(app: App, notePath: string, sourceTaskId: string, title: string): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(notePath);
  if (!(file instanceof TFile)) return false;
  let written = false;
  await app.vault.process(file, (text) => {
    const next = insertTaskBelow(text, notePath, sourceTaskId, title);
    written = next !== null;
    return next ?? text;
  });
  return written;
}

/**
 * The tick, with our own edit standing behind Tasks'.
 *
 * A neighbour's API is somebody else's code running inside our write path, and
 * the worst thing it could do here is leave the box unticked because it threw.
 * So a throw falls back to the plain edit rather than up to the caller: the
 * completion still lands, and only the recurrence is lost.
 */
function tickThrough(text: string, title: string, toggle: TasksToggle | undefined): string | null {
  if (!toggle) return tickTaskLine(text, title);
  try {
    return tickTaskLine(text, title, toggle);
  } catch (e) {
    console.warn("[happy-squid] Tasks refused to toggle a line; ticking it ourselves", e);
    return tickTaskLine(text, title);
  }
}
