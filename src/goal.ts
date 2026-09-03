import { formatGoalMinutes, formatMinutesSpaced } from "./vendor/format";
import { parseTimeToHour12 } from "./vendor/hour12";
import { dayKey, dayKeyStart } from "./vendor/day-key";

/**
 * The Task Goal as a NOTE asks for it, which is a different question from the
 * one every other surface asks.
 *
 * Home, Settings and the phone all draw the goal as it stands NOW. A note is
 * dated, and a dated page showing a live figure is wrong the day after it is
 * written: last Tuesday's note would say what this Tuesday has logged. So the
 * card is drawn for ONE DAY — the day the marker names (goal-marker.ts), which
 * is live while it is today and static once it has ended.
 *
 * That costs a record of past days, and where those days come FROM is the design
 * here. Three layers, narrowest first:
 *
 *   the live row      `model.taskGoal`, for a day still running.
 *   the account       `model.taskGoalDays`, the last eight ended days. This is
 *                     the RECOVERY layer: it can answer for days the vault was
 *                     shut for, which nothing on this side ever could.
 *   the vault         this file's snapshots, in `data.json`. The ARCHIVE: it
 *                     keeps what the account has already forgotten, a year deep.
 *
 * The account backfills the vault on every refresh (`absorbGoalDays`), so open
 * Obsidian once a week and the archive is complete — where a plugin banking only
 * what it happened to have open was full of holes by construction. Past that,
 * a day nobody recorded has no card, and no amount of care invents one: the
 * marker stays as the raw text the user typed.
 *
 * Importless past a few leaves, exactly as task-line.ts and note-context.ts are,
 * so `src/tests/obsidian/goal.test.ts` can hold it and it runs in the repo's
 * `npm run check` rather than behind a second test runner. Every import here is
 * a SPELLING and each one is deliberate: `formatGoalMinutes` and
 * `formatMinutesSpaced` from `src/shared/format.ts`, `parseTimeToHour12` from
 * `src/view/shared/hour12.ts`. Both files import nothing at all, so neither
 * drags any of the extension's graph in, and each function is the single place
 * its figure is spelled anywhere in the product — a goal ("every surface that
 * prints a goal figure goes through this, browser and phones alike, so none of
 * them can drift into days on their own"), a spendable budget, a time of day. A
 * further surface copying any of those rules would be exactly that drift, and
 * that pair of conditions — importless, and the one place the product already
 * spells this — is the whole test for adding another.
 */

export type GoalPeriod = "day" | "week";

/** `model.taskGoal`, as it comes off the `user_state` row. The Model's own type
 *  carries no more than this. */
export interface GoalValue {
  period: GoalPeriod;
  minutes: number;
  loggedMs: number;
  periodStart: number;
  streak: number;
  goalMet: boolean;
}

const MS_PER_MINUTE = 60_000;

/**
 * A Task Goal period turns over at MIDNIGHT, and mirroring that here is not a
 * detail — it is what makes "the day of the note" and "the day of the goal" the
 * same day. Everything else the extension measures per day hangs off
 * `usageResetTime` (4 AM), because those are about a browsing EVENING, which
 * midnight cuts in half. A goal is about a DAY's work. See src/update/task-goal.ts,
 * which takes no reset time at all for the same reason.
 */
function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The most recent Sunday at midnight at or before `ts` — the extension's
 *  `logicalWeekStart` at the goal's own boundary. */
function weekStart(ts: number): number {
  const d = new Date(dayStart(ts));
  d.setDate(d.getDate() - d.getDay()); // getDay() is 0 on Sunday.
  return d.getTime();
}

/** The start of the period of `period` that contains `ts`. */
export function goalPeriodStart(period: GoalPeriod, ts: number): number {
  return period === "week" ? weekStart(ts) : dayStart(ts);
}

/** The instant the period containing `ts` gives way to the next one. Used to ask
 *  whether a snapshot covers a note's day, so it has to step by the CALENDAR —
 *  a daylight-saving week is not 168 hours. */
