# Happy Squid for Obsidian

Type `{task}` after a checkbox and it draws as **start task**. Pressing it asks
Happy Squid to start that task.

```md
- [ ] Write the quarterly report {task}
```

The control has seven faces. Pressing it draws **starting…** at once, and the
control does nothing more until Happy Squid answers — a second press sends
nothing. While that task is the one running it reads **stop task**, and pressing
that draws **stopping…** the same way until the task has ended. If the
productivity check refused it, it reads **task deemed unproductive**, with the
verdict as its tooltip — rewrite the line and it goes back to "start task",
because the marker is keyed by the task's own words. And if a **locked** task is
holding the slot it reads **current task locked**, which rewriting will not fix:
starting a task from here replaces anything that is not locked, and a lock is
the one thing that refuses.

The seventh is the free tier's weekly allowance: out of tasks for the week, the
marker reads **out of tasks this week**. It is deliberately not the refused face
— nothing judged the task, and rewriting the line will not buy a task back.

The two waiting faces are the plugin's own promise, drawn before the request is
even sent, and only the account ends them: a start by the task running or being
turned away, a stop by the task no longer being the one running. A request that
fails gives the old face straight back, and a press that nothing answers within
a minute falls back to whatever the account says.

Press Enter at the end of a marked task and the next one is marked too, so a run
of tasks costs one marker rather than one per line. Enter on an empty marked task
ends the run, exactly as it ends an ordinary list. To stop marking a single task,
put the caret inside the control — it turns back into `{task}` — and delete it.

A **completed** task hides its marker outright rather than striking it through,
so a done task that carries one looks like a done task that never did.

**Ticking the box finishes the task.** While a task is the one running in Happy
Squid, ticking its checkbox — in Live Preview, in reading view, with the
_Toggle checkbox status_ command, or by typing an `x` into the brackets — ends
it exactly as pressing **stop task** does. Any other box is an ordinary box: a
task Happy Squid is not running, or never heard of, ticks off with nothing
sent. It works the other way round too — finishing the task in Happy Squid
ticks the box for you, next time the plugin looks, so a task finished while
Obsidian was shut is ticked at the next launch.

There is also a command, **Start or stop task under cursor**, which needs no
rendering and works in Live Preview, reading view and source mode alike. Give it
a hotkey.

## Account, network and payment

**An account is required.** Everything the plugin draws or does reads from a
Happy Squid account — the same one the browser extension and the phone apps sign
into. Sign in under Settings → Happy Squid with a six-digit email code. Signed
out, the markers stay as the text you typed and the control sends nothing.

