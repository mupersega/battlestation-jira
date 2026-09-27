/**
 * Calendar-date arithmetic. Dates are ISO strings (YYYY-MM-DD) with no time
 * zone; sprints start and end on whole days, so a calendar date is the right
 * unit. Arithmetic runs in UTC so that daylight-saving changes cannot shift
 * a day.
 */

/** A calendar date, YYYY-MM-DD. */
export type ISODate = string;
/** An ISO 8601 date-time with offset, for events and audit stamps. */
export type ISODateTime = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return fromUTC(d) === value;
}

export function assertISODate(value: string, what = "date"): ISODate {
  if (!isISODate(value)) throw new Error(`${what} must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  return value;
}

function toUTC(date: ISODate): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`not an ISO date: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUTC(d: Date): ISODate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(date: ISODate): number {
  return toUTC(date).getUTCDay();
}

export function isWeekend(date: ISODate): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

/** Add working days (Monday to Friday). Public holidays are not modelled. */
export function addBusinessDays(date: ISODate, days: number): ISODate {
  let d = date;
  let remaining = days;
  while (remaining > 0) {
    d = addDays(d, 1);
    if (!isWeekend(d)) remaining -= 1;
  }
  return d;
}

/** Days from `a` to `b`; positive when `b` is later. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return compareDates(a, b) >= 0 ? a : b;
}

/** The local calendar date for a moment in time (defaults to now, machine time zone). */
export function todayISO(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The calendar date part of an ISO date-time, taken as written (no time-zone conversion). */
export function datePart(dateTime: ISODateTime): ISODate {
  return dateTime.slice(0, 10);
}

const SHORT = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** A date as a person says it: "Fri 5 Feb". For text a person reads; stored and exchanged dates stay ISO. */
export function sayDate(date: ISODate): string {
  return SHORT.format(toUTC(date)).replace(",", "");
}

/** Working days (Monday to Friday) from `from` to `to`, counting both ends. Zero when `to` is before `from`. */
export function workingDaysBetween(from: ISODate, to: ISODate): number {
  let n = 0;
  for (let d = from; compareDates(d, to) <= 0; d = addDays(d, 1)) if (!isWeekend(d)) n += 1;
  return n;
}
