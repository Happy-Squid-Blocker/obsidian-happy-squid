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
  CHEVRON_PATH,
  DAY_SUMMARY_SEPARATOR,
  DAY_SUMMARY_TITLE,
  daySummaryLine,
  FLAME_PATH,
  goalText,
  taskRowText,
  type DaySummary,
  type GoalValue,
  type SnapshotTask,
} from "./goal";
import { rawMarkerText, type FoundMarker } from "./goal-marker";

/**
 * What one marker should draw, or null when there is nothing to draw.
 *
 * Three shapes, because the markers are three different kinds of thing. A
 * `{taskgoal}` is a CARD — the phone's row, with its own ground and lanes. A
 * `{daysummary}` is a second card of its own shape: the same ground and the same
 * ink, and a paragraph rather than a list of rows underneath. A `{tasktime}` is
 * a piece of TEXT, "1h 13m", and it deliberately carries no styling of its own
 * so that whatever the user wraps it in — bold, a heading, a callout, a table
 * cell — is what it comes out as. That is the whole point of the figure markers:
 * they are numbers people build their own blocks around.
 *
 * Implemented in main.ts, which is the one thing holding the live row, the
 * account's day record and the vault's archive.
 */
export type Rendered =
  | { kind: "card"; goal: GoalValue | null; date: string; tasks: SnapshotTask[] }
  | { kind: "daysummary"; day: DaySummary; date: string }
  | { kind: "text"; text: string };
export type GoalResolver = (found: FoundMarker) => Rendered | null;

/** Every marker in a line, already parsed. main.ts binds the vault's own date
 *  convention into it, so nothing here has to know about daily-note formats. */
export type MarkerScanner = (text: string) => FoundMarker[];

function flameSvg(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "25");
  svg.setAttribute("viewBox", "0 0 18 25");
  svg.setAttribute("fill", "none");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute("clip-rule", "evenodd");
  path.setAttribute("d", FLAME_PATH);
  // The glyph takes the card's own accent through CSS, so it is painted by the
  // stylesheet rather than by an attribute — the extension's exports hand the
  // colour in as a prop because their palette is spelled per surface, and here
  // there is one surface and one accent.
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

/** The disclosure glyph, traced from the Anima export and drawn ONCE pointing
 *  RIGHT. Every direction the card needs is that same glyph turned: right while
 *  the card is shut, down while it is open, left on a task whose name is cut
 *  off. The path is centred in a square box so the turn is about its own middle
 *  (styles.css rotates it), which a 7x12 box could not do. */
function chevronSvg(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "12.284");
  svg.setAttribute("height", "12.284");
  svg.setAttribute("viewBox", "0 0 12.284 12.284");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const g = document.createElementNS(ns, "g");
  g.setAttribute("transform", "translate(-31.1719 -29.8613)");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", CHEVRON_PATH);
  path.setAttribute("fill", "currentColor");
  g.appendChild(path);
  svg.appendChild(g);
  return svg;
}

/** Which days are open, and which task names are shown in full.
 *
 * Held HERE rather than on the widget, and that is the whole of what makes the
 * expansion usable in Live Preview. A CodeMirror decoration is rebuilt on every
 * doc change, viewport change and CARET MOVE, and a rebuilt widget is a fresh
 * `toDOM` — so state living on the widget is dropped the moment the user types
 * anywhere in the note. The streak reveal beside it has always been dropped that
 * way and nobody notices, a reveal being a glance; an expansion the user opened
 * and then lost mid-read is a different thing.
 *
 * Keyed by the DAY the card is about, so two markers naming one day open
 * together — which is right: they are two drawings of one thing. Not persisted
 * anywhere. It is a way of looking at the page, not a fact about the vault, and
 * writing it down would make it a third thing this plugin puts on disk.
 */
const openDays = new Set<string>();
const openNames = new Set<string>();
/** Which days' Daily Summary cards are open. A SECOND set rather than `openDays`
 *  above, and the difference is deliberate: two `{taskgoal}` markers naming one
 *  day open together because they are two drawings of one thing, while a Task
 *  Goal card and a Daily Summary card are two different things about one day and
 *  opening one says nothing about the other. Not persisted, for `openDays`'
 *  reason — it is a way of looking at the page, not a fact about the vault. */
const openSummaries = new Set<string>();