export function goalPeriodEnd(period: GoalPeriod, ts: number): number {
  const start = goalPeriodStart(period, ts);
  const d = new Date(start);
  if (period === "week") d.setDate(d.getDate() + 7);
  else d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * The goal as it stands at `now`, rolled forward when `now` has left the period
 * the stored progress belongs to.
 *
 * A read-only twin of the reducer's `rolledTaskGoal`, and it exists for the same
 * reason the phone's Home screen calls that one before it renders: the stored
 * value is only rewritten when a device dispatches something, so a vault opened
 * the morning after a quiet night would otherwise print yesterday's logged time
 * as today's. Pure and idempotent, and it never writes anything back — the
 * account's copy is the extension's to roll.
 */
export function rollGoal(goal: GoalValue, now: number): GoalValue {
  const currentStart = goalPeriodStart(goal.period, now);
  if (currentStart <= goal.periodStart) return goal;
  // One millisecond before the current period starts falls inside the previous
  // one. Stepped by the calendar rather than by subtracting a fixed length, so a
  // daylight-saving shift cannot throw the comparison off.
  const previousStart = goalPeriodStart(goal.period, currentStart - 1);
  const storedStart = goalPeriodStart(goal.period, goal.periodStart);
  const streak = goal.goalMet && storedStart === previousStart ? goal.streak : 0;
  const rolled: GoalValue = { ...goal, loggedMs: 0, goalMet: false, periodStart: currentStart, streak };
  // A target of zero is met by the fresh period on the spot, with no completed
  // task behind it — the reducer's `settleGoalMet`, which is why a goal of
  // 0h 0m keeps a streak running. Zero is a real target, never an absent one.
  if (rolled.loggedMs >= rolled.minutes * MS_PER_MINUTE) {
    return { ...rolled, goalMet: true, streak: rolled.streak + 1 };
  }
  return rolled;
}

// ── What the card says ──────────────────────────────────────────────────────

export interface GoalText {
  title: string;
  /** "4h 17m logged · 1h 43m left" — the browser's own progress line, verbatim. */
  progress: string;
  /** "3 week streak". Empty when there is no streak, which is what leaves the
   *  flame slot empty exactly as it is left on every other surface. */
  streakLabel: string;
}

/** The card's three strings. Every one of them is a line some other surface
 *  already draws — nothing here is newly worded, which is the same rule the
 *  three Notice messages in main.ts follow. */
export const GOAL_DISABLED = "Task goals are disabled";

export function goalText(goal: GoalValue | null): GoalText {
  // A day the vault KNOWS about but that had no goal says so, on the card's one
  // loud line, rather than falling back to the raw `{taskgoal}` text (Anton,
  // 2026-09-01). It is the same answer the four figures give by printing a zero:
  // "there was no goal" is a fact about the day, and a marker that silently
  // stops drawing reads as broken. There is no period to name, so the card drops
  // its title line and the stack centres what is left.
  if (goal === null) return { title: "", progress: GOAL_DISABLED, streakLabel: "" };
  const loggedMinutes = goal.loggedMs / MS_PER_MINUTE;
  const logged = formatGoalMinutes(loggedMinutes);
  const left = formatGoalMinutes(Math.max(0, goal.minutes - loggedMinutes));
  return {
    title: goal.period === "week" ? "Weekly Task Goal" : "Daily Task Goal",
    progress: `${logged} logged · ${left} left`,
    streakLabel: goal.streak > 0 ? `${goal.streak} ${goal.period === "week" ? "week" : "day"} streak` : "",
  };
}
// ── The record of days already seen ─────────────────────────────────────────

/**
 * One DAY's figures.
 *
 * The shape mirrors the account's own `TaskDay` (shared/types.ts), because all
 * of what lands here comes straight off it: the extension keeps the last eight
 * days and the plugin copies them in. What the plugin adds is DEPTH — the
 * account's window is a week, and a note is re-read a year later, so the vault
 * keeps every day it has ever been handed.
 *
 * FOUR facts, one per marker: the task work (`{tasktime}`), the goal laid over
 * it (`{taskgoal}`), the blocks (`{timesblocked}`) and the Free Time spent
 * (`{freetime}`) — plus two things no marker of their own prints, the day's task
 * LIST and the squid's own account of the day, which are what the two cards
 * expand to show.
 *
 * That division is the whole of the design. The account is the RECOVERY: it can
 * answer for days Obsidian was shut for, which no amount of care on this side
 * ever could. The vault is the ARCHIVE: it holds what the account has already
 * forgotten. Open the vault once a week and the archive is complete, where a
 * plugin banking only what it happened to see was full of holes by construction.
 */
export interface GoalSnapshot {
  /** `YYYY-MM-DD`. The key, and never a timestamp — see shared/day-key.ts. */
  date: string;
  /** Task work done on THIS DAY, in ms. The figure `{tasktime}` prints, and the
   *  one that is true whether or not a goal was ever configured. */
  loggedMs: number;
  /** The goal that governed this day, or null when there was none. Only
   *  `{taskgoal}` reads it. Null does NOT silence the card — it draws the day's
   *  block saying the goal was off, the same way `{tasktime}` answers such a day
   *  with the work it still recorded. Only a day with no ROW at all is silent. */
  goal: SnapshotGoal | null;
  /**
   * How many times the squid BLOCKED the user on this day — `{timesblocked}`.
   *
   * ABSENT rather than zero on a row that predates the counter, which is the
   * whole reason it is optional. A day nobody counted and a day nothing happened
   * on are two different answers, and this marker prints the second and stays
   * raw text for the first — the same rule the archive already applies to a row
   * with no `loggedMs` at all.
   */
  timesBlocked?: number;
  /** Free Time spent on this day, in ms — `{freetime}`. Absent on a row written
   *  before the counter existed, for `timesBlocked`'s reason. */
  freeTimeMs?: number;
  /**
   * When the user pressed the morning lock's Unlock button, as `HH:MM` on their
   * own 24-hour clock — `{morningbutton}`.
   *
   * Absent means NO PRESS, and that is the difference between this and the two
   * counters above. They answer zero on a day nothing happened, because a count
   * has a zero; a time does not, and most mornings nobody presses anything —
   * the lock is off, or the backstop took the wall down on its own. So the
   * marker stays as raw text there, exactly as `{taskgoal}` does on a day with
   * no goal.
   */
  morningUnlockTime?: string;
  /**
   * The tasks that ENDED on this day, oldest first — the rows the card lists
   * when it is expanded. The account's `TaskDay.tasks`.
   *
   * The one field here that is a LIST rather than a figure, and the only one no
   * marker of its own prints: it is what the `{taskgoal}` card's chevron opens.
   * `loggedMs` above is still the day's total and is never derived from this, so
   * a day whose list the account capped still prints the right figure.
   *
   * ABSENT and EMPTY are both "nothing to expand" as far as the card is
   * concerned — a day banked before the list existed, and a day nothing ended
   * on, are one answer on the page — so nothing downstream tells them apart.
   * The distinction is kept in the shape anyway, because it is a real one about
   * the record and costs nothing to preserve.
   */
  tasks?: SnapshotTask[];
  /**
   * What the squid WROTE about this day — `{daysummary}`'s expansion. The
   * account's `TaskDay.summary`.
   *
   * The one thing on this row nobody counted. Every other field is a figure the
   * extension measured; this is prose a model produced when the day was folded,
   * and it is here rather than read out of `history` because this record is the
   * one keyed by the day a dated note names — and because it is the layer that
   * gets ARCHIVED, which is what makes a summary readable in next year's note.
   *
   * That archiving is the one place this plugin outlives the account on purpose.
   * The extension deletes a summary after seven days on the device and on the
   * server (the privacy policy's own promise, kept twice — see
   * `TaskDay.summary`), and the vault keeps what it was handed while the promise
   * still held. The user asked for the sentence to be in their note; a note is
   * theirs and is not deleted on a schedule.
   *
   * ABSENT is ordinary and means several things at once, all of which draw the
   * same thing: the day has not been folded yet (every part of today), the fold
   * came back empty, the seven days ran out before this vault was next opened,
   * or the row predates the field. The card draws its header with no chevron —
   * the same "nothing to expand" the `{taskgoal}` card gives a day with no tasks.
   */
  summary?: string;
}

/**
 * One task that ended on a day — the account's `TaskDayTask`.
 *
 * `startedAt` is `HH:MM` on the user's own 24-hour clock, exactly as the account
 * stores it. `cancelled` is narrower than the history row's own word: it means
 * the user pressed Cancel, on a timed task, that they started in Happy Squid.
 */
export interface SnapshotTask {
  id: string;
  startedAt: string;
  name: string;
  workedMs: number;
  timesBlocked: number;
  cancelled?: true;
}

/** The Task Goal as it stood at one day's end — the account's `TaskDayGoal`. */
export interface SnapshotGoal {
  period: GoalPeriod;
  minutes: number;
  /** The PERIOD's running total as this day ended: the day's own work for a
   *  daily goal, and the week's climb for a weekly one. */
  periodLoggedMs: number;
  streak: number;
}

export type GoalSnapshots = Record<string, GoalSnapshot>;

/** Days kept. A little over a year, which is further back than a note is likely
 *  to be re-read and far enough that the bound is never what the user notices. */
export const MAX_SNAPSHOTS = 400;

/**
 * Folds the account's own day rows into the vault's archive.
 *
 * Additive and never destructive: a day the account has forgotten stays in the
 * archive, and a day both hold is taken from the ACCOUNT, which saw every device
 * where this saw one. This runs on every refresh, and returns the record it was
 * given when nothing moved, so an idle vault writes no disk.
 */
export function absorbGoalDays(snapshots: GoalSnapshots, days: GoalSnapshot[]): GoalSnapshots {
  let changed = false;
  const next = { ...snapshots };
  for (const day of days) {
    if (sameDay(next[day.date], day)) continue;
    next[day.date] = day;
    changed = true;
  }
  return changed ? pruneSnapshots(next) : snapshots;
}

function sameDay(a: GoalSnapshot | undefined, b: GoalSnapshot): boolean {
  if (!a || a.loggedMs !== b.loggedMs) return false;
  // The counters are part of this, or an archived row would never take on the
  // day's blocks once the account started carrying them — an idle vault writes
  // no disk precisely because this comparison decides whether anything moved.
  if (a.timesBlocked !== b.timesBlocked || a.freeTimeMs !== b.freeTimeMs) return false;
  if (a.morningUnlockTime !== b.morningUnlockTime) return false;
  // The prose too, and for the counters' reason: this comparison is what decides
  // whether anything moved, so leaving it out would mean an archived row never
  // took on the summary that landed the morning after the day it is about.
  if (a.summary !== b.summary) return false;
  // The list too, for the counters' reason: this comparison is what decides
  // whether anything moved, so a row left out of it would never take on the
  // day's tasks once the account started carrying them. Compared by what is
  // DRAWN rather than deep-equal, since that is the whole of what a change here
  // can mean to a note.
  if (!sameTasks(a.tasks, b.tasks)) return false;
  if (a.goal === null || b.goal === null) return a.goal === b.goal;
  return (
    a.goal.period === b.goal.period &&
    a.goal.minutes === b.goal.minutes &&
    a.goal.periodLoggedMs === b.goal.periodLoggedMs &&
    a.goal.streak === b.goal.streak
  );
}

function sameTasks(a: SnapshotTask[] | undefined, b: SnapshotTask[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.id === y.id &&
      x.startedAt === y.startedAt &&
      x.name === y.name &&
      x.workedMs === y.workedMs &&
      x.timesBlocked === y.timesBlocked &&
      x.cancelled === y.cancelled
    );
  });
}

