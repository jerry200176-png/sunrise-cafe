/**
 * Booking calendar (.ics) builder — guest add-to-calendar without SMS vendors.
 */
import { toTaipei } from "@/lib/datetime";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format as UTC iCalendar DATE-TIME (YYYYMMDDTHHMMSSZ) */
export function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function buildBookingIcs(opts: {
  bookingCode: string;
  summary: string;
  description: string;
  location?: string;
  startTime: string;
  endTime: string;
}): string {
  const uid = `${opts.bookingCode}@sunrise-cafe`;
  const dtStamp = toIcsUtc(new Date().toISOString());
  const dtStart = toIcsUtc(opts.startTime);
  const dtEnd = toIcsUtc(opts.endTime);
  const escape = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sunrise Cafe//Booking//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escape(opts.summary)}`,
    `DESCRIPTION:${escape(opts.description)}`,
  ];
  if (opts.location) lines.push(`LOCATION:${escape(opts.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Human Taipei range for descriptions */
export function taipeiRangeLabel(start: string, end: string): string {
  const s = toTaipei(start);
  const e = toTaipei(end);
  const d = `${s.getFullYear()}/${pad(s.getMonth() + 1)}/${pad(s.getDate())}`;
  return `${d} ${pad(s.getHours())}:${pad(s.getMinutes())}–${pad(e.getHours())}:${pad(e.getMinutes())}`;
}

export function buildGoogleCalendarUrl(opts: {
  summary: string;
  description: string;
  location?: string;
  startTime: string;
  endTime: string;
}): string {
  const dtStart = toIcsUtc(opts.startTime);
  const dtEnd = toIcsUtc(opts.endTime);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.summary,
    dates: `${dtStart}/${dtEnd}`,
    details: opts.description,
  });
  if (opts.location) {
    params.set("location", opts.location);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

