/**
 * Which task an account's task records show, worked out the way every device
 * works it out.
 *
 * A COPY of `liveTaskSlots` (src/shared/task-sync.ts) and `isActiveTaskLive`
 * (src/shared/task-status.ts), not an import. Both of those files import more
 * of the extension at runtime, and the public plugin repo can only carry
 * importless files across (scripts/export-source.mjs refuses anything else),
 * so importing them made the plugin unreleasable. The copies are held equal
 * to the originals by src/tests/obsidian/task-slots.test.ts, the way
 * goal.test.ts holds the goal's period boundary equal to the reducer's.
 *
 * Importless itself, so that test can load it.
 */

/** The fields of a task record the pick reads. */
export interface SlotTask {
  id: string;
  startedAt: number;
  expiresAt: number;
  pausedAt?: number | null;
  statusRevision?: number;
  revision?: number;
}

/** The fields of a history entry the pick reads: a task's end marker. */
export interface SlotHistoryEntry {
  type: string;
  taskId?: string;
  taskRevision?: number;
}

/**
 * The task each slot shows. The task that moved in last took the place of
 * every other, even when it has ended since. It stays, in `pausedTask` when it
 * is paused and in `activeTask` otherwise, unless the history holds its end;
 * then both slots are empty.
 */
export function liveTaskSlots<T extends SlotTask>(
  copies: readonly T[],
  history: { history: readonly SlotHistoryEntry[] },
): { activeTask: T | null; pausedTask: T | null } {
  const last = copies.reduce<T | null>((best, task) => (best === null || movedLater(task, best) ? task : best), null);
  const task = last && !isTaskEnded(history.history, last) ? last : null;
  return {
    activeTask: task?.pausedAt == null ? task : null,
    pausedTask: task?.pausedAt != null ? task : null,
  };
}

/** Running and not yet run out, or paused (a paused task's frozen deadline can
 *  fall behind the clock and it is still live). */
export function isActiveTaskLive(task: SlotTask | null | undefined, now: number): boolean {
  if (!task) return false;
  return task.pausedAt != null || task.expiresAt > now;
}

function isTaskEnded(history: readonly SlotHistoryEntry[], task: SlotTask): boolean {
  return history.some(
    (entry) =>
      entry.type === "task_end" &&
      entry.taskId === task.id &&
      (entry.taskRevision === undefined || entry.taskRevision >= (task.revision ?? 0)),
  );
}

function movedInAt(task: SlotTask): number {
  return task.statusRevision ?? task.startedAt;
}

function movedLater(a: SlotTask, b: SlotTask): boolean {
  if (movedInAt(a) !== movedInAt(b)) return movedInAt(a) > movedInAt(b);
  return a.startedAt !== b.startedAt ? a.startedAt > b.startedAt : a.id > b.id;
}