/** Keeps the newest {@link MAX_SNAPSHOTS} days. Oldest first out, measured by
 *  the day covered rather than by when it was written, so a note opened from
 *  last year cannot evict this week. */
export function pruneSnapshots(snapshots: GoalSnapshots): GoalSnapshots {
  const entries = Object.entries(snapshots);
  if (entries.length <= MAX_SNAPSHOTS) return snapshots;
  entries.sort((a, b) => b[1].date.localeCompare(a[1].date));
  return Object.fromEntries(entries.slice(0, MAX_SNAPSHOTS));
}

/**
 * What a `{taskgoal}` card should show on `date`: the live goal for the day
 * still running, the archived figures for one that has ended, and null when
 * there is nothing to draw.
 *
 * Null covers signed out, no goal configured, a day the user had no goal on, and
 * a day nobody recorded — all of them "there is no card here", and all answered
 * by leaving the marker as the raw text the user typed. Nothing is announced: an
 * undesigned message is a bug (see CLAUDE.md), and a marker sitting there
 * unrendered is the same feedback an unconfigured control gives everywhere else
 * in this product.
 *
 * The live row is rolled first, exactly as Home and Settings roll it before they
 * render, so a vault left open past midnight does not print yesterday's total
 * under today's date.
 */
export function goalForDay(params: {
  live: GoalValue | null;
  snapshots: GoalSnapshots;
  date: string;
  now: number;
}): GoalValue | null {
  const { live, snapshots, date, now } = params;
  if (date === dayKey(now)) return live ? rollGoal(live, now) : null;
  const banked = snapshots[date]?.goal;
  if (!banked) return null;
  return {
    period: banked.period,
    minutes: banked.minutes,
    loggedMs: banked.periodLoggedMs,
    // The period the day belonged to, which the card never prints and
    // `goalText` never reads. Recomputed rather than stored: a banked day is
    // never rolled, so nothing downstream can be misled by it.
    periodStart: goalPeriodStart(banked.period, dayKeyStart(date) ?? now),
    streak: banked.streak,
    // Not recorded, and not needed: `goalMet` drives the reducer's streak
    // arithmetic and nothing the card draws.
    goalMet: false,
  };
}

