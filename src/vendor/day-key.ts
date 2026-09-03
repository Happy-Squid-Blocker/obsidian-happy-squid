/**
 * A calendar DATE as a string — "2026-08-29" — the local midnight it names, and
 * a TIME OF DAY as the clock on the wall showed it — "06:42".
 *
 * This exists because a day used as a KEY must not be a timestamp. Everywhere
 * else in the Model a day is an instant (`logicalDayStart` and friends), which is
 * right for arithmetic and wrong for identity: the same Tuesday is a different
 * number on a laptop in Berlin and a phone in New York, and a value written
 * before the Task Goal boundary moved from `usageResetTime` to midnight is a
 * 4 AM instant sitting in the middle of the day it belongs to. Two writers
 * meaning the same day and disagreeing about the number is a lookup that misses
 * with no symptom at all — see the Task Goal day store, whose whole job is to be
 * read back by date.
 *
 * A date string cannot drift that way: it is what the calendar on the wall says,
 * every device agrees on how to spell it, and a human reading the stored JSON
 * can tell at a glance which day a row is about.
 *
 * Local, deliberately, and never UTC. The day a user means by "Tuesday" is the
 * one their own clock showed, which is the same reason the goal's own boundary
 * is local midnight rather than an offset from epoch.
 *
 * Importless, and it must stay that way: the Obsidian plugin reads these
 * functions, and its rule is that everything it reaches across for drags no type
 * graph behind it (see obsidian/src/goal.ts).
 */

/** The calendar date containing `ts`, as `YYYY-MM-DD` in local time. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * The time of day at `ts`, as `HH:MM` on a 24-hour local clock.
 *
 * A recorded time is written down the way a recorded DAY is, and for the same
 * reason: what is being kept is what the user's own clock said, not an instant.
 * "I pressed Unlock at 6:42" stays 6:42 in a note read next year, on a laptop
 * that has since crossed three timezones — where an instant would have become
 * 3:42 or 9:42 with nothing on the page to say it had moved.
 *
 * It is also the spelling the Model already uses for every time of day the user
 * SETS — a block schedule's window, Free Time's disable hours, the morning
 * lock's own `startAt` and `autoUnlockAt` are all "HH:MM" 24-hour strings — so a
 * time the product records and a time the user typed are one kind of value, and
 * `view/shared/hour12.ts` is the single place either is turned into the 12-hour
 * clock every editor shows.
 */
export function clockKey(ts: number): string {
  const d = new Date(ts);
  return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
}

/**
 * Local midnight of the date `key` names, or null when it is not a date.
 *
 * Real dates only: `2026-02-30` is arithmetic, not a day, and a `Date` built
 * from it rolls silently into March. The round-trip through {@link dayKey} is
 * what catches that, and it catches every other rollover with it.
 */
export function dayKeyStart(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return dayKey(d.getTime()) === key ? d.getTime() : null;
}

/** The date `days` after `key`, or null when `key` is not a date. Stepped by the
 *  CALENDAR rather than by adding milliseconds, so a daylight-saving crossing
 *  moves by one day like every other. */
export function addDays(key: string, days: number): string | null {
  const start = dayKeyStart(key);
  if (start === null) return null;
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return dayKey(d.getTime());
}

/**
 * The IANA name of the zone this device's clock is keeping — "Europe/Berlin" —
 * or undefined where the runtime cannot say.
 *
 * The third local-clock fact in this file, and the only one that is not a value
 * we store in the Model. It exists for the SERVER: `dayKey` and
 * `logicalDayStart` above are pure local-clock functions, so an account's
 * "4 AM" is a question only something on the user's own clock can answer, and
 * the backend holds epoch milliseconds and the string "04:00". The sync push
 * stamps this onto every `user_state` row it writes and the daily fold reads the
 * newest one back — see the `user_state.time_zone` migration.
 *
 * A NAME and never an offset. An offset is right for half the year, and the one
 * job that reads this runs at 4 AM, which is close enough to a DST turn that
 * getting it wrong files a day's summary under the wrong date.
 *
 * Undefined rather than a guess when `Intl` is missing or throws. The reader
 * treats an absent zone as "fall back", which is a fold that happens late; a
 * wrong zone is a fold that happens on the wrong day, and nothing downstream
 * could tell the two apart.
 */
export function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
