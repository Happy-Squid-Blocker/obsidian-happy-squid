/**
 * The one place that knows what a marked task line looks like.
 *
 * Both halves of the feature read a line the same way — the decoration that
 * draws the control, and the Enter handler that carries the marker onto the next
 * task — so the parse lives here and neither owns its own regex. It is also the
 * only part of the plugin with no Obsidian or CodeMirror import, which is what
 * makes it the part worth unit-testing.
 */

/** What the user types. Single braces on purpose: `{{double}}` is taken by
 *  Obsidian's core Templates plugin (`{{date}}`, `{{title}}`). */
export const MARKER = "{task}";

/** What the marker is drawn as at rest. Short, because it sits at the end of
 *  the line and a long label wraps onto its own row on a phone. */
export const LABEL = "start task";

/** Drawn instead while THIS task is the one running, so the control says what
 *  pressing it would now do rather than offering to start what already has. */
export const LABEL_RUNNING = "stop task";

/**
 * Drawn when the productivity check refused this task.
 *
 * It is a STATE and not a button: the note is where the user finds out, since
 * the review itself opens on whichever device handled the check. Rewording the
 * line clears it, because the marker is keyed by the task's own words — see
 * state.ts.
 */
export const LABEL_REFUSED = "task deemed unproductive";

/**
 * Drawn when a LOCKED task is holding the slot.
 *
 * A different answer from the one above and it must not wear its words:
 * rewriting the line fixes a verdict about the task and does nothing at all
 * about a lock. It names the LOCK rather than the busy slot, because since an
 * integration start displaces anything unlocked, the lock is the only reason
 * this face is ever drawn — the reducer's own "A task is already active." is
 * still the tooltip. (Anton, 2026-08-29)
 */
export const LABEL_BLOCKED = "current task locked";

/**
 * Drawn when the free tier's weekly allowance is spent.
 *
 * The THIRD answer to a start, and it wore the first one's words until
 * 2026-08-29: a user who had used their task for the week was told the squid had
 * judged it unproductive, which nothing had. Rewriting the line fixes neither
 * face, but only one of them is about the line at all — which is the same reason
 * the one above is not this one either.
 *
 * A Todoist user meets this refusal as a comment on the item ("You are out of
 * tasks. Upgrade to Pro for unlimited access to Happy Squid.") and never through
 * `result` at all; these are that sentence's first half in the register the two
 * faces above settled into. The reducer's own "The free version allows 1 task a
 * week." is the tooltip, as every other face's reason is.
 */
export const LABEL_SPENT = "out of tasks this week";

/**
 * Drawn from the moment "start task" is pressed until the account answers.
 *
 * A press is a round trip through the Edge Function, a device's claim and —
 * for a start — the productivity check, so the control used to sit unchanged
 * for seconds looking unpressed and then flip. This face is the plugin's own
 * promise, drawn before the request is even sent, and it lasts until the
 * account reports the task running or turned away (TaskStates.markPending).
 * Anton's copy (2026-09-02); the ellipsis is the one character, as the
 * product's other trailing ellipses are.
 */
export const LABEL_STARTING = "starting…";

/** The same promise for "stop task". See LABEL_STARTING. */
export const LABEL_STOPPING = "stopping…";

// Group 1 is the whole "- [ ] " prefix, group 2 the character inside the box.
//
// The box admits ANY single character, and an ORDERED-list number is a bullet
// like any other. Both were narrower — `[ xX]` and `[-*+]` — until the plugin
// was finally opened in a vault that had its neighbours in it. Tasks ships two
// custom statuses out of the box (`/` in progress, `-` cancelled) and its Status
// Collections add `>`, `?`, `!` and more, so a user who marked a task in
// progress watched the control turn back into five characters of raw text, with
// nothing to report but "it stopped working". Which character sits in the box is
// the theme's business and Tasks'; ours is only whether the task is still open.
const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[([^\]])\]\s+)/;

/**
 * The boxes that mean "nothing left to start".
 *
 * `x` and `X` are Obsidian's own done. `-` is Tasks' cancelled, which is equally
 * not a task anybody can begin. Every other character — `/`, `>`, `?`, `!`, or
 * whatever a Status Collection invents next — is an OPEN task wearing a status,
 * and the control belongs on it.
 */
const DONE_BOXES = new Set(["x", "X", "-"]);

/**
 * Tasks' signifiers that carry a VALUE after them — a date, a recurrence rule,
 * an id. `⌛`, `📆` and `🗓` are the alternates Tasks accepts for `⏳` and `📅`.
 */
