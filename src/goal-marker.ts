import { addDays, dayKey, dayKeyStart } from "./vendor/day-key";

/**
 * The DAY markers — `{taskgoal}`, `{daysummary}`, `{tasktime}`, `{timesblocked}`,
 * `{freetime}` and `{morningbutton}` — and the day each is about.
 *
 * The file's name is the first marker's, and stayed that way as the others
 * arrived: everything below is about the grammar they SHARE, and every one of
 * them reads a day out of the same record.
 *
 * The day used to be INFERRED — read out of the note's filename, its `date:`
 * frontmatter, or the vault's daily-note format — and every way that could go
 * wrong, it did: an ordinary note inside a folder called `2025-01-01 Archive`
 * read as New Year's Day 2025, a `date:` meaning a conference date sent the card
 * looking for a day that had not happened, a vault naming notes `DD-MM-YYYY` had
 * every note read as undated, and a note pre-created with the next-day arrow
 * drew nothing at all. None of those told the user anything; they all came out
 * as the same raw text.
 *
 * So the day is DECLARED now, and the marker carries it:
 *
 *   {taskgoal}             the day it was written. Live until that midnight,
 *                          then static forever — which it can only be by being
 *                          written down, so the plugin stamps it into the note
 *                          as the dated form below (see stampBareMarkers).
 *   {taskgoal:today}       always today, on whatever device is reading. Never
 *                          stamped, never frozen — the marker for a note that is
 *                          not about a day, in a dashboard or a permanent note.
 *   {taskgoal:template}    the marker for a TEMPLATE. Draws today's card where it
 *                          sits, so whoever is writing the template can see what
 *                          they are writing, and is unwrapped to a bare
 *                          `{taskgoal}` in each note CREATED from that template —
 *                          which the stamp then dates to the day that note was
 *                          made. See unwrapTemplateMarkers.
 *   {taskgoal:29.08.2026}  that day, forever.
 *
 * Nothing here reads the note, its name or its metadata, and that is the whole
 * point: the two questions a card needs answering — which day, and is that day
 * today — are both answered by the text the user (or their template) typed.
 *
 * `template` is what a bare marker in a template file needs and cannot be. A
 * template is an ordinary note, edited on the day it is written, so the stamp
 * rewrote the TEMPLATE with the day the template was authored and every note
 * ever made from it inherited that one frozen day — silently, since the card
 * still drew, just for the wrong day. The marker cannot be told apart from its
 * own copy by looking at either (they are the same eighteen characters), so the
 * thing that separates them is not a property of the text at all: a template is
 * never CREATED twice, and each note made from it is. That is why the unwrap
 * hangs off file creation and off nothing else.
 *
 * Importless past `day-key.ts`, which imports nothing itself, so
 * `src/tests/obsidian/` can hold this and it runs in the repo's `npm run check`
 * rather than behind a second test runner. Same rule as task-line.ts and
 * note-context.ts next door.
 */

/**
 * The six markers, which share everything but what they draw.
 *
 *   taskgoal      the Task Goal card — the phone's row, with a target and a streak.
 *   daysummary    the Daily Summary card — the day's three figures on one line,
 *                 expanding to the account the squid wrote of that day.
 *   tasktime      the day's task time as plain text, "1h 13m", and nothing else.
 *   timesblocked  how many times the squid blocked you that day, as a bare number.
 *   freetime      the Free Time you spent that day, "25m", spelled as the
 *                 product spells a budget everywhere else.
 *   morningbutton when you pressed the morning lock's Unlock button, "6:42 AM",
 *                 spelled as every time-of-day editor in the product spells one.
 *
 * Two of the six are CARDS and four are FIGURES, and each figure is a separate
 * marker rather than a mode of the first for the same reason: `{taskgoal}` is
 * about a goal, and on a day that had none its card says so rather than printing
 * a figure, where all four of these answer for a user who has never set one up. They are also four different facts about
 * a day, and nobody wants all of them in one place — the point of a bare figure
 * is that people build their own sentence around it.
 *
 * `{daysummary}` is the second CARD rather than a seventh figure because the one
 * thing it adds to the four is PROSE — a paragraph the squid wrote, which has
 * nowhere to go inside a sentence the user is building. Its own header line is
 * three of those same figures said together, which is deliberate duplication:
 * somebody who wants the numbers in their own words still has the four, and
 * somebody who wants the day at a glance has one marker rather than a sentence
 * they had to assemble.
 *
 * Single braces, matching `{task}` next door and for the same reason:
 * `{{double}}` is taken by Obsidian's core Templates plugin. None of them can
 * collide with `{task}` — that marker needs a `}` or a `:` straight after
 * "task", and these all have another letter there or another word entirely.
 */
export const MARKER_NAMES = [
  "taskgoal",
  "daysummary",
  "tasktime",
  "timesblocked",
  "freetime",
  "morningbutton",
] as const;

export type MarkerName = (typeof MARKER_NAMES)[number];