/**
 * What `{tasktime}` should print on `date` — the day's own task work — or null
 * when the day is not one this vault can answer for.
 *
 * The difference from {@link goalForDay} above is the whole reason this marker
 * exists. It reads `loggedMs`, which is recorded with or without a Task Goal, so
 * a user who has never configured one still gets a figure; and it is the DAY's
 * own work rather than the period's running total, so a weekly goal does not
 * make it climb.
 *
 * TODAY is answered as zero rather than as null when there is nothing recorded,
 * and that is the one place the two markers deliberately differ. A day still
 * running is a day this vault is watching, so "no work yet" is a real answer and
 * `0m` is the honest thing to print — where falling back to raw text would read
 * as broken every morning until the first task completed. `signedIn` is what
 * makes that safe: signed out, nothing is being watched and there is no answer
 * to give.
 */
export function taskTimeForDay(params: {
  snapshots: GoalSnapshots;
  date: string;
  now: number;
  signedIn: boolean;
}): number | null {
  const recorded = params.snapshots[params.date];
  if (recorded) return recorded.loggedMs;
  return dayIsRecorded(params) ? 0 : null;
}

/**
 * Whether this vault can answer for `date` at all.
 *
 * A day with a row is one it was told about. TODAY is one it is WATCHING, so
 * "nothing yet" is a real answer and not a silence — which is what lets the
 * figures print a zero on a quiet morning instead of reading as broken, and what
 * lets `{taskgoal}` say the goal is off rather than falling back to raw text.
 * `signedIn` is what keeps that honest: signed out, nothing is being watched and
 * there is nothing to say.
 *
 * Pulled out because `{taskgoal}` and the four figures must answer for exactly
 * the same set of days. Two copies of this rule would drift into a card that
 * draws where a figure is silent, or the other way about, and neither would look
 * like a bug from the note.
 */
export function dayIsRecorded(params: {
  snapshots: GoalSnapshots;
  date: string;
  now: number;
  signedIn: boolean;
}): boolean {
  const { snapshots, date, now, signedIn } = params;
  if (snapshots[date]) return true;
  return signedIn && date === dayKey(now);
}

/** The day's task work as the product spells it everywhere else — "1h 13m",
 *  "47m", "0m". `formatGoalMinutes` is the single place a task figure is
 *  spelled, browser and phones alike, so this marker cannot drift into its own
 *  wording. */
export function taskTimeText(loggedMs: number): string {
  return formatGoalMinutes(loggedMs / MS_PER_MINUTE);
}

/**
 * What `{timesblocked}` should print on `date` — how many times the squid pulled
 * the user off a page that day — or null when this vault cannot answer for it.
 *
 * The same three-layer read as {@link taskTimeForDay} and the same rule for
 * today, with ONE case of its own: a row that exists but carries no count is a
 * row written before the counter did, and it answers NULL rather than zero. The
 * day happened, the work on it was recorded, and nobody was counting blocks —
 * printing "0" there would be a claim the record never made. It is a transitional
 * case in the account (eight days) and a permanent one in the archive, where a
 * note from before this feature is read for years.
 */
export function timesBlockedForDay(params: {
  snapshots: GoalSnapshots;
  date: string;
  now: number;
  signedIn: boolean;
}): number | null {
  return countedForDay(params, (row) => row.timesBlocked);
}

/**
 * What `{freetime}` should print on `date`, in ms — the Free Time spent that
 * day — or null when this vault cannot answer for it. {@link timesBlockedForDay}
 * in every respect but the field.
 *
 * The figure is what has been BANKED. A drain span still running is credited
 * when it closes, so a note read while a browser is burning Free Time in the
 * background is behind by that open span — the same way a RUNNING task is
 * missing from `{tasktime}` until it completes.
 */
