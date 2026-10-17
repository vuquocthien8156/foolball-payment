import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Match data is authored in Vietnam — anchor display on ICT so users abroad
// still see the actual kickoff time, not their local re-projection.
export const MATCH_TZ = "Asia/Ho_Chi_Minh";

export const getMatchDateTimeInput = (date: Date): { date: string; time: string } => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MATCH_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
};

export const createMatchDate = (date: string, time: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Enter a valid match date and time.");
  }
  const kickoff = new Date(`${date}T${time}:00+07:00`);
  if (isNaN(kickoff.getTime()) || getMatchDateTimeInput(kickoff).date !== date) {
    throw new Error("Enter a valid match date and time.");
  }
  return kickoff;
};

// Wall-clock hour & minute as observed in MATCH_TZ.
// Use this when a "is the time set?" check is needed — getHours()/getMinutes()
// read in the browser's TZ and can disagree with the displayed time.
export const getMatchTimeParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MATCH_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? "0"),
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? "0"),
  };
};

// Format a match's kickoff for display.
// Returns "07/06/2026 · 18:30" when time is set, "07/06/2026" when 00:00 (no time).
// Coerce Firestore Timestamp / Date / string / millis input.
type DateLike = Date | string | number | { toDate: () => Date } | null | undefined;

const toDate = (input: DateLike): Date | null => {
  if (input == null) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === "object" && typeof (input as { toDate?: () => Date }).toDate === "function") {
    const d = (input as { toDate: () => Date }).toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(input as string | number);
  return isNaN(d.getTime()) ? null : d;
};

export const formatMatchDate = (input: DateLike): string => {
  const d = toDate(input);
  if (!d) return "Không rõ";
  return d.toLocaleDateString("vi-VN", { timeZone: MATCH_TZ });
};

export const formatMatchDateTime = (input: DateLike): string => {
  const d = toDate(input);
  if (!d) return "Không rõ";
  const dateLabel = d.toLocaleDateString("vi-VN", { timeZone: MATCH_TZ });
  const { hour, minute } = getMatchTimeParts(d);
  if (hour === 0 && minute === 0) return dateLabel;
  const timeLabel = d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MATCH_TZ,
  });
  return `${dateLabel} · ${timeLabel}`;
};
