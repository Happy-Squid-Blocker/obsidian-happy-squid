/**
 * The note a fresh install writes and opens.
 *
 * The README is the plugin's documentation and the community directory renders
 * it on the listing page, so it is written for somebody deciding whether to
 * install. This is for somebody who just has, and it teaches the only way this
 * plugin can be taught: by SHOWING. Every live marker below is real, so the note
 * is the feature rather than a description of it — press the control, and the
 * card fills in the moment the account answers.
 *
 * The copy is Anton's (2026-09-03) and is not to be rewritten here.
 *
 * Four things about the plugin decide what may be written, and all four are
 * worth knowing before editing the text:
 *
 *  - **A marker renders wherever it appears**, including inside a code fence or
 *    inline code: both rendering paths scan raw text and neither knows anything
 *    about code. So syntax cannot be shown by quoting it in the ordinary way.
 *  - **Quotation marks INSIDE the braces are how it is shown anyway** (Anton's
 *    own answer to that): `{"taskgoal:today"}` misses the marker regex, which
 *    wants a name straight after the brace, so it stays as text on the page —
 *    VERIFIED against `findGoalMarkers`, which sees nothing in it. The note says
 *    so in the one place it uses the trick, because a reader who copies the
 *    quotes gets a marker that does nothing.
 *  - **Only the dated forms are safe to use LIVE.** A bare marker is stamped
 *    with today's date shortly after the note is opened, which would rewrite
 *    this note under the reader; a `:template` one is unwrapped the moment the
 *    file is created, which is this note. Every live marker here says `:today`,
 *    which is neither — and `:template` appears only in quotes, where nothing
 *    can act on it.
 *  - **The stamp writes ISO**, so the example of what a template marker becomes
 *    has to be ISO too. A user may WRITE `01.09.2026` and the parser takes it;
 *    the plugin never writes that form itself.
 *
 * The text is deliberately kept in one importless function so the extension's
 * own suite can hold it, the way `task-line.ts` and `goal.ts` are held.
 */

/** Where the note is written, at the vault root. Never overwritten: a vault
 *  that already has a file by this name keeps it, and nothing is created. */
export const WELCOME_PATH = "Happy Squid.md";

/**
 * The note's text.
 *
 * A function rather than a constant so the tests read the same string the vault
 * gets, and so a future version can vary it without every caller changing.
 */
export function welcomeNote(): string {
  return `# Welcome to Happy Squid

This plugin connects your notes to Happy Squid: start a task from a checkbox,
and pull what you actually did back into your daily notes.

## First, sign in

Open **Settings → Happy Squid** and sign in with the six-digit code sent to your
email.

## Start a task from a checkbox

- [ ] Try Happy Squid {task}

Write {task} after any checkbox to create a start task button. After the task
was send to Happy Squid the button automatically switches to stop task.

Complete a task by clicking the checkmark icon in Happy Squid or Obsidian.
Completing a task stops it automatically.

## Put the day in your notes

Your Task Goal, as it stands right now:

{taskgoal:today}

Press it to see the tasks the day was made of.

The day at a glance, with the account of it that Happy Squid writes each
morning, once the day has ended:

{daysummary:today}

And four plain figures, which take whatever formatting you wrap them in:

- Time spent on tasks: {tasktime:today}
- Free Time spent: {freetime:today}
- Times blocked: {timesblocked:today}
- Morning unlock: {morningbutton:today}

## Writing about another day and setting up templates

Every marker here says today, for example {"taskgoal:today"} (quotation marks
just to show the marker, remove quotation marks for the marker to work) so it
always shows the day it is read on.

Leave the day out and the plugin fills in the day you wrote it, which is what
makes a daily note still read correctly a year later. Write a concrete date to
get the data for that day, for example {"taskgoal:01.09.2026"}

When setting up a template use {"taskgoal:template"}. In the template that
always shows today, when creating a note from that template it inserts the date
you are creating the new note. {"daysummary:template"} becomes
{"daysummary:2026-09-01"} when you are creating the note on the first of
september.

## Where to read more

The full documentation is on the plugin's page under **Settings → Community
plugins**, and the settings tab has a switch for each part of the daily summary
card. Also under happy-squid.com/documentation#integrations.

You can delete this note whenever you like. It is written once, when the plugin
is first installed, and never again.
`;
}
