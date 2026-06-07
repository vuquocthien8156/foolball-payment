import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Match data is authored in Vietnam — anchor display on ICT so users abroad
// still see the actual kickoff time, not their local re-projection.
export const MATCH_TZ = "Asia/Ho_Chi_Minh";

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
