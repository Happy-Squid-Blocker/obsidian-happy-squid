/** A value within this many seconds of the next minute is displayed as that
 * minute. This absorbs the sub-second skew of the render clock. Without it, a
 * lock that was just set to 5:00 is measured as 4:59.9 and reads "4m". */
const GRACE_SECONDS = 2;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
const MILLISECONDS_PER_MINUTE = 60_000;
const GLOBAL_LOCK_MINUTE_DETAIL_LIMIT_HOURS = 10;
const GLOBAL_LOCK_HOUR_DETAIL_LIMIT_DAYS = 10;

/** Formats a whole number of minutes in hours and minutes alone — "47m", "1h
 *  19m", "6h" — however large it grows. Twenty-six hours is "26h", never
 *  "1d 2h". */
function formatHoursMinutes(m: number): string {
  if (m < MINUTES_PER_HOUR) return `${m}m`;
  const h = Math.floor(m / MINUTES_PER_HOUR);
  const mm = m % MINUTES_PER_HOUR;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}

/** Formats a whole number of minutes as "47m", "1h 19m" or "0m". Once the value
 *  crosses 24 hours it collapses to days and hours, such as "2d 4h". */
export function formatWholeMinutes(m: number): string {
  const days = Math.floor(m / MINUTES_PER_DAY);
  if (days >= 1) {
    const hours = Math.floor((m - days * MINUTES_PER_DAY) / MINUTES_PER_HOUR);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  return formatHoursMinutes(m);
}

/**
 * Formats a Task Goal figure: the target, the time logged against it, and the
 * time left. It is {@link formatMinutesSpaced} with the day collapse taken out
 * — a goal is a number of HOURS worked in a day or a week, and the editor that
 * sets it has an hours box and a minutes box and nothing else, so a 30-hour
 * week reads "30h" here rather than "1d 6h". Every surface that prints a goal
 * figure goes through this, browser and phones alike, so none of them can drift
 * into days on their own.
 */
export function formatGoalMinutes(minutes: number): string {
  return formatHoursMinutes(Math.floor(Math.max(0, minutes) + GRACE_SECONDS / MINUTES_PER_HOUR));
}

function remainingWholeMinutes(until: number, now: number): number {
  const ms = Math.max(0, until - now);
  if (ms <= 0) return 0;
  return Math.max(1, Math.floor(ms / MILLISECONDS_PER_MINUTE + GRACE_SECONDS / MINUTES_PER_HOUR));
}

/**
 * Formats a spendable budget of minutes, such as remaining free time or
 * remaining usage, as "1h 19m", "47m" or "0m". It rounds down, but with the
 * GRACE_SECONDS window so a value within two seconds of the next minute reads as
 * that minute. A budget that was just set to 35 minutes therefore shows "35m"
 * rather than "34m" when the render clock is slightly off. Less than a full
 * minute left reads "0m", because that little left means the budget is spent.
 * This is the opposite of formatMsRemaining, which is a running countdown and
 * keeps showing "1m" until it reaches zero.
 */
export function formatMinutesSpaced(minutes: number): string {
  return formatWholeMinutes(Math.floor(Math.max(0, minutes) + GRACE_SECONDS / MINUTES_PER_HOUR));
}

/**
 * Formats a running countdown to a deadline, such as a lock or a task expiry. It
 * uses the same grace window as the budget formatter. The difference is that
 * anything between one second and one minute reads "1m", so a ticking timer
 * never shows "0m". Only a timer that has fully elapsed reads "0m".
 */
export function formatMsRemaining(until: number, now: number): string {
  return formatWholeMinutes(remainingWholeMinutes(until, now));
}

/**
 * Formats a compact countdown for the Global Lock summary pills. Minute
 * precision stays useful below 10 hours, and hour precision below 10 days. Past
 * those thresholds the smaller unit adds visual noise without making the summary
 * any more useful.
 */
export function formatGlobalLockCounter(until: number, now: number): string {
  const minutes = remainingWholeMinutes(until, now);
  if (minutes >= GLOBAL_LOCK_HOUR_DETAIL_LIMIT_DAYS * MINUTES_PER_DAY) {
    return `${Math.floor(minutes / MINUTES_PER_DAY)}d`;
  }
  if (minutes >= GLOBAL_LOCK_MINUTE_DETAIL_LIMIT_HOURS * MINUTES_PER_HOUR && minutes < MINUTES_PER_DAY) {
    return `${Math.floor(minutes / MINUTES_PER_HOUR)}h`;
  }
  return formatWholeMinutes(minutes);
}

/** Collapses a whole number of minutes to its single largest unit, so "2d", "1h"
 *  or "47m". It never returns a two-part string such as "2d 4h" or "1h 19m". */
function formatBiggestUnit(m: number): string {
  if (m >= MINUTES_PER_DAY) return `${Math.floor(m / MINUTES_PER_DAY)}d`;
  if (m >= MINUTES_PER_HOUR) return `${Math.floor(m / MINUTES_PER_HOUR)}h`;
  return `${m}m`;
}

/**
 * Works like formatMsRemaining but shows only the biggest unit of time, so
 * either days, or hours, or minutes. The lock pills on the website blocks use
 * it, in WebsiteSmall and WebsiteBig. There the countdown is a rough magnitude
 * the user takes in at a glance rather than a precise deadline. So "2d 4h" reads
 * "2d" and "1h 19m" reads "1h".
 */
export function formatMsRemainingBiggestUnit(until: number, now: number): string {
  return formatBiggestUnit(remainingWholeMinutes(until, now));
}

/** Category labels are stored lowercase, for example "shopping" or "adult
 *  content". The lock pills title-case them so the button reads "Lock Shopping"
 *  or "Lock Adult Content" — on the blocked page and, for an application walled
 *  by a category block, on the phone's app wall. */
export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A plan's date, as the Manage Subscription card states it: "21 Sept 2081".
 *
 * The SPELLING is the design's own, recovered rather than chosen — the frame Anton
 * drew reads "21 Sept 2081", which is exactly what `en-GB` gives at
 * `{day, month: "short", year}` ("Sept" with four letters is CLDR's British
 * abbreviation for September; `en-US` would give "Sep 21, 2081", a different shape
 * entirely). So the LOCALE IS PINNED rather than taken from the device: this
 * product has no other translated string in it, and a date that changes shape by
 * machine would be the one piece of the design that does.
 *
 * The space between the day and the month is a NON-BREAKING one, and that is the
 * design's too — it is Apple's, from the sheet the cancellation copy was measured
 * off — because a day and its month broken across two lines read as two dates. The
 * one between the month and the year is ordinary, so the line still has somewhere
 * to break on a narrow card.
 *
 * Built from `formatToParts` rather than by patching the formatted string, since
 * the only thing that reliably names the separator between the day and the month
 * is the part list itself.
 */
export function formatPlanDate(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(new Date(epochMs));
  // The first literal after the day is the one that binds the two together; every
  // later separator is left as it came.
  let boundDay = false;
  return parts
    .map((part) => {
      if (part.type !== "literal") return part.value;
      if (boundDay) return part.value;
      boundDay = true;
      // Spelled as an escape so it is visible in source, exactly as the
      // placeholder this replaced spelled its own.
      return "\u00A0";
    })
    .join("");
}