const TASKS_VALUE = "🔁➕🛫⏳⌛📅📆🗓✅❌🆔⛔🏁";

/** Tasks' priorities, which are the whole field — there is no value after one. */
const TASKS_BARE = "🔺⏫🔼🔽⏬";

/**
 * A TRAILING run of Tasks signifiers, each swallowing whatever follows it up to
 * the next one.
 *
 * Anchored to the end on purpose, because that is where Tasks itself reads them:
 * its own editor writes every signifier after the description, and its docs
 * teach the same. Anchoring costs one thing and buys another — a date typed in
 * FRONT of the words is left in the title, and no line ever loses words that
 * merely happened to sit behind a signifier the user put mid-sentence.
 */
const TASKS_TRAILING_RE = new RegExp(
  `(?:\\s*(?:[${TASKS_VALUE}][^${TASKS_VALUE}${TASKS_BARE}]*|[${TASKS_BARE}]))+$`,
  "u",
);

/**
 * Dataview's inline fields, in both spellings.
 *
 * Taken out ANYWHERE rather than only at the end, because unlike the emoji these
 * are delimited: there is no question where one stops. `[[A wiki link]]` is left
 * alone by construction — the inner text has no `::` and the outer bracket is
 * followed by one this cannot cross.
 */
const INLINE_FIELD_RE = /[[(][^[\]()]*::[^[\]()]*[\])]/g;

/** Day Planner's clock, which it writes at the FRONT of the line. */
const LEADING_TIME_RE = /^\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\s+/;

/** Obsidian's own block id, always last. */
const BLOCK_ID_RE = /\s*\^[A-Za-z0-9-]+$/;

/** Completion dates Tasks adds while toggling a line. Happy Squid keeps main's
 *  checkbox-only completion UI, even when it asks Tasks to create a recurrence. */
const TASKS_COMPLETION_DATE_RE = /\s*✅\s+\d{4}-\d{2}-\d{2}(?=\s|$)/gu;

/**
 * The neighbours' annotations, taken back out of the task's own words.
 *
 * The title is defined as everything between the checkbox and the marker, so
 * without this every plugin sharing the line writes into it. That costs twice,
 * from one cause. It is what the productivity model JUDGES — hours of
 * "🔁 every day 📅 2026-09-01" in front of it, on every page load — and it is
 * also the IDENTITY, since `taskIdFor(notePath, title)` and `stateFor(title)`
 * both key on these words. So pushing a due date back while a task ran used to
 * make it silently a different task: the marker lost its "stop task" face and
 * the completion tick could no longer find the line. Tasks appending its own
 * `✅ 2026-08-30` at completion was itself such a rename.
 *
 * Tags and links are deliberately KEPT. `#philosophy` and `[[Some Note]]` are
 * words the user chose to put in the title of their task, and no other plugin
 * put them there.
 */
