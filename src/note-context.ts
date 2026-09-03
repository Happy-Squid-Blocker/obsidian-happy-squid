import { findTaskLine, MARKER, parseTaskLine, taskIdFor } from "./task-line";

/**
 * Where a task sits in a note, in the shape the two AI calls already read.
 *
 * The Todoist twin of this file is `supabase/functions/_shared/todoist-task-context.ts`,
 * and it composes SERVER-side for the reason that is exactly reversed here: the
 * server is the only thing that can reach the Todoist API, and it is the one
 * thing that can never reach a vault. So the gathering is the plugin's, and what
 * crosses the wire is the two halves the user can never edit (`context` and
 * `notes`), kept apart from the one they can (the title) — see
 * `src/shared/source-task.ts` for why that split is what makes re-describing an
 * imported task work.
 *
 * A checkbox in a note is not a sentence either, it is a POSITION, and a note
 * gives four of the things Todoist gives:
 *
 *   Folder                   ← the project: the folders the user made
 *   Note                     ← the document, which is usually the project's name
 *   Heading                  ← the section: the `#`-chain above the line
 *   Parent task              ← the enclosing list item
 *   Parent task description  ← the parent's own continuation lines
 *
 * Deliberately free of Obsidian and CodeMirror imports, exactly as
 * `task-line.ts` is, so `src/tests/obsidian/` can hold it and it runs in
 * `npm run check` rather than behind a second test runner. Keep it importless
 * past this file's one sibling.
 */

/** The parent's notes are CONTEXT for the task, not the task, so they are cut
 *  hard — the Todoist reader's own reasoning and its own number. Both limits are
 *  pinned against it by note-context.test.ts: two sources whose blocks are read
 *  by one prompt should not disagree about how much of one is too much. */
export const PARENT_DESCRIPTION_LIMIT = 500;

/** The started item's own notes, which are the closest thing there is to the
 *  user saying what they mean to do. Three times the parent's allowance. */
export const STARTED_DESCRIPTION_LIMIT = 1500;

/** Said to the MODEL, never to the user, and word for word the Todoist one: it
 *  exists so a description that stops mid-sentence reads as cut rather than as
 *  all there was. */
const TRUNCATION_MARKER = "description has been truncated";

/** A tab is four columns. Obsidian's own default for list indentation, and the
 *  only thing that has to be true here is that it is CONSISTENT — every
 *  comparison below is between two lines of the same note, so a vault indenting
 *  with tabs nests the same way a vault indenting with spaces does. */
const TAB_WIDTH = 4;

/**
 * Any list item, ticked or plain, bulleted or numbered.
 *
 * The PARENT is matched with this rather than with `parseTaskLine`, so a task
 * under a plain `- Backend` bullet still knows where it sits. Structure is what
 * is being asked about, and a bullet holding checkboxes is structure whether or
 * not somebody put a box on it too.
 */
const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Cuts `text` to `limit` characters and says so. Whitespace is trimmed first,
 *  so a description that is only newlines drops out entirely rather than
 *  becoming a labelled empty line. */
function truncateDescription(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}… (${TRUNCATION_MARKER})`;
}

/** How far in a line starts, in columns. */
function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += TAB_WIDTH;
    else break;
  }
  return n;
}

/** The words of a list item, with its bullet, its checkbox and any marker gone.
 *  Null when the line is not a list item at all. */
function listItemTextOf(line: string): { indent: number; text: string } | null {
  const m = LIST_ITEM_RE.exec(line);
  if (!m) return null;
  return { indent: indentOf(line), text: line.slice(m[0].length).split(MARKER).join("").trim() };
}

/**
 * The continuation lines under the item on `index` — its description.
 *
 * Obsidian has no notes FIELD, so what stands in for one is its own convention:
 * the indented lines under a bullet that are not themselves bullets. That last
 * clause is the whole of the care here. Sweeping in nested list items would put
 * every sibling of the started task, and every task under them, into a block
 * that rides along on every monitoring judgment for as long as the task runs —
 * so the first list item ENDS the description, as does a blank line and as does
 * anything that has dedented back out of the item.
 *
 * Joined with a space rather than a newline: the block is read a labelled line
 * at a time, and a value that breaks over lines reads as new fields.
 */
function descriptionUnder(lines: string[], index: number, indent: number): string {
  const out: string[] = [];
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;
    if (indentOf(line) <= indent) break;
    if (LIST_ITEM_RE.test(line)) break;
    out.push(line.trim());
  }
  return out.join(" ");
}

/**
 * The nearest enclosing list item, or null when the task is already top-level.
 *
 * ONE parent, which is where this stops short of the nesting a note can express
 * (Anton, 2026-08-29). Todoist gives one and the block has one pair of lines for
 * it, so an ancestor chain would leave `Parent task description` not saying
 * which parent it belonged to — and every extra level is text on every page
 * check for hours.
 */
function parentOf(
  lines: string[],
  index: number,
  indent: number,
): { line: number; text: string; indent: number } | null {
  if (indent <= 0) return null;
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i];
    if (HEADING_RE.test(line)) return null;
    const item = listItemTextOf(line);
    if (!item) {
      // A non-empty line back at the margin is where this list began; anything
      // above it belongs to a different one.
      if (line.trim() && indentOf(line) === 0) return null;
      continue;
    }
    if (item.indent < indent) return { line: i, text: item.text, indent: item.indent };
  }
  return null;
}

/**
 * The `#`-chain above the line, outermost first — the Section analogue.
 *
 * A heading only counts as an ancestor if it is a LEVEL above the last one
 * taken, so `## Backend` then `## Frontend` then the task yields Frontend alone,
 * which is the one the task is actually under.
 */
