/** Calendar-date helpers for display. Dates are YYYY-MM-DD; arithmetic is in UTC so a day never shifts. */

export function toUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dayFormat = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const longFormat = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonthFormat = new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' });
const dateTimeFormat = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "Wed 28 Oct" */
export const formatDay = (date: string): string => dayFormat.format(toUtc(date)).replace(',', '');
/** "Wednesday 28 October 2026" */
export const formatLong = (date: string): string => longFormat.format(toUtc(date)).replace(',', '');
/** "October 2026" */
export const formatMonth = (date: string): string => monthFormat.format(toUtc(date));
/** "Oct" */
export const formatShortMonth = (date: string): string => shortMonthFormat.format(toUtc(date));
/** An event's date and time in the viewer's own time zone: "Mon 5 Oct, 7:00 pm" */
export const formatDateTime = (dateTime: string): string => dateTimeFormat.format(new Date(dateTime));

/** "today", "tomorrow", "in 12 days", "3 days overdue" */
export function relativeDays(inDays: number): string {
  if (inDays === 0) return 'today';
  if (inDays === 1) return 'tomorrow';
  if (inDays === -1) return '1 day overdue';
  return inDays > 0 ? `in ${inDays} days` : `${-inDays} days overdue`;
}

const two = (n: number) => String(n).padStart(2, '0');

/** A moment as a date-and-time field holds it: this machine's local time, to the minute. */
export function toField(at: string | null): string {
  if (!at) return '';
  const d = new Date(at);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The day a moment falls on here, as YYYY-MM-DD. */
export function localDay(at: string): string {
  return toField(at).slice(0, 10);
}

/** What a date-and-time field holds, as a moment with this machine's offset from UTC on that day. */
export function fromField(value: string): string {
  const offset = -new Date(value).getTimezoneOffset();
  const ahead = Math.abs(offset);
  return `${value}:00${offset < 0 ? '-' : '+'}${two(Math.floor(ahead / 60))}:${two(ahead % 60)}`;
}