export function stripMetadata(title: string): string {
  const stripped = title
    .replace(BLOCK_ID_RE, "")
    .replace(TASKS_TRAILING_RE, "")
    .replace(INLINE_FIELD_RE, " ")
    .replace(LEADING_TIME_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  // A title is never stripped away to NOTHING. A line whose every word turned
  // out to be somebody else's annotation is a line this has misread — a date
  // typed in front of the task rather than behind it, which is the one shape the
  // trailing anchor cannot tell from metadata — and the user's own text is a
  // better answer than an empty identity that every such line would share.
  return stripped === "" ? title.replace(/\s+/g, " ").trim() : stripped;
}

/**
 * Writing a character into the box, wherever the box is.
 *
 * A literal `[ ]` to replace until the parse learned to admit `[/]`: a line
 * whose box holds anything else would have been left exactly as it was, ticked
 * nowhere and reported nowhere.
 */
function setBox(line: string, box: string): string {
  const m = TASK_LINE_RE.exec(line);
  if (!m) return line;
  const at = m[1].indexOf("[");
  return line.slice(0, at + 1) + box + line.slice(at + 2);
}

export interface ParsedTaskLine {
  /** The list prefix, e.g. "- [ ] ", including its trailing space. */
  prefix: string;
  checked: boolean;
  /** Offset of the marker within the line, or -1 when the line carries none. */
  markerStart: number;
  /** Offset one past the marker, or -1. */
  markerEnd: number;
  /**
   * Offset where the title stops — everything before the marker, with trailing
   * whitespace ignored. This is what "the end of the line" means for the Enter
   * handler: the marker is a control rather than text, and the caret sits in
   * front of it the moment the user finishes typing.
   */
  titleEnd: number;
  /**
   * The task's own words, with the prefix, the marker AND the neighbours'
   * annotations taken out — see `stripMetadata`. This is the identity, and it is
   * what the productivity model reads.
   */
  title: string;
  /**
   * Everything between the prefix and the marker, trimmed and nothing else.
   *
   * The Enter handler's "is this line empty" question is about the TEXT rather
   * than about the words: a line holding only a due date is not an empty task,
   * and clearing it would delete the date the user typed.
   */
  rawTitle: string;
  /** The single character inside the box, exactly as written. */
  box: string;
}

/** Null when the line is not a task list item at all. */
export function parseTaskLine(text: string): ParsedTaskLine | null {
  const m = TASK_LINE_RE.exec(text);
  if (!m) return null;
  const prefix = m[1];
  const box = m[2];
  const checked = DONE_BOXES.has(box);
  const markerStart = text.indexOf(MARKER);
  const markerEnd = markerStart < 0 ? -1 : markerStart + MARKER.length;
  const beforeMarker = markerStart < 0 ? text : text.slice(0, markerStart);
  const titleEnd = beforeMarker.replace(/\s+$/, "").length;
  const rawTitle = text.slice(prefix.length, markerStart < 0 ? text.length : markerStart).trim();
  return { prefix, box, checked, markerStart, markerEnd, titleEnd, title: stripMetadata(rawTitle), rawTitle };
}

/**
 * The range the decoration should cover.
 *
 * On a COMPLETED task the space in front of the marker goes too. The marker is
 * hidden there rather than drawn, and hiding it alone would leave the title
 * wearing a trailing space — a gap that reads as a missing word next to a
 * struck-through line.
 */
export function markerRange(parsed: ParsedTaskLine, text: string): { from: number; to: number } | null {
  if (parsed.markerStart < 0) return null;
  const eatsSpace = parsed.checked && parsed.markerStart > 0 && text[parsed.markerStart - 1] === " ";
  return { from: parsed.markerStart - (eatsSpace ? 1 : 0), to: parsed.markerEnd };
}

/**
 * Ticking the box on the task these words name, in a whole note.
 *
 * Returns the new text, or null when there was nothing to do — which is what
 * makes applying a completion idempotent: a row goes on saying `completed` for
 * as long as it is read, and a line that is already ticked no longer parses as
 * unchecked.
 *
 * Matched by the task's own WORDS and by the marker, never by line number: notes
 * get edited and reordered between a task starting and finishing. Only the box
 * changes — the marker stays exactly where the user put it, since deleting it
 * would be the plugin editing their words, and a done task hides it anyway.
 *
 * The FIRST match wins. Two identical task lines in one note are the same task
 * as far as anything here can tell, so ticking either is the same answer.
 */
export function tickTaskLine(text: string, title: string, toggle?: TasksToggle): string | null {
  const lines = text.split("\n");
  const found = findTaskLine(lines, title);
  if (found < 0) return null;
  lines.splice(found, 1, ...tickOne(lines[found], toggle));
  return lines.join("\n");
}

/**
 * Tasks' own toggle, as this file is willing to know it: one line in, the lines
 * that should stand in its place out, joined by newlines. Nothing here imports
 * Tasks — tick.ts looks the plugin up and hands the call down, which is what
 * keeps this file the one part of the plugin that imports nothing at all.
 */
export type TasksToggle = (line: string) => string;

/**
 * What one line becomes when it is ticked.
 *
 * Without Tasks in the vault this is the box and nothing else. With it, Tasks
 * answers instead so a `🔁` line gets its next occurrence. Its completion date
 * is removed before the note is written, keeping main's checkbox-only UI.
 */
function tickOne(line: string, toggle?: TasksToggle): string[] {
  if (!toggle) return [setBox(line, "x")];
  const { body, tail } = detachTrailingMarker(line);
  const out = toggle(body).split("\n").map(stripTasksCompletionDate);
  // Every line Tasks hands back gets the marker: the NEW occurrence needs one to
  // be startable at all, and on the completed line it is hidden anyway.
  return tail ? out.map((l) => l + tail) : out;
}

function stripTasksCompletionDate(line: string): string {
  return line.replace(TASKS_COMPLETION_DATE_RE, "").trimEnd();
}

/**
 * The line with our marker taken off the end, and the tail to put back.
 *
 * Tasks reads its signifiers as a TRAILING run, so a `{task}` sitting after them
 * hides the whole run from it. MEASURED, in a vault with Tasks 8.4.0:
 * `executeToggleTaskDoneCommand` writes tomorrow's occurrence for
 * `- [ ] Water plants 🔁 every day 📅 2026-09-01` and writes NONE for the same
 * line with ` {task}` on the end. That is the shape enter.ts produces and the
 * README teaches, so handing Tasks the line unchanged would be asking it the
 * question with the answer covered up.
 *
 * A marker that is NOT trailing is left exactly where it is: Tasks reads past it
 * already, and moving somebody's marker to tidy up would be the plugin editing
 * their words.
 */
export function detachTrailingMarker(line: string): { body: string; tail: string } {
  const parsed = parseTaskLine(line);
  if (!parsed || parsed.markerStart < 0) return { body: line, tail: "" };
  if (line.slice(parsed.markerEnd).trim() !== "") return { body: line, tail: "" };
  const eatsSpace = parsed.markerStart > 0 && line[parsed.markerStart - 1] === " ";
  const cut = parsed.markerStart - (eatsSpace ? 1 : 0);
  return { body: line.slice(0, cut), tail: line.slice(cut) };
}

/**
 * Which line these words name, or -1.
 *
 * The two things done TO a task line ask this same question and must not answer
 * it differently: ticking one off when Happy Squid finished it, and reading the
 * position it sits in when it starts. A line found by one and missed by the
 * other would be a task walled under a note it was never in.
 *
 * The FIRST match wins. Two identical task lines in one note are the same task
 * as far as anything here can tell.
 */
export function findTaskLine(lines: string[], title: string): number {
  const wanted = title.trim();
  if (!wanted) return -1;
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseTaskLine(lines[i]);
    if (!parsed || parsed.checked || parsed.markerStart < 0) continue;
    if (parsed.title === wanted) return i;
  }
  return -1;
}

