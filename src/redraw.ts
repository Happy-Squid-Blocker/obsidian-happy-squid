import { ViewPlugin, type EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { TaskStates } from "./state";

/**
 * Making the editor rebuild its decorations when the ACCOUNT moved.
 *
 * A task starting, stopping or being refused changes no text, so the editor
 * has no reason of its own to redraw, and both decoration builders (the
 * control's and the cards') watch `TaskStates.version` for exactly that case —
 * but they watch it from `ViewPlugin.update`, which CodeMirror only calls with
 * a `ViewUpdate`, and until 2026-09-02 nothing here ever produced one.
 *
 * What was called instead was Obsidian's `Editor.refresh()`, on the reading
 * that it "refreshes the editor". It is `cm.requestMeasure()` (app.js), and a
 * measure with no request re-reads the editor's GEOMETRY and stops there:
 * `EditorView.measure` breaks out of its loop before creating a ViewUpdate
 * when `ViewState.measure` reports nothing moved and no measure requests are
 * queued — which, for a note sitting still under the user's eyes, is every
 * time. So the marker kept its old face until the user next typed, moved the
 * caret or scrolled, each of which IS a ViewUpdate. That is what "it takes a
 * while for start task to become stop task" was: not the wire, but a redraw
 * waiting for a keystroke.
 *
 * An EMPTY TRANSACTION is the documented way to ask for a ViewUpdate with no
 * change in it: `dispatch({})` builds one with a transaction and no flags, and
 * `EditorView.update` runs every plugin's `update` for any ViewUpdate that is
 * not empty — a transaction, even a changeless one, is not. It touches no
 * document, adds no undo step and fires no `editor-change` (Obsidian raises that
 * on `docChanged` alone), so the stamp beat and the file's save are not woken.
 *
 * One extension rather than a subscription inside each builder, so the two
 * builders stay what they are — readers of a version — and so a third would
 * get the redraw by being an ordinary plugin on the same view.
 *
 * DEFERRED to a microtask. `redraw()` calls its listeners synchronously from
 * wherever it was called, and dispatching from inside an update in progress is
 * an error; nothing dispatches from one today, and the microtask keeps it that
 * way for whatever calls `redraw()` next. Cheap either way: a dispatch that
 * finds the version already seen rebuilds nothing.
 */
export function redrawOnChange(states: TaskStates): Extension {
  return ViewPlugin.fromClass(
    class {
      private live = true;
      private readonly unsubscribe: () => void;

      constructor(view: EditorView) {
        this.unsubscribe = states.onChange(() => {
          queueMicrotask(() => {
            if (this.live) view.dispatch({});
          });
        });
      }

      destroy(): void {
        this.live = false;
        this.unsubscribe();
      }
    },
  );
}
