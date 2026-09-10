# Happy Squid for Obsidian

Start tasks from your notes and bring Happy Squid's task goals, daily summaries
and focus figures into your journal.

## Start a task from a checkbox

Write `{task}` after a checkbox or plain list item to create a **start task**
button:

```md
- [ ] Write the quarterly report {task}
- Read the board's comments {task}
```

Press it to start the task in Happy Squid; the button then becomes **stop task**.
Keep a Happy Squid app or browser extension running to handle the request.
Starting a task replaces the current one unless it is locked.

Ticking the checkbox in Obsidian finishes the running task. Completing it in
Happy Squid ticks the checkbox in your note too. For plain list items,
strikethrough works the same way:

```md
- ~~Read the board's comments~~ {task}
```

Completed items hide their buttons. Press **Enter** at the end of a marked item
to give the next item a button too; Enter on an empty item ends the list. To
remove a button, put the caret inside it and delete `{task}`.

Up to twenty unfinished subtasks come with the task, including nested checkboxes
and plain bullets. Happy Squid uses them and the surrounding note context to
understand the work.

While a request is pending, the button shows **starting…** or **stopping…**.
It can also show **task deemed unproductive** (hover for the reason and edit the
task to try again), **current task locked**, or **out of tasks this week**.

For keyboard access, assign a hotkey to **Happy Squid: Start or stop task at
caret**. Obsidian's **Toggle checkbox status** and **Toggle strikethrough**
commands also complete a running task.

## Put the day in your notes

### Task Goal

```md
{taskgoal:today}
```

Shows your Task Goal's progress. Open the card to see the tasks that contributed
to it, and hover over or tap the flame to see your streak. A day without a goal
reads **Task goals are disabled**.

### Daily Summary

```md
{daysummary:today}
```

Shows the day's task time, Free Time spent and times blocked. Once the day has
ended, Happy Squid writes a summary the next morning; open the card to read it.

Under **Settings → Happy Squid → Daily Summary**, you can hide or show each
figure and the written summary. These switches change the card's appearance;
your data and the individual markers below stay available.

### Individual figures

These markers produce plain text and take whatever formatting you wrap them in:

| Marker                  | What it shows                                     | Example   |
| ----------------------- | ------------------------------------------------- | --------- |
| `{tasktime:today}`      | Time spent on tasks that day                      | `1h 13m`  |
| `{freetime:today}`      | Free Time spent that day                          | `25m`     |
| `{timesblocked:today}`  | How often Happy Squid decided to block you        | `8`       |
| `{morningbutton:today}` | When you pressed the morning lock's Unlock button | `6:42 AM` |

Task time is added when a task ends; Free Time is added when you stop using it.
Blocks count Happy Squid's decisions to block a page, including announced blocks
with a grace period. Visiting or reloading the blocked page does not add a block.
If you did not press Unlock that morning, `{morningbutton}` reads
`no button unlock`.

Build your own sentences, tables and callouts:

```md
**Focus today: {tasktime:today}**

| Day | Task time             | Free Time             | Blocks                    |
| --- | --------------------- | --------------------- | ------------------------- |
| Mon | {tasktime:2026-09-07} | {freetime:2026-09-07} | {timesblocked:2026-09-07} |
| Tue | {tasktime:2026-09-08} | {freetime:2026-09-08} | {timesblocked:2026-09-08} |

> [!note] Morning
> Unlocked at {morningbutton:today}.
```

The figures and Daily Summary work without a Task Goal. If a day's data is
unavailable, its markers stay as text. The plugin archives the days it receives
for about a year, so older notes can keep their figures and summaries.

## Writing about another day and setting up templates

All six day markers accept the same four forms:

| Form                    | Day shown                                                                   |
| ----------------------- | --------------------------------------------------------------------------- |
| `{taskgoal}`            | Today when written; the plugin inserts the date so the note keeps that day. |
| `{taskgoal:today}`      | Always today, whenever you read the note.                                   |
| `{taskgoal:2026-09-01}` | A specific day.                                                             |
| `{taskgoal:template}`   | Today in the template; the new note's creation day in notes made from it.   |

Replace `taskgoal` with `daysummary`, `tasktime`, `freetime`, `timesblocked`
or `morningbutton` to use any of these forms.

Dates can be written as `2026-09-01`, `01.09.2026`, `1/9/26` or
`Sep 1, 2026`. Numeric dates put the month in the middle: `05/06/2026` means
5 June.

Use `:template` when setting up a daily-note template:

```md
{taskgoal:template}
{daysummary:template}

Task time: {tasktime:template}
Free Time: {freetime:template}
Times blocked: {timesblocked:template}
Morning unlock: {morningbutton:template}
```

In a note created on 1 September 2026, `{daysummary:template}` becomes
`{daysummary:2026-09-01}`. The template itself keeps showing today.

Inserting a template into an existing note leaves `:template` unchanged.
Use a bare marker or an explicit date there. You can also let your template
plugin supply the date:

- Core Templates: `{taskgoal:{{date:YYYY-MM-DD}}}`
- Templater: `{taskgoal:<% tp.date.now("YYYY-MM-DD") %>}`

## Account, network and payment

Requires an account; sign in under **Settings → Happy Squid**.
One task/week is free; unlimited tasks need [Pro](https://happy-squid.com).
[Our Supabase backend](https://dtptcpfaeqstzzdumfeb.supabase.co) syncs account data and
receives task text, note context and subtasks. No analytics.
[Privacy](https://happy-squid.com/privacy).

For feature documentation, visit
[happy-squid.com/documentation](https://happy-squid.com/documentation).

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Happy Squid.