/**
 * The card, built once and handed to whichever surface is drawing it.
 *
 * The HEADER is the phone's Task Goal row — the same 70px of ground, the same
 * two lines, the same words — with three things changed, each because a note is
 * not the Home screen. Its corners are rounded all round, where on Home the row
 * tops a stack of blocks and squares its bottom into the card below. Its flame
 * lane stands at the RIGHT edge, because a card standing alone answers to
 * nothing beside it while every row on that screen has to start on one line. And
 * its two lines are two tiers rather than the row's one, the figure being the
 * thing that has to be read.
 *
 * It EXPANDS (Anton, 2026-09-01). Under the header the card lists the tasks that
 * ended on that day — when each started, what it worked, how many times the
 * squid blocked during it, and what the user called it — in rows of the same
 * 70px on the same unbroken ground, so an open card reads as one block rather
 * than as a card with a drawer. There is no chevron and nothing to press on a
 * day with no tasks, which covers a quiet day and a day recorded before the list
 * existed alike: both are "nothing to expand", and the card is exactly what it
 * has always been.
 *
 * The rows reuse the header's own two tiers rather than introducing any: the
 * time and the "1h 17m worked · 13 blocks" line take the quiet tier the title
 * takes, the task's NAME takes the loud tier the figure takes. That is measured
 * off the export, where those four runs are set in exactly two weights.
 *
 * Everything about it that is a COLOUR comes from Obsidian instead (styles.css):
 * a plugin that painted Happy Squid's blue into somebody's Minimal theme would
 * look like a foreign object, which is the same call `.hs-start-task` next door
 * already makes. That holds unchanged for everything the expansion added — the
 * new rows are two more uses of the two tints the card already had, and no third
 * colour was introduced for them.
 *
 * A `<span>` throughout, laid out with flex. Reading view hands us a text node
 * inside a `<p>`, and a `<div>` there is invalid nesting that browsers repair by
 * splitting the paragraph — so the card would break the very block it sits in.
 */
