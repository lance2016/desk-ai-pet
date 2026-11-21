/** A time of day as typed into `TimeField`, always written back as "HH:MM". */

const HOURS = 24;
const MINUTES = 60;
/** "22:30", "9:5", "7：45", "7.45". */
const WITH_SEPARATOR = /^(\d{1,2})[:：.](\d{1,2})$/;
/** "9", "22", "930", "2230". */
const DIGITS_ONLY = /^\d{1,4}$/;

const pad = (value: number) => String(value).padStart(2, "0");
const clock = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;

/** The time `text` stands for, or null when it is not one. */
export function parseClock(text: string): string | null {
  const trimmed = text.trim();
  let hour: number;
  let minute: number;
  const separated = WITH_SEPARATOR.exec(trimmed);
  if (separated) {
    hour = Number(separated[1]);
    minute = Number(separated[2]);
  } else if (DIGITS_ONLY.test(trimmed)) {
    // One or two digits are an hour; three or four end with the minutes.
    hour = Number(trimmed.length <= 2 ? trimmed : trimmed.slice(0, -2));
    minute = trimmed.length <= 2 ? 0 : Number(trimmed.slice(-2));
  } else {
    return null;
  }
  return hour < HOURS && minute < MINUTES ? clock(hour, minute) : null;
}

/** `value` ("HH:MM") with its hour or minute moved by `delta`, wrapping like the system's time field. */
export function stepClock(value: string, part: "hour" | "minute", delta: number): string {
  const [hour, minute] = value.split(":").map(Number);
  const wrap = (current: number, size: number) => (current + delta + size) % size;
  return part === "hour" ? clock(wrap(hour, HOURS), minute) : clock(hour, wrap(minute, MINUTES));
}