/** Every spelling of any marker, with its name and argument captured. The
 *  argument may be empty (`{taskgoal:}`), which reads as the bare form rather
 *  than as a broken date — a trailing colon is a typo, not an instruction.
 *
 *  Built FROM the list above rather than beside it. Everything in this file is
 *  shared by all six — the day grammar, `template`, the unwrap — so a seventh
 *  marker gets all of it by being added in one place, and cannot arrive with a
 *  regex that knows it and a type that does not. The tests iterate the same list
 *  for the same reason. */
const MARKER_RE = new RegExp(`\\{(${MARKER_NAMES.join("|")})(?::([^}]*))?\\}`, "g");

export type GoalMarker =
  /** `{taskgoal}` — the day it was written, once the plugin has stamped it. */
  | { kind: "bare" }
  /** `{taskgoal:today}` — whatever day it is being read on. */
  | { kind: "today" }
  /** `{taskgoal:template}` — today where it stands, bare in a note made from it. */
  | { kind: "template" }
  /** `{taskgoal:<date>}` — one day, as `YYYY-MM-DD`. */
  | { kind: "date"; date: string };

export interface FoundMarker {
  /** Which of the five markers this is. */
  name: MarkerName;
  /** Index of the `{`. */
  from: number;
  /** Index one past the `}`. */
  to: number;
  marker: GoalMarker | null;
  /** The text between `:` and `}`, or null for the bare form. Kept so a marker
   *  whose date does not parse can be left exactly as the user typed it. */
  argument: string | null;
}

/**
 * Every marker in `text`, in order.
 *
 * A marker whose argument is not a date it can read comes back with
 * `marker: null` rather than being skipped. The caller draws nothing for it and
 * leaves the raw text standing, which is the same answer this feature gives to
 * every other "there is no card here" — an undesigned error message would be a
 * bug (see CLAUDE.md), and the words the user typed are still on the page for
 * them to correct.
 */
export function findGoalMarkers(text: string): FoundMarker[] {
  const out: FoundMarker[] = [];
  // A fresh regex per call: MARKER_RE is global, and a shared one carries
  // `lastIndex` from the previous caller into this one.
  const re = new RegExp(MARKER_RE.source, "g");
  let m = re.exec(text);
  while (m !== null) {
    const argument = m[2] === undefined ? null : m[2];
    out.push({
      name: m[1] as MarkerName,
      from: m.index,
      to: m.index + m[0].length,
      marker: parseGoalMarker(argument),
      argument,
    });
    m = re.exec(text);
  }
  return out;
}

/** One marker's argument, read. `null` in means the bare form. */
export function parseGoalMarker(argument: string | null): GoalMarker | null {
  if (argument === null) return { kind: "bare" };
  const text = argument.trim();
  // A trailing colon with nothing after it is a typo mid-type, not a request.
  if (!text) return { kind: "bare" };
  if (text.toLowerCase() === "today") return { kind: "today" };
  if (text.toLowerCase() === "template") return { kind: "template" };
  const date = parseUserDate(text);
  return date === null ? null : { kind: "date", date };
}

/** The dated form of a marker, which is what a bare one is stamped into. Always
 *  ISO: it is the one spelling no locale reads as a different day, it sorts, and
 *  it is what `day-key.ts` produces — so the text in the note and the key it is
 *  looked up by are the same string. Every other spelling is still ACCEPTED on
 *  the way in; only what the plugin writes itself is pinned. */
export function markerFor(name: MarkerName, date: string): string {
  return `{${name}:${date}}`;
}

/**
 * The text with every `:template` marker unwrapped to its bare form, or null
 * when there was none to unwrap.
 *
 * Called on a note the moment it is CREATED, which is the whole of what tells a
 * template apart from a note made from one — see the block at the top of this
 * file. The bare markers it leaves behind are then dated by the ordinary stamp,
 * so the note ends up carrying the day it was made rather than the day its
 * template was authored, and nothing here needs to know what day it is.
 *
 * Back to front, because every unwrap SHORTENS the text: a forward pass would
 * read the second marker's indices against a document that had already moved
 * under it. The same reason `stampBareMarkers` applies its changes in reverse.
 */
export function unwrapTemplateMarkers(text: string): string | null {
  const found = findGoalMarkers(text).filter((f) => f.marker?.kind === "template");
  if (found.length === 0) return null;
  let out = text;
  for (const marker of found.reverse()) {
    out = `${out.slice(0, marker.from)}{${marker.name}}${out.slice(marker.to)}`;
  }
  return out;
}

/** The raw text of a found marker, for putting back when there is nothing to
 *  draw — the argument included, so a mistyped date stays on the page as the
 *  user wrote it rather than being quietly rewritten. */
export function rawMarkerText(found: FoundMarker): string {
  return found.argument === null ? `{${found.name}}` : `{${found.name}:${found.argument}}`;
}

// ── Reading a date a human wrote ────────────────────────────────────────────

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Three numbers separated by one of the characters a date is written with, the
 *  same character both times. `29.08.2026`, `2026-08-29`, `29/8/26`. */
