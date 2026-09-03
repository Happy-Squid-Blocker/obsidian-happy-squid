import type { Auth } from "./auth";
import { functionUrl, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

/**
 * Asking Happy Squid to start a task.
 *
 * The plugin does NOT write the task itself, and could not if it wanted to:
 * `task_intents` grants a client `select` and `update` on its own rows and
 * nothing else, so the insert is the Edge Function's. That split is the whole
 * design and it is the backend's, not ours — writing `activeTask` straight into
 * `user_state` would look like it worked while skipping the productivity
 * verdict, the refusal when a task is already running, the teardown of the
 * unblock sessions a task start performs, and the history row. See the comment
 * on supabase/migrations/20260826120000_todoist_integration.sql.
 */

export type StartResult = { ok: true } | { ok: false; reason: "signed-out" | "failed" };

export interface StartTaskRequest {
  /** Stable enough to name this item twice; see `taskIdFor`. */
  sourceTaskId: string;
  /** The task's own words. The device renders the context block around it. */
  title: string;
  /** Where the item lives, shown with the task and never parsed. */
  notePath: string;
  /** Where the item SITS — folder, note, heading, parent — already composed and
   *  already truncated by `note-context.ts`. The two halves of the description
   *  block that are the note's rather than the user's, sent apart from the title
   *  so a rewrite can re-render around them. Empty when the line could not be
   *  found in the note, which is not a reason to refuse the start. */
  context: string;
  /** The started item's own continuation lines. The last line of the block. */
  notes: string;
}

/**
 * Stopping the task this line started.
 *
 * A complete names its target with the source id alone, exactly as the Todoist
 * webhook's does — and the reducer re-checks that the task named is the one
 * actually running before it ends anything, so a press that arrives after the
 * user has moved on cannot finish a task they never meant.
 */
export async function completeTask(auth: Auth, sourceTaskId: string): Promise<StartResult> {
  return post(auth, { kind: "complete", sourceTaskId });
}

/** See `taskIdFor` in task-line.ts for how `sourceTaskId` is minted. */
export async function startTask(auth: Auth, req: StartTaskRequest): Promise<StartResult> {
  return post(auth, { kind: "start", ...req, prefer: "desktop" });
}

/**
 * The row the last start press for this line made.
 *
 * Read AFTER the POST has returned, which is what makes the newest row for the
 * line this press's: the function inserts before it answers. It exists so the
 * pending face can be ended by a verdict on THIS row rather than on the
 * title (TaskStates.attachIntent), and it is a second request rather than a
 * field on the function's reply so the plugin does not depend on which build
 * of the function is deployed. The request is made while "starting…" is
 * already on the page, so it costs the user nothing to look at. Null when the
 * read fails, which costs the face its exact answer and nothing else — the
 * running state and the backstop still end it.
 */
export async function latestStartIntentId(auth: Auth, sourceTaskId: string): Promise<string | null> {
  const session = await auth.session();
  if (!session) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/task_intents?select=id&source=eq.obsidian&kind=eq.start&source_task_id=eq.${encodeURIComponent(sourceTaskId)}&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { id?: unknown }[];
    const id = Array.isArray(rows) ? rows[0]?.id : undefined;
    return typeof id === "string" && id ? id : null;
  } catch (e) {
    console.warn("[happy-squid] could not read the intent row", e);
    return null;
  }
}

async function post(auth: Auth, body: Record<string, unknown>): Promise<StartResult> {
  const session = await auth.session();
  if (!session) return { ok: false, reason: "signed-out" };
  try {
    const res = await fetch(functionUrl("obsidian-intent"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("[happy-squid] intent rejected", res.status, await res.text().catch(() => ""));
      return { ok: false, reason: res.status === 401 ? "signed-out" : "failed" };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[happy-squid] intent failed", e);
    return { ok: false, reason: "failed" };
  }
}
