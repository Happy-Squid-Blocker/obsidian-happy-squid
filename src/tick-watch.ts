import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { Extension, Text } from "@codemirror/state";
import { editorInfoField } from "obsidian";
import { tickedTitles } from "./task-line";

/** A box ticked by the user's own hand: the task's words, and the note it is
 *  in ("" when the editor has no file — a canvas card, say). */
export type TickHandler = (title: string, notePath: string) => void;

/**
 * Noticing a checkbox being ticked in the editor.
 *
 * Ticking the box completes the task in Happy Squid (Anton, 2026-09-02), and
 * every way of ticking one in the editor is a document change: the checkbox
 * Live Preview draws, the "Toggle checkbox status" command, an `x` typed into
 * the brackets in source mode. So the watcher is an `updateListener` — the
 * editor's own hook for "something changed", run after the change has landed
 * and outside any decoration build, so nothing here can loop a render — and it
 * reads the TRANSITION off the lines the change touched: the old document's
 * lines under the replaced range against the new document's lines under what
 * replaced it. A transition and not a state, because a note may hold a
 * finished copy of a task beside the running one, and "is the running task's
 * line ticked" would then answer yes at the first keystroke anywhere in it
 * (task-line.ts, `tickedTitles`).
 *
 * The note is read off `editorInfoField`, the file Obsidian attaches to each
 * of its editors, rather than the active view: a checkbox can be ticked in a
 * pane that is not the active one.
 *
 * Reading view is not an editor and has no changes to listen to; its
 * checkbox is answered in marker.ts, on the element itself.
 */
export function tickWatch(onTick: TickHandler): Extension {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged) return;
    const before: string[] = [];
    const after: string[] = [];
    update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      linesOf(update.startState.doc, fromA, toA, before);
      linesOf(update.state.doc, fromB, toB, after);
    });
    const titles = tickedTitles(before, after);
    if (titles.length === 0) return;
    const notePath = update.state.field(editorInfoField, false)?.file?.path ?? "";
    for (const title of titles) onTick(title, notePath);
  });
}

/** Every line a range touches, whole — a tick is one character inside one. */
function linesOf(doc: Text, from: number, to: number, out: string[]): void {
  let line = doc.lineAt(from);
  for (;;) {
    out.push(line.text);
    if (line.to >= to || line.number >= doc.lines) return;
    line = doc.line(line.number + 1);
  }
}
