import type { Auth } from "./auth";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import { readSnapshotSummary, readSnapshotTasks, type GoalSnapshot, type GoalValue, type SnapshotGoal } from "./goal";
import { notePathOf, taskIdFor } from "./task-line";
import { dayKeyStart } from "./vendor/day-key";

/**
 * What the marker in a note should SAY, read back from the account.
 *
 * The plugin was write-only until now: it could ask for a task and never learn
 * what became of it, so a control that had been pressed looked exactly like one
 * that had not. Two reads fix that, and both are of things the account already
 * holds rather than anything invented for this:
 *
 *  - `activeTask` is a synced Model key, so "is this task running" is answerable
 *    from any device without the plugin being told.
 *  - a refused check writes `result` onto the intent row it came from (see
 *    src/real/task-intent-result.ts), which is the only refusal a note has no
 *    other way to hear about.
 *
 * KEYED BY TITLE, not by the note path or the intent id, and that is what gives
 * "rewrite it and try again" for free: change the words on the line and it is a
 * different task, matching neither the running one nor any refusal, so the
 * marker falls back to "start task" with nothing to clear.
 */
export type TaskState =
  | { kind: "idle" }
  /** This exact task is the one running; `taskId` is what a stop names. */
  | { kind: "running"; taskId: string }
  | { kind: "refused"; detail: string }
  /** A locked task holds the slot. Rewriting this line changes nothing. */
  | { kind: "blocked"; detail: string }
  /** The free tier’s weekly allowance is spent. Rewriting changes nothing here
   *  either, and it is not a judgement about the task — see LABEL_SPENT. */
  | { kind: "spent"; detail: string }
  /** "start task" was pressed and the account has not answered yet — the
   *  plugin's own promise, drawn before the request is sent. See markPending. */
  | { kind: "starting" }
  /** The same promise for "stop task". */
  | { kind: "stopping" };

/** The ways a start is turned away, as the intent row spells them. One value per
 *  reason rather than a refusal and a catch-all, because a marker is the only
 *  place they are ever told apart and each asks the user for something different
 *  — see the labels in task-line.ts. */
type Refusal = "refused" | "blocked" | "spent";

const IDLE: TaskState = { kind: "idle" };

/** A press the account has not answered. See markPending. */
interface Pending {
  kind: "starting" | "stopping";
  /** The pressed line's id on the wire — see markPending for why the words
   *  alone are not enough. */
  sourceTaskId: string;
  /** The intent row the press made, once known — see attachIntent. */
  intentId: string | null;
  /** Bare `setTimeout`, not `window.setTimeout`: this file is held by the
   *  extension's node-side suite (src/tests/obsidian/) and has no window, and
   *  the timer is a bookkeeping deadline rather than anything a popout window
   *  could own. */
  timer: ReturnType<typeof setTimeout>;
}

/**
 * How long a press is drawn as pending with no answer.
 *
 * Long enough for the slowest ordinary path — an extension with no socket
 * hears of the intent at its 30-second sync alarm, the productivity check
 * takes seconds more, and the push, the plugin's socket and the refresh add a
 * couple — and short enough that a press nothing will ever answer is not a
 * face frozen mid-sentence for the rest of the session.
 */
export const PENDING_TTL_MS = 60_000;

/**
 * A running task whose words are the squid's rather than the note's.
 *
 * The productivity review can end with the model's own description of the task
 * (`{tool:productive: …}` on a turn the user argued), and the task then runs
 * under those words while `origin.taskId` still names the line the user
 * pressed. Everything here is keyed by words, so that task matched nothing: the
 * marker never read "stop task" and the completion never found a line to tick.
 * The plugin answers by writing the new wording under the old line — see
 * `writeRewrite` — and this is what tells it to. Keyed by the task's own id so
 * the same item refused and re-worded on another day gets its new line too.
 */
export interface TaskRewrite {
  /** The line the user pressed, as the intent named it. */
  sourceTaskId: string;
  /** The note that line was in when it was pressed — read off the id, which is
   *  the one string the hash was minted with. */
  notePath: string;
  /** The words the task is running under. */
  title: string;
  /** The running task's own id, so one re-wording is written once. */
  taskId: string;
}