function headingChain(lines: string[], index: number): string[] {
  const chain: string[] = [];
  let level = 7;
  for (let i = index - 1; i >= 0 && level > 1; i--) {
    const m = HEADING_RE.exec(lines[i]);
    if (!m || m[1].length >= level) continue;
    level = m[1].length;
    const text = m[2].trim();
    if (text) chain.unshift(text);
  }
  return chain;
}

/** The folder the user made and the note's own title, out of a vault-relative
 *  path. The VAULT is never named: it is the one container every note in the
 *  block shares, so naming it says nothing about where this task sits. */
export function notePlace(notePath: string): { folder: string; note: string } {
  const path = notePath.trim();
  if (!path) return { folder: "", note: "" };
  const cut = path.lastIndexOf("/");
  const folder = cut < 0 ? "" : path.slice(0, cut);
  const base = cut < 0 ? path : path.slice(cut + 1);
  return { folder, note: base.replace(/\.md$/i, "") };
}

/**
 * The two halves of the block that belong to the note rather than to the user.
 *
 * A field with nothing in it is OMITTED rather than left blank — "Heading:" with
 * nothing after it is not a fact about the task — so a bare checkbox in a
 * root-level note renders down to nothing here, and `renderSourceDescription`
 * leaves it as the one labelled line an origin without context has always been.
 *
 * Best-effort throughout, which is the Todoist reader's posture too: a note we
 * cannot find the line in leaves the whole block out and the task still starts.
 * Nothing here is worth refusing an import over.
 */
export function composeNoteContext(params: { notePath: string; text: string; title: string }): {
  context: string;
  notes: string;
} {
  const { folder, note } = notePlace(params.notePath);
  const lines = (params.text ?? "").split("\n");
  const index = findTaskLine(lines, params.title);

  const heading = index < 0 ? [] : headingChain(lines, index);
  const indent = index < 0 ? 0 : indentOf(lines[index]);
  const parent = index < 0 ? null : parentOf(lines, index, indent);

  const out: string[] = [];
  const push = (label: string, value: string) => {
    const text = value.trim();
    if (text) out.push(`${label}: ${text}`);
  };
  push("Folder", folder);
  push("Note", note);
  push("Heading", heading.join(" / "));
  push("Parent task", parent?.text ?? "");
  push(
    "Parent task description",
    parent ? truncateDescription(descriptionUnder(lines, parent.line, parent.indent), PARENT_DESCRIPTION_LIMIT) : "",
  );

  return {
    context: out.join("\n"),
    notes: index < 0 ? "" : truncateDescription(descriptionUnder(lines, index, indent), STARTED_DESCRIPTION_LIMIT),
  };
}

/**
 * The note with the squid's own wording of a task written under the line the
 * task came from, or null when there is nothing to write.
 *
 * The line is found by the ID the running task carries — `origin.taskId`, which
 * is `taskIdFor` of the note's path and the words the user pressed — and not by
 * the running title, which is exactly the thing that no longer matches. The new
 * line goes AFTER the item's whole subtree (its description lines and any
 * nested items, by the same indent rule `descriptionUnder` reads), so it lands
 * as the item's next sibling rather than between the item and its own notes,
 * and it wears the item's own prefix with the box open — the same bullet and
 * the same indent, so it reads as a task the user could have typed there.
 *
 * Null, and the note untouched, when the line the id names is not in this note
 * any more (renamed, reworded, moved), and when a marked task already carries
 * the new words — ticked or not — which is what makes a second pass, or a
 * second vault on the same account, write nothing.
 */
export function insertTaskBelow(text: string, notePath: string, sourceTaskId: string, title: string): string | null {
  const wording = title.trim();
  if (!wording) return null;
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseTaskLine(lines[i]);
    if (!parsed || parsed.markerStart < 0) continue;
    if (parsed.title === wording) return null;
    if (at < 0 && taskIdFor(notePath, parsed.title) === sourceTaskId) at = i;
  }
  if (at < 0) return null;
  const original = parseTaskLine(lines[at])!;
  const indent = indentOf(lines[at]);
  let after = at;
  while (after + 1 < lines.length && lines[after + 1].trim() && indentOf(lines[after + 1]) > indent) after++;
  const prefix = original.prefix.replace(/\[[xX]\]/, "[ ]");
  lines.splice(after + 1, 0, `${prefix}${wording} ${MARKER}`);
  return lines.join("\n");
}
