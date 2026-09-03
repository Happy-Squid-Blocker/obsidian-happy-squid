import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Auth } from "./auth";

/**
 * Hearing about changes instead of asking for them.
 *
 * Polling alone made the control feel broken: press "start task" and nothing
 * moves for up to thirty seconds, because the marker cannot change until a
 * device has claimed the intent, dispatched it and the verdict has landed — and
 * the plugin only looked on its own timer. The answer is not to poll harder but
 * to be told, which both tables already support: `user_state` and `task_intents`
 * are in the `supabase_realtime` publication (see docs/DATABASE.md), and Obsidian
 * is a long-lived app that can hold a socket the extension's service worker
 * cannot.
 *
 * The poll STAYS as the backstop. A socket drops, a laptop sleeps, and a missed
 * INSERT is not replayed — the same reasoning that keeps the 30-second alarm
 * beside the extension's own realtime sync.
 *
 * Every event is answered with the same full refresh rather than by applying the
 * payload: the rows are small, the refresh is two reads, and a merge that tried
 * to be clever would be a second copy of the logic in state.ts.
 */
export class Live {
  private channel: RealtimeChannel | null = null;

  constructor(
    private auth: Auth,
    private onChange: () => void,
  ) {}

  async start(): Promise<void> {
    await this.stop();
    const session = await this.auth.session();
    if (!session) return;
    const uid = session.user.id;
    this.channel = this.auth.client
      .channel(`hs-obsidian-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_state", filter: `user_id=eq.${uid}` }, () =>
        this.onChange(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_intents", filter: `user_id=eq.${uid}` },
        () => this.onChange(),
      )
      .subscribe();
  }

  async stop(): Promise<void> {
    if (!this.channel) return;
    const channel = this.channel;
    this.channel = null;
    try {
      await this.auth.client.removeChannel(channel);
    } catch (e) {
      console.warn("[happy-squid] could not close the live channel", e);
    }
  }
}