export function buildGoalCard(rendered: { goal: GoalValue | null; date: string; tasks: SnapshotTask[] }): HTMLElement {
  const { goal, date, tasks } = rendered;
  const text = goalText(goal);
  const card = createSpan();
  card.className = "hs-goal";
  card.setAttribute("aria-label", "Task goal");

  const head = createSpan();
  // A card with no goal has ONE line, and neither reason the row is top-bound
  // applies to it: there is no time in the gutter for a first line to stand
  // level with, and nothing here can grow a line. Top-bound, its 27.6px of slack
  // all falls below the message and the block reads bottom-heavy beside a
  // chevron that is centred. So it centres — the same answer the flame lane
  // opposite already gives (`align-self: center`).
  head.className = text.title ? "hs-goal-head" : "hs-goal-head hs-goal-head--single";
  card.appendChild(head);

  // The gutter is the CARD's layout, not the chevron's, so it is drawn whether
  // or not there is anything to put in it — the same rule the flame lane has
  // kept since it was written. Without it a day gaining its first task would
  // step every line of the card sideways.
  const gutter = createSpan();
  gutter.className = "hs-goal-gutter";
  head.appendChild(gutter);

  const flame = createSpan();
  flame.className = "hs-goal-flame";
  // A slot that is EMPTY while there is no streak, exactly as it is left empty
  // on the browser's row and the phone's — the lane holds its width either way.
  // On those two that is what stops a streak starting from stepping the title
  // sideways; here the title meets a fixed inset instead, and what the held
  // width keeps steady is the card's right edge.
  if (text.streakLabel) {
    flame.appendChild(flameSvg());
    // The name goes in a visually hidden span rather than an `aria-label`, and
    // that is an OBSIDIAN fact rather than an accessibility one: Obsidian pops
    // its own tooltip for any `[aria-label]` element, so hovering the flame
    // answered twice — the title crossfading to "2 week streak" underneath a
    // black box also saying "2 week streak". The crossfade is the design's
    // answer (the browser's row does exactly this on hover); the tooltip was
    // chrome nobody drew. A hidden span gives a screen reader the same name
    // with nothing to pop.
    const name = createSpan();
    name.className = "hs-goal-sr";
    name.textContent = text.streakLabel;
    flame.appendChild(name);
  }

  const stack = createSpan();
  stack.className = "hs-goal-stack";

  // Both lines share ONE grid cell so the crossfade moves nothing and the lane
  // is sized by whichever is showing. The browser's row and the phone's stack
  // them the same way.
  // No title at all on a day whose goal was off: there is no period to name, and
  // an empty line would hold the 7px gap open above the one line there is. The
  // stack is `justify-content: center`, so dropping it centres what is left
  // rather than leaving it hanging at the top.
  if (text.title) {
    const titles = createSpan();
    titles.className = "hs-goal-titles";
    const title = createSpan();
    title.className = "hs-goal-title";
    title.textContent = text.title;
    titles.appendChild(title);
    const streak = createSpan();
    streak.className = "hs-goal-title hs-goal-streak";
    streak.textContent = text.streakLabel;
    streak.setAttribute("aria-hidden", "true");
    titles.appendChild(streak);
    stack.appendChild(titles);
  }

  const progress = createSpan();
  progress.className = "hs-goal-progress";
  progress.textContent = text.progress;
  stack.appendChild(progress);

  head.appendChild(stack);
  // The flame goes in AFTER the stack, so the lane stands at the card's right
  // edge (styles.css). Reordered in the DOM rather than with CSS `order`, so
  // that a screen reader meets the streak's hidden name where the eye meets the
  // glyph — last — instead of hearing "2 day streak" before the card has said
  // what it is.
  head.appendChild(flame);

  const list = createSpan();
  list.className = "hs-goal-tasks";
  card.appendChild(list);

  /** Draws the open/shut state. The rows are built and torn down rather than
   *  hidden, so a card that is shut costs nothing and a card that is opened is
   *  always looking at the record as it stands. */
  const paint = (): void => {
    const open = openDays.has(date);
    card.setAttribute("data-expanded", String(open));
    head.setAttribute("aria-expanded", String(open));
    list.replaceChildren();
    if (!open) return;
    for (const task of tasks) list.appendChild(buildTaskRow(date, task));
  };

  if (tasks.length > 0) {
    gutter.appendChild(chevronSvg());
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    const toggle = (e: Event) => {
      e.preventDefault();
      if (openDays.has(date)) openDays.delete(date);
      else openDays.add(date);
      paint();
    };
    // mousedown rather than click, matching the start-task control and the flame
    // below: in the editor a click would have moved the caret before it landed.
    head.addEventListener("mousedown", toggle);
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") toggle(e);
    });
  }
  paint();

  /**
   * Revealing the streak.
   *
   * The browser's row does this on HOVER and the phone's on a tap that expires
   * after four seconds, because a finger leaves no pointer behind to end the
   * reveal with. A note is read on both kinds of device, so the card takes the
   * hover AND makes the flame a toggle — and it needs no timer for the second,
   * because a widget in a note is rebuilt whenever anything changes and has no
   * lifecycle of its own to leave a reveal stranded in.
   *
   * Only ever wired when there IS a streak: with an empty slot there is nothing
   * to reveal, and a bare span that answers a click is a control that lies.
   */
  if (text.streakLabel) {
    flame.setAttribute("role", "button");
    flame.setAttribute("tabindex", "0");
    let pinned = false;
    const show = (on: boolean) => card.setAttribute("data-revealed", String(on));
    show(false);
    flame.addEventListener("mouseenter", () => show(true));
    flame.addEventListener("mouseleave", () => show(pinned));
    const toggle = (e: Event) => {
      e.preventDefault();
      // The flame sits INSIDE the header, which is itself the expand control now.
      // Without this a press on the streak would also open the card.
      e.stopPropagation();
      pinned = !pinned;
      show(pinned);
    };
    // mousedown rather than click, matching the start-task control: in the
    // editor a click would have moved the caret before it ever landed.
    flame.addEventListener("mousedown", toggle);
    flame.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") toggle(e);
    });
  }

  return card;
}

/**
 * One task's row: the time in the gutter, the worked-and-blocked line beside it,
 * the task's own name underneath.
 *
 * The NAME is one line and is cut off where the row runs out, under a fade
 * rather than an ellipsis (styles.css) — and a name that IS cut off grows a
 * chevron of its own, after the line above it, which opens the name in full and
 * takes the row with it. The chevron is drawn only when the name actually
 * overflows, which nothing here can know: `toDOM` returns a DETACHED element and
 * a detached element measures zero. So it is measured once the row is in the
 * document and again whenever the note's column changes width, and the row
 * carries the answer as an attribute the stylesheet reads.
 */
