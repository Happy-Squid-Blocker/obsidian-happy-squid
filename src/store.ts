import {
  DAY_SUMMARY_ALL_VISIBLE,
  readSnapshotSummary,
  readSnapshotTasks,
  type DaySummaryVisibility,
  type GoalSnapshots,
  type SnapshotGoal,
} from "./goal";
import { dayKey, dayKeyStart } from "./vendor/day-key";

/**
 * The plugin's own `data.json`, with one writer.
 *
 * Five things live in it and they must not clobber each other: the Supabase
 * session (which supabase-js reads and writes through its storage adapter,
 * whenever it likes), the record of which completions have already been applied
 * to a note, the record of which re-wordings have already been written under
 * their line, the Task Goal figures already seen, and the Daily Summary card's
 * visibility switches. Before this, the session keys sat at the top level and
 * anything else written beside them raced the auth cache.
 *
 * Sessions written by an earlier build ARE migrated rather than dropped: their
 * keys are the `sb-…` ones at the top level, and losing them would sign the user
 * out on upgrade for no reason they could see.
 */
export interface PluginData {
  /** supabase-js's own keys, namespaced away from everything else. */
  auth: Record<string, string>;
  /**
   * `source_task_id`s whose completion has already ticked a box.
   *
   * Without it the plugin re-ticks forever: a completed intent row goes on
   * saying `completed` for as long as it is read, so a box the user deliberately
   * un-ticked was silently re-ticked at the next poll — which is exactly the
   * "it keeps completing itself" behaviour. Applying a completion is a
   * ONE-TIME event; this is what makes it one.
   */
  applied: string[];
  /**
   * The squid's re-wording already written under each pressed line, keyed by
   * that line's `source_task_id`.
   *
   * `applied`'s twin, for the same reason: the account goes on saying the task
   * runs under new words for as long as it runs, so without a record the line
   * the user deleted would be written again at the next poll. Keyed by the
   * pressed line and holding the running task's own id, so the SAME item
   * refused and re-worded again on another day gets its new line, while one
   * run writes exactly one. The title is kept so the completion that ends the
   * run can tick the line it wrote as well as the line the user pressed.
   */
  rewrites: Record<string, { taskId: string; title: string }>;
  /**
   * What each DAY ended on, keyed by its date — the vault's own archive.
   *
   * Not the only copy any more, and that is the point: the account keeps the
   * last eight ended days (`model.taskGoalDays`) and this absorbs them on every
   * refresh. The account is what can answer for days the vault was shut for;
   * this is what still answers a year later, once the account has forgotten. See
   * goal.ts, which lays the two layers out.
   */
  goals: GoalSnapshots;
  /**
   * Which parts of the Daily Summary card are drawn — the settings panel's four
   * switches, and the only thing in this file that is a PREFERENCE rather than a
   * record. It is here because it is the plugin's, not the account's: what a
   * note shows is a property of the vault it is read in, and syncing it would
   * make a switch thrown in one vault redraw another one's notes.
   *
   * Optical only, which is a fact about where it is applied rather than a
   * promise — see DaySummaryVisibility in goal.ts.
   */
  daySummary: DaySummaryVisibility;
}

/** Nothing on disk, or nothing readable there — a fresh object every time, since
 *  the caller owns what it is handed and one shared literal would be a record
 *  every vault in the process wrote into. */
function empty(): PluginData {
  return { auth: {}, applied: [], rewrites: {}, goals: {}, daySummary: { ...DAY_SUMMARY_ALL_VISIBLE } };
}

/** Reads whatever shape is on disk into the current one. */
export function readData(raw: unknown): PluginData {
  if (!raw || typeof raw !== "object") return empty();
  const obj = raw as Record<string, unknown>;
  const auth: Record<string, string> = {};
  // The current shape.
  if (obj.auth && typeof obj.auth === "object") {
    for (const [k, v] of Object.entries(obj.auth as Record<string, unknown>)) {
      if (typeof v === "string") auth[k] = v;
    }
  }
  // The old shape: session keys at the top level. Carried across so an upgrade
  // does not sign the user out.
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("sb-") && typeof v === "string") auth[k] = v;
  }
  const applied = Array.isArray(obj.applied) ? obj.applied.filter((x): x is string => typeof x === "string") : [];
  return {
    auth,
    applied,
    rewrites: readRewrites(obj.rewrites),
    goals: readGoals(obj.goals),
    daySummary: readDaySummary(obj.daySummary),
  };
}

/** The re-wording record, entry by entry: one that is not a whole `{ taskId,
 *  title }` is dropped, and dropping one costs at most a line written twice —
 *  the safe direction, where a half-read one could tick the wrong line. */
function readRewrites(raw: unknown): PluginData["rewrites"] {
  const out: PluginData["rewrites"] = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.taskId !== "string" || !entry.taskId || typeof entry.title !== "string" || !entry.title) continue;
    out[key] = { taskId: entry.taskId, title: entry.title };
  }
  return out;
}

/**
 * The Daily Summary card's four switches, defaulting ON in every direction.
 *
 * Anything that is not an explicit `false` is on: an absent key (every vault
 * that upgrades into this), an absent object, a value of the wrong type. That is
 * the deliberate direction for an OPTICAL setting — failing towards showing more
 * leaves a reader with the card they have always had, where failing the other
 * way would quietly empty it and read as the plugin breaking. Contrast
 * `readGoals` above, which drops what it cannot read: that is a RECORD, and half
 * a record prints "NaN" into somebody's note.
 */