export class TaskStates {
  private runningTitle: string | null = null;
  private runningTaskId: string | null = null;
  /** The running task's re-wording, when it has one. Not drawn — the new line
   *  it asks for draws itself off `runningTitle` like any other — so it stays
   *  out of `apply`'s comparison and is read by the refresh directly. */
  rewrite: TaskRewrite | null = null;
  private refused = new Map<string, { result: Refusal; detail: string }>();
  /** Presses the account has not answered, by the task's words. */
  private pending = new Map<string, Pending>();
  private listeners = new Set<() => void>();
  /** Bumped on every change so the editor decorations know to rebuild. */
  version = 0;
  /**
   * Tasks finished in Happy Squid whose checkbox may still be unticked.
   *
   * Kept as a plain list rather than folded into the state map because it is not
   * something a marker DRAWS — it is work for the plugin to do to the file. It
   * is rebuilt on every refresh and applying it is idempotent, so a row that
   * goes on saying `completed` costs one scan of a note and no edit.
   */
  completed: { title: string; sourceTaskId: string }[] = [];

  /**
   * `model.taskGoal` exactly as the account holds it — RAW, never rolled.
   *
   * Raw because rolling is a question about WHEN it is being drawn, and the
   * answer differs per marker: `{taskgoal:today}` wants it rolled to now, and a
   * dated marker does not want it at all. So the card rolls it (goalForDay), as
   * Home and Settings do before they render, and this holds what the account
   * said.
   */
  goal: GoalValue | null = null;

  /**
   * The last eight ended days, straight off `model.taskGoalDays`.
   *
   * The RECOVERY layer: the account stamps a day as it ends on whichever device
   * is awake, so a vault that was shut all weekend still learns what Friday came
   * to. The plugin folds these into its own archive on every refresh — see
   * absorbGoalDays, and goal.ts for why the two layers are not the same thing.
   */
  goalDays: GoalSnapshot[] = [];

  /**
   * Whether the account answered at all.
   *
   * `{tasktime:today}`, `{timesblocked:today}` and `{freetime:today}` all print
   * a zero for a day with nothing recorded yet, because a day still running is
   * one this vault is watching and "nothing yet" is a real answer. Signed out,
   * nothing is being watched and there is no answer to give — and without this
   * flag the two states are indistinguishable, since both leave the goal null
   * and the day list empty.
   */
  signedIn = false;