export function freeTimeForDay(params: {
  snapshots: GoalSnapshots;
  date: string;
  now: number;
  signedIn: boolean;
}): number | null {
  return countedForDay(params, (row) => row.freeTimeMs);
}

/**
 * The shared read behind the two counters above.
 *
 * A COUNTER always answers a number for a day this vault knows about, and that
 * is the rule (Anton, 2026-08-30): a day with a row is a day that was watched,
 * so "none" is a real answer and `0m` is what it looks like. A row that carries
 * no counter at all — one banked before the counter existed — reads as zero too
 * rather than falling back to raw text, which costs the honest "nobody was
 * counting" for the handful of days that predate the feature and buys a figure
 * that always renders. Only a day with NO ROW is silent, which is the same
 * silence every other marker gives to a day nobody recorded.
 *
 * Today is a zero rather than a silence for its own reason: a day still running
 * is one this vault is watching, and "nothing yet" is a real answer. `signedIn`
 * is what keeps that honest, since signed out there is nothing being watched.
 */
function countedForDay(
  params: { snapshots: GoalSnapshots; date: string; now: number; signedIn: boolean },
  field: (row: GoalSnapshot) => number | undefined,
): number | null {
  const { snapshots, date, now, signedIn } = params;
  const recorded = snapshots[date];
  if (recorded) return field(recorded) ?? 0;
  if (!signedIn) return null;
  return date === dayKey(now) ? 0 : null;
}

/**
 * The tasks a `{taskgoal}` card lists when it is expanded, oldest first.
 *
 * No three-layer dance and no `signedIn`, unlike every reader above, and that is
 * because this one has nothing to be silent ABOUT. The other markers each print
 * a figure and have to choose between a real zero and raw text; this is a LIST,
 * and every reason it could be empty — no row for the day, a row banked before
 * the list existed, a day nothing ended on, signed out — comes to the same thing
 * on the page: no chevron, and the card exactly as it draws today.
 *
 * TODAY answers live. The account's own row for the day still running is written
 * as each task ends, and `state.ts` reads the whole `taskDays` array, so a task
 * finished ten minutes ago is already in here.
 */
export function tasksForDay(params: { snapshots: GoalSnapshots; date: string }): SnapshotTask[] {
  return params.snapshots[params.date]?.tasks ?? [];
}

/**
 * A day's task list, off whichever store it came from — the account's row or the
 * vault's archive — with anything that is not a whole row dropped.
 *
 * Lives here rather than beside either reader because BOTH need it and the two
 * must not drift: `state.ts` validates what arrives from `user_state` and
 * `store.ts` validates what comes back off disk a year later, and a row that one
 * accepted and the other refused would be a card that changed when the account's
 * eight-day window rolled past it.
 *
 * A malformed ROW is dropped on its own rather than taking the list with it,
 * which is the treatment the goal half already gets: one bad entry costs its own
 * line, not the whole expansion. A value that is not a list at all leaves the
 * field ABSENT — the day had no list rather than an empty one — and the card
 * draws the same thing either way.
 *
 * `startedAt` is checked against the 24-hour clock it is stored on, and `name`
 * is taken as-is: both are printed straight into a note, so what is refused here
 * is what would otherwise be printed as "undefined" or "NaN" next year.
 */
export function readSnapshotTasks(value: unknown): { tasks?: SnapshotTask[] } {
  if (!Array.isArray(value)) return {};
  const tasks: SnapshotTask[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const id = t["id"];
    const startedAt = t["startedAt"];
    const name = t["name"];
    const workedMs = t["workedMs"];
    const timesBlocked = t["timesBlocked"];
    if (typeof id !== "string" || id === "") continue;
    if (typeof startedAt !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startedAt)) continue;
    if (typeof name !== "string") continue;
    if (typeof workedMs !== "number" || !Number.isFinite(workedMs)) continue;
    if (typeof timesBlocked !== "number" || !Number.isFinite(timesBlocked)) continue;
    tasks.push({
      id,
      startedAt,
      name,
      workedMs,
      timesBlocked,
      // Anything other than the flag itself is no flag: a row is marked or it is
      // not, and a truthy stray must not put "cancelled" on somebody's task.
      ...(t["cancelled"] === true ? { cancelled: true as const } : {}),
    });
  }
  return { tasks };
}

/**
 * `{ summary }` for a readable one, `{}` for anything else — the guard both
 * stores share, beside `readSnapshotTasks` and for its reason: `state.ts`
 * validates what arrives from `user_state` and `store.ts` validates what comes
 * back off disk a year later, and a value one accepted and the other refused
 * would be a card that changed when the account's eight-day window rolled past
 * it.
 *
 * Trimmed and refused when empty, because the two are the same answer here: a
 * row carrying "" would draw a chevron opening onto nothing. Everything else is
 * taken as-is — it is prose, and the only claim this makes about it is that it
 * is a non-empty string.
 */
export function readSnapshotSummary(value: unknown): { summary?: string } {
  if (typeof value !== "string") return {};
  const text = value.trim();
  return text ? { summary: text } : {};
}

/** The three strings one task row prints. Split rather than pre-joined because
 *  the card sets them in three different places: the time in its own lane, the
 *  rest of the line beside it, and the name on the line below in the heavier of
 *  the card's two tiers. */
export interface TaskRowText {
  /** "12:13" — the START of the task. */
  time: string;
  /** "1h 17m worked · 13 blocks", with " · cancelled" on the end when it was. */
  meta: string;
  /** What the user called the task. */
  name: string;
}

