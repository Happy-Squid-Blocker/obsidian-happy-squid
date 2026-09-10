import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";
import {
  LABEL,
  LABEL_BLOCKED,
  LABEL_REFUSED,
  LABEL_RUNNING,
  LABEL_SPENT,
  LABEL_STARTING,
  LABEL_STOPPING,
  markerRange,
  parseTaskLine,
} from "./task-line";
import type { TaskStates } from "./state";
import type { TickHandler } from "./tick-watch";

/** Pressing the control. What it MEANS depends on the state it is drawn in,
 *  which is the point of having one control rather than three. */
export type PressHandler = (title: string) => void;

/** One face of the control: the word, the tone the stylesheet keys off, the
 *  reason as its tooltip, and whether it is waiting on the account. */
export interface Face {
  label: string;
  tone: string;
  tooltip: string;
  /** A press the account has not answered. The control is INERT while it
   *  lasts — `press` sends nothing for it — and says so to a screen reader. */
  pending: boolean;
}

/**
 * Drawing the control.
 *
 * A REPLACE decoration over text that is already there, never a widget inserted
 * at a position. The difference is the whole reason this works inside Live
 * Preview: nothing enters the document flow, so click-to-position, selection and
 * cursor movement are all left alone.
 */
class StartTaskWidget extends WidgetType {
  constructor(
    private title: string,
    private face: Face,
    private onStart: PressHandler,
  ) {
    super();
  }

  eq(other: StartTaskWidget): boolean {
    return (
      other.title === this.title && other.face.label === this.face.label && other.face.tooltip === this.face.tooltip
    );
  }

  toDOM(): HTMLElement {
    const span = createSpan();
    applyFace(span, this.face);
    span.setAttribute("role", "button");
    span.setAttribute("tabindex", "0");
    // mousedown, not click: the editor would otherwise have moved the caret
    // before a click ever landed.
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onStart(this.title);
    });
    span.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this.onStart(this.title);
    });
    return span;
  }

  /** Our own listeners handle it; let the events through rather than have
   *  CodeMirror swallow them. */
  ignoreEvent(): boolean {
    return false;
  }
}

/** Puts a face onto a span — the one place the class, the word, the tooltip
 *  and the inert mark are written, so the editor's widget and the reading
 *  view's span can never dress the same state two ways. */
function applyFace(span: HTMLElement, face: Face): void {
  span.className = `hs-start-task hs-${face.tone}`;
  span.textContent = face.label;
  if (face.tooltip) span.title = face.tooltip;
  else span.removeAttribute("title");
  if (face.pending) span.setAttribute("aria-disabled", "true");
  else span.removeAttribute("aria-disabled");
}

/**
 * The faces of one control, and each keeps the reason as its tooltip: the
 * sentence is the only part worth reading twice, and it is always the reducer's
 * or the model's own words rather than copy written for a marker.
 *
 * `refused`, `blocked` and `spent` look alike and are three different answers:
 * rewriting the line answers the first, and does nothing at all about a lock or
 * about an allowance that is used up. So none of them may share a label — which
 * `spent` did until 2026-08-29, telling a user out of free tasks that their task
 * had been judged unproductive.
 *
 * `starting` and `stopping` are the two faces BETWEEN the others: a press the
 * account has not answered yet, drawn from the press itself rather than from
 * anything read back — see TaskStates.markPending.
 */
export function faceFor(states: TaskStates, title: string): Face {
  const state = states.stateFor(title);
  if (state.kind === "starting") return { label: LABEL_STARTING, tone: "starting", tooltip: "", pending: true };
  if (state.kind === "stopping") return { label: LABEL_STOPPING, tone: "stopping", tooltip: "", pending: true };
  if (state.kind === "running") return { label: LABEL_RUNNING, tone: "running", tooltip: "", pending: false };
  if (state.kind === "refused") return { label: LABEL_REFUSED, tone: "refused", tooltip: state.detail, pending: false };
  if (state.kind === "blocked") return { label: LABEL_BLOCKED, tone: "blocked", tooltip: state.detail, pending: false };
  if (state.kind === "spent") return { label: LABEL_SPENT, tone: "spent", tooltip: state.detail, pending: false };
  return { label: LABEL, tone: "idle", tooltip: "", pending: false };
}