function buildTaskRow(date: string, task: SnapshotTask): HTMLElement {
  const text = taskRowText(task);
  const key = `${date}#${task.id}`;

  const row = createSpan();
  row.className = "hs-goal-task";

  const time = createSpan();
  time.className = "hs-goal-time";
  time.textContent = text.time;
  row.appendChild(time);

  const stack = createSpan();
  stack.className = "hs-goal-stack";
  row.appendChild(stack);

  // The meta line and the name's chevron share a line, the chevron sitting after
  // the words rather than at the row's edge — it belongs to this task's name,
  // and the design puts it where the sentence ends.
  const line = createSpan();
  line.className = "hs-goal-line";
  const meta = createSpan();
  meta.className = "hs-goal-meta";
  meta.textContent = text.meta;
  line.appendChild(meta);

  const more = createSpan();
  more.className = "hs-goal-more";
  more.appendChild(chevronSvg());
  more.setAttribute("role", "button");
  more.setAttribute("tabindex", "0");
  line.appendChild(more);
  stack.appendChild(line);

  const name = createSpan();
  name.className = "hs-goal-name";
  name.textContent = text.name;
  stack.appendChild(name);

  const paint = (): void => {
    const open = openNames.has(key);
    row.setAttribute("data-name-open", String(open));
    more.setAttribute("aria-expanded", String(open));
  };
  const toggle = (e: Event) => {
    e.preventDefault();
    // The row sits inside the card, whose header is the other expand control.
    // The header is not an ancestor of this row, but a press here must not reach
    // anything above the card either.
    e.stopPropagation();
    if (openNames.has(key)) openNames.delete(key);
    else openNames.add(key);
    paint();
    measure();
  };
  more.addEventListener("mousedown", toggle);
  more.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") toggle(e);
  });
  paint();

  /**
   * Whether the name is actually too long for its lane.
   *
   * Only asked while the name is SHUT, because a name shown in full wraps and
   * `scrollWidth` then equals `clientWidth` — measuring an open name would
   * report it as fitting and take away the control that shuts it again.
   */
  const measure = (): void => {
    if (openNames.has(key)) {
      row.setAttribute("data-name-long", "true");
      return;
    }
    row.setAttribute("data-name-long", String(name.scrollWidth > name.clientWidth + 1));
  };
  // Zero until the row is in the document, so the first answer has to come after
  // it is attached — and from a TIMER as well as from the observer, because a
  // ResizeObserver delivers before a paint and a note in a background tab (or a
  // pane nobody is looking at) may not paint for a long time. The observer is
  // what keeps the answer right afterwards: a card is half the note's column
  // wide, so dragging the sidebar changes which names fit.
  if (typeof ResizeObserver === "function") new ResizeObserver(measure).observe(name);
  window.setTimeout(measure, 0);
  measure();

  return row;
}

/**
 * The Daily Summary card — `{daysummary}` in a note.
 *
 * The design (Anima package WOY8B, screen `DaySummaryObsidian`) draws the same
 * block of ground the Task Goal card stands on, with the same two tiers of ink
 * and the same 15px corner, and swaps what is inside it. The heading is a word
 * rather than a target, the second line is the day's three figures said
 * together, and the expansion is a PARAGRAPH rather than a list of rows.
 *
 * IT HAS THE TASK GOAL CARD'S GUTTER (Anton, 2026-09-01): the same chevron, in
 * the same 39px lane, on the left of the text. It used to sit after the TITLE
 * and point LEFT while shut, and those two went together — a glyph in a
 * left-hand lane that points left points away from the card it opens — so it
 * turns the sibling's way now and shares its rules outright (styles.css). What
 * follows from the lane is the rest of that card's left-hand geometry: a 17px
 * inset, the 39px lane, a 17px gap, writing at 73. The card grew 380 -> 420 to
 * pay for it, which keeps the right inset at the export's own 34 and the text
 * lane at the 313 it drew at 380. (MEASURED off the export at 380, before the
 * lane: the title, the stats and all five lines of the body had a text origin of
 * 34.0 ± 0.1 — which is that same 17 twice, with the lane taken out.)
 *
 * The BODY is 14px against the header's 16, and it takes the loud tier rather
 * than a third one. Its weight is 500 — the same as the header's TITLE and not
 * the same as the header's figure, which is 600. That looks like an
 * inconsistency and is the export's own: at 14px a 600 paragraph reads as a
 * heading, and the two tiers this card shares with its sibling are a matter of
 * INK, which the body takes at the loud end because it is what the card is for.
 *
 * The colours are Obsidian's throughout, exactly as the Task Goal card takes
 * them — see styles.css. The export paints this in Happy Squid's blue and none
 * of it is used, for the reason `.hs-start-task` documented first: a plugin that
 * hardcoded our palette would be a foreign object in the themes people run.
 *
 * A `<span>` throughout with flex layout, for the Task Goal card's reason:
 * reading view hands us a text node inside a `<p>`, and a `<div>` there is
 * invalid nesting that browsers repair by splitting the paragraph.
 */