**Payment is required for full access.** Happy Squid's free version allows one
task a week; unlimited tasks need the paid Pro subscription, which is bought at
[happy-squid.com](https://happy-squid.com) or in the apps and never through this
plugin. Out of tasks, the control reads **out of tasks this week** and starts
nothing.

**Network use.** The plugin talks to exactly one remote service: Happy Squid's
own backend, hosted on Supabase at `https://dtptcpfaeqstzzdumfeb.supabase.co`.
It uses it to sign you in, to read your own account's rows (the task that is
running, your Task Goal and day records, and what became of the tasks you
started from notes), to start and stop tasks through the `obsidian-intent`
function, and to hold a realtime connection so the control updates within a
second rather than at the next 30-second poll. When you press **start task** it
sends the task's own words, the note's path, where the line sits (folder, note,
heading, parent item and the parent's own description lines) and the item's
continuation lines, because that is what Happy Squid's productivity check reads.
Nothing else leaves the vault — no other note content, no telemetry, no
analytics. Happy Squid's privacy policy is at
[happy-squid.com/privacy](https://happy-squid.com/privacy).

**Files.** The plugin reads and writes notes inside the vault only, and the only
edits it ever makes are the four listed under [The Task Goal card](#in-a-template).
Everything it stores for itself — your session, the days it has archived, the
settings below — goes through Obsidian's own plugin data API, into
`.obsidian/plugins/happy-squid/data.json` inside the vault. It writes nothing to
`localStorage` and nothing outside the vault. See [Signing in](#signing-in).

## The Task Goal card

Type `{taskgoal}` anywhere in a note and it draws your Task Goal:

```md
{taskgoal}
{taskgoal:today}
{taskgoal:template}
{taskgoal:29.08.2026}
```

It is the phone's Task Goal row — the same ground, the same two lines, the same
flame — in your own theme's accent, with its bottom corners rounded because here
it stands on its own rather than on top of a stack of blocks. The flame reveals
the streak on hover, and is a toggle for a device with no pointer.

**A card is about one DAY**, and the marker says which:

| marker                  | the day it shows                                                    |
| ----------------------- | ------------------------------------------------------------------- |
| `{taskgoal}`            | the day you wrote it. Live until that midnight, then fixed forever. |
| `{taskgoal:today}`      | always today, wherever and whenever it is read.                     |
| `{taskgoal:template}`   | today here, and the note's own day in each note made from it.       |
| `{taskgoal:29.08.2026}` | that day, forever.                                                  |

That is the point of the dated forms — every other surface draws the goal as it
stands now, and a page from last Tuesday doing the same thing is wrong the day
after it is written.

**A day with no Task Goal draws the card anyway**, reading _Task goals are
disabled_. Switching goals off does not make a note full of `{taskgoal}` markers
fall back to raw text — "there was no goal that day" is an answer, the same one
the four figures give by printing a zero. Only a day this vault was never told
about is silent.

The bare `{taskgoal}` needs its day written down to keep it, so shortly after you
type one the plugin fills it in for you: `{taskgoal}` becomes
`{taskgoal:2026-08-30}`. It waits until you have stopped typing, never touches a
marker your cursor is inside, and only ever writes to a note you have edited
today — so browsing back through old notes cannot rewrite them. It is a single
edit, so one undo takes it back.

### In a template

A bare `{taskgoal}` in a **template** is stamped with the day you wrote the
_template_, and every note you then create from it carries that one frozen day.
Write `{taskgoal:template}` instead:

```md
{taskgoal:template}
```

It draws today's card where it sits, so you can see what you are writing, and
every note created from that template gets a plain `{taskgoal}` — dated, a moment
later, to the day that note was made. The template itself is left alone, because
only the notes made from it are ever created.

The one flow this does not reach is inserting a template into a note that already
exists: nothing is created, so the marker stays as it is and goes on drawing
today's card. Adding a goal to an existing note by hand needs none of this — just
write `{taskgoal}`.

`:template` works on every day marker, not just the card —
`{daysummary:template}`, `{tasktime:template}`, `{timesblocked:template}`,
`{freetime:template}` and `{morningbutton:template}` all behave the same way, and
a line carrying several is unwrapped into each of their own names.

Both markers still work if you would rather have your template plugin fill the
date in: `{taskgoal:{{date:YYYY-MM-DD}}}` for core Templates,
`{taskgoal:<% tp.date.now("YYYY-MM-DD") %>}` for Templater.

Stamping a bare marker with its day, unwrapping a `:template` one in a new note,
ticking a finished task's checkbox and writing a re-worded task under yours are
the only four things the plugin ever writes into a note. The first three replace
text you or your template put there with the same text carrying a fact it could
not hold otherwise, and never write a word you did not. The fourth is the one
that does: if Happy Squid refused a task as too vague and you talked it round in
the review, the squid may start the task under its own more precise wording —
and rather than rewrite your line, the plugin adds that wording as a NEW task
directly under yours, wearing your bullet and indent, showing **stop task** from
the moment it lands. Finishing the task ticks both boxes.

**Write the month in the middle, with separators.** `29.08.2026`, `2026-08-29`,
`29/8/26` and `29_08_2026` all work — year first if you start with a four-digit
year, day first otherwise, and the month in between either way. `05/06/2026` is
the 5th of June. A run of digits with nothing between them (`20260829`) is not
read: notes are full of numbers that are not dates.

Month-first numbers (`08/29/2026`) are not read, because `05/06/2026` would then
mean two different days and nothing in it says which. If that is your habit, two
spellings always work:

```md
{taskgoal:2026-08-29}
{taskgoal:Aug 29, 2026}
```

A spelled-out month is never ambiguous, so it can go either side: `29 Aug 2026`,
`August 29, 2026` and `1 Sept 2026` all read. A date the plugin cannot read stays
on the page as you typed it, so you can see it did not take.

**A day nobody recorded has no card**, and the marker stays as the text you
typed. Happy Squid keeps the last eight days that have ended, so a note about any
day in the past week works even if Obsidian was closed all week — the plugin
picks those up and files them away, and its own archive goes back about a year
from there. Before that, or for a note read while signed out or with no goal
configured, there is nothing to draw. There is no message for it; the unrendered
marker is the tell.

## The task time

Type `{tasktime}` and it prints the task time you logged that day, as plain text:

```md
{tasktime}
{tasktime:today}
{tasktime:29.08.2026}
```

It comes out as `1h 13m`, `47m` or `0m` — nothing else, no card, no styling of
its own. **It takes whatever formatting you wrap it in**, so you can build your
own blocks around it:

```md
**Focus today: {tasktime:today}**

| Day | Logged                |
| --- | --------------------- |
| Mon | {tasktime:2026-08-24} |
| Tue | {tasktime:2026-08-25} |

> [!note] Yesterday
> {tasktime:2026-08-29}
```

The three forms mean exactly what they do for `{taskgoal}`, and a bare
`{tasktime}` is stamped with its day in the same way.

**You do not need a Task Goal for this.** `{taskgoal}` draws a card only when a
goal governed that day; `{tasktime}` just reports the work, so it answers whether
or not you have ever set a target. It is the day's own time, too — with a weekly
goal the card climbs across the week and this does not.

Today prints `0m` before you have finished anything, rather than sitting there
unrendered. A day from before Happy Squid was watching prints nothing at all.

## The blocks and the free time

Two more figures about the same day, in the same three forms and with the same
stamping:

```md
{timesblocked}
{timesblocked:today}
{timesblocked:29.08.2026}

{freetime}
{freetime:today}
{freetime:29.08.2026}
```

`{timesblocked}` is **how many times the squid blocked you** that day — a bare
number, `0`, `1`, `7`. It counts the moments Happy Squid decided to pull you off
a page, not the times you landed on the blocked page: a walled site sends you
there on every visit and every reload, so that number would just be counting
keystrokes. A block that came with a grace window ("blocking in 15s") counts when
it is announced, whether or not you left before it fired.

`{freetime}` is **the Free Time you spent** that day — `25m`, `1h 19m`, `0m`, the
same spelling as the budget in the popup. It is the calendar day, so time you
spend after midnight counts towards the new day even though your Free Time budget
itself resets at 4 AM. Time you are spending _right now_ is added when you stop —
the same way a task counts once you finish it.

Neither needs a Task Goal, and both carry no styling of their own, so they take
whatever you wrap them in:

```md
Blocked **{timesblocked:today}** times · {freetime:today} of free time spent.

| Day | Blocks                    | Free time             |
| --- | ------------------------- | --------------------- |
| Mon | {timesblocked:2026-08-24} | {freetime:2026-08-24} |
| Tue | {timesblocked:2026-08-25} | {freetime:2026-08-25} |
```

Today prints `0` and `0m` before anything has happened, and so does any day Happy
Squid was watching but nothing happened on. Only a day it knows nothing about — a
note from before you installed it, or one older than the archive goes back —
stays as the text you typed.

## The morning button

Type `{morningbutton}` and it prints the time you pressed **Unlock** on the
morning lock that day:

```md
{morningbutton}
{morningbutton:today}
{morningbutton:29.08.2026}
```

It comes out as `6:42 AM` — the same 12-hour clock the morning lock's own
"Start lock at" and "Automatically unlocks at" boxes show. On the hour it reads
`7 AM`, again as those boxes do. Like the other figures it carries no styling, so
it takes whatever you wrap it in:

```md
Up at **{morningbutton:today}**.

| Day | Up at                      | Blocks                    |
| --- | -------------------------- | ------------------------- |
| Mon | {morningbutton:2026-08-24} | {timesblocked:2026-08-24} |
| Tue | {morningbutton:2026-08-25} | {timesblocked:2026-08-25} |
```

**A morning you did not press it reads `no button unlock`.** The lock may have
been off, or it may have unlocked on its own at its usual time — either way there
is no time to print, and this is the one figure with no zero to fall back on. A
day Happy Squid knows nothing about still prints nothing at all and stays as the
text you typed, exactly like the others.

## The daily summary

Type `{daysummary}` and it draws the day at a glance — what you worked, what you
spent, how often the squid stopped you — with the squid's own account of the day
folded underneath:

```md
{daysummary}
{daysummary:today}
{daysummary:29.08.2026}
```

The three forms mean exactly what they do for `{taskgoal}`, and a bare
`{daysummary}` is stamped with its day in the same way.

The header is always there: **`3h 17m tasks · 47m free time · 8 blocks`**, the
same three figures `{tasktime}`, `{freetime}` and `{timesblocked}` print on their
own. Press it and the card opens onto the paragraph Happy Squid wrote when it
folded that day away.

**On the day itself there is nothing to open, and that is normal.** Happy Squid
writes about a day once the day has ended, so a note you are writing now shows
its figures straight away and grows its paragraph the next morning. No chevron
means there is nothing there yet.

**Happy Squid deletes its summaries after seven days; your note keeps them.**
That is the point of putting one in a note. Once the plugin has seen a summary it
files it in its own archive alongside everything else, so a daily note from last
year still reads the way it did when you wrote it. You do not need a Task Goal
for this one, and a day nobody recorded stays as the text you typed, exactly like
the others.

**You can switch any part of it off.** Settings → Happy Squid → Daily Summary has
a switch for each of the four things the card shows: the time spent on tasks, the
Free Time spent, the times blocked, and the written summary. They only change what
the card DRAWS — everything goes on being recorded exactly as before, so a switch
turned back on shows the figures it was hiding, and the `{tasktime}`,
`{freetime}` and `{timesblocked}` markers are untouched by them.

## Building

```bash
npm install
npm run build      # tsc --noEmit, then esbuild → main.js
npm run dev        # watch
npm run check      # types only
npm run lint       # Obsidian's own community-directory review rules (eslint-plugin-obsidianmd)
```

`npm run lint` runs the same rules the community directory's scanner applies to
every release, so run it before tagging one. Warnings there do not block a
listing; errors do.

`main.js` is the bundle Obsidian loads and is not committed: it belongs to a
release, not to the tree. To try a build, copy `main.js`, `manifest.json` and
`styles.css` into `<vault>/.obsidian/plugins/happy-squid/` and enable it under
Settings → Community plugins.

The plugin is developed inside Happy Squid's own repository, beside the browser
extension and the phone apps, and this repository is that folder laid out to
stand on its own. Every release is published from there, so the source here is
always the source that built the release beside it, and a release rebuilt from
this repository comes out byte for byte identical.

`src/vendor/` is the one seam between the two. Three files are carried over
verbatim — the day a note names, how a task figure is spelled, how a time of day
is spelled — because each is the single place the product spells that thing
anywhere, and a second copy of those rules is exactly the drift they exist to
prevent. All three import nothing at all, which is what makes carrying them
across possible. Edit them in Happy Squid; this copy is regenerated.

The plugin's real logic — the line parser in `src/task-line.ts`, the note reader
in `src/note-context.ts`, the goal arithmetic in `src/goal.ts` — is deliberately
free of Obsidian and CodeMirror imports, so it is tested as plain functions by
Happy Squid's own suite rather than sitting behind a second test runner.

## How a task actually starts

The plugin does not write the task and could not: `task_intents` grants a client
`select` and `update` on its own rows and nothing else. Pressing the control
POSTs to the `obsidian-intent` Edge Function, which inserts a `start` intent, and
whichever Happy Squid device is awake claims it atomically and turns it into a
real `USER_TASK_START`.

**Which device handles it** is a preference the plugin sends: an intent from a
desktop vault asks for a desktop device, and a phone stands back for twelve
seconds before claiming it anyway. That is what stops the review for a refused
task appearing on a phone in your pocket while you are looking at your laptop.

**Where the wait goes**, from the press to the face changing: the Edge Function
writes the intent (under a second); a device claims it — the desktop app and the
Android app hold a socket and hear of it in about a second, a browser extension
on its own hears at its next 30-second sync alarm, and a phone stands back the
twelve seconds above; a start then runs the productivity check, an AI call that
takes seconds (skipped for a wording the check has already approved); the
device pushes the task within 150 ms; the plugin's socket reports the push and
one refresh reads it back. A stop skips the check and is the shorter trip. The
waiting faces are what cover that span; the plugin itself adds nothing to it.

That indirection is the point. Writing `activeTask` into `user_state` directly
would appear to work — a pulled task is fully adopted by the reducer — while
skipping the productivity verdict, the "a task is already running" refusal, the
unblock-session teardown and the history row. Four questions an imported task
raises were already answered by the Todoist integration and are inherited
unchanged: it runs **open-ended** (no duration, a hidden backstop), it takes the
account's own Free Time setting, a late-claimed completion re-checks what is
actually running, and the wire carries the TITLE with the device rendering the
context block around it.

## Signing in

Settings → Happy Squid, with the same six-digit email code the extension and the
apps use. Google OAuth is deliberately not offered: the extension reaches it
through `chrome.identity`, and the redirect dance a desktop app needs instead
would be a second auth surface onto the same account.

The session is stored by `saveData`, which writes
`.obsidian/plugins/happy-squid/data.json` **inside the vault**. On a synced vault
the refresh token syncs with it. That is the ordinary plugin convention and it is
what makes this work on a phone, but the token is only as private as the vault.

## What is deliberately not here yet

- **A box ticked outside Obsidian.** The plugin listens to the editor and to
  reading view, not to the files on disk, so a tick that arrives by sync or
  from another app finishes nothing unless the note happens to be open in
  front of you. A tick made here while nothing is running files nothing
  either; there is no queue of ticks waiting for a task to start.
- **A stable id across a rename.** `source_task_id` is derived from the note path
  and the task's own words, so rewording a task makes it a different item. That
  is deliberate and load-bearing here — it is exactly what resets a refused
  marker — but it does mean a task renamed while running loses its "stop task"
  face until the words match again.
- **The read widgets** — task goals, task/session/day summaries rendered into a
  note. Different feature, same account.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Happy Squid.