function buildDecorations(view: EditorView, onStart: PressHandler, states: TaskStates): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sel = view.state.selection.main;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const parsed = parseTaskLine(line.text);
      const range = parsed && markerRange(parsed, line.text);
      if (parsed && range) {
        const start = line.from + range.from;
        const end = line.from + range.to;
        // Reveal the raw text while the caret is STRICTLY inside it — that is
        // how the marker gets edited or deleted, and it is how Obsidian's own
        // inline elements behave. Merely adjacent does not count: the caret sits
        // at the end of the line the whole time the user is typing the task, and
        // treating that as inside makes the control flicker on every keystroke.
        const inside = sel.from < end && sel.to > start;
        if (!inside) {
          builder.add(
            start,
            end,
            parsed.done
              ? // A finished task has nothing to start. Hidden outright, because
                // leaving the raw text is worse than either alternative: Obsidian
                // strikes it through with the rest of the line — a ticked box's
                // line by its own rule, a plain item's by the very tildes that
                // made it done.
                Decoration.replace({})
              : Decoration.replace({
                  widget: new StartTaskWidget(parsed.title, faceFor(states, parsed.title), onStart),
                }),
          );
        }
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/**
 * The editor's control. Rebuilt on the editor's own reasons and on the
 * account's — `states.version` — which reaches this plugin's `update` only
 * because `redrawOnChange` (redraw.ts) turns a change into a ViewUpdate.
 */
export function markerExtension(onStart: PressHandler, states: TaskStates): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      // What the account said last time this was drawn. A task starting or being
      // refused changes no text, so without this the control would keep its old
      // face until the user happened to type on the line.
      private seenVersion: number;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, onStart, states);
        this.seenVersion = states.version;
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet || this.seenVersion !== states.version) {
          this.decorations = buildDecorations(update.view, onStart, states);
          this.seenVersion = states.version;
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/**
 * One control in reading view, kept current.
 *
 * Reading view is a separate rendering path with its own pass, and until
 * 2026-09-02 that pass drew the face once and left it: the word could change
 * under the account's hand — the task starting, the verdict landing — and the
 * span went on saying what it said when the note was rendered. The press itself
 * now draws a face ("starting…") that nothing re-renders the note for, so the
 * span has to move on its own. The goal card next door already answers this
 * with a `MarkdownRenderChild`, Obsidian's own mechanism for a rendered element
 * with a lifetime; this is the same answer, one span at a time — subscribed on
 * load and unsubscribed for us when the note is closed or re-rendered.
 */
class FaceChild extends MarkdownRenderChild {
  constructor(
    span: HTMLElement,
    private title: string,
    private states: TaskStates,
  ) {
    super(span);
  }

  onload(): void {
    this.draw();
    this.register(this.states.onChange(() => this.draw()));
  }

  private draw(): void {
    applyFace(this.containerEl, faceFor(this.states, this.title));
  }
}

/**
 * The same control in reading view, which is a separate rendering path and needs
 * its own pass. A plugin that only does the editor works where the author is
 * not looking and reads as broken.
 *
 * Every list item, boxed or plain — a plain item being a task since 2026-09-07
 * — and each is read by putting its rendered content back into the SOURCE
 * shape `parseTaskLine` knows (`inlineSource`), so reading view and the editor
 * answer "done" and "title" out of one parser: the box's own character in
 * front, and a `<del>` element turned back into the `~~` that made it, which
 * is the one piece of markup that decides anything here.
 *
 * The CHECKBOX is answered here too. Reading view is not an editor, so a tick
 * there is no document change for `tickWatch` (tick-watch.ts) to see — it is
 * Obsidian's own handler on the box writing the file — so the box itself is
 * listened to. On EVERY marked box, ticked or not at render time, and what the
 * click means is read at the click: Obsidian toggles a box in place (its
 * handler patches the section's cached html and sets `checked` on the same
 * element) rather than re-rendering the item, so a listener attached only to
 * boxes that were open when the note was drawn was gone from a box the user
 * had just un-ticked and ticked again — MEASURED 2026-09-02, the second click
 * filed nothing. `checked` already holds what the click is moving the box TO
 * while the event runs, before Obsidian's delegated handler prevents the
 * default, so a click on a done box reads false and files nothing. A plain
 * item has no box and reading view is not editable, so it has no tick here;
 * striking it through is an edit, and the editor's watcher sees that.
 */
export function decorateReadingView(
  el: HTMLElement,
  onStart: PressHandler,
  onTick: TickHandler,
  states: TaskStates,
  ctx: MarkdownPostProcessorContext,
): void {
  for (const li of Array.from(el.querySelectorAll("li"))) {
    // The box's OWN character, not a two-way guess off it.
    //
    // `data-task` carries whatever Obsidian read out of the line, and for an
    // OPEN task that string is EMPTY — so `!== " "` was true for every task in
    // the vault and this pass read them all as done. MEASURED against the
    // shipped build in a real vault: nine marked tasks in reading view, zero
    // controls drawn, which is not a rendering quirk but this one comparison.
    // A Tasks in-progress `[/]` failed the same test for the same reason.
    const raw = li.getAttribute("data-task");
    const boxed = li.classList.contains("task-list-item");
    const parsed = parseTaskLine(`- ${boxed ? `[${raw && raw.length === 1 ? raw : " "}] ` : ""}${inlineSource(li)}`);
    const done = parsed?.done ?? false;
    const title = parsed?.title ?? "";
    // The item's OWN box — `:scope >` so a nested list's boxes are their own
    // items', and through the `<p>` a loose list wraps its items in — and only
    // when the marker is on this item, which is what makes it a task Happy
    // Squid could be running.
    const box = li.querySelector<HTMLInputElement>(
      ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]',
    );
    if (box && title && (parsed?.markerStart ?? -1) >= 0) {
      box.addEventListener("click", () => {
        if (box.checked) onTick(title, ctx.sourcePath);
      });
    }
    const hits = ownTextNodes(li).filter((node) => node.nodeValue?.includes("{task}"));
    for (const textNode of hits) {
      const frag = createFragment();
      const children: FaceChild[] = [];
      const parts = textNode.nodeValue!.split("{task}");
      parts.forEach((part, i) => {
        // On a done task the marker is dropped along with the space in front of
        // it, matching the editor.
        if (part) frag.appendChild(document.createTextNode(done ? part.replace(/ $/, "") : part));
        if (i < parts.length - 1 && !done) {
          const span = createSpan();
          span.setAttribute("role", "button");
          span.addEventListener("click", () => onStart(title));
          frag.appendChild(span);
          children.push(new FaceChild(span, title, states));
        }
      });
      textNode.parentNode?.replaceChild(frag, textNode);
      // Registered only once the span is in the document: a child loads on
      // registration and draws straight away.
      for (const child of children) ctx.addChild(child);
    }
  }
}