/**
 * The id this item is known by.
 *
 * A Todoist item arrives with an id of its own; a checkbox in a markdown file
 * has no identity at all — it is a line of text that can be edited, moved or
 * reordered. So one is derived from the note's path and the task's own words.
 *
 * That makes a RENAMED task a different item, which is the right trade while
 * "start" is the only direction: nothing reads the id back yet. Writing the
 * completion back into the note is what will need an id that survives a
 * rewording, and the Obsidian convention for that is a block id (`^hs7a3f`)
 * stamped into the line. Deliberately not done here, because stamping one edits
 * the user's note on a click that has no other reason to touch it.
 *
 * It lives here rather than beside the request that sends it because it is ON
 * THE WIRE: every intent row the account holds carries one, and the running
 * task's `origin.taskId` is read back against it (see `insertTaskBelow`), so
 * the hash may never change. The pin in task-line.test.ts is a real row's.
 */
export function taskIdFor(notePath: string, title: string): string {
  return `${notePath}#${fnv1a(title)}`;
}

/** The note a `source_task_id` names. The id is `<path>#<hash of the title>`,
 *  and a vault path may itself contain `#`, so the LAST one is the separator. */
export function notePathOf(sourceTaskId: string): string | null {
  const cut = sourceTaskId.lastIndexOf("#");
  return cut <= 0 ? null : sourceTaskId.slice(0, cut);
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Which marked tasks were TICKED between two versions of the same lines.
 *
 * Ticking the box by hand completes the task in Happy Squid (Anton,
 * 2026-09-02), and this is how a tick is told apart from a box that was
 * already ticked: a line that is open in `before` and ticked in `after`, with
 * the same words and the marker on both. A state alone cannot say it — a note
 * may hold a finished copy of a task next to the one running, and the first
 * keystroke anywhere in it would then read as ticking the finished copy off —
 * so it is the TRANSITION that counts, read off the lines an edit touched.
 *
 * Only marked lines, for the reason `tickTaskLine` takes only marked ones: an
 * unmarked checkbox is not a task Happy Squid was ever told about. Words that
 * changed in the same edit are not a tick of either wording, since no click
 * does both. Deduplicated, so two identical lines ticked at once — the same
 * task as far as anything here can tell — name it once.
 */
export function tickedTitles(before: string[], after: string[]): string[] {
  const open = new Set<string>();
  for (const line of before) {
    const parsed = parseTaskLine(line);
    if (parsed && !parsed.checked && parsed.markerStart >= 0 && parsed.title) open.add(parsed.title);
  }
  if (open.size === 0) return [];
  const ticked: string[] = [];
  for (const line of after) {
    const parsed = parseTaskLine(line);
    if (!parsed || !parsed.checked || parsed.markerStart < 0) continue;
    if (open.delete(parsed.title)) ticked.push(parsed.title);
  }
  return ticked;
}
