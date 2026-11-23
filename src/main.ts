import { MarkdownView, Notice, Plugin, requestUrl, TFile, type EditorPosition, type TAbstractFile } from "obsidian";
import { Auth } from "./auth";
import { completeTask, latestStartIntentId, startTask } from "./intent";
import { decorateReadingView, markerExtension } from "./marker";
import { redrawOnChange } from "./redraw";
import { enterPropagation } from "./enter";
import { HappySquidSettingTab } from "./settings";
import { TaskStates } from "./state";
import { Live } from "./live";
import { type PluginData, readData, rememberApplied, rememberRewrite } from "./store";
import { MARKER, notePathOf, parseTaskLine, taskIdFor } from "./task-line";
import { composeNoteContext } from "./note-context";
import { tickCompleted, writeRewrite } from "./tick";
import { WELCOME_PATH, welcomeNote } from "./welcome";
import { tickWatch } from "./tick-watch";
import {
  absorbGoalDays,
  dayIsRecorded,
  daySummaryForDay,
  freeTimeForDay,
  freeTimeText,
  goalForDay,
  tasksForDay,
  morningUnlockForDay,
  morningUnlockText,
  taskTimeForDay,
  taskTimeText,
  timesBlockedForDay,
  timesBlockedText,
} from "./goal";
import { decorateGoalCards, goalCardExtension, type Rendered } from "./goal-card";
import { findGoalMarkers, markerDate, markerFor, unwrapTemplateMarkers, type FoundMarker } from "./goal-marker";
import { dayKey } from "./vendor/day-key";

/**
 * Happy Squid for Obsidian.
 *
 * Type `{task}` after a list item — a checkbox or a plain bullet — and it draws
 * as "start task"; pressing it asks Happy Squid to start that task. While that
 * task is the one running it reads "stop task", and if the productivity check
 * refused it, "task deemed not productive" — one control with three faces,
 * because what you can do with a task depends entirely on what became of it.
 * And the BOX is the control's other half: ticking it while the task runs
 * finishes the task, exactly as "stop task" does (Anton, 2026-09-02), and
 * finishing it in Happy Squid ticks the box. A plain item has no box, so its
 * strikethrough stands in for it both ways (Anton, 2026-09-07).
 *
 * The messages below are the extension's OWN, lifted verbatim from the Todoist
 * entry point and the auth gate, because this is the same action reaching the
 * same backend. Nothing here is newly worded.
 */
const SENT = "Task sent to Happy Squid.";
const COULD_NOT_START = "Happy Squid could not start this task.";
const SIGNED_OUT = "Sign in to use Happy Squid.";

/**
 * How long a tick the plugin wrote itself is remembered as its own.
 *
 * `vault.modify` on a note that is open in an editor lands in that editor as
 * a document change, which is exactly what `tickWatch` reads a tick off — so
 * without this the plugin's own completion tick would come straight back as
 * the user's, and file a `complete` for a task the account has just finished.
 * That is not a theoretical loop: a completion reaches the intent row and
 * `activeTask` on two different wires, and a refresh between the two reads
 * "completed" beside a task still running. Long enough to outlast however
 * Obsidian chooses to deliver the change; the line it names is ticked by then,
 * so nothing a user could do inside the window is lost.
 */
const OWN_TICK_MS = 5_000;

/**
 * How often the account is asked what became of things.
 *
 * Only while Obsidian has focus: a vault sitting in the background behind a
 * browser has nobody looking at a marker, and two reads a minute against
 * somebody's own row is the most this should ever cost. Every foreground and
 * every press refreshes out of band, so the interval is the backstop rather than
 * the mechanism.
 */
const POLL_MS = 30_000;

/** How long the typing has to stop before a bare `{taskgoal}` is stamped with
 *  its day. Long enough that it never lands mid-word, short enough that the card
 *  appears while the user is still looking at the line they typed it on. */
const STAMP_IDLE_MS = 1200;

export default class HappySquidPlugin extends Plugin {
  private auth!: Auth;
  private states!: TaskStates;
  private live!: Live;
  private data: PluginData = readData(null);
  private stampTimer = 0;
  /** Ticks the plugin wrote itself, by note and words — see OWN_TICK_MS. */
  private ownTicks = new Set<string>();