const NUMERIC_RE = /^(\d{1,4})([-_./])(\d{1,2})\2(\d{1,4})$/;
/** A date with the month spelled out, in either order: `29 Aug 2026`,
 *  `August 29, 2026`. The comma and the ordinal suffix are optional noise. */
const NAMED_DMY_RE = /^(\d{1,2})(?:st|nd|rd|th)?[ ,-]+([A-Za-z]{3,})[ ,-]+(\d{2,4})$/;
const NAMED_MDY_RE = /^([A-Za-z]{3,})[ ,-]+(\d{1,2})(?:st|nd|rd|th)?[ ,-]+(\d{2,4})$/;

/**
 * A date as a person writes it, as `YYYY-MM-DD`, or null.
 *
 * **Cleanly separated only, and the MONTH is the middle field.** `29.08.2026`,
 * `2026-08-29`, `29/8/26` and `29_08_2026` read; the American `08/29/2026` does
 * not, and neither does the run-together `20260829` (Anton, 2026-08-30). Both
 * refusals leave the marker as raw text for the user to correct rather than
 * guessing at it.
 *
 * The compact form goes because a run of eight digits is not a date on sight —
 * to a reader or to this. Notes are full of bare numbers that are not days, a
 * Zettelkasten id most of all, and the separator is the whole of what says "this
 * is a date" rather than a number that happens to be eight long.
 *
 * That is deliberately blunter than it could be. `05/06/2026` is the 5th of June
 * to half the world and the 6th of May to the other half, and the earlier answer
 * was to read the vault's own daily-note format and follow its field order.
 * Anton dropped it (2026-08-30): a rule the user can state in one sentence beats
 * one that is right more often but depends on another plugin's settings file,
 * and it takes the plugin out of the business of reading those files entirely.
 * Anyone whose habit is month-first has two spellings that always work —
 * `2026-08-29` and `Aug 29, 2026` — and the stamp writes ISO regardless.
 *
 * A SPELLED-OUT month is exempt, in either position: "August" can only be a
 * month, so `August 29, 2026` carries no ambiguity for the middle rule to
 * resolve.
 *
 * A two-digit year is this century. Moment's own pivot is 68, and somebody
 * writing `29.08.26` in a note is not filing it under 1926.
 */
export function parseUserDate(text: string): string | null {
  const trimmed = text.trim();

  const named = NAMED_DMY_RE.exec(trimmed);
  if (named) return build(year(named[3]), monthByName(named[2]), Number(named[1]));
  const namedFirst = NAMED_MDY_RE.exec(trimmed);
  if (namedFirst) return build(year(namedFirst[3]), monthByName(namedFirst[1]), Number(namedFirst[2]));

  const numeric = NUMERIC_RE.exec(trimmed);
  if (!numeric) return null;
  const [a, month, c] = [numeric[1], Number(numeric[3]), numeric[4]];
  // A four-digit leading field is a year, so the rest is year-month-day.
  // Anything else is day-month-year. Either way the month is in the middle, and
  // `build` refuses a middle field that is not one.
  return a.length === 4 ? build(Number(a), month, Number(c)) : build(year(c), month, Number(a));
}

function year(text: string): number {
  const n = Number(text);
  return text.length <= 2 ? 2000 + n : n;
}

/** A month by its name or its usual abbreviation, 1-based, or 0 for none. `Sept`
 *  is handled by matching on the PREFIX rather than on a fixed length. */
function monthByName(text: string): number {
  const lower = text.toLowerCase();
  const exact = MONTH_NAMES.indexOf(lower);
  if (exact >= 0) return exact + 1;
  const matches = MONTH_NAMES.map((name, i) => (name.startsWith(lower.slice(0, 3)) ? i + 1 : 0)).filter((i) => i > 0);
  return matches.length === 1 ? matches[0] : 0;
}

/** The three numbers as a date key, or null when they are not a day. Real dates
 *  only — `2026-02-30` is arithmetic, and `dayKeyStart` is what catches it. */
function build(y: number, month: number, day: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (y < 1900 || y > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const key = `${y}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`;
  return dayKeyStart(key) === null ? null : key;
}

// ── Which day the card is about ─────────────────────────────────────────────

/** The date a marker is asking about at `now`, or null when it is asking about
 *  nothing readable. A bare marker is TODAY here — it has not been stamped yet,
 *  and the day it is written is the day it is first seen. */
export function markerDate(marker: GoalMarker, now: number): string {
  return marker.kind === "date" ? marker.date : dayKey(now);
}

/** Whether a marker's day is still running, which is what decides live figures
 *  against banked ones. `today` is live by definition, and a dated marker is
 *  live only on its own day. */
export function markerIsLive(marker: GoalMarker, now: number): boolean {
  return marker.kind !== "date" || marker.date === dayKey(now);
}

/** The day before `date`, for callers walking a week backwards. Re-exported so
 *  nothing downstream needs its own copy of the calendar. */
export { addDays, dayKey };
