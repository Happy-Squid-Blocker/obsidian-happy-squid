import { type EditorView, keymap } from "@codemirror/view";
import { type Extension, Prec } from "@codemirror/state";
import { MARKER, parseTaskLine } from "./task-line";

/**
 * Carrying the marker onto the next task.
 *
 * Layered ABOVE Obsidian's own list continuation with `Prec.high`, and it
 * returns false in every case it does not own, so ordinary Enter is untouched
 * everywhere else.
 *
 * Two things here were found by running it rather than by reading it, and both
 * are the kind that look right on paper:
 *
 *  1. The trigger cannot be "caret at end of line". After you type a title the
 *     caret sits BEFORE the trailing marker, so an end-of-line rule fires on the
 *     first task and never again: Obsidian's own Enter splits the line instead,
 *     carries the marker down to the new one, and leaves the task you just typed
 *     unmarked. The marker is a control rather than text, so the end of the
 *     TITLE is what counts as the end of the line.
 *
 *  2. An empty marked task has to be cleared here. Obsidian ends a list when you
 *     press Enter on an empty item, but ` {task}` is content as far as it is
 *     concerned, so the default splits the line and strands a marker on a task
 *     that has no words. Since the marker propagates down a list, that is the
 *     case a user hits every single time they finish one.
 */
export function enterPropagation(): Extension {
  return Prec.high(
    keymap.of([
      {
        key: "Enter",
        run: (view: EditorView) => {
          const range = view.state.selection.main;
          if (!range.empty) return false;

          const line = view.state.doc.lineAt(range.head);
          const parsed = parseTaskLine(line.text);
          if (!parsed || parsed.markerStart < 0) return false;

          // (2) Empty marked task: clear the whole line, which is what ending the
          // list looks like. This is also the way OUT of a propagating run.
          //
          // The RAW title, deliberately. `title` has the neighbours' annotations
          // taken out of it, so a line holding nothing but `📅 2026-09-01
          // {task}` reads as empty there — and clearing it would delete a date
          // the user typed. Empty means the line has no text, not that it has no
          // words of ours.
          if (parsed.rawTitle.length === 0) {
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: "" },
              selection: { anchor: line.from },
              userEvent: "input",
            });
            return true;
          }

          // (1) A genuine split inside the title is still Obsidian's.
          if (range.head < line.from + parsed.titleEnd) return false;

          view.dispatch({
            // The space keeps the next title off the marker: the caret lands at
            // the prefix end, so what gets typed goes in BEFORE it.
            changes: { from: line.to, to: line.to, insert: `\n${parsed.prefix} ${MARKER}` },
            selection: { anchor: line.to + 1 + parsed.prefix.length },
            scrollIntoView: true,
            userEvent: "input",
          });
          return true;
        },
      },
    ]),
  );
}
