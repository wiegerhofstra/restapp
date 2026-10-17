export function formatMoney(cents: number | null | undefined, currency = "EUR") {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(value));
}

// Decimal text for Dutch forms/PDFs; no grouping so it remains easy to edit.
export function decimalNl(value:number, digits=2) {
  return value.toLocaleString('nl-NL',{minimumFractionDigits:digits,maximumFractionDigits:digits,useGrouping:false});
}

export function durationMinutes(start: string, end?: string | null) {
  return Math.max(0, Math.round((new Date(end ?? Date.now()).getTime() - new Date(start).getTime()) / 60000));
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return `${hours} uur ${remainder.toString().padStart(2, "0")} min`;
}