export function buildDaySummaryCard(rendered: { day: DaySummary; date: string }): HTMLElement {
  const { day, date } = rendered;
  const card = createSpan();
  card.className = "hs-daysum";
  card.setAttribute("aria-label", DAY_SUMMARY_TITLE);

  const head = createSpan();
  // The header is TWO lines and centres its one, exactly as the Task Goal card's
  // does on a day whose goal was off. Its three figures can all be switched off
  // in the settings panel, and an empty stats line would otherwise hold the
  // stack's 7px gap open under the title and leave the card reading bottom-heavy
  // beside a chevron that is centred.
  head.className = day.stats.length > 0 ? "hs-daysum-head" : "hs-daysum-head hs-daysum-head--single";
  card.appendChild(head);

  // The gutter is the Task Goal card's lane, and like that card's it is drawn
  // whether or not there is a chevron to put in it: without it, a day gaining
  // its summary the next morning would step every line of the card sideways.
  const gutter = createSpan();
  gutter.className = "hs-daysum-gutter";
  head.appendChild(gutter);

  // The two lines stand beside the lane as a column of their own, which is what
  // lets the gutter centre on both of them at once.
  const titles = createSpan();
  titles.className = "hs-daysum-titles";
  const title = createSpan();
  title.className = "hs-daysum-title";
  title.textContent = DAY_SUMMARY_TITLE;
  titles.appendChild(title);

  // The figures, each in its own unbreakable span with the separator drawn
  // between them — so the line wraps at a middle dot rather than parting "8"
  // from "blocks". See DaySummary.stats for why it wraps at all.
  //
  // NOT BUILT AT ALL when there are none, which is every figure switched off in
  // the settings panel: an empty element still holds the stack's gap open, and
  // the card is a title on its own in that case. There is no message about it
  // and there should not be — the switches are two clicks away, and a card
  // saying what the reader turned off would be copy nobody designed.
  if (day.stats.length > 0) {
    const stats = createSpan();
    stats.className = "hs-daysum-stats";
    day.stats.forEach((term, i) => {
      // The separator goes in as a bare TEXT NODE: nothing styles it, and it
      // exists only so the two terms either side of it can be unbreakable while
      // the line still has somewhere to break. Drawn BETWEEN whatever terms
      // there are, so hiding one leaves the dots right with nothing to tell.
      if (i > 0) stats.appendChild(document.createTextNode(DAY_SUMMARY_SEPARATOR));
      const span = createSpan();
      span.className = "hs-daysum-stat";
      span.textContent = term;
      stats.appendChild(span);
    });
    titles.appendChild(stats);
  }
  head.appendChild(titles);

  const body = createSpan();
  body.className = "hs-daysum-body";
  card.appendChild(body);

  /** Draws the open/shut state. The paragraph is built and torn down rather than
   *  hidden, matching the Task Goal card's rows: a shut card costs nothing. */
  const paint = (): void => {
    const open = openSummaries.has(date);
    card.setAttribute("data-expanded", String(open));
    head.setAttribute("aria-expanded", String(open));
    body.textContent = open ? day.summary : "";
  };

  // NO chevron and nothing to press on a day the squid has not written about,
  // which is every part of the day the note is being written on — the fold
  // happens the next morning. The same "nothing to expand" the Task Goal card
  // gives a day with no tasks, and the same answer for a day whose seven days
  // ran out before this vault was next opened.
  if (day.summary) {
    gutter.appendChild(chevronSvg());
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    const toggle = (e: Event) => {
      e.preventDefault();
      if (openSummaries.has(date)) openSummaries.delete(date);
      else openSummaries.add(date);
      paint();
    };
    // mousedown rather than click, matching every other control in this plugin:
    // in the editor a click would have moved the caret before it landed.
    head.addEventListener("mousedown", toggle);
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") toggle(e);
    });
  }
  paint();

  return card;
}