/**
 * The text nodes that belong to THIS item — through the `<p>` a loose list
 * wraps it in, and never into a nested list, whose items are their own.
 *
 * A walk over the whole `<li>` used to take the nested items' text too, so a
 * marker on a child was replaced by the PARENT's pass with a control bound to
 * the parent's title, and the child's own pass then found nothing left to
 * draw. The node's nearest `<li>` says whose it is.
 */
function ownTextNodes(li: Element): Text[] {
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.parentElement?.closest("li") === li) out.push(node as Text);
    node = walker.nextNode();
  }
  return out;
}

/**
 * An item's rendered content put back into the shape of the line it was
 * rendered from, as far as this pass needs it: its own text (never a nested
 * list's), with a strikethrough element turned back into the `~~` it came
 * from. Every other inline element stands as its text, exactly as
 * `li.textContent` always read it here — bold, links and code lose their
 * syntax in this view as they did before, and only the strike is
 * load-bearing, being what makes a plain item done.
 */
function inlineSource(li: Element): string {
  let out = "";
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) out += child.nodeValue ?? "";
      else if (child.nodeType !== Node.ELEMENT_NODE) continue;
      else {
        const tag = (child as Element).tagName;
        if (tag === "UL" || tag === "OL") continue;
        if (tag === "DEL" || tag === "S") out += `~~${child.textContent ?? ""}~~`;
        else walk(child);
      }
    }
  };
  walk(li);
  return out;
}