  async onload(): Promise<void> {
    // A FRESH install is one with no `data.json` at all, which is the flag
    // itself — no field to add, and nothing an upgrade could trip. The write
    // below is what makes it true from here on, so a welcome note that fails to
    // be written is not attempted again at every launch.
    const stored: unknown = await this.loadData();
    const firstRun = stored === null || stored === undefined;
    this.data = readData(stored);
    if (firstRun) await this.saveData(this.data);
    this.auth = new Auth({
      load: async () => this.data.auth,
      save: async (store) => {
        this.data.auth = store;
        await this.saveData(this.data);
      },
    });
    this.states = new TaskStates(this.auth, requestUrl);
    // Told rather than asked: without this the marker cannot move until the next
    // poll, which is up to thirty seconds of a control that looks unpressed.
    this.live = new Live(this.auth, () => void this.sync());

    const onPress = (title: string) => void this.press(title);
    const onTick = (title: string, notePath: string) => void this.tick(title, notePath);

    const resolveGoal = (found: FoundMarker) => this.render(found);

    this.registerEditorExtension([
      markerExtension(onPress, this.states),
      goalCardExtension(resolveGoal, findGoalMarkers, () => this.states.version),
      // What makes the two above see the account move at all — see redraw.ts.
      redrawOnChange(this.states),
      enterPropagation(),
      // The box, ticked in the editor. Reading view's box is answered in
      // decorateReadingView, being no editor.
      tickWatch(onTick),
    ]);
    this.registerMarkdownPostProcessor((el, ctx) => {
      decorateReadingView(el, onPress, onTick, this.states, ctx);
      decorateGoalCards(el, resolveGoal, findGoalMarkers, (fn) => this.states.onChange(fn), ctx);
    });
    this.addSettingTab(
      new HappySquidSettingTab(
        this.app,
        this,
        this.auth,
        () => {
          // Signing in or out changes both what the markers say and whose rows the
          // socket should be listening to.
          void this.live.start();
          void this.sync();
        },
        {
          read: () => this.data.daySummary,
          write: async (next) => {
            this.data.daySummary = next;
            await this.saveData(this.data);
            // Nothing in the account moved, so nothing would otherwise ask the
            // notes to redraw — but what the Daily Summary card should draw just
            // changed, and a switch the user watched do nothing is a switch that
            // reads as broken.
            this.states.redraw();
          },
        },
      ),
    );

    this.registerInterval(window.setInterval(() => void this.sync(), POLL_MS));
    // A bare marker is stamped once the user has stopped typing near it. Both
    // triggers matter: the debounce catches one typed into the note in front of
    // you, and leaving the note catches one that arrived with a template and was
    // never touched.
    this.registerEvent(this.app.workspace.on("editor-change", () => this.scheduleStamp()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.stampBareMarkers()));
    // A `:template` marker is unwrapped to its bare form in each note CREATED
    // from the template, and the stamp above then dates it. Creation is the only
    // trigger, because being created is the only thing that separates a note
    // made from a template from the template itself — see goal-marker.ts.
    //
    // Registered inside `onLayoutReady` because `create` is ALSO fired for every
    // file already in the vault when Obsidian loads. Without that guard the
    // first launch after installing would unwrap the template file itself, which
    // is precisely the damage this exists to prevent.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => void this.unwrapTemplate(file)));
      // The welcome note, on a fresh install only. Inside `onLayoutReady` for
      // the same reason the listener above is: at load there is no workspace to
      // open a note into yet. It is written AFTER that listener is registered,
      // which is harmless — the note carries no `:template` marker to unwrap,
      // and every marker in it is dated so the stamp beat leaves it alone.
      if (firstRun) void this.openWelcome(true);
    });
    void this.live.start();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => void this.sync()));
    void this.sync();

    // The keyboard route, which needs no rendering and works in every mode —
    // Live Preview, reading view and source mode alike.
    this.addCommand({
      id: "start-task-under-cursor",
      name: "Start or stop task at cursor",
      editorCheckCallback: (checking, editor) => {
        const title = titleOf(editor.getLine(editor.getCursor().line));
        if (!title) return false;
        if (!checking) void this.press(title);
        return true;
      },
    });

    // The way back to the note after it has been deleted, and the way to it at
    // all for anyone who installed before it existed.
    this.addCommand({
      id: "open-welcome-note",
      name: "Open the welcome note",
      callback: () => void this.openWelcome(false),
    });
  }

  /**
   * Writes the welcome note and opens it.
   *
   * `onInstall` is the fresh-install path, and it is the CAUTIOUS one: a vault
   * that already has a file by that name keeps it and is not opened, because on
   * an install the name collision is far more likely to be somebody's own note
   * than a copy of ours. Asked for by the command instead, an existing file at
   * the path is simply opened — by then the user has said which note they mean.
   */
  private async openWelcome(onInstall: boolean): Promise<void> {
    try {
      const existing = this.app.vault.getAbstractFileByPath(WELCOME_PATH);
      if (existing instanceof TFile) {
        if (onInstall) return;
        await this.app.workspace.getLeaf(true).openFile(existing);
        return;
      }
      const file = await this.app.vault.create(WELCOME_PATH, welcomeNote());
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (e) {
      console.warn("[happy-squid] could not open the welcome note", e);
    }
  }

  /**
   * Read what became of things, then write back the one thing that belongs in
   * the file: a task finished in Happy Squid ticks its checkbox here.
   *
   * The tick is deliberately part of the ordinary refresh rather than a push:
   * nothing can reach a vault that is closed, so "next time the plugin looks" is
   * the only moment it could ever happen, and doing it here means a task
   * finished while Obsidian was shut is ticked at the next launch instead of
   * being lost.
   */
  private async sync(): Promise<void> {
    await this.states.refresh();
    // Fold the account's own record of ended days into the vault's archive. The
    // account keeps a week and stamps a day on whichever device was awake, so
    // this is where a vault that was shut all weekend learns what Friday came to
    // — and where the archive gets to be complete rather than holding only the
    // days somebody happened to have Obsidian open for. Written only when
    // something moved, so an idle vault costs no disk.
    const goals = absorbGoalDays(this.data.goals, this.states.goalDays);
    if (goals !== this.data.goals) {
      this.data.goals = goals;
      // Every marker but the goal card's live figure reads this archive, and
      // `refresh` above only redraws when the TASK side moved. Without this a
      // note drew the archive it was opened with: "no button unlock" and zeros
      // all morning, until a task started or the note was re-rendered.
      this.states.redraw();
      await this.saveData(this.data);
    }
    for (const done of this.states.completed) {
      // ONCE. The row goes on saying `completed` for as long as it is read, so
      // without this a box the user deliberately un-ticked was silently
      // re-ticked at the next poll — the task "completing itself" over and over.
      if (this.data.applied.includes(done.sourceTaskId)) continue;
      const path = notePathOf(done.sourceTaskId);
      if (!path) continue;
      try {
        await this.tickOurselves(path, done.title);
        // A task that ran under the squid's own wording has TWO lines in the
        // note: the one the user pressed, which the row names, and the one the
        // plugin wrote under it. They are one item on the wire — one intent,
        // one completion — so both are ticked.
        const rewrite = this.data.rewrites[done.sourceTaskId];
        if (rewrite) await this.tickOurselves(path, rewrite.title);
      } catch (e) {
        console.warn("[happy-squid] could not tick a completed task", e);
      }
      // Marked applied whether or not a line was found: a completion for a note
      // that has been renamed or a task that has been reworded is not going to
      // start matching later, and retrying it forever costs a read of that note
      // on every poll.
      this.data.applied = rememberApplied(this.data.applied, done.sourceTaskId);
      await this.saveData(this.data);
    }
    // A task running under the squid's own wording gets that wording written
    // as a new line under the one the user pressed (Anton, 2026-09-02) — never
    // over it, which would be the plugin rewriting the user's task. The line
    // reads "stop task" from the moment it lands, and it is the line the tick
    // above finds when the task ends. Recorded whether or not the note was
    // there to take it, for `applied`'s reason: a renamed note is not going to
    // start matching later.
    const rewrite = this.states.rewrite;
    if (rewrite && this.data.rewrites[rewrite.sourceTaskId]?.taskId !== rewrite.taskId) {
      try {
        await writeRewrite(this.app, rewrite.notePath, rewrite.sourceTaskId, rewrite.title);
      } catch (e) {
        console.warn("[happy-squid] could not write a re-worded task", e);
      }
      this.data.rewrites = rememberRewrite(this.data.rewrites, rewrite.sourceTaskId, {
        taskId: rewrite.taskId,
        title: rewrite.title,
      });
      await this.saveData(this.data);
    }
  }

  /**
   * What one marker should draw.
   *
   * The DAY comes from the marker itself, so nothing here reads the note — that
   * is the whole change from the version that inferred it, and it is why there
   * is no filename to misread and no `date:` to mistake for a note's own day.
   *
   * From there the six markers ask different things of the same record.
   * `{taskgoal}` wants the goal that governed the day and says so on the card
   * when there was none. The other five want facts that are recorded whether or not a goal was
   * ever configured — the day's own work, the blocks, the Free Time spent, the
   * morning press, and the squid's own account of the day — so they answer for
   * the many users who have never set one up.
   * A day this vault knows about ALWAYS answers: the three figures print a zero
   * for a day with nothing on it, and `{morningbutton}`, having no zero to print,
   * says so in words instead — the one piece of copy this feature carries.
   * `{daysummary}` answers with its header, which is three of those figures, and
   * grows its paragraph whenever the fold that writes one lands.
   *
   * All six read three layers, narrowest first, and the layering is the design
   * (goal.ts): the LIVE row for a day still running, the account's own record of
   * the last eight days, and the vault's archive for anything older. The account
   * is what can answer for days Obsidian was shut; the vault is what still
   * answers a year later. `absorbGoalDays` in sync() is the seam between them, so
   * by the time this runs both are already in one record.
   *
   * `{taskgoal}` and `{daysummary}` are CARDS; the other four are TEXT, and every
   * figure on any of them is spelled by the one function the rest of the product
   * spells that figure with — never a wording invented here.
   */
  private render(found: FoundMarker): Rendered | null {
    if (found.marker === null) return null;
    const now = Date.now();
    const date = markerDate(found.marker, now);
    const day = { snapshots: this.data.goals, date, now, signedIn: this.states.signedIn };
    switch (found.name) {
      case "tasktime": {
        const loggedMs = taskTimeForDay(day);
        return loggedMs === null ? null : { kind: "text", text: taskTimeText(loggedMs) };
      }
      case "timesblocked": {
        const count = timesBlockedForDay(day);
        return count === null ? null : { kind: "text", text: timesBlockedText(count) };
      }
      case "freetime": {
        const freeTimeMs = freeTimeForDay(day);
        return freeTimeMs === null ? null : { kind: "text", text: freeTimeText(freeTimeMs) };
      }
      case "morningbutton": {
        const morning = morningUnlockForDay(day);
        return morning === null ? null : { kind: "text", text: morningUnlockText(morning) };
      }
      case "daysummary": {
        // The header alone is drawn for a day with no prose yet — which is every
        // part of today, the fold happening the next morning — so a note written
        // now shows its figures immediately and grows the paragraph later. Null
        // only for a day this vault cannot answer for at all.
        const summary = daySummaryForDay({ ...day, visible: this.data.daySummary });
        return summary === null ? null : { kind: "daysummary", day: summary, date };
      }
      case "taskgoal": {
        const goal = goalForDay({ live: this.states.goal, snapshots: this.data.goals, date, now });
        // A day this vault can answer for ALWAYS draws its card, and one whose
        // goal was off says so on it (Anton, 2026-09-01) rather than falling
        // back to raw text — the same rule the four figures keep by printing a
        // zero, and `dayIsRecorded` is that rule so the card and the figures
        // cannot answer for different days. Only a day with no record at all is
        // silent, which is every day before this vault knew anything.
        if (goal === null && !dayIsRecorded(day)) return null;
        // The day's own tasks ride along with the card. Read unconditionally
        // and answered as an empty list for every reason there could be none —
        // no row, a row banked before the list existed, a day nothing ended on
        // — because all of them come to the same thing on the page: no chevron.
        return { kind: "card", goal, date, tasks: tasksForDay({ snapshots: this.data.goals, date }) };
      }
    }
  }

  /**
   * Unwraps a newly created note's `:template` markers.
   *
   * A template holds `{taskgoal:template}`, which draws today's card where it
   * sits so its author can see what they are writing. The note made from it
   * should carry the day IT was made, so the marker is unwrapped here to the
   * bare form and the ordinary stamp dates it on the next beat.
   *
   * `vault.process` rather than a read followed by a write: it is a
   * read-modify-write under the vault's own lock, so an edit landing in between
   * cannot be lost. Untouched when there is nothing to unwrap, so a note created
   * without a template never gets written to at all.
   *
   * One flow this deliberately does not reach: inserting a template into a note
   * that ALREADY exists fires no creation, so its markers stay `:template` and
   * go on drawing a live card. That fails safe and visibly — the opposite of the
   * frozen wrong day it replaces — and it is not a flow that needs the marker
   * anyway, since a goal added to an existing note by hand is written bare.
   */
  private async unwrapTemplate(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    await this.app.vault.process(file, (text) => unwrapTemplateMarkers(text) ?? text);
  }

  /**
   * Writes today's date into every bare day marker on the page.
   *
   * A bare marker means "the day this was written", and that is a fact only the
   * text can hold: `data.json` keyed by note path would lose it the first time a
   * note was renamed, which is the same reason the completion tick matches by
   * words rather than by line number. So the marker is stamped into its dated
   * form and is an ordinary dated marker from then on — live until its midnight,
   * static forever after.
   *
   * NOT done from the decoration builder, for two reasons. Dispatching a doc
   * change from inside a render pass is how CodeMirror loops; and `{taskgoal}`
   * becomes complete the instant the user types the closing brace, so stamping
   * there would inject eleven characters under a live caret mid-word. This runs
   * on the idle beat instead, and skips any marker the caret is inside — the
   * same condition the card itself uses to reveal raw text, and the one that
   * makes a marker being edited stay editable.
   *
   * One transaction for the whole page, so an undo takes the stamp back in one
   * press rather than one per marker.
   */
  private stampBareMarkers(): void {
    // Every marker, one pass. A bare `{daysummary}`, `{tasktime}`,
    // `{timesblocked}`, `{freetime}` or `{morningbutton}` means the day it was
    // written exactly as a bare `{taskgoal}` does, and all six are stamped by the
    // same rules for the same reason.
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!editor) return;
    // Only a note being WORKED ON is stamped, which is what stops browsing
    // through a year of old daily notes from rewriting every one of them with
    // today's date. A bare marker means "the day this was written", so a file
    // last touched days ago is not making that claim about today — and a marker
    // left unstamped is not broken, it simply goes on drawing the live card.
    const mtime = view?.file?.stat?.mtime;
    if (mtime !== undefined && dayKey(mtime) !== dayKey(Date.now())) return;

    const today = dayKey(Date.now());
    const caret = editor.getCursor();
    const changes: { from: EditorPosition; to: EditorPosition; text: string }[] = [];
    for (let line = 0; line < editor.lineCount(); line++) {
      for (const found of findGoalMarkers(editor.getLine(line))) {
        if (found.marker?.kind !== "bare") continue;
        // Leave the one the user is inside alone; it is being typed or edited.
        if (caret.line === line && caret.ch > found.from && caret.ch < found.to) continue;
        // Each marker is stamped into ITS OWN dated form, so a line carrying
        // several comes out as `{taskgoal:…}` and `{tasktime:…}` rather than
        // several copies of whichever was written first.
        const text = markerFor(found.name, today);
        changes.push({ from: { line, ch: found.from }, to: { line, ch: found.to }, text });
      }
    }
    // Applied back to front. A transaction's positions are meant to be read
    // against the document as it was, but every stamp GROWS the line by eleven
    // characters, so anything that read them sequentially would put the second
    // marker on a line eleven columns off. Reverse order is correct either way.
    if (changes.length > 0) editor.transaction({ changes: changes.reverse() });
  }

  /**
   * One press, read through the state the control was drawn in.
   *
   * A refused task is deliberately RE-SENT rather than treated as dead: the
   * verdict is about the words, so pressing it again after rewording is the
   * whole recovery, and pressing it unchanged simply asks the model once more —
   * which is what the review screen's own chat does anyway.
   */
  onunload(): void {
    window.clearTimeout(this.stampTimer);
    // `Plugin.onunload` is synchronous; closing the socket is fire-and-forget,
    // and a close that fails is logged by `stop` itself.
    void this.live.stop();
  }

  /** The idle beat the stamp rides. Restarted on every keystroke, so it lands
   *  once the user has stopped rather than in the middle of a word. */
  private scheduleStamp(): void {
    window.clearTimeout(this.stampTimer);
    this.stampTimer = window.setTimeout(() => this.stampBareMarkers(), STAMP_IDLE_MS);
  }

  private async press(title: string): Promise<void> {
    const state = this.states.stateFor(title);
    // A press on a control still waiting for the last one is the user checking
    // it heard them, not a second request. The face already says it did.
    if (state.kind === "starting" || state.kind === "stopping") return;
    if (state.kind === "running") {
      await this.stop(title, state.taskId);
      return;
    }

    // The BUFFER, not the file on disk: the line was very likely typed moments
    // ago and the parent it sits under may be newer still. An unsaved note is
    // the normal case for this press, not an edge one.
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const notePath = view?.file?.path ?? "";
    const { context, notes, subtasks } = composeNoteContext({
      notePath,
      text: view?.editor?.getValue() ?? "",
      title,
    });
    const sourceTaskId = taskIdFor(notePath, title);
    // "starting…" from the press itself. It stands over a stale refusal too,
    // which is what a re-press after a reword is for, and the account ends it
    // — the task running, or a verdict on the row this press makes.
    this.states.markPending("starting", title, sourceTaskId);
    const result = await startTask(this.auth, { sourceTaskId, title, notePath, context, notes, subtasks });
    if (!result.ok) {
      this.states.dropPending(title);
      new Notice(result.reason === "signed-out" ? SIGNED_OUT : COULD_NOT_START);
      return;
    }
    new Notice(SENT);
    // The row this press made, so a verdict on it ends the face even when it
    // is word for word the verdict already drawn — see TaskStates.attachIntent.
    const intentId = await latestStartIntentId(this.auth, sourceTaskId);
    if (intentId) this.states.attachIntent(title, intentId);
    // The verdict lands seconds later on whichever device took it; the socket
    // reports it, and this refresh is the backstop for a socket that is down.
    void this.sync();
  }

  /**
   * "stop task", whichever way it was asked — by the control or by the box.
   *
   * "stopping…" from the press itself, before the request goes out; the account
   * ends it when the task is no longer the one running. A request that fails
   * has nothing to wait for and gives the old face straight back.
   */
  private async stop(title: string, taskId: string): Promise<void> {
    this.states.markPending("stopping", title, taskId);
    const result = await completeTask(this.auth, taskId);
    if (!result.ok) {
      this.states.dropPending(title);
      new Notice(result.reason === "signed-out" ? SIGNED_OUT : COULD_NOT_START);
      return;
    }
    void this.sync();
  }

  /**
   * A box ticked by the user's own hand (Anton, 2026-09-02).
   *
   * Ticking the running task's box finishes the task, exactly as pressing
   * "stop task" does — it is the same request down the same wire, and the
   * reducer still re-checks that the task named is the one running before it
   * ends anything. A tick on any other box is an ordinary tick: a task Happy
   * Squid is not running, or never heard of, files nothing, and signed out
   * nothing is running at all. Which lines count is `runningTaskOf`'s answer —
   * the task's own words, or the line it was started from when the squid
   * re-worded it — and a tick the plugin wrote ITSELF is not the user's, see
   * OWN_TICK_MS.
   */
  private async tick(title: string, notePath: string): Promise<void> {
    if (this.ownTicks.has(tickKey(notePath, title))) return;
    const taskId = this.states.runningTaskOf(title, taskIdFor(notePath, title));
    if (taskId) await this.stop(title, taskId);
  }

  /** The completion tick, marked as the plugin's own before it is written so
   *  the editor handing it back is not read as a tick by hand. */
  private async tickOurselves(notePath: string, title: string): Promise<void> {
    const key = tickKey(notePath, title);
    this.ownTicks.add(key);
    window.setTimeout(() => this.ownTicks.delete(key), OWN_TICK_MS);
    await tickCompleted(this.app, notePath, title);
  }
}

/** One tick's identity: the note and the words, which is all either side of
 *  the echo knows. */
function tickKey(notePath: string, title: string): string {
  return `${notePath}\n${title.trim()}`;
}

/** The title of an OPEN task line that carries the marker, or null. Kept here
 *  rather than in task-line.ts because it is the command's question. */
function titleOf(lineText: string): string | null {
  if (!lineText.includes(MARKER)) return null;
  const parsed = parseTaskLine(lineText);
  if (!parsed || parsed.done || !parsed.title) return null;
  return parsed.title;
}