// ── Live Preview ────────────────────────────────────────────────────────────

class GoalCardWidget extends WidgetType {
  constructor(private card: { goal: GoalValue | null; date: string; tasks: SnapshotTask[] }) {
    super();
  }

  /** Compared by what is DRAWN rather than by the value behind it, so a logged
   *  figure that moves by a second — under the minute the card prints — does not
   *  rebuild the DOM and drop a reveal the user is mid-way through reading. The
   *  ROWS are part of that: a task ending while the note is open has to reach a
   *  card that is already expanded, and nothing else about the goal need have
   *  moved for it to. Rebuilding does not lose the expansion — that lives in
   *  `openDays`, outside every widget — so this is only about doing no work. */
  eq(other: GoalCardWidget): boolean {
    const a = goalText(this.card.goal);
    const b = goalText(other.card.goal);
    if (a.title !== b.title || a.progress !== b.progress || a.streakLabel !== b.streakLabel) return false;
    return this.card.date === other.card.date && sameRows(this.card.tasks, other.card.tasks);
  }

  toDOM(): HTMLElement {
    return buildGoalCard(this.card);
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** The Daily Summary card in the editor. Compared by what is DRAWN, exactly as
 *  the goal card's widget is: the header's figures move under the minute they
 *  print, and a rebuild for a change nobody can see would drop a card the user
 *  is mid-way through reading. (The EXPANSION survives a rebuild either way —
 *  it lives in `openSummaries`, outside every widget — so this is only about
 *  doing no work.) */
class DaySummaryWidget extends WidgetType {
  constructor(private card: { day: DaySummary; date: string }) {
    super();
  }

  eq(other: DaySummaryWidget): boolean {
    return (
      this.card.date === other.card.date &&
      daySummaryLine(this.card.day) === daySummaryLine(other.card.day) &&
      this.card.day.summary === other.card.day.summary
    );
  }

  toDOM(): HTMLElement {
    return buildDaySummaryCard(this.card);
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * `{tasktime}` — the figure alone.
 *
 * A bare `<span>` carrying nothing: no class, no styles, no `hs-` anything. A
 * widget still has to be an element (CodeMirror will not take a text node), and
 * an unstyled span is the closest thing to one — every property that decides how
 * text looks is inherited, so the mark decorations Obsidian wraps the range in
 * for `**bold**`, a heading or a callout reach straight through it. Give it a
 * class and the first theme that styles our class breaks that.
 */
class TaskTimeWidget extends WidgetType {
  constructor(private text: string) {
    super();
  }

  eq(other: TaskTimeWidget): boolean {
    return this.text === other.text;
  }

  toDOM(): HTMLElement {
    const span = createSpan();
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Two lists of rows, compared by what a row DRAWS. Beside `GoalCardWidget.eq`
 *  for the same reason `goalText` is: a figure moving by a second under the
 *  minute the row prints is not a change anybody can see. */
function sameRows(a: SnapshotTask[], b: SnapshotTask[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((task, i) => {
    const x = taskRowText(task);
    const y = taskRowText(b[i]);
    return task.id === b[i].id && x.time === y.time && x.meta === y.meta && x.name === y.name;
  });
}

function widgetFor(rendered: Rendered): WidgetType {
  if (rendered.kind === "card") return new GoalCardWidget(rendered);
  if (rendered.kind === "daysummary") return new DaySummaryWidget(rendered);
  return new TaskTimeWidget(rendered.text);
}

function buildDecorations(view: EditorView, resolve: GoalResolver, scan: MarkerScanner): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sel = view.state.selection.main;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      for (const found of scan(line.text)) {
        const start = line.from + found.from;
        const end = line.from + found.to;
        // Reveal the raw text while the caret is STRICTLY inside it, which is
        // how the marker gets edited or deleted. Merely adjacent does not count,
        // for the reason the start-task control documents: the caret sits at the
        // end of the line the whole time the user is typing.
        if (sel.from < end && sel.to > start) continue;
        // Nothing to draw leaves the marker as the raw text the user typed —
        // a date that does not parse, no goal, signed out, or a day nobody
        // recorded. See goalForDay, and CLAUDE.md on not inventing a message.
        const rendered = resolve(found);
        if (!rendered) continue;
        builder.add(start, end, Decoration.replace({ widget: widgetFor(rendered) }));
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/** `version` is what the account last said, bumped by TaskStates. A goal moving
 *  changes no text, so without watching it the card would keep its old figures
 *  until the user happened to type on the line. */
export function goalCardExtension(resolve: GoalResolver, scan: MarkerScanner, version: () => number): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private seenVersion: number;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, resolve, scan);
        this.seenVersion = version();
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet || this.seenVersion !== version()) {
          this.decorations = buildDecorations(update.view, resolve, scan);
          this.seenVersion = version();
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ── Reading view ────────────────────────────────────────────────────────────

/**
 * The same card in reading view, which is a separate rendering path and needs
 * its own pass — a plugin that only does the editor works where the author is
 * not looking and reads as broken.
 *
 * It REDRAWS, as the start-task control next door does: a goal card is a live
 * figure that moves while nobody touches the note at all, and "always in sync"
 * is the whole of what it promises. So each card becomes a
 * `MarkdownRenderChild` — Obsidian's own mechanism for a rendered element with
 * a lifetime — which subscribes on load and is unsubscribed for us when the
 * note is closed or re-rendered.
 */
class GoalCardChild extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private found: FoundMarker,
    private resolve: GoalResolver,
    private subscribe: (fn: () => void) => () => void,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.draw();
    this.register(this.subscribe(() => this.draw()));
  }

  private draw(): void {
    const rendered = this.resolve(this.found);
    this.containerEl.empty();
    // Nothing to draw puts the marker's own text back — the WHOLE of it, argument
    // included, so a mistyped date stays on the page as the user typed it rather
    // than being quietly rewritten to something they did not ask for.
    if (!rendered) {
      this.containerEl.setText(rawMarkerText(this.found));
      return;
    }
    // A figure goes in as TEXT, inside the holder span, which carries no class
    // and no styling — so it inherits the bold, the heading, the table cell or
    // the callout the user wrapped the marker in. A card brings its own ground.
    if (rendered.kind === "text") {
      this.containerEl.setText(rendered.text);
      return;
    }
    this.containerEl.appendChild(
      rendered.kind === "daysummary" ? buildDaySummaryCard(rendered) : buildGoalCard(rendered),
    );
  }
}

export function decorateGoalCards(
  el: HTMLElement,
  resolve: GoalResolver,
  scan: MarkerScanner,
  subscribe: (fn: () => void) => () => void,
  ctx: MarkdownPostProcessorContext,
): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const hits: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue !== null && scan(node.nodeValue).length > 0) hits.push(node as Text);
    node = walker.nextNode();
  }
  for (const textNode of hits) {
    const text = textNode.nodeValue!;
    const frag = createFragment();
    const children: GoalCardChild[] = [];
    // Walked by POSITION rather than split on a fixed string: a marker now
    // carries an argument, so two of them in one line are two different lengths
    // and `split` has nothing constant to cut on.
    let cursor = 0;
    for (const found of scan(text)) {
      if (found.from > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, found.from)));
      const holder = createSpan();
      // Both CARDS get a holder the stylesheet lays out; a figure's holder
      // carries no class at all, so nothing of ours sits between the number and
      // whatever the user's markdown wrapped it in.
      if (found.name === "taskgoal") holder.className = "hs-goal-holder";
      if (found.name === "daysummary") holder.className = "hs-daysum-holder";
      frag.appendChild(holder);
      children.push(new GoalCardChild(holder, found, resolve, subscribe));
      cursor = found.to;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.parentNode?.replaceChild(frag, textNode);
    // Registered only once the holder is in the document: a child loads on
    // registration and draws straight away, and drawing into a detached
    // fragment would leave the card outside the tree Obsidian measures.
    for (const child of children) ctx.addChild(child);
  }
}