  constructor(private auth: Auth) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Ask every drawn marker to redraw.
   *
   * `apply` below calls it when the ACCOUNT moved, which is what this bus was
   * built for; the settings panel calls it when nothing moved but what the
   * markers should DRAW did — the Daily Summary card's visibility switches. Both
   * rendering paths are already subscribed to exactly these two things (the
   * editor extension rebuilds off `version`, the reading-view child off
   * `onChange`), so a second bus for the second reason would be two ways of
   * saying one thing to the same two listeners.
   */
  redraw(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  stateFor(title: string): TaskState {
    const key = title.trim();
    if (!key) return IDLE;
    // A press the account has not answered outranks whatever it said last: the
    // face is a promise about THIS press, and the running task or the old
    // refusal underneath it is exactly what the press is changing.
    const pending = this.pending.get(key);
    if (pending) return { kind: pending.kind };
    if (this.runningTitle === key && this.runningTaskId) {
      return { kind: "running", taskId: this.runningTaskId };
    }
    const hit = this.refused.get(key);
    if (!hit) return IDLE;
    // Each value carries straight through to its own face. It used to be a
    // ternary against "blocked", which meant a row saying anything else drew the
    // productivity verdict's words — fine while there were two, wrong the moment
    // a third arrived.
    return { kind: hit.result, detail: hit.detail };
  }

  /**
   * The running task's id when THIS LINE is the task running, or null.
   *
   * What a tick of the box asks (Anton, 2026-09-02: ticking completes the
   * task). A line is the running task by its WORDS, as every face is — or by
   * its wire id, which is the one case the faces do not cover: a task the
   * squid re-worded runs under its own title with `origin.taskId` still naming
   * the line the user pressed, and the plugin writes that wording as a second
   * line under theirs. The two are one item on the wire, and finishing in
   * Happy Squid ticks both, so ticking EITHER by hand is finishing it. The id
   * can only ever match the line it was minted from (the note's path and the
   * words are both in it), so this adds that one case and nothing else.
   *
   * Null while a press on the line is in flight, for the reason `press` sends
   * nothing then: the face already says the account has been asked.
   */
  runningTaskOf(title: string, sourceTaskId: string): string | null {
    const key = title.trim();
    if (!key || this.pending.has(key) || !this.runningTaskId) return null;
    if (this.runningTitle === key || this.runningTaskId === sourceTaskId) return this.runningTaskId;
    return null;
  }

  async refresh(): Promise<void> {
    const session = await this.auth.session();
    if (!session) {
      this.completed = [];
      this.goalDays = [];
      this.signedIn = false;
      this.rewrite = null;
      // Nothing will ever answer a press signed out, so none is kept.
      const dropped = this.dropAllPending();
      if (!this.apply(null, null, new Map(), null) && dropped) this.redraw();
      return;
    }
    const headers = {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    };
    try {
      const [taskRes, goalRes, refusedRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/user_state?select=value&key=eq.activeTask`, { headers }),
        // The same table and the same shape, one row along. `taskGoal` is a
        // synced Model key (src/shared/sync-keys.ts), so the goal a note draws
        // is the account's own and needs nothing invented for it.
        fetch(`${SUPABASE_URL}/rest/v1/user_state?select=key,value&key=in.(taskGoal,taskDays)`, { headers }),
        // Only this source's refusals, and only the ones a marker could still be
        // sitting in front of. A task refused last month is not news.
        fetch(
          `${SUPABASE_URL}/rest/v1/task_intents?select=id,source_task_id,payload,result,result_detail&source=eq.obsidian&kind=eq.start&result=not.is.null&order=created_at.desc&limit=40`,
          { headers },
        ),
      ]);
      if (!taskRes.ok || !refusedRes.ok) return;
      // Read BESIDE the task rather than gated with it: a failed goal read must
      // not cost the marker its face, and a goal that has never been set has no
      // row at all, which is a null and not an error.
      const goalRows: unknown = goalRes.ok ? await goalRes.json() : [];
      const goal = readGoal(rowValue(goalRows, "taskGoal"));
      // The account's own record of ended days. Read here rather than derived
      // from the row above because it is the one thing the row CANNOT say: it
      // holds a single period and wipes it at every rollover, so a day the vault
      // was shut for exists only in this list.
      this.goalDays = readGoalDays(rowValue(goalRows, "taskDays"));
      this.signedIn = true;

      const active = (await taskRes.json()) as { value: ActiveTaskRow | null }[];
      const task = active[0]?.value ?? null;
      const title = task?.origin?.source === "obsidian" ? (task.origin.title ?? null) : null;
      const taskId = task?.origin?.source === "obsidian" ? (task.origin.taskId ?? null) : null;
      this.rewrite = rewriteOf(task);

      const rows = (await refusedRes.json()) as OutcomeRow[];
      const refused = new Map<string, { result: Refusal; detail: string }>();
      const seen = new Set<string>();
      this.completed = [];
      for (const r of rows) {
        const t = r.payload?.origin?.title?.trim();
        if (!t || !r.result) continue;
        // The newest row for a title wins: the list is ordered newest first, so
        // the first one seen is the one that counts and older ones are history.
        if (seen.has(t)) continue;
        seen.add(t);
        if (r.result === "completed") this.completed.push({ title: t, sourceTaskId: r.source_task_id });
        else refused.set(t, { result: r.result, detail: r.result_detail ?? "" });
      }
      // A task that is RUNNING is not refused, whatever an older row says.
      if (title) refused.delete(title);
      // A press is settled by the account's answer to IT, before the faces are
      // compared: a verdict word-for-word the same as the one already drawn
      // moves nothing in `apply`, and the press still has to end.
      const settled = this.settlePending(title, taskId, rows);
      if (!this.apply(title, taskId, refused, goal) && settled) this.redraw();
    } catch (e) {
      console.warn("[happy-squid] state refresh failed", e);
    }
  }

  /**
   * The face a press wears until the account answers it.
   *
   * A press is a round trip through the Edge Function, a device's claim and —
   * for a start — the productivity check, so the control used to sit unchanged
   * for seconds looking unpressed, then flip. This records the press the moment
   * it is made, BEFORE the request is sent, and `stateFor` draws it as
   * "starting…" or "stopping…" over whatever the account said last. It outranks
   * the old answer because the old answer is exactly what the press is
   * changing.
   *
   * It ENDS on evidence about this press and on nothing else — see
   * settlePending — with one backstop: a press nothing ever answers (no device
   * awake to claim it, a socket that dropped) lapses after PENDING_TTL_MS and
   * the face falls back to what the account says, so a promise the plugin
   * cannot keep is not drawn forever. A request that FAILS is dropped at once
   * by the caller (dropPending), since there is then nothing to wait for.
   *
   * Keyed by the task's words, as every state here is, and carrying the line's
   * wire id beside them because the two can part company: a task the squid
   * re-words runs under its own title with `origin.taskId` still naming the
   * pressed line, and that start is this press's answer all the same.
   */
  markPending(kind: "starting" | "stopping", title: string, sourceTaskId: string): void {
    const key = title.trim();
    if (!key) return;
    this.forget(key);
    const timer = setTimeout(() => this.dropPending(key), PENDING_TTL_MS);
    this.pending.set(key, { kind, sourceTaskId, intentId: null, timer });
    this.redraw();
  }

  /**
   * Which intent row a start press made, learned once the POST has landed.
   *
   * The row is what a refusal is written onto, and a start can be refused with
   * the SAME words as the last one — a lock still held answers "A task is
   * already active." twice — which the title-keyed map cannot tell from no
   * news. The id can. A press already settled by the time the read returns
   * (the task started first) has nothing to attach to, and that is fine.
   */
  attachIntent(title: string, intentId: string): void {
    const pending = this.pending.get(title.trim());
    if (pending) pending.intentId = intentId;
  }

  /** Ends a press without an answer: the request failed, or it lapsed. */
  dropPending(title: string): void {
    if (this.forget(title.trim())) this.redraw();
  }

  /** Removes a pending press and its timer. True when there was one. */
  private forget(key: string): boolean {
    const pending = this.pending.get(key);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(key);
    return true;
  }

  private dropAllPending(): boolean {
    const had = this.pending.size > 0;
    for (const key of [...this.pending.keys()]) this.forget(key);
    return had;
  }

  /**
   * Ends every press the account has answered. True when any ended.
   *
   * A START is answered by that task running — matched by its words, or by
   * the pressed line's id when the squid re-worded it — or by a verdict on the
   * row the press made. A STOP is answered by that task no longer being the
   * one running, whatever replaced it; a complete the device declined because
   * the task had already been replaced is the same answer. Nothing else ends
   * one: another task starting, a refusal on an older row, or the account
   * simply not having heard yet all leave the face where the press put it.
   */
  private settlePending(runningTitle: string | null, runningTaskId: string | null, answered: OutcomeRow[]): boolean {
    let settled = false;
    for (const [key, pending] of this.pending) {
      const running = runningTitle === key || (runningTaskId !== null && runningTaskId === pending.sourceTaskId);
      const done =
        pending.kind === "starting"
          ? running || (pending.intentId !== null && answered.some((r) => r.id === pending.intentId))
          : !running;
      if (done) settled = this.forget(key) || settled;
    }
    return settled;
  }

  /** Takes the account's answer. True when a face changed and was redrawn. */
  private apply(
    title: string | null,
    taskId: string | null,
    refused: Map<string, { result: Refusal; detail: string }>,
    goal: GoalValue | null,
  ): boolean {
    const same =
      title === this.runningTitle &&
      taskId === this.runningTaskId &&
      // The goal has to be part of this. It moves with no task starting and no
      // refusal landing — a task completed on the phone credits it and nothing
      // else about this account changes — so a comparison that left it out would
      // hold the version still and leave every card in the vault showing the
      // figure it was drawn with. Compared by VALUE: the row is re-fetched every
      // poll, so identity would say "changed" twice a minute forever.
      sameGoal(goal, this.goal) &&
      refused.size === this.refused.size &&
      [...refused].every(([k, v]) => {
        const seen = this.refused.get(k);
        return seen?.result === v.result && seen?.detail === v.detail;
      });
    if (same) return false;
    this.runningTitle = title;
    this.runningTaskId = taskId;
    this.refused = refused;
    this.goal = goal;
    this.redraw();
    return true;
  }
}

type ActiveTaskRow = {
  id?: string;
  origin?: { source?: string; title?: string; taskId?: string };
};

/**
 * Whether the running task's words are the note's — null when they are, or
 * when there is no Obsidian task running at all. The test is the id: it was
 * minted from the words on the line, so words that hash to something else are
 * words the line does not hold.
 */
function rewriteOf(task: ActiveTaskRow | null): TaskRewrite | null {
  const origin = task?.origin;
  if (!task || !origin || origin.source !== "obsidian") return null;
  const title = origin.title?.trim() ?? "";
  const sourceTaskId = origin.taskId ?? "";
  const notePath = notePathOf(sourceTaskId);
  if (!title || !notePath || typeof task.id !== "string" || !task.id) return null;
  if (taskIdFor(notePath, title) === sourceTaskId) return null;
  return { sourceTaskId, notePath, title, taskId: task.id };
}

/**
 * `model.taskGoal` off its `user_state` row.
 *
 * Validated field by field rather than cast, which the two rows above can get
 * away with and this one cannot: they feed a LABEL, and a malformed one draws
 * the wrong word, while this feeds arithmetic — a missing `minutes` would print
 * "NaN left" in somebody's note. A row that is not a whole goal is no goal.
 */
function readGoal(value: unknown): GoalValue | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Record<string, unknown>;
  const period = g["period"];
  if (period !== "day" && period !== "week") return null;
  const num = (key: string): number | null => {
    const n = g[key];
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  const minutes = num("minutes");
  const loggedMs = num("loggedMs");
  const periodStart = num("periodStart");
  const streak = num("streak");
  if (minutes === null || loggedMs === null || periodStart === null || streak === null) return null;
  return { period, minutes, loggedMs, periodStart, streak, goalMet: g["goalMet"] === true };
}

/** Two goals as the card would tell them apart. `goalMet` is in it because it
 *  survives a rollover and decides the next period's streak, so a change there
 *  is a change the next card will show. */
function sameGoal(a: GoalValue | null, b: GoalValue | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.period === b.period &&
    a.minutes === b.minutes &&
    a.loggedMs === b.loggedMs &&
    a.periodStart === b.periodStart &&
    a.streak === b.streak &&
    a.goalMet === b.goalMet
  );
}

/** One key's value out of a multi-key `user_state` read. */
function rowValue(rows: unknown, key: string): unknown {
  if (!Array.isArray(rows)) return undefined;
  return (rows as { key?: string; value?: unknown }[]).find((r) => r.key === key)?.value;
}

/**
 * `model.taskDays` off its row.
 *
 * Validated field by field for `readGoal`'s reason, and one reason more: these
 * rows are ARCHIVED into `data.json` and read back for as long as the vault
 * lives, so a malformed one would print "NaN" into a note next year rather than
 * until the next refresh. A row that is not a whole day is no row.
 *
 * The GOAL half is optional and a bad one is dropped rather than taking the row
 * with it: the day's work is the more important of the two facts and the only
 * one `{tasktime}` needs, so a row with a half-written goal still answers that
 * marker instead of answering nothing.
 */
function readGoalDays(value: unknown): GoalSnapshot[] {
  if (!Array.isArray(value)) return [];
  const out: GoalSnapshot[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const g = raw as Record<string, unknown>;
    const date = g["date"];
    if (typeof date !== "string" || dayKeyStart(date) === null) continue;
    const loggedMs = finite(g["loggedMs"]);
    if (loggedMs === null) continue;
    // The counters are OPTIONAL and stay absent when the row does not carry
    // them — a row written by an extension that predates them knows nothing
    // about that day's blocks, which is a different answer from zero. Same
    // treatment as the goal half beside them: a bad one is dropped on its own
    // rather than taking the row with it.
    out.push({
      date,
      loggedMs,
      goal: readSnapshotGoal(g["goal"]),
      ...optionalCount("timesBlocked", g["timesBlocked"]),
      ...optionalCount("freeTimeMs", g["freeTimeMs"]),
      ...optionalClock(g["morningUnlockTime"]),
      // The day's task list, through the one validator both stores share so the
      // account's copy and the archive's can never disagree about a row.
      ...readSnapshotTasks(g["tasks"]),
      // The squid's own account of the day, the same way. Kept for seven days on
      // the account and for as long as the vault lives once absorbed, which is
      // the one place the archive deliberately outlives what it copied — see
      // GoalSnapshot.summary.
      ...readSnapshotSummary(g["summary"]),
    });
  }
  return out;
}

function readSnapshotGoal(value: unknown): SnapshotGoal | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Record<string, unknown>;
  const period = g["period"];
  if (period !== "day" && period !== "week") return null;
  const minutes = finite(g["minutes"]);
  const periodLoggedMs = finite(g["periodLoggedMs"]);
  const streak = finite(g["streak"]);
  if (minutes === null || periodLoggedMs === null || streak === null) return null;
  return { period, minutes, periodLoggedMs, streak };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `{ key: n }` for a readable count, `{}` for one that is absent or malformed.
 *  Absent is a real state here, so a bad value has to leave nothing behind
 *  rather than fall back to zero. */
function optionalCount<K extends string>(key: K, value: unknown): { [P in K]?: number } {
  const n = finite(value);
  return (n === null ? {} : { [key]: n }) as { [P in K]?: number };
}

/** `{ morningUnlockTime }` for a readable 24-hour `HH:MM`, `{}` for anything
 *  else. Validated rather than trusted for the reason the numbers are: this one
 *  is printed straight into a note, so a malformed value would put whatever the
 *  row happened to hold on somebody's page. */
function optionalClock(value: unknown): { morningUnlockTime?: string } {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? { morningUnlockTime: value } : {};
}

type OutcomeRow = {
  id: string;
  source_task_id: string;
  payload: { origin?: { title?: string } } | null;
  result: Refusal | "completed" | null;
  result_detail: string | null;
};
