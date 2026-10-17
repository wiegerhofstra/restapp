import pg from 'pg';

// PostgreSQL DATE is a calendar day, not an instant. Decode it before pg can
// turn local midnight into a JavaScript Date and shift it during UTC conversion.
export function calendarDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Expected a date-only YYYY-MM-DD string');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid calendar date: ${value}`);
  return value;
}
export const calendarDateTypes = {
  getTypeParser(oid, format) {
    return oid === 1082 && format !== 'binary' ? calendarDate : pg.types.getTypeParser(oid, format);
  },
};
export function addCalendarDays(value, days) {
  const date = calendarDate(value);
  if (date === null) return null;
  if (!Number.isInteger(days)) throw new Error('Expected a whole number of days');
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return calendarDate(instant.toISOString().slice(0, 10));
}
