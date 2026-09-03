// Converts between the stored 24-hour times and the 12-hour clock the editors show.
// The editors are the from/to window pickers for Free Time's disable window and for
// the scheduled global lock. A schedule is stored as an "HH:MM" string on a 24-hour
// clock. The editor shows a compact box holding either an hour or an hour and
// minutes, next to an AM/PM toggle.

export type Hour12Period = "AM" | "PM";

export interface Hour12Time {
  input: string;
  period: Hour12Period;
}

const MAX_HOUR_12 = 12;
const MAX_MINUTE = 59;
const HOUR_12_INPUT = /^\d{0,2}(?::\d{0,2})?$/;

export function parseTimeToHour12(hhmm: string): Hour12Time {
  const [h, minute = 0] = hhmm.split(":").map(Number);
  const period: Hour12Period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return {
    input: minute === 0 ? String(h12) : `${h12}:${String(minute).padStart(2, "0")}`,
    period,
  };
}

export function editHour12Time(time: Hour12Time, input: string): Hour12Time {
  return HOUR_12_INPUT.test(input) ? { ...time, input } : time;
}

export function normalizeHour12Time(time: Hour12Time): Hour12Time {
  const [hourInput, minuteInput] = time.input.split(":");
  const hour = clampInteger(hourInput, 1, MAX_HOUR_12);
  if (minuteInput === undefined) return { ...time, input: String(hour) };
  const minute = clampInteger(minuteInput, 0, MAX_MINUTE);
  return { ...time, input: `${hour}:${String(minute).padStart(2, "0")}` };
}

export function formatHour12To24(time: Hour12Time): string {
  const normalized = normalizeHour12Time(time);
  const [hourInput, minuteInput = "0"] = normalized.input.split(":");
  let hour = Number(hourInput) % 12;
  if (normalized.period === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${minuteInput.padStart(2, "0")}`;
}

function clampInteger(input: string, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(Number(input) || 0)));
}