function readDaySummary(raw: unknown): DaySummaryVisibility {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const on = (value: unknown): boolean => value !== false;
  return {
    taskTime: on(obj["taskTime"]),
    freeTime: on(obj["freeTime"]),
    timesBlocked: on(obj["timesBlocked"]),
    summary: on(obj["summary"]),
  };
}

/**
 * Snapshots off disk, dropping anything that is not a whole one.
 *
 * A half-written entry would print "NaN" into a note, so a row that does not
 * carry the day's own work is not a row. The GOAL half is optional and a bad one
 * is dropped on its own: `{tasktime}` needs only the work, so a row with a
 * broken goal still answers that marker rather than answering nothing. The two
 * COUNTERS are optional the same way, and for one reason more — absent is what
 * a row banked before they existed honestly says about that day.
 *
 * Rows written before the record was keyed by DATE are carried across where they
 * can be. Those keys were `${period}:${periodStart}`, with `periodStart` an
 * absolute millisecond anchor — the very thing shared/day-key.ts exists to
 * replace, since two devices computing the same day disagreed about the number.
 * A `day:` row names one day and migrates cleanly, its logged time being that
 * day's own. A `week:` row does NOT: it held a week's total as of whenever it
 * was last looked at, which is neither a day's work nor any particular day's
 * ending figure, and writing it under the Sunday would be inventing a day that
 * was never observed. Those are dropped, and the account's own eight-day window
 * refills the recent past at the next refresh.
 */
function readGoals(raw: unknown): GoalSnapshots {
  if (!raw || typeof raw !== "object") return {};
  const out: GoalSnapshots = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const g = value as Record<string, unknown>;
    const date = dateOf(key, g);
    if (date === null) continue;
    const loggedMs = finite(g["loggedMs"]);
    if (loggedMs === null) continue;
    // The two counters stay ABSENT when the archived row does not carry them —
    // a row banked before they existed knows nothing about that day's blocks,
    // which is not the same as knowing there were none. That distinction is
    // permanent here, where the account's is only eight days wide: a note from
    // last year is read out of this file for as long as the vault lives.
    out[date] = {
      date,
      loggedMs,
      goal: readGoalHalf(g),
      ...optionalCount("timesBlocked", g["timesBlocked"]),
      ...optionalCount("freeTimeMs", g["freeTimeMs"]),
      ...optionalClock(g["morningUnlockTime"]),
      ...readSnapshotTasks(g["tasks"]),
      ...readSnapshotSummary(g["summary"]),
    };
  }
  return out;
}

/** The goal half, in the current shape or in the flat one the first version of
 *  this record wrote (period/minutes/streak alongside a single `loggedMs`). */
function readGoalHalf(row: Record<string, unknown>): SnapshotGoal | null {
  const nested = row["goal"];
  const g = nested && typeof nested === "object" ? (nested as Record<string, unknown>) : row;
  const period = g["period"];
  if (period !== "day" && period !== "week") return null;
  const minutes = finite(g["minutes"]);
  const streak = finite(g["streak"]);
  // The flat shape had no separate period total — its one `loggedMs` WAS the
  // period's running figure, which is what the goal half wants.
  const periodLoggedMs = finite(g["periodLoggedMs"]) ?? finite(row["loggedMs"]);
  if (minutes === null || streak === null || periodLoggedMs === null) return null;
  return { period, minutes, periodLoggedMs, streak };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `{ key: n }` for a readable count, `{}` for one that is absent or malformed.
 *  A bad value must leave nothing behind rather than fall back to zero, since
 *  absent is a real state that a marker answers differently. */
function optionalCount<K extends string>(key: K, value: unknown): { [P in K]?: number } {
  const n = finite(value);
  return (n === null ? {} : { [key]: n }) as { [P in K]?: number };
}

/** `{ morningUnlockTime }` for a readable 24-hour `HH:MM`, `{}` for anything
 *  else — the archive's copy of state.ts's own guard, since this value is
 *  printed straight into a note and is read back for as long as the vault
 *  lives. */
function optionalClock(value: unknown): { morningUnlockTime?: string } {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? { morningUnlockTime: value } : {};
}

/** The day a stored row is about: its own `date` field, or — for a row written
 *  under the old millisecond keying — the day that row's `day:` anchor fell in.
 *  Null for anything else, which drops the row. */
function dateOf(key: string, row: Record<string, unknown>): string | null {
  if (typeof row["date"] === "string" && dayKeyStart(row["date"]) !== null) return row["date"];
  if (!key.startsWith("day:")) return null;
  const anchor = Number(key.slice("day:".length));
  return Number.isFinite(anchor) ? dayKey(anchor) : null;
}

/** Applied ids are kept bounded: the marker only ever asks about tasks a note
 *  still mentions, and an unbounded list would grow for the life of the vault. */
export const MAX_APPLIED = 500;

export function rememberApplied(applied: string[], id: string): string[] {
  if (applied.includes(id)) return applied;
  return [...applied, id].slice(-MAX_APPLIED);
}

/** Bounded the same way, oldest entry first out: the record only ever matters
 *  for a task a note still mentions. */
export function rememberRewrite(
  rewrites: PluginData["rewrites"],
  sourceTaskId: string,
  entry: { taskId: string; title: string },
): PluginData["rewrites"] {
  const next: PluginData["rewrites"] = { ...rewrites };
  delete next[sourceTaskId];
  next[sourceTaskId] = entry;
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_APPLIED))) delete next[key];
  return next;
}
