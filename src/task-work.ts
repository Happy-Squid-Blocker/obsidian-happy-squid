import { dayKey } from "./vendor/day-key";

/**
 * How much the RUNNING task has worked, and on which days, worked out the way
 * every device works it out.
 *
 * The account credits a task's work to the days it was worked on only when the
 * task ENDS, so a note read while one runs sees none of it: an open-ended task
 * started yesterday morning left yesterday's card at what had ended by then and
 * today's at zero, where Home already drew today's part (Anton, 2026-11-24). The
 * cards add this on top of the account's rows, as `liveTaskGoal` does for Home.
 *
 * COPIES of `taskWorkedMs` and `taskWorkSpans` (src/shared/task-status.ts) and
 * `taskDayShares` (src/update/task-goal.ts), not imports, for task-slots.ts's
 * reason: those files import more of the extension, and the public plugin repo
 * carries only importless files across. src/tests/obsidian/task-work.test.ts
 * holds them equal to the originals.
 */

const MS_PER_MINUTE = 60_000;

/** One stretch the task ran. */
export interface WorkSpan {
  start: number;
  end: number;
}

/** The fields of a task record the worked time is read from. */
export interface WorkTask {
  id: string;
  startedAt: number;
  expiresAt: number;
  durationMinutes?: number;
  pausedAt?: number | null;
  workAdjustMs?: number;
  workSpans?: WorkSpan[];
  spanStartedAt?: number;
}

/** A day's part of a task's worked time: `from` is where it began that day. */
export interface DayShare {
  date: string;
  ms: number;
  from: number;
}

/** The running or paused task's work so far, by day. */
export interface RunningWork {
  taskId: string;
  shares: DayShare[];
}

/** The task's work at `now`, by day, or null with no task. */
export function runningWork(task: WorkTask | null, now: number): RunningWork | null {
  if (!task) return null;
  return { taskId: task.id, shares: taskDayShares(taskWorkSpans(task, now), taskWorkedMs(task, now), now) };
}

function taskRemainingMs(task: WorkTask, now: number): number {
  const remaining = task.pausedAt != null ? task.expiresAt - task.pausedAt : task.expiresAt - now;
  return Math.max(0, remaining);
}

function taskElapsedMs(task: WorkTask, now: number): number {
  const totalMs = task.durationMinutes != null ? task.durationMinutes * MS_PER_MINUTE : task.expiresAt - task.startedAt;
  return Math.max(0, totalMs - taskRemainingMs(task, now));
}

/** The worked time the task will be credited with if it ends at `now`. */
export function taskWorkedMs(task: WorkTask, now: number): number {
  return Math.max(0, taskElapsedMs(task, now) + (task.workAdjustMs ?? 0));
}

/** Every stretch the task has run, the one running now included unless it is
 *  paused, without the ones of no length. */
export function taskWorkSpans(task: WorkTask, now: number): WorkSpan[] {
  const closed = task.workSpans ?? [];
  const open = { start: task.spanStartedAt ?? task.startedAt, end: Math.min(now, task.expiresAt) };
  const spans = task.pausedAt == null ? [...closed, open] : closed;
  return spans.filter((span) => span.end > span.start);
}

function nextMidnight(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** `workedMs` split at midnight along the stretches the task ran, each day
 *  taking its proportion and the last day what rounding leaves. */
export function taskDayShares(spans: readonly WorkSpan[], workedMs: number, endedAt: number): DayShare[] {
  const worked = Math.max(0, workedMs);
  const parts: DayShare[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    let cursor = span.start;
    while (cursor < span.end) {
      const until = Math.min(span.end, nextMidnight(cursor));
      if (until <= cursor) break;
      const date = dayKey(cursor);
      const part = parts.find((p) => p.date === date);
      if (part) part.ms += until - cursor;
      else parts.push({ date, ms: until - cursor, from: cursor });
      cursor = until;
    }
  }
  const total = parts.reduce((sum, part) => sum + part.ms, 0);
  if (worked === 0 || total === 0) return [{ date: dayKey(endedAt), ms: worked, from: endedAt }];
  let left = worked;
  return parts
    .map((part, i) => {
      const ms = i === parts.length - 1 ? left : Math.min(left, Math.round((worked * part.ms) / total));
      left -= ms;
      return { ...part, ms };
    })
    .filter((part) => part.ms > 0);
}
