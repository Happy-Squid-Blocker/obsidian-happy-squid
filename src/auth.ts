import { createClient, type Session } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

/**
 * The plugin's half of the account, which is the SAME account the extension and
 * the apps sign into — a six-digit email code, the flow already built for them
 * (`signInWithOtp` + `verifyOtp`).
 *
 * Google OAuth is deliberately not offered here. The extension reaches it
 * through `chrome.identity`, and the loopback-redirect dance a desktop app would
 * need instead is a second auth surface to keep correct for a second way into
 * the same account.
 *
 * WHERE THE SESSION LIVES is worth knowing before shipping: `saveData` writes
 * `.obsidian/plugins/happy-squid/data.json` INSIDE the vault, so on a synced
 * vault the refresh token syncs with it. That is the ordinary Obsidian plugin
 * convention and it is what makes the plugin work on a phone, but it does mean
 * the token is only as private as the vault.
 */

type Store = Record<string, string>;

export interface SessionStore {
  load(): Promise<Store>;
  save(store: Store): Promise<void>;
}

export class Auth {
  readonly client: ReturnType<typeof createClient>;
  private cache: Store = {};
  private ready: Promise<void>;

  constructor(private store: SessionStore) {
    this.ready = store.load().then((s) => {
      this.cache = s;
    });
    this.client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // No URL to parse: a plugin is not a page and never lands on a redirect.
        detectSessionInUrl: false,
        storage: {
          getItem: async (key: string) => {
            await this.ready;
            return this.cache[key] ?? null;
          },
          setItem: async (key: string, value: string) => {
            await this.ready;
            this.cache[key] = value;
            await this.store.save(this.cache);
          },
          removeItem: async (key: string) => {
            await this.ready;
            delete this.cache[key];
            await this.store.save(this.cache);
          },
        },
      },
    });
  }

  /** Sends the six-digit code. `shouldCreateUser` stays true so the plugin can
   *  be somebody's first way in, exactly as the extension's own form is. */
  async sendCode(email: string): Promise<{ error: string | null }> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    return { error: error?.message ?? null };
  }

  async verifyCode(email: string, code: string): Promise<{ error: string | null }> {
    const { error } = await this.client.auth.verifyOtp({ email, token: code, type: "email" });
    return { error: error?.message ?? null };
  }

  async session(): Promise<Session | null> {
    await this.ready;
    const { data } = await this.client.auth.getSession();
    return data.session;
  }

  async email(): Promise<string | null> {
    return (await this.session())?.user.email ?? null;
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }
}