/**
 * One row's words.
 *
 * The TIME is printed as the account stores it, on the 24-hour clock, and that
 * is a deliberate departure from `parseTimeToHour12` — which every other time in
 * this product goes through, `{morningbutton}` in this very file included. Anton
 * drew these rows at 24 hours (2026-09-01) and the design's own time column is
 * measured for it: "6:42 AM" is half again as wide as "12:13" and would push the
 * whole second column across. Two markers in one plugin therefore spell a clock
 * two ways, which is worth writing down rather than quietly fixing — the card is
 * a list of stamps in a column and the other is a sentence's worth of one time.
 *
 * Everything else is the product's own spelling. `formatGoalMinutes` is the
 * single place a task figure is spelled anywhere, so a row reads "1h 17m" beside
 * a header reading "4h 17m logged" with no chance of drift. The word is "worked"
 * where the header says "logged", which is the design's, and the separator is
 * the same middle dot the header already uses — so "cancelled" arrives as one
 * more term in a list rather than as a new kind of thing.
 */
export function taskRowText(task: SnapshotTask): TaskRowText {
  const worked = formatGoalMinutes(task.workedMs / MS_PER_MINUTE);
  const blocks = blocksLabel(task.timesBlocked);
  return {
    time: task.startedAt,
    meta: `${worked} worked · ${blocks}${task.cancelled ? " · cancelled" : ""}`,
    name: task.name,
  };
}

/** "13 blocks", "1 block". The one piece of counting language either card
 *  carries, said in one place so the task row and the Daily Summary header
 *  cannot come out differently — they sit in the same note and often on the same
 *  page. `{timesblocked}` deliberately does NOT go through this: a bare figure
 *  exists so the user writes their own words around it. */
function blocksLabel(count: number): string {
  return `${count} ${count === 1 ? "block" : "blocks"}`;
}

/** A day's morning, as `{morningbutton}` asks about it. `at` is the press, and
 *  null is a morning nobody pressed anything on — an answer in its own right,
 *  not a missing one, which is why this is a shape rather than a bare string. */
export interface MorningUnlock {
  at: string | null;
}

/**
 * What `{morningbutton}` should print on `date` — when the user pressed the
 * morning lock's Unlock button — or null when this vault cannot answer for the
 * day at all.
 *
 * The same three cases the counters have, and the same rule (Anton, 2026-08-30):
 * a day this vault knows about always answers. A row with a stamp answers the
 * press; a row WITHOUT one answers "no press", which is a real fact about that
 * morning — the lock was off, or the backstop took the wall down on its own —
 * and is what LABEL_NO_PRESS below spells. Only a day with no row is silent, and
 * that is the same silence every marker gives a day nobody recorded.
 *
 * Today with no row is a "no press" for the counters' reason: a day still
 * running is one this vault is watching, and the stamp appears the moment the
 * button is pressed. `signedIn` keeps that honest — signed out, nothing is being
 * watched and there is no answer to give.
 */
export function morningUnlockForDay(params: {
  snapshots: GoalSnapshots;
  date: string;
  now: number;
  signedIn: boolean;
}): MorningUnlock | null {
  const { snapshots, date, now, signedIn } = params;
  const recorded = snapshots[date];
  if (recorded) return { at: recorded.morningUnlockTime ?? null };
  if (!signedIn) return null;
  return date === dayKey(now) ? { at: null } : null;
}

/** A morning nobody pressed Unlock on. Anton's words (2026-08-30), and the one
 *  piece of copy this feature carries — every other marker answers such a
 *  morning with a figure, and a time has no zero to answer it with. */
export const LABEL_NO_PRESS = "no button unlock";

/**
 * The press as the product shows a time of day: "6:42 AM", "6 AM", "11:05 PM" —
 * or {@link LABEL_NO_PRESS} for a morning that had none.
 *
 * `parseTimeToHour12` is the single place the Model's 24-hour `HH:MM` becomes
 * the 12-hour clock, and every editor that shows a time — a block's schedule,
 * Free Time's disable window, the morning lock's own two boxes — already draws
 * its answer. An exact hour comes out bare ("6 AM"), which is what those boxes
 * show, so a note and the card the press came from spell one time one way.
 */
export function morningUnlockText(unlock: MorningUnlock): string {
  if (unlock.at === null) return LABEL_NO_PRESS;
  const time = parseTimeToHour12(unlock.at);
  return `${time.input} ${time.period}`;
}

/** A count, as a bare number: "0", "1", "7". No unit and no word — the marker's
 *  whole purpose is that the user writes the sentence around it, exactly as
 *  `{tasktime}` leaves them the styling. Inventing "3 times" here would be
 *  inventing copy nobody designed. */
export function timesBlockedText(count: number): string {
  return `${Math.max(0, Math.round(count))}`;
}

/** Free Time spent, as the product spells a Free Time figure everywhere else —
 *  "25m", "1h 19m", "0m". `formatMinutesSpaced` and NOT `formatGoalMinutes`
 *  beside it: a goal is a number of hours worked and collapses to hours however
 *  large, a spendable budget is what this is, and every pill, popup and
 *  menu-bar countdown that prints one already goes through that function. */
export function freeTimeText(freeTimeMs: number): string {
  return formatMinutesSpaced(freeTimeMs / MS_PER_MINUTE);
}

