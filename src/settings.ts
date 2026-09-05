import { type App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type { Auth } from "./auth";
import { DAY_SUMMARY_TITLE, type DaySummaryVisibility } from "./goal";
import type HappySquidPlugin from "./main";

/**
 * The settings panel: the account, and the Daily Summary card's four switches.
 *
 * The extension's rule is that the UI carries only messages the maintainer
 * designed, and on the SUCCESS path this surface needs none: the panel's own
 * state is the feedback — asking for a code swaps the form for the code field,
 * and a verified code swaps the whole thing for the signed-in row.
 *
 * The two FAILURES are the exception, and they are the case the rule's other
 * half is written for. A rejected email or a mistyped code is a refusal the user
 * can act on, and there was no state left to say so with: the panel re-rendered
 * identically, so a wrong code looked exactly like a right one that had not
 * landed yet, and the only trace was a `console.warn` nobody opens a vault to
 * read. The two sentences below are the Todoist card's own, lifted verbatim
 * (supabase/functions/todoist-extension/index.ts) — the same flow, asking the
 * same backend the same question, so nothing here is newly worded. Same rule
 * main.ts's three Notices are taken under.
 */
const BAD_EMAIL = "That email didn’t work. Try again.";
const BAD_CODE = "That code didn’t match. Try again.";

/**
 * The Daily Summary section's four switches, in the order the card draws what
 * they hide: the three header terms left to right, then the paragraph under
 * them. Anton's own words (2026-09-01), carried verbatim — the settings panel is
 * held to the same rule as everything else here, which is that copy is the
 * maintainer's and nothing is worded on this side.
 *
 * No descriptions under them, deliberately. The panel has never carried one, its
 * own state being the feedback, and a line explaining what "Times blocked" hides
 * would be exactly the undesigned chrome the extension's rule is about — the
 * card next to it in the note says what each switch does the moment it is
 * thrown.
 */
const DAY_SUMMARY_SWITCHES: { key: keyof DaySummaryVisibility; name: string }[] = [
  { key: "taskTime", name: "Time spent on tasks" },
  { key: "freeTime", name: "Free Time spent" },
  { key: "timesBlocked", name: "Times blocked" },
  { key: "summary", name: "Written summary" },
];

/**
 * How the panel reaches the switches, which live in the plugin's `data.json`
 * beside everything else it keeps (store.ts).
 *
 * A port rather than the plugin itself, for the reason `Auth` is one: this tab
 * has no business knowing how the record is stored or when it is written, and
 * the whole of what it does is read four booleans and hand four back.
 */
export interface DaySummaryPrefs {
  read(): DaySummaryVisibility;
  write(next: DaySummaryVisibility): Promise<void>;
}

export class HappySquidSettingTab extends PluginSettingTab {
  private email = "";
  private codeSent = false;
  /** Which row is standing in front of a refusal, if either. One field rather
   *  than two flags because a row has one state and the pair could not both be
   *  true honestly — a failed send never reaches the code row, and a failed
   *  verify says nothing about the email that got a code sent to it. */
  private failed: "email" | "code" | null = null;

  constructor(
    app: App,
    plugin: HappySquidPlugin,
    private auth: Auth,
    /** Signing in or out changes what every marker should say, and the editor
     *  has no reason of its own to notice. */
    private onAccountChanged: () => void,
    /** The Daily Summary card's four visibility switches. */
    private daySummary: DaySummaryPrefs,
  ) {
    super(app, plugin);
  }

  /** Obsidian 1.13's searchable settings; `display` below remains the fallback
   *  for older supported app versions. The account rows stay custom because
   *  their shape changes across an asynchronous sign-in flow, while the four
   *  stored booleans fit the declarative controls directly. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Account",
        desc: "Loading account…",
        aliases: ["Email", "Sign in", "Log out"],
        render: (setting) => {
          let current = true;
          void this.populateAccount(setting, () => current);
          return () => {
            current = false;
          };
        },
      },
      {
        name: "Code",
        desc: this.failed === "code" ? BAD_CODE : "The six-digit code sent to your email.",
        visible: () => this.codeSent,
        render: (setting) => this.populateCode(setting),
      },
      {
        type: "group",
        heading: DAY_SUMMARY_TITLE,
        items: DAY_SUMMARY_SWITCHES.map(({ key, name }) => ({
          name,
          control: { type: "toggle", key },
        })),
      },
    ];
  }

  getControlValue(key: string): unknown {
    const preference = DAY_SUMMARY_SWITCHES.find((item) => item.key === key);
    return preference ? this.daySummary.read()[preference.key] : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const preference = DAY_SUMMARY_SWITCHES.find((item) => item.key === key);
    if (!preference || typeof value !== "boolean") return;
    await this.daySummary.write({ ...this.daySummary.read(), [preference.key]: value });
  }

  display(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    await this.renderAccount();
    // Drawn whether or not anybody is signed in, and after the account block
    // rather than inside it: it is a way of LOOKING at a card, so it is the
    // vault's own setting and has nothing to do with whose rows are being read.
    // The account block returns early in two places, which is why it is its own
    // method now — a section appended after those returns would have been drawn
    // on exactly one of the three paths through it.
    this.renderDaySummary();
  }

  /** The four switches. Each one writes and asks the notes to redraw; there is
   *  nothing to confirm and nothing that can fail, so the card changing in the
   *  note behind the panel is the whole of the feedback. */
  private renderDaySummary(): void {
    const { containerEl } = this;
    new Setting(containerEl).setName(DAY_SUMMARY_TITLE).setHeading();
    for (const { key, name } of DAY_SUMMARY_SWITCHES) {
      new Setting(containerEl).setName(name).addToggle((t) =>
        t.setValue(this.daySummary.read()[key]).onChange(async (on) => {
          // Read at the moment of the change rather than closed over, so four
          // switches thrown in a row each write on top of the last one instead
          // of on top of what the panel opened with.
          await this.daySummary.write({ ...this.daySummary.read(), [key]: on });
        }),
      );
    }
  }

  private async renderAccount(): Promise<void> {
    const signedIn = await this.populateAccount(new Setting(this.containerEl));
    if (signedIn !== false || !this.codeSent) return;
    this.populateCode(new Setting(this.containerEl));
  }

  private async populateAccount(setting: Setting, current: () => boolean = () => true): Promise<boolean | null> {
    const signedInAs = await this.auth.email();
    if (!current()) return null;
    if (signedInAs) {
      setting
        .setName("Account")
        .setDesc(signedInAs)
        .addButton((b) =>
          b.setButtonText("Log out").onClick(async () => {
            await this.auth.signOut();
            this.codeSent = false;
            this.email = "";
            this.failed = null;
            this.onAccountChanged();
            this.rerender();
          }),
        );
      return true;
    }

    // Signed out. The same six-digit email code the extension and the apps use.
    setting
      .setName("Email")
      .setDesc(this.failed === "email" ? BAD_EMAIL : "Sign in to use Happy Squid.")
      .addText((t) =>
        t
          .setPlaceholder("you@example.com")
          .setValue(this.email)
          .onChange((v) => {
            this.email = v.trim();
          }),
      )
      .addButton((b) =>
        b.setButtonText(this.codeSent ? "Resend code" : "Send code").onClick(async () => {
          if (!this.email) return;
          const { error } = await this.auth.sendCode(this.email);
          if (error) {
            console.warn("[happy-squid] could not send code", error);
            // Re-rendered rather than returned from: the refusal IS the state
            // change, and without one the button reads as having done nothing.
            this.failed = "email";
            this.rerender();
            return;
          }
          this.failed = null;
          this.codeSent = true;
          this.rerender();
        }),
      );
    return false;
  }

  private populateCode(setting: Setting): void {
    let code = "";
    setting
      .setName("Code")
      .setDesc(this.failed === "code" ? BAD_CODE : "The six-digit code sent to your email.")
      // The field is built fresh on every render and carries no `setValue`, so a
      // refused code is cleared along the way and the row is ready to be typed
      // into again — which is what the Todoist card does by re-asking.
      .addText((t) =>
        t.setPlaceholder("123456").onChange((v) => {
          code = v.trim();
        }),
      )
      .addButton((b) =>
        b.setButtonText("Verify").onClick(async () => {
          if (!code) return;
          const { error } = await this.auth.verifyCode(this.email, code);
          if (error) {
            console.warn("[happy-squid] could not verify code", error);
            this.failed = "code";
            this.rerender();
            return;
          }
          this.failed = null;
          this.codeSent = false;
          this.onAccountChanged();
          this.rerender();
        }),
      );
  }

  /** `update` exists in Obsidian 1.13; older supported versions call the
   *  imperative `display` fallback and need that same path refreshed. */
  private rerender(): void {
    const update: unknown = Reflect.get(this, "update");
    if (typeof update === "function") update.call(this);
    else void this.render();
  }
}