/**
 * What a `{daysummary}` card draws: the day's three figures as one line, and the
 * squid's own account of the day underneath it.
 *
 * TWO strings and not one, because they are two tiers on the card and only the
 * second can be missing. The header is what the card IS — a day the vault knows
 * about always has all three figures — and the body is what it expands to, which
 * is absent for most of the day the note is written on.
 */
export interface DaySummary {
  /**
   * The header's TERMS, in order: "3h 17m tasks", "47m free time", "8 blocks".
   * {@link daySummaryLine} joins them into the design's own line. Fewer than
   * three once the settings panel has hidden some, and EMPTY when it has hidden
   * all three — which the card draws as a header with no second line at all
   * rather than as a blank one holding its 7px gap open (see
   * DaySummaryVisibility, and `.hs-goal-head--single` next door for the same
   * answer to the same question).
   *
   * A list rather than that one string, and the reason is the one thing about
   * this card that is not the design's: it WRAPS. No width fixes it — a long day
   * ("10h 45m tasks · 10h 45m free time · 128 blocks") runs 100px past even the
   * design's own card. (The design's own line is 295px, which the 313px lane at
   * this card's floor now clears; it did not while the card was 380 wide and the
   * lane was 292, three pixels short. The floor is the Task Goal card's, so the
   * two line up in a note.)
   *
   * Since it has to wrap, it may as well wrap where a sentence does. Kept apart,
   * each term is drawn unbreakable and a wrap lands on a separator — "8" and
   * "blocks" cannot be parted, which is exactly what one string did.
   */
  stats: string[];
  /** The paragraph the squid wrote about the day, or "" when there is none —
   *  the fold has not happened yet, or the panel has hidden it. Empty is what
   *  leaves the card with no chevron and nothing to open, exactly as an empty
   *  task list does on the `{taskgoal}` card next door, so hiding it needed no
   *  new state anywhere. */
  summary: string;
}

/** The terms as the design draws them, on one line. What a reader that cannot
 *  break a line — a test, a plain-text copy — asks for. Empty when the panel has
 *  hidden all three, which is a line with nothing on it rather than a line of
 *  separators, since the dots are drawn BETWEEN whatever terms there are. */
export function daySummaryLine(day: DaySummary): string {
  return day.stats.join(DAY_SUMMARY_SEPARATOR);
}

/** The middle dot the Task Goal card's progress line and its task rows already
 *  separate terms with. Named because the card draws it as its own element,
 *  between two terms that must not break. */
export const DAY_SUMMARY_SEPARATOR = " · ";

/**
 * Which of the Daily Summary card's four parts are DRAWN.
 *
 * The plugin's own settings panel, and OPTICAL ONLY — which is the whole of what
 * has to be true about it. Nothing here reaches the account, nothing here stops
 * a figure being recorded, and a switch turned off and back on shows the same
 * numbers it hid. That is not a claim about intent, it is where the filter sits:
 * every figure is read, and the null that says "this vault cannot answer for
 * this day" is decided, BEFORE any of these is consulted — see daySummaryForDay.
 * So a hidden term cannot change whether the card appears, and cannot change
 * what any other term says.
 *
 * The first three name the same three facts `{tasktime}`, `{freetime}` and
 * `{timesblocked}` print on their own, and they do NOT reach those markers: this
 * is a setting about one card, not about the day. Somebody who wants the card
 * without its block count still has `{timesblocked}` to write the figure into a
 * sentence with, which is the whole reason those markers exist beside the card.
 */
export interface DaySummaryVisibility {
  /** "3h 17m tasks". */
  taskTime: boolean;
  /** "47m free time". */
  freeTime: boolean;
  /** "8 blocks". */
  timesBlocked: boolean;
  /** The paragraph the squid wrote. Hidden, the card has no chevron and nothing
   *  to open — the same state a day the fold has not reached yet is already in,
   *  so the card needed nothing new to draw for it. */
  summary: boolean;
}

/** Everything on, which is what a vault that has never opened the panel gets and
 *  what any unreadable stored value falls back to (store.ts). The default is ON
 *  in every direction on purpose: this is an optical setting, so failing towards
 *  showing MORE leaves a reader with the card they have always had. */
export const DAY_SUMMARY_ALL_VISIBLE: DaySummaryVisibility = {
  taskTime: true,
  freeTime: true,
  timesBlocked: true,
  summary: true,
};

/**
 * What `{daysummary}` should show on `date`, or null when this vault cannot
 * answer for the day at all.
 *
 * Composed from the three FIGURE readers above rather than reading the row
 * itself, which is the whole point of writing it this way: the three-layer read,
 * the rule that a day the vault knows about always answers, the zero for a row
 * that predates a counter and the silence for a day nobody recorded are already
 * decided there, and a fourth copy of any of them would be exactly the drift
 * this file keeps warning about. The three cannot disagree either — they all key
 * off the same row — so one null is all of them.
 *
 * The BODY is read straight off the row, and its absence is not a reason to
 * refuse the card: a note written today gets its header immediately and grows
 * its paragraph when the fold lands, which is the next morning. See
 * GoalSnapshot.summary.
 *
 * `visible` is applied LAST, and that ordering is what makes those switches
 * optical rather than structural (DaySummaryVisibility). All three figures are
 * read and the null is settled first, so hiding a term subtracts a string from
 * a list and does nothing else — it cannot silence a card, cannot change another
 * term, and cannot reach a single thing this plugin records.
 */
export function daySummaryForDay(params: {
  snapshots: GoalSnapshots;
  date: string;
  now: number;
  signedIn: boolean;
  visible: DaySummaryVisibility;
}): DaySummary | null {
  const loggedMs = taskTimeForDay(params);
  const freeTimeMs = freeTimeForDay(params);
  const timesBlocked = timesBlockedForDay(params);
  if (loggedMs === null || freeTimeMs === null || timesBlocked === null) return null;
  return {
    stats: daySummaryStats({ loggedMs, freeTimeMs, timesBlocked }, params.visible),
    summary: params.visible.summary ? (params.snapshots[params.date]?.summary ?? "") : "",
  };
}

/**
 * The header's terms — three of them, or fewer once the panel has hidden some.
 *
 * Every figure in them is spelled by the function the rest of the product spells
 * that figure with, and the three do not agree with each other on purpose:
 * `formatGoalMinutes` for task work (which collapses to hours however large) and
 * `formatMinutesSpaced` for a spendable budget, exactly as `{tasktime}` and
 * `{freetime}` already differ. The separator the card puts between them is the
 * middle dot the Task Goal card's own progress line and task rows already use.
 *
 * The words are the design's ("tasks", "free time", the block count), and
 * "tasks" does not pluralise because it is not a count — "3h 17m tasks" is an
 * amount of task time, where "8 blocks" is eight of something.
 *
 * Hiding one takes it OUT of the list rather than blanking it, which is what
 * leaves the separator right: the card draws a middle dot between the terms it
 * is given, so two terms come out with one dot and one term with none, and
 * nothing had to learn about the switches to get that.
 */
function daySummaryStats(
  day: { loggedMs: number; freeTimeMs: number; timesBlocked: number },
  visible: DaySummaryVisibility,
): string[] {
  const stats: string[] = [];
  if (visible.taskTime) stats.push(`${formatGoalMinutes(day.loggedMs / MS_PER_MINUTE)} tasks`);
  if (visible.freeTime) stats.push(`${formatMinutesSpaced(day.freeTimeMs / MS_PER_MINUTE)} free time`);
  if (visible.timesBlocked) stats.push(blocksLabel(day.timesBlocked));
  return stats;
}

/** The card's heading, which is the design's own words and the only fixed copy
 *  this marker carries. */
export const DAY_SUMMARY_TITLE = "Daily Summary";

// ── The marker ──────────────────────────────────────────────────────────────

/**
 * The disclosure chevron, traced from the Anima export at its own 7.157 x 12.284
 * and left pointing RIGHT.
 *
 * ONE glyph for every direction the card needs — right while a card is shut,
 * down while it is open, left on a task whose name is cut off — because they are
 * one glyph turned, and drawing three would be three things to keep in step.
 * goal-card.ts centres it in a square box so the turn is about its own middle.
 *
 * NOT the extension's own chevrons, which is worth saying because there are two
 * next door and neither is this: `ChevronIcon` (chrome.tsx) is a STROKED
 * 24-box path, and `ExceptionChevron` (BlockEditorScreen.tsx) is a filled 13x7
 * of slightly different proportion (12.11 x 6.96 against this one's 12.284 x
 * 7.157 turned). Copied from the export rather than reached for from either,
 * because the export is what Anton drew.
 *
 * Path data rather than a component, and in THIS file rather than beside the
 * drawing, for FLAME_PATH's reasons below.
 */
export const CHEVRON_PATH =
  "M40.8926 36C40.8926 36.2689 40.7832 36.515 40.5645 36.7383L35.3008 41.8857C35.2096 41.9723 35.1117 42.0384 35.0068 42.084C34.902 42.125 34.7858 42.1455 34.6582 42.1455C34.4896 42.1455 34.3346 42.1045 34.1934 42.0225C34.0521 41.9404 33.9404 41.8311 33.8584 41.6943C33.7764 41.5531 33.7354 41.3981 33.7354 41.2295C33.7354 40.9743 33.8288 40.751 34.0156 40.5596L39.0195 35.6855V36.3076L34.0156 31.4473C33.8288 31.2559 33.7354 31.0326 33.7354 30.7773C33.7354 30.6087 33.7764 30.4561 33.8584 30.3193C33.9404 30.1781 34.0521 30.0664 34.1934 29.9844C34.3346 29.9023 34.4896 29.8613 34.6582 29.8613C34.9089 29.8613 35.1208 29.9502 35.2939 30.1279L40.5645 35.2617C40.6738 35.3711 40.7559 35.4873 40.8105 35.6104C40.8607 35.7288 40.888 35.8587 40.8926 36Z";

/** The streak flame, the extension's own glyph at its own 18x25 — copied as
 *  PATH DATA rather than imported, because `src/view/components/Flame/Flame.tsx`
 *  is a React component and the card builds DOM by hand. It lives in THIS file
 *  rather than beside the drawing so the extension's suite can pin it against
 *  the original: goal-card.ts imports CodeMirror and Obsidian, neither of which
 *  resolves from the repo root where the tests run. */
export const FLAME_PATH =
  "M7.07517 0C12.9467 2.89927 14.5859 6.94111 11.7008 13.6881C12.8536 13.415 15.415 11.7493 15.3708 10.1788C15.3708 10.1788 16.8637 11.9333 17.3183 12.9931C17.7578 14.0159 18 15.1373 18 16.3128C18 21.1074 13.9672 25 9 25C4.03278 25 0 21.1074 0 16.3128C0 13.9154 1.34255 10.8319 5.13938 7.00947C7.01216 5.12396 8.18139 2.81769 7.07517 0Z";
